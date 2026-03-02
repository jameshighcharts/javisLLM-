import { useMemo } from 'react'
import type { CitationSourceStat } from '../utils/citationSources'

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

type CitationSourceLeaderboardProps = {
  items: CitationSourceStat[]
  title?: string
  subtitle?: string
  limit?: number
  emptyText?: string
}

export default function CitationSourceLeaderboard({
  items,
  title = 'Most Cited Sources',
  subtitle,
  limit = 10,
  emptyText = 'No citation sources found yet.',
}: CitationSourceLeaderboardProps) {
  const rows = useMemo(() => items.slice(0, Math.max(1, limit)), [items, limit])

  return (
    <div
      className="rounded-xl border"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #F2EDE6' }}>
        <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
          {title}
        </div>
        {subtitle && (
          <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
            {subtitle}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-4 text-sm" style={{ color: '#9AAE9C' }}>
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold" style={{ color: '#7A8E7C' }}>
                  Source
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold" style={{ color: '#7A8E7C' }}>
                  Citations
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold" style={{ color: '#7A8E7C' }}>
                  Outputs
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold" style={{ color: '#7A8E7C' }}>
                  URLs
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => (
                <tr
                  key={item.key}
                  style={{
                    borderBottom: index < rows.length - 1 ? '1px solid #F2EDE6' : 'none',
                  }}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9AAE9C' }}>
                      #{index + 1} · {truncate(item.host, 48)}
                    </div>
                    <a
                      href={item.primaryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-semibold mt-0.5"
                      style={{ color: '#2A5C2E', textDecoration: 'none' }}
                      title={item.primaryUrl}
                    >
                      {truncate(item.title || item.primaryUrl, 78)}
                    </a>
                    <div className="text-[11px] mt-0.5" style={{ color: '#8EA890' }}>
                      {truncate(item.primaryUrl, 84)}
                    </div>
                    {item.providers.length > 0 && (
                      <div className="text-[10px] mt-1" style={{ color: '#A08F78' }}>
                        providers: {item.providers.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: '#2A3A2C' }}>
                    {item.citationCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#3D5840' }}>
                    {item.responseCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#3D5840' }}>
                    {item.uniqueUrlCount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
