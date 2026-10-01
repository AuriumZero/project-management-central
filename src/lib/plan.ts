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

/** Moves a task and, for a parent, all of its subtasks. */
export function shiftTree(tasks: Task[], id: string, days: number): Task[] {
  if (!days) return tasks
  const move = (t: Task): Task => ({ ...t, start: fromDay(toDay(t.start) + days), end: fromDay(toDay(t.end) + days) })
  return tasks.map((t) => (t.id === id || t.parentId === id ? move(t) : t))
}

/** How many days the successor must move later to satisfy one link (0 if it already does). */
export function requiredDelay(pred: Task, succ: Task, dep: Pick<Dependency, 'type' | 'lag'>): number {
  const ps = toDay(pred.start)
  const pe = toDay(pred.end)
  const ss = toDay(succ.start)
  const se = toDay(succ.end)
  const need: Record<LinkType, number> = {
    FS: pe + 1 + dep.lag - ss,
    SS: ps + dep.lag - ss,
    FF: pe + dep.lag - se,
    SF: ps - 1 + dep.lag - se,
  }
  return Math.max(0, need[dep.type])
}

/**
 * Auto-schedules the plan: successors are pushed later until every link is
 * satisfied, and parents are rolled up from their subtasks. Tasks are never
 * pulled earlier, so slack you add by hand is kept.
 */
export function schedule(input: Task[]): Task[] {
  let tasks = rollup(sanitize(input))
  const limit = tasks.length * 4 + 10
  for (let pass = 0; pass < limit; pass++) {
    let changed = false
    for (const t of tasks) {
      for (const dep of t.deps) {
        const pred = tasks.find((x) => x.id === dep.id)
        const succ = tasks.find((x) => x.id === t.id)!
        if (!pred) continue
        const delay = requiredDelay(pred, succ, dep)
        if (delay > 0) {
          tasks = rollup(shiftTree(tasks, t.id, delay))
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return tasks
}

const LINK_RE = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?)?)?$/i

/** Formats predecessors the way Microsoft Project does: `3, 5SS+2d`. */
export function formatPredecessors(task: Task, numById: Map<string, number>): string {
  return task.deps
    .filter((d) => numById.has(d.id))
    .map((d) => {
      const lag = d.lag ? `${d.lag > 0 ? '+' : ''}${d.lag}d` : ''
      return `${numById.get(d.id)}${d.type === 'FS' && !lag ? '' : d.type}${lag}`
    })
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
