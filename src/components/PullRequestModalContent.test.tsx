import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PullRequestModalContent } from './PullRequestModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./ReadmeRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="readme">{content}</div>,
}))

vi.mock('./CompareSummary', () => ({
  CompareSummary: (props: Record<string, unknown>) => (
    <div
      data-testid="compare"
      data-owner={props.owner as string}
      data-repo={props.repo as string}
      data-base={props.base as string}
      data-head={props.head as string}
    />
  ),
}))

const makeEvent = (body: string | null): GitHubFeedEvent => ({
  id: '1',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: 'Fix the thing',
      number: 42,
      body,
      user: { login: 'contributor', avatar_url: '' },
      base: { sha: 'aaaa', ref: 'main' },
      head: { sha: 'bbbb', ref: 'feature' },
    },
  },
  created_at: new Date().toISOString(),
})

describe('PullRequestModalContent', () => {
  it('renders the PR body via ReadmeRenderer', async () => {
    render(<PullRequestModalContent event={makeEvent('PR body markdown')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme')).toHaveTextContent('PR body markdown')
  })

  it('renders CompareSummary using base/head SHAs and the repo from event.repo.full_name', () => {
    render(<PullRequestModalContent event={makeEvent('body')} />)
    const compare = screen.getByTestId('compare')
    expect(compare.getAttribute('data-owner')).toBe('acme')
    expect(compare.getAttribute('data-repo')).toBe('widget')
    expect(compare.getAttribute('data-base')).toBe('aaaa')
    expect(compare.getAttribute('data-head')).toBe('bbbb')
  })

  it('renders only CompareSummary when body is null', async () => {
    render(<PullRequestModalContent event={makeEvent(null)} />)
    expect(screen.queryByTestId('readme')).toBeNull()
    expect(screen.getByTestId('compare')).toBeInTheDocument()
  })
})
