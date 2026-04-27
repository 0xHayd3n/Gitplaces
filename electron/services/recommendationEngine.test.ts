// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { rankCandidates, findAnchors } from './recommendationEngine'
import { computeCorpusStats } from './corpusStats'
import { buildUserProfile } from './userProfile'
import type { GitHubRepo } from '../github'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

function userRepo(o: any) {
  return {
    id: 'u' + o.id, owner: o.owner ?? 'me', name: o.name ?? 'p',
    description: o.description ?? null, language: o.language ?? null,
    topics: JSON.stringify(o.topics ?? []), stars: o.stars ?? 100,
    starred_at: new Date(NOW).toISOString(), saved_at: null,
    pushed_at: new Date(NOW - 30 * DAY).toISOString(),
    type_bucket: o.bucket ?? null, type_sub: o.sub ?? null,
    forks: null, watchers: null, size: null, open_issues: null,
    updated_at: null, created_at: null, license: null, homepage: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    default_branch: 'main', avatar_url: null, og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null,
    verification_signals: null, verification_checked_at: null,
  }
}

function ghRepo(o: any): GitHubRepo {
  return {
    id: o.id, full_name: `${o.owner ?? 'oo'}/${o.name ?? 'rr'}`, name: o.name ?? 'rr',
    html_url: `https://github.com/${o.owner ?? 'oo'}/${o.name ?? 'rr'}`,
    owner: { login: o.owner ?? 'oo', avatar_url: '' },
    description: o.description ?? null, language: o.language ?? null,
    topics: o.topics ?? [], stargazers_count: o.stars ?? 100,
    forks_count: 0, watchers_count: 0, open_issues_count: 0, size: 0,
    license: null, homepage: null,
    updated_at: new Date(NOW).toISOString(),
    pushed_at: o.pushed_at ?? new Date(NOW - 10 * DAY).toISOString(),
    created_at: new Date(NOW - 365 * DAY).toISOString(),
    default_branch: 'main', archived: o.archived ?? false,
  }
}

describe('rankCandidates (orchestrator)', () => {
  it('produces complete ScoreBreakdown for each candidate', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'], language: 'Rust', bucket: 'dev-tools', sub: 'cli' })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [ghRepo({ id: 1, topics: ['rust'], language: 'Rust' })]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked.length).toBe(1)
    expect(ranked[0].scoreBreakdown).toMatchObject({
      topic:       expect.any(Number),
      description: expect.any(Number),
      bucket:      expect.any(Number),
      subType:     expect.any(Number),
      language:    expect.any(Number),
      scale:       expect.any(Number),
      freshness:   expect.any(Number),
      engagement:  expect.any(Number),
    })
  })

  it('ranks topic-matching candidate above non-matching', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['unrelated'] }),
      ghRepo({ id: 2, topics: ['rust'] }),
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked[0].repo.id).toBe(2)
  })

  it('archived repos rank below non-archived even with topic match', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['rust'], archived: true }),
      ghRepo({ id: 2, topics: ['rust'], archived: false }),
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked[0].repo.id).toBe(2)
  })

  it('filters out candidates with no anchors (Fix G: drop unexplainable recs)', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['rust'] }),                  // matches → anchor
      ghRepo({ id: 2, topics: ['totally-unrelated-xyz'] }), // no topic/bucket/lang match → no anchor
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked.map(r => r.repo.id)).toEqual([1])
  })

  it('falls back to top reranked when every candidate is anchorless (Fix G defensive)', () => {
    // User repo has no topics / no classification → anchorPool entries can't
    // produce anchors for any candidate. Result must not be empty.
    const userRepos = [userRepo({ id: 1, topics: [] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['anything'] }),
      ghRepo({ id: 2, topics: ['anything-else'] }),
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every(r => r.anchors.length === 0)).toBe(true)
  })

  it('applies MMR rerank — diverse pick beats near-duplicate', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust', 'cli'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['rust', 'cli'] }),
      ghRepo({ id: 2, topics: ['rust', 'cli'] }),       // near-duplicate of #1
      ghRepo({ id: 3, topics: ['rust', 'web'] }),       // diverse
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    // #1 first by score; #3 should appear before #2 due to MMR diversity
    expect(ranked[0].repo.id).toBe(1)
    const id3Pos = ranked.findIndex(r => r.repo.id === 3)
    const id2Pos = ranked.findIndex(r => r.repo.id === 2)
    expect(id3Pos).toBeLessThan(id2Pos)
  })
})

describe('anchor diversification', () => {
  it('spreads primaryAnchor across the result set when many user repos match', () => {
    // 5 user repos all tagged 'ai' — every candidate could anchor to any.
    // Without diversification, the most recent / most signal-rich repo wins
    // every time. With diversification, the anchor identities should spread.
    const userRepos = Array.from({ length: 5 }, (_, i) =>
      userRepo({ id: 100 + i, owner: `u${i}`, name: `r${i}`, topics: ['ai'] }),
    ) as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    // 10 candidates all tagged 'ai' — without diversification all 10 would
    // anchor to the same single user repo.
    const candidates = Array.from({ length: 10 }, (_, i) =>
      ghRepo({ id: i + 1, owner: `c${i}`, name: `cand-${i}`, topics: ['ai'] }),
    )
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    const primaryNames = ranked
      .map(r => r.primaryAnchor && `${r.primaryAnchor.owner}/${r.primaryAnchor.name}`)
      .filter((x): x is string => x !== null)
    expect(primaryNames.length).toBe(ranked.length)              // every card has a primary anchor
    expect(new Set(primaryNames).size).toBeGreaterThan(1)        // primary anchors are not all identical
  })
})

describe('findAnchors', () => {
  it('returns up to 3 anchors sorted by similarity', () => {
    const userRepos = [
      userRepo({ id: 1, owner: 'a', name: 'a1', topics: ['rust', 'cli'] }),
      userRepo({ id: 2, owner: 'b', name: 'b1', topics: ['rust'] }),
    ] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const cand = { topics: ['rust', 'cli'], type_bucket: null, type_sub: null, language: null, stars: 100, owner: 'x' }
    const anchors = findAnchors(cand, profile, corpus)
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors[0].similarity).toBeGreaterThanOrEqual(anchors[anchors.length - 1].similarity)
  })
})
