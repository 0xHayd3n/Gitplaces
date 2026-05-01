# Per-Repo User-Action Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the authed user's own actions on a repo (star, learn, fork, archive) as Steam-style single-line rows merged into the Activities tab's left-panel timeline alongside release `BannerCard`s, day-grouped chronologically.

**Architecture:** Two new columns on the `repos` table (`archived_at`, `forked_at`) join the existing `starred_at`, `skills.generated_at`, and `sub_skills.generated_at` to seed five event types (clone deferred). One read IPC (`getRepoUserEvents`) returns a normalized `RepoUserEvent[]`. Two write IPCs (`recordFork`, `setArchivedAt`) instrument the action sites. The renderer merges releases + user events into a unified `RepoActivityItem[]`, day-groups via a new generic util, and renders a switch that picks `BannerCard` or `RepoUserEventRow` per item.

**Tech Stack:** electron + better-sqlite3 (IPC + DB), React 18 + TypeScript (renderer), Vitest + Testing Library (TDD), `react-icons/pi` for the brain icon (existing convention), `lucide-react` already imported elsewhere.

**Spec:** `docs/superpowers/specs/2026-05-02-repo-user-action-feed-design.md`

**Branch policy:** Work directly on `main` per project CLAUDE.md. **Do NOT** create a feature branch or worktree. Each task below is one commit.

**Pre-existing test failures on main** (not caused by this work, do NOT gate on these):
- `src/views/RepoDetail.test.tsx` — 6 stale "+ Learn" / "✓ Learned" text-mismatch tests
- `src/components/ReadmeRenderer.test.tsx` — 5 badge / image-link / popover-timing tests

Gate on **"no NEW failures vs the per-file pre-change baseline."** Capture the per-file baseline before each task that touches its tests. If a test the task didn't touch was passing before and is failing after → real regression. Otherwise → pre-existing.

---

## File Structure

| File | Role |
|---|---|
| `electron/db.ts` | Schema migration (`ALTER TABLE repos ADD COLUMN archived_at`, `forked_at`) |
| `electron/services/repoUserEvents.ts` | NEW. `getRepoUserEvents(db, owner, name)` reads from `repos`, `skills`, `sub_skills` |
| `electron/services/repoUserEvents.test.ts` | NEW. ~8 cases against an in-memory DB |
| `electron/main.ts` | NEW IPC handlers: `github:getRepoUserEvents`, `github:recordFork`, `github:setArchivedAt` |
| `electron/preload.ts` | Surface 3 new methods on `window.api.github.*` |
| `electron/main.test.ts` | Tests the SQL the new write handlers run, against an in-memory DB |
| `src/env.d.ts` | Add 3 new method signatures to the `Window['api']['github']` interface |
| `src/types/repoUserEvents.ts` | NEW. Discriminated `RepoUserEvent` union |
| `src/types/repoActivity.ts` | NEW. `RepoActivityItem` union (release \| user) |
| `src/hooks/useRepoUserEvents.ts` | NEW. Hook wrapping the read IPC |
| `src/utils/groupEventsByDay.ts` | Refactor: `export` `dayKey` and `labelFor` |
| `src/utils/groupRepoActivityByDay.ts` | NEW. Generic-shape day grouper for the union |
| `src/utils/groupRepoActivityByDay.test.ts` | NEW. ~5 cases |
| `src/components/RepoUserEventRow.tsx` (+ `.css`) | NEW. Steam-style row component |
| `src/components/RepoUserEventRow.test.tsx` | NEW. ~5 render cases |
| `src/hooks/useArchivedRepos.ts` | Dual-write: also call `setArchivedAt` IPC on toggle |
| `src/views/RepoDetail.tsx` | Wire fork on click; replace single-source feed with merged feed |
| `src/views/RepoDetail.test.tsx` | Wrap `setupDetail` in `<GitHubAuthProvider>`; mock `getRepoUserEvents`; new feed cases |

No changes to: `BannerCard`, `ActivityModal`, `ReleaseModalContent`, `CloneOptionsPanel`, `engagement_events` table, or the Library `ActivityFeed`.

## Verification commands

- Per-file: `npx vitest run path/to/file.test.tsx`
- Per-file by name: `npx vitest run path/to/file.test.tsx -t "test name"`
- Full suite (no rebuild): `npx vitest run`
- Full suite (rebuilds better-sqlite3 — slow, only at the end): `npm test`
- TypeScript: `npx tsc --noEmit`

After every task: run the affected test file(s) and confirm no new failures vs. the captured baseline. Commit only when green.

---

## Task 1: Schema migration

**Files:**
- Modify: `electron/db.ts` — add two `ALTER TABLE` calls

The new columns are `archived_at` (ISO timestamp string, nullable) and `forked_at` (same). Both are added in the existing migration block alongside the current `try { db.exec('ALTER TABLE repos ADD COLUMN ...') } catch {}` lines (around `electron/db.ts:197-209`).

- [ ] **Step 1.1: Open `electron/db.ts` and locate the migration block.**

  Find the section with these existing lines (approximately lines 197-209):
  ```ts
  try { db.exec(`ALTER TABLE repos ADD COLUMN is_forked         INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_available  INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_checked_at INTEGER DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN upstream_version  TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN stored_version    TEXT    DEFAULT NULL`) } catch {}
  ```

- [ ] **Step 1.2: Add the two new column migrations.**

  Insert after the last existing `ALTER TABLE repos` line:
  ```ts
  try { db.exec(`ALTER TABLE repos ADD COLUMN archived_at       TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN forked_at         TEXT    DEFAULT NULL`) } catch {}
  ```

- [ ] **Step 1.3: Run the existing schema tests to confirm migration is idempotent.**

  Run: `npx vitest run electron/db.phase23-migration.test.ts electron/main.test.ts`
  Expected: PASS (the existing `initSchema` flow still works; the two new columns are now present but no test asserts on them yet).

- [ ] **Step 1.4: Commit.**

  ```bash
  git add electron/db.ts
  git commit -m "feat(db): add archived_at and forked_at columns to repos

  Two new ISO-timestamp columns on the repos table, default NULL.
  Used by the per-repo user-action feed to surface 'you archived this'
  and 'you forked this' events alongside release events. Columns added
  via idempotent ALTER TABLE in the existing migration block."
  ```

---

## Task 2: Read service + types + read IPC

**Files:**
- Create: `src/types/repoUserEvents.ts` — `RepoUserEvent` discriminated union
- Create: `electron/services/repoUserEvents.ts` — `getRepoUserEvents(db, owner, name)`
- Create: `electron/services/repoUserEvents.test.ts` — TDD tests for the read service
- Modify: `electron/main.ts` — register `github:getRepoUserEvents` IPC handler
- Modify: `electron/preload.ts` — add `getRepoUserEvents` method
- Modify: `src/env.d.ts` — add `getRepoUserEvents` to the `github` interface

