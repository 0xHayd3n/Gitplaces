# Library sidebar redesign

**Date:** 2026-05-23
**Status:** Design — ready for implementation plan

## Summary

Simplify the Library sidebar by removing the left NavRail and the six filter-mode chips. Replace them with a compact two-row top bar (home icon + Repos/Collections icon toggle on row 1, full-width search input on row 2). Archived and recently-unstarred repos move into collapsible sections pinned at the bottom of the list.

## Goals

- Reduce the sidebar's chrome to what's used in practice.
- Make repository navigation feel like search-driven browsing, not filter-driven categorization.
- Keep Collections accessible without a dedicated rail.
- Preserve mini-mode (78px) behavior when the Files/Components tab is active.

## Non-goals

- Visual restyling of `SidebarRepoRow` or `CollectionsSidebar` row markup.
- Changes to the main detail area, activity feed, or routing structure outside what's required to drop NavRail.
- Adding new filter dimensions or new search syntax. Search is a plain substring match.

## Current state

The Library view (`src/views/Library.tsx`) renders three columns:

1. `<NavRail>` (44px) — logo + two toggle icons that switch between Repos and Collections panels.
2. `<LibrarySidebar>` or `<CollectionsSidebar>` (220px, only one visible at a time per `activePanel`).
3. Main detail area.

`<LibrarySidebar>` contains:

- A `REPOSITORIES` header strip.
- A single-button row with an `Activity` button (navigates to `/library`).
- A row of six filter chips: All, Learned, Unstarred, Own, Recent, Archive (driven by `SEGMENTS` array, `activeSegment` state, and `filterLibraryEntries` in `src/lib/libraryFilter.ts`).
- The filtered list of repos + local projects.

`<CollectionsSidebar>` is a parallel component with a `COLLECTIONS` header and a list of collections.

When the URL matches `/library/collection/:id`, `Library.tsx` auto-switches `activePanel` to `'collections'`.

## Proposed design

### Implementation approach

Rewrite `LibrarySidebar` in place to own the new top bar and the mode toggle. `CollectionsSidebar` stays as its own component and is rendered conditionally from inside `LibrarySidebar` when the toggle is set to Collections. `Library.tsx` is simplified to render only one column (the new sidebar) plus the main area.

Alternatives considered and rejected:

- Unifying `LibrarySidebar` and `CollectionsSidebar` into one component. Rejected because it rewrites a working component for marginal gain.
- Splitting into `LibraryTopBar` + `LibraryList` sub-components. Rejected as premature abstraction for the scope of the change.

### Component structure

```
<LibrarySidebar>
  <TopBar>
    <HomeButton onClick={navigate('/library')} />
    <ModeToggle value={mode} onChange={setMode} />        // row 1
    <SearchInput value={searchTerm} onChange={setSearchTerm} />  // row 2
  </TopBar>
  {mode === 'repos'
    ? <RepoList ... />              // includes collapsible Archived + Unstarred sections
    : <CollectionsSidebar searchTerm={searchTerm} ... />}
</LibrarySidebar>
```

`TopBar`, `HomeButton`, `ModeToggle`, `SearchInput`, and `RepoList` are inline within `LibrarySidebar.tsx` (sub-functions or JSX blocks), not separate component files — they are not reused elsewhere.

### Top bar — full mode (240px wide)

**Row 1** (8px vertical padding, 10px horizontal):

