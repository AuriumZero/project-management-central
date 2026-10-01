import { describe, expect, it } from 'vitest'
import { seedState } from '../lib/storage'
import type { AppState, Task, Ticket } from '../lib/types'
import { currentProject, reducer } from './reducer'

const empty = (): AppState => reducer({ v: 2, current: undefined, projects: [] },
  { type: 'createProject', project: { id: 'p', name: 'P', key: 'P', description: '' } })

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, name: id, start: '2026-10-01', end: '2026-10-05', progress: 0, deps: [], parentId: '', assignee: '', ...extra })

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
    s = reducer(s, { type: 'saveTask', task: task('b', { start: '2026-10-06', end: '2026-10-07', deps: [{ id: 'a', type: 'FS', lag: 0 }] }) })
    s = reducer(s, { type: 'saveTicket', ticket: ticket('k', { taskId: 'a' }) })
    s = reducer(s, { type: 'deleteTask', id: 'a' })
    const p = currentProject(s)!
    expect(p.tasks.map((t) => [t.id, t.deps])).toEqual([['b', []]])
    expect(p.tickets[0].taskId).toBe('')
  })

  it('deletes a parent together with its subtasks', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('p') })
    s = reducer(s, { type: 'saveTask', task: task('c', { parentId: 'p' }) })
    s = reducer(s, { type: 'saveTask', task: task('other', { deps: [{ id: 'c', type: 'SS', lag: 0 }] }) })
    s = reducer(s, { type: 'deleteTask', id: 'p' })
    expect(currentProject(s)!.tasks.map((t) => [t.id, t.deps])).toEqual([['other', []]])
  })

  it('indents a task under the one above and outdents it back', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('p') })
    s = reducer(s, { type: 'saveTask', task: task('x', { start: '2026-10-07', end: '2026-10-08' }) })
    s = reducer(s, { type: 'indentTask', id: 'x' })
    let p = currentProject(s)!
    expect(p.tasks.find((t) => t.id === 'x')?.parentId).toBe('p')
    // The parent now spans its only subtask.
    expect(p.tasks.find((t) => t.id === 'p')).toMatchObject({ start: '2026-10-07', end: '2026-10-08' })
    s = reducer(s, { type: 'outdentTask', id: 'x' })
    p = currentProject(s)!
    expect(p.tasks.map((t) => [t.id, t.parentId])).toEqual([['p', ''], ['x', '']])
  })

  it('will not indent the first task or a parent that has subtasks', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('p') })
    expect(reducer(s, { type: 'indentTask', id: 'p' })).toBe(s)
    s = reducer(s, { type: 'saveTask', task: task('c', { parentId: 'p' }) })
    s = reducer(s, { type: 'saveTask', task: task('q') })
    s = reducer(s, { type: 'saveTask', task: task('d', { parentId: 'q' }) })
    expect(reducer(s, { type: 'indentTask', id: 'q' })).toBe(s)
  })

  it('moves a whole group when a parent is dragged or its start changes', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('p') })
    s = reducer(s, { type: 'saveTask', task: task('c', { parentId: 'p', start: '2026-10-02', end: '2026-10-03' }) })
    s = reducer(s, { type: 'shiftTask', id: 'p', start: 3, end: 3 })
    expect(currentProject(s)!.tasks.find((t) => t.id === 'c')).toMatchObject({ start: '2026-10-05', end: '2026-10-06' })
    s = reducer(s, { type: 'updateTask', id: 'p', patch: { start: '2026-10-01' } })
    expect(currentProject(s)!.tasks.find((t) => t.id === 'c')).toMatchObject({ start: '2026-10-01', end: '2026-10-02' })
  })

  it('reschedules successors after an inline edit', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'saveTask', task: task('b', { start: '2026-10-06', end: '2026-10-06', deps: [{ id: 'a', type: 'FS', lag: 0 }] }) })
    s = reducer(s, { type: 'updateTask', id: 'a', patch: { end: '2026-10-09' } })
    expect(currentProject(s)!.tasks.find((t) => t.id === 'b')?.start).toBe('2026-10-10')
  })

  it('links two tasks dragged together and sets successors from the dialog', () => {
    let s = reducer(empty(), { type: 'saveTask', task: task('a') })
    s = reducer(s, { type: 'saveTask', task: task('b') })
    s = reducer(s, { type: 'addLink', from: 'a', to: 'b' })
    expect(currentProject(s)!.tasks.find((t) => t.id === 'b')).toMatchObject({ start: '2026-10-06', deps: [{ id: 'a', type: 'FS', lag: 0 }] })
    s = reducer(s, { type: 'saveTask', task: currentProject(s)!.tasks[0], successors: [] })
    expect(currentProject(s)!.tasks.find((t) => t.id === 'b')?.deps).toEqual([])
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
