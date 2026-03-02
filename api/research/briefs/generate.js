const { enforceRateLimit, enforceTriggerToken } = require('../../_rate-limit')
const {
  DEFAULT_BRIEF_MODEL,
  sendJson,
  parseBody,
  ensureResearchFeaturesEnabled,
  resolveModel,
  ensureOpenAiModel,
  getSupabaseRestConfig,
  supabaseRestRequest,
  runOpenAiJsonWithRetry,
  createResearchRun,
  completeResearchRun,
  failResearchRun,
  cleanText,
  hasNonEmptyCitationArray,
} = require('../_shared')

const REQUIRED_SECTIONS = [
  'Opportunity',
  'Why This Gap Exists',
  'Recommended Page Target',
  'Section Outline',
  'Conversational Long-tail Queries',
  'Entity/Citation Strategy',
  'Action Checklist',
  'Validation Steps',
]

function normalizeChecklist(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 40)
}

function normalizeBriefCitations(value) {
  const items = Array.isArray(value) ? value : []
  const normalized = []
  const seen = new Set()

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const url = cleanText(item.url || item.link || item.href)
    if (!url || seen.has(url)) {
      continue
    }
    seen.add(url)
    normalized.push({
      title: cleanText(item.title, 'Citation'),
      url,
      note: cleanText(item.note),
    })
  }

  return normalized
}

function hasAllRequiredSections(markdown) {
  const normalized = cleanText(markdown).toLowerCase()
  return REQUIRED_SECTIONS.every((section) => normalized.includes(section.toLowerCase()))
}

function buildBriefPrompt(gapRow) {
  const evidence = Array.isArray(gapRow.evidence_citations) ? gapRow.evidence_citations : []
  const evidenceLines = evidence.slice(0, 12).map((citation, index) => {
    const title = cleanText(citation?.title, `Source ${index + 1}`)
    const source = cleanText(citation?.source, 'Unknown source')
    const link = cleanText(citation?.link, '')
    return `${index + 1}. ${title} (${source})${link ? ` - ${link}` : ''}`
  })

  return [
    'Produce a content optimization brief as strict JSON only.',
    'JSON object must include keys: brief_markdown, action_checklist, brief_citations.',
    'brief_markdown must contain these section headings exactly as markdown H2:',
    REQUIRED_SECTIONS.map((section) => `- ${section}`).join('\n'),
    'action_checklist must be an array of concise checklist strings.',
    'brief_citations must be a non-empty array of objects: {title,url,note}.',
    `Gap topic: ${cleanText(gapRow.topic_label)}`,
    `Mention deficit score: ${gapRow.mention_deficit_score}`,
    `Competitor coverage score: ${gapRow.competitor_coverage_score}`,
    `Composite score: ${gapRow.composite_score}`,
    `Evidence count: ${gapRow.evidence_count}`,
    'Evidence references:',
    evidenceLines.length > 0 ? evidenceLines.join('\n') : '- (none provided)',
  ].join('\n\n')
}

module.exports = async (req, res) => {
  let researchRunId = null
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' })
    }

    ensureResearchFeaturesEnabled()

    enforceRateLimit(req, {
      bucket: 'research-brief-generate',
      max: 10,
      windowMs: 60 * 1000,
    })
    enforceTriggerToken(req)

    const body = parseBody(req)
    const gapId = cleanText(body.gapId)
    if (!gapId) {
      const error = new Error('gapId is required.')
      error.statusCode = 400
      throw error
    }

    const model = resolveModel(body.model, DEFAULT_BRIEF_MODEL)
    ensureOpenAiModel(model)

    const config = getSupabaseRestConfig()
    researchRunId = await createResearchRun(config, {
      runType: 'brief_generation',
      model,
      params: { gapId },
    })

    const gapRows = await supabaseRestRequest(
      config,
      `/rest/v1/content_gap_items?select=id,topic_key,topic_label,mention_deficit_score,competitor_coverage_score,composite_score,evidence_count,evidence_citations&limit=1&id=eq.${encodeURIComponent(gapId)}`,
      'GET',
      undefined,
      'Load gap item',
    )
    const gapRow = Array.isArray(gapRows) ? gapRows[0] : null

    if (!gapRow?.id) {
      const error = new Error('Gap item not found.')
      error.statusCode = 404
      throw error
    }

    const llmResult = await runOpenAiJsonWithRetry({
      model,
      systemPrompt:
        'You are an SEO strategist. Return strict JSON only and ensure the markdown is practical and citation-backed.',
      userPrompt: buildBriefPrompt(gapRow),
      maxAttempts: 2,
      webSearch: true,
    })

    const briefMarkdown = cleanText(llmResult.parsed?.brief_markdown)
    const checklist = normalizeChecklist(llmResult.parsed?.action_checklist)
    if (!hasNonEmptyCitationArray(llmResult.parsed?.brief_citations)) {
      const error = new Error('Generated brief must include non-empty citations.')
      error.statusCode = 400
      throw error
    }
    const briefCitations = normalizeBriefCitations(llmResult.parsed?.brief_citations)

    if (!briefMarkdown) {
      const error = new Error('Generated brief was empty.')
      error.statusCode = 502
      throw error
    }
    if (!hasAllRequiredSections(briefMarkdown)) {
      const error = new Error('Generated brief missing one or more required sections.')
      error.statusCode = 502
      throw error
    }
    if (briefCitations.length === 0) {
      const error = new Error('Generated brief must include non-empty citations.')
      error.statusCode = 400
      throw error
    }

    const patchRows = await supabaseRestRequest(
      config,
      `/rest/v1/content_gap_items?id=eq.${encodeURIComponent(gapId)}`,
      'PATCH',
      {
        brief_markdown: briefMarkdown,
        brief_checklist: checklist,
        brief_citations: briefCitations,
        brief_model: model,
        brief_generated_at: new Date().toISOString(),
      },
      'Save generated brief',
      { Prefer: 'return=representation' },
    )

    const updated = Array.isArray(patchRows) ? patchRows[0] : patchRows

    const stats = {
      gapId,
      sectionCount: REQUIRED_SECTIONS.length,
      checklistCount: checklist.length,
      citationCount: briefCitations.length,
      model,
    }
    await completeResearchRun(config, researchRunId, stats)

    return sendJson(res, 200, {
      ok: true,
      runId: researchRunId,
      gap: updated,
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
      console.error('[research.briefs.generate] request failed', error)
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
