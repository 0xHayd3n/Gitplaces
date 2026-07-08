import { describe, it, expect } from 'vitest'
import { formatDate, daysSince, parseSignals } from './dateHelpers'

describe('formatDate', () => {
  it('returns an em dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('formats an ISO date using the en-US medium style', () => {
    const iso = '2023-06-15T12:00:00Z'
    // Compare against the same locale call so the assertion is timezone-independent.
    const expected = new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    expect(formatDate(iso)).toBe(expected)
    expect(formatDate(iso)).toContain('2023')
  })
})

describe('daysSince', () => {
  it('returns "today" for a just-now timestamp', () => {
    expect(daysSince(new Date().toISOString())).toBe('today')
  })

  it('returns "1 day ago" for a day-old timestamp', () => {
    const iso = new Date(Date.now() - 86_400_000).toISOString()
    expect(daysSince(iso)).toBe('1 day ago')
  })

  it('pluralises for multiple days', () => {
    const iso = new Date(Date.now() - 5 * 86_400_000).toISOString()
    expect(daysSince(iso)).toBe('5 days ago')
  })
})

describe('parseSignals', () => {
  it('returns an empty array for null', () => {
    expect(parseSignals(null)).toEqual([])
  })

  it('parses a JSON array string', () => {
    expect(parseSignals('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array on invalid JSON', () => {
    expect(parseSignals('not json')).toEqual([])
    expect(parseSignals('')).toEqual([])
  })
})
