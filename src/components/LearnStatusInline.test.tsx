import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LearnStatusInline } from './LearnStatusInline'

describe('LearnStatusInline', () => {
  it('renders phase label, percent, and elapsed in seconds-only format', () => {
    render(<LearnStatusInline phase="generating" percent={60} elapsedMs={47_000} state="running" />)
    expect(screen.getByText('LEARNING')).toBeInTheDocument()
    expect(screen.getByText(/60% Complete/)).toBeInTheDocument()
    expect(screen.getByText(/47s/)).toBeInTheDocument()
  })

  it('renders mm ss format past 60s', () => {
    render(<LearnStatusInline phase="generating" percent={60} elapsedMs={167_000} state="running" />)
    expect(screen.getByText(/2m 47s/)).toBeInTheDocument()
  })

  it('renders FAILED label and error on failed state', () => {
    render(<LearnStatusInline phase="failed" percent={0} elapsedMs={5_000} state="failed" error="boom" />)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('renders the progress bar with correct fill width', () => {
    const { container } = render(
      <LearnStatusInline phase="generating" percent={60} elapsedMs={5_000} state="running" />,
    )
    const fill = container.querySelector('.learn-status-bar-fill') as HTMLElement
    expect(fill.style.width).toBe('60%')
  })
})
