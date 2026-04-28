import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RepoOverlay from './RepoOverlay'

vi.mock('../views/RepoDetail', () => ({
  default: () => <div data-testid="repo-detail-content">RepoDetail</div>,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderOverlay() {
  return render(
    <MemoryRouter initialEntries={['/repo/vercel/next.js']}>
      <Routes>
        <Route path="/repo/:owner/:name" element={<RepoOverlay />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RepoOverlay', () => {
  beforeEach(() => { mockNavigate.mockReset() })

  it('renders RepoDetail content', () => {
    renderOverlay()
    expect(screen.getByTestId('repo-detail-content')).toBeInTheDocument()
  })

  it('renders a close button', () => {
    renderOverlay()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls navigate(-1) when close button is clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('calls navigate(-1) when Escape is pressed', () => {
    renderOverlay()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})
