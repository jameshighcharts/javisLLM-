import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { CompetitorSeries, DashboardResponse, PromptStatus, TimeSeriesPoint } from '../types'

// ── Palette ─────────────────────────────────────────────────────────────────

const HC_COLOR = '#8FBB93'
const RIVAL_COLORS = ['#C8A87A', '#A89CB8', '#D49880', '#C8B858', '#7AABB8', '#C89878', '#90A878']

function rivalColor(indexAmongRivals: number) {
  return RIVAL_COLORS[indexAmongRivals % RIVAL_COLORS.length]
}

function truncate(s: string, n = 26) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

// ── Card Shell ───────────────────────────────────────────────────────────────

function Card({
  title,
  sub,
  children,
  className = '',
  action,
}: {
  title: string
  sub?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div
      className={`rounded-xl border shadow-sm ${className}`}
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex items-start justify-between p-5 pb-0">
        <div className="flex flex-col space-y-0.5">
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            {title}
          </div>
          {sub && (
            <div className="text-xs" style={{ color: '#9AAE9C' }}>
              {sub}
            </div>
          )}
        </div>
        {action}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </div>
  )
}

// ── Run Meta Card ─────────────────────────────────────────────────────────────

function RunMetaCard({ summary }: { summary: DashboardResponse['summary'] }) {
  const runLabel = summary.runMonth
    ? new Date(summary.runMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })
    : null

  const pills = [
    runLabel,
    summary.models.length > 0 ? summary.models.join(', ') : null,
    summary.webSearchEnabled
      ? `web search ${summary.webSearchEnabled === 'yes' ? 'on' : 'off'}`
      : null,
  ].filter(Boolean) as string[]

  return (
    <div
      className="rounded-xl border shadow-sm flex items-center justify-between px-5 py-3"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <span className="text-xs font-medium" style={{ color: '#9AAE9C' }}>
        Run details
      </span>
      <div className="flex items-center gap-2">
        {pills.map((label, i) => (
          <span
            key={i}
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ background: '#F2EDE6', color: '#2A3A2C', border: '1px solid #DDD0BC' }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

function ScoreStatCard({ score, isLoading }: { score: number; isLoading: boolean }) {
  return (
    <div
      className="rounded-xl border shadow-sm h-full w-full"
      style={{ background: '#F2EDE6', borderColor: '#DDD0BC' }}
    >
      <div className="flex flex-row items-center justify-between px-4 pt-3 pb-2">
        <div className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
          AI Visibility Score
        </div>
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#9AAE9C" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
        </svg>
      </div>
      <div className="px-4 pt-0 pb-4">
        {isLoading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : (
          <div className="text-3xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
            {score.toFixed(1)}
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: '#7A8E7C' }}>
          0–100 scale · 70% presence + 30% SOV
        </p>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  isLoading,
  accent,
}: {
  label: string
  value: string | number
  sub: string
  isLoading: boolean
  accent?: string
}) {
  return (
    <div
      className="rounded-xl border shadow-sm h-full w-full"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex flex-row items-center justify-between px-4 pt-3 pb-2">
        <div className="text-sm font-medium" style={{ color: '#7A8E7C' }}>
          {label}
        </div>
      </div>
      <div className="px-4 pt-0 pb-4">
        {isLoading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : (
          <div
            className="text-3xl font-bold tracking-tight"
            style={{ color: accent ?? '#2A3A2C' }}
          >
            {value}
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: '#9AAE9C' }}>
          {sub}
        </p>
      </div>
    </div>
  )
}

// ── Visibility Time Series Chart ──────────────────────────────────────────────

function VisibilityChart({
  points,
  competitorSeries,
  visible,
}: {
  points: TimeSeriesPoint[]
  competitorSeries: CompetitorSeries[]
  visible: Set<string>
}) {
  const hcSeries = competitorSeries.find((s) => s.isHighcharts)
  const rivals = competitorSeries.filter((s) => !s.isHighcharts)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg"
        style={{ height: 260, background: '#FDFCF8', border: '1px dashed #DDD0BC' }}
      >
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: '#9AAE9C' }}>
            No historical data yet
          </p>
          <p className="text-xs mt-1" style={{ color: '#C8D0C8' }}>
            Run the benchmark to see visibility trends
          </p>
        </div>
      </div>
    )
  }

  const seriesOptions: Highcharts.SeriesOptionsType[] = []

  // Highcharts series — areaspline with fill
  if (hcSeries && visible.has(hcSeries.entity)) {
    seriesOptions.push({
      type: 'areaspline',
      name: hcSeries.entity,
      color: HC_COLOR,
      lineWidth: 2.5,
      fillColor: {
        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
        stops: [
          [0, 'rgba(143,187,147,0.22)'],
          [1, 'rgba(143,187,147,0)'],
        ],
      } as Highcharts.GradientColorObject,
      zIndex: 2,
      marker: { enabled: points.length <= 3, radius: 4 },
      data: points.map((p) => [
        Date.parse(p.date + 'T12:00:00Z'),
        p.rates[hcSeries.entity] ?? 0,
      ]),
    })
  }

  // Rival series — spline, no fill
  for (const rival of rivals) {
    if (!visible.has(rival.entity)) continue
    const idx = rivalIndexMap.get(rival.entity) ?? 0
    seriesOptions.push({
      type: 'spline',
      name: rival.entity,
      color: rivalColor(idx),
      lineWidth: 1.5,
      zIndex: 1,
      marker: { enabled: points.length <= 3, radius: 3 },
      data: points.map((p) => [
        Date.parse(p.date + 'T12:00:00Z'),
        p.rates[rival.entity] ?? 0,
      ]),
    })
  }

  const options: Highcharts.Options = {
    chart: {
      height: 260,
      backgroundColor: 'transparent',
      margin: [8, 8, 42, 50],
    },
    xAxis: {
      type: 'datetime',
      lineWidth: 0,
      tickWidth: 0,
      gridLineWidth: 0,
      labels: { style: { color: '#9AAE9C', fontSize: '11px' } },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
      title: { text: null },
    },
    legend: { enabled: false },
    tooltip: {
      shared: true,
      valueDecimals: 1,
      valueSuffix: '%',
      backgroundColor: '#FFFFFF',
      borderColor: '#DDD0BC',
      borderRadius: 8,
      shadow: false,
      style: { fontFamily: "'Inter', sans-serif", fontSize: '12px', color: '#2A3A2C' },
    },
    plotOptions: {
      areaspline: {
        lineWidth: 2.5,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 3 } },
      },
      spline: {
        lineWidth: 1.5,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 2 } },
      },
    },
    series: seriesOptions,
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Competitor Toggles ────────────────────────────────────────────────────────

