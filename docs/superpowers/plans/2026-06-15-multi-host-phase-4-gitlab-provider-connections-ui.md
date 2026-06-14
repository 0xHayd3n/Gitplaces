# Multi-Host Phase 4: GitLab Provider + Connections UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GitLabProvider` paralleling the existing `GitHubProvider`, register it for `gl:gitlab.com` (seeded on first launch), wire a GitLab probe into `hosts:probe`, and build a new "Connections" settings pane that lists configured hosts and lets the user attach a Personal Access Token per host.

**Architecture:** GitLab's REST surface is mirrored into `electron/providers/gitlab/{rest,normalize,index}.ts`, structurally identical to `electron/providers/github/`. Provider methods return provider-native shapes (GitLab API responses); `normalize.ts` translates those into the canonical `Repo` / `Release` / `User` shapes already used after Phase 2. The registry is widened so `getProvider('gl:gitlab.com')` returns a memoized `GitLabProvider` (lazy-constructed from the `HostInstance.baseUrl` lookup so self-hosted instances added later automatically work). Both providers gain a `getCurrentUser(token): Promise<User>` method that returns canonical `User`, replacing the current `provider.getUser → githubUserToUser` two-step inside `hostHandlers.ts`. The `hosts:probe` handler grows a GitLab branch that fetches `${baseUrl}/api/v4/version` and reports `{ ok: true }` only if the response is a JSON object with a `version` string. A new `ConnectionsPanel.tsx` lives alongside the existing `ConnectorsPanel.tsx` and exercises `window.api.hosts.list/getConnectedUser/setToken/clearToken`; the existing GitHub device-flow UI in `ConnectorsPanel` stays untouched.

**Tech Stack:** TypeScript, Electron, React, vitest, electron-store, better-sqlite3.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 4 section under "Migration phasing".

**Out of scope for this plan:**
- Gitea provider (Phase 5).
- Mixed-row Discover wiring (Phase 6).
- Self-hosted "Add a host" form, TLS-error surfacing, per-host health checks (Phase 7).
- Making GitLab repos actually browsable in `RepoDetail` or the Library views — Phase 4 only adds the provider plumbing + the connection management UI. Navigating to `/repo/gl:gitlab.com/owner/name` is not expected to render a usable page; the renderer-side multi-host capability gating lands in Phase 6.

---

## File structure

### New files

- `electron/providers/gitlab/rest.ts` — REST helpers paralleling `electron/providers/github/rest.ts`. PAT auth via `PRIVATE-TOKEN` header, base URL constructor parameter so the same code path covers `gitlab.com` and self-hosted instances.
- `electron/providers/gitlab/rest.test.ts` — vitest with `fetch` mocks, mirrors the pattern in `electron/providers/github/rest.test.ts`.
- `electron/providers/gitlab/normalize.ts` — `gitlabProjectToRepo`, `gitlabReleaseToRelease`, `gitlabUserToUser`, `gitlabStarredToStarredEntry`.
- `electron/providers/gitlab/normalize.test.ts` — fixture-based golden tests.
- `electron/providers/gitlab/index.ts` — `GitLabProvider` class + barrel exports. Takes `(hostId, baseUrl)` in its constructor so the registry can instantiate one per `HostInstance`.
- `electron/ipc/hostHandlers.probe.test.ts` — covers the GitLab probe branch (GitHub probe is exercised indirectly today).
- `src/views/settings/ConnectionsPanel.tsx` — new settings pane.

### Modified files

- `electron/providers/github/index.ts` — add a `getCurrentUser(token): Promise<User>` method that wraps `rest.getUser` through `githubUserToUser`.
- `electron/providers/registry.ts` — widen `AnyProvider` to `GitHubProvider | GitLabProvider`; add lazy GitLab instantiation keyed by `hostId`, sourced from `hostConfig.getHost`.
- `electron/providers/registry.test.ts` — add coverage for `getProvider('gl:gitlab.com')` after `seedDefaultHosts` runs.
- `electron/providers/hostConfig.ts` — extend `seedDefaultHosts` to seed `gl:gitlab.com` alongside the existing GitHub seed.
- `electron/providers/hostConfig.test.ts` — assert both seeds, in stable order.
- `electron/ipc/hostHandlers.ts`:
  - Replace `await provider.getUser(token)` + `githubUserToUser(rawUser)` two-step with `await provider.getCurrentUser(token)` in three places (`hosts:setToken`, `hosts:pollDeviceToken`, `hosts:getConnectedUser`).
  - The GitHub-only identity mirroring (`setGitHubUser`, `github_username` settings row) now reads the canonical `user.login` + `user.avatarUrl`.
  - Extend `hosts:probe` with a GitLab branch.
- `src/views/Settings.tsx` — add a `'connections'` category to the `CategoryId` union and the `CATEGORIES` array; render `<ConnectionsPanel />` when active.

### Files NOT touched in this plan

- `electron/providers/github/rest.ts`, `normalize.ts`, `graphql.ts` — no changes needed; `getCurrentUser` lives in the class wrapper, not the lifted functions.
- `electron/ipc/repoHandlers.ts` — already casts the resolved provider as `GitHubProvider`; the cast is safe for Phase 4 because no UI path navigates to a non-GitHub repo yet. (Phase 6 will revisit this when multi-host repo browsing lands.)
- `src/views/settings/ConnectorsPanel.tsx` — the existing GitHub device-flow + Skills Backup connector pane stays. The new ConnectionsPanel is additive.

---

## Notes for the executor

- Work directly on `main`. Do NOT create a feature branch or a worktree (per project-level CLAUDE.md).
- For non-sqlite tests use `npx vitest run <path>` — direct vitest does not rebuild `better-sqlite3` for the Node ABI, which preserves Electron-launch sanity. Tests in this plan only mock `fetch` and electron-store — they do not touch sqlite.
- Run `npm test` only at the very end (Task 10). If the rebuild fails with a file lock, the user's dev app is running — pause and confirm before force-killing.
- Conventional-commit style; one commit per task. Use `feat(providers/gitlab):`, `feat(providers):`, `feat(ipc):`, `feat(settings):`, `refactor(ipc):` as the type/scope prefixes.
- The user prefers batch execution — run every task consecutively without per-task pauses. The single code-review dispatch happens after Task 10.
- Today's date in the seed timestamp test fixtures: `2026-06-15`. When comparing seeded `addedAt` values, use a tolerance (`expect(Date.parse(...)).toBeGreaterThan(0)`) rather than equality.

---

## Task 1: Add `getCurrentUser(token)` to `GitHubProvider`

`hosts:*` handlers today fetch a raw GitHub user via `provider.getUser(token)` then run it through `githubUserToUser`. That works only because GitHub is the only registered provider. To accept a GitLab provider (whose raw user shape is different), the providers themselves must return canonical `User` shape. We add a new method `getCurrentUser` on `GitHubProvider` that wraps the existing call; we leave the original `getUser` method in place (it has callers in the legacy free-function form re-exported from `./rest`).

**Files:**
- Modify: `electron/providers/github/index.ts`
- Modify: `electron/ipc/hostHandlers.ts`

- [ ] **Step 1: Add `getCurrentUser` to `GitHubProvider`**

Edit `electron/providers/github/index.ts`.

Find the existing `// ── Auth / identity ─────...` block:

```ts
  // ── Auth / identity ────────────────────────────────────────────
  startDeviceFlow = rest.startDeviceFlow
  pollDeviceToken = rest.pollDeviceToken
  getUser = rest.getUser
```

Replace with:

```ts
  // ── Auth / identity ────────────────────────────────────────────
  startDeviceFlow = rest.startDeviceFlow
  pollDeviceToken = rest.pollDeviceToken
  getUser = rest.getUser

  /** Canonical-shape current user fetch. Wraps the legacy `getUser` so the
   *  IPC layer no longer has to know about provider-native shapes. */
  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getUser(token)
    return githubUserToUser(raw)
  }
```

Add the supporting imports at the top of the file. Find:

```ts
import type Database from 'better-sqlite3'
import * as rest from './rest'
import * as graphql from './graphql'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
```

Replace with:

```ts
import type Database from 'better-sqlite3'
import * as rest from './rest'
import * as graphql from './graphql'
import { githubUserToUser } from './normalize'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
import type { User } from '../../../src/types/repo'
```

