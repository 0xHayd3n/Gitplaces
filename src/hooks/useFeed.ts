import { useState, useEffect, useCallback, useRef } from 'react'
import { useGitHubAuth } from '../contexts/GitHubAuth'

export interface GitHubFeedEvent {
  id: string
  type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
  actor: { login: string; avatar_url: string }
  repo: { full_name: string }
  payload: Record<string, unknown>
  created_at: string
}

interface FeedState {
  events: GitHubFeedEvent[]
  loading: boolean
  error: string | null
}

const POLL_MS = 5 * 60 * 1000
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const RELEASE_FETCH_CONCURRENCY = 6

// Module-level cache survives ActivityFeed unmount/remount within a session,
// so navigating away and back renders the previous feed instantly instead of
// flashing a skeleton while the next fetch resolves. The cache is hydrated
// from localStorage at module load and rewritten after every successful fetch
// so it also survives full app restarts — opening the app two days later
// shows the last-known feed first, then silently merges in anything new.
const STORAGE_KEY = 'feed-cache:v1'
const CACHE_EVENT_LIMIT = 200

interface PersistedCache {
  login: string
  events: GitHubFeedEvent[]
  cachedAt: number
}

function loadPersisted(): PersistedCache | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedCache
    if (!parsed || typeof parsed.login !== 'string' || !Array.isArray(parsed.events)) return null
    return parsed
  } catch {
    return null
  }
}

function savePersisted(cache: PersistedCache): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded or storage disabled — fall back to memory-only cache.
  }
}

const initialPersisted = loadPersisted()
let cachedEvents: GitHubFeedEvent[] = initialPersisted?.events ?? []
let cachedLogin: string | null = initialPersisted?.login ?? null

export function __resetFeedCache() {
  cachedEvents = []
  cachedLogin = null
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Bounded-concurrency Promise.allSettled. Workers share `cursor` but the
// `cursor++` runs synchronously before the await, so JS's single-threaded
// model makes the increment atomic — no extra locking needed.
async function pMapSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  return results
}

export function useFeed(): FeedState & { refresh: () => void } {
  const { user } = useGitHubAuth()
  const [events, setEvents] = useState<GitHubFeedEvent[]>(() =>
    user?.login && cachedLogin === user.login ? cachedEvents : [],
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async (login: string) => {
    setLoading(true)
    setError(null)
    try {
      const [receivedSettled, feedReposSettled] = await Promise.allSettled([
        window.api.github.getReceivedEvents(login) as Promise<GitHubFeedEvent[]>,
        window.api.github.getFeedRepos(),
      ])

      const received = receivedSettled.status === 'fulfilled' ? receivedSettled.value : []
      const feedRepos = feedReposSettled.status === 'fulfilled' ? feedReposSettled.value : []

      const cutoff = Date.now() - NINETY_DAYS_MS
      const releaseResults = await pMapSettled(
        feedRepos,
        RELEASE_FETCH_CONCURRENCY,
        ({ owner, name }) =>
          window.api.github.getReleases(owner, name).then(releases =>
            (releases ?? [])
              .filter(r => r.tag_name && new Date(r.published_at).getTime() > cutoff)
              .map((r): GitHubFeedEvent => ({
                id: `release-${owner}-${name}-${r.tag_name}`,
                type: 'ReleaseEvent',
                actor: { login: owner, avatar_url: `https://github.com/${owner}.png?size=200` },
                repo: { full_name: `${owner}/${name}` },
                payload: { release: { tag_name: r.tag_name, name: r.name, body: r.body, prerelease: r.prerelease } },
                created_at: r.published_at,
              }))
          ),
      )

      // Dedup repo-API releases against ReleaseEvents already in the received feed.
      // Composite key (repo + tag); skip null/undefined tags so untagged releases
      // from different repos don't collide on `repo::undefined`.
      const receivedKeys = new Set<string>()
      for (const e of received) {
        if (e.type !== 'ReleaseEvent') continue
        const tag = (e.payload as { release?: { tag_name?: string } }).release?.tag_name
        if (tag) receivedKeys.add(`${e.repo.full_name}::${tag}`)
      }

      const repoReleases = releaseResults
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(e => {
          const tag = (e.payload as { release: { tag_name: string } }).release.tag_name
          return !receivedKeys.has(`${e.repo.full_name}::${tag}`)
        })

      // Preserve cached events not in the fresh payload — keeps "where you left
      // off" intact across long gaps where the API window has rolled past older
      // entries. Only merge when the cache belongs to the current login.
      const fetched = [...received, ...repoReleases]
      const fetchedIds = new Set(fetched.map(e => e.id))
      const preserved = cachedLogin === login
        ? cachedEvents.filter(e => !fetchedIds.has(e.id))
        : []
      const merged = [...fetched, ...preserved]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      const anyFailure =
        receivedSettled.status === 'rejected' ||
        feedReposSettled.status === 'rejected' ||
        releaseResults.some(r => r.status === 'rejected')

      // Total failure: leave any cached events in place so the user keeps seeing
      // their last-known feed; surface the error for the empty-state path.
      // Partial success (or full success): replace events with what we got.
      if (merged.length === 0 && anyFailure) {
        setError('Couldn\'t load activity')
      } else {
        // Cap the cache so a long-running install doesn't grow localStorage
        // unboundedly across sessions. Already sorted newest-first, so the
        // slice keeps the most recent CACHE_EVENT_LIMIT events.
        const capped = merged.slice(0, CACHE_EVENT_LIMIT)
        setEvents(capped)
        cachedEvents = capped
        cachedLogin = login
        savePersisted({ login, events: capped, cachedAt: Date.now() })
      }
    } catch {
      setError('Couldn\'t load activity')
    } finally {
      setLoading(false)
    }
  }, [])

  const startPolling = useCallback((login: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchEvents(login), POLL_MS)
  }, [fetchEvents])

  const refresh = useCallback(() => {
    if (!user?.login) return
    fetchEvents(user.login)
    startPolling(user.login)
  }, [user?.login, fetchEvents, startPolling])

  useEffect(() => {
    if (!user?.login) return
    fetchEvents(user.login)
    startPolling(user.login)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user?.login, fetchEvents, startPolling])

  return { events, loading, error, refresh }
}
