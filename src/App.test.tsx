import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
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
    expect(screen.getByRole('button', { name: /Wireframes/ })).toBeInTheDocument()
    expect(screen.getByText('Open tickets').previousElementSibling).toHaveTextContent('6')
  })

  it('adds a task and saves it to the browser', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    await user.type(screen.getByLabelText('Task name'), 'Write launch email')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write launch email/ })).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('Write launch email')
  })

  it('refuses a task that ends before it starts', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: '+ Task' }))
    await user.type(screen.getByLabelText('Task name'), 'Backwards')
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-10' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-01' } })
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The end date is before the start date')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
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
