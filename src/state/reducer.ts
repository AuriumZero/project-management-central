import { fromDay, toDay } from '../lib/dates'
import { addWorkdays, snapWorkday } from '../lib/calendar'
import type { WorkWeek } from '../lib/calendar'
import { childrenOf, placeAt, schedule, shiftTree } from '../lib/plan'
import type { AppState, Dependency, Project, Status, Task, Ticket, View, Zoom } from '../lib/types'

export type Action =
  | { type: 'selectProject'; id: string }
  | { type: 'setView'; view: View }
  | { type: 'setZoom'; zoom: Zoom }
  | { type: 'createProject'; project: Pick<Project, 'id' | 'name' | 'key' | 'description'> & Partial<Pick<Project, 'workWeek'>> }
  | { type: 'updateProject'; patch: Pick<Project, 'name' | 'key' | 'description'> }
  | { type: 'deleteProject' }
  | { type: 'saveTask'; task: Task; successors?: Dependency[] }
  /** Inline edits. A new start keeps the task's length; `days` sets the length in working days. */
  | { type: 'updateTask'; id: string; patch: Partial<Omit<Task, 'id'>> & { days?: number } }
  | { type: 'setWorkWeek'; workWeek: WorkWeek }
  | { type: 'moveTask'; id: string; by: -1 | 1 }
  | { type: 'indentTask'; id: string }
  | { type: 'outdentTask'; id: string }
  | { type: 'toggleCollapse'; id: string }
  | { type: 'addLink'; from: string; to: string; link?: Omit<Dependency, 'id'> }
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

/** Applies a change to the current project's tasks, then re-schedules the plan. */
function withTasks(state: AppState, fn: (tasks: Task[], week: WorkWeek) => Task[]): AppState {
  return withCurrent(state, (p) => {
    const tasks = fn(p.tasks, p.workWeek)
    return tasks === p.tasks ? p : { ...p, tasks: schedule(tasks, p.workWeek) }
  })
}

/** Rewrites which tasks wait on `id`. Each entry names a successor and how it is linked. */
function setSuccessors(tasks: Task[], id: string, successors: Dependency[]): Task[] {
  return tasks.map((t) => {
    if (t.id === id) return t
    const link = successors.find((s) => s.id === t.id)
    const deps = t.deps.filter((d) => d.id !== id)
    return link ? { ...t, deps: [...deps, { id, type: link.type, lag: link.lag }] } : deps.length === t.deps.length ? t : { ...t, deps }
  })
}

const isParent = (tasks: Task[], id: string) => tasks.some((t) => t.parentId === id)

