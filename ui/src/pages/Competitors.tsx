import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { CompetitorSeries, PromptCompetitorRate, PromptStatus } from '../types'

// Highcharts = rich forest green (bolder than before); competitors = original earthy palette
const HC_COLOR = '#3D7A45'
const COMPETITOR_COLORS = ['#DDD0BC', '#D4836A', '#9B8CB5', '#D4C05A', '#9AAE9C', '#C4836A', '#6A8E6E', '#B5A898']

// Brand logo map — Recharts and AG Chart have no logo so they fall back to text
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
interface LogoCrop { x: number; y: number; w: number; h: number; srcW: number; srcH: number; displayH: number }
const LOGO_CROP: Record<string, LogoCrop> = {
  '/aggrid.png':   { x: 16, y: 116, w: 374, h: 118, srcW: 400, srcH: 400, displayH: 13 },
  '/amcharts.png': { x: 100, y: 100, w: 799, h: 353, srcW: 1000, srcH: 558, displayH: 13 },
}

function getEntityLogo(entity: string): string | null {
  return ENTITY_LOGOS[entity.toLowerCase()] ?? null
}

const LOGO_SLOT_W = 32

function EntityLogo({ entity, size = 16 }: { entity: string; size?: number }) {
  const src = getEntityLogo(entity)
  if (!src) return null
  const crop = LOGO_CROP[src]

  if (crop) {
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

  return (
    <div style={{ width: LOGO_SLOT_W, height: size, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0, borderRadius: 3 }} alt={entity} />
    </div>
  )
}

function logoLabel(entity: string, opts?: { size?: number; color?: string; fontSize?: string; fontWeight?: string }) {
  const logo = getEntityLogo(entity)
  const size = opts?.size ?? 14
  const color = opts?.color ?? '#607860'
  const fontSize = opts?.fontSize ?? '12px'
  const fontWeight = opts?.fontWeight ?? '500'
  if (logo) {
    const crop = LOGO_CROP[logo]
    let imgHtml: string
    if (crop) {
      const scale = crop.displayH / crop.h
      const displayW = Math.round(crop.w * scale)
      const imgW = Math.round(crop.srcW * scale)
      const imgH = Math.round(crop.srcH * scale)
      const offX = Math.round(crop.x * scale)
      const offY = Math.round(crop.y * scale)
      imgHtml =
        `<span style="display:inline-block;width:${displayW}px;height:${crop.displayH}px;overflow:hidden;position:relative;flex-shrink:0;vertical-align:middle">` +
        `<img src="${logo}" style="position:absolute;width:${imgW}px;height:${imgH}px;top:${-offY}px;left:${-offX}px;object-fit:fill" />` +
        `</span>`
    } else {
      imgHtml =
        `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;overflow:hidden;border-radius:2px;flex-shrink:0;vertical-align:middle">` +
        `<img src="${logo}" width="${size}" height="${size}" style="object-fit:contain;flex-shrink:0" />` +
        `</span>`
    }
    return (
      `<span style="display:inline-flex;align-items:center;gap:4px">` +
      imgHtml +
      `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>` +
      `</span>`
    )
  }
  return `<span style="color:${color};font-size:${fontSize};font-weight:${fontWeight}">${entity}</span>`
}

function getColor(s: CompetitorSeries, i: number) {
  if (s.isHighcharts) return HC_COLOR
  return COMPETITOR_COLORS[(i % COMPETITOR_COLORS.length)]
}

type TagFilterMode = 'any' | 'all'

type TagSummary = {
  tag: string
  count: number
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
    return baseline.map((series) => ({ ...series, mentionRatePct: 0, shareOfVoicePct: 0 }))
  }

  const hasCompetitorBreakdown = tracked.some((prompt) => (prompt.competitorRates?.length ?? 0) > 0)
  if (!hasCompetitorBreakdown) return baseline

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
    const averageRate = bucket && bucket.sampleCount > 0 ? bucket.rateSum / bucket.sampleCount : 0
    const weightedRate =
      useWeighted && bucket ? (bucket.mentions / weightedTotalResponses) * 100 : averageRate
    return { ...series, mentionRatePct: Number(weightedRate.toFixed(2)) }
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

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ background: '#E5DDD0' }} />
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1.5"
      style={{
        background: highlight ? '#EEF3EE' : '#FFFFFF',
        border: `1.5px solid ${highlight ? '#8FBB93' : '#DDD0BC'}`,
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: highlight ? '#4A8A50' : '#9AAE9C' }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-bold tracking-tight tabular-nums"
        style={{ color: highlight ? '#2A4A2C' : '#2A3A2C' }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: highlight ? '#6A9A6E' : '#9AAE9C' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border shadow-sm" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
      <div className="flex flex-col space-y-1 p-5 pb-0">
        <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>{title}</div>
        {sub && <div className="text-xs" style={{ color: '#9AAE9C' }}>{sub}</div>}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </div>
  )
}

