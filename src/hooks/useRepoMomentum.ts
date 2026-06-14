// src/hooks/useRepoMomentum.ts
import { useEffect, useState } from 'react'
import type { RepoStats } from '../types/repoStats'

type MomentumState = RepoStats['momentum'] | 'loading' | 'error'

// Lazy momentum fetch — only fires when `enabled` is true. RepoStatsSidebar
// flips it true the first time the user expands the Momentum collapsible,
// so a user who never opens that section pays no GitHub call for momentum.
// Once fetched, the result is cached on the main process for 6h.
export function useRepoMomentum(
  hostId: string,
  owner: string | undefined,
  name: string | undefined,
  enabled: boolean,
): MomentumState {
  const [momentum, setMomentum] = useState<MomentumState>('loading')

  useEffect(() => {
    if (!enabled || !owner || !name) return
    let cancelled = false
    setMomentum('loading')
    window.api.repo.getRepoMomentum(hostId, owner, name)
      .then(m => { if (!cancelled) setMomentum(m) })
      .catch(() => { if (!cancelled) setMomentum('error') })
    return () => { cancelled = true }
  }, [hostId, owner, name, enabled])

  return momentum
}
