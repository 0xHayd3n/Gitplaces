import { describe, it, expect, vi } from 'vitest'
import { isAnatomyRepoStale } from './updateService'

describe('isAnatomyRepoStale', () => {
  it('delegates to the staleness probe and maps to updateAvailable', async () => {
    const probe = vi.fn(async () => ({ stale: true, reason: 'anatomy drifted', latestSha: 'new' }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'old', null, probe)
    expect(r).toEqual({ updateAvailable: true, upstreamVersion: 'new' })
  })

  it('not stale → updateAvailable false, keeps stored sha as upstream', async () => {
    const probe = vi.fn(async () => ({ stale: false, reason: 'fresh', latestSha: 'same' }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'same', null, probe)
    expect(r.updateAvailable).toBe(false)
  })

  it('null latestSha → not available (no signal)', async () => {
    const probe = vi.fn(async () => ({ stale: false, reason: 'api error 403', latestSha: null }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'x', null, probe)
    expect(r).toEqual({ updateAvailable: false, upstreamVersion: 'x' })
  })
})
