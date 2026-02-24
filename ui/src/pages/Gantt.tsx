import Highcharts from 'highcharts/highcharts-gantt'
import DraggablePoints from 'highcharts/modules/draggable-points'
import HighchartsReact from 'highcharts-react-official'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const initDraggablePoints = DraggablePoints as unknown as (chartingLibrary: typeof Highcharts) => void
if (typeof initDraggablePoints === 'function') {
  initDraggablePoints(Highcharts)
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const ROW_HEIGHT = 72
const CHART_HEADER_HEIGHT = 70
const DAY_COLUMN_WIDTH = 128
const CHART_FONT = "'Avenir Next', 'Inter', system-ui, sans-serif"

type ProjectColor = 'blue' | 'red' | 'turquoise' | 'yellow' | 'purple'

interface Project {
  id: string
  name: string
  color: ProjectColor
}

interface SubTask {
  id: string
  description: string
  isCompleted: boolean
}

interface TimelineTask {
  id: string
  projectId: string
  employeeId: string
  startDate: Date
  endDate: Date
  totalHours: number
  subTasks: SubTask[]
}

interface Employee {
  id: string
  name: string
  role: string
  avatarUrl: string
}

type DragBadge = {
  left: number
  top: number
  hours: number
}

type TaskView = 'grid' | 'list'

const THEME = {
  background: '#FDFCF8',
  muted: '#F2EDE6',
  surface: '#FFFFFF',
  border: '#DDD0BC',
  foreground: '#2A3A2C',
  subtle: '#7A8E7C',
  primary: '#4A6B4E',
  primaryDeep: '#3D5C40',
  primarySoft: '#8FBB93',
  accentWarm: '#C8A87A',
  accentCoral: '#D49880',
  accentLavender: '#A89CB8',
  timelineBg: '#283D2C',
  timelinePanel: '#314A35',
  timelinePanelSoft: 'rgba(50, 76, 55, 0.86)',
  timelineGrid: '#4A654E',
  timelineAxis: '#E3EFDF',
  timelineAxisSub: '#ABC2AD',
  timelineText: '#F1F8EF',
  timelineTextMuted: '#BDD0BE',
  badgeBg: '#213124',
  closeMask: '#213125',
} as const

const PROJECT_COLORS: Record<ProjectColor, string> = {
  blue: THEME.primarySoft,
  red: THEME.accentCoral,
  turquoise: '#96B685',
  yellow: THEME.accentWarm,
  purple: THEME.accentLavender,
}

function avatarDataUrl(initials: string, base: string, accent: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88' viewBox='0 0 88 88' fill='none'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${base}'/><stop offset='1' stop-color='${accent}'/></linearGradient></defs><rect width='88' height='88' rx='44' fill='url(#g)'/><text x='44' y='53' text-anchor='middle' fill='white' font-size='29' font-family='Avenir Next, Inter, sans-serif' font-weight='700'>${initials}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function utcDate(year: number, month: number, day: number, hour = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function snapToNearestDay(timestamp: number): number {
  return Math.round(timestamp / DAY_MS) * DAY_MS
}

function computeHours(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((endMs - startMs) / HOUR_MS))
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
    const next = pickNumber(candidate.newValues, ['x2', 'end', 'x'])
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

function getPointStartMs(point: Highcharts.Point): number {
  const candidate = point as Highcharts.Point & {
    start?: number
    x?: number
    options?: { start?: number; x?: number }
  }
  return candidate.start ?? candidate.x ?? candidate.options?.start ?? candidate.options?.x ?? Date.now()
}

function getPointEndMs(point: Highcharts.Point): number {
  const candidate = point as Highcharts.Point & {
    end?: number
    x2?: number
    options?: { end?: number; x2?: number }
  }
  return candidate.end ?? candidate.x2 ?? candidate.options?.end ?? candidate.options?.x2 ?? getPointStartMs(point) + HOUR_MS
}

function getPointId(point: Highcharts.Point): string | null {
  const candidate = point as Highcharts.Point & {
    id?: string
    options?: { id?: string; custom?: { taskId?: string } }
  }
  return candidate.id ?? candidate.options?.id ?? candidate.options?.custom?.taskId ?? null
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

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const PROJECTS: Project[] = [
  { id: 'p-protocol', name: 'Protocol Cash', color: 'blue' },
  { id: 'p-dribbble', name: 'Dribbble Shot', color: 'red' },
  { id: 'p-astronomys', name: 'Astronomys', color: 'turquoise' },
  { id: 'p-brand-kit', name: 'Brand Kit', color: 'yellow' },
  { id: 'p-event-site', name: 'Event Microsite', color: 'purple' },
]

const EMPLOYEES: Employee[] = [
  { id: 'e-elise', name: 'Elise Chester', role: 'Web designer', avatarUrl: avatarDataUrl('EC', '#8FBB93', '#4A6B4E') },
  { id: 'e-freddie', name: 'Freddie She', role: 'Product designer', avatarUrl: avatarDataUrl('FS', '#D49880', '#A96A53') },
  { id: 'e-santi', name: 'Santi Holmes', role: 'Motion designer', avatarUrl: avatarDataUrl('SH', '#9DB88F', '#6C8855') },
  { id: 'e-aida', name: 'Aida Keller', role: 'UX researcher', avatarUrl: avatarDataUrl('AK', '#A89CB8', '#746682') },
  { id: 'e-tomas', name: 'Tomas Graff', role: 'Frontend engineer', avatarUrl: avatarDataUrl('TG', '#C8A87A', '#8F6E3B') },
]

const INITIAL_TASKS: TimelineTask[] = [
  {
    id: 't-1',
    projectId: 'p-protocol',
    employeeId: 'e-elise',
    startDate: utcDate(2026, 4, 28),
    endDate: utcDate(2026, 5, 1, 10),
    totalHours: 82,
    subTasks: [
      { id: 's-11', description: 'Create logo', isCompleted: false },
      { id: 's-12', description: 'Draft spacing system', isCompleted: true },
    ],
  },
  {
    id: 't-2',
    projectId: 'p-dribbble',
    employeeId: 'e-freddie',
    startDate: utcDate(2026, 4, 29, 9),
    endDate: utcDate(2026, 5, 3, 14),
    totalHours: 101,
    subTasks: [
      { id: 's-21', description: 'Create branding style', isCompleted: false },
      { id: 's-22', description: 'Publish interaction mockups', isCompleted: false },
    ],
  },
  {
    id: 't-3',
    projectId: 'p-astronomys',
    employeeId: 'e-santi',
    startDate: utcDate(2026, 4, 30),
    endDate: utcDate(2026, 5, 5),
    totalHours: 120,
    subTasks: [
      { id: 's-31', description: 'Create the set of icons', isCompleted: false },
      { id: 's-32', description: 'Motion curve tuning', isCompleted: false },
    ],
  },
  {
    id: 't-4',
    projectId: 'p-brand-kit',
    employeeId: 'e-aida',
    startDate: utcDate(2026, 5, 1),
    endDate: utcDate(2026, 5, 4, 17),
    totalHours: 89,
    subTasks: [
      { id: 's-41', description: 'Interview pilot users', isCompleted: true },
      { id: 's-42', description: 'Synthesize feedback themes', isCompleted: false },
    ],
  },
  {
    id: 't-5',
    projectId: 'p-event-site',
    employeeId: 'e-tomas',
    startDate: utcDate(2026, 5, 2, 10),
    endDate: utcDate(2026, 5, 7, 10),
    totalHours: 120,
    subTasks: [
      { id: 's-51', description: 'Build reusable timeline components', isCompleted: false },
      { id: 's-52', description: 'Connect chart interactions', isCompleted: false },
    ],
  },
  {
    id: 't-6',
    projectId: 'p-protocol',
    employeeId: 'e-freddie',
    startDate: utcDate(2026, 5, 5),
    endDate: utcDate(2026, 5, 8, 12),
    totalHours: 84,
    subTasks: [
      { id: 's-61', description: 'Hand-off component specs', isCompleted: false },
    ],
  },
]

export default function Gantt() {
  const projectById = useMemo(() => new Map(PROJECTS.map((project) => [project.id, project])), [])
  const employeeById = useMemo(() => new Map(EMPLOYEES.map((employee) => [employee.id, employee])), [])

  const [searchValue, setSearchValue] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [tasks, setTasks] = useState<TimelineTask[]>(INITIAL_TASKS)
  const [dragBadge, setDragBadge] = useState<DragBadge | null>(null)
  const [dragging, setDragging] = useState(false)

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [modalMounted, setModalMounted] = useState(false)
  const [modalActive, setModalActive] = useState(false)
  const [closingMask, setClosingMask] = useState(false)
  const [taskFilter, setTaskFilter] = useState('all')
  const [taskView, setTaskView] = useState<TaskView>('grid')
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  const [timelineScrollMax, setTimelineScrollMax] = useState(0)

  const closeTimerRef = useRef<number | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)

  const syncTimelineScroll = useCallback(() => {
    const container = timelineScrollRef.current
    if (!container) {
      setTimelineScrollMax(0)
      setTimelineScrollLeft(0)
      return
    }
    const max = Math.max(0, container.scrollWidth - container.clientWidth)
    setTimelineScrollMax(max)
    setTimelineScrollLeft(container.scrollLeft)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const roleOptions = useMemo(() => {
    const roles = [...new Set(EMPLOYEES.map((employee) => employee.role))]
    return ['all', ...roles]
  }, [])

  const visibleEmployees = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    return EMPLOYEES.filter((employee) => {
      if (roleFilter !== 'all' && employee.role !== roleFilter) return false
      if (!query) return true
      return employee.name.toLowerCase().includes(query) || employee.role.toLowerCase().includes(query)
    })
  }, [roleFilter, searchValue])

  const employeeIndex = useMemo(() => {
    return new Map(visibleEmployees.map((employee, index) => [employee.id, index]))
  }, [visibleEmployees])

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => employeeIndex.has(task.employeeId))
  }, [employeeIndex, tasks])

  const timelineRange = useMemo(() => {
    const allTimes = visibleTasks.flatMap((task) => [task.startDate.getTime(), task.endDate.getTime()])
    const fallbackStart = utcDate(2026, 4, 28).getTime()
    const fallbackEnd = utcDate(2026, 5, 9).getTime()
    const minRaw = allTimes.length > 0 ? Math.min(...allTimes) : fallbackStart
    const maxRaw = allTimes.length > 0 ? Math.max(...allTimes) : fallbackEnd
    const min = snapToNearestDay(minRaw - DAY_MS)
    const max = snapToNearestDay(maxRaw + DAY_MS)
    const dayCount = Math.max(6, Math.round((max - min) / DAY_MS))
    return { min, max, dayCount }
  }, [visibleTasks])

  const chartWidth = useMemo(() => Math.max(940, (timelineRange.dayCount + 1) * DAY_COLUMN_WIDTH), [timelineRange.dayCount])
  const chartHeight = useMemo(
    () => CHART_HEADER_HEIGHT + Math.max(1, visibleEmployees.length) * ROW_HEIGHT,
    [visibleEmployees.length],
  )

  useEffect(() => {
    const container = timelineScrollRef.current
    if (!container) return
    syncTimelineScroll()
    const onResize = () => syncTimelineScroll()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [syncTimelineScroll, chartWidth, visibleEmployees.length])

  const modalEmployee = selectedEmployeeId ? employeeById.get(selectedEmployeeId) ?? null : null
  const modalTasks = useMemo(() => {
    if (!selectedEmployeeId) return []
    return tasks.filter((task) => task.employeeId === selectedEmployeeId)
  }, [selectedEmployeeId, tasks])

  const modalProjectOptions = useMemo(() => {
    const options = new Set<string>()
    for (const task of modalTasks) {
      const project = projectById.get(task.projectId)
      if (project) options.add(project.id)
    }
    return ['all', ...options]
  }, [modalTasks, projectById])

  const filteredModalTasks = useMemo(() => {
    if (taskFilter === 'all') return modalTasks
    return modalTasks.filter((task) => task.projectId === taskFilter)
  }, [modalTasks, taskFilter])

  function openEmployeeDetails(employeeId: string): void {
    setSelectedEmployeeId(employeeId)
    setTaskFilter('all')
    setTaskView('grid')
    setModalMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setModalActive(true))
    })
  }

  function closeEmployeeDetails(): void {
    setModalActive(false)
    setClosingMask(true)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setModalMounted(false)
      setSelectedEmployeeId(null)
      setClosingMask(false)
      setTaskFilter('all')
      setDragBadge(null)
      setDragging(false)
    }, 560)
  }

  const ganttOptions = useMemo<Highcharts.Options>(() => {
    const axisTextColor = THEME.timelineAxis

    return {
      chart: {
        type: 'gantt',
        backgroundColor: THEME.timelineBg,
        height: chartHeight,
        width: chartWidth,
        spacing: [0, 8, 0, 8],
        style: { fontFamily: CHART_FONT },
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
        height: CHART_HEADER_HEIGHT,
        offset: 0,
        min: timelineRange.min,
        max: timelineRange.max,
        tickInterval: DAY_MS,
        lineColor: THEME.timelineGrid,
        lineWidth: 1,
        gridLineColor: THEME.timelineGrid,
        gridLineWidth: 1,
        tickColor: THEME.timelineGrid,
        labels: {
          useHTML: true,
          y: 18,
          style: { color: axisTextColor, fontSize: '11px', fontWeight: '600' },
          formatter: function formatter(this: Highcharts.AxisLabelsFormatterContextObject): string {
            const raw = typeof this.value === 'number' ? this.value : Number(this.value)
            const date = new Date(raw)
            const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
            const day = date.getUTCDate()
            const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getUTCDay()]
            return `<div style="display:flex;flex-direction:column;line-height:1.05;"><span style="color:${axisTextColor};font-size:11px;font-weight:650;">${month} ${day}</span><span style="color:${THEME.timelineAxisSub};font-size:10px;font-weight:500;letter-spacing:0.06em;margin-top:3px;">${weekday}</span></div>`
          },
        },
      },
      yAxis: {
        type: 'category',
        staticScale: ROW_HEIGHT,
        top: CHART_HEADER_HEIGHT,
        height: Math.max(1, visibleEmployees.length) * ROW_HEIGHT,
        categories: visibleEmployees.map((employee) => employee.name),
        grid: { borderColor: THEME.timelineGrid },
        labels: { enabled: false },
        min: -0.5,
        max: Math.max(visibleEmployees.length - 0.5, 0.5),
        plotBands: visibleEmployees.map((_, index) => ({
          from: index - 0.5,
          to: index + 0.5,
          color: index % 2 === 0 ? '#344F39' : '#39563E',
        })),
      },
      tooltip: {
        enabled: !dragging,
        useHTML: true,
        outside: false,
        borderWidth: 0,
        backgroundColor: 'transparent',
        shadow: false,
        padding: 0,
        formatter: function formatter(this: Highcharts.TooltipFormatterContextObject): string {
          const point = this.point as Highcharts.Point & {
            options?: { custom?: { projectName?: string; firstSubTask?: string; color?: string } }
          }
          const projectName = point.options?.custom?.projectName ?? point.name ?? 'Untitled'
          const firstSubTask = point.options?.custom?.firstSubTask ?? 'No subtasks yet'
          const color = point.options?.custom?.color ?? THEME.primary
          return `<div style="min-width:174px;padding:10px 12px;border-radius:10px;background:linear-gradient(180deg,${rgba(color, 0.95)} 0%,${rgba(color, 0.88)} 100%);border:1px solid ${rgba('#FFFFFF', 0.28)};box-shadow:0 12px 24px rgba(18,27,20,0.38);"><div style="font-weight:700;color:${textColorFor(color)};font-size:12px;margin-bottom:3px;">${projectName}</div><div style="font-size:11px;color:${rgba(textColorFor(color), 0.9)};">${firstSubTask}</div></div>`
        },
        positioner: function positioner(
          this: Highcharts.Tooltip,
          labelWidth: number,
          labelHeight: number,
        ): Highcharts.PositionObject {
          const hoverPoint = this.chart.hoverPoint as Highcharts.Point & {
            shapeArgs?: { x?: number; y?: number; width?: number; height?: number }
          }
          const shape = hoverPoint?.shapeArgs
          if (!shape) return { x: 0, y: 0 }
          const x = (shape.x ?? 0) + this.chart.plotLeft + ((shape.width ?? 0) / 2) - (labelWidth / 2)
          const y = (shape.y ?? 0) + this.chart.plotTop + (shape.height ?? 0) + 12
          return { x, y }
        },
      },
      plotOptions: {
        series: {
          borderRadius: 8,
          pointPadding: 0.06,
          animation: { duration: 240 },
          states: {
            hover: {
              enabled: true,
              brightness: 0.09,
              halo: { size: 0 },
            },
          },
        },
      },
      series: [
        {
          type: 'gantt',
          name: 'Employee tasks',
          data: visibleTasks.map((task) => {
            const project = projectById.get(task.projectId)
            const rowIndex = employeeIndex.get(task.employeeId)
            const barColor = project ? PROJECT_COLORS[project.color] : THEME.primary
            return {
              id: task.id,
              name: project?.name ?? 'Unknown',
              start: task.startDate.getTime(),
              end: task.endDate.getTime(),
              y: rowIndex ?? 0,
              color: barColor,
              borderColor: rgba('#FFFFFF', 0.26),
              custom: {
                taskId: task.id,
                projectName: project?.name ?? 'Unknown',
                firstSubTask: task.subTasks[0]?.description ?? 'No subtasks yet',
                color: barColor,
              },
            }
          }) as Highcharts.XrangePointOptionsObject[],
          dataLabels: {
            enabled: true,
            inside: true,
            crop: false,
            overflow: 'allow',
            formatter: function formatter(this: Highcharts.PointLabelObject): string {
              const point = this.point as Highcharts.Point
              return point.name
            },
            style: {
              color: THEME.timelineText,
              textOutline: 'none',
              fontWeight: '600',
              fontSize: '11px',
            },
          },
          dragDrop: {
            draggableStart: false,
            draggableEnd: true,
            draggableY: true,
            draggableX: false,
            draggableX1: false,
            draggableX2: true,
            liveRedraw: true,
            dragPrecisionX: HOUR_MS,
            dragPrecisionY: 1,
            dragHandle: {
              color: THEME.surface,
              lineColor: THEME.primaryDeep,
              lineWidth: 1.25,
              zIndex: 9,
            },
          },
          point: {
            events: {
              dragStart: function dragStart(this: Highcharts.Point): void {
                setDragging(true)
                setDragBadge(null)
                this.series.chart.tooltip?.hide(0)
              },
              drag: function drag(
                this: Highcharts.Point,
                event: Highcharts.PointDragEventObject,
              ): void {
                const pointId = getPointId(this)
                const nextEnd = getDraggedEnd(event, pointId)
                if (nextEnd === null) {
                  setDragBadge(null)
                  return
                }

                const currentEnd = getPointEndMs(this)
                if (Math.abs(nextEnd - currentEnd) < 1) {
                  setDragBadge(null)
                  return
                }

                const chart = this.series.chart
                const shape = (this as Highcharts.Point & { shapeArgs?: { y?: number } }).shapeArgs
                const startMs = getPointStartMs(this)
                const totalHours = clamp(computeHours(startMs, nextEnd), 1, 240)
                setDragBadge({
                  left: this.series.xAxis.toPixels(nextEnd, false),
                  top: (shape?.y ?? 0) + chart.plotTop - 8,
                  hours: totalHours,
                })
              },
              drop: function drop(
                this: Highcharts.Point,
                event: Highcharts.PointDropEventObject,
              ): void {
                setDragging(false)
                setDragBadge(null)

                const pointId = getPointId(this)
                const draggedEnd = getDraggedEnd(event, pointId)

                const draggedY = getDraggedY(event, pointId)
                const hasYChange = typeof draggedY === 'number' && Number.isFinite(draggedY)
                const nextRowIndex = hasYChange
                  ? clamp(Math.round(draggedY), 0, Math.max(visibleEmployees.length - 1, 0))
                  : null
                const nextEmployeeId = nextRowIndex === null ? null : (visibleEmployees[nextRowIndex]?.id ?? null)

                const taskId = pointId ?? String((this.options as { custom?: { taskId?: string } }).custom?.taskId ?? '')
                if (!taskId) return

                setTasks((currentTasks) =>
                  currentTasks.map((task) =>
                    task.id !== taskId
                      ? task
                      : (() => {
                          const updatedEmployeeId = nextEmployeeId ?? task.employeeId
                          const nextEndMs = draggedEnd === null
                            ? task.endDate.getTime()
                            : Math.max(task.startDate.getTime() + HOUR_MS, snapToNearestDay(draggedEnd))
                          const endChanged = Math.abs(task.endDate.getTime() - nextEndMs) >= 1
                          const employeeChanged = updatedEmployeeId !== task.employeeId
                          if (!endChanged && !employeeChanged) return task
                          return {
                            ...task,
                            employeeId: updatedEmployeeId,
                            endDate: endChanged ? new Date(nextEndMs) : task.endDate,
                            totalHours: endChanged
                              ? computeHours(task.startDate.getTime(), nextEndMs)
                              : task.totalHours,
                          }
                        })(),
                  ),
                )
              },
            },
          },
        } as Highcharts.SeriesGanttOptions,
      ],
    }
  }, [chartHeight, chartWidth, dragging, employeeIndex, projectById, timelineRange.max, timelineRange.min, visibleEmployees, visibleTasks])

  return (
    <div
      className="gantt-shell relative overflow-hidden rounded-2xl border"
      style={{
        borderColor: THEME.timelineGrid,
        background: `radial-gradient(circle at 9% 8%, ${rgba(THEME.primarySoft, 0.36)}, transparent 32%), radial-gradient(circle at 92% 0%, ${rgba(THEME.accentWarm, 0.24)}, transparent 32%), ${THEME.timelineBg}`,
        minHeight: 'calc(100dvh - 160px)',
      }}
    >
      <div
        className="transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{
          opacity: modalMounted ? 0.08 : 1,
          transform: modalMounted ? 'scale(0.995)' : 'scale(1)',
          filter: modalMounted ? 'blur(1px)' : 'none',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b" style={{ borderColor: THEME.timelineGrid }}>
          <label
            className="flex items-center gap-2 rounded-xl border px-3 py-2 min-w-[240px] max-w-[420px] w-full sm:w-auto"
            style={{ background: THEME.timelinePanel, borderColor: THEME.timelineGrid }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke={THEME.timelineAxisSub} strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent outline-none text-sm"
              style={{ color: THEME.timelineText, fontFamily: CHART_FONT }}
            />
          </label>

          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ background: THEME.timelinePanel, borderColor: THEME.timelineGrid }}>
            <div className="text-right">
              <p className="text-[11px] leading-tight" style={{ color: THEME.timelineTextMuted }}>Hello, Patrick!</p>
              <p className="text-xs font-semibold leading-tight" style={{ color: THEME.timelineText }}>Design Ops</p>
            </div>
            <img src={avatarDataUrl('PT', '#8FBB93', '#4A6B4E')} alt="Patrick avatar" className="w-9 h-9 rounded-full border" style={{ borderColor: THEME.timelineGrid }} />
          </div>
        </div>

        <div className="p-3 sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[290px_minmax(0,1fr)]">
            <aside className="rounded-xl border overflow-hidden" style={{ borderColor: THEME.timelineGrid, background: THEME.timelinePanelSoft }}>
              <div
                className="flex items-center justify-between gap-2 px-3 border-b"
                style={{ borderColor: THEME.timelineGrid, height: CHART_HEADER_HEIGHT }}
              >
                <label className="text-[11px] uppercase tracking-[0.08em]" style={{ color: THEME.timelineAxisSub }}>
                  Team Filter
                </label>
                <select
                  className="rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none"
                  style={{ background: THEME.timelineBg, borderColor: THEME.timelineGrid, color: THEME.timelineText }}
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  {roleOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === 'all' ? 'All employees' : option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                {visibleEmployees.length === 0 ? (
                  <div className="px-3 py-12 text-center text-sm" style={{ color: THEME.timelineTextMuted }}>
                    No employees match your search.
                  </div>
                ) : (
                  visibleEmployees.map((employee, index) => {
                    const active = selectedEmployeeId === employee.id && modalMounted
                    return (
                      <button
                        key={employee.id}
                        type="button"
                        onClick={() => openEmployeeDetails(employee.id)}
                        className="w-full px-3 text-left transition-colors"
                        style={{
                          height: ROW_HEIGHT,
                          borderTop: `1px solid ${THEME.timelineGrid}`,
                          background: active
                            ? rgba(THEME.primarySoft, 0.28)
                            : index % 2 === 0
                              ? 'rgba(53, 81, 58, 0.62)'
                              : 'rgba(50, 76, 54, 0.72)',
                        }}
                      >
                        <span className="flex items-center gap-3">
                          <img src={employee.avatarUrl} alt={employee.name} className="w-10 h-10 rounded-full border" style={{ borderColor: THEME.timelineGrid }} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold truncate" style={{ color: THEME.timelineText }}>
                              {employee.name}
                            </span>
                            <span className="block text-xs truncate" style={{ color: THEME.timelineTextMuted }}>
                              {employee.role}
                            </span>
                          </span>
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </aside>

            <section
              className="relative rounded-xl border overflow-hidden"
              style={{ borderColor: THEME.timelineGrid, background: THEME.timelinePanelSoft }}
            >
              <div
                ref={timelineScrollRef}
                onScroll={syncTimelineScroll}
                className="timeline-scroll overflow-x-auto overflow-y-hidden"
              >
                <div className="relative" style={{ width: chartWidth }}>
                  <HighchartsReact highcharts={Highcharts} constructorType="ganttChart" options={ganttOptions} />
                  {dragBadge ? (
                    <div
                      className="pointer-events-none absolute rounded-full px-3 py-2 flex items-end gap-1"
                      style={{
                        left: dragBadge.left,
                        top: dragBadge.top,
                        transform: 'translate(-50%, -100%)',
                        background: THEME.badgeBg,
                        border: '1px solid rgba(255,255,255,0.12)',
                        boxShadow: '0 14px 28px rgba(0,0,0,0.42)',
                      }}
                    >
                      <span className="text-base leading-none font-semibold tabular-nums" style={{ color: THEME.timelineText }}>{dragBadge.hours}</span>
                      <span className="text-[10px] leading-none uppercase tracking-[0.06em]" style={{ color: THEME.timelineTextMuted }}>hrs</span>
                    </div>
                  ) : null}
                </div>
              </div>
              {timelineScrollMax > 0 ? (
                <div className="px-3 py-2 border-t" style={{ borderColor: THEME.timelineGrid, background: THEME.timelineBg }}>
                  <label className="flex items-center gap-3">
                    <span className="text-[10px] uppercase tracking-[0.08em] whitespace-nowrap" style={{ color: THEME.timelineAxisSub }}>
                      Scroll timeline
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, timelineScrollMax)}
                      value={Math.min(timelineScrollLeft, Math.max(1, timelineScrollMax))}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        const container = timelineScrollRef.current
                        if (!container) return
                        container.scrollLeft = next
                        setTimelineScrollLeft(next)
                      }}
                      className="w-full"
                      style={{ accentColor: THEME.primarySoft }}
                    />
                  </label>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {modalMounted && modalEmployee ? (
        <div className="absolute inset-0 z-20">
          <div
            className="absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{
              opacity: modalActive ? 1 : 0,
              background: THEME.muted,
            }}
          />

          <div
            className="absolute inset-0 overflow-y-auto px-4 sm:px-8 py-5 sm:py-7"
            style={{
              opacity: modalActive ? 1 : 0,
              transform: modalActive ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 320ms ease, transform 420ms cubic-bezier(0.2,0.8,0.2,1)',
            }}
          >
            <button
              type="button"
              onClick={closeEmployeeDetails}
              className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full border text-2xl leading-none"
              style={{ background: THEME.surface, color: THEME.foreground, borderColor: THEME.border }}
              aria-label="Close employee details"
            >
              ×
            </button>

            <div className="mx-auto max-w-6xl space-y-5">
              <section
                className="relative overflow-hidden rounded-[28px] px-6 py-7 border"
                style={{
                  borderColor: THEME.border,
                  background: `linear-gradient(180deg, ${rgba(THEME.primarySoft, 0.2)} 0%, ${THEME.background} 74%)`,
                }}
              >
                <div className="absolute inset-x-0 -top-20 mx-auto h-44 w-[130%] rounded-[100%]" style={{ background: rgba(THEME.primarySoft, 0.22) }} />
                <div className="relative flex flex-col items-center text-center gap-2">
                  <img src={modalEmployee.avatarUrl} alt={modalEmployee.name} className="w-24 h-24 rounded-full border-[3px]" style={{ borderColor: THEME.surface, boxShadow: '0 12px 26px rgba(42,58,44,0.24)' }} />
                  <h2 className="text-[30px] font-semibold leading-tight" style={{ color: THEME.foreground, fontFamily: CHART_FONT }}>
                    {modalEmployee.name}
                  </h2>
                  <p className="text-sm" style={{ color: THEME.subtle }}>{modalEmployee.role}</p>
                </div>

                <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                    style={{ background: THEME.surface, borderColor: THEME.border, color: THEME.primary }}
                  >
                    <span>▣</span>
                    <span>Meet in Zoom</span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                    style={{ background: THEME.surface, borderColor: THEME.border, color: '#336F3D' }}
                  >
                    <span>◉</span>
                    <span>Chat in Slack</span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                    style={{ background: THEME.surface, borderColor: THEME.border, color: '#7A5B18' }}
                  >
                    <span>◎</span>
                    <span>Harvest Profile</span>
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: THEME.border }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={taskFilter}
                      onChange={(event) => setTaskFilter(event.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: THEME.border, color: THEME.foreground }}
                    >
                      {modalProjectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? 'All tasks' : (projectById.get(option)?.name ?? option)}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs" style={{ color: THEME.subtle }}>
                      {filteredModalTasks.length} task{filteredModalTasks.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="inline-flex rounded-lg border p-1" style={{ borderColor: THEME.border }}>
                    <button
                      type="button"
                      onClick={() => setTaskView('grid')}
                      className="rounded-md px-2 py-1 text-xs font-semibold"
                      style={{
                        background: taskView === 'grid' ? rgba(THEME.primarySoft, 0.28) : 'transparent',
                        color: taskView === 'grid' ? THEME.foreground : THEME.subtle,
                      }}
                    >
                      Grid
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskView('list')}
                      className="rounded-md px-2 py-1 text-xs font-semibold"
                      style={{
                        background: taskView === 'list' ? rgba(THEME.primarySoft, 0.28) : 'transparent',
                        color: taskView === 'list' ? THEME.foreground : THEME.subtle,
                      }}
                    >
                      List
                    </button>
                  </div>
                </div>

                {filteredModalTasks.length === 0 ? (
                  <div className="mt-5 rounded-xl border px-4 py-8 text-center text-sm" style={{ borderColor: THEME.border, color: THEME.subtle }}>
                    No tasks for this filter.
                  </div>
                ) : (
                  <div
                    className="mt-5 gap-3"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: taskView === 'grid' ? 'repeat(auto-fit, minmax(210px, 1fr))' : '1fr',
                    }}
                  >
                    {filteredModalTasks.map((task) => {
                      const project = projectById.get(task.projectId)
                      const cardColor = project ? PROJECT_COLORS[project.color] : THEME.primary
                      const textColor = textColorFor(cardColor)
                      return (
                        <article
                          key={task.id}
                          className="rounded-2xl border p-4"
                          style={{
                            borderColor: rgba('#FFFFFF', 0.32),
                            background: `linear-gradient(165deg, ${rgba(cardColor, 0.94)} 0%, ${rgba(cardColor, 0.79)} 100%)`,
                            color: textColor,
                            boxShadow: `0 16px 26px ${rgba(cardColor, 0.3)}`,
                          }}
                        >
                          <header className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">{project?.name ?? 'Untitled project'}</h3>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">{task.totalHours} hrs</span>
                          </header>
                          <ul className="mt-3 space-y-1.5 text-sm">
                            {task.subTasks.map((subTask) => (
                              <li key={subTask.id} className="flex items-start gap-2">
                                <span style={{ opacity: 0.9 }}>•</span>
                                <span style={{ textDecoration: subTask.isCompleted ? 'line-through' : 'none', opacity: subTask.isCompleted ? 0.75 : 1 }}>
                                  {subTask.description}
                                </span>
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
            animation: 'gantt-close-circle 560ms cubic-bezier(0.22, 0.84, 0.26, 1) forwards',
          }}
        />
      ) : null}

      <style>{`
        .gantt-shell .timeline-scroll {
          scrollbar-width: thin;
          scrollbar-color: ${THEME.timelineGrid} transparent;
        }
        .gantt-shell .timeline-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .gantt-shell .timeline-scroll::-webkit-scrollbar-thumb {
          background: ${THEME.timelineGrid};
          border-radius: 8px;
        }
        .gantt-shell .highcharts-point {
          transition: filter 160ms ease;
        }
        .gantt-shell .highcharts-point:hover {
          filter: drop-shadow(0 6px 14px rgba(21, 33, 22, 0.34));
        }
        .gantt-shell .highcharts-point-drag-handle {
          opacity: 0;
          transition: opacity 130ms ease;
        }
        .gantt-shell .highcharts-point:hover + .highcharts-point-drag-handle,
        .gantt-shell .highcharts-point-drag-handle:hover,
        .gantt-shell .highcharts-point-drag-handle:focus {
          opacity: 1;
        }
        @keyframes gantt-close-circle {
          0% {
            transform: translate(50%, -50%) scale(0.1);
          }
          100% {
            transform: translate(50%, -50%) scale(58);
          }
        }
      `}</style>
    </div>
  )
}
