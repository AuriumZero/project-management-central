import { addWorkdays, nextWorkday, prevWorkday, snapWorkday, workdayOffset, workdaysBetween } from './calendar'
import type { WorkWeek } from './calendar'
import { fromDay, spanDays, toDay } from './dates'
import type { Dependency, LinkType, Task } from './types'

// The plan is a two-level outline: parent tasks (no parentId) and their
// subtasks. Everything here is pure so the scheduling rules can be tested
// without rendering anything.

export interface OutlineRow {
  task: Task
  /** Row number shown in the ID column and used in predecessor text, starting at 1. */
  num: number
  depth: 0 | 1
  hasChildren: boolean
  /** True when a collapsed parent hides this row. */
  hidden: boolean
}

export function childrenOf(tasks: Task[], id: string): Task[] {
  return tasks.filter((t) => t.parentId === id)
}

/** Tasks in display order: each parent followed by its subtasks. */
export function outline(tasks: Task[]): OutlineRow[] {
  const rows: OutlineRow[] = []
  for (const parent of tasks.filter((t) => !t.parentId)) {
    const kids = childrenOf(tasks, parent.id)
    rows.push({ task: parent, num: rows.length + 1, depth: 0, hasChildren: kids.length > 0, hidden: false })
    for (const kid of kids) {
      rows.push({ task: kid, num: rows.length + 1, depth: 1, hasChildren: false, hidden: Boolean(parent.collapsed) })
    }
  }
  return rows
}

/** The overall project span and progress, shown as the project summary row. */
export function projectSummary(tasks: Task[]): { start: number; end: number; progress: number } | null {
  const leaves = tasks.filter((t) => !tasks.some((c) => c.parentId === t.id))
  if (!leaves.length) return null
  return {
    start: Math.min(...leaves.map((t) => toDay(t.start))),
    end: Math.max(...leaves.map((t) => toDay(t.end))),
    progress: weightedProgress(leaves),
  }
}

function weightedProgress(tasks: Task[]): number {
  const total = tasks.reduce((sum, t) => sum + spanDays(t.start, t.end), 0)
  return total ? Math.round(tasks.reduce((sum, t) => sum + spanDays(t.start, t.end) * t.progress, 0) / total) : 0
}

/** Parent dates and progress come from their subtasks. */
export function rollup(tasks: Task[]): Task[] {
  return tasks.map((t) => {
    const kids = childrenOf(tasks, t.id)
    if (!kids.length) return t
    const start = fromDay(Math.min(...kids.map((k) => toDay(k.start))))
    const end = fromDay(Math.max(...kids.map((k) => toDay(k.end))))
    const progress = weightedProgress(kids)
    return t.start === start && t.end === end && t.progress === progress && !t.milestone
      ? t
      : { ...t, start, end, progress, milestone: false }
  })
}

/** Ids of the tasks that carry real dates for `id`: its subtasks, or itself. */
function leavesOf(tasks: Task[], id: string): string[] {
  const kids = childrenOf(tasks, id)
  return kids.length ? kids.map((k) => k.id) : [id]
}

/**
 * Repairs the outline and drops dependencies that can't be scheduled:
 * links to missing tasks, links between a parent and its own subtasks, and
 * any link that would close a loop. Links are kept first come, first served.
 */
export function sanitize(input: Task[]): Task[] {
  const ids = new Set(input.map((t) => t.id))
  const topLevel = new Set(input.filter((t) => !t.parentId || !ids.has(t.parentId)).map((t) => t.id))
  // Only two levels: a subtask's parent must itself be top level.
  const tasks = input.map((t) => (t.parentId && !topLevel.has(t.parentId) ? { ...t, parentId: '' } : t))

  const edges = new Map<string, Set<string>>()
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length) {
      const n = stack.pop()!
      if (n === to) return true
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(edges.get(n) ?? []))
    }
    return false
  }

  return tasks.map((t) => {
    const kept: Dependency[] = []
    for (const dep of t.deps) {
      if (dep.id === t.id || !tasks.some((x) => x.id === dep.id) || kept.some((k) => k.id === dep.id)) continue
      const from = leavesOf(tasks, dep.id)
      const to = leavesOf(tasks, t.id)
      if (from.some((f) => to.some((s) => f === s || reaches(s, f)))) continue
      for (const f of from) {
        const set = edges.get(f) ?? new Set<string>()
        to.forEach((s) => set.add(s))
        edges.set(f, set)
      }
      kept.push(dep)
    }
    return kept.length === t.deps.length ? t : { ...t, deps: kept }
  })
}

