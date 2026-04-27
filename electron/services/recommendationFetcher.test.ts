// electron/services/recommendationFetcher.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserProfile } from '../../src/types/recommendation'
import type { GitHubRepo } from '../../electron/github'

vi.mock('../github', () => ({
  searchRepos: vi.fn(),
}))
import { searchRepos } from '../github'
import { planQueries, fetchCandidates } from './recommendationFetcher'

const mockSearch = searchRepos as unknown as ReturnType<typeof vi.fn>

function emptyProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    topicAffinity: new Map(),
    bucketDistribution: new Map(),
    subTypeDistribution: new Map(),
    languageWeights: new Map(),
    starScale: { median: 100, p25: 50, p75: 200 },
    anchorPool: [],
    repoCount: 0,
    descriptionAffinity: new Map(),
    freshnessPreference: 365,
    engagement: {
      clickedTopicAffinity: new Map(),
      clickedOwnerAffinity: new Map(),
      clickedRepoIds: new Set(),
      clickCount: 0,
    },
    ...overrides,
  }
}

function ghRepo(overrides: Partial<GitHubRepo>): GitHubRepo {
  return {
    id: 1, node_id: 'n', owner: { login: 'o' }, name: 'n',
    full_name: 'o/n', description: null, language: null, license: null,
    homepage: null, topics: [], stargazers_count: 100,
    forks_count: 0, watchers_count: 0, size: 0, open_issues_count: 0,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  } as unknown as GitHubRepo
}

beforeEach(() => {
  mockSearch.mockReset()
})

describe('planQueries', () => {
  it('returns top 5 topics by affinity value', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([
        ['a', 0.30], ['b', 0.25], ['c', 0.20], ['d', 0.10],
        ['e', 0.08], ['f', 0.05], ['g', 0.02],
      ]),
    })
    const queries = planQueries(profile)
    expect(queries.length).toBe(5)
    expect(queries.map((q) => q.topic)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns cold-start query when topicAffinity is empty', () => {
    const queries = planQueries(emptyProfile())
    expect(queries.length).toBe(1)
    expect(queries[0].coldStart).toBe(true)
  })
})

describe('fetchCandidates', () => {
  it('calls searchRepos once per query with best-match sort', async () => {
    mockSearch.mockResolvedValue([
      ghRepo({ id: 1, name: 'r1' }),
    ])
    const queries = [
      { topic: 'rust', coldStart: false },
      { topic: 'cli', coldStart: false },
    ]
    await fetchCandidates('token', queries)
    expect(mockSearch).toHaveBeenCalledTimes(2)
    // Verify sort is empty/best-match and query format
    const call1 = mockSearch.mock.calls[0]
    expect(call1[1]).toBe('topic:rust stars:>10')
    expect(call1[3]).toBe('')  // sort: best-match
  })

  it('dedupes across topics by repo id', async () => {
    mockSearch
      .mockResolvedValueOnce([ghRepo({ id: 1 }), ghRepo({ id: 2 })])
      .mockResolvedValueOnce([ghRepo({ id: 2 }), ghRepo({ id: 3 })])
    const result = await fetchCandidates('token', [
      { topic: 'rust', coldStart: false },
      { topic: 'cli', coldStart: false },
    ])
    expect(result.map((r) => r.id).sort()).toEqual([1, 2, 3])
  })

  it('executes cold-start query when coldStart flag is set', async () => {
    mockSearch.mockResolvedValue([ghRepo({ id: 1 })])
    await fetchCandidates('token', [{ topic: '', coldStart: true }])
    const call = mockSearch.mock.calls[0]
    expect(call[1]).toBe('stars:>50000')
    expect(call[3]).toBe('stars')  // cold-start uses popularity sort
  })

  it('skips failed queries and returns partial results', async () => {
    mockSearch
      .mockResolvedValueOnce([ghRepo({ id: 1 })])
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce([ghRepo({ id: 3 })])
    const result = await fetchCandidates('token', [
      { topic: 'a', coldStart: false },
      { topic: 'b', coldStart: false },
      { topic: 'c', coldStart: false },
    ])
    expect(result.map((r) => r.id).sort()).toEqual([1, 3])
  })
})