TDD: the read service is pure and DB-driven, so we test it directly with an in-memory DB (mirroring `engagementTracker.test.ts`). The IPC wiring is trivial and tested manually by running the app.

- [ ] **Step 2.1: Capture the pre-change baseline.**

  Run: `npx vitest run electron/`
  Note: total tests passing / failing. We expect this to grow only by the count of our new tests.

- [ ] **Step 2.2: Create the type file.**

  Create `src/types/repoUserEvents.ts`:
  ```ts
  export type RepoUserEvent =
    | { type: 'star';    ts: string }
    | { type: 'archive'; ts: string }
    | { type: 'fork';    ts: string }
    | { type: 'learn';   ts: string; skillFilename: string; skillType: 'master' | 'components' }
  ```

- [ ] **Step 2.3: Write the failing test file.**

  Create `electron/services/repoUserEvents.test.ts`:
  ```ts
  // @vitest-environment node
  import { describe, it, expect, beforeEach } from 'vitest'
  import Database from 'better-sqlite3'
  import { initSchema } from '../db'
  import { getRepoUserEvents } from './repoUserEvents'

  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initSchema(db)
  })

  function seedRepo(opts: {
    id?: string
    owner?: string
    name?: string
    starred_at?: string | null
    archived_at?: string | null
    forked_at?: string | null
  } = {}) {
    const id = opts.id ?? 'r1'
    const owner = opts.owner ?? 'alice'
    const name = opts.name ?? 'repo'
    db.prepare('INSERT INTO repos (id, owner, name, starred_at, archived_at, forked_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, owner, name, opts.starred_at ?? null, opts.archived_at ?? null, opts.forked_at ?? null)
    return { id, owner, name }
  }

  describe('getRepoUserEvents', () => {
    it('returns [] for a repo not in the DB', () => {
      const events = getRepoUserEvents(db, 'unknown', 'repo')
      expect(events).toEqual([])
    })

    it('returns a star event when starred_at is populated', () => {
      const r = seedRepo({ starred_at: '2026-04-01T00:00:00Z' })
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([{ type: 'star', ts: '2026-04-01T00:00:00Z' }])
    })

    it('returns an archive event when archived_at is populated', () => {
      const r = seedRepo({ archived_at: '2026-04-02T00:00:00Z' })
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([{ type: 'archive', ts: '2026-04-02T00:00:00Z' }])
    })

    it('returns a fork event when forked_at is populated', () => {
      const r = seedRepo({ forked_at: '2026-04-03T00:00:00Z' })
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([{ type: 'fork', ts: '2026-04-03T00:00:00Z' }])
    })

    it('returns a learn event with skillType=master from skills.generated_at', () => {
      const r = seedRepo()
      db.prepare('INSERT INTO skills (repo_id, filename, content, generated_at) VALUES (?, ?, ?, ?)')
        .run(r.id, 'repo.skill.md', '', '2026-04-04T00:00:00Z')
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([
        { type: 'learn', ts: '2026-04-04T00:00:00Z', skillFilename: 'repo.skill.md', skillType: 'master' },
      ])
    })

    it('returns a learn event with skillType=components from sub_skills.generated_at', () => {
      const r = seedRepo()
      db.prepare(`INSERT INTO sub_skills (repo_id, skill_type, filename, content, generated_at) VALUES (?, 'components', ?, ?, ?)`)
        .run(r.id, 'repo.components.skill.md', '', '2026-04-05T00:00:00Z')
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([
        { type: 'learn', ts: '2026-04-05T00:00:00Z', skillFilename: 'repo.components.skill.md', skillType: 'components' },
      ])
    })

    it('returns all populated events sorted desc by ts', () => {
      const r = seedRepo({
        starred_at: '2026-04-01T00:00:00Z',
        archived_at: '2026-04-03T00:00:00Z',
        forked_at: '2026-04-02T00:00:00Z',
      })
      db.prepare('INSERT INTO skills (repo_id, filename, content, generated_at) VALUES (?, ?, ?, ?)')
        .run(r.id, 'repo.skill.md', '', '2026-04-04T00:00:00Z')
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events.map(e => e.ts)).toEqual([
        '2026-04-04T00:00:00Z',
        '2026-04-03T00:00:00Z',
        '2026-04-02T00:00:00Z',
        '2026-04-01T00:00:00Z',
      ])
    })

    it('skips null timestamps', () => {
      const r = seedRepo() // all timestamps null
      const events = getRepoUserEvents(db, r.owner, r.name)
      expect(events).toEqual([])
    })
  })
  ```

- [ ] **Step 2.4: Run tests to verify they fail.**

  Run: `npx vitest run electron/services/repoUserEvents.test.ts`
  Expected: FAIL with "Cannot find module './repoUserEvents'" — the file doesn't exist yet.

- [ ] **Step 2.5: Implement the read service.**

  Create `electron/services/repoUserEvents.ts`:
  ```ts
  import type Database from 'better-sqlite3'
  import type { RepoUserEvent } from '../../src/types/repoUserEvents'

  interface RepoRow {
    id: string
    starred_at: string | null
    archived_at: string | null
    forked_at: string | null
  }
  interface SkillRow { filename: string; generated_at: string | null }
  interface SubSkillRow { filename: string; generated_at: string | null }

  export function getRepoUserEvents(
    db: Database.Database,
    owner: string,
    name: string,
  ): RepoUserEvent[] {
    const repo = db.prepare(
      'SELECT id, starred_at, archived_at, forked_at FROM repos WHERE owner=? AND name=?'
    ).get(owner, name) as RepoRow | undefined
    if (!repo) return []

    const events: RepoUserEvent[] = []
    if (repo.starred_at)  events.push({ type: 'star',    ts: repo.starred_at })
    if (repo.archived_at) events.push({ type: 'archive', ts: repo.archived_at })
    if (repo.forked_at)   events.push({ type: 'fork',    ts: repo.forked_at })

    const master = db.prepare(
      'SELECT filename, generated_at FROM skills WHERE repo_id=? AND generated_at IS NOT NULL'
    ).get(repo.id) as SkillRow | undefined
    if (master?.generated_at) {
      events.push({ type: 'learn', ts: master.generated_at, skillFilename: master.filename, skillType: 'master' })
    }

    const components = db.prepare(
      `SELECT filename, generated_at FROM sub_skills WHERE repo_id=? AND skill_type='components' AND generated_at IS NOT NULL`
    ).get(repo.id) as SubSkillRow | undefined
    if (components?.generated_at) {
      events.push({ type: 'learn', ts: components.generated_at, skillFilename: components.filename, skillType: 'components' })
    }

    return events.sort((a, b) => b.ts.localeCompare(a.ts))
  }
  ```

