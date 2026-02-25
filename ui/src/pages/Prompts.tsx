import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type {
  BenchmarkConfig,
  BenchmarkWorkflowRun,
  DashboardResponse,
  PromptStatus,
} from '../types'

const TRIGGER_TOKEN_STORAGE_KEY = 'benchmark_trigger_token'

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function readStoredTriggerToken(): string {
  if (!canUseSessionStorage()) {
    return ''
  }
  return window.sessionStorage.getItem(TRIGGER_TOKEN_STORAGE_KEY)?.trim() ?? ''
}

function writeStoredTriggerToken(nextToken: string): void {
  if (!canUseSessionStorage()) {
    return
  }
  const normalized = nextToken.trim()
  if (!normalized) {
    window.sessionStorage.removeItem(TRIGGER_TOKEN_STORAGE_KEY)
    return
  }
  window.sessionStorage.setItem(TRIGGER_TOKEN_STORAGE_KEY, normalized)
}

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
  if (status === 'deleted') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#EF4444' }} />
        Deleted
      </span>
    )
  }

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

// ── Brand logos ──────────────────────────────────────────────────────────────

const ENTITY_LOGOS: Record<string, string> = {
  'chart.js':   '/chartjs.png',
  'chartjs':    '/chartjs.png',
  'd3.js':      '/d3.png',
  'd3':         '/d3.png',
  'highcharts': '/highcharts%20(1).svg',
  'echarts':    '/echarts.png',
  'ag grid':    '/aggrid.png',
  'aggrid':     '/aggrid.png',
  'ag chart':   '/aggrid.png',
  'amcharts':   '/amcharts.png',
  'recharts':   '/react-svgrepo-com.svg',
}

interface LogoCrop { x: number; y: number; w: number; h: number; srcW: number; srcH: number; displayH: number }
const LOGO_CROP: Record<string, LogoCrop> = {
  '/aggrid.png':   { x: 16, y: 116, w: 374, h: 118, srcW: 400, srcH: 400, displayH: 13 },
  '/amcharts.png': { x: 100, y: 100, w: 799, h: 353, srcW: 1000, srcH: 558, displayH: 13 },
}

function getEntityLogo(entity: string): string | null {
  return ENTITY_LOGOS[entity.toLowerCase()] ?? null
}

