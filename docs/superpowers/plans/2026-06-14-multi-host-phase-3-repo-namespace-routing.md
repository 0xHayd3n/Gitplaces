# Multi-Host Phase 3: `repo.*` IPC Namespace + URL Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-only `window.api.github.*` IPC namespace with host-id-aware `window.api.repo.*` and `window.api.hosts.*` parallel namespaces, migrate all 31 renderer call sites to the new API, add a `/repo/:hostId/:owner/:name` URL route, and delete the old namespace in a single final commit.

**Architecture:** Each existing `github:foo(owner, name)` IPC channel gets a sibling `repo:foo(hostId, owner, name)` channel that takes the host instance ID as its first parameter. Bodies route through `getProvider(hostId)` — for Phase 3, only the GitHub provider is registered, so runtime behavior is identical to today. Auth and host-management channels move under `hosts:*` (`hosts:list`, `hosts:setToken`, `hosts:startDeviceFlow`, etc.). The React Router config gains `/repo/:hostId/:owner/:name`; the old `/repo/:owner/:name` route stays with a compat redirect that resolves `hostId` from the saved-repos DB (defaulting to `gh:api.github.com`). Renderer files migrate in 6 logical groups mirroring Phase 2's groupings.

**Tech Stack:** TypeScript, React, React Router, Electron, electron-store, better-sqlite3, vitest.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 3 section.

**Out of scope for this plan:** the "Connections" pane UI (Phase 4 / Phase 7), GitLab/Gitea provider implementations (Phases 4–5), mixed-row Discover (Phase 6), self-hosted instance management UI. Phase 3 sets up the namespace and routing scaffolding; the new host-management IPC channels exist but are exercised only programmatically — no user-facing "Add a host" form lands until Phase 7.

---

## Channel mapping (the canonical reference for every renderer-migration task)

### `window.api.github.*` → `window.api.repo.*`

Every existing `github:*` channel that operates on a specific repository gains a `hostId` first parameter. The method name on the renderer interface stays the same wherever possible; channels move from the `github:` prefix to `repo:`.

| Old channel | New channel | Renderer call before | Renderer call after |
|---|---|---|---|
| `github:getRepo` | `repo:get` | `window.api.github.getRepo(owner, name)` | `window.api.repo.get(hostId, owner, name)` |
| `github:searchRepos` | `repo:search` | `window.api.github.searchRepos(query, sort, order, page)` | `window.api.repo.search(hostId, query, sort, order, page)` |
| `github:getReadme` | `repo:getReadme` | `window.api.github.getReadme(owner, name)` | `window.api.repo.getReadme(hostId, owner, name)` |
| `github:getFileContent` | `repo:getFileContent` | `window.api.github.getFileContent(owner, name, path)` | `window.api.repo.getFileContent(hostId, owner, name, path)` |
| `github:getReleases` | `repo:getReleases` | `window.api.github.getReleases(owner, name)` | `window.api.repo.getReleases(hostId, owner, name)` |
| `github:getRepoUserEvents` | `repo:getRepoUserEvents` | `window.api.github.getRepoUserEvents(owner, name)` | `window.api.repo.getRepoUserEvents(hostId, owner, name)` |
| `github:getRepoStats` | `repo:getRepoStats` | `window.api.github.getRepoStats(owner, name)` | `window.api.repo.getRepoStats(hostId, owner, name)` |
| `github:getRepoMomentum` | `repo:getRepoMomentum` | `window.api.github.getRepoMomentum(owner, name)` | `window.api.repo.getRepoMomentum(hostId, owner, name)` |
| `github:fetchRepoBundle` | `repo:fetchBundle` | `window.api.github.fetchRepoBundle(owner, name)` | `window.api.repo.fetchBundle(hostId, owner, name)` |
| `github:recordFork` | `repo:recordFork` | `window.api.github.recordFork(owner, name)` | `window.api.repo.recordFork(hostId, owner, name)` |
| `github:setArchivedAt` | `repo:setArchivedAt` | `window.api.github.setArchivedAt(owner, name, archived)` | `window.api.repo.setArchivedAt(hostId, owner, name, archived)` |
| `github:starRepo` | `repo:star` | `window.api.github.starRepo(owner, name)` | `window.api.repo.star(hostId, owner, name)` |
| `github:unstarRepo` | `repo:unstar` | `window.api.github.unstarRepo(owner, name)` | `window.api.repo.unstar(hostId, owner, name)` |
| `github:isStarred` | `repo:isStarred` | `window.api.github.isStarred(owner, name)` | `window.api.repo.isStarred(hostId, owner, name)` |
| `github:saveRepo` | `repo:save` | `window.api.github.saveRepo(owner, name)` | `window.api.repo.save(hostId, owner, name)` |
| `github:getSavedRepos` | `repo:getSaved` | `window.api.github.getSavedRepos()` | `window.api.repo.getSaved()` *(no hostId — returns all hosts)* |
| `github:getFeedRepos` | `repo:getFeed` | `window.api.github.getFeedRepos()` | `window.api.repo.getFeed()` *(no hostId — same reason)* |
| `github:getRelatedRepos` | `repo:getRelated` | `window.api.github.getRelatedRepos(owner, name, topicsJson)` | `window.api.repo.getRelated(hostId, owner, name, topicsJson)` |
| `github:getBranch` | `repo:getBranch` | `window.api.github.getBranch(owner, name, branch)` | `window.api.repo.getBranch(hostId, owner, name, branch)` |
| `github:getTree` | `repo:getTree` | `window.api.github.getTree(owner, name, treeSha)` | `window.api.repo.getTree(hostId, owner, name, treeSha)` |
| `github:getBlob` | `repo:getBlob` | `window.api.github.getBlob(owner, name, blobSha)` | `window.api.repo.getBlob(hostId, owner, name, blobSha)` |
| `github:getRawFile` | `repo:getRawFile` | `window.api.github.getRawFile(owner, name, branch, path)` | `window.api.repo.getRawFile(hostId, owner, name, branch, path)` |
| `github:getLastCommitsForPaths` | `repo:getLastCommitsForPaths` | `window.api.github.getLastCommitsForPaths(repoId, owner, name, ref, pathShas)` | `window.api.repo.getLastCommitsForPaths(hostId, repoId, owner, name, ref, pathShas)` |
| `github:compareRefs` | `repo:compareRefs` | `window.api.github.compareRefs(repoId, owner, name, base, head)` | `window.api.repo.compareRefs(hostId, repoId, owner, name, base, head)` |
| `github:getCompare` | `repo:getCompare` | `window.api.github.getCompare(owner, name, base, head)` | `window.api.repo.getCompare(hostId, owner, name, base, head)` |
| `github:getStarred` | `repo:getMyStarred` | `window.api.github.getStarred(force)` | `window.api.repo.getMyStarred(hostId, force)` *(your own starred list — renamed for clarity)* |
| `github:getMyRepos` | `repo:getMyRepos` | `window.api.github.getMyRepos()` | `window.api.repo.getMyRepos(hostId)` |
| `github:getReceivedEvents` | `repo:getReceivedEvents` | `window.api.github.getReceivedEvents(username)` | `window.api.repo.getReceivedEvents(hostId, username)` |
| `github:getRecommended` | `repo:getRecommended` | `window.api.github.getRecommended(page, excludeIds)` | `window.api.repo.getRecommended(page, excludeIds)` *(no hostId — multi-host in Phase 6)* |

