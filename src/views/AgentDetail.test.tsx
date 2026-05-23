// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import AgentDetail from './AgentDetail'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]
const baseAgent: AgentRow = {
  id: 'a1', name: 'Copy editor', body: '# Copy editor\n\nHello body.',
  folder_id: 'f1', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z',
}

function makeApi() {
  return {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [baseAgent] }),
      update: vi.fn().mockImplementation(async (_id: string, patch: any) => ({
        ...baseAgent, ...patch, updated_at: '2026-05-23T00:00:05Z',
      })),
      delete: vi.fn(),
      duplicate: vi.fn(),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/a1']}>
      <Routes>
        <Route path="/library/agent/:id" element={<AgentDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Wait for the agent header (h2) to appear — the body markdown also renders "Copy editor" as h1
async function waitForLoaded() {
  await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
}

describe('AgentDetail', () => {
  it('renders the agent name and rendered body', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByText(/Hello body/)).toBeTruthy()
  })

  it('toggles to edit mode and shows the textarea', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const ta = screen.getByRole('textbox', { name: /Body/ }) as HTMLTextAreaElement
    expect(ta.value).toContain('Copy editor')
  })

  it('debounced auto-save calls api.agents.update 1500ms after last keystroke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setup()
    // Flush the initial async load (Promise microtasks are not faked)
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve))
    })
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve))
    })
    // The name h2 should be visible now
    expect(screen.getByRole('heading', { level: 2, name: 'Copy editor' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const ta = screen.getByRole('textbox', { name: /Body/ })
    fireEvent.change(ta, { target: { value: 'changed body' } })
    expect(window.api.agents.update).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(window.api.agents.update).toHaveBeenCalledWith('a1', { body: 'changed body' })
  })

  it('Copy markdown writes the body to clipboard', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /Copy markdown/ }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(baseAgent.body),
    )
  })

  it('changing the folder pill calls api.agents.update with new folderId', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /Folder/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Unfiled/ }))
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { folderId: null }),
    )
  })

  it('resets edit mode when navigating between agents', async () => {
    const otherAgent: AgentRow = {
      id: 'a2', name: 'Other agent', body: '# Other\n\nother body.',
      folder_id: null, created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z',
    }
    ;(window as any).api.agents.getAll = vi.fn()
      .mockResolvedValueOnce({ folders, agents: [baseAgent] })
      .mockResolvedValueOnce({ folders, agents: [otherAgent] })

    // A small wrapper that exposes a navigate button so we can trigger real in-router navigation
    function NavButton() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/library/agent/a2')}>Go to a2</button>
    }

    render(
      <MemoryRouter initialEntries={['/library/agent/a1']}>
        <NavButton />
        <Routes>
          <Route path="/library/agent/:id" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.getByRole('textbox', { name: /Body/ })).toBeTruthy()

    // Navigate to /library/agent/a2 via the real router
    fireEvent.click(screen.getByRole('button', { name: /Go to a2/ }))
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Other agent' }))
    // After navigation, the body textarea should be absent (back in preview mode)
    expect(screen.queryByRole('textbox', { name: /Body/ })).toBeNull()
  })

  it('Copy markdown uses bodyDraft (live edits) when in edit mode', async () => {
    setup()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const ta = screen.getByRole('textbox', { name: /Body/ })
    fireEvent.change(ta, { target: { value: 'live unsaved content' } })
    fireEvent.click(screen.getByRole('button', { name: /Copy markdown/ }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('live unsaved content'),
    )
  })

  it('shows nameDraft in header after inline name edit even before save resolves', async () => {
    setup()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.click(screen.getByRole('heading', { level: 2 }))
    const nameInput = screen.getByDisplayValue('Copy editor') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Renamed agent' } })
    fireEvent.blur(nameInput)
    // After blur, header should reflect the new name (nameDraft), not stale agent.name
    expect(screen.getByRole('heading', { level: 2, name: 'Renamed agent' })).toBeTruthy()
  })
})
