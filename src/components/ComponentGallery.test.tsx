import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComponentGallery } from './ComponentGallery'

beforeEach(() => {
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
    takeRecords: () => [], root: null, rootMargin: '', thresholds: [],
  })) as unknown as typeof IntersectionObserver
})

function makeComp(name: string, path = `${name}.tsx`) {
  return {
    path, name, props: [], framework: 'react' as const, renderable: true,
  }
}

const mockVariant = { name: 'default', props: {}, source: 'default' as const }

describe('ComponentGallery', () => {
  it('renders a card for each component', () => {
    const components = ['A', 'B', 'C'].map(n => makeComp(n))
    render(<ComponentGallery
      components={components}
      variantsByPath={Object.fromEntries(components.map(c => [c.path, [mockVariant]]))}
      tierByPath={Object.fromEntries(components.map(c => [c.path, 'source']))}
      bundledByPath={{}} sourceByPath={Object.fromEntries(components.map(c => [c.path, '']))}
      theme="dark" onSelect={() => {}}
    />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('calls onSelect with the component path when a card is clicked', () => {
    const onSelect = vi.fn()
    const components = [makeComp('Button')]
    render(<ComponentGallery
      components={components}
      variantsByPath={{ 'Button.tsx': [mockVariant] }}
      tierByPath={{ 'Button.tsx': 'source' }}
      bundledByPath={{}} sourceByPath={{ 'Button.tsx': '' }}
      theme="dark" onSelect={onSelect}
    />)
    fireEvent.click(screen.getByText('Button').closest('.cg-card')!)
    expect(onSelect).toHaveBeenCalledWith('Button.tsx')
  })
})
