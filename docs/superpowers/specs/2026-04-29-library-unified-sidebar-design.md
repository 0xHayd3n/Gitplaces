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

---

## Data Model

### Unified entry type

Replace the internal `SidebarEntry` in `LibrarySidebar` with:

```ts
type LibraryEntry =
  | { kind: 'repo'; row: RepoRow; isInstalled: boolean; isStarred: boolean }
  | { kind: 'local'; session: CreateSession }
```

### ActiveSegment type

Expand (currently local to `LibrarySidebar.tsx`, keep it there and re-export):

```ts
export type ActiveSegment = 'all' | 'active' | 'unstarred' | 'own' | 'recent' | 'archive'
```

---

## Archive Mechanism

### GitHub repos (existing)
Unchanged. `useArchivedRepos` hook persists `Set<string>` of `"owner/name"` keys via `window.api.settings.get/set('archived_repos')`.

### Local sessions (new)
A parallel mechanism using a separate settings key `'archived_sessions'` (same pattern as `archived_repos`). Store a `Set<string>` of session IDs.

- New hook `useArchivedSessions` in `src/hooks/useArchivedSessions.ts` mirroring `useArchivedRepos`, with `toggle(id: string)` (single-arg, unlike `useArchivedRepos.toggle(owner, name)`)
- `Library.tsx` calls both hooks and passes:
  - `archivedRepoKeys: Set<string>` — for repo entries (`"owner/name"` format)
  - `archivedSessionIds: Set<string>` — for local entries (session UUID)

The Archive filter shows repo entries whose `"owner/name"` key is in `archivedRepoKeys` + local entries whose `session.id` is in `archivedSessionIds`.

---

## Recent Mechanism

`recentVisits` (existing) is a **localStorage** lib, not IPC. It stores `RecentEntry[]` keyed by `owner/name`. It is not suitable for session IDs and must not be called inside `refreshAll`.

### GitHub repos (existing)
Unchanged. `getRecentVisits()` returns `RecentEntry[]` with `owner`, `name`, `visitedAt`. Continue recording repo visits via `recordRecentVisit` on navigation.

### Local sessions (new)
A new parallel localStorage module `src/lib/recentSessions.ts` (mirroring `recentVisits.ts`) with:
- Storage key: `'library-recent-sessions'`
- Entry shape: `{ id: string; name: string; visitedAt: number }`
- Exports: `getRecentSessions()`, `recordRecentSession(session: CreateSession)`

Call `recordRecentSession` when navigating to a local project from the Library sidebar.

### Merging in Library.tsx

Read both sources **outside** `refreshAll` (in a separate `useEffect` or directly at component mount — these are synchronous localStorage reads):

```ts
const [recentEntries, setRecentEntries] = useState<RecentLibraryEntry[]>([])

// RecentLibraryEntry — define in src/types/library.ts (new file):
type RecentLibraryEntry =
  | { kind: 'repo'; owner: string; name: string; visitedAt: number }
  | { kind: 'local'; id: string; visitedAt: number }
```

Refresh `recentEntries` on each navigation into a repo or session (after recording the visit). Pass the merged list as `recentEntries` to `LibrarySidebar`.

The Recent filter matches entries by:
- repo entry: match if `"${row.owner}/${row.name}"` appears in `recentEntries` where `kind === 'repo'`
- local entry: match if `session.id` appears in `recentEntries` where `kind === 'local'`

Sort matched entries by `visitedAt` descending.

---

## Filter Tab Logic

| Tab | Icon | Includes |
|---|---|---|
| All | Layers | All GitHub repos (installed + starred) + all local sessions |
| Learned | Brain | GitHub repos: `installed=1 AND active=1` only |
| Unstarred | DashedStar | GitHub repos: `unstarred_at` within last 30 days only |
| Own | User | GitHub repos where `owner === githubUsername` + all local sessions |
| Recent | History | Entries in `recentEntries`, sorted by `visitedAt` desc |
| Archive | Archive | GitHub repos whose `"owner/name"` is in `archivedRepoKeys` + sessions in `archivedSessionIds` |

Learned and Unstarred intentionally exclude local sessions — those concepts don't apply to them.

### Empty state strings

