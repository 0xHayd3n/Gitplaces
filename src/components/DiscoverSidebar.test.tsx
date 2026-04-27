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

describe('FilterPanel — language sectioned view (default)', () => {
  it('renders Popular section first, then platform sections, all visible at once', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // Popular header
    expect(screen.getByRole('heading', { name: /Popular/ })).toBeInTheDocument()
    // At least a couple of platform headers are visible simultaneously
    expect(screen.getByRole('heading', { name: /Native/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /JVM/ })).toBeInTheDocument()
    // No Use Case / Platform toggle anymore
    expect(screen.queryByRole('button', { name: 'Use Case' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it('shows all platform sections’ languages on one page (no drill-in click required)', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // Popular language (also appears in its platform section, so allow multiple)
    expect(screen.getAllByRole('button', { name: /^JavaScript$/ }).length).toBeGreaterThanOrEqual(1)
    // Native-only language (not in Popular) — visible without clicking
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
    // Another platform's language — also visible without clicking
    expect(screen.getByRole('button', { name: /^Crystal$/ })).toBeInTheDocument()
  })

  it('shows section counts that match the catalogue', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('heading', { name: /Native.*\(/ })).toBeInTheDocument()
  })
})

describe('FilterPanel — language search results', () => {
  beforeEach(() => localStorage.clear())

  it('shows a flat list of matching languages when search has text', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    expect(screen.getByRole('button', { name: /^Rust/ })).toBeInTheDocument()
    // Section headers are hidden during search
    expect(screen.queryByRole('heading', { name: /^Native/ })).not.toBeInTheDocument()
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

  it('shows platform caption (· <Platform>) on each row', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    expect(screen.getByText(/· Native/)).toBeInTheDocument()
  })

  it('shows empty state when no language matches', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'zzznosuchlang')
    expect(screen.getByText(/No languages match/)).toBeInTheDocument()
  })

  it('returns to the full sectioned view after clearing the search', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'python')
    expect(screen.getByRole('button', { name: /^Python/ })).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search languages...') as HTMLInputElement
    await user.clear(input)
    // All platform sections back, Zig (Native-only) visible again
    expect(screen.getByRole('heading', { name: /Native/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Zig$/ })).toBeInTheDocument()
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
  })

  it('filters to a flat list of matching languages by controlled search prop', () => {
    render(<FilterPanel {...filterPanelProps} embedded activeTab="language" search="rust" />)
    expect(screen.getByText(/^Rust$/)).toBeInTheDocument()
    // Python should be filtered out
    expect(screen.queryByText(/^Python$/)).not.toBeInTheDocument()
  })
})
