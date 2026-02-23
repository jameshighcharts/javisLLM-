import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { DashboardResponse } from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────

function gaugeColor(score: number) {
  if (score >= 60) return '#22c55e'
  if (score >= 30) return '#64748b'
  return '#f97316'
}

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg animate-pulse ${className}`}
      style={{ background: '#E5DDD0' }}
    />
  )
}

// ── Stat Cards ─────────────────────────────────────────────────────────────
// Follows shadcnblocks old-card API pattern exactly.
// AI score card uses bg-muted (#f1f5f9) to visually distinguish it.

function ScoreStatCard({ score, isLoading }: { score: number; isLoading: boolean }) {
  return (
    <div
      className="rounded-xl border shadow-sm h-full w-full"
      style={{ background: '#F2EDE6', borderColor: '#DDD0BC' }}
    >
      <div
        className="flex flex-row items-center justify-between px-4 pt-3 pb-2"
      >
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
}: {
  label: string
  value: string | number
  sub: string
  isLoading: boolean
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
          <div className="text-3xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
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

// ── Score Gauge ────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color = gaugeColor(score)

  const options: Highcharts.Options = {
    chart: {
      type: 'solidgauge',
      height: 200,
      backgroundColor: 'transparent',
      margin: [0, 0, 16, 0],
      spacing: [0, 0, 0, 0],
    },
    pane: {
      center: ['50%', '82%'],
      size: '150%',
      startAngle: -90,
      endAngle: 90,
      background: [
        {
          backgroundColor: '#E5DDD0',
          innerRadius: '62%',
          outerRadius: '100%',
          shape: 'arc',
          borderWidth: 0,
        } as Highcharts.PaneBackgroundOptions,
      ],
    },
    yAxis: {
      min: 0,
      max: 100,
      lineWidth: 0,
      tickWidth: 0,
      minorTickInterval: undefined,
      labels: { enabled: false },
    },
    plotOptions: {
      solidgauge: {
        innerRadius: '62%',
        dataLabels: {
          y: -28,
          borderWidth: 0,
          useHTML: true,
          formatter: function () {
            return `
              <div style="text-align:center;line-height:1">
                <span style="font-family:'Inter',sans-serif;font-size:36px;font-weight:700;color:${color};letter-spacing:-0.02em">${(this.y ?? 0).toFixed(1)}</span>
                <span style="font-family:'Inter',sans-serif;font-size:11px;color:#9AAE9C;display:block;margin-top:4px">/ 100</span>
              </div>`
          },
        },
      },
    },
    series: [
      {
        type: 'solidgauge',
        name: 'Score',
        color,
        data: [score],
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Competitor Bars ────────────────────────────────────────────────────────

function CompetitorBars({ data }: { data: DashboardResponse['competitorSeries'] }) {
  const sorted = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      height: Math.max(190, sorted.length * 34 + 30),
      backgroundColor: 'transparent',
      margin: [4, 56, 8, 4],
    },
    xAxis: {
      categories: sorted.map((s) => s.entity),
      lineWidth: 0,
      tickWidth: 0,
      labels: { style: { color: '#546657', fontSize: '12px', fontWeight: '500' } },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#F2EDE6',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
    },
    plotOptions: {
      bar: {
        borderRadius: 3,
        dataLabels: {
          enabled: true,
          format: '{y:.0f}%',
          style: {
            fontFamily: "'Inter', sans-serif",
            fontSize: '11px',
            fontWeight: '600',
            color: '#7A8E7C',
            textOutline: 'none',
          },
        },
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Mention Rate',
        showInLegend: false,
        data: sorted.map((s) => ({
          y: s.mentionRatePct,
          color: s.isHighcharts ? '#8FBB93' : '#E5DDD0',
          name: s.entity,
        })),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Query Column Chart ─────────────────────────────────────────────────────

function QueryMentions({ data }: { data: DashboardResponse['promptStatus'] }) {
  const truncate = (s: string) => (s.length > 28 ? s.slice(0, 28) + '…' : s)

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 220,
      backgroundColor: 'transparent',
      margin: [16, 16, 72, 44],
    },
    xAxis: {
      categories: data.map((p) => truncate(p.query)),
      lineWidth: 0,
      tickWidth: 0,
      labels: {
        style: { color: '#7A8E7C', fontSize: '11px' },
        autoRotation: [-35],
      },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#F2EDE6',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
    },
    plotOptions: {
      column: {
        borderRadius: 3,
        color: '#8FBB93',
        dataLabels: {
          enabled: true,
          format: '{y:.0f}%',
          style: {
            fontFamily: "'Inter', sans-serif",
            fontSize: '11px',
            fontWeight: '600',
            color: '#7A8E7C',
            textOutline: 'none',
          },
        },
      },
    },
    series: [
      {
        type: 'column',
        name: 'Highcharts',
        showInLegend: false,
        data: data.map((p) => (p.status === 'tracked' ? p.highchartsRatePct : 0)),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Card Shell ─────────────────────────────────────────────────────────────
// Follows shadcnblocks large-card pattern: bg-card, rounded-xl border shadow-sm,
// header p-6, content p-6 pt-0.

function Card({
  title,
  sub,
  children,
  className = '',
}: {
  title: string
  sub?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border shadow-sm ${className}`}
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex flex-col space-y-1 p-5 pb-0">
        <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
          {title}
        </div>
        {sub && (
          <div className="text-xs" style={{ color: '#9AAE9C' }}>
            {sub}
          </div>
        )}
      </div>
      <div className="p-5 pt-4">
        {children}
      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  })

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

  const s = data?.summary
  const runLabel = s?.runMonth
    ? new Date(s.runMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })
    : null

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* Run meta */}
      {!isLoading && s && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#9AAE9C' }}>
          {runLabel && <span>{runLabel}</span>}
          {s.models.length > 0 && (
            <>
              <span style={{ color: '#DDD0BC' }}>·</span>
              <span>{s.models.join(', ')}</span>
            </>
          )}
          {s.webSearchEnabled && (
            <>
              <span style={{ color: '#DDD0BC' }}>·</span>
              <span>web search {s.webSearchEnabled === 'yes' ? 'on' : 'off'}</span>
            </>
          )}
        </div>
      )}

      {/* KPI cards — 4-col grid, AI score featured with bg-muted */}
      <div className="grid grid-cols-4 gap-4">
        <ScoreStatCard score={s?.overallScore ?? 0} isLoading={isLoading} />
        <StatCard
          label="Queries Tracked"
          value={s?.queryCount ?? '–'}
          sub="configured prompts"
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
          sub="LLM outputs"
          isLoading={isLoading}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-5 gap-4">
        <Card
          className="col-span-2"
          title="AI Visibility Score"
          sub="70% mention presence · 30% share-of-voice"
        >
          {isLoading ? <Skeleton className="h-48" /> : <ScoreGauge score={s?.overallScore ?? 0} />}
        </Card>

        <Card
          className="col-span-3"
          title="Mention Rates"
          sub="% of queries each entity appeared in"
        >
          {isLoading ? <Skeleton className="h-48" /> : <CompetitorBars data={data?.competitorSeries ?? []} />}
        </Card>
      </div>

      {/* Per-query chart */}
      <Card
        title="Highcharts Mention Rate by Query"
        sub="% of runs Highcharts was mentioned per prompt"
      >
        {isLoading ? <Skeleton className="h-52" /> : <QueryMentions data={data?.promptStatus ?? []} />}
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
