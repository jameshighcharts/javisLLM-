const {
  dispatchWorkflow,
  enforceRateLimit,
  enforceTriggerToken,
  getGitHubConfig,
  listWorkflowRuns,
} = require('../_github')

const DEFAULT_MODEL = 'gpt-4o-mini'
const OUR_TERMS_DEFAULT = 'Highcharts'
const MAX_OUR_TERMS_LENGTH = 300
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

function getAllowedModels() {
  const raw = process.env.BENCHMARK_ALLOWED_MODELS || ''
  const configured = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return configured.length > 0 ? configured : [DEFAULT_MODEL]
}

function resolveModel(modelInput, allowedModels) {
  const normalizedMap = new Map(
    allowedModels.map((name) => [name.toLowerCase(), name]),
  )
  const resolved = normalizedMap.get(modelInput.toLowerCase())
  if (!resolved) {
    const error = new Error(
      `Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(', ')}`,
    )
    error.statusCode = 400
    throw error
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
    const config = getGitHubConfig()
    const body = parseBody(req)
    const triggerId = `ui-${Date.now()}`
    const allowedModels = getAllowedModels()

    const requestedModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL
    const model = resolveModel(requestedModel, allowedModels)
    const ourTerms = resolveOurTerms(body.ourTerms)
    const runs = Math.round(normalizeNumber(body.runs, 1, 1, 3))
    const temperature = normalizeNumber(body.temperature, 0.7, 0, 2)
    const webSearch = parseWebSearch(body.webSearch)
    const runMonth = resolveRunMonth(body.runMonth)

    await dispatchWorkflow({
      trigger_id: triggerId,
      model,
      runs: String(runs),
      temperature: String(temperature),
      web_search: webSearch ? 'true' : 'false',
      our_terms: ourTerms,
      run_month: runMonth,
    })

    const matchedRun = await findTriggeredRun(triggerId)

    return sendJson(res, 200, {
      ok: true,
      triggerId,
      workflow: config.workflow,
      repo: `${config.owner}/${config.repo}`,
      ref: config.ref,
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
