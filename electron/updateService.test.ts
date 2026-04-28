// electron/updateService.test.ts
import { describe, it, expect } from 'vitest'
import { isNewerRelease, isNewerPushedAt } from './services/updateService'

describe('isNewerRelease', () => {
  it('returns true when stored is null', () => {
    expect(isNewerRelease('v2.0.0', null)).toBe(true)
  })
  it('returns false when upstream equals stored', () => {
    expect(isNewerRelease('v2.0.0', 'v2.0.0')).toBe(false)
  })
  it('returns true when upstream differs from stored', () => {
    expect(isNewerRelease('v2.1.0', 'v2.0.0')).toBe(true)
  })
})

describe('isNewerPushedAt', () => {
  it('returns true when stored is null', () => {
    expect(isNewerPushedAt('2026-04-29T00:00:00Z', null)).toBe(true)
  })
  it('returns false when upstream equals stored', () => {
    expect(isNewerPushedAt('2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(false)
  })
  it('returns true when upstream is later than stored', () => {
    expect(isNewerPushedAt('2026-04-29T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(true)
  })
  it('returns false when upstream is earlier than stored', () => {
    expect(isNewerPushedAt('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(false)
  })
})
