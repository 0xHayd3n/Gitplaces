import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterChipRow from './FilterChipRow'

const baseProps = {
  selectedLanguages: [],
  selectedSubtypes: [],
  activeTags: [],
  filters: {},
  activeVerification: new Set<'verified' | 'likely'>(),
  onRemoveLanguage: vi.fn(),
  onRemoveSubtype: vi.fn(),
  onRemoveTag: vi.fn(),
  onClearAdvanced: vi.fn(),
  onVerificationToggle: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onSelectedSubtypesChange: vi.fn(),
  onFilterChange: vi.fn(),
}

describe('FilterChipRow', () => {
  it('renders nothing when no filters are active', () => {
    const { container } = render(<FilterChipRow {...baseProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one chip per active filter', () => {
    render(
      <FilterChipRow
        {...baseProps}
        selectedLanguages={['typescript']}
        selectedSubtypes={['cli-tool']}
        filters={{ stars: 1000 }}
        activeVerification={new Set(['verified'])}
      />,
    )
    const chips = document.querySelectorAll('.filter-chip')
    expect(chips.length).toBe(4)
  })

  it('calls onRemoveLanguage when a language chip × is clicked', () => {
    const onRemoveLanguage = vi.fn()
    render(
      <FilterChipRow {...baseProps} selectedLanguages={['python']} onRemoveLanguage={onRemoveLanguage} />,
    )
    fireEvent.click(screen.getByLabelText(/remove python/i))
    expect(onRemoveLanguage).toHaveBeenCalledWith('python')
  })

  it('opens the FilterOverlay when + Filter is clicked', () => {
    render(<FilterChipRow {...baseProps} selectedLanguages={['rust']} />)
    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }))
    expect(screen.getByRole('dialog', { name: /filters/i })).toBeTruthy()
  })
})
