const {
  enforceRateLimit,
  enforceTriggerToken,
  getGitHubConfig,
  listWorkflowRuns,
} = require('../_github')

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed. Use GET.' })
    }

    const rateLimitMax = Number(process.env.BENCHMARK_RUNS_RATE_MAX || 30)
    const rateLimitWindowMs = Number(process.env.BENCHMARK_RUNS_RATE_WINDOW_MS || 60 * 1000)
    enforceRateLimit(req, {
      bucket: 'benchmark-runs',
      max: Number.isFinite(rateLimitMax) ? rateLimitMax : 30,
      windowMs: Number.isFinite(rateLimitWindowMs) ? rateLimitWindowMs : 60 * 1000,
    })

    enforceTriggerToken(req)
    const config = getGitHubConfig()
    const runs = await listWorkflowRuns(15)

    return sendJson(res, 200, {
      ok: true,
      workflow: config.workflow,
      repo: `${config.owner}/${config.repo}`,
      runs,
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
      console.error('[benchmark.runs] request failed', error)
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
