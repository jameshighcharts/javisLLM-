const {
  dispatchWorkflow,
  enforceRateLimit,
  enforceTriggerToken,
  getGitHubConfig,
  listWorkflowRuns,
} = require('../_github')

const DEFAULT_MODEL = 'gpt-4o-mini'

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
    const ourTerms =
      typeof body.ourTerms === 'string' && body.ourTerms.trim()
        ? body.ourTerms.trim()
        : 'Highcharts'
    const runs = Math.round(normalizeNumber(body.runs, 3, 1, 10))
    const temperature = normalizeNumber(body.temperature, 0.7, 0, 2)
    const webSearch = Boolean(body.webSearch ?? true)
    const runMonth =
      typeof body.runMonth === 'string' && /^\d{4}-\d{2}$/.test(body.runMonth.trim())
        ? body.runMonth.trim()
        : ''

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
    return sendJson(res, statusCode, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
