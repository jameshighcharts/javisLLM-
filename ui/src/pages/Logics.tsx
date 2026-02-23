import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

type Accent = 'green' | 'amber' | 'neutral'

const ACCENT = {
  green: { border: '#52B256', badge: '#EEFAF0', badgeText: '#276B2E', badgeBorder: '#B8E4BF' },
  amber: { border: '#D4870F', badge: '#FEF5E7', badgeText: '#925C0A', badgeBorder: '#F7D89A' },
  neutral: { border: '#A8BEA9', badge: '#F4EFE9', badgeText: '#4A5E4D', badgeBorder: '#DDD0BC' },
}

function MetricCard({
  index,
  name,
  formula,
  meaning,
  current,
  accent = 'neutral',
  note,
}: {
  index: number
  name: string
  formula: string
  meaning: string
  current: string
  accent?: Accent
  note?: string
}) {
  const a = ACCENT[accent]
  return (
    <div
      className="rounded-xl border flex flex-col overflow-hidden transition-shadow hover:shadow-sm"
      style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
    >
      <div className="px-5 pt-5 pb-4 flex-1 flex flex-col gap-3">
        {/* Header: index + name + value */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span
              className="text-[11px] font-bold mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: '#F0EBE3', color: '#9AAE9C' }}
            >
              {index}
            </span>
            <span className="text-[13px] font-semibold leading-snug" style={{ color: '#1C2B1E' }}>
              {name}
            </span>
          </div>
          <div
            className="shrink-0 rounded-md px-2.5 py-1 text-sm font-bold whitespace-nowrap tabular-nums"
            style={{
              background: a.badge,
              color: a.badgeText,
              border: `1.5px solid ${a.badgeBorder}`,
              fontSize: '13px',
            }}
          >
            {current}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs leading-relaxed pl-7" style={{ color: '#7A8E7C' }}>
          {meaning}
        </p>
        {note && (
          <p className="text-[11px] font-medium pl-7" style={{ color: '#A8BEA9' }}>
            {note}
          </p>
        )}
      </div>

      {/* Formula footer */}
      <div
        className="px-5 py-2.5 border-t flex items-center gap-2"
        style={{ borderColor: '#EDE8DF', background: '#F8F4EF' }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: '#B4C5B6' }}>
          formula
        </span>
        <code className="text-[11px] truncate" style={{ color: '#8EA090', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
          {formula}
        </code>
      </div>
    </div>
  )
}

function SectionLabel({ label, desc }: { label: string; desc?: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#9AAE9C' }}>
        {label}
      </span>
      {desc && (
        <span className="text-xs" style={{ color: '#B4C5B6' }}>
          {desc}
        </span>
      )}
      <div className="flex-1 h-px" style={{ background: '#EDE8DF' }} />
    </div>
  )
}

export default function Logics() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  })

  if (dashboard.isError) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
      >
        {(dashboard.error as Error).message}
      </div>
    )
  }

  const data = dashboard.data
  const loading = dashboard.isLoading || !data
  const promptStatus = data?.promptStatus ?? []
  const tracked = promptStatus.filter((p) => p.status === 'tracked')
  const wins = tracked.filter(
    (p) => !p.topCompetitor || p.highchartsRatePct >= p.topCompetitor.ratePct,
  )

  const winRate = tracked.length > 0 ? (wins.length / tracked.length) * 100 : 0
  const coverage = promptStatus.length > 0 ? (tracked.length / promptStatus.length) * 100 : 0
  const avgPromptHighcharts =
    tracked.length > 0
      ? tracked.reduce((sum, p) => sum + p.highchartsRatePct, 0) / tracked.length
      : 0
  const avgPromptViability =
    tracked.length > 0
      ? tracked.reduce((sum, p) => sum + p.viabilityRatePct, 0) / tracked.length
      : 0

  const highchartsCompetitor = data?.competitorSeries.find((e) => e.isHighcharts) ?? null
  const highchartsMentionRate = highchartsCompetitor?.mentionRatePct ?? 0
  const highchartsSov = highchartsCompetitor?.shareOfVoicePct ?? 0

  const metaItems = loading
    ? [
        { label: 'Last generated', value: '—' },
        { label: 'Run month', value: '—' },
        { label: 'Models', value: '—' },
        { label: 'Web search', value: '—' },
      ]
    : [
        { label: 'Last generated', value: new Date(data.generatedAt).toLocaleString() },
        { label: 'Run month', value: data.summary.runMonth ?? 'n/a' },
        { label: 'Models', value: data.summary.models.join(', ') || 'n/a' },
        { label: 'Web search', value: String(data.summary.webSearchEnabled ?? 'n/a') },
      ]

  return (
    <div className="max-w-[900px] space-y-6">
      {/* Run context strip */}
      <div
        className="rounded-xl border px-5 py-4 flex flex-wrap gap-x-8 gap-y-3 items-center"
        style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
      >
        <div className="flex items-center gap-2 mr-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#52B256' }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#9AAE9C' }}>
            Latest run
          </span>
        </div>
        <div className="w-px h-4 hidden sm:block" style={{ background: '#DDD0BC' }} />
        {metaItems.map(({ label, value }) => (
          <div key={label} className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: '#B4C5B6' }}>
              {label}
            </span>
            <span className="text-[13px] font-medium" style={{ color: '#1C2B1E' }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Section: Core performance */}
      <div className="space-y-3">
        <SectionLabel label="Core performance" desc="Top-level health indicators" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricCard
            index={1}
            name="AI Visibility Score"
            meaning="Primary benchmark score for the latest run. Summarises overall brand visibility performance across all prompts and models."
            formula="overallScore = benchmark_runs.overall_score"
            current={loading ? '—' : `${data.summary.overallScore.toFixed(1)} / 100`}
            accent="green"
            note="↑ Your actual Highcharts benchmark score."
          />
          <MetricCard
            index={2}
            name="Win Rate"
            meaning="Share of tracked prompts where Highcharts matches or beats the top competitor."
            formula="wins / trackedPrompts × 100"
            current={loading ? '—' : `${winRate.toFixed(1)}%  (${wins.length}/${tracked.length})`}
            accent={winRate >= 50 ? 'green' : 'amber'}
          />
          <MetricCard
            index={3}
            name="Coverage"
            meaning="How many configured prompts have at least one run result."
            formula="trackedPrompts / totalPrompts × 100"
            current={
              loading ? '—' : `${coverage.toFixed(1)}%  (${tracked.length}/${promptStatus.length})`
            }
            accent={coverage === 100 ? 'green' : 'neutral'}
          />
          <MetricCard
            index={4}
            name="Total Responses"
            meaning="Total LLM outputs analysed in the latest run snapshot."
            formula="count(benchmark_responses for latest run)"
            current={loading ? '—' : String(data.summary.totalResponses)}
            accent="neutral"
          />
        </div>
      </div>

      {/* Section: Reach & visibility */}
      <div className="space-y-3">
        <SectionLabel label="Reach & visibility" desc="How often Highcharts appears in model outputs" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricCard
            index={5}
            name="Highcharts Mention Rate"
            meaning="Across all latest-run responses, the share where Highcharts was mentioned at least once."
            formula="HighchartsMentions / totalResponses × 100"
            current={loading ? '—' : `${highchartsMentionRate.toFixed(1)}%`}
            accent="green"
          />
          <MetricCard
            index={6}
            name="Share of Voice"
            meaning="Highcharts' portion of all entity mentions — how dominant the brand is relative to all competitors."
            formula="HighchartsMentions / allEntityMentions × 100"
            current={loading ? '—' : `${highchartsSov.toFixed(1)}%`}
            accent="neutral"
          />
        </div>
      </div>

      {/* Section: Prompt-level */}
      <div className="space-y-3">
        <SectionLabel label="Prompt-level averages" desc="Aggregated across individual tracked prompts" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricCard
            index={7}
            name="Prompt Highcharts Average"
            meaning="Average Highcharts mention rate across all tracked prompts — the prompt-level view of visibility."
            formula="sum(prompt.highchartsRatePct) / trackedPrompts"
            current={loading ? '—' : `${avgPromptHighcharts.toFixed(1)}%`}
            accent="green"
          />
          <MetricCard
            index={8}
            name="Prompt Viability Average"
            meaning="Average competitor pressure across tracked prompts — higher means more competition in responses."
            formula="sum(prompt.viabilityRatePct) / trackedPrompts"
            current={loading ? '—' : `${avgPromptViability.toFixed(1)}%`}
            accent="neutral"
          />
        </div>
      </div>
    </div>
  )
}