- [ ] **Step 2: Refactor `hostHandlers.ts` to use `getCurrentUser`**

Edit `electron/ipc/hostHandlers.ts`.

Remove the now-unused `githubUserToUser` import. Find:

```ts
import { githubUserToUser } from '../providers/github/normalize'
```

…and delete that line.

For each of the three places that call `provider.getUser(token)` and then run it through `githubUserToUser`, replace with `provider.getCurrentUser(token)` and use canonical-shape field accesses for the GitHub-only mirroring sidecar.

**a)** Find the `hosts:setToken` handler body:

```ts
  ipcMain.handle('hosts:setToken', async (_event, hostId: string, token: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const rawUser = await provider.getUser(token)
    setToken(hostId, token)
    // GitHub remains the canonical identity for legacy consumers (createHandlers,
    // updateService user-filter, skillSync:setup, recommendation owner-filter).
    // Until Phase 4+ teaches those paths about other hosts, mirror the user
    // identity into the GitHub-specific slots only for HOST_ID_GITHUB.
    if (hostId === HOST_ID_GITHUB) {
      setGitHubUser(rawUser.login, rawUser.avatar_url)
      const db = getDb(app.getPath('userData'))
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', rawUser.login)
    }
    return { user: githubUserToUser(rawUser) }
  })
```

Replace with:

```ts
  ipcMain.handle('hosts:setToken', async (_event, hostId: string, token: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const user = await provider.getCurrentUser(token)
    setToken(hostId, token)
    // GitHub remains the canonical identity for legacy consumers (createHandlers,
    // updateService user-filter, skillSync:setup, recommendation owner-filter).
    // Other hosts skip this mirroring until their consumers learn multi-host.
    if (hostId === HOST_ID_GITHUB) {
      setGitHubUser(user.login, user.avatarUrl)
      const db = getDb(app.getPath('userData'))
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
    }
    return { user }
  })
```

**b)** Find the `hosts:getConnectedUser` handler body:

```ts
  ipcMain.handle('hosts:getConnectedUser', async (_event, hostId: string) => {
    const provider = getProvider(hostId)
    if (!provider) return null
    const token = getToken(hostId)
    if (!token) return null
    try {
      const rawUser = await provider.getUser(token)
      return githubUserToUser(rawUser)
    } catch {
      return null
    }
  })
```

Replace with:

```ts
  ipcMain.handle('hosts:getConnectedUser', async (_event, hostId: string) => {
    const provider = getProvider(hostId)
    if (!provider) return null
    const token = getToken(hostId)
    if (!token) return null
    try {
      return await provider.getCurrentUser(token)
    } catch {
      return null
    }
  })
```

**c)** Find the `hosts:pollDeviceToken` handler body:

```ts
  ipcMain.handle('hosts:pollDeviceToken', async (_event, hostId: string, deviceCode: string, interval: number) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const controller = getDeviceFlowAbort() ?? new AbortController()
    try {
      const token = await provider.pollDeviceToken(deviceCode, interval, controller.signal)
      setToken(hostId, token)
      const rawUser = await provider.getUser(token)
      // GitHub-specific: mirror identity into legacy slots (see hosts:setToken
      // for the full rationale) and warm the topic cache for Discover.
      if (hostId === HOST_ID_GITHUB) {
        setGitHubUser(rawUser.login, rawUser.avatar_url)
        const db = getDb(app.getPath('userData'))
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', rawUser.login)
        initTopicCache(token).catch(() => {}) // Non-blocking
      }
      return { user: githubUserToUser(rawUser) }
    } finally {
      closeLoginPopup()
    }
  })
```

Replace with:

```ts
  ipcMain.handle('hosts:pollDeviceToken', async (_event, hostId: string, deviceCode: string, interval: number) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const controller = getDeviceFlowAbort() ?? new AbortController()
    try {
      const token = await provider.pollDeviceToken(deviceCode, interval, controller.signal)
      setToken(hostId, token)
      const user = await provider.getCurrentUser(token)
      // GitHub-specific: mirror identity into legacy slots (see hosts:setToken
      // for the full rationale) and warm the topic cache for Discover.
      if (hostId === HOST_ID_GITHUB) {
        setGitHubUser(user.login, user.avatarUrl)
        const db = getDb(app.getPath('userData'))
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
        initTopicCache(token).catch(() => {}) // Non-blocking
      }
      return { user }
    } finally {
      closeLoginPopup()
    }
  })
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors. (If TypeScript complains that `User` is imported from `src/types/repo` but `tsconfig` only allows `src/`-internal imports, confirm `tsconfig.json` includes both `src/**/*` and `electron/**/*` — it does in this repo.)

- [ ] **Step 4: Commit**

```bash
git add electron/providers/github/index.ts electron/ipc/hostHandlers.ts
git commit -m "refactor(providers): add getCurrentUser; hostHandlers consumes canonical User"
```

---

## Task 2: TDD GitLab REST helpers

Mirror `electron/providers/github/rest.ts`'s shape. Authentication is via `PRIVATE-TOKEN` header. All endpoints live under `${baseUrl}/api/v4/`. The module exports a `gitlabHeaders(token)` helper plus a series of free functions; the file also re-exports types named with a `GitLab` prefix (e.g. `GitLabProject`, `GitLabRelease`, `GitLabUser`, `GitLabStarredProject`).

**Files:**
- Create: `electron/providers/gitlab/rest.ts`
- Create: `electron/providers/gitlab/rest.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/gitlab/rest.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  gitlabHeaders,
  getCurrentUser,
  getProject,
  searchProjects,
  getReadme,
  getReleases,
  getBranch,
  getTreeBySha,
  getBlobBySha,
  getRawFileBytes,
  getFileContent,
  starProject,
  unstarProject,
  getServerVersion,
} from './rest'

const BASE = 'https://gitlab.com'

function makeResponse(body: unknown, headers: Record<string, string> = {}, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 401),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

describe('gitlabHeaders', () => {
  it('uses PRIVATE-TOKEN when a token is supplied', () => {
    expect(gitlabHeaders('tok')).toEqual(expect.objectContaining({ 'PRIVATE-TOKEN': 'tok' }))
  })
  it('omits the token header when null', () => {
    expect(gitlabHeaders(null)).not.toHaveProperty('PRIVATE-TOKEN')
  })
})

describe('getCurrentUser', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /api/v4/user and returns the GitLab user payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 17, username: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', web_url: 'https://gitlab.com/alice',
    }))
    const user = await getCurrentUser(BASE, 'tok')
    expect(user.username).toBe('alice')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/user',
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'tok' }) }),
    )
  })
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'unauthorized' }, {}, false, 401))
    await expect(getCurrentUser(BASE, 'tok')).rejects.toThrow(/GitLab API error: 401/)
  })
})

describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { version, revision } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '16.10.0-pre', revision: 'b93c103' }))
    const v = await getServerVersion(BASE)
    expect(v.version).toBe('16.10.0-pre')
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/version', expect.any(Object))
  })
  it('returns null when the response is not JSON or has no version field', async () => {
    mockFetch.mockResolvedValue(makeResponse({ unrelated: true }))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on non-ok status', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getServerVersion(BASE)).toBeNull()
  })
})

describe('getProject', () => {
  beforeEach(() => mockFetch.mockReset())
  it('encodes the owner/name slug and requests license + statistics', async () => {
    mockFetch.mockResolvedValue(makeResponse({ id: 42, path_with_namespace: 'gitlab-org/gitlab', path: 'gitlab', name: 'GitLab', default_branch: 'master', archived: false, namespace: { path: 'gitlab-org', avatar_url: '' }, star_count: 1, forks_count: 1, open_issues_count: 0, topics: [], description: null, web_url: '', created_at: '', last_activity_at: '', updated_at: '' }))
    await getProject(BASE, 'tok', 'gitlab-org', 'gitlab')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab?license=true&statistics=true',
      expect.any(Object),
    )
  })
})

