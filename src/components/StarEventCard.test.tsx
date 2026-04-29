import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { StarEventCard } from './StarEventCard'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import type { ForkRepoData } from '../hooks/useForkData'

vi.mock('../hooks/useForkData', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useForkData')>('../hooks/useForkData')
  return { ...actual, useRepoData: vi.fn() }
})

const mockUseRepoData = vi.mocked(
  (await import('../hooks/useForkData')).useRepoData
)

const starEvent: GitHubFeedEvent = {
  id: '1',
  type: 'WatchEvent',
  actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
  repo: { full_name: 'ibelick/ui-skills' },
  payload: { action: 'started' },
  created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
}

const repoData: ForkRepoData = {
  owner: 'ibelick',
  name: 'ui-skills',
  description: 'A collection of UI skills',
  language: 'TypeScript',
  stars: 1200,
  forks: 87,
  avatarUrl: 'https://github.com/ibelick.png?size=40',
}

describe('StarEventCard', () => {
  it('renders skeleton card while loading', () => {
    mockUseRepoData.mockReturnValue({ repo: null, loading: true })
    const { container } = render(<StarEventCard event={starEvent} />)
    expect(container.querySelector('.fork-repo-card--skeleton')).toBeInTheDocument()
  })

  it('renders actor header with login and timestamp', () => {
    mockUseRepoData.mockReturnValue({ repo: repoData, loading: false })
    render(<StarEventCard event={starEvent} />)
    expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/starred a repository/)).toBeInTheDocument()
  })

  it('renders the starred repo card with name and description', () => {
    mockUseRepoData.mockReturnValue({ repo: repoData, loading: false })
    render(<StarEventCard event={starEvent} />)
    expect(screen.getByText('ui-skills')).toBeInTheDocument()
    expect(screen.getByText('A collection of UI skills')).toBeInTheDocument()
  })

  it('does not show fork badge', () => {
    mockUseRepoData.mockReturnValue({ repo: repoData, loading: false })
    render(<StarEventCard event={starEvent} />)
    expect(screen.queryByText('fork')).toBeNull()
  })

  it('falls back to owner/name from event when API returns null', () => {
    mockUseRepoData.mockReturnValue({ repo: null, loading: false })
    render(<StarEventCard event={starEvent} />)
    expect(screen.getByText('ui-skills')).toBeInTheDocument()
    expect(screen.getByText('ibelick')).toBeInTheDocument()
  })

  it('links the card to the GitHub URL', () => {
    mockUseRepoData.mockReturnValue({ repo: repoData, loading: false })
    render(<StarEventCard event={starEvent} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/ibelick/ui-skills')
  })
})
