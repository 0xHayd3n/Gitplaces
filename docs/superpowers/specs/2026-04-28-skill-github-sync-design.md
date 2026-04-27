# Skill GitHub Sync — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Overview

User-generated skill files are backed up to a private GitHub repository (`gitsuite-skills`) owned by the authenticated user. The local filesystem remains the fast-path for all reads; GitHub is the write-only backup destination. Sync is one-way (local → GitHub), automatic after every skill generation or update, and uses the GitHub Contents API with a SHA cache stored in SQLite.

---

## Architecture

A new `SkillSyncService` (`electron/services/skillSyncService.ts`) is added as a thin async layer after skill generation. The existing `skill:generate` IPC handler writes to disk and DB first (unchanged), then calls `skillSyncService.push()` as a fire-and-forget side-effect. Sync failure never blocks or rolls back skill generation.

```
skill:generate IPC
  └─ write to disk + DB  (existing, unchanged)
  └─ skillSyncService.push()  (new, async, non-blocking)
        └─ GitHub Contents API PUT
        └─ update DB (sha, synced_at, sync_status)
        └─ on failure: emit skill:sync-failed IPC → toast notification
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

Three new columns added via migration:

```sql
github_sha    TEXT     -- SHA returned by GitHub after last successful push; NULL if never synced
synced_at     INTEGER  -- Unix ms timestamp of last successful push; NULL if never synced
sync_status   TEXT     -- 'synced' | 'pending' | 'failed' | NULL (sync not enabled at generation time)
```

On first connect, all existing skills with `sync_status IS NULL` are set to `'pending'` and queued for `pushAll()`.

### electron-store — `skillSync` key

```json
{
  "skillSync": {
    "enabled": true,
    "repoName": "gitsuite-skills",
    "repoOwner": "username"
  }
}
```

`repoOwner` is always the authenticated GitHub username, stored explicitly to avoid extra API calls at push time.

---

## Push Mechanism

### `push(repoId, owner, filename, content)`

Called after every skill generation or update.

1. Read `skillSync.enabled` from store — bail if false
2. Build GitHub path: `{owner}/{filename}` (e.g., `microsoft/vscode.skill.md`)
3. Look up `github_sha` from the `skills` DB row for `repoId`
4. `PUT /repos/{repoOwner}/gitsuite-skills/contents/{path}`
   - Body: `{ message, content: base64(content), sha }` — omit `sha` on first push
5. On success: write returned SHA + `Date.now()` to DB; set `sync_status = 'synced'`
6. On failure: set `sync_status = 'failed'`; emit `skill:sync-failed` IPC event to renderer

### `pushAll(statusFilter?)`

Iterates all skills (and sub_skills) matching `statusFilter` (default: `pending` or `failed`), calls `push()` for each with a 250ms delay between calls to respect GitHub rate limits. Stops on first failure and notifies the user.

Called:
- Once after initial setup (to sync all existing skills)
- When user clicks "Retry failed syncs" in Settings

### `setupRepo()`

Called during the setup flow.

1. `GET /repos/{username}/gitsuite-skills`
   - 200: repo exists, proceed to connect
   - 404: `POST /user/repos` with `{ name: 'gitsuite-skills', private: true, auto_init: true }`
2. On success: write `skillSync` config to store; trigger `pushAll()` for any existing skills
3. Return `{ ok: true, repoUrl }` to renderer to show connected state
4. On failure: return error to renderer; show error in dialog

---

## Repo Structure

```
gitsuite-skills/
  README.md               (auto-created by GitHub on repo init)
  microsoft/
    vscode.skill.md
    vscode.components.skill.md
    vscode@main.skill.md
  facebook/
    react.skill.md
  ...
```

Paths mirror the existing local structure: `skills/{owner}/{filename}`. Sub-skills (components, versioned refs) use their existing filename conventions and are synced alongside primary skills.

---

## Error Handling & Notifications

| Scenario | Behaviour |
|---|---|
| Push fails (network, rate limit, auth) | `sync_status = 'failed'`; toast: "Skill sync failed for `{owner}/{repo}` — [Retry]" |
| `pushAll()` fails mid-way | Stops; notifies user; Settings shows pending/failed count |
| Auth error during push | Toast prompts user to reconnect GitHub |
| User is offline at generation time | Push fails immediately; user retries from Settings when online |

No silent background retries. The user always decides when to retry.

**Disconnect behaviour:** sets `skillSync.enabled = false`. Existing `github_sha` values are preserved in the DB so that reconnecting later resumes updates rather than re-pushing every file as new.

---

## Files Affected

| File | Change |
|---|---|
| `electron/services/skillSyncService.ts` | New — `push()`, `pushAll()`, `setupRepo()` |
| `electron/github.ts` | Add `createRepo()`, `putFileContents()` GitHub API helpers |
| `electron/db.ts` | Migration: add `github_sha`, `synced_at`, `sync_status` to `skills` + `sub_skills` |
| `electron/store.ts` | Add `skillSync` key to store schema |
| `electron/main.ts` | Hook `skillSyncService.push()` into `skill:generate` handler; add `skillSync:setup`, `skillSync:disconnect`, `skillSync:retryFailed` IPC handlers |
| `electron/preload.ts` | Expose `skillSync` IPC methods to renderer |
| `src/views/Settings.tsx` | Add "Skills Backup" card |
| `src/env.d.ts` | Add `skillSync` typings |
