import { createClient } from '@supabase/supabase-js'
import type {
  BenchmarkRunsResponse,
  BenchmarkTriggerResponse,
  BenchmarkConfig,
  ConfigResponse,
  DiagnosticsCheck,
  DiagnosticsResponse,
  DiagnosticsStatus,
  DashboardResponse,
  HealthResponse,
  KpiRow,
  PromptDrilldownResponse,
  TimeSeriesResponse,
} from './types'

const BASE = '/api'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

type PromptQueryRow = {
  id: string
  query_text: string
  sort_order: number
  is_active: boolean
  updated_at?: string | null
}

type CompetitorRow = {
  id: string
  name: string
  slug: string
  is_primary: boolean
  sort_order: number
  is_active: boolean
  updated_at?: string | null
  competitor_aliases?: Array<{ alias: string }>
}

type BenchmarkRunRow = {
  id: string
  run_month: string | null
  model: string | null
  web_search_enabled: boolean | null
  started_at: string | null
  ended_at: string | null
  overall_score: number | null
  created_at: string | null
}

type BenchmarkResponseRow = {
  id: number
  query_id: string
  run_iteration: number
  model: string
  web_search_enabled: boolean
}

type ResponseMentionRow = {
  response_id: number
  competitor_id: string
  mentioned: boolean
}

type TimeSeriesRunRow = {
  id: string
  created_at: string | null
  run_month: string | null
}

type TimeSeriesResponseRow = {
  id: number
  run_id: string
}

type PromptDrilldownPromptRow = {
  id: string
  query_text: string
  sort_order: number
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

type PromptDrilldownResponseRow = {
  id: number
  run_id: string
  run_iteration: number
  model: string
  web_search_enabled: boolean
  response_text: string
  citations: unknown
  error: string | null
  created_at: string | null
}

type PromptDrilldownRunRow = {
  id: string
  run_month: string | null
  model: string | null
  web_search_enabled: boolean | null
  started_at: string | null
  ended_at: string | null
  overall_score: number | null
  created_at: string | null
}

function uniqueNonEmpty(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean)
  return [...new Set(normalized)]
}

function toValidTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? value : null
}

function pickTimestamp(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const valid = toValidTimestamp(value)
    if (valid) return valid
  }
  return null
}

function normalizeCitations(citations: unknown): string[] {
  const normalizeEntry = (entry: unknown): string | null => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      return trimmed || null
    }
    if (typeof entry === 'object' && entry !== null) {
      const candidate = entry as {
        url?: unknown
        href?: unknown
        source?: unknown
      }
      for (const value of [candidate.url, candidate.href, candidate.source]) {
        if (typeof value === 'string' && value.trim()) {
          return value.trim()
        }
      }
    }
    return null
  }

  if (Array.isArray(citations)) {
    return citations
      .map((entry) => normalizeEntry(entry))
      .filter(Boolean)
      .map((entry) => entry as string)
  }

  if (typeof citations === 'string') {
    const trimmed = citations.trim()
    if (!trimmed) return []

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
          return parsed
            .map((entry) => normalizeEntry(entry))
            .filter(Boolean)
            .map((entry) => entry as string)
        }
      } catch {
        return [trimmed]
      }
    }
    return [trimmed]
  }

  return []
}

function slugifyEntity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function hasSupabaseConfig() {
  return Boolean(supabase)
}

function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: string }).code
  return code === '42P01'
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: string }).message
    if (maybeMessage) {
      return new Error(`${context}: ${maybeMessage}`)
    }
  }
  return new Error(`${context}: ${String(error)}`)
}

type DiagnosticResult = {
  status: DiagnosticsStatus
  details: string
}

async function runCheck(
  id: string,
  name: string,
  check: () => Promise<DiagnosticResult>,
): Promise<DiagnosticsCheck> {
  const startedAt = Date.now()
  try {
    const result = await check()
    return {
      id,
      name,
      status: result.status,
      details: result.details,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      id,
      name,
      status: 'fail',
      details: asError(error, name).message,
      durationMs: Date.now() - startedAt,
    }
  }
}

function emptyDashboard(config: BenchmarkConfig): DashboardResponse {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      overallScore: 0,
      queryCount: config.queries.length,
      competitorCount: config.competitors.length,
      totalResponses: 0,
      models: [],
      runMonth: null,
      webSearchEnabled: null,
      windowStartUtc: null,
      windowEndUtc: null,
    },
    kpi: null,
    competitorSeries: config.competitors.map((name) => ({
      entity: name,
      entityKey: slugifyEntity(name),
      isHighcharts: name.toLowerCase() === 'highcharts',
      mentionRatePct: 0,
      shareOfVoicePct: 0,
    })),
    promptStatus: config.queries.map((query) => ({
      query,
      isPaused: false,
      status: 'awaiting_run',
      runs: 0,
      highchartsRatePct: 0,
      viabilityRatePct: 0,
      topCompetitor: null,
    })),
    comparisonRows: [],
    files: {
      comparisonTablePresent: false,
      competitorChartPresent: false,
      kpiPresent: false,
      llmOutputsPresent: false,
    },
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

function withOptionalTriggerToken(
  triggerToken?: string,
): Record<string, string> | undefined {
  const trimmed = triggerToken?.trim()
  if (!trimmed) {
    return undefined
  }
  return { Authorization: `Bearer ${trimmed}` }
}

