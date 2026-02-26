const {
  enforceRateLimit,
} = require("../_github")

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
const ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages"
const GEMINI_GENERATE_CONTENT_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
const DEFAULT_MODEL = "gpt-4o-mini"
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929"
const DEFAULT_CLAUDE_OPUS_MODEL = "claude-opus-4-5-20251101"
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
const MODEL_ALIASES = {
  "claude-3-5-sonnet-latest": DEFAULT_CLAUDE_MODEL,
  "claude-4-6-sonnet-latest": DEFAULT_CLAUDE_MODEL,
  "claude-sonnet-4-6": DEFAULT_CLAUDE_MODEL,
  "claude-4-6-opus-latest": DEFAULT_CLAUDE_OPUS_MODEL,
  "claude-opus-4-6": DEFAULT_CLAUDE_OPUS_MODEL,
  "gemini-3.0-flash": DEFAULT_GEMINI_MODEL,
  "gemini-3-flash-preview": DEFAULT_GEMINI_MODEL,
}
const FALLBACK_ALLOWED_MODELS = [
  DEFAULT_MODEL,
  "gpt-4o",
  "gpt-5.2",
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_OPUS_MODEL,
  DEFAULT_GEMINI_MODEL,
]
const QUERY_MAX_LENGTH = 600
const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer with concise bullets and include direct library names."
const USER_PROMPT_TEMPLATE =
  "Query: {query}\nList relevant libraries/tools with a short rationale for each in bullet points."
const ANTHROPIC_API_VERSION = "2023-06-01"

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

function normalizeModelAlias(value) {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return ""
  }
  return MODEL_ALIASES[normalized.toLowerCase()] || normalized
}

function normalizeModelList(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const normalized = normalizeModelAlias(value)
    if (!normalized) {
      continue
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function getAllowedModels() {
  const configured = String(process.env.BENCHMARK_ALLOWED_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return normalizeModelList(
    configured.length > 0 ? configured : FALLBACK_ALLOWED_MODELS,
  )
}

function resolveModel(modelInput, allowedModels) {
  const normalizedMap = new Map(allowedModels.map((name) => [name.toLowerCase(), name]))
  const normalizedInput = normalizeModelAlias(modelInput).toLowerCase()
  const resolved = normalizedMap.get(normalizedInput)
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
    )
    error.statusCode = 400
    throw error
  }
  return resolved
}

function parseRequestedModels(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false
    }
  }
  return fallback
}

function resolveModels(body, allowedModels) {
  const selectAll = parseBoolean(
    body.selectAllModels ?? body.selectAll ?? body.select_all,
    false,
  )

  let candidates = selectAll
    ? allowedModels
    : parseRequestedModels(body.models)

  if (candidates.length === 0 && typeof body.model === "string" && body.model.trim()) {
    candidates = [body.model.trim()]
  }
  if (candidates.length === 0) {
    candidates = [DEFAULT_MODEL]
  }

  const resolved = []
  const seen = new Set()
  for (const candidate of candidates) {
    const model = resolveModel(candidate, allowedModels)
    const key = model.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    resolved.push(model)
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

function inferProviderFromModel(model) {
  const normalized = String(model || "").trim().toLowerCase()
  if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
    return "anthropic"
  }
  if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
    return "google"
  }
  return "openai"
}

function resolveApiKeyForProvider(provider) {
  const keyName =
    provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : provider === "google"
        ? "GEMINI_API_KEY"
        : "OPENAI_API_KEY"
  const value = String(process.env[keyName] || "").trim()
  if (!value) {
    const error = new Error(`Prompt lab is not configured. Set ${keyName} on the server.`)
    error.statusCode = 503
    error.exposeMessage = true
    throw error
  }
  return value
}

function resolveModelOwner(provider) {
  if (provider === "anthropic") return "Anthropic"
  if (provider === "google") return "Google"
  if (provider === "openai") return "OpenAI"
  return "Unknown"
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

  const contentItems = Array.isArray(responsePayload?.content) ? responsePayload.content : []
  for (const content of contentItems) {
    if (!content || typeof content !== "object") {
      continue
    }
    if (typeof content.text === "string" && content.text.trim()) {
      texts.push(content.text.trim())
    }
  }

  const candidates = Array.isArray(responsePayload?.candidates) ? responsePayload.candidates : []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }
    const content = candidate.content
    if (!content || typeof content !== "object") {
      continue
    }
    const parts = Array.isArray(content.parts) ? content.parts : []
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue
      }
      if (typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text.trim())
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

  const contentItems = Array.isArray(responsePayload?.content) ? responsePayload.content : []
  for (const content of contentItems) {
    if (!content || typeof content !== "object") {
      continue
    }
    if (Array.isArray(content.citations)) {
      for (const citation of content.citations) {
        appendCitation(citation)
      }
    }
  }

  const candidates = Array.isArray(responsePayload?.candidates) ? responsePayload.candidates : []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }
    const grounding = candidate.groundingMetadata
    if (!grounding || typeof grounding !== "object") {
      continue
    }
    const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : []
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") {
        continue
      }
      appendCitation(chunk)
      if (chunk.web && typeof chunk.web === "object") {
        appendCitation(chunk.web)
      }
    }
    const citationSources = Array.isArray(grounding.citationMetadata?.citationSources)
      ? grounding.citationMetadata.citationSources
      : []
    for (const source of citationSources) {
      appendCitation(source)
    }
  }

  return citations
}

function toNonNegativeInt(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }
  return Math.round(parsed)
}

