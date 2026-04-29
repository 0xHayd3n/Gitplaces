import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ActivityModal } from './ActivityModal'
import type { GitHubFeedEvent } from '../hooks/useFeed'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

let isSavedMock = vi.fn().mockReturnValue(true)
vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: (...args: [string, string]) => isSavedMock(...args), saveRepo: vi.fn(), loading: false }),
}))

vi.mock('./DitherBackground', () => ({ default: () => <div data-testid="dither" /> }))
vi.mock('./ReleaseModalContent', () => ({ ReleaseModalContent: () => <div data-testid="release-content" /> }))
vi.mock('./PullRequestModalContent', () => ({ PullRequestModalContent: () => <div data-testid="pr-content" /> }))

const releaseEvent: GitHubFeedEvent = {
  id: '1',
  type: 'ReleaseEvent',
  actor: { login: 'gaearon', avatar_url: '' },
  repo: { full_name: 'facebook/react' },
  payload: { release: { tag_name: 'v19.0.0', name: 'Reactivity Refresh', body: '', prerelease: false } },
  created_at: new Date('2026-04-29T10:00:00Z').toISOString(),
}

const prEvent: GitHubFeedEvent = {
  id: '2',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: 'Fix scrolling perf',
      number: 1248,
      body: '',
      user: { login: 'sindresorhus', avatar_url: '' },
      base: { sha: 'a', ref: 'main' },
      head: { sha: 'b', ref: 'feat' },
    },
  },
  created_at: new Date().toISOString(),
}

beforeEach(() => {
  navigateMock.mockClear()
  isSavedMock = vi.fn().mockReturnValue(true)
})

function renderModal(event: GitHubFeedEvent, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <ActivityModal event={event} onClose={onClose} />
    </MemoryRouter>
  )
}

describe('ActivityModal', () => {
  it('renders the version label and major tag for a major release', () => {
    renderModal(releaseEvent)
    expect(screen.getByText('v19.0.0')).toBeInTheDocument()
    expect(screen.getByText('MAJOR UPDATE')).toBeInTheDocument()
  })

  it('renders the PR number and PR MERGED tag for a merged PR', () => {
    renderModal(prEvent)
    expect(screen.getByText('#1248')).toBeInTheDocument()
    expect(screen.getByText('PR MERGED')).toBeInTheDocument()
  })

  it('renders ReleaseModalContent for release events', () => {
    renderModal(releaseEvent)
    expect(screen.getByTestId('release-content')).toBeInTheDocument()
    expect(screen.queryByTestId('pr-content')).toBeNull()
  })

  it('renders PullRequestModalContent for PR events', () => {
    renderModal(prEvent)
    expect(screen.getByTestId('pr-content')).toBeInTheDocument()
    expect(screen.queryByTestId('release-content')).toBeNull()
  })

  it('calls onClose when × button is clicked', () => {
    const onClose = vi.fn()
    renderModal(releaseEvent, onClose)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal(releaseEvent, onClose)
    fireEvent.click(container.querySelector('.activity-modal-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when modal body is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal(releaseEvent, onClose)
    fireEvent.click(container.querySelector('.activity-modal')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Esc is pressed', () => {
    const onClose = vi.fn()
    renderModal(releaseEvent, onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Open in Library closes modal then navigates when repo is saved', () => {
    const onClose = vi.fn()
    isSavedMock = vi.fn().mockReturnValue(true)
    renderModal(releaseEvent, onClose)

    fireEvent.click(screen.getByText('Open in Library'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/library/repo/facebook/react')
    // Order check: onClose should be called before navigate
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0])
  })

  it('Open in Library is disabled when repo is not saved', () => {
    isSavedMock = vi.fn().mockReturnValue(false)
    renderModal(releaseEvent)
    const button = screen.getByText('Open in Library') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/save/i)
  })
})
