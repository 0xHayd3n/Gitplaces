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

  it('seedDefaultHosts seeds the GitHub instance', () => {
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(1)
    expect(hosts[0].id).toBe(HOST_ID_GITHUB)
    expect(hosts[0].type).toBe('github')
    expect(hosts[0].baseUrl).toBe('https://api.github.com')
    expect(hosts[0].label).toBe('GitHub')
  })

  it('seedDefaultHosts is idempotent', () => {
    seedDefaultHosts()
    seedDefaultHosts()
    expect(listHosts()).toHaveLength(1)
  })

  it('addHost adds an instance with a computed id', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.map(h => h.id).sort()).toEqual(['gh:api.github.com', 'gl:gitlab.com'])
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
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' })
    removeHost('gl:gitlab.com')
    expect(listHosts()).toHaveLength(1)
    expect(getHost('gl:gitlab.com')).toBeNull()
  })
})
