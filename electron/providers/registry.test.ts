// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import { getProvider, getAnyProvider, getDefaultProvider, _resetGitLabCacheForTest, _resetGiteaCacheForTest, _resetGitHubCacheForTest } from './registry'
import { GitHubProvider, githubProvider } from './github'
import { addHost } from './hostConfig'
import { GitLabProvider } from './gitlab'
import { GiteaProvider } from './gitea'
import { setHostConfigBackend, seedDefaultHosts, type HostConfigBackend } from './hostConfig'

function makeMapBackend(): HostConfigBackend {
  const data = new Map<string, unknown>()
  return {
    get: (k) => data.get(k),
    set: (k, v) => { data.set(k, v) },
    has: (k) => data.has(k),
  }
}

describe('registry', () => {
  beforeEach(() => {
    _resetGitLabCacheForTest()
    _resetGiteaCacheForTest()
    _resetGitHubCacheForTest()
    setHostConfigBackend(makeMapBackend())
    seedDefaultHosts()
  })

  it('getProvider returns the GitHub provider for HOST_ID_GITHUB', () => {
    const p = getProvider(HOST_ID_GITHUB)
    expect(p).toBeInstanceOf(GitHubProvider)
  })

  it('getProvider returns null for non-GitHub host ids (narrowed legacy accessor)', () => {
    // Legacy code paths (main.ts, repoHandlers.ts) call GitHub-specific methods.
    // getProvider intentionally narrows so those paths reject non-GitHub hosts
    // up front rather than failing later with method-not-found.
    expect(getProvider('gl:gitlab.com')).toBeNull()
    expect(getProvider('gt:codeberg.org')).toBeNull()
  })

  it('getAnyProvider returns a GitLab provider for gl:gitlab.com after seeding', () => {
    const p = getAnyProvider('gl:gitlab.com')
    expect(p).toBeInstanceOf(GitLabProvider)
    expect(p && p.baseUrl).toBe('https://gitlab.com')
    expect(p && p.hostType).toBe('gitlab')
  })

  it('getAnyProvider returns the GitHub provider for HOST_ID_GITHUB', () => {
    expect(getAnyProvider(HOST_ID_GITHUB)).toBeInstanceOf(GitHubProvider)
  })

  it('getAnyProvider memoizes the GitLab instance across calls', () => {
    const a = getAnyProvider('gl:gitlab.com')
    const b = getAnyProvider('gl:gitlab.com')
    expect(a).toBe(b)
  })

  it('getAnyProvider returns a Gitea provider for gt:codeberg.org after seeding', () => {
    const p = getAnyProvider('gt:codeberg.org')
    expect(p).toBeInstanceOf(GiteaProvider)
    expect(p && p.baseUrl).toBe('https://codeberg.org')
    expect(p && p.hostType).toBe('gitea')
  })

  it('getAnyProvider memoizes the Gitea instance across calls', () => {
    const a = getAnyProvider('gt:codeberg.org')
    const b = getAnyProvider('gt:codeberg.org')
    expect(a).toBe(b)
  })

  it('GitLab and Gitea providers do not collide on memoization', () => {
    const gl = getAnyProvider('gl:gitlab.com')
    const gt = getAnyProvider('gt:codeberg.org')
    expect(gl).toBeInstanceOf(GitLabProvider)
    expect(gt).toBeInstanceOf(GiteaProvider)
    expect(gl).not.toBe(gt)
  })

  it('getProvider memoizes the GitHub instance across calls', () => {
    const a = getProvider(HOST_ID_GITHUB)
    const b = getProvider(HOST_ID_GITHUB)
    expect(a).toBe(b)
  })

  it('returns null for unknown host ids', () => {
    expect(getAnyProvider('gt:gitea.acme.com')).toBeNull()   // not seeded
    expect(getAnyProvider('gl:gitlab.acme.com')).toBeNull()  // not seeded
    expect(getAnyProvider('xx:nothing.example')).toBeNull()  // unknown prefix
  })

  it('getDefaultProvider returns the GitHub provider', () => {
    expect(getDefaultProvider()).toBeInstanceOf(GitHubProvider)
  })
})

describe('registry — GitHub Enterprise', () => {
  beforeEach(() => {
    _resetGitLabCacheForTest()
    _resetGiteaCacheForTest()
    _resetGitHubCacheForTest()
    setHostConfigBackend(makeMapBackend())
    seedDefaultHosts()
  })

  it('mints a per-hostId GitHubProvider for a non-default gh: hostId', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const provider = getAnyProvider('gh:github.acme.com/api/v3')
    expect(provider).toBeInstanceOf(GitHubProvider)
    expect((provider as GitHubProvider).baseUrl).toBe('https://github.acme.com/api/v3')
    expect((provider as GitHubProvider).hostId).toBe('gh:github.acme.com/api/v3')
  })

  it('caches the GHE provider — repeated lookups return the same instance', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const a = getAnyProvider('gh:github.acme.com/api/v3')
    const b = getAnyProvider('gh:github.acme.com/api/v3')
    expect(a).toBe(b)
  })

  it('GHE provider is distinct from the public-instance singleton', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const ghe = getAnyProvider('gh:github.acme.com/api/v3')
    const pub = getAnyProvider(HOST_ID_GITHUB)
    expect(ghe).not.toBe(pub)
    expect(pub).toBe(githubProvider)
  })

  it('returns null for a gh: hostId not present in hostConfig', () => {
    expect(getAnyProvider('gh:unknown.acme.com')).toBeNull()
  })

  it('getProvider (narrow accessor) returns the GHE GitHubProvider too', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const p = getProvider('gh:github.acme.com/api/v3')
    expect(p).toBeInstanceOf(GitHubProvider)
    expect(p?.baseUrl).toBe('https://github.acme.com/api/v3')
  })
})
