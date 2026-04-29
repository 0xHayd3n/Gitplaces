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

vi.mock('./BannerCard', () => ({
  BannerCard: (props: Record<string, unknown>) => (
    <div
      data-testid="banner-card"
      data-tag={props.tag as string}
      data-tier={props.tier as string}
      data-title={props.title as string}
      data-version={props.versionLabel as string}
      data-repo={props.repoFullName as string}
      onClick={() => (props.onClick as () => void)?.()}
    />
  ),
}))

vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: () => false, saveRepo: vi.fn(), loading: false }),
}))

const makeForkEvent = (): GitHubFeedEvent => ({
  id: '1',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: '' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date().toISOString(),
})

const makeWatchEvent = (): GitHubFeedEvent => ({
  id: '2',
  type: 'WatchEvent',
  actor: { login: 'alice', avatar_url: '' },
  repo: { full_name: 'some/repo' },
  payload: {},
  created_at: new Date().toISOString(),
})

const makeReleaseEvent = (overrides: Partial<{ tag_name: string; name: string | null; body: string; prerelease: boolean }> = {}): GitHubFeedEvent => ({
  id: '3',
  type: 'ReleaseEvent',
  actor: { login: 'maintainer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    release: {
      tag_name: overrides.tag_name ?? 'v1.0.0',
      name: overrides.name ?? null,
      body: overrides.body ?? 'Notes',
      prerelease: overrides.prerelease ?? false,
    },
  },
  created_at: new Date().toISOString(),
})

const makePrEvent = (overrides: Partial<{ number: number; title: string; body: string }> = {}): GitHubFeedEvent => ({
  id: '4',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: overrides.title ?? 'Improve scrolling',
      number: overrides.number ?? 1248,
      body: overrides.body ?? 'PR body',
      user: { login: 'contributor', avatar_url: '' },
      base: { sha: 'a', ref: 'main' },
      head: { sha: 'b', ref: 'feat' },
    },
  },
  created_at: new Date().toISOString(),
})

describe('ActivityEvent routing', () => {
  it('renders ForkEventCard for ForkEvent', () => {
    render(<MemoryRouter><ActivityEvent event={makeForkEvent()} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('fork-event-card')).toBeInTheDocument()
  })

  it('renders StarEventCard for WatchEvent', () => {
    render(<MemoryRouter><ActivityEvent event={makeWatchEvent()} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('star-event-card')).toBeInTheDocument()
  })

  it('renders BannerCard for ReleaseEvent with major tier when tag is x.0.0', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v2.0.0' })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('MAJOR UPDATE')
    expect(card.getAttribute('data-tier')).toBe('major')
    expect(card.getAttribute('data-version')).toBe('v2.0.0')
  })

  it('renders BannerCard for ReleaseEvent with normal tier when tag is x.y.z', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.2.3' })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('UPDATE')
    expect(card.getAttribute('data-tier')).toBe('normal')
  })

  it('renders BannerCard for ReleaseEvent with prerelease tier when prerelease flag is set', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ prerelease: true })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('PRE-RELEASE')
    expect(card.getAttribute('data-tier')).toBe('prerelease')
  })

  it('renders BannerCard for PullRequestEvent with #number version label', () => {
    render(<MemoryRouter><ActivityEvent event={makePrEvent({ number: 4242 })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('PR MERGED')
    expect(card.getAttribute('data-tier')).toBe('normal')
    expect(card.getAttribute('data-version')).toBe('#4242')
  })

  it('uses release.name as title suffix when distinct from tag', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.0.0', name: 'Big Bang' })} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('banner-card').getAttribute('data-title')).toBe('v1.0.0 — Big Bang')
  })

  it('uses just the tag as title when release name is null or matches tag', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.0.0', name: null })} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('banner-card').getAttribute('data-title')).toBe('v1.0.0')
  })

  it('calls onOpenModal with the event when the BannerCard is clicked', () => {
    const onOpenModal = vi.fn()
    const event = makeReleaseEvent()
    render(<MemoryRouter><ActivityEvent event={event} onOpenModal={onOpenModal} /></MemoryRouter>)
    screen.getByTestId('banner-card').click()
    expect(onOpenModal).toHaveBeenCalledWith(event)
  })
})
