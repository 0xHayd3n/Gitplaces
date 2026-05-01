# Per-Repo User-Action Feed (Activities Tab)

**Date:** 2026-05-02
**Status:** Approved (user)
**Scope:** Add a personal-action event log to the per-repo Activities tab, alongside the existing release feed.

## Overview

The Activities tab in `RepoDetail.tsx` currently shows release events from the maintainer (rendered as `BannerCard`s, grouped by day). This spec extends it to also surface events when the **authed user themselves** has acted on the repo:

- **starred** — when they starred the repo
- **learned** — when they generated a Skills folder for the repo (master and/or components)
- **forked** — when they forked the repo
- **cloned** — when they cloned the repo (each clone is its own event)
- **archived** — when they archived the repo in their library

These events render as Steam-style single-line rows merged into the existing left-panel timeline, day-grouped chronologically with the release events. The right panel of the Activities tab stays empty.

User-level decisions captured during brainstorming:

- **Q1**: Ship all five action types in V1 (no defer).
- **Q2**: Single event per toggle. Star and archive are toggles — only the most recent transition into the "on" state is surfaced (no unstars / unarchives in the feed).
- **Q3**: User actions merge into the **left** panel alongside releases. Right panel stays empty for future planning.
- **Q4**: Steam-style action rows — user avatar, colored username, plain verb, target chip with its own icon. Always show a target chip (even for self-referential events like star/archive). Display-only (no click navigation in V1).
- **Q5**: No backfill. Star and learn already have real timestamps from existing data and light up immediately. Fork, clone, archive only appear for actions performed *after* this ships.

## File Touch List

| File | Change |
|---|---|
| `electron/db.ts` | Add `archived_at` and `forked_at` columns to `repos` (idempotent `ALTER TABLE`); new index `idx_engagement_repo_type` |
| `electron/services/engagementTracker.ts` | New helper `logClone(db, repoId, path)` |
| `electron/services/repoUserEvents.ts` | NEW. `getRepoUserEvents(db, owner, name)` — normalized read across multiple tables |
| `electron/services/repoUserEvents.test.ts` | NEW. ~10 cases covering all event types |
| `electron/main.ts` | New IPC handlers: `github:getRepoUserEvents`, `github:recordFork`, `github:recordClone`, `github:setArchivedAt` |
| `electron/preload.ts` | Surface the four new methods on `window.api.github.*` |
| `electron/main.test.ts` | Tests for the three new write handlers |
| `src/types/repoUserEvents.ts` | NEW. Discriminated `RepoUserEvent` type |
| `src/types/repoActivity.ts` | NEW. `RepoActivityItem` union (release \| user) |
| `src/hooks/useRepoUserEvents.ts` | NEW. Renderer-side hook wrapping the read IPC |
| `src/utils/groupEventsByDay.ts` | Small refactor: export `dayKey` and `labelFor` helpers (no behavior change) |
| `src/utils/groupRepoActivityByDay.ts` | NEW. Day-grouper for `RepoActivityItem[]` |
| `src/utils/groupRepoActivityByDay.test.ts` | NEW. ~5 cases |
| `src/components/RepoUserEventRow.tsx` (+ `.css`) | NEW. Steam-style action row component |
| `src/components/RepoUserEventRow.test.tsx` | NEW. ~6 render cases |
| `src/hooks/useArchivedRepos.ts` | Dual-write: on toggle, also call `setArchivedAt` IPC |
| `src/views/RepoDetail.tsx` | Wire fork/clone success paths to call `recordFork`/`recordClone`. Replace single-source feed with merged feed. |
| `src/views/RepoDetail.test.tsx` | Extend `setupDetail` to mock `getRepoUserEvents`; new cases for merged feed |

No new files for clone-action ingestion (uses existing `CloneOptionsPanel` — just calls the new IPC after success). No changes to `BannerCard`, `ActivityModal`, `ReleaseModalContent`. The Library activity feed (`ActivityFeed.tsx`) stays unchanged.

## 1. Schema and Migration

### 1.1 New columns on `repos`

In the existing migration block in `electron/db.ts` (after the existing `ALTER TABLE` calls around lines 197-209):

```ts
try { db.exec(`ALTER TABLE repos ADD COLUMN archived_at TEXT DEFAULT NULL`) } catch {}
try { db.exec(`ALTER TABLE repos ADD COLUMN forked_at   TEXT DEFAULT NULL`) } catch {}
```

