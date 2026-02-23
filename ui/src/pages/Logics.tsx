import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

function LogicCard({
  name,
  formula,
  meaning,
  current,
  accent,
  note,
}: {
  name: string
  formula: string
  meaning: string
  current: string
  accent?: 'green' | 'amber' | 'neutral'
  note?: string
}) {
  const badge = {
    green: { bg: '#EEFAF0', text: '#276B2E', border: '#B8E4BF' },
    amber: { bg: '#FEF5E7', text: '#925C0A', border: '#F7D89A' },
    neutral: { bg: '#F4EFE9', text: '#4A5E4D', border: '#DDD0BC' },
  }[accent ?? 'neutral']

  return (
    <div
      className="rounded-2xl border flex flex-col gap-0 overflow-hidden transition-shadow hover:shadow-md"
      style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
    >
      {/* Card body */}
      <div className="px-5 pt-5 pb-4 flex items-start gap-4 justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm leading-snug" style={{ color: '#1C2B1E' }}>
            {name}
          </div>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#6E8472' }}>
            {meaning}
          </p>
          {note && (
            <p className="text-[11px] mt-2 font-medium" style={{ color: '#A8BEA9' }}>
              {note}
            </p>
          )}
        </div>
        <div
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold whitespace-nowrap"
          style={{ background: badge.bg, color: badge.text, border: `1.5px solid ${badge.border}` }}
        >
          {current}
        </div>
      </div>

      {/* Formula footer */}
      <div
        className="px-5 py-3 border-t flex items-center gap-2"
        style={{ borderColor: '#EDE8DF', background: '#FAF7F3' }}
      >
        <span className="text-xs font-semibold" style={{ color: '#B4C5B6' }}>ƒ</span>
        <span className="text-xs" style={{ color: '#8EA090' }}>
          {formula}
        </span>
      </div>
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

  const meta = loading
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
    <div className="max-w-[1100px] space-y-5">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#1C2B1E' }}>
            Logics
          </h2>
          <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
            Metric definitions and live values from your latest synced benchmark data.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs pb-0.5" style={{ color: '#9AAE9C' }}>
          <span
            className="w-1.5 h-1.5 rounded-full inline-block"
            style={{ background: '#52B256' }}
          />
          Live
        </div>
      </div>

      {/* Run context strip */}
      <div
        className="rounded-xl border px-5 py-4"
        style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          {meta.map(({ label, value }) => (
            <div key={label}>
              <div
                className="text-[10px] uppercase tracking-widest font-semibold mb-1"
                style={{ color: '#A8BEA9' }}
              >
                {label}
              </div>
              <div className="text-sm font-medium" style={{ color: '#1C2B1E' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LogicCard
          name="AI Visibility Score"
          meaning="Primary benchmark score for latest run. It summarizes overall brand visibility performance."
          formula="overallScore = benchmark_runs.overall_score"
          current={loading ? '—' : `${data.summary.overallScore.toFixed(1)} / 100`}
          accent="green"
          note="↑ This is your actual Highcharts benchmark score."
        />

        <LogicCard
          name="Win Rate"
          meaning="Percent of tracked prompts where Highcharts matches or beats the top competitor."
          formula="winRate = wins / trackedPrompts × 100"
          current={loading ? '—' : `${winRate.toFixed(1)}%  (${wins.length}/${tracked.length})`}
          accent={winRate >= 50 ? 'green' : 'amber'}
        />

        <LogicCard
          name="Coverage"
          meaning="How many configured prompts have at least one run result."
          formula="coverage = trackedPrompts / totalPrompts × 100"
          current={
            loading ? '—' : `${coverage.toFixed(1)}%  (${tracked.length}/${promptStatus.length})`
          }
          accent={coverage === 100 ? 'green' : 'neutral'}
        />

        <LogicCard
          name="Highcharts Mention Rate"
          meaning="Across all latest-run responses, share where Highcharts was mentioned."
          formula="mentionRate = HighchartsMentions / totalResponses × 100"
          current={loading ? '—' : `${highchartsMentionRate.toFixed(1)}%`}
          accent="green"
        />

        <LogicCard
          name="Highcharts Share of Voice"
          meaning="Share of all entity mentions attributed to Highcharts."
          formula="shareOfVoice = HighchartsMentions / allEntityMentions × 100"
          current={loading ? '—' : `${highchartsSov.toFixed(1)}%`}
          accent="neutral"
        />

        <LogicCard
          name="Prompt Highcharts Average"
          meaning="Average Highcharts rate across tracked prompts (prompt-level lens)."
          formula="avgPromptHighcharts = sum(prompt.highchartsRatePct) / trackedPrompts"
          current={loading ? '—' : `${avgPromptHighcharts.toFixed(1)}%`}
          accent="green"
        />

        <LogicCard
          name="Prompt Viability Average"
          meaning="Average competitor pressure across tracked prompts."
          formula="avgPromptViability = sum(prompt.viabilityRatePct) / trackedPrompts"
          current={loading ? '—' : `${avgPromptViability.toFixed(1)}%`}
          accent="neutral"
        />

        <LogicCard
          name="Total Responses"
          meaning="Total LLM outputs analyzed in the latest run snapshot."
          formula="totalResponses = count(benchmark_responses for latest run)"
          current={loading ? '—' : String(data.summary.totalResponses)}
          accent="neutral"
        />
      </div>
    </div>
  )
}