async function fetchSupabaseConfigRows(): Promise<{
  promptRows: PromptQueryRow[]
  competitorRows: CompetitorRow[]
}> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const [promptResult, competitorResult] = await Promise.all([
    supabase
      .from('prompt_queries')
      .select('id,query_text,sort_order,is_active,updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('competitors')
      .select('id,name,slug,is_primary,sort_order,is_active,updated_at,competitor_aliases(alias)')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (promptResult.error) {
    throw asError(promptResult.error, 'Failed to read prompt_queries from Supabase')
  }
  if (competitorResult.error) {
    throw asError(competitorResult.error, 'Failed to read competitors from Supabase')
  }

  return {
    promptRows: (promptResult.data ?? []) as PromptQueryRow[],
    competitorRows: (competitorResult.data ?? []) as CompetitorRow[],
  }
}

async function fetchConfigFromSupabase(): Promise<ConfigResponse> {
  const { promptRows, competitorRows } = await fetchSupabaseConfigRows()

  const queries = promptRows.map((row) => row.query_text)
  const competitors = competitorRows.map((row) => row.name)

  const aliases: Record<string, string[]> = {}
  for (const row of competitorRows) {
    const aliasValues = (row.competitor_aliases ?? []).map((aliasRow) => aliasRow.alias)
    aliases[row.name] = uniqueNonEmpty([row.name, ...aliasValues])
  }

  const updatedAt = [
    ...promptRows.map((row) => row.updated_at).filter(Boolean),
    ...competitorRows.map((row) => row.updated_at).filter(Boolean),
  ]
    .map((value) => String(value))
    .sort()
    .at(-1)

  return {
    config: {
      queries,
      competitors,
      aliases,
    },
    meta: {
      path: 'supabase://public.prompt_queries+public.competitors+public.competitor_aliases',
      updatedAt: updatedAt ?? new Date().toISOString(),
      queries: queries.length,
      competitors: competitors.length,
    },
  }
}

async function updateConfigInSupabase(config: BenchmarkConfig): Promise<ConfigResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const queries = uniqueNonEmpty(config.queries)
  const competitors = uniqueNonEmpty(config.competitors)

  if (queries.length === 0) {
    throw new Error('Config must include at least one query.')
  }
  if (competitors.length === 0) {
    throw new Error('Config must include at least one competitor.')
  }
  if (!competitors.some((value) => value.toLowerCase() === 'highcharts')) {
    throw new Error('Config competitors must include "Highcharts".')
  }

  const aliasesByName: Record<string, string[]> = {}
  for (const competitor of competitors) {
    aliasesByName[competitor] = uniqueNonEmpty([
      competitor,
      ...(config.aliases[competitor] ?? config.aliases[competitor.toLowerCase()] ?? []),
    ])
  }

  const promptPayload = queries.map((queryText, index) => ({
    query_text: queryText,
    sort_order: index + 1,
    is_active: true,
  }))

  const promptUpsert = await supabase
    .from('prompt_queries')
    .upsert(promptPayload, { onConflict: 'query_text' })
  if (promptUpsert.error) {
    throw asError(
      promptUpsert.error,
      'Unable to save prompts. Check RLS write policy for prompt_queries',
    )
  }

  const allPromptRows = await supabase
    .from('prompt_queries')
    .select('id,query_text,is_active')
  if (allPromptRows.error) {
    throw asError(allPromptRows.error, 'Unable to refresh prompt list')
  }
  const activeQuerySet = new Set(queries.map((query) => query.toLowerCase()))
  for (const row of (allPromptRows.data ?? []) as Array<{
    id: string
    query_text: string
    is_active: boolean
  }>) {
    const shouldBeActive = activeQuerySet.has(row.query_text.toLowerCase())
    if (row.is_active !== shouldBeActive) {
      const updateResult = await supabase
        .from('prompt_queries')
        .update({ is_active: shouldBeActive })
        .eq('id', row.id)
      if (updateResult.error) {
        throw asError(updateResult.error, 'Unable to update prompt active state')
      }
    }
  }

  const competitorPayload = competitors.map((name, index) => ({
    name,
    slug: slugifyEntity(name),
    is_primary: name.toLowerCase() === 'highcharts',
    sort_order: index + 1,
    is_active: true,
  }))

  const competitorUpsert = await supabase
    .from('competitors')
    .upsert(competitorPayload, { onConflict: 'slug' })
  if (competitorUpsert.error) {
    throw asError(
      competitorUpsert.error,
      'Unable to save competitors. Check RLS write policy for competitors',
    )
  }

  const allCompetitors = await supabase
    .from('competitors')
    .select('id,name,slug,is_active')
  if (allCompetitors.error) {
    throw asError(allCompetitors.error, 'Unable to refresh competitor list')
  }

  const activeCompetitorSlugSet = new Set(competitors.map((name) => slugifyEntity(name)))
  for (const row of (allCompetitors.data ?? []) as Array<{
    id: string
    name: string
    slug: string
    is_active: boolean
  }>) {
    const shouldBeActive = activeCompetitorSlugSet.has(row.slug)
    if (row.is_active !== shouldBeActive) {
      const updateResult = await supabase
        .from('competitors')
        .update({ is_active: shouldBeActive })
        .eq('id', row.id)
      if (updateResult.error) {
        throw asError(updateResult.error, 'Unable to update competitor active state')
      }
    }
  }

  const activeCompetitors = await supabase
    .from('competitors')
    .select('id,name,slug')
    .eq('is_active', true)
  if (activeCompetitors.error) {
    throw asError(activeCompetitors.error, 'Unable to read active competitors for alias sync')
  }

  for (const competitor of (activeCompetitors.data ?? []) as Array<{
    id: string
    name: string
    slug: string
  }>) {
    const desiredAliases = uniqueNonEmpty([
      competitor.name,
      ...(aliasesByName[competitor.name] ?? aliasesByName[competitor.name.toLowerCase()] ?? []),
    ])

    if (desiredAliases.length > 0) {
      const aliasUpsert = await supabase.from('competitor_aliases').upsert(
        desiredAliases.map((alias) => ({
          competitor_id: competitor.id,
          alias,
        })),
        { onConflict: 'competitor_id,alias' },
      )
      if (aliasUpsert.error) {
        throw asError(
          aliasUpsert.error,
          `Unable to upsert aliases for ${competitor.name}. Check RLS policy for competitor_aliases`,
        )
      }
    }

    const existingAliases = await supabase
      .from('competitor_aliases')
      .select('alias')
      .eq('competitor_id', competitor.id)
    if (existingAliases.error) {
      throw asError(existingAliases.error, `Unable to read aliases for ${competitor.name}`)
    }

    const desiredSet = new Set(desiredAliases.map((value) => value.toLowerCase()))
    const extras = (existingAliases.data ?? [])
      .map((row) => String((row as { alias: string }).alias))
      .filter((alias) => !desiredSet.has(alias.toLowerCase()))

    for (const alias of extras) {
      const deleteResult = await supabase
        .from('competitor_aliases')
        .delete()
        .eq('competitor_id', competitor.id)
        .eq('alias', alias)
      if (deleteResult.error) {
        throw asError(deleteResult.error, `Unable to delete stale alias ${alias}`)
      }
    }
  }

  return fetchConfigFromSupabase()
}

async function togglePromptInSupabase(query: string, active: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase
    .from('prompt_queries')
    .update({ is_active: active })
    .eq('query_text', query)
  if (error) throw asError(error, 'Failed to toggle prompt active state')
}

async function fetchDashboardFromSupabase(): Promise<DashboardResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const configResponse = await fetchConfigFromSupabase()
  const config = configResponse.config

  // Fetch ALL queries (active and paused) so we can show isPaused state in the grid
  const activeQueryRows = await supabase
    .from('prompt_queries')
    .select('id,query_text,sort_order,is_active')
    .order('sort_order', { ascending: true })

  if (activeQueryRows.error) {
    throw asError(activeQueryRows.error, 'Failed to load query metadata from Supabase')
  }

  const activeCompetitorRows = await supabase
    .from('competitors')
    .select('id,name,slug,is_primary,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (activeCompetitorRows.error) {
    throw asError(activeCompetitorRows.error, 'Failed to load competitor metadata from Supabase')
  }

  const queryRows = (activeQueryRows.data ?? []) as Array<{
    id: string
    query_text: string
    sort_order: number
    is_active: boolean
  }>
  const competitorRows = (activeCompetitorRows.data ?? []) as Array<{
    id: string
    name: string
    slug: string
    is_primary: boolean
    sort_order: number
  }>

  const latestRunResult = await supabase
    .from('benchmark_runs')
    .select('id,run_month,model,web_search_enabled,started_at,ended_at,overall_score,created_at')
    .order('created_at', { ascending: false })
    .limit(1)

  if (latestRunResult.error) {
    if (isMissingRelation(latestRunResult.error)) {
      return emptyDashboard(config)
    }
    throw asError(latestRunResult.error, 'Failed to load benchmark_runs from Supabase')
  }

  const latestRun = ((latestRunResult.data ?? [])[0] ?? null) as BenchmarkRunRow | null
  if (!latestRun) {
    return emptyDashboard(config)
  }

  const responseResult = await supabase
    .from('benchmark_responses')
    .select('id,query_id,run_iteration,model,web_search_enabled')
    .eq('run_id', latestRun.id)

  if (responseResult.error) {
    if (isMissingRelation(responseResult.error)) {
      return emptyDashboard(config)
    }
    throw asError(responseResult.error, 'Failed to load benchmark_responses from Supabase')
  }

  const responses = (responseResult.data ?? []) as BenchmarkResponseRow[]
  const responseIds = responses.map((row) => row.id)

  const mentionRows: ResponseMentionRow[] = []
  if (responseIds.length > 0) {
    const chunkSize = 500
    for (let index = 0; index < responseIds.length; index += chunkSize) {
      const chunk = responseIds.slice(index, index + chunkSize)
      const mentionResult = await supabase
        .from('response_mentions')
        .select('response_id,competitor_id,mentioned')
        .in('response_id', chunk)

      if (mentionResult.error) {
        if (isMissingRelation(mentionResult.error)) {
          return emptyDashboard(config)
        }
        throw asError(mentionResult.error, 'Failed to load response_mentions from Supabase')
      }

      mentionRows.push(...((mentionResult.data ?? []) as ResponseMentionRow[]))
    }
  }

  const competitorById = new Map(competitorRows.map((row) => [row.id, row]))
  const queryById = new Map(queryRows.map((row) => [row.id, row]))
  const mentionsByResponse = new Map<number, Map<string, boolean>>()

  for (const mention of mentionRows) {
    let bucket = mentionsByResponse.get(mention.response_id)
    if (!bucket) {
      bucket = new Map<string, boolean>()
      mentionsByResponse.set(mention.response_id, bucket)
    }
    bucket.set(mention.competitor_id, Boolean(mention.mentioned))
  }

  const totalResponses = responses.length
  const totalMentionsAcrossEntities = competitorRows.reduce((sum, competitor) => {
    const mentionsForCompetitor = responses.reduce((count, response) => {
      const mentionMap = mentionsByResponse.get(response.id)
      return count + (mentionMap?.get(competitor.id) ? 1 : 0)
    }, 0)
    return sum + mentionsForCompetitor
  }, 0)

  const competitorSeries = competitorRows.map((competitor) => {
    const mentionsCount = responses.reduce((count, response) => {
      const mentionMap = mentionsByResponse.get(response.id)
      return count + (mentionMap?.get(competitor.id) ? 1 : 0)
    }, 0)

    const mentionRatePct = totalResponses > 0 ? (mentionsCount / totalResponses) * 100 : 0
    const shareOfVoicePct =
      totalMentionsAcrossEntities > 0 ? (mentionsCount / totalMentionsAcrossEntities) * 100 : 0

    return {
      entity: competitor.name,
      entityKey: competitor.slug,
      isHighcharts: competitor.is_primary || competitor.slug === 'highcharts',
      mentionRatePct: Number(mentionRatePct.toFixed(2)),
      shareOfVoicePct: Number(shareOfVoicePct.toFixed(2)),
    }
  })

  const highchartsCompetitor =
    competitorRows.find((row) => row.is_primary) ??
    competitorRows.find((row) => row.slug === 'highcharts') ??
    null

  const nonHighchartsCompetitors = competitorRows.filter(
    (row) => row.id !== highchartsCompetitor?.id,
  )

  const promptStatus = queryRows.map((queryRow) => {
    const queryResponses = responses.filter((response) => response.query_id === queryRow.id)
    const runs = queryResponses.length

    const highchartsMentions = highchartsCompetitor
      ? queryResponses.reduce((count, response) => {
          const mentionMap = mentionsByResponse.get(response.id)
          return count + (mentionMap?.get(highchartsCompetitor.id) ? 1 : 0)
        }, 0)
      : 0

    const highchartsRatePct = runs > 0 ? (highchartsMentions / runs) * 100 : 0

    const competitorRates = nonHighchartsCompetitors.map((competitor) => {
      const mentions = queryResponses.reduce((count, response) => {
        const mentionMap = mentionsByResponse.get(response.id)
        return count + (mentionMap?.get(competitor.id) ? 1 : 0)
      }, 0)
      const ratePct = runs > 0 ? (mentions / runs) * 100 : 0
      return {
        entity: competitor.name,
        ratePct,
        mentions,
      }
    })

    const viabilityCount = competitorRates.reduce((sum, entry) => sum + entry.mentions, 0)
    const viabilityDenominator = runs * nonHighchartsCompetitors.length
    const viabilityRatePct =
      viabilityDenominator > 0 ? (viabilityCount / viabilityDenominator) * 100 : 0

    const topCompetitor =
      competitorRates
        .sort((left, right) => right.ratePct - left.ratePct)
        .map((entry) => ({ entity: entry.entity, ratePct: Number(entry.ratePct.toFixed(2)) }))
        .at(0) ?? null

    return {
      query: queryRow.query_text,
      isPaused: !queryRow.is_active,
      status: (runs > 0 ? 'tracked' : 'awaiting_run') as 'tracked' | 'awaiting_run',
      runs,
      highchartsRatePct: Number(highchartsRatePct.toFixed(2)),
      viabilityRatePct: Number(viabilityRatePct.toFixed(2)),
      topCompetitor,
    }
  })

  const responseModelSet = [...new Set(responses.map((row) => row.model).filter(Boolean))]
  const models = responseModelSet.length > 0 ? responseModelSet : latestRun.model ? [latestRun.model] : []

  const kpi: KpiRow = {
    metric_name: 'AI Visibility Overall',
    ai_visibility_overall_score: Number((latestRun.overall_score ?? 0).toFixed(2)),
    score_scale: '0-100',
    queries_count: String(queryRows.length),
    window_start_utc: latestRun.started_at ?? '',
    window_end_utc: latestRun.ended_at ?? '',
    models: models.join(','),
    web_search_enabled: latestRun.web_search_enabled ? 'yes' : 'no',
    run_month: latestRun.run_month ?? '',
    run_id: latestRun.id,
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      overallScore: Number((latestRun.overall_score ?? 0).toFixed(2)),
      queryCount: config.queries.length,
      competitorCount: config.competitors.length,
      totalResponses,
      models,
      runMonth: latestRun.run_month,
      webSearchEnabled: latestRun.web_search_enabled ? 'yes' : 'no',
      windowStartUtc: latestRun.started_at,
      windowEndUtc: latestRun.ended_at,
    },
    kpi,
    competitorSeries,
    promptStatus,
    comparisonRows: [],
    files: {
      comparisonTablePresent: true,
      competitorChartPresent: true,
      kpiPresent: true,
      llmOutputsPresent: totalResponses > 0,
    },
  }
}

