// electron/providers/tokenStore.ts
//
// Per-host PAT storage. Backed by an injected key-value store so the same
// module is unit-testable (Map backend) and production-runnable
// (electron-store backend, wired up in main.ts).
//
// Storage keys: 'tokens.<hostId>' — string PAT.
// Legacy key:   'github.token'   — the pre-Phase-1 single-host GitHub token.

import { HOST_ID_GITHUB } from './types'

const LEGACY_GH_KEY = 'github.token'

export interface TokenStoreBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
  has(key: string): boolean
}

let backend: TokenStoreBackend | null = null

export function setTokenStoreBackend(b: TokenStoreBackend): void {
  backend = b
}

function requireBackend(): TokenStoreBackend {
  if (!backend) throw new Error('tokenStore backend not initialized')
  return backend
}

function key(hostId: string): string {
  return `tokens.${hostId}`
}

export function getToken(hostId: string): string | null {
  const v = requireBackend().get(key(hostId))
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function setToken(hostId: string, token: string): void {
  requireBackend().set(key(hostId), token)
}

export function clearToken(hostId: string): void {
  requireBackend().delete(key(hostId))
}

/**
 * One-shot migration from the legacy single-host `github.token` to the new
 * `tokens.<HOST_ID_GITHUB>` slot. Idempotent.
 *
 * Behavior:
 *   - Legacy present + per-host absent → copy legacy → per-host; delete legacy.
 *   - Legacy present + per-host present → leave per-host alone; delete legacy.
 *   - Legacy absent                     → no-op.
 */
export function migrateLegacyGitHubToken(): void {
  const b = requireBackend()
  const legacy = b.get(LEGACY_GH_KEY)
  if (typeof legacy !== 'string' || legacy.length === 0) return

  const perHostKey = key(HOST_ID_GITHUB)
  if (!b.has(perHostKey)) {
    b.set(perHostKey, legacy)
  }
  b.delete(LEGACY_GH_KEY)
}
