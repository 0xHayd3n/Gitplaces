# Skill GitHub Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically back up user-generated skill files to a private `gitsuite-skills` GitHub repo after each generation, with an explicit opt-in setup flow in Settings.

**Architecture:** A new `SkillSyncService` (following the `verificationService` pattern) receives a `BrowserWindow` + DB ref at startup and exposes `push()`, `pushAll()`, and `setupRepo()`. After each successful skill write, the existing `skill:generate` IPC handler calls `push()` fire-and-forget. The GitHub Contents API with SHA caching handles the one-way push; failures emit `skillSync:syncFailed` to the renderer as a toast.

**Tech Stack:** Electron IPC, GitHub Contents API (fetch), better-sqlite3, electron-store, React useState/useCallback, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-28-skill-github-sync-design.md`

---

### Task 1: DB migration — add sync columns to `skills` and `sub_skills`

**Files:**
- Modify: `electron/db.ts` (after the last existing migration block, around line 197)

- [ ] **Step 1: Add the six ALTER TABLE migrations**

At the end of the existing migration block in `electron/db.ts` (after all current `try { db.exec(...) } catch {}` lines, around line 197), add:

```ts
// Skill GitHub sync columns
try { db.exec(`ALTER TABLE skills ADD COLUMN github_sha TEXT`) } catch {}
try { db.exec(`ALTER TABLE skills ADD COLUMN synced_at INTEGER`) } catch {}
try { db.exec(`ALTER TABLE skills ADD COLUMN sync_status TEXT`) } catch {}
try { db.exec(`ALTER TABLE sub_skills ADD COLUMN github_sha TEXT`) } catch {}
try { db.exec(`ALTER TABLE sub_skills ADD COLUMN synced_at INTEGER`) } catch {}
try { db.exec(`ALTER TABLE sub_skills ADD COLUMN sync_status TEXT`) } catch {}
```

- [ ] **Step 2: Start the app and verify no crash**

Run: `npm run dev`
Expected: app starts without error; open DevTools console and confirm no SQLite errors.

- [ ] **Step 3: Commit**

```bash
git add electron/db.ts
git commit -m "feat(db): add github_sha, synced_at, sync_status columns to skills + sub_skills"
```

---

### Task 2: `skillSyncStore` — new electron-store instance

**Files:**
- Modify: `electron/store.ts` (currently 53 lines; append at end)

The existing pattern (see `electron/store.ts:3-38` for `githubStore`, lines `40-53` for `apiStore`): define an interface, create a `new Store<T>()`, export named helper functions.

- [ ] **Step 1: Append `skillSyncStore` to `electron/store.ts`**

```ts
interface SkillSyncStoreSchema {
  'skillSync.enabled': boolean
  'skillSync.repoOwner': string
}

const skillSyncStore = new Store<SkillSyncStoreSchema>()

