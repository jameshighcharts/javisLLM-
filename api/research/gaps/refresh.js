const { enforceRateLimit, enforceTriggerToken } = require('../../_rate-limit')
const {
  sendJson,
  ensureResearchFeaturesEnabled,
  getSupabaseRestConfig,
  supabaseRestRequest,
  createResearchRun,
  completeResearchRun,
  failResearchRun,
  toNumber,
  scoreMentionDeficit,
  scoreCoverageFromDays,
  scoreComposite,
  cleanText,
} = require('../_shared')

const STOP_WORDS = new Set([
  'what',
  'which',
  'when',
  'where',
  'about',
  'best',
  'with',
  'from',
  'that',
  'this',
  'have',
  'into',
  'using',
  'chart',
  'charts',
  'library',
  'libraries',
  'tool',
  'tools',
  'javascript',
  'react',
])

function normalizeTopicKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function promptTokens(queryText) {
  return [...new Set(
    cleanText(queryText)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  )]
}

function parseDate(value) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return null
  }
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

function normalizeEvidencePosts(posts) {
  return (Array.isArray(posts) ? posts : [])
    .map((row) => {
      const link = cleanText(row?.link)
      if (!link) {
        return null
      }
      const publishDateRaw = cleanText(row?.published_at || row?.publish_date)
      const publishMs = parseDate(publishDateRaw)
      return {
        source: cleanText(row?.source, 'Unknown'),
        title: cleanText(row?.title, 'Untitled'),
        summary: cleanText(row?.description),
        theme: cleanText(row?.content_theme, 'General'),
        link,
        publishMs,
        publishDateRaw: publishDateRaw || null,
      }
    })
    .filter(Boolean)
}

function gatherEvidenceForPrompt(queryText, normalizedPosts) {
  const tokens = promptTokens(queryText)
  if (tokens.length === 0) {
    return []
  }

  const scored = []
  for (const post of normalizedPosts) {
    const haystack = `${post.title} ${post.summary} ${post.theme}`.toLowerCase()
    let matches = 0
    for (const token of tokens) {
      if (haystack.includes(token)) {
        matches += 1
      }
    }
    if (matches > 0) {
      scored.push({
        ...post,
        matches,
      })
    }
  }

  return scored.sort((left, right) => {
    if (right.matches !== left.matches) {
      return right.matches - left.matches
    }
    const leftDate = left.publishMs || 0
    const rightDate = right.publishMs || 0
    return rightDate - leftDate
  })
}

function extractCohortTag(tags) {
  if (!Array.isArray(tags)) {
    return null
  }
  const cohort = tags
    .map((tag) => cleanText(tag).toLowerCase())
    .find((tag) => tag.startsWith('cohort:'))
  return cohort || null
}

