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

describe('ActivityEvent ForkEvent integration', () => {
  it('renders ForkEventCard for ForkEvent', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeForkEvent()} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('fork-event-card')).toBeInTheDocument()
    expect(screen.getByText('anthropics/Databuddy')).toBeInTheDocument()
  })

  it('does not render ForkEventCard for non-fork events', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeWatchEvent()} />
      </MemoryRouter>
    )
    expect(screen.queryByTestId('fork-event-card')).toBeNull()
  })
})
