import { fromDay, isValidDate, today } from './dates'
import { PRIORITIES, STATUSES, TICKET_TYPES, ZOOMS } from './types'
import type { AppState, Project, Task, Ticket } from './types'

/** Same key and shape as the original single-file version, so saved data carries over. */
export const STORAGE_KEY = 'pmc.v1'

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function seedState(todayDay = today()): AppState {
  const D = (offset: number) => fromDay(todayDay + offset)
  const ids = Array.from({ length: 7 }, makeId)
  const tasks: Task[] = [
    { id: ids[0], name: 'Discovery & requirements', start: D(-12), end: D(-6), progress: 100, deps: [] },
    { id: ids[1], name: 'Wireframes', start: D(-5), end: D(1), progress: 75, deps: [ids[0]] },
    { id: ids[2], name: 'Visual design', start: D(2), end: D(9), progress: 0, deps: [ids[1]] },
    { id: ids[3], name: 'Build front end', start: D(10), end: D(24), progress: 0, deps: [ids[2]] },
    { id: ids[4], name: 'Content migration', start: D(6), end: D(18), progress: 10, deps: [] },
    { id: ids[5], name: 'QA & fixes', start: D(25), end: D(30), progress: 0, deps: [ids[3], ids[4]] },
    { id: ids[6], name: 'Launch', start: D(31), end: D(31), progress: 0, deps: [ids[5]], milestone: true },
  ]
  const ticket = (num: number, title: string, status: Ticket['status'], priority: Ticket['priority'], type: Ticket['type'], taskId: string, due?: number, description = ''): Ticket =>
    ({ id: makeId(), num, title, status, priority, type, taskId, due: due == null ? '' : D(due), description, created: D(-14) })
  const tickets: Ticket[] = [
    ticket(1, 'Interview three customers about checkout', 'done', 'medium', 'task', ids[0]),
    ticket(2, 'Mobile nav wireframe', 'doing', 'high', 'feature', ids[1], 1, 'Hamburger vs. bottom bar. Test both with two people.'),
    ticket(3, 'Pricing page wireframe', 'todo', 'medium', 'feature', ids[1], 1),
    ticket(4, 'Pick type and colour palette', 'todo', 'medium', 'task', ids[2], 5),
    ticket(5, 'Old blog URLs return 404', 'backlog', 'urgent', 'bug', ids[4], 12, 'Need 301 redirects for /blog/YYYY/slug.'),
    ticket(6, 'Export product copy from old CMS', 'doing', 'low', 'chore', ids[4], 9),
    ticket(7, 'Set up analytics events', 'backlog', 'low', 'task', ids[3]),
  ]
  return {
    v: 1,
    current: 'p1',
    projects: [{
      id: 'p1', name: 'Website relaunch (example)', key: 'WEB',
      description: 'Sample project to show how plans, the Gantt chart and tickets fit together. Edit it or delete it.',
      tasks, tickets, seq: 7, view: 'gantt', zoom: 'day',
    }],
  }
}

export function loadState(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): AppState | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = parseBackup(raw)
    return typeof parsed === 'string' ? null : parsed
  } catch {
    return null
  }
}

/** Returns false when the browser refuses to save (private mode, full quota). */
export function saveState(state: AppState, storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * Parses and cleans up a backup file. Returns the state, or a message
 * explaining why the file can't be used.
 */
export function parseBackup(text: string): AppState | string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return 'That file is not a valid backup.'
  }
  if (!isObj(data) || !Array.isArray(data.projects)) return 'That file is not a Project Management Central backup.'

  const projects: Project[] = data.projects.filter(isObj).map((p) => {
    const tasks: Task[] = (Array.isArray(p.tasks) ? p.tasks : []).filter(isObj)
      .filter((t) => isValidDate(t.start) && isValidDate(t.end))
      .map((t) => ({
        id: str(t.id, makeId()),
        name: str(t.name, 'Untitled task'),
        start: t.start as string,
        end: t.end as string,
        progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
        deps: Array.isArray(t.deps) ? t.deps.filter((d): d is string => typeof d === 'string') : [],
        milestone: Boolean(t.milestone),
        notes: str(t.notes),
      }))
    const taskIds = new Set(tasks.map((t) => t.id))
    tasks.forEach((t) => { t.deps = t.deps.filter((d) => taskIds.has(d) && d !== t.id) })
    const tickets: Ticket[] = (Array.isArray(p.tickets) ? p.tickets : []).filter(isObj).map((t, i) => ({
      id: str(t.id, makeId()),
      num: Number.isInteger(t.num) ? (t.num as number) : i + 1,
      title: str(t.title, 'Untitled ticket'),
      status: oneOf(STATUSES.map(([s]) => s), t.status, 'todo'),
      priority: oneOf(PRIORITIES, t.priority, 'medium'),
      type: oneOf(TICKET_TYPES, t.type, 'task'),
      taskId: taskIds.has(str(t.taskId)) ? str(t.taskId) : '',
      due: isValidDate(t.due) ? t.due : '',
      description: str(t.description),
      created: isValidDate(t.created) ? t.created : fromDay(today()),
    }))
    return {
      id: str(p.id, makeId()),
      name: str(p.name, 'Untitled project'),
      key: str(p.key, 'PRJ'),
      description: str(p.description),
      tasks,
      tickets,
      seq: Math.max(Number(p.seq) || 0, ...tickets.map((t) => t.num), 0),
      view: p.view === 'board' ? 'board' : 'gantt',
      zoom: oneOf(ZOOMS, p.zoom, 'day'),
    }
  })
  const current = projects.some((p) => p.id === data.current) ? (data.current as string) : projects[0]?.id
  return { v: 1, current, projects }
}