function EntityLogo({ entity, size = 16 }: { entity: string; size?: number }) {
  const src = getEntityLogo(entity)
  if (!src) return null
  const crop = LOGO_CROP[src]
  if (crop) {
    const scale = crop.displayH / crop.h
    const displayW = Math.round(crop.w * scale)
    const imgW = Math.round(crop.srcW * scale)
    const imgH = Math.round(crop.srcH * scale)
    const offX = Math.round(crop.x * scale)
    const offY = Math.round(crop.y * scale)
    return (
      <div style={{ width: displayW, height: crop.displayH, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <img src={src} alt={entity}
          style={{ position: 'absolute', width: imgW, height: imgH, top: -offY, left: -offX, objectFit: 'fill' }} />
      </div>
    )
  }
  return (
    <div style={{ width: size, height: size, overflow: 'hidden', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0 }} alt={entity} />
    </div>
  )
}

function inferPromptTags(query: string): string[] {
  const normalized = query.toLowerCase()
  const tags: string[] = []

  if (normalized.includes('react')) {
    tags.push('react')
  }
  if (normalized.includes('javascript') || /\bjs\b/.test(normalized)) {
    tags.push('javascript')
  }
  if (tags.length === 0) {
    tags.push('general')
  }

  return tags
}

// ── Tag color system ─────────────────────────────────────────────────────────

const TAG_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  react:         { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  javascript:    { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  js:            { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  general:       { bg: '#F2EDE6', color: '#7A8E7C', border: '#DDD0BC' },
  grid:          { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' },
  data:          { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
  accessibility: { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  python:        { bg: '#EEF2FF', color: '#4338CA', border: '#C7D2FE' },
}

const _TAG_FALLBACKS = [
  { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD' },
  { bg: '#FDF4FF', color: '#7E22CE', border: '#E9D5FF' },
  { bg: '#F0FDFA', color: '#0F766E', border: '#99F6E4' },
  { bg: '#FFF1F2', color: '#BE123C', border: '#FECDD3' },
]

function getTagStyle(tag: string, muted?: boolean) {
  if (muted) return { bg: '#F2EDE6', color: '#9AAE9C', border: '#DDD0BC' }
  const key = tag.toLowerCase()
  if (TAG_STYLES[key]) return TAG_STYLES[key]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return _TAG_FALLBACKS[h % _TAG_FALLBACKS.length]
}

function normalizePromptTags(tags: string[], query: string): string[] {
  const normalized = [...new Set(
    tags
      .map((tag) => {
        const normalizedTag = tag.trim().toLowerCase()
        return normalizedTag === 'generic' ? 'general' : normalizedTag
      })
      .filter(Boolean),
  )]
  return normalized.length > 0 ? normalized : inferPromptTags(query)
}

function normalizeQueryTagsMap(
  queries: string[],
  rawQueryTags?: Record<string, string[]>,
): Record<string, string[]> {
  const lookup = new Map<string, string[]>()
  for (const [query, tags] of Object.entries(rawQueryTags ?? {})) {
    lookup.set(query.trim().toLowerCase(), tags)
  }

  return Object.fromEntries(
    queries.map((query) => [
      query,
      normalizePromptTags(lookup.get(query.trim().toLowerCase()) ?? [], query),
    ]),
  )
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase()
}

function PromptTagChips({
  tags,
  muted,
}: {
  tags: string[]
  muted?: boolean
}) {
  if (tags.length === 0) {
    return <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => {
        const s = getTagStyle(tag, muted)
        return (
          <span
            key={tag}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
          >
            {tag}
          </span>
        )
      })}
    </div>
  )
}

// ── Inline Query Tag Row ───────────────────────────────────────────────────────

function QueryTagRow({
  query,
  tags,
  onChange,
}: {
  query: string
  tags: string[]
  onChange: (nextTags: string[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag() {
    const val = input.trim().toLowerCase()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
    if (e.key === 'Escape') { setInput(''); setEditing(false) }
  }

  return (
    <div
      className="flex flex-col items-start gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
      style={{ borderBottom: '1px solid #F2EDE6' }}
    >
      <span
        className="text-xs font-medium flex-shrink-0 truncate w-full sm:w-[200px]"
        style={{ color: '#3D5840' }}
        title={query}
      >
        {query}
      </span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
        {tags.map((tag) => {
          const s = getTagStyle(tag)
          return (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="leading-none"
                style={{ color: s.color, fontSize: 13, opacity: 0.5 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.color = '#dc2626' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; (e.currentTarget as HTMLButtonElement).style.color = s.color }}
              >
                ×
              </button>
            </span>
          )
        })}
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={addTag}
            placeholder="add tag…"
            className="text-[11px] px-2 py-0.5 rounded-full outline-none"
            style={{
              border: '1px solid #8FBB93',
              background: '#FFFFFF',
              color: '#2A3A2C',
              width: 76,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }}
            className="inline-flex w-6 h-6 sm:w-[18px] sm:h-[18px] items-center justify-center rounded-full font-bold leading-none"
            style={{
              background: '#F2EDE6',
              color: '#8FBB93',
              border: '1px solid #DDD0BC',
              fontSize: 14,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#E8E0D2')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#F2EDE6')}
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sort Header ───────────────────────────────────────────────────────────────

type SortKey =
  | 'query'
  | 'tags'
  | 'status'
  | 'runs'
  | 'highchartsRatePct'
  | 'highchartsRank'
  | 'viabilityRatePct'
  | 'lead'
  | 'isPaused'

function HeaderInfoBadge({
  text,
  align = 'left',
}: {
  text: string
  align?: 'left' | 'right'
}) {
  return (
    <span className="relative inline-flex items-center group" style={{ verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center justify-center rounded-full text-[9px] font-bold leading-none ml-1"
        style={{
          width: 14,
          height: 14,
          background: '#DDD0BC',
          color: '#7A8E7C',
          cursor: 'pointer',
          border: 'none',
          flexShrink: 0,
        }}
        aria-label="Column info"
      >
        i
      </button>
      <div
        className="pointer-events-none absolute z-50 rounded-lg shadow-xl border text-xs leading-relaxed p-3 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-150"
        style={{
          top: 'calc(100% + 6px)',
          width: 230,
          maxWidth: 'min(230px, calc(100vw - 32px))',
          background: '#FFFFFF',
          borderColor: '#DDD0BC',
          color: '#2A3A2C',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          whiteSpace: 'normal',
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
        }}
      >
        {text}
      </div>
    </span>
  )
}

function SortTh({
  label,
  col,
  current,
  dir,
  align = 'left',
  width,
  info,
  infoAlign,
  onSort,
}: {
  label: string
  col: SortKey
  current: SortKey | null
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  width?: string
  info?: string
  infoAlign?: 'left' | 'right'
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
        {info && <HeaderInfoBadge text={info} align={infoAlign ?? (align === 'right' ? 'right' : 'left')} />}
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
  showLogos,
  maxVisibleItems,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  showLogos?: boolean
  maxVisibleItems?: number
}) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [showAllItems, setShowAllItems] = useState(false)

  const hasOverflow =
    typeof maxVisibleItems === 'number' &&
    maxVisibleItems > 0 &&
    items.length > maxVisibleItems

  const visibleItems =
    hasOverflow && !showAllItems ? items.slice(0, maxVisibleItems) : items

  useEffect(() => {
    if (!hasOverflow && showAllItems) {
      setShowAllItems(false)
    }
  }, [hasOverflow, showAllItems])

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
          {visibleItems.map((item) => {
            const logo = showLogos ? getEntityLogo(item) : null
            return (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium"
                style={{
                  background: '#F2EDE6',
                  color: '#3D5840',
                  border: '1px solid #DDD0BC',
                  paddingLeft: logo ? 6 : 12,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                }}
              >
                {logo && <EntityLogo entity={item} size={14} />}
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
            )
          })}
          {hasOverflow && !showAllItems && (
            <button
              type="button"
              onClick={() => setShowAllItems(true)}
              className="inline-flex items-center rounded-full text-xs font-semibold"
              style={{
                background: '#EEF5EF',
                color: '#2A5C2E',
                border: '1px solid #C8DEC9',
                padding: '5px 11px',
                cursor: 'pointer',
              }}
            >
              See all
            </button>
          )}
          {hasOverflow && showAllItems && (
            <button
              type="button"
              onClick={() => setShowAllItems(false)}
              className="inline-flex items-center rounded-full text-xs font-semibold"
              style={{
                background: '#F2EDE6',
                color: '#607860',
                border: '1px solid #DDD0BC',
                padding: '5px 11px',
                cursor: 'pointer',
              }}
            >
              Show less
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          placeholder={placeholder}
          className="flex-1 px-3 py-2.5 sm:py-2 rounded-lg text-sm outline-none"
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
          className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium"
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

// ── Query Lab ─────────────────────────────────────────────────────────────────

type LabStatus = 'idle' | 'running' | 'done' | 'error'

interface LabMention {
  entity: string
  count: number
}

const LAB_SUGGESTIONS = [
  'best javascript charting library for React',
  'highcharts vs chart.js comparison',
  'data visualization library with TypeScript support',
  'lightweight chart library for dashboards',
]

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function aliasToMentionPattern(alias: string): RegExp | null {
  const chunks = alias.trim().split(/\s+/).filter(Boolean).map(escapeRegExp)
  if (chunks.length === 0) return null
  const body = chunks.join('\\s+')
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'gi')
}

function countMentionMatches(text: string, alias: string): number {
  const pattern = aliasToMentionPattern(alias)
  if (!pattern) return 0
  return [...text.matchAll(pattern)].length
}

function buildAliasLookup(aliasesByEntity: Record<string, string[]>): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [entity, aliases] of Object.entries(aliasesByEntity)) {
    const key = entity.trim().toLowerCase()
    if (!key) continue
    const normalizedAliases = dedupeCaseInsensitive((aliases ?? []).map((value) => String(value)))
    if (normalizedAliases.length > 0) {
      map.set(key, normalizedAliases)
    }
  }
  return map
}

function detectMentions(
  responseText: string,
  trackedEntities: string[],
  aliasLookup: Map<string, string[]>,
): LabMention[] {
  return trackedEntities
    .map((entity) => {
      const normalizedEntity = entity.trim()
      const aliases = dedupeCaseInsensitive([
        normalizedEntity,
        ...(aliasLookup.get(normalizedEntity.toLowerCase()) ?? []),
      ])

      const canonicalCount = countMentionMatches(responseText, normalizedEntity)
      const aliasCount = aliases
        .filter((alias) => alias.toLowerCase() !== normalizedEntity.toLowerCase())
        .reduce((max, alias) => Math.max(max, countMentionMatches(responseText, alias)), 0)

      return {
        entity,
        count: canonicalCount > 0 ? canonicalCount : aliasCount,
      }
    })
    .filter((mention) => mention.count > 0)
    .sort((left, right) => right.count - left.count)
}

function QueryLab({
  trackedEntities,
  aliasesByEntity,
}: {
  trackedEntities: string[]
  aliasesByEntity: Record<string, string[]>
}) {
  const [queryText, setQueryText] = useState('')
  const [status, setStatus] = useState<LabStatus>('idle')
  const [response, setResponse] = useState('')
  const [mentions, setMentions] = useState<LabMention[]>([])
  const [errorText, setErrorText] = useState('')
  const [model, setModel] = useState<'gpt-4o-mini' | 'gpt-4o'>('gpt-4o-mini')
  const [webSearch, setWebSearch] = useState(true)
  const [elapsedMs, setElapsedMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const aliasLookup = useMemo(() => buildAliasLookup(aliasesByEntity), [aliasesByEntity])

  const canRun =
    queryText.trim().length > 0 &&
    status !== 'running'

  function startTimer() {
    const t0 = Date.now()
    intervalRef.current = setInterval(() => setElapsedMs(Date.now() - t0), 100)
  }
  function stopTimer() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }

  useEffect(() => () => stopTimer(), [])

  async function handleRun() {
    if (!canRun) return
    setStatus('running')
    setResponse('')
    setMentions([])
    setErrorText('')
    setElapsedMs(0)
    startTimer()
    try {
      const result = await api.promptLabRun({
        query: queryText.trim(),
        model,
        webSearch,
      })
      const responseText =
        result.responseText.trim() || 'Model returned an empty response.'
      const detected = detectMentions(responseText, trackedEntities, aliasLookup)
      setResponse(responseText)
      setMentions(detected)
      setStatus('done')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Run failed')
      setStatus('error')
    } finally {
      stopTimer()
    }
  }

  const elapsedSec = (elapsedMs / 1000).toFixed(1)
  const maxCount = mentions.length > 0 ? Math.max(...mentions.map((m) => m.count)) : 1

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #DDD5C5',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(30,40,25,0.07), 0 6px 28px rgba(30,40,25,0.05)',
      }}
    >
      {/* ── Two-column body ── */}
      <div className="query-lab-grid" style={{ minHeight: 260 }}>

        {/* ── Left: input + controls ── */}
        <div className="query-lab-left" style={{ display: 'flex', flexDirection: 'column', padding: '22px 24px 20px', gap: 16, borderRight: '1px solid #EDE7DA' }}>

          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: status === 'running' ? '#52A55A' : status === 'done' ? '#7DB882' : '#C5D4C6',
                boxShadow: status === 'running' ? '0 0 0 3px #52A55A22' : 'none',
                transition: 'all 0.2s',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2A3A2C', letterSpacing: '-0.01em' }}>Query Lab</span>
            <span style={{ fontSize: 11, color: '#B4C4B6', fontWeight: 400 }}>· test a prompt and see which entities get mentioned</span>
          </div>

          {/* Input area — white box, no visible border until focus */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              borderRadius: 12,
              background: '#F8F5F0',
              border: '1px solid #E4DDD0',
              overflow: 'hidden',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onFocusCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = '#96C49A'
              el.style.boxShadow = '0 0 0 3px #96C49A1A'
            }}
            onBlurCapture={(e) => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = '#E4DDD0'
              el.style.boxShadow = 'none'
            }}
          >
            <textarea
              ref={textareaRef}
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="add a prompt"
              rows={5}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '14px 16px 12px',
                fontSize: 14,
                lineHeight: 1.65,
                color: '#1E2E20',
                fontFamily: 'inherit',
              }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void handleRun() } }}
            />
            {/* Char count if user typed */}
            {queryText.length > 0 && (
              <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, color: '#B8C8BA', fontVariantNumeric: 'tabular-nums' }}>
                {queryText.length}
              </div>
            )}
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Model pill */}
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as typeof model)}
                style={{
                  appearance: 'none', WebkitAppearance: 'none',
                  background: '#F2EDE6', border: '1px solid #DCCFBC',
                  borderRadius: 20, padding: '5px 12px',
                  fontSize: 11, fontWeight: 600, color: '#4A6050', cursor: 'pointer',
                  letterSpacing: '0.01em',
                }}
              >
                <option value="gpt-4o-mini">GPT-4o mini</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>

              {/* Web search */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                <Toggle active={webSearch} onChange={setWebSearch} />
                <span style={{ fontSize: 11, color: '#7A8E7C', fontWeight: 500 }}>Web search</span>
              </label>
            </div>

            {/* Run button */}
            <button
              type="button"
              onClick={() => { void handleRun() }}
              disabled={!canRun}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '9px 22px', borderRadius: 12,
                background: canRun ? '#2A6032' : '#EDEBE6',
                color: canRun ? '#FFFFFF' : '#B0BAB2',
                border: `1.5px solid ${canRun ? '#1C4826' : 'transparent'}`,
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700,
                boxShadow: canRun ? '0 2px 14px rgba(42,96,50,0.28)' : 'none',
                transition: 'all 0.15s',
                letterSpacing: '-0.01em',
              }}
            >
              {status === 'running' ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin-lab 0.85s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span className="tabular-nums">{elapsedSec}s</span>
                </>
              ) : (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Run
                  <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 400 }}>⌘↵</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Right: response / idle / running ── */}
        <div className="query-lab-right" style={{ display: 'flex', flexDirection: 'column', background: '#F9F8F5' }}>

          {/* IDLE */}
          {status === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 20px 18px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#C8D6CA', marginBottom: 14 }}>
                Try a query
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                {LAB_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setQueryText(s); setTimeout(() => textareaRef.current?.focus(), 0) }}
                    style={{
                      textAlign: 'left', background: 'transparent', border: '1px solid #E8E2D8',
                      borderRadius: 10, padding: '9px 13px',
                      fontSize: 12, color: '#6A8070', cursor: 'pointer',
                      lineHeight: 1.45, fontWeight: 500,
                      transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                    }}
                    onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#F2EDE6'; b.style.borderColor = '#CBBFAC'; b.style.color = '#3A5040' }}
                    onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'transparent'; b.style.borderColor = '#E8E2D8'; b.style.color = '#6A8070' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* RUNNING */}
          {status === 'running' && (
            <div style={{ flex: 1, padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                {[0, 0.18, 0.36].map((delay) => (
                  <span
                    key={delay}
                    style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#8FBB93', display: 'inline-block',
                      animation: `pulse-lab-dot 1.1s ease-in-out ${delay}s infinite`,
                    }}
                  />
                ))}
                <span style={{ fontSize: 11, color: '#8EA890', marginLeft: 4 }}>Querying model…</span>
              </div>
              {[88, 72, 82, 58, 76, 48].map((w, i) => (
                <div key={i} style={{ height: 9, width: `${w}%`, borderRadius: 6, background: '#E8E0D4', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          )}

          {/* DONE */}
          {status === 'done' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Response text */}
              <div
                style={{
                  flex: 1, overflowY: 'auto', padding: '14px 16px',
                  fontSize: 12, lineHeight: 1.65, color: '#2A3A2C',
                  borderBottom: mentions.length > 0 ? '1px solid #EDE7DA' : 'none',
                  maxHeight: mentions.length > 0 ? 200 : 'none',
                }}
              >
                {response.split('\n\n').map((para, i, arr) => (
                  <p key={i} style={{ marginBottom: i < arr.length - 1 ? 8 : 0 }}>{para}</p>
                ))}
              </div>

              {/* Entity bars */}
              {mentions.length > 0 && (
                <div style={{ padding: '12px 16px', flexShrink: 0 }}>
                  <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: '#BCCABE', marginBottom: 10 }}>
                    Entities detected
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {mentions.map((m) => {
                      const isHC = m.entity.toLowerCase() === 'highcharts'
                      return (
                        <div key={m.entity} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 88, flexShrink: 0 }}>
                            {getEntityLogo(m.entity) && <EntityLogo entity={m.entity} size={12} />}
                            <span style={{ fontSize: 11, fontWeight: 600, color: isHC ? '#2A5C30' : '#4A6050', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.entity}
                            </span>
                          </div>
                          <div style={{ flex: 1, height: 5, borderRadius: 4, background: '#E8E0D4', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%', borderRadius: 4,
                                width: `${(m.count / maxCount) * 100}%`,
                                background: isHC ? '#3A7040' : '#8FBB93',
                                transition: 'width 0.55s cubic-bezier(.4,0,.2,1)',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#8EA890', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            ×{m.count}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ERROR */}
          {status === 'error' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 6 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: '#E09090' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#A04040' }}>Run failed</p>
              {errorText && (
                <p style={{ fontSize: 11, color: '#B34A4A', maxWidth: 360 }}>
                  {errorText}
                </p>
              )}
              <button type="button" onClick={() => setStatus('idle')} style={{ fontSize: 11, color: '#8FBB93', cursor: 'pointer', background: 'none', border: 'none', marginTop: 2 }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .query-lab-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 520px);
        }
        @keyframes spin-lab { to { transform: rotate(360deg); } }
        @keyframes pulse-lab-dot { 0%, 100% { opacity: 0.2; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1); } }
        @media (max-width: 1100px) {
          .query-lab-grid {
            grid-template-columns: 1fr;
          }
          .query-lab-left {
            border-right: none !important;
            border-bottom: 1px solid #EDE7DA;
          }
        }
      `}</style>
    </div>
  )
}

// ── Prompts Page ──────────────────────────────────────────────────────────────

export default function Prompts() {
  const qc = useQueryClient()
  const navigate = useNavigate()

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
      const prevDashboard = qc.getQueryData<DashboardResponse>(['dashboard'])
      const prevQueries = queries
      const prevQueryTags = queryTags
      const normalizedQuery = normalizeQueryKey(query)
      const matchingPrompt = prevDashboard?.promptStatus.find(
        (prompt) => normalizeQueryKey(prompt.query) === normalizedQuery,
      )
      const canonicalQuery = matchingPrompt?.query ?? query

      qc.setQueryData<DashboardResponse>(['dashboard'], (old) =>
        old
          ? {
              ...old,
              promptStatus: old.promptStatus.map((p) =>
                normalizeQueryKey(p.query) === normalizedQuery
                  ? { ...p, isPaused: !active }
                  : p,
              ),
            }
          : old,
      )

      setQueries((current) => {
        const hasQuery = current.some(
          (existing) => normalizeQueryKey(existing) === normalizedQuery,
        )
        if (active) {
          return hasQuery ? current : [...current, canonicalQuery]
        }
        return hasQuery
          ? current.filter(
              (existing) => normalizeQueryKey(existing) !== normalizedQuery,
            )
          : current
      })

      if (active) {
        const tagsForQuery =
          matchingPrompt?.tags && matchingPrompt.tags.length > 0
            ? matchingPrompt.tags
            : inferPromptTags(canonicalQuery)
        setQueryTags((current) => {
          const existingKey = Object.keys(current).find(
            (existing) => normalizeQueryKey(existing) === normalizedQuery,
          )
          if (existingKey) return current
          return {
            ...current,
            [canonicalQuery]: normalizePromptTags(tagsForQuery, canonicalQuery),
          }
        })
      }

      return { prevDashboard, prevQueries, prevQueryTags }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevDashboard) qc.setQueryData(['dashboard'], ctx.prevDashboard)
      if (ctx?.prevQueries) setQueries(ctx.prevQueries)
      if (ctx?.prevQueryTags) setQueryTags(ctx.prevQueryTags)
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
  const pausedCount = prompts.filter((p) => p.isPaused).length

  const sorted = useMemo(() => {
    if (!sortKey) return prompts
    return [...prompts].sort((a, b) => {
      let av: string | number | boolean | null
      let bv: string | number | boolean | null
      if (sortKey === 'lead') {
        av = a.highchartsRatePct - (a.topCompetitor?.ratePct ?? 0)
        bv = b.highchartsRatePct - (b.topCompetitor?.ratePct ?? 0)
      } else if (sortKey === 'tags') {
        av = a.tags.join(', ')
        bv = b.tags.join(', ')
      } else {
        av = a[sortKey] as string | number | boolean | null
        bv = b[sortKey] as string | number | boolean | null
      }
      if (av == null) av = Number.POSITIVE_INFINITY
      if (bv == null) bv = Number.POSITIVE_INFINITY
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
  const [queryTags, setQueryTags] = useState<Record<string, string[]>>({})
  const [competitors, setCompetitors] = useState<string[]>([])
  const [triggerToken, setTriggerToken] = useState(() => readStoredTriggerToken())
  const [dirty, setDirty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveAndRunPending, setSaveAndRunPending] = useState(false)
  const [runNotice, setRunNotice] = useState<{
    type: 'idle' | 'running' | 'success' | 'error'
    text: string
  }>({ type: 'idle', text: '' })
  const normalizedTriggerToken = triggerToken.trim()
  const hasTriggerToken = normalizedTriggerToken.length > 0

  useEffect(() => {
    if (configQuery.data) {
      const nextQueries = configQuery.data.config.queries
      setQueries(nextQueries)
      setQueryTags(normalizeQueryTagsMap(nextQueries, configQuery.data.config.queryTags))
      setCompetitors(configQuery.data.config.competitors)
      setDirty(false)
    }
  }, [configQuery.data])

  useEffect(() => {
    writeStoredTriggerToken(triggerToken)
  }, [triggerToken])

  function applySavedConfig(updated: Awaited<ReturnType<typeof api.updateConfig>>) {
    qc.setQueryData(['config'], updated)
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    setDirty(false)
    setSaveErr(null)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  const configMutation = useMutation({
    mutationFn: (cfg: BenchmarkConfig) => api.updateConfig(cfg),
    onSuccess: (updated) => applySavedConfig(updated),
    onError: (e) => setSaveErr((e as Error).message),
  })

  function mark(fn: () => void) {
    fn()
    setDirty(true)
    setSaveSuccess(false)
  }

  function handleQueryListChange(nextQueries: string[]) {
    mark(() => {
      setQueries(nextQueries)
      setQueryTags((prev) => {
        const lookup = new Map<string, string[]>()
        for (const [query, tags] of Object.entries(prev)) {
          lookup.set(query.trim().toLowerCase(), tags)
        }
        return Object.fromEntries(
          nextQueries.map((query) => [
            query,
            normalizePromptTags(
              lookup.get(query.trim().toLowerCase()) ?? inferPromptTags(query),
              query,
            ),
          ]),
        )
      })
    })
  }

  const hasHighcharts = competitors.some((c) => c.toLowerCase() === 'highcharts')
  const canSaveChanges =
    dirty &&
    !configMutation.isPending &&
    !saveAndRunPending &&
    queries.length > 0 &&
    hasHighcharts
  const canSaveAndRun = canSaveChanges && hasTriggerToken

  const configPayload: BenchmarkConfig = {
    queries,
    queryTags: normalizeQueryTagsMap(queries, queryTags),
    competitors,
    aliases: configQuery.data?.config.aliases ?? {},
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms)
    })
  }

  async function waitForRunCompletion(
    triggerId: string,
    initialRun: BenchmarkWorkflowRun | null,
    triggerTokenValue: string,
  ): Promise<BenchmarkWorkflowRun> {
    let currentRun = initialRun
    const deadlineMs = Date.now() + 30 * 60 * 1000

    while (Date.now() < deadlineMs) {
      const runsResponse = await api.benchmarkRuns(triggerTokenValue)
      const matched =
        currentRun
          ? runsResponse.runs.find((run) => run.id === currentRun?.id) ??
            runsResponse.runs.find((run) => run.title.includes(triggerId))
          : runsResponse.runs.find((run) => run.title.includes(triggerId))

      if (matched) {
        currentRun = matched
      }

      if (currentRun?.status === 'completed') {
        return currentRun
      }

      const runLabel = currentRun ? ` · Run #${currentRun.runNumber}` : ''
      setRunNotice({ type: 'running', text: `Running queries${runLabel}…` })
      await sleep(3000)
    }

    throw new Error('Run did not complete in time. Open Runs page to check status.')
  }

  async function handleSaveAndRun() {
    if (!canSaveAndRun) return
    setSaveErr(null)
    setSaveAndRunPending(true)
    setRunNotice({ type: 'running', text: 'Saving changes…' })

    try {
      if (!normalizedTriggerToken) {
        throw new Error('Trigger token is required to run benchmarks.')
      }

      const updated = await api.updateConfig(configPayload)
      applySavedConfig(updated)
      setRunNotice({ type: 'running', text: 'Starting benchmark run…' })

      const triggerResult = await api.triggerBenchmark(
        {
          model: 'gpt-4o-mini',
          runs: 1,
          temperature: 0.7,
          webSearch: true,
          ourTerms: 'Highcharts',
        },
        normalizedTriggerToken,
      )

      const completedRun = await waitForRunCompletion(
        triggerResult.triggerId,
        triggerResult.run,
        normalizedTriggerToken,
      )
      const conclusion = (completedRun.conclusion ?? '').toLowerCase()
      if (conclusion !== 'success') {
        throw new Error(
          conclusion
            ? `Run finished with status: ${conclusion}. Open Runs for details.`
            : 'Run finished without success. Open Runs for details.',
        )
      }

      for (let seconds = 5; seconds >= 1; seconds -= 1) {
        setRunNotice({
          type: 'success',
          text: `Run succeeded. Going to dashboard in ${seconds}s…`,
        })
        await sleep(1000)
      }

      navigate('/dashboard')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveErr(message)
      setRunNotice({ type: 'error', text: message })
    } finally {
      setSaveAndRunPending(false)
    }
  }

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
    <div className="max-w-[1360px] space-y-5">
      {/* ── Query Lab ──────────────────────────────────────────────────────── */}
      <QueryLab
        trackedEntities={competitors}
        aliasesByEntity={configQuery.data?.config.aliases ?? {}}
      />

      {/* ── Section divider ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pt-1">
        <div className="flex-1 h-px" style={{ background: '#DDD0BC' }} />
        <span className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: '#9AAE9C' }}>
          Manage Queries &amp; Tracked Entities
        </span>
        <div className="flex-1 h-px" style={{ background: '#DDD0BC' }} />
      </div>

      {/* ── Config editors ─────────────────────────────────────────────────── */}
      {configQuery.isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border p-6" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
              <div className="h-4 w-28 rounded animate-pulse mb-5" style={{ background: '#D4BB96' }} />
              <div className="h-24 rounded animate-pulse" style={{ background: '#F2EDE6' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Left card: Queries + Competitors */}
            <div
              className="rounded-xl border shadow-sm"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
            >
              {/* Queries */}
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
                  className="text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full"
                  style={{ background: '#EEF5EF', color: '#5E8A62', border: '1px solid #C8DDC9' }}
                >
                  {queries.length}
                </span>
              </div>
              <div className="p-5 pt-4">
                <TagInput
                  items={queries}
                  onChange={handleQueryListChange}
                  placeholder="e.g. javascript charting libraries"
                  maxVisibleItems={11}
                />
              </div>

              {/* Divider */}
              <div className="mx-5" style={{ borderTop: '1px solid #E8E0D2' }} />

              {/* Competitors */}
              <div className="flex items-center justify-between p-5 pb-0">
                <div>
                  <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
                    Tracked entities
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#7A8E7C' }}>
                    Companies, libraries or tools tracked in benchmarks
                  </div>
                </div>
                <span
                  className="text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full"
                  style={{ background: '#FEF6ED', color: '#B07030', border: '1px solid #F0D4A8' }}
                >
                  {competitors.length}
                </span>
              </div>
              <div className="p-5 pt-4">
                <TagInput
                  items={competitors}
                  onChange={(v) => mark(() => setCompetitors(v))}
                  placeholder="e.g. chart.js"
                  showLogos={true}
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

            {/* Right card: Prompt Tags */}
            <div
              className="rounded-xl border shadow-sm"
              style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
            >
              <div className="flex items-center justify-between p-5 pb-0">
                <div>
                  <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
                    Prompt Tags
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#7A8E7C' }}>
                    Tags assigned to each query for filtering
                  </div>
                </div>
                <span
                  className="text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full"
                  style={{ background: '#F0EEFB', color: '#7B54D0', border: '1px solid #D4C7F5' }}
                >
                  {queries.length}
                </span>
              </div>
              <div className="p-5 pt-4">
                {queries.length > 0 ? (
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid #F2EDE6' }}
                  >
                    {queries.map((query) => (
                      <QueryTagRow
                        key={query}
                        query={query}
                        tags={queryTags[query] ?? inferPromptTags(query)}
                        onChange={(nextTags) =>
                          mark(() =>
                            setQueryTags((prev) => ({
                              ...prev,
                              [query]: normalizePromptTags(nextTags, query),
                            }))
                          )
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: '#9AAE9C' }}>
                    Add queries to assign tags.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Save row */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { void handleSaveAndRun() }}
              disabled={!canSaveAndRun}
              className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: canSaveAndRun ? '#2A6032' : '#E8E0D2',
                color: canSaveAndRun ? '#FFFFFF' : '#9AAE9C',
                cursor: canSaveAndRun ? 'pointer' : 'not-allowed',
                boxShadow: canSaveAndRun ? '0 1px 8px rgba(42,96,50,0.28)' : 'none',
                border: `1.5px solid ${canSaveAndRun ? '#1E4A26' : 'transparent'}`,
              }}
            >
              {saveAndRunPending ? (
                <>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    style={{ animation: 'spin-prompts-save-run 0.9s linear infinite' }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Saving &amp; Running…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={canSaveAndRun ? 'white' : '#9AAE9C'} stroke="none">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Save &amp; Run
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => configMutation.mutate(configPayload)}
              disabled={!canSaveChanges}
              className="w-full sm:w-auto px-5 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: canSaveChanges ? '#8FBB93' : '#E8E0D2',
                color: canSaveChanges ? '#FFFFFF' : '#9AAE9C',
                cursor: canSaveChanges ? 'pointer' : 'not-allowed',
              }}
              onMouseEnter={(e) => {
                if (canSaveChanges) (e.currentTarget as HTMLButtonElement).style.background = '#7AAB7E'
              }}
              onMouseLeave={(e) => {
                if (canSaveChanges) (e.currentTarget as HTMLButtonElement).style.background = '#8FBB93'
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
          {runNotice.type !== 'idle' && (
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
              style={{
                background:
                  runNotice.type === 'error'
                    ? '#fef2f2'
                    : runNotice.type === 'success'
                      ? '#ecfdf3'
                      : '#ecfdf3',
                border:
                  runNotice.type === 'error'
                    ? '1px solid #fecaca'
                    : runNotice.type === 'success'
                      ? '1px solid #86efac'
                      : '1px solid #bbf7d0',
                color:
                  runNotice.type === 'error'
                    ? '#991b1b'
                    : runNotice.type === 'success'
                      ? '#166534'
                      : '#166534',
              }}
            >
              {runNotice.type === 'running' && (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ animation: 'spin-prompts-save-run 0.9s linear infinite' }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              {runNotice.type === 'success' && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {runNotice.type === 'error' && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              {runNotice.text}
            </div>
          )}
          <style>{`@keyframes spin-prompts-save-run { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {/* ── Prompts data grid ──────────────────────────────────────────────── */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden min-h-[420px]"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div
          className="px-4 py-2.5 text-xs"
          style={{ color: '#9AAE9C', background: '#FDFCF8', borderBottom: '1px solid #F2EDE6' }}
        >
          Click a query to open its drilldown dashboard.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
                <th className="px-4 py-3" style={{ width: 48 }} />
                <SortTh label="Query" col="query" current={sortKey} dir={sortDir} onSort={handleSort} width="320px" />
              <SortTh label="Tags" col="tags" current={sortKey} dir={sortDir} onSort={handleSort} width="180px" />
              <SortTh label="Status" col="status" current={sortKey} dir={sortDir} onSort={handleSort} width="130px" />
              <SortTh label="Runs" col="runs" current={sortKey} dir={sortDir} align="right" onSort={handleSort} width="60px" />
              <SortTh
                label="Highcharts %"
                col="highchartsRatePct"
                current={sortKey}
                dir={sortDir}
                onSort={handleSort}
                width="148px"
                infoAlign="right"
                info="Share of responses for this prompt that mention Highcharts."
              />
              <SortTh
                label="HC Rank"
                col="highchartsRank"
                current={sortKey}
                dir={sortDir}
                align="right"
                onSort={handleSort}
                width="92px"
                info="Highcharts rank for this prompt among all tracked entities, by mention rate."
              />
              <SortTh
                label="Viability %"
                col="viabilityRatePct"
                current={sortKey}
                dir={sortDir}
                onSort={handleSort}
                width="148px"
                info="Average competitor mention pressure for this prompt."
              />
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
                      {Array.from({ length: 10 }).map((__, j) => (
                        <td key={j} className="px-4 py-4">
                          <Skeleton className="h-4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : sorted.map((p, i) => {
                    const paused = p.isPaused
                    const deleted = p.status === 'deleted'
                    const delta = p.highchartsRatePct - (p.topCompetitor?.ratePct ?? 0)
                    const isPending =
                      toggleMutation.isPending && toggleMutation.variables?.query === p.query

                    return (
                      <tr
                        key={p.query}
                        style={{
                          borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none',
                          background: paused ? '#FDFCF8' : deleted ? '#FFF9F7' : 'transparent',
                          opacity: paused ? 0.65 : deleted ? 0.78 : 1,
                          transition: 'opacity 0.15s, background 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (!paused && !deleted) {
                            (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                          }
                        }}
                        onMouseLeave={(e) => {
                          ;(e.currentTarget as HTMLTableRowElement).style.background = paused
                            ? '#FDFCF8'
                            : deleted
                              ? '#FFF9F7'
                              : 'transparent'
                        }}
                      >
                        <td className="px-4 py-3">
                          <Toggle
                            active={!paused && !deleted}
                            onChange={(v) => toggleMutation.mutate({ query: p.query, active: v })}
                            disabled={isPending || deleted}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">
                          <Link
                            to={`/prompts/drilldown?query=${encodeURIComponent(p.query)}`}
                            className="inline-flex max-w-[320px] items-center gap-1.5"
                            style={{ color: paused ? '#9AAE9C' : deleted ? '#B45309' : '#2A3A2C' }}
                          >
                            <span className="block truncate whitespace-nowrap">{p.query}</span>
                            <span className="text-xs" style={{ color: paused ? '#C8D0C8' : deleted ? '#F59E0B' : '#8FBB93' }} aria-hidden>↗</span>
                          </Link>
                        </td>
                      <td className="px-4 py-3">
                        <PromptTagChips tags={p.tags} muted={paused} />
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
                      <td
                        className="px-4 py-3 text-right text-sm font-semibold tabular-nums"
                        style={{
                          color:
                            p.status === 'tracked' && p.highchartsRank !== null
                              ? p.highchartsRank === 1
                                ? '#2A5C2E'
                                : paused
                                  ? '#9AAE9C'
                                  : '#2A3A2C'
                              : '#E5DDD0',
                        }}
                      >
                        {p.status === 'tracked' && p.highchartsRank !== null
                          ? `${p.highchartsRank}/${p.highchartsRankOutOf}`
                          : '–'}
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
                            <div className="flex items-center gap-1.5">
                              {getEntityLogo(p.topCompetitor.entity) && (
                                <EntityLogo entity={p.topCompetitor.entity} size={14} />
                              )}
                              <span className="text-sm font-medium" style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>
                                {p.topCompetitor.entity}
                              </span>
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
      </div>

    </div>
  )
}
