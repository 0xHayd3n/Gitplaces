// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useHostCapabilities, _resetCapabilitiesCacheForTest, type ProviderCapabilities } from './useHostCapabilities'

const getCaps = vi.fn()

beforeEach(() => {
  _resetCapabilitiesCacheForTest()
  getCaps.mockReset()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = { hosts: { getCapabilities: getCaps } }
})

describe('useHostCapabilities', () => {
  it('returns null while loading and resolves to caps once IPC responds', async () => {
    getCaps.mockResolvedValue({
      vulnerabilityAlerts: true, codeScanningAlerts: true, events: true,
      trendingDiscovery: true, graphqlBundle: true, isVerifiedOrg: true,
    })
    const { result } = renderHook(() => useHostCapabilities('gh:api.github.com'))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.graphqlBundle).toBe(true))
  })

  it('caches by hostId — second mount reuses the resolved caps', async () => {
    getCaps.mockResolvedValue({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    await waitFor(() => expect(a.result.current?.graphqlBundle).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    const b = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    expect(b.result.current?.graphqlBundle).toBe(false)
    expect(getCaps).toHaveBeenCalledTimes(1)
  })

  it('returns null when the IPC returns null (unknown host)', async () => {
    getCaps.mockResolvedValue(null)
    const { result } = renderHook(() => useHostCapabilities('xx:unknown'))
    await waitFor(() => expect(getCaps).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('clearCachedCapabilities forces the next mount to refetch', async () => {
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    const { clearCachedCapabilities } = await import('./useHostCapabilities')
    clearCachedCapabilities('gl:gitlab.com')
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: true, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })

    const b = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    await waitFor(() => expect(b.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
  })

  it('refetches when the hosts:capabilities-changed IPC event fires for the mounted host', async () => {
    const listeners = new Set<(data: { hostId: string }) => void>()
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      hosts: {
        getCapabilities: getCaps,
        onCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.add(cb) },
        offCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.delete(cb) },
      },
    }
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: true, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    // Simulate the main process broadcasting that this host's caps changed.
    // Wrap in act() because the listener triggers a setState inside the hook.
    act(() => { listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' })) })

    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
  })

  it('in-flight fetch that resolves AFTER an eviction does not repopulate the cache', async () => {
    const { clearCachedCapabilities } = await import('./useHostCapabilities')
    // Build a manually-resolvable promise so we can interleave eviction and
    // resolution at known points.
    let resolveFirst: (v: ProviderCapabilities) => void = () => {}
    const firstFetch = new Promise<ProviderCapabilities>(res => { resolveFirst = res })
    getCaps.mockReturnValueOnce(firstFetch)

    const a = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    // Effect has started the IPC but it hasn't resolved yet.
    await Promise.resolve()
    expect(getCaps).toHaveBeenCalledTimes(1)

    // Eviction happens DURING the in-flight fetch.
    clearCachedCapabilities('gl:gitlab.com')

    // Now resolve the in-flight fetch with stale data.
    act(() => {
      resolveFirst({
        vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
        trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
      })
    })
    await Promise.resolve()

    // A second mount should NOT see the stale cached value — the eviction
    // moved the tick after the fetch started, so the stale .then guard
    // refused to write it to the cache. The second mount fires a fresh IPC.
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: true, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const b = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    await waitFor(() => expect(b.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
    // The first mount still observed its resolved (stale) caps because the
    // listener wasn't bumped — but the cache, which seeds future mounts, is
    // clean.
    void a  // keep ref so React doesn't warn about an unused render
  })

  it('ignores capabilities-changed events for other hosts', async () => {
    const listeners = new Set<(data: { hostId: string }) => void>()
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      hosts: {
        getCapabilities: getCaps,
        onCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.add(cb) },
        offCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.delete(cb) },
      },
    }
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gh:api.github.com'))
    await waitFor(() => expect(a.result.current).not.toBeNull())
    expect(getCaps).toHaveBeenCalledTimes(1)

    // Event fires for a different host — must NOT trigger a refetch.
    // act() wrap matches the sibling case; harmless when no state changes.
    act(() => { listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' })) })
    // Yield to the event loop so a hypothetical re-fetch would have started.
    await Promise.resolve()
    expect(getCaps).toHaveBeenCalledTimes(1)
  })
})
