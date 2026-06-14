// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import {
  setHostConfigBackend,
  listHosts,
  getHost,
  addHost,
  removeHost,
  seedDefaultHosts,
  type HostConfigBackend,
} from './hostConfig'

function makeMapBackend(): HostConfigBackend {
  const data = new Map<string, unknown>()
  return {
    get: (k) => data.get(k),
    set: (k, v) => { data.set(k, v) },
    has: (k) => data.has(k),
  }
}

describe('hostConfig', () => {
  beforeEach(() => {
    setHostConfigBackend(makeMapBackend())
  })

  it('returns an empty list before seeding', () => {
    expect(listHosts()).toEqual([])
  })

  it('seedDefaultHosts seeds GitHub and GitLab.com on first run', () => {
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)

    const gh = hosts.find(h => h.id === HOST_ID_GITHUB)
    expect(gh).toBeDefined()
    expect(gh!.type).toBe('github')
    expect(gh!.baseUrl).toBe('https://api.github.com')
    expect(gh!.label).toBe('GitHub')

    const gl = hosts.find(h => h.id === 'gl:gitlab.com')
    expect(gl).toBeDefined()
    expect(gl!.type).toBe('gitlab')
    expect(gl!.baseUrl).toBe('https://gitlab.com')
    expect(gl!.label).toBe('GitLab.com')
  })

  it('seedDefaultHosts is idempotent across repeat calls', () => {
    seedDefaultHosts()
    seedDefaultHosts()
    expect(listHosts()).toHaveLength(2)
  })

  it('seedDefaultHosts preserves a pre-existing GitHub entry but still adds GitLab', () => {
    addHost({ type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub (renamed)' })
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.find(h => h.id === HOST_ID_GITHUB)!.label).toBe('GitHub (renamed)')
    expect(hosts.find(h => h.id === 'gl:gitlab.com')).toBeDefined()
  })

  it('addHost adds a self-hosted instance with a computed id', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme GitLab' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(3)
    expect(hosts.map(h => h.id).sort()).toEqual([
      'gh:api.github.com',
      'gl:gitlab.acme.com',
      'gl:gitlab.com',
    ])
  })

  it('addHost is rejected for duplicate ids', () => {
    seedDefaultHosts()
    expect(() =>
      addHost({ type: 'github', baseUrl: 'https://api.github.com', label: 'dup' })
    ).toThrow(/already exists/)
  })

  it('getHost returns null for unknown ids', () => {
    seedDefaultHosts()
    expect(getHost('gt:codeberg.org')).toBeNull()
  })

  it('removeHost removes the given instance', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme GitLab' })
    removeHost('gl:gitlab.acme.com')
    expect(listHosts()).toHaveLength(2)
    expect(getHost('gl:gitlab.acme.com')).toBeNull()
  })
})