| Tab | Empty state |
|---|---|
| All | `'No repos or projects'` |
| Learned | `'No active skills'` |
| Unstarred | `'Nothing unstarred in the last 30 days'` (existing) |
| Own | `'No repos or projects owned by you'` |
| Recent | `'Nothing viewed recently'` |
| Archive | `'Nothing archived'` |

---

## LibrarySidebar Changes

### New props

```ts
sessions: CreateSession[]
archivedRepoKeys: Set<string>
archivedSessionIds: Set<string>
recentEntries: RecentLibraryEntry[]
githubUsername: string | null
```

### Filter row

6 icon-only `<button>` elements replacing the 3 text segment buttons. Same `library-sidebar-seg` / `active` CSS pattern. Each gets a `title` attribute for tooltip discoverability. No text labels.

### Row rendering

- **`repo` entry**: existing avatar `<img>` + name + small GitHub mark SVG at right end (opacity ~0.45)
- **`local` entry**: purple folder SVG as avatar (no `<img>`) + session name + small clipboard icon at right end (opacity ~0.55, purple tint `#a78bfa`)

### Context menu

Local entries (`kind === 'local'`) do **not** get the existing `RepoContextMenu`. Suppress `onContextMenu` for local entries (no-op or prevent default only). A context menu for local entries is out of scope for this feature.

### Navigation

- Clicking a `repo` entry: `navigate('/library/repo/:owner/:name')` (unchanged)
- Clicking a `local` entry: `navigate('/local-project?sessionId=${session.id}')` — `LocalProjectDetail` reads via `useSearchParams()`, so query params are required; also calls `recordRecentSession(session)`

---

## Library.tsx Changes

- Import `CreateSession` from `../types/create`
- Import `useArchivedSessions` from `../hooks/useArchivedSessions`
- Import `getRecentVisits` from `../lib/recentVisits` and `getRecentSessions` from `../lib/recentSessions`
- Add `sessions: CreateSession[]` state, fetch via `window.api.create.getSessions()` inside `refreshAll`
- Add `archivedRepoKeys` from `useArchivedRepos` (already used elsewhere via hook)
- Add `archivedSessionIds` from `useArchivedSessions`
- Add `recentEntries: RecentLibraryEntry[]` state, populated by reading `getRecentVisits()` + `getRecentSessions()` and merging/sorting by `visitedAt` — refresh this after any navigation that records a visit
- Read `githubUsername` via `useGitHubAuth().user?.login ?? null`
- Pass all new props to `LibrarySidebar`

---

## Create View Changes (TemplateGallery.tsx)

The `activeTab: SideRailTab` state, `handleTabChange`, `ProjectsSideRail` usage, and the tab-based filtering of sessions live in `src/components/create/TemplateGallery.tsx` (not `Create.tsx`).

Changes to `TemplateGallery.tsx`:
- Remove `ProjectsSideRail` import and render
- Remove `activeTab` state and `handleTabChange`
- Remove tab-based session filtering — pass all sessions directly to the grid

`src/components/create/ProjectsSideRail.tsx` and `ProjectsSideRail.css` are deleted (no other consumers).

---

## New Files

| File | Purpose |
|---|---|
| `src/hooks/useArchivedSessions.ts` | Persists archived session IDs to `'archived_sessions'` settings key |
| `src/lib/recentSessions.ts` | localStorage module for recent session visits |
| `src/types/library.ts` | Shared types: `LibraryEntry`, `RecentLibraryEntry` |

---

## Visual Design

- Type icon sits flush at the right end of each row item, ~11px, low opacity
- GitHub repos: GitHub mark icon (`opacity: 0.45`)
- Local projects: clipboard icon with `color: #a78bfa`, `opacity: 0.55`
- Local project avatar: purple folder SVG in `rgba(167,139,250,0.12)` rounded box, same 20×20 as repo avatars
- 6 icon buttons spread evenly across the sidebar width (~28px each in a 220px panel)

---

## Out of Scope

- No context menu for local project entries
- No changes to RepoDetail, CollectionsSidebar, or CollectionDetail
- No changes to the NavRail (Repos / Collections toggle)
- No new IPC handlers for recent visits — all localStorage
