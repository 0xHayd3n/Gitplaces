# Projects Side Rail, Recent & Archive — Design Spec

**Date:** 2026-04-29
**Status:** Approved

---

## Overview

Add a permanent side rail to the Projects (Create) page containing two tabs — **Recent** and **Archive** — each revealing a sidebar panel with a library-style repo list. Also add an **Archive** action button to the RepoDetail action bar, and update the default column count in the Projects grid.

This feature is scoped entirely to the Projects/Create page. No other routes are affected.

---

## Layout

The `TemplateGallery` component is restructured from a single-column layout to a horizontal three-column shell:

```
[SideRail 48px] | [Panel 240px] | [Main gallery flex:1]
```

All three columns are **always present in the layout** — no push animation, no collapsing. The panel space is permanently reserved. One tab is always active (defaults to Recent). Switching tabs changes panel content in place; there is no way to close the panel.

### SideRail
- Width: 48px, sits against the left edge of the Projects page
- Contains two icon-only tab buttons stacked vertically, top-aligned
- **Recent tab**: history/clock icon
- **Archive tab**: archive/box icon
- Active tab shows a short white indicator bar on its right edge; inactive tab is ~40% opacity
- Clicking the already-active tab does nothing (panel stays open)

### Panel
- Width: 240px fixed
- Header: small uppercase label ("RECENT" or "ARCHIVE")
- Body: scrollable list of repo entries, each: 22px avatar circle + repo name (truncated), matching `LibrarySidebar` item style
- Clicking a repo entry in either panel navigates the same way as clicking that card in the main grid
- Empty state: single centered message ("No recent repos" / "No archived repos")

---

## Data & State

### Recent (localStorage)

- Key: `projects-recent-repos`
- Format:
  ```ts
  {
    owner: string;
    name: string;
    avatar_url: string | null;
    navigatePath: string;   // fully-constructed path (see below)
    visitedAt: number;
  }[]
  ```
- `navigatePath` stores the **fully-constructed navigation path** at the time of the visit:
  - For GitHub repos: the `path` argument passed by `RepoCard` (e.g. `/repo/owner/name`)
  - For local-only repos (no GitHub match): the full constructed path, e.g. `/local-project?path=...&name=...&git=1`
  - This means `RecentPanel` can navigate directly using the stored `navigatePath` without re-deriving it
- Max 30 entries, ordered newest-first; duplicate entries (same `owner/name`) are deduplicated — the existing entry is removed and re-inserted at front with updated `visitedAt`
- Written in the `onNavigate` callback of each `RepoCard` inside `TemplateGallery`, before `navigate()` fires:
  ```ts
  onNavigate={path => {
    const actualPath = !hasGithub && localPath
      ? `/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`
      : path
    recordRecentVisit({ owner: row.owner, name: row.name, avatar_url: row.avatar_url, navigatePath: actualPath })
    navigate(actualPath)
  }}
  ```
- `recordRecentVisit` is a plain function (not a hook) that reads, deduplicates, prepends, trims to 30, and writes back to localStorage
- Read fresh on each render of `RecentPanel` (no extra state layer needed)
- Recent entries are **not filtered** against the archive set — a repo can appear in both Recent and Archive simultaneously. This is intentional: Recent is a history of visits, not a list of active repos.

### Archive (Electron settings)

- Settings key: `archived_repos`
- Format: JSON-serialised `string[]` of `"owner/name"` identifiers
- Read/written via `window.api.settings.get('archived_repos')` / `window.api.settings.set('archived_repos', value)`
- A custom hook `useArchivedRepos()` exposes:
  ```ts
  { archivedSet: Set<string>; loading: boolean; toggle: (owner: string, name: string) => void }
  ```
- **Loading state:** on mount the hook fires an async settings read; `loading` is `true` until it resolves. `TemplateGallery` should not render the repo grid (show existing skeleton) while `loading` is true, to avoid a flash where archived repos briefly appear. `RepoDetail` can seed its `archived` state once `loading` becomes false.
- **Error handling:** if `window.api.settings.get` rejects, treat as empty archive (`archivedSet = new Set()`). Follow existing codebase pattern: `.catch(() => {})`.
- **Optimistic toggle:** `toggle()` updates in-memory state immediately, then writes to settings asynchronously. On write failure the in-memory state is left as-is (no rollback) — Electron IPC failures are rare and the worst case is a stale toggle state until next app restart. This is acceptable.
- `TemplateGallery` consumes this hook to filter archived entries out of the main grid
- `ArchivePanel` receives `allEntries` as a prop (the pre-filter list, not `visibleEntries`) to resolve metadata for display