- [ ] **Step 2.6: Run tests to verify they pass.**

  Run: `npx vitest run electron/services/repoUserEvents.test.ts`
  Expected: 8/8 pass.

- [ ] **Step 2.7: Wire up the IPC handler in `electron/main.ts`.**

  Find the existing `github:getReleases` handler (around `electron/main.ts:697`). Add the new handler near it, importing the service at the top of the file:

  Add to imports (top of file, alongside other electron-side service imports):
  ```ts
  import { getRepoUserEvents } from './services/repoUserEvents'
  ```

  Add after `github:getReleases`:
  ```ts
  ipcMain.handle('github:getRepoUserEvents', async (_event, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    return getRepoUserEvents(db, owner, name)
  })
  ```

- [ ] **Step 2.8: Surface the method in `electron/preload.ts`.**

  Find the `github` namespace block (around `electron/preload.ts:36` where `getReleases` lives). Add:
  ```ts
  getRepoUserEvents: (owner: string, name: string) =>
    ipcRenderer.invoke('github:getRepoUserEvents', owner, name),
  ```

- [ ] **Step 2.9: Add the type to `src/env.d.ts`.**

  Find the `Window['api']['github']` interface (around `src/env.d.ts:81`). Add:
  ```ts
  getRepoUserEvents: (owner: string, name: string) => Promise<RepoUserEvent[]>
  ```
  At the top of `src/env.d.ts`, add the import alongside the existing `RepoRow`/`ReleaseRow` import:
  ```ts
  import type { RepoUserEvent } from './types/repoUserEvents'
  ```

- [ ] **Step 2.10: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: no NEW errors. Pre-existing errors in `Discover.tsx` / `Library.tsx` / `Profile.tsx` may still appear — only fail if a NEW error reference is in a file you just touched.

- [ ] **Step 2.11: Commit.**

  ```bash
  git add src/types/repoUserEvents.ts electron/services/repoUserEvents.ts electron/services/repoUserEvents.test.ts electron/main.ts electron/preload.ts src/env.d.ts
  git commit -m "feat(repo-user-events): add normalized read service + IPC

  getRepoUserEvents returns a chronological list of RepoUserEvent
  values for one repo by reading repos.starred_at / archived_at /
  forked_at, skills.generated_at (master), and sub_skills.generated_at
  (components). Pure DB function, no GitHub API access. Returns [] for
  unknown repo. Surfaced as window.api.github.getRepoUserEvents."
  ```

---

## Task 3: Write IPCs (recordFork, setArchivedAt)

**Files:**
- Modify: `electron/main.ts` — add 2 IPC handlers
- Modify: `electron/preload.ts` — add 2 methods
- Modify: `src/env.d.ts` — add 2 method signatures
- Modify: `electron/main.test.ts` — add tests for the underlying SQL

The handlers are 1-2 lines of SQL each. We test the underlying state changes by running the same SQL the handler runs against an in-memory DB (matching the existing `versioned installs query` test pattern at `electron/main.test.ts:17-34`).

- [ ] **Step 3.1: Capture baseline.**

  Run: `npx vitest run electron/main.test.ts`
  Note tests passing.

- [ ] **Step 3.2: Write the failing tests in `electron/main.test.ts`.**

  Append to the file:
  ```ts
  describe('recordFork SQL', () => {
    it('sets repos.forked_at to a non-null timestamp', () => {
      if (!db) throw new Error('db not initialized')
      db.prepare("INSERT INTO repos (id, owner, name) VALUES ('r1', 'alice', 'repo')").run()

      db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=?')
        .run(new Date().toISOString(), 'alice', 'repo')

      const row = db.prepare('SELECT forked_at FROM repos WHERE id=?').get('r1') as { forked_at: string | null }
      expect(row.forked_at).not.toBeNull()
      expect(typeof row.forked_at).toBe('string')
    })

    it('UPDATE silently no-ops for an unknown repo', () => {
      if (!db) throw new Error('db not initialized')
      const result = db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=?')
        .run(new Date().toISOString(), 'unknown', 'repo')
      expect(result.changes).toBe(0)
    })
  })

  describe('setArchivedAt SQL', () => {
    it('archived=true sets archived_at to a non-null timestamp', () => {
      if (!db) throw new Error('db not initialized')
      db.prepare("INSERT INTO repos (id, owner, name) VALUES ('r1', 'alice', 'repo')").run()

      db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?')
        .run(new Date().toISOString(), 'alice', 'repo')

      const row = db.prepare('SELECT archived_at FROM repos WHERE id=?').get('r1') as { archived_at: string | null }
      expect(row.archived_at).not.toBeNull()
    })

    it('archived=false clears archived_at to NULL', () => {
      if (!db) throw new Error('db not initialized')
      db.prepare("INSERT INTO repos (id, owner, name, archived_at) VALUES ('r1', 'alice', 'repo', '2026-04-01T00:00:00Z')").run()

      db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?')
        .run(null, 'alice', 'repo')

      const row = db.prepare('SELECT archived_at FROM repos WHERE id=?').get('r1') as { archived_at: string | null }
      expect(row.archived_at).toBeNull()
    })
  })
  ```

- [ ] **Step 3.3: Run tests to verify they pass already.**

  Run: `npx vitest run electron/main.test.ts`
  Expected: PASS. (These tests run the SQL directly against the in-memory DB, so they pass as soon as the columns exist from Task 1. They're regression tests for the migration + the SQL we're about to run from the IPC handlers.)

- [ ] **Step 3.4: Add the IPC handlers to `electron/main.ts`.**

  Near the `github:getReleases` and `github:getRepoUserEvents` handlers, add:
  ```ts
  ipcMain.handle('github:recordFork', async (_event, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=?')
      .run(new Date().toISOString(), owner, name)
  })

  ipcMain.handle('github:setArchivedAt', async (_event, owner: string, name: string, archived: boolean) => {
    const db = getDb(app.getPath('userData'))
    const ts = archived ? new Date().toISOString() : null
    db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?').run(ts, owner, name)
  })
  ```

- [ ] **Step 3.5: Add to `electron/preload.ts`.**

  In the `github` namespace block:
  ```ts
  recordFork: (owner: string, name: string) =>
    ipcRenderer.invoke('github:recordFork', owner, name),
  setArchivedAt: (owner: string, name: string, archived: boolean) =>
    ipcRenderer.invoke('github:setArchivedAt', owner, name, archived),
  ```

