// src/hooks/useRepoStats.ts
import { useEffect, useState } from 'react'
import type { RepoStats } from '../types/repoStats'

export function useRepoStats(
  owner: string | undefined,
  name: string | undefined,
): RepoStats | 'loading' | 'error' {
  const [stats, setStats] = useState<RepoStats | 'loading' | 'error'>('loading')

  // Fires once per repo. The previous version had `lastReleaseDate` in its
  // deps, which caused a second full stats fetch (9 GitHub calls) the moment
  // releases resolved in RepoDetail. The renderer now recomputes the
  // release-affected score components client-side using `computeHealthScore`
  // and the `daysSinceCommit` field exposed in `RepoStats.health`.
  useEffect(() => {
    if (!owner || !name) { setStats('loading'); return }
    let cancelled = false
    setStats('loading')
    window.api.github.getRepoStats(owner, name)
      .then(s => { if (!cancelled) setStats(s) })
      .catch(() => { if (!cancelled) setStats('error') })
    return () => { cancelled = true }
  }, [owner, name])

  return stats
}
