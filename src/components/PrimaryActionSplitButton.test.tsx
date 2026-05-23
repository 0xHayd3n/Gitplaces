import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrimaryActionSplitButton } from './PrimaryActionSplitButton'

describe('PrimaryActionSplitButton', () => {
  it('renders the action label and caret', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Learn" onAction={() => {}}>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.getByRole('button', { name: 'Learn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument()
  })

  it('invokes onAction when the primary half is clicked', () => {
    const onAction = vi.fn()
    render(
      <PrimaryActionSplitButton actionLabel="Cancel" onAction={onAction}>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('toggles the dropdown when the caret is clicked', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Learn" onAction={() => {}}>
        <button>Hidden item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.queryByText('Hidden item')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText('Hidden item')).toBeInTheDocument()
  })

  it('disables the primary half when disabled is true', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Cancel" onAction={() => {}} disabled>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
