import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ComponentSidebar } from './ComponentSidebar'

const components = [
  { path: 'src/Button.tsx',          name: 'Button' },
  { path: 'src/forms/Input.tsx',     name: 'Input' },
  { path: 'src/forms/Select.tsx',    name: 'Select' },
]

describe('ComponentSidebar', () => {
  it('renders all components after expanding their groups', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      theme="dark"
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    // Groups default to collapsed — expand both before asserting items render
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByText(/forms/i))
    expect(screen.getByText('Button')).toBeInTheDocument()
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Select')).toBeInTheDocument()
  })

  it('hides group items by default (collapsed state)', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      theme="dark"
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    expect(screen.queryByText('Button')).toBeNull()
    expect(screen.queryByText('Input')).toBeNull()
    expect(screen.queryByText('Select')).toBeNull()
  })

  it('groups components by parent folder', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      theme="dark"
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    expect(screen.getByText(/forms/i)).toBeInTheDocument()
  })

  it('calls onSelectPath when a component is clicked', () => {
    const onSelectPath = vi.fn()
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      theme="dark"
      onSelectPath={onSelectPath} onClearSelection={() => {}} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    // Expand the group containing Button before clicking
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByText('Button'))
    expect(onSelectPath).toHaveBeenCalledWith('src/Button.tsx')
  })

  it('calls onClearSelection when "All components" is clicked', () => {
    const onClearSelection = vi.fn()
    render(<ComponentSidebar
      components={components} selectedPath="src/Button.tsx" searchQuery=""
      theme="dark"
      onSelectPath={() => {}} onClearSelection={onClearSelection} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    fireEvent.click(screen.getByText(/all components/i))
    expect(onClearSelection).toHaveBeenCalled()
  })

  it('filters components by search query (case-insensitive substring)', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery="sel"
      theme="dark"
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}} onToggleTheme={() => {}}
    />)
    expect(screen.queryByText('Button')).toBeNull()
    expect(screen.queryByText('Input')).toBeNull()
    expect(screen.getByText('Select')).toBeInTheDocument()
  })
})
