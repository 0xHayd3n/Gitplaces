import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildViewModeQuery, getViewModeSort } from './discoverQueries'

beforeEach(() => {
  // Fix "today" so the relative-date computations in buildViewModeQuery
  // produce deterministic strings we can assert on.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('buildViewModeQuery — hot-today', () => {
  it('returns pushed:>{yesterday} with no language filter', () => {
    expect(buildViewModeQuery('hot-today', '', '')).toBe('pushed:>2026-06-14')
  })

  it('appends language filter when langKey provided', () => {
    expect(buildViewModeQuery('hot-today', 'rust', '')).toBe('pushed:>2026-06-14 language:rust')
  })
})

describe('buildViewModeQuery — trending-week', () => {
  it('returns pushed:>{7 days ago} with no language filter', () => {
    expect(buildViewModeQuery('trending-week', '', '')).toBe('pushed:>2026-06-08')
  })

  it('appends language filter when langKey provided', () => {
    expect(buildViewModeQuery('trending-week', 'typescript', '')).toBe('pushed:>2026-06-08 language:typescript')
  })
})

describe('buildViewModeQuery — hidden-gems', () => {
  it('returns pushed:>{30 days ago} with stars range and no language filter', () => {
    expect(buildViewModeQuery('hidden-gems', '', '')).toBe('pushed:>2026-05-16 stars:50..500')
  })

  it('appends language filter while keeping the stars range', () => {
    expect(buildViewModeQuery('hidden-gems', 'go', '')).toBe('pushed:>2026-05-16 stars:50..500 language:go')
  })
})

describe('getViewModeSort — new view modes', () => {
  it('returns updated desc for hot-today (sort:stars would clone Trending this week)', () => {
    expect(getViewModeSort('hot-today')).toEqual({ sort: 'updated', order: 'desc' })
  })
  it('returns stars desc for trending-week', () => {
    expect(getViewModeSort('trending-week')).toEqual({ sort: 'stars', order: 'desc' })
  })
  it('returns stars desc for hidden-gems', () => {
    expect(getViewModeSort('hidden-gems')).toEqual({ sort: 'stars', order: 'desc' })
  })
})

describe('buildViewModeQuery — existing modes unchanged', () => {
  it('home with no langKey still returns stars:>100', () => {
    expect(buildViewModeQuery('home', '', '')).toBe('stars:>100')
  })
  it('home with langKey still returns stars:>0 language:X', () => {
    expect(buildViewModeQuery('home', 'rust', '')).toBe('stars:>0 language:rust')
  })
  it('explicit trimmed search overrides the mode-specific base query', () => {
    expect(buildViewModeQuery('hot-today', '', 'react')).toBe('react')
  })
})

describe('buildViewModeQuery — popular (Most Popular expansion)', () => {
  it('mirrors home query with no langKey', () => {
    expect(buildViewModeQuery('popular', '', '')).toBe('stars:>100')
  })
  it('mirrors home query with langKey', () => {
    expect(buildViewModeQuery('popular', 'rust', '')).toBe('stars:>0 language:rust')
  })
  it('uses stars desc sort like home', () => {
    expect(getViewModeSort('popular')).toEqual({ sort: 'stars', order: 'desc' })
  })
})
