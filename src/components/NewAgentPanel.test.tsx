// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import NewAgentPanel from './NewAgentPanel'
import type { AgentFolderRow, AgentRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [] }),
      create: vi.fn().mockImplementation(async (input: any) => ({
        id: 'new-id',
        name: input.name,
        body: input.body,
        folder_id: input.folderId,
        created_at: '2026-05-23T00:00:00Z',
        updated_at: '2026-05-23T00:00:00Z',
      } satisfies AgentRow)),
      createFolder: vi.fn().mockImplementation(async (name: string) => ({
        id: 'new-folder', name, color_start: null, color_end: null, description: null,
        created_at: '2026-05-23T00:00:00Z',
      } satisfies AgentFolderRow)),
    },
  }
})

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/new']}>
      <Routes>
        <Route path="/library/agent/new" element={<NewAgentPanel />} />
        <Route path="/library/agent/:id" element={<LocationDisplay />} />
        <Route path="/library" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NewAgentPanel', () => {
  it('autofocuses the body textarea', () => {
    setup()
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('auto-derives name from first H1', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# Hello world\nbody text' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('Hello world')
  })

  it('falls back to first non-empty line when no H1 present', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '\n\nsome line\nmore' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('some line')
  })

  it('user-edited name is not overwritten by subsequent body edits', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# First' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'My override' } })
    fireEvent.change(ta, { target: { value: '# Second' } })
    expect(nameInput.value).toBe('My override')
  })

  it('clearing the name field restores auto-derivation from body', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# First' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('First')
    fireEvent.change(nameInput, { target: { value: 'Override' } })
    expect(nameInput.value).toBe('Override')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.change(ta, { target: { value: '# Restored' } })
    expect(nameInput.value).toBe('Restored')
  })

  it('disables Create until body is non-empty', () => {
    setup()
    const create = screen.getByRole('button', { name: /Create/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'x' } })
    expect(create.disabled).toBe(false)
  })

  it('on Create: calls api.agents.create and navigates to /library/agent/:newId', async () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# Title\nhello' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/ }))
    await waitFor(() =>
      expect(window.api.agents.create).toHaveBeenCalledWith({
        name: 'Title', body: '# Title\nhello', folderId: null,
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/library/agent/new-id'),
    )
  })

  it('Back button navigates to /library', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByTestId('location').textContent).toBe('/library')
  })

  it('inline folder creation via "+ New folder" menu item', async () => {
    setup()
    await waitFor(() => screen.getByLabelText(/Folder/))
    fireEvent.click(screen.getByLabelText(/Folder/))
    fireEvent.click(screen.getByRole('menuitem', { name: /\+ New folder/ }))
    const folderInput = screen.getByPlaceholderText(/Folder name/i) as HTMLInputElement
    fireEvent.change(folderInput, { target: { value: 'Personas' } })
    fireEvent.keyDown(folderInput, { key: 'Enter' })
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('Personas'))
  })
})
