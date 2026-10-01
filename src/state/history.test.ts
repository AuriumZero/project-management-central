import { describe, expect, it } from 'vitest'
import { seedState } from '../lib/storage'
import { historyReducer, initHistory } from './history'

describe('historyReducer', () => {
  it('undoes and redoes changes', () => {
    const start = initHistory(seedState())
    const renamed = historyReducer(start, { type: 'updateProject', patch: { name: 'Renamed', key: 'WEB', description: '' } })
    const undone = historyReducer(renamed, { type: 'undo' })
    expect(undone.present).toBe(start.present)
    expect(historyReducer(undone, { type: 'redo' }).present).toBe(renamed.present)
  })

  it('does not record view changes as undo steps', () => {
    const h = historyReducer(initHistory(seedState()), { type: 'setView', view: 'board' })
    expect(h.past).toEqual([])
  })

  it('ignores undo with nothing to undo', () => {
    const h = initHistory(seedState())
    expect(historyReducer(h, { type: 'undo' })).toBe(h)
  })
})
