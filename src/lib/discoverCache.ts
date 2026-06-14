// Persistent cache for the Discover page initial render. Survives app restart
// via localStorage so the user sees the same Most Popular grid + hero row
// instantly on cold launch instead of waiting on a network fetch.
//
// SWR pattern: callers seed UI state from `load*()`, then issue a background
// fetch and `save*()` the fresh result. Within TTL, cached cards render
// immediately; beyond TTL, the cache is treated as missing.

import type { SavedRepo } from '../types/repo'
import type { RecommendationItem } from '../types/recommendation'

const KEY_POPULAR = 'discover-cache.popular.v1'
const KEY_RECOMMENDED = 'discover-cache.recommended.v1'
// v2: sort changed from stars to updated; older cached payloads would serve
// the wrong ordering for up to RECOMMENDED_TTL_MS, so we invalidate by key.
const KEY_HOT_TODAY = 'discover-cache.hot-today.v2'
const KEY_TRENDING_WEEK = 'discover-cache.trending-week.v1'
const KEY_HIDDEN_GEMS = 'discover-cache.hidden-gems.v1'
const KEY_AGENTS = 'discover-cache.agents.v1'

// 24h: trending repos shift slowly day-to-day, and SWR refresh runs in the
// background on every mount, so cache age is bounded by the user's session
// frequency, not this number.
export const POPULAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000

// One page of results is enough for instant render; subsequent pages re-fetch
// on demand via the existing pagination path.
const MAX_CACHED_ENTRIES = 100

interface CachedPopular {
  repos: SavedRepo[]
  fetchedAt: number
}

interface CachedRecommended {
  items: RecommendationItem[]
  fetchedAt: number
}

function loadCache<T extends { fetchedAt: number }>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as T
    if (typeof parsed?.fetchedAt !== 'number') return null
    if (Date.now() - parsed.fetchedAt > POPULAR_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function loadCachedPopular(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_POPULAR)
}

export function saveCachedPopular(repos: SavedRepo[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_POPULAR, JSON.stringify(payload))
  } catch {
    // quota exceeded or storage unavailable — non-critical
  }
}

export function loadCachedRecommended(): CachedRecommended | null {
  return loadCache<CachedRecommended>(KEY_RECOMMENDED)
}

export function saveCachedRecommended(items: RecommendationItem[]): void {
  try {
    const payload: CachedRecommended = {
      items: items.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_RECOMMENDED, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedHotToday(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_HOT_TODAY)
}

export function saveCachedHotToday(repos: SavedRepo[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_HOT_TODAY, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedTrendingWeek(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_TRENDING_WEEK)
}

export function saveCachedTrendingWeek(repos: SavedRepo[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_TRENDING_WEEK, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedHiddenGems(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_HIDDEN_GEMS)
}

export function saveCachedHiddenGems(repos: SavedRepo[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_HIDDEN_GEMS, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedAgents(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_AGENTS)
}

export function saveCachedAgents(repos: SavedRepo[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_AGENTS, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}
