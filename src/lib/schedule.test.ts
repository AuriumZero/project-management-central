import { describe, expect, it } from 'vitest'
import { toDay } from './dates'
import { DAY_WIDTH, dragOffsets, ganttLayout, linkPath, projectKey, projectStats, ROW_HEIGHT } from './schedule'
import type { ChartRow } from './schedule'
import type { Dependency, Project, Task } from './types'

const task = (id: string, start: string, end: string, extra: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, progress: 0, deps: [], parentId: '', assignee: '', ...extra })

const row = (id: string, start: string, end: string, extra: Partial<ChartRow> = {}): ChartRow =>
  ({ id, start, end, milestone: false, summary: false, deps: [], ...extra })

const fs = (id: string): Dependency => ({ id, type: 'FS', lag: 0 })

const project = (tasks: Task[]): Project =>
  ({ id: 'p', name: 'P', key: 'P', description: '', tasks, tickets: [], risks: [], seq: 0, view: 'gantt', zoom: 'day', workWeek: 'all' })

describe('projectStats', () => {
  it('weights completion by task length', () => {
    const p = project([
      task('a', '2026-10-01', '2026-10-03', { progress: 100 }), // 3 days, done
      task('b', '2026-10-04', '2026-10-04', { progress: 0 }), // 1 day
    ])
    expect(projectStats(p).percent).toBe(75)
    expect(projectStats(p).span).toEqual([toDay('2026-10-01'), toDay('2026-10-04')])
  })

  it('counts subtasks, not the parents that summarise them', () => {
    const p = project([
      task('parent', '2026-10-01', '2026-10-04', { progress: 50 }),
      task('a', '2026-10-01', '2026-10-02', { parentId: 'parent', progress: 100 }),
      task('b', '2026-10-03', '2026-10-04', { parentId: 'parent', progress: 0 }),
    ])
    expect(projectStats(p).percent).toBe(50)
  })

  it('handles an empty plan', () => {
    expect(projectStats(project([]))).toEqual({ percent: 0, openTickets: 0, span: null })
  })
})

describe('projectKey', () => {
  it('uses the given prefix, cleaned up', () => expect(projectKey('Anything', ' web-2 ')).toBe('WEB2'))
  it('falls back to initials', () => expect(projectKey('Website relaunch')).toBe('WR'))
  it('never returns an empty prefix', () => expect(projectKey('  ', '!!')).toBe('PRJ'))
})

describe('ganttLayout', () => {
  const today = toDay('2026-10-01')
  const rows = [
    row('a', '2026-10-01', '2026-10-05'),
    row('b', '2026-10-06', '2026-10-08', { deps: [fs('a')] }),
    row('m', '2026-10-09', '2026-10-09', { deps: [fs('b')], milestone: true }),
    row('s', '2026-10-01', '2026-10-09', { summary: true }),
  ]

  it('pads the range around the tasks and today', () => {
    const l = ganttLayout(rows, 'day', today)
    expect(l.min).toBe(today - 3)
    expect(l.width).toBe((l.max - l.min + 1) * DAY_WIDTH.day)
    expect(l.width).toBeGreaterThanOrEqual(1100)
    expect(l.height).toBe(5 * ROW_HEIGHT)
  })

  it('places bars by date and length, and marks milestones and summaries', () => {
    const l = ganttLayout(rows, 'day', today)
    expect(l.bars[0]).toMatchObject({ x: 3 * 34, width: 5 * 34, kind: 'task' })
    expect(l.bars[1].x).toBe(8 * 34)
    expect(l.bars[2].kind).toBe('milestone')
    expect(l.bars[3]).toMatchObject({ x: 3 * 34, width: 9 * 34, kind: 'summary' })
  })

  it('draws one arrow per dependency', () => {
    const l = ganttLayout(rows, 'day', today)
    expect(l.arrows.map((a) => [a.from, a.to])).toEqual([['a', 'b'], ['b', 'm']])
    // b starts the day after a ends, so the arrow drops between rows and comes back in.
    expect(l.arrows[0].path).toBe('M272 20 H280 V40 H264 V60 H271')
  })

  it('draws a straight elbow when there is a gap before the successor', () => {
    const gap = [row('a', '2026-10-01', '2026-10-02'), row('b', '2026-10-06', '2026-10-07', { deps: [fs('a')] })]
    // a ends at the right edge of Oct 2 (x=170); b starts at Oct 6 (x=272).
    expect(ganttLayout(gap, 'day', today).arrows[0].path).toBe('M170 20 H178 V60 H271')
  })

  it('connects the right edges for each link type', () => {
    const pair = (type: Dependency['type']) => ganttLayout([
      row('a', '2026-10-01', '2026-10-02'),
      row('b', '2026-10-04', '2026-10-05', { deps: [{ id: 'a', type, lag: 0 }] }),
    ], 'day', today).arrows[0].path
    // a spans x 102–170, b spans x 204–272.
    expect(pair('SS')).toBe('M102 20 H94 V60 H203')
    expect(pair('FF')).toBe('M170 20 H280 V60 H273')
    expect(pair('SF').startsWith('M102 20')).toBe(true)
    expect(pair('SF').endsWith('H273')).toBe(true)
  })

  it('ignores dependencies on rows that are not shown', () => {
    expect(ganttLayout([row('a', '2026-10-01', '2026-10-02', { deps: [fs('gone')] })], 'day', today).arrows).toEqual([])
  })

  it('labels every day when zoomed to days and only Mondays when zoomed to weeks', () => {
    const day = ganttLayout(rows, 'day', today)
    expect(day.days).toHaveLength(day.max - day.min + 1)
    expect(day.days.filter((d) => d.isToday)).toHaveLength(1)
    const week = ganttLayout(rows, 'week', today)
    expect(week.days.every((d) => d.weekStart)).toBe(true)
    expect(ganttLayout(rows, 'month', today).days).toEqual([])
  })
})

describe('linkPath', () => {
  it('turns on the outside for start-to-start links', () => {
    expect(linkPath(100, 20, -1, 300, 60, 1)).toBe('M100 20 H92 V60 H299')
  })
})

describe('dragOffsets', () => {
  it('moves both ends together', () => expect(dragOffsets('move', -3, 5)).toEqual({ start: -3, end: -3 }))
  it('resizes the end but keeps at least one day', () => {
    expect(dragOffsets('end', 2, 5)).toEqual({ start: 0, end: 2 })
    expect(dragOffsets('end', -10, 5)).toEqual({ start: 0, end: -4 })
  })
  it('resizes the start but keeps at least one day', () => {
    expect(dragOffsets('start', -2, 5)).toEqual({ start: -2, end: 0 })
    expect(dragOffsets('start', 10, 5)).toEqual({ start: 4, end: 0 })
  })
})
