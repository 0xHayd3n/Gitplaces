import { describe, it, expect } from 'vitest'
import { stripAnsi, detectManualFallback } from './login-helpers'

describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
  })
  it('removes CSI cursor/formatting sequences', () => {
    expect(stripAnsi('\x1b[1;31merror\x1b[0m message')).toBe('error message')
  })
  it('removes OSC sequences (e.g. terminal title)', () => {
    expect(stripAnsi('\x1b]0;title\x07plain')).toBe('plain')
  })
  it('passes plain text through unchanged', () => {
    expect(stripAnsi('plain text\n')).toBe('plain text\n')
  })
  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('')
  })
})

describe('detectManualFallback', () => {
  it('flags platform.claude.com redirect URL (fallback signal)', () => {
    expect(detectManualFallback('Visit https://platform.claude.com/oauth/code/callback?code=…')).toBe(true)
  })
  it('does not flag loopback URL (happy path)', () => {
    expect(detectManualFallback('Opening browser at http://127.0.0.1:54823/callback')).toBe(false)
  })
  it('does not flag unrelated claude.com URLs', () => {
    expect(detectManualFallback('See https://claude.com/docs for help')).toBe(false)
  })
  it('does not flag non-platform oauth callback (subdomain matters)', () => {
    expect(detectManualFallback('https://claude.com/oauth/code/callback')).toBe(false)
  })
  it('returns false for empty input', () => {
    expect(detectManualFallback('')).toBe(false)
  })
})