- Home button: 26×26, rounded 4px, border `1px solid var(--glass-border)`, background `rgba(255,255,255,0.08)`. Icon is a square/home glyph. `onClick` navigates to `/library`. Adds `.active` styling when `location.pathname === '/library'` (same logic as today's Activity button).
- Mode toggle: segmented control filling remaining width. Two buttons (Repos / Collections) inside one bordered container. Active button has filled background `rgba(255,255,255,0.12)`, inactive is transparent with muted color. Icons:
  - Repos: three horizontal bars (same SVG as today's `NavRail` `ReposIcon`).
  - Collections: stacked squares (same SVG as today's `NavRail` `CollectionsIcon`).
- Gap between home and toggle: 8px.

**Row 2** (0 top, 8px bottom, 10px horizontal):

- Styled native `<input type="text">` with a search-glyph SVG positioned absolutely or as a flex-item prefix. Full width within the row. Placeholder text:
  - Repos mode: `Search repositories`
  - Collections mode: `Search collections`
- 4px padding, 1px border, `rgba(255,255,255,0.04)` background. No border on focus other than a color shift (consistent with existing toolbar inputs).
- Bottom border on row 2 separates the top bar from the list.

### List — Repos mode

Renders these in order:

1. **Main entries:** today's combined `installedRows` + `starredRows` (non-archived) + `localProjects`, filtered by the search term. The combined-entries logic from today's `allEntries` `useMemo` stays. The six-mode filter via `filterLibraryEntries` is replaced with a simple search filter:
   - For repo entries: match if `searchTerm` is empty OR `row.name.toLowerCase().includes(q) || row.owner.toLowerCase().includes(q)`.
   - For local-project entries: match if empty OR `project.name.toLowerCase().includes(q)`.
   - Archived repos are excluded here (they appear in the Archived section instead).
2. **Archived section** — collapsible, default collapsed. Header reads `▸ Archived (N)`. Body uses the same `SidebarRepoRow` markup. Filtered by the same search term. Section hides entirely if no items match.
3. **Recently unstarred section** — collapsible, default collapsed. Header reads `▸ Recently unstarred (N)`. Body uses `unstarredRows` filtered by the same search term. Section hides entirely if no items match.

Collapsed state is local component state (does not persist across sessions in this design — can be added later if requested).

### List — Collections mode

Renders `<CollectionsSidebar searchTerm={searchTerm} selectedId={collSelectedId} onSelect={handleCollSelect} />`. `CollectionsSidebar` gains an optional `searchTerm` prop and filters its `collections` list by `name.toLowerCase().includes(q)`. If `searchTerm` is omitted, behaves as today.

The `COLLECTIONS` header inside `CollectionsSidebar` is removed (the mode toggle now indicates context).

### Mode state and routing

- Local state in `LibrarySidebar`: `const [mode, setMode] = useState<'repos' | 'collections'>('repos')`.
- The URL-driven auto-switch from `Library.tsx` moves into `LibrarySidebar`:
  - `useMatch('/library/collection/:id')` — on transition (new collection ID), force `mode = 'collections'`.
  - `useMatch('/library/repo/:owner/:name')` — on transition (new owner/name), force `mode = 'repos'`.
  - Implemented as two `useEffect`s whose dependency arrays are the matched **params** (e.g., `[collMatch?.params.id]`), not the match objects themselves. This guarantees the effect fires only when the URL actually transitions — clicking the toggle while staying on the same URL won't get clobbered by the effect re-firing.
- Switching mode via the toggle resets `searchTerm` to `''` (avoids confusion about which list is filtered). The URL-driven mode switch does NOT reset the search term (user may be navigating between repos with a search active).

### Search behavior

- Local state in `LibrarySidebar`: `const [searchTerm, setSearchTerm] = useState('')`.
- Live filter, no debounce (lists are small — dozens of items, not thousands).
- Case-insensitive substring match.
- Applies to main list, Archived section, and Recently unstarred section in Repos mode.
- Applies to collections list in Collections mode.

### Mini mode (78px)

Triggered today by `library-panel.mini` class when `repoNav.activeTab === 'files' || 'components'`. Behavior in the new design:

- **Top bar reflows vertically.** Home button on its own (centered, 36×36, rounded 6px). Mode toggle becomes a vertical 2-button stack (each 32×22, container border kept) directly below.
- **Search input hides** entirely (`display: none`).
- **Repo list shows avatars only**, same as today's mini behavior. Avatar size 46×46, rounded 11px, installed items get the white glow ring.
- **Archived and Recently unstarred sections hide entirely** in mini mode (no room).
- **Bottom border under top bar hides** in mini mode (already-tight space).

### Files touched

**Rewrite:**

- `src/components/LibrarySidebar.tsx` — new top bar, mode state, search state, sub-render functions.
- `src/components/LibrarySidebar.css` — new top-bar styles, removed filter styles, mini-mode reflow.
- `src/views/Library.tsx` — drop NavRail import + render, drop `activePanel` state, drop separate Collections column, drop the URL→panel auto-switch effect.

**Small change:**

- `src/components/CollectionsSidebar.tsx` — accept optional `searchTerm` prop; filter `collections` by name when set; remove the `COLLECTIONS` header element.

**Delete:**

- `src/components/NavRail.tsx`
- `src/lib/libraryFilter.ts` and `src/lib/libraryFilter.test.ts` (no longer used; archive-hiding logic moves inline).
- The `ActiveSegment` type export from `src/types/library.ts` (only this line — keep `LocalProject` and `LibraryEntry` exports, they are used elsewhere).

**Tests to update:**

- `src/views/Library.test.tsx` — expectations around NavRail/panels.
- `src/components/CollectionsSidebar.test.tsx` — new `searchTerm` behavior.
- Any existing `LibrarySidebar` tests (rerun after rewrite; expect rewrites of segment-related tests).

## Behavior matrix

| Action | Result |
|---|---|
| Click home button | Navigate to `/library` (Activity feed) |
| Click Repos toggle when on Collections | Switch mode, clear search, list shows repos |
| Click Collections toggle | Switch mode, clear search, list shows collections |
| Type in search (Repos mode) | Filter main list + Archived + Unstarred sections by name/owner |
| Type in search (Collections mode) | Filter collections by name |
| Navigate to `/library/collection/:id` directly | Mode forced to `collections` |
| Navigate to `/library/repo/:owner/:name` directly | Mode forced to `repos` |
| Files/Components tab opens (mini mode) | Top bar reflows vertically, search hides, sections hide |
| Click `▸ Archived (N)` | Section expands; click again to collapse |
| Archived section has 0 matches | Header hides entirely |

## Open questions

None — all behavior decisions resolved during brainstorming.

## Risks and notes

- **`filterLibraryEntries` deletion:** Confirm no other component imports it before deleting. A grep for `filterLibraryEntries` and `ActiveSegment` is required as the first step of implementation.
- **`COLLECTIONS` header removal:** If `CollectionsSidebar` is rendered anywhere else in the app, the header removal could regress that context. Grep `<CollectionsSidebar` to verify it's only used from `Library.tsx`. If used elsewhere, gate the header on a prop.
- **Collapsed-section state persistence:** Currently scoped to in-memory only. If user wants this to persist across page loads, add later via `localStorage`.
- **`recentVisits` no longer surfaces in sidebar:** Today the Recent filter highlighted recent repos. Recent visits still record (used elsewhere) but are no longer surfaced in the sidebar. If discoverability matters, can revisit later.
