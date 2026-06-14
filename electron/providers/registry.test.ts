// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import { getProvider, getDefaultProvider } from './registry'
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

  it('getProvider returns a GitLab provider for gl:gitlab.com after seeding', () => {
    const p = getProvider('gl:gitlab.com')
    expect(p).toBeInstanceOf(GitLabProvider)
    expect(p && p.baseUrl).toBe('https://gitlab.com')
    expect(p && p.hostType).toBe('gitlab')
  })

  it('getProvider memoizes the GitLab instance across calls', () => {
    const a = getProvider('gl:gitlab.com')
    const b = getProvider('gl:gitlab.com')
    expect(a).toBe(b)
  })

  it('getProvider memoizes the GitHub instance across calls', () => {
    const a = getProvider(HOST_ID_GITHUB)
    const b = getProvider(HOST_ID_GITHUB)
    expect(a).toBe(b)
  })

  it('getProvider returns null for unknown host ids', () => {
    expect(getProvider('gt:codeberg.org')).toBeNull()
    expect(getProvider('gl:gitlab.acme.com')).toBeNull()  // not seeded
  })

  it('getDefaultProvider returns the GitHub provider', () => {
    expect(getDefaultProvider()).toBeInstanceOf(GitHubProvider)
  })
})
