// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import { getProvider, getAnyProvider, getDefaultProvider } from './registry'
import { GitHubProvider } from './github'
import { GitLabProvider } from './gitlab'
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

  it('getProvider memoizes the GitHub instance across calls', () => {
    const a = getProvider(HOST_ID_GITHUB)
    const b = getProvider(HOST_ID_GITHUB)
    expect(a).toBe(b)
  })

  it('returns null for unknown host ids', () => {
    expect(getProvider('gt:codeberg.org')).toBeNull()
    expect(getAnyProvider('gt:codeberg.org')).toBeNull()
    expect(getAnyProvider('gl:gitlab.acme.com')).toBeNull()  // not seeded
  })

  it('getDefaultProvider returns the GitHub provider', () => {
    expect(getDefaultProvider()).toBeInstanceOf(GitHubProvider)
  })
})
