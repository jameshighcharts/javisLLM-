const {
  sendJson,
  ensureResearchFeaturesEnabled,
  getSupabaseRestConfig,
  supabaseRestRequest,
} = require('./_shared')

const ALLOWED_STATUSES = new Set(['backlog', 'in_progress', 'published', 'verify', 'closed'])

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 100
  }
  return Math.max(1, Math.min(200, Math.round(parsed)))
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed. Use GET.' })
    }

    ensureResearchFeaturesEnabled()

    const config = getSupabaseRestConfig()
    const status = cleanText(req.query?.status).toLowerCase()
    const tag = cleanText(req.query?.tag).toLowerCase()
    const limit = normalizeLimit(req.query?.limit)

    const filters = [
      'select=id,topic_key,topic_label,prompt_query_id,cohort_tag,mention_deficit_score,competitor_coverage_score,composite_score,evidence_count,evidence_citations,status,linked_page_url,brief_markdown,brief_checklist,brief_citations,brief_model,brief_generated_at,created_at,updated_at',
      `limit=${encodeURIComponent(String(limit))}`,
      'order=composite_score.desc,updated_at.desc',
    ]

    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        const error = new Error(`Invalid status filter. Allowed: ${[...ALLOWED_STATUSES].join(', ')}`)
        error.statusCode = 400
        throw error
      }
      filters.push(`status=eq.${encodeURIComponent(status)}`)
    }

    if (tag) {
      filters.push(`cohort_tag=eq.${encodeURIComponent(tag)}`)
    }

    const rows = await supabaseRestRequest(
      config,
      `/rest/v1/content_gap_items?${filters.join('&')}`,
      'GET',
      undefined,
      'Load content gaps',
    )

    return sendJson(res, 200, {
      ok: true,
      gaps: Array.isArray(rows) ? rows : [],
    })
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500

    if (statusCode >= 500) {
      console.error('[research.gaps.list] request failed', error)
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
