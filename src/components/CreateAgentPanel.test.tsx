// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateAgentPanel from './CreateAgentPanel'
import type { AgentFolderRow, AgentRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Engineering', color_start: null, color_end: null, description: null, emoji: null, created_at: 't' },
]

function makeApi() {
  return {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [] }),
      create: vi.fn().mockImplementation(async (input: any): Promise<AgentRow> => ({
        id: 'new-id',
        name: input.name,
        handle: input.handle,
        folder_id: input.folderId,
        color_start: input.colorStart,
        color_end: input.colorEnd,
        emoji: input.emoji,
        pinned: 0,
        pinned_at: null,
        last_used_at: null,
        presets_json: '[]',
        created_at: 't',
        updated_at: 't',
        description: '',
        origin_plugin: null,
        origin_path: null,
        origin_version: null,
        origin_imported_at: null,
        tools: null,
        model: 'inherit',
        is_subagent: 0,
        is_slash_command: 0,
        argument_hint: null,
        synced_subagent_at: null,
        synced_slash_command_at: null,
      })),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
})

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/new']}>
      <Routes>
        <Route path="/library/agent/new" element={<CreateAgentPanel />} />
        <Route path="/library/agent/:id" element={<div>opened</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CreateAgentPanel', () => {
  it('auto-fills handle from name', async () => {
    setup()
    const name = screen.getByLabelText(/^name$/i) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Code Investigator' } })
    const handle = screen.getByLabelText(/^handle$/i) as HTMLInputElement
    expect(handle.value).toBe('@code-investigator')
  })

  it('lets the user override the handle after auto-fill', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Foo' } })
    const handle = screen.getByLabelText(/^handle$/i) as HTMLInputElement
    expect(handle.value).toBe('@foo')
    fireEvent.change(handle, { target: { value: '@override' } })
    expect(handle.value).toBe('@override')
    // Subsequent name changes do NOT touch a user-edited handle
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Bar' } })
    expect(handle.value).toBe('@override')
  })

  it('disables Create button when name or handle is empty', () => {
    setup()
    const btn = screen.getByRole('button', { name: /create agent/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('submits with the resolved customisation values and navigates to the new agent', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: /create agent/i }))
    await waitFor(() => screen.getByText('opened'))
    const api = (window as any).api as ReturnType<typeof makeApi>
    const call = api.agents.create.mock.calls[0][0]
    expect(call.name).toBe('Reviewer')
    expect(call.handle).toBe('reviewer')
    expect(call.colorStart).toMatch(/^#[0-9a-f]{6}$/)
    expect(call.colorEnd).toBeNull()  // solid by default
  })
})
