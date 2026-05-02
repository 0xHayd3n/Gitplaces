// src/hooks/useRepoStats.ts
import { useEffect, useState } from 'react'
import type { RepoStats } from '../types/repoStats'

export function useRepoStats(
  owner: string | undefined,
  name: string | undefined,
  lastReleaseDate: string | null,
): RepoStats | 'loading' | 'error' {
  const [stats, setStats] = useState<RepoStats | 'loading' | 'error'>('loading')

  useEffect(() => {
    if (!owner || !name) { setStats('loading'); return }
    let cancelled = false
    setStats('loading')
    window.api.github.getRepoStats(owner, name, lastReleaseDate)
      .then(s  => { if (!cancelled) setStats(s ?? 'error') })
      .catch(() => { if (!cancelled) setStats('error') })
    return () => { cancelled = true }
  }, [owner, name, lastReleaseDate])

  return stats
}
