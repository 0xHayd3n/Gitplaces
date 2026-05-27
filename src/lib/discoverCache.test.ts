import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadCachedPopular, saveCachedPopular,
  loadCachedRecommended, saveCachedRecommended,
  loadCachedHotToday, saveCachedHotToday,
  loadCachedTrendingWeek, saveCachedTrendingWeek,
  loadCachedHiddenGems, saveCachedHiddenGems,
  POPULAR_CACHE_TTL_MS,
} from './discoverCache'
import type { RepoRow } from '../types/repo'
import type { RecommendationItem } from '../types/recommendation'

const KEY_POPULAR = 'discover-cache.popular.v1'
const KEY_RECOMMENDED = 'discover-cache.recommended.v1'
const KEY_HOT_TODAY = 'discover-cache.hot-today.v2'
const KEY_TRENDING_WEEK = 'discover-cache.trending-week.v1'
const KEY_HIDDEN_GEMS = 'discover-cache.hidden-gems.v1'

function makeRepo(name: string): RepoRow {
  return {
    id: name, owner: 'alice', name, description: null, language: null,
    topics: '[]', stars: 0, forks: 0, license: null, homepage: null,
    updated_at: null, pushed_at: null, saved_at: null, type: null,
    banner_svg: null, discovered_at: null, discover_query: null,
    watchers: 0, size: 0, open_issues: 0, starred_at: null, unstarred_at: null,
    default_branch: null, avatar_url: null, og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null, verification_signals: null,
    verification_checked_at: null, type_bucket: null, type_sub: null,
    is_forked: null, update_available: null, update_checked_at: null,
    upstream_version: null, stored_version: null,
  }
}

function makeRecItem(name: string): RecommendationItem {
  return {
    repo: makeRepo(name),
    score: 0,
    scoreBreakdown: { topic: 0, description: 0, bucket: 0, subType: 0, language: 0, scale: 0, freshness: 0, engagement: 0 },
    anchors: [],
    primaryAnchor: null,
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => { vi.useRealTimers() })

describe('loadCachedPopular', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedPopular()).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY_POPULAR, 'not-json')
    expect(loadCachedPopular()).toBeNull()
  })

  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_POPULAR, JSON.stringify(stale))
    expect(loadCachedPopular()).toBeNull()
  })

  it('returns payload when within TTL', () => {
    saveCachedPopular([makeRepo('a'), makeRepo('b')])
    const result = loadCachedPopular()
    expect(result).not.toBeNull()
    expect(result!.repos).toHaveLength(2)
    expect(result!.repos[0].name).toBe('a')
    expect(typeof result!.fetchedAt).toBe('number')
  })
})

describe('saveCachedPopular', () => {
  it('writes a payload that round-trips through load', () => {
    saveCachedPopular([makeRepo('a')])
    expect(loadCachedPopular()!.repos[0].name).toBe('a')
  })

  it('caps stored entries to avoid quota bloat', () => {
    const many = Array.from({ length: 500 }, (_, i) => makeRepo(`r${i}`))
    saveCachedPopular(many)
    const loaded = loadCachedPopular()
    expect(loaded!.repos.length).toBeLessThanOrEqual(100)
    expect(loaded!.repos[0].name).toBe('r0')
  })

  it('does not throw if localStorage.setItem throws (e.g. quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCachedPopular([makeRepo('a')])).not.toThrow()
    spy.mockRestore()
  })
})

describe('loadCachedRecommended', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedRecommended()).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY_RECOMMENDED, 'not-json')
    expect(loadCachedRecommended()).toBeNull()
  })

  it('returns null when older than TTL', () => {
    const stale = { items: [makeRecItem('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_RECOMMENDED, JSON.stringify(stale))
    expect(loadCachedRecommended()).toBeNull()
  })

  it('round-trips items within TTL', () => {
    saveCachedRecommended([makeRecItem('a'), makeRecItem('b')])
    const result = loadCachedRecommended()
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(2)
    expect(result!.items[0].repo.name).toBe('a')
  })
})

describe('saveCachedRecommended', () => {
  it('caps stored items', () => {
    const many = Array.from({ length: 500 }, (_, i) => makeRecItem(`r${i}`))
    saveCachedRecommended(many)
    const loaded = loadCachedRecommended()
    expect(loaded!.items.length).toBeLessThanOrEqual(100)
  })

  it('does not throw on quota errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCachedRecommended([makeRecItem('a')])).not.toThrow()
    spy.mockRestore()
  })
})

describe('loadCachedHotToday', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedHotToday()).toBeNull()
  })
  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY_HOT_TODAY, 'not-json')
    expect(loadCachedHotToday()).toBeNull()
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_HOT_TODAY, JSON.stringify(stale))
    expect(loadCachedHotToday()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedHotToday([makeRepo('a'), makeRepo('b')])
    const result = loadCachedHotToday()
    expect(result).not.toBeNull()
    expect(result!.repos).toHaveLength(2)
    expect(result!.repos[0].name).toBe('a')
  })
})

describe('saveCachedHotToday', () => {
  it('caps stored entries at 100', () => {
    const many = Array.from({ length: 500 }, (_, i) => makeRepo(`r${i}`))
    saveCachedHotToday(many)
    expect(loadCachedHotToday()!.repos.length).toBeLessThanOrEqual(100)
  })
  it('does not throw on quota errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCachedHotToday([makeRepo('a')])).not.toThrow()
    spy.mockRestore()
  })
})

describe('loadCachedTrendingWeek', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedTrendingWeek()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedTrendingWeek([makeRepo('a')])
    expect(loadCachedTrendingWeek()!.repos[0].name).toBe('a')
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_TRENDING_WEEK, JSON.stringify(stale))
    expect(loadCachedTrendingWeek()).toBeNull()
  })
})

describe('loadCachedHiddenGems', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedHiddenGems()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedHiddenGems([makeRepo('a')])
    expect(loadCachedHiddenGems()!.repos[0].name).toBe('a')
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_HIDDEN_GEMS, JSON.stringify(stale))
    expect(loadCachedHiddenGems()).toBeNull()
  })
})
