import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { BenchmarkWorkflowRun } from '../types'

const MANAGED_TRIGGER_TOKEN = String(
  (import.meta.env.VITE_BENCHMARK_TRIGGER_TOKEN as string | undefined) ?? '',
).trim()

function runStatusBadge(run: BenchmarkWorkflowRun) {
  if (run.status === 'completed' && run.conclusion === 'success') {
    return { label: 'Succeeded', bg: '#ecfdf3', border: '#bbf7d0', text: '#166534' }
  }
  if (run.status === 'completed' && run.conclusion === 'failure') {
    return { label: 'Failed', bg: '#fef2f2', border: '#fecaca', text: '#991b1b' }
  }
  if (run.status === 'completed' && run.conclusion === 'cancelled') {
    return { label: 'Cancelled', bg: '#f8fafc', border: '#e2e8f0', text: '#475569' }
  }
  return { label: 'Running', bg: '#fffbeb', border: '#fde68a', text: '#92400e' }
}

function formatRunDate(value: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// ── Web Search Toggle ─────────────────────────────────────────────────────────

function WebSearchToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
      style={{
        background: checked ? '#F0F7F1' : '#F2EDE6',
        border: `1.5px solid ${checked ? '#C8DEC9' : '#DDD0BC'}`,
        color: checked ? '#2A5C2E' : '#7A8E7C',
      }}
    >
      {/* pill toggle */}
      <span
        className="relative flex-shrink-0"
        style={{ width: 28, height: 16, borderRadius: 8, background: checked ? '#8FBB93' : '#DDD0BC', transition: 'background 0.15s', display: 'inline-block' }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 12 : 2,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        />
      </span>
      Web search
    </button>
  )
}

// ── Runs Page ─────────────────────────────────────────────────────────────────

