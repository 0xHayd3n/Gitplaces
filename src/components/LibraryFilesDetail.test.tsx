import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LibraryFilesDetail from './LibraryFilesDetail'
import type { LibrarySavedRepo } from '../types/repo'
import { fixtureLibrarySavedRepo } from '../test-utils/repoFixtures'

// FilesTab makes GitHub API calls — mock the whole module
vi.mock('./FilesTab', () => ({
  default: () => <div data-testid="files-tab" />,
}))

const baseRow: LibrarySavedRepo = fixtureLibrarySavedRepo({
  hostNativeId: 'r1',
  fullName: 'acme/my-skill',
  owner: 'acme',
  name: 'my-skill',
  language: 'TypeScript',
  description: 'A skill',
  stars: 1200,
  license: 'MIT',
  defaultBranch: 'main',
  savedAt: '2026-01-01',
  type: 'skill',
  typeBucket: 'tools',
  version: 'v2.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
})

function renderDetail(overrides: Partial<LibrarySavedRepo> = {}, props = {}) {
  const row = { ...baseRow, ...overrides }
  return render(
    <MemoryRouter>
      <LibraryFilesDetail
        row={row}
        onToggleActive={vi.fn()}
        onInstalled={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('api', {
    skill: {
      generate: vi.fn().mockResolvedValue({ content: 'c', version: 'v1', generated_at: null }),
    },
  })
})

describe('LibraryFilesDetail', () => {
  it('renders repo name and owner in compact header', () => {
    renderDetail()
    expect(screen.getByText('my-skill')).toBeInTheDocument()
    expect(screen.getByText(/by acme/)).toBeInTheDocument()
  })

  it('renders star count when present', () => {
    renderDetail()
    expect(screen.getByText(/1,200/)).toBeInTheDocument()
  })

  it('renders FilesTab', () => {
    renderDetail()
    expect(screen.getByTestId('files-tab')).toBeInTheDocument()
  })

  it('shows active toggle when installed', () => {
    renderDetail({ installed: 1, active: 1 })
    expect(screen.getByRole('switch', { name: /toggle skill active/i })).toBeInTheDocument()
  })

  it('calls onToggleActive when toggle clicked', async () => {
    const onToggleActive = vi.fn()
    render(
      <MemoryRouter>
        <LibraryFilesDetail
          row={baseRow}
          onToggleActive={onToggleActive}
          onInstalled={vi.fn()}
        />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('switch', { name: /toggle skill active/i }))
    expect(onToggleActive).toHaveBeenCalledWith(false)
  })

  it('shows Install button when not installed', () => {
    renderDetail({ installed: 0 })
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /toggle skill active/i })).not.toBeInTheDocument()
  })

  it('calls onInstalled after successful install', async () => {
    const onInstalled = vi.fn()
    render(
      <MemoryRouter>
        <LibraryFilesDetail
          row={{ ...baseRow, installed: 0 }}
          onToggleActive={vi.fn()}
          onInstalled={onInstalled}
        />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith({ content: 'c', version: 'v1', generated_at: null }))
  })

  it('shows error message on failed install', async () => {
    ;(window.api.skill.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('net'))
    renderDetail({ installed: 0 })
    await userEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => expect(screen.getByText(/install failed/i)).toBeInTheDocument())
  })
})
