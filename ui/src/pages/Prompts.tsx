import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { PromptStatus } from '../types'

function StatusBadge({ status }: { status: PromptStatus['status'] }) {
  const tracked = status === 'tracked'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: '#F2EDE6',
        color: tracked ? '#607860' : '#9AAE9C',
        border: '1px solid #DDD0BC',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: tracked ? '#22c55e' : '#E5DDD0' }}
      />
      {tracked ? 'Tracked' : 'Awaiting run'}
    </span>
  )
}

function MiniBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ background: '#E5DDD0', height: 4, minWidth: 64 }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: '#8FBB93' }}
        />
      </div>
      <span className="text-xs w-9 text-right flex-shrink-0 font-medium" style={{ color: '#607860' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

export default function Prompts() {
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
        {(error as Error).message}
      </div>
    )
  }

  const prompts = data?.promptStatus ?? []
  const tracked = prompts.filter((p) => p.status === 'tracked').length

  return (
    <div className="max-w-[860px] space-y-4">
      {/* Summary */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
          Prompts
        </h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          {isLoading
            ? 'Loading…'
            : `${tracked} of ${prompts.length} queries have run data`}
        </p>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
              {[
                { label: 'Query', align: 'left', w: '38%' },
                { label: 'Status', align: 'left', w: '130px' },
                { label: 'Runs', align: 'right', w: '64px' },
                { label: 'Highcharts %', align: 'left', w: '160px' },
                { label: 'Top competitor', align: 'left', w: '' },
              ].map((h) => (
                <th
                  key={h.label}
                  className="px-5 py-3 text-xs font-medium"
                  style={{
                    color: '#7A8E7C',
                    textAlign: h.align as 'left' | 'right',
                    width: h.w || undefined,
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : prompts.map((p, i) => (
                  <tr
                    key={p.query}
                    style={{
                      borderBottom: i < prompts.length - 1 ? '1px solid #F2EDE6' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                    }}
                  >
                    <td className="px-5 py-3.5 text-sm font-medium" style={{ color: '#2A3A2C' }}>
                      {p.query}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium" style={{ color: p.runs > 0 ? '#2A3A2C' : '#E5DDD0' }}>
                      {p.runs > 0 ? p.runs : '–'}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.status === 'tracked' ? (
                        <MiniBar pct={p.highchartsRatePct} />
                      ) : (
                        <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.topCompetitor ? (
                        <div>
                          <div className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
                            {p.topCompetitor.entity}
                          </div>
                          <div className="text-xs" style={{ color: '#9AAE9C' }}>
                            {p.topCompetitor.ratePct.toFixed(0)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
