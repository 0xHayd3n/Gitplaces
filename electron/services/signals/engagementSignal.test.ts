// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildEngagementProfile, scoreEngagement } from './engagementSignal'
import type { EngagementProfile } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

const empty: EngagementProfile = {
  clickedTopicAffinity: new Map(),
  clickedOwnerAffinity: new Map(),
  clickedRepoIds: new Set(),
  clickCount: 0,
}

describe('scoreEngagement', () => {
  it('returns 0 when clickCount is 0', () => {
    expect(scoreEngagement({ topics: ['rust'], owner: 'tokio-rs' }, empty)).toBe(0)
  })
  it('combines topic match (70%) + owner match (30%)', () => {
    const profile: EngagementProfile = {
      clickedTopicAffinity: new Map([['rust', 0.5]]),
      clickedOwnerAffinity: new Map([['tokio-rs', 0.5]]),
      clickedRepoIds: new Set(),
      clickCount: 5,
    }
    // 0.7 * 0.5 + 0.3 * 0.5 = 0.5
    expect(scoreEngagement({ topics: ['rust'], owner: 'tokio-rs' }, profile)).toBeCloseTo(0.5, 5)
  })
  it('caps at 1', () => {
    const profile: EngagementProfile = {
      clickedTopicAffinity: new Map([['rust', 1], ['cli', 1]]),
      clickedOwnerAffinity: new Map([['x', 1]]),
      clickedRepoIds: new Set(),
      clickCount: 5,
    }
    expect(scoreEngagement({ topics: ['rust', 'cli'], owner: 'x' }, profile)).toBe(1)
  })
})

describe('buildEngagementProfile', () => {
  it('returns empty profile when no events', () => {
    const p = buildEngagementProfile([], new Map(), NOW)
    expect(p.clickCount).toBe(0)
    expect(p.clickedTopicAffinity.size).toBe(0)
  })

  it('aggregates topics + owners with 30-day half-life decay, normalizes to sum=1', () => {
    const events = [
      { repo_id: 'r1', ts: NOW },
      { repo_id: 'r2', ts: NOW - 30 * DAY },
    ] as any[]
    const repos = new Map<string, any>([
      ['r1', { topics: JSON.stringify(['rust']), owner: 'a' }],
      ['r2', { topics: JSON.stringify(['python']), owner: 'b' }],
    ])
    const p = buildEngagementProfile(events, repos, NOW)
    expect(p.clickCount).toBe(2)
    // r2 at half-life → weight 0.5 vs r1's 1.0 → normalized: rust 0.667, python 0.333
    expect(p.clickedTopicAffinity.get('rust')!).toBeCloseTo(2 / 3, 1)
    expect(p.clickedTopicAffinity.get('python')!).toBeCloseTo(1 / 3, 1)
    expect(p.clickedRepoIds.has('r1')).toBe(true)
    expect(p.clickedRepoIds.has('r2')).toBe(true)
  })

  it('skips events with unknown repo_id', () => {
    const events = [{ repo_id: 'unknown', ts: NOW }] as any[]
    const p = buildEngagementProfile(events, new Map(), NOW)
    expect(p.clickCount).toBe(1)              // event count is the raw count
    expect(p.clickedTopicAffinity.size).toBe(0)
    expect(p.clickedRepoIds.has('unknown')).toBe(true)  // still filtered from recommendations
  })
})
