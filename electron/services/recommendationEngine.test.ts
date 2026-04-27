// electron/services/recommendationEngine.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeTopicStats, buildUserProfile, scoreCandidate, findAnchors, rankCandidates } from './recommendationEngine'
import type { RepoRow } from '../../src/types/repo'
import type { UserProfile } from '../../src/types/recommendation'
import type { GitHubRepo } from '../../electron/github'

function repo(topics: string[]): { topics: string } {
  return { topics: JSON.stringify(topics) }
}

describe('computeTopicStats', () => {
  it('returns zeros for empty input', () => {
    const stats = computeTopicStats([])
    expect(stats.totalRepos).toBe(0)
    expect(stats.docFrequency.size).toBe(0)
    expect(stats.idf.size).toBe(0)
  })

  it('counts doc frequency per topic', () => {
    const stats = computeTopicStats([
      repo(['rust', 'cli']),
      repo(['rust', 'web']),
      repo(['python']),
    ])
    expect(stats.totalRepos).toBe(3)
    expect(stats.docFrequency.get('rust')).toBe(2)
    expect(stats.docFrequency.get('cli')).toBe(1)
    expect(stats.docFrequency.get('python')).toBe(1)
  })

  it('computes IDF with log(N / (1 + df))', () => {
    const stats = computeTopicStats([
      repo(['rust']),
      repo(['rust']),
      repo(['rust']),
      repo(['python']),
    ])
    // rust: log(4 / (1+3)) = log(1) = 0
    // python: log(4 / (1+1)) = log(2) ≈ 0.693
    expect(stats.idf.get('rust')).toBeCloseTo(0, 5)
    expect(stats.idf.get('python')).toBeCloseTo(Math.log(2), 5)
  })

  it('ignores repos with malformed topics JSON', () => {
    const stats = computeTopicStats([
      { topics: 'not json' },
      { topics: JSON.stringify(['rust']) },
    ])
    expect(stats.totalRepos).toBe(2)
    expect(stats.docFrequency.get('rust')).toBe(1)
  })
})

function makeRepo(overrides: Partial<RepoRow>): RepoRow {
  return {
    id: 'x', owner: 'o', name: 'n',
    description: null, language: null, license: null, homepage: null,
    topics: '[]', stars: 100, forks: null, watchers: null, size: null,
    open_issues: null, updated_at: null, pushed_at: null,
    saved_at: null, starred_at: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    default_branch: null, avatar_url: null, og_image_url: null,
    banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null,
    detected_language: null,
    verification_score: null, verification_tier: null,
    verification_signals: null, verification_checked_at: null,
    type_bucket: null, type_sub: null,
    ...overrides,
  } as RepoRow
}

const NOW = Date.UTC(2026, 3, 15)  // April 15, 2026
const DAY = 24 * 60 * 60 * 1000

