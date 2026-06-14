import { describe, it, expect, beforeEach } from 'vitest'
import { recordRecentVisit, getRecentVisits } from './recentVisits'

const STORAGE_KEY = 'projects-recent-repos'

const entry = (name: string, owner = 'alice') => ({
  owner,
  name,
  ownerAvatarUrl: null,
  navigatePath: `/repo/${owner}/${name}`,
})

beforeEach(() => localStorage.clear())

describe('getRecentVisits', () => {
  it('returns empty array when nothing stored', () => {
    expect(getRecentVisits()).toEqual([])
  })

  it('returns stored entries', () => {
    const stored = [{ owner: 'a', name: 'b', ownerAvatarUrl: null, navigatePath: '/repo/a/b', visitedAt: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    expect(getRecentVisits()).toEqual(stored)
  })

  it('migrates legacy snake_case avatar_url entries on read', () => {
    const stored = [{ owner: 'a', name: 'b', avatar_url: 'https://x/y', navigatePath: '/repo/a/b', visitedAt: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    expect(getRecentVisits()).toEqual([
      { owner: 'a', name: 'b', ownerAvatarUrl: 'https://x/y', navigatePath: '/repo/a/b', visitedAt: 1 },
    ])
  })

  it('returns empty array on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(getRecentVisits()).toEqual([])
  })
})

describe('recordRecentVisit', () => {
  it('adds a new entry with visitedAt timestamp', () => {
    recordRecentVisit(entry('repo1'))
    const visits = getRecentVisits()
    expect(visits).toHaveLength(1)
    expect(visits[0].owner).toBe('alice')
    expect(visits[0].name).toBe('repo1')
    expect(typeof visits[0].visitedAt).toBe('number')
  })

  it('prepends new entries (newest first)', () => {
    recordRecentVisit(entry('repo1'))
    recordRecentVisit(entry('repo2'))
    const visits = getRecentVisits()
    expect(visits[0].name).toBe('repo2')
    expect(visits[1].name).toBe('repo1')
  })

  it('deduplicates — revisiting moves entry to front', () => {
    recordRecentVisit(entry('repo1'))
    recordRecentVisit(entry('repo2'))
    recordRecentVisit(entry('repo1'))
    const visits = getRecentVisits()
    expect(visits).toHaveLength(2)
    expect(visits[0].name).toBe('repo1')
    expect(visits[1].name).toBe('repo2')
  })

  it('caps at 30 entries, dropping oldest', () => {
    for (let i = 0; i < 35; i++) {
      recordRecentVisit(entry(`repo${i}`))
    }
    expect(getRecentVisits()).toHaveLength(30)
    expect(getRecentVisits()[0].name).toBe('repo34')
  })

  it('stores the provided navigatePath unchanged', () => {
    recordRecentVisit({ ...entry('repo1'), navigatePath: '/local-project?path=%2Ffoo&name=repo1&git=1' })
    expect(getRecentVisits()[0].navigatePath).toBe('/local-project?path=%2Ffoo&name=repo1&git=1')
  })
})