describe('searchProjects', () => {
  beforeEach(() => mockFetch.mockReset())
  it('builds the search URL with sort+order+page params', async () => {
    mockFetch.mockResolvedValue(makeResponse([]))
    await searchProjects(BASE, 'tok', 'rust', 20, 'stars', 'desc', 2)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects')
    expect(call).toContain('search=rust')
    expect(call).toContain('order_by=star_count')
    expect(call).toContain('sort=desc')
    expect(call).toContain('page=2')
    expect(call).toContain('per_page=20')
  })
  it('maps GitHub-style sort=updated to GitLab order_by=last_activity_at', async () => {
    mockFetch.mockResolvedValue(makeResponse([]))
    await searchProjects(BASE, 'tok', 'rust', 20, 'updated', 'desc', 1)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('order_by=last_activity_at')
  })
  it('returns [] when GitLab errors out (parity with GitHub 422 behavior)', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: 'bad query' }, {}, false, 400))
    expect(await searchProjects(BASE, 'tok', '!!!', 20, 'stars', 'desc', 1)).toEqual([])
  })
})

describe('getReadme', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded README when README.md exists', async () => {
    const content = Buffer.from('# hello\n').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))            // getProject for default branch
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))       // files/README.md
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('# hello\n')
  })
  it('falls back across README, README.md, readme.md when earlier names 404', async () => {
    const content = Buffer.from('plain readme').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))                    // README.md
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))       // README
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('plain readme')
  })
  it('returns null when no README variant exists', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBeNull()
  })
})

describe('getReleases', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /releases?per_page=100 and returns the array', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { tag_name: 'v1.0.0', name: 'One', released_at: '2026-01-01T00:00:00Z', description: 'first', upcoming_release: false, assets: { links: [{ name: 'src.tar', url: 'https://x/y' }] } },
    ]))
    const rels = await getReleases(BASE, 'tok', 'alice', 'demo')
    expect(rels).toHaveLength(1)
    expect(rels[0].tag_name).toBe('v1.0.0')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/releases?per_page=100')
  })
})

describe('getBranch', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { commitSha, rootTreeSha: commit.id } since GitLab tree access keys off commit sha', async () => {
    mockFetch.mockResolvedValue(makeResponse({ name: 'main', commit: { id: 'sha-xyz', parent_ids: [] } }))
    const r = await getBranch(BASE, 'tok', 'alice', 'demo', 'main')
    expect(r.commitSha).toBe('sha-xyz')
    // GitLab tree API takes a ref string (branch name or sha) — we reuse the commit sha as the cache key.
    expect(r.rootTreeSha).toBe('sha-xyz')
  })
})

describe('getRawFileBytes', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /repository/files/{path}/raw?ref=...', async () => {
    mockFetch.mockResolvedValue(makeResponse('hello', { 'content-type': 'application/octet-stream' }))
    const buf = await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'main', 'src/x.ts')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.toString()).toBe('hello')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/repository/files/src%2Fx.ts/raw?ref=main')
  })
})

describe('getBlobBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { content, rawBase64, size } from blobs/{sha}', async () => {
    const rawBase64 = Buffer.from('blob').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ size: 4, encoding: 'base64', content: rawBase64 }))
    const out = await getBlobBySha(BASE, 'tok', 'alice', 'demo', 'sha-xyz')
    expect(out.size).toBe(4)
    expect(out.rawBase64).toBe(rawBase64)
    expect(out.content).toBe('blob')
  })
})

describe('starProject / unstarProject', () => {
  beforeEach(() => mockFetch.mockReset())
  it('star posts to /projects/:id/star', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 201))
    await starProject(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gitlab.com/api/v4/projects/alice%2Fdemo/star')
    expect((init as { method: string }).method).toBe('POST')
  })
  it('unstar posts to /projects/:id/unstar', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 201))
    await unstarProject(BASE, 'tok', 'alice', 'demo')
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gitlab.com/api/v4/projects/alice%2Fdemo/unstar')
  })
})

describe('getTreeBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /repository/tree?ref={treeSha}&recursive=true&per_page=100', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { id: 'sha-a', name: 'README.md', type: 'blob', path: 'README.md', mode: '100644' },
    ]))
    const entries = await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('README.md')
    expect(entries[0].type).toBe('blob')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/repository/tree?ref=sha-root&recursive=true&per_page=100')
  })
})