describe('buildUserProfile', () => {
  const emptyStats = { docFrequency: new Map(), totalRepos: 0, idf: new Map() }

  it('returns cold-start profile for empty input', () => {
    const profile = buildUserProfile({ userRepos: [], topicStats: emptyStats, now: NOW })
    expect(profile.repoCount).toBe(0)
    expect(profile.topicAffinity.size).toBe(0)
    expect(profile.anchorPool).toEqual([])
    expect(profile.starScale).toEqual({ median: 0, p25: 0, p75: 0 })
  })

  it('topic affinity uses IDF weighting and normalizes to sum=1', () => {
    // User starred 2 repos. 'rust' has low IDF (common), 'mcp-server' has high IDF (rare).
    const stats = {
      totalRepos: 100,
      docFrequency: new Map([['rust', 50], ['mcp-server', 2]]),
      idf: new Map([
        ['rust', Math.log(100 / 51)],       // ≈ 0.673
        ['mcp-server', Math.log(100 / 3)],  // ≈ 3.506
      ]),
    }
    const userRepos = [
      makeRepo({ topics: JSON.stringify(['rust', 'mcp-server']), starred_at: new Date(NOW).toISOString() }),
      makeRepo({ topics: JSON.stringify(['rust']), starred_at: new Date(NOW).toISOString() }),
    ]
    const profile = buildUserProfile({ userRepos, topicStats: stats, now: NOW })
    const sum = [...profile.topicAffinity.values()].reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 5)
    // mcp-server should outweigh rust despite appearing less
    expect(profile.topicAffinity.get('mcp-server')!).toBeGreaterThan(profile.topicAffinity.get('rust')!)
  })

  it('recency decay: a 90-day-old star contributes ~0.5 of a fresh one', () => {
    // Use two distinct topics so normalization preserves their relative ratio.
    // 'fresh-topic' only appears in a fresh star; 'old-topic' only in a 90-day-old star.
    // Same IDF for both. After recency decay: fresh contributes 1.0, old contributes 0.5.
    // After normalization: fresh/old ratio should be ~2:1.
    const stats = {
      totalRepos: 10,
      docFrequency: new Map([['fresh-topic', 2], ['old-topic', 2]]),
      idf: new Map([['fresh-topic', 1], ['old-topic', 1]]),
    }
    const userRepos = [
      makeRepo({ id: '1', topics: JSON.stringify(['fresh-topic']), starred_at: new Date(NOW).toISOString() }),
      makeRepo({ id: '2', topics: JSON.stringify(['old-topic']), starred_at: new Date(NOW - 90 * DAY).toISOString() }),
    ]
    const profile = buildUserProfile({ userRepos, topicStats: stats, now: NOW })
    const fresh = profile.topicAffinity.get('fresh-topic')!
    const old = profile.topicAffinity.get('old-topic')!
    // Decay math: 0.5^(90/90) = 0.5, so ratio should be 2:1 after normalization
    expect(fresh / old).toBeCloseTo(2.0, 2)
  })

  it('bucket/subType/language distributions normalize to sum=1', () => {
    const userRepos = [
      makeRepo({ id: '1', type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'TypeScript' }),
      makeRepo({ id: '2', type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'TypeScript' }),
      makeRepo({ id: '3', type_bucket: 'dev-tools', type_sub: 'build-tool', language: 'Rust' }),
    ]
    const profile = buildUserProfile({ userRepos, topicStats: emptyStats, now: NOW })
    expect(profile.bucketDistribution.get('ai-ml')).toBeCloseTo(2 / 3, 5)
    expect(profile.bucketDistribution.get('dev-tools')).toBeCloseTo(1 / 3, 5)
    expect(profile.subTypeDistribution.get('ai-coding')).toBeCloseTo(2 / 3, 5)
    expect(profile.languageWeights.get('TypeScript')).toBeCloseTo(2 / 3, 5)
  })

  it('starScale returns median/p25/p75 percentiles', () => {
    const userRepos = [100, 500, 1000, 2000, 5000].map((stars, i) =>
      makeRepo({ id: String(i), stars })
    )
    const profile = buildUserProfile({ userRepos, topicStats: emptyStats, now: NOW })
    expect(profile.starScale.median).toBe(1000)
    expect(profile.starScale.p25).toBe(500)
    expect(profile.starScale.p75).toBe(2000)
  })

  it('anchorPool contains up to 20 most-recent signal-rich repos', () => {
    const userRepos = Array.from({ length: 30 }, (_, i) =>
      makeRepo({
        id: String(i),
        topics: JSON.stringify(['rust']),
        type_bucket: 'dev-tools',
        starred_at: new Date(NOW - i * DAY).toISOString(),
      })
    )
    const profile = buildUserProfile({ userRepos, topicStats: emptyStats, now: NOW })
    expect(profile.anchorPool.length).toBe(20)
    // Most recent first
    expect(profile.anchorPool[0].id).toBe('0')
  })

  it('anchorPool prioritizes signal-rich repos when recency is tied', () => {
    const richRepo = makeRepo({
      id: 'rich',
      topics: JSON.stringify(['rust', 'cli']),
      type_bucket: 'dev-tools',
      language: 'Rust',
      starred_at: new Date(NOW).toISOString(),
    })
    const poorRepo = makeRepo({
      id: 'poor',
      topics: '[]',
      type_bucket: null,
      language: null,
      starred_at: new Date(NOW).toISOString(),
    })
    const profile = buildUserProfile({ userRepos: [poorRepo, richRepo], topicStats: emptyStats, now: NOW })
    expect(profile.anchorPool[0].id).toBe('rich')
  })
})

function emptyProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    topicAffinity: new Map(),
    bucketDistribution: new Map(),
    subTypeDistribution: new Map(),
    languageWeights: new Map(),
    starScale: { median: 1000, p25: 500, p75: 2000 },
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

interface CandidateInput {
  topics: string[]
  type_bucket?: string | null
  type_sub?: string | null
  language?: string | null
  stars?: number
}

function cand(input: CandidateInput) {
  return {
    topics: input.topics,
    type_bucket: input.type_bucket ?? null,
    type_sub: input.type_sub ?? null,
    language: input.language ?? null,
    stars: input.stars ?? 1000,
  }
}

