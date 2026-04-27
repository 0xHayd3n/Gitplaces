# Skill GitHub Sync — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Overview

User-generated skill files are backed up to a private GitHub repository (`gitsuite-skills`) owned by the authenticated user. The local filesystem remains the fast-path for all reads; GitHub is the write-only backup destination. Sync is one-way (local → GitHub), automatic after every skill generation or update, and uses the GitHub Contents API with a SHA cache stored in SQLite.

---

## Architecture

A new `SkillSyncService` (`electron/services/skillSyncService.ts`) is added as a thin async layer after skill generation. The existing `skill:generate` IPC handler writes to disk and DB first (unchanged), then calls `skillSyncService.push()` as a fire-and-forget side-effect. Sync failure never blocks or rolls back skill generation.

`SkillSyncService` receives a `BrowserWindow` reference at construction time (matching the pattern used by `verificationService.ts`) so it can call `mainWindow.webContents.send('skillSync:syncFailed', payload)` to push failure events to the renderer.

```
skill:generate IPC
  └─ write to disk + DB  (existing, unchanged)
  └─ skillSyncService.push()  (new, async, non-blocking)
        └─ GitHub Contents API PUT
        └─ update DB (sha, synced_at, sync_status)
        └─ on failure: mainWindow.webContents.send('skillSync:syncFailed') → toast notification
```

---

## Setup Flow

A "Skills Backup" card is added to Settings. It has three states:

**Disconnected**
- Text: "Back up your skills to GitHub"
- Button: "Connect"
- Clicking shows a confirmation dialog:
  - If `gitsuite-skills` does not exist on user's account: "This will create a private repo `gitsuite-skills` on your GitHub account. Your skills will be pushed there automatically after each generation."
  - If it already exists: "Connect to your existing `gitsuite-skills` repo."
  - Actions: Cancel / Create & Connect (or Connect)
- Disabled with tooltip "Log in to GitHub first" if user is not authenticated

**Connected**
- Shows repo name as a clickable link (`github.com/{username}/gitsuite-skills`)
- Last synced timestamp
- "Disconnect" button — stops future syncs, does not delete the remote repo; retains `github_sha` values in DB for future reconnection

**Error State**
- Shown when any skill has `sync_status = 'failed'`
- Text: "Last sync failed."
- Buttons: "Retry" / "Disconnect"

No re-authentication is required. The existing OAuth scope (`repo`) already covers creating private repos and pushing file contents.

---

## Data Model

### SQLite — `skills` and `sub_skills` tables

Three new columns added via migration (idempotent `try/catch ALTER TABLE`, matching the pattern in `electron/db.ts`):

```sql
github_sha    TEXT     -- SHA returned by GitHub after last successful push; NULL if never synced
synced_at     INTEGER  -- Unix ms timestamp of last successful push; NULL if never synced
sync_status   TEXT     -- 'synced' | 'pending' | 'failed' | NULL (sync not enabled at generation time)
```

On first connect, all existing skills with `sync_status IS NULL` are set to `'pending'` and queued for `pushAll()`.

### electron-store — `skillSyncStore`

A new `skillSyncStore` instance (following the pattern of `githubStore` and `apiStore` in `electron/store.ts`) with flat dotted keys and named helper exports:

```ts
// Keys: 'skillSync.enabled', 'skillSync.repoOwner'
// (repoName is always 'gitsuite-skills' — fixed, not stored)
export function getSyncEnabled(): boolean
export function setSyncEnabled(v: boolean): void
export function getSyncRepoOwner(): string | undefined
export function setSyncRepoOwner(v: string): void
```

`repoOwner` is the authenticated GitHub username (the owner of `gitsuite-skills`), stored explicitly to avoid extra API calls at push time. This is distinct from the skill-source repo owner (e.g. `microsoft`) used to build the GitHub path.

---

## Push Mechanism

A module-level constant `SKILLS_BACKUP_REPO = 'gitsuite-skills'` is used throughout the service to avoid typo risk across `push()`, `setupRepo()`, and `pushAll()`.

### `push(repoId, owner, filename, content, skillType?)`

Called after every skill generation or update. `skillType` is omitted for primary skills and provided for sub-skills, routing the SHA lookup and write to the correct table. **Pass the raw `skill_type` column value including any prefix** — e.g. `'components'`, `'system'`, `'practice'`, or `'version:main'` (the colon-prefixed form used by versioned sub-skills in the `sub_skills` table).

- `owner` here is the **skill-source repo owner** (e.g. `microsoft`) — the org/user whose repo the skill was generated for. This is distinct from `getSyncRepoOwner()` (the authenticated user who owns `gitsuite-skills`).

1. Read `getSyncEnabled()` — bail if false. Read token via `getToken()`.
2. Build GitHub path: `{owner}/{filename}` (e.g., `microsoft/vscode.skill.md`)
3. Look up `github_sha`:
   - Primary skill (`skillType` omitted): `SELECT github_sha FROM skills WHERE repo_id = ?`
   - Sub-skill: `SELECT github_sha FROM sub_skills WHERE repo_id = ? AND skill_type = ?` — both columns required (composite primary key)
