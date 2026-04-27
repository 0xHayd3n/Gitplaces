// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mmrRerank, repoSimilarity } from './diversityReranker'

interface Item {
  score: number
  repo: { id: string; topics: string[]; bucket: string | null; sub: string | null; language: string | null }
}

function item(id: string, score: number, topics: string[] = [], bucket: string | null = null, sub: string | null = null, language: string | null = null): Item {
  return { score, repo: { id, topics, bucket, sub, language } }
}

describe('repoSimilarity', () => {
  it('identical repos → 1.0', () => {
    const a = { topics: ['rust', 'cli'], bucket: 'dev-tools', sub: 'cli', language: 'Rust' }
    expect(repoSimilarity(a, a)).toBeCloseTo(1, 5)
  })
  it('disjoint → 0', () => {
    const a = { topics: ['rust'], bucket: 'a', sub: 'a1', language: 'Rust' }
    const b = { topics: ['python'], bucket: 'b', sub: 'b1', language: 'Python' }
    expect(repoSimilarity(a, b)).toBe(0)
  })
  it('partial topic overlap', () => {
    const a = { topics: ['rust', 'cli'], bucket: null, sub: null, language: null }
    const b = { topics: ['rust', 'web'], bucket: null, sub: null, language: null }
    // jaccard = 1/3 ≈ 0.333; * 0.5 ≈ 0.167
    expect(repoSimilarity(a, b)).toBeCloseTo(0.167, 2)
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
})