export function getSyncEnabled(): boolean {
  return skillSyncStore.get('skillSync.enabled', false)
}
export function setSyncEnabled(v: boolean): void {
  skillSyncStore.set('skillSync.enabled', v)
}
export function getSyncRepoOwner(): string | undefined {
  return skillSyncStore.get('skillSync.repoOwner') as string | undefined
}
export function setSyncRepoOwner(v: string): void {
  skillSyncStore.set('skillSync.repoOwner', v)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `electron/store.ts`.

- [ ] **Step 3: Commit**

```bash
git add electron/store.ts
git commit -m "feat(store): add skillSyncStore with getSyncEnabled/setSyncEnabled/getSyncRepoOwner/setSyncRepoOwner"
```

---

### Task 3: GitHub API helpers — `createRepo` and `putFileContents`

**Files:**
- Modify: `electron/github.ts` (append after the last existing exported function, around line 480+)
- Create: `electron/services/githubHelpers.test.ts`

The existing API call pattern (see `electron/github.ts:6-10` for `githubHeaders`, lines `436-453` for `getFileContent`): `fetch()` with `githubHeaders(token)`, check `res.ok`, throw on failure, return parsed JSON. **Do NOT `encodeURIComponent` the path** — this encodes `/` as `%2F` which causes a GitHub Contents API 404. Pass path directly.

- [ ] **Step 1: Write the failing tests**

Create `electron/services/githubHelpers.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRepo, putFileContents } from '../github'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('createRepo', () => {
  it('POSTs to /user/repos and returns html_url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/user/gitsuite-skills' })
    })
    const result = await createRepo('tok', 'gitsuite-skills')
    expect(result.html_url).toBe('https://github.com/user/gitsuite-skills')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user/repos',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422 })
    await expect(createRepo('tok', 'gitsuite-skills')).rejects.toThrow('422')
  })
})

describe('putFileContents', () => {
  it('PUTs base64-encoded content and returns sha', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { sha: 'abc123' } })
    })
    const result = await putFileContents('tok', 'user', 'gitsuite-skills', 'ms/vscode.skill.md', 'hello', 'update')
    expect(result.content.sha).toBe('abc123')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.content).toBe(Buffer.from('hello').toString('base64'))
    expect(body.sha).toBeUndefined()
    // Path must NOT be percent-encoded — slash must remain a slash
    expect(mockFetch.mock.calls[0][0]).toContain('ms/vscode.skill.md')
    expect(mockFetch.mock.calls[0][0]).not.toContain('%2F')
  })

  it('includes sha in body when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'def456' } }) })
    await putFileContents('tok', 'user', 'repo', 'path', 'content', 'msg', 'oldshavalue')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.sha).toBe('oldshavalue')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 })
    await expect(putFileContents('tok', 'u', 'r', 'p', 'c', 'm')).rejects.toThrow('409')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run electron/services/githubHelpers.test.ts`
Expected: FAIL — `createRepo` and `putFileContents` are not yet exported from `electron/github.ts`.

- [ ] **Step 3: Add `createRepo` and `putFileContents` to `electron/github.ts`**

Append after the last existing exported function. Note the URL uses `${path}` directly — no `encodeURIComponent`:

```ts
export async function createRepo(
  token: string,
  name: string
): Promise<{ html_url: string }> {
  const res = await fetch(`${BASE}/user/repos`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ name, private: true, auto_init: true })
  })
  if (!res.ok) throw new Error(`createRepo failed: ${res.status}`)
  return res.json()
}

export async function putFileContents(
  token: string,
  repoOwner: string,
  repoName: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<{ content: { sha: string } }> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64')
  }
  if (sha) body.sha = sha
  // Do NOT encodeURIComponent(path) — that encodes '/' as '%2F' causing a 404
  const res = await fetch(`${BASE}/repos/${repoOwner}/${repoName}/contents/${path}`, {
    method: 'PUT',
    headers: githubHeaders(token),
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`putFileContents failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run electron/services/githubHelpers.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/github.ts electron/services/githubHelpers.test.ts
git commit -m "feat(github): add createRepo and putFileContents API helpers"
```

---

### Task 4: `SkillSyncService` — push, pushAll, setupRepo

**Files:**
- Create: `electron/services/skillSyncService.ts`
- Create: `electron/services/skillSyncService.test.ts`

Pattern reference: `electron/services/verificationService.ts:298` — `startVerificationService(db, win)` stores `db` and `win` as module-level variables. `webContents.send` at line 262.

Note: `repos.id` is `TEXT PRIMARY KEY` in the DB schema, so `repoId` throughout this service is `string`, not `number`.

- [ ] **Step 1: Write failing tests**

Create `electron/services/skillSyncService.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Database } from 'better-sqlite3'

vi.mock('../github', () => ({
  createRepo: vi.fn(),
  putFileContents: vi.fn(),
  getRepo: vi.fn()
}))

vi.mock('../store', () => ({
  getSyncEnabled: vi.fn(),
  getSyncRepoOwner: vi.fn(),
  setSyncEnabled: vi.fn(),
  setSyncRepoOwner: vi.fn(),
  getToken: vi.fn()
}))

import { createRepo, putFileContents, getRepo } from '../github'
import { getSyncEnabled, getSyncRepoOwner, getToken } from '../store'
import { startSkillSyncService, push, setupRepo } from './skillSyncService'

function makeDb(rows: Record<string, unknown> = {}) {
  const stmt = { get: vi.fn(() => rows), run: vi.fn(), all: vi.fn(() => []) }
  return { prepare: vi.fn(() => stmt) } as unknown as Database
}

