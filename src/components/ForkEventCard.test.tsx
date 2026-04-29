import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
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
}

const forkData: ForkRepoData = {
  owner: 'zzzzshawn',
  name: 'Databuddy',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 0,
  forks: 0,
}

describe('ForkEventCard', () => {
  it('renders skeleton cards while loading', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: true })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByRole('generic', { hidden: true })
      .some(el => el.classList.contains('fork-mini-card--skeleton'))
    ).toBe(true)
    expect(screen.queryByText('Databuddy')).toBeNull()
  })

  it('renders actor header with login and timestamp', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(1)
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

  it('shows stars and forks on original card', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText(/4,200/)).toBeInTheDocument()
    expect(screen.getByText(/312/)).toBeInTheDocument()
  })

  it('links original card to github.com/anthropics/Databuddy', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    const links = screen.getAllByRole('link')
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/anthropics/Databuddy')).toBe(true)
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/zzzzshawn/Databuddy')).toBe(true)
  })

  it('falls back to repo name from event when API returns null', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    // Should still render repo names parsed from full_name
    expect(screen.getAllByText('Databuddy')).toHaveLength(2)
    expect(screen.getByText('anthropics')).toBeInTheDocument()
    expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(1)
  })
})
