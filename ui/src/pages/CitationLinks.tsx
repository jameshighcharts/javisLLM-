import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../api'
import CitationSourceLeaderboard from '../components/CitationSourceLeaderboard'
import type { CitationLinksSourceStat } from '../types'

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
]

const LIMIT_OPTIONS = [
  { value: 10, label: 'Top 10' },
  { value: 25, label: 'Top 25' },
  { value: 50, label: 'Top 50' },
  { value: 500, label: 'All' },
]

function formatRunLabel(runMonth: string | null, createdAt: string | null, webSearch: boolean | null): string {
  const base = runMonth ?? (createdAt ? new Date(createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'Unknown')
  return webSearch ? `${base} · web` : base
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#9AAE9C' }}>
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: '#2A3A2C' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: '#B0A898' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function CitationLinks() {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [limit, setLimit] = useState(25)

  const query = useQuery({
    queryKey: ['citation-links', selectedRunId, selectedProviders],
    queryFn: () => api.citationLinks({ runId: selectedRunId, providers: selectedProviders }),
    staleTime: 2 * 60 * 1000,
  })

  const data = query.data

  const filteredSources = useMemo((): CitationLinksSourceStat[] => {
    return data?.sources ?? []
  }, [data])

  const avgCitationsPerCited = useMemo(() => {
    if (!data || data.responsesWithCitations === 0) return 0
    return Number((data.totalCitations / data.responsesWithCitations).toFixed(1))
  }, [data])

  function toggleProvider(value: string) {
    setSelectedProviders((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    )
    setSelectedRunId((id) => id) // keep run, trigger re-query via key
  }

  const availableRuns = data?.availableRuns ?? []
  const currentRunId = data?.runId ?? null

  return (
    <div className="max-w-[1360px] space-y-5">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
            Citation Links
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#9AAE9C' }}>
            Sources cited by LLMs across benchmark responses
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Run selector */}
        {availableRuns.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Run</span>
            <select
              className="text-xs rounded-lg px-2.5 py-1.5 border font-medium"
              style={{
                background: '#FFFFFF',
                borderColor: '#DDD0BC',
                color: '#2A3A2C',
                outline: 'none',
              }}
              value={currentRunId ?? ''}
              onChange={(e) => setSelectedRunId(e.target.value || undefined)}
            >
              {availableRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatRunLabel(run.runMonth, run.createdAt, run.webSearchEnabled)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Provider filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium mr-1" style={{ color: '#7A8E7C' }}>Provider</span>
          <button
            className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors"
            style={{
              background: selectedProviders.length === 0 ? '#2A5C2E' : '#FFFFFF',
              borderColor: selectedProviders.length === 0 ? '#2A5C2E' : '#DDD0BC',
              color: selectedProviders.length === 0 ? '#FFFFFF' : '#5A7060',
            }}
            onClick={() => setSelectedProviders([])}
          >
            All
          </button>
          {PROVIDER_OPTIONS.map((opt) => {
            const active = selectedProviders.includes(opt.value)
            return (
              <button
                key={opt.value}
                className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors"
                style={{
                  background: active ? '#2A5C2E' : '#FFFFFF',
                  borderColor: active ? '#2A5C2E' : '#DDD0BC',
                  color: active ? '#FFFFFF' : '#5A7060',
                }}
                onClick={() => toggleProvider(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* Limit selector */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Show</span>
          <div className="flex gap-1">
            {LIMIT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className="text-xs px-2.5 py-1 rounded-full border font-medium"
                style={{
                  background: limit === opt.value ? '#2A5C2E' : '#FFFFFF',
                  borderColor: limit === opt.value ? '#2A5C2E' : '#DDD0BC',
                  color: limit === opt.value ? '#FFFFFF' : '#5A7060',
                }}
                onClick={() => setLimit(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading / error */}
      {query.isLoading && (
        <div
          className="rounded-xl border p-6 text-sm text-center"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC', color: '#9AAE9C' }}
        >
          Loading citation data…
        </div>
      )}

      {query.isError && (
        <div
          className="rounded-xl border p-6 text-sm"
          style={{ background: '#FFF8F5', borderColor: '#F0D4A8', color: '#8A5A21' }}
        >
          {String(query.error instanceof Error ? query.error.message : query.error)}
        </div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Total Citations"
              value={data.totalCitations}
              sub={`across ${data.totalResponses.toLocaleString()} responses`}
            />
            <StatCard
              label="Unique Sources"
              value={data.uniqueSources}
              sub="distinct domains cited"
            />
            <StatCard
              label="Responses with Citations"
              value={data.responsesWithCitations}
              sub={
                data.totalResponses > 0
                  ? `${((data.responsesWithCitations / data.totalResponses) * 100).toFixed(0)}% of total`
                  : undefined
              }
            />
            <StatCard
              label="Avg Citations / Response"
              value={avgCitationsPerCited}
              sub="among cited responses"
            />
          </div>

          {/* Leaderboard */}
          {filteredSources.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-sm text-center"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC', color: '#9AAE9C' }}
            >
              No citation sources found for this run.
            </div>
          ) : (
            <CitationSourceLeaderboard
              items={filteredSources}
              title="Most Cited Sources"
              subtitle={`${data.runMonth ?? 'Latest run'} · ${data.uniqueSources.toLocaleString()} unique domains · ${data.totalCitations.toLocaleString()} total citations`}
              limit={limit}
            />
          )}
        </>
      )}
    </div>
  )
}