describe('scoreCandidate', () => {
  it('topicScore sums matching topicAffinity values, clamped to 1', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([['rust', 0.3], ['cli', 0.2]]),
    })
    const result = scoreCandidate(cand({ topics: ['rust', 'cli', 'other'] }), profile)
    expect(result.breakdown.topic).toBeCloseTo(0.5, 5)
  })

  it('topicScore clamps at 1.0', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([['a', 0.6], ['b', 0.6]]),
    })
    const result = scoreCandidate(cand({ topics: ['a', 'b'] }), profile)
    expect(result.breakdown.topic).toBeCloseTo(1.0, 5)
  })

  it('bucketScore looks up bucketDistribution', () => {
    const profile = emptyProfile({
      bucketDistribution: new Map([['ai-ml', 0.4]]),
    })
    const result = scoreCandidate(cand({ topics: [], type_bucket: 'ai-ml' }), profile)
    expect(result.breakdown.bucket).toBeCloseTo(0.4, 5)
  })

  it('bucketScore is 0 when bucket missing from profile', () => {
    const profile = emptyProfile({ bucketDistribution: new Map([['ai-ml', 0.4]]) })
    const result = scoreCandidate(cand({ topics: [], type_bucket: 'other' }), profile)
    expect(result.breakdown.bucket).toBe(0)
  })

  it('subTypeScore and languageScore follow the same pattern', () => {
    const profile = emptyProfile({
      subTypeDistribution: new Map([['ai-coding', 0.5]]),
      languageWeights: new Map([['TypeScript', 0.3]]),
    })
    const result = scoreCandidate(
      cand({ topics: [], type_sub: 'ai-coding', language: 'TypeScript' }),
      profile
    )
    expect(result.breakdown.subType).toBeCloseTo(0.5, 5)
    expect(result.breakdown.language).toBeCloseTo(0.3, 5)
  })

  it('starScaleScore peaks at user median, decays with log-distance', () => {
    const profile = emptyProfile({ starScale: { median: 1000, p25: 500, p75: 2000 } })
    const matching = scoreCandidate(cand({ topics: [], stars: 1000 }), profile)
    const distant = scoreCandidate(cand({ topics: [], stars: 1_000_000 }), profile)
    expect(matching.breakdown.scale).toBeCloseTo(1.0, 3)
    expect(distant.breakdown.scale).toBeLessThan(0.1)
  })

  it('composite score matches weighted sum of components', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([['rust', 1.0]]),
      bucketDistribution: new Map([['dev-tools', 1.0]]),
      subTypeDistribution: new Map([['build-tool', 1.0]]),
      languageWeights: new Map([['Rust', 1.0]]),
      starScale: { median: 1000, p25: 500, p75: 2000 },
    })
    const result = scoreCandidate(
      cand({ topics: ['rust'], type_bucket: 'dev-tools', type_sub: 'build-tool', language: 'Rust', stars: 1000 }),
      profile
    )
    // All components should be ~1.0, so composite = 0.35+0.30+0.15+0.10+0.10 = 1.0
    expect(result.score).toBeCloseTo(1.0, 2)
  })
})

