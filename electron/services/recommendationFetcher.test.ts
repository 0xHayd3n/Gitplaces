// electron/services/recommendationFetcher.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserProfile } from '../../src/types/recommendation'
import type { GitHubRepo } from '../../electron/providers/github'

vi.mock('../providers/github', () => ({
  searchRepos: vi.fn(),
}))
import { searchRepos } from '../providers/github'
import { planQueries, fetchCandidates } from './recommendationFetcher'
import type { QueryPlan } from './recommendationFetcher'

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

// Alias used by the new test groups
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return emptyProfile(overrides)
}

import type { CorpusStats } from '../../src/types/recommendation'
function makeCorpus(idfMap: Record<string, number>): CorpusStats {
  return {
    topicDocFrequency: new Map(),
    topicIdf: new Map(Object.entries(idfMap)),
    descriptionDocFrequency: new Map(),
    descriptionIdf: new Map(),
    totalRepos: 1000,
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

// ── Legacy planQueries tests (adapted for new shape) ─────────────────────────

describe('planQueries (legacy)', () => {
  it('returns top 4 topics by affinity value', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([
        ['a', 0.30], ['b', 0.25], ['c', 0.20], ['d', 0.10],
        ['e', 0.08], ['f', 0.05], ['g', 0.02],
      ]),
    })
    const queries = planQueries(profile)
    const topicPlans = queries.filter(q => q.kind === 'topic')
    expect(topicPlans.length).toBe(4)
    expect(topicPlans.map((q) => q.topic)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns cold-start query when topicAffinity is empty', () => {
    const queries = planQueries(emptyProfile())
    expect(queries.length).toBe(1)
    expect(queries[0].coldStart).toBe(true)
    expect(queries[0].kind).toBe('coldStart')
  })
})

// ── fetchCandidates tests (adapted for new shape) ─────────────────────────────

