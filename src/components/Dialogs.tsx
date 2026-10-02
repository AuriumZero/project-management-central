import { useState } from 'react'
import type { Dispatch } from 'react'
import { fromDay, toDay, today } from '../lib/dates'
import { nameFromFile, readPlan } from '../lib/importPlan'
import { childrenOf, dropsLinks, outline } from '../lib/plan'
import { projectKey } from '../lib/schedule'
import { makeId } from '../lib/storage'
import { LINK_TYPES, PRIORITIES, STATUSES, TICKET_TYPES } from '../lib/types'
import type { AppState, Dependency, LinkType, Project, Status, Task, Ticket } from '../lib/types'
import type { SheetData } from '../lib/xlsxRead'
import type { Action } from '../state/reducer'
import { DeleteButton, Field, FormError, Modal } from './Modal'

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

interface DialogBase {
  dispatch: Dispatch<Action>
  onClose: () => void
  toast: (message: string) => void
}

export function ProjectDialog({ project, dispatch, onClose, toast }: DialogBase & { project?: Project }) {
  const [name, setName] = useState(project?.name ?? '')
  const [key, setKey] = useState(project?.key ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')

  const save = () => {
    if (!name.trim()) return setError('Give the project a name.')
    const fields = { name: name.trim(), key: projectKey(name, key), description: description.trim() }
    dispatch(project ? { type: 'updateProject', patch: fields } : { type: 'createProject', project: { id: makeId(), ...fields } })
    onClose()
  }

  return (
    <Modal
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {project && <DeleteButton label="Delete project" onConfirm={() => { dispatch({ type: 'deleteProject' }); onClose(); toast('Project deleted') }} />}
        <div className="r">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{project ? 'Save' : 'Create project'}</button>
        </div>
      </>}
    >
      <div className="fgrid">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Ticket prefix"><input className="input mono" maxLength={6} placeholder="e.g. WEB" value={key} onChange={(e) => setKey(e.target.value)} /></Field>
        <Field label="Description" full><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <FormError message={error} />
    </Modal>
  )
}

/**
 * A blank task. A new subtask starts with its parent's dates (or right after
 * the parent's last subtask); a new parent task starts after the last task.
 */
export function newTask(project: Project, parentId = '', todayDay = today()): Task {
  const base = { id: makeId(), name: '', progress: 0, deps: [], parentId, assignee: '', notes: '' }
  const parent = project.tasks.find((t) => t.id === parentId)
  if (parent) {
    const kids = childrenOf(project.tasks, parent.id)
    if (!kids.length) return { ...base, start: parent.start, end: parent.milestone ? fromDay(toDay(parent.start) + 2) : parent.end }
    const start = Math.max(...kids.map((k) => toDay(k.end))) + 1
    return { ...base, start: fromDay(start), end: fromDay(start + 2) }
  }
  const lastEnd = project.tasks.length ? Math.max(...project.tasks.map((t) => toDay(t.end))) : todayDay - 1
  const start = Math.max(todayDay, lastEnd + 1)
  return { ...base, start: fromDay(start), end: fromDay(start + 4) }
}

interface LinkEditorProps {
  label: string
  links: Dependency[]
  options: Task[]
  numById: Map<string, number>
  onChange: (links: Dependency[]) => void
}