/** Swaps two tasks' places in the array, which is what orders siblings in the outline. */
function swap(tasks: Task[], a: Task, b: Task): Task[] {
  return tasks.map((t) => (t === a ? b : t === b ? a : t))
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
        projects: [...state.projects, { workWeek: 'weekdays', ...action.project, tasks: [], tickets: [], seq: 0, view: 'gantt', zoom: 'day' }],
      }

    case 'updateProject':
      return withCurrent(state, (p) => ({ ...p, ...action.patch }))

    case 'deleteProject': {
      const project = currentProject(state)
      const projects = state.projects.filter((p) => p !== project)
      return { ...state, projects, current: projects[0]?.id }
    }

    case 'saveTask':
      return withTasks(state, (tasks, week) => {
        const task: Task = { ...action.task, end: action.task.milestone ? action.task.start : action.task.end }
        const old = tasks.find((t) => t.id === task.id)
        if (action.successors) tasks = setSuccessors(tasks, task.id, action.successors)
        // A new subtask opens its parent so you can see it.
        if (!old) return [...tasks.map((t) => (t.id === task.parentId && t.collapsed ? { ...t, collapsed: false } : t)), task]
        // A parent's dates come from its subtasks: moving its start moves the whole group.
        if (isParent(tasks, task.id)) {
          const moved = shiftTree(tasks, task.id, toDay(task.start) - toDay(old.start), week)
          return moved.map((t) => (t.id === task.id ? { ...task, start: t.start, end: t.end, progress: t.progress } : t))
        }
        return tasks.map((t) => (t.id === task.id ? task : t))
      })

    case 'updateTask':
      return withTasks(state, (tasks, week) => {
        const old = tasks.find((t) => t.id === action.id)
        if (!old) return tasks
        const { start, end, days, ...rest } = action.patch
        if (isParent(tasks, old.id)) {
          const moved = start ? shiftTree(tasks, old.id, toDay(start) - toDay(old.start), week) : tasks
          return moved.map((t) => (t.id === old.id ? { ...t, ...rest } : t))
        }
        let next: Task = { ...old, ...rest }
        // A new start keeps the length, as in Microsoft Project.
        if (start) next = placeAt(next, toDay(start), week)
        if (end) next = { ...next, end: fromDay(Math.max(toDay(next.start), snapWorkday(toDay(end), -1, week))) }
        if (days) next = { ...next, end: fromDay(addWorkdays(toDay(next.start), Math.max(1, days) - 1, week)) }
        if (next.milestone) next = { ...next, end: next.start }
        return tasks.map((t) => (t.id === old.id ? next : t))
      })

    case 'setWorkWeek':
      return withCurrent(state, (p) =>
        p.workWeek === action.workWeek ? p : { ...p, workWeek: action.workWeek, tasks: schedule(p.tasks, action.workWeek) })

    case 'moveTask':
      return withTasks(state, (tasks) => {
        const task = tasks.find((t) => t.id === action.id)
        if (!task) return tasks
        const siblings = tasks.filter((t) => t.parentId === task.parentId)
        const other = siblings[siblings.indexOf(task) + action.by]
        return other ? swap(tasks, task, other) : tasks
      })

    case 'indentTask':
      return withTasks(state, (tasks) => {
        const task = tasks.find((t) => t.id === action.id)
        if (!task || task.parentId || isParent(tasks, task.id)) return tasks
        const tops = tasks.filter((t) => !t.parentId)
        const parent = tops[tops.indexOf(task) - 1]
        if (!parent) return tasks
        // Becomes the parent's last subtask, which keeps it in the same place on screen.
        const kids = childrenOf(tasks, parent.id)
        const firstSubtask = !kids.length
        const moved: Task = { ...task, parentId: parent.id }
        const rest = tasks.filter((t) => t !== task).map((t) =>
          t === parent && firstSubtask ? { ...t, milestone: false, collapsed: false } : t)
        return [...rest, moved]
      })

    case 'outdentTask':
      return withTasks(state, (tasks) => {
        const task = tasks.find((t) => t.id === action.id)
        if (!task?.parentId) return tasks
        // Lands right after its old parent's group.
        const rest = tasks.filter((t) => t !== task)
        const at = rest.findIndex((t) => t.id === task.parentId) + 1
        return [...rest.slice(0, at), { ...task, parentId: '' }, ...rest.slice(at)]
      })

    case 'toggleCollapse':
      return withCurrent(state, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.id ? { ...t, collapsed: !t.collapsed } : t)),
      }))

    case 'addLink':
      return withTasks(state, (tasks) => tasks.map((t) =>
        t.id === action.to && action.from !== action.to && !t.deps.some((d) => d.id === action.from)
          ? { ...t, deps: [...t.deps, { id: action.from, ...(action.link ?? { type: 'FS', lag: 0 }) }] }
          : t))

    case 'shiftTask':
      return withTasks(state, (tasks, week) => {
        const task = tasks.find((t) => t.id === action.id)
        if (!task) return tasks
        if (isParent(tasks, task.id) || action.start === action.end) return shiftTree(tasks, task.id, action.start, week)
        // Resizing one end: snap it onto a working day in the direction it was dragged.
        return tasks.map((t) => {
          if (t.id !== action.id) return t
          const start = action.start ? snapWorkday(toDay(t.start) + action.start, action.start, week) : toDay(t.start)
          const end = action.end ? snapWorkday(toDay(t.end) + action.end, action.end, week) : toDay(t.end)
          // Never let a resize make the task end before it starts.
          return action.start
            ? { ...t, start: fromDay(Math.min(start, end)) }
            : { ...t, end: fromDay(Math.max(start, end)) }
        })
      })

    case 'deleteTask':
      return withCurrent(state, (p) => {
        const gone = new Set([action.id, ...childrenOf(p.tasks, action.id).map((t) => t.id)])
        return {
          ...p,
          tasks: schedule(p.tasks.filter((t) => !gone.has(t.id)).map((t) => ({ ...t, deps: t.deps.filter((d) => !gone.has(d.id)) })), p.workWeek),
          tickets: p.tickets.map((t) => (gone.has(t.taskId) ? { ...t, taskId: '' } : t)),
        }
      })

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
