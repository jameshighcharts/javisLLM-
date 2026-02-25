import { useEffect, useMemo, useRef, useState } from 'react'
import { buildTaskColorMap, getTaskColorById } from '../utils/taskColors'

const DAY_MS = 24 * 60 * 60 * 1000
const ROW_HEIGHT = 110
const HEADER_HEIGHT = 48
const DAY_WIDTH = 45
const MIN_TIMELINE_DAYS = 14
const EXTRA_SCOPE_WEEKS = 1
const TODAY_LEFT_MARGIN_DAYS = 1
const CLOSE_MASK_DURATION_MS = 560
const DRAG_CLICK_THRESHOLD_PX = 5
const TASK_POPUP_WIDTH = 278
const SPLIT_INSERT_SNAP_DAYS = 0.46
const UI_FONT = "'Avenir Next', 'Manrope', 'Segoe UI', sans-serif"
const ROW_PADDING_Y = 10
const LANE_GAP = 4

type MemberId = 'A' | 'J' | 'M'

type DragMode = 'move' | 'resize-left' | 'resize-right'

interface TeamMember {
  id: MemberId
  name: string
  role: string
  accent: string
}

interface ResourceTask {
  id: string
  sourceTaskId: string
  project: string
  color: string
  memberId: MemberId
  startDay: number
  endDay: number
  actionItem: string
  subtasks: string[]
}

interface DragState {
  taskId: string
  mode: DragMode
  startClientX: number
  startClientY: number
  originStartDay: number
  originEndDay: number
  originMemberId: MemberId
  originTasks: ResourceTask[]
  pointerId: number
}

interface DragBadge {
  left: number
  top: number
  days: number
}

interface SplitInsertPreview {
  memberId: MemberId
  day: number
}

interface TaskStackLayout {
  lane: number
  laneCount: number
}

interface TaskFrame {
  left: number
  width: number
  top: number
  height: number
}

interface PlannerTask {
  id: string
  label: string
  owner: string
  start: string
  end: string
  progress: number
  pagesTarget: number
  dependency?: string
}

interface KR21ResourcePlannerProps {
  tasks: PlannerTask[]
  onPatchTask: (taskId: string, next: Partial<PlannerTask>) => void
}

const THEME = {
  timelineBg: '#FDFCF8',
  timelinePanel: '#FFFFFF',
  timelinePanelSoft: 'rgba(253, 252, 248, 0.97)',
  timelineGrid: '#DDD0BC',
  timelineAxis: '#2A3A2C',
  timelineAxisSub: '#8FAE92',
  timelineText: '#2A3A2C',
  timelineTextMuted: '#9AAE9C',
  badgeBg: '#FFFFFF',
  closeMask: '#F2EDE6',
  detailBg: '#F2EDE6',
  detailSurface: '#FFFFFF',
  detailBorder: '#DDD0BC',
  detailText: '#2A3A2C',
  detailMuted: '#6B7E6F',
} as const

const TEAM_MEMBERS: TeamMember[] = [
  { id: 'A', name: 'A', role: 'Strategy + Content', accent: '#8FBB93' },
  { id: 'J', name: 'J', role: 'Design + UX', accent: '#C8A87A' },
  { id: 'M', name: 'M', role: 'Build + QA', accent: '#8EA8C8' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
  if (normalized.length !== 6) return '#2A3A2C'
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.50 ? '#2A3A2C' : '#FDFCF8'
}

function parseIsoDateToUtcMs(value: string): number {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10))
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  }
  return Date.UTC(year, month - 1, day)
}

