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

// Eviction tick per hostId — monotonically increases each time the cache for
// that host is cleared. Lets hooks that mount AFTER an eviction see a
// non-zero initial version (so their fetch effect fires correctly), and lets
// in-flight fetches detect "I started before an eviction" and avoid
// repopulating the cache with stale data.
const evictionTick = new Map<string, number>()

function tickOf(hostId: string): number {
  return evictionTick.get(hostId) ?? 0
}

export function _resetCapabilitiesCacheForTest(): void {
  cache.clear()
  inflight.clear()
  evictionTick.clear()
}

export function clearCachedCapabilities(hostId: string): void {
  cache.delete(hostId)
  inflight.delete(hostId)
  evictionTick.set(hostId, tickOf(hostId) + 1)
}

export function useHostCapabilities(hostId: string | null): ProviderCapabilities | null {
  const [caps, setCaps] = useState<ProviderCapabilities | null>(
    () => (hostId ? cache.get(hostId) ?? null : null),
  )
  // Initialize from the module-level tick. If eviction happened before this
  // mount (e.g. another hook instance cleared the cache between component
  // creation and effect run), a non-zero starting version means the fetch
  // effect's [hostId, version] dep array will have the right value on first
  // run without needing a setVersion catch-up.
  const [version, setVersion] = useState<number>(
    () => hostId ? tickOf(hostId) : 0,
  )

  useEffect(() => {
    if (!hostId) return
    const handler = (data: { hostId: string }) => {
      if (data?.hostId === hostId) {
        clearCachedCapabilities(hostId)
        setVersion(tickOf(hostId))
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
      const startTick = tickOf(hostId)
      promise = ipc(hostId)
        .then(c => {
          // Only commit to the cache if no eviction happened during the
          // fetch — otherwise the value was computed against pre-eviction
          // auth state and would re-stale the cache as soon as it lands.
          if (tickOf(hostId) === startTick) cache.set(hostId, c)
          inflight.delete(hostId)
          return c
        })
        .catch(() => { inflight.delete(hostId); return null })
      inflight.set(hostId, promise)
    }
    promise.then(c => { if (!cancelled) setCaps(c) })
    return () => { cancelled = true }
  }, [hostId, version])

  return caps
}
