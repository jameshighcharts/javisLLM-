import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type {
  PromptDrilldownCompetitor,
  PromptDrilldownResponseItem,
  PromptDrilldownRunPoint,
} from '../types'

const HC_COLOR = '#8FBB93'
const RIVAL_COLORS = ['#C8A87A', '#A89CB8', '#D49880', '#C8B858', '#7AABB8', '#C89878']

const CHART_FONT = "'Inter', system-ui, sans-serif"

// ── Brand logos ──────────────────────────────────────────────────────────────

const ENTITY_LOGOS: Record<string, string> = {
  'chart.js':   '/chartjs.png',
  'chartjs':    '/chartjs.png',
  'd3.js':      '/d3.png',
  'd3':         '/d3.png',
  'highcharts': '/highcharts%20(1).svg',
  'echarts':    '/echarts.png',
  'ag grid':    '/aggrid.png',
  'aggrid':     '/aggrid.png',
  'ag chart':   '/aggrid.png',
  'amcharts':   '/amcharts.png',
  'recharts':   '/react-svgrepo-com.svg',
}

interface LogoCrop { x: number; y: number; w: number; h: number; srcW: number; srcH: number; displayH: number }
const LOGO_CROP: Record<string, LogoCrop> = {
  '/aggrid.png':   { x: 16, y: 116, w: 374, h: 118, srcW: 400, srcH: 400, displayH: 13 },
  '/amcharts.png': { x: 100, y: 100, w: 799, h: 353, srcW: 1000, srcH: 558, displayH: 13 },
}

function getEntityLogo(entity: string): string | null {
  return ENTITY_LOGOS[entity.toLowerCase()] ?? null
}

function EntityLogo({ entity, size = 16 }: { entity: string; size?: number }) {
  const src = getEntityLogo(entity)
  if (!src) return null
  const crop = LOGO_CROP[src]
  if (crop) {
    const scale = crop.displayH / crop.h
    const displayW = Math.round(crop.w * scale)
    const imgW = Math.round(crop.srcW * scale)
    const imgH = Math.round(crop.srcH * scale)
    const offX = Math.round(crop.x * scale)
    const offY = Math.round(crop.y * scale)
    return (
      <div style={{ width: displayW, height: crop.displayH, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <img src={src} alt={entity}
          style={{ position: 'absolute', width: imgW, height: imgH, top: -offY, left: -offX, objectFit: 'fill' }} />
      </div>
    )
  }
  return (
    <div style={{ width: size, height: size, overflow: 'hidden', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0 }} alt={entity} />
    </div>
  )
}

function logoLabel(entity: string, opts?: { size?: number; color?: string; fontSize?: string; fontWeight?: string }) {
  const logo = getEntityLogo(entity)
  const size = opts?.size ?? 14
  const color = opts?.color ?? '#607860'
  const fontSize = opts?.fontSize ?? '12px'
  const fontWeight = opts?.fontWeight ?? '500'
  if (logo) {
    const crop = LOGO_CROP[logo]
    let imgHtml: string
    if (crop) {
      const scale = crop.displayH / crop.h
      const displayW = Math.round(crop.w * scale)
      const imgW = Math.round(crop.srcW * scale)
      const imgH = Math.round(crop.srcH * scale)
      const offX = Math.round(crop.x * scale)
      const offY = Math.round(crop.y * scale)
      imgHtml =
        `<span style="display:inline-block;width:${displayW}px;height:${crop.displayH}px;overflow:hidden;position:relative;flex-shrink:0;vertical-align:middle">` +
        `<img src="${logo}" style="position:absolute;width:${imgW}px;height:${imgH}px;top:${-offY}px;left:${-offX}px;object-fit:fill" />` +
        `</span>`
    } else {
      imgHtml =
        `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;overflow:hidden;border-radius:2px;flex-shrink:0;vertical-align:middle">` +
        `<img src="${logo}" width="${size}" height="${size}" style="object-fit:contain;flex-shrink:0" />` +
        `</span>`
    }
    return (
      `<span style="display:inline-flex;align-items:center;gap:4px">` +
      imgHtml +
      `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>` +
      `</span>`
    )
  }
  return `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>`
}

const TOOLTIP_BASE: Highcharts.TooltipOptions = {
  backgroundColor: '#FFFFFF',
  borderColor: '#DDD0BC',
  borderRadius: 8,
  shadow: { color: 'rgba(42,58,44,0.08)', offsetX: 0, offsetY: 2, opacity: 1, width: 8 },
  style: { fontFamily: CHART_FONT, fontSize: '12px', color: '#2A3A2C' },
  padding: 10,
}

const CHART_CREDITS: Highcharts.CreditsOptions = { enabled: false }

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function shortRunId(value: string) {
  if (value.length <= 8) return value
  return `${value.slice(0, 8)}…`
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

type OutputTagMap = Record<string, string>

function normalizeOutputTagValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeOutputTagValue(item))
      .filter(Boolean)
      .join(' ')
      .trim()
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return ''
}

function extractOutputTags(responseText: string): OutputTagMap {
  const extractRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  }

  const parseJson = (raw: string): Record<string, unknown> | null => {
    const candidates: string[] = [raw.trim()]
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim())
    }

    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        const parsed = JSON.parse(candidate) as unknown
        const record = extractRecord(parsed)
        if (record) return record
      } catch {
        continue
      }
    }

    return null
  }

  const tags: OutputTagMap = {}
  const parsed = parseJson(responseText)
  for (const [rawKey, value] of Object.entries(parsed ?? {})) {
    const key = rawKey.trim().toLowerCase()
    if (!key) continue
    const normalizedValue = normalizeOutputTagValue(value)
    if (normalizedValue) {
      tags[key] = normalizedValue
    }
  }

  const fallbackText = responseText.toLowerCase()
  for (const fallbackTag of ['rtargs', 'keywords', 'esearch']) {
    if (!tags[fallbackTag] && fallbackText.includes(fallbackTag)) {
      tags[fallbackTag] = fallbackTag
    }
  }

  return tags
}

