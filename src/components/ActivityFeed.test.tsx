import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ActivityFeed from './ActivityFeed'

// Mock useFeed so we control the event list directly
const events = [
  { id: 'today1', type: 'WatchEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/b' }, payload: {}, created_at: new Date().toISOString() },
  { id: 'today2', type: 'ForkEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/c' }, payload: { forkee: { full_name: 'a/d' } }, created_at: new Date().toISOString() },
  { id: 'yesterday1', type: 'WatchEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/e' }, payload: {}, created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
]

vi.mock('../hooks/useFeed', () => ({
  useFeed: () => ({ events, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: { login: 'octocat' } }),
}))

vi.mock('./ActivityEvent', () => ({
  default: ({ event, onOpenModal }: any) => (
    <button data-testid={`event-${event.id}`} onClick={() => onOpenModal(event)}>
      {event.id}
    </button>
  ),
}))

vi.mock('./ActivityModal', () => ({
  ActivityModal: ({ event, onClose }: any) => (
    <div data-testid="activity-modal" data-event-id={event.id} onClick={onClose} />
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ActivityFeed', () => {
  it('renders Today and Yesterday dividers', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
  })

  it('renders all events, grouped by day', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.getByTestId('event-today1')).toBeInTheDocument()
    expect(screen.getByTestId('event-today2')).toBeInTheDocument()
    expect(screen.getByTestId('event-yesterday1')).toBeInTheDocument()
  })

  it('renders no modal initially', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.queryByTestId('activity-modal')).toBeNull()
  })

  it('opens modal with the clicked event', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('event-today2'))
    const modal = screen.getByTestId('activity-modal')
    expect(modal).toBeInTheDocument()
    expect(modal.getAttribute('data-event-id')).toBe('today2')
  })

  it('closes modal when its onClose fires', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('event-today1'))
    expect(screen.getByTestId('activity-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('activity-modal'))
    expect(screen.queryByTestId('activity-modal')).toBeNull()
  })
})
