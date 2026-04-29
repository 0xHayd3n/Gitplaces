import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReleaseModalContent } from './ReleaseModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

// Stub ReadmeRenderer (lazy/Suspense + markdown engine is heavy in tests).
vi.mock('./ReadmeRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="readme">{content}</div>,
}))

// Stub CompareSummary so we can assert it received the right props.
vi.mock('./CompareSummary', () => ({
  CompareSummary: (props: Record<string, unknown>) => (
    <div data-testid="compare" data-base={props.base as string} data-head={props.head as string} />
  ),
}))

const makeEvent = (body: string): GitHubFeedEvent => ({
  id: '1',
  type: 'ReleaseEvent',
  actor: { login: 'maintainer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: { release: { tag_name: 'v1.2.3', name: 'v1.2.3', body } },
  created_at: new Date().toISOString(),
})

describe('ReleaseModalContent', () => {
  it('renders the markdown body via ReadmeRenderer', async () => {
    render(<ReleaseModalContent event={makeEvent('Some release notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme')).toHaveTextContent('Some release notes')
  })

  it('strips the Full Changelog line from the body before rendering', async () => {
    const body = 'Notes\n\n**Full Changelog**: https://github.com/acme/widget/compare/v1.2.2...v1.2.3'
    render(<ReleaseModalContent event={makeEvent(body)} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme').textContent).toBe('Notes')
  })

  it('renders CompareSummary when a compare URL is present', async () => {
    const body = 'Notes\n\n**Full Changelog**: https://github.com/acme/widget/compare/v1.2.2...v1.2.3'
    render(<ReleaseModalContent event={makeEvent(body)} />)
    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument())
    const compare = screen.getByTestId('compare')
    expect(compare.getAttribute('data-base')).toBe('v1.2.2')
    expect(compare.getAttribute('data-head')).toBe('v1.2.3')
  })

  it('does not render CompareSummary when no compare URL is in the body', async () => {
    render(<ReleaseModalContent event={makeEvent('Just plain notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByTestId('compare')).toBeNull()
  })

  it('handles missing body gracefully', async () => {
    const event: GitHubFeedEvent = {
      ...makeEvent(''),
      payload: { release: { tag_name: 'v1.2.3', name: 'v1.2.3', body: null } },
    }
    render(<ReleaseModalContent event={event} />)
    // No body → no readme content rendered
    await waitFor(() => {}, { timeout: 50 }).catch(() => {})
    expect(screen.queryByTestId('readme')?.textContent ?? '').toBe('')
    expect(screen.queryByTestId('compare')).toBeNull()
  })
})
