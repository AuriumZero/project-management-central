import type { AppState } from '../lib/types'
import { reducer } from './reducer'
import type { Action } from './reducer'

export interface History {
  past: AppState[]
  present: AppState
  future: AppState[]
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' }

const LIMIT = 50
/** Switching projects, tabs or zoom, or folding the outline, isn't worth an undo step. */
const NOT_UNDOABLE = new Set<Action['type']>(['selectProject', 'setView', 'setZoom', 'toggleCollapse'])

export function initHistory(present: AppState): History {
  return { past: [], present, future: [] }
}

export function historyReducer(h: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    const prev = h.past[h.past.length - 1]
    return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h
  }
  if (action.type === 'redo') {
    const [next, ...future] = h.future
    return next ? { past: [...h.past, h.present], present: next, future } : h
  }
  const present = reducer(h.present, action)
  if (present === h.present) return h
  if (NOT_UNDOABLE.has(action.type)) return { ...h, present }
  return { past: [...h.past, h.present].slice(-LIMIT), present, future: [] }
}
