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

vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: { login: 'octocat' } }),
}))

const { useFeed, __resetFeedCache } = await import('./useFeed')

afterEach(() => {
  vi.clearAllMocks()
  __resetFeedCache()
})

describe('useFeed synthesized releases', () => {
  it('carries prerelease flag from getReleases into the event payload', async () => {
    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValue([
      {
        tagName: 'v1.0.0-rc.1',
        name: 'RC',
        publishedAt: new Date().toISOString(),
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

describe('useFeed session cache', () => {
  it('initializes from the cache on remount so the feed renders without a loading flash', async () => {
    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValue([
      {
        tagName: 'v1.0.0',
        name: 'first',
        publishedAt: new Date().toISOString(),
        body: '',
        assets: [],
        prerelease: false,
      },
    ])

    const first = renderHook(() => useFeed())
    await waitFor(() => expect(first.result.current.events).toHaveLength(1))
    first.unmount()

    const second = renderHook(() => useFeed())
    expect(second.result.current.events).toHaveLength(1)
    // The second mount triggers a silent background refresh. Drain it before
    // the test ends so its late write to the module cache + localStorage
    // doesn't leak past afterEach into the next test.
    await waitFor(() => expect(mockGetReleases).toHaveBeenCalledTimes(2))
    second.unmount()
  })

  it('persists the merged feed to localStorage so it survives app restarts', async () => {
    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValue([
      {
        tagName: 'v3.0.0',
        name: 'persistent',
        publishedAt: new Date().toISOString(),
        body: '',
        assets: [],
        prerelease: false,
      },
    ])

    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.events).toHaveLength(1))

    const raw = localStorage.getItem('feed-cache:v1')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!)
    expect(stored.login).toBe('octocat')
    expect(stored.events).toHaveLength(1)
    expect(stored.events[0].id).toBe('release-a-b-v3.0.0')
    expect(typeof stored.cachedAt).toBe('number')
  })

  it('merges fresh fetch with cached events not in the new payload', async () => {
    const olderRelease = {
      tagName: 'v1.0.0',
      name: 'older',
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
      body: '',
      assets: [],
      prerelease: false,
    }
    const newerRelease = {
      tagName: 'v2.0.0',
      name: 'newer',
      publishedAt: new Date().toISOString(),
      body: '',
      assets: [],
      prerelease: false,
    }

    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValueOnce([olderRelease])

    const first = renderHook(() => useFeed())
    await waitFor(() => expect(first.result.current.events).toHaveLength(1))
    first.unmount()

    // Second mount fetches a payload that no longer contains the older release.
    mockGetReleases.mockResolvedValueOnce([newerRelease])
    const second = renderHook(() => useFeed())
    await waitFor(() => expect(second.result.current.events).toHaveLength(2))

    const ids = second.result.current.events.map(e => e.id)
    expect(ids).toContain('release-a-b-v1.0.0')
    expect(ids).toContain('release-a-b-v2.0.0')
    // Newer first.
    expect(second.result.current.events[0].id).toBe('release-a-b-v2.0.0')
  })
})
