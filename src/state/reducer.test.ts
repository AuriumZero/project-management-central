import { describe, expect, it } from 'vitest'
import { seedState } from '../lib/storage'
import type { AppState, Task, Ticket } from '../lib/types'
import { currentProject, reducer } from './reducer'

const empty = (): AppState => reducer({ v: 1, current: undefined, projects: [] },
  { type: 'createProject', project: { id: 'p', name: 'P', key: 'P', description: '' } })

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, name: id, start: '2026-10-01', end: '2026-10-05', progress: 0, deps: [], ...extra })

const ticket = (id: string, extra: Partial<Ticket> = {}): Ticket => ({
  id, num: 0, title: id, status: 'todo', priority: 'medium', type: 'task', taskId: '', due: '', description: '', created: '2026-10-01', ...extra,
})

describe('reducer', () => {
  it('creates a project and selects it', () => {
    const s = empty()
    expect(s.current).toBe('p')
    expect(currentProject(s)).toMatchObject({ tasks: [], tickets: [], seq: 0, view: 'gantt', zoom: 'day' })
  })

  it('only changes the current project', () => {
    let s = seedState()
    const sample = s.projects[0]
    s = reducer(s, { type: 'createProject', project: { id: 'p2', name: 'Two', key: 'TWO', description: '' } })
    s = reducer(s, { type: 'setView', view: 'board' })
    expect(s.projects[0]).toBe(sample)
    expect(s.projects[1].view).toBe('board')
  })

  it('deletes the current project and selects the next one', () => {
    let s = seedState()
    s = reducer(s, { type: 'createProject', project: { id: 'p2', name: 'Two', key: 'TWO', description: '' } })
    s = reducer(s, { type: 'deleteProject' })
    expect(s.projects).toHaveLength(1)
    expect(s.current).toBe(s.projects[0].id)
  })

  it('adds and updates tasks, pinning milestones to one day', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'saveTask', task: task('a', { name: 'Renamed', milestone: true }) })
    expect(currentProject(s)!.tasks).toEqual([task('a', { name: 'Renamed', milestone: true, end: '2026-10-01' })])
  })

  it('reorders tasks and ignores moves past either end', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'saveTask', task: task('b') })
    s = reducer(s, { type: 'moveTask', id: 'b', by: -1 })
    expect(currentProject(s)!.tasks.map((t) => t.id)).toEqual(['b', 'a'])
    expect(reducer(s, { type: 'moveTask', id: 'b', by: -1 })).toBe(s)
  })

  it('reschedules a task from a drag', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'shiftTask', id: 'a', start: 2, end: 2 })
    expect(currentProject(s)!.tasks[0]).toMatchObject({ start: '2026-10-03', end: '2026-10-07' })
    s = reducer(s, { type: 'shiftTask', id: 'a', start: 0, end: -10 })
    expect(currentProject(s)!.tasks[0]).toMatchObject({ start: '2026-10-03', end: '2026-10-03' })
  })

  it('cleans up dependencies and ticket links when a task is deleted', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'saveTask', task: task('b', { deps: ['a'] }) })
    s = reducer(s, { type: 'saveTicket', ticket: ticket('k', { taskId: 'a' }) })
    s = reducer(s, { type: 'deleteTask', id: 'a' })
    const p = currentProject(s)!
    expect(p.tasks.map((t) => [t.id, t.deps])).toEqual([['b', []]])
    expect(p.tickets[0].taskId).toBe('')
  })

  it('numbers new tickets in sequence and never reuses a number', () => {
    let s = reducer(empty(), { type: 'saveTicket', ticket: ticket('k1') })
    s = reducer(s, { type: 'saveTicket', ticket: ticket('k2') })
    s = reducer(s, { type: 'deleteTicket', id: 'k2' })
    s = reducer(s, { type: 'saveTicket', ticket: ticket('k3') })
    expect(currentProject(s)!.tickets.map((t) => t.num)).toEqual([1, 3])
  })

  it('moves a ticket between columns', () => {
    let s = reducer(empty(), { type: 'saveTicket', ticket: ticket('k') })
    s = reducer(s, { type: 'setTicketStatus', id: 'k', status: 'done' })
    expect(currentProject(s)!.tickets[0].status).toBe('done')
  })
})
