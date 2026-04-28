# Repo Update Notifications Design

**Date:** 2026-04-29
**Status:** Approved

## Overview

Add update detection and actioning to the Library. When a saved repo receives a new GitHub release or new commits, a blue name indicator appears in the Library list/grid. The user clicks an update button to review changes and confirm the update. Auto-update mode (off by default) applies updates silently without confirmation.

Two update paths exist based on the repo's relationship to the user:
- **Forked repos** — user has a GitHub fork; update = fork sync via GitHub's merge-upstream API
- **Learned repos** — repo has installed skills; update = skill file regeneration with latest repo data

A repo can be both forked and learned; both paths are available independently.

---

## Data Model

### DB Migration — Phase 23

Five new columns on the `repos` table:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_forked` | `INTEGER` | `0` | Authenticated GitHub user has a fork of this repo |
| `update_available` | `INTEGER` | `0` | Update detected, waiting for user action |
| `update_checked_at` | `INTEGER` | `NULL` | Unix timestamp of last check |
| `upstream_version` | `TEXT` | `NULL` | Latest release tag (e.g. `v2.1.0`) or latest commit SHA |
| `stored_version` | `TEXT` | `NULL` | Version/SHA at last save or update |

`RepoRow` in `src/types/repo.ts` gains all five fields. `LibraryRow` extends `RepoRow` and picks them up automatically.

### Settings Keys

| Key | Default | Purpose |
|---|---|---|
| `autoUpdateEnabled` | `"false"` | Enable silent auto-update |
| `updateCheckIntervalHours` | `"24"` | Polling interval in hours |

---

## Backend Service

### `electron/services/updateService.ts`

Mirrors the existing `verificationService.ts` pattern. Registered in `electron/main.ts` alongside other services.

**Lifecycle:**
- `start()` — reads `updateCheckIntervalHours` from settings, starts `setInterval`, runs `checkAll()` immediately on first tick
- `stop()` — clears the interval; called on app quit or when interval setting changes before restarting
- Restarting the interval (on settings change): `stop()` → read new interval → `start()`

**`checkAll()`:**
1. Query all repos from the library DB
2. Process in batches of 10 with a short delay (500ms) between batches to stay within GitHub's 5,000 req/hr authenticated rate limit
3. Call `checkRepo(repo)` for each
4. Write results to DB
5. Emit `update:status-changed` IPC event with array of changed repo IDs

**`checkRepo(repo)`** — two-step update detection:
1. `GET /repos/{owner}/{name}/releases/latest` — if a release exists, compare `tag_name` vs `stored_version`
2. If no releases (404 response), fall back to `GET /repos/{owner}/{name}` — compare `pushed_at` vs `stored_version`

If newer: set `update_available = 1`, write `upstream_version`, update `update_checked_at`.

**`checkIsFork(owner, name, githubUser)`** — called once at repo-save time, not on every poll tick:
- `GET /repos/{githubUser}/{name}` — check response has `fork: true` and `parent.full_name === "{owner}/{name}"`
- Writes `is_forked` to the repo row

**Auto-update behaviour** — after `checkRepo` detects an update and `autoUpdateEnabled` is `"true"`:
- Forked repo → call `applyForkSync(repo)` immediately
- Learned repo → call `applySkillRegen(repo)` immediately
- Both emit a toast notification via IPC: `"Auto-updated: {owner}/{name}"`

---

## IPC Layer

### `electron/ipc/updateHandlers.ts`

**Renderer → Main:**

| Channel | Payload | Response | Purpose |
|---|---|---|---|
| `update:get-changes` | `{ id: number }` | `UpdateChanges` | Fetch diff/release notes before user confirms |
| `update:apply-fork-sync` | `{ id: number }` | `{ ok: boolean, error?: string }` | Execute merge-upstream, clear `update_available` |
| `update:apply-skill-regen` | `{ id: number }` | `{ ok: boolean, error?: string }` | Trigger skill regeneration pipeline |
| `update:check-now` | — | — | Trigger immediate `checkAll()` outside normal interval |

**`UpdateChanges` type:**
```ts
type UpdateChanges = {
  type: 'release' | 'commits';
  releaseNotes?: string;       // markdown, if type === 'release'
  commits?: CommitSummary[];   // if type === 'commits' or supplementary
  upstreamVersion: string;
};

