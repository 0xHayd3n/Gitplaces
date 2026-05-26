// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockStore } = vi.hoisted(() => {
  // electron-store mock with in-memory backing — every Store() instance shares it,
  // which matches the test patterns already used in electron/store.test.ts.
  const data = new Map<string, unknown>()
  return {
    mockStore: {
      get: vi.fn((k: string, def?: unknown) => (data.has(k) ? data.get(k) : def)),
      set: vi.fn((k: string, v: unknown) => { data.set(k, v) }),
      delete: vi.fn((k: string) => { data.delete(k) }),
      __seed: (k: string, v: unknown) => { data.set(k, v) },
      __reset: () => { data.clear() },
    },
  }
})

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => mockStore),
}))

import {
  getApiKey,
  setApiKey,
  getProviderConfig,
  setProviderConfig,
  listOpenAICompatibleEndpoints,
  upsertOpenAICompatibleEndpoint,
  removeOpenAICompatibleEndpoint,
  migrateApiStore,
  getOpenAIProviderConfig,
} from './store'

beforeEach(() => {
  mockStore.__reset()
  mockStore.get.mockClear()
  mockStore.set.mockClear()
  mockStore.delete.mockClear()
})

describe('migrateApiStore', () => {
  it('copies legacy anthropic.apiKey into providers.anthropic.apiKey and sets enabled=true', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    migrateApiStore()
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.apiKey', 'sk-legacy')
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.enabled', true)
  })

  it('does not overwrite providers.anthropic.apiKey if already set', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    mockStore.__seed('providers.anthropic.apiKey', 'sk-new')
    migrateApiStore()
    const calls = mockStore.set.mock.calls.filter(c => c[0] === 'providers.anthropic.apiKey')
    expect(calls).toHaveLength(0)
  })

  it('is a no-op when neither key is set', () => {
    migrateApiStore()
    expect(mockStore.set).not.toHaveBeenCalled()
  })

  it('is idempotent — running twice produces the same end state', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    migrateApiStore()
    const callsAfterFirst = mockStore.set.mock.calls.length
    migrateApiStore()
    // Second call should not write anything new — providers.anthropic.apiKey is now set.
    expect(mockStore.set.mock.calls.length).toBe(callsAfterFirst)
  })
})

describe('getApiKey (back-compat read-through alias)', () => {
  it('returns providers.anthropic.apiKey when set', () => {
    mockStore.__seed('providers.anthropic.apiKey', 'sk-new')
    expect(getApiKey()).toBe('sk-new')
  })

  it('falls back to legacy anthropic.apiKey if providers key is unset', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    expect(getApiKey()).toBe('sk-legacy')
  })

  it('returns undefined when neither is set', () => {
    expect(getApiKey()).toBeUndefined()
  })
})

describe('setApiKey (writes both legacy + new for back-compat)', () => {
  it('writes providers.anthropic.apiKey AND legacy anthropic.apiKey', () => {
    setApiKey('sk-fresh')
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.apiKey', 'sk-fresh')
    expect(mockStore.set).toHaveBeenCalledWith('anthropic.apiKey', 'sk-fresh')
  })
})

describe('getProviderConfig / setProviderConfig', () => {
  it('returns { enabled: false, apiKey: undefined } by default', () => {
    expect(getProviderConfig('openai')).toEqual({ enabled: false, apiKey: undefined })
  })

  it('round-trips a provider config', () => {
    setProviderConfig('openai', { enabled: true, apiKey: 'sk-openai-test' })
    expect(getProviderConfig('openai')).toEqual({ enabled: true, apiKey: 'sk-openai-test' })
  })

  it('supports google + opencode providers', () => {
    setProviderConfig('google', { enabled: true, apiKey: 'g-key' })
    setProviderConfig('opencode', { enabled: true })
    expect(getProviderConfig('google')).toEqual({ enabled: true, apiKey: 'g-key' })
    expect(getProviderConfig('opencode')).toEqual({ enabled: true, apiKey: undefined })
  })

  it('silently ignores apiKey for opencode (no top-level key by design)', () => {
    setProviderConfig('opencode', { enabled: true, apiKey: 'should-be-ignored' })
    // enabled was written
    expect(mockStore.set).toHaveBeenCalledWith('providers.opencode.enabled', true)
    // apiKey was NOT written
    const apiKeyWrites = mockStore.set.mock.calls.filter(c => c[0] === 'providers.opencode.apiKey')
    expect(apiKeyWrites).toHaveLength(0)
  })

  it('silently ignores apiKey for openai-compatible (per-endpoint keys instead)', () => {
    setProviderConfig('openai-compatible', { enabled: true, apiKey: 'should-be-ignored' })
    expect(mockStore.set).toHaveBeenCalledWith('providers.openai-compatible.enabled', true)
    const apiKeyWrites = mockStore.set.mock.calls.filter(c => c[0] === 'providers.openai-compatible.apiKey')
    expect(apiKeyWrites).toHaveLength(0)
  })
})

describe('openai-compatible endpoints', () => {
  it('returns an empty list by default', () => {
    expect(listOpenAICompatibleEndpoints()).toEqual([])
  })

  it('upsert creates a new endpoint when id is new', () => {
    upsertOpenAICompatibleEndpoint({
      id: 'ollama-local',
      label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'ollama-local', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
    ])
  })

  it('upsert updates an existing endpoint by id', () => {
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'old', baseUrl: 'http://a' })
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'new', baseUrl: 'http://b' })
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'e1', label: 'new', baseUrl: 'http://b' },
    ])
  })

  it('remove deletes by id', () => {
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'one', baseUrl: 'http://a' })
    upsertOpenAICompatibleEndpoint({ id: 'e2', label: 'two', baseUrl: 'http://b' })
    removeOpenAICompatibleEndpoint('e1')
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'e2', label: 'two', baseUrl: 'http://b' },
    ])
  })
})

describe('getOpenAIProviderConfig', () => {
  it('returns generic providerConfig fields plus organization', () => {
    setProviderConfig('openai', { enabled: true, apiKey: 'sk-x' })
    mockStore.__seed('providers.openai.organization', 'org-foo')  // direct write — no setter for this field yet
    expect(getOpenAIProviderConfig()).toEqual({
      enabled: true,
      apiKey: 'sk-x',
      organization: 'org-foo',
    })
  })

  it('returns organization=undefined when not set', () => {
    setProviderConfig('openai', { enabled: true, apiKey: 'sk-y' })
    expect(getOpenAIProviderConfig().organization).toBeUndefined()
  })
})
