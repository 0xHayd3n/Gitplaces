// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import {
  setTokenStoreBackend,
  getToken,
  setToken,
  clearToken,
  migrateLegacyGitHubToken,
  type TokenStoreBackend,
} from './tokenStore'

function makeMapBackend(initial: Record<string, unknown> = {}): TokenStoreBackend {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    get: (k) => data.get(k),
    set: (k, v) => { data.set(k, v) },
    delete: (k) => { data.delete(k) },
    has: (k) => data.has(k),
  }
}

describe('tokenStore', () => {
  beforeEach(() => {
    setTokenStoreBackend(makeMapBackend())
  })

  it('getToken returns null for an unknown host', () => {
    expect(getToken(HOST_ID_GITHUB)).toBeNull()
  })

  it('setToken then getToken round-trips', () => {
    setToken(HOST_ID_GITHUB, 'abc123')
    expect(getToken(HOST_ID_GITHUB)).toBe('abc123')
  })

  it('clearToken removes the entry', () => {
    setToken(HOST_ID_GITHUB, 'abc123')
    clearToken(HOST_ID_GITHUB)
    expect(getToken(HOST_ID_GITHUB)).toBeNull()
  })

  it('multiple hosts keep separate tokens', () => {
    setToken(HOST_ID_GITHUB, 'gh-tok')
    setToken('gl:gitlab.com', 'gl-tok')
    expect(getToken(HOST_ID_GITHUB)).toBe('gh-tok')
    expect(getToken('gl:gitlab.com')).toBe('gl-tok')
  })
})

describe('migrateLegacyGitHubToken', () => {
  it('moves github.token → tokens.gh:api.github.com when only the legacy key exists', () => {
    const backend = makeMapBackend({ 'github.token': 'legacy-tok' })
    setTokenStoreBackend(backend)

    migrateLegacyGitHubToken()

    expect(getToken(HOST_ID_GITHUB)).toBe('legacy-tok')
    expect(backend.has('github.token')).toBe(false)
  })

  it('does not overwrite an existing per-host token', () => {
    const backend = makeMapBackend({
      'github.token': 'legacy-tok',
      'tokens.gh:api.github.com': 'new-tok',
    })
    setTokenStoreBackend(backend)

    migrateLegacyGitHubToken()

    expect(getToken(HOST_ID_GITHUB)).toBe('new-tok')
    expect(backend.has('github.token')).toBe(false)
  })

  it('is a no-op when no legacy key is present', () => {
    const backend = makeMapBackend({ 'tokens.gh:api.github.com': 'kept' })
    setTokenStoreBackend(backend)

    migrateLegacyGitHubToken()

    expect(getToken(HOST_ID_GITHUB)).toBe('kept')
  })

  it('is idempotent across repeat calls', () => {
    const backend = makeMapBackend({ 'github.token': 'legacy-tok' })
    setTokenStoreBackend(backend)

    migrateLegacyGitHubToken()
    migrateLegacyGitHubToken()

    expect(getToken(HOST_ID_GITHUB)).toBe('legacy-tok')
  })
})