### `window.api.github.*` → `window.api.hosts.*` (auth / connection management)

| Old channel | New channel | Notes |
|---|---|---|
| `github:startDeviceFlow` | `hosts:startDeviceFlow` | Only GitHub provider implements in Phase 3; ignores `hostId` other than `gh:api.github.com`. |
| `github:pollDeviceToken` | `hosts:pollDeviceToken` | Same. |
| `github:cancelDeviceFlow` | `hosts:cancelDeviceFlow` | Same. |
| `github:openLoginPopup` | `hosts:openLoginPopup` | Same. |
| `github:getUser` | `hosts:getConnectedUser` | Returns the connected `User` for the given host, or `null` if no token / token invalid. |
| `github:disconnect` | `hosts:clearToken` | Renamed for symmetry with `hosts:setToken`. |

### New `hosts:*` channels with no `github:*` predecessor (added in Phase 3, used by Phase 4+ UI)

These are added even though no UI exercises them yet, because (a) the registry already supports them after Phase 1, and (b) it lets us delete `window.api.github.*` cleanly at end of Phase 3:

| Channel | Signature | Notes |
|---|---|---|
| `hosts:list` | `() → Promise<HostInstance[]>` | Lists all host instances (only GitHub seeded in Phase 3). |
| `hosts:get` | `(hostId) → Promise<HostInstance \| null>` | Single lookup. |
| `hosts:add` | `({ type, baseUrl, label, webUrl? }) → Promise<HostInstance>` | Creates an instance; Phase 7 wires UI. |
| `hosts:remove` | `(hostId) → Promise<void>` | Removes from the registry. |
| `hosts:probe` | `({ type, baseUrl }) → Promise<{ ok: true } \| { ok: false, error: string }>` | Validates a candidate host before saving. Phase 3 implements only for GitHub (returns `{ ok: true }` if `baseUrl === 'https://api.github.com'`, else `{ ok: false, error: 'Probe not implemented for this host type yet' }`). Phase 4/5 fill in the GitLab/Gitea probe paths. |
| `hosts:setToken` | `(hostId, token) → Promise<{ user: User }>` | Stores the token after validating via `getCurrentUser`. Returns the connected user as a side-effect read. |

---

## File structure

### New files
- `electron/ipc/repoHandlers.ts` — every `repo:*` IPC handler. Body of each handler does `const provider = getProvider(hostId) ?? throw; const token = getToken(hostId);` then delegates to a `provider.<method>(...)` call. For Phase 3 with only GitHub registered, runtime semantics are unchanged.
- `electron/ipc/hostHandlers.ts` — every `hosts:*` IPC handler.

### Modified files
- `electron/main.ts` — delete every `ipcMain.handle('github:...')` block in Task 13 (Phase 3 cleanup), AFTER all renderer migration tasks land. Keep the existing handlers untouched until then; just import-and-call `registerRepoHandlers()` and `registerHostHandlers()` at app startup alongside the existing registrations.
- `electron/preload.ts` — add `window.api.repo` and `window.api.hosts` exposures alongside the existing `window.api.github`. Task 13 deletes the `window.api.github` exposure.
- `src/env.d.ts` — add `window.api.repo` and `window.api.hosts` declarations; delete `window.api.github` in Task 13.
- `src/App.tsx` — add the `/repo/:hostId/:owner/:name` route alongside the existing `/repo/:owner/:name`. The old route renders a compat component that resolves `hostId` from the saved-repos DB and `<Navigate>`s to the new route.
- The 31 renderer files in the migration groups (cards / Discover / Library / Profile / RepoDetail / Activity / utilities). Each gets its `window.api.github.*` calls swapped for `window.api.repo.*` / `window.api.hosts.*` with `hostId` plumbed in.
- `electron/ipc/recommendHandlers.ts` — add the `repo:getRecommended` handler alongside the existing `github:getRecommended`. Task 13 deletes the old one.

### Deleted at end of plan (Task 13)
- Every `ipcMain.handle('github:...')` block in `electron/main.ts` and `electron/ipc/recommendHandlers.ts`.
- The `github:` exposure in `electron/preload.ts` (the entire `github: { ... }` object).
- The `window.api.github` declaration in `src/env.d.ts`.

---

## Notes for the executor

- Work directly on `main`. No branch. No worktree. Per CLAUDE.md.
- `npm test` rebuilds better-sqlite3 each run. For changes that don't touch sqlite, `npx vitest run <path>` is fine. Running `npm rebuild better-sqlite3` after a vitest run breaks Electron launch; rebuild via `npx @electron/rebuild -f -o better-sqlite3` at the end of Phase 3 to restore the Electron ABI.
- Conventional-commit style. One commit per task.
- For each renderer migration task (Tasks 7–12), the procedure is the same: replace `window.api.github.X(args)` with `window.api.repo.X(hostId, args)` per the channel mapping above. The `hostId` source varies per file — the per-task descriptions document where `hostId` comes from in that context.
- The `HOST_ID_GITHUB` constant is exported from `electron/providers/types.ts` and is safe to `import type`-import into `src/` for the default-to-GitHub fallback. For runtime values, define a renderer-side constant `HOST_ID_GITHUB = 'gh:api.github.com'` in `src/lib/hostIds.ts` (created in Task 1) to avoid pulling Electron runtime into the renderer bundle.

---

## Task 1: Add a renderer-side `HOST_ID_GITHUB` constant

**Files:**
- Create: `src/lib/hostIds.ts`

- [ ] **Step 1: Create the module**

