// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  tokenizeDescription,
  buildDescriptionAffinity,
  scoreDescription,
} from './descriptionSignal'
import type { CorpusStats } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)

function emptyCorpus(): CorpusStats {
  return {
    topicDocFrequency: new Map(),
    topicIdf: new Map(),
    descriptionDocFrequency: new Map(),
    descriptionIdf: new Map(),
    totalRepos: 0,
  }
}

describe('tokenizeDescription', () => {
  it('lowercases and splits on non-word', () => {
    expect(tokenizeDescription('Rust CLI for Image Processing!')).toEqual(['rust', 'cli', 'image', 'processing'])
  })
  it('drops short tokens', () => {
    expect(tokenizeDescription('go a it cli')).toEqual(['cli'])
  })
  it('drops stopwords', () => {
    expect(tokenizeDescription('a tool for parsing yaml')).toEqual(['parsing', 'yaml'])
  })
  it('handles null/empty', () => {
    expect(tokenizeDescription(null)).toEqual([])
    expect(tokenizeDescription('')).toEqual([])
  })
  it('caps at 50 tokens', () => {
    const long = Array.from({ length: 100 }, (_, i) => `token${i}`).join(' ')
    expect(tokenizeDescription(long).length).toBe(50)
  })
})

describe('buildDescriptionAffinity', () => {
  it('returns empty map for repos with no descriptions', () => {
    const repos = [{ description: null, starred_at: null }] as any[]
    expect(buildDescriptionAffinity(repos, emptyCorpus(), NOW).size).toBe(0)
  })
  it('weights tokens by IDF and normalizes to sum=1', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      descriptionIdf: new Map([['rust', 1], ['parser', 2]]),
      totalRepos: 200,
    }
    const repos = [
      { description: 'rust parser', starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildDescriptionAffinity(repos, corpus, NOW)
    const total = [...aff.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(aff.get('parser')!).toBeGreaterThan(aff.get('rust')!)
  })
})

describe('scoreDescription', () => {
  it('returns 0 for empty token list', () => {
    expect(scoreDescription([], new Map([['rust', 0.5]]))).toBe(0)
  })
  it('sums affinities, caps at 1', () => {
    const aff = new Map([['rust', 0.6], ['parser', 0.5]])
    expect(scoreDescription(['rust', 'parser'], aff)).toBe(1)
  })
})
