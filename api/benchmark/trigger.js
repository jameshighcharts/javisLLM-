const { enforceRateLimit, enforceTriggerToken } = require('../_rate-limit')
const {
  dispatchWorkflow,
  getGitHubConfig,
  listWorkflowRuns,
} = require('../_github')

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'
const DEFAULT_CLAUDE_OPUS_MODEL = 'claude-opus-4-5-20251101'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const MODEL_ALIASES = {
  'claude-3-5-sonnet-latest': DEFAULT_CLAUDE_MODEL,
  'claude-4-6-sonnet-latest': DEFAULT_CLAUDE_MODEL,
  'claude-sonnet-4-6': DEFAULT_CLAUDE_MODEL,
  'claude-4-6-opus-latest': DEFAULT_CLAUDE_OPUS_MODEL,
  'claude-opus-4-6': DEFAULT_CLAUDE_OPUS_MODEL,
  'gemini-3.0-flash': DEFAULT_GEMINI_MODEL,
  'gemini-3-flash-preview': DEFAULT_GEMINI_MODEL,
}
const FALLBACK_ALLOWED_MODELS = [
  DEFAULT_MODEL,
  'gpt-4o',
  'gpt-5.2',
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_OPUS_MODEL,
  DEFAULT_GEMINI_MODEL,
]
const OUR_TERMS_DEFAULT = 'Highcharts'
const MAX_OUR_TERMS_LENGTH = 300
const MAX_PROMPT_LIMIT = 10000
const RUN_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/
const OUR_TERMS_REGEX = /^[\w\s.,&()+/\-]+$/i

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

function normalizeNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  const bounded = Math.max(min, Math.min(max, parsed))
  return bounded
}

function normalizeModelAlias(value) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return ''
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
  const raw = process.env.BENCHMARK_ALLOWED_MODELS || ''
  const configured = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return normalizeModelList(
    configured.length > 0 ? configured : FALLBACK_ALLOWED_MODELS,
  )
}

