import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mockGetReceivedEvents = vi.fn()
const mockGetFeedRepos = vi.fn()
const mockGetReleases = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: {
      github: {
        getReceivedEvents: mockGetReceivedEvents,
        getFeedRepos: mockGetFeedRepos,
        getReleases: mockGetReleases,
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: { login: 'octocat' } }),
}))

const { useFeed } = await import('./useFeed')

describe('useFeed synthesized releases', () => {
  it('carries prerelease flag from getReleases into the event payload', async () => {
    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValue([
      {
        tag_name: 'v1.0.0-rc.1',
        name: 'RC',
        published_at: new Date().toISOString(),
        body: 'notes',
        assets: [],
        prerelease: true,
      },
    ])

    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.events).toHaveLength(1))

    const event = result.current.events[0]
    expect(event.type).toBe('ReleaseEvent')
    const release = (event.payload as { release: { prerelease?: boolean } }).release
    expect(release.prerelease).toBe(true)
  })
})
