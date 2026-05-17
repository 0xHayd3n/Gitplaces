import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { cacheDirFor, exceedsCeiling, selectEvictions } from './clone'

describe('cacheDirFor', () => {
  it('namespaces by owner/repo@sha and sanitises', () => {
    expect(cacheDirFor('/c', 'o', 'n', 'abc')).toBe(join('/c', 'o', 'n@abc'))
    expect(cacheDirFor('/c', 'o/x', 'n', 'a')).toBe(join('/c', 'o_x', 'n@a'))
  })
})

describe('exceedsCeiling', () => {
  it('compares GitHub size (KB) to a byte ceiling', () => {
    expect(exceedsCeiling(300_000, 250 * 1024 * 1024)).toBe(true)   // ~293 MB
    expect(exceedsCeiling(1000, 250 * 1024 * 1024)).toBe(false)
  })
})

describe('selectEvictions', () => {
  const now = 1_000_000_000_000
  it('evicts oldest first when over budget', () => {
    const entries = [
      { dir: 'a', bytes: 100, mtimeMs: now - 5000 },
      { dir: 'b', bytes: 100, mtimeMs: now - 1000 },
    ]
    expect(selectEvictions(entries, 150, 14 * 864e5, now)).toEqual(['a'])
  })
  it('evicts entries older than maxAge regardless of budget', () => {
    const entries = [{ dir: 'old', bytes: 1, mtimeMs: now - 20 * 864e5 }]
    expect(selectEvictions(entries, 1e9, 14 * 864e5, now)).toEqual(['old'])
  })
})