function makeWin() {
  return { webContents: { send: vi.fn() } } as unknown as BrowserWindow
}

describe('push', () => {
  beforeEach(() => {
    vi.mocked(getSyncEnabled).mockReturnValue(true)
    vi.mocked(getSyncRepoOwner).mockReturnValue('alice')
    vi.mocked(getToken).mockReturnValue('tok')
  })

  it('bails if sync disabled', async () => {
    vi.mocked(getSyncEnabled).mockReturnValue(false)
    startSkillSyncService(makeDb(), makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('calls putFileContents with correct path and no sha on first push', async () => {
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha1' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills', 'ms/vscode.skill.md', 'content',
      expect.any(String), undefined
    )
  })

  it('passes cached sha on subsequent push', async () => {
    const db = makeDb({ github_sha: 'cached' })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'newsha' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills', 'ms/vscode.skill.md', 'content',
      expect.any(String), 'cached'
    )
  })

  it('marks sync_status failed and sends IPC event on error', async () => {
    const win = makeWin()
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockRejectedValue(new Error('network error'))
    startSkillSyncService(db, win)
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(win.webContents.send).toHaveBeenCalledWith(
      'skillSync:syncFailed',
      expect.objectContaining({ filename: 'vscode.skill.md' })
    )
  })

  it('uses sub_skills table when skillType is provided', async () => {
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha1' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.components.skill.md', 'content', 'components')
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls as string[][]
    expect(prepareCalls.some(args => args[0].includes('sub_skills'))).toBe(true)
  })
})

