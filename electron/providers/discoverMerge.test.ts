// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Repo } from '../../src/types/repo'
import type { HostInstance } from './types'

const resolveAnyMock = vi.fn()
vi.mock('./registry', () => ({
  getAnyProvider: (hostId: string) => resolveAnyMock(hostId),
}))

import { searchAllHosts, translateQuery } from './discoverMerge'

function repo(hostId: string, name: string, pushedAt: string, stars = 100): Repo {
  return {
    hostId,
    hostType: hostId.startsWith('gh:') ? 'github' : hostId.startsWith('gl:') ? 'gitlab' : 'gitea',
    hostNativeId: name,
    fullName: `org/${name}`,
    owner: 'org',
    name,
    htmlUrl: `https://example.org/org/${name}`,
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: pushedAt,
    updatedAt: pushedAt,
    pushedAt,
    ownerAvatarUrl: '',
  }
}

function host(id: string, type: HostInstance['type']): HostInstance {
  return { id, type, baseUrl: `https://${id.slice(3)}`, label: id, addedAt: '2026-01-01T00:00:00Z' }
}

describe('translateQuery', () => {
  it('builds GitHub trending-week query', () => {
    const out = translateQuery('github', { kind: 'trending-week' })
    expect(out.query).toMatch(/created:>\d{4}-\d{2}-\d{2}/)
    expect(out.sort).toBe('stars')
  })
  it('builds GitHub hot-today query', () => {
    const out = translateQuery('github', { kind: 'hot-today' })
    expect(out.query).toMatch(/pushed:>\d{4}-\d{2}-\d{2}/)
    expect(out.sort).toBe('updated')
  })
  it('builds GitHub hidden-gems query', () => {
    const out = translateQuery('github', { kind: 'hidden-gems' })
    expect(out.query).toContain('stars:50..500')
  })
  it('builds GitHub popular query (stars:>100, sort by stars)', () => {
    const out = translateQuery('github', { kind: 'popular' })
    expect(out.query).toBe('stars:>100')
    expect(out.sort).toBe('stars')
  })
  it('builds GitLab/Gitea popular query (free-text + stars sort)', () => {
    expect(translateQuery('gitlab', { kind: 'popular' }).query).toBe('')
    expect(translateQuery('gitlab', { kind: 'popular' }).sort).toBe('stars')
    expect(translateQuery('gitea',  { kind: 'popular' }).sort).toBe('stars')
  })
  it('builds GitHub topic query', () => {
    const out = translateQuery('github', { kind: 'topic', topic: 'rust' })
    expect(out.query).toContain('topic:rust')
  })
  it('builds GitHub free-text query', () => {
    const out = translateQuery('github', { kind: 'free-text', freeText: 'electron' })
    expect(out.query).toBe('electron')
  })
  it('builds GitLab/Gitea trending-week query (plain text, recency sort)', () => {
    expect(translateQuery('gitlab', { kind: 'trending-week' }).sort).toBe('updated')
    expect(translateQuery('gitea', { kind: 'trending-week' }).sort).toBe('updated')
  })
  it('builds GitLab/Gitea topic query', () => {
    expect(translateQuery('gitlab', { kind: 'topic', topic: 'rust' }).query).toBe('rust')
    expect(translateQuery('gitea', { kind: 'topic', topic: 'rust' }).query).toBe('rust')
  })
})

