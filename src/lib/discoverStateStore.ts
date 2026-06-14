// ── Discover view state persistence ─────────────────────────────────────────
// Saves the full Discover state (results, query, filters, scroll position) when
// the user navigates into a repo, so it can be restored when they go back.
// Module-level variable intentionally — it lives for the app session and is
// independent of React's render lifecycle.

import type { SavedRepo } from '../types/repo'
import type { ViewModeKey } from './discoverQueries'

interface SearchFilters {
  activity?: 'week' | 'month' | 'halfyear'
  stars?: 100 | 1000 | 10000
  license?: string
}

export interface DiscoverSnapshot {
  query: string
  repos: SavedRepo[]
  viewMode: ViewModeKey
  selectedLanguages: string[]
  appliedFilters: SearchFilters
  mode: 'raw' | 'natural'
  detectedTags: string[]
  activeTags: string[]
  relatedTags: string[]
  scrollTop: number
  page: number
  hasMore: boolean
  searchPath: 'trending' | 'raw' | 'tagged'
  selectedSubtypes?: string[]
  activePanel?: 'buckets' | 'filters' | 'advanced' | null
  showLanding?: boolean
  topicMode?: boolean
}

let _snapshot: DiscoverSnapshot | null = null

/** Save the current Discover state before navigating away. */
export function saveDiscoverSnapshot(s: DiscoverSnapshot): void {
  _snapshot = s
}

/**
 * Read the snapshot without consuming it. Safe to call in the render phase —
 * React 18 Strict Mode calls component functions twice, so destructive reads
 * in render would lose the snapshot on the second invocation.
 */
export function peekDiscoverSnapshot(): DiscoverSnapshot | null {
  return _snapshot
}

/**
 * Consume the saved snapshot. Call this from a useEffect (not render) so it
 * runs exactly once per mount, clearing the store for the next navigation.
 */
export function popDiscoverSnapshot(): DiscoverSnapshot | null {
  const s = _snapshot
  _snapshot = null
  return s
}
