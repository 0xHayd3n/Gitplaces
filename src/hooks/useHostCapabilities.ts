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

// Module-level cache: provider capabilities don't change in-process, so first
// fetch wins forever. Renderer hooks reuse the resolved promise so concurrent
// callers don't fan out to multiple IPC round-trips.
const cache = new Map<string, ProviderCapabilities | null>()
const inflight = new Map<string, Promise<ProviderCapabilities | null>>()

export function _resetCapabilitiesCacheForTest(): void {
  cache.clear()
  inflight.clear()
}

export function useHostCapabilities(hostId: string | null): ProviderCapabilities | null {
  const [caps, setCaps] = useState<ProviderCapabilities | null>(
    () => (hostId ? cache.get(hostId) ?? null : null),
  )

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
    const existing = inflight.get(hostId)
    const promise = existing ?? ipc(hostId)
      .then(c => { cache.set(hostId, c); inflight.delete(hostId); return c })
      .catch(() => { inflight.delete(hostId); return null })
    inflight.set(hostId, promise)
    promise.then(c => { if (!cancelled) setCaps(c) })
    return () => { cancelled = true }
  }, [hostId])

  return caps
}
