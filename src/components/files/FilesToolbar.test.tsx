import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilesToolbar from './FilesToolbar'

const noopProps = {
  searchValue: '',
  onSearchChange: vi.fn(),
  searchMode: 'expand' as const,
  onSearchModeChange: vi.fn(),
  density: 'comfortable' as const,
  onDensityChange: vi.fn(),
  diffBase: null,
  onDiffBaseChange: vi.fn(),
  diffBaseOptions: [],
}

describe('FilesToolbar', () => {
  it('renders search input + three selects', () => {
    render(<FilesToolbar {...noopProps} />)
    expect(screen.getByPlaceholderText('Search files…')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
  })

  it('calls onSearchChange when input changes', () => {
    const onSearchChange = vi.fn()
    render(<FilesToolbar {...noopProps} onSearchChange={onSearchChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'foo' } })
    expect(onSearchChange).toHaveBeenCalledWith('foo')
  })

  it('emits diff base change with parsed type and ref', () => {
    const onDiffBaseChange = vi.fn()
    render(<FilesToolbar {...noopProps}
      diffBaseOptions={[{ label: 'vs v1.0.0', ref: { type: 'tag', ref: 'v1.0.0' } }]}
      onDiffBaseChange={onDiffBaseChange} />)
    const select = screen.getAllByRole('combobox')[2]
    fireEvent.change(select, { target: { value: 'tag:v1.0.0' } })
    expect(onDiffBaseChange).toHaveBeenCalledWith({ type: 'tag', ref: 'v1.0.0' })
  })

  it('emits null diff base when "None" selected', () => {
    const onDiffBaseChange = vi.fn()
    render(<FilesToolbar {...noopProps}
      diffBase={{ type: 'tag', ref: 'v1.0.0' }}
      diffBaseOptions={[{ label: 'vs v1.0.0', ref: { type: 'tag', ref: 'v1.0.0' } }]}
      onDiffBaseChange={onDiffBaseChange} />)
    const select = screen.getAllByRole('combobox')[2]
    fireEvent.change(select, { target: { value: '' } })
    expect(onDiffBaseChange).toHaveBeenCalledWith(null)
  })

  it('focuses search input on files-toolbar:focus-search event', () => {
    render(<FilesToolbar {...noopProps} />)
    const input = screen.getByPlaceholderText('Search files…') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
    expect(document.activeElement).toBe(input)
  })
})