describe('getFileContent', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded file content', async () => {
    const content = Buffer.from('const x = 1\n').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))
    const out = await getFileContent(BASE, 'tok', 'alice', 'demo', 'src/x.ts')
    expect(out).toBe('const x = 1\n')
  })
  it('returns null on 404', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    expect(await getFileContent(BASE, 'tok', 'alice', 'demo', 'nope.ts')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitlab/rest.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/gitlab/rest.ts`:

```ts
// electron/providers/gitlab/rest.ts
//
// REST helpers for a GitLab instance. The `baseUrl` argument is the API root
// (e.g. "https://gitlab.com" or "https://gitlab.acme.com") — every helper
// appends "/api/v4/..." internally. Auth is a Personal Access Token sent in
// the `PRIVATE-TOKEN` header. All helpers accept `token: string | null` so
// they can also drive unauthenticated requests (public projects).

// ── Types (provider-native; normalize.ts translates to canonical shapes) ────

export interface GitLabUser {
  id: number
  username: string
  name: string
  avatar_url: string
  web_url: string
}

export interface GitLabNamespace {
  id: number
  name: string
  path: string
  kind: 'user' | 'group'
  full_path: string
  avatar_url: string | null
}

export interface GitLabProjectLicense {
  key: string                // SPDX-ish, lowercase ("mit", "apache-2.0")
  name: string
  nickname: string | null
  html_url: string | null
  source_url: string | null
}

export interface GitLabProjectStatistics {
  commit_count: number
  storage_size: number
  repository_size: number   // bytes
  wiki_size: number
  lfs_objects_size: number
  job_artifacts_size: number
}

export interface GitLabProject {
  id: number
  description: string | null
  name: string
  path: string
  path_with_namespace: string
  default_branch: string | null
  topics: string[]
  web_url: string
  avatar_url: string | null
  star_count: number
  forks_count: number
  open_issues_count: number
  created_at: string
  last_activity_at: string
  updated_at: string
  archived: boolean
  visibility: 'private' | 'internal' | 'public'
  namespace: GitLabNamespace
  license?: GitLabProjectLicense | null
  statistics?: GitLabProjectStatistics
  readme_url?: string | null
}

export interface GitLabReleaseAssetLink {
  id: number
  name: string
  url: string
  direct_asset_url?: string
}

export interface GitLabReleaseAssets {
  count: number
  sources?: { format: string; url: string }[]
  links?: GitLabReleaseAssetLink[]
}

export interface GitLabRelease {
  tag_name: string
  name: string | null
  description: string | null
  released_at: string
  upcoming_release: boolean
  assets?: GitLabReleaseAssets
}

export interface GitLabBranch {
  name: string
  commit: { id: string; parent_ids: string[] }
  default?: boolean
}

export interface GitLabTreeEntry {
  id: string                 // git sha
  name: string
  type: 'blob' | 'tree'
  path: string
  mode: string
}

export interface GitLabBlob {
  size: number
  encoding: 'base64'
  content: string
  sha: string
}

export interface GitLabStarredProject extends GitLabProject {}

// ── Headers ─────────────────────────────────────────────────────────────────

export function gitlabHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['PRIVATE-TOKEN'] = token
  return headers
}

function api(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v4${path}`
}

function projectId(owner: string, name: string): string {
  return encodeURIComponent(`${owner}/${name}`)
}

async function readError(res: Response, op: string): Promise<Error> {
  let body: unknown = null
  try { body = await res.json() } catch { /* ignore */ }
  const detail = body && typeof body === 'object' && 'message' in body
    ? ` — ${String((body as { message: unknown }).message)}`
    : ''
  return new Error(`GitLab API error: ${res.status}${detail} (${op})`)
}

// ── Server version (probe target) ────────────────────────────────────────────

export async function getServerVersion(baseUrl: string): Promise<{ version: string; revision?: string } | null> {
  try {
    const res = await fetch(api(baseUrl, '/version'), { headers: gitlabHeaders(null) })
    if (!res.ok) return null
    const body = await res.json() as { version?: unknown; revision?: unknown }
    if (typeof body?.version !== 'string') return null
    return { version: body.version, revision: typeof body.revision === 'string' ? body.revision : undefined }
  } catch {
    return null
  }
}

// ── Auth / identity ─────────────────────────────────────────────────────────

export async function getCurrentUser(baseUrl: string, token: string): Promise<GitLabUser> {
  const res = await fetch(api(baseUrl, '/user'), { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getCurrentUser')
  return res.json() as Promise<GitLabUser>
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function getProject(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<GitLabProject> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}?license=true&statistics=true`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getProject')
  return res.json() as Promise<GitLabProject>
}

const SORT_MAP: Record<string, string> = {
  stars: 'star_count',
  updated: 'last_activity_at',
  forks: 'forks_count',
  created: 'created_at',
}

export async function searchProjects(
  baseUrl: string,
  token: string | null,
  query: string,
  perPage = 100,
  sort = 'stars',
  order: 'asc' | 'desc' | string = 'desc',
  page = 1,
): Promise<GitLabProject[]> {
  const orderBy = SORT_MAP[sort] ?? 'star_count'
  const params = new URLSearchParams({
    search: query,
    order_by: orderBy,
    sort: order === 'asc' ? 'asc' : 'desc',
    per_page: String(perPage),
    page: String(page),
  })
  const res = await fetch(api(baseUrl, `/projects?${params.toString()}`), { headers: gitlabHeaders(token) })
  if (!res.ok) return []
  return res.json() as Promise<GitLabProject[]>
}

export async function getDefaultBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<string> {
  const p = await getProject(baseUrl, token, owner, name)
  return p.default_branch && p.default_branch.length > 0 ? p.default_branch : 'main'
}

// ── README / file content ───────────────────────────────────────────────────

const README_CANDIDATES = ['README.md', 'README', 'readme.md', 'README.rst']

export async function getReadme(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  ref?: string,
): Promise<string | null> {
  const resolvedRef = ref ?? await getDefaultBranch(baseUrl, token, owner, name)
  for (const candidate of README_CANDIDATES) {
    const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(candidate)}?ref=${encodeURIComponent(resolvedRef)}`)
    const res = await fetch(url, { headers: gitlabHeaders(token) })
    if (res.ok) {
      const body = await res.json() as { content?: string; encoding?: string }
      if (typeof body.content === 'string' && body.encoding === 'base64') {
        return Buffer.from(body.content, 'base64').toString('utf8')
      }
    }
  }
  return null
}

export async function getFileContent(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const resolvedRef = ref ?? await getDefaultBranch(baseUrl, token, owner, name)
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(resolvedRef)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res, 'getFileContent')
  const body = await res.json() as { content?: string; encoding?: string }
  if (typeof body.content !== 'string' || body.encoding !== 'base64') return null
  return Buffer.from(body.content, 'base64').toString('utf8')
}

// ── Releases ────────────────────────────────────────────────────────────────

export async function getReleases(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<GitLabRelease[]> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/releases?per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getReleases')
  return res.json() as Promise<GitLabRelease[]>
}

// ── Tree / branch / blob ────────────────────────────────────────────────────

export async function getBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  branch: string,
): Promise<{ commitSha: string; rootTreeSha: string }> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/branches/${encodeURIComponent(branch)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBranch')
  const body = await res.json() as GitLabBranch
  // GitLab tree API takes a ref string (branch or commit sha), not a tree sha.
  // For the contract `{commitSha, rootTreeSha}` we use the commit id for both
  // — the renderer treats `rootTreeSha` as an opaque cache key, and GitLab's
  // tree endpoint accepts that sha as `ref`.
  return { commitSha: body.commit.id, rootTreeSha: body.commit.id }
}

export async function getTreeBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  treeSha: string,
): Promise<GitLabTreeEntry[]> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/tree?ref=${encodeURIComponent(treeSha)}&recursive=true&per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getTreeBySha')
  const entries = await res.json() as Array<{ id: string; name: string; type: 'blob' | 'tree'; path: string; mode: string }>
  return entries
}

export async function getBlobBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  blobSha: string,
): Promise<{ content: string; rawBase64: string; size: number }> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/blobs/${encodeURIComponent(blobSha)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBlobBySha')
  const body = await res.json() as GitLabBlob
  return {
    content: Buffer.from(body.content, 'base64').toString('utf8'),
    rawBase64: body.content,
    size: body.size,
  }
}

export async function getRawFileBytes(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<Buffer> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getRawFileBytes')
  return Buffer.from(await res.arrayBuffer())
}

// ── Social ──────────────────────────────────────────────────────────────────

export async function starProject(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/star`)
  const res = await fetch(url, { method: 'POST', headers: gitlabHeaders(token) })
  // 201 = newly starred; 304 = already starred — both fine.
  if (!res.ok && res.status !== 304) throw await readError(res, 'starProject')
}

export async function unstarProject(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/unstar`)
  const res = await fetch(url, { method: 'POST', headers: gitlabHeaders(token) })
  // 201 = newly unstarred; 304 = was not starred — both fine.
  if (!res.ok && res.status !== 304) throw await readError(res, 'unstarProject')
}

export async function getStarredProjects(
  baseUrl: string,
  token: string,
): Promise<GitLabStarredProject[]> {
  // Need the current user's id first; GitLab's "current user's starred" endpoint
  // is /users/:user_id/starred_projects (no /user/starred shortcut in v4).
  const me = await getCurrentUser(baseUrl, token)
  const url = api(baseUrl, `/users/${me.id}/starred_projects?per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getStarredProjects')
  return res.json() as Promise<GitLabStarredProject[]>
}

export async function isProjectStarred(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<boolean> {
  if (!token) return false
  // GitLab v4 has no direct is-starred query — fall back to scanning the user's
  // starred list and matching the slug. This is good enough for Phase 4 (UI
  // wiring lands in Phase 6); a cached lookup is a Phase 7 polish item.
  try {
    const starred = await getStarredProjects(baseUrl, token)
    const slug = `${owner}/${name}`.toLowerCase()
    return starred.some(p => p.path_with_namespace.toLowerCase() === slug)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitlab/rest.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitlab/rest.ts electron/providers/gitlab/rest.test.ts
git commit -m "feat(providers/gitlab): REST helpers + version probe + PAT auth"
```

---

## Task 3: TDD GitLab normalizers

Mirror `electron/providers/github/normalize.ts`. Convert GitLab provider-native shapes (snake_case, bytes for size, lowercase license keys, `path_with_namespace` for fullName) into the canonical `Repo` / `Release` / `User` shapes the renderer consumes.

**Files:**
- Create: `electron/providers/gitlab/normalize.ts`
- Create: `electron/providers/gitlab/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/gitlab/normalize.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  gitlabProjectToRepo,
  gitlabReleaseToRelease,
  gitlabUserToUser,
  gitlabStarredToStarredEntry,
} from './normalize'
import type { GitLabProject, GitLabRelease, GitLabUser } from './rest'

const HOST_ID = 'gl:gitlab.com'

const FIXTURE: GitLabProject = {
  id: 278964,
  description: 'GitLab is open source',
  name: 'GitLab',
  path: 'gitlab',
  path_with_namespace: 'gitlab-org/gitlab',
  default_branch: 'master',
  topics: ['gitlab', 'ruby'],
  web_url: 'https://gitlab.com/gitlab-org/gitlab',
  avatar_url: 'https://gitlab.com/uploads/-/system/project/avatar/278964/gitlab.png',
  star_count: 4500,
  forks_count: 5500,
  open_issues_count: 12100,
  created_at: '2014-08-29T00:00:00.000Z',
  last_activity_at: '2026-06-14T22:00:00.000Z',
  updated_at: '2026-06-14T22:00:00.000Z',
  archived: false,
  visibility: 'public',
  namespace: { id: 9970, name: 'GitLab.org', path: 'gitlab-org', kind: 'group', full_path: 'gitlab-org', avatar_url: 'https://gitlab.com/uploads/-/system/group/avatar/9970/group.png' },
  license: { key: 'mit', name: 'MIT License', nickname: null, html_url: null, source_url: null },
  statistics: { commit_count: 0, storage_size: 0, repository_size: 5_242_880, wiki_size: 0, lfs_objects_size: 0, job_artifacts_size: 0 },
  readme_url: 'https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md',
}

describe('gitlabProjectToRepo', () => {
  it('maps the standard fields', () => {
    const r = gitlabProjectToRepo(HOST_ID, FIXTURE)
    expect(r.hostId).toBe(HOST_ID)
    expect(r.hostType).toBe('gitlab')
    expect(r.hostNativeId).toBe(278964)
    expect(r.fullName).toBe('gitlab-org/gitlab')
    expect(r.owner).toBe('gitlab-org')
    expect(r.name).toBe('gitlab')
    expect(r.htmlUrl).toBe('https://gitlab.com/gitlab-org/gitlab')
    expect(r.description).toBe('GitLab is open source')
    expect(r.topics).toEqual(['gitlab', 'ruby'])
    expect(r.license).toBe('mit')
    expect(r.defaultBranch).toBe('master')
    expect(r.archived).toBe(false)
    expect(r.stars).toBe(4500)
    expect(r.forks).toBe(5500)
    expect(r.openIssues).toBe(12100)
    expect(r.createdAt).toBe('2014-08-29T00:00:00.000Z')
    expect(r.updatedAt).toBe('2026-06-14T22:00:00.000Z')
    expect(r.pushedAt).toBe('2026-06-14T22:00:00.000Z')   // last_activity_at
    expect(r.ownerAvatarUrl).toBe(FIXTURE.namespace.avatar_url)
  })

  it('converts repository_size from bytes → KB', () => {
    const r = gitlabProjectToRepo(HOST_ID, FIXTURE)
    // 5_242_880 bytes / 1024 = 5120 KB
    expect(r.size).toBe(5120)
  })

  it('defaults size to 0 when statistics is missing', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, statistics: undefined })
    expect(r.size).toBe(0)
  })

  it('falls back defaultBranch to "main" when null/empty', () => {
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, default_branch: null }).defaultBranch).toBe('main')
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('falls back ownerAvatarUrl to "" when namespace.avatar_url is null', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, namespace: { ...FIXTURE.namespace, avatar_url: null } })
    expect(r.ownerAvatarUrl).toBe('')
  })

  it('language is null (GitLab project endpoint does not expose it)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).language).toBeNull()
  })

  it('homepageUrl is null (GitLab project endpoint has no equivalent field)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).homepageUrl).toBeNull()
  })

  it('watchers mirrors stars (GitLab has no separate watcher count)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).watchers).toBe(FIXTURE.star_count)
  })

  it('topics empty when missing', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, topics: undefined as unknown as string[] })
    expect(r.topics).toEqual([])
  })

  it('license maps to null when license object is missing', () => {
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, license: null }).license).toBeNull()
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, license: undefined }).license).toBeNull()
  })
})

