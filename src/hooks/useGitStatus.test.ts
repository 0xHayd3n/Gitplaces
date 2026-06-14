import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGitStatus } from './useGitStatus'
import { HOST_ID_GITHUB } from '../lib/hostIds'

beforeEach(() => {
  window.api = {
    repo: {
      compareRefs: vi.fn(),
    },
  } as unknown as typeof window.api
})

describe('useGitStatus', () => {
  it('returns empty map when no base ref is set', () => {
    const { result } = renderHook(() =>
      useGitStatus({ hostId: HOST_ID_GITHUB, repoId: '1', owner: 'o', name: 'n', baseRef: null, headRef: 'main' }))
    expect(result.current.statusMap.size).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('fetches the diff when base ref is set', async () => {
    ;(window.api.repo.compareRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: 'src/foo.ts', status: 'modified' },
      { path: 'src/bar.ts', status: 'added' },
    ])
    const { result } = renderHook(() =>
      useGitStatus({ hostId: HOST_ID_GITHUB, repoId: '1', owner: 'o', name: 'n', baseRef: 'v1.0.0', headRef: 'main' }))

    await waitFor(() => {
      expect(result.current.statusMap.get('src/foo.ts')).toBe('modified')
      expect(result.current.statusMap.get('src/bar.ts')).toBe('added')
    })
  })

  it('sets error when fetch returns null', async () => {
    ;(window.api.repo.compareRefs as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { result } = renderHook(() =>
      useGitStatus({ hostId: HOST_ID_GITHUB, repoId: '1', owner: 'o', name: 'n', baseRef: 'v1.0.0', headRef: 'main' }))

    await waitFor(() => {
      expect(result.current.error).toBe('Compare failed')
    })
  })

  it('refetches when baseRef changes', async () => {
    const mockFn = window.api.repo.compareRefs as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue([{ path: 'src/a.ts', status: 'modified' }])

    const { result, rerender } = renderHook(
      (props: { baseRef: string }) =>
        useGitStatus({ hostId: HOST_ID_GITHUB, repoId: '1', owner: 'o', name: 'n', baseRef: props.baseRef, headRef: 'main' }),
      { initialProps: { baseRef: 'v1.0.0' } },
    )
    await waitFor(() => expect(result.current.statusMap.size).toBe(1))

    mockFn.mockResolvedValue([{ path: 'src/b.ts', status: 'added' }])
    rerender({ baseRef: 'v2.0.0' })

    await waitFor(() => expect(result.current.statusMap.get('src/b.ts')).toBe('added'))
  })
})
