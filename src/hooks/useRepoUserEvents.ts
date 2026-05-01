import { useEffect, useState } from 'react'
import type { RepoUserEvent } from '../types/repoUserEvents'

export function useRepoUserEvents(
  owner: string | undefined,
  name: string | undefined,
): RepoUserEvent[] | 'loading' | 'error' {
  const [events, setEvents] = useState<RepoUserEvent[] | 'loading' | 'error'>('loading')
  useEffect(() => {
    if (!owner || !name) { setEvents([]); return }
    let cancelled = false
    setEvents('loading')
    window.api.github.getRepoUserEvents(owner, name)
      .then(e => { if (!cancelled) setEvents(e) })
      .catch(() => { if (!cancelled) setEvents('error') })
    return () => { cancelled = true }
  }, [owner, name])
  return events
}
