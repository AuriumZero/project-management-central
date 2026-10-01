import { describe, expect, it } from 'vitest'
import {
  dropsLinks, formatPredecessors, outline, parsePredecessors, projectSummary, requiredDelay, rollup, sanitize, schedule,
} from './plan'
import { toDay } from './dates'
import type { Dependency, LinkType, Task } from './types'

const task = (id: string, start: string, end: string, extra: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, progress: 0, deps: [], parentId: '', assignee: '', ...extra })
const link = (id: string, type: LinkType = 'FS', lag = 0): Dependency => ({ id, type, lag })
const get = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)!

describe('outline', () => {
  const tasks = [
    task('p1', '2026-10-01', '2026-10-05'),
    task('p2', '2026-10-06', '2026-10-08', { collapsed: true }),
    task('c1', '2026-10-01', '2026-10-02', { parentId: 'p1' }),
    task('c2', '2026-10-06', '2026-10-06', { parentId: 'p2' }),
    task('c3', '2026-10-03', '2026-10-05', { parentId: 'p1' }),
  ]

  it('lists each parent followed by its subtasks, numbered in that order', () => {
    expect(outline(tasks).map((r) => `${r.num}:${r.task.id}:${r.depth}`)).toEqual(['1:p1:0', '2:c1:1', '3:c3:1', '4:p2:0', '5:c2:1'])
  })

  it('hides subtasks of a collapsed parent but keeps their numbers', () => {
    const rows = outline(tasks)
    expect(rows.filter((r) => r.hidden).map((r) => r.task.id)).toEqual(['c2'])
    expect(rows.find((r) => r.task.id === 'p1')?.hasChildren).toBe(true)
  })
})

describe('rollup', () => {
  it('gives a parent the span of its subtasks and their weighted progress', () => {
    const tasks = rollup([
      task('p', '2026-01-01', '2026-01-01', { milestone: true }),
      task('a', '2026-10-01', '2026-10-03', { parentId: 'p', progress: 100 }),
      task('b', '2026-10-10', '2026-10-10', { parentId: 'p', progress: 0 }),
    ])
    expect(get(tasks, 'p')).toMatchObject({ start: '2026-10-01', end: '2026-10-10', progress: 75, milestone: false })
  })

  it('leaves a parent without subtasks alone', () => {
    const p = task('p', '2026-10-01', '2026-10-02')
    expect(rollup([p])[0]).toBe(p)
  })
})

describe('projectSummary', () => {
  it('spans every task in the project', () => {
    expect(projectSummary([
      task('p', '2026-10-01', '2026-10-09'),
      task('a', '2026-10-02', '2026-10-09', { parentId: 'p' }),
      task('x', '2026-10-20', '2026-10-21'),
    ])).toEqual({ start: toDay('2026-10-02'), end: toDay('2026-10-21'), progress: 0 })
  })
  it('is empty with no tasks', () => expect(projectSummary([])).toBeNull())
})

describe('requiredDelay', () => {
  const pred = task('p', '2026-10-01', '2026-10-05')
  const succ = task('s', '2026-10-03', '2026-10-04')
  it.each([
    ['FS', 0, 3], // must start Oct 6
    ['SS', 0, 0], // already starts after Oct 1
    ['SS', 4, 2], // must start Oct 5
    ['FF', 0, 1], // must finish Oct 5
    ['SF', 0, 0], // must finish by the day before Oct 1 at the latest: already fine
    ['FS', -3, 0], // lead time: may start Oct 3
  ] as const)('%s with %i days lag needs %i days', (type, lag, days) => {
    expect(requiredDelay(pred, succ, { type, lag })).toBe(days)
  })
})

