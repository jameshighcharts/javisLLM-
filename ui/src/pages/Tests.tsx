import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { DiagnosticsCheck } from '../types'

function statusColors(status: DiagnosticsCheck['status']) {
  if (status === 'pass') {
    return { bg: '#ecfdf3', border: '#bbf7d0', text: '#166534', dot: '#22c55e', label: 'PASS' }
  }
  if (status === 'warn') {
    return { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#f59e0b', label: 'WARN' }
  }
  return { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', dot: '#ef4444', label: 'FAIL' }
}

function StatusBadge({ status }: { status: DiagnosticsCheck['status'] }) {
  const c = statusColors(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div
      className="rounded-xl border shadow-sm px-4 py-3"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="text-xs font-medium" style={{ color: '#7A8E7C' }}>
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight mt-0.5" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

export default function Tests() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: api.diagnostics,
    staleTime: 10_000,
  })

  const checks = data?.checks ?? []
  const passCount = checks.filter((check) => check.status === 'pass').length
  const warnCount = checks.filter((check) => check.status === 'warn').length
  const failCount = checks.filter((check) => check.status === 'fail').length

  return (
    <div className="max-w-[980px] space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
            System Tests
          </h2>
          <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
            Run production checks for Supabase tables, prompts, and benchmark data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: isFetching ? '#E8E0D2' : '#8FBB93',
            color: isFetching ? '#9AAE9C' : '#FFFFFF',
            cursor: isFetching ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isFetching) {
              ;(e.currentTarget as HTMLButtonElement).style.background = '#7AAB7E'
            }
          }}
          onMouseLeave={(e) => {
            if (!isFetching) {
              ;(e.currentTarget as HTMLButtonElement).style.background = '#8FBB93'
            }
          }}
        >
          {isFetching ? 'Running…' : 'Run Tests'}
        </button>
      </div>

      {isError && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
        >
          {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <SummaryStat label="Total Checks" value={checks.length} color="#2A3A2C" />
        <SummaryStat label="Pass" value={passCount} color="#166534" />
        <SummaryStat label="Warnings" value={warnCount} color="#92400e" />
        <SummaryStat label="Failures" value={failCount} color="#991b1b" />
      </div>

      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Results
          </div>
          <div className="text-xs" style={{ color: '#9AAE9C' }}>
            {data
              ? `Source: ${data.source} • ${new Date(data.generatedAt).toLocaleString()}`
              : isLoading
                ? 'Running initial checks...'
                : 'No test run yet'}
          </div>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-12 rounded animate-pulse"
                style={{ background: '#F2EDE6' }}
              />
            ))}
          </div>
        ) : checks.length === 0 ? (
          <div className="p-5 text-sm" style={{ color: '#7A8E7C' }}>
            No checks returned. Click Run Tests.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Check</th>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Status</th>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Details</th>
                <th className="px-5 py-3 text-xs font-medium text-right" style={{ color: '#7A8E7C' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check, index) => (
                <tr
                  key={check.id}
                  style={{
                    borderBottom: index < checks.length - 1 ? '1px solid #F2EDE6' : 'none',
                  }}
                >
                  <td className="px-5 py-3.5 text-sm font-medium" style={{ color: '#2A3A2C' }}>
                    {check.name}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={check.status} />
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: '#536654' }}>
                    {check.details}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-right" style={{ color: '#9AAE9C' }}>
                    {check.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