describe('gitlabReleaseToRelease', () => {
  it('maps tag, name, body, publishedAt, prerelease', () => {
    const rel: GitLabRelease = {
      tag_name: 'v1.0.0',
      name: 'First release',
      released_at: '2026-01-01T00:00:00Z',
      description: 'release notes',
      upcoming_release: false,
      assets: { count: 1, links: [{ id: 1, name: 'src.tar.gz', url: 'https://x/y.tar.gz' }] },
    }
    const out = gitlabReleaseToRelease(rel)
    expect(out.tagName).toBe('v1.0.0')
    expect(out.name).toBe('First release')
    expect(out.publishedAt).toBe('2026-01-01T00:00:00Z')
    expect(out.body).toBe('release notes')
    expect(out.prerelease).toBe(false)
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0].name).toBe('src.tar.gz')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tar.gz')
    expect(out.assets[0].downloadCount).toBe(0)  // GitLab does not expose this
    expect(out.assets[0].size).toBe(0)           // ditto
  })

  it('treats upcoming_release === true as prerelease', () => {
    const rel: GitLabRelease = {
      tag_name: 'v2.0.0-rc1', name: null, released_at: '2026-06-01T00:00:00Z',
      description: null, upcoming_release: true,
    }
    expect(gitlabReleaseToRelease(rel).prerelease).toBe(true)
  })

  it('handles missing assets', () => {
    const rel: GitLabRelease = {
      tag_name: 'v3', name: null, released_at: '2026-06-01T00:00:00Z',
      description: null, upcoming_release: false,
    }
    expect(gitlabReleaseToRelease(rel).assets).toEqual([])
  })
})

