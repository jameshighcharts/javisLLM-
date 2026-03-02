const { enforceRateLimit, enforceTriggerToken } = require('../../_rate-limit')
const {
  DEFAULT_RESEARCH_MODEL,
  sendJson,
  parseBody,
  ensureResearchFeaturesEnabled,
  resolveModel,
  ensureOpenAiModel,
  getSupabaseRestConfig,
  supabaseRestRequest,
  inferDomainCandidates,
  runOpenAiJsonWithRetry,
  createResearchRun,
  completeResearchRun,
  failResearchRun,
  cleanText,
} = require('../_shared')

function normalizeMaxItems(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 8
  }
  return Math.max(1, Math.min(25, Math.round(parsed)))
}

function normalizePublishDate(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return { publishDate: null, publishedAt: null, publishDateRaw: null }
  }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) {
    return { publishDate: null, publishedAt: null, publishDateRaw: raw }
  }
  const iso = new Date(parsed).toISOString()
  return {
    publishDate: iso.slice(0, 10),
    publishedAt: iso,
    publishDateRaw: raw,
  }
}

function normalizeResearchItems(parsedPayload, fallbackSource, fallbackCitations, maxItems) {
  const inputItems = Array.isArray(parsedPayload)
    ? parsedPayload
    : Array.isArray(parsedPayload?.items)
      ? parsedPayload.items
      : []

  if (!Array.isArray(inputItems)) {
    return []
  }

  const seenLinks = new Set()
  const items = []

  for (const entry of inputItems) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const title = cleanText(entry.title)
    const link = cleanText(entry.link)
    if (!title || !link) {
      continue
    }

    let parsedUrl
    try {
      parsedUrl = new URL(link)
    } catch {
      continue
    }
    const normalizedLink = parsedUrl.toString()
    if (seenLinks.has(normalizedLink)) {
      continue
    }
    seenLinks.add(normalizedLink)

    const citations = Array.isArray(entry.citations)
      ? entry.citations
          .map((citation) => cleanText(citation))
          .filter(Boolean)
          .slice(0, 15)
      : fallbackCitations.slice(0, 15)

    items.push({
      title,
      link: normalizedLink,
      publishDate: cleanText(entry.publish_date),
      contentTheme: cleanText(entry.content_theme, 'General'),
      summary: cleanText(entry.summary),
      source: cleanText(entry.source, fallbackSource),
      citations,
    })

    if (items.length >= maxItems) {
      break
    }
  }

  return items
}

function buildResearchPrompt(competitorName, domainCandidates, maxItems) {
  return [
    `Research recent content by competitor: ${competitorName}.`,
    `Potential domains/pages: ${domainCandidates.join(', ') || 'unknown'}.`,
    `Return ONLY valid JSON as an object with key \"items\" containing up to ${maxItems} objects.`,
    'Each item must include: title, link, publish_date, content_theme, summary, source, citations.',
    'Use ISO date or YYYY-MM-DD for publish_date when possible.',
    'Only include real, crawlable links.',
  ].join('\n')
}

module.exports = async (req, res) => {
  let researchRunId = null
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' })
    }

    ensureResearchFeaturesEnabled()

    enforceRateLimit(req, {
      bucket: 'research-competitors-run',
      max: 8,
      windowMs: 60 * 1000,
    })
    enforceTriggerToken(req)

    const body = parseBody(req)
    const model = resolveModel(body.model, DEFAULT_RESEARCH_MODEL)
    ensureOpenAiModel(model)
    const maxItemsPerCompetitor = normalizeMaxItems(body.maxItemsPerCompetitor)

    const config = getSupabaseRestConfig()
    researchRunId = await createResearchRun(config, {
      runType: 'competitor_research',
      model,
      params: { maxItemsPerCompetitor },
    })

    const competitors = await supabaseRestRequest(
      config,
      '/rest/v1/competitors?select=id,name,slug,is_primary&is_active=eq.true&order=sort_order.asc,name.asc',
      'GET',
      undefined,
      'Load competitors',
    )

    const blogRows = await supabaseRestRequest(
      config,
      '/rest/v1/competitor_blog_posts?select=source,link&order=created_at.desc&limit=5000',
      'GET',
      undefined,
      'Load competitor blog history',
    )

    const knownLinksBySource = new Map()
    for (const row of Array.isArray(blogRows) ? blogRows : []) {
      const source = cleanText(row?.source).toLowerCase()
      const link = cleanText(row?.link)
      if (!source || !link) {
        continue
      }
      const bucket = knownLinksBySource.get(source) || []
      bucket.push(link)
      knownLinksBySource.set(source, bucket)
    }

    const rowsToUpsert = []
    let competitorCount = 0

    for (const competitor of Array.isArray(competitors) ? competitors : []) {
      const competitorName = cleanText(competitor?.name)
      const competitorSlug = cleanText(competitor?.slug)
      const isPrimary = Boolean(competitor?.is_primary)
      if (!competitorName || isPrimary) {
        continue
      }

      competitorCount += 1

      const knownLinks = knownLinksBySource.get(competitorName.toLowerCase()) || []
      const domainCandidates = inferDomainCandidates(competitorName, knownLinks)
      const prompt = buildResearchPrompt(competitorName, domainCandidates, maxItemsPerCompetitor)

      const llmResult = await runOpenAiJsonWithRetry({
        model,
        systemPrompt:
          'You are a web-research analyst. Always return strict JSON, never markdown or prose.',
        userPrompt: prompt,
        maxAttempts: 2,
        webSearch: true,
      })

      const normalizedItems = normalizeResearchItems(
        llmResult.parsed,
        competitorName,
        llmResult.citations,
        maxItemsPerCompetitor,
      )

      if (normalizedItems.length === 0) {
        const error = new Error(`No valid research items returned for ${competitorName}.`)
        error.statusCode = 502
        throw error
      }

      for (const item of normalizedItems) {
        const publish = normalizePublishDate(item.publishDate)
        rowsToUpsert.push({
          source: competitorName,
          source_slug: competitorSlug || competitorName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: item.title,
          content_theme: item.contentTheme || 'General',
          description: item.summary || '',
          author: null,
          link: item.link,
          publish_date: publish.publishDate,
          published_at: publish.publishedAt,
          publish_date_raw: publish.publishDateRaw,
          metadata: {
            source: item.source || competitorName,
            citations: item.citations,
            research_run_id: researchRunId,
            domain_candidates: domainCandidates,
          },
        })
      }
    }

    if (rowsToUpsert.length > 0) {
      await supabaseRestRequest(
        config,
        '/rest/v1/competitor_blog_posts?on_conflict=link',
        'POST',
        rowsToUpsert,
        'Upsert competitor blog posts',
        {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      )
    }

    const stats = {
      competitorsProcessed: competitorCount,
      itemsUpserted: rowsToUpsert.length,
      model,
      maxItemsPerCompetitor,
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
        // ignore secondary failure
      }
    }

    const statusCode =
      typeof error === 'object' && error !== null && Number(error.statusCode)
        ? Number(error.statusCode)
        : 500

    if (statusCode >= 500) {
      console.error('[research.competitors.run] request failed', error)
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
