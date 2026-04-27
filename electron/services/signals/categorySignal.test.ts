// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreCategory, categoryMismatchPenalty } from './categorySignal'

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

describe('categoryMismatchPenalty', () => {
  const profile = {
    bucketDistribution:  new Map([['ai-ml', 0.6], ['dev-tools', 0.4]]),
    subTypeDistribution: new Map([['ai-coding', 0.5]]),
    languageWeights:     new Map([['Python', 0.7]]),
  }

  it('zero penalty when bucket and subType both match user', () => {
    expect(categoryMismatchPenalty({ type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'Python' }, profile))
      .toBe(0)
  })

  it('zero penalty when candidate has no classification (cant penalize unknown)', () => {
    expect(categoryMismatchPenalty({ type_bucket: null, type_sub: null, language: null }, profile))
      .toBe(0)
  })

  it('penalizes bucket mismatch (user has 0 in candidates bucket)', () => {
    expect(categoryMismatchPenalty({ type_bucket: 'careers', type_sub: null, language: null }, profile))
      .toBe(0.15)
  })

  it('penalizes subType mismatch independently of bucket', () => {
    // bucket matches, subType doesnt
    expect(categoryMismatchPenalty({ type_bucket: 'ai-ml', type_sub: 'job-listing', language: null }, profile))
      .toBe(0.10)
  })

  it('compounds bucket and subType mismatches', () => {
    expect(categoryMismatchPenalty({ type_bucket: 'careers', type_sub: 'job-listing', language: null }, profile))
      .toBeCloseTo(0.25, 5)
  })

  it('zero penalty when user has empty bucket/subType distributions (no signal to penalize against)', () => {
    const emptyProfile = {
      bucketDistribution: new Map<string, number>(),
      subTypeDistribution: new Map<string, number>(),
      languageWeights: new Map<string, number>(),
    }
    expect(categoryMismatchPenalty({ type_bucket: 'careers', type_sub: 'job-listing', language: null }, emptyProfile))
      .toBe(0)
  })
})