function chunkArray(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

module.exports = async (req, res) => {
  let researchRunId = null
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' })
    }

    ensureResearchFeaturesEnabled()

    enforceRateLimit(req, {
      bucket: 'research-gaps-refresh',
      max: 8,
      windowMs: 60 * 1000,
    })
    enforceTriggerToken(req)

    const config = getSupabaseRestConfig()
    researchRunId = await createResearchRun(config, {
      runType: 'gap_refresh',
      params: {},
    })

    const [runs, competitors, promptQueries, blogPosts, existingGaps] = await Promise.all([
      supabaseRestRequest(
        config,
        '/rest/v1/benchmark_runs?select=id,created_at,ended_at&ended_at=not.is.null&order=created_at.desc&limit=1',
        'GET',
        undefined,
        'Load latest completed run',
      ),
      supabaseRestRequest(
        config,
        '/rest/v1/competitors?select=id,name,slug,is_primary&is_active=eq.true&order=sort_order.asc,name.asc',
        'GET',
        undefined,
        'Load competitors',
      ),
      supabaseRestRequest(
        config,
        '/rest/v1/prompt_queries?select=id,query_text,tags&is_active=eq.true&order=sort_order.asc,created_at.asc',
        'GET',
        undefined,
        'Load prompt queries',
      ),
      supabaseRestRequest(
        config,
        '/rest/v1/competitor_blog_posts?select=source,title,description,content_theme,link,publish_date,published_at&order=published_at.desc.nullslast,publish_date.desc.nullslast&limit=5000',
        'GET',
        undefined,
        'Load competitor evidence',
      ),
      supabaseRestRequest(
        config,
        '/rest/v1/content_gap_items?select=id,topic_key,status,linked_page_url,brief_markdown,brief_checklist,brief_citations,brief_model,brief_generated_at',
        'GET',
        undefined,
        'Load existing gaps',
      ),
    ])

    const latestRun = Array.isArray(runs) ? runs[0] : null
    if (!latestRun?.id) {
      const error = new Error('No completed benchmark run found. Run a benchmark before refreshing gaps.')
      error.statusCode = 400
      throw error
    }

    const brandCompetitor = (Array.isArray(competitors) ? competitors : []).find((entry) => entry?.is_primary)
      || (Array.isArray(competitors) ? competitors : []).find((entry) => cleanText(entry?.slug).toLowerCase() === 'highcharts')
      || null

    if (!brandCompetitor?.id) {
      const error = new Error('Could not identify primary brand competitor (is_primary or slug=highcharts).')
      error.statusCode = 400
      throw error
    }

    const mentionRows = await supabaseRestRequest(
      config,
      `/rest/v1/mv_competitor_mention_rates?select=run_id,query_id,competitor_id,mentions_rate_pct,is_overall_row&run_id=eq.${encodeURIComponent(latestRun.id)}&is_overall_row=eq.false&limit=100000`,
      'GET',
      undefined,
      'Load mention rates',
    )

    const byQueryId = new Map()
    for (const row of Array.isArray(mentionRows) ? mentionRows : []) {
      const queryId = cleanText(row?.query_id)
      const competitorId = cleanText(row?.competitor_id)
      if (!queryId || !competitorId) {
        continue
      }
      const bucket = byQueryId.get(queryId) || []
      bucket.push({
        competitorId,
        ratePct: toNumber(row?.mentions_rate_pct, 0),
      })
      byQueryId.set(queryId, bucket)
    }

    const evidencePosts = normalizeEvidencePosts(blogPosts)
    const existingByTopicKey = new Map(
      (Array.isArray(existingGaps) ? existingGaps : [])
        .map((row) => [cleanText(row?.topic_key), row])
        .filter(([key]) => Boolean(key)),
    )

    const actionableRows = []

    for (const prompt of Array.isArray(promptQueries) ? promptQueries : []) {
      const promptId = cleanText(prompt?.id)
      const queryText = cleanText(prompt?.query_text)
      if (!promptId || !queryText) {
        continue
      }

      const rates = byQueryId.get(promptId) || []
      const brandRatePct = rates.find((entry) => entry.competitorId === brandCompetitor.id)?.ratePct || 0
      const topCompetitorRatePct = rates
        .filter((entry) => entry.competitorId !== brandCompetitor.id)
        .reduce((max, entry) => Math.max(max, entry.ratePct), 0)

      const mentionDeficitScore = scoreMentionDeficit(topCompetitorRatePct, brandRatePct)

      const evidence = gatherEvidenceForPrompt(queryText, evidencePosts)
      const evidenceCount = evidence.length
      const coverageRaw = evidence
        .slice(0, 25)
        .reduce((sum, post) => {
          if (!post.publishMs) {
            return sum
          }
          const daysSincePublish = Math.max(0, (Date.now() - post.publishMs) / (1000 * 60 * 60 * 24))
          return sum + scoreCoverageFromDays(daysSincePublish)
        }, 0)

      const competitorCoverageScore = Math.min(1, coverageRaw / 5)
      const compositeScore = scoreComposite(mentionDeficitScore, competitorCoverageScore)

      if (!(compositeScore >= 0.35 && evidenceCount >= 2)) {
        continue
      }

      const topicKey = normalizeTopicKey(queryText)
      if (!topicKey) {
        continue
      }

      const citations = evidence.slice(0, 12).map((post) => ({
        source: post.source,
        title: post.title,
        link: post.link,
        publish_date: post.publishDateRaw,
      }))

      const existingGap = existingByTopicKey.get(topicKey)

      actionableRows.push({
        ...(existingGap?.id ? { id: existingGap.id } : {}),
        topic_key: topicKey,
        topic_label: queryText,
        prompt_query_id: promptId,
        cohort_tag: extractCohortTag(prompt?.tags),
        mention_deficit_score: Number(mentionDeficitScore.toFixed(4)),
        competitor_coverage_score: Number(competitorCoverageScore.toFixed(4)),
        composite_score: Number(compositeScore.toFixed(4)),
        evidence_count: evidenceCount,
        evidence_citations: citations,
        ...(existingGap?.status ? { status: existingGap.status } : {}),
      })
    }

    let rowsUpserted = 0
    for (const chunk of chunkArray(actionableRows, 200)) {
      if (chunk.length === 0) {
        continue
      }
      await supabaseRestRequest(
        config,
        '/rest/v1/content_gap_items?on_conflict=topic_key',
        'POST',
        chunk,
        'Upsert content gaps',
        {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      )
      rowsUpserted += chunk.length
    }

    const stats = {
      runId: latestRun.id,
      promptsConsidered: Array.isArray(promptQueries) ? promptQueries.length : 0,
      actionableGapCount: actionableRows.length,
      gapsUpserted: rowsUpserted,
      evidencePoolSize: evidencePosts.length,
    }

    await completeResearchRun(config, researchRunId, stats)

    return sendJson(res, 200, {
      ok: true,
      runId: researchRunId,
      ...stats,
    })
  } catch (error) {
    if (researchRunId) {
      try {
        await failResearchRun(getSupabaseRestConfig(), researchRunId, error instanceof Error ? error.message : String(error))
      } catch {
        // ignore
      }
    }

    const statusCode =
      typeof error === 'object' && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500

    if (statusCode >= 500) {
      console.error('[research.gaps.refresh] request failed', error)
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