function extractTokenUsage(responsePayload) {
  const usage = responsePayload?.usage && typeof responsePayload.usage === "object"
    ? responsePayload.usage
    : {}
  const usageMetadata =
    responsePayload?.usageMetadata && typeof responsePayload.usageMetadata === "object"
      ? responsePayload.usageMetadata
      : {}

  const inputTokens = Math.max(
    toNonNegativeInt(usage.input_tokens),
    toNonNegativeInt(usage.prompt_tokens),
    toNonNegativeInt(usageMetadata.promptTokenCount),
    toNonNegativeInt(usageMetadata.prompt_tokens),
  )
  const outputTokens = Math.max(
    toNonNegativeInt(usage.output_tokens),
    toNonNegativeInt(usage.completion_tokens),
    toNonNegativeInt(usageMetadata.candidatesTokenCount),
    toNonNegativeInt(usageMetadata.completion_tokens),
  )
  const totalTokens =
    Math.max(
      toNonNegativeInt(usage.total_tokens),
      toNonNegativeInt(usageMetadata.totalTokenCount),
      toNonNegativeInt(usageMetadata.total_tokens),
    ) || inputTokens + outputTokens

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

async function runOpenAiPromptLabQuery({ query, model, webSearch }) {
  const apiKey = resolveApiKeyForProvider("openai")
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
    tokens: extractTokenUsage(payload),
  }
}

async function runAnthropicPromptLabQuery({ query, model }) {
  const apiKey = resolveApiKeyForProvider("anthropic")
  const requestBody = {
    model,
    max_tokens: 1024,
    temperature: 0.7,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: USER_PROMPT_TEMPLATE.replace("{query}", query) },
    ],
  }

  const upstreamResponse = await fetch(ANTHROPIC_MESSAGES_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
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
        : `Anthropic request failed (${upstreamResponse.status}).`
    const error = new Error(upstreamMessage)
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status
    throw error
  }

  return {
    responseText: extractResponseText(payload),
    citations: extractCitations(payload),
    tokens: extractTokenUsage(payload),
  }
}

async function runGeminiPromptLabQuery({ query, model }) {
  const apiKey = resolveApiKeyForProvider("google")
  const modelPath = encodeURIComponent(model)
  const url =
    `${GEMINI_GENERATE_CONTENT_API_ROOT}/${modelPath}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`
  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: USER_PROMPT_TEMPLATE.replace("{query}", query) }],
      },
    ],
    generationConfig: { temperature: 0.7 },
  }

  const upstreamResponse = await fetch(url, {
    method: "POST",
    headers: {
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
        : `Gemini request failed (${upstreamResponse.status}).`
    const error = new Error(upstreamMessage)
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status
    throw error
  }

  return {
    responseText: extractResponseText(payload),
    citations: extractCitations(payload),
    tokens: extractTokenUsage(payload),
  }
}

async function runPromptLabQuery({ query, model, webSearch }) {
  const provider = inferProviderFromModel(model)
  if (provider === "anthropic") {
    return runAnthropicPromptLabQuery({ query, model, webSearch })
  }
  if (provider === "google") {
    return runGeminiPromptLabQuery({ query, model })
  }
  return runOpenAiPromptLabQuery({ query, model, webSearch })
}

async function runPromptLabQueryForModel({ query, model, webSearch }) {
  const provider = inferProviderFromModel(model)
  const modelOwner = resolveModelOwner(provider)
  const webSearchEnabled = provider === "openai" ? webSearch : false
  const startedAt = Date.now()
  try {
    const result = await runPromptLabQuery({
      query,
      model,
      webSearch: webSearchEnabled,
    })
    return {
      ok: true,
      model,
      provider,
      modelOwner,
      webSearchEnabled,
      responseText: result.responseText,
      citations: result.citations,
      tokens: result.tokens,
      durationMs: Date.now() - startedAt,
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      model,
      provider,
      modelOwner,
      webSearchEnabled,
      responseText: "",
      citations: [],
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function summarizePromptLabResults(results) {
  return results.reduce(
    (summary, result) => {
      summary.modelCount += 1
      if (result.ok) {
        summary.successCount += 1
      } else {
        summary.failureCount += 1
      }
      summary.totalDurationMs += toNonNegativeInt(result.durationMs)
      summary.totalInputTokens += toNonNegativeInt(result?.tokens?.inputTokens)
      summary.totalOutputTokens += toNonNegativeInt(result?.tokens?.outputTokens)
      summary.totalTokens += toNonNegativeInt(result?.tokens?.totalTokens)
      return summary
    },
    {
      modelCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    },
  )
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
    const models = resolveModels(body, allowedModels)
    const requestedWebSearch = parseWebSearch(body.webSearch)
    const results = await Promise.all(
      models.map((modelName) =>
        runPromptLabQueryForModel({
          query,
          model: modelName,
          webSearch: requestedWebSearch,
        }),
      ),
    )
    const summary = summarizePromptLabResults(results)
    const primaryResult = results[0] || null
    return sendJson(res, 200, {
      ok: summary.successCount > 0,
      query,
      models,
      results,
      summary,
      // Backwards compatibility for single-model callers.
      model: primaryResult?.model ?? null,
      provider: primaryResult?.provider ?? null,
      modelOwner: primaryResult?.modelOwner ?? null,
      webSearchEnabled: Boolean(primaryResult?.webSearchEnabled),
      responseText: primaryResult?.responseText ?? "",
      citations: primaryResult?.citations ?? [],
      durationMs: toNonNegativeInt(primaryResult?.durationMs),
      tokens: primaryResult?.tokens ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500
    const exposeMessage =
      typeof error === "object" &&
      error !== null &&
      Boolean(error.exposeMessage)
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
      statusCode >= 500 && !exposeMessage
        ? "Internal server error."
        : error instanceof Error
          ? error.message
          : String(error)
    return sendJson(res, statusCode, { error: message })
  }
}
