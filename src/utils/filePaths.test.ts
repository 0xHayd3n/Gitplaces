import { describe, it, expect } from 'vitest'
import { resolveRelativePath, classifyLink } from './filePaths'

describe('resolveRelativePath', () => {
  it.each<[string, string, string]>([
    ['docs', '../README.md', 'README.md'],
    ['src/components', './Button.tsx', 'src/components/Button.tsx'],
    ['', 'docs/guide.md', 'docs/guide.md'],
    ['a/b/c', '../../x.md', 'a/x.md'],
    ['docs', 'sub/page.md', 'docs/sub/page.md'],
  ])('resolves (%s, %s) => %s', (base, rel, expected) => {
    expect(resolveRelativePath(base, rel)).toBe(expected)
  })
})

describe('classifyLink', () => {
  it('classifies an empty href as external', () => {
    expect(classifyLink('', 'docs', 'o', 'r')).toEqual({ type: 'external' })
  })

  it('classifies anchor links', () => {
    expect(classifyLink('#usage', 'docs', 'o', 'r')).toEqual({ type: 'anchor' })
  })

  it('treats same-repo github blob URLs as internal (case-insensitive owner/name)', () => {
    const res = classifyLink(
      'https://github.com/Owner/Repo/blob/main/src/index.ts',
      'docs',
      'owner',
      'repo',
    )
    expect(res).toEqual({ type: 'internal', resolvedPath: 'src/index.ts' })
  })

  it('treats other-repo github blob URLs as external', () => {
    const res = classifyLink(
      'https://github.com/someone/else/blob/main/x.ts',
      'docs',
      'owner',
      'repo',
    )
    expect(res).toEqual({ type: 'external' })
  })

  it('classifies plain http(s) URLs as external', () => {
    expect(classifyLink('https://example.com', 'docs', 'o', 'r')).toEqual({ type: 'external' })
  })

  it('resolves relative links against the base path as internal', () => {
    expect(classifyLink('../LICENSE', 'docs', 'o', 'r')).toEqual({
      type: 'internal',
      resolvedPath: 'LICENSE',
    })
  })
})
