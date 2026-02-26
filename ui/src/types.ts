export interface ModelOwnerStat {
  owner: string
  models: string[]
  responseCount: number
}

export interface DashboardModelStat {
  model: string
  owner: string
  responseCount: number
  successCount: number
  failureCount: number
  webSearchEnabledCount: number
  totalDurationMs: number
  avgDurationMs: number
  p95DurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  avgInputTokens: number
  avgOutputTokens: number
  avgTotalTokens: number
}

export interface DashboardTokenTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface DashboardDurationTotals {
  totalDurationMs: number
  avgDurationMs: number
}

export interface DashboardSummary {
  overallScore: number
  queryCount: number
  competitorCount: number
  totalResponses: number
  models: string[]
  modelOwners: string[]
  modelOwnerMap: Record<string, string>
  modelOwnerStats: ModelOwnerStat[]
  modelStats: DashboardModelStat[]
  tokenTotals: DashboardTokenTotals
  durationTotals: DashboardDurationTotals
  runMonth: string | null
  webSearchEnabled: string | null
  windowStartUtc: string | null
  windowEndUtc: string | null
}

export interface KpiRow {
  metric_name: string
  ai_visibility_overall_score: number
  score_scale: string
  queries_count: string
  window_start_utc: string
  window_end_utc: string
  models: string
  model_owners?: string
  model_owner_map?: string
  web_search_enabled: string
  run_month: string
  run_id: string
}

export interface CompetitorSeries {
  entity: string
  entityKey: string
  isHighcharts: boolean
  mentionRatePct: number
  shareOfVoicePct: number
}

export interface PromptStatus {
  query: string
  tags: string[]
  isPaused: boolean
  status: 'tracked' | 'awaiting_run' | 'deleted'
  runs: number
  highchartsRatePct: number
  highchartsRank: number | null
  highchartsRankOutOf: number
  viabilityRatePct: number
  topCompetitor: { entity: string; ratePct: number } | null
  latestRunResponseCount?: number | null
  competitorRates?: PromptCompetitorRate[]
}

export interface PromptCompetitorRate {
  entity: string
  entityKey: string
  isHighcharts: boolean
  ratePct: number
  mentions?: number
}

export interface DashboardResponse {
  generatedAt: string
  summary: DashboardSummary
  kpi: KpiRow | null
  competitorSeries: CompetitorSeries[]
  promptStatus: PromptStatus[]
  comparisonRows: Record<string, string>[]
  files: {
    comparisonTablePresent: boolean
    competitorChartPresent: boolean
    kpiPresent: boolean
    llmOutputsPresent: boolean
  }
}

export interface BenchmarkConfig {
  queries: string[]
  queryTags?: Record<string, string[]>
  competitors: string[]
  aliases: Record<string, string[]>
  pausedQueries?: string[]
}

export interface ConfigResponse {
  config: BenchmarkConfig
  meta: {
    path?: string
    source?: string
    updatedAt: string
    queries?: number
    competitors?: number
  }
}

export interface HealthResponse {
  ok: boolean
  service?: string
  repoRoot?: string
}

export type DiagnosticsStatus = 'pass' | 'warn' | 'fail'

export interface DiagnosticsCheck {
  id: string
  name: string
  status: DiagnosticsStatus
  details: string
  durationMs: number
}

export interface DiagnosticsResponse {
  generatedAt: string
  source: 'supabase' | 'api'
  checks: DiagnosticsCheck[]
}

export interface TimeSeriesPoint {
  date: string
  timestamp?: string
  total: number
  rates: Record<string, number>
  aiVisibilityScore?: number
  combviPct?: number
}

export interface TimeSeriesResponse {
  ok: boolean
  competitors: string[]
  points: TimeSeriesPoint[]
}

export interface CompetitorBlogPost {
  id: string
  title: string
  type: string
  source: string
  sourceKey: string
  description: string
  author: string | null
  link: string
  publishDate: string | null
  publishedAt: string | null
}

export interface CompetitorBlogTimelinePoint {
  month: string
  label: string
  total: number
  bySource: Record<string, number>
}

export interface CompetitorBlogsResponse {
  generatedAt: string
  totalPosts: number
  sourceTotals: Array<{
    source: string
    sourceKey: string
    count: number
  }>
  typeTotals: Array<{
    type: string
    count: number
  }>
  posts: CompetitorBlogPost[]
  timeline: CompetitorBlogTimelinePoint[]
}

export interface PromptDrilldownCompetitor {
  id: string
  entity: string
  entityKey: string
  isHighcharts: boolean
  isActive: boolean
  mentionCount: number
  mentionRatePct: number
}

export interface PromptDrilldownRunPoint {
  runId: string
  runMonth: string | null
  timestamp: string
  date: string
  totalResponses: number
  highchartsRatePct: number
  viabilityRatePct: number
  topCompetitor: { entity: string; ratePct: number } | null
  rates: Record<string, number>
}

export interface PromptDrilldownResponseItem {
  id: number
  runId: string
  runMonth: string | null
  runCreatedAt: string | null
  createdAt: string | null
  runIteration: number
  model: string
  provider?: string | null
  modelOwner?: string | null
  webSearchEnabled: boolean
  error: string | null
  durationMs?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  responseText: string
  citations: string[]
  mentions: string[]
}

export interface PromptDrilldownResponse {
  generatedAt: string
  prompt: {
    id: string
    query: string
    sortOrder: number
    isPaused: boolean
    createdAt: string | null
    updatedAt: string | null
  }
  summary: {
    totalResponses: number
    trackedRuns: number
    highchartsRatePct: number
    viabilityRatePct: number
    leadPct: number
    topCompetitor: { entity: string; ratePct: number } | null
    lastRunAt: string | null
  }
  competitors: PromptDrilldownCompetitor[]
  runPoints: PromptDrilldownRunPoint[]
  responses: PromptDrilldownResponseItem[]
}

export interface PromptLabRunResponse {
  ok: boolean
  query: string
  models: string[]
  results: PromptLabRunResult[]
  summary: PromptLabRunSummary
  model?: string | null
  provider?: string | null
  modelOwner?: string | null
  webSearchEnabled: boolean
  responseText: string
  citations: string[]
  durationMs: number
  tokens?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export interface PromptLabRunResult {
  ok: boolean
  model: string
  provider: string
  modelOwner: string
  webSearchEnabled: boolean
  responseText: string
  citations: string[]
  durationMs: number
  error: string | null
  tokens: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export interface PromptLabRunSummary {
  modelCount: number
  successCount: number
  failureCount: number
  totalDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
}

export interface BenchmarkWorkflowRun {
  id: number
  runNumber: number
  status: string
  conclusion: string | null
  htmlUrl: string
  createdAt: string
  updatedAt: string
  headBranch: string
  title: string
  actor: string
}

export interface BenchmarkTriggerResponse {
  ok: boolean
  triggerId: string
  workflow: string
  repo: string
  ref: string
  models?: string[]
  run: BenchmarkWorkflowRun | null
  message: string
}

export interface BenchmarkRunsResponse {
  ok: boolean
  workflow: string
  repo: string
  runs: BenchmarkWorkflowRun[]
}
