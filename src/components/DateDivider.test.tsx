import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DateDivider } from './DateDivider'

describe('DateDivider', () => {
  it('renders the label', () => {
    render(<DateDivider label="Today" />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders the rule line', () => {
    const { container } = render(<DateDivider label="April 25" />)
    expect(container.querySelector('.date-divider__line')).toBeInTheDocument()
  })

  it('passes through the exact label without case transformation', () => {
    render(<DateDivider label="April 25, 2025" />)
    expect(screen.getByText('April 25, 2025')).toBeInTheDocument()
  })
})
