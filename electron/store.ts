import Store from 'electron-store'
import type { ProviderId } from './llm/types'
import { parseModelRef, formatModelRef } from './llm/registry'

interface GitHubStoreSchema {
  'github.token'?: string
  'github.username'?: string
  'github.avatarUrl'?: string
}

const githubStore = new Store<GitHubStoreSchema>()

export function getToken(): string | undefined {
  return githubStore.get('github.token')
}

export function setToken(token: string): void {
  githubStore.set('github.token', token)
}

export function clearToken(): void {
  githubStore.delete('github.token')
}

export function getGitHubUser(): { username: string; avatarUrl: string } | undefined {
  const username = githubStore.get('github.username')
  const avatarUrl = githubStore.get('github.avatarUrl')
  if (!username) return undefined
  return { username, avatarUrl: avatarUrl ?? '' }
}

export function setGitHubUser(username: string, avatarUrl: string): void {
  githubStore.set('github.username', username)
  githubStore.set('github.avatarUrl', avatarUrl)
}

export function clearGitHubUser(): void {
  githubStore.delete('github.username')
  githubStore.delete('github.avatarUrl')
}

type ProviderConfig = {
  enabled: boolean
  /**
   * Only meaningful for providers that take a top-level API key (anthropic, openai, google).
   * Silently ignored for opencode (uses Claude Code's auth) and openai-compatible
   * (keys live per-endpoint in the `endpoints` array).
   */
  apiKey?: string
}

type OpenAICompatibleEndpoint = {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
}

interface ApiStoreSchema {
  // Legacy — kept as a back-compat alias. New code reads/writes via
  // providers.anthropic.apiKey; setApiKey() writes both, getApiKey() prefers
  // providers.* and falls back to the legacy key.
  'anthropic.apiKey'?: string

  // Per-provider config introduced by Phase 1 of the multi-provider effort.
  'providers.anthropic.apiKey'?: string
  'providers.anthropic.enabled'?: boolean
  'providers.openai.apiKey'?: string
  'providers.openai.enabled'?: boolean
  'providers.openai.organization'?: string
  'providers.google.apiKey'?: string
  'providers.google.enabled'?: boolean
  'providers.opencode.enabled'?: boolean
  'providers.openai-compatible.enabled'?: boolean
  'providers.openai-compatible.endpoints'?: OpenAICompatibleEndpoint[]

  'defaults.chat'?:       { provider: ProviderId; model: string; endpoint?: string }
  'defaults.skillGen'?:   { provider: ProviderId; model: string; endpoint?: string }
  'defaults.tagExtract'?: { provider: ProviderId; model: string; endpoint?: string }
}

const apiStore = new Store<ApiStoreSchema>({ encryptionKey: 'git-suite-api-key-v1' })

// ── API key (back-compat aliases) ───────────────────────────────
export function getApiKey(): string | undefined {
  return apiStore.get('providers.anthropic.apiKey') ?? apiStore.get('anthropic.apiKey')
}

export function setApiKey(key: string): void {
  apiStore.set('providers.anthropic.apiKey', key)
  apiStore.set('anthropic.apiKey', key) // keep legacy key in sync for any code that still reads it directly
}

// ── Generic per-provider config ─────────────────────────────────
/**
 * Read a provider's configured state.
 *
 * Note on `apiKey: undefined` ambiguity: this can mean either "user hasn't set
 * one yet, prompt them" OR "this provider doesn't have a top-level key by design"
 * (opencode reuses Claude Code's auth; openai-compatible stores per-endpoint keys
 * in the `endpoints` array). Callers that branch on missing keys must consult
 * PROVIDERS_WITHOUT_TOP_LEVEL_KEY (see setProviderConfig below) to disambiguate.
 *
 * TODO(Phase 4): split into KeyedProviderConfig | KeylessProviderConfig when the
 * Settings UI gains real callers and the type-level distinction earns its keep.
 */
export function getProviderConfig(provider: ProviderId): ProviderConfig {
  return {
    enabled: apiStore.get(`providers.${provider}.enabled` as keyof ApiStoreSchema) as boolean | undefined ?? false,
    apiKey:  apiStore.get(`providers.${provider}.apiKey`  as keyof ApiStoreSchema) as string  | undefined,
  }
}

