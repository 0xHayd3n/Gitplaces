// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mmrRerank, repoSimilarity, starTier } from './diversityReranker'

interface Item {
  score: number
  repo: { id: string; topics: string[]; bucket: string | null; sub: string | null; language: string | null; tier: number }
}

function item(
  id: string,
  score: number,
  topics: string[] = [],
  bucket: string | null = null,
  sub: string | null = null,
  language: string | null = null,
  tier = 0,
): Item {
  return { score, repo: { id, topics, bucket, sub, language, tier } }
}

describe('starTier', () => {
  it('buckets stars by log10', () => {
    expect(starTier(0)).toBe(0)         // 0..9
    expect(starTier(9)).toBe(0)
    expect(starTier(10)).toBe(1)        // 10..99
    expect(starTier(99)).toBe(1)
    expect(starTier(100)).toBe(2)       // 100..999
    expect(starTier(1_000)).toBe(3)     // 1k..10k
    expect(starTier(10_000)).toBe(4)    // 10k..100k
    expect(starTier(100_000)).toBe(5)   // 100k+
  })
})

describe('repoSimilarity', () => {
  it('identical repos → 1.0', () => {
    const a = { topics: ['rust', 'cli'], bucket: 'dev-tools', sub: 'cli', language: 'Rust', tier: 3 }
    expect(repoSimilarity(a, a)).toBeCloseTo(1, 5)
  })
  it('disjoint → 0', () => {
    const a = { topics: ['rust'], bucket: 'a', sub: 'a1', language: 'Rust', tier: 1 }
    const b = { topics: ['python'], bucket: 'b', sub: 'b1', language: 'Python', tier: 4 }
    expect(repoSimilarity(a, b)).toBe(0)
  })
  it('partial topic overlap (different tier)', () => {
    const a = { topics: ['rust', 'cli'], bucket: null, sub: null, language: null, tier: 2 }
    const b = { topics: ['rust', 'web'], bucket: null, sub: null, language: null, tier: 5 }
    // jaccard = 1/3 ≈ 0.333; * 0.5 ≈ 0.167; tiers differ → no tier bump
    expect(repoSimilarity(a, b)).toBeCloseTo(0.167, 2)
  })
  it('same tier adds similarity bump (so MMR prefers cross-tier)', () => {
    const a = { topics: ['rust'], bucket: null, sub: null, language: null, tier: 4 }
    const b = { topics: ['python'], bucket: null, sub: null, language: null, tier: 4 }
    // No topic/bucket/sub/lang overlap; only tier match → 0.15
    expect(repoSimilarity(a, b)).toBeCloseTo(0.15, 5)
  })
})

describe('mmrRerank', () => {
  it('first pick is the top-scored item', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.8, ['python']),
      item('c', 0.5, ['ai']),
    ]
    const result = mmrRerank(items, { topK: 3, lambda: 0.7 })
    expect(result[0].repo.id).toBe('a')
  })

  it('λ=1 → pure relevance order', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.8, ['rust']),
      item('c', 0.5, ['rust']),
    ]
    const result = mmrRerank(items, { topK: 3, lambda: 1 })
    expect(result.map(r => r.repo.id)).toEqual(['a', 'b', 'c'])
  })

  it('λ=0.7 prefers diverse second pick', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.85, ['rust']),                  // very similar to a, slightly lower score
      item('c', 0.7,  ['python', 'web']),         // diverse, lower score
    ]
    const result = mmrRerank(items, { topK: 2, lambda: 0.5 })
    expect(result[0].repo.id).toBe('a')
    expect(result[1].repo.id).toBe('c')
  })

  it('respects topK', () => {
    const items = [item('a', 0.9), item('b', 0.8), item('c', 0.7)]
    const result = mmrRerank(items, { topK: 2, lambda: 0.7 })
    expect(result.length).toBe(2)
  })

  it('prefers cross-tier picks when tiers differ', () => {
    // a (tier 5, 100k+) is top. b is similar to a in everything including tier.
    // c is in a different tier (niche). With same topics, MMR should pick c over b.
    const items = [
      item('a', 0.90, ['rust'], null, null, null, 5),
      item('b', 0.85, ['rust'], null, null, null, 5),  // same tier as a
      item('c', 0.80, ['rust'], null, null, null, 2),  // different tier
    ]
    const result = mmrRerank(items, { topK: 2, lambda: 0.5 })
    expect(result[0].repo.id).toBe('a')
    expect(result[1].repo.id).toBe('c')
  })
})
