import { describe, it, expect } from 'vitest'
import { parseSemverTag } from './parseSemverTag'

describe('parseSemverTag', () => {
  it('parses a basic v-prefixed tag', () => {
    expect(parseSemverTag('v1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
  })

  it('parses a tag without v prefix', () => {
    expect(parseSemverTag('1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
  })

  it('parses a prerelease suffix', () => {
    expect(parseSemverTag('v2.0.0-rc.1')).toEqual({
      major: 2, minor: 0, patch: 0, prerelease: 'rc.1',
    })
  })

  it('parses a complex prerelease string', () => {
    expect(parseSemverTag('v1.0.0-alpha.10.beta-2')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: 'alpha.10.beta-2',
    })
  })

  it('parses 0.x as semver (major=0)', () => {
    expect(parseSemverTag('v0.5.0')).toEqual({
      major: 0, minor: 5, patch: 0, prerelease: null,
    })
  })

  it('parses 1.0.0 (the canonical major bump)', () => {
    expect(parseSemverTag('1.0.0')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: null,
    })
  })

  it('returns null for non-semver tags', () => {
    expect(parseSemverTag('release-2024-04')).toBeNull()
    expect(parseSemverTag('build-7654')).toBeNull()
    expect(parseSemverTag('next')).toBeNull()
    expect(parseSemverTag('')).toBeNull()
    expect(parseSemverTag('v1.2')).toBeNull() // missing patch
    expect(parseSemverTag('v1')).toBeNull()   // missing minor + patch
  })

  it('is case-insensitive on the v prefix and prerelease', () => {
    expect(parseSemverTag('V1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
    expect(parseSemverTag('v1.0.0-RC.1')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: 'RC.1',
    })
  })
})
