import { describe, expect, it } from 'vitest'
import { toDay } from './dates'
import { loadState, parseBackup, saveState, seedState, STORAGE_KEY } from './storage'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('seedState', () => {
  it('builds a sample project around today', () => {
    const s = seedState(toDay('2026-10-01'))
    const p = s.projects[0]
    expect(s.current).toBe(p.id)
    expect(p.tasks).toHaveLength(7)
    expect(p.tickets.map((t) => t.num)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.seq).toBe(7)
    expect(p.tasks[1].deps).toEqual([p.tasks[0].id])
  })
})

describe('saveState and loadState', () => {
  it('round-trips through storage', () => {
    const storage = memory()
    const s = seedState()
    expect(saveState(s, storage)).toBe(true)
    expect(loadState(storage)).toMatchObject(s)
  })

  it('reports a storage that refuses writes', () => {
    expect(saveState(seedState(), { setItem: () => { throw new Error('quota') } })).toBe(false)
  })

  it('ignores corrupt saved data', () => {
    const storage = memory()
    storage.setItem(STORAGE_KEY, '{not json')
    expect(loadState(storage)).toBeNull()
  })
})

describe('parseBackup', () => {
  it('explains files it cannot use', () => {
    expect(parseBackup('nope')).toBe('That file is not a valid backup.')
    expect(parseBackup('{"hello":1}')).toBe('That file is not a Project Management Central backup.')
  })

  it('reads data saved by the original single-file version', () => {
    const legacy = {
      v: 1,
      current: 'p1',
      projects: [{
        id: 'p1', name: 'Old', key: 'OLD', description: '', view: 'board', zoom: 'week', seq: 2, _scroll: 120,
        tasks: [{ id: 't1', name: 'Build', start: '2026-10-01', end: '2026-10-04', progress: 50, deps: [] }],
        tickets: [{ id: 'k1', num: 2, title: 'Fix', status: 'doing', priority: 'high', type: 'bug', taskId: 't1', due: '', description: '', created: '2026-09-30' }],
      }],
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.projects[0]).toMatchObject({ name: 'Old', view: 'board', zoom: 'week', seq: 2 })
    expect(parsed.projects[0]).not.toHaveProperty('_scroll')
    expect(parsed.projects[0].tickets[0]).toMatchObject({ status: 'doing', taskId: 't1' })
  })

  it('repairs bad values instead of failing', () => {
    const parsed = parseBackup(JSON.stringify({
      current: 'missing',
      projects: [{
        id: 'p', name: 'P',
        tasks: [
          { id: 'a', name: 'A', start: '2026-10-01', end: '2026-10-02', progress: 250, deps: ['a', 'ghost', 'b'] },
          { id: 'b', name: 'B', start: '2026-10-01', end: '2026-10-02', deps: [] },
          { id: 'bad', name: 'Bad dates', start: 'soon', end: 'later' },
        ],
        tickets: [{ id: 'k', title: 'T', status: 'weird', num: 9, taskId: 'bad' }],
      }],
    }))
    if (typeof parsed === 'string') throw new Error(parsed)
    const p = parsed.projects[0]
    expect(parsed.current).toBe('p')
    expect(p.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(p.tasks[0]).toMatchObject({ progress: 100, deps: ['b'] })
    expect(p.tickets[0]).toMatchObject({ status: 'todo', taskId: '', priority: 'medium' })
    expect(p.seq).toBe(9)
  })
})
