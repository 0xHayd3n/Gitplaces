# Repo Update Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub release/commit update detection to the Library — repos with new releases or commits show blue name text and an update button; forked repos show a fork icon; updates are applied via a confirmation modal.

**Architecture:** A background `updateService.ts` polls GitHub's releases and repo APIs on a configurable interval, writes `update_available` / `is_forked` / `stored_version` flags to SQLite, and notifies the renderer via IPC. `LibraryCard` and `LibraryListRow` read these fields directly from the already-loaded `LibraryRow`. An `UpdateModal` component fetches the diff and dispatches the apply action. Settings exposes a toggle for auto-update and a configurable check interval.

**Tech Stack:** Electron main process, React + TypeScript renderer, better-sqlite3 (SQLite), GitHub REST API (`api.github.com`), lucide-react icons, Vitest (testing).

---

## File Map

**New files:**
- `electron/services/updateService.ts` — polling service, fork-check, apply actions
- `electron/ipc/updateHandlers.ts` — IPC handler registrations
- `electron/db.phase23-migration.test.ts` — DB migration test
- `electron/updateService.test.ts` — pure helper unit tests
- `src/components/UpdateModal.tsx` — diff review + confirm modal
- `src/components/UpdateModal.css` — modal styles

**Modified files:**
- `electron/db.ts` — Phase 23 migration (5 new columns)
- `src/types/repo.ts` — 5 new fields on `RepoRow`
- `electron/preload.ts` — expose `window.api.updates` namespace
- `electron/main.ts` — register handlers, start service, inject fork-check in `github:saveRepo`
- `src/styles/globals.css` — add `--color-update-available` token
- `src/components/LibraryListRow.tsx` — fork icon, blue name, update button
- `src/components/LibraryListRow.css` — indicator styles
- `src/components/LibraryCard.tsx` — fork icon, blue name, update button
- `src/components/LibraryCard.css` — indicator styles
- `src/views/Library.tsx` — subscribe to `update:status-changed` IPC event
- `src/views/Settings.tsx` — add Updates section

---

## Task 1: DB Migration + RepoRow Types

**Files:**
- Create: `electron/db.phase23-migration.test.ts`
- Modify: `electron/db.ts`
- Modify: `src/types/repo.ts`

- [ ] **Step 1: Write failing migration test**

```typescript
// electron/db.phase23-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — Phase 23 update notifications', () => {
  it('adds is_forked column to repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'is_forked')).toBe(true)
  })

  it('adds update_available column to repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'update_available')).toBe(true)
  })

  it('adds stored_version, upstream_version, update_checked_at columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'stored_version')).toBe(true)
    expect(cols.some(c => c.name === 'upstream_version')).toBe(true)
    expect(cols.some(c => c.name === 'update_checked_at')).toBe(true)
  })

  it('is_forked defaults to 0 for existing rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('o/n', 'o', 'n', '[]')`).run()
    const row = db.prepare(`SELECT is_forked, update_available FROM repos WHERE id = 'o/n'`).get() as { is_forked: number; update_available: number }
    expect(row.is_forked).toBe(0)
    expect(row.update_available).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run electron/db.phase23-migration.test.ts
```
Expected: FAIL — columns not found.

- [ ] **Step 3: Add Phase 23 migrations to `electron/db.ts`**

After the "Skill GitHub sync columns" block (after line 196), add:

```typescript
  // Phase 23 migration — update notifications
  try { db.exec(`ALTER TABLE repos ADD COLUMN is_forked         INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_available  INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_checked_at INTEGER DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN upstream_version  TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN stored_version    TEXT    DEFAULT NULL`) } catch {}
```

Also add an index inside the post-migration `db.exec` block (after the existing index lines):

```typescript
    CREATE INDEX IF NOT EXISTS repos_update_available ON repos(update_available);
```

- [ ] **Step 4: Add fields to `RepoRow` in `src/types/repo.ts`**

After the `type_sub` line (line 42), add:

```typescript
  // Phase 23 — update notifications
  is_forked:         number | null   // 1 if user has a GitHub fork of this repo
  update_available:  number | null   // 1 if an update has been detected
  update_checked_at: number | null   // Unix timestamp of last check
  upstream_version:  string | null   // latest release tag or pushed_at
  stored_version:    string | null   // version at last save or update
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run electron/db.phase23-migration.test.ts
```
Expected: PASS (all 4 tests green).

- [ ] **Step 6: Commit**

```bash
git add electron/db.ts src/types/repo.ts electron/db.phase23-migration.test.ts
git commit -m "feat(db): Phase 23 migration — update notification columns"
```

---

## Task 2: updateService — Pure Helpers (Tested)

**Files:**
- Create: `electron/updateService.test.ts`
- Create: `electron/services/updateService.ts` (skeleton with pure functions only)

- [ ] **Step 1: Write failing tests**

```typescript
// electron/updateService.test.ts
import { describe, it, expect } from 'vitest'
import { isNewerRelease, isNewerPushedAt } from './services/updateService'

describe('isNewerRelease', () => {
  it('returns true when stored is null', () => {
    expect(isNewerRelease('v2.0.0', null)).toBe(true)
  })
  it('returns false when upstream equals stored', () => {
    expect(isNewerRelease('v2.0.0', 'v2.0.0')).toBe(false)
  })
  it('returns true when upstream differs from stored', () => {
    expect(isNewerRelease('v2.1.0', 'v2.0.0')).toBe(true)
  })
})