Write `src/lib/hostIds.ts`:

```ts
// src/lib/hostIds.ts
//
// Renderer-side mirror of the canonical host-id constants. The main process
// owns these in electron/providers/types.ts; this file exists so the renderer
// can use them as runtime values without import-pulling the electron module.

export const HOST_ID_GITHUB = 'gh:api.github.com'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hostIds.ts
git commit -m "feat(types): add renderer-side HOST_ID_GITHUB constant"
```

---

## Task 2: Add `repo:*` IPC handlers

**Files:**
- Create: `electron/ipc/repoHandlers.ts`
- Modify: `electron/main.ts` — call `registerRepoHandlers()` after the existing handler registrations near `app.whenReady().then(...)`.
- Modify: `electron/ipc/recommendHandlers.ts` — add `repo:getRecommended` (no hostId arg) alongside the existing `github:getRecommended`.

- [ ] **Step 1: Build a helper to resolve provider+token for the channel**

Write `electron/ipc/repoHandlers.ts`:

```ts
// electron/ipc/repoHandlers.ts
//
// Host-id-aware mirror of the legacy github:* IPC channels. For Phase 3 only
// GitHub is registered, so every channel delegates to the GitHub provider when
// called with HOST_ID_GITHUB. Phases 4-5 will add GitLab/Gitea providers; this
// file does not need changes for them — the registry resolution handles it.

import { ipcMain, app } from 'electron'
import { getDb } from '../db'
import { getProvider } from '../providers/registry'
import { getToken } from '../providers/tokenStore'
import {
  githubRepoToRepo,
  githubReleaseToRelease,
  githubStarredToStarredEntry,
} from '../providers/github/normalize'
import { repoRowToSavedRepo } from '../repoNormalize'
import type { RepoRow, LibraryRow } from '../db-row-types'
import type { GitHubProvider } from '../providers/github'

function resolve(hostId: string) {
  const provider = getProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider: provider as GitHubProvider, token }
}

export function registerRepoHandlers(): void {
  // ── Read ────────────────────────────────────────────────────────
  ipcMain.handle('repo:get', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    const db = getDb(app.getPath('userData'))
    try {
      const raw = await provider.getRepo(token, owner, name, db)
      return githubRepoToRepo(raw)
    } catch {
      const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
      return row ? repoRowToSavedRepo(row) : null
    }
  })

  ipcMain.handle('repo:search', async (_event, hostId: string, query: string, sort?: string, order?: string, page?: number) => {
    const { provider, token } = resolve(hostId)
    const items = await provider.searchRepos(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1)
    return items.map(githubRepoToRepo)
  })

  ipcMain.handle('repo:getReadme', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getReadme(token, owner, name)
  })

  ipcMain.handle('repo:getFileContent', async (_event, hostId: string, owner: string, name: string, path: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getFileContent(token, owner, name, path)
  })

  ipcMain.handle('repo:getReleases', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    const db = getDb(app.getPath('userData'))
    const releases = await provider.getReleases(token, owner, name, db)
    return releases.map(githubReleaseToRelease)
  })

  ipcMain.handle('repo:getBranch', async (_event, hostId: string, owner: string, name: string, branch: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getBranch(token, owner, name, branch)
  })

  ipcMain.handle('repo:getTree', async (_event, hostId: string, owner: string, name: string, treeSha: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getTreeBySha(token, owner, name, treeSha)
  })

  ipcMain.handle('repo:getBlob', async (_event, hostId: string, owner: string, name: string, blobSha: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getBlobBySha(token, owner, name, blobSha)
  })

  ipcMain.handle('repo:getRawFile', async (_event, hostId: string, owner: string, name: string, branch: string, path: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getRawFileBytes(token, owner, name, branch, path)
  })

  ipcMain.handle('repo:getCompare', async (_event, hostId: string, owner: string, name: string, base: string, head: string) => {
    const { provider, token } = resolve(hostId)
    return provider.getCompare(token, owner, name, base, head)
  })

  ipcMain.handle('repo:compareRefs', async (_event, hostId: string, repoId: string, owner: string, name: string, base: string, head: string) => {
    const { provider, token } = resolve(hostId)
    const files = await provider.compareRefs(token, owner, name, base, head)
    return { repoId, files }
  })

  ipcMain.handle('repo:getLastCommitsForPaths', async (
    _event,
    hostId: string,
    repoId: string,
    owner: string,
    name: string,
    ref: string,
    pathShas: { path: string; sha: string }[],
  ) => {
    const { provider, token } = resolve(hostId)
    const db = getDb(app.getPath('userData'))
    return provider.fetchLastCommitsForPaths(db, token, owner, name, ref, repoId, pathShas)
  })

  ipcMain.handle('repo:fetchBundle', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    const db = getDb(app.getPath('userData'))
    return provider.fetchRepoBundle(db, token, owner, name)
  })

  ipcMain.handle('repo:getReceivedEvents', async (_event, hostId: string, username: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) return []
    return provider.getReceivedEvents(token, username)
  })

  ipcMain.handle('repo:getMyRepos', async (_event, hostId: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) throw new Error('Not connected')
    const repos = await provider.getMyRepos(token)
    return repos.map(githubRepoToRepo)
  })

  ipcMain.handle('repo:getMyStarred', async (_event, hostId: string, force?: boolean) => {
    const { provider, token } = resolve(hostId)
    if (!token) return []
    const items = await provider.getStarred(token)
    return items.map(githubStarredToStarredEntry)
  })

  // ── Mutate ──────────────────────────────────────────────────────
  ipcMain.handle('repo:star', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) throw new Error('Not connected')
    await provider.starRepo(token, owner, name)
  })

  ipcMain.handle('repo:unstar', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) throw new Error('Not connected')
    await provider.unstarRepo(token, owner, name)
  })

  ipcMain.handle('repo:isStarred', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    const db = getDb(app.getPath('userData'))
    return provider.isRepoStarred(token, owner, name, db)
  })

  // ── Local DB ────────────────────────────────────────────────────
  // repo:save, repo:getSaved, repo:getFeed, repo:getRelated, repo:recordFork,
  // repo:setArchivedAt, repo:getRepoUserEvents, repo:getRepoStats,
  // repo:getRepoMomentum: copy the BODY of each existing github:* handler
  // verbatim from electron/main.ts, but accept hostId as the first IPC arg
  // and resolve provider/token via resolve(hostId). The renaming is mechanical;
  // see the channel mapping table at the top of this plan.
  //
  // For brevity, only the helper-using handlers are inlined above. Apply the
  // same shape for the remaining ~9 handlers in this file. After this task,
  // every github:* handler from main.ts should have a sibling repo:* here.
  //
  // NOTE: Do NOT delete the github:* handlers in main.ts yet — Task 13 does
  // that after the renderer migrations are done.
}
```