function rivalColor(index: number) {
  return RIVAL_COLORS[index % RIVAL_COLORS.length]
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div
      className="rounded-xl border shadow-sm px-4 py-3"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="text-xs font-medium" style={{ color: '#7A8E7C' }}>
        {label}
      </div>
      <div
        className="text-2xl font-bold tracking-tight mt-1"
        style={{ color: accent ?? '#2A3A2C' }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: '#9AAE9C' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function EmptyChartState({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      className="h-[280px] rounded-lg flex flex-col items-center justify-center text-center px-6"
      style={{ background: '#FDFCF8', border: '1px dashed #DDD0BC' }}
    >
      <div className="text-sm font-semibold" style={{ color: '#7A8E7C' }}>
        {title}
      </div>
      <div className="text-xs mt-1" style={{ color: '#9AAE9C' }}>
        {sub}
      </div>
    </div>
  )
}

function PromptTrendChart({
  runPoints,
  competitors,
}: {
  runPoints: PromptDrilldownRunPoint[]
  competitors: PromptDrilldownCompetitor[]
}) {
  if (runPoints.length === 0) {
    return (
      <EmptyChartState
        title="No runs yet for this prompt"
        sub="Run benchmark again after enabling this prompt to populate trend data."
      />
    )
  }

  const highchartsEntity = competitors.find((row) => row.isHighcharts)?.entity ?? null
  const rivals = competitors.filter((row) => !row.isHighcharts).slice(0, 3)
  const seriesNames = [
    ...(highchartsEntity ? [highchartsEntity] : []),
    ...rivals.map((row) => row.entity),
  ]

  const series: Highcharts.SeriesOptionsType[] = seriesNames.map((name) => {
    const isHC = name === highchartsEntity
    const rivalIndex = rivals.findIndex((row) => row.entity === name)
    const color = isHC ? HC_COLOR : rivalColor(Math.max(rivalIndex, 0))
    return {
      type: isHC ? 'areaspline' : 'spline',
      name,
      color,
      lineWidth: isHC ? 2.5 : 1.8,
      dashStyle: isHC ? 'Solid' : 'ShortDot',
      marker: {
        enabled: runPoints.length <= 4,
        radius: isHC ? 4 : 3,
        symbol: 'circle',
        fillColor: color,
        lineWidth: 2,
        lineColor: '#FFFFFF',
        states: { hover: { enabled: true, radius: isHC ? 5 : 4 } },
      },
      zIndex: isHC ? 2 : 1,
      fillColor: isHC
        ? {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'rgba(143,187,147,0.22)'],
              [1, 'rgba(143,187,147,0)'],
            ],
          }
        : undefined,
      data: runPoints.map((point) => [Date.parse(point.timestamp), point.rates[name] ?? 0]),
    }
  })

  const options: Highcharts.Options = {
    chart: {
      height: 280,
      backgroundColor: 'transparent',
      margin: [12, 12, 46, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      type: 'datetime',
      lineWidth: 0,
      tickWidth: 0,
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
      title: { text: null },
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
    },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      useHTML: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600">{point.key:%b %e, %Y}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat: '',
    },
    legend: {
      enabled: true,
      align: 'left',
      verticalAlign: 'top',
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#2A3A2C', fontFamily: CHART_FONT },
      symbolRadius: 4,
      symbolHeight: 8,
      symbolWidth: 8,
    },
    plotOptions: {
      spline: {
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 2.5 } },
      },
      areaspline: {
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 3 } },
      },
    },
    series,
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function CompetitorBreakdownChart({ competitors }: { competitors: PromptDrilldownCompetitor[] }) {
  if (competitors.length === 0) {
    return (
      <EmptyChartState
        title="No competitor data"
        sub="Mentions will appear here after this prompt gets benchmark responses."
      />
    )
  }

  const sorted = [...competitors].sort((left, right) => right.mentionRatePct - left.mentionRatePct)
  const maxVal = sorted[0]?.mentionRatePct ?? 1
  const yMax = Math.max(20, Math.ceil(maxVal / 10) * 10 + 10)

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      height: Math.max(280, sorted.length * 40 + 40),
      backgroundColor: 'transparent',
      margin: [12, 40, 30, 130],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      categories: sorted.map((row) => row.entity),
      lineWidth: 0,
      tickWidth: 0,
      labels: {
        useHTML: true,
        style: { color: '#7A8E7C', fontSize: '12px', fontWeight: '500' },
        formatter: function () {
          return logoLabel(String(this.value), { size: 14 })
        },
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: yMax,
      title: { text: null },
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
    },
    legend: { enabled: false },
    tooltip: {
      ...TOOLTIP_BASE,
      useHTML: true,
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C;font-weight:600">{point.category}</span>' +
        '<span style="margin-left:6px;color:#607860;font-weight:700">{point.y:.1f}%</span>' +
        '</div>',
      headerFormat: '',
    },
    plotOptions: {
      bar: {
        borderRadius: 4,
        borderWidth: 0,
        dataLabels: {
          enabled: true,
          format: '{y:.0f}%',
          style: {
            color: '#607860',
            textOutline: 'none',
            fontSize: '11px',
            fontWeight: '600',
            fontFamily: CHART_FONT,
          },
        },
        states: { hover: { brightness: -0.05 } },
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Mention rate',
        data: sorted.map((row, index) => ({
          y: row.mentionRatePct,
          color: row.isHighcharts ? HC_COLOR : rivalColor(index),
        })),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function RunHistoryTable({ runPoints }: { runPoints: PromptDrilldownRunPoint[] }) {
  if (runPoints.length === 0) {
    return (
      <div className="text-sm text-center py-10" style={{ color: '#9AAE9C' }}>
        No run history for this prompt yet.
      </div>
    )
  }

  const rows = [...runPoints].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Run</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Started</th>
            <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Responses</th>
            <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Highcharts %</th>
            <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Viability %</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Top rival</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point, index) => (
            <tr
              key={point.runId}
              style={{
                borderBottom: index < rows.length - 1 ? '1px solid #F2EDE6' : 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
            >
              <td className="px-4 py-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
                    {point.runMonth ?? 'No month'}
                  </div>
                  <div className="text-xs" style={{ color: '#9AAE9C' }}>
                    {shortRunId(point.runId)}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm" style={{ color: '#2A3A2C' }}>
                {formatDateTime(point.timestamp)}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#2A3A2C' }}>
                {point.totalResponses}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#2A5C2E' }}>
                {point.highchartsRatePct.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#7A8E7C' }}>
                {point.viabilityRatePct.toFixed(1)}%
              </td>
              <td className="px-4 py-3">
                {point.topCompetitor ? (
                  <div className="flex items-center gap-1.5">
                    {getEntityLogo(point.topCompetitor.entity) && (
                      <EntityLogo entity={point.topCompetitor.entity} size={14} />
                    )}
                    <span className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
                      {point.topCompetitor.entity}
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: '#9AAE9C' }}>
                      ({point.topCompetitor.ratePct.toFixed(1)}%)
                    </span>
                  </div>
                ) : (
                  <span className="text-sm" style={{ color: '#E5DDD0' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResponseExplorer({
  responses,
  runOptions,
}: {
  responses: PromptDrilldownResponseItem[]
  runOptions: PromptDrilldownRunPoint[]
}) {
  const [selectedRunId, setSelectedRunId] = useState<string>('all')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedResponseIds, setExpandedResponseIds] = useState<Set<number>>(new Set())

  const responseSearchRows = useMemo(
    () =>
      responses.map((response) => {
        const tags = extractOutputTags(response.responseText)
        return {
          response,
          tags,
          allText: [
            response.responseText,
            response.mentions.join(' '),
            response.citations.join(' '),
            response.error ?? '',
            response.model,
            response.webSearchEnabled ? 'web on' : 'web off',
            ...Object.entries(tags).flatMap(([key, value]) => [key, value]),
          ]
            .join('\n')
            .toLowerCase(),
        }
      }),
    [responses],
  )

  const effectiveRunId =
    selectedRunId === 'all' || runOptions.some((run) => run.runId === selectedRunId)
      ? selectedRunId
      : 'all'

  const availableTags = useMemo(() => {
    return [...new Set(responseSearchRows.flatMap((row) => Object.keys(row.tags)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
  }, [responseSearchRows])

  const effectiveTag = selectedTag === 'all' || availableTags.includes(selectedTag)
    ? selectedTag
    : 'all'

  const filteredResponses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()

    return responseSearchRows
      .filter((row) => effectiveRunId === 'all' || row.response.runId === effectiveRunId)
      .filter((row) => {
        const tagValue = effectiveTag === 'all' ? '' : row.tags[effectiveTag] ?? ''

        if (effectiveTag !== 'all' && !tagValue) return false
        if (!term) return true

        const haystack =
          effectiveTag === 'all'
            ? row.allText
            : tagValue.toLowerCase()

        return haystack.includes(term)
      })
      .map((row) => row.response)
  }, [responseSearchRows, effectiveRunId, effectiveTag, searchTerm])

  if (responses.length === 0) {
    return (
      <div className="text-sm text-center py-10" style={{ color: '#9AAE9C' }}>
        No prompt outputs yet. Run benchmark to generate output text and mention matches.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-medium" style={{ color: '#7A8E7C' }}>
          Showing {filteredResponses.length} of {responses.length} outputs
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: '#7A8E7C' }}>
            Run filter
            <select
              value={effectiveRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs"
              style={{ border: '1px solid #DDD0BC', background: '#FFFFFF', color: '#2A3A2C' }}
            >
              <option value="all">All runs</option>
              {runOptions
                .slice()
                .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
                .map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {run.runMonth ?? shortRunId(run.runId)} · {new Date(run.timestamp).toLocaleDateString()}
                  </option>
                ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: '#7A8E7C' }}>
            Tags
            <select
              value={effectiveTag}
              onChange={(event) => setSelectedTag(event.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs"
              style={{ border: '1px solid #DDD0BC', background: '#FFFFFF', color: '#2A3A2C' }}
            >
              <option value="all">All tags</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: '#7A8E7C' }}>
            Search
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={effectiveTag === 'all' ? 'Find text in outputs' : `Find text in ${effectiveTag}`}
              className="px-2.5 py-1.5 rounded-lg text-xs min-w-[220px]"
              style={{ border: '1px solid #DDD0BC', background: '#FFFFFF', color: '#2A3A2C' }}
            />
          </label>
        </div>
      </div>

      <div className="space-y-3 max-h-[680px] overflow-y-auto pr-1">
        {filteredResponses.length === 0 && (
          <div
            className="rounded-xl border border-dashed px-4 py-8 text-sm text-center"
            style={{ borderColor: '#DDD0BC', color: '#9AAE9C', background: '#FDFCF8' }}
          >
            No outputs match the current filters.
          </div>
        )}

        {filteredResponses.map((response) => {
          const isExpanded = expandedResponseIds.has(response.id)
          const output = isExpanded
            ? response.responseText
            : truncate(response.responseText, 420)

          return (
            <div
              key={response.id}
              className="rounded-xl border p-4"
              style={{ background: '#FFFFFF', borderColor: '#E5DDD0' }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold" style={{ color: '#2A3A2C' }}>
                    Run {response.runMonth ?? shortRunId(response.runId)} · #{response.runIteration}
                  </div>
                  <div className="text-xs" style={{ color: '#9AAE9C' }}>
                    {formatDateTime(response.createdAt ?? response.runCreatedAt)}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span
                    className="px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#F2EDE6', color: '#607860', border: '1px solid #DDD0BC' }}
                  >
                    {response.model}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: response.webSearchEnabled ? '#ECFDF3' : '#F8FAFC',
                      color: response.webSearchEnabled ? '#166534' : '#64748b',
                      border: `1px solid ${response.webSearchEnabled ? '#bbf7d0' : '#e2e8f0'}`,
                    }}
                  >
                    web {response.webSearchEnabled ? 'on' : 'off'}
                  </span>
                </div>
              </div>

              {response.error && (
                <div
                  className="mt-3 rounded-lg px-3 py-2 text-xs"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
                >
                  {response.error}
                </div>
              )}

              <div
                className="mt-3 rounded-lg px-3 py-3 text-sm whitespace-pre-wrap"
                style={{ background: '#FDFCF8', border: '1px solid #F2EDE6', color: '#2A3A2C', lineHeight: 1.5 }}
              >
                {output || 'No output text recorded.'}
              </div>

              {response.responseText.length > 420 && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedResponseIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(response.id)) {
                        next.delete(response.id)
                      } else {
                        next.add(response.id)
                      }
                      return next
                    })
                  }}
                  className="mt-2 text-xs font-medium"
                  style={{ color: '#607860' }}
                >
                  {isExpanded ? 'Collapse output' : 'Show full output'}
                </button>
              )}

              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9AAE9C' }}>
                  Mentions
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {response.mentions.length > 0 ? (
                    response.mentions.map((mention) => (
                      <span
                        key={`${response.id}-${mention}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: '#F0F7F1', color: '#2A5C2E', border: '1px solid #C8DEC9' }}
                      >
                        {mention}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs" style={{ color: '#9AAE9C' }}>No tracked entities found</span>
                  )}
                </div>
              </div>

              {response.citations.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9AAE9C' }}>
                    Citations
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {response.citations.slice(0, 6).map((citation, index) => {
                      const isLink = /^https?:\/\//i.test(citation)
                      if (isLink) {
                        return (
                          <a
                            key={`${response.id}-citation-${index}`}
                            href={citation}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
                          >
                            source {index + 1}
                          </a>
                        )
                      }

                      return (
                        <span
                          key={`${response.id}-citation-${index}`}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
                        >
                          {truncate(citation, 64)}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PromptDrilldown() {
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('query') ?? '').trim()

  const drilldownQuery = useQuery({
    queryKey: ['prompt-drilldown', query],
    queryFn: () => api.promptDrilldown(query),
    enabled: Boolean(query),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

  if (!query) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
      >
        Missing prompt query parameter. Open this page from the Prompts table.
      </div>
    )
  }

  if (drilldownQuery.isError) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Link
          to="/prompts"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: '#607860' }}
        >
          <span aria-hidden>←</span> Back to prompts
        </Link>
        <div
          className="rounded-xl p-5 text-sm"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
        >
          {(drilldownQuery.error as Error).message}
        </div>
      </div>
    )
  }

  const data = drilldownQuery.data
  const loading = drilldownQuery.isLoading || !data

  return (
    <div className="max-w-[1200px] space-y-4">
      <Link
        to="/prompts"
        className="inline-flex items-center gap-1.5 text-xs font-medium"
        style={{ color: '#607860' }}
      >
        <span aria-hidden>←</span> Back to prompts
      </Link>

      <div
        className="rounded-xl border shadow-sm p-5"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide" style={{ color: '#9AAE9C' }}>
              Prompt Drilldown
            </div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
              {loading ? query : data.prompt.query}
            </h2>
            {!loading && (
              <div className="text-xs" style={{ color: '#7A8E7C' }}>
                Last updated {formatDateTime(data.generatedAt)}
              </div>
            )}
          </div>

          {!loading && (
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                style={{
                  background: data.prompt.isPaused ? '#F2EDE6' : '#F0F7F1',
                  color: data.prompt.isPaused ? '#9AAE9C' : '#2A5C2E',
                  border: `1px solid ${data.prompt.isPaused ? '#DDD0BC' : '#C8DEC9'}`,
                }}
              >
                {data.prompt.isPaused ? 'Paused' : 'Active'}
              </span>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: '#F2EDE6', color: '#7A8E7C', border: '1px solid #DDD0BC' }}
              >
                sort #{data.prompt.sortOrder}
              </span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border animate-pulse h-[118px]"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Highcharts Rate"
            value={`${data.summary.highchartsRatePct.toFixed(1)}%`}
            sub={`${data.summary.totalResponses} outputs scanned`}
            accent="#2A5C2E"
          />
          <SummaryCard
            label="Lead vs Top Rival"
            value={`${data.summary.leadPct >= 0 ? '+' : ''}${data.summary.leadPct.toFixed(1)}%`}
            sub={data.summary.topCompetitor ? `vs ${data.summary.topCompetitor.entity}` : 'No rival data'}
            accent={data.summary.leadPct >= 0 ? '#2A5C2E' : '#B45309'}
          />
          <SummaryCard
            label="Viability Rate"
            value={`${data.summary.viabilityRatePct.toFixed(1)}%`}
            sub="Meaningfully recommended"
          />
          <SummaryCard
            label="Tracked Runs"
            value={String(data.summary.trackedRuns)}
            sub={data.summary.lastRunAt ? `Last run ${formatDateTime(data.summary.lastRunAt)}` : 'No runs yet'}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div
          className="rounded-xl border shadow-sm xl:col-span-2"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
              Prompt Trend Over Runs
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
              Highcharts vs top rivals for this prompt — dashed lines = rivals
            </div>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="h-[280px] rounded-lg animate-pulse" style={{ background: '#E5DDD0' }} />
            ) : (
              <PromptTrendChart runPoints={data.runPoints} competitors={data.competitors} />
            )}
          </div>
        </div>

        <div
          className="rounded-xl border shadow-sm"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
              Competitor Breakdown
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
              Mention rate for this prompt only
            </div>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="h-[280px] rounded-lg animate-pulse" style={{ background: '#E5DDD0' }} />
            ) : (
              <CompetitorBreakdownChart competitors={data.competitors} />
            )}
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Run History
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
            Per-run scoring for this prompt
          </div>
        </div>
        <div className="p-2">
          {loading ? (
            <div className="h-[220px] rounded-lg animate-pulse" style={{ background: '#E5DDD0' }} />
          ) : (
            <RunHistoryTable runPoints={data.runPoints} />
          )}
        </div>
      </div>

      <div
        className="rounded-xl border shadow-sm"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Output Explorer
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
            Raw LLM output, mention matches, and citations for each response
          </div>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[160px] rounded-lg animate-pulse" style={{ background: '#E5DDD0' }} />
              ))}
            </div>
          ) : (
            <ResponseExplorer responses={data.responses} runOptions={data.runPoints} />
          )}
        </div>
      </div>
    </div>
  )
}
