import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

const makeEvent = (
  body: string,
  opts: { tag?: string; assets?: Array<{ name: string; size: number; browser_download_url: string; download_count: number }> } = {}
): GitHubFeedEvent => ({
  id: '1',
  type: 'ReleaseEvent',
  actor: { login: 'maintainer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    release: {
      tag_name: opts.tag ?? 'v1.2.3',
      name: opts.tag ?? 'v1.2.3',
      body,
      ...(opts.assets ? { assets: opts.assets } : {}),
    },
  },
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

  it('renders no install button when onLearnVersion is absent', async () => {
    render(<ReleaseModalContent event={makeEvent('notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText('Learn this version')).toBeNull()
    expect(screen.queryByText(/Failed — retry/)).toBeNull()
    expect(screen.queryByText('Learning…')).toBeNull()
  })

  it('renders "Learn this version" button when UNLEARNED and not already learned', async () => {
    const onLearn = vi.fn()
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={onLearn}
        learnState="UNLEARNED"
        alreadyLearned={false}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Learn this version'))
    expect(onLearn).toHaveBeenCalledWith('v1.2.3')
  })

  it('renders "Learning…" label and no clickable button when LEARNING', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={vi.fn()}
        learnState="LEARNING"
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText('Learning…')).toBeInTheDocument()
    expect(screen.queryByText('Learn this version')).toBeNull()
  })

  it('renders "Failed — retry" button when ERROR and calls onLearnVersion on click', async () => {
    const onLearn = vi.fn()
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={onLearn}
        learnState="ERROR"
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Failed — retry/))
    expect(onLearn).toHaveBeenCalledWith('v1.2.3')
  })

  it('renders installed label and no button when alreadyLearned is true', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={vi.fn()}
        alreadyLearned
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText(/widget@v1\.2\.3\.skill\.md/)).toBeInTheDocument()
    expect(screen.queryByText('Learn this version')).toBeNull()
  })

  it('renders assets list when onLearnVersion is provided and assets are present', async () => {
    const assets = [
      { name: 'widget-darwin.zip', size: 1048576, browser_download_url: 'https://x/y', download_count: 12 },
      { name: 'widget-linux.tar.gz', size: 2097152, browser_download_url: 'https://x/z', download_count: 0 },
    ]
    render(
      <ReleaseModalContent
        event={makeEvent('notes', { assets })}
        onLearnVersion={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText('widget-darwin.zip')).toBeInTheDocument()
    expect(screen.getByText('widget-linux.tar.gz')).toBeInTheDocument()
  })

  it('does not render assets list when onLearnVersion is provided but assets are empty', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes', { assets: [] })}
        onLearnVersion={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText(/Assets/i)).toBeNull()
  })

  it('does not render assets list when onLearnVersion is absent (Library-feed mode)', async () => {
    const assets = [
      { name: 'widget-darwin.zip', size: 1048576, browser_download_url: 'https://x/y', download_count: 0 },
    ]
    render(<ReleaseModalContent event={makeEvent('notes', { assets })} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText('widget-darwin.zip')).toBeNull()
  })
})
