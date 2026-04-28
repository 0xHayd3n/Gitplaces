# Library Unified Sidebar Design

**Date:** 2026-04-29  
**Status:** Approved

## Overview

Unify the Library sidebar so local projects (Create sessions) appear alongside GitHub repos in a single flat list. Expand filter tabs from 3 text-label buttons to 6 icon-only buttons. Remove the Recent/Archive side rail from the Create view — those concepts move to Library as filter tabs.

## Goals

- Local projects and GitHub repos visible in one place (Library) without switching views
- Visual distinction between entry types via a small icon at the right end of each row
- Richer filtering: All, Learned, Unstarred, Own, Recent, Archive
- Create view simplified — no more tab-filtered side rail

## Data Model

### Unified entry type

Replace the internal `SidebarEntry` in `LibrarySidebar` with:

```ts
type LibraryEntry =
  | { kind: 'repo'; row: RepoRow; isInstalled: boolean; isStarred: boolean }
  | { kind: 'local'; session: CreateSession }
```

### New state in Library.tsx

```ts
sessions: CreateSession[]        // from window.api.create.getSessions()
archivedIds: Set<string>         // repo IDs + session IDs that are archived
recentIds: string[]              // ordered recently-viewed IDs (repos + sessions)
githubUsername: string | null    // from GitHubAuthContext, used for Own filter
```

All four fetched inside `refreshAll` alongside existing `installedRows`, `starredRows`, `unstarredRows`.

### ActiveSegment expansion

```ts
type ActiveSegment = 'all' | 'active' | 'unstarred' | 'own' | 'recent' | 'archive'
```

## Filter Tab Logic

| Tab | Icon | Includes |
|---|---|---|
| All | Layers | All GitHub repos (installed + starred) + all local sessions |
| Learned | Brain | GitHub repos: `installed=1 AND active=1` only |
| Unstarred | DashedStar | GitHub repos: `unstarred_at` within last 30 days only |
| Own | User | GitHub repos where `owner === githubUsername` + all local sessions |
| Recent | History | Any entry whose ID is in `recentIds`, ordered by recency |
| Archive | Archive | GitHub repos in `archivedIds` + archived local sessions |

Learned and Unstarred intentionally exclude local sessions — those concepts don't apply to them.

## LibrarySidebar Changes

### New props

```ts
sessions: CreateSession[]
archivedIds: Set<string>
recentIds: string[]
githubUsername: string | null
```

### Filter row

6 icon-only `<button>` elements replacing the 3 text segment buttons. Same `library-sidebar-seg` / `active` CSS pattern. Each button gets a `title` attribute for tooltip discoverability. No text labels.

### Row rendering

- **`repo` entry**: existing avatar `<img>` + name + small GitHub mark SVG at right end (opacity ~0.45)
- **`local` entry**: purple folder SVG as avatar (no `<img>`) + session name + small clipboard/local SVG at right end (opacity ~0.55, purple tint)

Clicking a `local` entry navigates to `/local-project` passing the session ID (same route `LocalProjectDetail` already handles).

Clicking a `repo` entry navigates to `/library/repo/:owner/:name` (unchanged).

### Filter logic inside LibrarySidebar

```
all      → repo entries (installed + starred) + local entries
active   → repo entries where isInstalled && row.active === 1
unstarred → unstarredRows mapped to repo entries
own      → repo entries where row.owner === githubUsername + local entries
recent   → all entries whose ID appears in recentIds, sorted by recentIds order
archive  → repo entries whose row.id is in archivedIds + local entries where session is archived
```

## Library.tsx Changes

- Import `CreateSession` from `../types/create`
- Add `sessions`, `archivedIds`, `recentIds`, `githubUsername` state
- Extend `refreshAll` to fetch sessions, archived IDs, and recent IDs
- Read `githubUsername` from `GitHubAuthContext`
- Pass all four new props down to `LibrarySidebar`

## Create View Changes

- Remove `ProjectsSideRail` import and usage from `Create.tsx`
- Remove `activeTab: SideRailTab` state and `handleTabChange` handler
- Remove the `SideRailTab`-based filtering of sessions passed to child components — show all sessions in one flat grid
- `ProjectsSideRail.tsx` and `ProjectsSideRail.css` can be deleted (no other consumers)

## Visual Design

- Type icon sits flush at the right end of each row item, ~11px, low opacity
- GitHub repos: GitHub mark icon
- Local projects: clipboard/local icon with purple tint to match the purple folder avatar
- Local project avatar: purple folder SVG in a `rgba(167,139,250,0.12)` rounded box, same 20×20 dimensions as repo avatars
- 6 icon buttons spread evenly across the sidebar width (~28px each in a 220px panel)

## Out of Scope

- No changes to RepoDetail, CollectionsSidebar, or CollectionDetail
- No changes to the NavRail (Repos / Collections toggle)
- No new IPC handlers — uses existing `window.api.create.getSessions()`, existing archive IPC, existing `recentVisits` lib
