import { useMemo, type ReactNode } from 'react'
import type { CitationRef } from '../types'

function isValidCitationBounds(
  ref: CitationRef,
  textLength: number,
): ref is CitationRef & { startIndex: number; endIndex: number } {
  return (
    typeof ref.startIndex === 'number' &&
    Number.isFinite(ref.startIndex) &&
    typeof ref.endIndex === 'number' &&
    Number.isFinite(ref.endIndex) &&
    ref.startIndex >= 0 &&
    ref.endIndex > ref.startIndex &&
    ref.endIndex <= textLength
  )
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

type CitationRichOutputProps = {
  text: string
  citationRefs?: CitationRef[]
  citations?: string[]
  emptyText?: string
}

export default function CitationRichOutput({
  text,
  citationRefs = [],
  citations = [],
  emptyText = 'No output text recorded.',
}: CitationRichOutputProps) {
  const normalizedText = text ?? ''
  const normalizedRefs = Array.isArray(citationRefs) ? citationRefs : []

  const orderedRefs = useMemo(() => {
    const seen = new Set<string>()
    const refs = normalizedRefs
      .filter((ref) => typeof ref.url === 'string' && ref.url.trim().length > 0)
      .slice()
      .sort((left, right) => {
        const leftEnd =
          typeof left.endIndex === 'number' && Number.isFinite(left.endIndex)
            ? left.endIndex
            : Number.POSITIVE_INFINITY
        const rightEnd =
          typeof right.endIndex === 'number' && Number.isFinite(right.endIndex)
            ? right.endIndex
            : Number.POSITIVE_INFINITY
        if (leftEnd !== rightEnd) return leftEnd - rightEnd
        return left.url.localeCompare(right.url)
      })
    return refs.filter((ref) => {
      const key = `${ref.url}|${ref.title}|${ref.host}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [normalizedRefs])

  const anchoredRefs = useMemo(
    () => orderedRefs.filter((ref) => isValidCitationBounds(ref, normalizedText.length)),
    [orderedRefs, normalizedText.length],
  )

  const inlineText = useMemo(() => {
    if (!normalizedText) return null
    if (anchoredRefs.length === 0) return normalizedText

    const refsByEnd = new Map<number, CitationRef[]>()
    for (const ref of anchoredRefs) {
      const endIndex = ref.endIndex as number
      const bucket = refsByEnd.get(endIndex) ?? []
      bucket.push(ref)
      refsByEnd.set(endIndex, bucket)
    }

    const nodes: ReactNode[] = []
    const orderedEnds = [...refsByEnd.keys()].sort((left, right) => left - right)
    let cursor = 0

    for (const endIndex of orderedEnds) {
      if (endIndex > cursor) {
        nodes.push(normalizedText.slice(cursor, endIndex))
        cursor = endIndex
      }
      const refsForEnd = refsByEnd.get(endIndex) ?? []
      for (const ref of refsForEnd) {
        const label = truncate(ref.title || ref.host || 'source', 28)
        nodes.push(
          <a
            key={`inline-${ref.id}`}
            href={ref.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginLeft: 6,
              marginRight: 2,
              marginTop: 1,
              marginBottom: 1,
              padding: '1px 8px',
              borderRadius: 999,
              border: '1px solid #DDD0BC',
              background: '#F2EDE6',
              color: '#3D5840',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '15px',
              textDecoration: 'none',
              verticalAlign: 'middle',
            }}
          >
            {label}
          </a>,
        )
      }
    }

    if (cursor < normalizedText.length) {
      nodes.push(normalizedText.slice(cursor))
    }

    return nodes
  }, [anchoredRefs, normalizedText])

  const fallbackCitations = useMemo(() => {
    if (orderedRefs.length > 0) {
      return orderedRefs.map((ref) => ref.url)
    }
    return [...new Set((citations ?? []).map((item) => String(item ?? '').trim()).filter(Boolean))]
  }, [citations, orderedRefs])
  const showAnchoredLayout = anchoredRefs.length > 0

  if (!normalizedText.trim()) {
    return (
      <div
        className="rounded-lg px-3 py-3 text-sm"
        style={{ background: '#FDFCF8', border: '1px solid #F2EDE6', color: '#9AAE9C' }}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: showAnchoredLayout ? 'minmax(0, 1fr) minmax(230px, 300px)' : '1fr',
      }}
    >
      <div
        className="rounded-lg px-3 py-3 text-sm whitespace-pre-wrap"
        style={{ background: '#FDFCF8', border: '1px solid #F2EDE6', color: '#2A3A2C', lineHeight: 1.5 }}
      >
        {inlineText}
      </div>

      {showAnchoredLayout ? (
        <div
          className="rounded-lg px-3 py-3"
          style={{ background: '#FFFFFF', border: '1px solid #E5DDD0' }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: '#9AAE9C', marginBottom: 8 }}
          >
            Citations
          </div>
          <div className="space-y-2">
            {orderedRefs.map((ref, index) => (
              <a
                key={`panel-${ref.id}`}
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  background: '#FDFCF8',
                  border: '1px solid #F2EDE6',
                  borderRadius: 8,
                  padding: '8px 9px',
                }}
              >
                <div style={{ fontSize: 10, color: '#9AAE9C', marginBottom: 2 }}>
                  #{index + 1} · {ref.host || 'source'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#2A3A2C',
                    fontWeight: 600,
                    lineHeight: 1.3,
                    marginBottom: ref.snippet ? 3 : 0,
                  }}
                >
                  {truncate(ref.title || ref.url, 70)}
                </div>
                {ref.snippet && (
                  <div style={{ fontSize: 11, color: '#607860', lineHeight: 1.35 }}>
                    {truncate(ref.snippet, 130)}
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      ) : fallbackCitations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {fallbackCitations.slice(0, 8).map((citation, index) => {
            const isLink = /^https?:\/\//i.test(citation)
            if (isLink) {
              return (
                <a
                  key={`fallback-link-${index}`}
                  href={citation}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
                >
                  source {index + 1}
                </a>
              )
            }
            return (
              <span
                key={`fallback-text-${index}`}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: '#F2EDE6', color: '#3D5840', border: '1px solid #DDD0BC' }}
              >
                {truncate(citation, 64)}
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
