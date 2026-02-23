import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { api } from '../api'
import type { CompetitorSeries } from '../types'

// Highcharts = rich forest green (bolder than before); competitors = original earthy palette
const HC_COLOR = '#3D7A45'
const COMPETITOR_COLORS = ['#DDD0BC', '#D4836A', '#9B8CB5', '#D4C05A', '#9AAE9C', '#C4836A', '#6A8E6E', '#B5A898']

// Brand logo map — Recharts and AG Chart have no logo so they fall back to text
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
}

// Some PNGs have heavy transparent padding — zoom crops away the whitespace
const LOGO_ZOOM: Record<string, number> = {
  '/echarts.png': 1.9,
  '/aggrid.png':  2.2,
  '/amcharts.png':1.8,
}

function getEntityLogo(entity: string): string | null {
  return ENTITY_LOGOS[entity.toLowerCase()] ?? null
}

function EntityLogo({ entity, size = 16 }: { entity: string; size?: number }) {
  const src = getEntityLogo(entity)
  if (!src) return null
  const zoom = LOGO_ZOOM[src] ?? 1
  const inner = Math.round(size * zoom)
  return (
    <div style={{ width: size, height: size, overflow: 'hidden', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} width={inner} height={inner} style={{ objectFit: 'contain', flexShrink: 0 }} alt={entity} />
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
    const zoom = LOGO_ZOOM[logo] ?? 1
    const inner = Math.round(size * zoom)
    const imgHtml =
      `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;overflow:hidden;border-radius:2px;flex-shrink:0;vertical-align:middle">` +
      `<img src="${logo}" width="${inner}" height="${inner}" style="object-fit:contain;flex-shrink:0" />` +
      `</span>`
    return (
      `<span style="display:inline-flex;align-items:center;gap:4px">` +
      imgHtml +
      `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>` +
      `</span>`
    )
  }
  return `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>`
}

function getColor(s: CompetitorSeries, i: number) {
  if (s.isHighcharts) return HC_COLOR
  return COMPETITOR_COLORS[(i % COMPETITOR_COLORS.length)]
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1.5"
      style={{
        background: highlight ? '#EEF3EE' : '#FFFFFF',
        border: `1.5px solid ${highlight ? '#8FBB93' : '#DDD0BC'}`,
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: highlight ? '#4A8A50' : '#9AAE9C' }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-bold tracking-tight tabular-nums"
        style={{ color: highlight ? '#2A4A2C' : '#2A3A2C' }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: highlight ? '#6A9A6E' : '#9AAE9C' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border shadow-sm" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
      <div className="flex flex-col space-y-1 p-5 pb-0">
        <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>{title}</div>
        {sub && <div className="text-xs" style={{ color: '#9AAE9C' }}>{sub}</div>}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </div>
  )
}

function MentionRateChart({ data }: { data: CompetitorSeries[] }) {
  const sorted = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      height: Math.max(200, sorted.length * 38 + 30),
      backgroundColor: 'transparent',
      margin: [8, 80, 28, 120],
    },
    xAxis: {
      categories: sorted.map((s) => s.entity),
      lineWidth: 0,
      tickWidth: 0,
      labels: {
        useHTML: true,
        style: { color: '#607860', fontSize: '12px', fontWeight: '500' },
        formatter: function () {
          return logoLabel(String(this.value), { size: 14 })
        },
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#F2EDE6',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
      title: { text: null },
    },
    plotOptions: {
      bar: {
        borderRadius: 3,
        dataLabels: {
          enabled: true,
          format: '{y:.0f}%',
          style: {
            fontFamily: "'Inter', sans-serif",
            fontSize: '12px',
            fontWeight: '600',
            textOutline: 'none',
          },
          formatter: function () {
            const isHC = (this.point as { isHighcharts?: boolean }).isHighcharts
            return `<span style="color:${isHC ? HC_COLOR : '#7A8E7C'}">${(this.y ?? 0).toFixed(0)}%</span>`
          },
        },
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Mention Rate',
        showInLegend: false,
        data: sorted.map((s, i) => ({
          y: s.mentionRatePct,
          color: getColor(s, i),
          isHighcharts: s.isHighcharts,
          name: s.entity,
        })),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function ShareOfVoiceChart({ data }: { data: CompetitorSeries[] }) {
  const withData = data.filter((s) => s.shareOfVoicePct > 0)
  const sortedAll = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)

  if (withData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No share-of-voice data yet
      </div>
    )
  }

  const options: Highcharts.Options = {
    chart: {
      type: 'pie',
      height: 290,
      backgroundColor: 'transparent',
      margin: [0, 0, 0, 0],
    },
    plotOptions: {
      pie: {
        innerSize: '52%',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        dataLabels: {
          enabled: true,
          useHTML: true,
          style: {
            fontSize: '11px',
            color: '#607860',
            textOutline: 'none',
            fontWeight: '500',
          },
          connectorColor: '#DDD0BC',
          formatter: function () {
            const isHC = (this.point as { isHighcharts?: boolean }).isHighcharts
            const color = isHC ? HC_COLOR : '#607860'
            const logo = getEntityLogo(this.point.name ?? '')
            const pSize = 12
            const pZoom = LOGO_ZOOM[logo ?? ''] ?? 1
            const pInner = Math.round(pSize * pZoom)
            const nameSpan = logo
              ? `<span style="display:inline-flex;align-items:center;gap:3px">` +
                `<span style="display:inline-flex;align-items:center;justify-content:center;width:${pSize}px;height:${pSize}px;overflow:hidden;border-radius:2px;flex-shrink:0;vertical-align:middle">` +
                `<img src="${logo}" width="${pInner}" height="${pInner}" style="object-fit:contain;flex-shrink:0" />` +
                `</span>` +
                `<span style="color:${color}">${this.point.name}</span>` +
                `</span>`
              : `<span style="color:${color}">${this.point.name}</span>`
            return `${nameSpan}: <b style="color:${color}">${(this.y ?? 0).toFixed(1)}%</b>`
          },
        },
      },
    },
    series: [
      {
        type: 'pie',
        name: 'Share of Voice',
        data: withData.map((s) => {
          const idx = sortedAll.findIndex((x) => x.entityKey === s.entityKey)
          return {
            name: s.entity,
            y: s.shareOfVoicePct,
            color: getColor(s, idx),
            isHighcharts: s.isHighcharts,
            sliced: s.isHighcharts,
          }
        }),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

export default function Competitors() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
  })

  if (isError) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
      >
        {(error as Error).message}
      </div>
    )
  }

  const series = data?.competitorSeries ?? []
  const sorted = [...series].sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const hc = series.find((s) => s.isHighcharts)
  const hcRank = sorted.findIndex((s) => s.isHighcharts) + 1
  const entitiesBeaten = sorted.filter((s) => !s.isHighcharts && s.mentionRatePct < (hc?.mentionRatePct ?? 0)).length
  const leader = sorted[0]
  const gapToLeader = hc && leader && !leader.isHighcharts
    ? (leader.mentionRatePct - hc.mentionRatePct).toFixed(1)
    : null

  return (
    <div className="max-w-[980px] space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>Competitors</h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          Mention rates and share of voice across all queries
        </p>
      </div>

      {/* Highcharts summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Rank"
              value={hc ? `#${hcRank}` : '–'}
              sub={`of ${sorted.length} entities`}
              highlight
            />
            <StatCard
              label="Mention Rate"
              value={hc ? `${hc.mentionRatePct.toFixed(1)}%` : '–'}
              sub="queries mentioning Highcharts"
              highlight
            />
            <StatCard
              label="Share of Voice"
              value={hc ? `${hc.shareOfVoicePct.toFixed(1)}%` : '–'}
              sub="of all entity mentions"
              highlight
            />
            <StatCard
              label="Entities Beaten"
              value={hc ? `${entitiesBeaten}` : '–'}
              sub={gapToLeader ? `${gapToLeader}% behind ${leader?.entity}` : 'leading the field'}
              highlight
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Mention Rate" sub="% of queries each entity was mentioned in">
          {isLoading ? <Skeleton className="h-52" /> : <MentionRateChart data={series} />}
        </Card>
        <Card title="Share of Voice" sub="Proportion of all entity mentions">
          {isLoading ? <Skeleton className="h-52" /> : <ShareOfVoiceChart data={series} />}
        </Card>
      </div>

      {/* Head-to-head table */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Head-to-Head vs Highcharts
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
              {['Rank', 'Entity', 'Mention Rate', 'Share of Voice', 'Gap vs Highcharts'].map((h, i) => (
                <th
                  key={h}
                  className="px-5 py-3 text-xs font-medium"
                  style={{
                    color: '#7A8E7C',
                    textAlign: i <= 1 ? 'left' : i < 4 ? 'right' : 'left',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((s, i) => {
                  const diff = (hc?.mentionRatePct ?? 0) - s.mentionRatePct
                  const color = getColor(s, i)
                  const isHC = s.isHighcharts
                  return (
                    <tr
                      key={s.entityKey}
                      style={{
                        borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none',
                        background: isHC ? '#EEF3EE' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isHC)
                          (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = isHC ? '#EEF3EE' : 'transparent'
                      }}
                    >
                      {/* Rank */}
                      <td
                        className="px-5 py-3.5 text-xs font-semibold tabular-nums"
                        style={{ color: isHC ? HC_COLOR : '#C8C0B8' }}
                      >
                        #{i + 1}
                      </td>

                      {/* Entity */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {getEntityLogo(s.entity)
                            ? <EntityLogo entity={s.entity} size={18} />
                            : <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ background: color, boxShadow: isHC ? `0 0 0 3px #C4DCC6` : 'none' }}
                              />
                          }
                          <span
                            className="text-sm font-medium"
                            style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                          >
                            {s.entity}
                          </span>
                          {isHC && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                background: '#D4E8D5',
                                color: HC_COLOR,
                                border: `1px solid #8FBB93`,
                              }}
                            >
                              YOU
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Mention Rate */}
                      <td
                        className="px-5 py-3.5 text-right text-sm font-medium tabular-nums"
                        style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                      >
                        {s.mentionRatePct.toFixed(1)}%
                      </td>

                      {/* Share of Voice */}
                      <td
                        className="px-5 py-3.5 text-right text-sm font-medium tabular-nums"
                        style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                      >
                        {s.shareOfVoicePct > 0 ? `${s.shareOfVoicePct.toFixed(1)}%` : '–'}
                      </td>

                      {/* Gap */}
                      <td className="px-5 py-3.5">
                        {isHC ? (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        ) : diff > 0 ? (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#F0FAF0', color: '#16a34a', border: '1px solid #BBF7D0' }}
                          >
                            +{diff.toFixed(1)}% ahead
                          </span>
                        ) : diff < 0 ? (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#FEF2F2', color: '#dc2626', border: '1px solid #FECACA' }}
                          >
                            {diff.toFixed(1)}% behind
                          </span>
                        ) : (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}
                          >
                            tied
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