describe('gitlabUserToUser', () => {
  it('maps username → login, avatar_url → avatarUrl, publicRepos defaults to 0', () => {
    const u: GitLabUser = { id: 1, username: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', web_url: 'https://gitlab.com/alice' }
    const out = gitlabUserToUser(u)
    expect(out.login).toBe('alice')
    expect(out.avatarUrl).toBe('https://x/a.png')
    // GitLab does not expose a public_repos count on /user; surface 0 until Phase 7
    // teaches the user-page renderer to call /users/:id/projects?visibility=public.
    expect(out.publicRepos).toBe(0)
  })
})

describe('gitlabStarredToStarredEntry', () => {
  it('uses last_activity_at as a stand-in for starred_at (no native field in GitLab v4)', () => {
    const out = gitlabStarredToStarredEntry(HOST_ID, FIXTURE)
    expect(out.starredAt).toBe(FIXTURE.last_activity_at)
    expect(out.repo.fullName).toBe('gitlab-org/gitlab')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitlab/normalize.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/gitlab/normalize.ts`:

```ts
// electron/providers/gitlab/normalize.ts
//
// Translates GitLab provider-native shapes to the canonical renderer shapes
// (Repo / Release / User / StarredEntry). Pure functions, no I/O. Mirrors
// electron/providers/github/normalize.ts.
//
// Known asymmetries we accept in Phase 4:
//   - `language`     → null (GitLab /projects/:id doesn't surface a top language;
//                     fetching /projects/:id/languages is a Phase 6 polish item).
//   - `homepageUrl`  → null (no equivalent field on GitLab projects).
//   - `watchers`     → mirrors `star_count` (GitLab has no separate watcher count).
//   - `publicRepos`  → 0 (GitLab /user doesn't expose a count; renderer surfaces
//                     this only on profile pages, which Phase 4 doesn't touch).
//   - `starredAt`    → `last_activity_at` (GitLab v4 has no per-star timestamp).
//   - `size`         → bytes → KB conversion via `statistics.repository_size`.

import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GitLabProject,
  GitLabRelease,
  GitLabReleaseAssetLink,
  GitLabUser,
} from './rest'

export function gitlabProjectToRepo(hostId: string, g: GitLabProject): Repo {
  const sizeBytes = g.statistics?.repository_size ?? 0
  return {
    hostId,
    hostType: 'gitlab',
    hostNativeId: g.id,
    fullName: g.path_with_namespace,
    owner: g.namespace.path,
    name: g.path,
    htmlUrl: g.web_url,
    homepageUrl: null,
    description: g.description ?? null,
    language: null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: g.license?.key ?? null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: Math.round(sizeBytes / 1024),
    stars: g.star_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.star_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.last_activity_at,
    ownerAvatarUrl: g.namespace.avatar_url ?? '',
  }
}

function releaseAssetLinkToAsset(a: GitLabReleaseAssetLink): ReleaseAsset {
  return {
    name: a.name,
    size: 0,
    browserDownloadUrl: a.direct_asset_url ?? a.url,
    downloadCount: 0,
  }
}

export function gitlabReleaseToRelease(r: GitLabRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.released_at,
    body: r.description,
    assets: (r.assets?.links ?? []).map(releaseAssetLinkToAsset),
    prerelease: Boolean(r.upcoming_release),
  }
}

export function gitlabUserToUser(u: GitLabUser): User {
  return {
    login: u.username,
    avatarUrl: u.avatar_url,
    publicRepos: 0,
  }
}

export function gitlabStarredToStarredEntry(hostId: string, p: GitLabProject): StarredEntry {
  return {
    starredAt: p.last_activity_at,
    repo: gitlabProjectToRepo(hostId, p),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitlab/normalize.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitlab/normalize.ts electron/providers/gitlab/normalize.test.ts
git commit -m "feat(providers/gitlab): normalize Project/Release/User → canonical shapes"
```

---

## Task 4: Add `GitLabProvider` class

Build the provider class wrapping the GitLab REST + normalize helpers. The class implements the same surface as `GitHubProvider` for every method exercised through the registry (in Phase 4 only `getCurrentUser`, plus the throw-only `startDeviceFlow` / `pollDeviceToken` so the union type stays callable). Phase 6 will exercise the metadata/social methods.

**Files:**
- Create: `electron/providers/gitlab/index.ts`

- [ ] **Step 1: Write the GitLabProvider barrel**

Write `electron/providers/gitlab/index.ts`:

```ts
// electron/providers/gitlab/index.ts
//
// GitLabProvider wraps the lifted REST helpers + the gitlab→canonical
// normalizers into one class so the ProviderRegistry can address GitLab
// instances through a uniform handle. Both gitlab.com and self-hosted
// GitLab instances use this single class — the constructor's baseUrl
// parameter is the only thing that differs.
//
// Phase 4 does not exercise repo-browsing methods through the renderer.
// They exist so the class surface matches GitHubProvider (the registry
// returns a union of the two) and so Phase 6 can wire them up without
// further provider-layer churn.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import {
  gitlabProjectToRepo,
  gitlabReleaseToRelease,
  gitlabUserToUser,
  gitlabStarredToStarredEntry,
} from './normalize'
import type { ProviderCapabilities } from '../types'
import type { Repo, Release, User, StarredEntry } from '../../../src/types/repo'

const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: false,
  codeScanningAlerts: false,
  events: false,
  trendingDiscovery: true,
  graphqlBundle: false,
  isVerifiedOrg: false,
}

export class GitLabProvider {
  readonly hostType = 'gitlab' as const

  constructor(
    public readonly hostId: string,
    public readonly baseUrl: string,
  ) {}

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getCurrentUser(this.baseUrl, token)
    return gitlabUserToUser(raw)
  }

  /** GitLab has no device-flow equivalent in v4. The Connections pane drives
   *  PAT entry directly via `hosts:setToken`. This method exists only so the
   *  shared `AnyProvider` union has a callable `startDeviceFlow` — if any caller
   *  ever invokes it for a GitLab host, throwing a clear error is the right
   *  outcome. */
  startDeviceFlow(): Promise<never> {
    return Promise.reject(new Error('GitLab uses Personal Access Tokens; device flow is not supported.'))
  }

  pollDeviceToken(): Promise<never> {
    return Promise.reject(new Error('GitLab uses Personal Access Tokens; device flow is not supported.'))
  }

  // ── Repo metadata (Phase 6 wires these to the renderer) ────────
  async getRepo(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Repo> {
    const raw = await rest.getProject(this.baseUrl, token, owner, name)
    return gitlabProjectToRepo(this.hostId, raw)
  }

  async searchRepos(
    token: string | null,
    query: string,
    perPage = 100,
    sort = 'stars',
    order = 'desc',
    page = 1,
  ): Promise<Repo[]> {
    const projects = await rest.searchProjects(this.baseUrl, token, query, perPage, sort, order, page)
    return projects.map(p => gitlabProjectToRepo(this.hostId, p))
  }

  getDefaultBranch(token: string | null, owner: string, name: string): Promise<string> {
    return rest.getDefaultBranch(this.baseUrl, token, owner, name)
  }

  getReadme(token: string | null, owner: string, name: string, ref?: string): Promise<string | null> {
    return rest.getReadme(this.baseUrl, token, owner, name, ref)
  }

  async getReleases(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Release[]> {
    const rels = await rest.getReleases(this.baseUrl, token, owner, name)
    return rels.map(gitlabReleaseToRelease)
  }

  getFileContent(token: string | null, owner: string, name: string, path: string, ref?: string): Promise<string | null> {
    return rest.getFileContent(this.baseUrl, token, owner, name, path, ref)
  }

  getBranch(token: string | null, owner: string, name: string, branch: string) {
    return rest.getBranch(this.baseUrl, token, owner, name, branch)
  }

  getTreeBySha(token: string | null, owner: string, name: string, treeSha: string) {
    return rest.getTreeBySha(this.baseUrl, token, owner, name, treeSha)
  }

  getBlobBySha(token: string | null, owner: string, name: string, blobSha: string) {
    return rest.getBlobBySha(this.baseUrl, token, owner, name, blobSha)
  }

  getRawFileBytes(token: string | null, owner: string, name: string, ref: string, path: string) {
    return rest.getRawFileBytes(this.baseUrl, token, owner, name, ref, path)
  }

  // ── Social ─────────────────────────────────────────────────────
  starRepo(token: string, owner: string, name: string): Promise<void> {
    return rest.starProject(this.baseUrl, token, owner, name)
  }

  unstarRepo(token: string, owner: string, name: string): Promise<void> {
    return rest.unstarProject(this.baseUrl, token, owner, name)
  }

  async getStarred(token: string): Promise<StarredEntry[]> {
    const projects = await rest.getStarredProjects(this.baseUrl, token)
    return projects.map(p => gitlabStarredToStarredEntry(this.hostId, p))
  }

  isRepoStarred(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<boolean> {
    return rest.isProjectStarred(this.baseUrl, token, owner, name)
  }
}

// Re-export the underlying types so callers can `import type` from the barrel.
export type {
  GitLabUser,
  GitLabProject,
  GitLabRelease,
  GitLabReleaseAssetLink,
  GitLabBranch,
  GitLabTreeEntry,
  GitLabBlob,
} from './rest'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add electron/providers/gitlab/index.ts
git commit -m "feat(providers/gitlab): GitLabProvider class wrapping rest + normalize"
```

---

## Task 5: Register GitLab in the provider registry

Widen `AnyProvider` to a union of `GitHubProvider | GitLabProvider`. Lazy-construct a `GitLabProvider` per `hostId` (lookup `baseUrl` via `hostConfig.getHost`). Memoize so repeated lookups return the same instance.

**Files:**
- Modify: `electron/providers/registry.ts`
- Modify: `electron/providers/registry.test.ts`

- [ ] **Step 1: Update the failing test first**

Edit `electron/providers/registry.test.ts`. Replace its body with:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: FAIL — `GitLabProvider` is not (yet) returned for `gl:gitlab.com`.

- [ ] **Step 3: Update the registry implementation**

Edit `electron/providers/registry.ts`. Replace the whole file with:

```ts
// electron/providers/registry.ts
//
// Maps a hostId to its concrete provider instance.
//
// Phase 1 added GitHub. Phase 4 widens the union to include GitLab — both
// gitlab.com (seeded) and any self-hosted instance the user adds later via
// the Connections pane (Phase 7). GitLab providers are constructed lazily
// from `HostInstance.baseUrl` so the registry doesn't need a build-time
// list of self-hosted hosts.
//
// Phase 5 will append Gitea to the union the same way.

import { HOST_ID_GITHUB } from './types'
import { GitHubProvider, githubProvider } from './github'
import { GitLabProvider } from './gitlab'
import { getHost } from './hostConfig'

export type AnyProvider = GitHubProvider | GitLabProvider

const gitlabProviders = new Map<string, GitLabProvider>()

export function getProvider(hostId: string): AnyProvider | null {
  if (hostId === HOST_ID_GITHUB) return githubProvider

  if (hostId.startsWith('gl:')) {
    const cached = gitlabProviders.get(hostId)
    if (cached) return cached
    const host = getHost(hostId)
    if (!host || host.type !== 'gitlab') return null
    const inst = new GitLabProvider(hostId, host.baseUrl)
    gitlabProviders.set(hostId, inst)
    return inst
  }

  return null
}

export function getDefaultProvider(): GitHubProvider {
  return githubProvider
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: all 6 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/registry.ts electron/providers/registry.test.ts
git commit -m "feat(providers): register GitLab + widen AnyProvider union"
```

---

## Task 6: Seed `gl:gitlab.com` on first launch

Extend `seedDefaultHosts()` so the GitLab.com instance appears in the host list immediately after Task 5 lands. Existing GitHub seed is preserved; the helper is still idempotent.

**Files:**
- Modify: `electron/providers/hostConfig.ts`
- Modify: `electron/providers/hostConfig.test.ts`

- [ ] **Step 1: Update the failing test first**

Edit `electron/providers/hostConfig.test.ts`. Find:

```ts
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
```

Replace those two cases with:

```ts
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
```

Also find the existing `addHost adds an instance with a computed id` test:

```ts
  it('addHost adds an instance with a computed id', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.map(h => h.id).sort()).toEqual(['gh:api.github.com', 'gl:gitlab.com'])
  })
```

It's now redundant with the seed test (seeds already populate gitlab.com). Replace it with a self-hosted addition:

```ts
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
```

Similarly the `removeHost` and `getHost null for unknown ids` tests assume only-GitHub-seeded state. Update:

```ts
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
```

The `returns an empty list before seeding` and `addHost is rejected for duplicate ids` tests still pass as-is — leave them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/hostConfig.test.ts`

Expected: FAIL — only the GitHub instance is seeded.

- [ ] **Step 3: Update `seedDefaultHosts`**

Edit `electron/providers/hostConfig.ts`. Find the existing `seedDefaultHosts` body:

```ts
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

Replace with:

```ts
const DEFAULT_HOSTS: ReadonlyArray<Omit<HostInstance, 'addedAt'>> = [
  { id: HOST_ID_GITHUB, type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub' },
  { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' },
]

export function seedDefaultHosts(): void {
  const list = readAll()
  const additions: HostInstance[] = []
  const now = new Date().toISOString()
  for (const def of DEFAULT_HOSTS) {
    if (list.some(h => h.id === def.id)) continue
    additions.push({ ...def, addedAt: now })
  }
  if (additions.length > 0) writeAll([...list, ...additions])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/hostConfig.test.ts`

Expected: all cases PASS (including the registry test from Task 5, which seeds via `seedDefaultHosts` in `beforeEach`).

Re-run the registry test:

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/hostConfig.ts electron/providers/hostConfig.test.ts
git commit -m "feat(providers): seed gl:gitlab.com alongside GitHub on first launch"
```

---

## Task 7: Wire GitLab into `hosts:probe`

`hosts:probe` today returns `{ ok: true }` only for `gh:api.github.com` and falls through to `"Probe not implemented for host type '<type>' yet"` for everything else. Add a GitLab branch that calls `getServerVersion(baseUrl)` (from Task 2's REST module) and returns `{ ok: true }` when the response is a JSON object with a `version` string, otherwise `{ ok: false, error: "..." }`.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Create: `electron/ipc/hostHandlers.probe.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/ipc/hostHandlers.probe.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Capture the registered handler functions so we can call them directly.
type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
  },
  app: { getPath: () => '/tmp/test' },
}))

vi.mock('../githubLoginPopup', () => ({
  openLoginPopup: vi.fn(),
  closeLoginPopup: vi.fn(),
}))
vi.mock('../store', () => ({ setGitHubUser: vi.fn(), clearGitHubUser: vi.fn() }))
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../services/topicCacheService', () => ({ initTopicCache: vi.fn() }))
vi.mock('../services/deviceFlowState', () => ({ getDeviceFlowAbort: vi.fn(), setDeviceFlowAbort: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { registerHostHandlers } from './hostHandlers'

registerHostHandlers()

describe('hosts:probe — GitLab', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true } when /api/v4/version responds with a version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '16.10.0-pre', revision: 'b93c103' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://gitlab.com' })
    expect(out).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/version', expect.any(Object))
  })

  it('hits a self-hosted base URL when given one', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '17.0.0' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    await probe({}, { type: 'gitlab', baseUrl: 'https://gitlab.acme.com/' })
    // Trailing slash gets normalized inside getServerVersion.
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.acme.com/api/v4/version', expect.any(Object))
  })

  it('returns { ok: false } when the server is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://nope.example' })
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/not a GitLab/i) })
  })

  it('returns { ok: false } when the response is not a GitLab version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ unrelated: true }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' })
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/not a GitLab/i) })
  })

  it('returns { ok: false } on HTTP error status', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' })
    expect(out.ok).toBe(false)
  })

  it('still returns ok:true for the GitHub probe of api.github.com', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'github', baseUrl: 'https://api.github.com' })
    expect(out).toEqual({ ok: true })
    // No fetch call made — GitHub branch short-circuits.
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still falls through to "not implemented" for unknown host types', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://codeberg.org' })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not implemented/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: FAIL — GitLab branch returns "not implemented" today.

