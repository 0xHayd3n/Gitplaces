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
- Format: `{ owner: string; name: string; avatar_url: string | null; navigatePath: string; visitedAt: number }[]`
- Max 30 entries, ordered newest-first; duplicate entries (same `owner/name`) are deduplicated — the existing entry is moved to front with updated `visitedAt`
- Written in the `onNavigate` callback of each `RepoCard` inside `TemplateGallery`, before the navigation fires
- Read fresh on each render of `RecentPanel` (no extra state layer needed)

### Archive (Electron settings)
- Settings key: `archived_repos`
- Format: JSON-serialised `string[]` of `"owner/name"` identifiers
- Read/written via `window.api.settings.get('archived_repos')` / `window.api.settings.set('archived_repos', value)`
- A custom hook `useArchivedRepos()` handles read + optimistic updates, exposing `{ archivedSet: Set<string>; toggle: (owner: string, name: string) => void }`
- `TemplateGallery` consumes this hook to filter archived entries out of the main grid
- `ArchivePanel` consumes this hook to get the list for display; it must cross-reference the full repo list (from `allEntries`) to get metadata (avatar_url, navigatePath) for display

---

## New Files

| File | Purpose |
|---|---|
| `src/components/create/ProjectsSideRail.tsx` | Icon tab rail; props: `activeTab`, `onTabChange` |
| `src/components/create/ProjectsSideRail.css` | Rail + active indicator styles |
| `src/components/create/RecentPanel.tsx` | Recent repos list; reads from localStorage |
| `src/components/create/ArchivePanel.tsx` | Archived repos list; reads from `useArchivedRepos` |
| `src/hooks/useArchivedRepos.ts` | Settings-backed archive state + toggle |

---

## Modified Files

### `src/components/create/TemplateGallery.tsx`
- Wrap existing JSX in a `projects-shell` flex-row container: `[SideRail][Panel][main gallery]`
- Add `activeTab` state (`'recent' | 'archive'`, defaults to `'recent'`)
- Consume `useArchivedRepos()` to filter `allEntries` before rendering the grid
- Record recent visit in `onNavigate` before `navigate(path)` fires
- **Change default columns:** `DEFAULT_COLS = 5` → `DEFAULT_COLS = 6`
- **Change column range:** options `[3, 4, 5, 6, 7]` → `[4, 5, 6, 7, 8]`

### `src/views/RepoDetail.tsx`
- Add `archived` state + `handleArchive` handler (uses `useArchivedRepos()`)
- Add Archive `article-action-btn` button after the Fork button
  - Icon: archive/box SVG, label "Archive" / "Unarchive" based on state
  - Same disabled/loading pattern as Star button

---

## Archive Button — RepoDetail

The Archive button appears in the article action bar of **all** RepoDetail views (not gated to Projects context). Its effect is global: archiving a repo here hides it from the Projects grid. The button renders in the same `article-action-btn` style as Learn, Clone, Star, Fork.

State:
- `archived: boolean` — seeded on mount from `useArchivedRepos()`
- Toggling calls `useArchivedRepos().toggle(owner, name)`, which writes to settings immediately

---

## Filtering in TemplateGallery

After building `allEntries` and before filtering by search query, filter out archived entries:

```ts
const visibleEntries = allEntries.filter(
  ({ row }) => !archivedSet.has(`${row.owner}/${row.name}`)
)
```

Apply the search query filter to `visibleEntries` (not `allEntries`).

---

## ArchivePanel — Metadata Resolution

`useArchivedRepos()` only stores `"owner/name"` strings. `ArchivePanel` receives the full `allEntries` array as a prop (from `TemplateGallery`) so it can look up `avatar_url` and `navigatePath` for display. Entries in the archive set that have no matching entry in `allEntries` are shown with a fallback initial avatar.

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
