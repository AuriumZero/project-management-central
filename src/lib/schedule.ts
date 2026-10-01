import { dayOfMonth, formatDay, spanDays, toDay, weekday } from './dates'
import type { Project, Task, Zoom } from './types'

/** Pixel width of one day at each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 34, week: 14, month: 5 }
export const ROW_HEIGHT = 40
export const BAR_HEIGHT = 22

export interface ProjectStats {
  /** Completion weighted by task duration, 0–100. */
  percent: number
  openTickets: number
  /** First start and last end day, or null with no tasks. */
  span: [number, number] | null
}

export function projectStats(project: Project): ProjectStats {
  const { tasks, tickets } = project
  const total = tasks.reduce((sum, t) => sum + spanDays(t.start, t.end), 0)
  const done = tasks.reduce((sum, t) => sum + spanDays(t.start, t.end) * t.progress, 0)
  return {
    percent: total ? Math.round(done / total) : 0,
    openTickets: tickets.filter((t) => t.status !== 'done').length,
    span: tasks.length
      ? [Math.min(...tasks.map((t) => toDay(t.start))), Math.max(...tasks.map((t) => toDay(t.end)))]
      : null,
  }
}

/** Derives a ticket prefix from a name when none is given: "Website relaunch" → "WR". */
export function projectKey(name: string, key = ''): string {
  const source = key.trim() || name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 4)
  return source.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PRJ'
}

export interface Bar {
  id: string
  x: number
  y: number
  width: number
  milestone: boolean
}

export interface ScaleMark {
  x: number
  width: number
  label: string
  weekStart: boolean
  weekend: boolean
  isToday: boolean
}

export interface GanttLayout {
  min: number
  max: number
  dayWidth: number
  width: number
  height: number
  months: { x: number; label: string }[]
  days: ScaleMark[]
  gridLines: number[]
  weekends: { x: number; width: number }[]
  bars: Bar[]
  arrows: string[]
  todayX: number | null
}

const MILESTONE = 18

/**
 * Computes every position the Gantt chart draws: the visible date range,
 * the scale labels, the task bars and the dependency arrows.
 */
export function ganttLayout(tasks: Task[], zoom: Zoom, todayDay: number, minWidth = 1100): GanttLayout {
  const dayWidth = DAY_WIDTH[zoom]
  const min = Math.min(todayDay, ...tasks.map((t) => toDay(t.start))) - 3
  let max = Math.max(todayDay, ...tasks.map((t) => toDay(t.end))) + 14
  const minDays = Math.ceil(minWidth / dayWidth)
  if (max - min + 1 < minDays) max = min + minDays - 1
  const X = (day: number) => (day - min) * dayWidth

  const months: GanttLayout['months'] = []
  const days: ScaleMark[] = []
  const gridLines: number[] = []
  const weekends: GanttLayout['weekends'] = []
  for (let d = min; d <= max; d++) {
    const dom = dayOfMonth(d)
    const wd = weekday(d)
    if (dom === 1 || d === min) months.push({ x: X(d), label: formatDay(d, { month: dayWidth < 10 ? 'short' : 'long', year: 'numeric' }) })
    if (zoom === 'day') {
      days.push({ x: X(d), width: dayWidth, label: String(dom), weekStart: wd === 1, weekend: wd === 0 || wd === 6, isToday: d === todayDay })
      gridLines.push(X(d))
      if (wd === 0 || wd === 6) weekends.push({ x: X(d), width: dayWidth })
    } else if (wd === 1) {
      if (zoom === 'week') days.push({ x: X(d) - 10, width: 24, label: String(dom), weekStart: true, weekend: false, isToday: false })
      gridLines.push(X(d))
    }
  }

  const row = new Map(tasks.map((t, i) => [t.id, i]))
  const centerY = (i: number) => i * ROW_HEIGHT + ROW_HEIGHT / 2
  const bars: Bar[] = tasks.map((t, i) => {
    const s = toDay(t.start)
    const e = toDay(t.end)
    return t.milestone
      ? { id: t.id, x: X(s) + dayWidth / 2 - MILESTONE / 2, y: centerY(i) - MILESTONE / 2, width: MILESTONE, milestone: true }
      : { id: t.id, x: X(s), y: centerY(i) - BAR_HEIGHT / 2, width: (e - s + 1) * dayWidth, milestone: false }
  })

  const arrows: string[] = []
  tasks.forEach((t, i) => {
    for (const depId of t.deps) {
      const j = row.get(depId)
      if (j === undefined) continue
      const dep = tasks[j]
      const x1 = dep.milestone ? X(toDay(dep.end)) + dayWidth / 2 + MILESTONE / 2 : X(toDay(dep.end) + 1)
      const x2 = t.milestone ? X(toDay(t.start)) + dayWidth / 2 - MILESTONE / 2 - 3 : X(toDay(t.start))
      const y1 = centerY(j)
      const y2 = centerY(i)
      const dir = y2 > y1 ? 1 : -1
      arrows.push(x2 - x1 >= 12
        ? `M${x1} ${y1} H${x1 + 6} V${y2} H${x2 - 1}`
        // Successor starts before the predecessor ends: route around between rows.
        : `M${x1} ${y1} H${x1 + 6} V${y2 - (dir * ROW_HEIGHT) / 2} H${x2 - 8} V${y2} H${x2 - 1}`)
    }
  })

  return {
    min, max, dayWidth,
    width: (max - min + 1) * dayWidth,
    height: (tasks.length + 1) * ROW_HEIGHT,
    months, days, gridLines, weekends, bars, arrows,
    todayX: todayDay >= min && todayDay <= max ? X(todayDay) + dayWidth / 2 : null,
  }
}

export type DragMode = 'move' | 'start' | 'end'

/**
 * Turns a horizontal drag of `deltaDays` into start and end offsets.
 * Resizing never lets a task end before it starts.
 */
export function dragOffsets(mode: DragMode, deltaDays: number, lengthDays: number): { start: number; end: number } {
  if (mode === 'move') return { start: deltaDays, end: deltaDays }
  if (mode === 'start') return { start: Math.min(deltaDays, lengthDays - 1), end: 0 }
  return { start: 0, end: Math.max(deltaDays, 1 - lengthDays) }
}
