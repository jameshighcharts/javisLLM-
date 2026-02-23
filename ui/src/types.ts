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
