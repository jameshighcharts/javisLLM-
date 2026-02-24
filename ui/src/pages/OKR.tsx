import Highcharts from 'highcharts/highcharts-gantt'
import DraggablePoints from 'highcharts/modules/draggable-points'
import HighchartsReact from 'highcharts-react-official'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import KR21ResourcePlanner from '../components/KR21ResourcePlanner'
import { buildTaskColorMap, getTaskColorById } from '../utils/taskColors'

const initDraggablePoints = DraggablePoints as unknown as (chartingLibrary: typeof Highcharts) => void
if (typeof initDraggablePoints === 'function') {
  initDraggablePoints(Highcharts)
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const HOUR_MS = 60 * 60 * 1000
const OKR_GANTT_ROW_HEIGHT = 72
const OKR_GANTT_HEADER_HEIGHT = 68
const OKR_GANTT_WEEK_COL_WIDTH = 154

const OKR_GANTT_THEME = {
  timelineBg: '#FAF8F3',
  timelinePanel: '#F6F1E8',
  timelinePanelSoft: '#F6F1E8',
  timelineGrid: '#E0D5C4',
  timelineAxis: '#6E8370',
  timelineAxisSub: '#7A8E7C',
  timelineText: '#1F2B21',
  timelineTextMuted: '#6E8370',
  badgeBg: '#213124',
  today: '#D49880',
  deadline: '#C8A87A',
}

function normalizeOwner(owner: string): string {
  const trimmed = owner.trim()
  return trimmed.length > 0 ? trimmed : 'Unassigned'
}

function toDateInputValueFromMs(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function pickNumber(
  values: Highcharts.Dictionary<number> | undefined,
  keys: string[],
): number | null {
  if (!values) return null
  for (const key of keys) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function getDraggedEnd(
  event: Highcharts.PointDragEventObject | Highcharts.PointDropEventObject,
  pointId: string | null,
): number | null {
  const candidates: Highcharts.PointDragDropObject[] = []
  if ('newPoint' in event && event.newPoint) candidates.push(event.newPoint)
  if (pointId && event.newPoints?.[pointId]) candidates.push(event.newPoints[pointId])
  for (const key of Object.keys(event.newPoints ?? {})) {
    candidates.push(event.newPoints[key])
  }
  for (const candidate of candidates) {
    const next = pickNumber(candidate.newValues, ['x2', 'end'])
    if (next !== null) return next
  }
  return null
}

function getDraggedStart(
  event: Highcharts.PointDragEventObject | Highcharts.PointDropEventObject,
  pointId: string | null,
): number | null {
  const candidates: Highcharts.PointDragDropObject[] = []
  if ('newPoint' in event && event.newPoint) candidates.push(event.newPoint)
  if (pointId && event.newPoints?.[pointId]) candidates.push(event.newPoints[pointId])
  for (const key of Object.keys(event.newPoints ?? {})) {
    candidates.push(event.newPoints[key])
  }
  for (const candidate of candidates) {
    const next = pickNumber(candidate.newValues, ['x', 'start', 'x1'])
    if (next !== null) return next
  }
  return null
}

function getDraggedY(
  event: Highcharts.PointDragEventObject | Highcharts.PointDropEventObject,
  pointId: string | null,
): number | null {
  const candidates: Highcharts.PointDragDropObject[] = []
  if ('newPoint' in event && event.newPoint) candidates.push(event.newPoint)
  if (pointId && event.newPoints?.[pointId]) candidates.push(event.newPoints[pointId])
  for (const key of Object.keys(event.newPoints ?? {})) {
    candidates.push(event.newPoints[key])
  }
  for (const candidate of candidates) {
    const next = pickNumber(candidate.newValues, ['y'])
    if (next !== null) return next
  }
  return null
}

function getPointId(point: Highcharts.Point): string | null {
  const candidate = point as Highcharts.Point & {
    id?: string
    options?: { id?: string; custom?: { taskId?: string } }
  }
  return candidate.id ?? candidate.options?.id ?? candidate.options?.custom?.taskId ?? null
}

function getPointEndMs(point: Highcharts.Point): number {
  const candidate = point as Highcharts.Point & {
    end?: number
    x2?: number
    options?: { end?: number; x2?: number }
  }
  return candidate.end ?? candidate.x2 ?? candidate.options?.end ?? candidate.options?.x2 ?? Date.now()
}

function getPointStartMs(point: Highcharts.Point): number {
  const candidate = point as Highcharts.Point & {
    start?: number
    x?: number
    options?: { start?: number; x?: number }
  }
  return candidate.start ?? candidate.x ?? candidate.options?.start ?? candidate.options?.x ?? Date.now()
}

function snapToNearestWeek(value: number): number {
  return Math.round(value / WEEK_MS) * WEEK_MS
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function textColorFor(hex: string): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return '#F8FBF4'
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.65 ? '#1F2B21' : '#F8FBF4'
}

type ComparisonStatus = 'ideation' | 'draft' | 'qa' | 'launched'

interface ComparisonPage {
  id: string
  title: string
  status: ComparisonStatus
  qualityScore: number
  launchedOn: string | null
}

interface WorkstreamTask {
  id: string
  label: string
  owner: string
  start: string
  end: string
  progress: number
  pagesTarget: number
  dependency?: string
}

type DragMode = 'move' | 'resize-start' | 'resize-end'

interface TimelineDraftTask {
  id: string
  owner: string
  startMs: number
  endMs: number
}

interface DragSession {
  taskId: string
  originalOwner: string
  originalStartMs: number
  originalEndMs: number
  linkedLeftTaskId: string | null
  linkedRightTaskId: string | null
  mode: DragMode | null
}

function toTimelineDraftTask(task: WorkstreamTask): TimelineDraftTask {
  return {
    id: task.id,
    owner: normalizeOwner(task.owner),
    startMs: parseDate(task.start),
    endMs: parseDate(task.end),
  }
}

function sortTimelineDraftTasks(a: TimelineDraftTask, b: TimelineDraftTask): number {
  if (a.startMs === b.startMs) return a.endMs - b.endMs
  return a.startMs - b.startMs
}

function inferDragMode(
  originalStartMs: number,
  originalEndMs: number,
  draggedStart: number | null,
  draggedEnd: number | null,
): DragMode {
  if (draggedStart !== null && draggedEnd === null) return 'resize-start'
  if (draggedEnd !== null && draggedStart === null) return 'resize-end'
  if (draggedStart === null && draggedEnd === null) return 'move'
  const originalSpan = originalEndMs - originalStartMs
  const nextStart = draggedStart ?? originalStartMs
  const nextEnd = draggedEnd ?? originalEndMs
  const nextSpan = nextEnd - nextStart
  if (Math.abs(nextSpan - originalSpan) < 1) return 'move'
  return Math.abs(nextStart - originalStartMs) >= Math.abs(nextEnd - originalEndMs)
    ? 'resize-start'
    : 'resize-end'
}

function getTimelineBounds(
  drafts: TimelineDraftTask[],
  owner: string,
  activeTaskId: string,
  startMs: number,
  endMs: number,
): { minStart: number; maxEnd: number } {
  let minStart = Number.NEGATIVE_INFINITY
  let maxEnd = Number.POSITIVE_INFINITY
  for (const task of drafts) {
    if (task.id === activeTaskId || task.owner !== owner) continue
    if (task.startMs < endMs) minStart = Math.max(minStart, task.endMs)
    if (task.endMs > startMs) maxEnd = Math.min(maxEnd, task.startMs)
  }
  return { minStart, maxEnd }
}

function resolveSingleTrackDrag(input: {
  drafts: TimelineDraftTask[]
  taskId: string
  targetOwner: string
  draftStartMs: number
  draftEndMs: number
  mode: DragMode
  linkedLeftTaskId: string | null
  linkedRightTaskId: string | null
  allowLinkedPush: boolean
}): Map<string, TimelineDraftTask> {
  const {
    drafts,
    taskId,
    targetOwner,
    draftStartMs,
    draftEndMs,
    mode,
    linkedLeftTaskId,
    linkedRightTaskId,
    allowLinkedPush,
  } = input

  const byId = new Map(drafts.map((task) => [task.id, { ...task }]))
  const active = byId.get(taskId)
  if (!active) return new Map()

  const originalOwner = active.owner
  const originalStartMs = active.startMs
  const originalEndMs = active.endMs

  active.owner = targetOwner
  let startMs = draftStartMs
  let endMs = draftEndMs

  if (endMs <= startMs) {
    if (mode === 'resize-start') startMs = endMs - WEEK_MS
    else endMs = startMs + WEEK_MS
  }
  if (endMs - startMs < WEEK_MS) {
    if (mode === 'resize-start') startMs = endMs - WEEK_MS
    else endMs = startMs + WEEK_MS
  }

  const updates = new Map<string, TimelineDraftTask>()

  if (mode === 'resize-start') {
    let linkedPushApplied = false
    if (allowLinkedPush && linkedLeftTaskId) {
      const linkedLeft = byId.get(linkedLeftTaskId)
      if (linkedLeft && linkedLeft.owner === targetOwner) {
        const minBoundary = linkedLeft.startMs + WEEK_MS
        const maxBoundary = endMs - WEEK_MS
        if (maxBoundary >= minBoundary) {
          const boundary = clamp(startMs, minBoundary, maxBoundary)
          startMs = boundary
          linkedLeft.endMs = boundary
          updates.set(linkedLeft.id, { ...linkedLeft })
          linkedPushApplied = true
        }
      }
    }

    if (!linkedPushApplied) {
      const { minStart } = getTimelineBounds(drafts, targetOwner, taskId, startMs, endMs)
      const maxStart = endMs - WEEK_MS
      if (maxStart < minStart) startMs = minStart
      else startMs = clamp(startMs, minStart, maxStart)
    }
  } else if (mode === 'resize-end') {
    let linkedPushApplied = false
    if (allowLinkedPush && linkedRightTaskId) {
      const linkedRight = byId.get(linkedRightTaskId)
      if (linkedRight && linkedRight.owner === targetOwner) {
        const minBoundary = startMs + WEEK_MS
        const maxBoundary = linkedRight.endMs - WEEK_MS
        if (maxBoundary >= minBoundary) {
          const boundary = clamp(endMs, minBoundary, maxBoundary)
          endMs = boundary
          linkedRight.startMs = boundary
          updates.set(linkedRight.id, { ...linkedRight })
          linkedPushApplied = true
        }
      }
    }

    if (!linkedPushApplied) {
      const { maxEnd } = getTimelineBounds(drafts, targetOwner, taskId, startMs, endMs)
      const minEnd = startMs + WEEK_MS
      if (maxEnd < minEnd) endMs = minEnd
      else endMs = clamp(endMs, minEnd, maxEnd)
    }
  } else {
    const duration = Math.max(WEEK_MS, endMs - startMs)
    endMs = startMs + duration
    let attempts = 0
    while (attempts < 4) {
      const { minStart, maxEnd } = getTimelineBounds(drafts, active.owner, taskId, startMs, endMs)
      const maxStart = maxEnd - duration
      if (maxStart < minStart) {
        active.owner = originalOwner
        startMs = originalStartMs
        endMs = originalEndMs
        break
      }
      const clampedStart = clamp(startMs, minStart, maxStart)
      if (Math.abs(clampedStart - startMs) < 1) break
      startMs = clampedStart
      endMs = startMs + duration
      attempts += 1
    }
  }

  active.startMs = startMs
  active.endMs = Math.max(startMs + WEEK_MS, endMs)
  updates.set(active.id, { ...active })
  return updates
}

function normalizeTimelineByOwner(drafts: TimelineDraftTask[]): TimelineDraftTask[] {
  const rows = new Map<string, TimelineDraftTask[]>()
  for (const task of drafts) {
    const owner = normalizeOwner(task.owner)
    const row = rows.get(owner) ?? []
    row.push({ ...task, owner })
    rows.set(owner, row)
  }

  const normalized: TimelineDraftTask[] = []
  for (const row of rows.values()) {
    row.sort(sortTimelineDraftTasks)
    for (let index = 0; index < row.length; index += 1) {
      const current = row[index]
      if (current.endMs <= current.startMs) current.endMs = current.startMs + WEEK_MS
      if (current.endMs - current.startMs < WEEK_MS) current.endMs = current.startMs + WEEK_MS
      if (index > 0) {
        const previous = row[index - 1]
        if (current.startMs < previous.endMs) {
          const span = Math.max(WEEK_MS, current.endMs - current.startMs)
          current.startMs = previous.endMs
          current.endMs = current.startMs + span
        }
      }
      normalized.push(current)
    }
  }

  return normalized
}

const STATUS_META: Record<ComparisonStatus, { label: string; bg: string; color: string }> = {
  ideation: { label: 'Ideation', bg: '#F2EDE6', color: '#7A8E7C' },
  draft: { label: 'Draft', bg: '#FFF3E8', color: '#C16A2C' },
  qa: { label: 'QA', bg: '#EAF2FF', color: '#245A95' },
  launched: { label: 'Launched', bg: '#E8F6EA', color: '#25693A' },
}

const INITIAL_PAGES: ComparisonPage[] = [
  { id: 'page-1', title: 'AG Charts vs Highcharts', status: 'launched', qualityScore: 88, launchedOn: '2026-02-18' },
  { id: 'page-2', title: 'Recharts vs Highcharts', status: 'launched', qualityScore: 84, launchedOn: '2026-02-26' },
  { id: 'page-3', title: 'ECharts vs Highcharts', status: 'launched', qualityScore: 81, launchedOn: '2026-03-04' },
  { id: 'page-4', title: 'Chart.js vs Highcharts', status: 'qa', qualityScore: 79, launchedOn: null },
  { id: 'page-5', title: 'D3 vs Highcharts', status: 'qa', qualityScore: 83, launchedOn: null },
  { id: 'page-6', title: 'ApexCharts vs Highcharts', status: 'draft', qualityScore: 74, launchedOn: null },
  { id: 'page-7', title: 'Plotly vs Highcharts', status: 'draft', qualityScore: 72, launchedOn: null },
  { id: 'page-8', title: 'Nivo vs Highcharts', status: 'draft', qualityScore: 76, launchedOn: null },
  { id: 'page-9', title: 'Victory vs Highcharts', status: 'ideation', qualityScore: 68, launchedOn: null },
  { id: 'page-10', title: 'Observable Plot vs Highcharts', status: 'ideation', qualityScore: 65, launchedOn: null },
]

const INITIAL_TASKS: WorkstreamTask[] = [
  {
    id: 'phase-discovery',
    label: 'Query intent map + competitive angle definitions',
    owner: 'A',
    start: '2026-02-20',
    end: '2026-03-02',
    progress: 100,
    pagesTarget: 0,
  },
  {
    id: 'phase-template',
    label: 'Template + checklist instrumentation',
    owner: 'J',
    start: '2026-02-27',
    end: '2026-03-14',
    progress: 82,
    pagesTarget: 0,
    dependency: 'phase-discovery',
  },
  {
    id: 'phase-batch-1',
    label: 'Ship batch 1 (pages 1-5)',
    owner: 'M',
    start: '2026-03-08',
    end: '2026-04-12',
    progress: 64,
    pagesTarget: 5,
    dependency: 'phase-template',
  },
  {
    id: 'phase-batch-2',
    label: 'Ship batch 2 (pages 6-10)',
    owner: 'A',
    start: '2026-04-01',
    end: '2026-05-20',
    progress: 36,
    pagesTarget: 5,
    dependency: 'phase-batch-1',
  },
  {
    id: 'phase-polish',
    label: 'Final QA + internal linking + launch QA sweep',
    owner: 'J',
    start: '2026-05-11',
    end: '2026-05-31',
    progress: 18,
    pagesTarget: 0,
    dependency: 'phase-batch-2',
  },
]

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  borderRadius: 9,
  border: '1px solid #D8CCB8',
  background: '#FFFFFF',
  color: '#2A3A2C',
  padding: '8px 10px',
  fontSize: 13,
  lineHeight: 1.3,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00`)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function formatDateShort(value: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function velocityLabel(value: number): string {
  if (!Number.isFinite(value)) return 'inf'
  return value.toFixed(1)
}

function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: bg, color }}
    >
      {text}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  tone = 'neutral',
  badge,
  bar,
}: {
  label: string
  value: string
  sub: string
  tone?: 'neutral' | 'positive' | 'warning'
  badge?: string
  bar?: { pct: number; color: string }
}) {
  const dot   = { positive: '#4A6B4E', warning: '#C06040', neutral: '#A8B0A8' }[tone]
  const badgeBg    = { positive: '#E8F5EA', warning: '#FAF0EB', neutral: '#F0ECE6' }[tone]
  const badgeColor = { positive: '#2D6335', warning: '#A04530', neutral: '#607060' }[tone]

  return (
    <article
      style={{
        background: '#FFFFFF',
        border: '1px solid #E8E2D8',
        borderRadius: 16,
        padding: '16px 18px 14px',
        boxShadow: '0 1px 4px rgba(30,40,30,0.06)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Label + badge row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: '#9AA49C', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
            {label}
          </span>
        </div>
        {badge && (
          <span style={{ background: badgeBg, color: badgeColor, fontSize: 9, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {badge}
          </span>
        )}
      </div>

      {/* Value */}
      <p className="tabular-nums" style={{ color: '#18231A', fontSize: 26, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        {value}
      </p>

      {/* Sub */}
      <p style={{ color: '#7A8C7C', fontSize: 11, marginTop: 6, lineHeight: 1.5, flexGrow: 1 }}>
        {sub}
      </p>

      {/* Progress bar */}
      {bar && (
        <div style={{ marginTop: 14, height: 3, background: '#EDE7DE', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${bar.pct}%`, background: bar.color, borderRadius: 2, transition: 'width 0.35s ease' }} />
        </div>
      )}
    </article>
  )
}

