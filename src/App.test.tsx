import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { addWorkdays } from './lib/calendar'
import { fromDay, toDay } from './lib/dates'
import { loadState, seedState, STORAGE_KEY } from './lib/storage'

const renderApp = () => {
  const user = userEvent.setup()
  render(<App initialState={seedState()} />)
  return user
}

describe('App', () => {
  it('opens on the sample project with its plan', () => {
    renderApp()
    expect(screen.getByRole('heading', { level: 1, name: 'Website relaunch (example)' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Wireframes')).toBeInTheDocument()
    // Row 0 is the whole project, rolled up from every task.
    expect(screen.getByLabelText('Project name')).toHaveValue('Website relaunch (example)')
    expect(screen.getByText('Open tickets').previousElementSibling).toHaveTextContent('6')
  })

  it('adds a task as a new row with its name ready to type over', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const name = screen.getByDisplayValue('New task')
    expect(name).toHaveFocus()
    await user.keyboard('Write launch email{Enter}')
    expect(screen.getByDisplayValue('Write launch email')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('Write launch email')
  })

  it('fills in a new row column by column', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    await user.click(screen.getByRole('button', { name: '+ Add task' }))
    await user.keyboard('Press kit')
    await user.tab()
    expect(screen.getByLabelText('Start of Press kit')).toHaveFocus()
    const row = screen.getByDisplayValue('Press kit').closest<HTMLElement>('[role=row]')!
    const days = within(row).getByLabelText('Days for Press kit')
    await user.clear(days)
    await user.type(days, '3{Enter}')
    await user.type(within(row).getByLabelText('Assignee of Press kit'), 'Robin{Enter}')
    const saved = loadState()!.projects[0].tasks.find((t) => t.name === 'Press kit')!
    expect(saved.assignee).toBe('Robin')
    expect(toDay(saved.end)).toBe(addWorkdays(toDay(saved.start), 2, 'weekdays'))
  })

  it('types several tasks in a row by pressing Enter', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    await user.keyboard('Brief agency{Enter}Book venue{Enter}Send invites')
    const names = loadState()!.projects[0].tasks.map((t) => t.name)
    expect(names.slice(-3)).toEqual(['Brief agency', 'Book venue', 'New task'])
    expect(screen.getByDisplayValue('Send invites')).toHaveFocus()
  })

  it('moves down and up a column with Enter and Shift+Enter', async () => {
    const user = renderApp()
    await user.click(screen.getByDisplayValue('Wireframes'))
    await user.keyboard('{Enter}')
    expect(screen.getByDisplayValue('Visual design')).toHaveFocus()
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(screen.getByDisplayValue('Wireframes')).toHaveFocus()
  })

  it('adds a sibling subtask when Enter is pressed on the last subtask', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Delete Launch' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete Launch' }))
    await user.click(screen.getByDisplayValue('QA & fixes'))
    await user.keyboard('{Enter}')
    expect(screen.getByDisplayValue('New subtask')).toHaveFocus()
    const saved = loadState()!.projects[0].tasks
    const build = saved.find((t) => t.name === 'Build')!
    expect(saved.find((t) => t.name === 'New subtask')).toMatchObject({ parentId: build.id })
  })

  it('adds a task from any column when Enter is pressed on the last row', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    await user.click(screen.getByLabelText('Assignee of Launch'))
    await user.keyboard('{Enter}')
    expect(screen.getByDisplayValue('New task')).toHaveFocus()
  })

  it('logs risks in their own tab, typed in like tasks', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('tab', { name: 'Risks & issues' }))
    await user.click(screen.getByRole('button', { name: '+ Risk' }))
    expect(screen.getByDisplayValue('New risk')).toHaveFocus()
    await user.keyboard('Venue cancels')
    await user.tab()
    await user.selectOptions(screen.getByLabelText('Impact of Venue cancels'), 'high')
    const likely = screen.getByLabelText('Likelihood of Venue cancels, in percent')
    await user.clear(likely)
    await user.type(likely, '25')
    await user.type(screen.getByLabelText('Notes for Venue cancels'), 'Backup venue on hold{Enter}')
    expect(screen.getByDisplayValue('New risk')).toHaveFocus()
    const risk = loadState()!.projects[0].risks.find((r) => r.name === 'Venue cancels')
    expect(risk).toMatchObject({ impact: 'high', likelihood: 25, notes: 'Backup venue on hold' })
  })

  it('turns a column pasted from Excel into that many tasks, as one undo step', async () => {
    const user = renderApp()
    const before = loadState()?.projects[0].tasks.length ?? seedState().projects[0].tasks.length
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    await user.paste('Book venue\r\nSend invites\r\nOrder catering\r\n')
    const names = loadState()!.projects[0].tasks.map((t) => t.name)
    expect(names.slice(-3)).toEqual(['Book venue', 'Send invites', 'Order catering'])
    expect(names).toHaveLength(before + 3)
    expect(screen.getByRole('status')).toHaveTextContent('Pasted 3 rows, adding 2 tasks.')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByDisplayValue('Send invites')).not.toBeInTheDocument()
  })

  it('pastes several columns, starting from the column you paste into', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    await user.paste('Brief\t11/16/2026\t\t3\t\tRobin\t50%\nShoot\t11/23/2026\t\t2\t\tSam\t0')
    const saved = loadState()!.projects[0].tasks
    expect(saved.find((t) => t.name === 'Brief')).toMatchObject({ start: '2026-11-16', end: '2026-11-18', assignee: 'Robin', progress: 50 })
    expect(saved.find((t) => t.name === 'Shoot')).toMatchObject({ start: '2026-11-23', end: '2026-11-24', assignee: 'Sam' })
  })

  it('classifies, sorts and pastes risks', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('tab', { name: 'Risks & issues' }))
    const names = () => screen.getAllByLabelText(/^Risk \d+$/).map((i) => (i as HTMLInputElement).value)
    expect(screen.getByLabelText('Type of Front-end developer on leave for a week in October')).toHaveValue('issue')
    await user.click(screen.getByRole('button', { name: /Likelihood/ }))
    expect(names()[0]).toBe('Old blog URLs break on launch')
    await user.click(screen.getByRole('button', { name: /Likelihood/ }))
    expect(names()[0]).toBe('Front-end developer on leave for a week in October')
    await user.click(screen.getByRole('button', { name: /^ID/ }))
    await user.click(screen.getByRole('button', { name: '+ Risk' }))
    await user.paste('Supplier goes bust\tRisk\tHigh\t10%\nPrinter broke\tIssue\tlow\t100%\tReplaced it')
    const risks = loadState()!.projects[0].risks
    expect(risks.slice(-2)).toMatchObject([
      { name: 'Supplier goes bust', kind: 'risk', impact: 'high', likelihood: 10 },
      { name: 'Printer broke', kind: 'issue', impact: 'low', likelihood: 100, notes: 'Replaced it' },
    ])
  })

  it('refuses an edit that ends before it starts', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Edit Wireframes' }))
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-10' } })
    fireEvent.change(screen.getByLabelText('Finish'), { target: { value: '2026-10-01' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The end date is before the start date')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renames a task right in the grid', async () => {
    const user = renderApp()
    const name = screen.getByDisplayValue('Wireframes')
    await user.clear(name)
    await user.type(name, 'Low-fi wireframes{Enter}')
    expect(screen.getByDisplayValue('Low-fi wireframes')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('Low-fi wireframes')
  })

  it('deletes a task from its row after a second click, and undo brings it back', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Delete Wireframes' }))
    expect(screen.getByDisplayValue('Wireframes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm delete Wireframes' }))
    expect(screen.queryByDisplayValue('Wireframes')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByDisplayValue('Wireframes')).toBeInTheDocument()
  })

  it('adds a subtask row under its parent', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Add subtask to Design' }))
    expect(screen.getByDisplayValue('New subtask')).toHaveFocus()
    await user.keyboard('Accessibility audit{Enter}')
    const saved = loadState()!.projects[0].tasks
    const design = saved.find((t) => t.name === 'Design')!
    expect(saved.find((t) => t.name === 'Accessibility audit')).toMatchObject({ parentId: design.id })
  })

  it('folds a parent to hide its subtasks', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Hide subtasks of Design' }))
    expect(screen.queryByDisplayValue('Wireframes')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show subtasks of Design' }))
    expect(screen.getByDisplayValue('Wireframes')).toBeInTheDocument()
  })

  it('links tasks by typing predecessors and pushes the successor later', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    const launchRow = screen.getByDisplayValue('Launch').closest('[role=row]') as HTMLElement
    const preds = within(launchRow).getByLabelText('Predecessors of Launch')
    // Launch (row 12) already follows Build (row 8). Add a 2-day lag after it.
    expect(preds).toHaveValue('8')
    const before = within(launchRow).getByLabelText('Start of Launch').getAttribute('value')!
    await user.clear(preds)
    await user.type(preds, '8FS+2d{Enter}')
    const after = within(screen.getByDisplayValue('Launch').closest('[role=row]') as HTMLElement).getByLabelText('Start of Launch')
    // The sample project skips weekends, so the lag is two working days.
    expect(after.getAttribute('value')).toBe(fromDay(addWorkdays(toDay(before), 2, 'weekdays')))
  })

  it('rejects a predecessor that would make a loop', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    const preds = screen.getByLabelText('Predecessors of Stakeholder interviews')
    await user.type(preds, '3{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('That link would make a loop')
  })

  it('creates a ticket in the column it was started from', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('tab', { name: 'Tickets' }))
    await user.click(screen.getByRole('button', { name: 'New ticket in Done' }))
    await user.type(screen.getByLabelText('Title'), 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Create ticket' }))
    const done = screen.getByRole('region', { name: 'Done' })
    expect(within(done).getByText('Ship it')).toBeInTheDocument()
    expect(within(done).getByText('WEB-8')).toBeInTheDocument()
  })

  it('filters tickets by text', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('tab', { name: 'Tickets' }))
    await user.type(screen.getByLabelText('Filter tickets'), 'wireframe')
    expect(screen.getAllByText(/wireframe$/i)).toHaveLength(2)
    expect(screen.queryByText('Set up analytics events')).not.toBeInTheDocument()
  })

  it('asks twice before deleting a ticket', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('tab', { name: 'Tickets' }))
    await user.click(screen.getByText('Set up analytics events'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Set up analytics events')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Click again to delete' }))
    expect(screen.queryByText('Set up analytics events')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Ticket deleted')
  })

  it('creates a new project with a prefix taken from its name', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: '+ New project' }))
    await user.type(screen.getByLabelText('Name'), 'Kitchen remodel')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Kitchen remodel' })).toBeInTheDocument()
    expect(screen.getByText('No tasks in this plan')).toBeInTheDocument()
    expect(loadState()?.projects.map((p) => p.key)).toEqual(['WEB', 'KR'])
  })

  it('restores a backup file after confirming', async () => {
    const user = renderApp()
    const backup = { v: 1, current: 'x', projects: [{ id: 'x', name: 'Restored plan', key: 'RP', tasks: [], tickets: [] }] }
    await user.upload(screen.getByTestId('restore-input'), new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }))
    expect(await screen.findByText(/It holds 1 project: Restored plan/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Replace and restore' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Restored plan' })).toBeInTheDocument()
  })

  it('rejects a file that is not a backup', async () => {
    const user = renderApp()
    await user.upload(screen.getByTestId('restore-input'), new File(['hello'], 'notes.json', { type: 'application/json' }))
    expect(await screen.findByRole('status')).toHaveTextContent('That file is not a valid backup.')
  })
})