Both store ISO timestamp strings, matching the existing `starred_at` / `unstarred_at` convention. Wrapped in `try/catch` for idempotency per the existing migration pattern.

### 1.2 New index for clone-event lookup

In the post-migration index block (around `electron/db.ts:212-219`):

```sql
CREATE INDEX IF NOT EXISTS idx_engagement_repo_type ON engagement_events(repo_id, event_type, ts DESC);
```

Speeds up the `WHERE repo_id=? AND event_type='clone'` query in the read path. Goes alongside the existing `idx_engagement_repo` and `idx_engagement_ts` indexes.

### 1.3 No new tables

The existing `engagement_events` table (already used for `event_type='click'` records) is reused for `event_type='clone'`. The `source` column stores the destination path. No schema change to that table.

### 1.4 No backfill

Migration only adds columns and indexes. Existing rows get `archived_at = NULL` and `forked_at = NULL` — those events don't appear in any feed. The `archived_repos` settings JSON is left in place; `useArchivedRepos.toggle` becomes a dual-write (settings list + `archived_at`) so existing archived state continues to work without surfacing a fake event.

Net diff in `db.ts`: ~10 LOC.

## 2. Read Path

### 2.1 Normalized event type

`src/types/repoUserEvents.ts` (new):

```ts
export type RepoUserEvent =
  | { type: 'star';    ts: string }
  | { type: 'archive'; ts: string }
  | { type: 'fork';    ts: string }
  | { type: 'clone';   ts: string; path: string }
  | { type: 'learn';   ts: string; skillFilename: string; skillType: 'master' | 'components' }
```

Sorted desc by `ts` server-side.

### 2.2 Service function

`electron/services/repoUserEvents.ts`:

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
interface CloneRow { ts: number; source: string }

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

  const clones = db.prepare(
    `SELECT ts, source FROM engagement_events WHERE repo_id=? AND event_type='clone' ORDER BY ts DESC`
  ).all(repo.id) as CloneRow[]
  for (const c of clones) {
    events.push({ type: 'clone', ts: new Date(c.ts).toISOString(), path: c.source })
  }

  return events.sort((a, b) => b.ts.localeCompare(a.ts))
}
```

### 2.3 IPC handlers (`electron/main.ts`)

```ts
ipcMain.handle('github:getRepoUserEvents', (_e, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  return getRepoUserEvents(db, owner, name)
})

ipcMain.handle('github:recordFork', (_e, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=?')
    .run(new Date().toISOString(), owner, name)
})

ipcMain.handle('github:recordClone', (_e, owner: string, name: string, path: string) => {
  const db = getDb(app.getPath('userData'))
  const repo = db.prepare('SELECT id FROM repos WHERE owner=? AND name=?').get(owner, name) as { id: string } | undefined
  if (!repo) return
  logClone(db, repo.id, path)
})

ipcMain.handle('github:setArchivedAt', (_e, owner: string, name: string, archived: boolean) => {
  const db = getDb(app.getPath('userData'))
  const ts = archived ? new Date().toISOString() : null
  db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?').run(ts, owner, name)
})
```

`logClone` in `engagementTracker.ts`:

```ts
export function logClone(db: Database.Database, repoId: string, path: string): void {
  db.prepare(
    'INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)'
  ).run(repoId, 'clone', path, Date.now())
}
```

### 2.4 Preload surface

`electron/preload.ts` — add to `github` namespace:

```ts
getRepoUserEvents: (owner: string, name: string) =>
  ipcRenderer.invoke('github:getRepoUserEvents', owner, name),
recordFork: (owner: string, name: string) =>
  ipcRenderer.invoke('github:recordFork', owner, name),
recordClone: (owner: string, name: string, path: string) =>
  ipcRenderer.invoke('github:recordClone', owner, name, path),
setArchivedAt: (owner: string, name: string, archived: boolean) =>
  ipcRenderer.invoke('github:setArchivedAt', owner, name, archived),
```

The `env.d.ts` `Window['api']['github']` interface gains the four new methods (matching the same shape).

### 2.5 Renderer hook

`src/hooks/useRepoUserEvents.ts`:

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

### 2.6 Repo-not-in-DB caveat

If a user views a repo via `/discover/...` (no local DB row yet), `getRepoUserEvents` returns `[]` — no error, just empty. Same for the three write handlers — they no-op silently if the repo isn't in the DB. The user must save the repo (e.g., star or learn it) before action events can be tracked.

## 3. `RepoUserEventRow` Component

`src/components/RepoUserEventRow.tsx` (+ `RepoUserEventRow.css`). One component, ~80 LOC. Display-only — no click handler in V1.

### 3.1 Props

```ts
import type { RepoUserEvent } from '../types/repoUserEvents'

