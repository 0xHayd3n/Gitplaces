// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AgentsSidebar from './AgentsSidebar'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
  { id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
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
      updateFolder: vi.fn().mockResolvedValue({}),
      renameFolder: vi.fn().mockResolvedValue({}),
      deleteFolder: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn().mockResolvedValue({}),
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
    const nameNodes = document.querySelectorAll('.agents-sidebar-folder-name')
    const labels = Array.from(nameNodes).map(n => n.textContent ?? '')
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

  it('renders a star indicator next to the handle for pinned agents', async () => {
    const pinnedAgents: AgentRow[] = [
      { ...agents[0], id: 'pa1', name: 'PinnedAgent', handle: 'pinned-agent',
        pinned: 1, pinned_at: '2026-05-25T00:00:00Z' },
      { ...agents[0], id: 'pa2', name: 'Unpinned',    handle: 'unpinned',
        pinned: 0, pinned_at: null },
    ]
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: pinnedAgents })
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByRole('button', { name: /Writing/ }))
    const pinnedRow = (await screen.findByText('PinnedAgent')).closest('.library-sidebar-item') as HTMLElement
    expect(pinnedRow.querySelector('.agents-sidebar-row-pin')).toBeTruthy()
    const unpinnedRow = screen.getByText('Unpinned').closest('.library-sidebar-item') as HTMLElement
    expect(unpinnedRow.querySelector('.agents-sidebar-row-pin')).toBeNull()
  })

  it('shows a kebab button next to each named folder (not Unfiled)', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    expect(screen.getByTestId('folder-kebab-f1')).toBeTruthy()
    expect(screen.getByTestId('folder-kebab-f2')).toBeTruthy()
    expect(screen.queryByTestId('folder-kebab-__unfiled__')).toBeNull()
  })

  it('clicking the kebab opens the FolderKebabMenu', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByTestId('folder-kebab-f1'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
  })

  it('double-clicking a folder name shows an inline rename input', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    const nameSpan = screen.getByTestId('folder-name-f1')
    fireEvent.doubleClick(nameSpan)
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('Writing')
  })

  it('Enter on the rename input calls updateFolder and exits edit mode', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.doubleClick(screen.getByTestId('folder-name-f1'))
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Drafts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { name: 'Drafts' })
    })
    expect(screen.queryByTestId('folder-rename-f1')).toBeNull()
  })

  it('Escape on the rename input cancels without calling updateFolder', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.doubleClick(screen.getByTestId('folder-name-f1'))
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Drafts' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((window as any).api.agents.updateFolder).not.toHaveBeenCalled()
    expect(screen.queryByTestId('folder-rename-f1')).toBeNull()
  })

  it('renders a default folder icon when emoji is null', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    const avatar = screen.getByTestId('folder-avatar-f1')
    expect(avatar.querySelector('svg')).toBeTruthy()
  })

  it('renders the emoji when folder.emoji is set', async () => {
    const foldersWithEmoji = [
      { ...folders[0], emoji: '📝' },
      folders[1],
    ]
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: foldersWithEmoji, agents })
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    expect(screen.getByTestId('folder-avatar-f1').textContent).toContain('📝')
  })
})
