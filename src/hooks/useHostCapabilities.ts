import { useEffect, useState } from 'react'

// Mirror of electron/providers/types.ts → ProviderCapabilities. Kept inline so
// the renderer doesn't have to import from the electron tree at runtime.
export interface ProviderCapabilities {
  vulnerabilityAlerts: boolean
  codeScanningAlerts: boolean
  events: boolean
  trendingDiscovery: boolean
  graphqlBundle: boolean
  isVerifiedOrg: boolean
}

// Module-level cache. Capabilities can change in-process when auth state for a
// host flips (e.g. a token that newly unlocks vulnerability alerts), so the
// main process broadcasts 'hosts:capabilities-changed' on setToken/clearToken;
// the hook listens and re-fetches the affected hostId.
const cache = new Map<string, ProviderCapabilities | null>()
const inflight = new Map<string, Promise<ProviderCapabilities | null>>()

export function _resetCapabilitiesCacheForTest(): void {
  cache.clear()
  inflight.clear()
}

export function clearCachedCapabilities(hostId: string): void {
  cache.delete(hostId)
  inflight.delete(hostId)
}

export function useHostCapabilities(hostId: string | null): ProviderCapabilities | null {
  const [caps, setCaps] = useState<ProviderCapabilities | null>(
    () => (hostId ? cache.get(hostId) ?? null : null),
  )
  // Bumped by the IPC-event subscription below; re-triggers the fetch effect.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!hostId) return
    const handler = (data: { hostId: string }) => {
      if (data?.hostId === hostId) {
        clearCachedCapabilities(hostId)
        setVersion(v => v + 1)
      }
    }
    const on = window.api?.hosts?.onCapabilitiesChanged
    const off = window.api?.hosts?.offCapabilitiesChanged
    if (typeof on !== 'function' || typeof off !== 'function') return
    on(handler)
    return () => { off(handler) }
  }, [hostId])

  useEffect(() => {
    if (!hostId) { setCaps(null); return }
    const cached = cache.get(hostId)
    if (cached !== undefined) { setCaps(cached); return }

    // Defensive: in test environments that don't fully mock window.api the
    // hosts namespace (or getCapabilities specifically) may be absent. Treat
    // that as "no capability information available" rather than crashing.
    const ipc = window.api?.hosts?.getCapabilities
    if (typeof ipc !== 'function') { setCaps(null); return }

    let cancelled = false
    let promise = inflight.get(hostId)
    if (!promise) {
      // Register the inflight entry BEFORE chaining `.then`/`.catch`. If we
      // chained first and then set, a concurrent caller landing between the
      // chain and the set would see no inflight entry, fire a duplicate IPC,
      // and overwrite our entry on its own set.
      promise = ipc(hostId)
        .then(c => { cache.set(hostId, c); inflight.delete(hostId); return c })
        .catch(() => { inflight.delete(hostId); return null })
      inflight.set(hostId, promise)
    }
    promise.then(c => { if (!cancelled) setCaps(c) })
    return () => { cancelled = true }
  }, [hostId, version])

  return caps
}