interface Props {
  event: RepoUserEvent
  // Current repo (used as the target chip for self-referential star/archive).
  repoOwner: string
  repoName: string
  // Authed GitHub user (left-side avatar + colored username).
  userLogin: string
  userAvatarUrl: string
}
```

### 3.2 User avatar URL derivation

The `useGitHubAuth()` context only carries `{ login: string }` (verified at `src/contexts/GitHubAuth.tsx:5-7`). It does not store an avatar URL. The avatar is derived from the login:

```ts
const userAvatarUrl = `https://avatars.githubusercontent.com/${userLogin}?s=64`
```

Same domain convention used by `repoOwnerAvatarUrl` in `ActivityEvent.tsx:42-45`. Constructed in `RepoDetail.tsx` once and passed to `RepoUserEventRow`.

### 3.3 Verb + target chip per event type

| Event type | Verb | Target chip |
|---|---|---|
| `star` | "starred" | repo chip: `[ownerAvatar 14px] {owner}/{name}` |
| `archive` | "archived" | repo chip: `[ownerAvatar 14px] {owner}/{name}` |
| `fork` | "forked this to" | repo chip: `[userAvatar 14px] {userLogin}/{name}` *(GitHub's default fork destination)* |
| `clone` | "cloned this to" | path chip: `[Folder icon] {path}` (monospace) |
| `learn` (master) | "learned" | skill chip: `[PiBrainFill] {skillFilename}` |
| `learn` (components) | "learned components for" | skill chip: `[PiBrainFill] {skillFilename}` |

The chip kind is derived inside the component via a switch on `event.type`. Three chip variants share a base `.repo-user-event__chip` class plus a modifier (`--repo`, `--path`, `--skill`).

### 3.4 JSX

```tsx
import { Folder } from 'lucide-react'
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
    case 'clone':
      return { verb: 'cloned this to', chip: <PathChip path={event.path} /> }
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

