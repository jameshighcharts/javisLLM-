const { createHash } = require('node:crypto')

const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_RESEARCH_MODEL = 'gpt-5.2'
const DEFAULT_BRIEF_MODEL = 'gpt-5.2'
const FALLBACK_ALLOWED_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-5.2',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
  'gemini-2.5-flash',
]

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function parseBody(req) {
  if (!req.body) {
    return {}
  }
  if (typeof req.body === 'object') {
    return req.body
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return {}
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }
  return fallback
}

function ensureResearchFeaturesEnabled() {
  const enabled = parseBoolean(process.env.ENABLE_RESEARCH_FEATURES, true)
  if (!enabled) {
    const error = new Error('Research features are disabled.')
    error.statusCode = 404
    throw error
  }
}

function normalizeModelAlias(value) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return ''
  }
  return normalized
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
  const raw = process.env.BENCHMARK_ALLOWED_MODELS || ''
  const configured = String(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return normalizeModelList(
    configured.length > 0 ? configured : FALLBACK_ALLOWED_MODELS,
  )
}

function resolveModel(modelInput, fallbackModel = DEFAULT_RESEARCH_MODEL) {
  const allowedModels = getAllowedModels()
  const normalizedMap = new Map(allowedModels.map((name) => [name.toLowerCase(), name]))
  const candidate = normalizeModelAlias(modelInput || fallbackModel)
  const resolved = normalizedMap.get(candidate.toLowerCase())
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${candidate}". Allowed models: ${allowedModels.join(', ')}`,
    )
    error.statusCode = 400
    throw error
  }
  return resolved
}

function inferProviderFromModel(model) {
  const normalized = String(model || '').trim().toLowerCase()
  if (normalized.startsWith('claude') || normalized.startsWith('anthropic/')) {
    return 'anthropic'
  }
  if (normalized.startsWith('gemini') || normalized.startsWith('google/')) {
    return 'google'
  }
  return 'openai'
}

function ensureOpenAiModel(model) {
  const provider = inferProviderFromModel(model)
  if (provider !== 'openai') {
    const error = new Error('Research endpoints currently require an OpenAI model for web search.')
    error.statusCode = 400
    throw error
  }
}

function getSupabaseRestConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const anonKey = String(
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
  ).trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const error = new Error(
      'Missing Supabase env config. Set SUPABASE_URL, SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY), and SUPABASE_SERVICE_ROLE_KEY.',
    )
    error.statusCode = 500
    throw error
  }

  return {
    supabaseUrl,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  }
}

async function supabaseRestRequest(config, path, method, body, contextLabel, extraHeaders = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers: {
      ...config.headers,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const raw = await response.text()
  let payload = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && (payload.message || payload.error || payload.hint)) ||
      `${contextLabel} failed (${response.status})`
    const error = new Error(String(message))
    error.statusCode = response.status >= 500 ? 502 : response.status
    error.payload = payload
    throw error
  }

  return payload
}

function cleanText(value, fallback = '') {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractTagText(block, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = String(block || '').match(pattern)
  return match ? decodeXmlEntities(match[1].trim()) : ''
}

function parseSitemapXml(xml) {
  const text = String(xml || '')
  const sitemapBlocks = text.match(/<sitemap\b[\s\S]*?<\/sitemap>/gi) || []
  if (sitemapBlocks.length > 0) {
    return {
      type: 'index',
      entries: sitemapBlocks
        .map((block) => ({
          loc: extractTagText(block, 'loc'),
          lastmod: extractTagText(block, 'lastmod') || null,
        }))
        .filter((entry) => entry.loc),
    }
  }

  const urlBlocks = text.match(/<url\b[\s\S]*?<\/url>/gi) || []
  if (urlBlocks.length > 0) {
    return {
      type: 'urlset',
      entries: urlBlocks
        .map((block) => ({
          loc: extractTagText(block, 'loc'),
          lastmod: extractTagText(block, 'lastmod') || null,
        }))
        .filter((entry) => entry.loc),
    }
  }

  return {
    type: 'unknown',
    entries: [],
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHtmlTag(html, tag) {
  const match = String(html || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? stripHtml(match[1]) : ''
}

function extractMetaDescription(html) {
  const match = String(html || '').match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  )
  if (match && match[1]) {
    return decodeXmlEntities(match[1].trim())
  }

  const reverseMatch = String(html || '').match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
  )
  return reverseMatch && reverseMatch[1] ? decodeXmlEntities(reverseMatch[1].trim()) : ''
}

function extractCanonicalUrl(html) {
  const match = String(html || '').match(
    /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  )
  if (match && match[1]) {
    return match[1].trim()
  }

  const reverseMatch = String(html || '').match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i,
  )
  return reverseMatch && reverseMatch[1] ? reverseMatch[1].trim() : ''
}

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

function normalizeDate(value) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return null
  }
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return new Date(parsed).toISOString()
}

