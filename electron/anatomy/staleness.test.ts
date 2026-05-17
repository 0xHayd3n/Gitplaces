import { describe, it, expect } from 'vitest'
import { isAnatomyStale } from './staleness'

describe('isAnatomyStale (Phase 1 stub)', () => {
  it('always reports not-stale with a phase2 reason', async () => {
    expect(await isAnatomyStale('o', 'n', 'sha', null)).toEqual({ stale: false, reason: 'phase2-not-implemented' })
  })
})
