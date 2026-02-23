import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { api } from '../api'
import type { CompetitorSeries } from '../types'

const CHART_PALETTE = ['#8FBB93', '#DDD0BC', '#D4836A', '#9B8CB5', '#D4C05A', '#9AAE9C', '#C4836A', '#6A8E6E']

function getColor(s: CompetitorSeries, i: number) {
  if (s.isHighcharts) return '#8FBB93'
  return CHART_PALETTE[(i - 1 + CHART_PALETTE.length) % CHART_PALETTE.length]
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
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
      height: Math.max(200, sorted.length * 36 + 30),
      backgroundColor: 'transparent',
      margin: [4, 72, 8, 4],
    },
    xAxis: {
      categories: sorted.map((s) => s.entity),
      lineWidth: 0,
      tickWidth: 0,
      labels: { style: { color: '#607860', fontSize: '12px', fontWeight: '500' } },
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
            fontSize: '12px',
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
        data: sorted.map((s, i) => ({
          y: s.mentionRatePct,
          color: getColor(s, i),
          name: s.entity,
        })),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function ShareOfVoiceChart({ data }: { data: CompetitorSeries[] }) {
  const withData = data.filter((s) => s.shareOfVoicePct > 0)

  if (withData.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-48 text-sm"
        style={{ color: '#9AAE9C' }}
      >
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
          style: {
            fontSize: '11px',
            color: '#607860',
            textOutline: 'none',
            fontWeight: '500',
          },
          connectorColor: '#DDD0BC',
          formatter: function () {
            return `${this.point.name}: <b>${(this.y ?? 0).toFixed(1)}%</b>`
          },
        },
      },
    },
    series: [
      {
        type: 'pie',
        name: 'Share of Voice',
        data: withData.map((s, i) => ({
          name: s.entity,
          y: s.shareOfVoicePct,
          color: getColor(s, i),
        })),
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

  return (
    <div className="max-w-[980px] space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>Competitors</h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          Mention rates and share of voice across all queries
        </p>
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
              {['Entity', 'Mention Rate', 'Share of Voice', 'Gap vs Highcharts'].map((h, i) => (
                <th
                  key={h}
                  className="px-5 py-3 text-xs font-medium"
                  style={{
                    color: '#7A8E7C',
                    textAlign: i === 0 ? 'left' : i < 3 ? 'right' : 'left',
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
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((s, i) => {
                  const diff = (hc?.mentionRatePct ?? 0) - s.mentionRatePct
                  const color = getColor(s, i)
                  return (
                    <tr
                      key={s.entityKey}
                      style={{ borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none' }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                      }}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                          <span className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
                            {s.entity}
                          </span>
                          {s.isHighcharts && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{ background: '#F2EDE6', color: '#607860', border: '1px solid #DDD0BC' }}
                            >
                              YOU
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-medium" style={{ color: '#2A3A2C' }}>
                        {s.mentionRatePct.toFixed(1)}%
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-medium" style={{ color: '#2A3A2C' }}>
                        {s.shareOfVoicePct > 0 ? `${s.shareOfVoicePct.toFixed(1)}%` : '–'}
                      </td>
                      <td className="px-5 py-3.5">
                        {s.isHighcharts ? (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        ) : diff > 0 ? (
                          <span className="text-xs font-semibold" style={{ color: '#16a34a' }}>
                            +{diff.toFixed(1)}% ahead
                          </span>
                        ) : diff < 0 ? (
                          <span className="text-xs font-semibold" style={{ color: '#dc2626' }}>
                            {diff.toFixed(1)}% behind
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: '#94a3b8' }}>tied</span>
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
