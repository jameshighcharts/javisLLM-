import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { CSSProperties, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type {
  CompetitorSeries,
  DashboardResponse,
  PromptCompetitorRate,
  PromptStatus,
  TimeSeriesPoint,
} from '../types'

// ── Palette ─────────────────────────────────────────────────────────────────

const HC_COLOR = '#8FBB93'

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

// Wordmark logos need pixel-precise cropping to the content bbox
// Values computed from actual image analysis (x,y,w,h = content bbox; srcW,srcH = canvas size)
interface LogoCrop { x: number; y: number; w: number; h: number; srcW: number; srcH: number; displayH: number }
const LOGO_CROP: Record<string, LogoCrop> = {
  '/aggrid.png':   { x: 16, y: 116, w: 374, h: 118, srcW: 400, srcH: 400, displayH: 13 },
  '/amcharts.png': { x: 100, y: 100, w: 799, h: 353, srcW: 1000, srcH: 558, displayH: 13 },
}

function getEntityLogo(entity: string): string | null {
  return ENTITY_LOGOS[entity.toLowerCase()] ?? null
}

// All logo slots share the same fixed width so entity names align across every row
const LOGO_SLOT_W = 32

function EntityLogo({ entity, size = 16 }: { entity: string; size?: number }) {
  const src = getEntityLogo(entity)
  if (!src) return null
  const crop = LOGO_CROP[src]

  if (crop) {
    // Scale wordmark so it fills LOGO_SLOT_W wide, height proportional to aspect ratio
    const scale = LOGO_SLOT_W / crop.w
    const renderH = Math.round(crop.h * scale)
    const imgW = Math.round(crop.srcW * scale)
    const imgH = Math.round(crop.srcH * scale)
    const offX = Math.round(crop.x * scale)
    const offY = Math.round(crop.y * scale)
    return (
      <div style={{ width: LOGO_SLOT_W, height: size, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: LOGO_SLOT_W, height: renderH, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
          <img src={src} alt={entity}
            style={{ position: 'absolute', width: imgW, height: imgH, top: -offY, left: -offX }} />
        </div>
      </div>
    )
  }

  // Icon logo: centered in the same fixed-width slot
  return (
    <div style={{ width: LOGO_SLOT_W, height: size, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0, borderRadius: 3 }} alt={entity} />
    </div>
  )
}
const RIVAL_COLORS = ['#C8A87A', '#A89CB8', '#D49880', '#C8B858', '#7AABB8', '#C89878', '#90A878']

function rivalColor(indexAmongRivals: number) {
  return RIVAL_COLORS[indexAmongRivals % RIVAL_COLORS.length]
}

function truncate(s: string, n = 26) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ── Shared chart defaults ────────────────────────────────────────────────────

const CHART_FONT = "'Inter', system-ui, sans-serif"

const TOOLTIP_BASE: Highcharts.TooltipOptions = {
  backgroundColor: '#FFFFFF',
  borderColor: '#DDD0BC',
  borderRadius: 8,
  shadow: { color: 'rgba(42,58,44,0.08)', offsetX: 0, offsetY: 2, opacity: 1, width: 8 },
  style: { fontFamily: CHART_FONT, fontSize: '12px', color: '#2A3A2C' },
  padding: 10,
}

const CHART_CREDITS: Highcharts.CreditsOptions = { enabled: false }

type TagFilterMode = 'any' | 'all'

type TagSummary = {
  tag: string
  count: number
}

type ProviderFilterValue = 'chatgpt' | 'claude' | 'gemini'

const PROVIDER_FILTER_OPTIONS: Array<{
  value: ProviderFilterValue
  label: string
}> = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
]

function normalizeProviderList(providers: ProviderFilterValue[]): ProviderFilterValue[] {
  return [...new Set(providers.map((provider) => provider.trim().toLowerCase()))]
    .filter((provider): provider is ProviderFilterValue =>
      provider === 'chatgpt' || provider === 'claude' || provider === 'gemini',
    )
    .sort((left, right) => left.localeCompare(right))
}

function providerLabel(provider: ProviderFilterValue): string {
  return PROVIDER_FILTER_OPTIONS.find((option) => option.value === provider)?.label ?? provider
}

function normalizeTagList(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort()
}

function promptMatchesTagFilter(
  tags: string[],
  selectedTagSet: Set<string>,
  mode: TagFilterMode,
): boolean {
  if (selectedTagSet.size === 0) return true

  const promptTagSet = new Set(tags.map((tag) => tag.toLowerCase()))
  if (mode === 'all') {
    for (const tag of selectedTagSet) {
      if (!promptTagSet.has(tag)) return false
    }
    return true
  }

  for (const tag of selectedTagSet) {
    if (promptTagSet.has(tag)) return true
  }
  return false
}

function buildTagSummary(prompts: PromptStatus[]): TagSummary[] {
  const counts = new Map<string, number>()

  for (const prompt of prompts) {
    for (const tag of normalizeTagList(prompt.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return left.tag.localeCompare(right.tag)
    })
}

function resolvePromptSampleSize(prompt: PromptStatus): number | null {
  if (
    typeof prompt.latestRunResponseCount === 'number' &&
    Number.isFinite(prompt.latestRunResponseCount) &&
    prompt.latestRunResponseCount > 0
  ) {
    return prompt.latestRunResponseCount
  }

  const estimates = (prompt.competitorRates ?? [])
    .flatMap((rate) => {
      if (typeof rate.mentions !== 'number' || !Number.isFinite(rate.mentions)) return []
      if (!Number.isFinite(rate.ratePct) || rate.ratePct <= 0) return []
      const estimate = rate.mentions / (rate.ratePct / 100)
      return Number.isFinite(estimate) && estimate > 0 ? [estimate] : []
    })

  if (estimates.length === 0) return null
  return estimates.reduce((sum, value) => sum + value, 0) / estimates.length
}

function buildFilteredCompetitorSeries(
  prompts: PromptStatus[],
  baseline: CompetitorSeries[],
): CompetitorSeries[] {
  const tracked = prompts.filter((prompt) => prompt.status === 'tracked')

  if (tracked.length === 0) {
    return baseline.map((series) => ({
      ...series,
      mentionRatePct: 0,
      shareOfVoicePct: 0,
    }))
  }

  const hasCompetitorBreakdown = tracked.some((prompt) => (prompt.competitorRates?.length ?? 0) > 0)
  if (!hasCompetitorBreakdown) {
    return baseline
  }

  const buckets = new Map<string, { rateSum: number; sampleCount: number; mentions: number }>()
  for (const series of baseline) {
    buckets.set(series.entityKey.toLowerCase(), { rateSum: 0, sampleCount: 0, mentions: 0 })
  }

  let weightedTotalResponses = 0
  let weightedPromptCount = 0

  for (const prompt of tracked) {
    const promptRates = new Map<string, PromptCompetitorRate>()
    for (const rate of prompt.competitorRates ?? []) {
      const key = (rate.entityKey || rate.entity).toLowerCase()
      promptRates.set(key, rate)
      promptRates.set(rate.entity.toLowerCase(), rate)
    }

    const sampleSize = resolvePromptSampleSize(prompt)
    const hasSampleSize =
      typeof sampleSize === 'number' && Number.isFinite(sampleSize) && sampleSize > 0
    if (hasSampleSize) {
      weightedTotalResponses += sampleSize
      weightedPromptCount += 1
    }

    for (const series of baseline) {
      const bucket = buckets.get(series.entityKey.toLowerCase())
      if (!bucket) continue

      const rateEntry =
        promptRates.get(series.entityKey.toLowerCase()) ??
        promptRates.get(series.entity.toLowerCase()) ??
        null
      const ratePct = Math.max(0, rateEntry?.ratePct ?? 0)

      bucket.rateSum += ratePct
      bucket.sampleCount += 1

      if (hasSampleSize) {
        const mentions =
          typeof rateEntry?.mentions === 'number' && Number.isFinite(rateEntry.mentions)
            ? Math.max(0, rateEntry.mentions)
            : (ratePct / 100) * sampleSize
        bucket.mentions += mentions
      }
    }
  }

  const useWeighted = weightedPromptCount === tracked.length && weightedTotalResponses > 0

  const withRates = baseline.map((series) => {
    const bucket = buckets.get(series.entityKey.toLowerCase())
    const averageRate =
      bucket && bucket.sampleCount > 0 ? bucket.rateSum / bucket.sampleCount : 0
    const weightedRate =
      useWeighted && bucket ? (bucket.mentions / weightedTotalResponses) * 100 : averageRate

    return {
      ...series,
      mentionRatePct: Number(weightedRate.toFixed(2)),
    }
  })

  const totalMentionRate = withRates.reduce((sum, series) => sum + series.mentionRatePct, 0)

  return withRates.map((series) => ({
    ...series,
    shareOfVoicePct:
      totalMentionRate > 0
        ? Number(((series.mentionRatePct / totalMentionRate) * 100).toFixed(2))
        : 0,
  }))
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ background: '#E5DDD0', ...style }} />
}

// ── Card Shell ───────────────────────────────────────────────────────────────

function Card({
  title,
  sub,
  children,
  className = '',
  action,
}: {
  title: string
  sub?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div
      className={`rounded-xl border shadow-sm ${className}`}
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex items-start justify-between p-5 pb-0">
        <div className="flex flex-col space-y-0.5">
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            {title}
          </div>
          {sub && (
            <div className="text-xs" style={{ color: '#9AAE9C' }}>
              {sub}
            </div>
          )}
        </div>
        {action}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </div>
  )
}

function DashboardTagFilterBar({
  tags,
  selectedTags,
  selectedProviders,
  mode,
  onToggleTag,
  onToggleProvider,
  onModeChange,
  onClear,
  onClearProviders,
  totalCount,
  matchedCount,
  trackedCount,
  isLoading,
}: {
  tags: TagSummary[]
  selectedTags: string[]
  selectedProviders: ProviderFilterValue[]
  mode: TagFilterMode
  onToggleTag: (tag: string) => void
  onToggleProvider: (provider: ProviderFilterValue) => void
  onModeChange: (mode: TagFilterMode) => void
  onClear: () => void
  onClearProviders: () => void
  totalCount: number
  matchedCount: number
  trackedCount: number
  isLoading: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')

  const visibleTags = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return tags
    return tags.filter((entry) => entry.tag.includes(needle))
  }, [tags, search])

  const hasActiveFilter = selectedTags.length > 0
  const hasActiveProviderFilter = selectedProviders.length > 0
  const hasAnyFilter = hasActiveFilter || hasActiveProviderFilter
  const allSelected = selectedTags.length === 0

  return (
    <div
      className="rounded-xl border shadow-sm overflow-hidden"
      style={{ background: '#FFFFFF', borderColor: hasAnyFilter ? '#B8CCBA' : '#DDD0BC', transition: 'border-color 0.2s' }}
    >
      {/* ── Trigger row ── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex flex-wrap items-center justify-center gap-2.5 px-4 py-3"
        style={{ background: '#FDFCF8', cursor: 'pointer' }}
      >
        <span className="text-sm font-semibold" style={{ color: '#2A3A2C' }}>
          Segment by Tags &amp; Model
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#516554" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {hasActiveFilter && (
          <div className="flex items-center gap-1.5 ml-1">
            {selectedTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: '#EEF5EF', color: '#3D5840', border: '1px solid #C8DDC9' }}
              >
                {tag}
              </span>
            ))}
            {selectedTags.length > 3 && (
              <span className="text-[11px]" style={{ color: '#9AAE9C' }}>+{selectedTags.length - 3}</span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear() }}
              className="text-[11px] font-medium ml-1"
              style={{ color: '#9AAE9C' }}
            >
              clear
            </button>
          </div>
        )}
        {!hasActiveFilter && (
          <span className="text-xs" style={{ color: '#B0A898' }}>
            {totalCount} prompts
          </span>
        )}
        <span className="text-xs" style={{ color: '#D2C7B8' }}>
          •
        </span>
        {hasActiveProviderFilter ? (
          <div className="flex items-center gap-1.5">
            {selectedProviders.slice(0, 3).map((provider) => (
              <span
                key={provider}
                className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: '#EEF5EF', color: '#3D5840', border: '1px solid #C8DDC9' }}
              >
                {providerLabel(provider)}
              </span>
            ))}
            {selectedProviders.length > 3 && (
              <span className="text-[11px]" style={{ color: '#9AAE9C' }}>
                +{selectedProviders.length - 3}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs" style={{ color: '#B0A898' }}>
            all providers
          </span>
        )}
      </button>

      {/* ── Expandable body ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.25s ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div className="px-4 pt-3 pb-4 flex flex-col gap-3" style={{ borderTop: '1px solid #EDE6DC', background: '#FDFCF8' }}>

            {/* Tags section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#9AAE9C', flexShrink: 0 }}>Tags</span>
                <div className="flex-1" />
                {/* Search input */}
                <div
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                  style={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#C4BAB0" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search"
                    className="text-xs bg-transparent outline-none"
                    style={{ color: '#2A3A2C', width: 80 }}
                  />
                </div>
                {/* Match mode toggle */}
                <div
                  className="flex items-center rounded-lg overflow-hidden"
                  style={{ border: '1px solid #E8E0D2', background: '#FFFFFF' }}
                >
                  <button
                    type="button"
                    className="px-2.5 py-1.5 text-xs font-medium transition-all"
                    style={{
                      background: mode === 'any' ? '#3D5C40' : 'transparent',
                      color: mode === 'any' ? '#FEFAE8' : '#9AAE9C',
                    }}
                    onClick={() => onModeChange('any')}
                  >
                    any
                  </button>
                  <div style={{ width: 1, alignSelf: 'stretch', background: '#E8E0D2' }} />
                  <button
                    type="button"
                    className="px-2.5 py-1.5 text-xs font-medium transition-all"
                    style={{
                      background: mode === 'all' ? '#3D5C40' : 'transparent',
                      color: mode === 'all' ? '#FEFAE8' : '#9AAE9C',
                    }}
                    onClick={() => onModeChange('all')}
                  >
                    all
                  </button>
                </div>
                {/* Clear tags */}
                <button
                  type="button"
                  className="text-xs font-medium transition-all"
                  style={{ color: hasActiveFilter ? '#7A8E7C' : '#C4BAB0', cursor: hasActiveFilter ? 'pointer' : 'default' }}
                  onClick={onClear}
                  disabled={!hasActiveFilter}
                >
                  Clear
                </button>
              </div>

              {/* Tag pills */}
              {isLoading ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-7 w-20 rounded-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={onClear}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: allSelected ? '#3D5C40' : '#F2EDE6',
                      color: allSelected ? '#FEFAE8' : '#5A7060',
                      border: `1px solid ${allSelected ? '#3D5C40' : '#DDD0BC'}`,
                    }}
                  >
                    All
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                      style={{
                        background: allSelected ? 'rgba(255,255,255,0.18)' : '#E8E0D2',
                        color: allSelected ? '#FEFAE8' : '#7A8E7C',
                      }}
                    >
                      {totalCount}
                    </span>
                  </button>
                  {visibleTags.length > 0 ? (
                    visibleTags.map((entry) => {
                      const active = selectedTags.includes(entry.tag)
                      return (
                        <button
                          key={entry.tag}
                          type="button"
                          onClick={() => onToggleTag(entry.tag)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                          style={{
                            background: active ? '#3D5C40' : '#F2EDE6',
                            color: active ? '#FEFAE8' : '#5A7060',
                            border: `1px solid ${active ? '#3D5C40' : '#DDD0BC'}`,
                          }}
                        >
                          {entry.tag}
                          <span
                            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                            style={{
                              background: active ? 'rgba(255,255,255,0.18)' : '#E8E0D2',
                              color: active ? '#FEFAE8' : '#7A8E7C',
                            }}
                          >
                            {entry.count}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <p className="text-xs" style={{ color: '#9AAE9C' }}>No tags matched.</p>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: '#EDE6DC' }} />

            {/* Providers section */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#9AAE9C' }}>Model</span>
              {isLoading ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-7 w-20 rounded-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={onClearProviders}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: hasActiveProviderFilter ? '#F2EDE6' : '#3D5C40',
                      color: hasActiveProviderFilter ? '#5A7060' : '#FEFAE8',
                      border: `1px solid ${hasActiveProviderFilter ? '#DDD0BC' : '#3D5C40'}`,
                    }}
                  >
                    All
                  </button>
                  {PROVIDER_FILTER_OPTIONS.map((provider) => {
                    const active = selectedProviders.includes(provider.value)
                    return (
                      <button
                        key={provider.value}
                        type="button"
                        onClick={() => onToggleProvider(provider.value)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                        style={{
                          background: active ? '#3D5C40' : '#F2EDE6',
                          color: active ? '#FEFAE8' : '#5A7060',
                          border: `1px solid ${active ? '#3D5C40' : '#DDD0BC'}`,
                        }}
                      >
                        {provider.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

const SCORE_TARGET = 40

function ScoreStatCard({ score, isLoading }: { score: number; isLoading: boolean }) {
  const pct = Math.min(Math.max(score, 0), 100)
  const toTarget = Math.max(0, SCORE_TARGET - pct)

  const tier =
    pct >= SCORE_TARGET
      ? { label: 'On target', color: '#16A34A', bg: 'rgba(22,163,74,0.10)', border: 'rgba(22,163,74,0.22)' }
      : pct >= SCORE_TARGET * 0.7
        ? { label: 'Close', color: '#C27D0E', bg: 'rgba(194,125,14,0.10)', border: 'rgba(194,125,14,0.22)' }
        : { label: 'Off target', color: '#C0392B', bg: 'rgba(192,57,43,0.08)', border: 'rgba(192,57,43,0.20)' }

  // Subtle card tint matching the tier
  const cardTint =
    pct >= 60
      ? 'radial-gradient(ellipse at 85% 10%, rgba(22,163,74,0.06) 0%, transparent 60%)'
      : pct >= 35
        ? 'radial-gradient(ellipse at 85% 10%, rgba(194,125,14,0.06) 0%, transparent 60%)'
        : 'radial-gradient(ellipse at 85% 10%, rgba(192,57,43,0.05) 0%, transparent 60%)'

  return (
    <div
      className="rounded-xl border shadow-sm h-full flex flex-col"
      style={{ background: `#FEFCF9`, backgroundImage: cardTint, borderColor: '#DDD0BC' }}
    >
      {/* Title row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#6B8470' }}
        >
          AI Visibility Score
        </span>
        <div className="relative group">
          <button
            type="button"
            className="w-4 h-4 rounded-full border flex items-center justify-center"
            style={{ color: '#6B8470', borderColor: '#D8CEC0', background: '#FEFCF9' }}
            aria-label="About AI Visibility Score"
          >
            <svg
              width="11"
              height="11"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
            </svg>
          </button>
          <div
            className="pointer-events-none absolute right-0 top-5 z-20 w-72 rounded-md border px-2 py-1.5 text-[10px] leading-snug opacity-0 transition-opacity shadow-sm group-hover:opacity-100 group-focus-within:opacity-100"
            style={{ background: '#FFFFFF', borderColor: '#DDD0BC', color: '#6E8472' }}
          >
            <div>AI Visibility Score (0-100)</div>
            <div className="mt-1">
              Presence% = <code>(Highcharts mentions / responses) × 100</code>
            </div>
            <div className="mt-1">
              Share of Voice% = <code>(Highcharts mentions / (Highcharts mentions + competitor mentions)) × 100</code>
            </div>
            <div className="mt-1">
              Score = <code>0.7 × Presence% + 0.3 × Share of Voice%</code>
            </div>
            <div className="mt-1">Goal = {SCORE_TARGET}</div>
          </div>
        </div>
      </div>

      {/* Score hero */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3">
        {isLoading ? (
          <Skeleton className="h-14 w-32" />
        ) : (
          <>
            <span
              className="text-6xl font-black tracking-tight leading-none"
              style={{ color: tier.color }}
            >
              {pct.toFixed(1)}
            </span>
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-medium leading-none" style={{ color: '#8A9E8E' }}>
                / 100
              </span>
              <span
                className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}
              >
                {tier.label}
              </span>
              {toTarget > 0 && (
                <span className="text-[10px]" style={{ color: '#7E9882' }}>
                  +{toTarget.toFixed(1)} to goal
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Spectrum progress bar */}
      <div className="px-5 pb-5 mt-auto">
        <div className="relative h-2.5 rounded-full overflow-hidden">
          {/* Full colour spectrum — always rendered */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, #F87171 0%, #FB923C 20%, #FBBF24 40%, #A3E635 65%, #34D399 82%, #16A34A 100%)',
            }}
          />
          {/* Dim veil over the unachieved portion */}
          <div
            className="absolute top-0 right-0 h-full"
            style={{
              width: `${100 - pct}%`,
              background: 'rgba(254,252,249,0.76)',
            }}
          />
        </div>

        {/* Current score marker + target marker */}
        {!isLoading && (
          <div className="relative" style={{ height: 20 }}>
            {/* Current position tick */}
            <div
              className="absolute top-0 w-0.5 h-3 rounded-full"
              style={{ left: `${pct}%`, background: tier.color, transform: 'translateX(-50%)' }}
            />
            {/* Target marker */}
            <div
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${SCORE_TARGET}%`, transform: 'translateX(-50%)' }}
            >
              {/* Dashed notch */}
              <div
                className="w-px h-3"
                style={{
                  background: `repeating-linear-gradient(to bottom, #9AAE9C 0px, #9AAE9C 2px, transparent 2px, transparent 4px)`,
                }}
              />
              {/* Label */}
              <span
                className="text-[9px] font-semibold mt-0.5 px-1 rounded"
                style={{ color: '#7A8E7C', background: '#EDE8DF', lineHeight: '14px' }}
              >
                Goal
              </span>
            </div>
          </div>
        )}

        {/* Scale ticks */}
        <div className="flex justify-between mt-3">
          {[0, 25, 50, 75, 100].map((v) => (
            <span key={v} className="text-[10px] tabular-nums" style={{ color: '#8A9E90' }}>
              {v}
            </span>
          ))}
        </div>

        <p className="mt-2.5 text-[11px]" style={{ color: '#6B8470' }}>
          70% presence · 30% share of voice
        </p>
      </div>
    </div>
  )
}

// ── Snapshot trend (AI Visibility + COMBVI) ──────────────────────────────────

function SnapshotTrendCard({
  points,
  hcEntity,
  isLoading,
  useDerivedAiVisibility,
}: {
  points: TimeSeriesPoint[]
  hcEntity: string | null
  isLoading: boolean
  useDerivedAiVisibility: boolean
}) {
  const resolvedHcEntity = useMemo(() => {
    if (hcEntity) return hcEntity
    for (const point of points) {
      const fallback = Object.keys(point.rates).find(
        (name) => name.toLowerCase() === 'highcharts',
      )
      if (fallback) return fallback
    }
    return null
  }, [points, hcEntity])

  const snapshots = useMemo(
    () =>
      points
        .map((point) => {
          const timestampMs = Date.parse(point.timestamp ?? `${point.date}T12:00:00Z`)
          if (!Number.isFinite(timestampMs)) return null

          const hcKey =
            resolvedHcEntity ??
            Object.keys(point.rates).find((name) => name.toLowerCase() === 'highcharts') ??
            null
          const hcRatePct = hcKey ? Math.max(0, point.rates[hcKey] ?? 0) : 0
          const entries = Object.entries(point.rates)
          const totalMentionRatePct = entries.reduce((sum, [, rate]) => sum + Math.max(0, rate), 0)
          const shareOfVoicePct =
            totalMentionRatePct > 0 ? (hcRatePct / totalMentionRatePct) * 100 : 0

          const rivalRates = entries
            .filter(([name]) => (hcKey ? name !== hcKey : true))
            .map(([, rate]) => Math.max(0, rate))
          const derivedCombviPct =
            rivalRates.length > 0
              ? rivalRates.reduce((sum, rate) => sum + rate, 0) / rivalRates.length
              : 0
          const derivedAiVisibilityPct = 0.7 * hcRatePct + 0.3 * shareOfVoicePct
          const storedAiVisibility =
            typeof point.aiVisibilityScore === 'number' &&
            Number.isFinite(point.aiVisibilityScore)
              ? point.aiVisibilityScore
              : null
          const aiVisibilityPct = !useDerivedAiVisibility && storedAiVisibility !== null
            ? storedAiVisibility
            : derivedAiVisibilityPct

          return {
            x: timestampMs,
            aiVisibilityPct: Number(
              aiVisibilityPct.toFixed(2),
            ),
            combviPct: Number(
              (
                typeof point.combviPct === 'number'
                  ? point.combviPct
                  : derivedCombviPct
              ).toFixed(2),
            ),
          }
        })
        .filter((point): point is NonNullable<typeof point> => point !== null),
    [points, resolvedHcEntity, useDerivedAiVisibility],
  )

  const aiSeries = useMemo(
    () => snapshots.map((point) => [point.x, point.aiVisibilityPct]),
    [snapshots],
  )
  const combviSeries = useMemo(
    () => snapshots.map((point) => [point.x, point.combviPct]),
    [snapshots],
  )

  const latestAi = (aiSeries.at(-1)?.[1] as number | undefined) ?? 0
  const prevAi = (aiSeries.at(-2)?.[1] as number | undefined) ?? null
  const aiDelta = prevAi !== null ? latestAi - prevAi : null

  const latestCombvi = (combviSeries.at(-1)?.[1] as number | undefined) ?? 0
  const prevCombvi = (combviSeries.at(-2)?.[1] as number | undefined) ?? null
  const combviDelta = prevCombvi !== null ? latestCombvi - prevCombvi : null

  const hasData = snapshots.length > 0

  const aiColor = HC_COLOR
  const combviColor = '#C8A87A'

  const options = useMemo(
    (): Highcharts.Options => ({
      chart: {
        type: 'line',
        height: 78,
        backgroundColor: 'transparent',
        margin: [4, 6, 6, 6],
        spacing: [0, 0, 0, 0],
        animation: { duration: 400 },
        style: { fontFamily: CHART_FONT },
      },
      credits: CHART_CREDITS,
      title: { text: undefined },
      xAxis: { visible: false, type: 'datetime' },
      yAxis: { visible: false, min: 0 },
      legend: { enabled: false },
      tooltip: {
        ...TOOLTIP_BASE,
        enabled: true,
        shared: true,
        useHTML: true,
        xDateFormat: '%b %e, %Y',
        headerFormat:
          '<div style="margin-bottom:5px;font-size:11px;color:#7A8E7C;font-weight:600">{point.key}</div>',
        pointFormat:
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:{point.color}"></span>' +
          '<span style="color:#2A3A2C">{series.name}</span>' +
          '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}</span>' +
          '</div>',
      },
      plotOptions: {
        series: {
          lineWidth: 2,
          marker: { enabled: false, states: { hover: { enabled: true, radius: 3 } } },
          states: { hover: { lineWidthPlus: 0 } },
        },
      },
      series: [
        {
          type: 'line',
          name: 'AI Visibility',
          data: aiSeries,
          color: aiColor,
        },
        {
          type: 'line',
          name: 'COMBVI',
          data: combviSeries,
          color: combviColor,
          dashStyle: 'ShortDash',
        },
      ],
    }),
    [aiSeries, combviSeries],
  )

  return (
    <div
      className="rounded-xl border shadow-sm h-full flex flex-col"
      style={{ background: '#FEFCF9', borderColor: '#DDD0BC' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-0 flex items-center justify-between">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#6B8470' }}
        >
          AI Visibility Score Over Time
        </span>
        <div className="relative group">
          <button
            type="button"
            className="w-4 h-4 rounded-full text-[10px] font-semibold border flex items-center justify-center"
            style={{ color: '#6B8470', borderColor: '#D8CEC0', background: '#FEFCF9' }}
            aria-label="About AI Visibility Score Over Time"
          >
            i
          </button>
          <div
            className="pointer-events-none absolute right-0 top-5 z-20 w-72 rounded-md border px-2 py-1.5 text-[10px] leading-snug opacity-0 transition-opacity shadow-sm group-hover:opacity-100 group-focus-within:opacity-100"
            style={{ background: '#FFFFFF', borderColor: '#DDD0BC', color: '#6E8472' }}
          >
            <div>AI Visibility Score (0-100) by run</div>
            <div className="mt-1">
              Presence% = <code>(Highcharts mentions / responses) × 100</code>
            </div>
            <div className="mt-1">
              Share of Voice% = <code>(Highcharts mentions / (Highcharts mentions + competitor mentions)) × 100</code>
            </div>
            <div className="mt-1">
              Score = <code>0.7 × Presence% + 0.3 × Share of Voice%</code>
            </div>
            <div className="mt-1">
              Dashed line = COMBVI
            </div>
            <div className="mt-1">
              Formula: <code>COMBVI% = (rival mentions / (responses × rival competitors)) × 100</code>.
            </div>
            <div className="mt-1">Net Advantage = <code>AI Visibility - COMBVI</code></div>
          </div>
        </div>
      </div>

      {/* Latest values + deltas */}
      <div className="px-5 pt-2 pb-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6B8470' }}>
                AI Visibility
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight leading-none" style={{ color: aiColor }}>
                  {latestAi.toFixed(1)}
                </span>
                {aiDelta !== null && (
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: aiDelta >= 0 ? '#16A34A' : '#DC2626' }}
                  >
                    {aiDelta >= 0 ? '▲' : '▼'} {Math.abs(aiDelta).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6B8470' }}>
                COMBVI
              </span>
              <span className="text-[9px]" style={{ color: '#9AAE9C' }}>all competitors avg</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight leading-none" style={{ color: combviColor }}>
                  {latestCombvi.toFixed(1)}
                </span>
                {combviDelta !== null && (
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: combviDelta >= 0 ? '#16A34A' : '#DC2626' }}
                  >
                    {combviDelta >= 0 ? '▲' : '▼'} {Math.abs(combviDelta).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sparkline */}
      <div className="flex-1 px-1 pb-0">
        {isLoading ? (
          <Skeleton className="h-16 mx-4" />
        ) : hasData ? (
          <HighchartsReact highcharts={Highcharts} options={options} />
        ) : (
          <div
            className="h-16 flex items-center justify-center text-xs"
            style={{ color: '#C8D4C8' }}
          >
            No historical data yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 text-[10px]" style={{ color: '#6B8470' }}>
        AI Visibility + COMBVI snapshots · run history
      </div>
    </div>
  )
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  isLoading,
  accent,
}: {
  label: string
  value: string | number
  sub: string
  isLoading: boolean
  accent?: string
}) {
  return (
    <div
      className="rounded-xl border shadow-sm h-full w-full"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="flex flex-row items-center justify-between px-4 pt-3 pb-2">
        <div className="text-sm font-medium" style={{ color: '#516554' }}>
          {label}
        </div>
      </div>
      <div className="px-4 pt-0 pb-4">
        {isLoading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : (
          <div
            className="text-3xl font-bold tracking-tight"
            style={{ color: accent ?? '#2A3A2C' }}
          >
            {value}
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: '#6B7E6F' }}>
          {sub}
        </p>
      </div>
    </div>
  )
}

// ── Total Prompts Tracked Card ────────────────────────────────────────────────

function TotalPromptsCard({ count, isLoading }: { count: number; isLoading: boolean }) {
  return (
    <div
      className="rounded-xl border shadow-sm h-full flex flex-col overflow-hidden"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="px-4 pt-3 pb-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6B8470' }}>
          Prompts Tracked
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center pb-4 pt-2 gap-1">
        {isLoading ? (
          <Skeleton className="h-12 w-16 rounded-lg" />
        ) : (
          <>
            <span
              className="font-black tracking-tight leading-none"
              style={{ fontSize: 52, color: '#1C2B1E' }}
            >
              {count}
            </span>
            <div className="w-8 h-px" style={{ background: '#DDD0BC' }} />
            <span
              className="text-[9px] font-semibold uppercase tracking-widest"
              style={{ color: '#8FAE93' }}
            >
              active queries
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Prompt HC Average Card ────────────────────────────────────────────────────

function PromptHcAvgCard() {
  return (
    <Link
      to="/prompts"
      className="rounded-xl border shadow-sm h-full flex flex-col overflow-hidden group"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC', textDecoration: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.borderColor = '#8FBB93'
        el.style.boxShadow = '0 4px 16px rgba(143,187,147,0.18)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.borderColor = '#DDD0BC'
        el.style.boxShadow = ''
      }}
    >
      <div className="flex-1 flex flex-col justify-between px-4 pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6B8470' }}>
              Prompts
            </span>
            <p className="text-sm font-semibold mt-1.5 leading-snug" style={{ color: '#2A3A2C' }}>
              Manage Queries
            </p>
          </div>
          {/* Lucide: LayoutList */}
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 36, height: 36, background: '#EEF5EF', border: '1px solid #C8DDC9' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E8A62" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="6" height="6" rx="1" />
              <path d="M13 6h8" />
              <rect x="3" y="13" width="6" height="6" rx="1" />
              <path d="M13 14h8" />
              <path d="M13 18h5" />
            </svg>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center py-2">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D8E8D9" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </div>

        <div
          className="inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: '#8FBB93' }}
        >
          Open Prompts
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="group-hover:translate-x-0.5 transition-transform duration-150">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  )
}

// ── Visibility Time Series Chart ──────────────────────────────────────────────

function VisibilityChart({
  points,
  competitorSeries,
  visible,
}: {
  points: TimeSeriesPoint[]
  competitorSeries: CompetitorSeries[]
  visible: Set<string>
}) {
  const hcSeries = competitorSeries.find((s) => s.isHighcharts)
  const rivals = competitorSeries.filter((s) => !s.isHighcharts)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))
  const pointTimestamp = (point: TimeSeriesPoint) => {
    const source = point.timestamp ?? `${point.date}T12:00:00Z`
    const parsed = Date.parse(source)
    if (Number.isFinite(parsed)) {
      return parsed
    }
    return Date.parse(`${point.date}T12:00:00Z`)
  }

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg"
        style={{ height: 260, background: '#FDFCF8', border: '1px dashed #DDD0BC' }}
      >
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: '#9AAE9C' }}>
            No historical data yet
          </p>
          <p className="text-xs mt-1" style={{ color: '#C8D0C8' }}>
            Run the benchmark to see visibility trends
          </p>
        </div>
      </div>
    )
  }

  const seriesOptions: Highcharts.SeriesOptionsType[] = []

  if (hcSeries && visible.has(hcSeries.entity)) {
    seriesOptions.push({
      type: 'areaspline',
      name: hcSeries.entity,
      color: HC_COLOR,
      lineWidth: 2.5,
      fillColor: {
        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
        stops: [
          [0, 'rgba(143,187,147,0.22)'],
          [1, 'rgba(143,187,147,0)'],
        ],
      } as Highcharts.GradientColorObject,
      zIndex: 2,
      marker: {
        enabled: points.length <= 3,
        radius: 4,
        symbol: 'circle',
        fillColor: HC_COLOR,
        lineWidth: 2,
        lineColor: '#FFFFFF',
        states: { hover: { enabled: true, radius: 5 } },
      },
      data: points.map((p) => [
        pointTimestamp(p),
        p.rates[hcSeries.entity] ?? 0,
      ]),
    })
  }

  for (const rival of rivals) {
    if (!visible.has(rival.entity)) continue
    const idx = rivalIndexMap.get(rival.entity) ?? 0
    const color = rivalColor(idx)
    seriesOptions.push({
      type: 'spline',
      name: rival.entity,
      color,
      lineWidth: 1.8,
      dashStyle: 'ShortDot',
      zIndex: 1,
      marker: {
        enabled: points.length <= 3,
        radius: 3,
        symbol: 'circle',
        fillColor: color,
        lineWidth: 2,
        lineColor: '#FFFFFF',
        states: { hover: { enabled: true, radius: 4 } },
      },
      data: points.map((p) => [
        pointTimestamp(p),
        p.rates[rival.entity] ?? 0,
      ]),
    })
  }

  const options: Highcharts.Options = {
    chart: {
      height: 260,
      backgroundColor: 'transparent',
      margin: [8, 8, 44, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      type: 'datetime',
      lineWidth: 0,
      tickWidth: 0,
      gridLineWidth: 0,
      crosshair: { color: '#DDD0BC', width: 1, dashStyle: 'Dash' },
      labels: {
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
        format: '{value:%b %e}',
      },
    },
    yAxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: { enabled: false },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600">{point.key:%b %e, %Y}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat: '',
      useHTML: true,
      valueDecimals: 1,
    },
    plotOptions: {
      areaspline: {
        lineWidth: 2.5,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 3 } },
      },
      spline: {
        lineWidth: 1.8,
        marker: { enabled: false, symbol: 'circle', states: { hover: { enabled: true } } },
        states: { hover: { lineWidth: 2.5 } },
      },
    },
    series: seriesOptions,
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Competitor Toggles ────────────────────────────────────────────────────────

function CompetitorToggles({
  competitorSeries,
  visible,
  onToggle,
  onHighchartsOnly,
  onShowAll,
  isHighchartsOnly,
  hasHidden,
}: {
  competitorSeries: CompetitorSeries[]
  visible: Set<string>
  onToggle: (name: string) => void
  onHighchartsOnly: () => void
  onShowAll: () => void
  isHighchartsOnly: boolean
  hasHidden: boolean
}) {
  const rivals = competitorSeries.filter((s) => !s.isHighcharts)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onHighchartsOnly}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
          style={{
            background: isHighchartsOnly ? HC_COLOR : '#F0F7F1',
            color: isHighchartsOnly ? '#fff' : '#2A5C2E',
            border: `1.5px solid ${HC_COLOR}`,
          }}
        >
          Highcharts only
        </button>
        <button
          onClick={onShowAll}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
          style={{
            background: hasHidden ? '#FFFFFF' : '#F8F5EF',
            color: hasHidden ? '#2A3A2C' : '#9AAE9C',
            border: `1.5px solid ${hasHidden ? '#DDD0BC' : '#E8DFD0'}`,
            cursor: hasHidden ? 'pointer' : 'default',
          }}
          disabled={!hasHidden}
        >
          Show all
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {competitorSeries.map((s) => {
          const on = visible.has(s.entity)
          const color = s.isHighcharts ? HC_COLOR : rivalColor(rivalIndexMap.get(s.entity) ?? 0)
          return (
            <button
              key={s.entity}
              onClick={() => onToggle(s.entity)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: on ? color : '#F2EDE6',
                color: on ? '#fff' : '#9AAE9C',
                border: `1.5px solid ${on ? color : '#DDD0BC'}`,
                opacity: on ? 1 : 0.7,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: on ? 'rgba(255,255,255,0.8)' : color }}
              />
              {s.entity}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Competitor Ranking ─────────────────────────────────────────────────────────

function CompetitorRanking({ data }: { data: CompetitorSeries[] }) {
  const sorted = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const rivals = data.filter((s) => !s.isHighcharts).sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const rivalIndexMap = new Map(rivals.map((s, i) => [s.entity, i]))
  const maxRate = sorted[0]?.mentionRatePct ?? 1

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-center py-10" style={{ color: '#C8D0C8' }}>
        No competitor data yet
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {sorted.map((item, i) => {
        const dotColor = item.isHighcharts ? HC_COLOR : rivalColor(rivalIndexMap.get(item.entity) ?? 0)
        const barWidth = maxRate > 0 ? (item.mentionRatePct / maxRate) * 100 : 0
        return (
          <div
            key={item.entity}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
            style={{
              background: item.isHighcharts ? '#F0F7F1' : 'transparent',
              border: `1px solid ${item.isHighcharts ? '#C8DEC9' : 'transparent'}`,
            }}
          >
            <span
              className="text-sm w-5 text-right flex-shrink-0 font-medium tabular-nums"
              style={{ color: '#C8D4C8' }}
            >
              {i + 1}
            </span>
            {getEntityLogo(item.entity)
              ? <EntityLogo entity={item.entity} size={18} />
              : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
            }
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium truncate"
                style={{ color: item.isHighcharts ? '#2A5C2E' : '#2A3A2C' }}
              >
                {item.entity}
              </div>
              {/* Mini bar */}
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: '#F2EDE6' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barWidth}%`, background: dotColor, opacity: 0.7 }}
                />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div
                className="text-sm font-semibold tabular-nums"
                style={{ color: item.isHighcharts ? '#3D7A42' : '#607860' }}
              >
                {item.mentionRatePct.toFixed(1)}%
              </div>
              {item.shareOfVoicePct !== undefined && (
                <div className="text-xs tabular-nums" style={{ color: '#9AAE9C' }}>
                  {item.shareOfVoicePct.toFixed(0)}% SOV
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── HC vs Top Rival per Query ──────────────────────────────────────────────────

function HCvsRivalChart({ data }: { data: PromptStatus[] }) {
  const tracked = data.filter((p) => p.status === 'tracked')

  if (tracked.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No tracked queries yet
      </div>
    )
  }

  // Dynamic yAxis max: round up to nearest 10, min 40
  const maxVal = Math.max(
    ...tracked.map((p) => p.highchartsRatePct),
    ...tracked.map((p) => p.topCompetitor?.ratePct ?? 0),
  )
  const yMax = Math.max(40, Math.ceil(maxVal / 10) * 10 + 10)

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 280,
      backgroundColor: 'transparent',
      margin: [20, 16, 100, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query, 22)),
      lineWidth: 0,
      tickWidth: 0,
      crosshair: { color: '#F2EDE6', width: 20 },
      labels: {
        style: { color: '#7A8E7C', fontSize: '11px', fontFamily: CHART_FONT },
        autoRotation: [-45],
        overflow: 'justify',
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: yMax,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C', fontFamily: CHART_FONT },
      symbolRadius: 3,
      symbolHeight: 10,
      symbolWidth: 10,
      itemDistance: 16,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      useHTML: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600;max-width:200px;white-space:normal">{point.key}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat: '',
    },
    plotOptions: {
      column: {
        borderRadius: 4,
        groupPadding: 0.1,
        pointPadding: 0.05,
        borderWidth: 0,
        dataLabels: { enabled: false },
        states: { hover: { brightness: -0.05 } },
      },
    },
    series: [
      {
        type: 'column',
        name: 'Highcharts',
        color: HC_COLOR,
        data: tracked.map((p) => p.highchartsRatePct),
      },
      {
        type: 'column',
        name: 'Top Rival',
        color: RIVAL_COLORS[0],
        data: tracked.map((p) => p.topCompetitor?.ratePct ?? 0),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Mention Rate vs Viability Rate ─────────────────────────────────────────────

function MentionVsViabilityChart({ data }: { data: PromptStatus[] }) {
  const tracked = data.filter((p) => p.status === 'tracked')

  if (tracked.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No tracked queries yet
      </div>
    )
  }

  const maxVal = Math.max(
    ...tracked.map((p) => p.highchartsRatePct),
    ...tracked.map((p) => p.viabilityRatePct),
  )
  const yMax = Math.max(40, Math.ceil(maxVal / 10) * 10 + 10)

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 280,
      backgroundColor: 'transparent',
      margin: [20, 16, 100, 52],
      style: { fontFamily: CHART_FONT },
      animation: { duration: 300 },
    },
    credits: CHART_CREDITS,
    title: { text: undefined },
    xAxis: {
      categories: tracked.map((p) => truncate(p.query, 22)),
      lineWidth: 0,
      tickWidth: 0,
      crosshair: { color: '#F2EDE6', width: 20 },
      labels: {
        style: { color: '#7A8E7C', fontSize: '11px', fontFamily: CHART_FONT },
        autoRotation: [-45],
        overflow: 'justify',
      },
      title: { text: null },
    },
    yAxis: {
      min: 0,
      max: yMax,
      tickAmount: 5,
      gridLineColor: '#EDE8E0',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#9AAE9C', fontSize: '11px', fontFamily: CHART_FONT },
      },
      title: { text: null },
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C', fontFamily: CHART_FONT },
      symbolRadius: 3,
      symbolHeight: 10,
      symbolWidth: 10,
      itemDistance: 16,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      shared: true,
      useHTML: true,
      headerFormat:
        '<div style="margin-bottom:6px;font-size:11px;color:#7A8E7C;font-weight:600;max-width:200px;white-space:normal">{point.key}</div>',
      pointFormat:
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:{point.color}"></span>' +
        '<span style="color:#2A3A2C">{series.name}</span>' +
        '<span style="margin-left:auto;font-weight:600;color:#2A3A2C">{point.y:.1f}%</span>' +
        '</div>',
      footerFormat:
        '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #EDE8E0;font-size:10px;color:#9AAE9C">' +
        'Mention = any reference · Viability = recommended' +
        '</div>',
    },
    plotOptions: {
      column: {
        borderRadius: 4,
        groupPadding: 0.1,
        pointPadding: 0.05,
        borderWidth: 0,
        states: { hover: { brightness: -0.05 } },
      },
    },
    series: [
      {
        type: 'column',
        name: 'Mention Rate',
        color: HC_COLOR,
        data: tracked.map((p) => p.highchartsRatePct),
      },
      {
        type: 'column',
        name: 'Viability Rate',
        color: '#A89CB8',
        data: tracked.map((p) => p.viabilityRatePct),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Prompts Table ─────────────────────────────────────────────────────────────

type SortKey =
  | 'query'
  | 'tags'
  | 'status'
  | 'runs'
  | 'highchartsRatePct'
  | 'highchartsRank'
  | 'viabilityRatePct'

// Hover/focus info badge that keeps tooltip anchored inside table cards.
function ColumnInfoBadge({
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
          width: 14, height: 14,
          background: '#DDD0BC',
          color: '#7A8E7C',
          cursor: 'pointer', border: 'none', flexShrink: 0,
          transition: 'background 0.15s',
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

function PStatusBadge({ status, isPaused }: { status: PromptStatus['status']; isPaused: boolean }) {
  if (isPaused) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#DDD0BC' }} />
        Paused
      </span>
    )
  }
  const tracked = status === 'tracked'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: '#F2EDE6', color: tracked ? '#607860' : '#9AAE9C', border: '1px solid #DDD0BC' }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: tracked ? '#22c55e' : '#E5DDD0' }} />
      {tracked ? 'Tracked' : 'Awaiting run'}
    </span>
  )
}

function PMiniBar({
  pct, color = '#8FBB93', muted, hoverLabel, trackMinWidth = 64,
}: {
  pct: number; color?: string; muted?: boolean; hoverLabel?: string; trackMinWidth?: number
}) {
  return (
    <div
      className="flex items-center gap-2.5"
      title={hoverLabel ? `${hoverLabel}: ${pct.toFixed(1)}%` : undefined}
    >
      <div className="flex-1 rounded-full overflow-hidden" style={{ background: '#E5DDD0', height: 4, minWidth: trackMinWidth }}>
        <div className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: muted ? '#DDD0BC' : color }} />
      </div>
      <span className="text-xs w-9 text-right flex-shrink-0 font-medium tabular-nums"
        style={{ color: muted ? '#9AAE9C' : '#607860' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function PromptTagChips({ tags, muted }: { tags: string[]; muted?: boolean }) {
  if (tags.length === 0) {
    return <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{
            background: '#F2EDE6',
            color: muted ? '#9AAE9C' : '#3D5840',
            border: '1px solid #DDD0BC',
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

function PSortTh({
  label, col, current, dir, align = 'left', width, onSort, info, infoAlign,
}: {
  label: string; col: SortKey; current: SortKey | null; dir: 'asc' | 'desc'
  align?: 'left' | 'right'; width?: string; onSort: (k: SortKey) => void; info?: string; infoAlign?: 'left' | 'right'
}) {
  const active = current === col
  return (
    <th className="px-4 py-3 text-xs font-medium select-none"
      style={{ color: active ? '#2A3A2C' : '#7A8E7C', textAlign: align, width: width ?? undefined, cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {info && <ColumnInfoBadge text={info} align={infoAlign ?? (align === 'right' ? 'right' : 'left')} />}
        <span style={{ fontSize: 9, color: active ? '#8FBB93' : '#DDD0BC', fontWeight: 700 }}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⬍'}
        </span>
      </span>
    </th>
  )
}

function PromptStatusTable({
  data,
  isLoading,
  activeTags,
  matchMode,
  onClearTagFilter,
}: {
  data: PromptStatus[]
  isLoading: boolean
  activeTags: string[]
  matchMode: TagFilterMode
  onClearTagFilter: () => void
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [search, setSearch] = useState('')

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      let av: string | number | boolean | null
      let bv: string | number | boolean | null
      if (sortKey === 'tags') {
        av = a.tags.join(', ')
        bv = b.tags.join(', ')
      } else {
        av = a[sortKey] as string | number | boolean | null
        bv = b[sortKey] as string | number | boolean | null
      }
      if (av == null) av = Number.POSITIVE_INFINITY
      if (bv == null) bv = Number.POSITIVE_INFINITY
      const al = typeof av === 'string' ? av.toLowerCase() : av
      const bl = typeof bv === 'string' ? bv.toLowerCase() : bv
      if (al < bl) return sortDir === 'asc' ? -1 : 1
      if (al > bl) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortKey, sortDir])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return sorted

    return sorted.filter((prompt) => {
      const statusLabel = prompt.isPaused
        ? 'paused'
        : prompt.status === 'tracked'
          ? 'tracked'
          : 'awaiting run'
      const haystack = [
        prompt.query,
        prompt.tags.join(' '),
        statusLabel,
        prompt.topCompetitor?.entity ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [sorted, search])

  return (
    <div
      className="rounded-xl border shadow-sm overflow-hidden min-h-[360px]"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
    >
      <div className="px-4 py-3" style={{ background: '#FDFCF8', borderBottom: '1px solid #F2EDE6' }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium" style={{ color: '#7A8E7C' }}>
              Prompt table
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#9AAE9C' }}>
              {rows.length} row{rows.length !== 1 ? 's' : ''} shown
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:max-w-[420px] sm:flex-1 sm:flex-row sm:items-center">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg w-full"
              style={{ border: '1px solid #DDD0BC', background: '#FFFFFF' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9AAE9C" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search query, tag, status, rival"
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: '#2A3A2C' }}
              />
            </div>
            <Link
              to="/prompts"
              className="text-xs font-medium whitespace-nowrap self-end sm:self-auto"
              style={{ color: '#8FBB93' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#607860')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#8FBB93')}
            >
              View all →
            </Link>
          </div>
        </div>

        {activeTags.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium" style={{ color: '#607860' }}>
              Global tag filter ({matchMode}):
            </span>
            {activeTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
              >
                {tag}
              </span>
            ))}
            <button
              type="button"
              onClick={onClearTagFilter}
              className="text-[11px] font-medium underline underline-offset-2"
              style={{ color: '#607860' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr style={{ borderBottom: '1px solid #F2EDE6', background: '#F7F2EA' }}>
              <PSortTh label="Query" col="query" current={sortKey} dir={sortDir} onSort={handleSort} width="320px" />
              <PSortTh label="Tags" col="tags" current={sortKey} dir={sortDir} onSort={handleSort} width="160px" />
              <PSortTh label="Status" col="status" current={sortKey} dir={sortDir} onSort={handleSort} width="130px" />
              <PSortTh
                label="HC mention Rate" col="highchartsRatePct" current={sortKey} dir={sortDir}
                onSort={handleSort} width="172px" infoAlign="right"
                info="The share of LLM responses for this prompt that explicitly mention Highcharts. Bar = mention rate %."
              />
              <PSortTh
                label="HC Rank" col="highchartsRank" current={sortKey} dir={sortDir}
                align="right" onSort={handleSort} width="90px"
                info="Highcharts position among all tracked entities for this prompt, ranked by mention rate."
              />
              <PSortTh label="Runs" col="runs" current={sortKey} dir={sortDir} align="right" onSort={handleSort} width="60px" />
              <PSortTh
                label="Viability" col="viabilityRatePct" current={sortKey} dir={sortDir}
                onSort={handleSort} width="160px"
                info="Average mention rate of competitor brands for this prompt. High viability means strong competitive pressure."
              />
              <th className="px-4 py-3 text-xs font-medium" style={{ color: '#7A8E7C', textAlign: 'left', whiteSpace: 'nowrap' }}>
                Top rival
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-4 py-4"><Skeleton className="h-4" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="text-sm font-medium" style={{ color: '#607860' }}>
                    No prompts matched your current filters.
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#9AAE9C' }}>
                    Try a different search, or clear the global tag filter.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((p, i) => {
                const paused = p.isPaused
                return (
                  <tr key={p.query}
                    style={{
                      borderBottom: i < rows.length - 1 ? '1px solid #F2EDE6' : 'none',
                      background: paused ? '#FDFCF8' : i % 2 === 0 ? '#FFFFFF' : '#FEFCF9',
                      opacity: paused ? 0.7 : 1,
                      transition: 'opacity 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!paused) {
                        (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        paused ? '#FDFCF8' : i % 2 === 0 ? '#FFFFFF' : '#FEFCF9'
                    }}>
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link to={`/prompts/drilldown?query=${encodeURIComponent(p.query)}`}
                        className="inline-flex max-w-[320px] items-center gap-1.5"
                        style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>
                        <span className="block truncate whitespace-nowrap">{p.query}</span>
                        <span className="text-xs" style={{ color: paused ? '#C8D0C8' : '#8FBB93' }} aria-hidden>↗</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <PromptTagChips tags={p.tags} muted={paused} />
                    </td>
                    <td className="px-4 py-3"><PStatusBadge status={p.status} isPaused={paused} /></td>
                    <td className="px-4 py-3">
                      {p.status === 'tracked'
                        ? <PMiniBar pct={p.highchartsRatePct} muted={paused} hoverLabel="Mention rate" trackMinWidth={46} />
                        : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
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
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums"
                      style={{ color: p.runs > 0 && !paused ? '#2A3A2C' : '#E5DDD0' }}>
                      {p.runs > 0 ? p.runs : '–'}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'tracked'
                        ? <PMiniBar pct={p.viabilityRatePct} color="#C8A87A" muted={paused} hoverLabel="Viability rate" />
                        : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.topCompetitor ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            {getEntityLogo(p.topCompetitor.entity) && (
                              <EntityLogo entity={p.topCompetitor.entity} size={14} />
                            )}
                            <span className="text-sm font-medium" style={{ color: paused ? '#9AAE9C' : '#2A3A2C' }}>{p.topCompetitor.entity}</span>
                          </div>
                          <PMiniBar pct={p.topCompetitor.ratePct} color="#C8A87A" muted={paused} hoverLabel="Mention rate" />
                        </div>
                      ) : <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>('any')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedProviders, setSelectedProviders] = useState<ProviderFilterValue[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set<string>())

  const normalizedSelectedTags = useMemo(() => normalizeTagList(selectedTags), [selectedTags])
  const normalizedSelectedProviders = useMemo(
    () => normalizeProviderList(selectedProviders),
    [selectedProviders],
  )
  const selectedTagSet = useMemo(() => new Set(normalizedSelectedTags), [normalizedSelectedTags])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', normalizedSelectedProviders.join(',')],
    queryFn: () => api.dashboard({ providers: normalizedSelectedProviders }),
    refetchInterval: 60_000,
  })

  const { data: tsData, isLoading: isTimeseriesLoading } = useQuery({
    queryKey: [
      'timeseries',
      normalizedSelectedTags.join(','),
      tagFilterMode,
      normalizedSelectedProviders.join(','),
    ],
    queryFn: () =>
      api.timeseries({
        tags: normalizedSelectedTags,
        mode: tagFilterMode,
        providers: normalizedSelectedProviders,
      }),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const s = data?.summary

  const promptStatusAll = data?.promptStatus ?? []
  const competitorSeriesAll = data?.competitorSeries ?? []

  const tagSummary = useMemo(() => buildTagSummary(promptStatusAll), [promptStatusAll])

  const promptStatus = useMemo(() => {
    if (selectedTagSet.size === 0) return promptStatusAll
    return promptStatusAll.filter((prompt) =>
      promptMatchesTagFilter(prompt.tags, selectedTagSet, tagFilterMode),
    )
  }, [promptStatusAll, selectedTagSet, tagFilterMode])

  const competitorSeries = useMemo(() => {
    if (selectedTagSet.size === 0) return competitorSeriesAll
    return buildFilteredCompetitorSeries(promptStatus, competitorSeriesAll)
  }, [selectedTagSet, promptStatus, competitorSeriesAll])

  const tracked = promptStatus.filter((p) => p.status === 'tracked')

  const hcEntry = competitorSeries.find((s) => s.isHighcharts)
  const hcRate = hcEntry?.mentionRatePct ?? 0
  const hcSov = hcEntry?.shareOfVoicePct ?? 0
  const derivedOverallScore = 0.7 * hcRate + 0.3 * hcSov
  const hasSegmentFilters =
    normalizedSelectedTags.length > 0 || normalizedSelectedProviders.length > 0
  const overallScore = hasSegmentFilters
    ? derivedOverallScore
    : (s?.overallScore ?? derivedOverallScore)
  const avgPromptHighcharts =
    tracked.length > 0
      ? tracked.reduce((sum, p) => sum + p.highchartsRatePct, 0) / tracked.length
      : 0

  const visible = useMemo(
    () => new Set(competitorSeries.map((s) => s.entity).filter((n) => !hidden.has(n))),
    [hidden, competitorSeries],
  )
  const highchartsEntity = competitorSeries.find((series) => series.isHighcharts)?.entity ?? null
  const nonHighchartsEntities = useMemo(
    () => competitorSeries.filter((series) => !series.isHighcharts).map((series) => series.entity),
    [competitorSeries],
  )
  const isHighchartsOnly = useMemo(() => {
    if (!highchartsEntity) return false
    return (
      visible.has(highchartsEntity) &&
      nonHighchartsEntities.every((entity) => !visible.has(entity))
    )
  }, [highchartsEntity, nonHighchartsEntities, visible])
  const hasHidden = useMemo(
    () => competitorSeries.some((series) => hidden.has(series.entity)),
    [hidden, competitorSeries],
  )

  function toggleTag(tag: string) {
    const normalized = tag.trim().toLowerCase()
    setSelectedTags((prev) => {
      const next = new Set(normalizeTagList(prev))
      if (next.has(normalized)) next.delete(normalized)
      else next.add(normalized)
      return [...next].sort()
    })
  }

  function clearTagFilter() {
    setSelectedTags([])
  }

  function toggleProvider(provider: ProviderFilterValue) {
    setSelectedProviders((prev) => {
      const next = new Set(normalizeProviderList(prev))
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return [...next].sort((left, right) => left.localeCompare(right)) as ProviderFilterValue[]
    })
  }

  function clearProviderFilter() {
    setSelectedProviders([])
  }

  function toggleCompetitor(name: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  function showHighchartsOnly() {
    setHidden(new Set(nonHighchartsEntities))
  }

  function showAllCompetitors() {
    setHidden(new Set())
  }

  const timeseriesPoints = useMemo((): TimeSeriesPoint[] => {
    if (!tsData?.points?.length) return []
    return [...tsData.points].sort((left, right) => {
      const leftSource = left.timestamp ?? `${left.date}T12:00:00Z`
      const rightSource = right.timestamp ?? `${right.date}T12:00:00Z`
      return Date.parse(leftSource) - Date.parse(rightSource)
    })
  }, [tsData])

  if (isError) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
      >
        <strong>Failed to load:</strong> {(error as Error).message}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-[1360px]">
      {/* Global segments */}
      <DashboardTagFilterBar
        tags={tagSummary}
        selectedTags={normalizedSelectedTags}
        selectedProviders={normalizedSelectedProviders}
        mode={tagFilterMode}
        onToggleTag={toggleTag}
        onToggleProvider={toggleProvider}
        onModeChange={setTagFilterMode}
        onClear={clearTagFilter}
        onClearProviders={clearProviderFilter}
        totalCount={promptStatusAll.length}
        matchedCount={promptStatus.length}
        trackedCount={tracked.length}
        isLoading={isLoading}
      />

      {/* KPI row: score (2) + trend chart (2) + sov (1) + prompt avg (1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 sm:gap-4">
        <div className="sm:col-span-1 xl:col-span-2">
          <ScoreStatCard score={overallScore} isLoading={isLoading} />
        </div>
        <div className="sm:col-span-1 xl:col-span-2">
          <SnapshotTrendCard
            points={timeseriesPoints}
            hcEntity={hcEntry?.entity ?? null}
            isLoading={isLoading || isTimeseriesLoading}
            useDerivedAiVisibility={hasSegmentFilters}
          />
        </div>
        <TotalPromptsCard count={tracked.length} isLoading={isLoading} />
        <PromptHcAvgCard />
      </div>

      {/* Main section — visibility chart + ranking */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: visibility over time + toggles */}
        <Card
          className="xl:col-span-7"
          title="LLM Mention Rate Over Time"
          sub={
            hasSegmentFilters
              ? `% of responses mentioning each brand (${[
                  normalizedSelectedTags.length > 0
                    ? `tags ${tagFilterMode}`
                    : null,
                  normalizedSelectedProviders.length > 0
                    ? `providers: ${normalizedSelectedProviders.map((provider) => providerLabel(provider)).join(', ')}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')})`
              : '% of responses that mention each brand across runs'
          }
          action={
            !isLoading && (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>
                  {hcRate.toFixed(1)}%
                </span>
                <span className="text-xs" style={{ color: '#9AAE9C' }}>
                  mention rate
                </span>
              </div>
            )
          }
        >
          {isLoading || isTimeseriesLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <VisibilityChart
                points={timeseriesPoints}
                competitorSeries={competitorSeries}
                visible={visible}
              />
              {competitorSeries.length > 0 && (
                <CompetitorToggles
                  competitorSeries={competitorSeries}
                  visible={visible}
                  onToggle={toggleCompetitor}
                  onHighchartsOnly={showHighchartsOnly}
                  onShowAll={showAllCompetitors}
                  isHighchartsOnly={isHighchartsOnly}
                  hasHidden={hasHidden}
                />
              )}
            </>
          )}
        </Card>

        {/* Right: competitor ranking */}
        <Card
          className="xl:col-span-5"
          title="Competitor Ranking"
          sub="Sorted by mention rate · bar = relative share"
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : (
            <CompetitorRanking data={competitorSeries} />
          )}
        </Card>
      </div>

      {/* Prompts table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>Prompt Performance</div>
            <div className="text-xs mt-0.5" style={{ color: '#9AAE9C' }}>
              Mention &amp; viability rates per query — scoped by selected segments
            </div>
          </div>
        </div>
        <PromptStatusTable
          data={promptStatus}
          isLoading={isLoading}
          activeTags={normalizedSelectedTags}
          matchMode={tagFilterMode}
          onClearTagFilter={clearTagFilter}
        />
      </div>

      {/* Data file status */}
      {!isLoading && data?.files && (
        <div className="flex items-center gap-5 text-xs" style={{ color: '#9AAE9C' }}>
          {Object.entries({
            'Comparison table': data.files.comparisonTablePresent,
            'Competitor chart': data.files.competitorChartPresent,
            'KPI row': data.files.kpiPresent,
            'LLM outputs': data.files.llmOutputsPresent,
          }).map(([label, ok]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: ok ? '#22c55e' : '#E5DDD0' }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
