import { dayOfMonth, formatDay, toDay, weekday } from './dates'
import { projectSummary } from './plan'
import type { Dependency, ISODate, LinkType, Project, Zoom } from './types'

/** Pixel width of one day at each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 34, week: 14, month: 5 }
export const ROW_HEIGHT = 40
export const BAR_HEIGHT = 22

export interface ProjectStats {
  /** Completion of the lowest-level tasks, weighted by duration, 0–100. */
  percent: number
  openTickets: number
  /** First start and last end day, or null with no tasks. */
  span: [number, number] | null
}

export function projectStats(project: Project): ProjectStats {
  const summary = projectSummary(project.tasks)
  return {
    percent: summary?.progress ?? 0,
    openTickets: project.tickets.filter((t) => t.status !== 'done').length,
    span: summary ? [summary.start, summary.end] : null,
  }
}

/** Derives a ticket prefix from a name when none is given: "Website relaunch" → "WR". */
export function projectKey(name: string, key = ''): string {
  const source = key.trim() || name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 4)
  return source.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PRJ'
}

/** One row of the chart, in display order. */
export interface ChartRow {
  id: string
  start: ISODate
  end: ISODate
  milestone: boolean
  /** Drawn as a summary bracket: the project row and parents with subtasks. */
  summary: boolean
  deps: Dependency[]
}

export interface Bar {
  id: string
  x: number
  y: number
  width: number
  kind: 'task' | 'milestone' | 'summary'
}

export interface Arrow {
  /** Predecessor and successor ids. */
  from: string
  to: string
  type: LinkType
  path: string
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
  arrows: Arrow[]
  todayX: number | null
}

const MILESTONE = 18
export const SUMMARY_HEIGHT = 10

/**
 * Computes every position the Gantt chart draws: the visible date range,
 * the scale labels, the bars and the dependency arrows.
 */
export function ganttLayout(rows: ChartRow[], zoom: Zoom, todayDay: number, minWidth = 1100): GanttLayout {
  const dayWidth = DAY_WIDTH[zoom]
  const min = Math.min(todayDay, ...rows.map((t) => toDay(t.start))) - 3
  let max = Math.max(todayDay, ...rows.map((t) => toDay(t.end))) + 14
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

  const centerY = (i: number) => i * ROW_HEIGHT + ROW_HEIGHT / 2
  const bars: Bar[] = rows.map((t, i) => {
    const s = toDay(t.start)
    const e = toDay(t.end)
    if (t.summary) return { id: t.id, x: X(s), y: centerY(i) - SUMMARY_HEIGHT / 2, width: (e - s + 1) * dayWidth, kind: 'summary' }
    if (t.milestone) return { id: t.id, x: X(s) + dayWidth / 2 - MILESTONE / 2, y: centerY(i) - MILESTONE / 2, width: MILESTONE, kind: 'milestone' }
    return { id: t.id, x: X(s), y: centerY(i) - BAR_HEIGHT / 2, width: (e - s + 1) * dayWidth, kind: 'task' }
  })
  const index = new Map(rows.map((r, i) => [r.id, i]))
  const edges = (i: number) => ({ left: bars[i].x, right: bars[i].x + bars[i].width })

  const arrows: Arrow[] = []
  rows.forEach((t, i) => {
    for (const dep of t.deps) {
      const j = index.get(dep.id)
      if (j === undefined) continue
      // Leave the predecessor from its finish (FS, FF) or start (SS, SF) and
      // enter the successor at its start (FS, SS) or finish (FF, SF).
      const fromFinish = dep.type === 'FS' || dep.type === 'FF'
      const toStart = dep.type === 'FS' || dep.type === 'SS'
      arrows.push({
        from: dep.id, to: t.id, type: dep.type,
        path: linkPath(fromFinish ? edges(j).right : edges(j).left, centerY(j), fromFinish ? 1 : -1,
          toStart ? edges(i).left : edges(i).right, centerY(i), toStart ? 1 : -1),
      })
    }
  })

  return {
    min, max, dayWidth,
    width: (max - min + 1) * dayWidth,
    height: (rows.length + 1) * ROW_HEIGHT,
    months, days, gridLines, weekends, bars, arrows,
    todayX: todayDay >= min && todayDay <= max ? X(todayDay) + dayWidth / 2 : null,
  }
}

/**
 * An elbow connector. `out` is the direction it leaves the predecessor
 * (1 = rightward), `into` the direction it travels as it enters the
 * successor (1 = rightward, into a start edge).
 */
export function linkPath(x1: number, y1: number, out: 1 | -1, x2: number, y2: number, into: 1 | -1): string {
  const stub = 8
  const a = x1 + out * stub
  const b = x2 - into * stub
  const tip = x2 - into
  // SS and FF links can always turn on the outer side of both bars.
  if (out !== into) return `M${x1} ${y1} H${out === 1 ? Math.max(a, b) : Math.min(a, b)} V${y2} H${tip}`
  if ((b - a) * into >= 0) return `M${x1} ${y1} H${a} V${y2} H${tip}`
  // No straight route: drop to the gap between the rows, cross, then come in.
  const mid = y2 + (y2 > y1 ? -1 : 1) * (ROW_HEIGHT / 2)
  return `M${x1} ${y1} H${a} V${mid} H${b} V${y2} H${tip}`
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
