// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentsSidebar from './AgentsSidebar'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
  { id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]
const agents: AgentRow[] = [
  { id: 'a1', name: 'Copy editor',   body: '# Copy editor\nbody',   folder_id: 'f1', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a2', name: 'Lit reviewer',  body: '# Lit reviewer\nbody',  folder_id: 'f2', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a3', name: 'Untagged note', body: '# Untagged\nbody',      folder_id: null, created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
      createFolder: vi.fn(),
      create: vi.fn(),
    },
  }
})

function renderSidebar(searchTerm = '') {
  return render(
    <MemoryRouter>
      <AgentsSidebar searchTerm={searchTerm} />
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

  it('opens the create modal when "+ New agent" is clicked', async () => {
    renderSidebar()
    await waitFor(() => screen.getByRole('button', { name: /\+ New agent/ }))
    fireEvent.click(screen.getByRole('button', { name: /\+ New agent/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('hides named folders that have no matching agents during search', async () => {
    renderSidebar('lit')
    await waitFor(() => screen.getByText(/Research/))
    // Writing folder contains only "Copy editor" which doesn't match "lit"
    expect(screen.queryByText(/Writing/)).toBeNull()
  })
})