describe('schedule', () => {
  it('pushes a chain of successors later', () => {
    const tasks = schedule([
      task('a', '2026-10-01', '2026-10-05'),
      task('b', '2026-10-01', '2026-10-02', { deps: [link('a')] }),
      task('c', '2026-10-01', '2026-10-01', { deps: [link('b', 'FS', 2)] }),
    ])
    expect(get(tasks, 'b')).toMatchObject({ start: '2026-10-06', end: '2026-10-07' })
    expect(get(tasks, 'c')).toMatchObject({ start: '2026-10-10', end: '2026-10-10' })
  })

  it('never pulls a task earlier than where you put it', () => {
    const tasks = schedule([
      task('a', '2026-10-01', '2026-10-02'),
      task('b', '2026-10-20', '2026-10-21', { deps: [link('a')] }),
    ])
    expect(get(tasks, 'b').start).toBe('2026-10-20')
  })

  it('moves all of a parent’s subtasks when the parent has to wait', () => {
    const tasks = schedule([
      task('design', '2026-10-01', '2026-10-10'),
      task('build', '2026-10-05', '2026-10-09', { deps: [link('design')] }),
      task('fe', '2026-10-05', '2026-10-07', { parentId: 'build' }),
      task('be', '2026-10-06', '2026-10-09', { parentId: 'build' }),
    ])
    expect(get(tasks, 'fe')).toMatchObject({ start: '2026-10-11', end: '2026-10-13' })
    expect(get(tasks, 'be')).toMatchObject({ start: '2026-10-12', end: '2026-10-15' })
    expect(get(tasks, 'build')).toMatchObject({ start: '2026-10-11', end: '2026-10-15' })
  })

  it('uses a parent’s rolled-up finish when it is the predecessor', () => {
    const tasks = schedule([
      task('p', '2026-10-01', '2026-10-01'),
      task('a', '2026-10-01', '2026-10-08', { parentId: 'p' }),
      task('launch', '2026-10-02', '2026-10-02', { milestone: true, deps: [link('p')] }),
    ])
    expect(get(tasks, 'launch').start).toBe('2026-10-09')
  })
})

describe('sanitize', () => {
  it('drops links that would make a loop', () => {
    const tasks = sanitize([
      task('a', '2026-10-01', '2026-10-02', { deps: [link('b')] }),
      task('b', '2026-10-03', '2026-10-04', { deps: [link('a')] }),
    ])
    expect(get(tasks, 'a').deps).toHaveLength(1)
    expect(get(tasks, 'b').deps).toEqual([])
  })

  it('drops links between a parent and its own subtasks, and loops through a parent', () => {
    const tasks = sanitize([
      task('p', '2026-10-01', '2026-10-05', { deps: [link('c')] }),
      task('c', '2026-10-01', '2026-10-05', { parentId: 'p' }),
      task('x', '2026-10-01', '2026-10-05', { deps: [link('c')] }),
      task('y', '2026-10-01', '2026-10-05', { deps: [link('x')] }),
    ])
    expect(get(tasks, 'p').deps).toEqual([])
    expect(dropsLinks([...tasks.filter((t) => t.id !== 'p'), { ...get(tasks, 'p'), deps: [link('y')] }])).toBe(true)
  })

  it('drops links to missing tasks and flattens a third level', () => {
    const tasks = sanitize([
      task('p', '2026-10-01', '2026-10-05'),
      task('c', '2026-10-01', '2026-10-05', { parentId: 'p', deps: [link('ghost')] }),
      task('g', '2026-10-01', '2026-10-05', { parentId: 'c' }),
    ])
    expect(get(tasks, 'c').deps).toEqual([])
    expect(get(tasks, 'g').parentId).toBe('')
  })
})

describe('predecessor text', () => {
  const idByNum = new Map([[1, 'a'], [2, 'b'], [3, 'c']])
  const numById = new Map([['a', 1], ['b', 2], ['c', 3]])

  it('reads Microsoft Project style links', () => {
    expect(parsePredecessors('1, 2SS+2d; 3ff-1', idByNum, 'x')).toEqual([link('a'), link('b', 'SS', 2), link('c', 'FF', -1)])
    expect(parsePredecessors('  ', idByNum, 'x')).toEqual([])
  })

  it('explains what it cannot read', () => {
    expect(parsePredecessors('1XX', idByNum, 'x')).toMatch(/Couldn't read "1XX"/)
    expect(parsePredecessors('9', idByNum, 'x')).toBe("There's no row 9.")
    expect(parsePredecessors('1', idByNum, 'a')).toBe("A task can't depend on itself.")
  })

  it('writes links back the same way', () => {
    const t = task('x', '2026-10-01', '2026-10-01', { deps: [link('a'), link('b', 'SS', 2), link('c', 'FS', -1)] })
    expect(formatPredecessors(t, numById)).toBe('1, 2SS+2d, 3FS-1d')
  })
})
