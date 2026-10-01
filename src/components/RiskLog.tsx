import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent, Ref } from 'react'
import { makeId } from '../lib/storage'
import { IMPACTS } from '../lib/types'
import type { Impact, Project, Risk } from '../lib/types'
import type { Action } from '../state/reducer'

export interface RiskLogHandle {
  /** Adds a row and puts the cursor in its name. */
  addRisk: () => void
}

interface RiskLogProps {
  project: Project
  dispatch: Dispatch<Action>
  toast: (message: string) => void
  ref?: Ref<RiskLogHandle>
}

export function RiskLog({ project, dispatch, toast, ref }: RiskLogProps) {
  const { risks } = project
  const table = useRef<HTMLTableElement>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  const addRisk = () => {
    const risk: Risk = { id: makeId(), name: 'New risk', impact: 'medium', likelihood: 50, notes: '' }
    dispatch({ type: 'addRisk', risk })
    setFocusId(risk.id)
  }
  useImperativeHandle(ref, () => ({ addRisk }))

  useEffect(() => {
    if (!focusId) return
    const input = table.current?.querySelector<HTMLInputElement>(`[data-id="${focusId}"] .r-name input`)
    if (!input) return
    input.focus()
    input.select()
    setFocusId(null)
  }, [focusId, risks])

  // Same keys as the task grid: Enter moves down a column (Shift+Enter up), and
  // Enter on the last row adds a new one. In Notes, Shift+Enter starts a new line.
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const field = e.target as HTMLElement
    if (e.key !== 'Enter' || !field.matches('input, select, textarea')) return
    const notes = field.tagName === 'TEXTAREA'
    if (notes && e.shiftKey) return
    e.preventDefault()
    const up = e.shiftKey
    const column = field.closest('td')?.className.split(' ')[0]
    const row = field.closest<HTMLElement>('tr')
    if (!column || !row) return
    field.blur()
    for (let next = up ? row.previousElementSibling : row.nextElementSibling; next; next = up ? next.previousElementSibling : next.nextElementSibling) {
      const target = next.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`.${column} input, .${column} select, .${column} textarea`)
      if (target) {
        target.focus()
        if (!(target instanceof HTMLSelectElement)) target.select()
        return
      }
    }
    if (!up) addRisk()
  }

  if (!risks.length) {
    return (
      <div className="blank">
        <h2>No risks or issues logged</h2>
        <p>Log anything that could hurt the plan, how bad it would be, and how likely it is. Something that has already happened is an issue: give it a likelihood of 100%.</p>
        <button className="btn primary" onClick={addRisk}>Add the first risk</button>
      </div>
    )
  }

  return (
    <div className="risks">
      <table className="risk-table" ref={table} onKeyDown={onKeyDown} aria-label="Risks and issues">
        <thead>
          <tr>
            <th className="r-id">ID</th>
            <th className="r-name">Risk or issue</th>
            <th className="r-impact">Impact</th>
            <th className="r-likely" title="How likely it is to happen. 100% means it already has, so it's an issue.">Likelihood</th>
            <th className="r-notes">Notes</th>
            <th className="r-actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {risks.map((risk, i) => <RiskRow key={risk.id} risk={risk} num={i + 1} dispatch={dispatch} toast={toast} />)}
        </tbody>
      </table>
      <div className="g-add">
        <button className="btn ghost small" onClick={addRisk}>+ Add risk</button>
      </div>
    </div>
  )
}

function RiskRow({ risk, num, dispatch, toast }: { risk: Risk; num: number; dispatch: Dispatch<Action>; toast: (message: string) => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  const update = (patch: Partial<Omit<Risk, 'id'>>) => dispatch({ type: 'updateRisk', id: risk.id, patch })
  const name = risk.name || 'Untitled'

  const commitLikelihood = (v: string) => {
    const n = Math.round(Number(v.replace('%', '')))
    if (!v.trim() || !Number.isFinite(n) || n < 0 || n > 100) return toast('Likelihood is a percentage from 0 to 100.')
    update({ likelihood: n })
  }

  return (
    <tr data-id={risk.id}>
      <td className="r-id mono">R{num}</td>
      <td className="r-name">
        <TextCell value={risk.name} label={`Risk ${num}`} onCommit={(v) => v.trim() ? update({ name: v.trim() }) : toast('A risk needs a name.')} />
      </td>
      <td className="r-impact">
        <select
          className="cell impact"
          data-impact={risk.impact}
          value={risk.impact}
          aria-label={`Impact of ${name}`}
          onChange={(e) => update({ impact: e.target.value as Impact })}
        >
          {IMPACTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </td>
      <td className="r-likely">
        <span className="pct">
          <TextCell value={String(risk.likelihood)} label={`Likelihood of ${name}, in percent`} inputMode="numeric" className="mono" onCommit={commitLikelihood} />
          <span aria-hidden="true">%</span>
        </span>
      </td>
      <td className="r-notes">
        <NotesCell value={risk.notes} label={`Notes for ${name}`} onCommit={(v) => update({ notes: v })} />
      </td>
      <td className="r-actions">
        {armed
          ? <button className="row-btn confirm" onClick={() => dispatch({ type: 'deleteRisk', id: risk.id })} aria-label={`Confirm delete ${name}`}>Delete?</button>
          : <button className="row-btn danger" onClick={() => setArmed(true)} aria-label={`Delete ${name}`} title="Delete">🗑</button>}
      </td>
    </tr>
  )
}

/** A text field that saves when you leave it, and reverts on Escape. */
function TextCell({ value, label, onCommit, className = '', inputMode }: {
  value: string
  label: string
  onCommit: (value: string) => void
  className?: string
  inputMode?: 'numeric'
}) {
  return (
    <input
      key={value}
      className={`cell ${className}`}
      defaultValue={value}
      aria-label={label}
      inputMode={inputMode}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur() } }}
      onBlur={(e) => { if (e.currentTarget.value !== value) onCommit(e.currentTarget.value) }}
    />
  )
}

/** A notes field that wraps and grows taller as you type. */
function NotesCell({ value, label, onCommit }: { value: string; label: string; onCommit: (value: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const fit = () => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }
  useLayoutEffect(fit, [value])
  return (
    <textarea
      key={value}
      ref={area}
      className="cell notes"
      rows={1}
      defaultValue={value}
      aria-label={label}
      placeholder="Add notes"
      onInput={fit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.value = value; fit(); e.currentTarget.blur() } }}
      onBlur={(e) => { if (e.currentTarget.value !== value) onCommit(e.currentTarget.value) }}
    />
  )
}
