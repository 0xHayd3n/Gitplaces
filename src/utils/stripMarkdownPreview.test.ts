import { describe, it, expect } from 'vitest'
import { stripMarkdownPreview } from './stripMarkdownPreview'

describe('stripMarkdownPreview', () => {
  it('returns empty string for empty input', () => {
    expect(stripMarkdownPreview('', 200)).toBe('')
  })

  it('strips heading markers but keeps the text', () => {
    expect(stripMarkdownPreview('# Title\nbody', 200)).toBe('Title body')
    expect(stripMarkdownPreview('### Subhead', 200)).toBe('Subhead')
  })

  it('strips emphasis markers', () => {
    expect(stripMarkdownPreview('**bold** and *italic* and __underline__', 200))
      .toBe('bold and italic and underline')
  })

  it('strips link wrappers and keeps the link text', () => {
    expect(stripMarkdownPreview('See [the docs](https://example.com) for more', 200))
      .toBe('See the docs for more')
  })

  it('strips images entirely', () => {
    expect(stripMarkdownPreview('Hello ![logo](logo.png) world', 200))
      .toBe('Hello world')
  })

  it('strips fenced code blocks', () => {
    expect(stripMarkdownPreview('intro\n```js\nconst x = 1\n```\noutro', 200))
      .toBe('intro outro')
  })

  it('strips inline code, keeping the inner text', () => {
    expect(stripMarkdownPreview('Use `useEffect` for side effects', 200))
      .toBe('Use useEffect for side effects')
  })

  it('collapses runs of whitespace and newlines to a single space', () => {
    expect(stripMarkdownPreview('a\n\n\nb\t\tc   d', 200)).toBe('a b c d')
  })

  it('removes the auto-generated Full Changelog line', () => {
    const input = 'Notes\n\n**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0'
    expect(stripMarkdownPreview(input, 200)).toBe('Notes')
  })

  it('truncates at maxLength on a word boundary when possible', () => {
    const input = 'one two three four five six seven eight'
    const out = stripMarkdownPreview(input, 18)
    expect(out.length).toBeLessThanOrEqual(18)
    expect(out).toBe('one two three four')
  })

  it('truncates mid-word when no whitespace before maxLength', () => {
    const input = 'supercalifragilisticexpialidocious'
    const out = stripMarkdownPreview(input, 10)
    expect(out).toBe('supercalif')
  })

  it('returns trimmed text under maxLength unchanged', () => {
    expect(stripMarkdownPreview('  short body  ', 200)).toBe('short body')
  })
})
