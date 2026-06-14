// src/hooks/useRepoStats.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { HOST_ID_GITHUB } from '../lib/hostIds'
import type { RepoStats } from '../types/repoStats'

const mockGetRepoStats = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: { repo: { getRepoStats: mockGetRepoStats } },
    configurable: true,
  })
})

afterEach(() => {
  mockGetRepoStats.mockReset()
})

// Import after window.api is defined
const { useRepoStats } = await import('./useRepoStats')

const mockStats: RepoStats = {
  vitals: { stars: 100, forks: 10, openIssues: 5, contributors: 20 },
  health: {
    score: 90, maintenance: 'active', issueVelocity: 'healthy',
    lastReleaseDate: '2026-04-01T00:00:00Z', lastReleaseDaysAgo: 31,
    daysSinceCommit: 3,
  },
  momentum: { monthlyCommits: [10, 20, 15, 30, 25, 40], trend: 'up' },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 2 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: false,
    secretScanning: null,
    alerts: null,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: null, skillsLearned: 2 },
}

describe('useRepoStats', () => {
  it('returns loading immediately without calling IPC when owner is undefined', () => {
    const { result } = renderHook(() => useRepoStats(HOST_ID_GITHUB, undefined, 'repo'))
    expect(result.current).toBe('loading')
    expect(mockGetRepoStats).not.toHaveBeenCalled()
  })

  it('transitions from loading to stats on success', async () => {
    mockGetRepoStats.mockResolvedValueOnce(mockStats)
    const { result } = renderHook(() => useRepoStats(HOST_ID_GITHUB, 'owner', 'repo'))
    expect(result.current).toBe('loading')
    await waitFor(() => expect(result.current).toEqual(mockStats))
  })

  it('transitions to error when IPC rejects', async () => {
    mockGetRepoStats.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useRepoStats(HOST_ID_GITHUB, 'owner', 'repo'))
    await waitFor(() => expect(result.current).toBe('error'))
  })

  it('shows loading skeleton when navigating to a different repo', async () => {
    mockGetRepoStats.mockResolvedValueOnce(mockStats)
    const { result, rerender } = renderHook(
      ({ owner, name }: { owner: string; name: string }) => useRepoStats(HOST_ID_GITHUB, owner, name),
      { initialProps: { owner: 'a', name: 'r1' } },
    )
    await waitFor(() => expect(result.current).toEqual(mockStats))

    mockGetRepoStats.mockResolvedValueOnce(mockStats)
    rerender({ owner: 'b', name: 'r2' })

    // Different repo → previous data is irrelevant, show loading
    expect(result.current).toBe('loading')
  })

  // Regression: previously the hook took `lastReleaseDate` as a third
  // dependency, which caused a second full stats fetch (~9 GitHub calls) the
  // moment releases resolved in RepoDetail. The hook must now fetch exactly
  // ONCE per repo regardless of when releases land — the renderer recomputes
  // the score client-side via `computeHealthScore`.
  it('fetches stats exactly once per repo (no second fetch tied to releases)', async () => {
    mockGetRepoStats.mockResolvedValue(mockStats)
    const { rerender } = renderHook(
      ({ owner, name }: { owner: string; name: string }) => useRepoStats(HOST_ID_GITHUB, owner, name),
      { initialProps: { owner: 'owner', name: 'repo' } },
    )
    // Re-render the same repo a few times — should not trigger more IPC calls.
    rerender({ owner: 'owner', name: 'repo' })
    rerender({ owner: 'owner', name: 'repo' })
    await waitFor(() => expect(mockGetRepoStats).toHaveBeenCalledTimes(1))
  })
})
