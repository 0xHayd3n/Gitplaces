import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useArchivedRepos } from './useArchivedRepos'

function makeSettingsApi(stored: string | null = null) {
  return {
    settings: {
      get: vi.fn().mockResolvedValue(stored),
      set: vi.fn().mockResolvedValue(undefined),
    },
    repo: {
      setArchivedAt: vi.fn().mockResolvedValue(undefined),
    },
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: makeSettingsApi(),
    writable: true,
    configurable: true,
  })
})

describe('useArchivedRepos', () => {
  it('starts with loading=true and empty set', () => {
    window.api.settings.get = vi.fn().mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useArchivedRepos())
    expect(result.current.loading).toBe(true)
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('loading becomes false after settings resolve', async () => {
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('loads stored archive keys from settings', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(JSON.stringify(['alice/repo1', 'bob/repo2']))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.has('alice/repo1')).toBe(true)
    expect(result.current.archivedSet.has('bob/repo2')).toBe(true)
  })

  it('treats null settings value as empty archive', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(null)
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('treats settings read error as empty archive', async () => {
    window.api.settings.get = vi.fn().mockRejectedValue(new Error('IPC error'))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('toggle adds a new key and writes to settings', async () => {
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggle('alice', 'myrepo'))
    expect(result.current.archivedSet.has('alice/myrepo')).toBe(true)
    expect(window.api.settings.set).toHaveBeenCalledWith(
      'archived_repos',
      JSON.stringify(['alice/myrepo'])
    )
  })

  it('toggle removes an existing key', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(JSON.stringify(['alice/myrepo']))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggle('alice', 'myrepo'))
    expect(result.current.archivedSet.has('alice/myrepo')).toBe(false)
    expect(window.api.settings.set).toHaveBeenCalledWith('archived_repos', JSON.stringify([]))
  })
})