describe('translateQuery — filters', () => {
  it('GitHub: encodes language + minStars + license + activityWindow into the query', () => {
    const out = translateQuery('github', {
      kind: 'popular',
      filters: {
        language: 'typescript',
        minStars: 1000,
        license: 'mit',
        activityWindow: 'week',
      },
    })
    expect(out.query).toContain('stars:>100')
    expect(out.query).toContain('language:typescript')
    expect(out.query).toContain('stars:>=1000')
    expect(out.query).toContain('license:mit')
    expect(out.query).toMatch(/pushed:>\d{4}-\d{2}-\d{2}/)
    expect(out.postFilter).toBeUndefined()
  })

  it('GitLab: encodes language via query; postFilter applies minStars + license + activityWindow', () => {
    const out = translateQuery('gitlab', {
      kind: 'topic',
      topic: 'rust',
      filters: { language: 'rust', minStars: 1000, license: 'mit', activityWindow: 'week' },
    })
    expect(out.query).toBe('rust')
    expect(typeof out.postFilter).toBe('function')
    const baseRepo = {
      hostId: 'gl:gitlab.com', hostType: 'gitlab' as const, hostNativeId: 1,
      fullName: 'o/n', owner: 'o', name: 'n', htmlUrl: '', homepageUrl: null,
      description: null, language: 'Rust', topics: [], license: 'MIT',
      defaultBranch: 'main', archived: false, size: 0, stars: 5000, forks: 0,
      watchers: 0, openIssues: 0, createdAt: '', updatedAt: '', pushedAt: new Date().toISOString(),
      ownerAvatarUrl: '',
    }
    expect(out.postFilter!(baseRepo)).toBe(true)
    expect(out.postFilter!({ ...baseRepo, stars: 50 })).toBe(false)
    expect(out.postFilter!({ ...baseRepo, license: 'Apache-2.0' })).toBe(false)
    const longAgo = new Date(Date.now() - 60 * 86400_000).toISOString()
    expect(out.postFilter!({ ...baseRepo, pushedAt: longAgo })).toBe(false)
  })

  it('Gitea: same postFilter-driven shape as GitLab', () => {
    const out = translateQuery('gitea', {
      kind: 'topic',
      topic: 'rust',
      filters: { minStars: 1000 },
    })
    expect(typeof out.postFilter).toBe('function')
    const baseRepo = {
      hostId: 'gt:codeberg.org', hostType: 'gitea' as const, hostNativeId: 1,
      fullName: 'o/n', owner: 'o', name: 'n', htmlUrl: '', homepageUrl: null,
      description: null, language: 'Rust', topics: [], license: null,
      defaultBranch: 'main', archived: false, size: 0, stars: 2000, forks: 0,
      watchers: 0, openIssues: 0, createdAt: '', updatedAt: '', pushedAt: '',
      ownerAvatarUrl: '',
    }
    expect(out.postFilter!(baseRepo)).toBe(true)
    expect(out.postFilter!({ ...baseRepo, stars: 50 })).toBe(false)
  })

  it('searchAllHosts applies postFilter to each host result before merging', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')
    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z', 5000)]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockResolvedValue([
          repo('gl:gitlab.com', 'b', '2026-06-13T10:00:00Z', 2000),
          repo('gl:gitlab.com', 'c', '2026-06-12T10:00:00Z', 50),
        ]),
      }
      return null
    })
    const out = await searchAllHosts([ghHost, glHost], {
      kind: 'topic', topic: 'rust', filters: { minStars: 1000 },
    }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name).sort()).toEqual(['a', 'b'])
  })
})

describe('searchAllHosts', () => {
  beforeEach(() => resolveAnyMock.mockReset())

  it('fans out across hosts, caps each at capPerHost, sorts by pushedAt desc', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([
          repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z'),
          repo('gh:api.github.com', 'b', '2026-06-13T10:00:00Z'),
          repo('gh:api.github.com', 'c', '2026-06-12T10:00:00Z'),
        ]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockResolvedValue([
          repo('gl:gitlab.com', 'x', '2026-06-15T10:00:00Z'),
          repo('gl:gitlab.com', 'y', '2026-06-11T10:00:00Z'),
        ]),
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['x', 'a', 'b', 'c', 'y'])
  })

  it('respects capPerHost — clips each host before merging', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    resolveAnyMock.mockImplementation(() => ({
      searchRepos: vi.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) =>
          repo('gh:api.github.com', `r${i}`, `2026-06-${String(14 - (i % 14)).padStart(2, '0')}T10:00:00Z`),
        ),
      ),
    }))
    const out = await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 5, totalLimit: 100 })
    expect(out).toHaveLength(5)
  })

  it('respects totalLimit', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    const ghRepos = Array.from({ length: 10 }, (_, i) =>
      repo('gh:api.github.com', `gh-${i}`, `2026-06-${String(15 - i).padStart(2, '0')}T10:00:00Z`),
    )
    const glRepos = Array.from({ length: 10 }, (_, i) =>
      repo('gl:gitlab.com', `gl-${i}`, `2026-06-${String(15 - i).padStart(2, '0')}T11:00:00Z`),
    )

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return { searchRepos: vi.fn().mockResolvedValue(ghRepos) }
      if (hostId === 'gl:gitlab.com')    return { searchRepos: vi.fn().mockResolvedValue(glRepos) }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 8 })
    expect(out).toHaveLength(8)
  })

  it('soft-times-out a slow host — contributes nothing rather than blocking the merge', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockImplementation(() => new Promise(() => {})),
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30, timeoutMs: 50 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('a throwing host contributes nothing — others still merge', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockRejectedValue(new Error('boom')),
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('returns [] when every host fails', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    resolveAnyMock.mockImplementation(() => ({
      searchRepos: vi.fn().mockRejectedValue(new Error('down')),
    }))
    const out = await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out).toEqual([])
  })

  it('skips hosts with no resolved provider (e.g. token missing / config mismatch)', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')
    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      return null
    })
    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('passes the per-host token via tokenForHost when supplied', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const searchSpy = vi.fn().mockResolvedValue([])
    resolveAnyMock.mockImplementation(() => ({ searchRepos: searchSpy }))
    await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30, tokenForHost: (id: string) => `tok-${id}` })
    expect(searchSpy).toHaveBeenCalledWith(
      'tok-gh:api.github.com',
      expect.any(String),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
    )
  })

  it('defaults to page=1 and forwards opts.page when supplied', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const searchSpy = vi.fn().mockResolvedValue([])
    resolveAnyMock.mockImplementation(() => ({ searchRepos: searchSpy }))

    await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(searchSpy.mock.calls[0][5]).toBe(1)

    searchSpy.mockClear()
    await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30, page: 3 })
    expect(searchSpy.mock.calls[0][5]).toBe(3)
  })
})
