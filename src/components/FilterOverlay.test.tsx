import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterOverlay from './FilterOverlay'

const baseProps = {
  open: true,
  onClose: vi.fn(),
  selectedSubtypes: [],
  onSelectedSubtypesChange: vi.fn(),
  filters: {},
  selectedLanguages: [],
  activeVerification: new Set<'verified' | 'likely'>(),
  onFilterChange: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onVerificationToggle: vi.fn(),
  initialTab: 'languages' as const,
}

describe('FilterOverlay', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<FilterOverlay {...baseProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders Languages / Types / Advanced tabs', () => {
    render(<FilterOverlay {...baseProps} />)
    const tabs = document.querySelectorAll('.filter-overlay-tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].textContent).toMatch(/languages/i)
    expect(tabs[1].textContent).toMatch(/types/i)
    expect(tabs[2].textContent).toMatch(/advanced/i)
  })

  it('calls onClose when Esc is pressed', () => {
    const onClose = vi.fn()
    render(<FilterOverlay {...baseProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on outside click', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <FilterOverlay {...baseProps} onClose={onClose} />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })
})