function PathChip({ path }: { path: string }) {
  return (
    <span className="repo-user-event__chip repo-user-event__chip--path">
      <Folder size={12} />
      <span>{path}</span>
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

### 3.5 CSS

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
.repo-user-event__chip--path { font-family: 'JetBrains Mono', monospace; }
.repo-user-event__chip-avatar { width: 14px; height: 14px; border-radius: 3px; }
.repo-user-event__time { margin-left: auto; color: var(--t3); font-size: 11px; }
```

CSS variable names (`--t1`, `--t2`, `--t3`, `--accent-text`, `--surface-2`) — sample from existing palette in `globals.css`. Verify exact names during implementation; if `--surface-2` doesn't exist, fall back to `var(--bg-elevated)` or similar.

### 3.6 Visual contrast with `BannerCard`

`BannerCard`s in the same day group are ~180px tall with imagery. `RepoUserEventRow` is ~32px tall, no imagery. Mixed in the same column, the heights differentiate at-a-glance: tall = release, short = my action.

## 4. Activities Tab Integration

### 4.1 Unified item type

`src/types/repoActivity.ts`:

```ts
import type { GitHubFeedEvent } from '../hooks/useFeed'
import type { RepoUserEvent } from './repoUserEvents'

export type RepoActivityItem =
  | { kind: 'release'; ts: string; event: GitHubFeedEvent }
  | { kind: 'user';    ts: string; event: RepoUserEvent }
```

### 4.2 Day-grouper

Small refactor to `src/utils/groupEventsByDay.ts`: change `dayKey` and `labelFor` from non-exported helpers to `export`s. No behavior change.

`src/utils/groupRepoActivityByDay.ts` (new):

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

### 4.3 Merge logic in `RepoDetail.tsx`

Alongside the existing `releases` / `activityEvents` state, add:

```ts
import { useRepoUserEvents } from '../hooks/useRepoUserEvents'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { groupRepoActivityByDay } from '../utils/groupRepoActivityByDay'
import type { RepoActivityItem } from '../types/repoActivity'

// inside RepoDetail():
const userEvents = useRepoUserEvents(owner, name)        // RepoUserEvent[] | 'loading' | 'error'
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

`activityEvents` (the release-only synthetic list) is still needed for `ActivityModal`'s `events` prop — keep it as-is.

### 4.4 Render switch in the body

Replaces the current `activityGroups.map(group => …)` block inside `.repo-activity-split-left`:

```tsx
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
```

### 4.5 Loading / error / empty states

Update the existing top-level conditional so it considers both data sources:

- **Loading**: `releases === 'loading' || userEvents === 'loading'` → "Loading activity…"
- **Both errored**: render "Failed to load activity."
- **One errored, one resolved**: silently use the one that worked. Partial activity > no activity.
- **Both empty**: "No activity yet."

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
      <div className="repo-activity-split-left"> {/* render switch from 4.4 */} </div>
      <div className="repo-activity-split-right" />
    </div>
  )
)}
```

### 4.6 Default-tab logic

The existing `fellBackRef` effect demotes `activeTab` from `'activities'` to `'readme'` when there's nothing to show. Extend the `hasActivity` check to also consider user events:

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

For repos you've starred (but with no releases), the feed has a star event → Activities is the default. For pure discovery (no save, no releases), README is the default.

### 4.7 Modal click on a release card

Unchanged. `setSelectedReleaseId(...)` still opens `ActivityModal` with `activityEvents` (release-only list). User-action rows have no click behavior in V1, so nothing extra to wire.

## 5. Instrumentation Points

The four IPC handlers from Section 2 need to be called at the right moments.

### 5.1 Star / Unstar — already instrumented

The existing `github:starRepo` and `github:unstarRepo` handlers already update `repos.starred_at` (set to NOW on star) and `repos.unstarred_at` (set on unstar). No code change needed. The read service ignores `unstarred_at`, so unstars don't surface as events (per Q2).

### 5.2 Learn — already instrumented

The existing `skill:generate` IPC writes to `skills.generated_at` on success. Sub-skills similarly populate `sub_skills.generated_at`. No code change needed.

### 5.3 Fork — new instrumentation

In `RepoDetail.tsx`, the existing `handleFork` (Fork button click handler) needs to call `recordFork` after the fork action succeeds. Find the fork success path and add:

```ts
await window.api.github.recordFork(owner, name)
```

(One line. Fire-and-forget; failures don't break the fork action.)

### 5.4 Clone — new instrumentation

Cloning happens via `CloneOptionsPanel` (component). After a successful clone, `CloneOptionsPanel` already knows the destination path (it asked the user). It needs to call:

```ts
await window.api.github.recordClone(owner, name, destinationPath)
```

The exact wiring depends on `CloneOptionsPanel`'s API — likely accepts an `onCloneSuccess?: (path: string) => void` callback that `RepoDetail.tsx` provides, which then calls `recordClone`. Alternatively, if `CloneOptionsPanel` performs the clone itself via an IPC, that IPC handler can call `logClone` directly. Implementation detail; either path is acceptable.

### 5.5 Archive — extended instrumentation

`useArchivedRepos.toggle` becomes a dual-write:

```ts
const toggle = useCallback((owner: string, name: string) => {
  const key = `${owner}/${name}`
  const next = new Set(archivedSetRef.current)
  const archived = !next.has(key)
  if (archived) next.add(key); else next.delete(key)
  setArchivedSet(next)
  window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
  // NEW: also write timestamp to repos.archived_at
  window.api.github.setArchivedAt(owner, name, archived).catch(() => {})
}, [])
```

The settings list stays the source of truth for "is this archived?" (existing UI continues to work). The `archived_at` timestamp is new and only used by the feed.

## 6. Testing

TDD where tests already exist. ~600 LOC of new tests across five files.

### 6.1 `electron/services/repoUserEvents.test.ts` (NEW)

Pure DB-driven function — easy to test with an in-memory `better-sqlite3`. Mirror the setup pattern from `engagementTracker.test.ts:7-30`.

Cases:
- Returns `[]` for a repo not in the DB.
- Returns one `star` event when `repos.starred_at` is populated.
- Returns one `archive` event when `repos.archived_at` is populated.
- Returns one `fork` event when `repos.forked_at` is populated.
- Returns a `learn` event with `skillType='master'` when `skills.generated_at` is populated.
- Returns a second `learn` event with `skillType='components'` when `sub_skills.generated_at` is populated.
- Returns multiple `clone` events from `engagement_events WHERE event_type='clone'`, each with the path from `source`.
- Returns a fully-populated repo's events sorted desc by `ts`.
- Skips null timestamps (no event for missing data).

~10 cases, ~150 LOC.

### 6.2 `src/utils/groupRepoActivityByDay.test.ts` (NEW)

Pure function tests:
- Groups release + user items into the same day if their `ts` fall on the same calendar day.
- Labels groups "Today" / "Yesterday" / `Month Day` / `Month Day, Year` based on `now`.
- Preserves the input order within each group.
- Returns `[]` for empty input.
- A mixed-day input produces ordered groups (most recent day first, since input is sorted desc).

~5 cases, ~80 LOC.

### 6.3 `src/components/RepoUserEventRow.test.tsx` (NEW)

Renders one row per event type and asserts visible text + chip:

- `star` → renders user login, "starred", repo chip with `owner/name`, relative time string.
- `archive` → renders "archived", repo chip.
- `fork` → renders "forked this to", chip with `{userLogin}/{repoName}`.
- `clone` with `path` → renders "cloned this to", path text in chip, folder icon (assert via class `repo-user-event__chip--path`).
- `learn` with `skillType='master'` → renders "learned", skill chip with `skillFilename`.
- `learn` with `skillType='components'` → renders "learned components for".

~6 cases, ~120 LOC.

### 6.4 `electron/main.test.ts` extensions

Add three IPC handler tests:

- `github:recordFork` updates `repos.forked_at` to a valid ISO timestamp.
- `github:recordClone` inserts a row into `engagement_events` with `event_type='clone'` and the path in `source`. No-ops silently if the repo isn't in the DB.
- `github:setArchivedAt(true)` sets `archived_at`; `setArchivedAt(false)` clears it to `NULL`.

~80 LOC added.

### 6.5 `src/views/RepoDetail.test.tsx` extensions

Extend `setupDetail` to also mock `getRepoUserEvents` (defaults to `[]`). Add cases:

- Activities tab renders both `BannerCard`s AND `RepoUserEventRow`s when both sources have data.
- Activities tab renders only user events when `releases` is `[]`.
- Activities tab renders only releases when `userEvents` is `[]`.
- Default tab is `'activities'` when `userEvents` is non-empty even if `releases` is empty.
- Default tab is `'readme'` when both are empty.
- Loading state shows "Loading activity…" while either source is loading.

~6 cases, ~150 LOC additions.

### 6.6 No tests deleted

Existing tests pass unchanged. The Library `ActivityFeed.test.tsx` is unaffected (no change to that path).

### 6.7 Verification at the end

- `npx vitest run` on the affected files.
- `npx tsc --noEmit` for type checking (the existing pre-existing errors must not increase).
- UI verified by the user.

## 7. Implementation Sequencing

Recommended commit order — each commit leaves the test suite green relative to its baseline:

1. **Schema** — `db.ts` migration + `engagementTracker.ts` `logClone` helper. Tested via the existing `engagementTracker.test.ts` patterns.
2. **Read service + IPC** — `repoUserEvents.ts` + `getRepoUserEvents` IPC + preload + types. Includes Section 2's tests.
3. **Write IPCs** — `recordFork` / `recordClone` / `setArchivedAt` handlers + preload. Includes Section 6.4's tests.
4. **Day-grouper utility** — small refactor of `groupEventsByDay.ts` exports + new `groupRepoActivityByDay.ts` + its tests.
5. **`RepoUserEventRow` component** — TDD: write tests first (Section 6.3), then component + CSS.
6. **Activities tab integration** — wire merge + render switch + state reconciliation in `RepoDetail.tsx`. Includes Section 6.5's tests.
7. **Instrumentation** — fork/clone/archive call sites updated to invoke the new write IPCs. The most behavior-affecting commit; verify by manually triggering each action in the running app.

Branch policy: work directly on `main` per project rules.

## 8. Out of Scope

- **Click behavior on action rows.** Display-only in V1. Navigation hooks (open Skills folder for a learn row, reveal clone path in Finder, etc.) deferred.
- **Backfill of historical action timestamps** for fork/clone/archive. Per Q5, no synthetic timestamps; only future actions appear.
- **Surfacing unstars / unarchives.** Per Q2, toggles only show the most recent "on" transition. The data is preserved in `unstarred_at` etc., but the renderer ignores it.
- **Multi-clone deduplication.** Each clone is its own event, even if cloning to the same path twice. Reasonable for V1.
- **Right panel content.** Stays empty. Will be planned separately.
- **Cross-repo aggregation.** This feed is per-repo only.
- **Library activity feed changes.** Unchanged. The Library feed reads GitHub-side events, not local action events.
