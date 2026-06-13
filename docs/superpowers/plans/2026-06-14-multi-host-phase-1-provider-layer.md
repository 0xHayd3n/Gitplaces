# Multi-Host Phase 1: Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing GitHub integration to live behind a provider registry, without changing any renderer behavior. Lay the foundation for adding GitLab and Gitea in later phases.

**Architecture:** A new `electron/providers/` module houses a typed host registry, per-host token storage, a host-config store, and a `GitHubProvider` class that wraps the lifted contents of `electron/github.ts` and `electron/githubGraphql.ts`. All IPC handlers acquire the provider from the registry instead of calling top-level functions directly. The DB gains a `host_id` column on repo-keyed tables, defaulting to `gh:api.github.com`. The renderer's `window.api.github.*` surface and the on-screen behavior are unchanged.

**Tech Stack:** TypeScript, Electron, electron-store, better-sqlite3, vitest.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 1 section.

**Out of scope for this plan:** the `Repo` normalized shape adoption by the renderer (Phase 2), the parallel `window.api.repo.*` namespace (Phase 3), GitLab/Gitea providers (Phases 4–5), mixed-row Discover (Phase 6), self-hosted UX (Phase 7).

---

## File structure

### New files
- `electron/providers/types.ts` — shared types: `HostType`, `HostInstance`, `ProviderCapabilities`, the constant `HOST_ID_GITHUB`.
- `electron/providers/hostConfig.ts` — read/write the list of host instances, backed by an injected key-value store.
- `electron/providers/hostConfig.test.ts` — unit tests with a Map-backed mock store.
- `electron/providers/tokenStore.ts` — per-host PAT storage + one-shot legacy-token migration.
- `electron/providers/tokenStore.test.ts` — unit tests with a Map-backed mock store.
- `electron/providers/registry.ts` — `getProvider(hostId)` + `getDefaultProvider()`.
- `electron/providers/registry.test.ts` — unit tests covering provider memoization and default lookup.
- `electron/providers/github/rest.ts` — current contents of `electron/github.ts`, moved verbatim.
- `electron/providers/github/rest.test.ts` — current contents of `electron/github.test.ts`, moved verbatim with import path updated.
- `electron/providers/github/graphql.ts` — current contents of `electron/githubGraphql.ts`, moved verbatim.
- `electron/providers/github/index.ts` — exports the `GitHubProvider` class wrapping the rest/graphql functions and re-exports the underlying function-level API for back-compat during Phase 1.

### Modified files
- `electron/main.ts` — initialize the host-config/token-store backends and the registry on app ready; migrate the legacy `github.token`; replace direct top-level imports with provider-mediated calls in every `github:*` IPC handler.
- `electron/ipc/createHandlers.ts` — change one import path (`../github` → `../providers/github`).
- `electron/ipc/recommendHandlers.ts` — change import paths and replace top-level function calls with provider calls.
- `electron/ipc/updateHandlers.ts` — same as recommendHandlers.
- `electron/services/skillSyncService.ts` — update imports.
- `electron/services/agentsBackupSyncService.ts` — update imports.
- `electron/services/agentsBackupSyncService.test.ts` — update mock target.
- `electron/services/notesSyncService.ts` — update imports.
- `electron/services/recommendationFetcher.ts` — update imports.
- `electron/services/recommendationFetcher.test.ts` — update mock target.
- `electron/services/recommendationEngine.ts` — update imports.
- `electron/services/recommendationEngine.test.ts` — update mock target.
- `electron/services/repoStats.ts` — update imports.
- `electron/services/repoSecurity.ts` — update imports.
- `electron/services/githubHelpers.test.ts` — update mock target.
- `electron/services/pluginImportFromGithubService.ts` — update imports.
- `electron/services/pluginImportFromGithubService.test.ts` — update mock target.
- `electron/services/updateService.ts` — update imports.
- `electron/services/downloadService.ts` — update imports.
- `electron/anatomy/staleness.ts` — update imports.
- `electron/anatomy/staleness.test.ts` — update mock target.
- `electron/componentScanner.ts` — update imports.
- `electron/db-helpers.ts` — update imports (if any).
- `electron/skill-gen/github-files.ts` — update imports.
- `electron/skill-gen/github-files.test.ts` — update mock target.
- `electron/smart-search.ts` — update imports.
- `electron/smart-search.test.ts` — update mock target.
- `electron/services/githubHelpers.test.ts` — update mock target.
- `electron/ipc/recommendHandlers.test.ts` — update mock target.
- `electron/services/skillSyncService.test.ts` — update mock target.
- `electron/db.ts` — add `host_id` column to `repos`, `profile_cache`, `repo_security_cache`, `repo_stats_cache`, `repo_momentum_cache`, `repo_releases_cache`.

### Deleted files
- `electron/github.ts` (moved to `electron/providers/github/rest.ts`).
- `electron/githubGraphql.ts` (moved to `electron/providers/github/graphql.ts`).
- `electron/github.test.ts` (moved to `electron/providers/github/rest.test.ts`).

---

## Notes for the executor

