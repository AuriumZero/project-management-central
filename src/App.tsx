import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BackupDialog, ProjectDialog, RestoreDialog, TaskDialog, TicketDialog } from './components/Dialogs'
import { GanttChart } from './components/GanttChart'
import type { GanttHandle } from './components/GanttChart'
import { TicketBoard } from './components/TicketBoard'
import type { TicketFilters } from './components/TicketBoard'
import type { WorkWeek } from './lib/calendar'
import { formatDay } from './lib/dates'
import { projectStats } from './lib/schedule'
import { loadState, parseBackup, saveState, seedState } from './lib/storage'
import { TICKET_TYPES, ZOOMS } from './lib/types'
import type { AppState, Status, Task, Ticket, TicketType } from './lib/types'
import { historyReducer, initHistory } from './state/history'
import { currentProject } from './state/reducer'

type Dialog =
  | { kind: 'project'; isNew: boolean }
  | { kind: 'task'; task?: Task; parentId?: string }
  | { kind: 'ticket'; ticket?: Ticket; status?: Status }
  | { kind: 'backup' }
  | { kind: 'restore'; data: AppState }

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

const DETAILS_KEY = 'pmc.ui.details'
function initialDetails(): boolean {
  try {
    const saved = localStorage.getItem(DETAILS_KEY)
    if (saved) return saved === '1'
  } catch { /* storage blocked: fall through */ }
  return typeof window === 'undefined' || window.innerWidth >= 1200
}

