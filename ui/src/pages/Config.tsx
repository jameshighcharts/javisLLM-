import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BenchmarkConfig } from '../types'

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
                className="flex items-center justify-center leading-none transition-colors"
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
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
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

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string
  description: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex flex-col space-y-1.5 p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            {title}
          </div>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: '#F2EDE6', color: '#7A8E7C', border: '1px solid #DDD0BC' }}
          >
            {count}
          </span>
        </div>
        <div className="text-sm" style={{ color: '#7A8E7C' }}>
          {description}
        </div>
      </div>
      <div className="p-6 pt-0">
        {children}
      </div>
    </div>
  )
}

export default function Config() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: api.config })

  const [queries, setQueries] = useState<string[]>([])
  const [competitors, setCompetitors] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [success, setSuccess] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    if (data) {
      setQueries(data.config.queries)
      setCompetitors(data.config.competitors)
      setDirty(false)
    }
  }, [data])

  const mutation = useMutation({
    mutationFn: (cfg: BenchmarkConfig) => api.updateConfig(cfg),
    onSuccess: (updated) => {
      qc.setQueryData(['config'], updated)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setDirty(false)
      setSaveErr(null)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    },
    onError: (e) => setSaveErr((e as Error).message),
  })

  function mark(fn: () => void) {
    fn()
    setDirty(true)
    setSuccess(false)
  }

  const hasHighcharts = competitors.some((c) => c.toLowerCase() === 'highcharts')
  const canSave = dirty && !mutation.isPending && queries.length > 0 && hasHighcharts

  if (isLoading) {
    return (
      <div className="max-w-[640px] space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border p-6" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
            <div className="h-4 w-28 rounded animate-pulse mb-5" style={{ background: '#D4BB96' }} />
            <div className="h-24 rounded animate-pulse" style={{ background: '#F2EDE6' }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-[640px] space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>Configuration</h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          {data?.meta.updatedAt
            ? `Last saved ${new Date(data.meta.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
            : 'Manage queries and competitors'}
        </p>
      </div>

      <Section
        title="Queries"
        description="Prompts sent to the LLM during benchmarks. Press Enter or click Add."
        count={queries.length}
      >
        <TagInput
          items={queries}
          onChange={(v) => mark(() => setQueries(v))}
          placeholder="e.g. javascript charting libraries"
        />
      </Section>

      <Section
        title="Competitors"
        description='Entities to detect in LLM responses. Must include "Highcharts".'
        count={competitors.length}
      >
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
            "Highcharts" must be included in the list
          </div>
        )}
      </Section>

      {/* Save row */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => mutation.mutate({ queries, competitors, aliases: data?.config.aliases ?? {} })}
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
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>

        {success && (
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
    </div>
  )
}