- The user's repo policy is **work directly on `main`** — do **not** create a feature branch or a worktree.
- Use `npm test` (not `npx vitest`) — direct vitest leaves `better-sqlite3` built for the Node ABI and breaks Electron launch on the next dev run.
- Renderer files (under `src/`) must NOT be modified in this plan. If a renderer test fails after the changes, that is a regression — fix the cause in the electron-side code, do not patch the renderer.
- Commit after every task. Conventional-commit style; e.g. `feat(providers): add HostInstance + RepoProvider types`.
- WIP at the start of this plan: `electron/main.ts`, several `src/components/*` files, `src/styles/globals.css`. The WIP touches `electron/main.ts`. Before starting Task 1, the executor should: (a) inspect the WIP with `git status` and `git diff electron/main.ts`; (b) commit the WIP if it is a coherent unit (it is the discover scroll-snap work — recent commits suggest yes), or stash it. **Do not start Task 1 against a dirty `electron/main.ts`.**

---

## Task 1: Add provider types

**Files:**
- Create: `electron/providers/types.ts`

- [ ] **Step 1: Create the types module**

Write `electron/providers/types.ts`:

```ts
// electron/providers/types.ts
//
// Shared types for the provider layer. Phase 1 only uses HostType, HostInstance,
// the HOST_ID_GITHUB constant, and a placeholder ProviderCapabilities. The full
// RepoProvider interface and normalized Repo shape are added in Phase 2 when the
// renderer migrates off the GitHubRepo shape.

export type HostType = 'github' | 'gitlab' | 'gitea'

export interface HostInstance {
  /** Deterministic ID: `${typePrefix}:${baseUrlHost}`, e.g. `gh:api.github.com`. */
  id: string
  type: HostType
  /** API base URL, e.g. `https://api.github.com`. */
  baseUrl: string
  /** User-editable display name, e.g. `GitHub`, `GitLab.com`, `Codeberg`. */
  label: string
  /** ISO 8601 timestamp the user added this instance (or first-launch seed). */
  addedAt: string
  /** Optional UI hint for self-hosted instances pointing at a separate web UI. */
  webUrl?: string
}

export interface ProviderCapabilities {
  vulnerabilityAlerts: boolean
  codeScanningAlerts: boolean
  events: boolean
  trendingDiscovery: boolean
  graphqlBundle: boolean
  isVerifiedOrg: boolean
}

export const HOST_ID_GITHUB = 'gh:api.github.com'

/** Computes a deterministic host ID from a host type and base URL. */
export function computeHostId(type: HostType, baseUrl: string): string {
  const prefix = type === 'github' ? 'gh' : type === 'gitlab' ? 'gl' : 'gt'
  // Strip protocol, trailing slash, lowercase host.
  const host = baseUrl
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  return `${prefix}:${host}`
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit -p tsconfig.electron.json`

Expected: no errors. (If `tsconfig.electron.json` doesn't exist, run `npx tsc --noEmit` instead — the project uses a single `tsconfig.json` for electron sources by default.)

- [ ] **Step 3: Commit**

```bash
git add electron/providers/types.ts
git commit -m "feat(providers): add HostInstance + ProviderCapabilities types"
```

---

## Task 2: TDD host-config storage

**Files:**
- Create: `electron/providers/hostConfig.ts`
- Create: `electron/providers/hostConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/hostConfig.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/providers/hostConfig.test.ts`

Expected: FAIL — `hostConfig.ts` does not exist; imports cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Write `electron/providers/hostConfig.ts`:

```ts
// electron/providers/hostConfig.ts
//
// Persistent list of host instances. Backed by an injected key-value store so
// the same module is unit-testable (Map backend) and production-runnable
// (electron-store backend, wired up in main.ts).
//
// Storage key: 'hosts.list' — JSON array of HostInstance.

import {
  HOST_ID_GITHUB,
  computeHostId,
  type HostInstance,
  type HostType,
} from './types'

const KEY = 'hosts.list'

export interface HostConfigBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  has(key: string): boolean
}

let backend: HostConfigBackend | null = null

export function setHostConfigBackend(b: HostConfigBackend): void {
  backend = b
}

function requireBackend(): HostConfigBackend {
  if (!backend) throw new Error('hostConfig backend not initialized')
  return backend
}

function readAll(): HostInstance[] {
  const raw = requireBackend().get(KEY)
  return Array.isArray(raw) ? (raw as HostInstance[]) : []
}

function writeAll(list: HostInstance[]): void {
  requireBackend().set(KEY, list)
}

export function listHosts(): HostInstance[] {
  return readAll()
}

export function getHost(id: string): HostInstance | null {
  return readAll().find(h => h.id === id) ?? null
}

export function addHost(spec: {
  type: HostType
  baseUrl: string
  label: string
  webUrl?: string
}): HostInstance {
  const id = computeHostId(spec.type, spec.baseUrl)
  const list = readAll()
  if (list.some(h => h.id === id)) {
    throw new Error(`Host ${id} already exists`)
  }
  const inst: HostInstance = {
    id,
    type: spec.type,
    baseUrl: spec.baseUrl,
    label: spec.label,
    addedAt: new Date().toISOString(),
    webUrl: spec.webUrl,
  }
  writeAll([...list, inst])
  return inst
}

