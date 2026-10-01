import { describe, expect, it } from 'vitest'
import { toDay } from './dates'
import { DAY_WIDTH, dragOffsets, ganttLayout, projectKey, projectStats, ROW_HEIGHT } from './schedule'
import type { Project, Task } from './types'

const task = (id: string, start: string, end: string, extra: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, progress: 0, deps: [], ...extra })

const project = (tasks: Task[]): Project =>
  ({ id: 'p', name: 'P', key: 'P', description: '', tasks, tickets: [], seq: 0, view: 'gantt', zoom: 'day' })

describe('projectStats', () => {
  it('weights completion by task length', () => {
    const p = project([
      task('a', '2026-10-01', '2026-10-03', { progress: 100 }), // 3 days, done
      task('b', '2026-10-04', '2026-10-04', { progress: 0 }), // 1 day
    ])
    expect(projectStats(p).percent).toBe(75)
    expect(projectStats(p).span).toEqual([toDay('2026-10-01'), toDay('2026-10-04')])
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
  const tasks = [
    task('a', '2026-10-01', '2026-10-05'),
    task('b', '2026-10-06', '2026-10-08', { deps: ['a'] }),
    task('m', '2026-10-09', '2026-10-09', { deps: ['b'], milestone: true }),
  ]

  it('pads the range around the tasks and today', () => {
    const l = ganttLayout(tasks, 'day', today)
    expect(l.min).toBe(today - 3)
    expect(l.width).toBe((l.max - l.min + 1) * DAY_WIDTH.day)
    expect(l.width).toBeGreaterThanOrEqual(1100)
    expect(l.height).toBe(4 * ROW_HEIGHT)
  })

  it('places bars by date and length', () => {
    const l = ganttLayout(tasks, 'day', today)
    expect(l.bars[0]).toMatchObject({ x: 3 * 34, width: 5 * 34, milestone: false })
    expect(l.bars[1].x).toBe(8 * 34)
    expect(l.bars[2].milestone).toBe(true)
  })

  it('draws one arrow per dependency', () => {
    const l = ganttLayout(tasks, 'day', today)
    expect(l.arrows).toHaveLength(2)
    // b starts the day after a ends, so the arrow drops between rows and comes back in.
    expect(l.arrows[0]).toBe('M272 20 H278 V40 H264 V60 H271')
  })

  it('draws a straight elbow when there is a gap before the successor', () => {
    const gap = [task('a', '2026-10-01', '2026-10-02'), task('b', '2026-10-06', '2026-10-07', { deps: ['a'] })]
    // a ends at the right edge of Oct 2 (x=170); b starts at Oct 6 (x=272).
    expect(ganttLayout(gap, 'day', today).arrows[0]).toBe('M170 20 H176 V60 H271')
  })

  it('routes around when a successor starts before its predecessor ends', () => {
    const overlap = [task('a', '2026-10-01', '2026-10-10'), task('b', '2026-10-03', '2026-10-04', { deps: ['a'] })]
    expect(ganttLayout(overlap, 'day', today).arrows[0].match(/V/g)).toHaveLength(2)
  })

  it('ignores dependencies on missing tasks', () => {
    expect(ganttLayout([task('a', '2026-10-01', '2026-10-02', { deps: ['gone'] })], 'day', today).arrows).toEqual([])
  })

  it('labels every day when zoomed to days and only Mondays when zoomed to weeks', () => {
    const day = ganttLayout(tasks, 'day', today)
    expect(day.days).toHaveLength(day.max - day.min + 1)
    expect(day.days.filter((d) => d.isToday)).toHaveLength(1)
    const week = ganttLayout(tasks, 'week', today)
    expect(week.days.every((d) => d.weekStart)).toBe(true)
    expect(ganttLayout(tasks, 'month', today).days).toEqual([])
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
