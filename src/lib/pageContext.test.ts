import { describe, it, expect } from 'vitest'
import { getPageContext } from './pageContext'

describe('getPageContext', () => {
  it('describes the Discover page for root and /discover', () => {
    expect(getPageContext('/')).toMatch(/^Discover —/)
    expect(getPageContext('/discover')).toMatch(/^Discover —/)
  })

  it('includes owner/name for repo detail routes', () => {
    const ctx = getPageContext('/repo/facebook/react')
    expect(ctx).toMatch(/^Repository Detail —/)
    expect(ctx).toContain('facebook/react')
  })

  it('tolerates a repo route missing the name segment', () => {
    const ctx = getPageContext('/repo/facebook')
    expect(ctx).toMatch(/^Repository Detail —/)
    // owner present, name empty → "facebook/"
    expect(ctx).toContain('facebook/')
  })

  it.each<[string, RegExp]>([
    ['/library', /^My Library —/],
    ['/collections', /^Collections —/],
    ['/starred', /^Starred —/],
    ['/settings', /^Settings —/],
  ])('maps %s to a dedicated context string', (path, re) => {
    expect(getPageContext(path)).toMatch(re)
  })

  it('falls back to "Gitplaces" for unknown routes', () => {
    expect(getPageContext('/totally-unknown')).toBe('Gitplaces')
    expect(getPageContext('')).toBe('Gitplaces')
  })
})
