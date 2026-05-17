import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./github', () => ({
  searchRepos: vi.fn().mockResolvedValue([]),
}))

import { rankResults, rawSearch, tagSearch } from './smart-search'
import { searchRepos as mockSearchRepos } from './github'

const mockFn = mockSearchRepos as ReturnType<typeof vi.fn>

const makeRepo = (overrides: Partial<{
  full_name: string
  topics: string[]
  stargazers_count: number
  pushed_at: string
  size: number
}>) => ({
  id: 1,
  full_name: overrides.full_name ?? 'owner/repo',
  owner: { login: 'owner' },
  name: 'repo',
  description: '',
  language: null,
  topics: overrides.topics ?? [],
  stargazers_count: overrides.stargazers_count ?? 1000,
  forks_count: 0,
  open_issues_count: 0,
  pushed_at: overrides.pushed_at ?? new Date(Date.now() - 90 * 86400000).toISOString(),
  size: overrides.size ?? 1000,
  default_branch: 'main',
})

describe('rankResults', () => {
  it('ranks a repo with more matching tags higher', () => {
    const tags = ['markdown', 'terminal', 'cli']
    const highMatch = makeRepo({ full_name: 'a/a', topics: ['markdown', 'terminal', 'cli'] })
    const lowMatch  = makeRepo({ full_name: 'b/b', topics: ['markdown'] })
    const ranked = rankResults([lowMatch, highMatch], tags)
    expect(ranked[0].full_name).toBe('a/a')
  })

  it('gives recency boost to repos pushed within 7 days', () => {
    const tags: string[] = []
    const recent = makeRepo({
      full_name: 'a/a',
      stargazers_count: 100,
      pushed_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    })
    const old = makeRepo({
      full_name: 'b/b',
      stargazers_count: 100,
      pushed_at: new Date(Date.now() - 365 * 86400000).toISOString(),
    })
    const ranked = rankResults([old, recent], tags)
    expect(ranked[0].full_name).toBe('a/a')
  })

  it('penalises very large repos', () => {
    const tags = ['cli']
    const big   = makeRepo({ full_name: 'a/a', topics: ['cli'], size: 600000 })
    const small = makeRepo({ full_name: 'b/b', topics: ['cli'], size: 500 })
    const ranked = rankResults([big, small], tags)
    expect(ranked[0].full_name).toBe('b/b')
  })

  it('attaches a score property to each result', () => {
    const ranked = rankResults([makeRepo({})], [])
    expect(ranked[0]).toHaveProperty('score')
    expect(typeof ranked[0].score).toBe('number')
  })
})

describe('rawSearch', () => {
  beforeEach(() => mockFn.mockReset().mockResolvedValue([]))

  it('passes page parameter to searchRepos', async () => {
    await rawSearch('tok', 'react', undefined, undefined, 3)
    expect(mockFn).toHaveBeenCalledWith('tok', 'react', 100, undefined, undefined, 3)
  })

  it('defaults page to 1 when omitted', async () => {
    await rawSearch('tok', 'react')
    expect(mockFn).toHaveBeenCalledWith('tok', 'react', 100, undefined, undefined, 1)
  })

  it('uses perPage of 100', async () => {
    await rawSearch('tok', 'react')
    expect(mockFn.mock.calls[0][2]).toBe(100)
  })
})

describe('tagSearch', () => {
  beforeEach(() => mockFn.mockReset().mockResolvedValue([]))

  it('passes page parameter to all sub-queries', async () => {
    await tagSearch('tok', ['react', 'hooks'], 'react hooks', undefined, undefined, 2)
    for (const call of mockFn.mock.calls) {
      expect(call[5]).toBe(2)
    }
  })

  it('defaults page to 1 when omitted', async () => {
    await tagSearch('tok', ['react'], 'react')
    for (const call of mockFn.mock.calls) {
      expect(call[5]).toBe(1)
    }
  })
})