- [ ] **Step 3.6: Add to `src/env.d.ts` `github` interface.**

  ```ts
  recordFork: (owner: string, name: string) => Promise<void>
  setArchivedAt: (owner: string, name: string, archived: boolean) => Promise<void>
  ```

- [ ] **Step 3.7: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: no NEW errors.

- [ ] **Step 3.8: Commit.**

  ```bash
  git add electron/main.ts electron/preload.ts electron/main.test.ts src/env.d.ts
  git commit -m "feat(repo-user-events): add recordFork and setArchivedAt IPCs

  Two write-side IPC handlers for the user-action feed. recordFork
  sets repos.forked_at to NOW. setArchivedAt(true) sets archived_at
  to NOW; setArchivedAt(false) clears it to NULL. Both UPDATE-by-
  owner/name and silently no-op for repos not in the local DB.
  Tested via SQL-against-in-memory-DB pattern matching the existing
  electron/main.test.ts conventions."
  ```

---

## Task 4: Day-grouper utility

**Files:**
- Modify: `src/utils/groupEventsByDay.ts` — `export` `dayKey` and `labelFor`
- Create: `src/utils/groupRepoActivityByDay.ts` — new grouper for `RepoActivityItem`
- Create: `src/utils/groupRepoActivityByDay.test.ts` — TDD tests
- Create: `src/types/repoActivity.ts` — `RepoActivityItem` discriminated union

Pure functions. TDD. The existing `groupEventsByDay` keeps working for the Library feed — we just expose two helpers for reuse.

- [ ] **Step 4.1: Capture baseline.**

  Run: `npx vitest run src/utils/`
  Note tests passing/failing.

- [ ] **Step 4.2: Refactor `groupEventsByDay.ts` to export the two helpers.**

  In `src/utils/groupEventsByDay.ts`, change:
  ```ts
  function dayKey(d: Date): string {
  ```
  to:
  ```ts
  export function dayKey(d: Date): string {
  ```

  And change:
  ```ts
  function labelFor(
  ```
  to:
  ```ts
  export function labelFor(
  ```

  The existing `groupEventsByDay` function continues to use them locally — no behavior change.

- [ ] **Step 4.3: Verify the existing tests still pass.**

  Run: `npx vitest run src/utils/groupEventsByDay.test.ts` (if it exists; if not, skip).
  Expected: PASS — pure refactor.

- [ ] **Step 4.4: Create `src/types/repoActivity.ts`.**

  ```ts
  import type { GitHubFeedEvent } from '../hooks/useFeed'
  import type { RepoUserEvent } from './repoUserEvents'

  export type RepoActivityItem =
    | { kind: 'release'; ts: string; event: GitHubFeedEvent }
    | { kind: 'user';    ts: string; event: RepoUserEvent }
  ```

- [ ] **Step 4.5: Write failing tests for the new grouper.**

  Create `src/utils/groupRepoActivityByDay.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { groupRepoActivityByDay } from './groupRepoActivityByDay'
  import type { RepoActivityItem } from '../types/repoActivity'
  import type { GitHubFeedEvent } from '../hooks/useFeed'

  function release(ts: string, id = 'r1'): RepoActivityItem {
    const event = { id, type: 'ReleaseEvent', actor: { login: '', avatar_url: '' }, repo: { full_name: 'a/b' }, payload: {}, created_at: ts } as unknown as GitHubFeedEvent
    return { kind: 'release', ts, event }
  }
  function user(ts: string): RepoActivityItem {
    return { kind: 'user', ts, event: { type: 'star', ts } }
  }

  describe('groupRepoActivityByDay', () => {
    it('returns [] for empty input', () => {
      expect(groupRepoActivityByDay([])).toEqual([])
    })

    it('groups release + user items into the same day', () => {
      const now = new Date('2026-05-02T12:00:00Z')
      const groups = groupRepoActivityByDay([
        release('2026-05-02T10:00:00Z', 'a'),
        user('2026-05-02T08:00:00Z'),
      ], now)
      expect(groups).toHaveLength(1)
      expect(groups[0].label).toBe('Today')
      expect(groups[0].items).toHaveLength(2)
    })

    it('labels groups Today, Yesterday, and absolute date', () => {
      const now = new Date('2026-05-02T12:00:00Z')
      const groups = groupRepoActivityByDay([
        release('2026-05-02T10:00:00Z', 'a'),  // Today
        user('2026-05-01T10:00:00Z'),          // Yesterday
        release('2026-04-30T10:00:00Z', 'b'),  // April 30
      ], now)
      expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'April 30'])
    })

    it('produces groups in input order (most recent first when input is sorted desc)', () => {
      const now = new Date('2026-05-02T12:00:00Z')
      const groups = groupRepoActivityByDay([
        release('2026-05-02T10:00:00Z', 'a'),
        release('2026-04-30T10:00:00Z', 'b'),
        release('2026-05-01T10:00:00Z', 'c'),  // out of order — yields a third group at the end
      ], now)
      expect(groups.map(g => g.label)).toEqual(['Today', 'April 30', 'Yesterday'])
    })

    it('preserves input order within a group', () => {
      const now = new Date('2026-05-02T12:00:00Z')
      const groups = groupRepoActivityByDay([
        release('2026-05-02T10:00:00Z', 'first'),
        release('2026-05-02T08:00:00Z', 'second'),
      ], now)
      expect(groups[0].items.map(i => (i.event as { id: string }).id)).toEqual(['first', 'second'])
    })
  })
  ```

- [ ] **Step 4.6: Run tests to verify they fail.**

  Run: `npx vitest run src/utils/groupRepoActivityByDay.test.ts`
  Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 4.7: Implement the grouper.**

  Create `src/utils/groupRepoActivityByDay.ts`:
  ```ts
  import { dayKey, labelFor } from './groupEventsByDay'
  import type { RepoActivityItem } from '../types/repoActivity'

  export interface RepoActivityGroup {
    label: string
    items: RepoActivityItem[]
  }

  export function groupRepoActivityByDay(
    items: RepoActivityItem[],
    now: Date = new Date(),
  ): RepoActivityGroup[] {
    const groups: RepoActivityGroup[] = []
    const idxByKey = new Map<string, number>()
    const todayKey = dayKey(now)
    const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    for (const item of items) {
      const date = new Date(item.ts)
      const key = dayKey(date)
      let idx = idxByKey.get(key)
      if (idx === undefined) {
        idx = groups.length
        idxByKey.set(key, idx)
        groups.push({ label: labelFor(date, now, todayKey, yesterdayKey), items: [] })
      }
      groups[idx].items.push(item)
    }
    return groups
  }
  ```