// Providers that do NOT have a top-level apiKey: opencode reuses Claude Code's auth;
// openai-compatible stores per-endpoint keys inside the `endpoints` array instead.
const PROVIDERS_WITHOUT_TOP_LEVEL_KEY: ReadonlySet<ProviderId> = new Set([
  'opencode',
  'openai-compatible',
])

export function setProviderConfig(provider: ProviderId, cfg: ProviderConfig): void {
  apiStore.set(`providers.${provider}.enabled` as keyof ApiStoreSchema, cfg.enabled as never)
  if (PROVIDERS_WITHOUT_TOP_LEVEL_KEY.has(provider)) {
    // apiKey is meaningless for these providers — silently ignored, never written.
    return
  }
  if (cfg.apiKey === undefined) {
    apiStore.delete(`providers.${provider}.apiKey` as keyof ApiStoreSchema)
  } else {
    apiStore.set(`providers.${provider}.apiKey` as keyof ApiStoreSchema, cfg.apiKey as never)
  }
}

/**
 * OpenAI has an optional `organization` field on top of the generic
 * `apiKey` + `enabled`. This dedicated helper reads it alongside the
 * generic provider config so the adapter gets a complete view.
 */
export function getOpenAIProviderConfig(): { enabled: boolean; apiKey?: string; organization?: string } {
  const base = getProviderConfig('openai')
  return {
    ...base,
    organization: apiStore.get('providers.openai.organization') as string | undefined,
  }
}

// ── Defaults (per-feature ModelRef preferences) ─────────────────
export type DefaultFeature = 'chat' | 'skillGen' | 'tagExtract'
export type StoredModelRef = { provider: ProviderId; model: string; endpoint?: string }

export function getDefault(feature: DefaultFeature): StoredModelRef | undefined {
  const key = `defaults.${feature}` as keyof ApiStoreSchema
  return apiStore.get(key) as StoredModelRef | undefined
}

export function setDefault(feature: DefaultFeature, ref: StoredModelRef): void {
  // Validate the ref shape by round-tripping through the parser. This rejects
  // unknown providers + malformed openai-compatible endpoints, matching the
  // validation that the LLM service performs at call time.
  const formatted = formatModelRef(ref)
  parseModelRef(formatted)  // throws on invalid

  const key = `defaults.${feature}` as keyof ApiStoreSchema
  apiStore.set(key, ref as never)
}

// ── openai-compatible endpoint list ─────────────────────────────
export function listOpenAICompatibleEndpoints(): OpenAICompatibleEndpoint[] {
  return apiStore.get('providers.openai-compatible.endpoints') ?? []
}

export function upsertOpenAICompatibleEndpoint(ep: OpenAICompatibleEndpoint): void {
  const all = listOpenAICompatibleEndpoints()
  const idx = all.findIndex(e => e.id === ep.id)
  if (idx === -1) all.push(ep)
  else all[idx] = ep
  apiStore.set('providers.openai-compatible.endpoints', all)
}

export function removeOpenAICompatibleEndpoint(id: string): void {
  const all = listOpenAICompatibleEndpoints().filter(e => e.id !== id)
  apiStore.set('providers.openai-compatible.endpoints', all)
}

// ── Migration (called once on startup from main.ts) ─────────────
/**
 * Copy legacy `anthropic.apiKey` into `providers.anthropic.apiKey` if the new key
 * is empty. Idempotent — safe to call on every startup.
 */
export function migrateApiStore(): void {
  const legacy = apiStore.get('anthropic.apiKey')
  const current = apiStore.get('providers.anthropic.apiKey')
  if (legacy && !current) {
    apiStore.set('providers.anthropic.apiKey', legacy)
    apiStore.set('providers.anthropic.enabled', true)
  }
}

interface SkillSyncStoreSchema {
  'skillSync.enabled': boolean
  'skillSync.repoOwner'?: string
}

const skillSyncStore = new Store<SkillSyncStoreSchema>()

export function getSyncEnabled(): boolean {
  return skillSyncStore.get('skillSync.enabled', false)
}

export function setSyncEnabled(v: boolean): void {
  skillSyncStore.set('skillSync.enabled', v)
}

export function getSyncRepoOwner(): string | undefined {
  return skillSyncStore.get('skillSync.repoOwner')
}

export function setSyncRepoOwner(v: string): void {
  skillSyncStore.set('skillSync.repoOwner', v)
}