function toIsoDateFromUtcMs(value: number): string {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateShortFromUtcMs(value: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(value)
}

function formatDateDayMonthFromUtcMs(value: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(value)
}

function getTodayUtcMs(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

function normalizeMemberId(owner: string): MemberId {
  const first = owner.trim().toUpperCase().charAt(0)
  if (first === 'J') return 'J'
  if (first === 'M') return 'M'
  return 'A'
}

function avatarDataUrl(initial: string, color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88' viewBox='0 0 88 88' fill='none'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${color}'/><stop offset='1' stop-color='${color}' stop-opacity='0.62'/></linearGradient></defs><rect width='88' height='88' rx='44' fill='url(#g)'/><text x='44' y='54' text-anchor='middle' fill='white' font-size='30' font-family='Avenir Next, Manrope, sans-serif' font-weight='700'>${initial}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function getTaskDurationDays(task: ResourceTask): number {
  return Math.max(1, task.endDay - task.startDay)
}

function buildTaskStackLayout(tasks: ResourceTask[]): Map<string, TaskStackLayout> {
  const layouts = new Map<string, TaskStackLayout>()

  for (const member of TEAM_MEMBERS) {
    const rowTasks = tasks
      .filter((task) => task.memberId === member.id)
      .sort((a, b) => {
        if (a.startDay !== b.startDay) return a.startDay - b.startDay
        return a.endDay - b.endDay
      })

    if (rowTasks.length === 0) continue

    let cluster: ResourceTask[] = []
    let clusterEnd = -1

    const flushCluster = () => {
      if (cluster.length === 0) return

      const assignments = new Map<string, number>()
      const active: Array<{ lane: number; endDay: number }> = []
      const freeLanes: number[] = []
      let laneCursor = 0
      let maxOverlap = 1

      for (const task of cluster) {
        for (let index = active.length - 1; index >= 0; index -= 1) {
          if (active[index].endDay <= task.startDay) {
            freeLanes.push(active[index].lane)
            active.splice(index, 1)
          }
        }

        freeLanes.sort((a, b) => a - b)
        const lane = freeLanes.length > 0 ? freeLanes.shift() ?? 0 : laneCursor++
        assignments.set(task.id, lane)
        active.push({ lane, endDay: task.endDay })
        maxOverlap = Math.max(maxOverlap, active.length)
      }

      for (const task of cluster) {
        layouts.set(task.id, {
          lane: assignments.get(task.id) ?? 0,
          laneCount: maxOverlap,
        })
      }

      cluster = []
      clusterEnd = -1
    }

    for (const task of rowTasks) {
      if (cluster.length === 0) {
        cluster = [task]
        clusterEnd = task.endDay
        continue
      }

      if (task.startDay < clusterEnd) {
        cluster.push(task)
        clusterEnd = Math.max(clusterEnd, task.endDay)
      } else {
        flushCluster()
        cluster = [task]
        clusterEnd = task.endDay
      }
    }

    flushCluster()
  }

  return layouts
}

function sortTasksByStart(tasks: ResourceTask[]): ResourceTask[] {
  return [...tasks].sort((a, b) => {
    if (a.startDay !== b.startDay) return a.startDay - b.startDay
    return a.endDay - b.endDay
  })
}

function findSplitInsertDay(
  tasks: ResourceTask[],
  movingTaskId: string,
  targetMemberId: MemberId,
  proposedStartDay: number,
  span: number,
  timelineDayCount: number,
): number | null {
  if (span < 1) return null

  const rowTasks = sortTasksByStart(
    tasks.filter((task) => task.memberId === targetMemberId && task.id !== movingTaskId),
  )
  if (rowTasks.length === 0) return null

  const candidateDays = new Set<number>()
  candidateDays.add(rowTasks[0].startDay)

  for (let index = 1; index < rowTasks.length; index += 1) {
    const previous = rowTasks[index - 1]
    const next = rowTasks[index]
    if (previous.endDay <= next.startDay) {
      candidateDays.add(next.startDay)
    }
  }

  candidateDays.add(rowTasks[rowTasks.length - 1].endDay)

  let bestDay: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const day of candidateDays) {
    if (day < 0 || day + span > timelineDayCount) continue

    const shiftTargets = rowTasks.filter((task) => task.startDay >= day)
    if (shiftTargets.length === 0) continue

    const maxShiftedEnd = Math.max(...shiftTargets.map((task) => task.endDay))
    if (maxShiftedEnd + span > timelineDayCount) continue

    const distance = Math.abs(proposedStartDay - day)
    if (distance > SPLIT_INSERT_SNAP_DAYS || distance >= bestDistance) continue

    bestDay = day
    bestDistance = distance
  }

  return bestDay
}

export default function KR21ResourcePlanner({ tasks: plannerTasks, onPatchTask }: KR21ResourcePlannerProps) {
  const [tasks, setTasks] = useState<ResourceTask[]>([])
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [subtaskChecks, setSubtaskChecks] = useState<Record<string, boolean[]>>({})
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragBadge, setDragBadge] = useState<DragBadge | null>(null)
  const [splitInsertPreview, setSplitInsertPreview] = useState<SplitInsertPreview | null>(null)
  const [todayUtcMs, setTodayUtcMs] = useState<number>(getTodayUtcMs)

  const [focusMemberId, setFocusMemberId] = useState<MemberId | null>(null)
  const [focusMounted, setFocusMounted] = useState(false)
  const [focusActive, setFocusActive] = useState(false)
  const [focusAnchor, setFocusAnchor] = useState<{ left: number; top: number; size: number } | null>(null)
  const [closingMask, setClosingMask] = useState(false)

  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrollMax, setScrollMax] = useState(0)
  const [isScrollSliderHeld, setIsScrollSliderHeld] = useState(false)

  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const timelineBodyRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const tasksRef = useRef<ResourceTask[]>(tasks)

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const memberIndex = useMemo(() => new Map(TEAM_MEMBERS.map((m, index) => [m.id, index])), [])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      const nextToday = getTodayUtcMs()
      setTodayUtcMs((current) => (current === nextToday ? current : nextToday))
    }, 60_000)
    return () => window.clearInterval(timerId)
  }, [])

  const timelineScope = useMemo(() => {
    const parsedTaskRanges = plannerTasks.map((task) => {
      const startMs = parseIsoDateToUtcMs(task.start)
      const endMsRaw = parseIsoDateToUtcMs(task.end)
      const endMs = endMsRaw > startMs ? endMsRaw : startMs + DAY_MS
      return { startMs, endMs }
    })
    const maxTaskEndMs =
      parsedTaskRanges.length > 0
        ? Math.max(...parsedTaskRanges.map((range) => range.endMs))
        : todayUtcMs + 7 * DAY_MS

    const scopeStartMs = todayUtcMs - TODAY_LEFT_MARGIN_DAYS * DAY_MS
    const minEndMs = scopeStartMs + MIN_TIMELINE_DAYS * DAY_MS
    const scopeEndMs = Math.max(minEndMs, maxTaskEndMs + EXTRA_SCOPE_WEEKS * 7 * DAY_MS)
    const dayCount = Math.max(MIN_TIMELINE_DAYS, Math.ceil((scopeEndMs - scopeStartMs) / DAY_MS))
    return { scopeStartMs, scopeEndMs, dayCount, todayUtcMs }
  }, [plannerTasks, todayUtcMs])

  const timelineStartMs = timelineScope.scopeStartMs
  const timelineDayCount = timelineScope.dayCount
  const timelineWidth = timelineDayCount * DAY_WIDTH
  const timelineHeight = TEAM_MEMBERS.length * ROW_HEIGHT
  const taskColorMap = useMemo(
    () => buildTaskColorMap(plannerTasks.map((task) => task.id)),
    [plannerTasks],
  )

  const mappedPlannerTasks = useMemo<ResourceTask[]>(() => {
    if (plannerTasks.length === 0) return []
    return plannerTasks.map((task) => {
      const startMs = parseIsoDateToUtcMs(task.start)
      const rawEndMs = parseIsoDateToUtcMs(task.end)
      const endMs = rawEndMs > startMs ? rawEndMs : startMs + DAY_MS
      const startDay = clamp(Math.floor((startMs - timelineStartMs) / DAY_MS), 0, timelineDayCount - 1)
      const endDay = clamp(
        Math.ceil((endMs - timelineStartMs) / DAY_MS),
        startDay + 1,
        timelineDayCount,
      )
      return {
        id: task.id,
        sourceTaskId: task.id,
        project: task.label,
        color: getTaskColorById(task.id, taskColorMap),
        memberId: normalizeMemberId(task.owner),
        startDay,
        endDay,
        actionItem: `${task.progress}% progress${task.pagesTarget > 0 ? ` · ${task.pagesTarget} pages` : ''}`,
        subtasks: [
          `Owner ${normalizeMemberId(task.owner)}`,
          `Schedule ${task.start} to ${task.end}`,
          task.dependency ? `Depends on ${task.dependency}` : 'No dependency',
          task.pagesTarget > 0 ? `Scope ${task.pagesTarget} pages` : 'No page target',
        ],
      }
    })
  }, [plannerTasks, taskColorMap, timelineDayCount, timelineStartMs])

  const sliderMax = Math.max(1, scrollMax)
  const sliderValue = Math.min(scrollLeft, sliderMax)
  const sliderRatio = sliderMax > 0 ? sliderValue / sliderMax : 0
  const sliderDay = clamp(Math.round(sliderValue / DAY_WIDTH), 0, Math.max(0, timelineDayCount - 1))
  const sliderWeek = Math.floor(sliderDay / 7) + 1
  const sliderDateLabel = formatDateDayMonthFromUtcMs(timelineStartMs + sliderDay * DAY_MS)

  useEffect(() => {
    if (dragState) return
    setTasks(mappedPlannerTasks)
  }, [dragState, mappedPlannerTasks])

  const weekSegments = useMemo(() => {
    const segments: Array<{ week: number; startDay: number; endDay: number }> = []
    let startDay = 0
    let week = 1
    while (startDay < timelineDayCount) {
      const endDay = Math.min(startDay + 7, timelineDayCount)
      segments.push({ week, startDay, endDay })
      startDay = endDay
      week += 1
    }
    return segments
  }, [timelineDayCount])
  const weekGridDays = useMemo(
    () => [...new Set([...weekSegments.map((segment) => segment.startDay), timelineDayCount])].sort(
      (left, right) => left - right,
    ),
    [timelineDayCount, weekSegments],
  )
  const todayDay = useMemo(() => {
    const dayOffset = Math.floor((timelineScope.todayUtcMs - timelineStartMs) / DAY_MS)
    return clamp(dayOffset, 0, Math.max(0, timelineDayCount - 1))
  }, [timelineDayCount, timelineScope.todayUtcMs, timelineStartMs])
  const todayWeekNumber = Math.floor(todayDay / 7) + 1
  const todayStepPath = useMemo(() => {
    const baseX = todayDay * DAY_WIDTH
    let currentX = baseX
    let path = `M ${baseX} 0`
    for (let row = 0; row < TEAM_MEMBERS.length; row += 1) {
      const rowBottom = (row + 1) * ROW_HEIGHT
      const nextX = row % 2 === 0 ? baseX + 8 : baseX
      path += ` L ${currentX} ${rowBottom - 10} L ${nextX} ${rowBottom}`
      currentX = nextX
    }
    return path
  }, [todayDay])

  const taskStackLayout = useMemo(() => buildTaskStackLayout(tasks), [tasks])
  const taskFrames = useMemo(() => {
    const frames = new Map<string, TaskFrame>()
    const rowContentHeight = ROW_HEIGHT - ROW_PADDING_Y * 2

    for (const task of tasks) {
      const row = memberIndex.get(task.memberId) ?? 0
      const stackLayout = taskStackLayout.get(task.id) ?? { lane: 0, laneCount: 1 }
      const laneCount = Math.max(1, stackLayout.laneCount)
      const laneHeight = (rowContentHeight - (laneCount - 1) * LANE_GAP) / laneCount
      const top =
        row * ROW_HEIGHT +
        ROW_PADDING_Y +
        stackLayout.lane * (laneHeight + LANE_GAP)

      frames.set(task.id, {
        left: task.startDay * DAY_WIDTH + 4,
        width: Math.max(16, (task.endDay - task.startDay) * DAY_WIDTH - 8),
        top,
        height: laneHeight,
      })
    }

    return frames
  }, [memberIndex, taskStackLayout, tasks])

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks],
  )

  const selectedTaskFrame = useMemo(
    () => (selectedTask ? taskFrames.get(selectedTask.id) ?? null : null),
    [selectedTask, taskFrames],
  )

  const selectedTaskChecks = useMemo(
    () =>
      selectedTask
        ? subtaskChecks[selectedTask.id] ?? selectedTask.subtasks.map(() => false)
        : [],
    [selectedTask, subtaskChecks],
  )

  const selectedTaskDoneCount = useMemo(
    () =>
      selectedTask
        ? selectedTask.subtasks.reduce(
            (count, _, index) => count + (selectedTaskChecks[index] ? 1 : 0),
            0,
          )
        : 0,
    [selectedTask, selectedTaskChecks],
  )

  const selectedTaskPopupPosition = useMemo(() => {
    if (!selectedTaskFrame) return { left: 0, top: 0, side: 'right' as 'right' | 'left' }
    const rightLeft = selectedTaskFrame.left + selectedTaskFrame.width + 12
    const leftLeft = selectedTaskFrame.left - TASK_POPUP_WIDTH - 12
    const vertCenter = selectedTaskFrame.top + selectedTaskFrame.height / 2
    if (rightLeft + TASK_POPUP_WIDTH <= timelineWidth - 8) {
      return { left: rightLeft, top: vertCenter, side: 'right' as const }
    }
    return { left: Math.max(8, leftLeft), top: vertCenter, side: 'left' as const }
  }, [selectedTaskFrame, timelineWidth])

  const conflictTaskIds = useMemo(() => {
    const conflicts = new Set<string>()
    for (const member of TEAM_MEMBERS) {
      const memberTasks = tasks
        .filter((task) => task.memberId === member.id)
        .sort((a, b) => a.startDay - b.startDay)
      for (let i = 1; i < memberTasks.length; i += 1) {
        const prev = memberTasks[i - 1]
        const next = memberTasks[i]
        if (next.startDay < prev.endDay) {
          conflicts.add(prev.id)
          conflicts.add(next.id)
        }
      }
    }
    return conflicts
  }, [tasks])

  const memberStats = useMemo(() => {
    return TEAM_MEMBERS.map((member) => {
      const memberTasks = tasks.filter((task) => task.memberId === member.id)
      const totalDays = memberTasks.reduce((sum, task) => sum + getTaskDurationDays(task), 0)
      const conflicts = memberTasks.filter((task) => conflictTaskIds.has(task.id)).length
      return {
        memberId: member.id,
        taskCount: memberTasks.length,
        totalDays,
        overloaded: totalDays > 15,
        conflicts,
      }
    })
  }, [conflictTaskIds, tasks])

  const focusedMember = useMemo(
    () => TEAM_MEMBERS.find((member) => member.id === focusMemberId) ?? null,
    [focusMemberId],
  )

  const focusedTasks = useMemo(() => {
    if (!focusMemberId) return []
    return tasks.filter((task) => task.memberId === focusMemberId)
  }, [focusMemberId, tasks])

  function syncScrollState(): void {
    const container = timelineScrollRef.current
    if (!container) {
      setScrollLeft(0)
      setScrollMax(0)
      return
    }
    const max = Math.max(0, container.scrollWidth - container.clientWidth)
    setScrollLeft(container.scrollLeft)
    setScrollMax(max)
  }

  useEffect(() => {
    syncScrollState()
    const onResize = () => syncScrollState()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    syncScrollState()
  }, [timelineWidth])

  useEffect(() => {
    if (!isScrollSliderHeld) return
    const onPointerRelease = () => setIsScrollSliderHeld(false)
    window.addEventListener('pointerup', onPointerRelease)
    window.addEventListener('pointercancel', onPointerRelease)
    return () => {
      window.removeEventListener('pointerup', onPointerRelease)
      window.removeEventListener('pointercancel', onPointerRelease)
    }
  }, [isScrollSliderHeld])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedTaskId) return
    if (tasks.some((task) => task.id === selectedTaskId)) return
    setSelectedTaskId(null)
  }, [selectedTaskId, tasks])

  useEffect(() => {
    if (!selectedTaskId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedTaskId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTaskId])

  useEffect(() => {
    if (!dragState) return

    const body = timelineBodyRef.current
    if (!body) return
    let hasMoved = false

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return

      if (
        !hasMoved &&
        (Math.abs(event.clientX - dragState.startClientX) >= DRAG_CLICK_THRESHOLD_PX ||
          Math.abs(event.clientY - dragState.startClientY) >= DRAG_CLICK_THRESHOLD_PX)
      ) {
        hasMoved = true
      }

      if (!hasMoved && dragState.mode === 'move') {
        return
      }

      const deltaDaysRaw = (event.clientX - dragState.startClientX) / DAY_WIDTH
      const deltaDays = Math.round(deltaDaysRaw)
      const minEnd = dragState.mode === 'resize-left' ? dragState.originEndDay - 1 : 1

      let nextStart = dragState.originStartDay
      let nextEnd = dragState.originEndDay
      let nextMemberId = dragState.originMemberId
      let splitInsertDay: number | null = null

      if (dragState.mode === 'move') {
        const span = dragState.originEndDay - dragState.originStartDay
        const proposedStartDay = clamp(
          dragState.originStartDay + deltaDaysRaw,
          0,
          timelineDayCount - span,
        )
        nextStart = clamp(Math.round(proposedStartDay), 0, timelineDayCount - span)
        nextEnd = nextStart + span

        const rect = body.getBoundingClientRect()
        const rowIndex = clamp(
          Math.floor((event.clientY - rect.top) / ROW_HEIGHT),
          0,
          TEAM_MEMBERS.length - 1,
        )
        nextMemberId = TEAM_MEMBERS[rowIndex].id

        splitInsertDay = findSplitInsertDay(
          dragState.originTasks,
          dragState.taskId,
          nextMemberId,
          proposedStartDay,
          span,
          timelineDayCount,
        )

        if (splitInsertDay !== null) {
          nextStart = splitInsertDay
          nextEnd = nextStart + span
          setSplitInsertPreview({ memberId: nextMemberId, day: splitInsertDay })
        } else {
          setSplitInsertPreview(null)
        }
      } else {
        setSplitInsertPreview(null)
      }

      if (dragState.mode === 'resize-left') {
        nextStart = clamp(dragState.originStartDay + deltaDays, 0, minEnd)
      }

      if (dragState.mode === 'resize-right') {
        nextEnd = clamp(
          dragState.originEndDay + deltaDays,
          dragState.originStartDay + 1,
          timelineDayCount,
        )
      }

      const span = dragState.originEndDay - dragState.originStartDay
      const nextTasks = dragState.originTasks.map((task) => {
        if (task.id === dragState.taskId) {
          return {
            ...task,
            memberId: nextMemberId,
            startDay: nextStart,
            endDay: nextEnd,
          }
        }

        if (
          dragState.mode === 'move' &&
          splitInsertDay !== null &&
          task.memberId === nextMemberId &&
          task.startDay >= splitInsertDay
        ) {
          return {
            ...task,
            startDay: task.startDay + span,
            endDay: task.endDay + span,
          }
        }

        return task
      })

      tasksRef.current = nextTasks
      setTasks(nextTasks)

      const days = Math.max(1, nextEnd - nextStart)
      setDragBadge({ left: event.clientX, top: event.clientY - 22, days })
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return
      if (!hasMoved && dragState.mode === 'move') {
        setSelectedTaskId((current) => (current === dragState.taskId ? null : dragState.taskId))
      } else {
        const baselineById = new Map(dragState.originTasks.map((task) => [task.id, task]))
        for (const committed of tasksRef.current) {
          const baseline = baselineById.get(committed.id)
          if (!baseline) continue
          if (
            baseline.memberId === committed.memberId &&
            baseline.startDay === committed.startDay &&
            baseline.endDay === committed.endDay
          ) {
            continue
          }

          onPatchTask(committed.sourceTaskId, {
            owner: committed.memberId,
            start: toIsoDateFromUtcMs(timelineStartMs + committed.startDay * DAY_MS),
            end: toIsoDateFromUtcMs(timelineStartMs + committed.endDay * DAY_MS),
          })
        }
      }
      setDragState(null)
      setDragBadge(null)
      setSplitInsertPreview(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    document.body.style.userSelect = 'none'
    document.body.style.cursor = dragState.mode === 'move' ? 'grabbing' : 'ew-resize'

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragState, onPatchTask, timelineDayCount, timelineStartMs])

  function toggleTaskSubtask(taskId: string, subtaskIndex: number): void {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return
    setSubtaskChecks((current) => {
      const previous = current[taskId] ?? task.subtasks.map(() => false)
      const next = [...previous]
      next[subtaskIndex] = !next[subtaskIndex]
      return { ...current, [taskId]: next }
    })
  }

  function beginDrag(task: ResourceTask, mode: DragMode, event: React.PointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    setHoveredTaskId(null)
    if (mode !== 'move') setSelectedTaskId(null)
    setDragState({
      taskId: task.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originStartDay: task.startDay,
      originEndDay: task.endDay,
      originMemberId: task.memberId,
      originTasks: tasks,
      pointerId: event.pointerId,
    })
    setSplitInsertPreview(null)
    if (mode === 'move') setDragBadge(null)
    else setDragBadge({ left: event.clientX, top: event.clientY - 22, days: getTaskDurationDays(task) })
  }

  function openMember(memberId: MemberId, event: React.MouseEvent<HTMLButtonElement>): void {
    const avatar = event.currentTarget.querySelector('[data-member-avatar="true"]') as HTMLElement | null
    const rect = avatar?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()

    setFocusAnchor({
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2,
      size: rect.width,
    })
    setFocusMemberId(memberId)
    setFocusMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFocusActive(true))
    })
  }

  function closeMember(): void {
    setFocusActive(false)
    setClosingMask(true)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setFocusMounted(false)
      setFocusMemberId(null)
      setFocusAnchor(null)
      setClosingMask(false)
    }, CLOSE_MASK_DURATION_MS)
  }

  return (
    <section
      className="kr21-resource-shell relative overflow-hidden rounded-2xl border"
      style={{
        borderColor: '#DDD0BC',
        background: `radial-gradient(circle at 8% 10%, ${rgba('#8FBB93', 0.10)}, transparent 32%), radial-gradient(circle at 90% 0%, ${rgba('#C8A87A', 0.08)}, transparent 30%), ${THEME.timelineBg}`,
      }}
    >
      <div
        className="transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{
          opacity: focusMounted ? 0.09 : 1,
          transform: focusMounted ? 'scale(0.996)' : 'scale(1)',
          filter: focusMounted ? 'blur(1px)' : 'none',
        }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6"
          style={{ borderColor: THEME.timelineGrid }}
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: THEME.timelineAxisSub }}>
              Resource Planner
            </p>
            <h2
              className="text-base font-semibold leading-tight sm:text-lg"
              style={{ color: THEME.timelineText, fontFamily: UI_FONT }}
            >
              Team Capacity Timeline
            </h2>
          </div>
        </div>

        <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-[290px_minmax(0,1fr)]">
          <aside
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: THEME.timelineGrid, background: THEME.timelinePanelSoft }}
          >
            <div
              className="flex items-center justify-between border-b px-3"
              style={{ borderColor: THEME.timelineGrid, height: HEADER_HEIGHT }}
            >
              <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: THEME.timelineAxisSub }}>
                Team
              </span>
              <span className="text-[11px]" style={{ color: THEME.timelineTextMuted }}>
                3 members
              </span>
            </div>

            {TEAM_MEMBERS.map((member, index) => {
              const stats = memberStats.find((item) => item.memberId === member.id)
              const isFocused = focusMounted && focusMemberId === member.id
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={(event) => openMember(member.id, event)}
                  className="w-full px-3 text-left transition-colors"
                  style={{
                    height: ROW_HEIGHT,
                    borderTop: `1px solid ${THEME.timelineGrid}`,
                    background: isFocused
                      ? rgba(member.accent, 0.18)
                      : index % 2 === 0
                        ? 'rgba(242, 237, 230, 0.55)'
                        : 'rgba(253, 252, 248, 0.80)',
                  }}
                >
                  <span className="flex items-center gap-3">
                    <img
                      data-member-avatar="true"
                      src={avatarDataUrl(member.name, member.accent)}
                      alt={`${member.name} avatar`}
                      className="h-10 w-10 rounded-full border"
                      style={{ borderColor: THEME.timelineGrid }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" style={{ color: THEME.timelineText }}>
                        {member.name}
                      </span>
                    </span>
                    <span
                      className="rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums"
                      style={{
                        background: stats?.overloaded ? rgba('#C8A87A', 0.20) : rgba('#8FBB93', 0.20),
                        color: stats?.overloaded ? '#8A5A2A' : '#2A5A30',
                      }}
                    >
                      {stats?.totalDays ?? 0}d
                    </span>
                  </span>
                </button>
              )
            })}
          </aside>

          <section
            className="relative overflow-hidden rounded-xl border"
            style={{ borderColor: THEME.timelineGrid, background: THEME.timelinePanelSoft }}
          >
            <div
              ref={timelineScrollRef}
              onScroll={syncScrollState}
              className="timeline-scroll overflow-x-auto overflow-y-hidden"
            >
              <div className="relative" style={{ width: timelineWidth }}>
                <div
                  className="sticky top-0 z-10 border-b"
                  style={{
                    height: HEADER_HEIGHT,
                    background: THEME.timelinePanel,
                    borderColor: THEME.timelineGrid,
                  }}
                >
                  {weekSegments.map((segment) => (
                    <div
                      key={`week-${segment.week}`}
                      className="absolute flex items-center justify-center"
                      style={{
                        left: segment.startDay * DAY_WIDTH,
                        top: 0,
                        width: (segment.endDay - segment.startDay) * DAY_WIDTH,
                        height: HEADER_HEIGHT,
                        borderLeft: `1px solid ${THEME.timelineGrid}`,
                        background:
                          segment.week % 2 === 0
                            ? 'rgba(242, 237, 230, 0.55)'
                            : 'rgba(255, 255, 255, 0.70)',
                      }}
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                          style={{ color: THEME.timelineAxis }}
                        >
                          Week {segment.week}
                        </span>
                        <span
                          className="mt-1 text-[10px] tracking-[0.05em]"
                          style={{ color: THEME.timelineAxisSub }}
                        >
                          {formatDateShortFromUtcMs(timelineStartMs + segment.startDay * DAY_MS)} - {formatDateShortFromUtcMs(timelineStartMs + (segment.endDay - 1) * DAY_MS)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      left: todayDay * DAY_WIDTH,
                      width: 2,
                      background: '#E45F3E',
                      boxShadow: '0 0 10px rgba(228,95,62,0.45)',
                    }}
                  />
                  <div
                    className="absolute -bottom-3 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      left: todayDay * DAY_WIDTH + 6,
                      background: '#FFFFFF',
                      borderColor: '#DDD0BC',
                      color: '#7A5A30',
                    }}
                  >
                    Today · {formatDateDayMonthFromUtcMs(timelineScope.todayUtcMs)} · W{todayWeekNumber}
                  </div>
                </div>

                <div
                  ref={timelineBodyRef}
                  className="relative"
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('[data-task-popup="true"]')) return
                    if (!target.closest('[data-resource-task="true"]')) {
                      setSelectedTaskId(null)
                    }
                  }}
                  style={{
                    height: timelineHeight,
                    background: THEME.timelinePanelSoft,
                  }}
                >
                  {TEAM_MEMBERS.map((_, rowIndex) => (
                    <div
                      key={`row-${rowIndex}`}
                      className="absolute left-0 right-0"
                      style={{
                        top: rowIndex * ROW_HEIGHT,
                        height: ROW_HEIGHT,
                        borderTop: `1px solid ${THEME.timelineGrid}`,
                        background:
                          rowIndex % 2 === 0 ? 'rgba(242, 237, 230, 0.45)' : 'rgba(253, 252, 248, 0.75)',
                      }}
                    />
                  ))}

                  {weekGridDays.map((day) => (
                    <div
                      key={`grid-week-${day}`}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: day * DAY_WIDTH,
                        width: day % 7 === 0 ? 2 : 1,
                        background: THEME.timelineGrid,
                        opacity: day % 7 === 0 ? 0.95 : 0.55,
                      }}
                    />
                  ))}

                  {splitInsertPreview ? (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: splitInsertPreview.day * DAY_WIDTH,
                        top: (memberIndex.get(splitInsertPreview.memberId) ?? 0) * ROW_HEIGHT + 8,
                        width: 2,
                        height: ROW_HEIGHT - 16,
                        background: '#E45F3E',
                        boxShadow: '0 0 0 4px rgba(228,95,62,0.15), 0 0 14px rgba(228,95,62,0.35)',
                        borderRadius: 999,
                        zIndex: 8,
                      }}
                    />
                  ) : null}

                  {tasks.map((task) => {
                    const frame = taskFrames.get(task.id)
                    if (!frame) return null
                    const isHovered = hoveredTaskId === task.id
                    const hasConflict = conflictTaskIds.has(task.id)
                    const stackLayout = taskStackLayout.get(task.id) ?? { lane: 0, laneCount: 1 }
                    const isStacked = stackLayout.laneCount > 1
                    const isCompact = frame.height < 28
                    const isSelected = selectedTaskId === task.id
                    const textColor = textColorFor(task.color)
                    return (
                      <div
                        key={task.id}
                        data-resource-task="true"
                        className="absolute"
                        onMouseEnter={() => setHoveredTaskId(task.id)}
                        onMouseLeave={() => setHoveredTaskId((current) => (current === task.id ? null : current))}
                        onPointerDown={(event) => beginDrag(task, 'move', event)}
                        style={{
                          left: frame.left,
                          top: frame.top,
                          width: frame.width,
                          height: frame.height,
                          borderRadius: Math.max(6, Math.min(10, frame.height / 2.2)),
                          background: `linear-gradient(165deg, ${rgba(task.color, 0.96)} 0%, ${rgba(task.color, 0.82)} 100%)`,
                          border: isSelected
                            ? `1.6px solid ${rgba('#FFFFFF', 0.76)}`
                            : hasConflict
                              ? '2px solid rgba(255,210,190,0.95)'
                              : `1px solid ${rgba('#FFFFFF', 0.27)}`,
                          boxShadow: isSelected
                            ? '0 8px 20px rgba(42, 58, 44, 0.20)'
                            : isHovered
                              ? '0 6px 14px rgba(42, 58, 44, 0.16)'
                              : '0 3px 8px rgba(42, 58, 44, 0.10)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: `0 ${isCompact ? 20 : 26}px`,
                          cursor: dragState ? 'grabbing' : 'grab',
                          zIndex: isSelected ? 7 : isHovered ? 4 : 3,
                          transition: dragState ? 'none' : 'box-shadow 140ms ease, transform 140ms ease',
                          transform: isSelected || isHovered ? 'translateY(-1px)' : 'translateY(0)',
                          color: textColor,
                          userSelect: 'none',
                          opacity: isStacked ? 0.97 : 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: isCompact ? 12 : 14,
                            fontWeight: 700,
                            letterSpacing: '0.01em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {task.project}
                        </span>

                        <button
                          type="button"
                          aria-label="Resize start"
                          onPointerDown={(event) => beginDrag(task, 'resize-left', event)}
                          style={{
                            position: 'absolute',
                            left: 4,
                            top: 3,
                            bottom: 3,
                            width: isCompact ? 8 : 10,
                            borderRadius: 8,
                            border: 'none',
                            background: rgba('#FFFFFF', 0.4),
                            cursor: 'ew-resize',
                          }}
                        />

                        <button
                          type="button"
                          aria-label="Resize end"
                          onPointerDown={(event) => beginDrag(task, 'resize-right', event)}
                          style={{
                            position: 'absolute',
                            right: 4,
                            top: 3,
                            bottom: 3,
                            width: isCompact ? 8 : 10,
                            borderRadius: 8,
                            border: 'none',
                            background: rgba('#FFFFFF', 0.4),
                            cursor: 'ew-resize',
                          }}
                        />
                      </div>
                    )
                  })}

                  {selectedTask && selectedTaskFrame && !dragState ? (
                    <div
                      data-task-popup="true"
                      className="task-checklist-pop absolute"
                      onPointerDown={(event) => event.stopPropagation()}
                      style={{
                        left: selectedTaskPopupPosition.left,
                        top: selectedTaskPopupPosition.top,
                        transform: 'translateY(-50%)',
                        width: TASK_POPUP_WIDTH,
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: '#FFFFFF',
                        border: '1px solid #DDD0BC',
                        boxShadow: '0 8px 32px rgba(30,42,32,0.14), 0 2px 8px rgba(30,42,32,0.08)',
                        zIndex: 10,
                        pointerEvents: 'auto',
                      }}
                    >
                      {/* Colour accent strip */}
                      <div style={{ height: 3, background: selectedTask.color }} />

                      <div style={{ padding: '10px 12px 12px' }}>
                        {/* Header row */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#1F2B21', lineHeight: 1.35, paddingRight: 4 }}>
                              {selectedTask.project}
                            </div>
                            {selectedTask.actionItem && (
                              <div style={{ fontSize: 11, color: '#7A8E7C', marginTop: 2, lineHeight: 1.35 }}>
                                {selectedTask.actionItem}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedTaskId(null)}
                            aria-label="Close"
                            style={{
                              flexShrink: 0,
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              border: '1px solid #E8E0D2',
                              background: '#F8F4EE',
                              color: '#9AAE9C',
                              fontSize: 14,
                              lineHeight: 1,
                              display: 'grid',
                              placeItems: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            ×
                          </button>
                        </div>

                        {/* Progress row */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9AAE9C' }}>
                              Progress
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#2A3A2C' }}>
                              {selectedTask.subtasks.length > 0
                                ? `${selectedTaskDoneCount}/${selectedTask.subtasks.length} done`
                                : '—'}
                            </span>
                          </div>
                          <div style={{ height: 4, background: '#F0EAE0', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              borderRadius: 2,
                              background: selectedTask.color,
                              width: selectedTask.subtasks.length > 0
                                ? `${(selectedTaskDoneCount / selectedTask.subtasks.length) * 100}%`
                                : '0%',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>

                        {/* Checklist */}
                        {selectedTask.subtasks.length > 0 && (
                          <>
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9AAE9C', marginBottom: 6 }}>
                              Checklist
                            </div>
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {selectedTask.subtasks.map((subtask, index) => {
                                const checked = selectedTaskChecks[index] ?? false
                                return (
                                  <li
                                    key={`${selectedTask.id}-${index}`}
                                    className="task-checklist-item"
                                    style={{ animationDelay: `${60 + index * 45}ms` }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        toggleTaskSubtask(selectedTask.id, index)
                                      }}
                                      style={{
                                        display: 'flex',
                                        width: '100%',
                                        alignItems: 'flex-start',
                                        gap: 8,
                                        padding: '5px 8px',
                                        borderRadius: 7,
                                        border: '1px solid',
                                        borderColor: checked ? '#C8DDC9' : '#EDE8E0',
                                        background: checked ? '#F0F7F1' : '#FDFCF8',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'background 0.12s, border-color 0.12s',
                                      }}
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          flexShrink: 0,
                                          marginTop: 1,
                                          width: 14,
                                          height: 14,
                                          borderRadius: 3,
                                          border: `1.5px solid ${checked ? '#4A6B4E' : '#C8C0B0'}`,
                                          background: checked ? '#4A6B4E' : '#FFFFFF',
                                          display: 'grid',
                                          placeItems: 'center',
                                          fontSize: 9,
                                          color: '#FFFFFF',
                                          fontWeight: 800,
                                        }}
                                      >
                                        {checked ? '✓' : ''}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 11,
                                          lineHeight: 1.4,
                                          color: checked ? '#8A9E8C' : '#2A3A2C',
                                          textDecoration: checked ? 'line-through' : 'none',
                                        }}
                                      >
                                        {subtask}
                                      </span>
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        )}
                      </div>

                      {/* Arrow caret */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          ...(selectedTaskPopupPosition.side === 'right'
                            ? { left: -5 }
                            : { right: -5 }),
                          width: 10,
                          height: 10,
                          transform: 'translateY(-50%) rotate(45deg)',
                          background: selectedTask.color,
                          border: 'none',
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {scrollMax > 0 ? (
              <div
                className="border-t px-3 py-2"
                style={{
                  borderColor: THEME.timelineGrid,
                  background: THEME.timelinePanel,
                  position: 'relative',
                  zIndex: 24,
                }}
              >
                <label className="flex items-center gap-3">
                  <span
                    className="whitespace-nowrap text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: THEME.timelineAxisSub }}
                  >
                    Scroll timeline
                  </span>
                  <span className="relative block w-full">
                    {isScrollSliderHeld ? (
                      <span
                        className="pointer-events-none absolute rounded-full border px-3 py-1 text-[11px] font-semibold"
                        style={{
                          left: `${(sliderRatio * 100).toFixed(3)}%`,
                          top: -38,
                          transform: 'translateX(-50%)',
                          background: '#FFFFFF',
                          borderColor: '#DDD0BC',
                          color: '#2A3A2C',
                          boxShadow: '0 6px 18px rgba(42,58,44,0.14)',
                          whiteSpace: 'nowrap',
                          zIndex: 40,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {sliderDateLabel} · W{sliderWeek}
                      </span>
                    ) : null}
                    <input
                      type="range"
                      min={0}
                      max={sliderMax}
                      value={sliderValue}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        const container = timelineScrollRef.current
                        if (!container) return
                        container.scrollLeft = next
                        setScrollLeft(next)
                      }}
                      onPointerDown={() => setIsScrollSliderHeld(true)}
                      onBlur={() => setIsScrollSliderHeld(false)}
                      className="w-full"
                      style={{ accentColor: '#8FBB93' }}
                    />
                  </span>
                </label>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {dragBadge ? (
        <div
          className="pointer-events-none fixed z-[100] flex items-end gap-1 rounded-full px-3 py-2"
          style={{
            left: dragBadge.left,
            top: dragBadge.top,
            transform: 'translate(-50%, -100%)',
            background: THEME.badgeBg,
            border: '1px solid #DDD0BC',
            boxShadow: '0 8px 20px rgba(42,58,44,0.14)',
          }}
        >
          <span className="tabular-nums text-base font-semibold leading-none" style={{ color: THEME.timelineText }}>
            {dragBadge.days}
          </span>
          <span
            className="text-[10px] uppercase leading-none tracking-[0.08em]"
            style={{ color: THEME.timelineTextMuted }}
          >
            days
          </span>
        </div>
      ) : null}

      {focusMounted && focusedMember ? (
        <div className="absolute inset-0 z-20">
          <div
            className="absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{
              opacity: focusActive ? 1 : 0,
              background: THEME.detailBg,
            }}
          />

          <div
            className="absolute inset-0 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7"
            style={{
              opacity: focusActive ? 1 : 0,
              transform: focusActive ? 'translateY(0)' : 'translateY(22px)',
              transition: 'opacity 320ms ease, transform 420ms cubic-bezier(0.2,0.8,0.2,1)',
            }}
          >
            <button
              type="button"
              onClick={closeMember}
              className="absolute right-4 top-4 z-10 h-11 w-11 rounded-full border text-2xl leading-none"
              style={{
                background: THEME.detailSurface,
                color: THEME.detailText,
                borderColor: THEME.detailBorder,
              }}
              aria-label="Close member details"
            >
              ×
            </button>

            {focusAnchor ? (
              <img
                src={avatarDataUrl(focusedMember.name, focusedMember.accent)}
                alt={focusedMember.name}
                className="pointer-events-none fixed z-30 rounded-full border-[3px]"
                style={{
                  left: focusActive ? '50%' : focusAnchor.left,
                  top: focusActive ? 126 : focusAnchor.top,
                  width: focusActive ? 96 : focusAnchor.size,
                  height: focusActive ? 96 : focusAnchor.size,
                  transform: 'translate(-50%, -50%)',
                  borderColor: THEME.detailSurface,
                  boxShadow: '0 8px 20px rgba(42,58,44,0.14)',
                  transition: 'left 420ms cubic-bezier(0.2,0.8,0.2,1), top 420ms cubic-bezier(0.2,0.8,0.2,1), width 420ms cubic-bezier(0.2,0.8,0.2,1), height 420ms cubic-bezier(0.2,0.8,0.2,1)',
                }}
              />
            ) : null}

            <div className="mx-auto max-w-6xl space-y-5 pt-16">
              <section
                className="relative overflow-hidden rounded-[28px] border px-6 pb-7 pt-16"
                style={{
                  borderColor: THEME.detailBorder,
                  background: `linear-gradient(180deg, ${rgba(focusedMember.accent, 0.26)} 0%, ${THEME.detailBg} 74%)`,
                }}
              >
                <div
                  className="absolute inset-x-0 -top-20 mx-auto h-44 w-[130%] rounded-[100%]"
                  style={{ background: rgba(focusedMember.accent, 0.22) }}
                />

                <div className="relative flex flex-col items-center text-center">
                  <h3
                    className="text-[30px] font-semibold leading-tight"
                    style={{ color: THEME.detailText, fontFamily: UI_FONT }}
                  >
                    {focusedMember.name}
                  </h3>
                  <p className="text-sm" style={{ color: THEME.detailMuted }}>
                    {focusedMember.role}
                  </p>
                </div>

                <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                    style={{
                      background: THEME.detailSurface,
                      borderColor: THEME.detailBorder,
                      color: '#2B5A9A',
                    }}
                  >
                    <span>▣</span>
                    <span>Meet in Zoom</span>
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                    style={{
                      background: THEME.detailSurface,
                      borderColor: THEME.detailBorder,
                      color: '#326E3C',
                    }}
                  >
                    <span>◉</span>
                    <span>Chat in Slack</span>
                  </button>
                </div>
              </section>

              <section
                className="rounded-2xl border p-4 sm:p-5"
                style={{ borderColor: THEME.detailBorder, background: THEME.detailSurface }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.08em]" style={{ color: THEME.detailMuted }}>
                    Assigned Projects
                  </p>
                  <span className="text-xs" style={{ color: THEME.detailMuted }}>
                    {focusedTasks.length} card{focusedTasks.length === 1 ? '' : 's'}
                  </span>
                </div>

                {focusedTasks.length === 0 ? (
                  <div
                    className="rounded-xl border px-4 py-8 text-center text-sm"
                    style={{ borderColor: THEME.detailBorder, color: THEME.detailMuted }}
                  >
                    No projects assigned.
                  </div>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    {focusedTasks.map((task) => {
                      const cardText = textColorFor(task.color)
                      return (
                        <article
                          key={task.id}
                          className="rounded-2xl border p-4"
                          style={{
                            borderColor: rgba('#FFFFFF', 0.3),
                            background: `linear-gradient(165deg, ${rgba(task.color, 0.95)} 0%, ${rgba(task.color, 0.8)} 100%)`,
                            color: cardText,
                            boxShadow: `0 14px 24px ${rgba(task.color, 0.26)}`,
                          }}
                        >
                          <header className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold">{task.project}</h4>
                            <span className="tabular-nums text-[10px] font-semibold uppercase tracking-[0.06em]">
                              {getTaskDurationDays(task)} days
                            </span>
                          </header>

                          <p className="mt-2 text-xs font-medium" style={{ opacity: 0.96 }}>
                            {task.actionItem}
                          </p>
                          <p className="mt-1 text-[11px]" style={{ opacity: 0.86 }}>
                            {formatDateShortFromUtcMs(timelineStartMs + task.startDay * DAY_MS)} - {formatDateShortFromUtcMs(timelineStartMs + task.endDay * DAY_MS)}
                          </p>

                          <ul className="mt-3 space-y-1.5 text-sm">
                            {task.subtasks.map((subtask) => (
                              <li key={subtask} className="flex items-start gap-2">
                                <span style={{ opacity: 0.9 }}>•</span>
                                <span>{subtask}</span>
                              </li>
                            ))}
                          </ul>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {closingMask ? (
        <div
          className="pointer-events-none absolute z-30 h-12 w-12 rounded-full"
          style={{
            top: 24,
            right: 24,
            background: THEME.closeMask,
            transform: 'translate(50%, -50%) scale(0.1)',
            animation: `kr21-close-circle ${CLOSE_MASK_DURATION_MS}ms cubic-bezier(0.22, 0.84, 0.26, 1) forwards`,
          }}
        />
      ) : null}

      <style>{`
        .kr21-resource-shell .timeline-scroll {
          scrollbar-width: thin;
          scrollbar-color: ${THEME.timelineGrid} transparent;
        }
        .kr21-resource-shell .timeline-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .kr21-resource-shell .timeline-scroll::-webkit-scrollbar-thumb {
          background: ${THEME.timelineGrid};
          border-radius: 8px;
        }
        .kr21-resource-shell .task-checklist-pop {
          animation: kr21-task-pop-in 220ms cubic-bezier(0.2, 0.82, 0.22, 1) both;
        }
        .kr21-resource-shell .task-checklist-item {
          opacity: 0;
          transform: translateY(5px);
          animation: kr21-subtask-pop 320ms cubic-bezier(0.2, 0.82, 0.22, 1) forwards;
        }
        @keyframes kr21-close-circle {
          0% {
            transform: translate(50%, -50%) scale(0.1);
          }
          100% {
            transform: translate(50%, -50%) scale(58);
          }
        }
        @keyframes kr21-task-pop-in {
          0% {
            opacity: 0;
            transform: translateY(-50%) translateX(-4px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(-50%) translateX(0) scale(1);
          }
        }
        @keyframes kr21-subtask-pop {
          0% {
            opacity: 0;
            transform: translateY(5px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  )
}