Add the remaining handlers (`repo:save`, `repo:getSaved`, `repo:getFeed`, `repo:getRelated`, `repo:recordFork`, `repo:setArchivedAt`, `repo:getRepoUserEvents`, `repo:getRepoStats`, `repo:getRepoMomentum`) by copying each existing `github:*` handler body from `electron/main.ts` verbatim, then changing:
- The channel name from `'github:foo'` to `'repo:foo'`
- The argument list to `(_event, hostId: string, ...originalArgs)`
- Any token reads from `getToken(HOST_ID_GITHUB)` to `getToken(hostId)`
- Any `gh.X(...)` calls to `getProvider(hostId)!.X(...)`

`repo:getSaved` and `repo:getFeed` take NO hostId (they return the full library across hosts).

- [ ] **Step 2: Add `repo:getRecommended` to recommendHandlers**

In `electron/ipc/recommendHandlers.ts`, add a parallel handler right after the existing `github:getRecommended` registration:

```ts
ipcMain.handle('repo:getRecommended', async (_event, page?: number, excludeIds?: string[]) => {
  // Same body as github:getRecommended — multi-host fan-out lands in Phase 6.
  return getRecommendedHandler({ page, excludeIds })
})
```

(If the existing handler inlines its body, factor it into a `getRecommendedHandler()` helper first, then call that helper from both registrations.)

- [ ] **Step 3: Register the handlers at app startup**

In `electron/main.ts`, add the import near the other IPC registration imports:

```ts
import { registerRepoHandlers } from './ipc/repoHandlers'
```

In the `app.whenReady().then(...)` block, call `registerRepoHandlers()` alongside the existing `registerLLMHandlers()`, `registerDownloadHandlers()`, etc.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/repoHandlers.ts electron/ipc/recommendHandlers.ts electron/main.ts
git commit -m "feat(ipc): add host-id-aware repo:* IPC channels alongside github:*"
```

---

## Task 3: Add `hosts:*` IPC handlers

**Files:**
- Create: `electron/ipc/hostHandlers.ts`
- Modify: `electron/main.ts` — call `registerHostHandlers()` at app startup.

- [ ] **Step 1: Write the host-handler module**

Write `electron/ipc/hostHandlers.ts`:

```ts
// electron/ipc/hostHandlers.ts
//
// Manages host instances (the list of GitHub/GitLab/Gitea servers the user
// has connected) and the per-host PATs/OAuth tokens. Phase 3 surfaces the
// IPC; Phase 7 builds the Connections-pane UI that exercises it.

import { ipcMain } from 'electron'
import {
  listHosts,
  getHost,
  addHost,
  removeHost,
  type HostInstance,
} from '../providers/hostConfig'
import {
  getToken,
  setToken,
  clearToken,
} from '../providers/tokenStore'
import { getProvider } from '../providers/registry'
import { githubUserToUser } from '../providers/github/normalize'
import { HOST_ID_GITHUB, type HostType } from '../providers/types'

interface AddHostInput {
  type: HostType
  baseUrl: string
  label: string
  webUrl?: string
}

interface ProbeInput {
  type: HostType
  baseUrl: string
}

interface ProbeResult {
  ok: boolean
  error?: string
}

export function registerHostHandlers(): void {
  ipcMain.handle('hosts:list', () => listHosts())

  ipcMain.handle('hosts:get', (_event, hostId: string) => getHost(hostId))

  ipcMain.handle('hosts:add', (_event, input: AddHostInput): HostInstance => {
    return addHost(input)
  })

  ipcMain.handle('hosts:remove', (_event, hostId: string) => {
    if (hostId === HOST_ID_GITHUB) {
      throw new Error('Cannot remove the GitHub host')
    }
    clearToken(hostId)
    removeHost(hostId)
  })

  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github' && input.baseUrl === 'https://api.github.com') {
      return { ok: true }
    }
    // GitLab + Gitea probe paths land with their providers in Phases 4-5.
    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })

  ipcMain.handle('hosts:setToken', async (_event, hostId: string, token: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const rawUser = await provider.getUser(token)
    setToken(hostId, token)
    return { user: githubUserToUser(rawUser) }
  })

  ipcMain.handle('hosts:clearToken', (_event, hostId: string) => {
    clearToken(hostId)
  })

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

  // ── Device flow ─────────────────────────────────────────────────
  ipcMain.handle('hosts:startDeviceFlow', async (_event, hostId: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    return provider.startDeviceFlow()
  })

  ipcMain.handle('hosts:pollDeviceToken', async (_event, hostId: string, deviceCode: string, interval: number) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const token = await provider.pollDeviceToken(deviceCode, interval)
    setToken(hostId, token)
    const rawUser = await provider.getUser(token)
    return { user: githubUserToUser(rawUser) }
  })

  ipcMain.handle('hosts:cancelDeviceFlow', (_event, _hostId: string) => {
    // The existing github:cancelDeviceFlow handler aborts the in-flight poll
    // via a module-level AbortController in electron/main.ts. Copy the same
    // logic here (or factor the AbortController into a shared module that
    // both handlers import). The hostId parameter is currently ignored —
    // only one device flow can be in progress at a time across all hosts.
  })

  ipcMain.handle('hosts:openLoginPopup', (_event, _hostId: string, url: string) => {
    // Same body as github:openLoginPopup in electron/main.ts. Copy verbatim.
  })
}
```

- [ ] **Step 2: Wire the cancelDeviceFlow + openLoginPopup bodies**

`electron/main.ts` currently holds a module-level `deviceFlowAbort` and an `openLoginPopup`/`closeLoginPopup` import. Two options:

A. Move both into a tiny shared helper module that both `hostHandlers` and `main.ts` can use.
B. Copy the few lines into `hostHandlers.ts` directly (the device-flow abort is just `deviceFlowAbort?.abort(); deviceFlowAbort = null; closeLoginPopup()`).

Option B is fewer files; Option A is cleaner if either body grows. Pick B for Phase 3; revisit if it grows.

- [ ] **Step 3: Register at app startup**

In `electron/main.ts`, after `registerRepoHandlers()` from Task 2:

```ts
import { registerHostHandlers } from './ipc/hostHandlers'
// ...
registerHostHandlers()
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/main.ts
git commit -m "feat(ipc): add hosts:* channels for host instance + token management"
```

---

## Task 4: Expose `window.api.repo.*` and `window.api.hosts.*` in preload

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add the new namespaces**

In `electron/preload.ts`, add a new `repo: { ... }` object alongside the existing `github: { ... }` object inside the `contextBridge.exposeInMainWorld('api', { ... })` call. Mirror the channel mapping table at the top of this plan. Example:

```ts
repo: {
  get: (hostId: string, owner: string, name: string) =>
    ipcRenderer.invoke('repo:get', hostId, owner, name) as Promise<import('../src/types/repo').SavedRepo | null>,
  search: (hostId: string, query: string, sort?: string, order?: string, page?: number) =>
    ipcRenderer.invoke('repo:search', hostId, query, sort, order, page) as Promise<import('../src/types/repo').Repo[]>,
  getReadme: (hostId: string, owner: string, name: string) =>
    ipcRenderer.invoke('repo:getReadme', hostId, owner, name) as Promise<string | null>,
  getFileContent: (hostId: string, owner: string, name: string, path: string) =>
    ipcRenderer.invoke('repo:getFileContent', hostId, owner, name, path) as Promise<string | null>,
  getReleases: (hostId: string, owner: string, name: string) =>
    ipcRenderer.invoke('repo:getReleases', hostId, owner, name) as Promise<import('../src/types/repo').Release[]>,
  // ... continue for every channel in the mapping table.
  // The arg lists mirror the IPC handler signatures from Task 2.
  // For repo:getSaved and repo:getFeed, no hostId — they return all hosts.
  // For repo:getRecommended, no hostId — multi-host comes in Phase 6.
},

