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
