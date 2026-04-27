// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildTopicAffinity, scoreTopic } from './topicSignal'
import type { CorpusStats } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

function emptyCorpus(): CorpusStats {
  return {
    topicDocFrequency: new Map(),
    topicIdf: new Map(),
    descriptionDocFrequency: new Map(),
    descriptionIdf: new Map(),
    totalRepos: 0,
  }
}

describe('buildTopicAffinity', () => {
  it('returns empty map for empty repos', () => {
    expect(buildTopicAffinity([], emptyCorpus(), NOW).size).toBe(0)
  })

  it('weights topics by recency-decayed IDF and normalizes to sum=1', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 1], ['python', 2]]),
      totalRepos: 200, // above IDF_FALLBACK_THRESHOLD
    }
    const repos = [
      { topics: JSON.stringify(['rust']),   starred_at: new Date(NOW).toISOString() },
      { topics: JSON.stringify(['python']), starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    const total = [...aff.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
    // python has higher IDF, so higher weight
    expect(aff.get('python')!).toBeGreaterThan(aff.get('rust')!)
  })

  it('falls back to flat weighting when corpus < threshold', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 0.01]]),
      totalRepos: 10, // below threshold
    }
    const repos = [
      { topics: JSON.stringify(['rust', 'python']), starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    // Both topics should get equal weight (0.5 each) under flat fallback
    expect(aff.get('rust')).toBeCloseTo(0.5, 5)
    expect(aff.get('python')).toBeCloseTo(0.5, 5)
  })

  it('decays older starred_at by recency half-life', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 1], ['python', 1]]),
      totalRepos: 200,
    }
    const repos = [
      { topics: JSON.stringify(['rust']), starred_at: new Date(NOW).toISOString() },
      { topics: JSON.stringify(['python']), starred_at: new Date(NOW - 90 * DAY).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    // python is at 90-day half-life → ~0.5 weight vs rust's 1.0 → after normalize: rust ~0.667, python ~0.333
    expect(aff.get('rust')!).toBeGreaterThan(aff.get('python')!)
    expect(aff.get('python')!).toBeCloseTo(1 / 3, 1)
  })
})

describe('scoreTopic', () => {
  it('returns 0 for empty candidate topics', () => {
    expect(scoreTopic([], new Map([['rust', 0.5]]))).toBe(0)
  })

  it('sums affinities and caps at 1.0', () => {
    const aff = new Map([['rust', 0.4], ['python', 0.3], ['ai', 0.2]])
    expect(scoreTopic(['rust'], aff)).toBeCloseTo(0.4, 5)
    expect(scoreTopic(['rust', 'python'], aff)).toBeCloseTo(0.7, 5)
    // Suppose two topics summed to >1
    const big = new Map([['a', 0.8], ['b', 0.7]])
    expect(scoreTopic(['a', 'b'], big)).toBe(1)
  })

  it('ignores unknown topics', () => {
    expect(scoreTopic(['unknown'], new Map([['rust', 0.5]]))).toBe(0)
  })
})
