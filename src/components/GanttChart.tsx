import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, InputHTMLAttributes, KeyboardEvent, PointerEvent as ReactPointerEvent, Ref } from 'react'
import { formatDay, fromDay, spanDays, toDay, today } from '../lib/dates'
import { workdaysBetween } from '../lib/calendar'
import type { WorkWeek } from '../lib/calendar'
import { dropsLinks, duration, formatPredecessors, outline, parsePredecessors, projectSummary } from '../lib/plan'
import type { OutlineRow } from '../lib/plan'
import { dragOffsets, ganttLayout, ROW_HEIGHT } from '../lib/schedule'
import type { ChartRow, DragMode } from '../lib/schedule'
import type { Project, Task } from '../lib/types'
import type { Action } from '../state/reducer'
import { AssigneeList, newTask } from './Dialogs'

export interface GanttHandle {
  scrollToToday: () => void
  /** Adds a row to the plan (a subtask when `parentId` is given) and puts the cursor in its name. */
  addTask: (parentId?: string) => void
}

interface GanttChartProps {
  project: Project
  dispatch: Dispatch<Action>
  onEditTask: (task: Task) => void
  toast: (message: string) => void
  /** Show the Start, Finish, Days, Predecessors, Assignee and % columns. */
  details: boolean
  ref?: Ref<GanttHandle>
}

/** The project summary row's id; it isn't a stored task. */
export const PROJECT_ROW = '__project'

interface Drag {
  id: string
  start: number
  end: number
  /** Pointer position for the floating date tip. */
  x: number
  y: number
}

interface LinkDrag {
  from: string
  x1: number
  y1: number
  x2: number
  y2: number
}

function useNarrow() {
  const query = () => typeof window !== 'undefined' && window.innerWidth < 760
  const [narrow, setNarrow] = useState(query)
  useEffect(() => {
    const onResize = () => setNarrow(query())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

/** Column widths in pixels; the grid is as wide as the visible columns. */
function columns(details: boolean, narrow: boolean) {
  const show = details && !narrow
  return {
    show,
    id: 32,
    name: narrow ? 140 : 220,
    actions: narrow ? 58 : 112,
    start: show ? 112 : 0,
    finish: show ? 112 : 0,
    days: show ? 46 : 0,
    preds: show ? 84 : 0,
    assignee: show ? 96 : 0,
    pct: show ? 46 : 0,
  }
}

const GRID_KEY = 'pmc.ui.gridWidth'
function savedGridWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(GRID_KEY))
    return n > 0 ? n : null
  } catch {
    return null
  }
}