async function fetchTimeseriesFromSupabase(): Promise<TimeSeriesResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const competitorResult = await supabase
    .from('competitors')
    .select('id,name,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (competitorResult.error) {
    throw asError(competitorResult.error, 'Failed to load competitors for time series')
  }

  const competitorRows = (competitorResult.data ?? []) as Array<{
    id: string
    name: string
    sort_order: number
  }>
  const competitors = competitorRows.map((row) => row.name)
  if (competitorRows.length === 0) {
    return { ok: true, competitors: [], points: [] }
  }

  const runResult = await supabase
    .from('benchmark_runs')
    .select('id,created_at,run_month')
    .order('created_at', { ascending: true })
    .limit(500)

  if (runResult.error) {
    if (isMissingRelation(runResult.error)) {
      return { ok: true, competitors, points: [] }
    }
    throw asError(runResult.error, 'Failed to load benchmark_runs for time series')
  }

  const runRows = (runResult.data ?? []) as TimeSeriesRunRow[]
  if (runRows.length === 0) {
    return { ok: true, competitors, points: [] }
  }

  const runIds = runRows.map((row) => row.id)
  const responseRows: TimeSeriesResponseRow[] = []
  const runChunkSize = 100

  for (let index = 0; index < runIds.length; index += runChunkSize) {
    const runIdChunk = runIds.slice(index, index + runChunkSize)
    const responseResult = await supabase
      .from('benchmark_responses')
      .select('id,run_id')
      .in('run_id', runIdChunk)

    if (responseResult.error) {
      if (isMissingRelation(responseResult.error)) {
        return { ok: true, competitors, points: [] }
      }
      throw asError(responseResult.error, 'Failed to load benchmark_responses for time series')
    }

    responseRows.push(...((responseResult.data ?? []) as TimeSeriesResponseRow[]))
  }

  if (responseRows.length === 0) {
    return { ok: true, competitors, points: [] }
  }

  const responseIds = responseRows.map((row) => row.id)
  const responseToRun = new Map<number, string>()
  const totalsByRun = new Map<string, number>()

  for (const response of responseRows) {
    responseToRun.set(response.id, response.run_id)
    totalsByRun.set(response.run_id, (totalsByRun.get(response.run_id) ?? 0) + 1)
  }

  const mentionRows: ResponseMentionRow[] = []
  const responseChunkSize = 500
  for (let index = 0; index < responseIds.length; index += responseChunkSize) {
    const responseChunk = responseIds.slice(index, index + responseChunkSize)
    const mentionResult = await supabase
      .from('response_mentions')
      .select('response_id,competitor_id,mentioned')
      .in('response_id', responseChunk)

    if (mentionResult.error) {
      if (isMissingRelation(mentionResult.error)) {
        return { ok: true, competitors, points: [] }
      }
      throw asError(mentionResult.error, 'Failed to load response_mentions for time series')
    }

    mentionRows.push(...((mentionResult.data ?? []) as ResponseMentionRow[]))
  }

  const activeCompetitorIds = new Set(competitorRows.map((row) => row.id))
  const mentionsByRun = new Map<string, Map<string, number>>()

  for (const mention of mentionRows) {
    if (!mention.mentioned || !activeCompetitorIds.has(mention.competitor_id)) {
      continue
    }

    const runId = responseToRun.get(mention.response_id)
    if (!runId) continue

    let runMentions = mentionsByRun.get(runId)
    if (!runMentions) {
      runMentions = new Map<string, number>()
      mentionsByRun.set(runId, runMentions)
    }
    runMentions.set(
      mention.competitor_id,
      (runMentions.get(mention.competitor_id) ?? 0) + 1,
    )
  }

  const points = runRows
    .map((run) => {
      const total = totalsByRun.get(run.id) ?? 0
      if (total < 1) {
        return null
      }

      const fallbackDate =
        run.run_month && /^\d{4}-\d{2}$/.test(run.run_month)
          ? `${run.run_month}-01`
          : new Date().toISOString().slice(0, 10)
      const timestamp = run.created_at ?? `${fallbackDate}T12:00:00Z`
      const runMentions = mentionsByRun.get(run.id)

      return {
        date: timestamp.slice(0, 10),
        timestamp,
        total,
        rates: Object.fromEntries(
          competitorRows.map((competitor) => {
            const mentions = runMentions?.get(competitor.id) ?? 0
            const mentionRatePct = total > 0 ? (mentions / total) * 100 : 0
            return [competitor.name, Number(mentionRatePct.toFixed(2))]
          }),
        ),
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((left, right) => {
      const leftMs = Date.parse(left.timestamp ?? `${left.date}T12:00:00Z`)
      const rightMs = Date.parse(right.timestamp ?? `${right.date}T12:00:00Z`)
      return leftMs - rightMs
    })

  return {
    ok: true,
    competitors,
    points,
  }
}

async function fetchPromptDrilldownFromSupabase(
  queryText: string,
): Promise<PromptDrilldownResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const query = queryText.trim()
  if (!query) {
    throw new Error('Prompt query is required.')
  }

  const promptResult = await supabase
    .from('prompt_queries')
    .select('id,query_text,sort_order,is_active,created_at,updated_at')
    .eq('query_text', query)
    .limit(1)

  if (promptResult.error) {
    throw asError(promptResult.error, 'Failed to load prompt details from Supabase')
  }

  const prompt = ((promptResult.data ?? [])[0] ?? null) as PromptDrilldownPromptRow | null
  if (!prompt) {
    throw new Error(`Prompt not found: ${query}`)
  }

  const competitorResult = await supabase
    .from('competitors')
    .select('id,name,slug,is_primary,sort_order,is_active')
    .order('sort_order', { ascending: true })

  if (competitorResult.error) {
    throw asError(competitorResult.error, 'Failed to load competitors for prompt drilldown')
  }

  const competitors = (competitorResult.data ?? []) as Array<{
    id: string
    name: string
    slug: string
    is_primary: boolean
    sort_order: number
    is_active: boolean
  }>

  const responseResult = await supabase
    .from('benchmark_responses')
    .select(
      'id,run_id,run_iteration,model,web_search_enabled,response_text,citations,error,created_at',
    )
    .eq('query_id', prompt.id)
    .order('created_at', { ascending: false })
    .limit(500)

  if (responseResult.error) {
    if (isMissingRelation(responseResult.error)) {
      return {
        generatedAt: new Date().toISOString(),
        prompt: {
          id: prompt.id,
          query: prompt.query_text,
          sortOrder: prompt.sort_order,
          isPaused: !prompt.is_active,
          createdAt: prompt.created_at,
          updatedAt: prompt.updated_at,
        },
        summary: {
          totalResponses: 0,
          trackedRuns: 0,
          highchartsRatePct: 0,
          viabilityRatePct: 0,
          leadPct: 0,
          topCompetitor: null,
          lastRunAt: null,
        },
        competitors: [],
        runPoints: [],
        responses: [],
      }
    }
    throw asError(responseResult.error, 'Failed to load prompt responses from Supabase')
  }

  const responses = (responseResult.data ?? []) as PromptDrilldownResponseRow[]
  const responseIds = responses.map((row) => row.id)
  const runIds = [...new Set(responses.map((row) => row.run_id))]

  const runRows: PromptDrilldownRunRow[] = []
  if (runIds.length > 0) {
    const runResult = await supabase
      .from('benchmark_runs')
      .select(
        'id,run_month,model,web_search_enabled,started_at,ended_at,overall_score,created_at',
      )
      .in('id', runIds)

    if (runResult.error) {
      if (!isMissingRelation(runResult.error)) {
        throw asError(runResult.error, 'Failed to load benchmark runs for prompt drilldown')
      }
    } else {
      runRows.push(...((runResult.data ?? []) as PromptDrilldownRunRow[]))
    }
  }

  const mentionRows: ResponseMentionRow[] = []
  if (responseIds.length > 0) {
    const chunkSize = 500
    for (let index = 0; index < responseIds.length; index += chunkSize) {
      const chunk = responseIds.slice(index, index + chunkSize)
      const mentionResult = await supabase
        .from('response_mentions')
        .select('response_id,competitor_id,mentioned')
        .in('response_id', chunk)

      if (mentionResult.error) {
        if (isMissingRelation(mentionResult.error)) {
          break
        }
        throw asError(mentionResult.error, 'Failed to load prompt mentions from Supabase')
      }

      mentionRows.push(...((mentionResult.data ?? []) as ResponseMentionRow[]))
    }
  }

  const runById = new Map(runRows.map((row) => [row.id, row]))
  const competitorById = new Map(competitors.map((row) => [row.id, row]))
  const mentionsByResponse = new Map<number, Set<string>>()

  for (const mention of mentionRows) {
    if (!mention.mentioned) continue
    let bucket = mentionsByResponse.get(mention.response_id)
    if (!bucket) {
      bucket = new Set<string>()
      mentionsByResponse.set(mention.response_id, bucket)
    }
    bucket.add(mention.competitor_id)
  }

  const mentionCountByCompetitor = new Map<string, number>()
  for (const responseId of responseIds) {
    const mentionSet = mentionsByResponse.get(responseId)
    if (!mentionSet) continue
    for (const competitorId of mentionSet) {
      mentionCountByCompetitor.set(
        competitorId,
        (mentionCountByCompetitor.get(competitorId) ?? 0) + 1,
      )
    }
  }

  const visibleCompetitors = competitors.filter(
    (row) => row.is_active || mentionCountByCompetitor.has(row.id),
  )
  const primaryCompetitor =
    visibleCompetitors.find((row) => row.is_primary) ??
    visibleCompetitors.find((row) => row.slug === 'highcharts') ??
    null

  const totalResponses = responses.length
  const competitorStats = visibleCompetitors.map((competitor) => {
    const mentionCount = mentionCountByCompetitor.get(competitor.id) ?? 0
    const mentionRatePct = totalResponses > 0 ? (mentionCount / totalResponses) * 100 : 0
    const isHighcharts = primaryCompetitor
      ? competitor.id === primaryCompetitor.id
      : competitor.slug === 'highcharts'

    return {
      id: competitor.id,
      entity: competitor.name,
      entityKey: competitor.slug,
      isHighcharts,
      isActive: competitor.is_active,
      mentionCount,
      mentionRatePct: Number(mentionRatePct.toFixed(2)),
    }
  })

  const rivalStats = competitorStats.filter((entry) => !entry.isHighcharts)
  const topCompetitor =
    totalResponses > 0
      ? rivalStats
          .slice()
          .sort((left, right) => right.mentionRatePct - left.mentionRatePct)
          .map((entry) => ({
            entity: entry.entity,
            ratePct: Number(entry.mentionRatePct.toFixed(2)),
          }))
          .at(0) ?? null
      : null

  const highchartsRatePct =
    competitorStats.find((entry) => entry.isHighcharts)?.mentionRatePct ?? 0
  const rivalMentionCount = rivalStats.reduce((sum, row) => sum + row.mentionCount, 0)
  const viabilityDenominator = totalResponses * rivalStats.length
  const viabilityRatePct =
    viabilityDenominator > 0 ? Number(((rivalMentionCount / viabilityDenominator) * 100).toFixed(2)) : 0

  const responsesByRun = new Map<string, PromptDrilldownResponseRow[]>()
  for (const response of responses) {
    const bucket = responsesByRun.get(response.run_id) ?? []
    bucket.push(response)
    responsesByRun.set(response.run_id, bucket)
  }

  const runPoints = Array.from(responsesByRun.entries())
    .map(([runId, runResponses]) => {
      const run = runById.get(runId)
      const mentionCountByCompetitorForRun = new Map<string, number>()

      for (const response of runResponses) {
        const mentionSet = mentionsByResponse.get(response.id)
        if (!mentionSet) continue
        for (const competitorId of mentionSet) {
          mentionCountByCompetitorForRun.set(
            competitorId,
            (mentionCountByCompetitorForRun.get(competitorId) ?? 0) + 1,
          )
        }
      }

      const runTotal = runResponses.length
      const rates = Object.fromEntries(
        competitorStats.map((competitor) => {
          const mentions = mentionCountByCompetitorForRun.get(competitor.id) ?? 0
          const pct = runTotal > 0 ? (mentions / runTotal) * 100 : 0
          return [competitor.entity, Number(pct.toFixed(2))]
        }),
      )

      const runHighchartsCount = primaryCompetitor
        ? mentionCountByCompetitorForRun.get(primaryCompetitor.id) ?? 0
        : 0
      const runHighchartsRate = runTotal > 0 ? (runHighchartsCount / runTotal) * 100 : 0

      const runRivals = competitorStats.filter((competitor) => !competitor.isHighcharts)
      const runRivalMentionCount = runRivals.reduce(
        (sum, competitor) =>
          sum + (mentionCountByCompetitorForRun.get(competitor.id) ?? 0),
        0,
      )
      const runViabilityDenominator = runTotal * runRivals.length
      const runViabilityRate =
        runViabilityDenominator > 0
          ? (runRivalMentionCount / runViabilityDenominator) * 100
          : 0

      const runTopCompetitor =
        runRivals
          .map((competitor) => {
            const mentions = mentionCountByCompetitorForRun.get(competitor.id) ?? 0
            const ratePct = runTotal > 0 ? (mentions / runTotal) * 100 : 0
            return {
              entity: competitor.entity,
              ratePct: Number(ratePct.toFixed(2)),
            }
          })
          .sort((left, right) => right.ratePct - left.ratePct)
          .at(0) ?? null

      const firstResponseTimestamp = runResponses
        .map((response) => response.created_at)
        .find((value) => Boolean(toValidTimestamp(value)))
      const fallbackRunMonthTimestamp =
        run?.run_month && /^\d{4}-\d{2}$/.test(run.run_month)
          ? `${run.run_month}-01T12:00:00Z`
          : null
      const timestamp =
        pickTimestamp(
          run?.created_at,
          run?.started_at,
          firstResponseTimestamp,
          fallbackRunMonthTimestamp,
        ) ?? new Date().toISOString()

      return {
        runId,
        runMonth: run?.run_month ?? null,
        timestamp,
        date: timestamp.slice(0, 10),
        totalResponses: runTotal,
        highchartsRatePct: Number(runHighchartsRate.toFixed(2)),
        viabilityRatePct: Number(runViabilityRate.toFixed(2)),
        topCompetitor: runTopCompetitor,
        rates,
      }
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))

  const responseItems = responses.map((response) => {
    const run = runById.get(response.run_id)
    const mentionIds = [...(mentionsByResponse.get(response.id) ?? new Set<string>())]
    const mentions = mentionIds
      .map((id) => competitorById.get(id)?.name)
      .filter((name): name is string => Boolean(name))
      .sort((left, right) => left.localeCompare(right))

    return {
      id: response.id,
      runId: response.run_id,
      runMonth: run?.run_month ?? null,
      runCreatedAt: pickTimestamp(run?.created_at, run?.started_at),
      createdAt: response.created_at,
      runIteration: response.run_iteration,
      model: response.model,
      webSearchEnabled: response.web_search_enabled,
      error: response.error,
      responseText: response.response_text ?? '',
      citations: normalizeCitations(response.citations),
      mentions,
    }
  })

  const lastRunAt = runPoints.length > 0 ? runPoints[runPoints.length - 1].timestamp : null

  return {
    generatedAt: new Date().toISOString(),
    prompt: {
      id: prompt.id,
      query: prompt.query_text,
      sortOrder: prompt.sort_order,
      isPaused: !prompt.is_active,
      createdAt: prompt.created_at,
      updatedAt: prompt.updated_at,
    },
    summary: {
      totalResponses,
      trackedRuns: runPoints.length,
      highchartsRatePct: Number(highchartsRatePct.toFixed(2)),
      viabilityRatePct,
      leadPct: Number((highchartsRatePct - (topCompetitor?.ratePct ?? 0)).toFixed(2)),
      topCompetitor,
      lastRunAt,
    },
    competitors: competitorStats.sort((left, right) => right.mentionRatePct - left.mentionRatePct),
    runPoints,
    responses: responseItems,
  }
}

async function healthViaSupabase(): Promise<HealthResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const result = await supabase.from('prompt_queries').select('id').limit(1)
  return {
    ok: !result.error,
    repoRoot: 'supabase',
  }
}

