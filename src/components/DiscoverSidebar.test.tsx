import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import DiscoverSidebar, { FilterPanel } from './DiscoverSidebar'

const baseProps = {
  selectedSubtypes: [],
  onSelectedSubtypesChange: () => {},
  filters: {},
  selectedLanguages: [],
  activeVerification: new Set<'verified' | 'likely'>(),
  onFilterChange: () => {},
  onSelectedLanguagesChange: () => {},
  onVerificationToggle: () => {},
  activePanel: null as 'buckets' | 'filters' | 'advanced' | null,
  onActivePanelChange: () => {},
  showLanding: false,
  onHomeClick: () => {},
  onBrowseClick: () => {},
}

describe('DiscoverSidebar', () => {
  it('accepts a mode prop without crashing', () => {
    expect(() => render(<DiscoverSidebar {...baseProps} mode="library" />)).not.toThrow()
  })

  it('defaults to discover mode when mode is omitted', () => {
    expect(() => render(<DiscoverSidebar {...baseProps} />)).not.toThrow()
  })
})

describe('DiscoverSidebar — library mode', () => {
  it('hides Stars, Activity, License in library mode advanced panel', () => {
    render(<DiscoverSidebar {...baseProps} mode="library" activePanel="advanced" />)
    expect(screen.queryByText('Stars')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
    expect(screen.queryByText('License')).not.toBeInTheDocument()
    expect(screen.getByText('Verification')).toBeInTheDocument()
  })

  it('shows Stars, Activity, License in discover mode advanced panel', () => {
    render(<DiscoverSidebar {...baseProps} activePanel="advanced" />)
    expect(screen.getByText('Stars')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('License')).toBeInTheDocument()
  })
})

describe('DiscoverSidebar — Skill Status panel', () => {
  it('renders Skill Status section in library mode', () => {
    render(
      <DiscoverSidebar
        {...baseProps}
        mode="library"
        activePanel="advanced"
        skillStatus={{ enhancedOnly: false, componentsOnly: false }}
        onSkillStatusChange={() => {}}
      />
    )
    expect(screen.getByText('Skill Status')).toBeInTheDocument()
    expect(screen.getByText(/Enhanced.*Tier 2/)).toBeInTheDocument()
    expect(screen.getByText(/Components available/)).toBeInTheDocument()
  })

  it('omits Skill Status section in discover mode', () => {
    render(<DiscoverSidebar {...baseProps} activePanel="advanced" />)
    expect(screen.queryByText('Skill Status')).not.toBeInTheDocument()
  })

  it('invokes onSkillStatusChange when Enhanced toggled', async () => {
    const user = userEvent.setup()
    const onSkillStatusChange = vi.fn()
    render(
      <DiscoverSidebar
        {...baseProps}
        mode="library"
        activePanel="advanced"
        skillStatus={{ enhancedOnly: false, componentsOnly: false }}
        onSkillStatusChange={onSkillStatusChange}
      />
    )
    await user.click(screen.getByText(/Enhanced.*Tier 2/))
    expect(onSkillStatusChange).toHaveBeenCalledWith({ enhancedOnly: true, componentsOnly: false })
  })
})

describe('DiscoverSidebar — itemCounts', () => {
  it('annotates bucket labels with counts and omits empty buckets', () => {
    const itemCounts = {
      byBucket:   new Map([['frameworks', 3], ['dev-tools', 1]]),
      byLanguage: new Map<string, number>(),
    }
    render(
      <DiscoverSidebar
        {...baseProps}
        mode="library"
        activePanel="filters"
        itemCounts={itemCounts}
      />
    )
    // Switch to Type tab inside the filter panel
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    expect(screen.getByText(/Frameworks \(3\)/)).toBeInTheDocument()
    expect(screen.getByText(/Dev Tools \(1\)/)).toBeInTheDocument()
    // ai-ml was not in the map — its bucket-group header should be absent
    expect(screen.queryByText(/AI & ML/)).not.toBeInTheDocument()
  })
})

const filterPanelProps = {
  selectedLanguages: [],
  onSelectedLanguagesChange: () => {},
  selectedSubtypes: [],
  onSelectedSubtypesChange: () => {},
}

describe('FilterPanel — grouping toggle', () => {
  beforeEach(() => localStorage.clear())

  it('renders Use Case and Platform buttons', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Use Case' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Platform' })).toBeInTheDocument()
  })

  it('defaults to Use Case mode (domain)', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Use Case' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Platform' })).not.toHaveClass('active')
  })

  it('switches to Platform mode (ecosystem) on click', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: 'Platform' }))
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Use Case' })).not.toHaveClass('active')
  })

  it('persists mode to localStorage', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: 'Platform' }))
    expect(JSON.parse(localStorage.getItem('discover:languageGrouping')!)).toBe('ecosystem')
  })

  it('reads mode from localStorage on mount', () => {
    localStorage.setItem('discover:languageGrouping', JSON.stringify('ecosystem'))
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveClass('active')
  })
})

