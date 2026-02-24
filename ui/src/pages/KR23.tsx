import Highcharts from 'highcharts/highcharts-gantt'
import HighchartsReact from 'highcharts-react-official'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_MS = 30.4375 * DAY_MS

type AudienceSource = 'actual' | 'forecast'
type InitiativeStatus = 'planning' | 'in-progress' | 'review' | 'complete'

const INITIATIVE_STATUS_META: Record<InitiativeStatus, { label: string; bg: string; color: string }> = {
  'planning':    { label: 'Planning',     bg: '#F2EDE6', color: '#7A6A50' },
  'in-progress': { label: 'In Progress',  bg: '#E8F6EA', color: '#25693A' },
  'review':      { label: 'Review',       bg: '#EEF0FB', color: '#4B52BE' },
  'complete':    { label: 'Complete',     bg: '#F0FAF0', color: '#166534' },
}

interface AudienceCheckpoint {
  id: string
  label: string
  date: string
  audienceM: number
  source: AudienceSource
}

interface InitiativeTask {
  id: string
  label: string
  owner: string
  start: string
  end: string
  progress: number
  expectedLiftM: number
  status: InitiativeStatus
  dependency?: string
}

const INITIAL_CHECKPOINTS: AudienceCheckpoint[] = [
  {
    id: 'baseline',
    label: 'February baseline',
    date: '2026-02-01',
    audienceM: 241.6,
    source: 'actual',
  },
  {
    id: 'march-read',
    label: 'March checkpoint',
    date: '2026-03-01',
    audienceM: 257.4,
    source: 'actual',
  },
  {
    id: 'april-read',
    label: 'April checkpoint',
    date: '2026-04-01',
    audienceM: 274.2,
    source: 'forecast',
  },
  {
    id: 'may-read',
    label: 'May checkpoint',
    date: '2026-05-01',
    audienceM: 289.7,
    source: 'forecast',
  },
]

const INITIAL_TASKS: InitiativeTask[] = [
  {
    id: 'llm-pages',
    label: 'Scale LLM landing pages and semantic clusters',
    owner: 'Mia',
    start: '2026-02-22',
    end: '2026-04-05',
    progress: 72,
    expectedLiftM: 19.5,
    status: 'in-progress',
  },
  {
    id: 'schema-updates',
    label: 'Schema upgrades + intent metadata rollout',
    owner: 'Leo',
    start: '2026-03-01',
    end: '2026-04-20',
    progress: 55,
    expectedLiftM: 11.4,
    status: 'in-progress',
    dependency: 'llm-pages',
  },
  {
    id: 'distribution',
    label: 'LLM citation distribution partnerships',
    owner: 'Ari',
    start: '2026-03-16',
    end: '2026-05-08',
    progress: 41,
    expectedLiftM: 13.8,
    status: 'in-progress',
    dependency: 'schema-updates',
  },
  {
    id: 'experiments',
    label: 'Prompt loop experiments + snippet tuning',
    owner: 'Nia',
    start: '2026-04-02',
    end: '2026-05-18',
    progress: 34,
    expectedLiftM: 9.2,
    status: 'planning',
    dependency: 'distribution',
  },
  {
    id: 'launch-week',
    label: 'Launch week push + QA stabilization',
    owner: 'Kai',
    start: '2026-05-12',
    end: '2026-05-31',
    progress: 18,
    expectedLiftM: 6.5,
    status: 'planning',
    dependency: 'experiments',
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

function formatDateShort(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function formatMonth(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
  }).format(value)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function velocityLabel(value: number): string {
  if (!Number.isFinite(value)) return 'inf'
  return value.toFixed(1)
}

function shortLabel(value: string): string {
  return value.length > 26 ? `${value.slice(0, 26)}...` : value
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
}: {
  label: string
  value: string
  sub: string
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const borderColor = tone === 'positive' ? '#AED5B2' : tone === 'warning' ? '#E3B8A4' : '#D8CCB8'
  const glow = tone === 'positive' ? 'rgba(143,187,147,0.18)' : tone === 'warning' ? 'rgba(212,152,128,0.18)' : 'rgba(74,107,78,0.08)'

  return (
    <article
      className="rounded-2xl p-4"
      style={{
        background: '#FFFFFF',
        border: `1px solid ${borderColor}`,
        boxShadow: `0 10px 24px ${glow}`,
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: '#7A8E7C' }}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: '#1F2B21' }}>
        {value}
      </p>
      <p className="mt-1 text-xs" style={{ color: '#6E8370' }}>
        {sub}
      </p>
    </article>
  )
}

