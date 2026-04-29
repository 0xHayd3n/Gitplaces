import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { ReleaseEventCard } from './ReleaseEventCard'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./CompareSummary', () => ({
  CompareSummary: ({ owner, repo, base, head }: { owner: string; repo: string; base: string | null; head: string }) => (
    <div data-testid="compare-summary" data-owner={owner} data-repo={repo} data-base={String(base)} data-head={head} />
  ),
}))

// ReadmeRenderer is heavy (TTS, link previews, image classifier). Stub it for
// these unit tests with a minimal renderer that exposes the props we care about.
vi.mock('./ReadmeRenderer', () => ({
  default: ({ content, repoOwner, repoName }: { content: string; repoOwner: string; repoName: string }) => (
    <div data-testid="readme-renderer" data-owner={repoOwner} data-repo={repoName}>
      {content}
    </div>
  ),
}))

function makeEvent(overrides: Partial<{ tag_name: string; name: string | null; body: string | null }> = {}): GitHubFeedEvent {
  return {
    id: '1',
    type: 'ReleaseEvent',
    actor: { login: 'cosmicstack-labs', avatar_url: 'https://example.com/avatar.png' },
    repo: { full_name: 'cosmicstack-labs/mercury-agent' },
    payload: {
      release: {
        tag_name: overrides.tag_name ?? 'v1.1.4',
        name: 'name' in overrides ? overrides.name : 'OpenAI Compilations & Provider Visibility',
        body: 'body' in overrides ? overrides.body : '## New: OpenAI Compilations Provider\n\nA dedicated provider for self-hosted, third-party, or any OpenAI-compatible API.',
      },
    },
    created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  }
}

describe('ReleaseEventCard', () => {
  it('renders actor + tag + repo in header', () => {
    render(<ReleaseEventCard event={makeEvent()} />)
    expect(screen.getByText('cosmicstack-labs')).toBeInTheDocument()
    expect(screen.getByText('v1.1.4')).toBeInTheDocument()
    expect(screen.getByText('cosmicstack-labs/mercury-agent')).toBeInTheDocument()
  })

  it('renders the release title combining tag and name', () => {
    render(<ReleaseEventCard event={makeEvent()} />)
    expect(screen.getByText(/v1\.1\.4 — OpenAI Compilations & Provider Visibility/)).toBeInTheDocument()
  })

  it('falls back to tag-only title when name is missing', () => {
    render(<ReleaseEventCard event={makeEvent({ name: null })} />)
    // Card title (not the header tag link)
    const titleLinks = screen.getAllByText('v1.1.4')
    expect(titleLinks.length).toBeGreaterThanOrEqual(2) // header link + card title
  })

  it('passes the release body through ReadmeRenderer with repo owner+name', async () => {
    render(<ReleaseEventCard event={makeEvent()} />)
    const renderer = await waitFor(() => screen.getByTestId('readme-renderer'))
    expect(renderer).toHaveAttribute('data-owner', 'cosmicstack-labs')
    expect(renderer).toHaveAttribute('data-repo', 'mercury-agent')
    expect(renderer.textContent).toMatch(/New: OpenAI Compilations Provider/)
    expect(renderer.textContent).toMatch(/dedicated provider for self-hosted/)
  })

  it('does not mount ReadmeRenderer when body is empty', () => {
    render(<ReleaseEventCard event={makeEvent({ body: '' })} />)
    expect(screen.queryByTestId('readme-renderer')).toBeNull()
  })

  it('shows "Read more" when body exceeds the limit and toggles expand', () => {
    const longBody = 'x'.repeat(800)
    render(<ReleaseEventCard event={makeEvent({ body: longBody })} />)
    const btn = screen.getByRole('button', { name: 'Read more' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('does not show "Read more" for short bodies', () => {
    render(<ReleaseEventCard event={makeEvent({ body: 'short note' })} />)
    expect(screen.queryByRole('button', { name: /Read more/ })).toBeNull()
  })

  it('links the tag and repo to GitHub URLs', () => {
    render(<ReleaseEventCard event={makeEvent()} />)
    const links = screen.getAllByRole('link')
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/cosmicstack-labs/mercury-agent')).toBe(true)
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/cosmicstack-labs/mercury-agent/releases/tag/v1.1.4')).toBe(true)
  })

  it('renders CompareSummary and strips the Full Changelog line when present', async () => {
    const body = '## Changes\n- foo bar\n\n**Full Changelog**: https://github.com/cosmicstack-labs/mercury-agent/compare/v1.1.3...v1.1.4'
    render(<ReleaseEventCard event={makeEvent({ body })} />)
    const summary = screen.getByTestId('compare-summary')
    expect(summary).toHaveAttribute('data-owner', 'cosmicstack-labs')
    expect(summary).toHaveAttribute('data-repo', 'mercury-agent')
    expect(summary).toHaveAttribute('data-base', 'v1.1.3')
    expect(summary).toHaveAttribute('data-head', 'v1.1.4')
    const renderer = await waitFor(() => screen.getByTestId('readme-renderer'))
    // The raw URL is stripped from the content sent to the renderer
    expect(renderer.textContent).not.toMatch(/Full Changelog/)
    expect(renderer.textContent).toMatch(/foo bar/)
  })

  it('renders the first-release variant of CompareSummary for commits-only links', () => {
    const body = '## v0.1.0\n\nFirst release.\n\n**Full Changelog**: https://github.com/cosmicstack-labs/mercury-agent/commits/v0.1.0'
    render(<ReleaseEventCard event={makeEvent({ tag_name: 'v0.1.0', body })} />)
    const summary = screen.getByTestId('compare-summary')
    expect(summary).toHaveAttribute('data-base', 'null')
    expect(summary).toHaveAttribute('data-head', 'v0.1.0')
  })

  it('does not render CompareSummary when the body has no compare URL', () => {
    render(<ReleaseEventCard event={makeEvent({ body: 'Just some plain notes.' })} />)
    expect(screen.queryByTestId('compare-summary')).toBeNull()
  })
})