describe('FilterPanel — language master-detail (default view)', () => {
  beforeEach(() => localStorage.clear())

  it('shows tiles + Popular languages by default (Popular auto-selected)', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // Tile column visible
    expect(screen.getByRole('button', { name: /Popular/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Systems/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Web/ })).toBeInTheDocument()
    // Popular's languages visible in the content column by default
    expect(screen.getByRole('button', { name: /^JavaScript$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Python$/ })).toBeInTheDocument()
  })

  it('shows tile counts that match the catalogue', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: /Systems.*\(15\)/ })).toBeInTheDocument()
  })

  it('marks Popular tile as active by default', () => {
    render(<FilterPanel {...filterPanelProps} />)
    const popularTile = screen.getByRole('button', { name: /Popular/ })
    expect(popularTile.classList.contains('active')).toBe(true)
  })
})

describe('FilterPanel — switching active category in master-detail', () => {
  beforeEach(() => localStorage.clear())

  it('clicking a category tile updates the content column to show that category\'s languages', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Default content is Popular — JavaScript visible, Zig not (Zig is in Systems but not in Popular)
    expect(screen.getByRole('button', { name: /^JavaScript$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Zig$/ })).not.toBeInTheDocument()
    // Click Systems tile
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    // Now Systems-only languages visible
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Crystal$/ })).toBeInTheDocument()
    // Tiles are still visible (master-detail)
    expect(screen.getByRole('button', { name: /^Web \(/ })).toBeInTheDocument()
  })

  it('marks the clicked tile as active and unmarks the previous one', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: /Popular/ }).classList.contains('active')).toBe(true)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /Popular/ }).classList.contains('active')).toBe(false)
    expect(screen.getByRole('button', { name: /^Systems/ }).classList.contains('active')).toBe(true)
  })

  it('keeps the grouping toggle visible across tile selections', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Use Case' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: 'Use Case' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Platform' })).toBeInTheDocument()
  })
})

describe('FilterPanel — language search results', () => {
  beforeEach(() => localStorage.clear())

  it('shows a flat list of matching languages when search has text', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    expect(screen.getByRole('button', { name: /^Rust/ })).toBeInTheDocument()
    // Tile column is hidden during search
    expect(screen.queryByRole('button', { name: /^Systems \(/ })).not.toBeInTheDocument()
    // Grouping toggle is hidden during search
    expect(screen.queryByRole('button', { name: 'Use Case' })).not.toBeInTheDocument()
  })

  it('ranks name-starts-with matches before name-contains matches', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Query "el" — prefix matches: Elixir, Elm, EJS. Contains matches: Haskell.
    await user.type(screen.getByPlaceholderText('Search languages...'), 'el')
    const langButtons = screen.getAllByRole('button').filter(b => {
      const t = b.textContent || ''
      return /^(Elixir|Elm|EJS|Haskell)\b/.test(t)
    })
    const prefixIdx = langButtons.findIndex(b => /^Elixir\b/.test(b.textContent || ''))
    const containsIdx = langButtons.findIndex(b => /^Haskell\b/.test(b.textContent || ''))
    expect(prefixIdx).toBeGreaterThanOrEqual(0)
    expect(containsIdx).toBeGreaterThanOrEqual(0)
    expect(prefixIdx, 'Elixir (prefix match) should rank before Haskell (contains match)').toBeLessThan(containsIdx)
  })

  it('shows category caption (· in <Category>) on each row', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    expect(screen.getByText(/· Systems/)).toBeInTheDocument()
  })

  it('shows empty state when no language matches', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'zzznosuchlang')
    expect(screen.getByText(/No languages match/)).toBeInTheDocument()
  })

  it('preserves the active tile selection across a search-and-clear cycle', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Switch from default Popular to Systems (Zig is Systems-only, not in Popular)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
    // Type a search — search overrides the master-detail
    await user.type(screen.getByPlaceholderText('Search languages...'), 'python')
    expect(screen.getByRole('button', { name: /^Python/ })).toBeInTheDocument()
    // Clear the search — should return to Systems (not Popular)
    const input = screen.getByPlaceholderText('Search languages...') as HTMLInputElement
    await user.clear(input)
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Systems/ }).classList.contains('active')).toBe(true)
  })
})