describe('fetchCandidates', () => {
  it('calls searchRepos once per query with best-match sort for topic plans', async () => {
    mockSearch.mockResolvedValue([
      ghRepo({ id: 1, name: 'r1' }),
    ])
    const queries: QueryPlan[] = [
      { topic: 'rust', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
      { topic: 'cli', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
    ]
    await fetchCandidates('token', queries)
    expect(mockSearch).toHaveBeenCalledTimes(2)
    // Verify sort is empty/best-match and query format
    const call1 = mockSearch.mock.calls[0]
    expect(call1[1]).toBe('topic:rust stars:10..5000')
    expect(call1[3]).toBe('')  // sort: best-match
  })

  it('dedupes across topics by repo id', async () => {
    mockSearch
      .mockResolvedValueOnce([ghRepo({ id: 1 }), ghRepo({ id: 2 })])
      .mockResolvedValueOnce([ghRepo({ id: 2 }), ghRepo({ id: 3 })])
    const result = await fetchCandidates('token', [
      { topic: 'rust', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
      { topic: 'cli', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
    ])
    expect(result.map((r) => r.hostNativeId).sort()).toEqual([1, 2, 3])
  })

  it('executes cold-start query when kind is coldStart', async () => {
    mockSearch.mockResolvedValue([ghRepo({ id: 1 })])
    await fetchCandidates('token', [{ topic: '', kind: 'coldStart', coldStart: true, perPage: 100, sort: 'stars' }])
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
      { topic: 'a', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
      { topic: 'b', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
      { topic: 'c', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
    ])
    expect(result.map((r) => r.hostNativeId).sort()).toEqual([1, 3])
  })

  it('tags every GitHub candidate with hostId so the IPC upsert can write host_id', async () => {
    mockSearch.mockResolvedValueOnce([ghRepo({ id: 42 })])
    const result = await fetchCandidates('token', [
      { topic: 'rust', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].hostId).toBe('gh:api.github.com')
    expect(result[0].hostNativeId).toBe(42)
  })
})

// ── New planQueries (extended) tests ─────────────────────────────────────────

describe('planQueries (extended)', () => {
  it('emits topic queries for top-4 affinity topics', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4], ['cli', 0.3], ['parser', 0.2], ['async', 0.1], ['extra', 0.05]]),
    })
    const plans = planQueries(profile)
    const topicPlans = plans.filter(p => p.kind === 'topic')
    expect(topicPlans.length).toBe(4)
    expect(topicPlans.map(p => p.topic)).toEqual(['rust', 'cli', 'parser', 'async'])
  })

  it('emits subType queries for top-2 subTypes', () => {
    const profile = makeProfile({
      subTypeDistribution: new Map([['ai-coding', 0.5], ['cli-tool', 0.3], ['extra', 0.2]]),
      topicAffinity: new Map([['x', 1]]),
    })
    const plans = planQueries(profile)
    const subPlans = plans.filter(p => p.kind === 'subType')
    expect(subPlans.length).toBe(2)
  })

  it('does not emit a standalone language query (Fix E: noise source removed)', () => {
    const profile = makeProfile({
      languageWeights: new Map([['Rust', 0.6], ['Python', 0.4]]),
      topicAffinity: new Map([['x', 1]]),
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'language').length).toBe(0)
  })

  it('skips engagement queries when clickCount is 0', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1]]),
      engagement: {
        clickedTopicAffinity: new Map([['ai', 1]]),
        clickedOwnerAffinity: new Map(),
        clickedRepoIds: new Set(),
        clickCount: 0,
      },
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'engagement').length).toBe(0)
  })

  it('emits engagement queries from a single click (gate lowered to 1)', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1]]),
      engagement: {
        clickedTopicAffinity: new Map([['ai', 1]]),
        clickedOwnerAffinity: new Map(),
        clickedRepoIds: new Set(),
        clickCount: 1,
      },
    })
    const plans = planQueries(profile)
    const engagementPlans = plans.filter(p => p.kind === 'engagement')
    expect(engagementPlans.length).toBe(1)
    expect(engagementPlans[0].topic).toBe('ai')
  })

  it('emits engagement queries for top clicked topics not in user-affinity top', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1]]),
      engagement: {
        clickedTopicAffinity: new Map([['ai', 0.6], ['ml', 0.4]]),
        clickedOwnerAffinity: new Map(),
        clickedRepoIds: new Set(),
        clickCount: 5,
      },
    })
    const plans = planQueries(profile)
    const engagementPlans = plans.filter(p => p.kind === 'engagement')
    expect(engagementPlans.length).toBe(2)
    expect(engagementPlans.map(p => p.topic).sort()).toEqual(['ai', 'ml'])
  })

  it('cold-start when no topic affinity', () => {
    const plans = planQueries(makeProfile())
    expect(plans.length).toBe(1)
    expect(plans[0].coldStart).toBe(true)
    expect(plans[0].kind).toBe('coldStart')
  })

  it('emits a pair query when top-2 topics both have affinity >= 0.15', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4], ['cli', 0.3], ['extra', 0.05]]),
    })
    const plans = planQueries(profile)
    const pairs = plans.filter(p => p.kind === 'pair')
    expect(pairs.length).toBe(1)
    expect(pairs[0].topic).toBe('rust cli')           // composite key, executor reads it as the search query terms
  })

  it('skips pair query when second topic too weak', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.9], ['cli', 0.05]]),
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'pair').length).toBe(0)
  })

  // Fix D: high-IDF topic injection — rare topics from the user's stars
  // get their own query even when affinity ranking shadows them.
  it('emits rare-topic queries for top-IDF topics not in affinity top-4', () => {
    const profile = makeProfile({
      // Affinity top-4: a, b, c, d (high frequency × moderate IDF)
      // Rare topics: x, y (low frequency, present in user stars but ranked low by affinity)
      topicAffinity: new Map([
        ['a', 0.3], ['b', 0.25], ['c', 0.2], ['d', 0.1],
        ['x', 0.05], ['y', 0.04], ['common', 0.02],
      ]),
    })
    const corpus = makeCorpus({
      a: 2, b: 2, c: 2, d: 2,
      x: 9.5, y: 9.0, common: 0.5,
    })
    const plans = planQueries(profile, corpus)
    const rarePlans = plans.filter(p => p.kind === 'rareTopic')
    expect(rarePlans.length).toBe(2)
    expect(rarePlans.map(p => p.topic).sort()).toEqual(['x', 'y'])
  })

  it('rare-topic injection dedupes against affinity-picked topics', () => {
    const profile = makeProfile({
      // x is BOTH high-affinity (top-4) AND high-IDF — it should not double-emit.
      topicAffinity: new Map([
        ['x', 0.4], ['b', 0.25], ['c', 0.2], ['d', 0.1], ['y', 0.05],
      ]),
    })
    const corpus = makeCorpus({
      x: 9, y: 8.5, b: 2, c: 2, d: 2,
    })
    const plans = planQueries(profile, corpus)
    const rarePlans = plans.filter(p => p.kind === 'rareTopic')
    // x is already in top-4 affinity, so only y should be emitted
    expect(rarePlans.map(p => p.topic)).toEqual(['y'])
  })

  it('skips rare-topic injection when corpus is omitted', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['a', 0.3], ['x', 0.05]]),
    })
    const plans = planQueries(profile)  // no corpus
    expect(plans.filter(p => p.kind === 'rareTopic').length).toBe(0)
  })

  // Fix A: long-tail queries inject niche candidates by capping stars on the upside.
  it('emits long-tail queries for top-2 topics', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4], ['cli', 0.3], ['parser', 0.2], ['async', 0.1]]),
    })
    const plans = planQueries(profile)
    const longTailPlans = plans.filter(p => p.kind === 'longTail')
    expect(longTailPlans.length).toBe(2)
    expect(longTailPlans.map(p => p.topic).sort()).toEqual(['cli', 'rust'])
  })

  it('long-tail uses best-match sort and small perPage', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4]]),
    })
    const plans = planQueries(profile)
    const lt = plans.filter(p => p.kind === 'longTail')
    expect(lt.length).toBe(1)
    expect(lt[0].sort).toBe('')
    expect(lt[0].perPage).toBe(25)
  })

  it('long-tail emits with starCeiling = min(MAX, max(500, p75)) when strictly below cap', () => {
    const profileLow = makeProfile({
      topicAffinity: new Map([['rust', 0.4]]),
      starScale: { median: 100, p25: 50, p75: 200 },  // p75 below floor → ceiling = 500
    })
    expect(planQueries(profileLow).find(p => p.kind === 'longTail')!.starCeiling).toBe(500)

    const profileMid = makeProfile({
      topicAffinity: new Map([['rust', 0.4]]),
      starScale: { median: 500, p25: 200, p75: 3000 },  // p75 between floor and cap → ceiling = 3000
    })
    expect(planQueries(profileMid).find(p => p.kind === 'longTail')!.starCeiling).toBe(3000)
  })

  it('long-tail is NOT emitted when p75 ≥ MAX (would duplicate the topic query at the cap)', () => {
    const profileHigh = makeProfile({
      topicAffinity: new Map([['rust', 0.4]]),
      starScale: { median: 5000, p25: 1000, p75: 12000 },  // p75 above global cap
    })
    expect(planQueries(profileHigh).filter(p => p.kind === 'longTail').length).toBe(0)
  })

  it('emits exactly 1 long-tail when user has only 1 topic', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1.0]]),
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'longTail').length).toBe(1)
  })
})