/** A task's length in working days; milestones have none. */
export function duration(task: Task, week: WorkWeek): number {
  return task.milestone ? 0 : Math.max(1, workdaysBetween(toDay(task.start), toDay(task.end), week))
}

/** Places a task at `start` (snapped onto the calendar), keeping its working-day length. */
export function placeAt(task: Task, start: number, week: WorkWeek, direction = 1): Task {
  const length = duration(task, week)
  const s = snapWorkday(start, direction, week)
  const e = task.milestone ? s : addWorkdays(s, length - 1, week)
  const next = { ...task, start: fromDay(s), end: fromDay(e) }
  return next.start === task.start && next.end === task.end ? task : next
}

/**
 * Moves a task by `days` calendar days and, for a parent, moves each of its
 * subtasks by the same number of working days so the group keeps its shape.
 */
export function shiftTree(tasks: Task[], id: string, days: number, week: WorkWeek = 'all'): Task[] {
  if (!days) return tasks
  const root = tasks.find((t) => t.id === id)
  if (!root) return tasks
  const from = nextWorkday(toDay(root.start), week)
  const to = snapWorkday(from + days, days, week)
  const offset = workdayOffset(from, to, week)
  return tasks.map((t) => {
    if (t.id !== id && t.parentId !== id) return t
    if (t.id === id && tasks.some((c) => c.parentId === id)) return t // rolled up afterwards
    return placeAt(t, addWorkdays(toDay(t.start), offset, week), week, offset)
  })
}

/** Snaps every task onto working days, keeping its working-day length. */
function normalize(tasks: Task[], week: WorkWeek): Task[] {
  if (week === 'all') return tasks
  return tasks.map((t) => {
    const s = nextWorkday(toDay(t.start), week)
    const e = t.milestone ? s : Math.max(s, prevWorkday(toDay(t.end), week))
    return fromDay(s) === t.start && fromDay(e) === t.end ? t : { ...t, start: fromDay(s), end: fromDay(e) }
  })
}

/**
 * The earliest working day the successor may start on to satisfy one link.
 * Lag counts working days. A milestone counts as finishing on its own day.
 */
export function earliestStart(pred: Task, succ: Task, dep: Pick<Dependency, 'type' | 'lag'>, week: WorkWeek = 'all'): number {
  const ps = toDay(pred.start)
  const pe = toDay(pred.end)
  const back = (finish: number) => addWorkdays(finish, -(Math.max(1, duration(succ, week)) - 1), week)
  switch (dep.type) {
    case 'FS': return addWorkdays(pe, 1 + dep.lag, week)
    case 'SS': return addWorkdays(ps, dep.lag, week)
    case 'FF': return back(addWorkdays(pe, dep.lag, week))
    case 'SF': return back(addWorkdays(ps, dep.lag - 1, week))
  }
}

/** How many calendar days the successor must move later to satisfy one link (0 if it already does). */
export function requiredDelay(pred: Task, succ: Task, dep: Pick<Dependency, 'type' | 'lag'>, week: WorkWeek = 'all'): number {
  return Math.max(0, earliestStart(pred, succ, dep, week) - toDay(succ.start))
}

/**
 * The earliest start the links allow for a lowest-level task: its own links,
 * plus its parent's (a link to a parent applies to every subtask). Null when
 * nothing links to it.
 */
export function linkedStart(tasks: Task[], task: Task, week: WorkWeek = 'all'): number | null {
  const parent = task.parentId ? tasks.find((p) => p.id === task.parentId) : undefined
  let best: number | null = null
  for (const dep of [...task.deps, ...(parent?.deps ?? [])]) {
    const pred = tasks.find((x) => x.id === dep.id)
    if (!pred) continue
    const s = earliestStart(pred, task, dep, week)
    best = best === null ? s : Math.max(best, s)
  }
  return best
}

const isLeaf = (tasks: Task[], id: string) => !tasks.some((t) => t.parentId === id)