export default function App({ initialState }: { initialState?: AppState }) {
  const [history, dispatch] = useReducer(historyReducer, initialState, (init) => initHistory(init ?? loadState() ?? seedState()))
  const state = history.present
  const [details, setDetails] = useState(initialDetails)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [filters, setFilters] = useState<TicketFilters>({ query: '', type: '' })
  const [toastMsg, setToastMsg] = useState('')
  const gantt = useRef<GanttHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const warnedStorage = useRef(false)
  const project = currentProject(state)

  const toast = useCallback((message: string) => setToastMsg(message), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    if (!toastMsg) return
    const id = setTimeout(() => setToastMsg(''), 3200)
    return () => clearTimeout(id)
  }, [toastMsg])

  useEffect(() => {
    if (!saveState(state) && !warnedStorage.current) {
      warnedStorage.current = true
      toast('This browser is not saving changes. Back up your data before closing.')
    }
  }, [state, toast])

  useEffect(() => {
    try { localStorage.setItem(DETAILS_KEY, details ? '1' : '0') } catch { /* not critical */ }
  }, [details])

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const selectProject = (id: string) => {
    dispatch({ type: 'selectProject', id })
    setFilters({ query: '', type: '' })
  }

  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return
    const parsed = parseBackup(await file.text())
    if (typeof parsed === 'string') toast(parsed)
    else setDialog({ kind: 'restore', data: parsed })
  }

  const dialogProps = { dispatch, onClose: closeDialog, toast }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">Project Management Central<small>Plans · Gantt · Tickets</small></div>
        <div>
          <div className="label" id="projects-label">Projects</div>
          <nav className="plist" aria-labelledby="projects-label">
            {state.projects.map((p) => (
              <button key={p.id} className="pitem" aria-current={p === project} onClick={() => selectProject(p.id)}>
                <span className="key">{p.key}</span>
                <span className="nm">{p.name}</span>
              </button>
            ))}
            {state.projects.length === 0 && <div className="note">No projects yet.</div>}
          </nav>
        </div>
        <button className="btn" onClick={() => setDialog({ kind: 'project', isNew: true })}>+ New project</button>
        <div className="rail-foot">
          <button className="btn ghost small" onClick={() => setDialog({ kind: 'backup' })}>Back up data</button>
          <button className="btn ghost small" onClick={() => fileInput.current?.click()}>Restore</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="restore-input"
            onChange={(e) => { void onRestoreFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>
      </aside>

      <main className="main">
        {!project ? (
          <div className="blank">
            <h2>Start your first project</h2>
            <p>A project holds a plan of dated tasks, shown as a Gantt chart, and a board of tickets.</p>
            <button className="btn primary" onClick={() => setDialog({ kind: 'project', isNew: true })}>Create a project</button>
          </div>
        ) : (
          <>
            <ProjectHeader project={project} onEdit={() => setDialog({ kind: 'project', isNew: false })} />
            <div className="toolbar">
              <div className="tabs" role="tablist" aria-label="View">
                <button role="tab" aria-selected={project.view !== 'board'} onClick={() => dispatch({ type: 'setView', view: 'gantt' })}>Plan &amp; Gantt</button>
                <button role="tab" aria-selected={project.view === 'board'} onClick={() => dispatch({ type: 'setView', view: 'board' })}>Tickets</button>
              </div>
              <div className="tools">
                {project.view === 'board' ? (
                  <>
                    <input
                      className="input filter"
                      type="search"
                      placeholder="Filter tickets"
                      aria-label="Filter tickets"
                      value={filters.query}
                      onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                    />
                    <select
                      className="input"
                      aria-label="Ticket type"
                      value={filters.type}
                      onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TicketType | '' }))}
                    >
                      <option value="">All types</option>
                      {TICKET_TYPES.map((t) => <option key={t} value={t}>{capitalize(t)}</option>)}
                    </select>
                    <button className="btn primary" onClick={() => setDialog({ kind: 'ticket' })}>+ Ticket</button>
                  </>
                ) : (
                  <>
                    <div className="seg" role="group" aria-label="Zoom">
                      {ZOOMS.map((z) => (
                        <button key={z} aria-pressed={project.zoom === z} onClick={() => dispatch({ type: 'setZoom', zoom: z })}>{capitalize(z)}</button>
                      ))}
                    </div>
                    <select
                      className="input"
                      aria-label="Working days"
                      title="Which days count toward task durations"
                      value={project.workWeek}
                      onChange={(e) => dispatch({ type: 'setWorkWeek', workWeek: e.target.value as WorkWeek })}
                    >
                      <option value="weekdays">Mon–Fri</option>
                      <option value="all">7 days a week</option>
                    </select>
                    <div className="seg" role="group" aria-label="History">
                      <button disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl+Z)">Undo</button>
                      <button disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })} title="Redo (Ctrl+Shift+Z)">Redo</button>
                    </div>
                    <button className="btn hide-narrow" aria-pressed={details} onClick={() => setDetails((d) => !d)}>
                      {details ? 'Hide columns' : 'Show columns'}
                    </button>
                    <button className="btn" onClick={() => gantt.current?.scrollToToday()}>Today</button>
                    <button className="btn primary" onClick={() => setDialog({ kind: 'task' })}>+ Task</button>
                  </>
                )}
              </div>
            </div>
            {project.view === 'board' ? (
              <TicketBoard
                project={project}
                filters={filters}
                dispatch={dispatch}
                onOpen={(ticket) => setDialog({ kind: 'ticket', ticket })}
                onNew={(status) => setDialog({ kind: 'ticket', status })}
              />
            ) : (
              <GanttChart
                ref={gantt}
                project={project}
                dispatch={dispatch}
                onEditTask={(task) => setDialog({ kind: 'task', task })}
                onNewTask={(parentId) => setDialog({ kind: 'task', parentId })}
                toast={toast}
                details={details}
              />
            )}
          </>
        )}
      </main>

      {dialog?.kind === 'project' && <ProjectDialog {...dialogProps} project={dialog.isNew ? undefined : project} />}
      {dialog?.kind === 'task' && project && <TaskDialog {...dialogProps} project={project} task={dialog.task} parentId={dialog.parentId} />}
      {dialog?.kind === 'ticket' && project && <TicketDialog {...dialogProps} project={project} ticket={dialog.ticket} status={dialog.status} />}
      {dialog?.kind === 'backup' && <BackupDialog state={state} onClose={closeDialog} toast={toast} />}
      {dialog?.kind === 'restore' && <RestoreDialog {...dialogProps} data={dialog.data} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}

function ProjectHeader({ project, onEdit }: { project: NonNullable<ReturnType<typeof currentProject>>; onEdit: () => void }) {
  const { percent, openTickets, span } = projectStats(project)
  return (
    <div className="phead">
      <div>
        <div className="title-row">
          <h1>{project.name}</h1>
          <button className="btn ghost small" onClick={onEdit}>Edit</button>
        </div>
        {project.description && <p className="desc">{project.description}</p>}
      </div>
      <div className="stats">
        <div className="stat">
          <b>{percent}%</b><span>Complete</span>
          <div className="meter" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
        </div>
        <div className="stat"><b>{project.tasks.length}</b><span>Tasks</span></div>
        <div className="stat"><b>{openTickets}</b><span>Open tickets</span></div>
        <div className="stat">
          <b className="span">{span ? `${formatDay(span[0])} – ${formatDay(span[1], { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No dates yet'}</b>
          <span>Timeline</span>
        </div>
      </div>
    </div>
  )
}
