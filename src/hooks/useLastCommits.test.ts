import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLastCommits } from './useLastCommits'

beforeEach(() => {
  window.api = {
    github: {
      getLastCommitsForPaths: vi.fn(),
    },
  } as unknown as typeof window.api
})

describe('useLastCommits', () => {
  it('returns undefined for paths not yet fetched', () => {
    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    expect(result.current.get('src/foo.ts')).toBeUndefined()
  })

  it('fetches and stores last-commit info for a requested path', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: 'http://avatar', committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    ;(window.api.github.getLastCommitsForPaths as ReturnType<typeof vi.fn>).mockResolvedValue({ 'src/foo.ts': info })

    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])

    await waitFor(() => {
      expect(result.current.get('src/foo.ts')).toEqual(info)
    })
  })

  it('does not refetch a path that is already cached', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    const mockFn = window.api.github.getLastCommitsForPaths as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue({ 'src/foo.ts': info })

    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])
    await waitFor(() => expect(result.current.get('src/foo.ts')).toEqual(info))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])

    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('handles null results without erroring', async () => {
    ;(window.api.github.getLastCommitsForPaths as ReturnType<typeof vi.fn>).mockResolvedValue({ 'src/foo.ts': null })
    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])
    await waitFor(() => {
      expect(result.current.get('src/foo.ts')).toBeNull()
    })
  })

  it('batches multiple paths into one IPC call', async () => {
    const mockFn = window.api.github.getLastCommitsForPaths as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue({
      'src/a.ts': { message: 'a', author_login: null, author_avatar: null, committed_at: '2026-05-27T00:00:00Z', commit_sha: 'a1' },
      'src/b.ts': { message: 'b', author_login: null, author_avatar: null, committed_at: '2026-05-27T00:00:00Z', commit_sha: 'b1' },
    })

    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([
      { path: 'src/a.ts', sha: 'sha-a' },
      { path: 'src/b.ts', sha: 'sha-b' },
    ])

    await waitFor(() => {
      expect(result.current.get('src/a.ts')?.message).toBe('a')
      expect(result.current.get('src/b.ts')?.message).toBe('b')
    })
    expect(mockFn).toHaveBeenCalledTimes(1)
  })
})
