import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLastCommits } from './useLastCommits'

beforeEach(() => {
  // @ts-expect-error global stub
  window.api = {
    github: {
      getLastCommitForPath: vi.fn(),
    },
  }
})

describe('useLastCommits', () => {
  it('returns undefined for paths not yet fetched', () => {
    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    expect(result.current.get('src/foo.ts')).toBeUndefined()
  })

  it('fetches and stores last-commit info for a requested path', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: 'http://avatar', committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    ;(window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>).mockResolvedValue(info)

    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])

    await waitFor(() => {
      expect(result.current.get('src/foo.ts')).toEqual(info)
    })
  })

  it('does not refetch a path that is already cached', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    const mockFn = window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue(info)

    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])
    await waitFor(() => expect(result.current.get('src/foo.ts')).toEqual(info))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])  // request again

    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('handles null results without erroring', async () => {
    ;(window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { result } = renderHook(() => useLastCommits({ repoId: '1', owner: 'o', name: 'n', ref: 'main' }))
    result.current.request([{ path: 'src/foo.ts', sha: 'sha1' }])
    await waitFor(() => {
      // null result is stored as a sentinel (not undefined) so we know we already tried.
      expect(result.current.get('src/foo.ts')).toBeNull()
    })
  })
})