describe('isNewerPushedAt', () => {
  it('returns true when stored is null', () => {
    expect(isNewerPushedAt('2026-04-29T00:00:00Z', null)).toBe(true)
  })
  it('returns false when upstream equals stored', () => {
    expect(isNewerPushedAt('2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(false)
  })
  it('returns true when upstream is later than stored', () => {
    expect(isNewerPushedAt('2026-04-29T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(true)
  })
  it('returns false when upstream is earlier than stored', () => {
    expect(isNewerPushedAt('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run electron/updateService.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `electron/services/updateService.ts` with pure exports**

```typescript
// electron/services/updateService.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { getToken, getGitHubUser } from '../store'
import { githubHeaders } from '../github'

// ── Pure helpers (tested) ──────────────────────────────────────────────────────

/** Returns true if the upstream release tag differs from what we last stored. */
export function isNewerRelease(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return upstream !== stored
}

/** Returns true if the upstream pushed_at timestamp is more recent than stored. */
export function isNewerPushedAt(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return new Date(upstream).getTime() > new Date(stored).getTime()
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run electron/updateService.test.ts
```
Expected: PASS (7 tests green).

- [ ] **Step 5: Commit**

```bash
git add electron/services/updateService.ts electron/updateService.test.ts
git commit -m "feat(update): updateService skeleton with tested pure helpers"
```

---

## Task 3: updateService — Complete Implementation

**Files:**
- Modify: `electron/services/updateService.ts`

Complete the service in one commit so there are no intermediate states where `checkAll` references functions that don't exist yet.

Add these imports to the top of `updateService.ts` (replacing the existing minimal imports):

```typescript
// electron/services/updateService.ts
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getToken, getGitHubUser, getApiKey } from '../store'
import { githubHeaders, getReadme, getReleases } from '../github'
import { route as pipelineRoute } from '../skill-gen/pipeline'
import { prepareWrite } from '../skill-gen/regeneration'
```

- [ ] **Step 1: Append all remaining service code to `updateService.ts`** (below the pure helpers already committed in Task 2)

```typescript
// ── Service state ─────────────────────────────────────────────────────────────

let _db: Database.Database | null = null
let _win: BrowserWindow | null = null
let _intervalId: ReturnType<typeof setInterval> | null = null

// ── clearUpdateFlag ───────────────────────────────────────────────────────────

export function clearUpdateFlag(repoId: string, upstreamVersion: string | null): void {
  _db?.prepare('UPDATE repos SET update_available = 0, stored_version = ? WHERE id = ?')
    .run(upstreamVersion, repoId)
  _win?.webContents.send('update:status-changed', { ids: [repoId] })
}

// ── checkRepo ─────────────────────────────────────────────────────────────────

export async function checkRepo(
  owner: string,
  name: string,
  storedVersion: string | null,
): Promise<{ updateAvailable: boolean; upstreamVersion: string } | null> {
  const token = getToken() ?? null
  const headers = githubHeaders(token)
  try {
    const relRes = await fetch(`https://api.github.com/repos/${owner}/${name}/releases/latest`, { headers })
    if (relRes.ok) {
      const rel = await relRes.json() as { tag_name: string }
      return { updateAvailable: isNewerRelease(rel.tag_name, storedVersion), upstreamVersion: rel.tag_name }
    }
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers })
    if (!repoRes.ok) return null
    const repo = await repoRes.json() as { pushed_at: string }
    return { updateAvailable: isNewerPushedAt(repo.pushed_at, storedVersion), upstreamVersion: repo.pushed_at }
  } catch {
    return null
  }
}

// ── applyForkSync ─────────────────────────────────────────────────────────────

export async function applyForkSync(repoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!_db) return { ok: false, error: 'Service not initialised' }
  const token = getToken()
  if (!token) return { ok: false, error: 'Not authenticated with GitHub' }
  const githubUser = getGitHubUser()?.username
  if (!githubUser) return { ok: false, error: 'GitHub user not found' }
  const row = _db.prepare('SELECT owner, name, upstream_version FROM repos WHERE id = ?').get(repoId) as
    { owner: string; name: string; upstream_version: string | null } | undefined
  if (!row) return { ok: false, error: 'Repo not found' }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubUser}/${row.name}/merge-upstream`,
      {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'main' }),
      },
    )
    if (!res.ok) {
      const err = await res.json() as { message?: string }
      return { ok: false, error: err.message ?? 'Fork sync failed' }
    }
    clearUpdateFlag(repoId, row.upstream_version)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── applySkillRegen ───────────────────────────────────────────────────────────
// Handles library-flavour regen. For codebase-flavour full support, see main.ts:1143.

export async function applySkillRegen(repoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!_db) return { ok: false, error: 'Service not initialised' }
  const token = getToken() ?? null
  const apiKey = getApiKey()
  const row = _db.prepare(
    'SELECT owner, name, language, topics, default_branch, type_bucket, type_sub, upstream_version FROM repos WHERE id = ?'
  ).get(repoId) as {
    owner: string; name: string; language: string | null; topics: string | null
    default_branch: string | null; type_bucket: string | null; type_sub: string | null; upstream_version: string | null
  } | undefined
  if (!row) return { ok: false, error: 'Repo not found' }

  try {
    const readme = await getReadme(token, row.owner, row.name)
    const releases = await getReleases(token, row.owner, row.name)
    const version = releases[0]?.tag_name ?? 'unknown'
    const topics = JSON.parse(row.topics ?? '[]') as string[]

    // pipelineRoute signature: (flavour: SkillFlavour, input: GenerateInput)
    // GenerateInput: { token, owner, name, language, topics, readme, version, defaultBranch, apiKey?, typeBucket?, typeSub? }
    // SkillFlavour is 'library' | 'codebase' | 'domain' — use 'library' for update regen
    const routeResult = await pipelineRoute('library', {
      token,
      owner: row.owner,
      name: row.name,
      language: row.language ?? '',
      topics,
      readme: readme ?? '',
      version,
      defaultBranch: row.default_branch ?? 'main',
      apiKey: apiKey ?? undefined,
      typeBucket: row.type_bucket ?? undefined,
      typeSub: row.type_sub ?? undefined,
    })

    // RouteResult is a discriminated union; 'codebase' has no .content — narrow first
    if (routeResult.flavour !== 'library' || !routeResult.content) return { ok: false, error: 'No content generated' }

    // Write skill file + update DB — library-flavour path (mirrors main.ts:1184-1229)
    const dir = path.join(app.getPath('userData'), 'skills', row.owner)
    await fs.mkdir(dir, { recursive: true })
    const skillPath = path.join(dir, `${row.name}.skill.md`)
    const storedSkill = (_db!.prepare('SELECT content FROM skills WHERE repo_id = ?')
      .get(repoId) as { content: string } | undefined)?.content ?? null
    const currentSkill = await fs.readFile(skillPath, 'utf8').catch(() => null)
    const generated_at = new Date().toISOString()
    const check = prepareWrite(routeResult.content, storedSkill, currentSkill)
    if (check.conflict) return { ok: false, error: 'Skill file has local edits in the generated block — regenerate manually' }

    await fs.writeFile(skillPath, check.merged!, 'utf8')
    _db!.prepare(`
      INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier)
      VALUES (?, ?, ?, ?, ?, 1, NULL, 1)
      ON CONFLICT(repo_id) DO UPDATE SET
        filename     = excluded.filename,
        content      = excluded.content,
        version      = excluded.version,
        generated_at = excluded.generated_at,
        tier         = excluded.tier
    `).run(repoId, `${row.name}.skill.md`, check.merged!, version, generated_at)

    clearUpdateFlag(repoId, row.upstream_version)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── checkIsFork ───────────────────────────────────────────────────────────────

export async function checkIsFork(owner: string, name: string): Promise<boolean> {
  const token = getToken() ?? null
  const githubUser = getGitHubUser()?.username
  if (!token || !githubUser) return false
  try {
    const res = await fetch(`https://api.github.com/repos/${githubUser}/${name}`, { headers: githubHeaders(token) })
    if (!res.ok) return false
    const data = await res.json() as { fork?: boolean; parent?: { full_name?: string } }
    return data.fork === true && data.parent?.full_name === `${owner}/${name}`
  } catch {
    return false
  }
}

// ── checkAll ──────────────────────────────────────────────────────────────────

export async function checkAll(): Promise<void> {
  if (!_db) return
  const rows = _db.prepare(
    'SELECT id, owner, name, stored_version FROM repos WHERE saved_at IS NOT NULL'
  ).all() as { id: string; owner: string; name: string; stored_version: string | null }[]

  const changedIds: string[] = []
  const BATCH = 10
  const DELAY = 500

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await Promise.all(batch.map(async (row) => {
      const result = await checkRepo(row.owner, row.name, row.stored_version)
      if (!result) return
      const prev = (_db!.prepare('SELECT update_available FROM repos WHERE id = ?')
        .get(row.id) as { update_available: number } | undefined)
      const nowSec = Math.floor(Date.now() / 1000)
      _db!.prepare(
        'UPDATE repos SET update_available = ?, upstream_version = ?, update_checked_at = ? WHERE id = ?'
      ).run(result.updateAvailable ? 1 : 0, result.upstreamVersion, nowSec, row.id)
      if ((prev?.update_available === 1) !== result.updateAvailable) {
        changedIds.push(row.id)
      }
    }))
    if (i + BATCH < rows.length) {
      await new Promise<void>(r => setTimeout(r, DELAY))
    }
  }

  const autoSetting = (_db.prepare("SELECT value FROM settings WHERE key = 'autoUpdateEnabled'")
    .get() as { value: string } | undefined)?.value
  if (autoSetting === 'true') {
    const toUpdate = _db.prepare(
      'SELECT id, owner, name, is_forked FROM repos WHERE update_available = 1'
    ).all() as { id: string; owner: string; name: string; is_forked: number }[]
    for (const r of toUpdate) {
      if (r.is_forked) await applyForkSync(r.id).catch(() => {})
      const hasSkill = _db!.prepare('SELECT 1 FROM skills WHERE repo_id = ?').get(r.id)
      if (hasSkill) await applySkillRegen(r.id).catch(() => {})
      if (r.is_forked || hasSkill) {
        _win?.webContents.send('update:toast', { message: `Auto-updated: ${r.owner}/${r.name}` })
      }
    }
  }

  if (changedIds.length > 0) {
    _win?.webContents.send('update:status-changed', { ids: changedIds })
  }
}

// ── Service lifecycle ─────────────────────────────────────────────────────────

export function startUpdateService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
  const hoursStr = (db.prepare("SELECT value FROM settings WHERE key = 'updateCheckIntervalHours'")
    .get() as { value: string } | undefined)?.value ?? '24'
  const ms = Math.max(1, parseInt(hoursStr, 10)) * 60 * 60 * 1000
  void checkAll()
  _intervalId = setInterval(() => void checkAll(), ms)
}