describe('FilterPanel — sticky header chrome', () => {
  beforeEach(() => localStorage.clear())

  it('hides the category dropdown when the Language tab is active', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.queryByRole('button', { name: /All Languages/ })).not.toBeInTheDocument()
  })

  it('shows the category dropdown when the Type tab is active', async () => {
    const user = userEvent.setup()
    const { container } = render(<FilterPanel {...filterPanelProps} />)
    // Click the Type panel-tab specifically (other Type-named subtypes appear after the click)
    const typeTab = container.querySelector('button.panel-tab:nth-of-type(2)') as HTMLButtonElement
    await user.click(typeTab)
    expect(screen.getByRole('button', { name: /All Types/ })).toBeInTheDocument()
  })
})

describe('FilterPanel — tab switching resets active tile to Popular', () => {
  beforeEach(() => localStorage.clear())

  it('switching from Language → Type → Language resets the active tile to Popular', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Switch to Systems (Zig is Systems-only, not in Popular)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
    // Tab switch (panel-tab buttons specifically; the Type tab also contains language-named subtypes)
    const tabBar = screen.getByRole('button', { name: 'Language' }).parentElement!
    const typeTab = tabBar.querySelector('button.panel-tab:nth-of-type(2)') as HTMLButtonElement
    const langTab = tabBar.querySelector('button.panel-tab:nth-of-type(1)') as HTMLButtonElement
    await user.click(typeTab)
    await user.click(langTab)
    // Popular content shown again (JavaScript visible, Zig not)
    expect(screen.getByRole('button', { name: /^JavaScript$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Zig$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Popular/ }).classList.contains('active')).toBe(true)
  })
})

describe('FilterPanel — embedded mode', () => {
  it('hides internal Blocks header / search / tabs / category dropdown when embedded', () => {
    render(<FilterPanel {...filterPanelProps} embedded activeTab="language" />)
    expect(screen.queryByText('Blocks')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search languages...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Language(\s|$)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All Languages/ })).not.toBeInTheDocument()
  })

  it('renders the internal header by default (non-embedded)', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByText('Blocks')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search languages...')).toBeInTheDocument()
  })

  it('renders Type tab content when controlled activeTab="type"', () => {
    render(<FilterPanel {...filterPanelProps} embedded activeTab="type" />)
    // A known repo-type bucket label should be visible
    expect(screen.getByText(/Frameworks/)).toBeInTheDocument()
    // Domain/Ecosystem toggle is language-only — should be hidden in type tab
    expect(screen.queryByRole('button', { name: 'Domain' })).not.toBeInTheDocument()
  })

  it('filters to a flat list of matching languages by controlled search prop', () => {
    render(<FilterPanel {...filterPanelProps} embedded activeTab="language" search="rust" />)
    expect(screen.getByText(/^Rust$/)).toBeInTheDocument()
    // Python should be filtered out
    expect(screen.queryByText(/^Python$/)).not.toBeInTheDocument()
  })
})
