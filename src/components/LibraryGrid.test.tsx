import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import LibraryGrid from './LibraryGrid'
import type { LibraryRow } from '../types/repo'
import { DEFAULT_LAYOUT_PREFS } from './LayoutDropdown'

const baseRow: LibraryRow = {
  id: '', owner: '', name: '', language: 'TypeScript', description: null,
  topics: '[]', stars: null, forks: null, license: null, homepage: null,
  updated_at: null, pushed_at: null, saved_at: null, type: 'skill',
  banner_svg: null, discovered_at: null, discover_query: null, watchers: null, size: null,
  open_issues: null, starred_at: null, default_branch: null, avatar_url: null,
  og_image_url: null, banner_color: null, translated_description: null,
  translated_description_lang: null, translated_readme: null, translated_readme_lang: null,
  detected_language: null, verification_score: null, verification_tier: null,
  verification_signals: null, verification_checked_at: null,
  type_bucket: null, type_sub: null,
  active: 1, version: null, generated_at: null, enabled_components: null, enabled_tools: null, tier: 1, installed: 1,
  unstarred_at: null, is_forked: null, update_available: null,
  update_checked_at: null, upstream_version: null, stored_version: null,
}

const rows: LibraryRow[] = [
  { ...baseRow, id: '1', owner: 'a', name: 'alpha', type_bucket: 'frameworks' },
  { ...baseRow, id: '2', owner: 'b', name: 'beta',  type_bucket: 'frameworks' },
  { ...baseRow, id: '3', owner: 'c', name: 'gamma', type_bucket: 'dev-tools' },
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
    renderGrid({ selectedId: '1' })
    const alphaRow = screen.getByText('alpha')
    expect(alphaRow).toBeInTheDocument()
  })
})
