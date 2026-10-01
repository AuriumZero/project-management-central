/** A calendar date stored as `YYYY-MM-DD`. */
export type ISODate = string

export type View = 'gantt' | 'board'
export type Zoom = 'day' | 'week' | 'month'
export type Status = 'backlog' | 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketType = 'task' | 'feature' | 'bug' | 'chore'

export interface Task {
  id: string
  name: string
  start: ISODate
  end: ISODate
  /** 0 to 100. */
  progress: number
  /** Ids of tasks that must finish before this one starts. */
  deps: string[]
  milestone?: boolean
  notes?: string
}

export interface Ticket {
  id: string
  /** Sequential number within the project, shown as `KEY-num`. */
  num: number
  title: string
  status: Status
  priority: Priority
  type: TicketType
  /** Id of the plan task this ticket belongs to, or `''`. */
  taskId: string
  /** Due date, or `''`. */
  due: ISODate
  description: string
  created: ISODate
}

export interface Project {
  id: string
  name: string
  /** Ticket prefix, e.g. `WEB`. */
  key: string
  description: string
  tasks: Task[]
  tickets: Ticket[]
  /** Last ticket number handed out. */
  seq: number
  view: View
  zoom: Zoom
}

export interface AppState {
  v: 1
  current: string | undefined
  projects: Project[]
}

export const STATUSES: ReadonlyArray<readonly [Status, string]> = [
  ['backlog', 'Backlog'],
  ['todo', 'To do'],
  ['doing', 'In progress'],
  ['done', 'Done'],
]
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']
export const TICKET_TYPES: readonly TicketType[] = ['task', 'feature', 'bug', 'chore']
export const ZOOMS: readonly Zoom[] = ['day', 'week', 'month']
