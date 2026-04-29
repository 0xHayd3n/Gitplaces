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
      const result = await window.api.github.getReceivedEvents(login) as GitHubFeedEvent[]
      setEvents(result)
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