function CompetitorToggles({
  competitorSeries,
  visible,
  onToggle,
}: {
  competitorSeries: CompetitorSeries[]
  visible: Set<string>
  onToggle: (name: string) => void
}) {
  const rivals = competitorSeries.filter((s) => !s.isHighcharts)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))

  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {competitorSeries.map((s) => {
        const on = visible.has(s.entity)
        const color = s.isHighcharts ? HC_COLOR : rivalColor(rivalIndexMap.get(s.entity) ?? 0)
        return (
          <button
            key={s.entity}
            onClick={() => onToggle(s.entity)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
            style={{
              background: on ? color : '#F2EDE6',
              color: on ? '#fff' : '#9AAE9C',
              border: `1.5px solid ${on ? color : '#DDD0BC'}`,
              opacity: on ? 1 : 0.7,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: on ? 'rgba(255,255,255,0.8)' : color }}
            />
            {s.entity}
          </button>
        )
      })}
    </div>
  )
}

// ── Competitor Ranking ─────────────────────────────────────────────────────────

function CompetitorRanking({ data }: { data: CompetitorSeries[] }) {
  const sorted = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const rivals = data.filter((s) => !s.isHighcharts).sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-center py-10" style={{ color: '#C8D0C8' }}>
        No competitor data yet
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {sorted.map((item, i) => {
        const dotColor = item.isHighcharts ? HC_COLOR : rivalColor(rivalIndexMap.get(item.entity) ?? 0)
        return (
          <div
            key={item.entity}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
            style={{
              background: item.isHighcharts ? '#F0F7F1' : 'transparent',
              border: `1px solid ${item.isHighcharts ? '#C8DEC9' : 'transparent'}`,
            }}
          >
            <span
              className="text-sm w-5 text-right flex-shrink-0 font-medium tabular-nums"
              style={{ color: '#C8D4C8' }}
            >
              {i + 1}
            </span>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: dotColor }}
            />
            <span
              className="flex-1 text-sm font-medium truncate"
              style={{ color: item.isHighcharts ? '#2A5C2E' : '#2A3A2C' }}
            >
              {item.entity}
            </span>
            <span
              className="text-sm font-semibold tabular-nums"
              style={{ color: item.isHighcharts ? '#3D7A42' : '#607860' }}
            >
              {item.mentionRatePct.toFixed(1)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── HC vs Top Rival per Query ──────────────────────────────────────────────────

function HCvsRivalChart({ data }: { data: PromptStatus[] }) {
  const tracked = data.filter((p) => p.status === 'tracked')

  if (tracked.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No tracked queries yet
      </div>
    )
  }

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 240,
      backgroundColor: 'transparent',
      margin: [16, 16, 96, 52],
    },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query)),
      lineWidth: 0,
      tickWidth: 0,
      labels: { style: { color: '#7A8E7C', fontSize: '11px' }, autoRotation: [-45] },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#EDE8E0',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C' },
      symbolRadius: 3,
    },
    plotOptions: {
      column: { borderRadius: 3, groupPadding: 0.08, dataLabels: { enabled: false } },
    },
    series: [
      {
        type: 'column',
        name: 'Highcharts',
        color: HC_COLOR,
        data: tracked.map((p) => p.highchartsRatePct),
      },
      {
        type: 'column',
        name: 'Top Rival',
        color: RIVAL_COLORS[0],
        data: tracked.map((p) => p.topCompetitor?.ratePct ?? 0),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Mention Rate vs Viability Rate ─────────────────────────────────────────────

function MentionVsViabilityChart({ data }: { data: PromptStatus[] }) {
  const tracked = data.filter((p) => p.status === 'tracked')

  if (tracked.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No tracked queries yet
      </div>
    )
  }

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 240,
      backgroundColor: 'transparent',
      margin: [16, 16, 96, 52],
    },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query)),
      lineWidth: 0,
      tickWidth: 0,
      labels: { style: { color: '#7A8E7C', fontSize: '11px' }, autoRotation: [-45] },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#EDE8E0',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C' },
      symbolRadius: 3,
    },
    plotOptions: {
      column: { borderRadius: 3, groupPadding: 0.08 },
    },
    series: [
      {
        type: 'column',
        name: 'Mention Rate',
        color: HC_COLOR,
        data: tracked.map((p) => p.highchartsRatePct),
      },
      {
        type: 'column',
        name: 'Viability Rate',
        color: '#A89CB8',
        data: tracked.map((p) => p.viabilityRatePct),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  })

  const { data: tsData } = useQuery({
    queryKey: ['timeseries'],
    queryFn: api.timeseries,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const s = data?.summary
  const promptStatus = data?.promptStatus ?? []
  const competitorSeries = data?.competitorSeries ?? []

  // Win rate: % of tracked queries where HC >= top rival
  const tracked = promptStatus.filter((p) => p.status === 'tracked')
  const wins = tracked.filter(
    (p) => !p.topCompetitor || p.highchartsRatePct >= p.topCompetitor.ratePct,
  )
  const winRate = tracked.length > 0 ? Math.round((wins.length / tracked.length) * 100) : 0
  const coverage =
    promptStatus.length > 0 ? Math.round((tracked.length / promptStatus.length) * 100) : 0

  const hcEntry = competitorSeries.find((s) => s.isHighcharts)
  const hcRate = hcEntry?.mentionRatePct ?? 0

  // Competitor toggles — track hidden names; all visible by default
  const [hidden, setHidden] = useState<Set<string>>(new Set<string>())
  const visible = useMemo(
    () => new Set(competitorSeries.map((s) => s.entity).filter((n) => !hidden.has(n))),
    [hidden, competitorSeries],
  )

  function toggleCompetitor(name: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  // Build time series points: use JSONL-derived data if available, else derive from competitorSeries
  const timeseriesPoints = useMemo((): TimeSeriesPoint[] => {
    if (tsData?.points && tsData.points.length > 0) return tsData.points
    if (competitorSeries.length === 0) return []
    // Single synthetic "current" point derived from overall rates
    const today = new Date().toISOString().split('T')[0]
    return [
      {
        date: today,
        total: s?.totalResponses ?? 1,
        rates: Object.fromEntries(competitorSeries.map((cs) => [cs.entity, cs.mentionRatePct])),
      },
    ]
  }, [tsData, competitorSeries, s])

  if (isError) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
      >
        <strong>Failed to load:</strong> {(error as Error).message}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* Run meta card */}
      {!isLoading && s && <RunMetaCard summary={s} />}
      {isLoading && <Skeleton className="h-11 rounded-xl" />}

      {/* KPI cards — 5-col */}
      <div className="grid grid-cols-5 gap-4">
        <ScoreStatCard score={s?.overallScore ?? 0} isLoading={isLoading} />
        <StatCard
          label="Win Rate"
          value={isLoading ? '–' : `${winRate}%`}
          sub={`${wins.length} of ${tracked.length} queries leading`}
          isLoading={isLoading}
          accent={winRate >= 50 ? '#22c55e' : '#f97316'}
        />
        <StatCard
          label="Coverage"
          value={isLoading ? '–' : `${coverage}%`}
          sub={`${tracked.length} of ${promptStatus.length} queries run`}
          isLoading={isLoading}
        />
        <StatCard
          label="Competitors"
          value={s?.competitorCount ?? '–'}
          sub="entities tracked"
          isLoading={isLoading}
        />
        <StatCard
          label="Total Responses"
          value={s?.totalResponses ?? '–'}
          sub="LLM outputs analysed"
          isLoading={isLoading}
        />
      </div>

      {/* Main section — visibility chart + ranking */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left: visibility over time + toggles */}
        <Card
          className="col-span-7"
          title="Highcharts AI Visibility"
          sub="% of LLM responses mentioning each entity over time"
          action={
            !isLoading && (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
                  {hcRate.toFixed(1)}%
                </span>
                <span className="text-xs" style={{ color: '#9AAE9C' }}>
                  mention rate
                </span>
              </div>
            )
          }
        >
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <VisibilityChart
                points={timeseriesPoints}
                competitorSeries={competitorSeries}
                visible={visible}
              />
              {competitorSeries.length > 0 && (
                <CompetitorToggles
                  competitorSeries={competitorSeries}
                  visible={visible}
                  onToggle={toggleCompetitor}
                />
              )}
            </>
          )}
        </Card>

        {/* Right: competitor ranking */}
        <Card
          className="col-span-5"
          title="Competitor Ranking"
          sub="Sorted by overall mention rate"
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : (
            <CompetitorRanking data={competitorSeries} />
          )}
        </Card>
      </div>

      {/* Bottom charts */}
      <Card
        title="Highcharts vs Top Rival by Query"
        sub="Side-by-side mention rate comparison per prompt"
      >
        {isLoading ? <Skeleton className="h-52" /> : <HCvsRivalChart data={promptStatus} />}
      </Card>

      <Card
        title="Mention Rate vs Viability Rate"
        sub="Mention rate = any mention · Viability rate = meaningfully recommended"
      >
        {isLoading ? (
          <Skeleton className="h-52" />
        ) : (
          <MentionVsViabilityChart data={promptStatus} />
        )}
      </Card>

      {/* Data file status */}
      {!isLoading && data?.files && (
        <div className="flex items-center gap-5 text-xs" style={{ color: '#9AAE9C' }}>
          {Object.entries({
            'Comparison table': data.files.comparisonTablePresent,
            'Competitor chart': data.files.competitorChartPresent,
            'KPI row': data.files.kpiPresent,
            'LLM outputs': data.files.llmOutputsPresent,
          }).map(([label, ok]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: ok ? '#22c55e' : '#E5DDD0' }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
