export interface DashboardSummary {
  overallScore: number
  queryCount: number
  competitorCount: number
  totalResponses: number
  models: string[]
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
  isPaused: boolean
  status: 'tracked' | 'awaiting_run'
  runs: number
  highchartsRatePct: number
  viabilityRatePct: number
  topCompetitor: { entity: string; ratePct: number } | null
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
  competitors: string[]
  aliases: Record<string, string[]>
  pausedQueries?: string[]
}

export interface ConfigResponse {
  config: BenchmarkConfig
  meta: {
    path: string
    updatedAt: string
    queries: number
    competitors: number
  }
}

export interface HealthResponse {
  ok: boolean
  repoRoot: string
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
}

export interface TimeSeriesResponse {
  ok: boolean
  competitors: string[]
  points: TimeSeriesPoint[]
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
  webSearchEnabled: boolean
  error: string | null
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
  run: BenchmarkWorkflowRun | null
  message: string
}

export interface BenchmarkRunsResponse {
  ok: boolean
  workflow: string
  repo: string
  runs: BenchmarkWorkflowRun[]
}