/**
 * Auto-schedules the plan the way Microsoft Project does by default: a task
 * with predecessors starts as soon as they allow, moving earlier or later as
 * they change. A start you set by hand on a linked task (`pin`) works as
 * "start no earlier than": the task can still be pushed later, but isn't
 * pulled earlier. Tasks with no links stay where you put them, and parents
 * are rolled up from their subtasks.
 */
export function schedule(input: Task[], week: WorkWeek = 'all'): Task[] {
  let tasks = rollup(normalize(sanitize(input), week))
  // A pin only means something on a linked task.
  tasks = tasks.map((t) => (t.pin && linkedStart(tasks, t, week) === null ? withoutPin(t) : t))
  const ids = tasks.filter((t) => isLeaf(tasks, t.id)).map((t) => t.id)
  const limit = tasks.length * 4 + 10
  for (let pass = 0; pass < limit; pass++) {
    let changed = false
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id)!
      const linked = linkedStart(tasks, t, week)
      if (linked === null) continue
      const placed = placeAt(t, Math.max(linked, t.pin ? toDay(t.pin) : linked), week)
      if (placed !== t) {
        tasks = rollup(tasks.map((x) => (x.id === id ? placed : x)))
        changed = true
      }
    }
    if (!changed) break
  }
  return tasks
}

export function withoutPin(task: Task): Task {
  if (!task.pin) return task
  const { pin: _pin, ...rest } = task
  return rest
}

/**
 * Plans saved before tasks followed their predecessors only ever pushed tasks
 * later, so a gap after a predecessor was set by hand. This pins those tasks
 * so upgrading doesn't move anything.
 */
export function keepManualStarts(input: Task[], week: WorkWeek): Task[] {
  const tasks = rollup(normalize(sanitize(input), week))
  return tasks.map((t) => {
    if (!isLeaf(tasks, t.id)) return t
    const linked = linkedStart(tasks, t, week)
    return linked !== null && toDay(t.start) > linked ? { ...t, pin: t.start } : t
  })
}

const LINK_RE = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?)?)?$/i

/** One link in Microsoft Project's notation: `3`, `5SS`, `7FF-1d`. */
export function formatLink(num: number, link: Pick<Dependency, 'type' | 'lag'>): string {
  const lag = link.lag ? `${link.lag > 0 ? '+' : ''}${link.lag}d` : ''
  return `${num}${link.type === 'FS' && !lag ? '' : link.type}${lag}`
}

/** Formats predecessors the way Microsoft Project does: `3, 5SS+2d`. */
export function formatPredecessors(task: Task, numById: Map<string, number>): string {
  return task.deps
    .filter((d) => numById.has(d.id))
    .map((d) => formatLink(numById.get(d.id)!, d))
    .join(', ')
}

/** The tasks waiting on `task`, in the same notation: `4, 6SS+1d`. */
export function formatSuccessors(task: Task, tasks: Task[], numById: Map<string, number>): string {
  return tasks
    .flatMap((t) => t.deps.filter((d) => d.id === task.id && numById.has(t.id)).map((d) => ({ num: numById.get(t.id)!, d })))
    .sort((x, y) => x.num - y.num)
    .map(({ num, d }) => formatLink(num, d))
    .join(', ')
}

/** Reads predecessor text such as `3, 5SS+2d, 7FF-1d`. */
export function parsePredecessors(text: string, idByNum: Map<number, string>, selfId: string): Dependency[] | string {
  const deps: Dependency[] = []
  for (const raw of text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = LINK_RE.exec(raw)
    if (!m) return `Couldn't read "${raw}". Use a row number like 3, or a link like 3SS+2d.`
    const id = idByNum.get(Number(m[1]))
    if (!id) return `There's no row ${m[1]}.`
    if (id === selfId) return "A task can't depend on itself."
    const lag = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0
    deps.push({ id, type: (m[2]?.toUpperCase() ?? 'FS') as LinkType, lag })
  }
  return deps
}

const linkCount = (tasks: Task[]) => tasks.reduce((n, t) => n + t.deps.length, 0)

/** True when a proposed plan has a link `sanitize` would drop, such as one that closes a loop. */
export function dropsLinks(tasks: Task[]): boolean {
  return linkCount(sanitize(tasks)) < linkCount(tasks)
}
