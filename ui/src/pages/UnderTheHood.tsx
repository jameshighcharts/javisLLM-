import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

function formatDurationMs(value: number): string {
  const safe = Math.max(0, Math.round(value))
  if (safe < 1000) {
    return `${safe} ms`
  }
  return `${(safe / 1000).toFixed(2)} s`
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'n/a'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'n/a'
  return parsed.toLocaleString()
}

function StatCard({
  label,
  value,
  help,
}: {
  label: string
  value: string
  help?: string
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#9AAE9C' }}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: '#2A3A2C' }}>
        {value}
      </div>
      {help && (
        <div className="mt-1 text-xs" style={{ color: '#8FA191' }}>
          {help}
        </div>
      )}
    </div>
  )
}

export default function UnderTheHood() {
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

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 rounded animate-pulse" style={{ background: '#E5DDD0' }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-24 rounded-xl animate-pulse" style={{ background: '#F2EDE6' }} />
          ))}
        </div>
        <div className="h-80 rounded-xl animate-pulse" style={{ background: '#F2EDE6' }} />
      </div>
    )
  }

  const { summary } = dashboard.data
  const stats = [...summary.modelStats].sort((left, right) => {
    if (right.responseCount !== left.responseCount) {
      return right.responseCount - left.responseCount
    }
    return left.model.localeCompare(right.model)
  })

  return (
    <div className="max-w-[1280px] space-y-4">
      <div className="rounded-xl border px-5 py-4" style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
          Under the Hood
        </h2>
        <p className="mt-1 text-sm" style={{ color: '#6E8370' }}>
          Model-level runtime and token metrics for the latest benchmark snapshot.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: '#8A9A8C' }}>
          <span>Run month: {summary.runMonth ?? 'n/a'}</span>
          <span>Web search: {String(summary.webSearchEnabled ?? 'n/a')}</span>
          <span>Window start: {formatTimestamp(summary.windowStartUtc)}</span>
          <span>Window end: {formatTimestamp(summary.windowEndUtc)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Models Tested" value={summary.models.length.toLocaleString()} />
        <StatCard label="Total Responses" value={summary.totalResponses.toLocaleString()} />
        <StatCard
          label="Total Duration"
          value={formatDurationMs(summary.durationTotals.totalDurationMs)}
          help="Across all model responses"
        />
        <StatCard
          label="Avg Duration / Response"
          value={formatDurationMs(summary.durationTotals.avgDurationMs)}
        />
        <StatCard
          label="Input Tokens"
          value={summary.tokenTotals.inputTokens.toLocaleString()}
        />
        <StatCard
          label="Output Tokens"
          value={summary.tokenTotals.outputTokens.toLocaleString()}
        />
        <StatCard
          label="Total Tokens"
          value={summary.tokenTotals.totalTokens.toLocaleString()}
        />
        <StatCard label="Model Owners" value={summary.modelOwners.length.toLocaleString()} />
      </div>

      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Per-model stats
          </div>
          <div className="text-xs mt-1" style={{ color: '#8FA191' }}>
            Duration and token breakdown by model run.
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="p-5 text-sm" style={{ color: '#7A8E7C' }}>
            No model stats available yet. Trigger a run to populate this page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead>
                <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
                  <th className="px-4 py-3 text-xs text-left font-medium" style={{ color: '#7A8E7C' }}>Model</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Responses</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Success</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Fail</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Web search</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Total duration</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Avg duration</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>P95 duration</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Input tokens</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Output tokens</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Total tokens</th>
                  <th className="px-4 py-3 text-xs text-right font-medium" style={{ color: '#7A8E7C' }}>Avg tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((item, index) => (
                  <tr
                    key={item.model}
                    style={{ borderBottom: index < stats.length - 1 ? '1px solid #F2EDE6' : 'none' }}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold" style={{ color: '#2A3A2C' }}>
                        {item.model}
                      </div>
                      <div className="text-xs" style={{ color: '#8FA191' }}>
                        {item.owner}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.responseCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#166534' }}>
                      {item.successCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#B45309' }}>
                      {item.failureCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.webSearchEnabledCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {formatDurationMs(item.totalDurationMs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {formatDurationMs(item.avgDurationMs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {formatDurationMs(item.p95DurationMs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.totalInputTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.totalOutputTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.totalTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: '#3D5840' }}>
                      {item.avgTotalTokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