function TagFilterBar({
  tags,
  selectedTags,
  mode,
  onToggleTag,
  onModeChange,
  onClear,
  totalCount,
  matchedCount,
  trackedCount,
  isLoading,
}: {
  tags: TagSummary[]
  selectedTags: string[]
  mode: TagFilterMode
  onToggleTag: (tag: string) => void
  onModeChange: (mode: TagFilterMode) => void
  onClear: () => void
  totalCount: number
  matchedCount: number
  trackedCount: number
  isLoading: boolean
}) {
  const [search, setSearch] = useState('')
  const allSelected = selectedTags.length === 0

  const visibleTags = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return tags
    return tags.filter((entry) => entry.tag.includes(needle))
  }, [tags, search])

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#DDD0BC', background: '#FFFFFF' }}>
      <div
        className="px-4 py-3"
        style={{
          background:
            'linear-gradient(120deg, rgba(143,187,147,0.18) 0%, rgba(200,168,122,0.16) 52%, rgba(242,237,230,0.92) 100%)',
          borderBottom: '1px solid #DDD0BC',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#607860' }}>
              Prompt Tag Scope
            </p>
            <p className="text-xs mt-1" style={{ color: '#6E8472' }}>
              {matchedCount} of {totalCount} prompts matched · {trackedCount} tracked
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: mode === 'any' ? '#2A3A2C' : '#FFFFFF',
                color: mode === 'any' ? '#F8F5EF' : '#607860',
                border: '1px solid #DDD0BC',
              }}
              onClick={() => onModeChange('any')}
            >
              Match Any
            </button>
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: mode === 'all' ? '#2A3A2C' : '#FFFFFF',
                color: mode === 'all' ? '#F8F5EF' : '#607860',
                border: '1px solid #DDD0BC',
              }}
              onClick={() => onModeChange('all')}
            >
              Match All
            </button>
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: selectedTags.length > 0 ? '#FFFFFF' : '#F6F2EB',
                color: selectedTags.length > 0 ? '#2A3A2C' : '#9AAE9C',
                border: '1px solid #DDD0BC',
                cursor: selectedTags.length > 0 ? 'pointer' : 'default',
              }}
              onClick={onClear}
              disabled={selectedTags.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        <div
          className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ border: '1px solid #DDD0BC', background: '#FFFFFF' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9AAE9C" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tags"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: '#2A3A2C' }}
          />
        </div>
      </div>

      <div className="px-4 py-3">
        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: allSelected ? '#2A3A2C' : '#F8F5EF',
                color: allSelected ? '#F8F5EF' : '#3D5840',
                border: `1px solid ${allSelected ? '#2A3A2C' : '#DDD0BC'}`,
              }}
            >
              <span>All</span>
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                style={{
                  background: allSelected ? 'rgba(255,255,255,0.18)' : '#EEE5D8',
                  color: allSelected ? '#F8F5EF' : '#607860',
                }}
              >
                {totalCount}
              </span>
            </button>

            {visibleTags.map((entry) => {
              const active = selectedTags.includes(entry.tag)
              return (
                <button
                  key={entry.tag}
                  type="button"
                  onClick={() => onToggleTag(entry.tag)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: active ? '#2A3A2C' : '#F8F5EF',
                    color: active ? '#F8F5EF' : '#3D5840',
                    border: `1px solid ${active ? '#2A3A2C' : '#DDD0BC'}`,
                  }}
                >
                  <span>{entry.tag}</span>
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                    style={{
                      background: active ? 'rgba(255,255,255,0.18)' : '#EEE5D8',
                      color: active ? '#F8F5EF' : '#607860',
                    }}
                  >
                    {entry.count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MentionRateChart({ data }: { data: CompetitorSeries[] }) {
  const sorted = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const hcIndex = sorted.findIndex((s) => s.isHighcharts)

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      height: Math.max(200, sorted.length * 38 + 30),
      backgroundColor: 'transparent',
      margin: [8, 80, 28, 120],
    },
    xAxis: {
      categories: sorted.map((s) => s.entity),
      lineWidth: 0,
      tickWidth: 0,
      labels: {
        useHTML: true,
        style: { color: '#607860', fontSize: '12px', fontWeight: '500' },
        formatter: function () {
          return logoLabel(String(this.value), { size: 14 })
        },
      },
      title: { text: null },
      plotBands: hcIndex >= 0 ? [{
        from: hcIndex - 0.5,
        to: hcIndex + 0.5,
        color: 'rgba(61, 122, 69, 0.07)',
      }] : [],
    },
    yAxis: {
      min: 0,
      max: 100,
      gridLineColor: '#F2EDE6',
      labels: { format: '{value}%', style: { color: '#9AAE9C', fontSize: '11px' } },
      title: { text: null },
    },
    plotOptions: {
      bar: {
        borderRadius: 3,
        dataLabels: {
          enabled: true,
          format: '{y:.0f}%',
          style: {
            fontFamily: "'Inter', sans-serif",
            fontSize: '12px',
            fontWeight: '600',
            textOutline: 'none',
          },
          formatter: function () {
            const isHC = (this.point as { isHighcharts?: boolean }).isHighcharts
            return `<span style="color:${isHC ? HC_COLOR : '#7A8E7C'};font-size:${isHC ? '13px' : '12px'};font-weight:${isHC ? '700' : '600'}">${(this.y ?? 0).toFixed(0)}%</span>`
          },
        },
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Mention Rate',
        showInLegend: false,
        data: sorted.map((s, i) => ({
          y: s.mentionRatePct,
          color: getColor(s, i),
          isHighcharts: s.isHighcharts,
          name: s.entity,
          borderColor: s.isHighcharts ? '#2A6032' : 'transparent',
          borderWidth: s.isHighcharts ? 2 : 0,
        })),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function ShareOfVoiceChart({ data }: { data: CompetitorSeries[] }) {
  const withData = data.filter((s) => s.shareOfVoicePct > 0)
  const sortedAll = [...data].sort((a, b) => b.mentionRatePct - a.mentionRatePct)

  if (withData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: '#9AAE9C' }}>
        No share-of-voice data yet
      </div>
    )
  }

  const options: Highcharts.Options = {
    chart: {
      type: 'pie',
      height: 290,
      backgroundColor: 'transparent',
      margin: [0, 0, 0, 0],
    },
    plotOptions: {
      pie: {
        innerSize: '52%',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        dataLabels: {
          enabled: true,
          useHTML: true,
          style: {
            fontSize: '11px',
            color: '#607860',
            textOutline: 'none',
            fontWeight: '500',
          },
          connectorColor: '#DDD0BC',
          formatter: function () {
            const isHC = (this.point as { isHighcharts?: boolean }).isHighcharts
            const color = isHC ? HC_COLOR : '#607860'
            const logo = getEntityLogo(this.point.name ?? '')
            const pSize = 12
            const pCrop = logo ? LOGO_CROP[logo] : null
            let logoHtml = ''
            if (logo && pCrop) {
              const scale = pCrop.displayH / pCrop.h
              const dW = Math.round(pCrop.w * scale)
              const iW = Math.round(pCrop.srcW * scale)
              const iH = Math.round(pCrop.srcH * scale)
              const oX = Math.round(pCrop.x * scale)
              const oY = Math.round(pCrop.y * scale)
              logoHtml =
                `<span style="display:inline-block;width:${dW}px;height:${pCrop.displayH}px;overflow:hidden;position:relative;flex-shrink:0;vertical-align:middle">` +
                `<img src="${logo}" style="position:absolute;width:${iW}px;height:${iH}px;top:${-oY}px;left:${-oX}px;object-fit:fill" /></span>`
            } else if (logo) {
              logoHtml =
                `<span style="display:inline-flex;align-items:center;justify-content:center;width:${pSize}px;height:${pSize}px;overflow:hidden;border-radius:2px;flex-shrink:0;vertical-align:middle">` +
                `<img src="${logo}" width="${pSize}" height="${pSize}" style="object-fit:contain;flex-shrink:0" /></span>`
            }
            const nameSpan = logo
              ? `<span style="display:inline-flex;align-items:center;gap:3px">${logoHtml}<span style="color:${color}">${this.point.name}</span></span>`
              : `<span style="color:${color}">${this.point.name}</span>`
            return `${nameSpan}: <b style="color:${color}">${(this.y ?? 0).toFixed(1)}%</b>`
          },
        },
      },
    },
    series: [
      {
        type: 'pie',
        name: 'Share of Voice',
        data: withData.map((s) => {
          const idx = sortedAll.findIndex((x) => x.entityKey === s.entityKey)
          return {
            name: s.entity,
            y: s.shareOfVoicePct,
            color: getColor(s, idx),
            isHighcharts: s.isHighcharts,
            sliced: s.isHighcharts,
          }
        }),
      },
    ],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

export default function Competitors() {
  const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>('any')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const normalizedSelectedTags = useMemo(() => normalizeTagList(selectedTags), [selectedTags])
  const selectedTagSet = useMemo(() => new Set(normalizedSelectedTags), [normalizedSelectedTags])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
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

  const promptStatusAll = data?.promptStatus ?? []
  const tagSummary = useMemo(() => buildTagSummary(promptStatusAll), [promptStatusAll])

  const filteredPrompts = useMemo(() => {
    if (selectedTagSet.size === 0) return promptStatusAll
    return promptStatusAll.filter((prompt) =>
      promptMatchesTagFilter(prompt.tags, selectedTagSet, tagFilterMode),
    )
  }, [promptStatusAll, selectedTagSet, tagFilterMode])

  const seriesAll = data?.competitorSeries ?? []
  const series = useMemo(() => {
    if (selectedTagSet.size === 0) return seriesAll
    return buildFilteredCompetitorSeries(filteredPrompts, seriesAll)
  }, [selectedTagSet, filteredPrompts, seriesAll])

  const sorted = [...series].sort((a, b) => b.mentionRatePct - a.mentionRatePct)
  const hc = series.find((s) => s.isHighcharts)
  const hcRank = sorted.findIndex((s) => s.isHighcharts) + 1
  const entitiesBeaten = sorted.filter(
    (s) => !s.isHighcharts && s.mentionRatePct < (hc?.mentionRatePct ?? 0),
  ).length
  const leader = sorted[0]
  const gapToLeader = hc && leader && !leader.isHighcharts
    ? (leader.mentionRatePct - hc.mentionRatePct).toFixed(1)
    : null

  const filteredTrackedCount = filteredPrompts.filter((prompt) => prompt.status === 'tracked').length

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

  return (
    <div className="max-w-[980px] space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#2A3A2C' }}>Competitors</h2>
        <p className="text-sm mt-0.5" style={{ color: '#7A8E7C' }}>
          {normalizedSelectedTags.length > 0
            ? `Mention rates and share of voice for selected tags (${tagFilterMode})`
            : 'Mention rates and share of voice across all queries'}
        </p>
      </div>

      <TagFilterBar
        tags={tagSummary}
        selectedTags={normalizedSelectedTags}
        mode={tagFilterMode}
        onToggleTag={toggleTag}
        onModeChange={setTagFilterMode}
        onClear={clearTagFilter}
        totalCount={promptStatusAll.length}
        matchedCount={filteredPrompts.length}
        trackedCount={filteredTrackedCount}
        isLoading={isLoading}
      />

      {/* Highcharts summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Rank"
              value={hc ? `#${hcRank}` : '–'}
              sub={`of ${sorted.length} entities`}
              highlight
            />
            <StatCard
              label="Mention Rate"
              value={hc ? `${hc.mentionRatePct.toFixed(1)}%` : '–'}
              sub="queries mentioning Highcharts"
              highlight
            />
            <StatCard
              label="Share of Voice"
              value={hc ? `${hc.shareOfVoicePct.toFixed(1)}%` : '–'}
              sub="of all entity mentions"
              highlight
            />
            <StatCard
              label="Entities Beaten"
              value={hc ? `${entitiesBeaten}` : '–'}
              sub={gapToLeader ? `${gapToLeader}% behind ${leader?.entity}` : 'leading the field'}
              highlight
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card
          title="Mention Rate"
          sub={
            normalizedSelectedTags.length > 0
              ? '% of selected prompts each entity was mentioned in'
              : '% of queries each entity was mentioned in'
          }
        >
          {isLoading ? <Skeleton className="h-52" /> : <MentionRateChart data={series} />}
        </Card>
        <Card
          title="Share of Voice"
          sub={
            normalizedSelectedTags.length > 0
              ? 'Proportion of mentions inside selected prompt tags'
              : 'Proportion of all entity mentions'
          }
        >
          {isLoading ? <Skeleton className="h-52" /> : <ShareOfVoiceChart data={series} />}
        </Card>
      </div>

      {/* Head-to-head table */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #F2EDE6' }}>
          <div className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            Head-to-Head vs Highcharts
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid #F2EDE6' }}>
              {['Rank', 'Entity', 'Mention Rate', 'Share of Voice', 'Gap vs Highcharts'].map((h, i) => (
                <th
                  key={h}
                  className="px-5 py-3 text-xs font-medium"
                  style={{
                    color: '#7A8E7C',
                    textAlign: i <= 1 ? 'left' : i < 4 ? 'right' : 'left',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F2EDE6' }}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.map((s, i) => {
                  const diff = (hc?.mentionRatePct ?? 0) - s.mentionRatePct
                  const color = getColor(s, i)
                  const isHC = s.isHighcharts
                  return (
                    <tr
                      key={s.entityKey}
                      style={{
                        borderBottom: i < sorted.length - 1 ? '1px solid #F2EDE6' : 'none',
                        background: isHC ? '#EEF3EE' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isHC)
                          (e.currentTarget as HTMLTableRowElement).style.background = '#F7F3EE'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = isHC ? '#EEF3EE' : 'transparent'
                      }}
                    >
                      {/* Rank */}
                      <td
                        className="px-5 py-3.5 text-xs font-semibold tabular-nums"
                        style={{ color: isHC ? HC_COLOR : '#C8C0B8' }}
                      >
                        #{i + 1}
                      </td>

                      {/* Entity */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {getEntityLogo(s.entity)
                            ? <EntityLogo entity={s.entity} size={18} />
                            : <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ background: color, boxShadow: isHC ? `0 0 0 3px #C4DCC6` : 'none' }}
                              />
                          }
                          <span
                            className="text-sm font-medium"
                            style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                          >
                            {s.entity}
                          </span>
                          {isHC && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                background: '#D4E8D5',
                                color: HC_COLOR,
                                border: `1px solid #8FBB93`,
                              }}
                            >
                              YOU
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Mention Rate */}
                      <td
                        className="px-5 py-3.5 text-right text-sm font-medium tabular-nums"
                        style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                      >
                        {s.mentionRatePct.toFixed(1)}%
                      </td>

                      {/* Share of Voice */}
                      <td
                        className="px-5 py-3.5 text-right text-sm font-medium tabular-nums"
                        style={{ color: isHC ? '#2A4A2C' : '#2A3A2C' }}
                      >
                        {s.shareOfVoicePct > 0 ? `${s.shareOfVoicePct.toFixed(1)}%` : '–'}
                      </td>

                      {/* Gap */}
                      <td className="px-5 py-3.5">
                        {isHC ? (
                          <span className="text-sm" style={{ color: '#E5DDD0' }}>–</span>
                        ) : diff > 0 ? (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#F0FAF0', color: '#16a34a', border: '1px solid #BBF7D0' }}
                          >
                            +{diff.toFixed(1)}% ahead
                          </span>
                        ) : diff < 0 ? (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#FEF2F2', color: '#dc2626', border: '1px solid #FECACA' }}
                          >
                            {diff.toFixed(1)}% behind
                          </span>
                        ) : (
                          <span
                            className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#F2EDE6', color: '#9AAE9C', border: '1px solid #DDD0BC' }}
                          >
                            tied
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
