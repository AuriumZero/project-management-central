import { useState } from 'react'
import type { Dispatch } from 'react'
import { fromDay, toDay, today } from '../lib/dates'
import { projectKey } from '../lib/schedule'
import { makeId } from '../lib/storage'
import { PRIORITIES, STATUSES, TICKET_TYPES } from '../lib/types'
import type { AppState, Project, Status, Task, Ticket } from '../lib/types'
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

/** A blank task scheduled right after the last one in the plan. */
export function newTask(project: Project, todayDay = today()): Task {
  const lastEnd = project.tasks.length ? Math.max(...project.tasks.map((t) => toDay(t.end))) : todayDay - 1
  const start = Math.max(todayDay, lastEnd + 1)
  return { id: makeId(), name: '', start: fromDay(start), end: fromDay(start + 4), progress: 0, deps: [], notes: '' }
}

export function TaskDialog({ project, task, dispatch, onClose, toast }: DialogBase & { project: Project; task?: Task }) {
  const isNew = !task
  const [draft, setDraft] = useState<Task>(() => task ?? newTask(project))
  const [error, setError] = useState('')
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const others = project.tasks.filter((t) => t.id !== draft.id)
  const linked = project.tickets.filter((t) => t.taskId === draft.id)
  const index = project.tasks.findIndex((t) => t.id === draft.id)

  const save = () => {
    const end = draft.milestone ? draft.start : draft.end
    if (!draft.name.trim()) return setError('Give the task a name.')
    if (!draft.start || !end) return setError('Pick a start and an end date.')
    if (toDay(end) < toDay(draft.start)) return setError('The end date is before the start date. Move one of them.')
    dispatch({ type: 'saveTask', task: { ...draft, name: draft.name.trim(), end, notes: draft.notes?.trim() } })
    onClose()
  }
  const move = (by: -1 | 1) => { dispatch({ type: 'moveTask', id: draft.id, by }); onClose() }

  return (
    <Modal
      title={isNew ? 'New task' : 'Edit task'}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {!isNew && (
          <div className="row">
            <DeleteButton onConfirm={() => { dispatch({ type: 'deleteTask', id: draft.id }); onClose(); toast('Task deleted') }} />
            <button type="button" className="btn small" disabled={index <= 0} onClick={() => move(-1)} aria-label="Move up">↑</button>
            <button type="button" className="btn small" disabled={index >= project.tasks.length - 1} onClick={() => move(1)} aria-label="Move down">↓</button>
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
        <Field label="Start"><input className="input" type="date" value={draft.start} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="End"><input className="input" type="date" value={draft.milestone ? draft.start : draft.end} disabled={draft.milestone} onChange={(e) => set('end', e.target.value)} /></Field>
        <Field label={<>Progress <output className="mono">{draft.progress}%</output></>}>
          <input type="range" min={0} max={100} step={5} value={draft.progress} onChange={(e) => set('progress', Number(e.target.value))} />
        </Field>
        <label className="field check">
          <input type="checkbox" checked={!!draft.milestone} onChange={(e) => set('milestone', e.target.checked)} /> Milestone (single day)
        </label>
        {others.length > 0 && (
          <fieldset className="field full">
            <legend>Starts after</legend>
            <div className="deps">
              {others.map((o) => (
                <label key={o.id}>
                  <input
                    type="checkbox"
                    checked={draft.deps.includes(o.id)}
                    onChange={(e) => set('deps', e.target.checked ? [...draft.deps, o.id] : draft.deps.filter((d) => d !== o.id))}
                  /> {o.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Notes" full><textarea className="input" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {linked.length > 0 && (
        <p className="note">{linked.length} linked ticket{linked.length > 1 ? 's' : ''}: {linked.map((t) => `${project.key}-${t.num}`).join(', ')}</p>
      )}
      <FormError message={error} />
    </Modal>
  )
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
            {project.tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
