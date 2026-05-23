import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LibrarySidebar from './LibrarySidebar'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { ToastProvider } from '../contexts/Toast'
import type { LibraryRow } from '../types/repo'

function makeRow(owner: string, name: string): LibraryRow {
  return {
    id: `${owner}/${name}`, owner, name, active: 1,
    description: null, language: null, topics: '[]',
    stars: null, forks: null, license: null, homepage: null,
    updated_at: null, pushed_at: null, saved_at: '2026-01-01', type: null,
    banner_svg: null, discovered_at: null, discover_query: null,
    watchers: null, size: null, open_issues: null, starred_at: null,
    default_branch: null, avatar_url: null, og_image_url: null,
    banner_color: null, translated_description: null,
    translated_description_lang: null, translated_readme: null,
    translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null,
    verification_signals: null, verification_checked_at: null,
    type_bucket: null, type_sub: null, version: null,
    generated_at: '2026-01-01T00:00:00.000Z',
    enabled_components: null, enabled_tools: null, tier: 1, installed: 1,
  } as LibraryRow
}

function LocationDisplay() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

function wrap(ui: React.ReactElement, initialPath = '/library/repo/foo/bar') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MockLearningProgressProvider>
        <ToastProvider>
          <Routes>
            <Route path="*" element={<>{ui}<LocationDisplay /></>} />
          </Routes>
        </ToastProvider>
      </MockLearningProgressProvider>
    </MemoryRouter>
  )
}

const defaultProps = {
  installedRows: [],
  starredRows: [],
  unstarredRows: [],
  localProjects: [],
  archivedSet: new Set<string>(),
  selectedId: null,
  selectedLocalPath: null,
  onSelect: vi.fn(),
  onSelectLocal: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: { getAll: vi.fn().mockResolvedValue([]) },
  })
})

describe('LibrarySidebar — top bar', () => {
  it('renders a home button that navigates to /library', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    const homeBtn = screen.getByRole('button', { name: /home/i })
    expect(homeBtn).toBeInTheDocument()
    fireEvent.click(homeBtn)
    expect(screen.getByTestId('loc').textContent).toBe('/library')
  })

  it('renders a Repos/Collections toggle with Repos active by default', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    const reposBtn = screen.getByRole('button', { name: 'Repositories' })
    const collsBtn = screen.getByRole('button', { name: 'Collections' })
    expect(reposBtn).toHaveClass('active')
    expect(collsBtn).not.toHaveClass('active')
  })

  it('clicking Collections toggle activates it', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(screen.getByRole('button', { name: 'Collections' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Repositories' })).not.toHaveClass('active')
  })
})

describe('LibrarySidebar — search', () => {
  const rows = [
    makeRow('playcanvas', 'supersplat-viewer'),
    makeRow('mui', 'material-ui'),
    makeRow('vercel', 'react-video-ascii'),
  ]

  it('renders all repos when search is empty', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    expect(screen.getByText('supersplat-viewer')).toBeInTheDocument()
    expect(screen.getByText('material-ui')).toBeInTheDocument()
    expect(screen.getByText('react-video-ascii')).toBeInTheDocument()
  })

  it('filters by repo name substring', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'material' } })
    expect(screen.getByText('material-ui')).toBeInTheDocument()
    expect(screen.queryByText('supersplat-viewer')).not.toBeInTheDocument()
  })

  it('filters by owner substring', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'playc' } })
    expect(screen.getByText('supersplat-viewer')).toBeInTheDocument()
    expect(screen.queryByText('material-ui')).not.toBeInTheDocument()
  })

  it('is case-insensitive', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'MATERIAL' } })
    expect(screen.getByText('material-ui')).toBeInTheDocument()
  })
})

describe('LibrarySidebar — archived section', () => {
  const liveRow = makeRow('foo', 'live-repo')
  const archivedRow = makeRow('bar', 'archived-repo')
  const archivedSet = new Set(['bar/archived-repo'])

  it('hides archived repos from main list', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    expect(screen.getByText('live-repo')).toBeInTheDocument()
    expect(screen.queryByText('archived-repo')).not.toBeInTheDocument()
  })

  it('shows a collapsed Archived (N) section when there are archived items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    const header = screen.getByRole('button', { name: /archived \(1\)/i })
    expect(header).toBeInTheDocument()
    expect(screen.queryByText('archived-repo')).not.toBeInTheDocument()
  })

  it('expands Archived section on click to reveal items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    fireEvent.click(screen.getByRole('button', { name: /archived \(1\)/i }))
    expect(screen.getByText('archived-repo')).toBeInTheDocument()
  })

  it('hides Archived section entirely when no archived items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow]} archivedSet={new Set()} />)
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument()
  })
})
