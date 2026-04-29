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
  const [events, setEvents] = useState<GitHubFeedEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async (login: string) => {
    setLoading(true)
    setError(null)
    try {
      const [received, feedRepos] = await Promise.all([
        window.api.github.getReceivedEvents(login) as Promise<GitHubFeedEvent[]>,
        window.api.github.getFeedRepos(),
      ])

      const cutoff = Date.now() - NINETY_DAYS_MS
      const releaseResults = await pMapSettled(
        feedRepos,
        RELEASE_FETCH_CONCURRENCY,
        ({ owner, name }) =>
          window.api.github.getReleases(owner, name).then(releases =>
            releases
              .filter(r => r.tag_name && new Date(r.published_at).getTime() > cutoff)
              .map((r): GitHubFeedEvent => ({
                id: `release-${owner}-${name}-${r.tag_name}`,
                type: 'ReleaseEvent',
                actor: { login: owner, avatar_url: `https://github.com/${owner}.png` },
                repo: { full_name: `${owner}/${name}` },
                payload: { release: { tag_name: r.tag_name, name: r.name, body: r.body } },
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

      const merged = [...received, ...repoReleases]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setEvents(merged)
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