/** Edits a list of links to other tasks: which task, link type and lag. */
function LinkEditor({ label, links, options, numById, onChange }: LinkEditorProps) {
  const update = (i: number, patch: Partial<Dependency>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const unused = options.filter((o) => !links.some((l) => l.id === o.id))
  const name = (t: Task) => `${numById.get(t.id) ?? ''} · ${t.parentId ? '— ' : ''}${t.name || 'Untitled'}`
  return (
    <fieldset className="field full links">
      <legend>{label}</legend>
      {links.map((link, i) => (
        <div className="link-row" key={link.id}>
          <select className="input" aria-label={`${label}: task`} value={link.id} onChange={(e) => update(i, { id: e.target.value })}>
            {options.filter((o) => o.id === link.id || !links.some((l) => l.id === o.id)).map((o) => <option key={o.id} value={o.id}>{name(o)}</option>)}
          </select>
          <select className="input" aria-label={`${label}: link type`} value={link.type} onChange={(e) => update(i, { type: e.target.value as LinkType })}>
            {LINK_TYPES.map(([v, l]) => <option key={v} value={v}>{v} · {l}</option>)}
          </select>
          <label className="lag">
            <span className="sr-only">Lag in days</span>
            <input className="input mono" type="number" value={link.lag} onChange={(e) => update(i, { lag: Math.round(Number(e.target.value) || 0) })} />
            <span aria-hidden="true">d</span>
          </label>
          <button type="button" className="btn ghost small" aria-label={`Remove ${label.toLowerCase()} link`} onClick={() => onChange(links.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {unused.length > 0 && (
        <button type="button" className="btn ghost small add-link" onClick={() => onChange([...links, { id: unused[0].id, type: 'FS', lag: 0 }])}>
          + Add {label.toLowerCase().replace(/s$/, '')}
        </button>
      )}
      {!links.length && !unused.length && <p className="note">No other tasks to link to yet.</p>}
    </fieldset>
  )
}

export function TaskDialog({ project, task, parentId, dispatch, onClose, toast }: DialogBase & { project: Project; task?: Task; parentId?: string }) {
  const isNew = !task
  const [draft, setDraft] = useState<Task>(() => task ?? newTask(project, parentId))
  const [successors, setSuccessors] = useState<Dependency[]>(() =>
    project.tasks.flatMap((t) => t.deps.filter((d) => d.id === draft.id).map((d) => ({ ...d, id: t.id }))))
  const [error, setError] = useState('')
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const rows = outline(project.tasks)
  const numById = new Map(rows.map((r) => [r.task.id, r.num]))
  const others = rows.map((r) => r.task).filter((t) => t.id !== draft.id)
  const hasKids = project.tasks.some((t) => t.parentId === draft.id)
  const parents = project.tasks.filter((t) => !t.parentId && t.id !== draft.id)
  const linked = project.tickets.filter((t) => t.taskId === draft.id)
  const siblings = project.tasks.filter((t) => t.parentId === draft.parentId)
  const index = siblings.findIndex((t) => t.id === draft.id)
  const kind = draft.parentId ? 'Subtask' : hasKids ? 'Parent task' : 'Task'

  const save = () => {
    const end = draft.milestone ? draft.start : draft.end
    if (!draft.name.trim()) return setError('Give the task a name.')
    if (!draft.start || !end) return setError('Pick a start and an end date.')
    if (toDay(end) < toDay(draft.start)) return setError('The end date is before the start date. Move one of them.')
    const next: Task = { ...draft, name: draft.name.trim(), assignee: draft.assignee.trim(), end, notes: draft.notes?.trim() }
    const proposed = [...project.tasks.filter((t) => t.id !== next.id), next].map((t) => (t.id === next.id ? t : {
      ...t, deps: [...t.deps.filter((d) => d.id !== next.id), ...successors.filter((s) => s.id === t.id).map((s) => ({ ...s, id: next.id }))],
    }))
    if (dropsLinks(proposed)) return setError("Those links would make a loop, or tie a task to its own parent. Remove one and try again.")
    dispatch({ type: 'saveTask', task: next, successors })
    onClose()
  }
  const move = (by: -1 | 1) => { dispatch({ type: 'moveTask', id: draft.id, by }); onClose() }

  return (
    <Modal
      title={<><span className="modal-key">{kind}{numById.has(draft.id) ? ` · row ${numById.get(draft.id)}` : ''}</span>{isNew ? `New ${kind.toLowerCase()}` : 'Edit task'}</>}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {!isNew && (
          <div className="row">
            <DeleteButton
              label={hasKids ? 'Delete with subtasks' : 'Delete'}
              onConfirm={() => { dispatch({ type: 'deleteTask', id: draft.id }); onClose(); toast('Task deleted') }}
            />
            <button type="button" className="btn small" disabled={index <= 0} onClick={() => move(-1)} aria-label="Move up">↑</button>
            <button type="button" className="btn small" disabled={index < 0 || index >= siblings.length - 1} onClick={() => move(1)} aria-label="Move down">↓</button>
          </div>
        )}
        <div className="r">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{isNew ? 'Add task' : 'Save'}</button>
        </div>
      </>}
    >
      <div className="fgrid">
        <Field label="Task name" full><input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Part of">
          <select className="input" value={draft.parentId} disabled={hasKids} onChange={(e) => set('parentId', e.target.value)}>
            <option value="">Nothing (a parent task)</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Assignee">
          <input className="input" list="assignees" value={draft.assignee} disabled={hasKids} placeholder={hasKids ? 'Set on subtasks' : 'Who does it'} onChange={(e) => set('assignee', e.target.value)} />
        </Field>
        <Field label="Start"><input className="input" type="date" value={draft.start} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="Finish">
          <input className="input" type="date" value={draft.milestone ? draft.start : draft.end} disabled={draft.milestone || hasKids} onChange={(e) => set('end', e.target.value)} />
        </Field>
        <Field label={<>Progress <output className="mono">{draft.progress}%</output></>}>
          <input type="range" min={0} max={100} step={5} value={draft.progress} disabled={hasKids} onChange={(e) => set('progress', Number(e.target.value))} />
        </Field>
        <label className="field check">
          <input type="checkbox" checked={!!draft.milestone} disabled={hasKids} onChange={(e) => set('milestone', e.target.checked)} /> Milestone (single day)
        </label>
        {hasKids && <p className="note full">Dates and progress roll up from this task's subtasks. Changing the start moves the whole group.</p>}
        <LinkEditor label="Predecessors" links={draft.deps} options={others} numById={numById} onChange={(deps) => set('deps', deps)} />
        <LinkEditor label="Successors" links={successors} options={others} numById={numById} onChange={setSuccessors} />
        <Field label="Notes" full><textarea className="input" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <AssigneeList project={project} />
      {linked.length > 0 && (
        <p className="note">{linked.length} linked ticket{linked.length > 1 ? 's' : ''}: {linked.map((t) => `${project.key}-${t.num}`).join(', ')}</p>
      )}
      <FormError message={error} />
    </Modal>
  )
}

/** Suggestions for assignee fields: everyone already assigned in this project. */
export function AssigneeList({ project }: { project: Project }) {
  const names = [...new Set(project.tasks.map((t) => t.assignee).filter(Boolean))].sort()
  return <datalist id="assignees">{names.map((n) => <option key={n} value={n} />)}</datalist>
}

export function TicketDialog({ project, ticket, status, dispatch, onClose, toast }: DialogBase & { project: Project; ticket?: Ticket; status?: Status }) {
  const isNew = !ticket
  const [draft, setDraft] = useState<Ticket>(() => ticket ?? {
    id: makeId(), num: 0, title: '', status: status ?? 'todo', priority: 'medium', type: 'task',
    taskId: '', due: '', description: '', created: fromDay(today()),
  })
  const [error, setError] = useState('')
  const set = <K extends keyof Ticket>(k: K, v: Ticket[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = () => {
    if (!draft.title.trim()) return setError('Give the ticket a title.')
    dispatch({ type: 'saveTicket', ticket: { ...draft, title: draft.title.trim(), description: draft.description.trim() } })
    onClose()
  }

  return (
    <Modal
      title={isNew ? 'New ticket' : <><span className="mono modal-key">{project.key}-{draft.num}</span>Edit ticket</>}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {!isNew && <DeleteButton onConfirm={() => { dispatch({ type: 'deleteTicket', id: draft.id }); onClose(); toast('Ticket deleted') }} />}
        <div className="r">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{isNew ? 'Create ticket' : 'Save'}</button>
        </div>
      </>}
    >
      <div className="fgrid">
        <Field label="Title" full><input className="input" value={draft.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Status">
          <select className="input" value={draft.status} onChange={(e) => set('status', e.target.value as Status)}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={draft.priority} onChange={(e) => set('priority', e.target.value as Ticket['priority'])}>
            {PRIORITIES.map((v) => <option key={v} value={v}>{capitalize(v)}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="input" value={draft.type} onChange={(e) => set('type', e.target.value as Ticket['type'])}>
            {TICKET_TYPES.map((v) => <option key={v} value={v}>{capitalize(v)}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input className="input" type="date" value={draft.due} onChange={(e) => set('due', e.target.value)} /></Field>
        <Field label="Part of task" full>
          <select className="input" value={draft.taskId} onChange={(e) => set('taskId', e.target.value)}>
            <option value="">None</option>
            {outline(project.tasks).map(({ task: t, depth }) => <option key={t.id} value={t.id}>{depth ? '— ' : ''}{t.name}</option>)}
          </select>
        </Field>
        <Field label="Description" full><textarea className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </div>
      <FormError message={error} />
    </Modal>
  )
}

export function BackupDialog({ state, onClose, toast }: { state: AppState; onClose: () => void; toast: (m: string) => void }) {
  const json = JSON.stringify(state, null, 2)
  const fileName = `project-management-central-${fromDay(today())}.json`

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      toast('Backup copied')
    } catch {
      document.querySelector<HTMLTextAreaElement>('#backup-json')?.select()
      toast('Press Ctrl+C or ⌘C to copy')
    }
  }

  return (
    <Modal
      title="Back up your data"
      onClose={onClose}
      onSubmit={download}
      footer={<>
        <span className="note mono">{(json.length / 1024).toFixed(1)} KB</span>
        <div className="r">
          <button type="button" className="btn" onClick={copy}>Copy</button>
          <button className="btn primary">Download {fileName}</button>
        </div>
      </>}
    >
      <p className="note">Your projects are saved in this browser only. Download a backup now and then, or to move your data to another computer, and use Restore there.</p>
      <textarea id="backup-json" className="input mono backup" readOnly value={json} aria-label="Backup data" />
    </Modal>
  )
}

export function RestoreDialog({ data, dispatch, onClose, toast }: DialogBase & { data: AppState }) {
  const restore = () => { dispatch({ type: 'replaceAll', state: data }); onClose(); toast('Backup restored') }
  const n = data.projects.length
  return (
    <Modal
      title="Restore this backup?"
      onClose={onClose}
      onSubmit={restore}
      footer={<div className="r">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary">Replace and restore</button>
      </div>}
    >
      <p>It holds {n} project{n === 1 ? '' : 's'}: {data.projects.map((p) => p.name).join(', ')}.</p>
      <p className="note">Restoring replaces everything currently in this browser.</p>
    </Modal>
  )
}

interface ImportDialogProps extends DialogBase {
  fileName: string
  sheets: SheetData[]
  /** The open project, which imported rows can be added to. */
  project?: Project
}

/** Shows what was found in a spreadsheet, then adds it to a new project or the open one. */
export function ImportDialog({ fileName, sheets, project, dispatch, onClose, toast }: ImportDialogProps) {
  const preview = readPlan(sheets, 'weekdays')
  const [target, setTarget] = useState<'new' | 'current'>('new')
  const [name, setName] = useState(preview.project?.name ?? nameFromFile(fileName))
  const nTasks = preview.tasks.length
  const nRisks = preview.risks.length
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  const save = () => {
    const actions: Action[] = []
    let week = project?.workWeek ?? 'weekdays'
    if (target === 'new' || !project) {
      const fields = { name: name.trim() || nameFromFile(fileName), description: preview.project?.description ?? '' }
      actions.push({ type: 'createProject', project: { id: makeId(), ...fields, key: projectKey(fields.name) } })
      week = 'weekdays'
    }
    // Read again for the project's working week, so durations count the same days.
    const { tasks, risks } = readPlan(sheets, week)
    actions.push({ type: 'importItems', tasks, risks }, { type: 'setView', view: tasks.length ? 'gantt' : 'risks' })
    dispatch({ type: 'batch', actions })
    onClose()
    toast(`Imported ${[nTasks && count(nTasks, 'task'), nRisks && count(nRisks, 'risk')].filter(Boolean).join(' and ')}`)
  }

  const found = nTasks + nRisks > 0
  return (
    <Modal
      title="Import from Excel"
      onClose={onClose}
      onSubmit={() => found && save()}
      footer={<div className="r">
        <button type="button" className="btn" onClick={onClose}>{found ? 'Cancel' : 'Close'}</button>
        {found && <button className="btn primary">Import</button>}
      </div>}
    >
      {found ? (
        <div className="import">
          <p>
            Found {[nTasks && `${count(nTasks, 'task')} on the “${preview.taskSheet}” sheet`, nRisks && `${count(nRisks, 'risk')} on the “${preview.riskSheet}” sheet`].filter(Boolean).join(' and ')} in <b>{fileName}</b>.
          </p>
          {nTasks > 0 && <p className="note">Task columns used: {preview.taskColumns.join(', ')}.</p>}
          {nRisks > 0 && <p className="note">Risk columns used: {preview.riskColumns.join(', ')}.</p>}
          {preview.warnings.length > 0 && (
            <div className="note error" role="alert">
              {preview.warnings.slice(0, 3).map((w) => <p key={w}>{w}</p>)}
              {preview.warnings.length > 3 && <p>…and {preview.warnings.length - 3} more.</p>}
            </div>
          )}
          <fieldset className="choices">
            <legend>Add them to</legend>
            <label className="choice">
              <input type="radio" name="target" checked={target === 'new'} onChange={() => setTarget('new')} />
              <span>A new project named</span>
              <input className="input" aria-label="New project name" value={name} disabled={target !== 'new'} onChange={(e) => setName(e.target.value)} />
            </label>
            {project && (
              <label className="choice">
                <input type="radio" name="target" checked={target === 'current'} onChange={() => setTarget('current')} />
                <span>The end of “{project.name}”</span>
              </label>
            )}
          </fieldset>
        </div>
      ) : (
        <>
          <p>Nothing to import was found in <b>{fileName}</b>.</p>
          <p className="note">
            The first rows of a sheet need column headings. For tasks, use Task (or Name) plus any of Start, Finish, Days,
            % Complete, Assignee, Predecessors and Notes. For risks, use Risk plus Impact or Likelihood, and optionally Type and Notes.
            A file exported from this app works as a template.
          </p>
        </>
      )}
    </Modal>
  )
}