---

## New Files

| File | Purpose |
|---|---|
| `src/components/create/ProjectsSideRail.tsx` | Icon tab rail; props: `activeTab`, `onTabChange` |
| `src/components/create/ProjectsSideRail.css` | Rail + active indicator + panel wrapper styles (shared by shell, rail, and both panels) |
| `src/components/create/RecentPanel.tsx` | Recent repos list; reads from localStorage |
| `src/components/create/ArchivePanel.tsx` | Archived repos list; reads from `useArchivedRepos` |
| `src/hooks/useArchivedRepos.ts` | Settings-backed archive state + toggle |

CSS note: `ProjectsSideRail.css` covers all new structural styles — `projects-shell`, `projects-side-rail`, `projects-panel` wrapper, and panel header/list styles. `RecentPanel` and `ArchivePanel` use the same panel list classes defined there; no separate CSS files needed for those components.

---

## Modified Files

### `src/components/create/TemplateGallery.tsx`
- Wrap existing JSX in a `projects-shell` flex-row container: `[SideRail][Panel][main gallery]`
- Add `activeTab` state (`'recent' | 'archive'`, defaults to `'recent'`)
- Consume `useArchivedRepos()` — wait for `loading === false` before rendering the repo grid
- Pass `allEntries` (pre-archive-filter) to `ArchivePanel` as a prop for metadata resolution
- Record recent visit in `onNavigate` (see Recent section for exact implementation)
- **Change default columns:** `DEFAULT_COLS = 5` → `DEFAULT_COLS = 6`
- **Change column range:** options `[3, 4, 5, 6, 7]` → `[4, 5, 6, 7, 8]`

### `src/views/RepoDetail.tsx`
- Add `archived` state + `handleArchive` handler (uses `useArchivedRepos()`)
- Seed `archived` once `useArchivedRepos().loading` is false
- Add Archive `article-action-btn` button after the Fork button
  - Icon: archive/box SVG, label "Archive" / "Unarchive" based on state
  - Same pattern as Star button

---

## Archive Button — RepoDetail

The Archive button appears in the article action bar of **all** RepoDetail views (not gated to Projects context). Its effect is global: archiving a repo here hides it from the Projects grid. The button renders in the same `article-action-btn` style as Learn, Clone, Star, Fork.

State:
- `archived: boolean` — seeded on mount from `useArchivedRepos()` once loading resolves
- Toggling calls `useArchivedRepos().toggle(owner, name)`, which updates state immediately and writes to settings async

---

## Filtering in TemplateGallery

After building `allEntries` and before filtering by search query, filter out archived entries:

```ts
const visibleEntries = allEntries.filter(
  ({ row }) => !archivedSet.has(`${row.owner}/${row.name}`)
)
```

Apply the search query filter to `visibleEntries` (not `allEntries`).

Pass `allEntries` (not `visibleEntries`) to `ArchivePanel`.

---

## ArchivePanel — Metadata Resolution

`useArchivedRepos()` only stores `"owner/name"` strings. `ArchivePanel` receives the full `allEntries` array (pre-archive-filter) as a prop from `TemplateGallery` so it can look up `avatar_url` and `navigatePath` for display.

For entries in the archive set that have no match in `allEntries` (stale archive entries — repo deleted or renamed): show fallback initial avatar, display `name` portion of the `"owner/name"` key, and **disable click** (no navigation attempted since there is no valid path). This prevents a navigation to a broken route.

---

## Column Count Change

In `TemplateGallery`:
- `DEFAULT_COLS`: `5` → `6`
- Popover options array: `[3, 4, 5, 6, 7]` → `[4, 5, 6, 7, 8]`

---

## Out of Scope

- Archive does not sync to GitHub or any remote store
- No bulk archive / unarchive UI
- No sort or filter within the Recent or Archive panels
- No undo toast for archive action (may be added later)
- The side rail does not appear on any route other than `/create` (without a `sessionId`)