describe('setupRepo', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue('tok')
  })

  it('returns repoUrl when repo already exists', async () => {
    vi.mocked(getRepo).mockResolvedValue({ html_url: 'https://github.com/alice/gitsuite-skills' })
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.repoUrl).toContain('gitsuite-skills')
    expect(createRepo).not.toHaveBeenCalled()
  })

  it('creates repo when getRepo throws (404)', async () => {
    vi.mocked(getRepo).mockRejectedValue(new Error('404'))
    vi.mocked(createRepo).mockResolvedValue({ html_url: 'https://github.com/alice/gitsuite-skills' })
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(true)
    expect(createRepo).toHaveBeenCalledWith('tok', 'gitsuite-skills')
  })

  it('returns ok:false on createRepo failure', async () => {
    vi.mocked(getRepo).mockRejectedValue(new Error('404'))
    vi.mocked(createRepo).mockRejectedValue(new Error('API error'))
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run electron/services/skillSyncService.test.ts`
Expected: FAIL — `skillSyncService.ts` does not exist yet.

- [ ] **Step 3: Create `electron/services/skillSyncService.ts`**

```ts
import { BrowserWindow } from 'electron'
import type { Database } from 'better-sqlite3'
import { getToken, getSyncEnabled, getSyncRepoOwner, setSyncEnabled, setSyncRepoOwner } from '../store'
import { createRepo, putFileContents, getRepo } from '../github'

export const SKILLS_BACKUP_REPO = 'gitsuite-skills'

let _win: BrowserWindow | null = null
let _db: Database | null = null

export function startSkillSyncService(db: Database, win: BrowserWindow): void {
  _db = db
  _win = win
}

// repoId is TEXT (repos.id is TEXT PRIMARY KEY)
export async function push(
  repoId: string,
  owner: string,
  filename: string,
  content: string,
  skillType?: string
): Promise<void> {
  if (!getSyncEnabled()) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  const githubPath = `${owner}/${filename}`

  let currentSha: string | undefined
  if (skillType) {
    const row = _db!.prepare(
      'SELECT github_sha FROM sub_skills WHERE repo_id = ? AND skill_type = ?'
    ).get(repoId, skillType) as { github_sha: string | null } | undefined
    currentSha = row?.github_sha ?? undefined
  } else {
    const row = _db!.prepare(
      'SELECT github_sha FROM skills WHERE repo_id = ?'
    ).get(repoId) as { github_sha: string | null } | undefined
    currentSha = row?.github_sha ?? undefined
  }

  try {
    const result = await putFileContents(
      token, repoOwner, SKILLS_BACKUP_REPO, githubPath, content,
      `sync ${filename}`, currentSha
    )
    const newSha = result.content.sha
    if (skillType) {
      _db!.prepare(
        'UPDATE sub_skills SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ? AND skill_type = ?'
      ).run(newSha, Date.now(), 'synced', repoId, skillType)
    } else {
      _db!.prepare(
        'UPDATE skills SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ?'
      ).run(newSha, Date.now(), 'synced', repoId)
    }
  } catch {
    if (skillType) {
      _db!.prepare(
        'UPDATE sub_skills SET sync_status = ? WHERE repo_id = ? AND skill_type = ?'
      ).run('failed', repoId, skillType)
    } else {
      _db!.prepare(
        'UPDATE skills SET sync_status = ? WHERE repo_id = ?'
      ).run('failed', repoId)
    }
    _win?.webContents.send('skillSync:syncFailed', { owner, filename })
  }
}

export async function pushAll(statusFilter?: 'pending' | 'failed' | 'all'): Promise<void> {
  if (!getSyncEnabled()) return

  const buildWhere = (filter?: 'pending' | 'failed' | 'all') => {
    if (filter === 'all') return '1=1'
    if (filter === 'failed') return "sync_status = 'failed'"
    return "(sync_status = 'pending' OR sync_status IS NULL OR sync_status = 'failed')"
  }
  const where = buildWhere(statusFilter)

  type SkillRow = { repo_id: string; owner: string; filename: string; content: string }
  const primarySkills = _db!.prepare(
    `SELECT s.repo_id, r.owner, s.filename, s.content
     FROM skills s JOIN repos r ON r.id = s.repo_id
     WHERE ${where} AND s.active = 1`
  ).all() as SkillRow[]

  type SubSkillRow = { repo_id: string; owner: string; filename: string; skill_type: string; content: string }
  const subSkills = _db!.prepare(
    `SELECT ss.repo_id, r.owner, ss.filename, ss.skill_type, ss.content
     FROM sub_skills ss JOIN repos r ON r.id = ss.repo_id
     WHERE ${where} AND ss.active = 1`
  ).all() as SubSkillRow[]

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  for (const s of primarySkills) {
    await push(s.repo_id, s.owner, s.filename, s.content)
    await delay(250)
  }

  for (const s of subSkills) {
    // Pass the raw skill_type value including any 'version:' prefix
    await push(s.repo_id, s.owner, s.filename, s.content, s.skill_type)
    await delay(250)
  }

  const failed = _db!.prepare(
    "SELECT COUNT(*) as n FROM skills WHERE sync_status = 'failed'"
  ).get() as { n: number }
  const failedSub = _db!.prepare(
    "SELECT COUNT(*) as n FROM sub_skills WHERE sync_status = 'failed'"
  ).get() as { n: number }
  const failCount = failed.n + failedSub.n

  if (failCount > 0) {
    _win?.webContents.send('skillSync:syncFailed', { summary: true, failCount })
  }
}

export async function setupRepo(
  username: string
): Promise<{ ok: true; repoUrl: string } | { ok: false; error: string }> {
  const token = getToken()
  if (!token) return { ok: false, error: 'Not authenticated' }

  let repoUrl: string
  try {
    // getRepo throws on 404 — use catch to distinguish exists vs. needs creating
    const existing = await getRepo(token ?? null, username, SKILLS_BACKUP_REPO) as { html_url: string }
    repoUrl = existing.html_url
  } catch {
    try {
      const created = await createRepo(token, SKILLS_BACKUP_REPO)
      repoUrl = created.html_url
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  setSyncEnabled(true)
  setSyncRepoOwner(username)

  // Mark all unsynced skills as 'pending' so interrupted pushAll is resumable
  _db!.prepare(
    "UPDATE skills SET sync_status = 'pending' WHERE sync_status IS NULL"
  ).run()
  _db!.prepare(
    "UPDATE sub_skills SET sync_status = 'pending' WHERE sync_status IS NULL"
  ).run()

  // Fire-and-forget initial bulk sync
  void pushAll('all')

  return { ok: true, repoUrl }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run electron/services/skillSyncService.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/skillSyncService.ts electron/services/skillSyncService.test.ts
git commit -m "feat(skillSync): add SkillSyncService with push, pushAll, setupRepo"
```

---

### Task 5: Wire `SkillSyncService` into `electron/main.ts`

**Files:**
- Modify: `electron/main.ts`

Reference: verification service is instantiated at line 2204 via `startVerificationService(db, mainWindow)`. The `skill:generate` handler starts at line 986.

- [ ] **Step 1: Add the service import**

At the top of `electron/main.ts`, alongside the other service imports, add:

```ts
import { startSkillSyncService, push as skillSyncPush, pushAll as skillSyncPushAll, setupRepo as skillSyncSetupRepo } from './services/skillSyncService'
```

Also update the existing store import line (line 9 or wherever the store import is) to add the four new helpers:

```ts
// Find the existing line that imports from './store' and add:
// getSyncEnabled, setSyncEnabled, getSyncRepoOwner, setSyncRepoOwner, getGitHubUser
// Example — merge with whatever is already imported:
import { getToken, setToken, clearToken, setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner, setSyncRepoOwner } from './store'
```

- [ ] **Step 2: Instantiate the service at app startup**

Near line 2204, alongside `startVerificationService(db, mainWindow)`, add:

```ts
startSkillSyncService(db, mainWindow)
```

- [ ] **Step 3: Hook `push()` into the `skill:generate` handler**

Read the full `skill:generate` handler (starting at line 986) to identify the variable names for `repoId` (string — from the DB query), `owner`, the final `filename`, and the final `content` string. Add this immediately before the handler's `return` statement:

```ts
// fire-and-forget; failure surfaces as toast, never blocks generation
void skillSyncPush(repoId, owner, skillFilename, skillContent)
```

Replace `repoId`, `skillFilename`, `skillContent` with the actual variable names in the handler. `repoId` comes from the repos DB query inside the handler and is a `string`.

Also search for any other IPC handlers that write sub-skills (search for `sub_skill`, `components`, `skill_type`). For each one that writes a sub-skill to disk/DB, add a corresponding:

```ts
void skillSyncPush(repoId, owner, filename, content, skillType)
```

where `skillType` is the raw `skill_type` value including any `version:` prefix.

- [ ] **Step 4: Add the four `skillSync` IPC handlers**

Add alongside the other `ipcMain.handle` blocks. Note: `getGitHubUser` is exported from `electron/store.ts:23` — it returns `{ username: string; avatarUrl: string } | undefined`:

```ts
ipcMain.handle('skillSync:setup', async () => {
  const user = getGitHubUser()
  if (!user?.username) return { ok: false, error: 'Not authenticated' }
  return skillSyncSetupRepo(user.username)
})

ipcMain.handle('skillSync:disconnect', async () => {
  setSyncEnabled(false)
  return { ok: true }
})

ipcMain.handle('skillSync:retryFailed', async () => {
  void skillSyncPushAll('failed')
  return { ok: true }
})

ipcMain.handle('skillSync:getStatus', async () => {
  const db = getDb()
  const failedCount =
    (db.prepare("SELECT COUNT(*) as n FROM skills WHERE sync_status = 'failed'").get() as { n: number }).n +
    (db.prepare("SELECT COUNT(*) as n FROM sub_skills WHERE sync_status = 'failed'").get() as { n: number }).n
  const lastSynced = (db.prepare(
    "SELECT MAX(synced_at) as t FROM skills WHERE synced_at IS NOT NULL"
  ).get() as { t: number | null }).t
  return {
    enabled: getSyncEnabled(),
    repoOwner: getSyncRepoOwner(),
    failedCount,
    lastSynced
  }
})
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(main): wire SkillSyncService into skill:generate and add skillSync IPC handlers"
```

---

### Task 6: `electron/preload.ts` — expose `skillSync` API to renderer

**Files:**
- Modify: `electron/preload.ts`

The `callbackWrappers` Map is at line 3. The `onUpdated`/`offUpdated` pattern is at lines 222-233. Follow it exactly.

- [ ] **Step 1: Add `skillSync` to the exposed API**

Inside the `contextBridge.exposeInMainWorld('api', { ... })` block, add a `skillSync` object alongside the existing keys:

```ts
skillSync: {
  setup: () => ipcRenderer.invoke('skillSync:setup'),
  disconnect: () => ipcRenderer.invoke('skillSync:disconnect'),
  retryFailed: () => ipcRenderer.invoke('skillSync:retryFailed'),
  getStatus: () => ipcRenderer.invoke('skillSync:getStatus'),
  onSyncFailed: (cb: (payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0])
    ipcRenderer.on('skillSync:syncFailed', wrapped)
    callbackWrappers.set(cb, wrapped)
  },
  offSyncFailed: (cb: (...args: unknown[]) => void) => {
    const wrapped = callbackWrappers.get(cb)
    if (wrapped) {
      ipcRenderer.removeListener('skillSync:syncFailed', wrapped)
      callbackWrappers.delete(cb)
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(preload): expose skillSync IPC methods and syncFailed push-event listeners"
```

---

### Task 7: `src/env.d.ts` — add `skillSync` typings

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: Add the `skillSync` type to `window.api`**

Find the existing `api` interface declaration in `src/env.d.ts` and add:

```ts
skillSync: {
  setup(): Promise<{ ok: true; repoUrl: string } | { ok: false; error: string }>
  disconnect(): Promise<{ ok: true }>
  retryFailed(): Promise<{ ok: true }>
  getStatus(): Promise<{
    enabled: boolean
    repoOwner: string | undefined
    failedCount: number
    lastSynced: number | null
  }>
  onSyncFailed(cb: (payload: {
    owner?: string
    filename?: string
    summary?: boolean
    failCount?: number
  }) => void): void
  offSyncFailed(cb: (...args: unknown[]) => void): void
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/env.d.ts
git commit -m "feat(types): add skillSync typings to window.api"
```

---

### Task 8: Settings UI — "Skills Backup" card

**Files:**
- Modify: `src/views/Settings.tsx`

The existing GitHub connector card pattern is at lines 407-449 (`.connector-row` with icon, info, and actions divs). The state management pattern uses `useState`, `useCallback`, and `useEffect`. Before reading the existing toast pattern, search for `setToast` or a notification context in `Settings.tsx` to understand how to surface failure messages.

- [ ] **Step 1: Add state and handlers**

Inside the `Settings()` function (after existing state declarations, around line 84-120), add:

```tsx
const [syncStatus, setSyncStatus] = useState<{
  enabled: boolean
  repoOwner: string | undefined
  failedCount: number
  lastSynced: number | null
} | null>(null)
const [syncConnecting, setSyncConnecting] = useState(false)
const [syncError, setSyncError] = useState<string | null>(null)
const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)
const [syncRepoExists, setSyncRepoExists] = useState(false)

useEffect(() => {
  window.api.skillSync.getStatus().then(setSyncStatus)
}, [])

const handleSyncConnectClick = useCallback(() => {
  // Show confirmation dialog before calling setup
  setSyncConfirmOpen(true)
}, [])

const handleSyncConfirm = useCallback(async () => {
  setSyncConfirmOpen(false)
  setSyncConnecting(true)
  setSyncError(null)
  const result = await window.api.skillSync.setup()
  setSyncConnecting(false)
  if (result.ok) {
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  } else {
    setSyncError(result.error)
  }
}, [])

const handleSyncDisconnect = useCallback(async () => {
  await window.api.skillSync.disconnect()
  const status = await window.api.skillSync.getStatus()
  setSyncStatus(status)
}, [])

const handleSyncRetry = useCallback(async () => {
  await window.api.skillSync.retryFailed()
}, [])
```

- [ ] **Step 2: Subscribe to `syncFailed` push events**

Find the existing toast/notification mechanism in `Settings.tsx` — search for `setToast`, `addNotification`, or similar. Subscribe to `skillSync:syncFailed` in a `useEffect` and surface the message through whatever mechanism the app uses. If notifications live in a global context, import and use that context here:

```tsx
useEffect(() => {
  const onFailed = (payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => {
    window.api.skillSync.getStatus().then(setSyncStatus)
    // Use the app's existing notification/toast mechanism here:
    // e.g. addNotification(`Skill sync failed: ${payload.filename ?? `${payload.failCount} skills`}`)
    // Find the correct call by searching for other toast usages in Settings.tsx
  }
  window.api.skillSync.onSyncFailed(onFailed)
  return () => window.api.skillSync.offSyncFailed(onFailed)
}, [])
```

- [ ] **Step 3: Add the confirmation dialog**

Before the connector card JSX, add a small confirmation modal. Use the existing dialog/modal pattern in the codebase — search for `<dialog`, `Modal`, or `confirm` in `src/` to find the existing component. Wire it to `syncConfirmOpen`:

```tsx
{syncConfirmOpen && (
  <div className="modal-overlay" onClick={() => setSyncConfirmOpen(false)}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Connect Skills Backup</h3>
      <p>
        {syncRepoExists
          ? 'Connect to your existing gitsuite-skills repo on GitHub. Your skills will be pushed there automatically after each generation.'
          : 'This will create a private repo gitsuite-skills on your GitHub account. Your skills will be pushed there automatically after each generation.'}
      </p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => setSyncConfirmOpen(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSyncConfirm}>
          {syncRepoExists ? 'Connect' : 'Create & Connect'}
        </button>
      </div>
    </div>
  </div>
)}
```

Note: to pre-check whether `gitsuite-skills` already exists (to show the right dialog text), you could add a `skillSync:checkRepo` IPC or simply always show the "create" variant and let `setupRepo` handle the already-exists case gracefully. Simplest approach: default to the "create" variant; if the repo already exists the `createRepo` call is skipped silently inside the service.

- [ ] **Step 4: Add the "Skills Backup" connector card**

In the connectors section (near the GitHub connector row at line 407), add after the existing GitHub connector row:

```tsx
<div className="connector-row">
  <div className="connector-icon connector-icon--skills-backup">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  </div>
  <div className="connector-info">
    <div className="connector-name">Skills Backup</div>
    <div className="connector-desc">
      {syncStatus?.enabled
        ? syncStatus.failedCount > 0
          ? `${syncStatus.failedCount} skill${syncStatus.failedCount > 1 ? 's' : ''} failed to sync`
          : syncStatus.lastSynced
            ? `Last synced ${new Date(syncStatus.lastSynced).toLocaleString()}`
            : 'Connected — waiting for first skill'
        : 'Back up your skills to GitHub'}
    </div>
  </div>
  <div className="connector-actions">
    {syncStatus?.enabled ? (
      syncStatus.failedCount > 0 ? (
        <>
          <button className="btn btn-sm btn-primary" onClick={handleSyncRetry}>Retry</button>
          <button className="btn btn-sm btn-ghost" onClick={handleSyncDisconnect}>Disconnect</button>
        </>
      ) : (
        <button className="btn btn-sm btn-ghost" onClick={handleSyncDisconnect}>Disconnect</button>
      )
    ) : syncConnecting ? (
      <span className="connector-connecting">Connecting…</span>
    ) : (
      <button
        className="btn btn-sm btn-primary"
        onClick={handleSyncConnectClick}
        disabled={!githubUsername}
        title={!githubUsername ? 'Log in to GitHub first' : undefined}
      >
        Connect
      </button>
    )}
    {syncError && <div className="connector-error">{syncError}</div>}
  </div>
</div>
```

Note: `githubUsername` already exists in Settings state (drives the GitHub connector row).

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(settings): add Skills Backup connector card with connect/disconnect/retry UI"
```

---

## Completion Checklist

- [ ] All 6 migration columns present in DB (`github_sha`, `synced_at`, `sync_status` on both tables)
- [ ] `skillSyncStore` reads/writes correctly (test by toggling in Settings)
- [ ] `createRepo` / `putFileContents` unit tests pass (`npx vitest run electron/services/githubHelpers.test.ts`)
- [ ] `SkillSyncService` unit tests pass (`npx vitest run electron/services/skillSyncService.test.ts`)
- [ ] `skill:generate` fires `push()` — generate a skill and check the GitHub repo for the file
- [ ] Setup flow shows confirmation dialog, then creates/connects repo and bulk-syncs existing skills
- [ ] Disconnect stops future pushes
- [ ] Retry button re-queues failed skills
- [ ] `syncFailed` notification appears when a push fails
- [ ] TypeScript compiles without errors: `npx tsc --noEmit`
