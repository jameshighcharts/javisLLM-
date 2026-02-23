import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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

// ── Shared chart defaults ────────────────────────────────────────────────────

const CHART_FONT = "'Inter', system-ui, sans-serif"

const TOOLTIP_BASE: Highcharts.TooltipOptions = {
  backgroundColor: '#FFFFFF',
  borderColor: '#DDD0BC',
  borderRadius: 8,
  shadow: { color: 'rgba(42,58,44,0.08)', offsetX: 0, offsetY: 2, opacity: 1, width: 8 },
  style: { fontFamily: CHART_FONT, fontSize: '12px', color: '#2A3A2C' },
  padding: 10,
}

const CHART_CREDITS: Highcharts.CreditsOptions = { enabled: false }

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

const SCORE_TARGET = 40

function ScoreStatCard({ score, isLoading }: { score: number; isLoading: boolean }) {
  const pct = Math.min(Math.max(score, 0), 100)
  const toTarget = Math.max(0, SCORE_TARGET - pct)

  const tier =
    pct >= SCORE_TARGET
      ? { label: 'On target', color: '#16A34A', bg: 'rgba(22,163,74,0.10)', border: 'rgba(22,163,74,0.22)' }
      : pct >= SCORE_TARGET * 0.7
        ? { label: 'Close', color: '#C27D0E', bg: 'rgba(194,125,14,0.10)', border: 'rgba(194,125,14,0.22)' }
        : { label: 'Off target', color: '#C0392B', bg: 'rgba(192,57,43,0.08)', border: 'rgba(192,57,43,0.20)' }

  // Subtle card tint matching the tier
  const cardTint =
    pct >= 60
      ? 'radial-gradient(ellipse at 85% 10%, rgba(22,163,74,0.06) 0%, transparent 60%)'
      : pct >= 35
        ? 'radial-gradient(ellipse at 85% 10%, rgba(194,125,14,0.06) 0%, transparent 60%)'
        : 'radial-gradient(ellipse at 85% 10%, rgba(192,57,43,0.05) 0%, transparent 60%)'

  return (
    <div
      className="rounded-xl border shadow-sm h-full flex flex-col"
      style={{ background: `#FEFCF9`, backgroundImage: cardTint, borderColor: '#DDD0BC' }}
    >
      {/* Title row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#A8BEA9' }}
        >
          AI Visibility Score
        </span>
        <svg
          width="13"
          height="13"
          fill="none"
          viewBox="0 0 24 24"
          stroke="#B8CAB9"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
        </svg>
      </div>

      {/* Score hero */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3">
        {isLoading ? (
          <Skeleton className="h-14 w-32" />
        ) : (
          <>
            <span
              className="text-6xl font-black tracking-tight leading-none"
              style={{ color: tier.color }}
            >
              {pct.toFixed(1)}
            </span>
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-medium leading-none" style={{ color: '#C8D4C0' }}>
                / 100
              </span>
              <span
                className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}
              >
                {tier.label}
              </span>
              {toTarget > 0 && (
                <span className="text-[10px]" style={{ color: '#B8CAB9' }}>
                  +{toTarget.toFixed(1)} to goal
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Spectrum progress bar */}
      <div className="px-5 pb-5 mt-auto">
        <div className="relative h-2.5 rounded-full overflow-hidden">
          {/* Full colour spectrum — always rendered */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, #F87171 0%, #FB923C 20%, #FBBF24 40%, #A3E635 65%, #34D399 82%, #16A34A 100%)',
            }}
          />
          {/* Dim veil over the unachieved portion */}
          <div
            className="absolute top-0 right-0 h-full"
            style={{
              width: `${100 - pct}%`,
              background: 'rgba(254,252,249,0.76)',
            }}
          />
        </div>

        {/* Current score marker + target marker */}
        {!isLoading && (
          <div className="relative" style={{ height: 20 }}>
            {/* Current position tick */}
            <div
              className="absolute top-0 w-0.5 h-3 rounded-full"
              style={{ left: `${pct}%`, background: tier.color, transform: 'translateX(-50%)' }}
            />
            {/* Target marker */}
            <div
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${SCORE_TARGET}%`, transform: 'translateX(-50%)' }}
            >
              {/* Dashed notch */}
              <div
                className="w-px h-3"
                style={{
                  background: `repeating-linear-gradient(to bottom, #9AAE9C 0px, #9AAE9C 2px, transparent 2px, transparent 4px)`,
                }}
              />
              {/* Label */}
              <span
                className="text-[9px] font-semibold mt-0.5 px-1 rounded"
                style={{ color: '#7A8E7C', background: '#EDE8DF', lineHeight: '14px' }}
              >
                Goal
              </span>
            </div>
          </div>
        )}

        {/* Scale ticks */}
        <div className="flex justify-between mt-3">
          {[0, 25, 50, 75, 100].map((v) => (
            <span key={v} className="text-[10px] tabular-nums" style={{ color: '#C0CCBF' }}>
              {v}
            </span>
          ))}
        </div>

        <p className="mt-2.5 text-[11px]" style={{ color: '#A8BEA9' }}>
          70% presence · 30% share of voice
        </p>
      </div>
    </div>
  )
}

// ── Snapshot trend (AI Visibility + COMBVI) ──────────────────────────────────

function SnapshotTrendCard({
  points,
  hcEntity,
  isLoading,
}: {
  points: TimeSeriesPoint[]
  hcEntity: string | null
  isLoading: boolean
}) {
  const resolvedHcEntity = useMemo(() => {
    if (hcEntity) return hcEntity
    for (const point of points) {
      const fallback = Object.keys(point.rates).find(
        (name) => name.toLowerCase() === 'highcharts',
      )
      if (fallback) return fallback
    }
    return null
  }, [points, hcEntity])

  const snapshots = useMemo(
    () =>
      points
        .map((point) => {
          const timestampMs = Date.parse(point.timestamp ?? `${point.date}T12:00:00Z`)
          if (!Number.isFinite(timestampMs)) return null

          const hcKey =
            resolvedHcEntity ??
            Object.keys(point.rates).find((name) => name.toLowerCase() === 'highcharts') ??
            null
          const hcRatePct = hcKey ? Math.max(0, point.rates[hcKey] ?? 0) : 0
          const entries = Object.entries(point.rates)
          const totalMentionRatePct = entries.reduce((sum, [, rate]) => sum + Math.max(0, rate), 0)
          const shareOfVoicePct =
            totalMentionRatePct > 0 ? (hcRatePct / totalMentionRatePct) * 100 : 0

          const rivalRates = entries
            .filter(([name]) => (hcKey ? name !== hcKey : true))
            .map(([, rate]) => Math.max(0, rate))
          const combviPct =
            rivalRates.length > 0
              ? rivalRates.reduce((sum, rate) => sum + rate, 0) / rivalRates.length
              : 0

          return {
            x: timestampMs,
            aiVisibilityPct: Number((0.7 * hcRatePct + 0.3 * shareOfVoicePct).toFixed(2)),
            combviPct: Number(combviPct.toFixed(2)),
          }
        })
        .filter((point): point is NonNullable<typeof point> => point !== null),
    [points, resolvedHcEntity],
  )

  const aiSeries = useMemo(
    () => snapshots.map((point) => [point.x, point.aiVisibilityPct]),
    [snapshots],
  )
  const combviSeries = useMemo(
    () => snapshots.map((point) => [point.x, point.combviPct]),
    [snapshots],
  )

  const latestAi = (aiSeries.at(-1)?.[1] as number | undefined) ?? 0
  const prevAi = (aiSeries.at(-2)?.[1] as number | undefined) ?? null
  const aiDelta = prevAi !== null ? latestAi - prevAi : null

  const latestCombvi = (combviSeries.at(-1)?.[1] as number | undefined) ?? 0
  const prevCombvi = (combviSeries.at(-2)?.[1] as number | undefined) ?? null
  const combviDelta = prevCombvi !== null ? latestCombvi - prevCombvi : null

  const hasData = snapshots.length > 0

  const aiColor = HC_COLOR
  const combviColor = '#C8A87A'

  const options = useMemo(
    (): Highcharts.Options => ({
      chart: {
        type: 'line',
        height: 78,
        backgroundColor: 'transparent',
        margin: [4, 6, 6, 6],
        spacing: [0, 0, 0, 0],
        animation: { duration: 400 },
        style: { fontFamily: CHART_FONT },
      },
      credits: CHART_CREDITS,
      title: { text: undefined },
      xAxis: { visible: false, type: 'datetime' },
      yAxis: { visible: false, min: 0 },
      legend: { enabled: false },
      tooltip: { enabled: false },
      plotOptions: {
        series: {
          lineWidth: 2,
          marker: { enabled: false, states: { hover: { enabled: false } } },
          states: { hover: { lineWidthPlus: 0 } },
        },
      },
      series: [
        {
          type: 'line',
          name: 'AI Visibility',
          data: aiSeries,
          color: aiColor,
        },
        {
          type: 'line',
          name: 'COMBVI',
          data: combviSeries,
          color: combviColor,
          dashStyle: 'ShortDash',
        },
      ],
    }),
    [aiSeries, combviSeries],
  )

  return (
    <div
      className="rounded-xl border shadow-sm h-full flex flex-col"
      style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-0">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#A8BEA9' }}
        >
          Snapshot Trend
        </span>
      </div>

      {/* Latest values + deltas */}
      <div className="px-5 pt-2 pb-1 grid grid-cols-2 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#A8BEA9' }}>
                AI Visibility
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight leading-none" style={{ color: aiColor }}>
                  {latestAi.toFixed(1)}
                </span>
                {aiDelta !== null && (
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: aiDelta >= 0 ? '#16A34A' : '#DC2626' }}
                  >
                    {aiDelta >= 0 ? '▲' : '▼'} {Math.abs(aiDelta).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#A8BEA9' }}>
                COMBVI
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight leading-none" style={{ color: combviColor }}>
                  {latestCombvi.toFixed(1)}
                </span>
                {combviDelta !== null && (
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: combviDelta >= 0 ? '#16A34A' : '#DC2626' }}
                  >
                    {combviDelta >= 0 ? '▲' : '▼'} {Math.abs(combviDelta).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sparkline */}
      <div className="flex-1 px-1 pb-0">
        {isLoading ? (
          <Skeleton className="h-16 mx-4" />
        ) : hasData ? (
          <HighchartsReact highcharts={Highcharts} options={options} />
        ) : (
          <div
            className="h-16 flex items-center justify-center text-xs"
            style={{ color: '#C8D4C8' }}
          >
            No historical data yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 text-[10px]" style={{ color: '#A8BEA9' }}>
        AI Visibility + COMBVI snapshots · run history
      </div>
    </div>
  )
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

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
  const pointTimestamp = (point: TimeSeriesPoint) => {
    const source = point.timestamp ?? `${point.date}T12:00:00Z`
    const parsed = Date.parse(source)
    if (Number.isFinite(parsed)) {
      return parsed
    }
    return Date.parse(`${point.date}T12:00:00Z`)
  }

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
      marker: {
        enabled: points.length <= 3,
        radius: 4,
        symbol: 'circle',
        fillColor: HC_COLOR,
        lineWidth: 2,
        lineColor: '#FFFFFF',
        states: { hover: { enabled: true, radius: 5 } },
      },
      data: points.map((p) => [
        pointTimestamp(p),
        p.rates[hcSeries.entity] ?? 0,
      ]),
    })
  }

  for (const rival of rivals) {
    if (!visible.has(rival.entity)) continue
    const idx = rivalIndexMap.get(rival.entity) ?? 0
    const color = rivalColor(idx)
    seriesOptions.push({
      type: 'spline',
      name: rival.entity,
      color,
      lineWidth: 1.8,
      dashStyle: 'ShortDot',
      zIndex: 1,
      marker: {
        enabled: points.length <= 3,
        radius: 3,
        symbol: 'circle',
        fillColor: color,
        lineWidth: 2,
        lineColor: '#FFFFFF',
        states: { hover: { enabled: true, radius: 4 } },
      },
      data: points.map((p) => [
        pointTimestamp(p),
        p.rates[rival.entity] ?? 0,
      ]),
    })
  }

  const options: Highcharts.Options = {
    chart: {
      height: 260,
      backgroundColor: 'transparent',
      margin: [8, 8, 44, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      type: 'datetime',
      lineWidth: 0,
      tickWidth: 0,
      gridLineWidth: 0,
      crosshair: { color: '#DDD0BC', width: 1, dashStyle: 'Dash' },
      labels: {
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
        format: '{value:%b %e}',
      },
    },
    yAxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: { enabled: false },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600">{point.key:%b %e, %Y}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat: '',
      useHTML: true,
      valueDecimals: 1,
    },
    plotOptions: {
      areaspline: {
        lineWidth: 2.5,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 3 } },
      },
      spline: {
        lineWidth: 1.8,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 2.5 } },
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
  const maxRate = sorted[0]?.mentionRatePct ?? 1

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-center py-10" style={{ color: '#C8D0C8' }}>
        No competitor data yet
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {sorted.map((item, i) => {
        const dotColor = item.isHighcharts ? HC_COLOR : rivalColor(rivalIndexMap.get(item.entity) ?? 0)
        const barWidth = maxRate > 0 ? (item.mentionRatePct / maxRate) * 100 : 0
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
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium truncate"
                style={{ color: item.isHighcharts ? '#2A5C2E' : '#2A3A2C' }}
              >
                {item.entity}
              </div>
              {/* Mini bar */}
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: '#F2EDE6' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barWidth}%`, background: dotColor, opacity: 0.7 }}
                />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div
                className="text-sm font-semibold tabular-nums"
                style={{ color: item.isHighcharts ? '#3D7A42' : '#607860' }}
              >
                {item.mentionRatePct.toFixed(1)}%
              </div>
              {item.shareOfVoicePct !== undefined && (
                <div className="text-xs tabular-nums" style={{ color: '#9AAE9C' }}>
                  {item.shareOfVoicePct.toFixed(0)}% SOV
                </div>
              )}
            </div>
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

  // Dynamic yAxis max: round up to nearest 10, min 40
  const maxVal = Math.max(
    ...tracked.map((p) => p.highchartsRatePct),
    ...tracked.map((p) => p.topCompetitor?.ratePct ?? 0),
  )
  const yMax = Math.max(40, Math.ceil(maxVal / 10) * 10 + 10)

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 280,
      backgroundColor: 'transparent',
      margin: [20, 16, 100, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query, 22)),
      lineWidth: 0,
      tickWidth: 0,
      crosshair: { color: '#F2EDE6', width: 20 },
      labels: {
        style: { color: '#7A8E7C', fontSize: '11px', fontFamily: CHART_FONT },
        autoRotation: [-45],
        overflow: 'justify',
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: yMax,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C', fontFamily: CHART_FONT },
      symbolRadius: 3,
      symbolHeight: 10,
      symbolWidth: 10,
      itemDistance: 16,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      useHTML: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600;max-width:200px;white-space:normal">{point.key}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat: '',
    },
    plotOptions: {
      column: {
        borderRadius: 4,
        groupPadding: 0.1,
        pointPadding: 0.05,
        borderWidth: 0,
        dataLabels: { enabled: false },
        states: { hover: { brightness: -0.05 } },
      },
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

  const maxVal = Math.max(
    ...tracked.map((p) => p.highchartsRatePct),
    ...tracked.map((p) => p.viabilityRatePct),
  )
  const yMax = Math.max(40, Math.ceil(maxVal / 10) * 10 + 10)

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 280,
      backgroundColor: 'transparent',
      margin: [20, 16, 100, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query, 22)),
      lineWidth: 0,
      tickWidth: 0,
      crosshair: { color: '#F2EDE6', width: 20 },
      labels: {
        style: { color: '#7A8E7C', fontSize: '11px', fontFamily: CHART_FONT },
        autoRotation: [-45],
        overflow: 'justify',
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: yMax,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C', fontFamily: CHART_FONT },
      symbolRadius: 3,
      symbolHeight: 10,
      symbolWidth: 10,
      itemDistance: 16,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      useHTML: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600;max-width:200px;white-space:normal">{point.key}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat:
        '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #EDE8E0;font-size:10px;color:#9AAE9C">' +
        'Mention = any reference · Viability = recommended' +
        '</div>',
    },
    plotOptions: {
      column: {
        borderRadius: 4,
        groupPadding: 0.1,
        pointPadding: 0.05,
        borderWidth: 0,
        states: { hover: { brightness: -0.05 } },
      },
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

// ── Prompts Table (shared with Prompts page) ──────────────────────────────────

type SortKey = 'query' | 'status' | 'runs' | 'highchartsRatePct' | 'viabilityRatePct' | 'lead' | 'isPaused'

function ToggleSwitch({
  active,
  onChange,
  disabled,
}: {
  active: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!active)}
      disabled={disabled}
      style={{
        width: 30, height: 17, borderRadius: 9, border: 'none', padding: 0,
        background: active ? '#8FBB93' : '#DDD0BC',
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.15s', flexShrink: 0, outline: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
      aria-label={active ? 'Pause prompt' : 'Resume prompt'}
    >
      <span style={{
        position: 'absolute', top: 2, left: active ? 13 : 2,
        width: 13, height: 13, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', display: 'block', boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </button>
  )
}

function PStatusBadge({ status, isPaused }: { status: PromptStatus['status']; isPaused: boolean }) {
  if (isPaused) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#DDD0BC' }} />
        Paused
      </span>
    )
  }
  const tracked = status === 'tracked'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: '#F2EDE6', color: tracked ? '#607860' : '#9AAE9C', border: '1px solid #DDD0BC' }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: tracked ? '#22c55e' : '#E5DDD0' }} />
      {tracked ? 'Tracked' : 'Awaiting run'}
    </span>
  )
}

function PMiniBar({ pct, color = '#8FBB93', muted }: { pct: number; color?: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 rounded-full overflow-hidden" style={{ background: '#E5DDD0', height: 4, minWidth: 64 }}>
        <div className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: muted ? '#DDD0BC' : color }} />
      </div>
      <span className="text-xs w-9 text-right flex-shrink-0 font-medium tabular-nums"
        style={{ color: muted ? '#9AAE9C' : '#607860' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function PLeadBadge({ delta, muted }: { delta: number; muted?: boolean }) {
  const neutral = Math.abs(delta) < 1
  const positive = delta >= 1
  if (muted) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: '#F2EDE6', color: '#9AAE9C' }}>–</span>
  )
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums"
      style={{
        background: neutral ? '#F2EDE6' : positive ? '#dcfce7' : '#fef2f2',
        color: neutral ? '#7A8E7C' : positive ? '#15803d' : '#dc2626',
      }}>
      {neutral ? '≈ 0%' : `${positive ? '+' : ''}${delta.toFixed(0)}%`}
    </span>
  )
}

function PSortTh({
  label, col, current, dir, align = 'left', width, onSort,
}: {
  label: string; col: SortKey; current: SortKey | null; dir: 'asc' | 'desc'
  align?: 'left' | 'right'; width?: string; onSort: (k: SortKey) => void
}) {
  const active = current === col
  return (
    <th className="px-4 py-3 text-xs font-medium select-none"
      style={{ color: active ? '#2A3A2C' : '#7A8E7C', textAlign: align, width: width ?? undefined, cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span style={{ fontSize: 9, color: active ? '#8FBB93' : '#DDD0BC', fontWeight: 700 }}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⬍'}
        </span>
      </span>
    </th>
  )
}

function PromptStatusTable({ data, isLoading }: { data: PromptStatus[]; isLoading: boolean }) {
  const qc = useQueryClient()
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleMutation = useMutation({
    mutationFn: ({ query, active }: { query: string; active: boolean }) =>
      api.togglePromptActive(query, active),
    onMutate: async ({ query, active }) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] })
      const prev = qc.getQueryData<DashboardResponse>(['dashboard'])
      qc.setQueryData<DashboardResponse>(['dashboard'], (old) =>
        old ? { ...old, promptStatus: old.promptStatus.map((p) => p.query === query ? { ...p, isPaused: !active } : p) } : old,
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(['dashboard'], ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      let av: string | number | boolean = sortKey === 'lead'
        ? a.highchartsRatePct - (a.topCompetitor?.ratePct ?? 0)
        : a[sortKey] as string | number | boolean
      let bv: string | number | boolean = sortKey === 'lead'
        ? b.highchartsRatePct - (b.topCompetitor?.ratePct ?? 0)
        : b[sortKey] as string | number | boolean
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortKey, sortDir])

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: '#FDFCF8', borderBottom: '1px solid #F2EDE6' }}>
        <span className="text-xs" style={{ color: '#9AAE9C' }}>
          Click a query to open its drilldown dashboard.
        </span>
        <Link to="/prompts" className="text-xs font-medium"
          style={{ color: '#8FBB93' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#607860')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#8FBB93')}>
          View all →
        </Link>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
            <th className="px-4 py-3" style={{ width: 48 }} />
            <PSortTh label="Query" col="query" current={sortKey} dir={sortDir} onSort={handleSort} />
            <PSortTh label="Status" col="status" current={sortKey} dir={sortDir} onSort={handleSort} width="130px" />
            <PSortTh label="Runs" col="runs" current={sortKey} dir={sortDir} align="right" onSort={handleSort} width="60px" />
            <PSortTh label="Highcharts %" col="highchartsRatePct" current={sortKey} dir={sortDir} onSort={handleSort} width="148px" />
            <PSortTh label="Viability %" col="viabilityRatePct" current={sortKey} dir={sortDir} onSort={handleSort} width="148px" />
            <PSortTh label="Lead" col="lead" current={sortKey} dir={sortDir} onSort={handleSort} width="80px" />
            <th className="px-4 py-3 text-xs font-medium" style={{ color: '#7A8E7C', textAlign: 'left' }}>Top rival</th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-4 py-4"><Skeleton className="h-4" /></td>
                  ))}
                </tr>
              ))
            : sorted.map((p, i) => {
                const paused = p.isPaused
                const delta = p.highchartsRatePct - (p.topCompetitor?.ratePct ?? 0)
                const isPending = toggleMutation.isPending && toggleMutation.variables?.query === p.query
                return (
                  <tr key={p.query}
                    style={{
                      borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none',
                      background: paused ? '#FDFCF8' : 'transparent',
                      opacity: paused ? 0.65 : 1,
                      transition: 'opacity 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!paused) (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = paused ? '#FDFCF8' : 'transparent' }}>
                    <td className="px-4 py-3">
                      <ToggleSwitch
                        active={!paused}
                        onChange={(v) => toggleMutation.mutate({ query: p.query, active: v })}
                        disabled={isPending}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link to={`/prompts/drilldown?query=${encodeURIComponent(p.query)}`}
                        className="inline-flex items-center gap-1.5"
                        style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>
                        <span>{p.query}</span>
                        <span className="text-xs" style={{ color: paused ? '#C8D0C8' : '#8FBB93' }} aria-hidden>↗</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3"><PStatusBadge status={p.status} isPaused={paused} /></td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums"
                      style={{ color: p.runs > 0 && !paused ? '#2A3A2C' : '#E5DDD0' }}>
                      {p.runs > 0 ? p.runs : '–'}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'tracked' ? <PMiniBar pct={p.highchartsRatePct} muted={paused} /> : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'tracked' ? <PMiniBar pct={p.viabilityRatePct} color="#C8A87A" muted={paused} /> : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'tracked' ? <PLeadBadge delta={delta} muted={paused} /> : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.topCompetitor ? (
                        <div className="space-y-1">
                          <div className="text-sm font-medium" style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>{p.topCompetitor.entity}</div>
                          <PMiniBar pct={p.topCompetitor.ratePct} color="#C8A87A" muted={paused} />
                        </div>
                      ) : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
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
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const s = data?.summary
  const promptStatus = data?.promptStatus ?? []
  const competitorSeries = data?.competitorSeries ?? []

  const tracked = promptStatus.filter((p) => p.status === 'tracked')
  const wins = tracked.filter(
    (p) => !p.topCompetitor || p.highchartsRatePct >= p.topCompetitor.ratePct,
  )
  const winRate = tracked.length > 0 ? Math.round((wins.length / tracked.length) * 100) : 0
  const coverage =
    promptStatus.length > 0 ? Math.round((tracked.length / promptStatus.length) * 100) : 0

  const hcEntry = competitorSeries.find((s) => s.isHighcharts)
  const hcRate = hcEntry?.mentionRatePct ?? 0
  const hcSov = hcEntry?.shareOfVoicePct ?? 0
  const avgPromptHighcharts =
    tracked.length > 0
      ? tracked.reduce((sum, p) => sum + p.highchartsRatePct, 0) / tracked.length
      : 0

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

  const timeseriesPoints = useMemo((): TimeSeriesPoint[] => {
    if (!tsData?.points?.length) return []
    return [...tsData.points].sort((left, right) => {
      const leftSource = left.timestamp ?? `${left.date}T12:00:00Z`
      const rightSource = right.timestamp ?? `${right.date}T12:00:00Z`
      return Date.parse(leftSource) - Date.parse(rightSource)
    })
  }, [tsData])

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

      {/* KPI row: score (2) + trend chart (2) + sov (1) + prompt avg (1) */}
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-2">
          <ScoreStatCard score={s?.overallScore ?? 0} isLoading={isLoading} />
        </div>
        <div className="col-span-2">
          <SnapshotTrendCard
            points={timeseriesPoints}
            hcEntity={hcEntry?.entity ?? null}
            isLoading={isLoading}
          />
        </div>
        <StatCard
          label="Share of Voice"
          value={isLoading ? '–' : `${hcSov.toFixed(1)}%`}
          sub="of all brand mentions"
          isLoading={isLoading}
          accent={hcSov >= 30 ? '#22c55e' : undefined}
        />
        <StatCard
          label="Prompt HC Average"
          value={isLoading ? '–' : `${avgPromptHighcharts.toFixed(1)}%`}
          sub="avg across tracked prompts"
          isLoading={isLoading}
          accent={avgPromptHighcharts >= 40 ? '#22c55e' : undefined}
        />
      </div>

      {/* Main section — visibility chart + ranking */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left: visibility over time + toggles */}
        <Card
          className="col-span-7"
          title="LLM Mention Rate Over Time"
          sub="% of responses that mention each brand across runs"
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
          sub="Sorted by mention rate · bar = relative share"
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

      {/* Prompts table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>Prompt Performance</div>
            <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>Mention &amp; viability rates per query — click to drilldown</div>
          </div>
        </div>
        <PromptStatusTable data={promptStatus} isLoading={isLoading} />
      </div>

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
