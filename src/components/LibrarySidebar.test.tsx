import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LibrarySidebar from './LibrarySidebar'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { ToastProvider } from '../contexts/Toast'
import type { LibrarySavedRepo } from '../types/repo'
import { fixtureLibrarySavedRepo } from '../test-utils/repoFixtures'

function makeRow(owner: string, name: string): LibrarySavedRepo {
  return fixtureLibrarySavedRepo({
    hostNativeId: `${owner}/${name}`,
    fullName: `${owner}/${name}`,
    owner,
    name,
    savedAt: '2026-01-01',
    generatedAt: '2026-01-01T00:00:00.000Z',
  })
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
  collSelectedId: null,
  onSelect: vi.fn(),
  onSelectLocal: vi.fn(),
  onSelectColl: vi.fn(),
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

describe('LibrarySidebar — recently unstarred section', () => {
  const unstarredRow: LibrarySavedRepo = {
    ...makeRow('zed', 'unstarred-repo'),
    starredAt: null,
    unstarredAt: '2026-05-22T00:00:00Z',
  }

  it('shows a collapsed Recently unstarred (N) section when there are items', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[unstarredRow]} />)
    expect(screen.getByRole('button', { name: /recently unstarred \(1\)/i })).toBeInTheDocument()
    expect(screen.queryByText('unstarred-repo')).not.toBeInTheDocument()
  })

  it('expands to reveal items on click', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[unstarredRow]} />)
    fireEvent.click(screen.getByRole('button', { name: /recently unstarred \(1\)/i }))
    expect(screen.getByText('unstarred-repo')).toBeInTheDocument()
  })

  it('hides Recently unstarred section entirely when empty', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[]} />)
    expect(screen.queryByRole('button', { name: /recently unstarred/i })).not.toBeInTheDocument()
  })
})

describe('LibrarySidebar — URL-driven mode', () => {
  it('starts in collections mode when URL is /library/collection/:id', () => {
    wrap(<LibrarySidebar {...defaultProps} />, '/library/collection/abc')
    expect(screen.getByRole('button', { name: 'Collections' })).toHaveClass('active')
  })

  it('starts in repos mode when URL is /library/repo/:owner/:name', () => {
    wrap(<LibrarySidebar {...defaultProps} />, '/library/repo/foo/bar')
    expect(screen.getByRole('button', { name: 'Repositories' })).toHaveClass('active')
  })
})

describe('LibrarySidebar — collections mode rendering', () => {
  it('renders the collections list when mode=collections', async () => {
    vi.stubGlobal('api', {
      collection: {
        getAll: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'My Collection', description: null, owner: 'me',
            active: 1, created_at: '2026-01-01', color_start: '#000', color_end: '#fff',
            repo_count: 0, saved_count: 0 },
        ]),
      },
    })
    wrap(<LibrarySidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(await screen.findByText('My Collection')).toBeInTheDocument()
  })

  it('changes search placeholder when in collections mode', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(screen.getByPlaceholderText('Search collections')).toBeInTheDocument()
  })
})
