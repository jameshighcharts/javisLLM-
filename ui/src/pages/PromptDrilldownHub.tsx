import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

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

function StatusBadge({ isPaused, tracked }: { isPaused: boolean; tracked: boolean }) {
  if (isPaused) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#DDD0BC' }} />
        Paused
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: '#F0F7F1', color: '#2A5C2E', border: '1px solid #C8DEC9' }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tracked ? '#22c55e' : '#C8DEC9' }} />
      {tracked ? 'Tracked' : 'Awaiting'}
    </span>
  )
}

function truncate(value: string, limit = 86) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

export default function PromptDrilldownHub() {
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  })

  const prompts = data?.promptStatus ?? []
  const tracked = prompts.filter((prompt) => prompt.status === 'tracked' && !prompt.isPaused)
  const paused = prompts.filter((prompt) => prompt.isPaused)

  const avgHighcharts =
    tracked.length > 0
      ? tracked.reduce((sum, prompt) => sum + prompt.highchartsRatePct, 0) / tracked.length
      : 0

  const avgLead =
    tracked.length > 0
      ? tracked.reduce(
          (sum, prompt) =>
            sum + (prompt.highchartsRatePct - (prompt.topCompetitor?.ratePct ?? 0)),
          0,
        ) / tracked.length
      : 0

  const term = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    const rows = prompts
      .slice()
      .sort((left, right) => {
        const leftRank = left.isPaused ? 2 : left.status === 'tracked' ? 0 : 1
        const rightRank = right.isPaused ? 2 : right.status === 'tracked' ? 0 : 1
        if (leftRank !== rightRank) return leftRank - rightRank
        if (left.runs !== right.runs) return right.runs - left.runs
        return left.query.localeCompare(right.query)
      })

    if (!term) return rows
    return rows.filter((prompt) => {
      const haystack = [
        prompt.query,
        prompt.status,
        prompt.topCompetitor?.entity ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [prompts, term])

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

  return (
    <div className="max-w-[1200px] space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
          Prompt Drilldown
        </h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          Pick a prompt, then drill into output text, mentions, and per-run scoring.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Prompts" value={String(prompts.length)} sub="Total configured" />
        <SummaryCard label="Tracked" value={String(tracked.length)} sub="Active with run data" accent="#2A5C2E" />
        <SummaryCard label="Paused" value={String(paused.length)} sub="Excluded from next run" />
        <SummaryCard
          label="Avg Lead"
          value={`${avgLead >= 0 ? '+' : ''}${avgLead.toFixed(1)}%`}
          sub={`Avg Highcharts ${avgHighcharts.toFixed(1)}%`}
          accent={avgLead >= 0 ? '#2A5C2E' : '#B45309'}
        />
      </div>

      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
          <div className="text-xs" style={{ color: '#9AAE9C' }}>
            Click any query to open detailed drilldown.
          </div>
          <div className="w-full sm:w-[360px]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompt, status, or top rival"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid #DDD0BC', background: '#FFFFFF', color: '#2A3A2C' }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Prompt</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Runs</th>
                <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Highcharts</th>
                <th className="px-4 py-3 text-right text-xs font-medium" style={{ color: '#7A8E7C' }}>Lead</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: '#7A8E7C' }}>Top rival</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid #F2EDE6' }}>
                      {Array.from({ length: 6 }).map((__, col) => (
                        <td key={col} className="px-4 py-4">
                          <div className="h-4 rounded animate-pulse" style={{ background: '#E5DDD0' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : filtered.map((prompt, index) => {
                    const lead = prompt.highchartsRatePct - (prompt.topCompetitor?.ratePct ?? 0)
                    return (
                      <tr
                        key={prompt.query}
                        style={{ borderBottom: index < filtered.length - 1 ? '1px solid #F2EDE6' : 'none' }}
                        onMouseEnter={(event) => {
                          ;(event.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                        }}
                        onMouseLeave={(event) => {
                          ;(event.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                        }}
                      >
                        <td className="px-4 py-3">
                          <Link
                            to={`/prompts/drilldown?query=${encodeURIComponent(prompt.query)}`}
                            className="inline-flex items-center gap-1.5 text-sm font-medium"
                            style={{ color: prompt.isPaused ? '#9AAE9C' : '#2A3A2C' }}
                          >
                            <span>{truncate(prompt.query)}</span>
                            <span className="text-xs" style={{ color: '#8FBB93' }} aria-hidden>
                              ↗
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge isPaused={prompt.isPaused} tracked={prompt.status === 'tracked'} />
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#2A3A2C' }}>
                          {prompt.runs}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#2A5C2E' }}>
                          {prompt.highchartsRatePct.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: lead >= 0 ? '#2A5C2E' : '#B45309' }}>
                          {lead >= 0 ? '+' : ''}{lead.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#2A3A2C' }}>
                          {prompt.topCompetitor
                            ? `${prompt.topCompetitor.entity} (${prompt.topCompetitor.ratePct.toFixed(1)}%)`
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>

        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-sm text-center" style={{ color: '#9AAE9C' }}>
            No prompts match your search.
          </div>
        )}
      </div>
    </div>
  )
}