async function fetchTextWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'easy-llm-benchmarker/1.0',
      },
    })
    const text = await response.text()
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`)
      error.statusCode = response.status >= 500 ? 502 : response.status
      throw error
    }
    return text
  } finally {
    clearTimeout(timeoutId)
  }
}

function slugifyCompetitorName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function inferDomainCandidates(competitorName, knownLinks = []) {
  const slug = slugifyCompetitorName(competitorName)
  const baseCandidates = new Set()

  if (slug) {
    baseCandidates.add(`https://${slug}.com`)
    baseCandidates.add(`https://www.${slug}.com`)
  }

  for (const link of knownLinks) {
    try {
      const parsed = new URL(String(link || '').trim())
      if (!parsed.hostname) {
        continue
      }
      baseCandidates.add(`https://${parsed.hostname}`)
    } catch {
      continue
    }
  }

  const paths = ['/blog', '/resources', '/docs', '/learn']
  const candidates = []
  for (const base of baseCandidates) {
    candidates.push(base)
    for (const path of paths) {
      candidates.push(`${base}${path}`)
    }
  }

  return [...new Set(candidates)]
}

function extractResponseText(payload) {
  const outputText = payload?.output_text
  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText.trim()
  }

  const chunks = []
  const outputItems = Array.isArray(payload?.output) ? payload.output : []
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== 'object') {
      continue
    }
    const contentItems = Array.isArray(outputItem.content) ? outputItem.content : []
    for (const content of contentItems) {
      if (!content || typeof content !== 'object') {
        continue
      }
      if (typeof content.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim())
      }
    }
  }

  return chunks.join('\n').trim()
}

function extractCitations(payload) {
  const out = []
  const seen = new Set()

  const appendCitation = (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return
    }
    const url = [candidate.url, candidate.uri, candidate.href, candidate.source].find(
      (value) => typeof value === 'string' && value.trim(),
    )
    if (!url || typeof url !== 'string') {
      return
    }
    const normalized = url.trim()
    if (seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    out.push(normalized)
  }

  for (const key of ['citations', 'sources', 'references']) {
    const entries = payload?.[key]
    if (!Array.isArray(entries)) {
      continue
    }
    for (const entry of entries) {
      appendCitation(entry)
    }
  }

  const outputItems = Array.isArray(payload?.output) ? payload.output : []
  for (const outputItem of outputItems) {
    if (!outputItem || typeof outputItem !== 'object') {
      continue
    }
    const contentItems = Array.isArray(outputItem.content) ? outputItem.content : []
    for (const content of contentItems) {
      if (!content || typeof content !== 'object') {
        continue
      }
      if (Array.isArray(content.citations)) {
        for (const citation of content.citations) {
          appendCitation(citation)
        }
      }
      if (Array.isArray(content.annotations)) {
        for (const annotation of content.annotations) {
          appendCitation(annotation)
          appendCitation(annotation.url_citation)
        }
      }
    }
  }

  return out
}

