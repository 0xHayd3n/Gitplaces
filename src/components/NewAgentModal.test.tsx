// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NewAgentModal from './NewAgentModal'
import type { AgentFolderRow, AgentRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]

const onClose = vi.fn()
const onCreated = vi.fn()

beforeEach(() => {
  onClose.mockReset()
  onCreated.mockReset()
  ;(window as any).api = {
    agents: {
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

function setup() {
  return render(
    <NewAgentModal folders={folders} onClose={onClose} onCreated={onCreated} />,
  )
}

describe('NewAgentModal', () => {
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

  it('disables Create until body is non-empty', () => {
    setup()
    const create = screen.getByRole('button', { name: /Create/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'x' } })
    expect(create.disabled).toBe(false)
  })

  it('on Create: calls api.agents.create with current values and fires onCreated', async () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# Title\nhello' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/ }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'))
    expect(window.api.agents.create).toHaveBeenCalledWith({
      name: 'Title', body: '# Title\nhello', folderId: null,
    })
  })

  it('inline folder creation: typing a name and pressing Enter creates and selects it', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /\+ New folder/ }))
    const folderInput = screen.getByPlaceholderText(/Folder name/i) as HTMLInputElement
    fireEvent.change(folderInput, { target: { value: 'Personas' } })
    fireEvent.keyDown(folderInput, { key: 'Enter' })
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('Personas'))
  })

  it('Cancel calls onClose', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape calls onClose', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
