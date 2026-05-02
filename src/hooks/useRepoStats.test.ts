// src/hooks/useRepoStats.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import type { RepoStats } from '../types/repoStats'

const mockGetRepoStats = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: { github: { getRepoStats: mockGetRepoStats } },
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
  },
  momentum: { monthlyCommits: [10, 20, 15, 30, 25, 40], trend: 'up' },
  security: {
    available: true,
    vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 2 },
    hasSecurityPolicy: true, codeScanningEnabled: false, alerts: null,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: null, skillsLearned: 2 },
}

describe('useRepoStats', () => {
  it('returns loading immediately without calling IPC when owner is undefined', () => {
    const { result } = renderHook(() => useRepoStats(undefined, 'repo', null))
    expect(result.current).toBe('loading')
    expect(mockGetRepoStats).not.toHaveBeenCalled()
  })

  it('transitions from loading to stats on success', async () => {
    mockGetRepoStats.mockResolvedValueOnce(mockStats)
    const { result } = renderHook(() => useRepoStats('owner', 'repo', null))
    expect(result.current).toBe('loading')
    await waitFor(() => expect(result.current).toEqual(mockStats))
  })

  it('transitions to error when IPC rejects', async () => {
    mockGetRepoStats.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useRepoStats('owner', 'repo', null))
    await waitFor(() => expect(result.current).toBe('error'))
  })
})
