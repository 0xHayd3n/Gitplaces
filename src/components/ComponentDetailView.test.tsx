import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComponentDetailView } from './ComponentDetailView'

beforeEach(() => {
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
    takeRecords: () => [], root: null, rootMargin: '', thresholds: [],
  })) as unknown as typeof IntersectionObserver
})

const baseComponent = {
  path: 'Button.tsx', name: 'Button',
  props: [
    { name: 'variant', type: "'a'|'b'", required: false, stringUnion: ['a', 'b'] },
    { name: 'label',   type: 'string',  required: true },
  ],
  framework: 'react' as const, renderable: true,
}

function variants(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `V${i}`, props: { variant: i }, source: 'auto' as const,
  }))
}

describe('ComponentDetailView', () => {
  it('renders the props table', () => {
    render(<ComponentDetailView
      component={baseComponent} variants={variants(1)} tier="source"
      theme="dark" source="const x = 1" onBack={() => {}}
    />)
    expect(screen.getByText('variant')).toBeInTheDocument()
    expect(screen.getByText('label')).toBeInTheDocument()
  })

  it('renders one tile per variant up to 6', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(4)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(4)
  })

  it('collapses variants beyond 6 behind a "+N more" button', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(10)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(6)
    expect(screen.getByText(/4 more/)).toBeInTheDocument()
  })

  it('shows all variants after clicking expand button', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(10)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    fireEvent.click(screen.getByText(/4 more/))
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(10)
  })

  it('toggles the source accordion', () => {
    render(<ComponentDetailView
      component={baseComponent} variants={variants(1)} tier="source"
      theme="dark" source="const x = 1" onBack={() => {}}
    />)
    expect(screen.queryByText('const x = 1')).toBeNull()
    fireEvent.click(screen.getByText(/source/i))
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })
})
