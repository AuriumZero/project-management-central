import { useState } from 'react'
import type { Dispatch } from 'react'
import { formatDay, toDay, today } from '../lib/dates'
import { PRIORITIES, STATUSES } from '../lib/types'
import type { Project, Status, Ticket, TicketType } from '../lib/types'
import type { Action } from '../state/reducer'

export interface TicketFilters {
  query: string
  type: TicketType | ''
}

export function filterTickets(project: Project, { query, type }: TicketFilters): Ticket[] {
  const q = query.trim().toLowerCase()
  return project.tickets.filter((t) =>
    (!type || t.type === type) &&
    (!q || `${project.key}-${t.num} ${t.title} ${t.description}`.toLowerCase().includes(q)))
}

/** Highest priority first, then oldest ticket first. */
export function sortTickets(tickets: Ticket[]): Ticket[] {
  const rank = (t: Ticket) => PRIORITIES.indexOf(t.priority)
  return [...tickets].sort((a, b) => rank(b) - rank(a) || a.num - b.num)
}

interface TicketBoardProps {
  project: Project
  filters: TicketFilters
  dispatch: Dispatch<Action>
  onOpen: (ticket: Ticket) => void
  onNew: (status: Status) => void
}

export function TicketBoard({ project, filters, dispatch, onOpen, onNew }: TicketBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
  const visible = filterTickets(project, filters)
  const filtered = Boolean(filters.query.trim() || filters.type)
  const todayDay = today()

  const drop = (status: Status, id: string) => {
    setOver(null)
    const ticket = project.tickets.find((t) => t.id === id)
    if (ticket && ticket.status !== status) dispatch({ type: 'setTicketStatus', id, status })
  }

  return (
    <div className="board">
      {STATUSES.map(([status, label]) => {
        const cards = sortTickets(visible.filter((t) => t.status === status))
        return (
          <section
            key={status}
            className={`col${over === status ? ' over' : ''}`}
            aria-label={label}
            onDragOver={(e) => { e.preventDefault(); setOver(status) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null) }}
            onDrop={(e) => { e.preventDefault(); drop(status, e.dataTransfer.getData('text/plain')) }}
          >
            <div className="col-h">
              <h3>{label}<span className="n">{cards.length}</span></h3>
              <button className="btn ghost small" onClick={() => onNew(status)} aria-label={`New ticket in ${label}`}>+</button>
            </div>
            {cards.map((t) => {
              const task = project.tasks.find((x) => x.id === t.taskId)
              const late = Boolean(t.due) && t.status !== 'done' && toDay(t.due) < todayDay
              return (
                <button
                  key={t.id}
                  className={`card${dragId === t.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id) }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(t)}
                >
                  <span className="top">
                    <span className="k">{project.key}-{t.num}</span>
                    <span className={`pill ${t.priority}`}>{t.priority}</span>
                  </span>
                  <span className="ti">{t.title}</span>
                  <span className="meta">
                    <span className={`tag ${t.type}`}>{t.type}</span>
                    {t.due && <span className={`due mono${late ? ' late' : ''}`}>{late ? 'Overdue · ' : 'Due '}{formatDay(toDay(t.due))}</span>}
                    {task && <span>↳ {task.name}</span>}
                  </span>
                </button>
              )
            })}
            {cards.length === 0 && <div className="empty">{filtered ? 'No matching tickets' : 'Drop tickets here'}</div>}
          </section>
        )
      })}
    </div>
  )
}
