// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreFreshness, buildFreshnessPreference } from './freshnessSignal'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

describe('scoreFreshness', () => {
  it('archived → 0', () => {
    expect(scoreFreshness({ pushed_at: new Date(NOW).toISOString(), archived: true }, 365, NOW)).toBe(0)
  })
  it('null pushed_at → 0.05 baseline', () => {
    expect(scoreFreshness({ pushed_at: null, archived: false }, 365, NOW)).toBe(0.05)
  })
  it('just pushed → ~1.0', () => {
    expect(scoreFreshness({ pushed_at: new Date(NOW).toISOString(), archived: false }, 365, NOW)).toBeCloseTo(1, 2)
  })
  it('at half-life → ~0.5', () => {
    const halfLife = 365
    const ts = new Date(NOW - halfLife * DAY).toISOString()
    expect(scoreFreshness({ pushed_at: ts, archived: false }, halfLife, NOW)).toBeCloseTo(0.5, 2)
  })
  it('floor of 180 days for half-life', () => {
    // user's freshnessPreference is 30 (very young), but floor is 180
    const ts = new Date(NOW - 180 * DAY).toISOString()
    expect(scoreFreshness({ pushed_at: ts, archived: false }, 30, NOW)).toBeCloseTo(0.5, 2)
  })
})

describe('buildFreshnessPreference', () => {
  it('returns 365 for empty repos', () => {
    expect(buildFreshnessPreference([], NOW)).toBe(365)
  })
  it('returns median age in days from pushed_at', () => {
    const repos = [
      { pushed_at: new Date(NOW - 100 * DAY).toISOString() },
      { pushed_at: new Date(NOW - 200 * DAY).toISOString() },
      { pushed_at: new Date(NOW - 300 * DAY).toISOString() },
    ] as any[]
    expect(buildFreshnessPreference(repos, NOW)).toBe(200)
  })
})
