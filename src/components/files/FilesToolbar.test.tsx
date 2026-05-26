import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilesToolbar from './FilesToolbar'

const baseProps = {
  searchValue: '',
  onSearchChange: vi.fn(),
}

describe('FilesToolbar', () => {
  it('renders only a search input (filters moved to the path bar)', () => {
    render(<FilesToolbar {...baseProps} />)
    expect(screen.getByPlaceholderText('Search files…')).toBeInTheDocument()
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('calls onSearchChange when input changes', () => {
    const onSearchChange = vi.fn()
    render(<FilesToolbar {...baseProps} onSearchChange={onSearchChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'foo' } })
    expect(onSearchChange).toHaveBeenCalledWith('foo')
  })

  it('focuses search input on files-toolbar:focus-search event', () => {
    render(<FilesToolbar {...baseProps} />)
    const input = screen.getByPlaceholderText('Search files…') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
    expect(document.activeElement).toBe(input)
  })
})