4. `PUT /repos/{getSyncRepoOwner()}/SKILLS_BACKUP_REPO/contents/{path}`
   - Body: `{ message, content: base64(content), sha }` — omit `sha` on first push
5. On success: write returned SHA + `Date.now()` to the appropriate DB row; set `sync_status = 'synced'`
6. On failure: set `sync_status = 'failed'`; call `mainWindow.webContents.send('skillSync:syncFailed', { owner, filename })`
   - Auth errors (401/403): set `sync_status = 'failed'` (not `'pending'`) so the user can see and retry from Settings after re-authenticating

### `pushAll(statusFilter?: 'pending' | 'failed' | 'all')`

Iterates all rows in `skills` and `sub_skills` matching `statusFilter` (default `undefined` = both `'pending'` and `'failed'`), calls `push()` for each with a 250ms delay between calls. **Continues on individual item failure** — each failed item is marked `sync_status = 'failed'` independently; the batch does not abort. After the batch completes, if any items failed, sends `skillSync:syncFailed` with a summary count.

When iterating `sub_skills`, pass the raw `skill_type` value (including any `version:` prefix) as the `skillType` argument to `push()`.

Called:
- Once after initial setup (to sync all existing skills)
- When user clicks "Retry failed syncs" in Settings

### `setupRepo()`

Called during the setup flow.

1. `GET /repos/{repoOwner}/gitsuite-skills`
   - 200: repo exists, proceed to connect
   - 404: `POST /user/repos` with `{ name: 'gitsuite-skills', private: true, auto_init: true }`
     - Note: `auto_init: true` creates a root `README.md` with its own SHA. Skill pushes go to sub-paths (`microsoft/vscode.skill.md`) and do not conflict with this file.
2. On success: write config via `setSyncEnabled(true)` + `setSyncRepoOwner(username)`; trigger `pushAll()` for any existing skills
3. Return `{ ok: true, repoUrl }` to renderer to show connected state
4. On failure: return error to renderer; show error in dialog

---

## Renderer IPC — Push Events

`skillSync:syncFailed` is a main-to-renderer push event, not a request/response handler. Following the `callbackWrappers` pattern in `preload.ts`:

```ts
// preload.ts additions
skillSync: {
  onSyncFailed: (cb) => {
    const wrapped = (_e, payload) => cb(payload)
    ipcRenderer.on('skillSync:syncFailed', wrapped)
    callbackWrappers.set(cb, wrapped)
  },
  offSyncFailed: (cb) => {
    const wrapped = callbackWrappers.get(cb)
    if (wrapped) { ipcRenderer.removeListener('skillSync:syncFailed', wrapped); callbackWrappers.delete(cb) }
  }
}
```

The renderer subscribes in Settings or a global toast handler and displays the failure notification.

---

## Repo Structure

```
gitsuite-skills/
  README.md               (auto-created by GitHub on repo init)
  microsoft/              (skill-source repo owner — not the authenticated user)
    vscode.skill.md
    vscode.components.skill.md
    vscode@main.skill.md
  facebook/
    react.skill.md
  ...
```

Paths mirror the existing local structure under `${userData}/skills/`. Sub-skills (components, versioned refs) use their existing filename conventions and are synced via `push()` with the appropriate `skillType`.

---

## Error Handling & Notifications

| Scenario | Behaviour |
|---|---|
| Single push fails (network, rate limit, auth) | `sync_status = 'failed'`; `skillSync:syncFailed` event → toast: "Skill sync failed for `{owner}/{repo}` — [Retry]" |
| `pushAll()` has partial failures | Each item marked independently; batch completes; Settings shows failed count with "Retry failed syncs" button |
| Auth error during push | Toast prompts user to reconnect GitHub |
| User is offline at generation time | Push fails immediately; user retries from Settings when online |

No silent background retries. The user always decides when to retry.

**Disconnect behaviour:** calls `setSyncEnabled(false)`. Existing `github_sha` values are preserved in the DB so that reconnecting later resumes updates rather than re-pushing every file as new.

---

## Files Affected

| File | Change |
|---|---|
| `electron/services/skillSyncService.ts` | New — `push()`, `pushAll()`, `setupRepo()`; receives `BrowserWindow` ref at construction |
| `electron/github.ts` | Add `createRepo()`, `putFileContents()` GitHub API helpers |
| `electron/db.ts` | Migration: add `github_sha`, `synced_at`, `sync_status` to `skills` + `sub_skills` |
| `electron/store.ts` | Add `skillSyncStore` instance + `getSyncEnabled`, `setSyncEnabled`, `getSyncRepoOwner`, `setSyncRepoOwner` helpers |
| `electron/main.ts` | Hook `skillSyncService.push()` into `skill:generate` handler; add `skillSync:setup`, `skillSync:disconnect`, `skillSync:retryFailed` IPC handlers |
| `electron/preload.ts` | Expose `skillSync` IPC methods + `onSyncFailed`/`offSyncFailed` push-event listeners using `callbackWrappers` pattern |
| `src/views/Settings.tsx` | Add "Skills Backup" card |
| `src/env.d.ts` | Add `skillSync` typings |
