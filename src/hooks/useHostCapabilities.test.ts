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
})
