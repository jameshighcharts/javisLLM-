import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { BenchmarkConfig, DashboardResponse, PromptStatus } from '../types'

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function Toggle({
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
        width: 30,
        height: 17,
        borderRadius: 9,
        border: 'none',
        padding: 0,
        background: active ? '#8FBB93' : '#DDD0BC',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.15s',
        flexShrink: 0,
        outline: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
      aria-label={active ? 'Pause prompt' : 'Resume prompt'}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: active ? 13 : 2,
          width: 13,
          height: 13,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          display: 'block',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        }}
      />
    </button>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  isPaused,
}: {
  status: PromptStatus['status']
  isPaused: boolean
}) {
  if (isPaused) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#DDD0BC' }} />
        Paused
      </span>
    )
  }
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

// ── Mini Bar ──────────────────────────────────────────────────────────────────

function MiniBar({
  pct,
  color = '#8FBB93',
  muted,
}: {
  pct: number
  color?: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ background: '#E5DDD0', height: 4, minWidth: 64 }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: muted ? '#DDD0BC' : color }}
        />
      </div>
      <span
        className="text-xs w-9 text-right flex-shrink-0 font-medium tabular-nums"
        style={{ color: muted ? '#9AAE9C' : '#607860' }}
      >
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

// ── Lead Badge ────────────────────────────────────────────────────────────────