- [ ] **Step 3: Update `hosts:probe`**

Edit `electron/ipc/hostHandlers.ts`. Add a top-level import alongside the existing ones:

```ts
import { getServerVersion as getGitLabServerVersion } from '../providers/gitlab/rest'
```

Find the existing `hosts:probe` handler:

```ts
  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github' && input.baseUrl === 'https://api.github.com') {
      return { ok: true }
    }
    // GitLab + Gitea probe paths land with their providers in Phases 4-5.
    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })
```

Replace with:

```ts
  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a GitLab instance (no /api/v4/version)` }
    }

    // Gitea lands in Phase 5.
    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: all 7 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/ipc/hostHandlers.probe.test.ts
git commit -m "feat(ipc): hosts:probe validates GitLab via /api/v4/version"
```

---

## Task 8: Add a `'connections'` category to Settings

Settings.tsx uses a sidebar of `CATEGORIES` keyed by `CategoryId`. Add a new `'connections'` id, label "Connections", with an icon that visually distinguishes it from the existing `ConnectorsIcon`. Wire the conditional render so the new pane shows up.

**Files:**
- Modify: `src/views/Settings.tsx`

- [ ] **Step 1: Widen the `CategoryId` type**

Find:

```ts
type CategoryId = 'ai' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

Replace with:

```ts
type CategoryId = 'ai' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'connections' | 'updates'
```

- [ ] **Step 2: Add an icon component for Connections**

Below the existing `UpdatesIcon = () => (...)` declaration (around line 65), add:

```ts
const ConnectionsIcon = () => (
  <svg {...iconProps}>
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="8.5" y="8.5" width="5" height="5" rx="1" />
    <path d="M5 7.5v1 M11 7.5h-1 M5 8.5h6" />
  </svg>
)
```

- [ ] **Step 3: Register the category and import the panel**

Find the imports near the top:

```ts
import AIPanel from './settings/AIPanel'
import ConnectorsPanel from './settings/ConnectorsPanel'
import AIIcon from './settings/shared/AIIcon'
```

Replace with:

```ts
import AIPanel from './settings/AIPanel'
import ConnectorsPanel from './settings/ConnectorsPanel'
import ConnectionsPanel from './settings/ConnectionsPanel'
import AIIcon from './settings/shared/AIIcon'
```

(`ConnectionsPanel` lands in Task 9. Until then, the import will be unresolved; do Task 8 and Task 9 back-to-back so the project type-checks at the boundary.)

Find the `CATEGORIES` array:

```ts
const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'ai',         label: 'AI',               icon: <AIIcon /> },
  { id: 'appearance', label: 'Appearance',        icon: <PaletteIcon /> },
  { id: 'language',   label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads',  label: 'Downloads',         icon: <DownloadIcon /> },
  { id: 'projects',   label: 'Projects',          icon: <ProjectsIcon /> },
  { id: 'connectors', label: 'Connectors',        icon: <ConnectorsIcon /> },
  { id: 'updates',    label: 'Updates',           icon: <UpdatesIcon /> },
]
```

Replace with:

```ts
const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'ai',          label: 'AI',                icon: <AIIcon /> },
  { id: 'appearance',  label: 'Appearance',        icon: <PaletteIcon /> },
  { id: 'language',    label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads',   label: 'Downloads',         icon: <DownloadIcon /> },
  { id: 'projects',    label: 'Projects',          icon: <ProjectsIcon /> },
  { id: 'connectors',  label: 'Connectors',        icon: <ConnectorsIcon /> },
  { id: 'connections', label: 'Connections',       icon: <ConnectionsIcon /> },
  { id: 'updates',     label: 'Updates',           icon: <UpdatesIcon /> },
]
```

Find the existing conditional render block in the JSX (search for `{activeCategory === 'connectors' && <ConnectorsPanel />}`). Add a sibling immediately after:

```tsx
        {activeCategory === 'connectors'  && <ConnectorsPanel />}
        {activeCategory === 'connections' && <ConnectionsPanel />}
```

- [ ] **Step 4: Commit at the end of Task 9**

Don't commit yet — wait until ConnectionsPanel exists in Task 9, then bundle Settings.tsx + ConnectionsPanel.tsx into a single commit (the new pane is meaningless on its own, and the Settings.tsx change is meaningless without the panel).