- [ ] **Step 4.8: Run tests to verify they pass.**

  Run: `npx vitest run src/utils/groupRepoActivityByDay.test.ts`
  Expected: 5/5 pass.

- [ ] **Step 4.9: Run all utils tests to confirm no regressions.**

  Run: `npx vitest run src/utils/`
  Expected: same baseline pass count + 5 new (no regressions).

- [ ] **Step 4.10: Commit.**

  ```bash
  git add src/types/repoActivity.ts src/utils/groupEventsByDay.ts src/utils/groupRepoActivityByDay.ts src/utils/groupRepoActivityByDay.test.ts
  git commit -m "feat(utils): add groupRepoActivityByDay for the unified per-repo feed

  New grouper accepts a discriminated RepoActivityItem union (release
  events + user-action events) and produces day-grouped output via
  the same Today/Yesterday/MonthDay labelling the Library feed uses.
  Refactored groupEventsByDay.ts to export its dayKey and labelFor
  helpers so both groupers share them; no behaviour change."
  ```

---

## Task 5: `RepoUserEventRow` component (TDD)

**Files:**
- Create: `src/components/RepoUserEventRow.tsx`
- Create: `src/components/RepoUserEventRow.css`
- Create: `src/components/RepoUserEventRow.test.tsx`
- Create: `src/hooks/useRepoUserEvents.ts`

The component is display-only. We test it by rendering each event variant and asserting the visible text + chip class.

- [ ] **Step 5.1: Capture baseline.**

  Run: `npx vitest run src/components/`
  Note pass/fail counts.

