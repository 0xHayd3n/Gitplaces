# Repo Notes — Design Spec

**Date:** 2026-05-02  
**Status:** Approved

## Overview

Add a personal notes section to the repo detail right panel, positioned above the Stats tile. Notes are stored locally in SQLite and synced to the user's private `gitsuite-skills` GitHub backup repo as plain markdown files.

---

## Decisions

| Question | Decision |
|---|---|
| Save behavior | Autosave with 1.5s debounce after typing stops |
| Sync timing | Queued background sync (same pattern as `skillSyncService`) |
| Markdown support | Rendered preview by default; click to edit (Notion-style) |
| Conflict resolution | GitHub is source of truth on app start — pull if remote is newer |
| DB storage | Separate `repo_notes` table (not a column on `repos`) |
| Sync service | New `notesSyncService.ts` modeled on `skillSyncService.ts` |

---

## Data Layer

### New table: `repo_notes`

```sql
CREATE TABLE IF NOT EXISTS repo_notes (
  repo_id      TEXT PRIMARY KEY REFERENCES repos(id),
  notes        TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL DEFAULT 0,
  sync_status  TEXT NOT NULL DEFAULT 'pending',
  synced_at    INTEGER,
  github_sha   TEXT
);
```

Added to `electron/db.ts` alongside existing table definitions. `CREATE TABLE IF NOT EXISTS` is idempotent — no migration script needed.

### IPC handlers (`electron/main.ts`)

- `notes:get(repoId)` → returns `{ notes, updated_at } | null`
- `notes:set(repoId, notes)` → upserts row, sets `updated_at = Date.now()`, `sync_status = 'pending'`, enqueues a `pushNote` call
- `notes:pullFromGitHub(repoId, owner, repoName)` → fetches remote file, compares timestamps, overwrites local if remote is newer

### Preload bridge (`electron/preload.ts`)

```ts
notes: {
  get:             (repoId: string) => ipcRenderer.invoke('notes:get', repoId),
  set:             (repoId: string, notes: string) => ipcRenderer.invoke('notes:set', repoId, notes),
  pullFromGitHub:  (repoId: string, owner: string, repoName: string) => ipcRenderer.invoke('notes:pullFromGitHub', repoId, owner, repoName),
}
```

---

## Sync — `notesSyncService.ts`

New file: `electron/services/notesSyncService.ts`

### File path in private repo

`notes/{owner}/{repo-name}.md`  
Example: `notes/facebook/react.md`

Plain markdown, human-readable when browsed on GitHub directly.

### File format

```markdown
<!-- updated: 1746123456789 -->
Good for **auth flows** — check the `src/auth` dir first.

- OAuth2 with refresh tokens
- Rate limits: 5000 req/hr
```

The `<!-- updated: ... -->` comment is invisible when rendered on GitHub and carries the epoch-ms timestamp used for conflict resolution. The timestamp is always on the first line; parsing extracts it with a simple regex on line 1: `/^<!-- updated: (\d+) -->$/`.

### Key functions

- `startNotesSyncService(db, win)` — captures db/win refs at startup
- `pushNote(repoId, owner, repoName, content)` — calls `putFileContents` with the stored `github_sha`; updates `sync_status` + `github_sha` on success, marks `failed` on error
- `pushAllPendingNotes()` — bulk push of all `pending | failed` rows with 250ms delay between calls; called as fire-and-forget from `main.ts` immediately after `startNotesSyncService()` at app startup (same pattern as `skillSyncService` calling `pushAll()` from `setupRepo`)

### Conflict resolution (pull on app start)

Called lazily when `RepoDetail` mounts, only if sync is enabled and the repo has a note with a `github_sha`:

1. Fetch `notes/{owner}/{repoName}.md` from GitHub API
2. Decode base64, parse `<!-- updated: N -->` timestamp
3. If remote `updated` > local `updated_at` → overwrite local row, store new `github_sha`, mark `synced`
4. If local is newer or equal → no-op (local wins, will push on next sync)

---

## UI Component

### `src/components/RepoNotes.tsx`

Self-contained component. All notes logic stays here — nothing leaks into `RepoDetail.tsx`.

**On mount:**
- Calls `window.api.notes.get(repoId)`
- If sync enabled and `github_sha` exists, fires `notes:pullFromGitHub` to check for newer remote copy

**Interaction model:**
- Default state: rendered markdown (via `react-markdown` or `marked` — whichever is already in the bundle)
- Click anywhere on the rendered content → textarea opens with raw markdown source
- Click outside / blur → returns to preview mode
- Empty state: dim italic "Click to add notes... (markdown supported)" — clicking opens textarea directly

**Autosave:**
- 1.5s debounce after last keystroke
- Shows `saving...` during debounce, `✓ saved` after IPC resolves

**Textarea styling:**
- `resize: none` — no OS resize grip
- `max-height: 160px`, then scrolls
- 3px custom scrollbar: `scrollbar-width: thin`, thumb `rgba(255,255,255,0.15)` blending into the dark box

### Integration in `RepoDetail.tsx`

`<RepoNotes>` inserted as the first child of the `.stats-sidebar` div, above the Stats tile. No other changes to `RepoDetail.tsx`.

### Styling

New `.repo-notes-*` classes added to `src/styles/globals.css`, following the existing `.stats-sidebar` / `.stats-tile` pattern.

---

## Files Touched

| File | Change |
|---|---|
| `electron/db.ts` | Add `repo_notes` table definition |
| `electron/main.ts` | Add `notes:get`, `notes:set`, `notes:pullFromGitHub` IPC handlers; call `startNotesSyncService` at startup |
| `electron/preload.ts` | Expose `window.api.notes.get`, `window.api.notes.set`, and `window.api.notes.pullFromGitHub` |
| `electron/services/notesSyncService.ts` | New file — push/pull note sync logic |
| `src/components/RepoNotes.tsx` | New file — notes tile component |
| `src/styles/globals.css` | Add `.repo-notes-*` styles |
| `src/views/RepoDetail.tsx` | Insert `<RepoNotes>` at top of `statsSlotNode` |
