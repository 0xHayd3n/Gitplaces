import { describe, it, expect } from 'vitest'
import { DOMAIN_CATEGORIES, getLangsByDomainCategory, LANGUAGES } from './languages'

describe('DOMAIN_CATEGORIES', () => {
  it('has exactly 9 entries in canonical order', () => {
    expect(DOMAIN_CATEGORIES).toEqual([
      'Systems',
      'Web',
      'Data & Science',
      'Functional',
      'Mobile & Desktop',
      'DevOps & Config',
      'Hardware',
      'Game',
      'Specialty',
    ])
  })
})

describe('getLangsByDomainCategory', () => {
  it('returns non-empty arrays for every domain', () => {
    for (const cat of DOMAIN_CATEGORIES) {
      const langs = getLangsByDomainCategory(cat)
      expect(langs.length, `${cat} should have at least one language`).toBeGreaterThan(0)
    }
  })

  it('returns only languages with matching domainCategory', () => {
    const systems = getLangsByDomainCategory('Systems')
    expect(systems.every(l => l.domainCategory === 'Systems')).toBe(true)
  })

  it('covers all 112 languages across all domains', () => {
    const covered = DOMAIN_CATEGORIES.flatMap(cat => getLangsByDomainCategory(cat))
    expect(covered.length).toBe(LANGUAGES.length)
  })
})
