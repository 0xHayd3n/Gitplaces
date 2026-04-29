import { describe, it, expect } from 'vitest'
import { groupEventsByDay } from './groupEventsByDay'
import type { GitHubFeedEvent } from '../hooks/useFeed'

function makeEvent(id: string, isoTimestamp: string): GitHubFeedEvent {
  return {
    id,
    type: 'WatchEvent',
    actor: { login: 'a', avatar_url: '' },
    repo: { full_name: 'a/b' },
    payload: {},
    created_at: isoTimestamp,
  }
}

describe('groupEventsByDay', () => {
  // Use a fixed local-time anchor: 2026-04-30 14:00 local
  const now = new Date(2026, 3, 30, 14, 0, 0) // month is 0-indexed (3 = April)

  it('returns empty array for empty input', () => {
    expect(groupEventsByDay([], now)).toEqual([])
  })

  it('labels todays events as Today', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 30, 13, 0, 0).toISOString()),
      makeEvent('2', new Date(2026, 3, 30, 9, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Today')
    expect(groups[0].events).toHaveLength(2)
  })

  it('labels yesterdays events as Yesterday', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 29, 23, 30, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('Yesterday')
  })

  it('labels older same-year dates as Month Day', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 25, 12, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('April 25')
  })

  it('labels prior-year dates with year suffix', () => {
    const events = [
      makeEvent('1', new Date(2025, 11, 31, 12, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('December 31, 2025')
  })

  it('preserves group order based on first occurrence in input', () => {
    const events = [
      makeEvent('today1', new Date(2026, 3, 30, 13, 0, 0).toISOString()),
      makeEvent('yesterday1', new Date(2026, 3, 29, 11, 0, 0).toISOString()),
      makeEvent('today2', new Date(2026, 3, 30, 9, 0, 0).toISOString()),
      makeEvent('apr25', new Date(2026, 3, 25, 8, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'April 25'])
    expect(groups[0].events.map(e => e.id)).toEqual(['today1', 'today2'])
    expect(groups[1].events.map(e => e.id)).toEqual(['yesterday1'])
    expect(groups[2].events.map(e => e.id)).toEqual(['apr25'])
  })

  it('treats events on either side of midnight as different days', () => {
    const lateYesterday = new Date(2026, 3, 29, 23, 59, 59).toISOString()
    const earlyToday = new Date(2026, 3, 30, 0, 0, 30).toISOString()
    const groups = groupEventsByDay([
      makeEvent('earlyToday', earlyToday),
      makeEvent('lateYesterday', lateYesterday),
    ], now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday'])
  })
})
