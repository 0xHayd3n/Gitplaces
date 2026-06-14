// src/hooks/useRepoStats.ts
import { useEffect, useRef, useState } from 'react'
import type { RepoStats } from '../types/repoStats'

export function useRepoStats(
  hostId: string,
  owner: string | undefined,
  name: string | undefined,
  // When false, the hook stays in 'loading' state without firing the IPC. This
  // lets callers defer the fetch until the data is actually visible — e.g. the
  // stats sidebar is only rendered on the Activities tab, so calling
  // `useRepoStats(hostId, owner, name, activeTab === 'activities')` avoids a
  // 9-call GitHub burst when the user lands on README/Files.
  enabled: boolean = true,
): RepoStats | 'loading' | 'error' {
  const [stats, setStats] = useState<RepoStats | 'loading' | 'error'>('loading')
  const fetchedRef = useRef<string | null>(null)

  // Reset when the target repo changes. Separate from the fetch effect so a
  // pure enabled flip doesn't clobber state.
  useEffect(() => {
    fetchedRef.current = null
    setStats('loading')
  }, [hostId, owner, name])

  // Fires once per (hostId, owner, name) once enabled. The previous version had
  // `lastReleaseDate` in its deps, which caused a second full stats fetch
  // (9 GitHub calls) the moment releases resolved in RepoDetail. The renderer
  // now recomputes the release-affected score components client-side using
  // `computeHealthScore` and the `daysSinceCommit` field on `RepoStats.health`.
  useEffect(() => {
    if (!owner || !name) return
    if (!enabled) return
    const key = `${hostId}|${owner}/${name}`
    if (fetchedRef.current === key) return
    fetchedRef.current = key

    let cancelled = false
    window.api.repo.getRepoStats(hostId, owner, name)
      .then(s => { if (!cancelled) setStats(s) })
      .catch(() => { if (!cancelled) setStats('error') })
    return () => { cancelled = true }
  }, [hostId, owner, name, enabled])

  return stats
}