export function GanttChart({ project, dispatch, onEditTask, toast, details, ref }: GanttChartProps) {
  const { tasks, zoom } = project
  const todayDay = today()
  const narrow = useNarrow()
  const col = columns(details, narrow)
  const full = col.id + col.name + col.assignee + col.start + col.finish + col.days + col.preds + col.pct + col.actions
  // The table pane can be dragged narrower than its columns, like Microsoft Project's split view.
  const [gridWidth, setGridWidth] = useState<number | null>(savedGridWidth)
  const [paneWidth, setPaneWidth] = useState(1200)
  const fallback = Math.max(360, Math.round(paneWidth * 0.5))
  const left = narrow ? full : Math.min(full, Math.max(200, gridWidth ?? fallback))

  const rows = useMemo(() => outline(tasks), [tasks])
  const visible = rows.filter((r) => !r.hidden)
  const summary = useMemo(() => projectSummary(tasks), [tasks])
  const numById = useMemo(() => new Map(rows.map((r) => [r.task.id, r.num])), [rows])
  const idByNum = useMemo(() => new Map(rows.map((r) => [r.num, r.task.id])), [rows])

  const chartRows: ChartRow[] = useMemo(() => [
    ...(summary ? [{ id: PROJECT_ROW, start: fromDay(summary.start), end: fromDay(summary.end), milestone: false, summary: true, deps: [] }] : []),
    ...visible.map((r) => ({ id: r.task.id, start: r.task.start, end: r.task.end, milestone: !!r.task.milestone, summary: r.hasChildren, deps: r.task.deps })),
  ], [summary, visible])
  const layout = useMemo(() => ganttLayout(chartRows, zoom, todayDay), [chartRows, zoom, todayDay])

  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const headClip = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setPaneWidth(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [tasks.length > 0])

  const startSplit = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    const x0 = e.clientX
    const w0 = left
    let latest = w0
    handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(full, Math.max(200, w0 + ev.clientX - x0))
      setGridWidth(latest)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      try { localStorage.setItem(GRID_KEY, String(latest)) } catch { /* not critical */ }
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }
  const splitter = !narrow && (
    <div className="g-split" role="separator" aria-orientation="vertical" aria-label="Resize the task table" title="Drag to resize the table" onPointerDown={startSplit} />
  )
  const [drag, setDrag] = useState<Drag | null>(null)
  const [link, setLink] = useState<LinkDrag | null>(null)

  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current
    if (!el || layout.todayX == null) return
    el.scrollTo({ left: Math.max(0, layout.todayX - (el.clientWidth - left) / 4), behavior })
  }
  // New tasks go straight into the grid, like typing into a blank row in Microsoft Project.
  const [focusId, setFocusId] = useState<string | null>(null)
  const addTask = (parentId = '') => {
    const task = { ...newTask(project, parentId), name: parentId ? 'New subtask' : 'New task' }
    dispatch({ type: 'saveTask', task })
    setFocusId(task.id)
  }
  useEffect(() => {
    if (!focusId) return
    const input = scroller.current?.querySelector<HTMLInputElement>(`[data-id="${focusId}"] input.name`)
    if (!input) return
    input.focus()
    input.select()
    setFocusId(null)
  }, [focusId, tasks])

  useImperativeHandle(ref, () => ({ scrollToToday, addTask }))

  // Start each project and zoom level with today in view.
  useLayoutEffect(() => { scrollToToday('instant') }, [project.id, zoom])

  if (!tasks.length) {
    return (
      <div className="blank">
        <h2>No tasks in this plan</h2>
        <p>Add parent tasks for the big deliverables, then break each one into subtasks with an owner. The Gantt chart builds itself as you go.</p>
        <button className="btn primary" onClick={() => addTask()}>Add the first task</button>
      </div>
    )
  }

  const byId = (id: string) => tasks.find((t) => t.id === id)
  const hasKids = (id: string) => tasks.some((t) => t.parentId === id)

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, task: Task) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.dataset.link) return startLink(e, task)
    e.preventDefault()
    const bar = e.currentTarget
    const group = hasKids(task.id)
    const handle = target.dataset.handle as DragMode | undefined
    const mode: DragMode = task.milestone || group ? 'move' : handle ?? 'move'
    const length = spanDays(task.start, task.end)
    const x0 = e.clientX
    let moved = false
    let offsets = { start: 0, end: 0 }
    bar.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (!moved) return
      offsets = dragOffsets(mode, Math.round((ev.clientX - x0) / layout.dayWidth), length)
      setDrag({ id: task.id, ...offsets, x: ev.clientX, y: ev.clientY })
    }
    const onUp = () => {
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerup', onUp)
      bar.removeEventListener('pointercancel', onUp)
      setDrag(null)
      if (!moved) return onEditTask(task)
      if (offsets.start || offsets.end) dispatch({ type: 'shiftTask', id: task.id, ...offsets })
    }
    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerup', onUp)
    bar.addEventListener('pointercancel', onUp)
  }

  /** Drag from the dot at the end of a bar onto another bar to link them finish-to-start. */
  const startLink = (e: ReactPointerEvent<HTMLDivElement>, task: Task) => {
    e.preventDefault()
    e.stopPropagation()
    const dot = e.target as HTMLElement
    const origin = body.current!.getBoundingClientRect()
    const r = dot.getBoundingClientRect()
    const x1 = r.left + r.width / 2 - origin.left
    const y1 = r.top + r.height / 2 - origin.top
    dot.setPointerCapture(e.pointerId)
    setLink({ from: task.id, x1, y1, x2: x1, y2: y1 })

    const onMove = (ev: PointerEvent) => {
      const o = body.current!.getBoundingClientRect()
      setLink({ from: task.id, x1, y1, x2: ev.clientX - o.left, y2: ev.clientY - o.top })
    }
    const onUp = (ev: PointerEvent) => {
      dot.removeEventListener('pointermove', onMove)
      dot.removeEventListener('pointerup', onUp)
      dot.removeEventListener('pointercancel', onUp)
      setLink(null)
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-tid]')
      const to = hit?.dataset.tid
      if (!to || to === task.id || to === PROJECT_ROW) return
      const succ = byId(to)
      if (!succ) return
      if (succ.deps.some((d) => d.id === task.id)) return toast('Those tasks are already linked.')
      const proposed = tasks.map((t) => (t.id === to ? { ...t, deps: [...t.deps, { id: task.id, type: 'FS' as const, lag: 0 }] } : t))
      if (dropsLinks(proposed)) return toast("That link would make a loop, or tie a task to its own parent.")
      dispatch({ type: 'addLink', from: task.id, to })
      toast(`Linked: ${succ.name} now starts after ${task.name}.`)
    }
    dot.addEventListener('pointermove', onMove)
    dot.addEventListener('pointerup', onUp)
    dot.addEventListener('pointercancel', onUp)
  }

  const dragged = drag && byId(drag.id)
  const tip = dragged && drag && (() => {
    const s = toDay(dragged.start) + drag.start
    const e = dragged.milestone ? s : toDay(dragged.end) + (hasKids(dragged.id) ? drag.start : drag.end)
    return dragged.milestone ? formatDay(s) : `${formatDay(s)} – ${formatDay(e)} · ${workdaysBetween(s, e, project.workWeek)}d`
  })()

  const gridStyle = {
    '--rh': `${ROW_HEIGHT}px`,
    '--c-id': `${col.id}px`, '--c-name': `${col.name}px`, '--c-assignee': `${col.assignee}px`, '--c-start': `${col.start}px`,
    '--c-finish': `${col.finish}px`, '--c-days': `${col.days}px`, '--c-preds': `${col.preds}px`, '--c-pct': `${col.pct}px`,
    '--c-actions': `${col.actions}px`,
  } as CSSProperties

  return (
    <div className={`gantt${col.show ? ' details' : ''}`} ref={scroller} style={gridStyle}>
      <AssigneeList project={project} />
      <div className="g-inner" style={{ width: left + layout.width }}>
        <div className="g-head">
          <div className="g-corner" style={{ width: left }}>
            <div className="g-clip" ref={headClip}>
              <div className="grid-row" style={{ width: full }} role="row">
                <span className="c-id label" role="columnheader">ID</span>
                <span className="c-name label" role="columnheader">Task</span>
                <span className="c-actions label" role="columnheader"><span className="sr-only">Actions</span></span>
                {col.show && <>
                  <span className="c-start label" role="columnheader">Start</span>
                  <span className="c-finish label" role="columnheader">Finish</span>
                  <span className="c-days label" role="columnheader">Days</span>
                  <span className="c-preds label" role="columnheader" title="Predecessors: row numbers, e.g. 3 or 5SS+2d">Pred.</span>
                  <span className="c-assignee label" role="columnheader">Assignee</span>
                  <span className="c-pct label" role="columnheader">%</span>
                </>}
              </div>
            </div>
            {splitter}
          </div>
          <div className="g-scale" style={{ width: layout.width }}>
            {layout.months.map((m) => <div key={m.x} className="g-mon" style={{ left: m.x }}>{m.label}</div>)}
            {layout.days.map((d) => (
              <div key={d.x} className={`g-day${d.weekStart ? ' wk' : ''}${d.isToday ? ' now' : ''}`} style={{ left: d.x, width: d.width }}>{d.label}</div>
            ))}
            {zoom !== 'day' && layout.todayX != null && <div className="g-today-tag" style={{ left: layout.todayX }}>TODAY</div>}
          </div>
        </div>
        <div className="g-rows">
          <div className="g-names" style={{ width: left }}>
           <div
             className="g-clip"
             role="grid"
             aria-label="Tasks"
             style={{ '--full': `${full}px` } as CSSProperties}
             onScroll={(e) => { if (headClip.current) headClip.current.scrollLeft = e.currentTarget.scrollLeft }}
           >
            {summary && (
              <ProjectRow project={project} summary={summary} show={col.show} dispatch={dispatch} />
            )}
            {visible.map((row) => (
              <TaskRow
                week={project.workWeek}
                key={row.task.id}
                row={row}
                show={col.show}
                narrow={narrow}
                canIndent={!row.task.parentId && !row.hasChildren && tasks.filter((t) => !t.parentId).indexOf(row.task) > 0}
                numById={numById}
                idByNum={idByNum}
                tasks={tasks}
                dispatch={dispatch}
                toast={toast}
                onEdit={() => onEditTask(row.task)}
                onAddSubtask={() => addTask(row.task.id)}
              />
            ))}
            <div className="g-add">
              <button className="btn ghost small" onClick={() => addTask()}>+ Add task</button>
            </div>
           </div>
           {splitter}
          </div>
          <div className="g-body" ref={body} style={{ width: layout.width, height: layout.height }}>
            {layout.gridLines.map((x) => <div key={`l${x}`} className="g-line" style={{ left: x }} />)}
            {project.workWeek === 'weekdays' && layout.weekends.map((w) => <div key={`w${w.x}`} className="g-wkend" style={{ left: w.x, width: w.width }} />)}
            {chartRows.map((r, i) => <div key={`r${r.id}`} className="g-rowline" style={{ top: (i + 1) * ROW_HEIGHT - 1 }} />)}
            {layout.todayX != null && <div className="g-today" style={{ left: layout.todayX - 1 }} />}
            <svg className="g-svg" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" />
                </marker>
              </defs>
              {layout.arrows.map((a) => <path key={`${a.from}-${a.to}`} d={a.path} markerEnd="url(#ah)" />)}
              {link && <line className="link-preview" x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} />}
            </svg>
            {layout.bars.map((bar) => {
              if (bar.id === PROJECT_ROW) {
                return (
                  <div key={bar.id} className="bar summary project" style={{ left: bar.x, top: bar.y, width: bar.width }} title={`${project.name}: whole project`}>
                    <span className="lbl">{project.name} · {summary?.progress ?? 0}%</span>
                  </div>
                )
              }
              const t = byId(bar.id)!
              const off = drag?.id === t.id ? drag : null
              const group = bar.kind === 'summary'
              const x = bar.x + (off ? off.start * layout.dayWidth : 0)
              const width = bar.width + (off && bar.kind === 'task' ? (off.end - off.start) * layout.dayWidth : 0)
              const done = t.progress >= 100
              const label = `${t.name}${!t.milestone && t.progress ? ` · ${t.progress}%` : ''}${t.assignee ? ` · ${t.assignee}` : ''}`
              return (
                <div
                  key={t.id}
                  className={`bar ${bar.kind === 'milestone' ? 'ms' : group ? 'summary' : ''}${done ? ' done' : ''}${off ? ' dragging' : ''}`}
                  style={{ left: x, top: bar.y, width }}
                  title={t.name}
                  data-tid={t.id}
                  data-testid={`bar-${t.id}`}
                  onPointerDown={(e) => startDrag(e, t)}
                >
                  {bar.kind === 'task' && <>
                    <div className="fill" style={{ width: `${t.progress}%` }} />
                    <div className="h l" data-handle="start" />
                    <div className="h r" data-handle="end" />
                  </>}
                  {group && <div className="fill" style={{ width: `${t.progress}%` }} />}
                  <div className="link-dot" data-link="1" title="Drag onto another task to link them" />
                  <span className="lbl">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {tip && drag && <div className="drag-tip" style={{ left: drag.x + 12, top: drag.y + 14 }}>{tip}</div>}
    </div>
  )
}

/** A text input that saves when you leave it or press Enter, and reverts on Escape. */
function Cell({ value, onCommit, label, className = '', onKeyDown: extraKeyDown, ...rest }: {
  value: string
  onCommit: (value: string) => void
  label: string
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur() }
    extraKeyDown?.(e)
  }
  return (
    <input
      key={value}
      className={`cell ${className}`}
      defaultValue={value}
      aria-label={label}
      onKeyDown={onKeyDown}
      onBlur={(e) => { if (e.currentTarget.value !== value) onCommit(e.currentTarget.value) }}
      {...rest}
    />
  )
}

interface TaskRowProps {
  week: WorkWeek
  row: OutlineRow
  show: boolean
  narrow: boolean
  canIndent: boolean
  numById: Map<string, number>
  idByNum: Map<number, string>
  tasks: Task[]
  dispatch: Dispatch<Action>
  toast: (message: string) => void
  onEdit: () => void
  onAddSubtask: () => void
}

function TaskRow({ week, row, show, narrow, canIndent, numById, idByNum, tasks, dispatch, toast, onEdit, onAddSubtask }: TaskRowProps) {
  const { task, depth, hasChildren, num } = row
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])

  const update = (patch: Partial<Task> & { days?: number }) => dispatch({ type: 'updateTask', id: task.id, patch })
  const name = task.name || 'Untitled'
  const days = duration(task, week)
  const kids = tasks.filter((t) => t.parentId === task.id).length

  // Tab from the name goes straight to Start, past the row buttons, so a row can be typed in one pass.
  const tabToStart = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || !show) return
    const next = e.currentTarget.closest('[role=row]')?.querySelector<HTMLInputElement>('.c-start input')
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  const commitStart = (v: string) => {
    if (!v) return
    // Moving the start keeps the length, as in Microsoft Project.
    update({ start: v })
  }
  const commitFinish = (v: string) => {
    if (!v) return
    if (toDay(v) < toDay(task.start)) return toast('The finish date is before the start date.')
    update({ end: v })
  }
  const commitDays = (v: string) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < 1) return toast('Days must be 1 or more.')
    update({ days: n })
  }
  const commitPreds = (v: string) => {
    const deps = parsePredecessors(v, idByNum, task.id)
    if (typeof deps === 'string') return toast(deps)
    const proposed = tasks.map((t) => (t.id === task.id ? { ...t, deps } : t))
    if (dropsLinks(proposed)) return toast("That link would make a loop, or tie a task to its own parent.")
    update({ deps })
  }
  const commitPct = (v: string) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < 0 || n > 100) return toast('Progress is a number from 0 to 100.')
    update({ progress: n })
  }

  return (
    <div className={`g-name grid-row${depth ? ' sub' : ''}${hasChildren ? ' parent' : ''}`} role="row" data-row={num} data-id={task.id}>
      <span className="c-id mono" role="gridcell">{num}</span>
      <span className="c-name" role="gridcell" style={{ paddingLeft: depth * 18 }}>
        {hasChildren ? (
          <button
            className="twisty"
            aria-label={`${task.collapsed ? 'Show' : 'Hide'} subtasks of ${name}`}
            aria-expanded={!task.collapsed}
            onClick={() => dispatch({ type: 'toggleCollapse', id: task.id })}
          >{task.collapsed ? '▸' : '▾'}</button>
        ) : <span className="twisty-gap">{task.milestone ? '◆' : ''}</span>}
        <Cell value={task.name} label={`Name of row ${num}`} className="name" onKeyDown={tabToStart} onCommit={(v) => v.trim() ? update({ name: v.trim() }) : toast('A task needs a name.')} />
      </span>
      <span className="c-actions" role="gridcell">
        {armed ? (
          <button className="row-btn confirm" onClick={() => dispatch({ type: 'deleteTask', id: task.id })} aria-label={`Confirm delete ${name}`}>
            {kids ? `Delete ${kids + 1}?` : 'Delete?'}
          </button>
        ) : <>
          <button className="row-btn" onClick={onEdit} aria-label={`Edit ${name}`} title="Edit">✎</button>
          {!narrow && <>
            {!depth
              ? <button className="row-btn" onClick={onAddSubtask} aria-label={`Add subtask to ${name}`} title="Add subtask">＋</button>
              : <span className="row-btn-gap" />}
            {depth
              ? <button className="row-btn" onClick={() => dispatch({ type: 'outdentTask', id: task.id })} aria-label={`Make ${name} a parent task`} title="Outdent: make it a parent task">⇤</button>
              : <button className="row-btn" disabled={!canIndent} onClick={() => dispatch({ type: 'indentTask', id: task.id })} aria-label={`Make ${name} a subtask`} title="Indent: make it a subtask of the task above">⇥</button>}
          </>}
          <button className="row-btn danger" onClick={() => setArmed(true)} aria-label={`Delete ${name}`} title={kids ? 'Delete with its subtasks' : 'Delete'}>🗑</button>
        </>}
      </span>
      {show && <>
        <span className="c-start" role="gridcell">
          <Cell type="date" value={task.start} label={`Start of ${name}`} onCommit={commitStart} />
        </span>
        <span className="c-finish" role="gridcell">
          <Cell type="date" value={task.end} label={`Finish of ${name}`} onCommit={commitFinish} disabled={hasChildren || !!task.milestone} />
        </span>
        <span className="c-days" role="gridcell">
          <Cell type="number" min={1} value={String(days)} label={`Days for ${name}`} className="mono" onCommit={commitDays} disabled={hasChildren || !!task.milestone} />
        </span>
        <span className="c-preds" role="gridcell">
          <Cell value={formatPredecessors(task, numById)} label={`Predecessors of ${name}`} className="mono" placeholder="—" onCommit={commitPreds} />
        </span>
        <span className="c-assignee" role="gridcell">
          {hasChildren
            ? <span className="muted">—</span>
            : <Cell value={task.assignee} label={`Assignee of ${name}`} list="assignees" placeholder={depth ? 'Assign' : ''} onCommit={(v) => update({ assignee: v.trim() })} />}
        </span>
        <span className="c-pct" role="gridcell">
          <Cell type="number" min={0} max={100} value={String(task.progress)} label={`Percent complete for ${name}`} className="mono" onCommit={commitPct} disabled={hasChildren} />
        </span>
      </>}
    </div>
  )
}

function ProjectRow({ project, summary, show, dispatch }: {
  project: Project
  summary: { start: number; end: number; progress: number }
  show: boolean
  dispatch: Dispatch<Action>
}) {
  return (
    <div className="g-name grid-row project" role="row" data-tid={PROJECT_ROW}>
      <span className="c-id mono" role="gridcell">0</span>
      <span className="c-name" role="gridcell">
        <span className="twisty-gap">▣</span>
        <Cell
          value={project.name}
          label="Project name"
          className="name"
          onCommit={(v) => v.trim() && dispatch({ type: 'updateProject', patch: { name: v.trim(), key: project.key, description: project.description } })}
        />
      </span>
      <span className="c-actions" role="gridcell" />
      {show && <>
        <span className="c-start mono ro" role="gridcell">{formatDay(summary.start, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
        <span className="c-finish mono ro" role="gridcell">{formatDay(summary.end, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
        <span className="c-days mono ro" role="gridcell">{workdaysBetween(summary.start, summary.end, project.workWeek)}</span>
        <span className="c-preds" role="gridcell" />
        <span className="c-assignee ro muted" role="gridcell">Whole project</span>
        <span className="c-pct mono ro" role="gridcell">{summary.progress}</span>
      </>}
    </div>
  )
}
