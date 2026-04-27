// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeCorpusStats } from './corpusStats'

function repo(topics: string[], description: string | null = null) {
  return { topics: JSON.stringify(topics), description }
}

describe('computeCorpusStats', () => {
  it('returns zeros for empty input', () => {
    const s = computeCorpusStats([])
    expect(s.totalRepos).toBe(0)
    expect(s.topicIdf.size).toBe(0)
    expect(s.descriptionIdf.size).toBe(0)
  })

  it('counts topic doc-frequency', () => {
    const s = computeCorpusStats([repo(['rust', 'cli']), repo(['rust']), repo(['python'])])
    expect(s.topicDocFrequency.get('rust')).toBe(2)
    expect(s.topicDocFrequency.get('cli')).toBe(1)
    expect(s.totalRepos).toBe(3)
  })

  it('computes topic IDF as log(N / (1 + df))', () => {
    const s = computeCorpusStats([repo(['rust']), repo(['rust']), repo(['rust']), repo(['python'])])
    expect(s.topicIdf.get('rust')).toBeCloseTo(0, 5)            // log(4/4)=0
    expect(s.topicIdf.get('python')).toBeCloseTo(Math.log(2), 5)
  })

  it('counts description doc-frequency using tokenizer', () => {
    const s = computeCorpusStats([
      repo([], 'rust parser library'),
      repo([], 'rust cli'),
      repo([], 'python parser'),
    ])
    expect(s.descriptionDocFrequency.get('rust')).toBe(2)
    expect(s.descriptionDocFrequency.get('parser')).toBe(2)
    expect(s.descriptionDocFrequency.get('library')).toBeUndefined() // stopword
  })

  it('skips null descriptions', () => {
    const s = computeCorpusStats([repo(['rust'], null), repo(['rust'], 'rust thing')])
    expect(s.descriptionDocFrequency.get('rust')).toBe(1)
  })
})
