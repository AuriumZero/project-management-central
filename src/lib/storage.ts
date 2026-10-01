import { fromDay, isValidDate, today } from './dates'
import { schedule } from './plan'
import { LINK_TYPES, PRIORITIES, STATUSES, TICKET_TYPES, ZOOMS } from './types'
import type { AppState, Dependency, Project, Task, Ticket } from './types'

/** Same key as the original single-file version, so saved data carries over (older shapes are upgraded on load). */
export const STORAGE_KEY = 'pmc.v1'

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function seedState(todayDay = today()): AppState {
  const D = (offset: number) => fromDay(todayDay + offset)
  const id: Record<string, string> = Object.fromEntries(
    ['discovery', 'interviews', 'requirements', 'design', 'wireframes', 'visual', 'review', 'build', 'frontend', 'content', 'qa', 'launch']
      .map((k) => [k, makeId()]))
  const fs = (pred: string, lag = 0): Dependency => ({ id: id[pred], type: 'FS', lag })
  const t = (key: string, name: string, start: number, end: number, progress: number, extra: Partial<Task> = {}): Task =>
    ({ id: id[key], name, start: D(start), end: D(end), progress, deps: [], parentId: '', assignee: '', ...extra })
  const tasks: Task[] = schedule([
    t('discovery', 'Discovery', -12, -4, 0),
    t('interviews', 'Stakeholder interviews', -12, -8, 100, { parentId: id.discovery, assignee: 'Alex' }),
    t('requirements', 'Requirements document', -7, -4, 100, { parentId: id.discovery, assignee: 'Sam', deps: [fs('interviews')] }),
    t('design', 'Design', -3, 9, 0),
    t('wireframes', 'Wireframes', -3, 2, 70, { parentId: id.design, assignee: 'Priya', deps: [fs('requirements')] }),
    t('visual', 'Visual design', 0, 7, 20, { parentId: id.design, assignee: 'Priya', deps: [{ id: id.wireframes, type: 'SS', lag: 3 }] }),
    t('review', 'Design review', 8, 9, 0, { parentId: id.design, assignee: 'Sam', deps: [fs('visual')] }),
    t('build', 'Build', 10, 30, 0),
    t('frontend', 'Front end', 10, 24, 0, { parentId: id.build, assignee: 'Alex', deps: [fs('design')] }),
    t('content', 'Content migration', 12, 22, 10, { parentId: id.build, assignee: 'Jordan', deps: [{ id: id.frontend, type: 'SS', lag: 2 }] }),
    t('qa', 'QA & fixes', 25, 30, 0, { parentId: id.build, assignee: 'Sam', deps: [fs('frontend'), fs('content')] }),
    t('launch', 'Launch', 31, 31, 0, { milestone: true, deps: [fs('build')] }),
  ], 'weekdays')
  const ticket = (num: number, title: string, status: Ticket['status'], priority: Ticket['priority'], type: Ticket['type'], taskId: string, due?: number, description = ''): Ticket =>
    ({ id: makeId(), num, title, status, priority, type, taskId, due: due == null ? '' : D(due), description, created: D(-14) })
  const tickets: Ticket[] = [
    ticket(1, 'Interview three customers about checkout', 'done', 'medium', 'task', id.interviews),
    ticket(2, 'Mobile nav wireframe', 'doing', 'high', 'feature', id.wireframes, 1, 'Hamburger vs. bottom bar. Test both with two people.'),
    ticket(3, 'Pricing page wireframe', 'todo', 'medium', 'feature', id.wireframes, 2),
    ticket(4, 'Pick type and colour palette', 'todo', 'medium', 'task', id.visual, 5),
    ticket(5, 'Old blog URLs return 404', 'backlog', 'urgent', 'bug', id.content, 14, 'Need 301 redirects for /blog/YYYY/slug.'),
    ticket(6, 'Export product copy from old CMS', 'doing', 'low', 'chore', id.content, 13),
    ticket(7, 'Set up analytics events', 'backlog', 'low', 'task', id.frontend),
  ]
  return {
    v: 2,
    current: 'p1',
    projects: [{
      id: 'p1', name: 'Website relaunch (example)', key: 'WEB',
      description: 'Sample project to show how plans, the Gantt chart and tickets fit together. Edit it or delete it.',
      tasks, tickets, seq: 7, view: 'gantt', zoom: 'day', workWeek: 'weekdays',
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
    // Projects saved before the setting existed get the Microsoft Project default.
    const workWeek = p.workWeek === 'all' ? 'all' : 'weekdays'
    const tasks: Task[] = (Array.isArray(p.tasks) ? p.tasks : []).filter(isObj)
      .filter((t) => isValidDate(t.start) && isValidDate(t.end))
      .map((t) => ({
        id: str(t.id, makeId()),
        name: str(t.name, 'Untitled task'),
        start: t.start as string,
        end: t.end as string,
        progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
        deps: (Array.isArray(t.deps) ? t.deps : []).map(parseDependency).filter((d): d is Dependency => d !== null),
        parentId: str(t.parentId),
        assignee: str(t.assignee),
        milestone: Boolean(t.milestone),
        collapsed: Boolean(t.collapsed),
        notes: str(t.notes),
      }))
    const taskIds = new Set(tasks.map((t) => t.id))
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
      // Repairs the outline, drops links that can't be scheduled and rolls up parents.
      tasks: schedule(tasks, workWeek),
      tickets,
      seq: Math.max(Number(p.seq) || 0, ...tickets.map((t) => t.num), 0),
      view: p.view === 'board' ? 'board' : 'gantt',
      zoom: oneOf(ZOOMS, p.zoom, 'day'),
      workWeek,
    }
  })
  const current = projects.some((p) => p.id === data.current) ? (data.current as string) : projects[0]?.id
  return { v: 2, current, projects }
}

/** Version 1 stored predecessors as bare ids, which meant finish-to-start. */
function parseDependency(value: unknown): Dependency | null {
  if (typeof value === 'string') return { id: value, type: 'FS', lag: 0 }
  if (!isObj(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    type: oneOf(LINK_TYPES.map(([t]) => t), value.type, 'FS'),
    lag: Number.isFinite(Number(value.lag)) ? Math.round(Number(value.lag)) : 0,
  }
}