function resolveModel(modelInput, allowedModels) {
  const normalizedMap = new Map(
    allowedModels.map((name) => [name.toLowerCase(), name]),
  )
  const normalizedInput = normalizeModelAlias(modelInput).toLowerCase()
  const resolved = normalizedMap.get(normalizedInput)
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(', ')}`,
    )
    error.statusCode = 400
    throw error
  }
  return resolved
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

function parseRequestedModels(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

function resolveModels(body, allowedModels) {
  const selectAll = parseBoolean(
    body.selectAllModels ?? body.selectAll ?? body.select_all,
    false,
  )

  let candidates = selectAll
    ? allowedModels
    : parseRequestedModels(body.models)

  if (candidates.length === 0 && typeof body.model === 'string' && body.model.trim()) {
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

function parseWebSearch(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no'].includes(normalized)) {
      return false
    }
  }
  return true
}

function resolveOurTerms(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return OUR_TERMS_DEFAULT
  }

  const normalized = value.trim()
  if (normalized.length > MAX_OUR_TERMS_LENGTH) {
    const error = new Error(
      `ourTerms is too long. Maximum length is ${MAX_OUR_TERMS_LENGTH} characters.`,
    )
    error.statusCode = 400
    throw error
  }
  if (!OUR_TERMS_REGEX.test(normalized)) {
    const error = new Error(
      'ourTerms contains unsupported characters. Use letters, numbers, spaces, and punctuation only.',
    )
    error.statusCode = 400
    throw error
  }
  return normalized
}

function resolveRunMonth(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }
  const normalized = value.trim()
  if (!RUN_MONTH_REGEX.test(normalized)) {
    const error = new Error('runMonth must use YYYY-MM format.')
    error.statusCode = 400
    throw error
  }
  return normalized
}

function resolvePromptLimit(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    const error = new Error('promptLimit must be an integer.')
    error.statusCode = 400
    throw error
  }
  if (parsed < 1) {
    const error = new Error('promptLimit must be at least 1.')
    error.statusCode = 400
    throw error
  }
  if (parsed > MAX_PROMPT_LIMIT) {
    const error = new Error(`promptLimit must be <= ${MAX_PROMPT_LIMIT}.`)
    error.statusCode = 400
    throw error
  }

  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function findTriggeredRun(triggerId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const runs = await listWorkflowRuns(15)
    const match = runs.find((run) => run.title.includes(triggerId))
    if (match) {
      return match
    }
    await sleep(1000)
  }
  return null
}

function isQueueTriggerEnabled() {
  return parseBoolean(process.env.USE_QUEUE_TRIGGER, false)
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
      Prefer: 'return=representation',
    },
  }
}

async function supabaseRestRequest(config, path, method, body, contextLabel) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers: config.headers,
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

async function triggerViaQueue(body, models, runs, temperature, webSearch, ourTerms, runMonth, promptLimit) {
  const restConfig = getSupabaseRestConfig()
  const effectiveRunMonth = runMonth || new Date().toISOString().slice(0, 7)

  const runPayload = {
    run_month: effectiveRunMonth,
    model: models.join(','),
    web_search_enabled: Boolean(webSearch),
    started_at: new Date().toISOString(),
  }

  const runInsertPayload = await supabaseRestRequest(
    restConfig,
    '/rest/v1/benchmark_runs',
    'POST',
    runPayload,
    'Insert benchmark run',
  )

  const insertedRun = Array.isArray(runInsertPayload)
    ? runInsertPayload[0]
    : runInsertPayload
  const runId = insertedRun && typeof insertedRun === 'object'
    ? String(insertedRun.id || '')
    : ''

  if (!runId) {
    const error = new Error('Supabase did not return benchmark run id.')
    error.statusCode = 502
    throw error
  }

  const enqueuePayload = await supabaseRestRequest(
    restConfig,
    '/rest/v1/rpc/enqueue_benchmark_run',
    'POST',
    {
      p_run_id: runId,
      p_models: models,
      p_our_terms: ourTerms,
      p_runs_per_model: runs,
      p_temperature: temperature,
      p_web_search: webSearch,
      p_prompt_limit: promptLimit,
    },
    'Enqueue benchmark jobs',
  )

  const enqueueResult = Array.isArray(enqueuePayload)
    ? enqueuePayload[0]
    : enqueuePayload
  const jobsEnqueued =
    enqueueResult && typeof enqueueResult === 'object'
      ? Number(enqueueResult.jobs_enqueued || 0)
      : 0

  return {
    runId,
    jobsEnqueued,
    models,
    promptLimit,
    runMonth: effectiveRunMonth,
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' })
    }

    const rateLimitMax = Math.round(
      normalizeNumber(process.env.BENCHMARK_TRIGGER_RATE_MAX, 5, 1, 100),
    )
    const rateLimitWindowMs = Math.round(
      normalizeNumber(
        process.env.BENCHMARK_TRIGGER_RATE_WINDOW_MS,
        60 * 1000,
        15 * 1000,
        60 * 60 * 1000,
      ),
    )
    enforceRateLimit(req, {
      bucket: 'benchmark-trigger',
      max: rateLimitMax,
      windowMs: rateLimitWindowMs,
    })

    enforceTriggerToken(req)
    const body = parseBody(req)
    const allowedModels = getAllowedModels()

    const models = resolveModels(body, allowedModels)
    const model = models[0]
    const ourTerms = resolveOurTerms(body.ourTerms)
    const runs = Math.round(normalizeNumber(body.runs, 1, 1, 3))
    const temperature = normalizeNumber(body.temperature, 0.7, 0, 2)
    const webSearch = parseWebSearch(body.webSearch)
    const runMonth = resolveRunMonth(body.runMonth)
    const promptLimit = resolvePromptLimit(body.promptLimit ?? body.prompt_limit)

    if (isQueueTriggerEnabled()) {
      const queueResult = await triggerViaQueue(
        body,
        models,
        runs,
        temperature,
        webSearch,
        ourTerms,
        runMonth,
        promptLimit,
      )

      return sendJson(res, 200, {
        ok: true,
        runId: queueResult.runId,
        jobsEnqueued: queueResult.jobsEnqueued,
        models: queueResult.models,
        promptLimit: queueResult.promptLimit,
        runMonth: queueResult.runMonth,
        message: 'Benchmark jobs enqueued.',
      })
    }

    // Legacy GitHub Actions path (feature-flag fallback).
    const config = getGitHubConfig()
    const triggerId = `ui-${Date.now()}`
    const workflowInputs = {
      trigger_id: triggerId,
      model,
      models: models.join(','),
      runs: String(runs),
      temperature: String(temperature),
      web_search: webSearch ? 'true' : 'false',
      our_terms: ourTerms,
      run_month: runMonth,
    }
    if (promptLimit !== null) {
      workflowInputs.prompt_limit = String(promptLimit)
    }

    await dispatchWorkflow(workflowInputs)
    const matchedRun = await findTriggeredRun(triggerId)

    return sendJson(res, 200, {
      ok: true,
      triggerId,
      workflow: config.workflow,
      repo: `${config.owner}/${config.repo}`,
      ref: config.ref,
      models,
      promptLimit,
      run: matchedRun,
      message: matchedRun
        ? 'Benchmark run queued in GitHub Actions.'
        : 'Benchmark dispatch sent. Run may take a few seconds to appear.',
    })
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500
    if (
      typeof error === 'object' &&
      error !== null &&
      Number(error.retryAfterSeconds)
    ) {
      res.setHeader('Retry-After', String(Math.round(Number(error.retryAfterSeconds))))
    }
    if (statusCode >= 500) {
      console.error('[benchmark.trigger] request failed', error)
    }
    const message =
      statusCode >= 500
        ? 'Internal server error.'
        : error instanceof Error
          ? error.message
          : String(error)
    return sendJson(res, statusCode, { error: message })
  }
}
