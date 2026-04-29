import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ActivityEvent from './ActivityEvent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./ForkEventCard', () => ({
  ForkEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="fork-event-card">{event.repo.full_name}</div>
  ),
}))

vi.mock('./StarEventCard', () => ({
  StarEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="star-event-card">{event.repo.full_name}</div>
  ),
}))

vi.mock('./ReleaseEventCard', () => ({
  ReleaseEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="release-event-card">{event.repo.full_name}</div>
  ),
}))

// useSavedRepos returns { isSaved, saveRepo, loading } — mock accordingly
vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: () => false, saveRepo: vi.fn(), loading: false }),
}))

const makeForkEvent = (): GitHubFeedEvent => ({
  id: '99',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date().toISOString(),
})

const makeWatchEvent = (): GitHubFeedEvent => ({
  id: '100',
  type: 'WatchEvent',
  actor: { login: 'alice', avatar_url: 'https://example.com/a.png' },
  repo: { full_name: 'some/repo' },
  payload: {},
  created_at: new Date().toISOString(),
})

const makeReleaseEvent = (): GitHubFeedEvent => ({
  id: '101',
  type: 'ReleaseEvent',
  actor: { login: 'rerun-io', avatar_url: 'https://example.com/r.png' },
  repo: { full_name: 'rerun-io/rerun' },
  payload: { release: { tag_name: '0.31.4' } },
  created_at: new Date().toISOString(),
})

describe('ActivityEvent routing', () => {
  it('renders ForkEventCard for ForkEvent', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeForkEvent()} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('fork-event-card')).toBeInTheDocument()
    expect(screen.getByText('anthropics/Databuddy')).toBeInTheDocument()
  })

  it('renders StarEventCard for WatchEvent', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeWatchEvent()} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('star-event-card')).toBeInTheDocument()
    expect(screen.queryByTestId('fork-event-card')).toBeNull()
  })

  it('renders ReleaseEventCard for ReleaseEvent', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeReleaseEvent()} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('release-event-card')).toBeInTheDocument()
  })
})
