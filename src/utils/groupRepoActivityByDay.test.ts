import { describe, it, expect } from 'vitest'
import { groupRepoActivityByDay } from './groupRepoActivityByDay'
import type { RepoActivityItem } from '../types/repoActivity'
import type { GitHubFeedEvent } from '../hooks/useFeed'

function release(ts: string, id = 'r1'): RepoActivityItem {
  const event = { id, type: 'ReleaseEvent', actor: { login: '', avatar_url: '' }, repo: { full_name: 'a/b' }, payload: {}, created_at: ts } as unknown as GitHubFeedEvent
  return { kind: 'release', ts, event }
}
function user(ts: string): RepoActivityItem {
  return { kind: 'user', ts, event: { type: 'star', ts } }
}

describe('groupRepoActivityByDay', () => {
  it('returns [] for empty input', () => {
    expect(groupRepoActivityByDay([])).toEqual([])
  })

  it('groups release + user items into the same day', () => {
    const now = new Date('2026-05-02T12:00:00Z')
    const groups = groupRepoActivityByDay([
      release('2026-05-02T10:00:00Z', 'a'),
      user('2026-05-02T08:00:00Z'),
    ], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Today')
    expect(groups[0].items).toHaveLength(2)
  })

  it('labels groups Today, Yesterday, and absolute date', () => {
    const now = new Date('2026-05-02T12:00:00Z')
    const groups = groupRepoActivityByDay([
      release('2026-05-02T10:00:00Z', 'a'),
      user('2026-05-01T10:00:00Z'),
      release('2026-04-30T10:00:00Z', 'b'),
    ], now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'April 30'])
  })

  it('produces groups in input order (most recent first when input is sorted desc)', () => {
    const now = new Date('2026-05-02T12:00:00Z')
    const groups = groupRepoActivityByDay([
      release('2026-05-02T10:00:00Z', 'a'),
      release('2026-04-30T10:00:00Z', 'b'),
      release('2026-05-01T10:00:00Z', 'c'),
    ], now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'April 30', 'Yesterday'])
  })

  it('preserves input order within a group', () => {
    const now = new Date('2026-05-02T12:00:00Z')
    const groups = groupRepoActivityByDay([
      release('2026-05-02T10:00:00Z', 'first'),
      release('2026-05-02T08:00:00Z', 'second'),
    ], now)
    expect(groups[0].items.map(i => (i.event as { id: string }).id)).toEqual(['first', 'second'])
  })
})