---

## Task 9: Build the `ConnectionsPanel.tsx`

The pane lists every host returned by `window.api.hosts.list()`, surfaces the connected user (via `window.api.hosts.getConnectedUser(hostId)`), and offers either a PAT input field (when not connected) or a Disconnect button (when connected). A "How do I create a PAT?" link per host type opens the right docs page in the user's default browser. Styling reuses the existing `connector-*` CSS classes so the new pane visually matches `ConnectorsPanel`.

**Files:**
- Create: `src/views/settings/ConnectionsPanel.tsx`

- [ ] **Step 1: Write the component**

Write `src/views/settings/ConnectionsPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { User } from '../../types/repo'

// Mirror the shape declared in electron/preload.ts → hosts.list.
// Renderer-local copy so we don't have to import from the electron tree at runtime.
interface HostInstance {
  id: string
  type: 'github' | 'gitlab' | 'gitea'
  baseUrl: string
  label: string
  addedAt: string
  webUrl?: string
}

const PAT_DOC_URLS: Record<HostInstance['type'], string> = {
  github: 'https://github.com/settings/tokens',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  gitea:  'https://docs.gitea.com/development/api-usage#authentication',
}

const HOST_ICONS: Record<HostInstance['type'], JSX.Element> = {
  github: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  ),
  gitlab: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.49A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92Z"/>
    </svg>
  ),
  gitea: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9z" />
    </svg>
  ),
}

interface HostStatus {
  user: User | null
  loading: boolean
  error: string | null
}

export default function ConnectionsPanel() {
  const [hosts, setHosts] = useState<HostInstance[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [patDraft, setPatDraft] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({})

  const refreshHost = useCallback(async (hostId: string) => {
    setStatuses(prev => ({ ...prev, [hostId]: { ...(prev[hostId] ?? { user: null, error: null }), loading: true } }))
    try {
      const user = await window.api.hosts.getConnectedUser(hostId)
      setStatuses(prev => ({ ...prev, [hostId]: { user, loading: false, error: null } }))
    } catch (e) {
      setStatuses(prev => ({ ...prev, [hostId]: { user: null, loading: false, error: (e as Error).message } }))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await window.api.hosts.list() as HostInstance[]
      if (cancelled) return
      setHosts(list)
      await Promise.all(list.map(h => refreshHost(h.id)))
    }
    load()
    return () => { cancelled = true }
  }, [refreshHost])

  const handleConnect = useCallback(async (host: HostInstance) => {
    const pat = (patDraft[host.id] ?? '').trim()
    if (!pat) return
    setConnecting(prev => ({ ...prev, [host.id]: true }))
    setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: null } }))
    try {
      const result = await window.api.hosts.setToken(host.id, pat)
      setStatuses(prev => ({ ...prev, [host.id]: { user: result.user, loading: false, error: null } }))
      setPatDraft(prev => ({ ...prev, [host.id]: '' }))
    } catch (e) {
      const message = (e as Error).message ?? 'Failed to connect.'
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: message } }))
    } finally {
      setConnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [patDraft])

  const handleDisconnect = useCallback(async (host: HostInstance) => {
    setDisconnecting(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.clearToken(host.id)
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: null } }))
    } finally {
      setDisconnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [])

  const handleOpenPatDocs = useCallback((host: HostInstance) => {
    const url = PAT_DOC_URLS[host.type]
    if (url) void window.api.openExternal(url)
  }, [])

  return (
    <>
      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Repository hosts Git Suite can browse and act on. Use a Personal Access Token for each.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">
          {hosts.length === 0 && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint" style={{ margin: 0 }}>No hosts configured yet.</p>
            </div>
          )}

          {hosts.map(host => {
            const status = statuses[host.id]
            const user = status?.user ?? null
            const isConnecting = connecting[host.id] ?? false
            const isDisconnecting = disconnecting[host.id] ?? false
            const draft = patDraft[host.id] ?? ''
            const error = status?.error ?? null

            return (
              <div key={host.id}>
                <div className="connector-row">
                  <div className={`connector-icon connector-icon--${host.type}`}>
                    {HOST_ICONS[host.type]}
                  </div>
                  <div className="connector-info">
                    <div className="connector-name">{host.label}</div>
                    <div className="connector-desc">
                      {status?.loading
                        ? 'Checking…'
                        : user
                          ? `Connected as @${user.login}`
                          : <>
                              <span>{host.baseUrl}</span>
                              {' — '}
                              <a
                                href="#"
                                onClick={e => { e.preventDefault(); handleOpenPatDocs(host) }}
                              >
                                How do I create a PAT?
                              </a>
                            </>}
                    </div>
                  </div>
                  <div className="connector-actions">
                    {user ? (
                      <>
                        <span className="connector-badge connected">Connected</span>
                        <button
                          className="settings-btn settings-btn--link connector-disconnect-btn"
                          disabled={isDisconnecting}
                          onClick={() => handleDisconnect(host)}
                        >
                          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <form
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                        onSubmit={e => { e.preventDefault(); void handleConnect(host) }}
                      >
                        <input
                          type="password"
                          className="settings-input"
                          placeholder="Personal access token"
                          value={draft}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={e => setPatDraft(prev => ({ ...prev, [host.id]: e.target.value }))}
                          disabled={isConnecting}
                          style={{ minWidth: 220 }}
                        />
                        <button
                          type="submit"
                          className="settings-btn"
                          disabled={isConnecting || draft.trim().length === 0}
                        >
                          {isConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="connector-row connector-row--log">
                    <p className="settings-hint error" style={{ margin: 0 }}>{error}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors. (If TS complains about `window.api.openExternal` not being declared, it already exists in the project — the existing `ConnectorsPanel.tsx` uses it.)

- [ ] **Step 3: Commit Settings.tsx + ConnectionsPanel.tsx together**

```bash
git add src/views/Settings.tsx src/views/settings/ConnectionsPanel.tsx
git commit -m "feat(settings): add Connections pane listing hosts + PAT entry"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run all targeted vitest specs added or modified by this plan**

Run:

```bash
npx vitest run electron/providers/gitlab/rest.test.ts electron/providers/gitlab/normalize.test.ts electron/providers/registry.test.ts electron/providers/hostConfig.test.ts electron/ipc/hostHandlers.probe.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`

Expected: PASS (modulo the Phase 2/3 pre-existing-failure baseline). If `npm test` fails to rebuild `better-sqlite3` because of a file lock, the user's dev app is running — pause and ask before force-killing.

If new failures appear in tests not touched by this plan, they likely come from the `hostHandlers.ts` changes in Task 1. Re-read the failing test's mock targets — many tests pre-Phase-3 still mock `provider.getUser` rather than `provider.getCurrentUser`; bring them into line with the refactor.

- [ ] **Step 4: Confirm the seeded GitLab instance shows up at runtime**

Manual smoke (skip if `npm run dev` is not available in this environment, but flag it in the summary):

1. Launch the dev app: `npm run dev`
2. Open Settings → Connections.
3. Two host rows should appear: `GitHub` and `GitLab.com`.
4. For GitLab.com: paste a real PAT (or any string for a negative test) and click Connect. A wrong token should surface `GitLab API error: 401` inline.
5. A valid GitHub PAT entered through Connections also works (it calls `hosts:setToken('gh:api.github.com', pat)` → `provider.getCurrentUser` → success).
6. Disconnect → the row returns to PAT entry. Reconnecting works.

- [ ] **Step 5: Hand off to the user**

Surface:
- Phase 4 complete. `GitLabProvider` exists, `gl:gitlab.com` is seeded, `hosts:probe` validates GitLab via `/api/v4/version`, and the new Connections settings pane lets the user attach/detach a PAT for any registered host.
- The existing `ConnectorsPanel` (GitHub device flow + Skills Backup) is unchanged.
- GitLab repos are NOT yet browsable — `repoHandlers.ts` still casts the resolved provider as `GitHubProvider`. Phase 6 will widen that path when mixed-row Discover lands.
- Next: Phase 5 brainstorm/spec would add `GiteaProvider` and seed `gt:codeberg.org` on first launch, mirroring this phase's structure.
