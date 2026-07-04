import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DiscoverTopNav from './DiscoverTopNav'

const baseProps = {
  selectedSubtypes: [],
  onSelectedSubtypesChange: vi.fn(),
  filters: {},
  selectedLanguages: [],
  activeVerification: new Set<'verified' | 'likely'>(),
  onFilterChange: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onVerificationToggle: vi.fn(),
  activePanel: null as 'buckets' | 'filters' | 'advanced' | null,
  onActivePanelChange: vi.fn(),
  viewMode: 'home' as const,
  onViewModeChange: vi.fn(),
  query: '',
  onQueryChange: vi.fn(),
  onSearch: vi.fn(),
}

describe('DiscoverTopNav', () => {
  it('renders search icon and three tab buttons by default', () => {
    render(<DiscoverTopNav {...baseProps} />)
    expect(screen.getByRole('button', { name: /search/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^recommended$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^agents$/i })).toBeTruthy()
  })

  it('marks the active tab with the active class', () => {
    render(<DiscoverTopNav {...baseProps} viewMode="recommended" />)
    expect(screen.getByRole('button', { name: /^recommended$/i })).toHaveClass('dtn-tab-active')
  })

  it('calls onViewModeChange when a tab is clicked', () => {
    const onViewModeChange = vi.fn()
    render(<DiscoverTopNav {...baseProps} onViewModeChange={onViewModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /^agents$/i }))
    expect(onViewModeChange).toHaveBeenCalledWith('agents')
  })

  it('replaces tabs with a search input when the search icon is clicked', () => {
    render(<DiscoverTopNav {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(screen.getByPlaceholderText(/search repos/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^home$/i })).toBeNull()
  })

  it('collapses back to tabs when Escape is pressed in the input', () => {
    render(<DiscoverTopNav {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/search repos/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeTruthy()
  })

  it('does NOT render a Gitplaces brand or a Filter button', () => {
    render(<DiscoverTopNav {...baseProps} />)
    expect(document.querySelector('.dtn-brand')).toBeNull()
    expect(document.querySelector('.dtn-search-filter-btn')).toBeNull()
  })
})