hosts: {
  list: () =>
    ipcRenderer.invoke('hosts:list') as Promise<import('../electron/providers/types').HostInstance[]>,
  get: (hostId: string) =>
    ipcRenderer.invoke('hosts:get', hostId) as Promise<import('../electron/providers/types').HostInstance | null>,
  add: (input: { type: string; baseUrl: string; label: string; webUrl?: string }) =>
    ipcRenderer.invoke('hosts:add', input) as Promise<import('../electron/providers/types').HostInstance>,
  remove: (hostId: string) =>
    ipcRenderer.invoke('hosts:remove', hostId) as Promise<void>,
  probe: (input: { type: string; baseUrl: string }) =>
    ipcRenderer.invoke('hosts:probe', input) as Promise<{ ok: boolean; error?: string }>,
  setToken: (hostId: string, token: string) =>
    ipcRenderer.invoke('hosts:setToken', hostId, token) as Promise<{ user: import('../src/types/repo').User }>,
  clearToken: (hostId: string) =>
    ipcRenderer.invoke('hosts:clearToken', hostId) as Promise<void>,
  getConnectedUser: (hostId: string) =>
    ipcRenderer.invoke('hosts:getConnectedUser', hostId) as Promise<import('../src/types/repo').User | null>,
  startDeviceFlow: (hostId: string) =>
    ipcRenderer.invoke('hosts:startDeviceFlow', hostId) as Promise<{
      deviceCode: string
      userCode: string
      verificationUri: string
      verificationUriComplete: string
      expiresIn: number
      interval: number
    }>,
  pollDeviceToken: (hostId: string, deviceCode: string, interval: number) =>
    ipcRenderer.invoke('hosts:pollDeviceToken', hostId, deviceCode, interval) as Promise<{ user: import('../src/types/repo').User }>,
  cancelDeviceFlow: (hostId: string) =>
    ipcRenderer.invoke('hosts:cancelDeviceFlow', hostId) as Promise<void>,
  openLoginPopup: (hostId: string, url: string) =>
    ipcRenderer.invoke('hosts:openLoginPopup', hostId, url) as Promise<void>,
},
```

Keep the existing `github: { ... }` exposure UNTOUCHED. Task 13 deletes it after the renderer migrations finish.

- [ ] **Step 2: Update `src/env.d.ts`**

Add `repo` and `hosts` member declarations alongside the existing `github` declaration in the `Window.api` interface. Mirror the preload signatures exactly. Keep the existing `github` declaration in place — Task 13 deletes it.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/env.d.ts
git commit -m "feat(preload): expose window.api.repo and window.api.hosts"
```

---

## Task 5: Add `/repo/:hostId/:owner/:name` route + compat redirect

**Files:**
- Modify: `src/App.tsx`
- Create: `src/views/RepoRouteCompatRedirect.tsx`
- Create: `src/views/RepoRouteCompatRedirect.test.tsx`

- [ ] **Step 1: Write the failing test**

Write `src/views/RepoRouteCompatRedirect.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RepoRouteCompatRedirect } from './RepoRouteCompatRedirect'

beforeEach(() => {
  vi.stubGlobal('window', {
    ...window,
    api: {
      ...(window as { api?: unknown }).api ?? {},
      repo: {
        getSaved: vi.fn().mockResolvedValue([
          { hostId: 'gl:gitlab.com', owner: 'foo', name: 'bar', fullName: 'foo/bar' },
        ]),
      },
    },
  })
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/repo/:owner/:name" element={<RepoRouteCompatRedirect />} />
        <Route path="/repo/:hostId/:owner/:name" element={<div data-testid="new-route" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RepoRouteCompatRedirect', () => {
  it('redirects to /repo/<savedHostId>/owner/name when the repo is in the saved library', async () => {
    renderAt('/repo/foo/bar')
    await waitFor(() => expect(screen.getByTestId('new-route')).toBeInTheDocument())
  })

  it('falls back to HOST_ID_GITHUB when the repo is not in the saved library', async () => {
    vi.mocked(window.api.repo.getSaved).mockResolvedValueOnce([])
    renderAt('/repo/foo/bar')
    await waitFor(() => expect(screen.getByTestId('new-route')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/RepoRouteCompatRedirect.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `src/views/RepoRouteCompatRedirect.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { HOST_ID_GITHUB } from '../lib/hostIds'