type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
};
```

**Main → Renderer (IPC event):**

| Event | Payload | Purpose |
|---|---|---|
| `update:status-changed` | `{ ids: number[] }` | Fires after polling when `update_available` or `is_forked` changes; renderer re-fetches those rows |

The `update:status-changed` listener in `Library.tsx` follows the same subscription model as the existing `verification:status-changed` pattern.

---

## Library UI

### Blue Update Indicator

Applied in both `LibraryCard.tsx` and `LibraryListRow.tsx`:
- When `row.update_available === 1`, the repo name renders in a new CSS variable `--color-update-available` (blue, defined in `globals.css`)
- No layout change — only the name color shifts

### Fork Icon

When `row.is_forked === 1`:
- A `GitFork` icon (lucide-react) appears to the right of the name
- Sits in the same indicator slot as the existing `hasSubSkill` Boxes icon
- Both icons can appear simultaneously for repos that are forked and have sub-skills

### Update Button

When `row.update_available === 1`:
- An `ArrowUpCircle` icon button appears to the right of the fork/sub-skill indicators
- Always visible (not hover-only) — the pending action should be obvious
- Clicking opens `UpdateModal`

### `src/components/UpdateModal.tsx`

- Calls `update:get-changes` on mount; shows a spinner while fetching
- **Forked repo section**: commit list (author, message, date). "Sync Fork" button → `update:apply-fork-sync`
- **Learned repo section**: release notes (rendered markdown) or commits summary. "Regenerate Skills" button → `update:apply-skill-regen`
- **Both present**: two independent sections with separate confirm buttons
- On success: modal closes, blue indicator clears (via `update:status-changed` event), success toast shown
- On failure: error message inline in modal, modal stays open

---

## Settings — Updates Section

New section added to `Settings.tsx` after the existing "Connectors" section.

**Controls:**

| Control | Type | Default | Behaviour |
|---|---|---|---|
| Auto-update | Toggle | Off | When enabled, shows inline warning: *"Auto-update for learned repos consumes Claude API credits automatically."* Stores `autoUpdateEnabled` |
| Check interval | Number input | 24 | Hours between polls (min 1, max 168). Changing it stops and restarts the service with the new interval. Stores `updateCheckIntervalHours` |
| Last checked | Read-only text | — | Derived from the most recent `update_checked_at` across all repos: *"Last checked: X minutes ago"* |
| Check now | Button | — | Triggers `update:check-now` IPC, shows brief spinner |

Auto-update is global — there is no per-repo override. Users who want selective control leave it off (default) and act on individual blue indicators.

---

## Update Action Flows

### Fork Sync Flow
1. User clicks `ArrowUpCircle` on a forked repo
2. `UpdateModal` opens, fetches upstream commits via `update:get-changes`
3. Shows commit list between user's fork and upstream HEAD
4. User clicks "Sync Fork"
5. `update:apply-fork-sync` calls `POST /repos/{githubUser}/{repoName}/merge-upstream`
6. On success: `update_available = 0`, `stored_version` updated, modal closes, toast shown
7. On failure: error shown in modal

### Skill Regeneration Flow
1. User clicks `ArrowUpCircle` on a learned repo
2. `UpdateModal` opens, fetches release notes or commits via `update:get-changes`
3. Shows release notes (markdown) or recent commits summary
4. User clicks "Regenerate Skills"
5. `update:apply-skill-regen` re-runs the existing skill generation pipeline with latest repo data
6. On success: `update_available = 0`, `stored_version` and `generated_at` updated in skills table, modal closes, toast shown
7. On failure: error shown in modal, `update_available` unchanged

### Auto-Update Flow
1. `checkAll()` detects an update
2. `autoUpdateEnabled === "true"` → immediately calls `applyForkSync` or `applySkillRegen`
3. On success: `update_available = 0`, toast: *"Auto-updated: {owner}/{name}"*
4. On failure: `update_available` remains `1`, error logged; user sees the blue indicator and can act manually

---

## File Inventory

**New files:**
- `electron/services/updateService.ts`
- `electron/ipc/updateHandlers.ts`
- `src/components/UpdateModal.tsx`
- `src/components/UpdateModal.css`

**Modified files:**
- `electron/db.ts` — Phase 23 migration
- `electron/main.ts` — register updateService and updateHandlers
- `src/types/repo.ts` — add five new fields to `RepoRow`
- `src/components/LibraryCard.tsx` — blue name, fork icon, update button
- `src/components/LibraryListRow.tsx` — blue name, fork icon, update button
- `src/components/LibraryCard.css` / `LibraryListRow.css` — update indicator styles
- `src/styles/globals.css` — add `--color-update-available`
- `src/views/Library.tsx` — subscribe to `update:status-changed` IPC event
- `src/views/Settings.tsx` — add Updates section
