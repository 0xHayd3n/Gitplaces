// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreCategory } from './categorySignal'

describe('scoreCategory', () => {
  const profile = {
    bucketDistribution:  new Map([['ai-ml', 0.6], ['dev-tools', 0.4]]),
    subTypeDistribution: new Map([['ai-coding', 0.5]]),
    languageWeights:     new Map([['Python', 0.7]]),
  }

  it('reads each distribution', () => {
    expect(scoreCategory({ type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'Python' }, profile))
      .toEqual({ bucket: 0.6, subType: 0.5, language: 0.7 })
  })

  it('returns 0 for missing fields on candidate', () => {
    expect(scoreCategory({ type_bucket: null, type_sub: null, language: null }, profile))
      .toEqual({ bucket: 0, subType: 0, language: 0 })
  })

  it('returns 0 for unknown values', () => {
    expect(scoreCategory({ type_bucket: 'unknown', type_sub: 'unknown', language: 'Cobol' }, profile))
      .toEqual({ bucket: 0, subType: 0, language: 0 })
  })
})
