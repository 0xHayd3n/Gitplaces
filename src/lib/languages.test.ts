import { describe, it, expect } from 'vitest'
import { DOMAIN_CATEGORIES, getLangsByDomainCategory, LANGUAGES, POPULAR_LANGUAGES, getPopularLangs, LANG_MAP } from './languages'

describe('DOMAIN_CATEGORIES', () => {
  it('has exactly 10 entries in canonical order', () => {
    expect(DOMAIN_CATEGORIES).toEqual([
      'Systems',
      'Web',
      'Markup & Styling',
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

describe('POPULAR_LANGUAGES', () => {
  it('lists 15 lowercase keys', () => {
    expect(POPULAR_LANGUAGES.length).toBe(15)
    for (const k of POPULAR_LANGUAGES) {
      expect(k).toBe(k.toLowerCase())
    }
  })

  it('every key resolves to a real LangDef in LANG_MAP', () => {
    for (const k of POPULAR_LANGUAGES) {
      expect(LANG_MAP.get(k), `${k} should exist in LANG_MAP`).toBeDefined()
    }
  })
})

describe('getPopularLangs', () => {
  it('returns LangDef[] in the order defined by POPULAR_LANGUAGES', () => {
    const popular = getPopularLangs()
    expect(popular.length).toBe(POPULAR_LANGUAGES.length)
    expect(popular.map(l => l.key)).toEqual(POPULAR_LANGUAGES)
  })

  it('returns only fully populated LangDef entries (smoke check)', () => {
    const popular = getPopularLangs()
    for (const def of popular) {
      expect(def.name).toBeDefined()
      expect(def.key).toBeDefined()
    }
  })
})
