import { describe, it, expect } from 'vitest'
import { classifyRelease } from './classifyRelease'

describe('classifyRelease', () => {
  it('returns prerelease when the flag is true', () => {
    expect(classifyRelease({ tagName: 'v2.0.0', prereleaseFlag: true })).toBe('prerelease')
    expect(classifyRelease({ tagName: 'v1.2.3', prereleaseFlag: true })).toBe('prerelease')
    expect(classifyRelease({ tagName: 'release-2024', prereleaseFlag: true })).toBe('prerelease')
  })

  it('returns major for x.0.0 tags with major>=1 and no prerelease suffix', () => {
    expect(classifyRelease({ tagName: 'v1.0.0', prereleaseFlag: false })).toBe('major')
    expect(classifyRelease({ tagName: 'v2.0.0', prereleaseFlag: false })).toBe('major')
    expect(classifyRelease({ tagName: '5.0.0', prereleaseFlag: false })).toBe('major')
  })

  it('returns normal for minor/patch bumps', () => {
    expect(classifyRelease({ tagName: 'v1.2.0', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v1.2.3', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v0.5.0', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for 0.x.0 (0.x is not "major")', () => {
    expect(classifyRelease({ tagName: 'v0.0.0', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v0.1.0', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for major-with-prerelease-suffix when flag is false', () => {
    // Caller decides via the flag, but this verifies the rule precedence.
    expect(classifyRelease({ tagName: 'v1.0.0-rc.1', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for non-semver tags', () => {
    expect(classifyRelease({ tagName: 'release-2024-04', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'next', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: '', prereleaseFlag: false })).toBe('normal')
  })
})