export default function Runs() {
  const queryClient = useQueryClient()

  const [ourTerms, setOurTerms] = useState('Highcharts')
  const [model, setModel] = useState('gpt-4o-mini')
  const [runs, setRuns] = useState(3)
  const [temperature, setTemperature] = useState(0.7)
  const [webSearch, setWebSearch] = useState(true)
  const [runMonth, setRunMonth] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const hasManagedRunAccess = Boolean(MANAGED_TRIGGER_TOKEN)

  const runsQuery = useQuery({
    queryKey: ['benchmark-runs', hasManagedRunAccess],
    queryFn: () => api.benchmarkRuns(MANAGED_TRIGGER_TOKEN || undefined),
    enabled: hasManagedRunAccess,
    refetchInterval: hasManagedRunAccess ? 15_000 : false,
    retry: false,
  })

  const triggerMutation = useMutation({
    mutationFn: () =>
      api.triggerBenchmark(
        { model, runs, temperature, webSearch, ourTerms, runMonth: runMonth || undefined },
        MANAGED_TRIGGER_TOKEN || undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benchmark-runs'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const activeRun = useMemo(
    () => runsQuery.data?.runs.find((run) => run.status !== 'completed') ?? null,
    [runsQuery.data?.runs],
  )

  const canRun =
    !triggerMutation.isPending &&
    hasManagedRunAccess &&
    Boolean(model.trim()) &&
    Boolean(ourTerms.trim())

  const runsErrorMessage = useMemo(() => {
    if (!runsQuery.isError) return ''
    const message = (runsQuery.error as Error).message || 'Unable to load runs.'
    if (message === 'Unauthorized trigger token.') {
      return 'Run service is not authorized. Ask an admin to verify environment configuration.'
    }
    if (message === 'Internal server error.') {
      return 'Server is not ready to list runs. Ask an admin to verify benchmark API env vars.'
    }
    return message
  }, [runsQuery.isError, runsQuery.error])

  const inputStyle = {
    border: '1px solid #DDD0BC',
    background: '#FFFFFF',
    color: '#2A3A2C',
    outline: 'none',
  }

  return (
    <div className="max-w-[1100px] space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
          Run Benchmarks
        </h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          Launch prompts + scoring pipeline. Results sync to Supabase and show up in Dashboard.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Trigger card */}
        <div
          className="rounded-xl border shadow-sm col-span-2"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
              Trigger New Run
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Primary controls row */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => triggerMutation.mutate()}
                disabled={!canRun}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  background: canRun ? '#8FBB93' : '#E8E0D2',
                  color: canRun ? '#FFFFFF' : '#9AAE9C',
                  cursor: canRun ? 'pointer' : 'not-allowed',
                }}
              >
                {triggerMutation.isPending ? 'Queueing…' : 'Run Benchmark'}
              </button>

              <button
                type="button"
                onClick={() => runsQuery.refetch()}
                disabled={!hasManagedRunAccess}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  border: '1px solid #DDD0BC',
                  color: hasManagedRunAccess ? '#2A3A2C' : '#9AAE9C',
                  background: '#FFFFFF',
                  cursor: hasManagedRunAccess ? 'pointer' : 'not-allowed',
                }}
              >
                Refresh Runs
              </button>

              <WebSearchToggle checked={webSearch} onChange={setWebSearch} />

              {/* Spacer */}
              <div className="flex-1" />

              {/* Advanced settings toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: showAdvanced ? '#F2EDE6' : 'transparent',
                  border: `1px solid ${showAdvanced ? '#DDD0BC' : '#E8E0D2'}`,
                  color: showAdvanced ? '#2A3A2C' : '#9AAE9C',
                  cursor: 'pointer',
                }}
              >
                Advanced settings
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  style={{ transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(180deg)' : 'none' }}
                >
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Advanced settings panel */}
            <div
              style={{
                overflow: 'hidden',
                maxHeight: showAdvanced ? 400 : 0,
                opacity: showAdvanced ? 1 : 0,
                transition: 'max-height 0.25s ease, opacity 0.2s ease',
              }}
            >
              <div
                className="rounded-xl p-4 space-y-3"
                style={{ background: '#FDFCF8', border: '1px solid #EDE8E0' }}
              >
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9AAE9C' }}>
                  Advanced settings
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Brand terms</span>
                    <input
                      value={ourTerms}
                      onChange={(e) => setOurTerms(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={inputStyle}
                      placeholder="Highcharts"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Model</span>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={inputStyle}
                      placeholder="gpt-4o-mini"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Runs per prompt</span>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={runs}
                      onChange={(e) => setRuns(Math.max(1, Math.min(3, Number(e.target.value) || 1)))}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={inputStyle}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Temperature</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={temperature}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setTemperature(Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.7)
                      }}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={inputStyle}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium" style={{ color: '#7A8E7C' }}>Run month (optional)</span>
                    <input
                      type="month"
                      value={runMonth}
                      onChange={(e) => setRunMonth(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={inputStyle}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Feedback messages */}
            {triggerMutation.isSuccess && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: '#ecfdf3', border: '1px solid #bbf7d0', color: '#166534' }}
              >
                {triggerMutation.data.message}
              </div>
            )}
            {triggerMutation.isError && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}
              >
                {(triggerMutation.error as Error).message}
              </div>
            )}
            {!hasManagedRunAccess && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: '#075985' }}
              >
                Run controls are unavailable. Ask an admin to configure benchmark access.
              </div>
            )}
          </div>
        </div>

        {/* Status card */}
        <div
          className="rounded-xl border shadow-sm"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
        >
          <div className="px-4 py-4" style={{ borderBottom: '1px solid #F2EDE6' }}>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
              Current Status
            </div>
          </div>
          <div className="p-4 space-y-2 text-sm">
            {!hasManagedRunAccess ? (
              <div
                className="rounded-lg px-3 py-2"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
              >
                Run status is unavailable until benchmark access is configured.
              </div>
            ) : (
              <>
                {activeRun ? (
                  <div
                    className="rounded-lg px-3 py-2"
                    style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
                  >
                    Run #{activeRun.runNumber} is in progress.
                  </div>
                ) : (
                  <div
                    className="rounded-lg px-3 py-2"
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                  >
                    No active run.
                  </div>
                )}
              </>
            )}
            {runsQuery.isError && (
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}
              >
                {runsErrorMessage}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent runs table */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid #F2EDE6' }}
        >
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Recent Workflow Runs
          </div>
          <div className="text-xs" style={{ color: '#9AAE9C' }}>
            {hasManagedRunAccess ? 'Auto-refresh every 15s' : 'Run access is not configured'}
          </div>
        </div>

        {!hasManagedRunAccess ? (
          <div className="p-5 text-sm" style={{ color: '#7A8E7C' }}>
            Recent runs are unavailable until benchmark access is configured.
          </div>
        ) : runsQuery.isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-11 rounded animate-pulse" style={{ background: '#F2EDE6' }} />
            ))}
          </div>
        ) : (runsQuery.data?.runs ?? []).length === 0 ? (
          <div className="p-5 text-sm" style={{ color: '#7A8E7C' }}>
            No runs found yet.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Run</th>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Status</th>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Started</th>
                <th className="px-5 py-3 text-xs font-medium text-left" style={{ color: '#7A8E7C' }}>Updated</th>
                <th className="px-5 py-3 text-xs font-medium text-right" style={{ color: '#7A8E7C' }}>Logs</th>
              </tr>
            </thead>
            <tbody>
              {(runsQuery.data?.runs ?? []).map((run, i, all) => {
                const badge = runStatusBadge(run)
                return (
                  <tr
                    key={run.id}
                    style={{ borderBottom: i < all.length - 1 ? '1px solid #F2EDE6' : 'none' }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium" style={{ color: '#2A3A2C' }}>
                        #{run.runNumber}
                      </div>
                      <div className="text-xs" style={{ color: '#9AAE9C' }}>
                        {run.title}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.text }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: '#536654' }}>
                      {formatRunDate(run.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: '#536654' }}>
                      {formatRunDate(run.updatedAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <a
                        href={run.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium underline"
                        style={{ color: '#3D5C40' }}
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