- [ ] **Step 5.2: Write failing tests.**

  Create `src/components/RepoUserEventRow.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect } from 'vitest'
  import { RepoUserEventRow } from './RepoUserEventRow'
  import type { RepoUserEvent } from '../types/repoUserEvents'

  const baseProps = {
    repoOwner: 'vercel',
    repoName: 'next.js',
    userLogin: 'hayden',
    userAvatarUrl: 'https://avatars.githubusercontent.com/hayden?s=64',
  }

  describe('RepoUserEventRow', () => {
    it('renders a star event with user login, "starred", and repo chip', () => {
      const event: RepoUserEvent = { type: 'star', ts: '2026-04-01T00:00:00Z' }
      const { container } = render(<RepoUserEventRow event={event} {...baseProps} />)
      expect(screen.getByText('hayden')).toBeInTheDocument()
      expect(screen.getByText('starred')).toBeInTheDocument()
      expect(screen.getByText('vercel/next.js')).toBeInTheDocument()
      expect(container.querySelector('.repo-user-event__chip--repo')).not.toBeNull()
    })

    it('renders an archive event with "archived" verb and repo chip', () => {
      const event: RepoUserEvent = { type: 'archive', ts: '2026-04-02T00:00:00Z' }
      render(<RepoUserEventRow event={event} {...baseProps} />)
      expect(screen.getByText('archived')).toBeInTheDocument()
      expect(screen.getByText('vercel/next.js')).toBeInTheDocument()
    })

    it('renders a fork event with "forked this to" verb and {userLogin}/{repoName} chip', () => {
      const event: RepoUserEvent = { type: 'fork', ts: '2026-04-03T00:00:00Z' }
      render(<RepoUserEventRow event={event} {...baseProps} />)
      expect(screen.getByText('forked this to')).toBeInTheDocument()
      expect(screen.getByText('hayden/next.js')).toBeInTheDocument()
    })

    it('renders a learn (master) event with "learned" verb and skill chip', () => {
      const event: RepoUserEvent = {
        type: 'learn', ts: '2026-04-04T00:00:00Z',
        skillFilename: 'next.js.skill.md', skillType: 'master',
      }
      const { container } = render(<RepoUserEventRow event={event} {...baseProps} />)
      expect(screen.getByText('learned')).toBeInTheDocument()
      expect(screen.getByText('next.js.skill.md')).toBeInTheDocument()
      expect(container.querySelector('.repo-user-event__chip--skill')).not.toBeNull()
    })

    it('renders a learn (components) event with "learned components for" verb', () => {
      const event: RepoUserEvent = {
        type: 'learn', ts: '2026-04-05T00:00:00Z',
        skillFilename: 'next.js.components.skill.md', skillType: 'components',
      }
      render(<RepoUserEventRow event={event} {...baseProps} />)
      expect(screen.getByText('learned components for')).toBeInTheDocument()
      expect(screen.getByText('next.js.components.skill.md')).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 5.3: Run tests to verify they fail.**

  Run: `npx vitest run src/components/RepoUserEventRow.test.tsx`
  Expected: FAIL with "Cannot find module './RepoUserEventRow'".

- [ ] **Step 5.4: Implement the component.**

  Create `src/components/RepoUserEventRow.tsx`:
  ```tsx
  import { PiBrainFill } from 'react-icons/pi'
  import { relativeTime } from '../utils/relativeTime'
  import type { RepoUserEvent } from '../types/repoUserEvents'
  import './RepoUserEventRow.css'

  interface Props {
    event: RepoUserEvent
    repoOwner: string
    repoName: string
    userLogin: string
    userAvatarUrl: string
  }

  export function RepoUserEventRow({ event, repoOwner, repoName, userLogin, userAvatarUrl }: Props) {
    const { verb, chip } = buildContent(event, repoOwner, repoName, userLogin)
    return (
      <div className="repo-user-event">
        <img src={userAvatarUrl} alt={userLogin} className="repo-user-event__avatar" />
        <span className="repo-user-event__user">{userLogin}</span>
        <span className="repo-user-event__verb">{verb}</span>
        {chip}
        <span className="repo-user-event__time">{relativeTime(event.ts)}</span>
      </div>
    )
  }

  function buildContent(
    event: RepoUserEvent,
    repoOwner: string,
    repoName: string,
    userLogin: string,
  ): { verb: string; chip: React.ReactNode } {
    const repoAvatar = `https://avatars.githubusercontent.com/${repoOwner}?s=64`
    const userAvatar = `https://avatars.githubusercontent.com/${userLogin}?s=64`

    switch (event.type) {
      case 'star':
        return { verb: 'starred', chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} /> }
      case 'archive':
        return { verb: 'archived', chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} /> }
      case 'fork':
        return { verb: 'forked this to', chip: <RepoChip avatar={userAvatar} text={`${userLogin}/${repoName}`} /> }
      case 'learn':
        return {
          verb: event.skillType === 'components' ? 'learned components for' : 'learned',
          chip: <SkillChip filename={event.skillFilename} />,
        }
    }
  }

  function RepoChip({ avatar, text }: { avatar: string; text: string }) {
    return (
      <span className="repo-user-event__chip repo-user-event__chip--repo">
        <img src={avatar} alt="" className="repo-user-event__chip-avatar" />
        <span>{text}</span>
      </span>
    )
  }

  function SkillChip({ filename }: { filename: string }) {
    return (
      <span className="repo-user-event__chip repo-user-event__chip--skill">
        <PiBrainFill size={12} />
        <span>{filename}</span>
      </span>
    )
  }
  ```

- [ ] **Step 5.5: Create the CSS.**

  Create `src/components/RepoUserEventRow.css`:
  ```css
  .repo-user-event {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--t2);
    min-height: 32px;
  }
  .repo-user-event__avatar { width: 20px; height: 20px; border-radius: 50%; }
  .repo-user-event__user { color: var(--accent-text); font-weight: 600; }
  .repo-user-event__verb { color: var(--t2); }
  .repo-user-event__chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--t1);
  }
  .repo-user-event__chip-avatar { width: 14px; height: 14px; border-radius: 3px; }
  .repo-user-event__time { margin-left: auto; color: var(--t3); font-size: 11px; }
  ```

  **CSS variable verification:** confirm `--t1`, `--t2`, `--t3`, `--accent-text`, `--surface-2` exist in `src/styles/globals.css`. If `--surface-2` doesn't exist, fall back to `var(--bg-elevated)` or another existing surface variable. Run a quick grep:
  ```bash
  grep -n "^  --t1:\|^  --t2:\|^  --t3:\|^  --accent-text:\|^  --surface-2:\|^  --bg-elevated:" src/styles/globals.css
  ```

- [ ] **Step 5.6: Run tests to verify they pass.**

  Run: `npx vitest run src/components/RepoUserEventRow.test.tsx`
  Expected: 5/5 pass.

- [ ] **Step 5.7: Create the renderer hook.**

  Create `src/hooks/useRepoUserEvents.ts`:
  ```ts
  import { useEffect, useState } from 'react'
  import type { RepoUserEvent } from '../types/repoUserEvents'

  export function useRepoUserEvents(
    owner: string | undefined,
    name: string | undefined,
  ): RepoUserEvent[] | 'loading' | 'error' {
    const [events, setEvents] = useState<RepoUserEvent[] | 'loading' | 'error'>('loading')
    useEffect(() => {
      if (!owner || !name) { setEvents([]); return }
      let cancelled = false
      setEvents('loading')
      window.api.github.getRepoUserEvents(owner, name)
        .then(e => { if (!cancelled) setEvents(e) })
        .catch(() => { if (!cancelled) setEvents('error') })
      return () => { cancelled = true }
    }, [owner, name])
    return events
  }
  ```

  No tests for the hook in isolation — it's exercised end-to-end in Task 6 via the merged feed tests.

- [ ] **Step 5.8: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: no NEW errors.

- [ ] **Step 5.9: Commit.**

  ```bash
  git add src/components/RepoUserEventRow.tsx src/components/RepoUserEventRow.css src/components/RepoUserEventRow.test.tsx src/hooks/useRepoUserEvents.ts
  git commit -m "feat(repo-user-events): RepoUserEventRow component + useRepoUserEvents hook

  Steam-style single-line row component for user-action events. Each
  event renders as: user avatar | colored login | plain verb | target
  chip (with its own avatar/icon and identifier) | relative time.
  Display-only — no click navigation in V1. Hook wraps the read IPC
  with loading/error/array state."
  ```

---

## Task 6: Activities tab integration

**Files:**
- Modify: `src/views/RepoDetail.test.tsx` — wrap `setupDetail` in `<GitHubAuthProvider>`, mock `getRepoUserEvents`, add new feed cases
- Modify: `src/views/RepoDetail.tsx` — fetch user events, build merged item list, render switch by `kind`, update default-tab fallback

**Critical prerequisite:** The current `setupDetail` helper in `RepoDetail.test.tsx` does NOT wrap in `<GitHubAuthProvider>`. As soon as the new code path calls `useGitHubAuth()`, every existing test will throw `"useGitHubAuth must be used inside GitHubAuthProvider"`. Step 6.1 fixes the harness BEFORE we add any new feed code.

- [ ] **Step 6.1: Capture baseline.**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Note: 6 pre-existing failures (the stale "+ Learn" / "✓ Learned" text-mismatch tests) are expected. Note the exact pass/fail counts.

- [ ] **Step 6.2: Wrap `setupDetail` in `<GitHubAuthProvider>` and mock `getUser`.**

  In `src/views/RepoDetail.test.tsx`, add the import at the top (alongside the existing `AppearanceProvider` import):
  ```ts
  import { GitHubAuthProvider } from '../contexts/GitHubAuth'
  ```

  In the `setupDetail` `Object.defineProperty(window, 'api', { … })` mock, add a `getUser` method to the `github` namespace (the auth provider calls it on mount):
  ```ts
  github: {
    // ... existing mocks ...
    getUser: vi.fn().mockResolvedValue({ login: 'tester' }),
    getRepoUserEvents: vi.fn().mockResolvedValue([]),
    recordFork: vi.fn().mockResolvedValue(undefined),
    setArchivedAt: vi.fn().mockResolvedValue(undefined),
  },
  ```

  In the render call, wrap with `<GitHubAuthProvider>`:
  ```tsx
  return render(
    <MemoryRouter initialEntries={['/repo/vercel/next.js']}>
      <AppearanceProvider>
        <GitHubAuthProvider>
          <ProfileOverlayProvider>
            <SavedReposProvider>
              <Routes>
                <Route path="/repo/:owner/:name" element={<RepoDetail />} />
              </Routes>
            </SavedReposProvider>
          </ProfileOverlayProvider>
        </GitHubAuthProvider>
      </AppearanceProvider>
    </MemoryRouter>
  )
  ```

  Update the `setupDetail` signature to accept an optional `userEvents` parameter (mirrors the existing `releases` pattern):
  ```ts
  function setupDetail(
    skillRow: SkillRow | null,
    apiKey: string | null = null,
    generateFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ content: '## [CORE]\nfoo', version: 'v1' }),
    relatedRepos: object[] = [],
    releases: object[] | 'reject' = [],
    userEvents: object[] | 'reject' = [],     // NEW
  ) {
    // ... existing releasesFn build ...
    const userEventsFn = userEvents === 'reject'
      ? vi.fn().mockRejectedValue(new Error('boom'))
      : vi.fn().mockResolvedValue(userEvents)
    // ... in the api mock, replace getRepoUserEvents: vi.fn().mockResolvedValue([]) with:
    //     getRepoUserEvents: userEventsFn,
  ```

- [ ] **Step 6.3: Re-run RepoDetail tests to confirm harness fix.**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Expected: same pass/fail count as baseline. The 6 pre-existing failures still fail for the same reasons; the previously-passing tests still pass.

- [ ] **Step 6.4: Add merged-feed tests.**

  Append to the existing `describe('RepoDetail activities tab', …)` block (or create a new `describe('RepoDetail activities tab — merged feed')` section):
  ```tsx
  describe('RepoDetail activities tab — merged feed', () => {
    const sampleStarEvent = { type: 'star', ts: '2026-04-15T10:00:00Z' }

    it('renders both BannerCards and RepoUserEventRows when both sources have data', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], [sampleStarEvent])
      await waitFor(() => screen.getAllByText('next.js'))
      // BannerCard exists for the release
      await waitFor(
        () => {
          if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
          return container.querySelector('.banner-card')
        },
        { timeout: 3000 },
      )
      // RepoUserEventRow exists for the star event
      expect(container.querySelector('.repo-user-event')).not.toBeNull()
    })

    it('renders only user events when releases is empty', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [], [sampleStarEvent])
      await waitFor(() => screen.getAllByText('next.js'))
      await waitFor(
        () => {
          if (!container.querySelector('.repo-user-event')) throw new Error('user-event not yet')
          return container.querySelector('.repo-user-event')
        },
        { timeout: 3000 },
      )
      expect(container.querySelector('.banner-card')).toBeNull()
    })

    it('renders only releases when user events is empty', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], [])
      await waitFor(() => screen.getAllByText('next.js'))
      await waitFor(
        () => {
          if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
          return container.querySelector('.banner-card')
        },
        { timeout: 3000 },
      )
      expect(container.querySelector('.repo-user-event')).toBeNull()
    })

    it('default tab is Activities when user events is non-empty even with no releases', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [], [sampleStarEvent])
      await waitFor(() => screen.getAllByText('next.js'))
      await waitFor(
        () => {
          if (!container.querySelector('.repo-user-event')) throw new Error('not yet')
          return container.querySelector('.repo-user-event')
        },
        { timeout: 3000 },
      )
      // Repo-user-event renders → activities tab is the active body
    })

    it('default tab falls back to Readme when both releases and user events are empty', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [], [])
      await waitFor(() => screen.getAllByText('next.js'))
      // No banner cards, no user-event rows: README is active
      expect(container.querySelector('.banner-card')).toBeNull()
      expect(container.querySelector('.repo-user-event')).toBeNull()
    })

    it('renders the resolved source when one errors and the other resolves', async () => {
      const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], 'reject')
      await waitFor(() => screen.getAllByText('next.js'))
      await waitFor(
        () => {
          if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
          return container.querySelector('.banner-card')
        },
        { timeout: 3000 },
      )
      // No error placeholder; banner cards rendered
    })
  })
  ```

- [ ] **Step 6.5: Run tests to verify the new ones fail.**

  Run: `npx vitest run src/views/RepoDetail.test.tsx -t "merged feed"`
  Expected: FAIL — the merge logic doesn't exist yet.

- [ ] **Step 6.6: Add imports to `RepoDetail.tsx`.**

  Near the existing top-of-file imports, add:
  ```ts
  import { useRepoUserEvents } from '../hooks/useRepoUserEvents'
  import { useGitHubAuth } from '../contexts/GitHubAuth'
  import { groupRepoActivityByDay } from '../utils/groupRepoActivityByDay'
  import { RepoUserEventRow } from '../components/RepoUserEventRow'
  import type { RepoActivityItem } from '../types/repoActivity'
  ```

- [ ] **Step 6.7: Inside the `RepoDetail` component, add the new state and memos.**

  Find the existing `activityEvents` memo (the one that synthesizes release feed events). Right after it, add:
  ```ts
  const userEvents = useRepoUserEvents(owner, name)
  const { user: authedUser } = useGitHubAuth()
  const userLogin = authedUser?.login ?? ''
  const userAvatarUrl = userLogin ? `https://avatars.githubusercontent.com/${userLogin}?s=64` : ''

  const repoActivityItems = useMemo<RepoActivityItem[]>(() => {
    const items: RepoActivityItem[] = []
    if (Array.isArray(releases)) {
      for (const r of releases as ReleaseRow[]) {
        const ev = releaseRowToFeedEvent(r, `${owner}/${name}`)
        items.push({ kind: 'release', ts: ev.created_at, event: ev })
      }
    }
    if (Array.isArray(userEvents)) {
      for (const u of userEvents) items.push({ kind: 'user', ts: u.ts, event: u })
    }
    return items.sort((a, b) => b.ts.localeCompare(a.ts))
  }, [releases, userEvents, owner, name])

  const repoActivityGroups = useMemo(
    () => groupRepoActivityByDay(repoActivityItems),
    [repoActivityItems],
  )
  ```

  The existing release-only `activityEvents` memo and `activityGroups` are no longer used in the body — but `activityEvents` IS still needed as the `events` prop on `<ActivityModal>` (for stacked navigation through release modals). Keep `activityEvents`; remove `activityGroups`.

- [ ] **Step 6.8: Update the activities tab body in `RepoDetail.tsx`.**

  Find the existing `{activeTab === 'activities' && ( … )}` block. Replace the conditional that decides what to render:
  ```tsx
  {activeTab === 'activities' && (
    (releases === 'loading' || userEvents === 'loading') ? (
      <p className="repo-detail-placeholder">Loading activity…</p>
    ) : (releases === 'error' && userEvents === 'error') ? (
      <p className="repo-detail-placeholder">Failed to load activity.</p>
    ) : repoActivityItems.length === 0 ? (
      <p className="repo-detail-placeholder">No activity yet.</p>
    ) : (
      <div className="repo-activity-split">
        <div className="repo-activity-split-left">
          {repoActivityGroups.map(group => (
            <div key={group.label} className="repo-activity-group">
              <DateDivider label={group.label} />
              {group.items.map(item => (
                item.kind === 'release' ? (
                  <BannerCard
                    key={item.event.id}
                    {...releaseToBannerProps(item.event, () => setSelectedReleaseId(item.event.id))}
                  />
                ) : (
                  <RepoUserEventRow
                    key={`${item.event.type}-${item.ts}`}
                    event={item.event}
                    repoOwner={owner!}
                    repoName={name!}
                    userLogin={userLogin}
                    userAvatarUrl={userAvatarUrl}
                  />
                )
              ))}
            </div>
          ))}
        </div>
        <div className="repo-activity-split-right" />
      </div>
    )
  )}
  ```

- [ ] **Step 6.9: Update the `fellBackRef` default-tab effect.**

  Find the existing `fellBackRef` effect (it currently checks only `releases`). Update its `hasActivity` derivation to also consider `userEvents`:
  ```ts
  useEffect(() => {
    if (fellBackRef.current) return
    if (releases === 'loading' || userEvents === 'loading') return
    fellBackRef.current = true
    const hasActivity = (Array.isArray(releases) && (releases as ReleaseRow[]).length > 0)
                     || (Array.isArray(userEvents) && userEvents.length > 0)
    if (!hasActivity && activeTab === 'activities') setActiveTab('readme')
  }, [releases, userEvents, activeTab])
  ```

- [ ] **Step 6.10: Run tests to verify they pass.**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Expected: previously-passing tests still pass, the 6 pre-existing failures still fail, the 6 new merged-feed tests pass.

- [ ] **Step 6.11: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: no NEW errors.

- [ ] **Step 6.12: Commit.**

  ```bash
  git add src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx
  git commit -m "feat(repo-detail): merge user-action events into the Activities feed

  Wraps setupDetail's render tree in <GitHubAuthProvider> and mocks
  getUser+getRepoUserEvents. RepoDetail now fetches user events via
  useRepoUserEvents, merges them with the existing release stream
  into a unified RepoActivityItem[], day-groups via the new utility,
  and renders BannerCard (for release) or RepoUserEventRow (for user)
  per item inside each day group. The default-tab fellBackRef effect
  also considers userEvents — Activities is the default if either
  source has data."
  ```

---

## Task 7: Instrumentation (fork on click, archive dual-write)

**Files:**
- Modify: `src/views/RepoDetail.tsx` — call `recordFork` from `handleFork`
- Modify: `src/hooks/useArchivedRepos.ts` — call `setArchivedAt` from `toggle`

This is the most behavior-affecting commit — it lights up new events for actions performed after this ships. Manual UI verification by the user.

- [ ] **Step 7.1: Capture baseline.**

  Run: `npx vitest run src/views/ src/hooks/`
  Note pass/fail counts.

- [ ] **Step 7.2: Add `recordFork` call to `handleFork`.**

  Find `handleFork` in `src/views/RepoDetail.tsx` (around line 884). Replace:
  ```ts
  const handleFork = () => {
    if (!owner || !name) return
    window.api.openExternal(`https://github.com/${owner}/${name}/fork`)
  }
  ```
  with:
  ```ts
  const handleFork = () => {
    if (!owner || !name) return
    void window.api.openExternal(`https://github.com/${owner}/${name}/fork`)
    void window.api.github.recordFork(owner, name)
  }
  ```

- [ ] **Step 7.3: Add `setArchivedAt` call to `useArchivedRepos.toggle`.**

  In `src/hooks/useArchivedRepos.ts`, replace the `toggle` callback:
  ```ts
  const toggle = useCallback((owner: string, name: string) => {
    const key = `${owner}/${name}`
    const next = new Set(archivedSetRef.current)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setArchivedSet(next)
    window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
  }, [])
  ```
  with:
  ```ts
  const toggle = useCallback((owner: string, name: string) => {
    const key = `${owner}/${name}`
    const next = new Set(archivedSetRef.current)
    const archived = !next.has(key)
    if (archived) next.add(key); else next.delete(key)
    setArchivedSet(next)
    window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
    window.api.github.setArchivedAt(owner, name, archived).catch(() => {})
  }, [])
  ```

- [ ] **Step 7.4: Update existing `useArchivedRepos.test.ts` to mock the new IPC.**

  Find `src/hooks/useArchivedRepos.test.ts`. The existing tests likely mock `window.api.settings` only. Add a `github.setArchivedAt` mock to the test setup so the new `.catch(() => {})` call doesn't throw:
  ```ts
  // In the test's window.api setup:
  github: {
    setArchivedAt: vi.fn().mockResolvedValue(undefined),
  },
  ```

  If the existing setup uses a partial `window.api` object, just add the field. If it uses `Object.defineProperty`, ensure the structure is preserved.

- [ ] **Step 7.5: Run tests to verify no regressions.**

  Run: `npx vitest run src/views/RepoDetail.test.tsx src/hooks/useArchivedRepos.test.ts`
  Expected: same baseline pass count. The 6 pre-existing RepoDetail failures still fail; everything else passes.

- [ ] **Step 7.6: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: no NEW errors.

- [ ] **Step 7.7: Commit.**

  ```bash
  git add src/views/RepoDetail.tsx src/hooks/useArchivedRepos.ts src/hooks/useArchivedRepos.test.ts
  git commit -m "feat(repo-detail): instrument fork and archive actions

  handleFork now logs a fork event optimistically on click via
  window.api.github.recordFork — handleFork is fire-and-forget
  openExternal, so we trust the click intent (acceptable trade-off
  since stray fork events in the personal feed cost nothing).
  useArchivedRepos.toggle dual-writes: settings JSON for the existing
  is-archived state, plus repos.archived_at via setArchivedAt for the
  feed timestamp. Both writes are independent (.catch() each)."
  ```

---

## Task 8: Final verification

- [ ] **Step 8.1: Full suite.**

  Run: `npx vitest run`
  Expected: same pre-existing failures count as the start of this work; new tests all pass; no new failures introduced. Capture the result and post it to the user.

- [ ] **Step 8.2: TypeScript check.**

  Run: `npx tsc --noEmit`
  Expected: same pre-existing error count. No new errors.

- [ ] **Step 8.3: Final UI verification (user does this).**

  Tell the user the work is ready for them to test in the running app. Suggested manual checks:
  - Open a repo you've previously starred → Activities tab shows a "starred" event with the date you starred it.
  - Open a repo you've previously learned → Activities tab shows a "learned" event with the skill filename.
  - Click Fork on any repo → reload → see a "forked this to" event.
  - Toggle Archive on any repo → reload → see an "archived" event (only after toggling — pre-existing archives won't appear, per the no-backfill design).
  - Open a repo with no releases that you've starred → Activities is the default tab and shows the star event.
  - Open a repo with no releases and no user actions → README is the default; Activities tab still appears (always visible per earlier work) and shows "No activity yet."

---

## Done

After Task 8 the work is complete:

- ✅ Four user-action event types surfaced in the Activities tab (star, learn, fork, archive)
- ✅ Steam-style row component, day-grouped alongside release BannerCards
- ✅ No backfill — fork/archive only appear for actions from now on
- ✅ Default tab favours Activities when either source has content; falls back to README otherwise
- ✅ All new tests pass; no regressions in pre-existing tests
- ✅ Seven commits on `main`, each green relative to its baseline
- ⏭ Clone deferred to a future iteration when an actual clone-with-destination flow exists in the app
