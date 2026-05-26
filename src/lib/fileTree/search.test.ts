import { describe, it, expect } from 'vitest'
import { findMatchRanges, pathMatchesQuery, ancestorPaths } from './search'

describe('findMatchRanges', () => {
  it('returns an empty array when no match', () => {
    expect(findMatchRanges('Button.tsx', 'xyz')).toEqual([])
  })

  it('returns single range for one match', () => {
    expect(findMatchRanges('Button.tsx', 'utt')).toEqual([[1, 4]])
  })

  it('returns multiple ranges for multiple matches', () => {
    expect(findMatchRanges('aaaXaaaX', 'X')).toEqual([[3, 4], [7, 8]])
  })

  it('is case-insensitive', () => {
    expect(findMatchRanges('Button.tsx', 'BUTTON')).toEqual([[0, 6]])
  })

  it('returns empty for empty query', () => {
    expect(findMatchRanges('foo', '')).toEqual([])
  })
})

describe('pathMatchesQuery', () => {
  it('matches path basename case-insensitively', () => {
    expect(pathMatchesQuery('src/components/Button.tsx', 'BUTTON')).toBe(true)
  })

  it('matches any segment in the path', () => {
    expect(pathMatchesQuery('src/components/Button.tsx', 'comp')).toBe(true)
  })

  it('returns false for no match', () => {
    expect(pathMatchesQuery('src/Button.tsx', 'xyz')).toBe(false)
  })
})

describe('ancestorPaths', () => {
  it('returns the chain of ancestor paths for a deeply nested file', () => {
    expect(ancestorPaths('a/b/c/foo.ts')).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('returns empty array for a root-level entry', () => {
    expect(ancestorPaths('foo.ts')).toEqual([])
  })

  it('returns one ancestor for a one-deep entry', () => {
    expect(ancestorPaths('src/foo.ts')).toEqual(['src'])
  })
})
