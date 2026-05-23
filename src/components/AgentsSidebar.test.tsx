// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AgentsSidebar from './AgentsSidebar'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
  { id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]
const agents: AgentRow[] = [
  { id: 'a1', name: 'Copy editor',   handle: 'copy-editor',   body: '# Copy editor\nbody',
    folder_id: 'f1',
    color_start: '#10b981', color_end: '#34d399', emoji: '✏️',
    pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
    created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a2', name: 'Lit reviewer',  handle: 'lit-reviewer',  body: '# Lit reviewer\nbody',
    folder_id: 'f2',
    color_start: '#6366f1', color_end: null, emoji: null,
    pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
    created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a3', name: 'Untagged note', handle: 'untagged-note', body: '# Untagged\nbody',
    folder_id: null,
    color_start: '#ec4899', color_end: null, emoji: null,
    pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
    created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
      createFolder: vi.fn(),
      create: vi.fn().mockImplementation(async (input: any) => ({
        id: 'new-id',
        name: input.name,
        body: input.body,
        folder_id: input.folderId,
        created_at: '2026-05-23T00:00:00Z',
        updated_at: '2026-05-23T00:00:00Z',
      })),
    },
  }
})

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderSidebar(searchTerm = '') {
  return render(
    <MemoryRouter>
      <AgentsSidebar searchTerm={searchTerm} />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

describe('AgentsSidebar', () => {
  it('renders folder section headers sorted by name', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText(/Research/)).toBeTruthy())
    const sections = screen.getAllByRole('button', { name: /Research|Writing|Unfiled/ })
    const labels = sections.map(b => b.textContent)
    // Unfiled first (synthetic), then alphabetical: Research, Writing
    expect(labels[0]).toMatch(/Unfiled/)
    expect(labels[1]).toMatch(/Research/)
    expect(labels[2]).toMatch(/Writing/)
  })

  it('lists agents under their folder when expanded', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByRole('button', { name: /Writing/ }))
    expect(screen.getByText('Copy editor')).toBeTruthy()
  })

  it('hides the Unfiled section when no unfiled agents exist', async () => {
    ;(window as any).api.agents.getAll.mockResolvedValueOnce({
      folders,
      agents: agents.filter(a => a.folder_id !== null),
    })
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    expect(screen.queryByText(/Unfiled/)).toBeNull()
  })

  it('filters by searchTerm against name + body', async () => {
    renderSidebar('lit')
    await waitFor(() => screen.getByText(/Research/))
    fireEvent.click(screen.getByRole('button', { name: /Research/ }))
    expect(screen.getByText('Lit reviewer')).toBeTruthy()
    expect(screen.queryByText('Copy editor')).toBeNull()
  })

  it('"+ New agent" navigates to /library/agent/new', async () => {
    renderSidebar()
    await waitFor(() => screen.getByRole('button', { name: /\+ New agent/ }))
    fireEvent.click(screen.getByRole('button', { name: /\+ New agent/ }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/library/agent/new'),
    )
  })

  it('renders a color swatch per agent row', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByRole('button', { name: /Writing/ }))
    const swatch = await screen.findByTestId('sidebar-swatch-a1')
    expect(swatch).toBeTruthy()
    // a1 has both colors set → gradient background
    expect(swatch.style.background).toMatch(/linear-gradient/)
  })

  it('renders @handle suffix per agent row', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByRole('button', { name: /Writing/ }))
    expect(await screen.findByText('@copy-editor')).toBeTruthy()
  })

  it('renders a solid swatch (no gradient) when color_end is null', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Research/))
    fireEvent.click(screen.getByRole('button', { name: /Research/ }))
    const swatch = await screen.findByTestId('sidebar-swatch-a2')
    // a2 has color_end: null → solid background
    expect(swatch.style.background).not.toMatch(/linear-gradient/)
    expect(swatch.textContent?.trim()).toBe('')  // a2 emoji is null
  })

  it('hides named folders that have no matching agents during search', async () => {
    renderSidebar('lit')
    await waitFor(() => screen.getByText(/Research/))
    // Writing folder contains only "Copy editor" which doesn't match "lit"
    expect(screen.queryByText(/Writing/)).toBeNull()
  })
})
