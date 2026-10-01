import type { WorkWeek } from './calendar'

/** A calendar date stored as `YYYY-MM-DD`. */
export type ISODate = string

export type View = 'gantt' | 'board' | 'risks'
export type Zoom = 'day' | 'week' | 'month'
export type Status = 'backlog' | 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketType = 'task' | 'feature' | 'bug' | 'chore'

/**
 * How a successor is tied to its predecessor, as in Microsoft Project:
 * FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish.
 */
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'

export interface Dependency {
  /** Id of the predecessor task. */
  id: string
  type: LinkType
  /** Days of lag (positive) or lead (negative). */
  lag: number
}

/**
 * Tasks form a two-level outline. A task with no `parentId` is a parent task
 * (a deliverable or milestone); a task with a `parentId` is a subtask. When a
 * parent has subtasks, its dates and progress are rolled up from them.
 */
export interface Task {
  id: string
  name: string
  start: ISODate
  end: ISODate
  /** 0 to 100. */
  progress: number
  /** Predecessors this task waits on. */
  deps: Dependency[]
  /** Id of the parent task, or `''` for a top-level task. */
  parentId: string
  /** Person responsible, mainly for subtasks. */
  assignee: string
  milestone?: boolean
  /** Subtasks hidden in the outline. */
  collapsed?: boolean
  notes?: string
  /**
   * A start set by hand on a task that has predecessors. It works like
   * Microsoft Project's "start no earlier than": links can push the task
   * later, but don't pull it earlier than this.
   */
  pin?: ISODate
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

export type Impact = 'low' | 'medium' | 'high'

/** An entry in the risk and issue log. */
export interface Risk {
  id: string
  name: string
  impact: Impact
  /** Chance it happens, 0 to 100. An issue that has already happened is 100. */
  likelihood: number
  notes: string
}

export interface Project {
  id: string
  name: string
  /** Ticket prefix, e.g. `WEB`. */
  key: string
  description: string
  tasks: Task[]
  tickets: Ticket[]
  risks: Risk[]
  /** Last ticket number handed out. */
  seq: number
  view: View
  zoom: Zoom
  /** Whether durations skip weekends (the default) or count every day. */
  workWeek: WorkWeek
}

export interface AppState {
  v: 3
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
export const LINK_TYPES: ReadonlyArray<readonly [LinkType, string]> = [
  ['FS', 'Finish to start'],
  ['SS', 'Start to start'],
  ['FF', 'Finish to finish'],
  ['SF', 'Start to finish'],
]
export const IMPACTS: ReadonlyArray<readonly [Impact, string]> = [
  ['low', 'Low'],
  ['medium', 'Med'],
  ['high', 'High'],
]
export const ZOOMS: readonly Zoom[] = ['day', 'week', 'month']
