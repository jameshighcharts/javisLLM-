import { useQuery } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { CompetitorBlogPost } from '../types'

// One muted accent per competitor
const ACCENTS = [
  '#4A6B4E',
  '#7A5C3A',
  '#3A5A7A',
  '#6A4A7A',
  '#4A7A6A',
  '#7A6A3A',
  '#7A3A4A',
  '#3A6A6A',
]

// ── Data utilities ─────────────────────────────────────────────────────────

type NormalizedPost = {
  id: string
  title: string
  type: string
  source: string
  sourceKey: string
  description: string
  author: string | null
  link: string
  publishDate: string | null
  publishedAt: string | null
  sortTime: number
}

type SourceGroup = {
  source: string
  sourceKey: string
  posts: NormalizedPost[]
}

function stripSpreadsheetPrefix(value: string | null | undefined): string {
  let text = String(value ?? '').trim()
  if (!text) return ''
  if (text.startsWith("'")) text = text.slice(1).trim()
  const wrapped = text.match(/^=\s*["']([\s\S]*)["']\s*$/)
  if (wrapped) text = wrapped[1].trim()
  text = text.replace(/^=+\s*/, '').trim()
  text = text.replace(/^["']([\s\S]*)["']$/, '$1').trim()
  return text
}

function cleanText(value: string | null | undefined, fallback = '—'): string {
  return stripSpreadsheetPrefix(value) || fallback
}

function cleanLink(value: string | null | undefined): string {
  const cleaned = stripSpreadsheetPrefix(value)
  if (!cleaned) return ''
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  if (/^www\./i.test(cleaned)) return `https://${cleaned}`
  return cleaned
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseTime(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    const candidate = stripSpreadsheetPrefix(value)
    if (!candidate) continue
    const parsed = Date.parse(candidate)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toMonthKey(...values: Array<string | null | undefined>): string | null {
  const time = parseTime(...values)
  if (!time) return null
  const date = new Date(time)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

function shortMonth(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return monthKey
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'short' })
}

function fmtDate(value: string | null, fallback?: string | null, short = false): string {
  const time = parseTime(value, fallback ?? null)
  if (!time) return '—'
  const date = new Date(time)
  return short
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function normalizePost(post: CompetitorBlogPost): NormalizedPost | null {
  const title = stripSpreadsheetPrefix(post.title)
  const source = cleanText(post.source, 'Unknown competitor')
  const sourceKeyRaw = stripSpreadsheetPrefix(post.sourceKey)
  const sourceKey = sourceKeyRaw || slugify(source) || 'unknown'
  const type = cleanText(post.type, 'General')
  const link = cleanLink(post.link)
  if (!title || !link) return null
  return {
    id: post.id,
    title,
    type,
    source,
    sourceKey,
    description: cleanText(post.description, ''),
    author: stripSpreadsheetPrefix(post.author) || null,
    link,
    publishDate: stripSpreadsheetPrefix(post.publishDate) || null,
    publishedAt: stripSpreadsheetPrefix(post.publishedAt) || null,
    sortTime: parseTime(stripSpreadsheetPrefix(post.publishedAt), stripSpreadsheetPrefix(post.publishDate)),
  }
}

// ── Company card ───────────────────────────────────────────────────────────

function CompanyCard({
  group,
  index,
  monthAxis,
  selectedTypes,
}: {
  group: SourceGroup
  index: number
  monthAxis: string[]
  selectedTypes: string[]
}) {
  const accent = ACCENTS[index % ACCENTS.length]

  const typeCount = useMemo(() => {
    const s = new Set(group.posts.map((p) => p.type))
    return s.size
  }, [group.posts])

  const cadence = useMemo(() => {
    const counts = new Map<string, number>()
    for (const post of group.posts) {
      const mk = toMonthKey(post.publishedAt, post.publishDate)
      if (mk) counts.set(mk, (counts.get(mk) ?? 0) + 1)
    }
    return monthAxis.map((month) => ({
      month,
      label: shortMonth(month),
      count: counts.get(month) ?? 0,
    }))
  }, [group.posts, monthAxis])

  const chartOptions = useMemo<Highcharts.Options>(
    () => ({
      chart: {
        type: 'column',
        height: 180,
        backgroundColor: 'transparent',
        margin: [24, 2, 28, 2],
        animation: false,
      },
      title: { text: '' },
      xAxis: {
        categories: cadence.map((e) => e.label),
        labels: { style: { fontSize: '10px', color: '#8A9C8C' } },
        lineWidth: 0,
        tickWidth: 0,
      },
      yAxis: {
        title: { text: '' },
        labels: { enabled: false },
        gridLineWidth: 0,
        allowDecimals: false,
        min: 0,
      },
      legend: { enabled: false },
      tooltip: {
        headerFormat: '',
        pointFormat: '<b>{point.category}:</b> {point.y} posts',
      },
      plotOptions: {
        column: {
          borderWidth: 0,
          borderRadius: 3,
          color: accent,
          pointPadding: 0.06,
          groupPadding: 0.1,
          dataLabels: {
            enabled: true,
            formatter() {
              return (this.y ?? 0) > 0 ? String(this.y) : ''
            },
            style: {
              fontSize: '10px',
              fontWeight: '600',
              color: '#4A5E4C',
              textOutline: 'none',
            },
          },
        },
      },
      credits: { enabled: false },
      series: [{ type: 'column', name: 'Posts', data: cadence.map((e) => e.count) }],
    }),
    [cadence, accent],
  )

  const filteredPosts = useMemo(() => {
    if (selectedTypes.length === 0) return group.posts
    return group.posts.filter((p) => selectedTypes.includes(p.type))
  }, [group.posts, selectedTypes])

  const recentPosts = filteredPosts.slice(0, 12)
  const latestDate = group.posts[0]
    ? fmtDate(group.posts[0].publishedAt, group.posts[0].publishDate)
    : '—'

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col"
      style={{
        background: '#F7F4EF',
        border: '1px solid #DDD0BC',
        boxShadow: '0 2px 10px rgba(42,58,44,0.07)',
        gap: 2,
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 4, background: accent }} />

      {/* ── Header ── */}
      <div
        className="px-5 pt-4 pb-4 mx-2 mt-2 rounded-lg"
        style={{ background: '#FFFFFF', border: '1px solid #EAE4DC' }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[16px] font-bold tracking-tight" style={{ color: '#1E2E20' }}>
            {group.source}
          </h3>
          <span
            className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
            style={{ background: `${accent}18`, color: accent }}
          >
            {group.posts.length}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: 'Posts', value: String(group.posts.length) },
            { label: 'Themes', value: String(typeCount) },
            { label: 'Latest', value: latestDate },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-md px-2 py-2 text-center"
              style={{ background: '#F8F6F2', border: '1px solid #EAE4DC' }}
            >
              <div className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#8A9C8C' }}>
                {label}
              </div>
              <div
                className="mt-0.5 font-bold leading-tight"
                style={{ color: '#1E2E20', fontSize: label === 'Latest' ? 11 : 17 }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Publishing cadence ── */}
      <div
        className="px-5 pt-3 pb-2 mx-2 rounded-lg"
        style={{ background: '#FFFFFF', border: '1px solid #EAE4DC' }}
      >
        <div className="text-[9px] uppercase tracking-[0.14em] font-semibold mb-1" style={{ color: '#8A9C8C' }}>
          Publishing cadence
        </div>
        {cadence.some((e) => e.count > 0) ? (
          <HighchartsReact highcharts={Highcharts} options={chartOptions} />
        ) : (
          <div className="py-4 text-xs" style={{ color: '#8A9C8C' }}>
            Not enough dated posts yet
          </div>
        )}
      </div>

      {/* ── Recent posts ── */}
      <div
        className="mx-2 mb-2 rounded-lg overflow-hidden flex flex-col"
        style={{ background: '#FFFFFF', border: '1px solid #EAE4DC' }}
      >
        {/* Section header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid #F2EDE6' }}
        >
          <div className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#8A9C8C' }}>
            Recent posts
          </div>
          {filteredPosts.length > 0 && (
            <div className="text-[10px] font-medium" style={{ color: '#8A9C8C' }}>
              {filteredPosts.length} post{filteredPosts.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {recentPosts.length > 0 ? (
          <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
            {recentPosts.map((post, i) => (
              <a
                key={post.id}
                href={post.link}
                target="_blank"
                rel="noreferrer"
                className="block px-5 py-4"
                style={{
                  borderBottom: i < recentPosts.length - 1 ? '1px solid #F2EDE6' : 'none',
                  textDecoration: 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#FAFAF7' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <p className="text-[14px] font-semibold leading-snug flex-1" style={{ color: '#1A2820' }}>
                    {post.title}
                  </p>
                  <span
                    className="flex-shrink-0 text-[11px] font-medium"
                    style={{ color: '#8A9C8C', whiteSpace: 'nowrap' }}
                  >
                    {fmtDate(post.publishedAt, post.publishDate, true)}
                  </span>
                </div>
                {post.description && (
                  <p
                    className="text-[13px] font-medium leading-relaxed"
                    style={{
                      color: '#4A6058',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {post.description}
                  </p>
                )}
              </a>
            ))}
          </div>
        ) : (
          <div className="px-5 py-5 text-sm" style={{ color: '#8A9C8C' }}>
            No posts match the selected filters.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-16 rounded-xl animate-pulse" style={{ background: '#E8E0D2' }} />
      <div className="h-10 rounded-xl animate-pulse" style={{ background: '#ECF0EC' }} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[500px] rounded-xl animate-pulse" style={{ background: '#ECF0EC' }} />
        ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CompetitorBlogs() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  const blogsQuery = useQuery({
    queryKey: ['competitor-blogs'],
    queryFn: () => api.competitorBlogs(600),
    staleTime: 120_000,
  })

  const data = blogsQuery.data

  const normalizedPosts = useMemo(() => {
    const posts = (data?.posts ?? [])
      .map(normalizePost)
      .filter((p): p is NormalizedPost => p !== null)
    posts.sort((a, b) => b.sortTime - a.sortTime || a.title.localeCompare(b.title))
    return posts
  }, [data?.posts])

  const sourceGroups = useMemo(() => {
    const map = new Map<string, SourceGroup>()
    for (const post of normalizedPosts) {
      const existing = map.get(post.sourceKey)
      if (existing) {
        existing.posts.push(post)
      } else {
        map.set(post.sourceKey, { source: post.source, sourceKey: post.sourceKey, posts: [post] })
      }
    }
    const groups = [...map.values()]
    for (const g of groups) {
      g.posts.sort((a, b) => b.sortTime - a.sortTime || a.title.localeCompare(b.title))
    }
    groups.sort((a, b) => b.posts.length - a.posts.length || (b.posts[0]?.sortTime ?? 0) - (a.posts[0]?.sortTime ?? 0))
    return groups
  }, [normalizedPosts])

  const typeTotals = useMemo(() => {
    const counts = new Map<string, number>()
    for (const post of normalizedPosts) counts.set(post.type, (counts.get(post.type) ?? 0) + 1)
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  }, [normalizedPosts])

  const monthAxis = useMemo(() => {
    const unique = new Set<string>()
    for (const post of normalizedPosts) {
      const mk = toMonthKey(post.publishedAt, post.publishDate)
      if (mk) unique.add(mk)
    }
    return [...unique].sort().slice(-8)
  }, [normalizedPosts])

  const toggleType = (type: string) =>
    setSelectedTypes((curr) =>
      curr.includes(type) ? curr.filter((t) => t !== type) : [...curr, type],
    )

  if (blogsQuery.isLoading) return <LoadingSkeleton />

  if (blogsQuery.isError) {
    return (
      <div
        className="rounded-xl border p-4"
        style={{ background: '#FFFFFF', borderColor: '#E7C6C6', color: '#8A2D2D' }}
      >
        {(blogsQuery.error as Error)?.message || 'Unable to load competitor blog data.'}
      </div>
    )
  }

  if (normalizedPosts.length === 0) {
    return (
      <div className="rounded-xl border p-5" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
          Competitor Blogs
        </h2>
        <p className="mt-2 text-sm" style={{ color: '#6F8571' }}>
          No blog posts found yet. Apply migration{' '}
          <code>supabase/sql/005_competitor_blog_posts.sql</code> and push your workflow output using{' '}
          <code>scripts/push_competitor_blogs_to_supabase.py</code>.
        </p>
      </div>
    )
  }

  const topTheme = typeTotals[0]?.type ?? '—'
  const latestDate = normalizedPosts[0]
    ? fmtDate(normalizedPosts[0].publishedAt, normalizedPosts[0].publishDate)
    : '—'

  return (
    <div className="max-w-[1460px] space-y-4 pb-4">

      {/* ── Compact header ──────────────────────────────────────────────── */}
      <section
        className="rounded-xl border px-5 py-4"
        style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold tracking-tight" style={{ color: '#1E2E20' }}>
              Competitor Blogs
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#7A8E7C' }}>
              Publishing cadence, themes, and posts across {sourceGroups.length} tracked competitors
            </p>
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            {[
              { label: 'Posts', value: String(normalizedPosts.length) },
              { label: 'Competitors', value: String(sourceGroups.length) },
              { label: 'Top Theme', value: topTheme },
              { label: 'Latest', value: latestDate },
            ].map(({ label, value }, i, arr) => (
              <div key={label} className="flex items-center gap-5">
                <div className="text-right sm:text-center">
                  <div className="text-sm font-semibold tracking-tight" style={{ color: '#1E2E20' }}>
                    {value}
                  </div>
                  <div
                    className="text-[9px] uppercase tracking-[0.14em] font-semibold mt-0.5"
                    style={{ color: '#8A9C8C' }}
                  >
                    {label}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ width: 1, height: 28, background: '#E8E0D2', flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Theme filter strip ──────────────────────────────────────────── */}
      {typeTotals.length > 0 && (
        <section
          className="rounded-xl border px-4 py-3"
          style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[10px] uppercase tracking-[0.14em] font-semibold flex-shrink-0"
              style={{ color: '#8A9C8C' }}
            >
              Themes
            </span>
            <button
              type="button"
              onClick={() => setSelectedTypes([])}
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
                border: '1px solid #DDD0BC',
                background: selectedTypes.length === 0 ? '#EEF3EE' : '#FFFFFF',
                color: '#3D5C40',
                cursor: 'pointer',
              }}
            >
              All
            </button>
            {typeTotals.map(({ type, count }) => {
              const sel = selectedTypes.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 500,
                    border: `1px solid ${sel ? '#3D5C40' : '#DDD0BC'}`,
                    background: sel ? '#3D5C40' : '#FFFFFF',
                    color: sel ? '#FFF' : '#4A5E4C',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  {type}
                  <span style={{ opacity: 0.6, fontSize: 10 }}>{count}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Company cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sourceGroups.map((group, index) => (
          <CompanyCard
            key={group.sourceKey}
            group={group}
            index={index}
            monthAxis={monthAxis}
            selectedTypes={selectedTypes}
          />
        ))}
      </div>
    </div>
  )
}
