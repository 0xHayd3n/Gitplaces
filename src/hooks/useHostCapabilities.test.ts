// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHostCapabilities, _resetCapabilitiesCacheForTest } from './useHostCapabilities'

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
    listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' }))

    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
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
    listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' }))
    // Yield to the event loop so a hypothetical re-fetch would have started.
    await Promise.resolve()
    expect(getCaps).toHaveBeenCalledTimes(1)
  })
})
