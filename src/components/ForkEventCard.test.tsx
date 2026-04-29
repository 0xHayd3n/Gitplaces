import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { ForkEventCard } from './ForkEventCard'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import type { ForkRepoData } from '../hooks/useForkData'

vi.mock('../hooks/useForkData')

const mockUseForkData = vi.mocked(
  (await import('../hooks/useForkData')).useForkData
)

const forkEvent: GitHubFeedEvent = {
  id: '1',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
}

const originalData: ForkRepoData = {
  owner: 'anthropics',
  name: 'Databuddy',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 4200,
  forks: 312,
  avatarUrl: 'https://github.com/anthropics.png?size=40',
}

const forkData: ForkRepoData = {
  owner: 'zzzzshawn',
  name: 'Databuddy',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 0,
  forks: 0,
  avatarUrl: 'https://github.com/zzzzshawn.png?size=40',
}

describe('ForkEventCard', () => {
  it('renders skeleton cards while loading', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: true })

    const { container } = render(<ForkEventCard event={forkEvent} />)

    expect(container.querySelector('.fork-repo-card--skeleton')).toBeInTheDocument()
    expect(screen.queryByText('Databuddy')).toBeNull()
  })

  it('renders actor header with login and timestamp', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    // actor in header + fork card creator row
    expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/forked a repository/)).toBeInTheDocument()
  })

  it('renders both repo names when loaded', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByText('Databuddy')).toHaveLength(2)
  })

  it('renders fork badge only on the fork card', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText('fork')).toBeInTheDocument()
  })

  it('shows stars and forks on original card using formatCount', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText(/4\.2k/)).toBeInTheDocument()
    expect(screen.getByText(/312/)).toBeInTheDocument()
  })

  it('links original and fork cards to correct GitHub URLs', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    const links = screen.getAllByRole('link')
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/anthropics/Databuddy')).toBe(true)
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/zzzzshawn/Databuddy')).toBe(true)
  })

  it('renders circle arrow between cards', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    const { container } = render(<ForkEventCard event={forkEvent} />)

    expect(container.querySelector('.fork-event__arrow-circle')).toBeInTheDocument()
  })

  it('falls back to repo name from event when API returns null', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByText('Databuddy')).toHaveLength(2)
    expect(screen.getByText('anthropics')).toBeInTheDocument()
    expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(1)
  })
})