export function RepoRouteCompatRedirect() {
  const { owner, name } = useParams<{ owner: string; name: string }>()
  const [hostId, setHostId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function resolve() {
      if (!owner || !name) return
      const saved = await window.api.repo.getSaved()
      if (cancelled) return
      const match = saved.find(r => r.owner === owner && r.name === name)
      setHostId(match?.hostId ?? HOST_ID_GITHUB)
    }
    resolve()
    return () => { cancelled = true }
  }, [owner, name])

  if (!hostId || !owner || !name) return null
  return <Navigate to={`/repo/${encodeURIComponent(hostId)}/${owner}/${name}`} replace />
}
```

- [ ] **Step 4: Verify the test passes**

Run: `npx vitest run src/views/RepoRouteCompatRedirect.test.tsx`

Expected: 2 PASS.

- [ ] **Step 5: Wire the routes in `App.tsx`**

In `src/App.tsx`, find the existing `<Route path="/repo/:owner/:name" element={<RepoDetail />} />` (or similar) and split it into TWO routes:

```tsx
<Route path="/repo/:hostId/:owner/:name" element={<RepoDetail />} />
<Route path="/repo/:owner/:name" element={<RepoRouteCompatRedirect />} />
```

Order matters in some router versions (more-specific first), so list the `:hostId` route first.

Note: this step does NOT modify `RepoDetail.tsx` to actually read `hostId` from the URL — that's Task 11. For now, both routes still drive into the same `RepoDetail` that defaults to GitHub. The compat redirect ensures old-shape URLs hit the new path; `RepoDetail` will start respecting the URL param in Task 11.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/RepoRouteCompatRedirect.tsx src/views/RepoRouteCompatRedirect.test.tsx src/App.tsx
git commit -m "feat(router): add /repo/:hostId/:owner/:name route + compat redirect"
```

---

## Task 6: Renderer migration — RepoDetail (sets the hostId pattern)

Task 11 in Phase 2's plan migrated RepoDetail to the camelCase `SavedRepo` shape. This task does the IPC-channel migration: every `window.api.github.X(owner, name)` becomes `window.api.repo.X(hostId, owner, name)`, with `hostId` sourced from the URL param introduced in Task 5.

**Files:**
- Modify: `src/views/RepoDetail.tsx`
- Modify: `src/views/RepoDetail.test.tsx`
- Modify: `src/hooks/useCompare.ts`
- Modify: `src/hooks/useRepoStats.ts`
- Modify: `src/hooks/useRepoMomentum.ts`
- Modify: `src/hooks/useRepoUserEvents.ts`
- Modify: `src/hooks/useLastCommits.test.ts`
- Modify: `src/hooks/useGitStatus.test.ts`
- Modify: `src/components/FilesTab.tsx`
- Modify: `src/components/PdfViewer.tsx`
- Modify: `src/components/RepoContextMenu.tsx`
- Modify: `src/components/RepoStatsSidebar.test.tsx`

- [ ] **Step 1: Read `hostId` from the URL inside `RepoDetail`**

In `src/views/RepoDetail.tsx`, find the existing `useParams<{ owner: string; name: string }>()` and widen it:

```ts
import { HOST_ID_GITHUB } from '../lib/hostIds'

const { hostId: hostIdParam, owner, name } = useParams<{ hostId?: string; owner: string; name: string }>()
const hostId = hostIdParam ? decodeURIComponent(hostIdParam) : HOST_ID_GITHUB
```

