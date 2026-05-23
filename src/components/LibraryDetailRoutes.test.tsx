import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import LibraryDetailRoutes from './LibraryDetailRoutes'

vi.mock('../views/RepoDetail', () => ({
  default: () => <div data-testid="repo-detail" />,
}))
vi.mock('../views/CollectionDetail', () => ({
  default: () => <div data-testid="collection-detail" />,
}))

function NavButton({ to, label, replace }: { to: string; label?: string; replace?: boolean }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to, replace ? { replace: true } : undefined)}>{label ?? `go-${to}`}</button>
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LibraryDetailRoutes />
    </MemoryRouter>
  )
}

describe('LibraryDetailRoutes', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders the current route immediately on mount', () => {
    renderAt('/repo/foo/bar')
    expect(screen.getByTestId('repo-detail')).toBeInTheDocument()
  })

  it('renders a leaving layer for the previous route after navigation', () => {
    render(
      <MemoryRouter initialEntries={['/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/repo/baz/qux" />
      </MemoryRouter>
    )

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)

    act(() => { screen.getByText('go-/repo/baz/qux').click() })

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)
  })

  it('unmounts the leaving layer after the transition duration', () => {
    render(
      <MemoryRouter initialEntries={['/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/repo/baz/qux" />
      </MemoryRouter>
    )

    act(() => { screen.getByText('go-/repo/baz/qux').click() })
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(250) })

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })

  it('does not start a transition when the same pathname is replaced', () => {
    render(
      <MemoryRouter initialEntries={['/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/repo/foo/bar" replace />
      </MemoryRouter>
    )

    act(() => { screen.getByText('go-/repo/foo/bar').click() })

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })

  it('handles rapid sequential navigation: leaving layer always reflects the most recently displayed location', () => {
    render(
      <MemoryRouter initialEntries={['/repo/a/a']}>
        <LibraryDetailRoutes />
        <NavButton to="/repo/b/b" label="goB" />
        <NavButton to="/repo/c/c" label="goC" />
      </MemoryRouter>
    )

    act(() => { screen.getByText('goB').click() })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { screen.getByText('goC').click() })

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(250) })
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })
})