function extractJsonFromText(text) {
  const normalized = String(text || '').trim()
  if (!normalized) {
    return null
  }

  const fenced = normalized.match(/```json\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(normalized)
  } catch {
    // fall through
  }

  const firstArray = normalized.indexOf('[')
  const lastArray = normalized.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) {
    const slice = normalized.slice(firstArray, lastArray + 1)
    try {
      return JSON.parse(slice)
    } catch {
      // fall through
    }
  }

  const firstObject = normalized.indexOf('{')
  const lastObject = normalized.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) {
    const slice = normalized.slice(firstObject, lastObject + 1)
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }

  return null
}

function resolveOpenAiApiKey() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) {
    const error = new Error('Research endpoints require OPENAI_API_KEY.')
    error.statusCode = 503
    error.exposeMessage = true
    throw error
  }
  return apiKey
}

async function runOpenAiWebSearch(model, messages, options = {}) {
  const apiKey = resolveOpenAiApiKey()
  const requestBody = {
    model,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
    input: messages,
  }
  if (options.webSearch !== false) {
    requestBody.tools = [{ type: 'web_search_preview' }]
  }

  const upstreamResponse = await fetch(OPENAI_RESPONSES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `OpenAI request failed (${upstreamResponse.status}).`
    const error = new Error(upstreamMessage)
    error.statusCode = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status
    throw error
  }

  return {
    payload,
    responseText: extractResponseText(payload),
    citations: extractCitations(payload),
  }
}

async function runOpenAiJsonWithRetry({ model, systemPrompt, userPrompt, maxAttempts = 2, webSearch = true }) {
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runOpenAiWebSearch(
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { webSearch, temperature: 0.2 },
    )

    const parsed = extractJsonFromText(result.responseText)
    if (parsed !== null) {
      return {
        ...result,
        parsed,
        attempt,
      }
    }

    lastError = new Error('Model response did not contain valid JSON.')
    if (attempt < maxAttempts) {
      continue
    }
  }

  throw lastError || new Error('Model response parsing failed.')
}

async function createResearchRun(config, { runType, model = null, params = {} }) {
  const inserted = await supabaseRestRequest(
    config,
    '/rest/v1/research_runs',
    'POST',
    {
      run_type: runType,
      status: 'running',
      model,
      params,
      started_at: new Date().toISOString(),
    },
    'Create research run',
    { Prefer: 'return=representation' },
  )

  const row = Array.isArray(inserted) ? inserted[0] : inserted
  const runId = row && typeof row === 'object' ? String(row.id || '') : ''
  if (!runId) {
    const error = new Error('Research run insert did not return id.')
    error.statusCode = 502
    throw error
  }
  return runId
}

async function completeResearchRun(config, runId, stats = {}) {
  await supabaseRestRequest(
    config,
    `/rest/v1/research_runs?id=eq.${encodeURIComponent(runId)}`,
    'PATCH',
    {
      status: 'completed',
      stats,
      completed_at: new Date().toISOString(),
    },
    'Complete research run',
  )
}

async function failResearchRun(config, runId, errorText) {
  await supabaseRestRequest(
    config,
    `/rest/v1/research_runs?id=eq.${encodeURIComponent(runId)}`,
    'PATCH',
    {
      status: 'failed',
      error: cleanText(errorText).slice(0, 2000),
      completed_at: new Date().toISOString(),
    },
    'Fail research run',
  )
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function scoreMentionDeficit(topCompetitorRatePct, brandRatePct) {
  return clamp(Math.max(0, (topCompetitorRatePct - brandRatePct) / 100), 0, 1)
}

function scoreCoverageFromDays(daysSincePublish) {
  return Math.exp(-Math.max(0, daysSincePublish) / 30)
}

function scoreComposite(mentionDeficitScore, competitorCoverageScore) {
  return clamp((0.6 * mentionDeficitScore) + (0.4 * competitorCoverageScore), 0, 1)
}

function computeProgressPct(upliftPp, targetPp) {
  if (targetPp <= 0) {
    return 0
  }
  return clamp((upliftPp / targetPp) * 100, -100, 200)
}

function addWeeks(isoDate, weeks) {
  const parsed = Date.parse(String(isoDate || ''))
  if (!Number.isFinite(parsed)) {
    return null
  }
  return new Date(parsed + (Math.max(0, Number(weeks) || 0) * 7 * 24 * 60 * 60 * 1000)).toISOString()
}

function hasNonEmptyCitationArray(value) {
  if (!Array.isArray(value)) {
    return false
  }
  return value.some((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const url = [item.url, item.link, item.href].find(
      (entry) => typeof entry === 'string' && entry.trim(),
    )
    return Boolean(url)
  })
}

module.exports = {
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_BRIEF_MODEL,
  sendJson,
  parseBody,
  parseBoolean,
  ensureResearchFeaturesEnabled,
  resolveModel,
  ensureOpenAiModel,
  inferProviderFromModel,
  getSupabaseRestConfig,
  supabaseRestRequest,
  cleanText,
  decodeXmlEntities,
  parseSitemapXml,
  stripHtml,
  extractHtmlTag,
  extractMetaDescription,
  extractCanonicalUrl,
  sha256,
  normalizeDate,
  fetchTextWithTimeout,
  inferDomainCandidates,
  extractJsonFromText,
  runOpenAiWebSearch,
  runOpenAiJsonWithRetry,
  createResearchRun,
  completeResearchRun,
  failResearchRun,
  toNumber,
  clamp,
  scoreMentionDeficit,
  scoreCoverageFromDays,
  scoreComposite,
  computeProgressPct,
  addWeeks,
  hasNonEmptyCitationArray,
}
