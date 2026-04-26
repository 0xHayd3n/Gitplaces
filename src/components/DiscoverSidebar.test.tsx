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

describe('FilterPanel — language tile grid (default view)', () => {
  beforeEach(() => localStorage.clear())

  it('renders Popular tile and category tiles, not language rows, when no search and no drill-in', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // Popular tile is always visible
    expect(screen.getByRole('button', { name: /Popular/ })).toBeInTheDocument()
    // Domain category tiles are visible (Use Case is the default mode)
    expect(screen.getByRole('button', { name: /^Systems/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Web/ })).toBeInTheDocument()
    // Individual language rows should NOT be in the default view
    expect(screen.queryByRole('button', { name: /^Rust$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Python$/ })).not.toBeInTheDocument()
  })

  it('shows tile counts that match the catalogue', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // The Systems domain has 15 languages in the catalogue (catalogue-derived; update if catalogue changes)
    expect(screen.getByRole('button', { name: /Systems.*\(15\)/ })).toBeInTheDocument()
  })
})

describe('FilterPanel — language drill-in', () => {
  beforeEach(() => localStorage.clear())

  it('clicking a category tile reveals that category\'s languages', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Go$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Web \(/ })).not.toBeInTheDocument()
  })

  it('clicking the Popular tile reveals popular languages', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /Popular/ }))
    expect(screen.getByRole('button', { name: /^JavaScript$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Python$/ })).toBeInTheDocument()
  })

  it('back button returns to the tile grid', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    // Pick the back button specifically (the dropdown trigger also reads "All Languages"
    // until Task 6 scopes it to the Type tab).
    const backBtn = screen.getAllByRole('button', { name: /All Languages/ })
      .find(b => b.classList.contains('lang-drillin-back'))!
    expect(backBtn).toBeDefined()
    await user.click(backBtn)
    expect(screen.getByRole('button', { name: /^Web/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rust$/ })).not.toBeInTheDocument()
  })

  it('hides the grouping toggle while drilled in', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.queryByRole('button', { name: 'Use Case' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument()
  })
})

describe('FilterPanel — language search results', () => {
  beforeEach(() => localStorage.clear())

  it('shows a flat list of matching languages when search has text', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    expect(screen.getByRole('button', { name: /^Rust/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Systems \(/ })).not.toBeInTheDocument()
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

  it('does not reset drilledCategory when typing a search', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Search languages...'), 'python')
    expect(screen.getByRole('button', { name: /^Python/ })).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search languages...') as HTMLInputElement
    await user.clear(input)
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Web \(/ })).not.toBeInTheDocument()
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
