import { fromDay, toDay } from '../lib/dates'
import type { AppState, Project, Status, Task, Ticket, View, Zoom } from '../lib/types'

export type Action =
  | { type: 'selectProject'; id: string }
  | { type: 'setView'; view: View }
  | { type: 'setZoom'; zoom: Zoom }
  | { type: 'createProject'; project: Pick<Project, 'id' | 'name' | 'key' | 'description'> }
  | { type: 'updateProject'; patch: Pick<Project, 'name' | 'key' | 'description'> }
  | { type: 'deleteProject' }
  | { type: 'saveTask'; task: Task }
  | { type: 'moveTask'; id: string; by: -1 | 1 }
  | { type: 'shiftTask'; id: string; start: number; end: number }
  | { type: 'deleteTask'; id: string }
  | { type: 'saveTicket'; ticket: Ticket }
  | { type: 'setTicketStatus'; id: string; status: Status }
  | { type: 'deleteTicket'; id: string }
  | { type: 'replaceAll'; state: AppState }

export function currentProject(state: AppState): Project | undefined {
  return state.projects.find((p) => p.id === state.current) ?? state.projects[0]
}

/** Applies `fn` to the current project, leaving every other project untouched. */
function withCurrent(state: AppState, fn: (p: Project) => Project): AppState {
  const project = currentProject(state)
  if (!project) return state
  const next = fn(project)
  return next === project ? state : { ...state, projects: state.projects.map((p) => (p === project ? next : p)) }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'selectProject':
      return state.projects.some((p) => p.id === action.id) ? { ...state, current: action.id } : state

    case 'setView':
      return withCurrent(state, (p) => ({ ...p, view: action.view }))

    case 'setZoom':
      return withCurrent(state, (p) => ({ ...p, zoom: action.zoom }))

    case 'createProject':
      return {
        ...state,
        current: action.project.id,
        projects: [...state.projects, { ...action.project, tasks: [], tickets: [], seq: 0, view: 'gantt', zoom: 'day' }],
      }

    case 'updateProject':
      return withCurrent(state, (p) => ({ ...p, ...action.patch }))

    case 'deleteProject': {
      const project = currentProject(state)
      const projects = state.projects.filter((p) => p !== project)
      return { ...state, projects, current: projects[0]?.id }
    }

    case 'saveTask':
      return withCurrent(state, (p) => {
        const task: Task = { ...action.task, end: action.task.milestone ? action.task.start : action.task.end }
        const exists = p.tasks.some((t) => t.id === task.id)
        return { ...p, tasks: exists ? p.tasks.map((t) => (t.id === task.id ? task : t)) : [...p.tasks, task] }
      })

    case 'moveTask':
      return withCurrent(state, (p) => {
        const i = p.tasks.findIndex((t) => t.id === action.id)
        const j = i + action.by
        if (i < 0 || j < 0 || j >= p.tasks.length) return p
        const tasks = [...p.tasks]
        ;[tasks[i], tasks[j]] = [tasks[j], tasks[i]]
        return { ...p, tasks }
      })

    case 'shiftTask':
      return withCurrent(state, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => {
          if (t.id !== action.id) return t
          const start = toDay(t.start) + action.start
          const end = t.milestone ? start : Math.max(start, toDay(t.end) + action.end)
          return { ...t, start: fromDay(start), end: fromDay(end) }
        }),
      }))

    case 'deleteTask':
      return withCurrent(state, (p) => ({
        ...p,
        tasks: p.tasks.filter((t) => t.id !== action.id).map((t) => ({ ...t, deps: t.deps.filter((d) => d !== action.id) })),
        tickets: p.tickets.map((t) => (t.taskId === action.id ? { ...t, taskId: '' } : t)),
      }))

    case 'saveTicket':
      return withCurrent(state, (p) => {
        if (p.tickets.some((t) => t.id === action.ticket.id)) {
          return { ...p, tickets: p.tickets.map((t) => (t.id === action.ticket.id ? action.ticket : t)) }
        }
        const seq = p.seq + 1
        return { ...p, seq, tickets: [...p.tickets, { ...action.ticket, num: seq }] }
      })

    case 'setTicketStatus':
      return withCurrent(state, (p) => ({
        ...p,
        tickets: p.tickets.map((t) => (t.id === action.id ? { ...t, status: action.status } : t)),
      }))

    case 'deleteTicket':
      return withCurrent(state, (p) => ({ ...p, tickets: p.tickets.filter((t) => t.id !== action.id) }))

    case 'replaceAll':
      return action.state
  }
}