describe('findAnchors', () => {
  const stats = {
    totalRepos: 100,
    docFrequency: new Map([['ai-agent', 5], ['common', 90]]),
    idf: new Map([
      ['ai-agent', Math.log(100 / 6)],   // ≈ 2.81
      ['common', Math.log(100 / 91)],    // ≈ 0.094 — below 0.2 threshold
    ]),
  }

  it('returns empty when anchor pool is empty', () => {
    const anchors = findAnchors(
      cand({ topics: ['ai-agent'] }),
      emptyProfile(),
      stats
    )
    expect(anchors).toEqual([])
  })

  it('picks anchor with shared rare topics', () => {
    const anchor = makeRepo({
      id: 'a1', owner: 'microsoft', name: 'autogen',
      topics: JSON.stringify(['ai-agent', 'llm']),
    })
    const profile = emptyProfile({ anchorPool: [anchor] })
    const anchors = findAnchors(
      cand({ topics: ['ai-agent', 'other'] }),
      profile,
      stats
    )
    expect(anchors.length).toBe(1)
    expect(anchors[0].name).toBe('autogen')
    expect(anchors[0].reasons).toContain('topic:ai-agent')
  })

  it('adds bucket/subType/language bumps to reasons when matched', () => {
    const anchor = makeRepo({
      id: 'a1', owner: 'o', name: 'a',
      topics: JSON.stringify(['ai-agent']),
      type_bucket: 'ai-ml',
      type_sub: 'ai-coding',
      language: 'Python',
    })
    const profile = emptyProfile({ anchorPool: [anchor] })
    const anchors = findAnchors(
      cand({
        topics: ['ai-agent'],
        type_bucket: 'ai-ml',
        type_sub: 'ai-coding',
        language: 'Python',
      }),
      profile,
      stats
    )
    expect(anchors[0].reasons).toEqual(
      expect.arrayContaining(['topic:ai-agent', 'bucket:ai-ml', 'sub:ai-coding', 'language:Python'])
    )
  })

  it('filters anchors below similarity threshold', () => {
    const weakAnchor = makeRepo({
      id: 'weak',
      topics: JSON.stringify(['common']),  // low IDF, no other matches
    })
    const profile = emptyProfile({ anchorPool: [weakAnchor] })
    const anchors = findAnchors(
      cand({ topics: ['common'], language: 'Go' }),
      profile,
      stats
    )
    expect(anchors).toEqual([])  // below 0.2 threshold
  })

  it('propagates avatar_url from the source RepoRow onto the Anchor', () => {
    const anchor = makeRepo({
      id: 'a1', owner: 'microsoft', name: 'autogen',
      topics: JSON.stringify(['ai-agent']),
      avatar_url: 'https://avatars.githubusercontent.com/u/6154722?v=4',
    })
    const profile = emptyProfile({ anchorPool: [anchor] })
    const anchors = findAnchors(
      cand({ topics: ['ai-agent'] }),
      profile,
      stats
    )
    expect(anchors.length).toBe(1)
    expect(anchors[0].avatar_url).toBe('https://avatars.githubusercontent.com/u/6154722?v=4')
  })

  it('anchor.avatar_url is null when source RepoRow.avatar_url is null', () => {
    const anchor = makeRepo({
      id: 'a2', owner: 'o', name: 'a',
      topics: JSON.stringify(['ai-agent']),
      avatar_url: null,
    })
    const profile = emptyProfile({ anchorPool: [anchor] })
    const anchors = findAnchors(
      cand({ topics: ['ai-agent'] }),
      profile,
      stats
    )
    expect(anchors.length).toBe(1)
    expect(anchors[0].avatar_url).toBeNull()
  })

  it('returns at most 3 anchors sorted by similarity desc', () => {
    const strongAnchor = makeRepo({
      id: 'strong', owner: 'o', name: 'strong',
      topics: JSON.stringify(['ai-agent']),
      type_bucket: 'ai-ml',
      type_sub: 'ai-coding',
      language: 'Python',
    })
    const mediumAnchor = makeRepo({
      id: 'medium', owner: 'o', name: 'medium',
      topics: JSON.stringify(['ai-agent']),
      type_bucket: 'ai-ml',
    })
    const okAnchor = makeRepo({
      id: 'ok', owner: 'o', name: 'ok',
      topics: JSON.stringify(['ai-agent']),
    })
    const extraAnchor = makeRepo({
      id: 'extra', owner: 'o', name: 'extra',
      topics: JSON.stringify(['ai-agent']),
    })
    const profile = emptyProfile({
      anchorPool: [okAnchor, extraAnchor, mediumAnchor, strongAnchor],
    })
    const anchors = findAnchors(
      cand({ topics: ['ai-agent'], type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'Python' }),
      profile,
      stats
    )
    expect(anchors.length).toBe(3)
    expect(anchors[0].name).toBe('strong')
    expect(anchors[1].name).toBe('medium')
  })
})

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

describe('rankCandidates', () => {
  const emptyStats = { totalRepos: 0, docFrequency: new Map(), idf: new Map() }

  it('returns empty array for empty candidates', () => {
    const items = rankCandidates([], emptyProfile(), emptyStats)
    expect(items).toEqual([])
  })

  it('sorts items by score descending', () => {
    const profile = emptyProfile({
      topicAffinity: new Map([['rust', 1.0]]),
    })
    const candidates = [
      ghRepo({ id: 1, name: 'match', topics: ['rust'] }),
      ghRepo({ id: 2, name: 'no-match', topics: ['python'] }),
    ]
    const items = rankCandidates(candidates, profile, emptyStats)
    expect(items[0].repo.name).toBe('match')
    expect(items[0].score).toBeGreaterThan(items[1].score)
  })

  it('attaches anchors and primaryAnchor', () => {
    const anchor = makeRepo({
      id: 'a', owner: 'microsoft', name: 'autogen',
      topics: JSON.stringify(['ai-agent']),
    })
    const stats = {
      totalRepos: 100,
      docFrequency: new Map([['ai-agent', 5]]),
      idf: new Map([['ai-agent', Math.log(100 / 6)]]),
    }
    const profile = emptyProfile({
      topicAffinity: new Map([['ai-agent', 1.0]]),
      anchorPool: [anchor],
    })
    const candidates = [ghRepo({ id: 1, topics: ['ai-agent'] })]
    const items = rankCandidates(candidates, profile, stats)
    expect(items[0].primaryAnchor?.name).toBe('autogen')
  })

  it('classifies candidates on the fly', () => {
    // A candidate whose topics should classify to ai-ml / ai-coding
    const profile = emptyProfile({
      bucketDistribution: new Map([['ai-ml', 1.0]]),
    })
    const candidates = [
      ghRepo({ id: 1, name: 'copilot', topics: ['ai-coding', 'llm'] }),
    ]
    const items = rankCandidates(candidates, profile, emptyStats)
    // If classification worked, bucket score > 0
    expect(items[0].scoreBreakdown.bucket).toBeGreaterThan(0)
  })
})
