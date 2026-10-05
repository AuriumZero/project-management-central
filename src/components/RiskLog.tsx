import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, Dispatch, KeyboardEvent, PointerEvent as ReactPointerEvent, Ref } from 'react'
import { parseClipboard, parsePercent } from '../lib/paste'
import { makeId } from '../lib/storage'
import { IMPACTS, RISK_KINDS } from '../lib/types'
import type { Impact, Project, Risk, RiskKind } from '../lib/types'
import type { Action } from '../state/reducer'
import { clampColumn, ColumnResizer, fitColumn, useColumnWidths } from './ColumnResizer'

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
/** Starting widths in pixels. Notes also takes up any spare room so the table fills its box. */
const DEFAULT_WIDTHS: Record<string, number> = { 'r-id': 52, 'r-name': 360, 'r-kind': 92, 'r-impact': 96, 'r-likely': 104, 'r-notes': 240, 'r-actions': 48 }
const RESIZABLE = ['r-name', 'r-kind', 'r-impact', 'r-likely', 'r-notes']
const COLUMNS_KEY = 'pmc.ui.riskColumns'

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

  // Each heading sorts ascending, then descending, then back to your own order.
  // ID ascending is your own order, so ID goes straight to descending.
  const sortBy = (key: SortKey) =>
    setSort((s) => {
      if (key === 'num') return s ? null : { key, dir: -1 }
      return s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null
    })

  // Drag a row by its ID to reorder the register. Rows can only be dragged in
  // your own order, not while sorted by a column.
  const box = useRef<HTMLDivElement>(null)
  const [sized, setSized] = useColumnWidths(COLUMNS_KEY)
  const [boxWidth, setBoxWidth] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setBoxWidth(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [risks.length > 0])
  const widths = { ...DEFAULT_WIDTHS, ...sized }
  const others = Object.entries(widths).reduce((sum, [k, w]) => k === 'r-notes' ? sum : sum + w, 0)
  widths['r-notes'] = Math.max(widths['r-notes'], boxWidth - others)
  const tableWidth = others + widths['r-notes']
  const colStart = useRef(0)
  const resizer = (cls: string, label: string) => RESIZABLE.includes(cls) && (
    <ColumnResizer
      label={label}
      width={widths[cls]}
      onStart={() => { colStart.current = widths[cls] }}
      onResize={(dx) => setSized(cls, clampColumn(colStart.current + dx, 48))}
      onFit={() => {
        const w = fitColumn(table.current?.tBodies[0] ?? null, cls, 48)
        if (w) setSized(cls, w)
      }}
    />
  )
  const [drag, setDrag] = useState<{ id: string; before: string | null; y: number } | null>(null)
  const [focusGrip, setFocusGrip] = useState<string | null>(null)

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, risk: Risk) => {
    if (e.button !== 0 || sort) return
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    let target: { before: string | null; y: number } | null = null
    const place = (clientY: number) => {
      const base = box.current!.getBoundingClientRect().top
      const rowsEl = [...box.current!.querySelectorAll<HTMLElement>('tbody tr')]
      const slots = [
        ...rowsEl.map((tr) => ({ before: tr.dataset.id!, y: tr.getBoundingClientRect().top - base })),
        { before: null, y: (rowsEl.at(-1)?.getBoundingClientRect().bottom ?? base) - base },
      ]
      const at = clientY - base
      target = slots.reduce((best, s) => (Math.abs(s.y - at) < Math.abs(best.y - at) ? s : best))
      setDrag({ id: risk.id, ...target })
    }
    const onMove = (ev: PointerEvent) => place(ev.clientY)
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', onUp)
      grip.removeEventListener('pointercancel', onCancel)
      setDrag(null)
      if (target) dispatch({ type: 'reorderRisk', id: risk.id, before: target.before })
    }
    const onCancel = () => { target = null; onUp() }
    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', onUp)
    grip.addEventListener('pointercancel', onCancel)
    place(e.clientY)
  }

  // Arrow keys on a row's ID move it up or down one place.
  const moveByKey = (e: KeyboardEvent<HTMLButtonElement>, risk: Risk) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || sort) return
    e.preventDefault()
    const i = risks.indexOf(risk)
    if (e.key === 'ArrowUp' && i > 0) dispatch({ type: 'reorderRisk', id: risk.id, before: risks[i - 1].id })
    if (e.key === 'ArrowDown' && i < risks.length - 1) dispatch({ type: 'reorderRisk', id: risk.id, before: risks[i + 2]?.id ?? null })
    setFocusGrip(risk.id)
  }
  useEffect(() => {
    if (!focusGrip) return
    table.current?.querySelector<HTMLButtonElement>(`[data-id="${focusGrip}"] .grip`)?.focus()
    setFocusGrip(null)
  }, [focusGrip, risks])

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
    <div className="risks" ref={box}>
      {drag && <div className="drop-line" style={{ top: drag.y - 1, left: 0 }} aria-hidden="true" />}
      <table className="risk-table" ref={table} style={{ width: tableWidth }} onKeyDown={onKeyDown} onPaste={onPaste} aria-label="Risks and issues">
        <colgroup>
          {Object.keys(DEFAULT_WIDTHS).map((cls) => <col key={cls} className={cls} style={{ width: widths[cls] }} />)}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.cls} title={c.title} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button className="sort" onClick={() => sortBy(c.key)}>
                  {c.label}
                  <span className="sort-mark" aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                </button>
                {resizer(c.cls, c.label)}
              </th>
            ))}
            <th className="r-actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((risk) => (
            <RiskRow
              key={risk.id}
              risk={risk}
              num={numById.get(risk.id)!}
              dispatch={dispatch}
              toast={toast}
              sorted={Boolean(sort)}
              dragging={drag?.id === risk.id}
              onGrab={(e) => startDrag(e, risk)}
              onGripKey={(e) => moveByKey(e, risk)}
            />
          ))}
        </tbody>
      </table>
      <div className="g-add">
        <button className="btn ghost small" onClick={addRisk}>+ Add risk</button>
      </div>
    </div>
  )
}

interface RiskRowProps {
  risk: Risk
  num: number
  dispatch: Dispatch<Action>
  toast: (message: string) => void
  sorted: boolean
  dragging: boolean
  onGrab: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onGripKey: (e: KeyboardEvent<HTMLButtonElement>) => void
}

function RiskRow({ risk, num, dispatch, toast, sorted, dragging, onGrab, onGripKey }: RiskRowProps) {
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
    <tr data-id={risk.id} className={dragging ? 'row-dragging' : undefined}>
      <td className="r-id mono">
        <button
          className="grip"
          disabled={sorted}
          onPointerDown={onGrab}
          onKeyDown={onGripKey}
          aria-label={`Move ${risk.name || 'Untitled'}: drag, or press the up and down arrow keys`}
          title={sorted ? 'Turn sorting off (click the sorted heading until the arrow goes) to move rows' : 'Drag to move this row'}
        >R{num}</button>
      </td>
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
  // Re-fit when the column is resized, since the text wraps differently.
  useEffect(() => {
    const el = area.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