(The `?? HOST_ID_GITHUB` fallback covers the case where `RepoDetail` is rendered from the old `/repo/:owner/:name` route during the compat-redirect's tick — it's a brief window where Hot the URL hasn't navigated yet.)

- [ ] **Step 2: Apply the channel mapping inside `RepoDetail.tsx`**

For each call site:
- `window.api.github.getRepo(owner, name)` → `window.api.repo.get(hostId, owner, name)`
- `window.api.github.getReadme(owner, name)` → `window.api.repo.getReadme(hostId, owner, name)`
- `window.api.github.getReleases(owner, name)` → `window.api.repo.getReleases(hostId, owner, name)`
- `window.api.github.fetchRepoBundle(owner, name)` → `window.api.repo.fetchBundle(hostId, owner, name)`
- `window.api.github.isStarred(owner, name)` → `window.api.repo.isStarred(hostId, owner, name)`
- `window.api.github.starRepo(owner, name)` → `window.api.repo.star(hostId, owner, name)`
- `window.api.github.unstarRepo(owner, name)` → `window.api.repo.unstar(hostId, owner, name)`
- `window.api.github.saveRepo(owner, name)` → `window.api.repo.save(hostId, owner, name)`
- `window.api.github.recordFork(owner, name)` → `window.api.repo.recordFork(hostId, owner, name)`
- `window.api.github.setArchivedAt(owner, name, archived)` → `window.api.repo.setArchivedAt(hostId, owner, name, archived)`

Pass `hostId` down to the four hooks (`useCompare`, `useRepoStats`, `useRepoMomentum`, `useRepoUserEvents`) and to `FilesTab` / `PdfViewer` / `RepoContextMenu` as new props.

- [ ] **Step 3: Update each hook signature**

For each of the four `useX` hooks, change the signature from `useX(owner, name, ...)` to `useX(hostId, owner, name, ...)`. Apply the channel mapping inside the hook body.

- [ ] **Step 4: Update each component prop type**

For `FilesTab`, `PdfViewer`, `RepoContextMenu`: add `hostId: string` to props. Update internal call sites.

- [ ] **Step 5: Update the tests**

Mocks in `RepoDetail.test.tsx`, `useLastCommits.test.ts`, `useGitStatus.test.ts`, `RepoStatsSidebar.test.tsx` reference `window.api.github.*`. Replace with `window.api.repo.*` calls. Pass `HOST_ID_GITHUB` from `../lib/hostIds` as the first arg to every mock setup that checks call args.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/views/RepoDetail.test.tsx src/hooks/useLastCommits.test.ts src/hooks/useGitStatus.test.ts src/components/RepoStatsSidebar.test.tsx`

Expected: PASS (excluding pre-existing failures from the Phase 2 baseline).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors anywhere within this group's files. Other src/ files still call `window.api.github.*` — those are for later tasks.

- [ ] **Step 8: Commit**

```bash
git add src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx \
        src/hooks/useCompare.ts src/hooks/useRepoStats.ts src/hooks/useRepoMomentum.ts src/hooks/useRepoUserEvents.ts \
        src/hooks/useLastCommits.test.ts src/hooks/useGitStatus.test.ts \
        src/components/FilesTab.tsx src/components/PdfViewer.tsx src/components/RepoContextMenu.tsx \
        src/components/RepoStatsSidebar.test.tsx
git commit -m "refactor(repo-detail): migrate RepoDetail + hooks to window.api.repo with hostId"
```

---

## Task 7: Renderer migration — Discover

**Files:**
- Modify: `src/views/Discover.tsx`
- Modify: `src/views/Discover.test.tsx`

For both files, the `hostId` source is `HOST_ID_GITHUB` (Discover only queries GitHub in Phase 3; Phase 6 introduces multi-host fan-out).

- [ ] **Step 1: Replace every `window.api.github.X(...)` call**

Apply the channel mapping table from the top of the plan. Notable for this file:
- `window.api.github.searchRepos(...)` → `window.api.repo.search(HOST_ID_GITHUB, ...)`
- `window.api.github.getRecommended(...)` → `window.api.repo.getRecommended(...)` (no hostId — already cross-host)
- `window.api.github.saveRepo(...)` → `window.api.repo.save(HOST_ID_GITHUB, ...)`
- `window.api.github.starRepo / unstarRepo / isStarred` → `window.api.repo.star / unstar / isStarred(HOST_ID_GITHUB, ...)`
- `window.api.github.getFeedRepos()` → `window.api.repo.getFeed()`
- `window.api.github.getRelatedRepos(owner, name, topicsJson)` → `window.api.repo.getRelated(HOST_ID_GITHUB, owner, name, topicsJson)`

Import `HOST_ID_GITHUB` from `../lib/hostIds`.

- [ ] **Step 2: Update the test mocks**

In `Discover.test.tsx`, replace every `window.api.github.X` mock with `window.api.repo.X`. The first call arg shifts by one — preserve all other assertions.

- [ ] **Step 3: Run the test suite**

Run: `npx vitest run src/views/Discover.test.tsx`

Expected: PASS (modulo pre-existing failures).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors in `Discover.tsx` and `Discover.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/views/Discover.tsx src/views/Discover.test.tsx
git commit -m "refactor(discover): migrate Discover view to window.api.repo"
```

---

## Task 8: Renderer migration — Library, Starred, Collections

**Files:**
- Modify: `src/views/Starred.tsx`
- Modify: `src/views/CollectionDetail.tsx`
- Modify: `src/views/Collections.tsx`
- Modify: `src/contexts/SavedRepos.tsx`
- Modify: `src/hooks/useArchivedRepos.ts`

The `hostId` source varies:
- `SavedRepos.tsx` — when iterating saved repos, the host is `repo.hostId` from the `SavedRepo`.
- `useArchivedRepos.ts` — likewise.
- `Starred.tsx`, `Collections.tsx`, `CollectionDetail.tsx` — repos are already loaded with `hostId` on them.

For "act-against-the-current-host" actions (e.g. saving a new repo from the user's typed input), use `HOST_ID_GITHUB`.

- [ ] **Step 1: Apply the channel mapping**

Find every `window.api.github.*` call. Replace per the channel mapping table at the top, sourcing `hostId` from the in-scope `SavedRepo` instance when available; otherwise `HOST_ID_GITHUB`.

- [ ] **Step 2: Update saved-repos cache invalidations**

`SavedRepos.tsx` likely has a `refresh()` that calls `window.api.github.getSavedRepos()`. Replace with `window.api.repo.getSaved()`.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/Starred.tsx src/views/CollectionDetail.tsx src/views/Collections.tsx src/contexts/SavedRepos.tsx src/hooks/useArchivedRepos.ts
git commit -m "refactor(library): migrate Library+Starred+Collections to window.api.repo"
```

---

## Task 9: Renderer migration — Profile + people

**Files:**
- (Profile views already migrated to the normalized `User` shape in Phase 2 Task 9. The IPC channels they consume — `profile:*` — are NOT part of this Phase 3 namespace migration; those stay on the `profile:*` channels. No work needed here unless a future audit surfaces `window.api.github.*` references in Profile files.)

- [ ] **Step 1: Audit Profile files for `window.api.github` references**

Run:
```bash
git grep -nE "window\.api\.github\." -- src/views/Profile.tsx src/views/Profile.test.tsx src/components/ProfileOverlay.tsx src/components/PersonRow.tsx
```

Expected: no matches. If matches appear, apply the channel mapping and migrate them. Otherwise skip the commit step and move on.

- [ ] **Step 2: Commit (if any changes were needed)**

Skip if Step 1 found nothing.

---

## Task 10: Renderer migration — Activity feed + hooks

**Files:**
- Modify: `src/hooks/useFeed.ts`
- Modify: `src/hooks/useForkData.ts`

`useFeed` calls `window.api.github.getStarred()`, `window.api.github.getReceivedEvents(username)`, `window.api.github.getReleases(owner, name)`, `window.api.github.getFeedRepos()`.

`useForkData` calls `window.api.github.getReleases(owner, name)`.

`hostId` source: `HOST_ID_GITHUB` (activity feed is GitHub-only in Phase 3).

- [ ] **Step 1: Apply the channel mapping**

Replace per the table:
- `window.api.github.getStarred(force?)` → `window.api.repo.getMyStarred(HOST_ID_GITHUB, force)` — note the rename to `getMyStarred`.
- `window.api.github.getReceivedEvents(username)` → `window.api.repo.getReceivedEvents(HOST_ID_GITHUB, username)`
- `window.api.github.getReleases(owner, name)` → `window.api.repo.getReleases(HOST_ID_GITHUB, owner, name)`
- `window.api.github.getFeedRepos()` → `window.api.repo.getFeed()`

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/hooks/useFeed.ts src/hooks/useForkData.ts
git commit -m "refactor(feed): migrate useFeed + useForkData to window.api.repo"
```

---

## Task 11: Renderer migration — Auth + Onboarding + Login UI

These files call the channels that moved to `hosts:*` (device flow, getUser, disconnect).

**Files:**
- Modify: `src/contexts/GitHubAuth.tsx`
- Modify: `src/views/Onboarding.tsx`
- Modify: `src/views/Onboarding.test.tsx`
- Modify: `src/components/GitHubLoginPrompt.tsx`
- Modify: `src/hooks/useGitHubLogin.ts`
- Modify: `src/views/settings/ConnectorsPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

For each file, the channel-mapping rule is:
- `window.api.github.startDeviceFlow()` → `window.api.hosts.startDeviceFlow(HOST_ID_GITHUB)`
- `window.api.github.pollDeviceToken(deviceCode, interval)` → `window.api.hosts.pollDeviceToken(HOST_ID_GITHUB, deviceCode, interval)` *(returns `{ user }` — adjust the call site)*
- `window.api.github.cancelDeviceFlow()` → `window.api.hosts.cancelDeviceFlow(HOST_ID_GITHUB)`
- `window.api.github.openLoginPopup(url)` → `window.api.hosts.openLoginPopup(HOST_ID_GITHUB, url)`
- `window.api.github.getUser()` → `window.api.hosts.getConnectedUser(HOST_ID_GITHUB)` *(returns `User | null` instead of throwing — adjust)*
- `window.api.github.disconnect()` → `window.api.hosts.clearToken(HOST_ID_GITHUB)`

Import `HOST_ID_GITHUB` from `../lib/hostIds`.

- [ ] **Step 1: Apply the channel mapping**

Walk each file. Apply per the rule above. Mind the return-type difference for `getConnectedUser` (returns `null` instead of throwing).

- [ ] **Step 2: Update test mocks**

`Onboarding.test.tsx` and `App.test.tsx` mock `window.api.github.startDeviceFlow` etc. Replace with `window.api.hosts.*`.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/contexts/GitHubAuth.tsx \
        src/views/Onboarding.tsx src/views/Onboarding.test.tsx \
        src/components/GitHubLoginPrompt.tsx src/hooks/useGitHubLogin.ts \
        src/views/settings/ConnectorsPanel.tsx \
        src/App.tsx src/App.test.tsx
git commit -m "refactor(auth): migrate login/onboarding to window.api.hosts"
```

---

## Task 12: Renderer migration — Stragglers

**Files:**
- Modify: `src/utils/githubRepoFetcher.ts`
- Modify: `src/components/create/TemplateGallery.tsx`
- Modify: `src/components/ReadmeRenderer.test.tsx`
- Modify: `src/views/Discover.test.tsx` (if it has remaining mocks not covered by Task 7)

`hostId` source: `HOST_ID_GITHUB` everywhere (utilities don't know about per-repo host).

- [ ] **Step 1: Sweep**

Run:
```bash
git grep -nE "window\.api\.github\." -- src/
```

Expected: only files in the list above. If anything else surfaces, surface it as a BLOCKED status — earlier tasks missed something.

- [ ] **Step 2: Apply the channel mapping**

Replace every `window.api.github.X(args)` with `window.api.repo.X(HOST_ID_GITHUB, args)` (or `window.api.hosts.X(HOST_ID_GITHUB, args)` for auth methods).

- [ ] **Step 3: Confirm the grep is now empty**

Run:
```bash
git grep -nE "window\.api\.github\." -- src/
```

Expected: zero matches.

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/utils/githubRepoFetcher.ts \
        src/components/create/TemplateGallery.tsx \
        src/components/ReadmeRenderer.test.tsx \
        src/views/Discover.test.tsx
git commit -m "refactor(misc): migrate remaining renderer files to window.api.repo"
```

---

## Task 13: Delete `window.api.github.*` and the `github:*` IPC handlers

**Files:**
- Modify: `electron/main.ts` — delete every `ipcMain.handle('github:...')` block.
- Modify: `electron/ipc/recommendHandlers.ts` — delete `ipcMain.handle('github:getRecommended', ...)`.
- Modify: `electron/preload.ts` — delete the entire `github: { ... }` object inside the `contextBridge.exposeInMainWorld` call.
- Modify: `src/env.d.ts` — delete the `github: { ... }` block from the `Window.api` interface.

- [ ] **Step 1: Confirm no renderer reference remains**

Run:
```bash
git grep -nE "window\.api\.github\.|api\.github\." -- src/
```

Expected: zero matches. If any remain, return to the appropriate Task 6–12 and finish the migration before deleting.

- [ ] **Step 2: Delete the `github:` IPC handlers from `electron/main.ts`**

Find every `ipcMain.handle('github:` registration and remove the entire block. There are ~35 of them. Tip: `git grep -nE "ipcMain\.handle\(['\"]github:" -- electron/main.ts` enumerates them. Each handler body is a few-to-many lines; remove the whole `ipcMain.handle('github:X', ...)` call.

- [ ] **Step 3: Delete `github:getRecommended` from `recommendHandlers.ts`**

- [ ] **Step 4: Delete the `github: { ... }` block from `electron/preload.ts`**

- [ ] **Step 5: Delete the `github: { ... }` block from `src/env.d.ts`**

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts electron/ipc/recommendHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "refactor(ipc): delete window.api.github namespace (replaced by window.api.repo + hosts)"
```

---

## Task 14: Final verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 2: Confirm no stale `github:*` channel references remain**

Run:
```bash
git grep -nE "'github:[a-zA-Z]+'|\"github:[a-zA-Z]+\"" -- electron/ src/
```

Expected: zero matches. (Comments referencing the old channel names are fine — they're text.)

- [ ] **Step 3: Confirm preload `github:` exposure is gone**

Run:
```bash
git grep -n "  github: {" electron/preload.ts
```

Expected: zero matches.

- [ ] **Step 4: Rebuild better-sqlite3 for Node ABI to run the full test suite**

```bash
npm rebuild better-sqlite3
```

If the rebuild fails because the Electron app is running, kill it first (per the Phase 1/2 verification convention) — surface the need to the user as the prior phases did.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`

Expected: all electron/ tests pass; src/ failures match Phase 2's pre-existing-failure baseline (no new regressions).

- [ ] **Step 6: Rebuild better-sqlite3 for Electron ABI**

```bash
npx @electron/rebuild -f -o better-sqlite3
```

So the app launches again.

- [ ] **Step 7: Smoke test the dev app**

Run: `npm run dev`

Checklist:
- Onboarding flow: device-flow login still works (now via `window.api.hosts.*`).
- Discover rows populate from `window.api.repo.search` / `window.api.repo.getRecommended`.
- Opening a saved repo's detail page: URL becomes `/repo/gh:api.github.com/owner/name`; old `/repo/owner/name` deep-links redirect.
- Star / unstar persists.
- Library / Starred / Collections views load.

- [ ] **Step 8: Hand off to the user**

Surface:
- Phase 3 complete. `window.api.github.*` is gone; `window.api.repo.*` (host-id-aware) and `window.api.hosts.*` (host instance + auth management) replace it.
- The repo detail URL now carries `hostId`. Old-shape deep links resolve via the compat redirect.
- Next: Phase 4 brainstorm/spec would build the `GitLabProvider` and the "Connections" pane UI that exercises the `hosts:*` channels added in Task 3.