async function diagnosticsViaSupabase(): Promise<DiagnosticsResponse> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const checks: DiagnosticsCheck[] = []
  const supabaseHost = new URL(SUPABASE_URL ?? '').hostname

  checks.push(
    await runCheck('supabase_env', 'Supabase environment', async () => ({
      status: 'pass',
      details: `Using project ${supabaseHost}`,
    })),
  )

  const tableChecks = await Promise.all([
    runCheck('table_prompt_queries', 'prompt_queries table', async () => {
      const result = await supabase
        .from('prompt_queries')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read prompt_queries').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'fail',
          details: 'No prompt rows found. Add prompts in Configuration or SQL Editor.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),

    runCheck('table_competitors', 'competitors table', async () => {
      const result = await supabase
        .from('competitors')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read competitors').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'fail',
          details: 'No competitors found. Add competitors in Configuration or SQL Editor.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),

    runCheck('table_competitor_aliases', 'competitor_aliases table', async () => {
      const result = await supabase
        .from('competitor_aliases')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read competitor_aliases').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'warn',
          details: 'No aliases found yet. Optional, but recommended for better mention matching.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),

    runCheck('table_benchmark_runs', 'benchmark_runs table', async () => {
      const result = await supabase
        .from('benchmark_runs')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        if (isMissingRelation(result.error)) {
          return {
            status: 'warn',
            details: 'Table missing. Run the Supabase schema SQL migration for benchmark tables.',
          }
        }
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read benchmark_runs').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'warn',
          details: 'No benchmark runs yet. Run the benchmark pipeline to populate results.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),

    runCheck('table_benchmark_responses', 'benchmark_responses table', async () => {
      const result = await supabase
        .from('benchmark_responses')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        if (isMissingRelation(result.error)) {
          return {
            status: 'warn',
            details: 'Table missing. Run the Supabase schema SQL migration for benchmark tables.',
          }
        }
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read benchmark_responses').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'warn',
          details: 'No response rows yet. This fills after the first benchmark run.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),

    runCheck('table_response_mentions', 'response_mentions table', async () => {
      const result = await supabase
        .from('response_mentions')
        .select('*', { count: 'exact', head: true })
      if (result.error) {
        if (isMissingRelation(result.error)) {
          return {
            status: 'warn',
            details: 'Table missing. Run the Supabase schema SQL migration for benchmark tables.',
          }
        }
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to read response_mentions').message,
        }
      }
      const count = result.count ?? 0
      if (count < 1) {
        return {
          status: 'warn',
          details: 'No mention rows yet. This fills after the first benchmark run.',
        }
      }
      return { status: 'pass', details: `${count} rows available` }
    }),
  ])
  checks.push(...tableChecks)

  checks.push(
    await runCheck('highcharts_primary', 'Highcharts primary competitor', async () => {
      const result = await supabase
        .from('competitors')
        .select('name,slug,is_primary,is_active')
        .eq('is_active', true)

      if (result.error) {
        return {
          status: 'fail',
          details: asError(result.error, 'Unable to validate Highcharts competitor').message,
        }
      }

      const rows = (result.data ?? []) as Array<{
        name: string
        slug: string
        is_primary: boolean
        is_active: boolean
      }>

      const highcharts =
        rows.find((row) => row.slug === 'highcharts') ??
        rows.find((row) => row.name.toLowerCase() === 'highcharts')

      if (!highcharts) {
        return {
          status: 'fail',
          details: 'Highcharts is missing from active competitors.',
        }
      }
      if (!highcharts.is_primary) {
        return {
          status: 'warn',
          details: 'Highcharts exists but is not marked as primary.',
        }
      }
      return {
        status: 'pass',
        details: 'Highcharts is active and marked as primary.',
      }
    }),
  )

  checks.push(
    await runCheck('latest_run_readiness', 'Latest run readiness', async () => {
      const latestRunResult = await supabase
        .from('benchmark_runs')
        .select('id,created_at')
        .order('created_at', { ascending: false })
        .limit(1)

      if (latestRunResult.error) {
        if (isMissingRelation(latestRunResult.error)) {
          return {
            status: 'warn',
            details: 'benchmark_runs table is missing, so no run data can be read yet.',
          }
        }
        return {
          status: 'fail',
          details: asError(latestRunResult.error, 'Unable to read latest benchmark run').message,
        }
      }

      const latestRun = (latestRunResult.data ?? [])[0] as { id: string } | undefined
      if (!latestRun) {
        return {
          status: 'warn',
          details: 'No benchmark run found yet.',
        }
      }

      const responseResult = await supabase
        .from('benchmark_responses')
        .select('*', { count: 'exact', head: true })
        .eq('run_id', latestRun.id)

      if (responseResult.error) {
        if (isMissingRelation(responseResult.error)) {
          return {
            status: 'warn',
            details: 'benchmark_responses table missing; run output cannot be displayed yet.',
          }
        }
        return {
          status: 'fail',
          details: asError(responseResult.error, 'Unable to read responses for latest run').message,
        }
      }

      const responseCount = responseResult.count ?? 0
      if (responseCount < 1) {
        return {
          status: 'warn',
          details: 'Latest run exists but has no benchmark_responses rows.',
        }
      }
      return {
        status: 'pass',
        details: `Latest run has ${responseCount} response rows.`,
      }
    }),
  )

  checks.push(
    await runCheck('dashboard_query', 'Dashboard query', async () => {
      const dashboard = await fetchDashboardFromSupabase()
      const hasConfig = dashboard.summary.queryCount > 0 && dashboard.summary.competitorCount > 0
      return {
        status: hasConfig ? 'pass' : 'warn',
        details: `${dashboard.summary.queryCount} queries, ${dashboard.summary.competitorCount} competitors, ${dashboard.summary.totalResponses} responses`,
      }
    }),
  )

  return {
    generatedAt: new Date().toISOString(),
    source: 'supabase',
    checks,
  }
}

async function diagnosticsViaApi(): Promise<DiagnosticsResponse> {
  const checks = await Promise.all([
    runCheck('api_health', 'API /health', async () => {
      const data = await json<HealthResponse>('/health')
      return {
        status: data.ok ? 'pass' : 'fail',
        details: data.ok ? `Healthy (${data.repoRoot})` : 'Health endpoint returned not ok',
      }
    }),
    runCheck('api_config', 'API /config', async () => {
      const data = await json<ConfigResponse>('/config')
      if (data.config.queries.length < 1 || data.config.competitors.length < 1) {
        return {
          status: 'warn',
          details: 'Config loaded but queries or competitors are empty.',
        }
      }
      return {
        status: 'pass',
        details: `${data.config.queries.length} queries, ${data.config.competitors.length} competitors`,
      }
    }),
    runCheck('api_dashboard', 'API /dashboard', async () => {
      const data = await json<DashboardResponse>('/dashboard')
      return {
        status: 'pass',
        details: `${data.summary.totalResponses} responses in latest dashboard snapshot`,
      }
    }),
  ])

  return {
    generatedAt: new Date().toISOString(),
    source: 'api',
    checks,
  }
}

export const api = {
  async health() {
    if (hasSupabaseConfig()) {
      try {
        return await healthViaSupabase()
      } catch (primaryError) {
        try {
          return await json<HealthResponse>('/health')
        } catch {
          throw asError(primaryError, 'Supabase health check failed')
        }
      }
    }
    return json<HealthResponse>('/health')
  },

  async diagnostics() {
    if (hasSupabaseConfig()) {
      try {
        return await diagnosticsViaSupabase()
      } catch (primaryError) {
        try {
          return await diagnosticsViaApi()
        } catch {
          throw asError(primaryError, 'Supabase diagnostics failed')
        }
      }
    }
    return diagnosticsViaApi()
  },

  async benchmarkRuns(triggerToken?: string) {
    return json<BenchmarkRunsResponse>('/benchmark/runs', {
      method: 'GET',
      headers: withOptionalTriggerToken(triggerToken),
    })
  },

  async triggerBenchmark(
    data: {
      model: string
      runs: number
      temperature: number
      webSearch: boolean
      ourTerms: string
      runMonth?: string
    },
    triggerToken?: string,
  ) {
    return json<BenchmarkTriggerResponse>('/benchmark/trigger', {
      method: 'POST',
      headers: withOptionalTriggerToken(triggerToken),
      body: JSON.stringify(data),
    })
  },

  async dashboard() {
    if (hasSupabaseConfig()) {
      try {
        return await fetchDashboardFromSupabase()
      } catch (primaryError) {
        try {
          return await json<DashboardResponse>('/dashboard')
        } catch {
          throw asError(primaryError, 'Supabase dashboard query failed')
        }
      }
    }
    return json<DashboardResponse>('/dashboard')
  },

  async config() {
    if (hasSupabaseConfig()) {
      try {
        return await fetchConfigFromSupabase()
      } catch (primaryError) {
        try {
          return await json<ConfigResponse>('/config')
        } catch {
          throw asError(primaryError, 'Supabase config query failed')
        }
      }
    }
    return json<ConfigResponse>('/config')
  },

  async togglePromptActive(query: string, active: boolean) {
    if (hasSupabaseConfig()) {
      try {
        return await togglePromptInSupabase(query, active)
      } catch (primaryError) {
        try {
          return await json<{ ok: boolean }>('/prompts/toggle', {
            method: 'PATCH',
            body: JSON.stringify({ query, active }),
          })
        } catch {
          throw asError(primaryError, 'Failed to toggle prompt active state')
        }
      }
    }
    return json<{ ok: boolean }>('/prompts/toggle', {
      method: 'PATCH',
      body: JSON.stringify({ query, active }),
    })
  },

  async timeseries(): Promise<TimeSeriesResponse> {
    if (hasSupabaseConfig()) {
      try {
        return await fetchTimeseriesFromSupabase()
      } catch {
        try {
          return await json<TimeSeriesResponse>('/timeseries')
        } catch {
          return { ok: false, competitors: [], points: [] }
        }
      }
    }

    try {
      return await json<TimeSeriesResponse>('/timeseries')
    } catch {
      return { ok: false, competitors: [], points: [] }
    }
  },

  async promptDrilldown(query: string): Promise<PromptDrilldownResponse> {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      throw new Error('Prompt query is required.')
    }

    if (hasSupabaseConfig()) {
      try {
        return await fetchPromptDrilldownFromSupabase(trimmedQuery)
      } catch (primaryError) {
        try {
          const encoded = encodeURIComponent(trimmedQuery)
          return await json<PromptDrilldownResponse>(`/prompts/drilldown?query=${encoded}`)
        } catch {
          throw asError(primaryError, 'Supabase prompt drilldown query failed')
        }
      }
    }

    const encoded = encodeURIComponent(trimmedQuery)
    return json<PromptDrilldownResponse>(`/prompts/drilldown?query=${encoded}`)
  },

  async updateConfig(data: BenchmarkConfig) {
    if (hasSupabaseConfig()) {
      try {
        return await updateConfigInSupabase(data)
      } catch (primaryError) {
        try {
          return await json<ConfigResponse>('/config', {
            method: 'PUT',
            body: JSON.stringify(data),
          })
        } catch {
          throw asError(primaryError, 'Supabase config update failed')
        }
      }
    }

    return json<ConfigResponse>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
}