function LeadBadge({ delta, muted }: { delta: number; muted?: boolean }) {
  const neutral = Math.abs(delta) < 1
  const positive = delta >= 1
  if (muted) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
        style={{ background: '#F2EDE6', color: '#9AAE9C' }}
      >
        –
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums"
      style={{
        background: neutral ? '#F2EDE6' : positive ? '#dcfce7' : '#fef2f2',
        color: neutral ? '#7A8E7C' : positive ? '#15803d' : '#dc2626',
      }}
    >
      {neutral ? '≈ 0%' : `${positive ? '+' : ''}${delta.toFixed(0)}%`}
    </span>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

// ── Sort Header ───────────────────────────────────────────────────────────────

type SortKey = 'query' | 'status' | 'runs' | 'highchartsRatePct' | 'viabilityRatePct' | 'lead' | 'isPaused'

function SortTh({
  label,
  col,
  current,
  dir,
  align = 'left',
  width,
  onSort,
}: {
  label: string
  col: SortKey
  current: SortKey | null
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  width?: string
  onSort: (k: SortKey) => void
}) {
  const active = current === col
  return (
    <th
      className="px-4 py-3 text-xs font-medium select-none"
      style={{
        color: active ? '#2A3A2C' : '#7A8E7C',
        textAlign: align,
        width: width ?? undefined,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span style={{ fontSize: 9, color: active ? '#8FBB93' : '#DDD0BC', fontWeight: 700 }}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⬍'}
        </span>
      </span>
    </th>
  )
}

// ── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  function add() {
    const val = input.trim()
    if (!val) return
    if (items.map((i) => i.toLowerCase()).includes(val.toLowerCase())) {
      setErr('Already in list')
      return
    }
    onChange([...items, val])
    setInput('')
    setErr(null)
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                className="flex items-center justify-center leading-none"
                style={{ color: '#9AAE9C', fontSize: '14px' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#dc2626')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#9AAE9C')}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            border: `1px solid ${err ? '#fca5a5' : focused ? '#8FBB93' : '#DDD0BC'}`,
            background: '#FFFFFF',
            color: '#2A3A2C',
            transition: 'border-color 0.1s',
          }}
          onFocus={() => { setFocused(true); setErr(null) }}
          onBlur={() => setFocused(false)}
          onChange={(e) => { setInput(e.target.value); setErr(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button
          type="button"
          onClick={add}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC', cursor: 'pointer' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#E8E0D2')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#F2EDE6')}
        >
          Add
        </button>
      </div>
      {err && <div className="text-xs" style={{ color: '#dc2626' }}>{err}</div>}
    </div>
  )
}

// ── Prompts Page ──────────────────────────────────────────────────────────────

export default function Prompts() {
  const qc = useQueryClient()

  // ── Dashboard data (grid) ─────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 60_000,
  })

  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleMutation = useMutation({
    mutationFn: ({ query, active }: { query: string; active: boolean }) =>
      api.togglePromptActive(query, active),
    onMutate: async ({ query, active }) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] })
      const prev = qc.getQueryData<DashboardResponse>(['dashboard'])
      qc.setQueryData<DashboardResponse>(['dashboard'], (old) =>
        old
          ? {
              ...old,
              promptStatus: old.promptStatus.map((p) =>
                p.query === query ? { ...p, isPaused: !active } : p,
              ),
            }
          : old,
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['dashboard'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const prompts = data?.promptStatus ?? []
  const trackedCount = prompts.filter((p) => p.status === 'tracked' && !p.isPaused).length
  const pausedCount = prompts.filter((p) => p.isPaused).length

  const sorted = useMemo(() => {
    if (!sortKey) return prompts
    return [...prompts].sort((a, b) => {
      let av: string | number | boolean
      let bv: string | number | boolean
      if (sortKey === 'lead') {
        av = a.highchartsRatePct - (a.topCompetitor?.ratePct ?? 0)
        bv = b.highchartsRatePct - (b.topCompetitor?.ratePct ?? 0)
      } else {
        av = a[sortKey] as string | number | boolean
        bv = b[sortKey] as string | number | boolean
      }
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [prompts, sortKey, sortDir])

  // ── Config data (editors) ─────────────────────────────────────────────────
  const configQuery = useQuery({ queryKey: ['config'], queryFn: api.config })

  const [queries, setQueries] = useState<string[]>([])
  const [competitors, setCompetitors] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    if (configQuery.data) {
      setQueries(configQuery.data.config.queries)
      setCompetitors(configQuery.data.config.competitors)
      setDirty(false)
    }
  }, [configQuery.data])

  const configMutation = useMutation({
    mutationFn: (cfg: BenchmarkConfig) => api.updateConfig(cfg),
    onSuccess: (updated) => {
      qc.setQueryData(['config'], updated)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setDirty(false)
      setSaveErr(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
    onError: (e) => setSaveErr((e as Error).message),
  })

  function mark(fn: () => void) {
    fn()
    setDirty(true)
    setSaveSuccess(false)
  }

  const hasHighcharts = competitors.some((c) => c.toLowerCase() === 'highcharts')
  const canSave = dirty && !configMutation.isPending && queries.length > 0 && hasHighcharts

  // ── Error state ───────────────────────────────────────────────────────────
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
    <div className="max-w-[1100px] space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
            Prompts
          </h2>
          <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
            {isLoading
              ? 'Loading…'
              : `${trackedCount} tracked · ${pausedCount} paused · ${prompts.length} total`}
          </p>
        </div>
        {pausedCount > 0 && !isLoading && (
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}
          >
            {pausedCount} paused — excluded from next run
          </span>
        )}
      </div>

      {/* ── Prompts data grid ──────────────────────────────────────────────── */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div
          className="px-4 py-2.5 text-xs"
          style={{ color: '#9AAE9C', background: '#FDFCF8', borderBottom: '1px solid #F2EDE6' }}
        >
          Click a query to open its drilldown dashboard.
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
              <th className="px-4 py-3" style={{ width: 48 }} />
              <SortTh label="Query" col="query" current={sortKey} dir={sortDir} onSort={handleSort} />
              <SortTh label="Status" col="status" current={sortKey} dir={sortDir} onSort={handleSort} width="130px" />
              <SortTh label="Runs" col="runs" current={sortKey} dir={sortDir} align="right" onSort={handleSort} width="60px" />
              <SortTh label="Highcharts %" col="highchartsRatePct" current={sortKey} dir={sortDir} onSort={handleSort} width="148px" />
              <SortTh label="Viability %" col="viabilityRatePct" current={sortKey} dir={sortDir} onSort={handleSort} width="148px" />
              <SortTh label="Lead" col="lead" current={sortKey} dir={sortDir} onSort={handleSort} width="80px" />
              <th className="px-4 py-3 text-xs font-medium" style={{ color: '#7A8E7C', textAlign: 'left' }}>
                Top rival
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((p, i) => {
                  const paused = p.isPaused
                  const delta = p.highchartsRatePct - (p.topCompetitor?.ratePct ?? 0)
                  const isPending =
                    toggleMutation.isPending && toggleMutation.variables?.query === p.query

                  return (
                    <tr
                      key={p.query}
                      style={{
                        borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none',
                        background: paused ? '#FDFCF8' : 'transparent',
                        opacity: paused ? 0.65 : 1,
                        transition: 'opacity 0.15s, background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!paused) (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = paused ? '#FDFCF8' : 'transparent'
                      }}
                    >
                      <td className="px-4 py-3">
                        <Toggle
                          active={!paused}
                          onChange={(v) => toggleMutation.mutate({ query: p.query, active: v })}
                          disabled={isPending}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        <Link
                          to={`/prompts/drilldown?query=${encodeURIComponent(p.query)}`}
                          className="inline-flex items-center gap-1.5"
                          style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}
                        >
                          <span>{p.query}</span>
                          <span
                            className="text-xs"
                            style={{ color: paused ? '#C8D0C8' : '#8FBB93' }}
                            aria-hidden
                          >
                            ↗
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} isPaused={paused} />
                      </td>
                      <td
                        className="px-4 py-3 text-right text-sm font-medium tabular-nums"
                        style={{ color: p.runs > 0 && !paused ? '#2A3A2C' : '#E5DDD0' }}
                      >
                        {p.runs > 0 ? p.runs : '–'}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === 'tracked' ? (
                          <MiniBar pct={p.highchartsRatePct} muted={paused} />
                        ) : (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === 'tracked' ? (
                          <MiniBar pct={p.viabilityRatePct} color="#C8A87A" muted={paused} />
                        ) : (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === 'tracked' ? (
                          <LeadBadge delta={delta} muted={paused} />
                        ) : (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.topCompetitor ? (
                          <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>
                              {p.topCompetitor.entity}
                            </div>
                            <MiniBar pct={p.topCompetitor.ratePct} color="#C8A87A" muted={paused} />
                          </div>
                        ) : (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {/* ── Section divider ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pt-1">
        <div className="flex-1 h-px" style={{ background: '#DDD0BC' }} />
        <span className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: '#9AAE9C' }}>
          Manage Queries &amp; Competitors
        </span>
        <div className="flex-1 h-px" style={{ background: '#DDD0BC' }} />
      </div>

      {/* ── Config editors ─────────────────────────────────────────────────── */}
      {configQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border p-6" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
              <div className="h-4 w-28 rounded animate-pulse mb-5" style={{ background: '#D4BB96' }} />
              <div className="h-24 rounded animate-pulse" style={{ background: '#F2EDE6' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {/* Queries */}
            <div
              className="rounded-xl border shadow-sm"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
            >
              <div className="flex items-center justify-between p-5 pb-0">
                <div>
                  <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
                    Queries
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#7A8E7C' }}>
                    Prompts sent to LLMs during benchmarks
                  </div>
                </div>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: '#F2EDE6', color: '#7A8E7C', border: '1px solid #DDD0BC' }}
                >
                  {queries.length}
                </span>
              </div>
              <div className="p-5 pt-4">
                <TagInput
                  items={queries}
                  onChange={(v) => mark(() => setQueries(v))}
                  placeholder="e.g. javascript charting libraries"
                />
              </div>
            </div>

            {/* Competitors */}
            <div
              className="rounded-xl border shadow-sm"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
            >
              <div className="flex items-center justify-between p-5 pb-0">
                <div>
                  <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
                    Competitors
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#7A8E7C' }}>
                    Entities detected in LLM responses
                  </div>
                </div>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: '#F2EDE6', color: '#7A8E7C', border: '1px solid #DDD0BC' }}
                >
                  {competitors.length}
                </span>
              </div>
              <div className="p-5 pt-4">
                <TagInput
                  items={competitors}
                  onChange={(v) => mark(() => setCompetitors(v))}
                  placeholder="e.g. chart.js"
                />
                {!hasHighcharts && competitors.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-medium" style={{ color: '#dc2626' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    "Highcharts" must be included
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Save row */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                configMutation.mutate({
                  queries,
                  competitors,
                  aliases: configQuery.data?.config.aliases ?? {},
                })
              }
              disabled={!canSave}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: canSave ? '#8FBB93' : '#E8E0D2',
                color: canSave ? '#FFFFFF' : '#9AAE9C',
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
              onMouseEnter={(e) => {
                if (canSave) (e.currentTarget as HTMLButtonElement).style.background = '#7AAB7E'
              }}
              onMouseLeave={(e) => {
                if (canSave) (e.currentTarget as HTMLButtonElement).style.background = '#8FBB93'
              }}
            >
              {configMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>

            {configQuery.data?.meta.updatedAt && !dirty && (
              <span className="text-xs" style={{ color: '#9AAE9C' }}>
                Last saved{' '}
                {new Date(configQuery.data.meta.updatedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            )}

            {saveSuccess && (
              <span className="text-sm flex items-center gap-1.5 font-medium" style={{ color: '#16a34a' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </span>
            )}

            {saveErr && (
              <span className="text-sm" style={{ color: '#dc2626' }}>{saveErr}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