// ── buildSearchQuery branches ──────────────────────────────────────────────────

describe('fetchCandidates — query string composition', () => {
  it('long-tail emits stars:10..N where N = max(500, p75)', async () => {
    mockSearch.mockResolvedValue([])
    // p75 = 800 → ceiling = max(500, 800) = 800
    const queries: QueryPlan[] = [
      { topic: 'rust', kind: 'longTail', coldStart: false, perPage: 25, sort: '', starCeiling: 800 },
    ]
    await fetchCandidates('token', queries)
    const call = mockSearch.mock.calls[0]
    expect(call[1]).toBe('topic:rust stars:10..800')
    expect(call[3]).toBe('')  // best-match
  })

  it('long-tail floors ceiling at 500 when p75 is small', async () => {
    mockSearch.mockResolvedValue([])
    const queries: QueryPlan[] = [
      { topic: 'rust', kind: 'longTail', coldStart: false, perPage: 25, sort: '', starCeiling: 500 },
    ]
    await fetchCandidates('token', queries)
    const call = mockSearch.mock.calls[0]
    expect(call[1]).toBe('topic:rust stars:10..500')
  })

  it('rareTopic uses topic:X stars:10..MAX (same as topic kind)', async () => {
    mockSearch.mockResolvedValue([])
    const queries: QueryPlan[] = [
      { topic: 'openclaw', kind: 'rareTopic', coldStart: false, perPage: 20, sort: '' },
    ]
    await fetchCandidates('token', queries)
    const call = mockSearch.mock.calls[0]
    expect(call[1]).toBe('topic:openclaw stars:10..5000')
  })

  it('global MAX_STAR_CEILING is applied to topic, pair, subType, engagement, rareTopic', async () => {
    mockSearch.mockResolvedValue([])
    const queries: QueryPlan[] = [
      { topic: 'rust', kind: 'topic', coldStart: false, perPage: 30, sort: '' },
      { topic: 'a b', kind: 'pair', coldStart: false, perPage: 25, sort: '' },
      { topic: 'cli tool', kind: 'subType', coldStart: false, perPage: 25, sort: '' },
      { topic: 'ai', kind: 'engagement', coldStart: false, perPage: 20, sort: '' },
      { topic: 'rare', kind: 'rareTopic', coldStart: false, perPage: 20, sort: '' },
    ]
    await fetchCandidates('token', queries)
    expect(mockSearch.mock.calls[0][1]).toBe('topic:rust stars:10..5000')
    expect(mockSearch.mock.calls[1][1]).toBe('topic:a topic:b stars:10..5000')
    expect(mockSearch.mock.calls[2][1]).toBe('cli tool stars:10..5000')
    expect(mockSearch.mock.calls[3][1]).toBe('topic:ai stars:10..5000')
    expect(mockSearch.mock.calls[4][1]).toBe('topic:rare stars:10..5000')
  })

  it('long-tail starCeiling clamps at the global MAX even for high-p75 users', async () => {
    mockSearch.mockResolvedValue([])
    // user p75 well above 5000; longTail should still cap at 5000
    const queries: QueryPlan[] = [
      { topic: 'rust', kind: 'longTail', coldStart: false, perPage: 25, sort: '', starCeiling: 5000 },
    ]
    await fetchCandidates('token', queries)
    expect(mockSearch.mock.calls[0][1]).toBe('topic:rust stars:10..5000')
  })

  it('cold-start is exempt from the global cap', async () => {
    mockSearch.mockResolvedValue([])
    const queries: QueryPlan[] = [
      { topic: '', kind: 'coldStart', coldStart: true, perPage: 100, sort: 'stars' },
    ]
    await fetchCandidates('token', queries)
    expect(mockSearch.mock.calls[0][1]).toBe('stars:>50000')
  })
})