// ── Small chevron icon ─────────────────────────────────────────────────────────
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      style={{ transition: 'transform 0.18s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6L15 12L9 18" />
    </svg>
  )
}

// ── Workstream accordion card ──────────────────────────────────────────────────
function WorkstreamCard({
  task,
  timelineTaskColor,
  allTasks,
  expanded,
  onToggle,
  onPatch,
  onRemove,
}: {
  task: WorkstreamTask
  timelineTaskColor: string
  allTasks: WorkstreamTask[]
  expanded: boolean
  onToggle: () => void
  onPatch: (next: Partial<WorkstreamTask>) => void
  onRemove: () => void
}) {
  const progressColor = task.progress === 100 ? '#4A6B4E' : task.progress >= 60 ? '#6A9A6E' : task.progress >= 30 ? '#C8A87A' : '#D49880'
  const depTask = allTasks.find((t) => t.id === task.dependency)

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: expanded ? '#A9C8AA' : '#E0D5C4',
        background: expanded ? '#F7FAF7' : '#FCFBF8',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Summary row — always visible */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 10px 8px' }}>
        <button
          type="button"
          onClick={onToggle}
          style={{ marginTop: 2, flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: '#7A8E7C' }}
          aria-label="Toggle workstream"
        >
          <ChevronIcon open={expanded} />
        </button>

        {/* Label — full text, wraps naturally */}
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0 }}
        >
          <span
            className="text-[13px] font-medium leading-snug"
            style={{ color: '#1F2B21', display: 'block' }}
          >
            {task.label}
          </span>
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ marginTop: 1 }}>
          <span
            aria-hidden="true"
            title="Resource timeline color"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: timelineTaskColor,
              border: '1px solid rgba(255,255,255,0.8)',
              boxShadow: `0 0 0 1px ${timelineTaskColor}55`,
            }}
          />
          {task.owner && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: '#EAF2EA', color: '#3A6B3E' }}
            >
              {task.owner}
            </span>
          )}

          <span
            className="tabular-nums text-[11px] font-bold"
            style={{ color: progressColor, minWidth: 30, textAlign: 'right' }}
          >
            {task.progress}%
          </span>

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            aria-label="Remove workstream"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: '1px solid #E0D5C4',
              background: '#FFF8F5',
              color: '#B06040',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Progress bar — prominent, full-width */}
      <div style={{ padding: '0 10px 10px' }}>
        <div style={{ height: 6, background: '#EDE5D8', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${task.progress}%`,
              background: progressColor,
              borderRadius: 4,
              transition: 'width 0.25s ease',
              boxShadow: `0 0 6px ${progressColor}55`,
            }}
          />
        </div>
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div className="p-3 pt-3 space-y-2" style={{ borderTop: '1px solid #E0D5C4', marginTop: 6 }}>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Workstream label</span>
            <input
              value={task.label}
              onChange={(e) => onPatch({ label: e.target.value })}
              style={INPUT_STYLE}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Owner</span>
              <input
                value={task.owner}
                onChange={(e) => onPatch({ owner: e.target.value })}
                style={INPUT_STYLE}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Pages target</span>
              <input
                type="number"
                min={0}
                max={20}
                value={task.pagesTarget}
                onChange={(e) => onPatch({ pagesTarget: clamp(Number(e.target.value) || 0, 0, 20) })}
                style={INPUT_STYLE}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Start</span>
              <input
                type="date"
                value={task.start}
                onChange={(e) => onPatch({ start: e.target.value })}
                style={INPUT_STYLE}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>End</span>
              <input
                type="date"
                value={task.end}
                onChange={(e) => onPatch({ end: e.target.value })}
                style={INPUT_STYLE}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>
              Depends on
            </span>
            <select
              value={task.dependency ?? ''}
              onChange={(e) => onPatch({ dependency: e.target.value || undefined })}
              style={{ ...INPUT_STYLE }}
            >
              <option value="">— none —</option>
              {allTasks
                .filter((t) => t.id !== task.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {truncate(t.label, 42)}
                  </option>
                ))}
            </select>
            {depTask && (
              <span className="text-[11px]" style={{ color: '#7A8E7C' }}>
                ↳ after <b>{truncate(depTask.label, 32)}</b>
              </span>
            )}
          </label>

          {/* Progress slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Progress</span>
              <input
                type="number"
                min={0}
                max={100}
                value={task.progress}
                onChange={(e) => onPatch({ progress: clamp(Number(e.target.value) || 0, 0, 100) })}
                style={{ ...INPUT_STYLE, width: 72, padding: '5px 8px', textAlign: 'right' }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={task.progress}
              onChange={(e) => onPatch({ progress: clamp(Number(e.target.value) || 0, 0, 100) })}
              className="w-full"
              style={{ accentColor: progressColor }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function OKR() {
  const [krTitle, setKrTitle] = useState(
    'KR 2.1: Create and launch 10 LLM-optimized comparison pages (individual pages, e.g. "AG charts vs Highcharts") that score >= 80% on the quality checklist by May 31, 2026.',
  )
  const [targetPages, setTargetPages] = useState(10)
  const [qualityThreshold, setQualityThreshold] = useState(80)
  const [deadline, setDeadline] = useState('2026-05-31')
  const [checklistName, setChecklistName] = useState('LLM Comparison Quality Checklist v1')
  const [pages, setPages] = useState<ComparisonPage[]>(INITIAL_PAGES)
  const [tasks, setTasks] = useState<WorkstreamTask[]>(INITIAL_TASKS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [krEditing, setKrEditing] = useState(false)
  const [timelineQuery, setTimelineQuery] = useState('')
  const [resizeBadge, setResizeBadge] = useState<{ left: number; top: number; hours: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [isTimelinePanning, setIsTimelinePanning] = useState(false)
  const [activeOwner, setActiveOwner] = useState<string | null>(null)

  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const timelinePanRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null)
  const tasksRef = useRef<WorkstreamTask[]>(tasks)
  const dragSessionRef = useRef<DragSession | null>(null)
  const dragPreviewRef = useRef<Map<string, TimelineDraftTask>>(new Map())

  const todayIso = toIsoDate(new Date())
  const todayMs = parseDate(todayIso)
  const deadlineMs = parseDate(deadline)
  const taskColorMap = useMemo(() => buildTaskColorMap(tasks.map((task) => task.id)), [tasks])

  // ── Metrics ────────────────────────────────────────────────────────────────
  const launchedPages = useMemo(() => pages.filter((p) => p.status === 'launched'), [pages])
  const launchedCount = launchedPages.length
  const remainingPages = Math.max(targetPages - launchedCount, 0)
  const launchProgressPct = targetPages > 0 ? clamp((launchedCount / targetPages) * 100, 0, 100) : 0
  const avgLaunchedQuality = average(launchedPages.map((p) => p.qualityScore))
  const qualityPassCount = launchedPages.filter((p) => p.qualityScore >= qualityThreshold).length
  const qualityPassRate = launchedCount > 0 ? (qualityPassCount / launchedCount) * 100 : 0
  const taskProgressPct = average(tasks.map((t) => t.progress))
  const blendedProgressPct = clamp(launchProgressPct * 0.62 + qualityPassRate * 0.2 + taskProgressPct * 0.18, 0, 100)
  const earliestTaskStartMs = tasks.length > 0 ? Math.min(...tasks.map((t) => parseDate(t.start))) : todayMs
  const elapsedWeeks = Math.max((todayMs - earliestTaskStartMs) / WEEK_MS, 1)
  const currentVelocity = launchedCount / elapsedWeeks
  const daysRemaining = Math.ceil((deadlineMs - todayMs) / DAY_MS)
  const weeksRemaining = Math.max(daysRemaining / 7, 0)
  const requiredVelocity =
    daysRemaining <= 0 && remainingPages > 0
      ? Number.POSITIVE_INFINITY
      : weeksRemaining > 0
        ? remainingPages / weeksRemaining
        : 0
  const qualityReady = launchedCount === 0 ? false : avgLaunchedQuality >= qualityThreshold
  const onTrack =
    remainingPages === 0
      ? qualityPassCount === launchedCount
      : Number.isFinite(requiredVelocity)
        ? currentVelocity >= requiredVelocity && qualityReady
        : false

  const visibleTasks = useMemo(() => {
    const query = timelineQuery.trim().toLowerCase()
    if (!query) return tasks
    return tasks.filter((task) => {
      const owner = normalizeOwner(task.owner).toLowerCase()
      return task.label.toLowerCase().includes(query) || owner.includes(query)
    })
  }, [tasks, timelineQuery])

  const ownerRows = useMemo(() => {
    const seen = new Set<string>()
    const rows: string[] = []
    for (const task of visibleTasks) {
      const owner = normalizeOwner(task.owner)
      if (!seen.has(owner)) {
        seen.add(owner)
        rows.push(owner)
      }
    }
    if (rows.length === 0 && tasks.length === 0) rows.push('Unassigned')
    return rows
  }, [tasks.length, visibleTasks])

  const ownerIndex = useMemo(() => {
    return new Map(ownerRows.map((owner, index) => [owner, index]))
  }, [ownerRows])

  const activeOwnerTasks = useMemo(() => {
    if (!activeOwner) return []
    return tasks.filter((task) => normalizeOwner(task.owner) === activeOwner)
  }, [activeOwner, tasks])

  const timelineRange = useMemo(() => {
    const allTimes = visibleTasks.flatMap((task) => [parseDate(task.start), parseDate(task.end)])
    const fallbackStart = parseDate('2026-02-20')
    const fallbackEnd = parseDate('2026-05-31')
    const minRaw = allTimes.length > 0 ? Math.min(...allTimes) : fallbackStart
    const maxRaw = allTimes.length > 0 ? Math.max(...allTimes) : fallbackEnd
    const min = Math.floor((minRaw - WEEK_MS) / WEEK_MS) * WEEK_MS
    const max = Math.ceil((maxRaw + WEEK_MS) / WEEK_MS) * WEEK_MS
    const weekCount = Math.max(6, Math.round((max - min) / WEEK_MS))
    return { min, max, weekCount }
  }, [visibleTasks])

  const executionTimelineWidth = useMemo(
    () => Math.max(940, (timelineRange.weekCount + 1) * OKR_GANTT_WEEK_COL_WIDTH),
    [timelineRange.weekCount],
  )

  const executionTimelineHeight = useMemo(
    () => OKR_GANTT_HEADER_HEIGHT + Math.max(1, ownerRows.length) * OKR_GANTT_ROW_HEIGHT,
    [ownerRows.length],
  )

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    if (hoveredTaskId && !visibleTasks.some((task) => task.id === hoveredTaskId)) {
      setHoveredTaskId(null)
    }
  }, [hoveredTaskId, visibleTasks])

  useEffect(() => {
    if (activeOwner && !ownerRows.includes(activeOwner)) {
      setActiveOwner(null)
    }
  }, [activeOwner, ownerRows])

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || isDragging) return
    const container = timelineScrollRef.current
    if (!container) return
    const target = event.target as HTMLElement
    if (
      target.closest('.highcharts-point') ||
      target.closest('.highcharts-point-drag-handle') ||
      target.closest('.highcharts-label')
    ) {
      return
    }
    timelinePanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
    }
    setIsTimelinePanning(true)
    container.setPointerCapture?.(event.pointerId)
  }

  function handleTimelinePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = timelinePanRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const container = timelineScrollRef.current
    if (!container) return
    const deltaX = event.clientX - state.startX
    container.scrollLeft = state.startScrollLeft - deltaX
  }

  function handleTimelinePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = timelinePanRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const container = timelineScrollRef.current
    container?.releasePointerCapture?.(event.pointerId)
    timelinePanRef.current = null
    setIsTimelinePanning(false)
  }

  // ── Burn-up chart data ─────────────────────────────────────────────────────
  const checkpointDates = useMemo(() => {
    const start = Math.min(earliestTaskStartMs, todayMs)
    const end = Math.max(deadlineMs, start + DAY_MS)
    return Array.from({ length: 9 }, (_, i) => start + ((end - start) * i) / 8)
  }, [deadlineMs, earliestTaskStartMs, todayMs])

  const plannedCumulative = useMemo(
    () => checkpointDates.map((_, i) => Number(((targetPages * i) / 8).toFixed(2))),
    [checkpointDates, targetPages],
  )

  const actualCumulative = useMemo(
    () =>
      checkpointDates.map(
        (cp) =>
          pages.filter(
            (p) => p.status === 'launched' && p.launchedOn && parseDate(p.launchedOn) <= cp,
          ).length,
      ),
    [checkpointDates, pages],
  )

  const projectedCumulative = useMemo(() => {
    const start = checkpointDates[0] ?? todayMs
    return checkpointDates.map((cp) => {
      const weeksFromStart = Math.max((cp - start) / WEEK_MS, 0)
      return Number(Math.min(targetPages, currentVelocity * weeksFromStart).toFixed(2))
    })
  }, [checkpointDates, currentVelocity, targetPages, todayMs])

  // ── Execution timeline gantt (drag between owners + resize) ───────────────
  const ganttOptions = useMemo<Highcharts.Options>(() => {
    return {
      chart: {
        type: 'gantt',
        height: executionTimelineHeight,
        width: executionTimelineWidth,
        backgroundColor: OKR_GANTT_THEME.timelineBg,
        spacing: [0, 8, 0, 8],
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      navigator: { enabled: false },
      scrollbar: { enabled: false },
      rangeSelector: { enabled: false },
      accessibility: { enabled: false },
      xAxis: {
        top: 0,
        height: OKR_GANTT_HEADER_HEIGHT,
        offset: 0,
        zIndex: 6,
        min: timelineRange.min,
        max: timelineRange.max,
        tickInterval: WEEK_MS,
        currentDateIndicator: {
          enabled: true,
          color: OKR_GANTT_THEME.today,
          width: 2,
          dashStyle: 'ShortDot',
          label: { style: { color: OKR_GANTT_THEME.timelineAxisSub, fontSize: '11px' } },
        },
        plotLines: [
          {
            value: deadlineMs,
            color: OKR_GANTT_THEME.deadline,
            width: 2,
            dashStyle: 'Dash',
            zIndex: 4,
            label: {
              text: 'KR deadline',
              align: 'right',
              x: -6,
              y: 12,
              style: { color: OKR_GANTT_THEME.timelineAxisSub, fontSize: '11px', fontWeight: '600' },
            },
          },
        ],
        lineColor: OKR_GANTT_THEME.timelineGrid,
        lineWidth: 1,
        gridLineColor: OKR_GANTT_THEME.timelineGrid,
        gridLineWidth: 1,
        tickColor: OKR_GANTT_THEME.timelineGrid,
        labels: {
          useHTML: true,
          y: 18,
          style: { color: OKR_GANTT_THEME.timelineAxis, fontSize: '11px', fontWeight: '600', zIndex: '7' },
          formatter: function formatter(this: Highcharts.AxisLabelsFormatterContextObject): string {
            const raw = typeof this.value === 'number' ? this.value : Number(this.value)
            const date = new Date(raw)
            const month = date.toLocaleDateString('en-US', { month: 'short' })
            const day = date.getDate()
            const weekLabel = `WEEK ${Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7)}`
            return `<div style="display:flex;flex-direction:column;line-height:1.05;"><span style="color:${OKR_GANTT_THEME.timelineAxis};font-size:11px;font-weight:650;">${month} ${day}</span><span style="color:${OKR_GANTT_THEME.timelineAxisSub};font-size:10px;font-weight:600;letter-spacing:0.06em;margin-top:3px;">${weekLabel}</span></div>`
          },
        },
      },
      yAxis: {
        type: 'category',
        staticScale: OKR_GANTT_ROW_HEIGHT,
        top: OKR_GANTT_HEADER_HEIGHT,
        height: Math.max(1, ownerRows.length) * OKR_GANTT_ROW_HEIGHT,
        categories: ownerRows,
        grid: { borderColor: OKR_GANTT_THEME.timelineGrid },
        labels: { enabled: false },
        min: -0.5,
        max: Math.max(ownerRows.length - 0.5, 0.5),
        plotBands: ownerRows.map((_, index) => ({
          from: index - 0.5,
          to: index + 0.5,
          color: index % 2 === 0 ? 'rgba(255,255,255,0.62)' : 'rgba(248,243,236,0.66)',
        })),
      },
      tooltip: {
        enabled: !isDragging,
        useHTML: true,
        backgroundColor: '#FFFFFF',
        borderColor: '#D8CCB8',
        borderRadius: 8,
        borderWidth: 1,
        shadow: false,
        padding: 10,
        formatter: function pointFormatter(this: Highcharts.TooltipFormatterContextObject): string {
          const p = this.point as Highcharts.Point & {
            options?: {
              custom?: {
                owner?: string
                pagesTarget?: number
                progress?: number
                subtitle?: string
                color?: string
                textColor?: string
              }
            }
          }
          const owner = p.options?.custom?.owner ?? 'Unassigned'
          const pagesTarget = p.options?.custom?.pagesTarget ?? 0
          const progress = p.options?.custom?.progress ?? 0
          const subtitle = p.options?.custom?.subtitle ?? 'No summary'
          return [
            `<div style="min-width:168px;">`,
            `<div style="font-size:12px;color:#2A3A2C;font-weight:700;margin-bottom:4px;">${this.point.name ?? 'Workstream'}</div>`,
            `<div style="font-size:11px;color:#5E765F;">${subtitle}</div>`,
            `<div style="font-size:11px;color:#5E765F;margin-top:6px;">${owner} • ${progress}%${pagesTarget > 0 ? ` • ${pagesTarget} pages` : ''}</div>`,
            `</div>`,
          ].join('')
        },
      },
      plotOptions: {
        series: {
          borderRadius: 6,
          pointPadding: 0.06,
          clip: true,
          animation: isDragging ? false : { duration: 220 },
          states: {
            hover: { enabled: true, brightness: 0.1, halo: { size: 0 } },
          },
        },
      },
      series: [
        {
          type: 'gantt',
          name: 'Execution timeline',
          dataLabels: {
            enabled: true,
            useHTML: true,
            inside: true,
            crop: false,
            overflow: 'allow',
            formatter: function formatter(this: Highcharts.PointLabelObject): string {
              const p = this.point as Highcharts.Point & {
                options?: { custom?: { subtitle?: string; taskId?: string; textColor?: string } }
              }
              const label = this.point.name ?? ''
              const subtitle = p.options?.custom?.subtitle ?? ''
              const textColor = p.options?.custom?.textColor ?? OKR_GANTT_THEME.timelineText
              const isActive = p.options?.custom?.taskId === hoveredTaskId
              return `<div style="display:flex;flex-direction:column;align-items:center;line-height:1.06;"><span style="font-size:10px;font-weight:700;color:${textColor};">${truncate(label, 30)}</span><span style="font-size:9px;font-weight:600;color:${rgba(textColor, 0.9)};opacity:${isActive ? '1' : '0'};max-height:${isActive ? '13px' : '0'};overflow:hidden;transform:translateY(${isActive ? '0' : '-2px'});transition:opacity 180ms ease,max-height 180ms ease,transform 180ms ease;margin-top:2px;">${truncate(subtitle, 28)}</span></div>`
            },
            style: {
              color: OKR_GANTT_THEME.timelineText,
              textOutline: 'none',
              fontWeight: '700',
              fontSize: '10px',
            },
          },
          dragDrop: {
            draggableStart: true,
            draggableEnd: true,
            draggableY: true,
            draggableX: false,
            draggableX1: true,
            draggableX2: true,
            dragPrecisionX: DAY_MS,
            dragPrecisionY: 1,
            dragSensitivity: 2,
            liveRedraw: true,
            dragHandle: {
              color: '#FFFFFF',
              lineColor: OKR_GANTT_THEME.timelineGrid,
              lineWidth: 1.25,
              zIndex: 9,
            },
          },
          data: visibleTasks.map((task) => {
            const owner = normalizeOwner(task.owner)
            const rowIndex = ownerIndex.get(owner) ?? 0
            const color = getTaskColorById(task.id, taskColorMap)
            const textColor = textColorFor(color)
            const subtitle = task.pagesTarget > 0
              ? `${task.pagesTarget} pages • ${task.progress}% progress`
              : `${task.progress}% progress`
            return {
              id: task.id,
              name: task.label,
              start: parseDate(task.start),
              end: parseDate(task.end),
              y: rowIndex,
              dependency: task.dependency,
              color,
              borderColor: 'rgba(255,255,255,0.28)',
              custom: {
                taskId: task.id,
                owner,
                pagesTarget: task.pagesTarget,
                progress: task.progress,
                subtitle,
                color,
                textColor,
              },
            }
          }) as Highcharts.XrangePointOptionsObject[],
          point: {
            events: {
              mouseOver: function mouseOver(this: Highcharts.Point): void {
                const pointId = getPointId(this)
                setHoveredTaskId(pointId)
                const graphic = (this as Highcharts.Point & { graphic?: { toFront?: () => void } }).graphic
                graphic?.toFront?.()
              },
              mouseOut: function mouseOut(this: Highcharts.Point): void {
                const pointId = getPointId(this)
                setHoveredTaskId((current) => (current === pointId ? null : current))
              },
              dragStart: function dragStart(this: Highcharts.Point): void {
                setIsDragging(true)
                setResizeBadge(null)
                setHoveredTaskId(null)
                this.series.chart.tooltip?.hide(0)

                const pointId = getPointId(this)
                if (!pointId) {
                  dragSessionRef.current = null
                  dragPreviewRef.current = new Map()
                  return
                }

                const drafts = tasksRef.current.map(toTimelineDraftTask)
                const active = drafts.find((task) => task.id === pointId)
                if (!active) {
                  dragSessionRef.current = null
                  dragPreviewRef.current = new Map()
                  return
                }

                const rowTasks = drafts
                  .filter((task) => task.owner === active.owner && task.id !== active.id)
                  .sort(sortTimelineDraftTasks)

                const linkedLeftTaskId = rowTasks
                  .filter((task) => Math.abs(task.endMs - active.startMs) < HOUR_MS)
                  .sort((a, b) => b.endMs - a.endMs)[0]?.id ?? null

                const linkedRightTaskId = rowTasks
                  .filter((task) => Math.abs(task.startMs - active.endMs) < HOUR_MS)
                  .sort((a, b) => a.startMs - b.startMs)[0]?.id ?? null

                dragSessionRef.current = {
                  taskId: pointId,
                  originalOwner: active.owner,
                  originalStartMs: active.startMs,
                  originalEndMs: active.endMs,
                  linkedLeftTaskId,
                  linkedRightTaskId,
                  mode: null,
                }
                dragPreviewRef.current = new Map()
              },
              drag: function drag(
                this: Highcharts.Point,
                event: Highcharts.PointDragEventObject,
              ): void {
                const pointId = getPointId(this)
                if (!pointId) {
                  setResizeBadge(null)
                  return
                }

                const session = dragSessionRef.current
                if (!session || session.taskId !== pointId) {
                  setResizeBadge(null)
                  return
                }

                const draggedStart = getDraggedStart(event, pointId)
                const draggedEnd = getDraggedEnd(event, pointId)
                const draggedY = getDraggedY(event, pointId)
                if (draggedStart === null && draggedEnd === null && draggedY === null) {
                  setResizeBadge(null)
                  return
                }

                const mode = inferDragMode(
                  session.originalStartMs,
                  session.originalEndMs,
                  draggedStart,
                  draggedEnd,
                )
                session.mode = mode

                const chartPointStart = getPointStartMs(this)
                const chartPointEnd = getPointEndMs(this)
                let draftStartMs = draggedStart ?? chartPointStart
                let draftEndMs = draggedEnd ?? chartPointEnd

                if (draftEndMs <= draftStartMs) {
                  if (mode === 'resize-start') draftStartMs = draftEndMs - WEEK_MS
                  else draftEndMs = draftStartMs + WEEK_MS
                }
                if (draftEndMs - draftStartMs < WEEK_MS) {
                  if (mode === 'resize-start') draftStartMs = draftEndMs - WEEK_MS
                  else draftEndMs = draftStartMs + WEEK_MS
                }

                const nextRowIndex =
                  typeof draggedY === 'number' && Number.isFinite(draggedY)
                    ? clamp(Math.round(draggedY), 0, Math.max(ownerRows.length - 1, 0))
                    : null

                const targetOwner =
                  nextRowIndex === null
                    ? normalizeOwner(tasksRef.current.find((task) => task.id === pointId)?.owner ?? session.originalOwner)
                    : ownerRows[nextRowIndex] ?? session.originalOwner

                const resolved = resolveSingleTrackDrag({
                  drafts: tasksRef.current.map(toTimelineDraftTask),
                  taskId: pointId,
                  targetOwner,
                  draftStartMs,
                  draftEndMs,
                  mode,
                  linkedLeftTaskId: session.linkedLeftTaskId,
                  linkedRightTaskId: session.linkedRightTaskId,
                  allowLinkedPush: targetOwner === session.originalOwner && mode !== 'move',
                })

                if (resolved.size === 0) {
                  setResizeBadge(null)
                  return
                }

                dragPreviewRef.current = resolved

                let hasPointUpdates = false
                for (const [id, draft] of resolved.entries()) {
                  const point =
                    id === pointId
                      ? this
                      : this.series.points.find((candidate) => getPointId(candidate) === id)
                  if (!point) continue

                  const nextY = ownerIndex.get(draft.owner)
                  const updatePayload = {
                    start: draft.startMs,
                    end: draft.endMs,
                    x: draft.startMs,
                    x2: draft.endMs,
                  } as Highcharts.PointOptionsObject
                  if (typeof nextY === 'number' && Number.isFinite(nextY)) {
                    updatePayload.y = nextY
                  }

                  point.update(updatePayload, false, false)
                  hasPointUpdates = true
                }

                if (hasPointUpdates) {
                  this.series.chart.redraw(false)
                }

                const activeDraft = resolved.get(pointId)
                if (!activeDraft) {
                  setResizeBadge(null)
                  return
                }

                if (
                  Math.abs(activeDraft.startMs - session.originalStartMs) < 1 &&
                  Math.abs(activeDraft.endMs - session.originalEndMs) < 1
                ) {
                  setResizeBadge(null)
                  return
                }

                const hours = Math.max(1, Math.round((activeDraft.endMs - activeDraft.startMs) / HOUR_MS))
                const chart = this.series.chart
                const shape = (this as Highcharts.Point & { shapeArgs?: { y?: number } }).shapeArgs
                const anchorMs = mode === 'resize-start' ? activeDraft.startMs : activeDraft.endMs

                setResizeBadge({
                  left: this.series.xAxis.toPixels(anchorMs, false),
                  top: (shape?.y ?? 0) + chart.plotTop - 8,
                  hours,
                })
              },
              drop: function drop(
                this: Highcharts.Point,
                event: Highcharts.PointDropEventObject,
              ): void {
                setIsDragging(false)
                setResizeBadge(null)

                const pointId = getPointId(this)
                const session = dragSessionRef.current
                dragSessionRef.current = null
                dragPreviewRef.current = new Map()
                if (!pointId) return

                const draggedStart = getDraggedStart(event, pointId)
                const draggedEnd = getDraggedEnd(event, pointId)
                const draggedY = getDraggedY(event, pointId)
                const nextRowIndex =
                  typeof draggedY === 'number' && Number.isFinite(draggedY)
                    ? clamp(Math.round(draggedY), 0, Math.max(ownerRows.length - 1, 0))
                    : null
                const nextOwner = nextRowIndex === null ? null : ownerRows[nextRowIndex] ?? null

                const defaultMode = inferDragMode(
                  getPointStartMs(this),
                  getPointEndMs(this),
                  draggedStart,
                  draggedEnd,
                )
                const mode = session?.mode ?? defaultMode
                const chartPointStart = getPointStartMs(this)
                const chartPointEnd = getPointEndMs(this)
                const rawStartMs = draggedStart ?? chartPointStart
                const rawEndMs = draggedEnd ?? chartPointEnd
                let snappedStartMs = snapToNearestWeek(rawStartMs)
                let snappedEndMs = snapToNearestWeek(rawEndMs)

                if (snappedEndMs <= snappedStartMs) {
                  if (mode === 'resize-start') snappedStartMs = snappedEndMs - WEEK_MS
                  else snappedEndMs = snappedStartMs + WEEK_MS
                }
                if (snappedEndMs - snappedStartMs < WEEK_MS) {
                  if (mode === 'resize-start') snappedStartMs = snappedEndMs - WEEK_MS
                  else snappedEndMs = snappedStartMs + WEEK_MS
                }

                setTasks((currentTasks) => {
                  const drafts = currentTasks.map(toTimelineDraftTask)
                  const activeTask = drafts.find((task) => task.id === pointId)
                  if (!activeTask) return currentTasks

                  const targetOwner = nextOwner ?? activeTask.owner
                  const resolved = resolveSingleTrackDrag({
                    drafts,
                    taskId: pointId,
                    targetOwner,
                    draftStartMs: snappedStartMs,
                    draftEndMs: snappedEndMs,
                    mode,
                    linkedLeftTaskId: session?.linkedLeftTaskId ?? null,
                    linkedRightTaskId: session?.linkedRightTaskId ?? null,
                    allowLinkedPush: !!session && targetOwner === session.originalOwner && mode !== 'move',
                  })
                  if (resolved.size === 0) return currentTasks

                  const merged = currentTasks.map((task) => {
                    const next = resolved.get(task.id)
                    return next ?? toTimelineDraftTask(task)
                  })
                  const normalized = new Map(
                    normalizeTimelineByOwner(merged).map((task) => [task.id, task]),
                  )

                  return currentTasks.map((task) => {
                    const next = normalized.get(task.id)
                    if (!next) return task
                    const nextStart = toDateInputValueFromMs(next.startMs)
                    const nextEnd = toDateInputValueFromMs(next.endMs)
                    const ownerChanged = next.owner !== normalizeOwner(task.owner)
                    const startChanged = nextStart !== task.start
                    const endChanged = nextEnd !== task.end
                    if (!ownerChanged && !startChanged && !endChanged) return task
                    return {
                      ...task,
                      start: startChanged ? nextStart : task.start,
                      end: endChanged ? nextEnd : task.end,
                      owner: ownerChanged ? (next.owner === 'Unassigned' ? '' : next.owner) : task.owner,
                    }
                  })
                })
              },
            },
          },
        } as Highcharts.SeriesGanttOptions,
      ],
    }
  }, [deadlineMs, executionTimelineHeight, executionTimelineWidth, hoveredTaskId, isDragging, ownerIndex, ownerRows, taskColorMap, timelineRange.max, timelineRange.min, visibleTasks])

  const burnUpOptions = useMemo<Highcharts.Options>(
    () => ({
      chart: { type: 'spline', backgroundColor: 'transparent', height: 300, spacing: [8, 10, 8, 8] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { itemStyle: { color: '#2A3A2C', fontSize: '11px', fontWeight: '500' }, symbolRadius: 0 },
      xAxis: {
        categories: checkpointDates.map((v) => formatDateShort(v)),
        lineColor: '#D8CCB8',
        tickColor: '#D8CCB8',
        labels: { style: { color: '#6E8370', fontSize: '11px' } },
      },
      yAxis: {
        min: 0,
        max: Math.max(targetPages, 10),
        tickInterval: 1,
        title: { text: 'Pages', style: { color: '#6E8370', fontSize: '11px' } },
        gridLineColor: 'rgba(122,142,124,0.16)',
        labels: { style: { color: '#6E8370', fontSize: '11px' } },
      },
      tooltip: { shared: true, backgroundColor: '#FFFFFF', borderColor: '#D8CCB8', borderRadius: 8, shadow: false },
      series: [
        { type: 'spline', name: 'Planned', data: plannedCumulative, color: '#C8A87A', dashStyle: 'ShortDash', lineWidth: 2, marker: { enabled: false } },
        { type: 'spline', name: 'Actual', data: actualCumulative, color: '#4A6B4E', lineWidth: 3, marker: { enabled: true, radius: 3 } },
        { type: 'spline', name: 'Projected', data: projectedCumulative, color: '#A89CB8', dashStyle: 'Dot', lineWidth: 2, marker: { enabled: false } },
      ],
    }),
    [actualCumulative, checkpointDates, plannedCumulative, projectedCumulative, targetPages],
  )

  // ── Mutations ──────────────────────────────────────────────────────────────
  function patchPage(pageId: string, next: Partial<ComparisonPage>) {
    setPages((cur) => cur.map((p) => (p.id === pageId ? { ...p, ...next } : p)))
  }

  function patchTask(taskId: string, next: Partial<WorkstreamTask>) {
    setTasks((cur) => cur.map((t) => (t.id === taskId ? { ...t, ...next } : t)))
  }

  function addTask() {
    const id = `task-${Date.now()}`
    const endDate = toIsoDate(new Date(Date.now() + 14 * DAY_MS))
    setTasks((cur) => [
      ...cur,
      { id, label: 'New workstream', owner: 'A', start: todayIso, end: endDate, progress: 0, pagesTarget: 0 },
    ])
    setExpandedId(id)
  }

  function removeTask(taskId: string) {
    setTasks((cur) =>
      cur
        .filter((t) => t.id !== taskId)
        .map((t) => (t.dependency === taskId ? { ...t, dependency: undefined } : t)),
    )
    if (expandedId === taskId) setExpandedId(null)
  }

  const statusTone: 'positive' | 'warning' = onTrack ? 'positive' : 'warning'
  const daysTone: 'neutral' | 'warning' = daysRemaining > 14 ? 'neutral' : 'warning'

  return (
    <div className="space-y-4 pb-4">
      {/* ── KR header ──────────────────────────────────────────────────────── */}
      <section
        style={{
          background: '#FFFFFF',
          border: '1px solid #DDD0BC',
          borderTop: '2px solid #4A6B4E',
          borderRadius: 14,
          padding: '18px 22px 20px',
        }}
      >
        {/* Top row: breadcrumb + edit */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: '#9AAE9C', fontWeight: 500 }}>Objective 2</span>
            <span style={{ color: '#C8C0B4', fontSize: 11 }}>›</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#4A6B4E' }}>KR 2.1</span>
          </div>
          <button
            type="button"
            onClick={() => setKrEditing((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              borderRadius: 20,
              border: `1px solid ${krEditing ? '#4A6B4E' : '#DDD0BC'}`,
              background: krEditing ? '#4A6B4E' : '#FFFFFF',
              color: krEditing ? '#FDFCF8' : '#7A8A7C',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {krEditing ? (
              <>
                <svg width="9" height="9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Done
              </>
            ) : (
              <>
                <svg width="9" height="9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6.768-6.768a2 2 0 012.828 2.828L11.828 13.828a2 2 0 01-1.414.586H8v-2.414A2 2 0 018.586 10.6z" /></svg>
                Edit
              </>
            )}
          </button>
        </div>

        {/* KR statement */}
        {krEditing ? (
          <textarea
            value={krTitle}
            onChange={(e) => setKrTitle(e.target.value)}
            rows={2}
            autoFocus
            style={{ ...INPUT_STYLE, resize: 'none', fontSize: 13, lineHeight: 1.5, background: '#FDFCF8', marginBottom: 14, width: '100%' }}
          />
        ) : (
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1A2B1C', lineHeight: 1.5, marginBottom: 14, letterSpacing: '-0.01em' }}>
            {krTitle}
          </p>
        )}

        {/* Param chips */}
        {krEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {([
              {
                label: 'Pages',
                el: (
                  <input type="number" min={1} value={targetPages}
                    onChange={(e) => setTargetPages(clamp(Number(e.target.value) || 0, 1, 50))}
                    style={{ width: 42, borderRadius: 6, border: '1px solid #DDD0BC', background: '#FFF', color: '#2A3A2C', padding: '3px 5px', fontSize: 12, fontWeight: 700, textAlign: 'center' }}
                  />
                ),
              },
              {
                label: 'Threshold',
                el: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <input type="number" min={0} max={100} value={qualityThreshold}
                      onChange={(e) => setQualityThreshold(clamp(Number(e.target.value) || 0, 0, 100))}
                      style={{ width: 42, borderRadius: 6, border: '1px solid #DDD0BC', background: '#FFF', color: '#2A3A2C', padding: '3px 5px', fontSize: 12, fontWeight: 700, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: '#9AAE9C' }}>%</span>
                  </span>
                ),
              },
              {
                label: 'Deadline',
                el: (
                  <input type="date" value={deadline}
                    onChange={(e) => setDeadline(e.target.value || todayIso)}
                    style={{ borderRadius: 6, border: '1px solid #DDD0BC', background: '#FFF', color: '#2A3A2C', padding: '3px 6px', fontSize: 11 }}
                  />
                ),
              },
              {
                label: 'Checklist',
                el: (
                  <input value={checklistName}
                    onChange={(e) => setChecklistName(e.target.value)}
                    style={{ width: 160, borderRadius: 6, border: '1px solid #DDD0BC', background: '#FFF', color: '#2A3A2C', padding: '3px 7px', fontSize: 11 }}
                  />
                ),
              },
            ] as { label: string; el: ReactNode }[]).map(({ label, el }) => (
              <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9AAE9C' }}>{label}</span>
                {el}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Pages', value: `${targetPages} pages` },
              { label: 'Quality', value: `≥${qualityThreshold}%` },
              {
                label: 'Deadline',
                value: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${deadline}T00:00:00`)),
              },
              { label: 'Checklist', value: checklistName },
            ].map(({ label, value }) => (
              <span
                key={label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: '#F2EDE6',
                  border: '1px solid #E0D8CC',
                  borderRadius: 6,
                  padding: '3px 9px',
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9AAE9C' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2A3A2C' }}>{value}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Status"
          value={onTrack ? 'On track' : 'At risk'}
          sub={onTrack ? 'Launch pace and quality are above threshold.' : 'Velocity or quality pass rate is below target.'}
          tone={statusTone}
          badge={onTrack ? '✓ Good' : '⚠ Review'}
        />
        <MetricCard
          label="Launch velocity"
          value={`${velocityLabel(currentVelocity)} / wk`}
          sub={`Need ${velocityLabel(requiredVelocity)} pages/wk · ${remainingPages} pages remaining`}
          tone={statusTone}
          bar={{ pct: Number.isFinite(requiredVelocity) && requiredVelocity > 0 ? clamp((currentVelocity / requiredVelocity) * 100, 0, 100) : 100, color: statusTone === 'positive' ? '#4A6B4E' : '#C06040' }}
        />
        <MetricCard
          label="Avg quality"
          value={`${avgLaunchedQuality.toFixed(1)}%`}
          sub={`${qualityPassCount} of ${launchedCount || 0} launched pages pass ≥${qualityThreshold}%`}
          tone={avgLaunchedQuality >= qualityThreshold ? 'positive' : 'warning'}
          bar={{ pct: avgLaunchedQuality, color: avgLaunchedQuality >= qualityThreshold ? '#4A6B4E' : '#C8A87A' }}
        />
        <MetricCard
          label="Days remaining"
          value={daysRemaining > 0 ? `${daysRemaining} days` : daysRemaining === 0 ? 'Due today' : 'Past due'}
          sub={daysRemaining >= 0 ? `Deadline ${deadline}` : `${Math.abs(daysRemaining)} days past deadline`}
          tone={daysTone}
          bar={{ pct: clamp(100 - (daysRemaining / 97) * 100, 0, 100), color: daysTone === 'warning' ? '#C06040' : '#8A9C8C' }}
        />
      </section>

      <KR21ResourcePlanner tasks={tasks} onPatchTask={patchTask} />

      {/* ── 2×2 aligned grid: Gantt | Editor / Tracker | Burn-up ─────────────── */}
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">

        {/* [row 1, col 2] Workstream editor — accordion */}
        <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>Workstream Editor</h2>
              <p className="text-xs" style={{ color: '#6E8370' }}>
                Click to expand and edit. Every change updates the timeline instantly.
              </p>
            </div>
            <button
              type="button"
              onClick={addTask}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                borderRadius: 10,
                background: '#4A6B4E',
                color: '#FDFCF8',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              Add
            </button>
          </div>

          {tasks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center rounded-xl py-10 text-center"
              style={{ border: '1.5px dashed #D8CCB8', color: '#9aab9c' }}
            >
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ marginBottom: 8, opacity: 0.5 }}>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h5" />
              </svg>
              <p className="text-sm font-medium">No workstreams yet</p>
              <p className="mt-1 text-xs">Click Add to create your first workstream.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[560px] overflow-auto pr-0.5">
              {tasks.map((task) => (
                <WorkstreamCard
                  key={task.id}
                  task={task}
                  timelineTaskColor={getTaskColorById(task.id, taskColorMap)}
                  allTasks={tasks}
                  expanded={expandedId === task.id}
                  onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  onPatch={(next) => patchTask(task.id, next)}
                  onRemove={() => removeTask(task.id)}
                />
              ))}
            </div>
          )}
        </article>

        {/* [row 2, col 1] Comparison Page Tracker */}
        <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>Comparison Page Tracker</h2>
                <p className="text-xs mt-0.5" style={{ color: '#6E8370' }}>Update status, quality score, and launch date per page.</p>
              </div>
              <Pill text={`${launchedCount}/${targetPages} launched`} bg="#E8F6EA" color="#25693A" />
            </div>

            <div className="space-y-1.5 max-h-[480px] overflow-auto pr-0.5">
              {pages.map((page, index) => {
                const meta = STATUS_META[page.status]
                const passing = page.qualityScore >= qualityThreshold
                const qualityColor =
                  page.qualityScore >= 80 ? '#4A6B4E' : page.qualityScore >= 65 ? '#C8A87A' : '#D49880'

                return (
                  <div
                    key={page.id}
                    className="rounded-xl p-3"
                    style={{ background: '#FAFAF7', border: '1px solid #EDE5D6', transition: 'border-color 0.15s' }}
                  >
                    {/* Title + status row */}
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          className="text-[11px] font-bold tabular-nums flex-shrink-0"
                          style={{ color: '#C4B9A8', lineHeight: '1.6', minWidth: 18 }}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span
                          className="text-[13px] font-medium leading-snug"
                          style={{ color: '#1F2B21' }}
                        >
                          {page.title}
                        </span>
                      </div>

                      {/* Status — styled pill select */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <select
                          value={page.status}
                          onChange={(e) => {
                            const s = e.target.value as ComparisonStatus
                            if (s === 'launched' && !page.launchedOn) {
                              patchPage(page.id, { status: s, launchedOn: todayIso })
                            } else if (s !== 'launched') {
                              patchPage(page.id, { status: s, launchedOn: null })
                            } else {
                              patchPage(page.id, { status: s })
                            }
                          }}
                          style={{
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            background: meta.bg,
                            color: meta.color,
                            border: `1px solid ${meta.color}33`,
                            borderRadius: 20,
                            padding: '4px 26px 4px 12px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            letterSpacing: '0.01em',
                          }}
                        >
                          {(Object.keys(STATUS_META) as ComparisonStatus[]).map((s) => (
                            <option value={s} key={s}>{STATUS_META[s].label}</option>
                          ))}
                        </select>
                        <svg
                          width="10" height="10" viewBox="0 0 10 10" fill="none"
                          style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                        >
                          <path d="M2 3.5L5 6.5L8 3.5" stroke={meta.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>

                    {/* Quality bar + score + date row */}
                    <div className="flex items-center gap-3">
                      {/* Score input */}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={page.qualityScore}
                        onChange={(e) =>
                          patchPage(page.id, { qualityScore: clamp(Number(e.target.value) || 0, 0, 100) })
                        }
                        style={{
                          flexShrink: 0,
                          width: 52,
                          borderRadius: 8,
                          border: '1px solid #DDD0BC',
                          background: '#FFF',
                          color: qualityColor,
                          padding: '4px 6px',
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: 'center',
                          lineHeight: 1.3,
                        }}
                      />

                      {/* Mini quality bar + pass label */}
                      <div className="flex-1 min-w-0">
                        <div style={{ height: 5, background: '#EDE5D8', borderRadius: 4, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${page.qualityScore}%`,
                              background: qualityColor,
                              borderRadius: 4,
                              transition: 'width 0.25s ease',
                              boxShadow: `0 0 5px ${qualityColor}55`,
                            }}
                          />
                        </div>
                        <div
                          className="mt-1 text-[11px] font-semibold"
                          style={{ color: passing ? '#3A8A4E' : '#B06040' }}
                        >
                          {passing ? '✓ Pass' : '✗ Below target'}
                        </div>
                      </div>

                      {/* Launch date — only when launched */}
                      {page.status === 'launched' ? (
                        <input
                          type="date"
                          value={page.launchedOn ?? ''}
                          onChange={(e) => patchPage(page.id, { launchedOn: e.target.value || null })}
                          style={{
                            flexShrink: 0,
                            borderRadius: 8,
                            border: '1px solid #DDD0BC',
                            background: '#FFF',
                            color: '#2A3A2C',
                            padding: '4px 7px',
                            fontSize: 11,
                            width: 130,
                          }}
                        />
                      ) : (
                        <span
                          className="text-[11px] flex-shrink-0 tabular-nums"
                          style={{ color: '#C4B9A8' }}
                        >
                          Not launched
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </article>

        {/* [row 2, col 2] Launch Trend vs Plan */}
        <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>Launch Trend vs Plan</h2>
            <p className="text-xs" style={{ color: '#6E8370' }}>Planned vs actual cumulative launches, plus projection at current pace.</p>
          </div>
          <HighchartsReact highcharts={Highcharts} options={burnUpOptions} />
        </article>

      </section>
    </div>
  )
}
