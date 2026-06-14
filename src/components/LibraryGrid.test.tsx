import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import LibraryGrid from './LibraryGrid'
import type { LibrarySavedRepo } from '../types/repo'
import { DEFAULT_LAYOUT_PREFS } from './LayoutDropdown'
import { fixtureLibrarySavedRepo } from '../test-utils/repoFixtures'

const rows: LibrarySavedRepo[] = [
  fixtureLibrarySavedRepo({
    hostNativeId: '1',
    fullName: 'a/alpha',
    owner: 'a',
    name: 'alpha',
    language: 'TypeScript',
    type: 'skill',
    typeBucket: 'frameworks',
  }),
  fixtureLibrarySavedRepo({
    hostNativeId: '2',
    fullName: 'b/beta',
    owner: 'b',
    name: 'beta',
    language: 'TypeScript',
    type: 'skill',
    typeBucket: 'frameworks',
  }),
  fixtureLibrarySavedRepo({
    hostNativeId: '3',
    fullName: 'c/gamma',
    owner: 'c',
    name: 'gamma',
    language: 'TypeScript',
    type: 'skill',
    typeBucket: 'dev-tools',
  }),
]

function renderGrid(props: Partial<React.ComponentProps<typeof LibraryGrid>> = {}) {
  const defaults = {
    rows,
    selectedId: null,
    layoutPrefs: DEFAULT_LAYOUT_PREFS,
    subSkillIds: new Set<string>(),
    onSelect: () => {},
  }
  return render(
    <MemoryRouter>
      <ProfileOverlayProvider>
        <LibraryGrid {...defaults} {...props} />
      </ProfileOverlayProvider>
    </MemoryRouter>
  )
}

describe('LibraryGrid', () => {
  it('renders all rows in flat mode', () => {
    renderGrid()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()
  })

  it('renders no section headers', () => {
    renderGrid()
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })

  it('respects row filtering', () => {
    renderGrid({ rows: [rows[0], rows[1]] })  // only alpha and beta
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.queryByText('gamma')).not.toBeInTheDocument()
  })

  it('renders selected row with correct class', () => {
    renderGrid({ selectedId: 'a/alpha' })
    const alphaRow = screen.getByText('alpha')
    expect(alphaRow).toBeInTheDocument()
  })
})
