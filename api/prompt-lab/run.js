const {
  enforceRateLimit,
} = require("../_github")

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
const DEFAULT_MODEL = "gpt-4o-mini"
const FALLBACK_ALLOWED_MODELS = [DEFAULT_MODEL, "gpt-4o"]
const QUERY_MAX_LENGTH = 600
const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer with concise bullets and include direct library names."
const USER_PROMPT_TEMPLATE =
  "Query: {query}\nList relevant libraries/tools with a short rationale for each in bullet points."

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(payload))
}

function parseBody(req) {
  if (!req.body) {
    return {}
  }
  if (typeof req.body === "object") {
    return req.body
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

function getAllowedModels() {
  const configured = String(process.env.BENCHMARK_ALLOWED_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return configured.length > 0 ? configured : FALLBACK_ALLOWED_MODELS
}

function resolveModel(modelInput, allowedModels) {
  const normalizedMap = new Map(allowedModels.map((name) => [name.toLowerCase(), name]))
  const resolved = normalizedMap.get(String(modelInput).toLowerCase())
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
    )
    error.statusCode = 400
    throw error
  }
  return resolved
}

function resolveQuery(value) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error("query is required.")
    error.statusCode = 400
    throw error
  }
  const query = value.trim()
  if (query.length > QUERY_MAX_LENGTH) {
    const error = new Error(`query is too long. Maximum length is ${QUERY_MAX_LENGTH} characters.`)
    error.statusCode = 400
    throw error
  }
  return query
}

function parseWebSearch(value) {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes"].includes(normalized)) {
      return true
    }
    if (["0", "false", "no"].includes(normalized)) {
      return false
    }
  }
  return true
}

function extractResponseText(responsePayload) {
  const outputText = responsePayload?.output_text
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim()
  }

  const texts = []
  const outputItems = Array.isArray(responsePayload?.output) ? responsePayload.output : []
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== "object") {
      continue
    }
    const contentItems = Array.isArray(outputItem.content) ? outputItem.content : []
    for (const content of contentItems) {
      if (!content || typeof content !== "object") {
        continue
      }
      if (typeof content.text === "string" && content.text.trim()) {
        texts.push(content.text.trim())
      }
    }
  }

  return texts.join("\n").trim()
}

function extractCitations(responsePayload) {
  const citations = []
  const seen = new Set()

  const appendCitation = (candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return
    }
    const urlCandidate = [candidate.url, candidate.uri, candidate.href, candidate.source].find(
      (value) => typeof value === "string" && value.trim(),
    )
    if (typeof urlCandidate !== "string") {
      return
    }
    const normalized = urlCandidate.trim()
    if (seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    citations.push(normalized)
  }

  for (const key of ["citations", "sources", "references"]) {
    const topLevelValue = responsePayload?.[key]
    if (!Array.isArray(topLevelValue)) {
      continue
    }
    for (const item of topLevelValue) {
      appendCitation(item)
    }
  }

  const outputItems = Array.isArray(responsePayload?.output) ? responsePayload.output : []
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== "object") {
      continue
    }
    const contentItems = Array.isArray(outputItem.content) ? outputItem.content : []
    for (const content of contentItems) {
      if (!content || typeof content !== "object") {
        continue
      }
      if (Array.isArray(content.citations)) {
        for (const citation of content.citations) {
          appendCitation(citation)
        }
      }
      if (!Array.isArray(content.annotations)) {
        continue
      }
      for (const annotation of content.annotations) {
        appendCitation(annotation)
        appendCitation(annotation?.url_citation)
      }
    }
  }

  return citations
}

async function runPromptLabQuery({ query, model, webSearch }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim()
  if (!apiKey) {
    const error = new Error("Prompt lab is not configured on the server.")
    error.statusCode = 500
    throw error
  }

  const requestBody = {
    model,
    temperature: 0.7,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT_TEMPLATE.replace("{query}", query) },
    ],
  }
  if (webSearch) {
    requestBody.tools = [{ type: "web_search_preview" }]
  }

  const upstreamResponse = await fetch(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  const raw = await upstreamResponse.text()
  let payload = {}
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = {}
    }
  }

  if (!upstreamResponse.ok) {
    const upstreamMessage =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `OpenAI request failed (${upstreamResponse.status}).`
    const error = new Error(upstreamMessage)
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status
    throw error
  }

  return {
    responseText: extractResponseText(payload),
    citations: extractCitations(payload),
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed. Use POST." })
    }

    const rateLimitMax = Math.round(
      normalizeNumber(process.env.PROMPT_LAB_RATE_MAX, 15, 1, 200),
    )
    const rateLimitWindowMs = Math.round(
      normalizeNumber(process.env.PROMPT_LAB_RATE_WINDOW_MS, 60 * 1000, 15 * 1000, 60 * 60 * 1000),
    )
    enforceRateLimit(req, {
      bucket: "prompt-lab-run",
      max: rateLimitMax,
      windowMs: rateLimitWindowMs,
    })

    const body = parseBody(req)
    const query = resolveQuery(body.query)
    const allowedModels = getAllowedModels()
    const requestedModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL
    const model = resolveModel(requestedModel, allowedModels)
    const webSearch = parseWebSearch(body.webSearch)
    const startedAt = Date.now()

    const result = await runPromptLabQuery({ query, model, webSearch })
    return sendJson(res, 200, {
      ok: true,
      query,
      model,
      webSearchEnabled: webSearch,
      responseText: result.responseText,
      citations: result.citations,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500
    if (
      typeof error === "object" &&
      error !== null &&
      Number(error.retryAfterSeconds)
    ) {
      res.setHeader("Retry-After", String(Math.round(Number(error.retryAfterSeconds))))
    }
    if (statusCode >= 500) {
      console.error("[prompt-lab.run] request failed", error)
    }
    const message =
      statusCode >= 500
        ? "Internal server error."
        : error instanceof Error
          ? error.message
          : String(error)
    return sendJson(res, statusCode, { error: message })
  }
}