export function stopUpdateService(): void {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null }
}

export function restartUpdateService(): void {
  stopUpdateService()
  if (_db && _win) startUpdateService(_db, _win)
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/updateService.ts
git commit -m "feat(update): complete updateService — checkAll, forkSync, skillRegen, checkIsFork"
```

---

## Task 4: updateHandlers.ts

**Files:**
- Create: `electron/ipc/updateHandlers.ts`

- [ ] **Step 1: Create the IPC handler file**

```typescript
// electron/ipc/updateHandlers.ts
import { ipcMain, app } from 'electron'
import { getDb } from '../db'
import { getToken } from '../store'
import { githubHeaders } from '../github'
import { checkAll, applyForkSync, applySkillRegen, restartUpdateService } from '../services/updateService'

export function registerUpdateHandlers(): void {

  // Trigger immediate full check outside normal interval (Settings "Check now")
  ipcMain.handle('update:check-now', async () => {
    await checkAll()
  })

  // Get MAX(update_checked_at) for the Settings "Last checked" display
  ipcMain.handle('update:last-checked', () => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare('SELECT MAX(update_checked_at) as ts FROM repos').get() as { ts: number | null } | undefined
    return { timestamp: row?.ts ?? null }
  })

  // Fetch diff/release notes before user confirms update
  ipcMain.handle('update:get-changes', async (_event, repoId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(
      'SELECT owner, name, stored_version, upstream_version, is_forked FROM repos WHERE id = ?'
    ).get(repoId) as { owner: string; name: string; stored_version: string | null; upstream_version: string | null; is_forked: number } | undefined
    if (!row) throw new Error('Repo not found')

    const token = getToken() ?? null
    const headers = githubHeaders(token)

    // For forked repos: compare upstream commits between stored and upstream HEAD
    // For learned repos (or fallback): return release notes or recent commits
    const result: {
      type: 'release' | 'commits'
      releaseNotes?: string
      commits?: { sha: string; message: string; author: string; date: string }[]
      upstreamVersion: string
    } = { type: 'commits', upstreamVersion: row.upstream_version ?? '' }

    if (row.is_forked && row.stored_version && row.upstream_version) {
      // GET /repos/{owner}/{name}/compare/{stored}...{upstream}
      const compareRes = await fetch(
        `https://api.github.com/repos/${row.owner}/${row.name}/compare/${row.stored_version}...${row.upstream_version}`,
        { headers }
      )
      if (compareRes.ok) {
        const data = await compareRes.json() as { commits?: { sha: string; commit: { message: string; author: { name: string; date: string } } }[] }
        result.type = 'commits'
        result.commits = (data.commits ?? []).slice(0, 30).map(c => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
          date: c.commit.author.date,
        }))
        return result
      }
    }

    // Try release notes
    const relRes = await fetch(`https://api.github.com/repos/${row.owner}/${row.name}/releases/latest`, { headers })
    if (relRes.ok) {
      const rel = await relRes.json() as { body?: string | null; tag_name: string }
      result.type = 'release'
      result.releaseNotes = rel.body ?? ''
      result.upstreamVersion = rel.tag_name
      return result
    }

    // Fall back to recent commits on default branch
    const commitsRes = await fetch(
      `https://api.github.com/repos/${row.owner}/${row.name}/commits?per_page=20`,
      { headers }
    )
    if (commitsRes.ok) {
      const commits = await commitsRes.json() as { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
      result.commits = commits.slice(0, 20).map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
      }))
    }
    return result
  })

  // Fork sync
  ipcMain.handle('update:apply-fork-sync', async (_event, repoId: string) => {
    return applyForkSync(repoId)
  })

  // Skill regeneration — all logic is in updateService.applySkillRegen
  ipcMain.handle('update:apply-skill-regen', async (_event, repoId: string) => {
    return applySkillRegen(repoId)
  })

  // Restart polling interval (called when updateCheckIntervalHours setting changes)
  ipcMain.handle('update:restart-service', async () => {
    restartUpdateService()
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/updateHandlers.ts
git commit -m "feat(update): IPC handlers for update detection and apply actions"
```

---

## Task 5: preload.ts — Expose updates API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add `updates` namespace to preload**

Inside the `contextBridge.exposeInMainWorld('api', { ... })` object, after the `skillSync` block (before the closing `}`), add:

```typescript
  updates: {
    checkNow:        ()                => ipcRenderer.invoke('update:check-now'),
    lastChecked:     ()                => ipcRenderer.invoke('update:last-checked') as Promise<{ timestamp: number | null }>,
    getChanges:      (id: string)      => ipcRenderer.invoke('update:get-changes', id),
    applyForkSync:   (id: string)      => ipcRenderer.invoke('update:apply-fork-sync', id) as Promise<{ ok: boolean; error?: string }>,
    applySkillRegen: (id: string)      => ipcRenderer.invoke('update:apply-skill-regen', id) as Promise<{ ok: boolean; error?: string }>,
    restartService:  ()                => ipcRenderer.invoke('update:restart-service'),
    onStatusChanged: (cb: (payload: { ids: string[] }) => void) => {
      const wrapped = ((_: unknown, payload: { ids: string[] }) => cb(payload)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapped)
      ipcRenderer.on('update:status-changed', wrapped)
    },
    offStatusChanged: (cb: (payload: { ids: string[] }) => void) => {
      const wrapped = callbackWrappers.get(cb)
      if (wrapped) {
        ipcRenderer.removeListener('update:status-changed', wrapped)
        callbackWrappers.delete(cb)
      }
    },
    onToast: (cb: (payload: { message: string }) => void) => {
      const wrapped = ((_: unknown, payload: { message: string }) => cb(payload)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapped)
      ipcRenderer.on('update:toast', wrapped)
    },
    offToast: (cb: (payload: { message: string }) => void) => {
      const wrapped = callbackWrappers.get(cb)
      if (wrapped) {
        ipcRenderer.removeListener('update:toast', wrapped)
        callbackWrappers.delete(cb)
      }
    },
  },
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(preload): expose window.api.updates namespace"
```

---

## Task 6: main.ts — Register Handlers + Wire saveRepo

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add imports at top of `electron/main.ts`**

After the existing `registerEngagementHandlers` import line (~line 39), add:

```typescript
import { registerUpdateHandlers } from './ipc/updateHandlers'
import { startUpdateService, checkIsFork } from './services/updateService'
```

- [ ] **Step 2: Register handlers**

After `registerVerificationHandlers()` and `registerDownloadHandlers()` lines (~line 1793), add:

```typescript
registerUpdateHandlers()
```

- [ ] **Step 3: Start service after `createWindow`**

In the `app.whenReady().then()` block, after the existing `startSkillSyncService(db, mainWindow)` line (~line 2252), add:

```typescript
    startUpdateService(db, mainWindow)
```

- [ ] **Step 4: Inject fork-check + stored_version in `github:saveRepo`**

The handler is at `electron/main.ts:732`. After the `enqueueRepo(...)` call, add:

```typescript
  // Set initial stored_version baseline and check if user has forked this repo
  setImmediate(async () => {
    const token = getToken() ?? null
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (token) headers.Authorization = `Bearer ${token}`
    // Determine initial stored_version
    let storedVersion: string | null = null
    try {
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${name}/releases/latest`, { headers })
      if (relRes.ok) {
        const rel = await relRes.json() as { tag_name: string }
        storedVersion = rel.tag_name
      } else {
        const dbRow = db.prepare('SELECT pushed_at FROM repos WHERE owner = ? AND name = ?').get(owner, name) as { pushed_at: string | null } | undefined
        storedVersion = dbRow?.pushed_at ?? null
      }
    } catch { /* network failure — leave stored_version null */ }
    // Check fork status
    const isFork = await checkIsFork(owner, name)
    db.prepare('UPDATE repos SET stored_version = ?, is_forked = ? WHERE owner = ? AND name = ?')
      .run(storedVersion, isFork ? 1 : 0, owner, name)
  })
```

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(update): register service + handlers, init stored_version + is_forked on save"
```

---

## Task 8: CSS Token + LibraryListRow

> **Dependency:** Task 7 (UpdateModal.tsx) must be committed before this task.

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/components/LibraryListRow.tsx`
- Modify: `src/components/LibraryListRow.css`

- [ ] **Step 1: Add CSS token to `globals.css`**

In the `:root { }` block, after the `--red-text` line, add:

```css
  /* Update notification */
  --color-update-available: #3b82f6;
```

- [ ] **Step 2: Update `src/components/LibraryListRow.tsx`**

Replace the entire file:

```tsx
import { useState } from 'react'
import { GitFork, ArrowUpCircle } from 'lucide-react'
import type { LibraryRow } from '../types/repo'
import UpdateModal from './UpdateModal'

export default function LibraryListRow({
  row, selected, onSelect,
}: {
  row: LibraryRow
  selected: boolean
  onSelect: () => void
}) {
  const [showUpdate, setShowUpdate] = useState(false)
  const hasUpdate = row.update_available === 1
  const isFork = row.is_forked === 1

  return (
    <>
      <div
        className={`library-row${selected ? ' selected' : ''}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      >
        <div className="library-row-info">
          <span className={`library-row-name${hasUpdate ? ' update-available' : ''}`}>{row.name}</span>
          <span className="library-row-owner">{row.owner}</span>
        </div>
        <div className="library-row-indicators">
          {isFork && <GitFork size={11} className="library-indicator-fork" aria-label="Forked repo" />}
          {hasUpdate && (
            <button
              className="library-update-btn"
              onClick={(e) => { e.stopPropagation(); setShowUpdate(true) }}
              aria-label="Update available"
            >
              <ArrowUpCircle size={13} />
            </button>
          )}
        </div>
      </div>
      {showUpdate && (
        <UpdateModal repoId={row.id} owner={row.owner} name={row.name} isFork={isFork} onClose={() => setShowUpdate(false)} />
      )}
    </>
  )
}
```

- [ ] **Step 3: Add update indicator styles to `LibraryListRow.css`**

Append to the file (create if it doesn't exist, check first):

```css
.library-row-indicators {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

.library-row-name.update-available {
  color: var(--color-update-available);
}

.library-indicator-fork {
  color: var(--t3);
  flex-shrink: 0;
}

.library-update-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--color-update-available);
  display: flex;
  align-items: center;
  opacity: 0.85;
  transition: opacity 0.15s;
}

.library-update-btn:hover {
  opacity: 1;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css src/components/LibraryListRow.tsx src/components/LibraryListRow.css
git commit -m "feat(library): update indicator and fork icon on list row"
```

---

## Task 9: LibraryCard

> **Dependency:** Task 7 (UpdateModal.tsx) must be committed before this task.

**Files:**
- Modify: `src/components/LibraryCard.tsx`
- Modify: `src/components/LibraryCard.css`

- [ ] **Step 1: Update `src/components/LibraryCard.tsx`**

Replace the entire file:

```tsx
import { useState } from 'react'
import { Boxes, GitFork, ArrowUpCircle } from 'lucide-react'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import type { LibraryRow } from '../types/repo'
import UpdateModal from './UpdateModal'

export interface LibraryCardProps {
  row: LibraryRow
  selected: boolean
  hasSubSkill: boolean
  onSelect: () => void
}

export default function LibraryCard({ row, selected, hasSubSkill, onSelect }: LibraryCardProps) {
  const { openProfile } = useProfileOverlay()
  const [showUpdate, setShowUpdate] = useState(false)
  const hasUpdate = row.update_available === 1
  const isFork = row.is_forked === 1

  return (
    <>
      <div
        className={`library-card${selected ? ' selected' : ''}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      >
        {(hasSubSkill || isFork) && (
          <span className="library-sub-skill-indicator" aria-label="Indicators">
            {hasSubSkill && <Boxes size={12} />}
            {isFork && <GitFork size={12} aria-label="Forked repo" />}
          </span>
        )}

        <div className="library-card-header">
          <div className="library-card-title-block">
            <span className={`library-card-name${hasUpdate ? ' update-available' : ''}`}>{row.name}</span>
            <button
              className="owner-name-btn library-card-owner"
              onClick={(e) => { e.stopPropagation(); openProfile(row.owner) }}
            >
              {row.owner}
            </button>
          </div>
          {hasUpdate && (
            <button
              className="library-update-btn"
              onClick={(e) => { e.stopPropagation(); setShowUpdate(true) }}
              aria-label="Update available"
            >
              <ArrowUpCircle size={14} />
            </button>
          )}
        </div>

        {row.description && (
          <p className="library-card-description">{row.description}</p>
        )}
      </div>
      {showUpdate && (
        <UpdateModal repoId={row.id} owner={row.owner} name={row.name} isFork={isFork} onClose={() => setShowUpdate(false)} />
      )}
    </>
  )
}
```

- [ ] **Step 2: Add styles to `LibraryCard.css`**

Append to the file:

```css
.library-card-name.update-available {
  color: var(--color-update-available);
}

.library-card .library-update-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--color-update-available);
  display: flex;
  align-items: center;
  opacity: 0.85;
  transition: opacity 0.15s;
  margin-left: auto;
}

.library-card .library-update-btn:hover {
  opacity: 1;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/LibraryCard.tsx src/components/LibraryCard.css
git commit -m "feat(library): update indicator and fork icon on card"
```

---

## Task 7: UpdateModal Component

> **Execution order note:** Despite appearing after Tasks 8 and 9 in this document, execute Task 7 first — both `LibraryListRow.tsx` (Task 8) and `LibraryCard.tsx` (Task 9) import `./UpdateModal`.

**Files:**
- Create: `src/components/UpdateModal.css`
- Create: `src/components/UpdateModal.tsx`

- [ ] **Step 1: Create `src/components/UpdateModal.css`**

```css
.update-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.update-modal {
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: var(--radius-lg);
  width: 520px;
  max-width: 90vw;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.update-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.update-modal-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  margin: 0;
}

.update-modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--t3);
  padding: 4px;
  border-radius: var(--radius-sm);
  line-height: 1;
  font-size: 18px;
}

.update-modal-close:hover {
  color: var(--t1);
  background: var(--bg3);
}

.update-modal-body {
  overflow-y: auto;
  padding: 16px 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.update-modal-loading {
  text-align: center;
  color: var(--t3);
  font-size: var(--text-sm);
  padding: 32px 0;
}

.update-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--t2);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.update-commits-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.update-commit {
  display: flex;
  gap: 8px;
  font-size: var(--text-sm);
}

.update-commit-sha {
  color: var(--t4);
  font-family: monospace;
  flex-shrink: 0;
}

.update-commit-message {
  color: var(--t2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-release-notes {
  font-size: var(--text-sm);
  color: var(--t2);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg3);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.update-error {
  color: var(--red-text);
  font-size: var(--text-sm);
  background: var(--red-soft);
  border: 1px solid var(--red-border);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
}

.update-action-row {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  gap: 8px;
}

.update-btn-cancel {
  background: none;
  border: 1px solid var(--border2);
  color: var(--t2);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
}

.update-btn-cancel:hover {
  background: var(--bg3);
}

.update-btn-apply {
  background: var(--accent);
  border: none;
  color: #fff;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 500;
}

.update-btn-apply:hover {
  background: var(--accent-light);
}

.update-btn-apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create `src/components/UpdateModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import './UpdateModal.css'

type CommitSummary = { sha: string; message: string; author: string; date: string }
type Changes = {
  type: 'release' | 'commits'
  releaseNotes?: string
  commits?: CommitSummary[]
  upstreamVersion: string
}

export default function UpdateModal({
  repoId, owner, name, isFork, onClose,
}: {
  repoId: string
  owner: string
  name: string
  isFork: boolean
  onClose: () => void
}) {
  const [changes, setChanges] = useState<Changes | null>(null)
  const [loading, setLoading] = useState(true)
  const [forkApplying, setForkApplying] = useState(false)
  const [regenApplying, setRegenApplying] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const [regenError, setRegenError] = useState<string | null>(null)

  const isLearned = true // all LibraryRows have installed skills

  useEffect(() => {
    window.api.updates.getChanges(repoId)
      .then((c) => { setChanges(c as Changes); setLoading(false) })
      .catch(() => setLoading(false))
  }, [repoId])

  const handleForkSync = async () => {
    setForkApplying(true)
    setForkError(null)
    const result = await window.api.updates.applyForkSync(repoId)
    setForkApplying(false)
    if (result.ok) onClose()
    else setForkError(result.error ?? 'Sync failed')
  }

  const handleSkillRegen = async () => {
    setRegenApplying(true)
    setRegenError(null)
    const result = await window.api.updates.applySkillRegen(repoId)
    setRegenApplying(false)
    if (result.ok) onClose()
    else setRegenError(result.error ?? 'Regeneration failed')
  }

  return (
    <div className="update-modal-overlay" onClick={onClose}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-header">
          <h2 className="update-modal-title">Update available — {owner}/{name}</h2>
          <button className="update-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="update-modal-body">
          {loading && <p className="update-modal-loading">Fetching changes…</p>}

          {!loading && changes && (
            <>
              {changes.type === 'release' && changes.releaseNotes != null && (
                <div>
                  <p className="update-section-title">Release notes — {changes.upstreamVersion}</p>
                  <pre className="update-release-notes">{changes.releaseNotes || 'No release notes provided.'}</pre>
                </div>
              )}

              {(changes.type === 'commits' || changes.commits) && (changes.commits?.length ?? 0) > 0 && (
                <div>
                  <p className="update-section-title">Recent commits</p>
                  <ul className="update-commits-list">
                    {changes.commits!.map((c) => (
                      <li key={c.sha} className="update-commit">
                        <span className="update-commit-sha">{c.sha}</span>
                        <span className="update-commit-message">{c.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isFork && (
                <div>
                  <p className="update-section-title">Fork sync</p>
                  {forkError && <p className="update-error">{forkError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      className="update-btn-apply"
                      onClick={handleForkSync}
                      disabled={forkApplying}
                    >
                      {forkApplying ? 'Syncing…' : 'Sync Fork'}
                    </button>
                  </div>
                </div>
              )}

              {isLearned && (
                <div>
                  <p className="update-section-title">Skill update</p>
                  {regenError && <p className="update-error">{regenError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      className="update-btn-apply"
                      onClick={handleSkillRegen}
                      disabled={regenApplying}
                    >
                      {regenApplying ? 'Regenerating…' : 'Regenerate Skills'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="update-action-row">
          <button className="update-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateModal.tsx src/components/UpdateModal.css
git commit -m "feat(update): UpdateModal component for diff review and confirm"
```

---

## Task 10: Library.tsx — IPC Subscription

**Files:**
- Modify: `src/views/Library.tsx`

- [ ] **Step 1: Add `update:status-changed` subscription and auto-update toast**

Add a `useEffect` in `Library.tsx` after the existing `library:changed` event listener effect (~line 57). The subscription re-fetches updated rows and shows a toast for auto-updated repos.

After the last `useEffect` block (before `const repoSelectedId`), add:

```typescript
  useEffect(() => {
    const onStatusChanged = ({ ids }: { ids: string[] }) => {
      if (!ids.length) return
      // Re-fetch the library to pick up updated update_available / is_forked flags
      refreshAll()
    }
    const onToast = ({ message }: { message: string }) => {
      toast(message, 'success')
    }
    window.api.updates.onStatusChanged(onStatusChanged)
    window.api.updates.onToast(onToast)
    return () => {
      window.api.updates.offStatusChanged(onStatusChanged)
      window.api.updates.offToast(onToast)
    }
  }, [refreshAll, toast])
```

- [ ] **Step 2: Commit**

```bash
git add src/views/Library.tsx
git commit -m "feat(library): subscribe to update:status-changed for live indicators"
```

---

## Task 11: Settings.tsx — Updates Section

**Files:**
- Modify: `src/views/Settings.tsx`

- [ ] **Step 1: Add `'updates'` to `CategoryId` type and `CATEGORIES` array**

Change the `CategoryId` type definition (line 8):

```typescript
type CategoryId = 'claude-desktop' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

Add an `UpdatesIcon` SVG component (add after `ConnectorsIcon`, before `CATEGORIES`):

```typescript
const UpdatesIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v6 M5 6l3-3 3 3" />
    <path d="M3.5 10a5.5 5.5 0 1 0 9.5-3.8" />
  </svg>
)
```

Add to the `CATEGORIES` array (after the `connectors` entry):

```typescript
  { id: 'updates', label: 'Updates', icon: <UpdatesIcon /> },
```

- [ ] **Step 2: Add state for the Updates section**

After the `syncConfirmOpen` state line (~line 115), add:

```typescript
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [checkIntervalHours, setCheckIntervalHours] = useState(24)
  const [lastCheckedTs, setLastCheckedTs] = useState<number | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
```

Add a `useEffect` to load these settings (after the existing `window.api.skillSync.getStatus` useEffect):

```typescript
  useEffect(() => {
    window.api.settings.get('autoUpdateEnabled').then(val => {
      setAutoUpdateEnabled(val === 'true')
    }).catch(() => {})
    window.api.settings.get('updateCheckIntervalHours').then(val => {
      if (val) setCheckIntervalHours(parseInt(val, 10) || 24)
    }).catch(() => {})
    window.api.updates.lastChecked().then(({ timestamp }) => {
      setLastCheckedTs(timestamp)
    }).catch(() => {})
  }, [])
```

- [ ] **Step 3: Add handlers for the Updates section**

After the `handleSyncRetry` function, add:

```typescript
  const handleAutoUpdateToggle = useCallback(async (enabled: boolean) => {
    setAutoUpdateEnabled(enabled)
    await window.api.settings.set('autoUpdateEnabled', enabled ? 'true' : 'false')
  }, [])

  const handleIntervalChange = useCallback(async (hours: number) => {
    const clamped = Math.min(168, Math.max(1, hours))
    setCheckIntervalHours(clamped)
    await window.api.settings.set('updateCheckIntervalHours', String(clamped))
    await window.api.updates.restartService()
  }, [])

  const handleCheckNow = useCallback(async () => {
    setUpdateChecking(true)
    await window.api.updates.checkNow()
    const { timestamp } = await window.api.updates.lastChecked()
    setLastCheckedTs(timestamp)
    setUpdateChecking(false)
  }, [])
```

- [ ] **Step 4: Add the Updates section render block**

In the JSX where each `activeCategory` renders its panel, add a case for `'updates'` after the `connectors` block. Find the pattern where `activeCategory === 'connectors'` renders its JSX, and add after it:

```tsx
              {activeCategory === 'updates' && (
                <div className="settings-section">
                  <h3 className="settings-section-title">Updates</h3>

                  <div className="settings-row">
                    <label className="settings-label">Auto-update</label>
                    <div className="settings-control">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={autoUpdateEnabled}
                          onChange={e => handleAutoUpdateToggle(e.target.checked)}
                        />
                        <span className="settings-toggle-track" />
                      </label>
                      {autoUpdateEnabled && (
                        <p className="settings-hint settings-hint-warn">
                          Auto-update for learned repos consumes Claude API credits automatically.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="settings-row">
                    <label className="settings-label">Check every (hours)</label>
                    <div className="settings-control">
                      <input
                        type="number"
                        className="settings-input-number"
                        min={1}
                        max={168}
                        value={checkIntervalHours}
                        onChange={e => handleIntervalChange(parseInt(e.target.value, 10) || 24)}
                      />
                    </div>
                  </div>

                  <div className="settings-row">
                    <label className="settings-label">Last checked</label>
                    <div className="settings-control">
                      <span className="settings-value">
                        {lastCheckedTs
                          ? (() => {
                              const diff = Math.floor((Date.now() / 1000 - lastCheckedTs) / 60)
                              if (diff < 1) return 'Just now'
                              if (diff < 60) return `${diff} minute${diff !== 1 ? 's' : ''} ago`
                              const h = Math.floor(diff / 60)
                              return `${h} hour${h !== 1 ? 's' : ''} ago`
                            })()
                          : 'Never'}
                      </span>
                    </div>
                  </div>

                  <div className="settings-row">
                    <label className="settings-label" />
                    <div className="settings-control">
                      <button
                        className="settings-btn"
                        onClick={handleCheckNow}
                        disabled={updateChecking}
                      >
                        {updateChecking ? 'Checking…' : 'Check now'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
```

- [ ] **Step 5: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(settings): Updates section with auto-update toggle and interval control"
```

---

## Verification

After all tasks are complete, run:

```bash
npx vitest run electron/db.phase23-migration.test.ts electron/updateService.test.ts
```
Expected: All tests pass.

Then build and launch the app to verify:
1. A repo in the Library shows a blue name after its `update_available` flag is set to 1 manually via SQLite
2. Forked repos show the `GitFork` icon
3. Clicking the `ArrowUpCircle` opens the `UpdateModal` with loading state
4. Settings → Updates section shows the toggle, interval, and "Check now" button