function WorkstreamCard23({
  task,
  expanded,
  onToggle,
  onPatch,
  onRemove,
}: {
  task: InitiativeTask
  expanded: boolean
  onToggle: () => void
  onPatch: (next: Partial<InitiativeTask>) => void
  onRemove: () => void
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${expanded ? '#C8D4C9' : '#E0D5C4'}`,
        background: expanded ? '#F8FBF8' : '#FCFBF8',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        style={{ cursor: 'pointer', background: 'none', border: 'none' }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="#9AAE9C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: '#1F2B21' }}>
            {task.label || 'Untitled initiative'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px]" style={{ color: '#9AAE9C' }}>{task.owner || 'No owner'}</span>
            <span style={{ color: '#D8CCB8' }}>·</span>
            <span className="text-[11px] tabular-nums" style={{ color: '#9AAE9C' }}>
              {task.progress}% · {task.expectedLiftM.toFixed(1)}M lift
            </span>
          </div>
        </div>
        <div style={{ width: 56, flexShrink: 0 }}>
          <div className="rounded-full overflow-hidden" style={{ height: 4, background: '#E8E1D4' }}>
            <div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: '#4A6B4E', transition: 'width 0.3s' }} />
          </div>
        </div>
      </button>

      {/* Expandable body */}
      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 0.22s ease' }}>
        <div style={{ overflow: 'hidden' }}>
          <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid #EDE5D6' }}>
            <div className="pt-2 grid gap-2 sm:grid-cols-2">
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Initiative</span>
                <input value={task.label} onChange={(e) => onPatch({ label: e.target.value })} style={INPUT_STYLE} />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Owner</span>
                <input value={task.owner} onChange={(e) => onPatch({ owner: e.target.value })} style={INPUT_STYLE} />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Expected lift (M)</span>
                <input
                  type="number" min={0} max={80} step={0.1} value={task.expectedLiftM}
                  onChange={(e) => onPatch({ expectedLiftM: clamp(Number(e.target.value) || 0, 0, 80) })}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>Start</span>
                <input type="date" value={task.start} onChange={(e) => onPatch({ start: e.target.value })} style={INPUT_STYLE} />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: '#7A8E7C' }}>End</span>
                <input type="date" value={task.end} onChange={(e) => onPatch({ end: e.target.value })} style={INPUT_STYLE} />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range" min={0} max={100} value={task.progress}
                onChange={(e) => onPatch({ progress: clamp(Number(e.target.value) || 0, 0, 100) })}
                className="w-full" style={{ accentColor: '#4A6B4E' }}
              />
              <input
                type="number" min={0} max={100} value={task.progress}
                onChange={(e) => onPatch({ progress: clamp(Number(e.target.value) || 0, 0, 100) })}
                style={{ ...INPUT_STYLE, width: 72 }}
              />
            </div>
            <button
              type="button" onClick={onRemove}
              className="text-xs font-medium"
              style={{ color: '#C4836A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Remove initiative
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KR23() {
  const [krTitle, setKrTitle] = useState(
    'KR 2.3: Improve Impression AI monthly audience from 241.6M (February baseline) to 302M (+25%) by May 31, 2026.',
  )
  const [metricName, setMetricName] = useState('Impression AI Monthly Audience')
  const [targetAudienceM, setTargetAudienceM] = useState(302)
  const [deadline, setDeadline] = useState('2026-05-31')
  const [checkpoints, setCheckpoints] = useState<AudienceCheckpoint[]>(INITIAL_CHECKPOINTS)
  const [tasks, setTasks] = useState<InitiativeTask[]>(INITIAL_TASKS)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const todayIso = toIsoDate(new Date())
  const todayMs = parseDate(todayIso)
  const deadlineMs = parseDate(deadline)

  const sortedCheckpoints = useMemo(
    () => [...checkpoints].sort((left, right) => parseDate(left.date) - parseDate(right.date)),
    [checkpoints],
  )

  const baselinePoint = sortedCheckpoints[0] ?? INITIAL_CHECKPOINTS[0]
  const baselineAudienceM = baselinePoint.audienceM
  const baselineDate = baselinePoint.date
  const baselineMs = parseDate(baselineDate)

  const latestActualPoint = sortedCheckpoints
    .filter((point) => point.source === 'actual')
    .sort((left, right) => parseDate(left.date) - parseDate(right.date))
    .at(-1)

  const currentAudienceM = latestActualPoint?.audienceM ?? baselineAudienceM
  const requiredDeltaM = targetAudienceM - baselineAudienceM
  const achievedDeltaM = currentAudienceM - baselineAudienceM
  const gapToTargetM = targetAudienceM - currentAudienceM

  const growthPct = baselineAudienceM > 0 ? (achievedDeltaM / baselineAudienceM) * 100 : 0
  const targetGrowthPct = baselineAudienceM > 0 ? (requiredDeltaM / baselineAudienceM) * 100 : 0
  const progressPct = requiredDeltaM > 0 ? clamp((achievedDeltaM / requiredDeltaM) * 100, 0, 100) : 100

  const daysRemaining = Math.ceil((deadlineMs - todayMs) / DAY_MS)
  const monthsElapsed = Math.max((todayMs - baselineMs) / MONTH_MS, 0.5)
  const monthsRemaining = Math.max(daysRemaining / 30.4375, 0)
  const velocityMPerMonth = achievedDeltaM / monthsElapsed
  const requiredVelocityMPerMonth =
    daysRemaining <= 0 && gapToTargetM > 0
      ? Number.POSITIVE_INFINITY
      : monthsRemaining > 0
        ? gapToTargetM / monthsRemaining
        : 0

  const initiativeProgress = average(tasks.map((task) => task.progress))
  const expectedLiftM = tasks.reduce((sum, task) => sum + task.expectedLiftM, 0)

  const onTrack =
    gapToTargetM <= 0
      ? true
      : Number.isFinite(requiredVelocityMPerMonth)
        ? velocityMPerMonth >= requiredVelocityMPerMonth
        : false

  const timelineDates = useMemo(() => {
    const dateSet = new Set<number>([baselineMs, deadlineMs])
    for (const point of sortedCheckpoints) {
      dateSet.add(parseDate(point.date))
    }
    return [...dateSet].sort((left, right) => left - right)
  }, [baselineMs, deadlineMs, sortedCheckpoints])

  const checkpointMap = useMemo(() => {
    const map = new Map<number, AudienceCheckpoint>()
    for (const point of sortedCheckpoints) {
      map.set(parseDate(point.date), point)
    }
    return map
  }, [sortedCheckpoints])

  const requiredTrajectory = useMemo(
    () =>
      timelineDates.map((time) => {
        if (time <= baselineMs) return Number(baselineAudienceM.toFixed(2))
        if (time >= deadlineMs) return Number(targetAudienceM.toFixed(2))
        const ratio = (time - baselineMs) / Math.max(deadlineMs - baselineMs, DAY_MS)
        return Number((baselineAudienceM + requiredDeltaM * ratio).toFixed(2))
      }),
    [baselineAudienceM, baselineMs, deadlineMs, requiredDeltaM, targetAudienceM, timelineDates],
  )

  const actualSeries = useMemo(
    () =>
      timelineDates.map((time) => {
        const row = checkpointMap.get(time)
        if (!row) return null
        return row.source === 'actual' ? Number(row.audienceM.toFixed(2)) : null
      }),
    [checkpointMap, timelineDates],
  )

  const forecastSeries = useMemo(
    () =>
      timelineDates.map((time) => {
        const row = checkpointMap.get(time)
        if (!row) return null
        return row.source === 'forecast' ? Number(row.audienceM.toFixed(2)) : null
      }),
    [checkpointMap, timelineDates],
  )

  const audienceTrendOptions = useMemo<Highcharts.Options>(
    () => ({
      chart: {
        type: 'line',
        backgroundColor: 'transparent',
        height: 320,
        spacing: [8, 10, 8, 8],
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        itemStyle: { color: '#2A3A2C', fontSize: '11px', fontWeight: '500' },
      },
      xAxis: {
        categories: timelineDates.map((date) => `${formatMonth(date)} ${new Date(date).getFullYear()}`),
        lineColor: '#D8CCB8',
        tickColor: '#D8CCB8',
        labels: {
          style: { color: '#6E8370', fontSize: '11px' },
        },
      },
      yAxis: {
        title: {
          text: 'Audience (M)',
          style: { color: '#6E8370', fontSize: '11px' },
        },
        min: Math.floor(Math.min(baselineAudienceM, currentAudienceM) - 10),
        max: Math.ceil(Math.max(targetAudienceM, currentAudienceM) + 12),
        tickInterval: 10,
        gridLineColor: 'rgba(122,142,124,0.16)',
        labels: {
          formatter: function formatter() {
            return `${this.value}M`
          },
          style: { color: '#6E8370', fontSize: '11px' },
        },
      },
      tooltip: {
        shared: true,
        backgroundColor: '#FFFFFF',
        borderColor: '#D8CCB8',
        borderRadius: 8,
        shadow: false,
        valueSuffix: 'M',
      },
      series: [
        {
          type: 'line',
          name: 'Required trajectory',
          data: requiredTrajectory,
          color: '#C8A87A',
          dashStyle: 'ShortDash',
          lineWidth: 2,
          marker: { enabled: false },
        },
        {
          type: 'line',
          name: 'Actual',
          data: actualSeries,
          color: '#4A6B4E',
          lineWidth: 3,
          marker: { enabled: true, radius: 3 },
        },
        {
          type: 'line',
          name: 'Forecast',
          data: forecastSeries,
          color: '#A89CB8',
          lineWidth: 2,
          marker: { enabled: true, radius: 3 },
        },
      ],
    }),
    [
      actualSeries,
      baselineAudienceM,
      currentAudienceM,
      forecastSeries,
      requiredTrajectory,
      targetAudienceM,
      timelineDates,
    ],
  )

  const impactOptions = useMemo<Highcharts.Options>(
    () => ({
      chart: {
        type: 'bar',
        backgroundColor: 'transparent',
        height: 320,
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: tasks.map((task) => shortLabel(task.label)),
        lineColor: '#D8CCB8',
        tickColor: '#D8CCB8',
        labels: { style: { color: '#6E8370', fontSize: '11px' } },
      },
      yAxis: {
        min: 0,
        title: {
          text: 'Expected audience lift (M)',
          style: { color: '#6E8370', fontSize: '11px' },
        },
        gridLineColor: 'rgba(122,142,124,0.14)',
        labels: {
          formatter: function formatter() {
            return `${this.value}M`
          },
          style: { color: '#6E8370', fontSize: '11px' },
        },
      },
      tooltip: {
        backgroundColor: '#FFFFFF',
        borderColor: '#D8CCB8',
        borderRadius: 8,
        shadow: false,
        valueSuffix: 'M',
      },
      series: [
        {
          type: 'bar',
          data: tasks.map((task, index) => ({
            y: Number(task.expectedLiftM.toFixed(2)),
            color: ['#8FBB93', '#C8A87A', '#A89CB8', '#D49880', '#7AABB8'][index % 5],
          })),
          dataLabels: {
            enabled: true,
            formatter: function formatter() {
              return `${this.y}M`
            },
            style: {
              color: '#1F2B21',
              textOutline: 'none',
              fontSize: '10px',
              fontWeight: '600',
            },
          },
        },
      ],
    }),
    [tasks],
  )

  const ganttOptions = useMemo<Highcharts.Options>(() => {
    const timelineHeight = Math.max(340, 120 + tasks.length * 62)

    return {
      chart: {
        type: 'gantt',
        height: timelineHeight,
        backgroundColor: 'transparent',
        spacing: [16, 8, 12, 8],
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        currentDateIndicator: {
          enabled: true,
          color: '#D49880',
          width: 2,
          dashStyle: 'ShortDot',
          label: { style: { color: '#8A4E2A', fontSize: '11px' } },
        },
        plotLines: [
          {
            value: deadlineMs,
            color: '#C06A3A',
            width: 2,
            dashStyle: 'Dash',
            zIndex: 4,
            label: {
              text: 'KR deadline',
              align: 'right',
              x: -6,
              y: 12,
              style: { color: '#8A4E2A', fontSize: '11px', fontWeight: '600' },
            },
          },
        ],
        gridLineColor: 'rgba(122,142,124,0.18)',
        labels: { style: { color: '#6E8370', fontSize: '11px' } },
      },
      yAxis: {
        type: 'category',
        uniqueNames: true,
        grid: { borderColor: 'rgba(122,142,124,0.15)' },
        labels: {
          style: { color: '#2A3A2C', fontSize: '12px', fontWeight: '500' },
        },
      },
      tooltip: {
        useHTML: true,
        backgroundColor: '#FFFFFF',
        borderColor: '#D8CCB8',
        borderRadius: 8,
        shadow: false,
        padding: 10,
        pointFormatter: function pointFormatter(this: Highcharts.Point): string {
          const pointWithMeta = this as Highcharts.Point & {
            completed?: { amount?: number }
            custom?: { owner?: string; expectedLiftM?: number }
          }
          const completion = Math.round((pointWithMeta.completed?.amount ?? 0) * 100)
          const owner = pointWithMeta.custom?.owner ?? 'Unassigned'
          const expectedLift = pointWithMeta.custom?.expectedLiftM ?? 0
          return [
            `<div style="font-size:12px; color:#2A3A2C; font-weight:600; margin-bottom:6px;">${this.name}</div>`,
            `<div style="font-size:11px; color:#5E765F;">Owner: <b>${owner}</b></div>`,
            `<div style="font-size:11px; color:#5E765F;">Progress: <b>${completion}%</b></div>`,
            `<div style="font-size:11px; color:#5E765F;">Expected lift: <b>${expectedLift.toFixed(1)}M</b></div>`,
          ].join('')
        },
      },
      series: [
        {
          type: 'gantt',
          name: 'Initiatives',
          color: '#A9C8AA',
          borderColor: '#5D7E60',
          lineColor: '#5D7E60',
          dataLabels: {
            enabled: true,
            allowOverlap: false,
            formatter: function formatter(this: Highcharts.PointLabelObject): string {
              const point = this.point as Highcharts.Point & { completed?: { amount?: number } }
              const percent = Math.round((point.completed?.amount ?? 0) * 100)
              return `${percent}%`
            },
            style: {
              color: '#1F2B21',
              textOutline: 'none',
              fontWeight: '600',
              fontSize: '10px',
            },
          },
          data: tasks.map((task) => ({
            id: task.id,
            name: task.label,
            start: parseDate(task.start),
            end: parseDate(task.end),
            dependency: task.dependency,
            completed: {
              amount: clamp(task.progress / 100, 0, 1),
              fill: '#4A6B4E',
            },
            custom: {
              owner: task.owner,
              expectedLiftM: task.expectedLiftM,
            },
          })) as Highcharts.XrangePointOptionsObject[],
        } as Highcharts.SeriesGanttOptions,
      ],
    }
  }, [deadlineMs, tasks])

  function patchCheckpoint(checkpointId: string, next: Partial<AudienceCheckpoint>) {
    setCheckpoints((current) =>
      current.map((checkpoint) => (checkpoint.id === checkpointId ? { ...checkpoint, ...next } : checkpoint)),
    )
  }

  function patchTask(taskId: string, next: Partial<InitiativeTask>) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...next } : task)),
    )
  }

  function addTask() {
    const id = `task-${Date.now()}`
    setTasks((current) => [
      ...current,
      {
        id,
        label: 'New initiative',
        owner: '',
        start: toIsoDate(new Date()),
        end: deadline,
        progress: 0,
        expectedLiftM: 0,
        status: 'planning',
      },
    ])
    setExpandedId(id)
  }

  function removeTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId))
    if (expandedId === taskId) setExpandedId(null)
  }


  const paceTone: 'positive' | 'warning' = onTrack ? 'positive' : 'warning'
  const deadlineTone: 'neutral' | 'warning' = daysRemaining > 14 ? 'neutral' : 'warning'

  return (
    <div className="space-y-4 pb-4">
      <section
        className="rounded-2xl border p-4 sm:p-5"
        style={{
          borderColor: '#D8CCB8',
          background:
            'radial-gradient(circle at 14% 18%, rgba(143,187,147,0.27), transparent 46%), radial-gradient(circle at 88% 10%, rgba(168,156,184,0.22), transparent 40%), #FCFAF4',
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[1.45fr_0.85fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Pill text="Objective" bg="#E8F6EA" color="#25693A" />
              <Pill text="KR 2.3" bg="#F2EDE6" color="#607860" />
            </div>

            <label className="block text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: '#6E8370' }}>
              Key Result Statement
            </label>
            <textarea
              value={krTitle}
              onChange={(event) => setKrTitle(event.target.value)}
              rows={3}
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: 92 }}
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: '#6E8370' }}>Metric name</span>
                <input
                  value={metricName}
                  onChange={(event) => setMetricName(event.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: '#6E8370' }}>Baseline audience (M)</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  step={0.1}
                  value={baselineAudienceM}
                  onChange={(event) =>
                    patchCheckpoint('baseline', {
                      audienceM: clamp(Number(event.target.value) || 0, 1, 5000),
                    })
                  }
                  style={INPUT_STYLE}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: '#6E8370' }}>Target audience (M)</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  step={0.1}
                  value={targetAudienceM}
                  onChange={(event) =>
                    setTargetAudienceM(clamp(Number(event.target.value) || 0, 1, 5000))
                  }
                  style={INPUT_STYLE}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: '#6E8370' }}>Deadline</span>
                <input
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value || todayIso)}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
          </div>

          <article
            className="rounded-2xl p-4"
            style={{
              background: 'rgba(255,255,255,0.86)',
              border: '1px solid #D8CCB8',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.08em]" style={{ color: '#6E8370' }}>
                  Target attainment
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums" style={{ color: '#1F2B21' }}>
                  {progressPct.toFixed(1)}%
                </p>
              </div>
              <div
                className="grid place-items-center rounded-full"
                style={{
                  width: 78,
                  height: 78,
                  background: `conic-gradient(#4A6B4E ${progressPct}%, #E5DDD0 ${progressPct}% 100%)`,
                }}
              >
                <div
                  className="grid place-items-center rounded-full text-xs font-semibold"
                  style={{ width: 56, height: 56, background: '#FCFAF4', color: '#2A3A2C' }}
                >
                  KR
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-2 text-xs" style={{ color: '#5E765F' }}>
              <div className="flex items-center justify-between">
                <span>Current audience</span>
                <span className="tabular-nums">{currentAudienceM.toFixed(1)}M</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E8E1D4' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${progressPct}%`, background: '#4A6B4E' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span>Gap to target</span>
                <span className="tabular-nums">{Math.max(gapToTargetM, 0).toFixed(1)}M</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E8E1D4' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${requiredDeltaM > 0 ? clamp((Math.max(gapToTargetM, 0) / requiredDeltaM) * 100, 0, 100) : 0}%`,
                    background: '#A89CB8',
                  }}
                />
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pace signal"
          value={onTrack ? 'On track' : 'At risk'}
          sub={
            onTrack
              ? 'Current run-rate can close the target gap.'
              : 'Current run-rate is behind what is required.'
          }
          tone={paceTone}
        />
        <MetricCard
          label="Growth so far"
          value={`${growthPct.toFixed(1)}%`}
          sub={`Target growth is ${targetGrowthPct.toFixed(1)}% by deadline.`}
          tone={growthPct >= targetGrowthPct ? 'positive' : 'warning'}
        />
        <MetricCard
          label="Current velocity"
          value={`${velocityLabel(velocityMPerMonth)}M / month`}
          sub={`Need ${velocityLabel(requiredVelocityMPerMonth)}M / month to finish.`}
          tone={paceTone}
        />
        <MetricCard
          label="Days to deadline"
          value={`${daysRemaining}`}
          sub={daysRemaining >= 0 ? `Due ${deadline}` : `Past due by ${Math.abs(daysRemaining)} days`}
          tone={deadlineTone}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>
              Audience Trend vs Required Trajectory
            </h2>
            <p className="text-xs" style={{ color: '#6E8370' }}>
              Actual and forecast checkpoints against the required line to reach 302M.
            </p>
          </div>
          <HighchartsReact highcharts={Highcharts} options={audienceTrendOptions} />
        </article>

        <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>
              Initiative Impact Mix
            </h2>
            <p className="text-xs" style={{ color: '#6E8370' }}>
              Expected audience lift contribution by active workstream.
            </p>
          </div>
          <HighchartsReact highcharts={Highcharts} options={impactOptions} />
          <div className="mt-2 text-xs" style={{ color: '#6E8370' }}>
            Combined expected uplift from plan: <b>{expectedLiftM.toFixed(1)}M</b>
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">

        {/* ── Left col: Execution Timeline + Initiative Tracker ── */}
        <div className="flex flex-col gap-4">
          <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>
                  Execution Timeline
                </h2>
                <p className="text-xs" style={{ color: '#6E8370' }}>
                  Workstreams driving monthly audience growth through the May 31 deadline.
                </p>
              </div>
              <Pill text={`${tasks.length} initiatives`} bg="#F2EDE6" color="#607860" />
            </div>
            <HighchartsReact highcharts={Highcharts} options={ganttOptions} />
          </article>

          {/* Initiative Tracker */}
          <article className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>Initiative Tracker</h2>
                <p className="text-xs mt-0.5" style={{ color: '#6E8370' }}>Update status and progress per initiative.</p>
              </div>
              <Pill
                text={`${tasks.filter((t) => t.status === 'complete').length}/${tasks.length} complete`}
                bg="#E8F6EA" color="#25693A"
              />
            </div>

            <div className="space-y-1.5 max-h-[480px] overflow-auto pr-0.5">
              {tasks.map((task, index) => {
                const meta = INITIATIVE_STATUS_META[task.status]
                const progressColor =
                  task.progress >= 75 ? '#4A6B4E' : task.progress >= 40 ? '#C8A87A' : '#D49880'

                return (
                  <div
                    key={task.id}
                    className="rounded-xl p-3"
                    style={{ background: '#FAFAF7', border: '1px solid #EDE5D6' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          className="text-[11px] font-bold tabular-nums flex-shrink-0"
                          style={{ color: '#C4B9A8', lineHeight: '1.6', minWidth: 18 }}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-snug truncate" style={{ color: '#1F2B21' }}>
                            {task.label}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: '#9AAE9C' }}>{task.owner}</div>
                        </div>
                      </div>

                      <select
                        value={task.status}
                        onChange={(e) => patchTask(task.id, { status: e.target.value as InitiativeStatus })}
                        style={{
                          flexShrink: 0,
                          appearance: 'none',
                          WebkitAppearance: 'none',
                          background: meta.bg,
                          color: meta.color,
                          border: `1px solid ${meta.color}33`,
                          borderRadius: 20,
                          padding: '4px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {(Object.keys(INITIATIVE_STATUS_META) as InitiativeStatus[]).map((s) => (
                          <option value={s} key={s}>{INITIATIVE_STATUS_META[s].label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0} max={100}
                        value={task.progress}
                        onChange={(e) => patchTask(task.id, { progress: clamp(Number(e.target.value) || 0, 0, 100) })}
                        style={{
                          flexShrink: 0,
                          width: 52,
                          borderRadius: 8,
                          border: '1px solid #DDD0BC',
                          background: '#FFF',
                          color: progressColor,
                          padding: '4px 6px',
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: 'center',
                          lineHeight: 1.3,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div style={{ height: 5, background: '#EDE5D8', borderRadius: 4, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${task.progress}%`,
                              background: progressColor,
                              borderRadius: 4,
                              transition: 'width 0.25s ease',
                              boxShadow: `0 0 5px ${progressColor}55`,
                            }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] font-semibold" style={{ color: progressColor }}>
                          {task.progress}% complete
                        </div>
                      </div>
                      <span className="text-[11px] flex-shrink-0 tabular-nums font-semibold" style={{ color: '#4A6B4E' }}>
                        {task.expectedLiftM.toFixed(1)}M lift
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </article>
        </div>

        {/* ── Right col: Workstream Editor ── */}
        <div className="flex flex-col gap-4">
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
                <p className="text-sm font-medium">No initiatives yet</p>
                <p className="mt-1 text-xs">Click Add to create your first initiative.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[560px] overflow-auto pr-0.5">
                {tasks.map((task) => (
                  <WorkstreamCard23
                    key={task.id}
                    task={task}
                    expanded={expandedId === task.id}
                    onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                    onPatch={(next) => patchTask(task.id, next)}
                    onRemove={() => removeTask(task.id)}
                  />
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4" style={{ borderColor: '#D8CCB8' }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#1F2B21' }}>
              Monthly Audience Checkpoints
            </h2>
            <p className="text-xs" style={{ color: '#6E8370' }}>
              Track observed and forecast readings for the `{metricName}` metric.
            </p>
          </div>
          <Pill text={`${initiativeProgress.toFixed(0)}% avg initiative progress`} bg="#E8F6EA" color="#25693A" />
        </div>

        <div className="overflow-auto border rounded-xl" style={{ borderColor: '#E0D5C4' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#F8F4EC' }}>
              <tr className="text-left text-xs" style={{ color: '#708572' }}>
                <th className="px-3 py-2 font-semibold">Checkpoint</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Audience (M)</th>
              </tr>
            </thead>
            <tbody>
              {sortedCheckpoints.map((checkpoint) => (
                <tr key={checkpoint.id} className="border-t" style={{ borderColor: '#EFE6DA' }}>
                  <td className="px-3 py-2">
                    <input
                      value={checkpoint.label}
                      onChange={(event) => patchCheckpoint(checkpoint.id, { label: event.target.value })}
                      style={{ ...INPUT_STYLE, minWidth: 160, padding: '6px 8px' }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={checkpoint.date}
                      onChange={(event) => patchCheckpoint(checkpoint.id, { date: event.target.value })}
                      style={{ ...INPUT_STYLE, width: 148, padding: '6px 8px' }}
                    />
                    <div className="mt-1 text-xs" style={{ color: '#708572' }}>
                      {formatDateShort(parseDate(checkpoint.date))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={checkpoint.source}
                      onChange={(event) =>
                        patchCheckpoint(checkpoint.id, {
                          source: event.target.value as AudienceSource,
                        })
                      }
                      style={{ ...INPUT_STYLE, minWidth: 110, padding: '6px 8px' }}
                    >
                      <option value="actual">Actual</option>
                      <option value="forecast">Forecast</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      step={0.1}
                      value={checkpoint.audienceM}
                      onChange={(event) =>
                        patchCheckpoint(checkpoint.id, {
                          audienceM: clamp(Number(event.target.value) || 0, 1, 5000),
                        })
                      }
                      style={{ ...INPUT_STYLE, width: 120, padding: '6px 8px' }}
                    />
                    <div className="mt-1 text-xs" style={{ color: '#708572' }}>
                      {checkpoint.source === 'actual' ? 'Observed' : 'Projected'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
