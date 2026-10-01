import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, Dispatch, KeyboardEvent, Ref } from 'react'
import { parseClipboard, parsePercent } from '../lib/paste'
import { makeId } from '../lib/storage'
import { IMPACTS, RISK_KINDS } from '../lib/types'
import type { Impact, Project, Risk, RiskKind } from '../lib/types'
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

type SortKey = 'num' | 'name' | 'kind' | 'impact' | 'likelihood' | 'notes'
interface Sort { key: SortKey; dir: 1 | -1 }

const COLUMNS: { key: SortKey; cls: string; label: string; title?: string }[] = [
  { key: 'num', cls: 'r-id', label: 'ID' },
  { key: 'name', cls: 'r-name', label: 'Risk or issue' },
  { key: 'kind', cls: 'r-kind', label: 'Type' },
  { key: 'impact', cls: 'r-impact', label: 'Impact' },
  { key: 'likelihood', cls: 'r-likely', label: 'Likelihood', title: "How likely it is to happen. An issue already has, so it's 100%." },
  { key: 'notes', cls: 'r-notes', label: 'Notes' },
]
/** Columns a paste fills, left to right. */
const PASTE_COLUMNS = ['r-name', 'r-kind', 'r-impact', 'r-likely', 'r-notes']

const newRisk = (): Risk => ({ id: makeId(), name: 'New risk', kind: 'risk', impact: 'medium', likelihood: 50, notes: '' })

/** Rows in the chosen order; ties keep the order they were logged in. */
export function sortRisks(risks: Risk[], sort: Sort | null): Risk[] {
  if (!sort) return risks
  const rank: Record<SortKey, (r: Risk) => number | string> = {
    num: (r) => risks.indexOf(r),
    name: (r) => r.name.toLowerCase(),
    kind: (r) => r.kind,
    impact: (r) => IMPACTS.findIndex(([i]) => i === r.impact),
    likelihood: (r) => r.likelihood,
    notes: (r) => r.notes.toLowerCase(),
  }
  const key = rank[sort.key]
  return [...risks].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || risks.indexOf(a) - risks.indexOf(b)
  })
}

/** Turns one pasted cell into a change, or null when it can't be read. */
function pastedValue(column: string, text: string): Partial<Omit<Risk, 'id'>> | null {
  const t = text.trim()
  const lower = t.toLowerCase()
  switch (column) {
    case 'r-name': return t ? { name: t } : null
    case 'r-kind': {
      const kind = RISK_KINDS.find(([k, label]) => lower === k || lower === label.toLowerCase())?.[0]
      return kind ? { kind } : null
    }
    case 'r-impact': {
      const impact = IMPACTS.find(([i, label]) => lower === i || lower === label.toLowerCase() || (lower.length >= 3 && i.startsWith(lower)))?.[0]
      return impact ? { impact } : null
    }
    case 'r-likely': {
      const n = parsePercent(t)
      return n === null ? null : { likelihood: n }
    }
    case 'r-notes': return { notes: text }
    default: return null
  }
}

export function RiskLog({ project, dispatch, toast, ref }: RiskLogProps) {
  const { risks } = project
  const table = useRef<HTMLTableElement>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort | null>(null)
  const rows = sortRisks(risks, sort)
  const numById = new Map(risks.map((r, i) => [r.id, i + 1]))

  const addRisk = () => {
    const risk = newRisk()
    dispatch({ type: 'addRisk', risk })
    setFocusId(risk.id)
  }

  const sortBy = (key: SortKey) =>
    setSort((s) => (key === 'num' && s?.key === 'num' && s.dir === -1 ? null : { key, dir: s?.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))

  // Pasting cells copied from Excel fills this row and the ones below, column by
  // column from where you pasted, and adds rows when it runs past the end.
  const onPaste = (e: ClipboardEvent<HTMLTableElement>) => {
    const field = e.target as HTMLElement
    const grid = parseClipboard(e.clipboardData.getData('text/plain'))
    const column = field.closest('td')?.className.split(' ')[0] ?? ''
    const id = field.closest<HTMLElement>('tr')?.dataset.id
    if (!grid || !id || !PASTE_COLUMNS.includes(column)) return
    e.preventDefault()
    const start = rows.findIndex((r) => r.id === id)
    const first = PASTE_COLUMNS.indexOf(column)
    const actions: Action[] = []
    let skipped = 0
    grid.forEach((cells, i) => {
      let target = rows[start + i]?.id
      if (!target) {
        const risk = newRisk()
        actions.push({ type: 'addRisk', risk })
        target = risk.id
      }
      const patch: Partial<Omit<Risk, 'id'>> = {}
      cells.slice(0, PASTE_COLUMNS.length - first).forEach((text, j) => {
        const value = pastedValue(PASTE_COLUMNS[first + j], text)
        if (value) Object.assign(patch, value)
        else if (text.trim()) skipped++
      })
      actions.push({ type: 'updateRisk', id: target, patch })
    })
    field.blur()
    dispatch({ type: 'batch', actions })
    toast(`Pasted ${grid.length} row${grid.length === 1 ? '' : 's'}.${skipped ? ` ${skipped} value${skipped === 1 ? " wasn't" : "s weren't"} understood and ${skipped === 1 ? 'was' : 'were'} left as they were.` : ''}`)
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
        <p>Log anything that could hurt the plan, how bad it would be, and how likely it is. Mark something that has already happened as an issue. You can also paste rows copied from Excel.</p>
        <button className="btn primary" onClick={addRisk}>Add the first risk</button>
      </div>
    )
  }

  return (
    <div className="risks">
      <table className="risk-table" ref={table} onKeyDown={onKeyDown} onPaste={onPaste} aria-label="Risks and issues">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.cls} title={c.title} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button className="sort" onClick={() => sortBy(c.key)}>
                  {c.label}
                  <span className="sort-mark" aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
            <th className="r-actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((risk) => <RiskRow key={risk.id} risk={risk} num={numById.get(risk.id)!} dispatch={dispatch} toast={toast} />)}
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
      <td className="r-kind">
        <select
          className="cell kind"
          data-kind={risk.kind}
          value={risk.kind}
          aria-label={`Type of ${name}`}
          onChange={(e) => update({ kind: e.target.value as RiskKind, ...(e.target.value === 'issue' ? { likelihood: 100 } : {}) })}
        >
          {RISK_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
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
