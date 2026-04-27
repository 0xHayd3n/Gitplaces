import { describe, it, expect } from 'vitest'
import { LANGUAGES, POPULAR_LANGUAGES, getPopularLangs, LANG_MAP } from './languages'

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
