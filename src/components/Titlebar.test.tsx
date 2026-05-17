import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Titlebar from './Titlebar'

const mockControls = {
  minimize: vi.fn(),
  maximize: vi.fn(),
  close: vi.fn()
}

Object.defineProperty(window, 'api', {
  value: { windowControls: mockControls },
  writable: true
})

describe('Titlebar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the titlebar drag region', () => {
    render(<MemoryRouter><Titlebar /></MemoryRouter>)
    expect(document.querySelector('header.titlebar')).toBeInTheDocument()
  })

  it('renders three control dots', () => {
    render(<MemoryRouter><Titlebar /></MemoryRouter>)
    expect(screen.getByTestId('ctrl-close')).toBeInTheDocument()
    expect(screen.getByTestId('ctrl-minimize')).toBeInTheDocument()
    expect(screen.getByTestId('ctrl-maximize')).toBeInTheDocument()
  })

  it('close dot calls windowControls.close', () => {
    render(<MemoryRouter><Titlebar /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('ctrl-close'))
    expect(mockControls.close).toHaveBeenCalledOnce()
  })

  it('minimize dot calls windowControls.minimize', () => {
    render(<MemoryRouter><Titlebar /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('ctrl-minimize'))
    expect(mockControls.minimize).toHaveBeenCalledOnce()
  })

  it('maximize dot calls windowControls.maximize', () => {
    render(<MemoryRouter><Titlebar /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('ctrl-maximize'))
    expect(mockControls.maximize).toHaveBeenCalledOnce()
  })
})
