import { describe, it, expect, vi } from 'vitest'
import { isAnatomyStale } from './staleness'

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('isAnatomyStale', () => {
  it('not stale when latest .anatomy commit equals stored commit', async () => {
    const fetchFn = vi.fn(async () => res([{ sha: 'abc123' }]))
    const r = await isAnatomyStale('o', 'n', 'main', 'abc123', null, fetchFn)
    expect(r.stale).toBe(false)
    expect(r.latestSha).toBe('abc123')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/n/commits?path=.anatomy&sha=main&per_page=1',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('stale when latest differs from stored', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'old', null, vi.fn(async () => res([{ sha: 'new' }])))
    expect(r.stale).toBe(true)
    expect(r.latestSha).toBe('new')
  })

  it('not stale + reason when the repo has no .anatomy commits (empty array)', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'x', null, vi.fn(async () => res([])))
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/no \.anatomy commits/i)
  })

  it('not stale + reason on API error (never throws)', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'x', null, vi.fn(async () => res({}, false, 403)))
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/api error 403/i)
  })

  it('not stale when storedCommit is null (nothing to compare)', async () => {
    const fetchFn = vi.fn(async () => res([{ sha: 'a' }]))
    const r = await isAnatomyStale('o', 'n', 'main', null, null, fetchFn)
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/no stored commit/i)
  })
})
