import { describe, it, expect } from 'vitest'
import { buildPersonaPayload, deriveDescription } from './copyPayload'

describe('deriveDescription', () => {
  it('returns the first non-heading line after the H1', () => {
    expect(deriveDescription('# Title\n\nThis is the agent description.\n\nMore body.'))
      .toBe('This is the agent description.')
  })

  it('returns the first non-empty line when there is no H1', () => {
    expect(deriveDescription('Just a paragraph here.\n\nNext.'))
      .toBe('Just a paragraph here.')
  })

  it('skips blank lines', () => {
    expect(deriveDescription('# Title\n\n\n\nLine after blanks.'))
      .toBe('Line after blanks.')
  })

  it('returns empty string when body has only headings/blanks', () => {
    expect(deriveDescription('# Only\n\n## Headings\n\n')).toBe('')
  })

  it('strips simple markdown formatting from the description', () => {
    expect(deriveDescription('# Title\n\n**bold** and *italic* here.'))
      .toBe('bold and italic here.')
  })

  it('truncates very long descriptions to 200 chars', () => {
    const long = 'x'.repeat(500)
    expect(deriveDescription(long).length).toBeLessThanOrEqual(200)
  })
})

describe('buildPersonaPayload', () => {
  it('includes the @handle in the framing line', () => {
    const out = buildPersonaPayload({ handle: 'investigator', description: 'A meticulous code investigator.', body: '# Investigator\n\nBody here.' })
    expect(out.startsWith('You are @investigator, A meticulous code investigator.')).toBe(true)
  })

  it('omits the description when empty', () => {
    const out = buildPersonaPayload({ handle: 'foo', description: '', body: 'Body.' })
    expect(out.startsWith('You are @foo.\n\n')).toBe(true)
  })

  it('appends the body verbatim after the framing line + blank line', () => {
    const out = buildPersonaPayload({ handle: 'a', description: 'd', body: 'Line 1\nLine 2' })
    expect(out).toBe('You are @a, d.\n\nLine 1\nLine 2')
  })

  it('handles a description that already ends in punctuation gracefully', () => {
    const out = buildPersonaPayload({ handle: 'a', description: 'A description.', body: 'body' })
    expect(out.startsWith('You are @a, A description.\n\n')).toBe(true)  // no double-period
  })
})

describe('buildPersonaPayload — preset support', () => {
  it('uses @handle/preset-slug in the framing line when presetSlug is provided', () => {
    const out = buildPersonaPayload({
      handle: 'reviewer',
      description: 'a strict reviewer',
      body: 'Body.',
      presetSlug: 'security-review',
    })
    expect(out.startsWith('You are @reviewer/security-review, a strict reviewer.\n\n')).toBe(true)
  })

  it('substitutes variables in the body using presetValues', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: 'Look at {{focus}} carefully.',
      presetSlug: 'sec',
      presetValues: { focus: 'auth' },
    })
    expect(out).toContain('Look at auth carefully.')
  })

  it('leaves variables raw when no presetValues are provided', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: 'See {{focus}}.',
    })
    expect(out).toContain('See {{focus}}.')
  })

  it('leaves missing-value variables raw and substitutes provided ones', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: '{{a}} and {{b}}',
      presetSlug: 'p',
      presetValues: { a: 'one' },
    })
    expect(out).toContain('one and {{b}}')
  })

  it('omits the sub-handle when presetSlug is null/undefined', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: 'd',
      body: 'b',
      presetSlug: null,
    })
    expect(out.startsWith('You are @r, d.\n\n')).toBe(true)
  })
})
