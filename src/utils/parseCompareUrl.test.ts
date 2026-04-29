import { describe, it, expect } from 'vitest'
import { parseCompareUrl, stripCompareLine } from './parseCompareUrl'

describe('parseCompareUrl', () => {
  it('extracts compare refs from a Full Changelog line', () => {
    const body = '## Changes\n- foo\n\n**Full Changelog**: https://github.com/anthropics/databuddy/compare/v1.0.0...v1.1.0'
    const result = parseCompareUrl(body)
    expect(result).toEqual({ owner: 'anthropics', repo: 'databuddy', base: 'v1.0.0', head: 'v1.1.0', kind: 'compare' })
  })

  it('extracts a commits-only ref for first releases', () => {
    const body = '**Full Changelog**: https://github.com/foo/bar/commits/v0.1.0'
    const result = parseCompareUrl(body)
    expect(result).toEqual({ owner: 'foo', repo: 'bar', head: 'v0.1.0', kind: 'commits', base: null })
  })

  it('returns null when there is no compare URL', () => {
    expect(parseCompareUrl('Just some notes here.')).toBeNull()
    expect(parseCompareUrl('')).toBeNull()
  })

  it('handles tag names containing dots and slashes', () => {
    const body = '**Full Changelog**: https://github.com/o/r/compare/release/2024.10...release/2024.11'
    const result = parseCompareUrl(body)
    expect(result).toEqual({ owner: 'o', repo: 'r', base: 'release/2024.10', head: 'release/2024.11', kind: 'compare' })
  })

  it('matches a bare URL without the **Full Changelog** label', () => {
    const body = 'See https://github.com/o/r/compare/v1...v2 for details'
    const result = parseCompareUrl(body)
    expect(result).toEqual({ owner: 'o', repo: 'r', base: 'v1', head: 'v2', kind: 'compare' })
  })

  it('returns the first compare URL when multiple are present', () => {
    const body = 'A: https://github.com/o/r/compare/a...b\nB: https://github.com/x/y/compare/c...d'
    const result = parseCompareUrl(body)
    expect(result?.owner).toBe('o')
    expect(result?.base).toBe('a')
  })
})

describe('stripCompareLine', () => {
  it('removes the entire Full Changelog line', () => {
    const body = '## Changes\n- foo\n\n**Full Changelog**: https://github.com/o/r/compare/v1...v2'
    expect(stripCompareLine(body)).toBe('## Changes\n- foo')
  })

  it('removes a Full Changelog line in the middle of the body', () => {
    const body = 'Top\n**Full Changelog**: https://github.com/o/r/compare/v1...v2\nBottom'
    expect(stripCompareLine(body)).toBe('Top\nBottom')
  })

  it('leaves the body unchanged when no compare line is present', () => {
    expect(stripCompareLine('Hello\nworld')).toBe('Hello\nworld')
  })

  it('strips a commits-only Full Changelog line', () => {
    const body = '## v0.1.0\n\nFirst!\n\n**Full Changelog**: https://github.com/o/r/commits/v0.1.0'
    expect(stripCompareLine(body)).toBe('## v0.1.0\n\nFirst!')
  })

  it('does NOT strip a mid-paragraph compare URL the author embedded', () => {
    const body = 'See https://github.com/o/r/compare/v1...v2 for the full diff.\n\nMore notes.'
    expect(stripCompareLine(body)).toBe(body)
  })

  it('strips lines using underscores or no markdown bold', () => {
    expect(stripCompareLine('Full Changelog: https://github.com/o/r/compare/v1...v2')).toBe('')
    expect(stripCompareLine('_Full Changelog_: https://github.com/o/r/compare/v1...v2')).toBe('')
  })
})
