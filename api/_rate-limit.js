const RATE_LIMIT_BUCKETS = new Map()
const RATE_LIMIT_SWEEP_INTERVAL_MS = 60 * 1000

let lastRateLimitSweepAt = 0

function getAuthToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  const headerToken =
    req.headers['x-benchmark-token'] || req.headers['X-Benchmark-Token']
  if (typeof headerToken === 'string') {
    return headerToken.trim()
  }
  return ''
}

function getClientIp(req) {
  const realIp = req.headers['x-real-ip'] || req.headers['X-Real-IP']
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim()
  }

  const vercelForwardedFor =
    req.headers['x-vercel-forwarded-for'] || req.headers['X-Vercel-Forwarded-For']
  if (typeof vercelForwardedFor === 'string' && vercelForwardedFor.trim()) {
    const first = vercelForwardedFor.split(',')[0].trim()
    if (first) {
      return first
    }
  }

  const trustForwardedFor = String(process.env.TRUST_X_FORWARDED_FOR || '')
    .trim()
    .toLowerCase()
  if (trustForwardedFor === 'true') {
    const forwardedFor =
      req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      const first = forwardedFor.split(',')[0].trim()
      if (first) {
        return first
      }
    }
  }

  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress) {
    return req.socket.remoteAddress
  }

  return 'unknown'
}

function sweepRateLimits(now) {
  if (now - lastRateLimitSweepAt < RATE_LIMIT_SWEEP_INTERVAL_MS) {
    return
  }

  for (const [key, value] of RATE_LIMIT_BUCKETS.entries()) {
    if (!value || typeof value.resetAt !== 'number' || value.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key)
    }
  }
  lastRateLimitSweepAt = now
}

function enforceTriggerToken(req) {
  const required = (process.env.BENCHMARK_TRIGGER_TOKEN || '').trim()
  if (!required) {
    const error = new Error('Trigger token is not configured on the server.')
    error.statusCode = 500
    throw error
  }

  const provided = getAuthToken(req)
  if (!provided || provided !== required) {
    const error = new Error('Unauthorized trigger token.')
    error.statusCode = 401
    throw error
  }
}

function enforceRateLimit(req, options) {
  const windowMs = Number(options?.windowMs)
  const max = Number(options?.max)
  const bucket = typeof options?.bucket === 'string' ? options.bucket.trim() : ''

  if (!bucket || !Number.isFinite(windowMs) || !Number.isFinite(max)) {
    return
  }
  if (windowMs <= 0 || max <= 0) {
    return
  }

  const now = Date.now()
  sweepRateLimits(now)

  const key = `${bucket}:${getClientIp(req)}`
  const existing = RATE_LIMIT_BUCKETS.get(key)
  let state = existing

  if (!state || typeof state.resetAt !== 'number' || state.resetAt <= now) {
    state = { count: 0, resetAt: now + windowMs }
  }

  state.count += 1
  RATE_LIMIT_BUCKETS.set(key, state)

  if (state.count > max) {
    const error = new Error('Rate limit exceeded.')
    error.statusCode = 429
    error.retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000))
    throw error
  }
}

module.exports = {
  enforceRateLimit,
  enforceTriggerToken,
}