export function removeHost(id: string): void {
  writeAll(readAll().filter(h => h.id !== id))
}

export function seedDefaultHosts(): void {
  const list = readAll()
  if (list.some(h => h.id === HOST_ID_GITHUB)) return
  const seeded: HostInstance = {
    id: HOST_ID_GITHUB,
    type: 'github',
    baseUrl: 'https://api.github.com',
    label: 'GitHub',
    addedAt: new Date().toISOString(),
  }
  writeAll([...list, seeded])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- electron/providers/hostConfig.test.ts`

Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/types.ts electron/providers/hostConfig.ts electron/providers/hostConfig.test.ts
git commit -m "feat(providers): add hostConfig with seedDefaultHosts + tests"
```

---

## Task 3: TDD per-host token store with legacy migration

**Files:**
- Create: `electron/providers/tokenStore.ts`
- Create: `electron/providers/tokenStore.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/tokenStore.test.ts`:

```ts
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
    // Legacy key is still cleaned up so a future migration is a no-op
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/providers/tokenStore.test.ts`

Expected: FAIL — `tokenStore.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Write `electron/providers/tokenStore.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- electron/providers/tokenStore.test.ts`

Expected: PASS — all 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/tokenStore.ts electron/providers/tokenStore.test.ts
git commit -m "feat(providers): add per-host tokenStore with legacy migration"
```

---

## Task 4: Move `electron/github.ts` and its tests into `providers/github/`

This task is a code move only — content is preserved verbatim, only the file location changes.

**Files:**
- Move: `electron/github.ts` → `electron/providers/github/rest.ts`
- Move: `electron/github.test.ts` → `electron/providers/github/rest.test.ts`

- [ ] **Step 1: Move the files with `git mv`**

```bash
git mv electron/github.ts electron/providers/github/rest.ts
git mv electron/github.test.ts electron/providers/github/rest.test.ts
```

(If the `providers/github/` directory doesn't exist yet from a previous task, `git mv` will create it automatically.)

- [ ] **Step 2: Update the test's import path**

Edit `electron/providers/github/rest.test.ts`: change the import from `./github` to `./rest`.

Old line:
```ts
import { getUser, getStarred, startDeviceFlow, pollDeviceToken, getRepo, searchRepos, getReadme, getReleases, getReceivedEvents } from './github'
```

New line:
```ts
import { getUser, getStarred, startDeviceFlow, pollDeviceToken, getRepo, searchRepos, getReadme, getReleases, getReceivedEvents } from './rest'
```

- [ ] **Step 3: Update internal imports inside `rest.ts`**

`rest.ts` (formerly `github.ts`) imports `etagFetch` from `./githubFetch`. That file stays at `electron/githubFetch.ts`. Update the dynamic import in `rest.ts`:

Old (appears twice — inside `getRepo` and `getReleases`):
```ts
const { etagFetch } = await import('./githubFetch')
```

New (relative path now climbs two levels from `electron/providers/github/`):
```ts
const { etagFetch } = await import('../../githubFetch')
```

- [ ] **Step 4: Run the moved tests in isolation**

Run: `npm test -- electron/providers/github/rest.test.ts`

Expected: PASS — same coverage as before the move.

- [ ] **Step 5: Commit the move**

```bash
git add electron/providers/github/rest.ts electron/providers/github/rest.test.ts
git commit -m "refactor(providers): move electron/github.ts to providers/github/rest.ts"
```

(Note: at this point `electron/github.ts` no longer exists. Other importers across the codebase are broken — they are fixed in Task 8.)

---

## Task 5: Move `electron/githubGraphql.ts` into `providers/github/`

**Files:**
- Move: `electron/githubGraphql.ts` → `electron/providers/github/graphql.ts`

- [ ] **Step 1: Move the file**

```bash
git mv electron/githubGraphql.ts electron/providers/github/graphql.ts
```

- [ ] **Step 2: Update its internal imports**

`graphql.ts` (formerly `githubGraphql.ts`) imports `etagFetch` from `./githubFetch`. The path now needs to climb two levels.

Old:
```ts
import { etagFetch } from './githubFetch'
```

New:
```ts
import { etagFetch } from '../../githubFetch'
```

- [ ] **Step 3: Commit the move**

```bash
git add electron/providers/github/graphql.ts
git commit -m "refactor(providers): move electron/githubGraphql.ts to providers/github/graphql.ts"
```

(Importers across the codebase are still broken — fixed in Task 8.)

---

## Task 6: Add `GitHubProvider` class

**Files:**
- Create: `electron/providers/github/index.ts`

- [ ] **Step 1: Write the GitHubProvider barrel**

Write `electron/providers/github/index.ts`:

```ts
// electron/providers/github/index.ts
//
// GitHubProvider wraps the lifted REST + GraphQL helpers into a class so the
// ProviderRegistry can address them through a single object handle. Phase 1
// keeps the method signatures identical to the underlying free functions so
// IPC handlers and other call sites translate one-for-one.
//
// The free functions are also re-exported from here so any callers that still
// import them by name (after Task 8's path sweep) work without further churn.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import * as graphql from './graphql'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'

const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: true,
  codeScanningAlerts: true,
  events: true,
  trendingDiscovery: true,
  graphqlBundle: true,
  isVerifiedOrg: true,
}

export class GitHubProvider {
  readonly hostId = HOST_ID_GITHUB
  readonly hostType = 'github' as const
  readonly baseUrl = 'https://api.github.com'

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  startDeviceFlow = rest.startDeviceFlow
  pollDeviceToken = rest.pollDeviceToken
  getUser = rest.getUser

  // ── Repo metadata ──────────────────────────────────────────────
  getRepo(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getRepo(token, owner, name, db)
  }
  searchRepos = rest.searchRepos
  getDefaultBranch = rest.getDefaultBranch
  getReadme = rest.getReadme
  getReleases(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getReleases(token, owner, name, db)
  }
  getCompare = rest.getCompare
  compareRefs = rest.compareRefs

  // ── Content ────────────────────────────────────────────────────
  getRepoTree = rest.getRepoTree
  getFileContent = rest.getFileContent
  getFileContentWithSha = rest.getFileContentWithSha
  getBranch = rest.getBranch
  getTreeBySha = rest.getTreeBySha
  getRawFileBytes = rest.getRawFileBytes
  getBlobBySha = rest.getBlobBySha

  // ── Social ─────────────────────────────────────────────────────
  getStarred = rest.getStarred
  starRepo = rest.starRepo
  unstarRepo = rest.unstarRepo
  isRepoStarred(
    token: string | null,
    owner: string,
    name: string,
    db?: Database.Database,
  ) {
    return rest.isRepoStarred(token, owner, name, db)
  }
  getReceivedEvents = rest.getReceivedEvents

  // ── Profile ────────────────────────────────────────────────────
  getProfileUser = rest.getProfileUser
  getUserRepos = rest.getUserRepos
  getMyRepos = rest.getMyRepos
  getUserStarred = rest.getUserStarred
  getUserFollowing = rest.getUserFollowing
  getUserFollowers = rest.getUserFollowers
  checkIsFollowing = rest.checkIsFollowing
  followUser = rest.followUser
  unfollowUser = rest.unfollowUser
  getOrgVerified = rest.getOrgVerified

  // ── Write ──────────────────────────────────────────────────────
  createRepo = rest.createRepo
  putFileContents = rest.putFileContents

  // ── Topics ─────────────────────────────────────────────────────
  fetchGitHubTopics = rest.fetchGitHubTopics

  // ── GraphQL bundle ─────────────────────────────────────────────
  fetchRepoBundle = graphql.fetchRepoBundle
  fetchLastCommitsForPaths = graphql.fetchLastCommitsForPaths
}

// Singleton instance used by the registry.
export const githubProvider = new GitHubProvider()

// Re-export the underlying free functions so any caller using
// `import { getRepo } from '.../providers/github'` continues to compile.
export * from './rest'
export * from './graphql'

// Re-export the constants the GraphQL bundle exposes.
export { HOST_ID_GITHUB } from '../types'
export type { GitHubProvider as GitHubProviderType }
```

- [ ] **Step 2: Verify the barrel compiles**

Run: `npx tsc --noEmit`

Expected: no errors related to `providers/github/index.ts`. (Other compile errors are expected because consumer imports are still broken — they are fixed in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add electron/providers/github/index.ts
git commit -m "feat(providers): add GitHubProvider class + barrel"
```

---

## Task 7: Add the provider registry

**Files:**
- Create: `electron/providers/registry.ts`
- Create: `electron/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/registry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import { getProvider, getDefaultProvider } from './registry'
import { GitHubProvider } from './github'

describe('registry', () => {
  it('getProvider returns the GitHub provider for HOST_ID_GITHUB', () => {
    const p = getProvider(HOST_ID_GITHUB)
    expect(p).toBeInstanceOf(GitHubProvider)
  })

  it('getProvider memoizes the same instance', () => {
    const a = getProvider(HOST_ID_GITHUB)
    const b = getProvider(HOST_ID_GITHUB)
    expect(a).toBe(b)
  })

  it('getProvider returns null for unknown host ids', () => {
    expect(getProvider('gl:gitlab.com')).toBeNull()
  })

  it('getDefaultProvider returns the GitHub provider', () => {
    expect(getDefaultProvider()).toBeInstanceOf(GitHubProvider)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/providers/registry.test.ts`

Expected: FAIL — `registry.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Write `electron/providers/registry.ts`:

```ts
// electron/providers/registry.ts
//
// Maps a hostId to its concrete provider instance. Phase 1 only knows about
// the GitHub provider. Phases 4–5 register GitLab and Gitea providers; the
// shape of registerProvider() is stable so they can plug in without churn.

import { HOST_ID_GITHUB } from './types'
import { GitHubProvider, githubProvider } from './github'

type AnyProvider = GitHubProvider  // Phase 2 widens this to RepoProvider

const providers = new Map<string, AnyProvider>([[HOST_ID_GITHUB, githubProvider]])

export function getProvider(hostId: string): AnyProvider | null {
  return providers.get(hostId) ?? null
}

export function getDefaultProvider(): AnyProvider {
  const p = providers.get(HOST_ID_GITHUB)
  if (!p) throw new Error('default provider missing from registry — this is a bug')
  return p
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- electron/providers/registry.test.ts`

Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/registry.ts electron/providers/registry.test.ts
git commit -m "feat(providers): add ProviderRegistry with GitHub default"
```

---

## Task 8: Update non-main consumer imports

A single sweep that points every importer of `./github` or `./githubGraphql` at the new barrel `./providers/github`. The barrel re-exports the original function-level API, so call sites do not change shape — only the import path does.

**Files (modify — each one is a path-only edit):**
- `electron/ipc/createHandlers.ts`
- `electron/ipc/recommendHandlers.ts`
- `electron/ipc/recommendHandlers.test.ts`
- `electron/ipc/updateHandlers.ts`
- `electron/services/skillSyncService.ts`
- `electron/services/skillSyncService.test.ts`
- `electron/services/agentsBackupSyncService.ts`
- `electron/services/agentsBackupSyncService.test.ts`
- `electron/services/notesSyncService.ts`
- `electron/services/recommendationFetcher.ts`
- `electron/services/recommendationFetcher.test.ts`
- `electron/services/recommendationEngine.ts`
- `electron/services/recommendationEngine.test.ts`
- `electron/services/repoStats.ts`
- `electron/services/repoSecurity.ts`
- `electron/services/githubHelpers.test.ts`
- `electron/services/pluginImportFromGithubService.ts`
- `electron/services/pluginImportFromGithubService.test.ts`
- `electron/services/updateService.ts`
- `electron/services/downloadService.ts`
- `electron/anatomy/staleness.ts`
- `electron/anatomy/staleness.test.ts`
- `electron/componentScanner.ts`
- `electron/db-helpers.ts`
- `electron/skill-gen/github-files.ts`
- `electron/skill-gen/github-files.test.ts`
- `electron/smart-search.ts`
- `electron/smart-search.test.ts`

- [ ] **Step 1: List every importer to confirm the file set**

Run:

```bash
git grep -nE "from\s+['\"]\.\.?(/\.\.)*/(github|githubGraphql)['\"]" -- electron/
```

Expected: prints one line per import statement targeting `./github` or `./githubGraphql` (in any relative form). Verify the list matches the files above. If extras appear, edit them too.

- [ ] **Step 2: Update each importer**

For each file, change the import target:

- `'./github'` → `'./providers/github'`
- `'../github'` → `'../providers/github'`
- `'./githubGraphql'` → `'./providers/github/graphql'`
- `'../githubGraphql'` → `'../providers/github/graphql'`

Examples (representative — apply the same rule everywhere):

`electron/ipc/createHandlers.ts` — change:
```ts
import { githubHeaders } from '../github'
```
to:
```ts
import { githubHeaders } from '../providers/github'
```

`electron/services/repoStats.ts` — change:
```ts
import { ... } from '../github'
```
to:
```ts
import { ... } from '../providers/github'
```

Test files that mock the module — for example `electron/services/recommendationFetcher.test.ts` — typically contain something like `vi.mock('../github', ...)`. Update the mock target to `'../providers/github'` so the mock still applies.

- [ ] **Step 3: Verify the grep returns no more matches**

Run:

```bash
git grep -nE "from\s+['\"]\.\.?(/\.\.)*/(github|githubGraphql)['\"]" -- electron/
```

Expected: zero matches. (The only remaining old-style import lives in `electron/main.ts`, which is updated in Task 9.)

- [ ] **Step 4: Type-check the changes**

Run: `npx tsc --noEmit`

Expected: no errors from any of the touched files. (Errors in `electron/main.ts` referencing `./github` are still expected at this point — Task 9 fixes those.)

- [ ] **Step 5: Run the test suites for the touched files**

Run:

```bash
npm test -- electron/services electron/ipc electron/anatomy electron/skill-gen electron/smart-search.test.ts
```

Expected: PASS for every test.

- [ ] **Step 6: Commit**

```bash
git add electron/
git commit -m "refactor(providers): point non-main importers at providers/github"
```

---

## Task 9: Update `main.ts` — initialization + IPC handlers

This task does three things in one commit:
1. Adds startup wiring (host-config backend, token-store backend, legacy-token migration).
2. Replaces the giant `from './github'` import with `from './providers/github'`.
3. Updates each `github:*` IPC handler to read tokens via `getToken(HOST_ID_GITHUB)` and acquire the provider via `getProvider(HOST_ID_GITHUB)`.

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add the new imports near the top of `main.ts`**

Find the existing block (around line 9–10):

```ts
import { getToken, setToken, clearToken, setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner, migrateApiStore } from './store'
import { startDeviceFlow, pollDeviceToken, getUser, getStarred, getRepo, searchRepos, getReadme, getFileContent, getReleases, starRepo, unstarRepo, isRepoStarred, fetchGitHubTopics, getProfileUser, getUserRepos, getMyRepos, getUserStarred, getUserFollowing, getUserFollowers, checkIsFollowing, followUser, unfollowUser, getOrgVerified, getBranch, getTreeBySha, getBlobBySha, getRawFileBytes, getRepoTree, getReceivedEvents, getCompare, compareRefs, type CompareSummary, type LastCommitInfo } from './github'
```

Replace it with:

```ts
import { setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner, migrateApiStore } from './store'
import { type CompareSummary, type LastCommitInfo } from './providers/github'
import {
  HOST_ID_GITHUB,
  type HostConfigBackend,
} from './providers/types'
import {
  setHostConfigBackend,
  seedDefaultHosts,
} from './providers/hostConfig'
import {
  setTokenStoreBackend,
  getToken,
  setToken,
  clearToken,
  migrateLegacyGitHubToken,
  type TokenStoreBackend,
} from './providers/tokenStore'
import { getProvider } from './providers/registry'
```

(Note: `getToken`/`setToken`/`clearToken` are now imported from the per-host token store, not from `./store`. The legacy `./store` versions still exist — they are dead after Task 11 but stay through Phase 1 to keep the diff focused.)

Also find the line:
```ts
import { fetchRepoBundle, fetchLastCommitsForPaths, type RepoBundle } from './githubGraphql'
```

Replace with:
```ts
import { fetchRepoBundle, fetchLastCommitsForPaths, type RepoBundle } from './providers/github/graphql'
```

- [ ] **Step 2: Wire the provider backends at app startup**

Find the `app.whenReady().then(...)` block (search for `app.whenReady`). Near the top of that callback — **before** any `ipcMain.handle('github:...')` is invoked at runtime — add:

```ts
// ── Provider layer bootstrap ─────────────────────────────────────
const providerStore = new Store<Record<string, unknown>>({ name: 'providers' })
const providerBackend = {
  get: (k: string) => providerStore.get(k),
  set: (k: string, v: unknown) => providerStore.set(k, v as never),
  delete: (k: string) => providerStore.delete(k as never),
  has: (k: string) => providerStore.has(k as never),
} satisfies HostConfigBackend & TokenStoreBackend
setHostConfigBackend(providerBackend)
setTokenStoreBackend(providerBackend)
seedDefaultHosts()
migrateLegacyGitHubToken()
```

(`Store` is already imported at the top of `main.ts` from `electron-store`. The `'providers'` name keeps host config + tokens in a separate JSON file from the existing GitHub store, so the migration is a clean copy not an in-place mutation.)

**Important:** before the `migrateLegacyGitHubToken()` call, copy the legacy GitHub token across stores. The legacy token lives in the default `electron-store` (`config.json`) under `github.token`; the new per-host store lives in `providers.json`. Add this two-line bridge immediately above `migrateLegacyGitHubToken()`:

```ts
// One-shot bridge: pull the legacy github.token from the default electron-store
// into the providers store so migrateLegacyGitHubToken() finds it. Idempotent.
const legacyStore = new Store<{ 'github.token'?: string }>()
const legacyTok = legacyStore.get('github.token')
if (typeof legacyTok === 'string' && legacyTok.length > 0 && !providerStore.has('tokens.gh:api.github.com' as never)) {
  providerStore.set('tokens.gh:api.github.com' as never, legacyTok as never)
  legacyStore.delete('github.token')
}
```

- [ ] **Step 3: Replace `getToken()` and friends in every `github:*` IPC handler**

For each IPC handler under `ipcMain.handle('github:*', ...)`:

- Every `getToken()` call becomes `getToken(HOST_ID_GITHUB)`.
- Every `setToken(t)` call becomes `setToken(HOST_ID_GITHUB, t)`.
- Every `clearToken()` call becomes `clearToken(HOST_ID_GITHUB)`.
- Every bare function call to one of the lifted REST/GraphQL functions (e.g. `getRepo(token, owner, name)`) is replaced with `getProvider(HOST_ID_GITHUB)!.getRepo(token, owner, name)`.
- `fetchRepoBundle(owner, name, token, db)` becomes `getProvider(HOST_ID_GITHUB)!.fetchRepoBundle(owner, name, token, db)` (same args — see the GitHubProvider class).

The non-null assertion (`!`) is safe because the registry always has GitHub in Phase 1; the more defensive form `const p = getProvider(HOST_ID_GITHUB); if (!p) throw new Error('GitHub provider missing')` is fine if preferred — both are acceptable; pick one and apply consistently.

There are ~30 handlers. Examples of the transformation:

**Before:**
```ts
ipcMain.handle('github:getUser', async () => {
  const token = getToken()
  if (!token) throw new Error('Not connected')
  const user = await getUser(token)
  setGitHubUser(user.login, user.avatar_url)
  ...
})
```

**After:**
```ts
ipcMain.handle('github:getUser', async () => {
  const token = getToken(HOST_ID_GITHUB)
  if (!token) throw new Error('Not connected')
  const user = await getProvider(HOST_ID_GITHUB)!.getUser(token)
  setGitHubUser(user.login, user.avatar_url)
  ...
})
```

**Before:**
```ts
ipcMain.handle('github:getRepo', async (_event, owner: string, name: string) => {
  const token = getToken()
  const db = getDb(app.getPath('userData'))
  return getRepo(token, owner, name, db)
})
```

**After:**
```ts
ipcMain.handle('github:getRepo', async (_event, owner: string, name: string) => {
  const token = getToken(HOST_ID_GITHUB)
  const db = getDb(app.getPath('userData'))
  return getProvider(HOST_ID_GITHUB)!.getRepo(token, owner, name, db)
})
```

**Before:**
```ts
ipcMain.handle('github:fetchRepoBundle', async (_event, owner: string, name: string) => {
  const token = getToken()
  const db = getDb(app.getPath('userData'))
  return fetchRepoBundle(owner, name, token, db)
})
```

**After:**
```ts
ipcMain.handle('github:fetchRepoBundle', async (_event, owner: string, name: string) => {
  const token = getToken(HOST_ID_GITHUB)
  const db = getDb(app.getPath('userData'))
  return getProvider(HOST_ID_GITHUB)!.fetchRepoBundle(owner, name, token, db)
})
```

Apply the same pattern to every `github:*` handler — they are at the lines listed in the file inventory:

```
393  github:startDeviceFlow
402  github:pollDeviceToken
413  github:cancelDeviceFlow
419  github:openLoginPopup
424  github:getUser
434  github:getStarred
521  github:disconnect
551  github:searchRepos
673  github:getRepo
756  github:getReadme
761  github:getFileContent
769  github:getReleases
798  github:getRepoUserEvents
803  github:getRepoStats
822  github:getRepoMomentum
848  github:fetchRepoBundle
927  github:recordFork
936  github:setArchivedAt
942  github:starRepo
962  github:unstarRepo
978  github:isStarred
1002 github:saveRepo
1036 github:getSavedRepos
1045 github:getFeedRepos
1052 github:getRelatedRepos
1085 github:getBranch
1097 github:getTree
1106 github:getRawFile
1112 github:getBlob
1122 github:getLastCommitsForPaths
1170 github:compareRefs
1191 github:getReceivedEvents
1203 github:getCompare
2448 github:getMyRepos
```

(`github:openLoginPopup` uses no GitHub API — only the line-9 import block needs updating, the handler body is unchanged. Same for `github:cancelDeviceFlow`.)

- [ ] **Step 4: Remove the now-dead `./store` exports from the import block**

After Step 3, `getToken`/`setToken`/`clearToken` are no longer imported from `./store` — they come from `./providers/tokenStore`. The legacy `./store` continues to export them (it is not deleted in this phase) — they are simply no longer imported anywhere. Verify no remaining call site in `main.ts` references the legacy versions:

Run:

```bash
git grep -n "from './store'" electron/main.ts
```

Expected: a single line showing the trimmed import list — no `getToken`, `setToken`, or `clearToken`.

- [ ] **Step 5: Type-check the file**

Run: `npx tsc --noEmit`

Expected: zero errors anywhere.

- [ ] **Step 6: Run the existing test suite**

Run: `npm test`

Expected: PASS for every test (including the moved `electron/providers/github/rest.test.ts`).

- [ ] **Step 7: Manual smoke test (only if running `npm run dev` works in this environment)**

Launch the dev app: `npm run dev`

Smoke checklist:
- App boots without errors in the main-process console.
- The GitHub user is loaded if a token was previously set (legacy migration succeeded).
- The Discover view renders rows that fetched from GitHub Search.
- Opening a saved repo loads its README, releases, and tree.

If `npm run dev` is not available in this environment, skip this step but flag it in the task summary for the user.

- [ ] **Step 8: Commit**

```bash
git add electron/main.ts
git commit -m "refactor(providers): main.ts wires provider registry + per-host tokens"
```

---

## Task 10: DB migration — add `host_id` column

Add `host_id` to every table whose primary key or natural key is repo-scoped (owner+name) or profile-scoped (username). Defaulting to `gh:api.github.com` backfills existing rows in one ALTER without a manual update statement. Caches keyed by URL (`http_etag_cache`) and tables that join via `repo_id` (which already resolves to a host through the parent `repos` row) are intentionally left alone in Phase 1 — they pick up the column in later phases when their consumers gain multi-host awareness.

**Files:**
- Modify: `electron/db.ts`

- [ ] **Step 1: Add migration statements at the end of `initSchema`**

In `electron/db.ts`, find the last `try { db.exec(`ALTER TABLE …`) } catch {}` block before the `// Post-migration indexes` block. Insert immediately after the last existing ALTER:

```ts
  // Phase 28 — multi-host: tag repo-scoped rows with their host of origin.
  // Existing rows backfill to 'gh:api.github.com' via the DEFAULT clause.
  // See docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md
  try { db.exec(`ALTER TABLE repos                ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
  try { db.exec(`ALTER TABLE profile_cache        ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
  try { db.exec(`ALTER TABLE repo_security_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
  try { db.exec(`ALTER TABLE repo_stats_cache     ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
  try { db.exec(`ALTER TABLE repo_momentum_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
  try { db.exec(`ALTER TABLE repo_releases_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`) } catch {}
```

- [ ] **Step 2: Add a regression test for the migration**

Create `electron/db.hostId.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

describe('host_id migration', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    initSchema(db)
  })

  const tables = [
    'repos',
    'profile_cache',
    'repo_security_cache',
    'repo_stats_cache',
    'repo_momentum_cache',
    'repo_releases_cache',
  ]

  for (const table of tables) {
    it(`${table} has a host_id column defaulting to gh:api.github.com`, () => {
      const cols = db
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>
      const hostId = cols.find(c => c.name === 'host_id')
      expect(hostId, `${table} should have host_id`).toBeDefined()
      expect(hostId!.notnull).toBe(1)
      expect(hostId!.dflt_value).toBe(`'gh:api.github.com'`)
    })
  }

  it('existing rows backfill to gh:api.github.com', () => {
    // Insert a row via the legacy column set (omit host_id) and confirm the DEFAULT applies.
    db.prepare(`INSERT INTO repos (id, owner, name) VALUES (?, ?, ?)`).run('1', 'alice', 'demo')
    const row = db.prepare(`SELECT host_id FROM repos WHERE id = '1'`).get() as { host_id: string }
    expect(row.host_id).toBe('gh:api.github.com')
  })

  it('migration is idempotent (running initSchema twice does not throw)', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- electron/db.hostId.test.ts`

Expected: PASS — 7 cases green (6 per-table column checks + 1 backfill + 1 idempotency).

- [ ] **Step 4: Commit**

```bash
git add electron/db.ts electron/db.hostId.test.ts
git commit -m "feat(db): add host_id column to repo-scoped tables (default 'gh:api.github.com')"
```

---

## Task 11: Delete the legacy single-host token helpers from `electron/store.ts`

`getToken`/`setToken`/`clearToken` in `electron/store.ts` are no longer called anywhere after Task 9. The legacy `github.token` key has been migrated to `tokens.gh:api.github.com`. Remove the dead helpers and the schema entry that backs them.

**Files:**
- Modify: `electron/store.ts`

- [ ] **Step 1: Confirm the helpers are unused**

Run:

```bash
git grep -nE "\b(getToken|setToken|clearToken)\b" -- electron/
```

Expected: every match either lives inside `electron/providers/tokenStore.ts` and `electron/providers/tokenStore.test.ts` (the new helpers and their tests), or is a comment. If `electron/main.ts` or any IPC handler still references `getToken`/`setToken`/`clearToken` imported from `./store`, return to Task 9 and finish that handler before continuing.

- [ ] **Step 2: Edit `electron/store.ts`**

Remove these elements:

```ts
interface GitHubStoreSchema {
  'github.token'?: string
  ...
}

const githubStore = new Store<GitHubStoreSchema>()

export function getToken(): string | undefined { ... }
export function setToken(token: string): void { ... }
export function clearToken(): void { ... }
```

Keep `getGitHubUser`, `setGitHubUser`, `clearGitHubUser` and their backing schema entries — those still hold the cached username/avatar and are unrelated to token storage. The simplest edit is to slim the schema to:

```ts
interface GitHubStoreSchema {
  'github.username'?: string
  'github.avatarUrl'?: string
}
```

…and delete only the three token functions.

- [ ] **Step 3: Verify the project type-checks**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/store.ts
git commit -m "refactor(store): drop legacy single-host getToken/setToken/clearToken helpers"
```

---

## Task 12: Final verification

- [ ] **Step 1: Confirm the deleted files are gone**

Run:

```bash
git ls-files electron/github.ts electron/githubGraphql.ts electron/github.test.ts
```

Expected: zero output (none of the three paths are tracked any more).

- [ ] **Step 2: Confirm no stale imports remain**

Run:

```bash
git grep -nE "from\s+['\"]\.\.?(/\.\.)*/(github|githubGraphql)['\"]" -- electron/ src/
```

Expected: zero matches.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS for every test. (Watch in particular for: the moved `providers/github/rest.test.ts` passing, `providers/hostConfig.test.ts`, `providers/tokenStore.test.ts`, `providers/registry.test.ts`, `db.hostId.test.ts`.)

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 5: Build the production bundle**

Run: `npm run build`

Expected: build succeeds. (This is a higher-confidence check than `tsc --noEmit` alone because electron-vite also runs through esbuild and may surface different issues.)

- [ ] **Step 6: Final commit (if any cleanup happened above)**

If Steps 1–5 surfaced no changes, skip this step. Otherwise commit any cleanup with:

```bash
git add electron/
git commit -m "chore(providers): post-migration cleanup"
```

- [ ] **Step 7: Hand off to the user**

Surface to the user:
- Phase 1 of the multi-host plan is complete.
- The provider layer exists under `electron/providers/` and the GitHub integration runs through it end-to-end.
- DB now has a `host_id` column on six tables, all existing rows backfilled to `gh:api.github.com`.
- Renderer behavior is unchanged.
- Next: Phase 2 brainstorm/spec would introduce the normalized `Repo` shape and migrate ~30 renderer files off `GitHubRepo`.

Recommend running the dev app once (`npm run dev`) before declaring complete:
- Sign-in flow works (device flow still reads/writes the right token slot).
- Discover rows populate.
- A saved repo's detail page loads READMEs, releases, file tree.
- Star / unstar works.

If any smoke step fails, fix the cause inline before claiming done.
