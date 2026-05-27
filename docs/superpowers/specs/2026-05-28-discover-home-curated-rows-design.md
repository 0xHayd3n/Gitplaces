# Discover home — curated rows replace the grid

**Date:** 2026-05-28
**Status:** Spec ready for plan
**Scope:** Discover view only (Home layout + three new curated rows + their expanded grid views)

## Goal

Replace the `DiscoverGrid` block on the Discover Home view with three additional curated single-row carousels, each with a clickable title that opens a dedicated full-grid "browse" view (the same pattern Recommended for You uses today). The result is a pure-rows Home page where every row is either a curated angle on the catalogue or a personalized list.

## Non-goals

- Touching the top pill nav (stays Home / Recommended / Agents).
- Touching the bottom global Dock.
- Adding new filter types or surfacing new filters in the UI.
- Reworking how Most Popular, Recommended for You, or Agents work — they stay as-is.
- Adding personalized ("Because you visited X") or topical ("Top in Rust") rows. Considered and deferred — the user picked time-fresh + hidden-gems for this pass.

## High-level shape

```
┌──────────────────────────────────────────────────────────────┐
│              [🔍]  [ Home* ]  [ Recommended ]  [ Agents ]    │   ← unchanged pill bar
│                                                              │
│  ┌────────────────────── Hero ───────────────────────┐       │
│  │                                                   │       │
│  │  title · desc · pills · owner                     │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  Recommended for You  ›                                      │   ← existing
│  [card] [card] [card] [card] [card]                          │
│                                                              │
│  Agents  ›                                                   │   ← existing
│  [agent] [agent] [agent] [agent] [agent]                     │
│                                                              │
│  Hot today  ›                                                │   ← NEW
│  [card] [card] [card] [card] [card]                          │
│                                                              │
│  Trending this week  ›                                       │   ← NEW
│  [card] [card] [card] [card] [card]                          │
│                                                              │
│  Most Popular                                                │   ← existing (no expand)
│  [card] [card] [card] [card] [card]                          │
│                                                              │
│  Hidden gems  ›                                              │   ← NEW
│  [card] [card] [card] [card] [card]                          │
└──────────────────────────────────────────────────────────────┘
```

Today's home view stacks the same three carousels (Recommended / Agents / Most Popular) and then renders a full `DiscoverGrid` below them seeded with the same popular-repos dataset. That trailing grid is what makes "Most Popular" feel like a multi-row section. We remove it on Home and use the freed vertical real estate for the three new curated rows.

## New view modes

`ViewModeKey` in [`src/lib/discoverQueries.ts`](src/lib/discoverQueries.ts) gains three values:

| Key              | Row title              | Base query                                      | Sort        |
|------------------|------------------------|-------------------------------------------------|-------------|
| `hot-today`      | Hot today              | `pushed:>{1 day ago YYYY-MM-DD}`                | stars desc  |
| `trending-week`  | Trending this week     | `pushed:>{7 days ago YYYY-MM-DD}`               | stars desc  |
| `hidden-gems`    | Hidden gems            | `pushed:>{30 days ago YYYY-MM-DD} stars:50..500`| stars desc  |

These are **deep-link-only** — they do not appear in the top pill nav. The only entry points are:

- Clicking the row's title chevron on Home (`onMore` callback → `setViewMode(key)`).
- A direct `/discover?view=hot-today` (etc.) URL.

The top nav (`DiscoverTopNav`) remains unchanged: Home / Recommended / Agents tabs only.

When a new view is active:

- `DiscoverHero` and the row stack are hidden (same condition as today's Recommended view).
- `FilterChipRow` renders above the grid.
- `DiscoverGrid` renders the row's dataset.
- Pagination via `loadMore` uses the row's base query + sort.

## Components

### 1. `src/lib/discoverQueries.ts` changes

- Extend `ViewModeKey` with `'hot-today' | 'trending-week' | 'hidden-gems'`.
- Extend `VIEW_MODES` array — though these aren't shown in the nav, keeping them in `VIEW_MODES` lets `getViewModeAccent` resolve a colour if any UI ever needs it. Suggested accents: `#ef4444` (hot-today, red), `#f97316` (trending-week, orange), `#10b981` (hidden-gems, green).
- `buildViewModeQuery(viewMode, langKey, search)` adds branches:
  - `case 'hot-today'`: `pushed:>{1d-ago}` + `langFilter` if present
  - `case 'trending-week'`: `pushed:>{7d-ago}` + `langFilter` if present
  - `case 'hidden-gems'`: `pushed:>{30d-ago} stars:50..500` + `langFilter` if present (langFilter does not displace the stars range)
- `getViewModeSort(viewMode)` keeps returning `{ sort: 'stars', order: 'desc' }` for all new modes (current behavior).

Date computation uses the same `new Date()` / `setDate()` pattern as `buildTrendingQuery` in `Discover.tsx`.

### 2. `src/lib/discoverCache.ts` changes

Add three new cache pairs mirroring the existing `loadCachedPopular` / `saveCachedPopular`:

- `loadCachedHotToday` / `saveCachedHotToday`
- `loadCachedTrendingWeek` / `saveCachedTrendingWeek`
- `loadCachedHiddenGems` / `saveCachedHiddenGems`

Each follows the existing pattern: persistent localStorage entry, 24h TTL on the persistent layer (so older-than-1h still seeds the UI but triggers background refetch), versioned key (e.g., `discover-cache-hot-today-v1`).

Storage keys:

```
discover-cache-hot-today-v1
discover-cache-trending-week-v1
discover-cache-hidden-gems-v1
```

### 3. `src/views/Discover.tsx` changes

**State (module-level caches):** add three module-level `_*ModuleCache` constants mirroring `_popularModuleCache`, hydrated from `loadCachedHotToday` / `loadCachedTrendingWeek` / `loadCachedHiddenGems` on module load.

**State (component):** add three row-data state hooks:

```ts
const [hotTodayRowRepos, setHotTodayRowRepos]         = useState<RepoRow[]>(...)
const [trendingWeekRowRepos, setTrendingWeekRowRepos] = useState<RepoRow[]>(...)
const [hiddenGemsRowRepos, setHiddenGemsRowRepos]     = useState<RepoRow[]>(...)
```

Each initial state seeds from its module cache if present, otherwise `[]`.

**Fetch effects:** three new `useEffect`s on mount fetch each row's top ~30 items in parallel, with SWR semantics (render cached, refetch in background unless in-session TTL says fresh). Pattern mirrors the existing `loadHeroData` effect.

```ts
useEffect(() => { loadHotToday()      }, [])
useEffect(() => { loadTrendingWeek()  }, [])
useEffect(() => { loadHiddenGems()    }, [])
```

Each `loadX` calls `window.api.github.searchRepos(buildViewModeQuery(key, '', ''), 'stars', 'desc')` with a small page size (30 items is enough to seed the carousel), then `saveCachedX(...)` on success.

**Grid-gating:** introduce a `showHomeRows` boolean and wrap both branches:

```ts
const showHomeRows =
  viewMode === 'home'
  && !topicMode
  && selectedSubtypes.length === 0
  && !inSearchResults

// JSX:
{showHomeRows ? (
  <> {hero + 6 rows} </>
) : (
  <div className="discover-content-inner">
    <FilterChipRow .../>
    {error && ...}
    <DiscoverGrid .../>
  </div>
)}
```

This is the trim that "makes Most Popular just one row".

**New row JSX:** three `<DiscoverRow>` instances placed in the order:

1. Hero (existing)
2. Recommended for You (existing) — `onMore={() => setViewMode('recommended')}`
3. Agents (existing)
4. Hot today (NEW) — `onMore={() => setViewMode('hot-today')}`
5. Trending this week (NEW) — `onMore={() => setViewMode('trending-week')}`
6. Most Popular (existing — no `onMore`)
7. Hidden gems (NEW) — `onMore={() => setViewMode('hidden-gems')}`

Each new row passes its row-data state as `items`, `activeIndex={0}`, `columns={effectiveCols}`, and a static `onAdvance={() => {}}` (horizontal scroll deferred, same as Most Popular today).

**Expanded view: query routing.** The existing `loadTrending` function in `Discover.tsx` already branches on `viewMode`. Extend the else-branch (`searchRepos` path) so that when `viewMode` is one of the three new keys, it uses `buildViewModeQuery(viewMode, langKey, '')` directly (which now returns the right base query). No changes to the recommended/agents/home branches.

**Expanded view: `loadMore` pagination.** Extend the `searchPath === 'trending'` branch in `loadMore` symmetrically: when `viewMode` is a new key, build the same query and request `nextPage`. Mirrors how today's `home` mode paginates.

**Snapshot restoration.** The "legacy normalisation" block (the `raw === 'recommended' ? ... : 'home'` ternary) gets the new modes added to its passthrough whitelist:

```ts
const snapshotView: ViewModeKey =
    raw === 'recommended'    ? 'recommended'
  : raw === 'agents'         ? 'agents'
  : raw === 'hot-today'      ? 'hot-today'
  : raw === 'trending-week'  ? 'trending-week'
  : raw === 'hidden-gems'    ? 'hidden-gems'
  : 'home'
```

**`setViewMode` URL contract:** `home` deletes `?view=`, everything else sets it. No change to the existing logic — it already handles arbitrary `ViewModeKey` values generically.

## Data flow

**Home view (`viewMode === 'home'`, no topic/subtype/search):**
```
Discover.tsx
  ├── DiscoverHero
  ├── DiscoverRow "Recommended for You"  ← rowRepos
  ├── DiscoverRow "Agents"               ← rankedAgents
  ├── DiscoverRow "Hot today"            ← hotTodayRowRepos      (NEW)
  ├── DiscoverRow "Trending this week"   ← trendingWeekRowRepos  (NEW)
  ├── DiscoverRow "Most Popular"         ← repos.slice(0, 30)
  └── DiscoverRow "Hidden gems"          ← hiddenGemsRowRepos    (NEW)
```

**`hot-today` / `trending-week` / `hidden-gems` views:**
```
Discover.tsx
  ├── FilterChipRow (active filters + + Filter button)
  └── DiscoverGrid visibleRepos={repos}   ← results of buildViewModeQuery(viewMode, …)
```

## Caching strategy

- **Each new row** caches its base (unfiltered) carousel dataset to localStorage, the same way `_popularModuleCache` does. TTL: 1h in-session (skip network on hit), 24h persistent (still seeds UI but background-refetch).
- **Filtered/expanded views** (i.e., user has language/license/etc. on top of the base query) **do not cache** — same rule as today's filtered popular.
- **Cold-start cost:** 5 GitHub `searchRepos` calls fire on mount in parallel (recommended + popular + 3 new). Well within GitHub's 5000/hr authenticated limit.

## URL contract

| URL                              | Renders                                                         |
|----------------------------------|-----------------------------------------------------------------|
| `/discover` or `?view=home`      | Home (hero + 6 rows)                                            |
| `?view=recommended`              | Recommended grid (unchanged)                                    |
| `?view=agents`                   | Agents grid (unchanged)                                         |
| `?view=hot-today`                | Hot today grid (with chip row when filtered)                    |
| `?view=trending-week`            | Trending this week grid (with chip row when filtered)           |
| `?view=hidden-gems`              | Hidden gems grid (with chip row when filtered)                  |
| `?view=trending` or `=all` or `=last-visited` | Normalised to Home on mount (legacy passthrough)   |

Row title clicks call `setViewMode(key)` which writes the URL via `setSearchParams`. Back-navigation lands the user back on Home.

## Removed code

Nothing structural is removed. The `DiscoverGrid` JSX stays — it's gated off on Home but still serves all other views. The existing `_popularModuleCache`, `loadCachedPopular`, etc. stay.

## Testing

New tests:

- `discoverQueries.test.ts` — for each new `ViewModeKey`, assert `buildViewModeQuery` returns the expected GitHub search syntax with the date-relative `pushed:` qualifier and (for hidden-gems) the `stars:50..500` range. Cover lang-filter merge — `language:rust` should compose with the base query, not replace it.
- `discoverCache.test.ts` — add cases mirroring the existing popular-cache tests for the three new datasets: round-trip save/load, 24h-old entries still hydrate, malformed JSON returns null.

Updated tests:

- `Discover.test.tsx` (if it exists — check during plan) — home renders 6 row carousels in the documented order; clicking a new row's title switches `viewMode` and renders the grid; snapshot restoration honours the new modes.

## Implementation order (for the plan)

1. **`discoverQueries.ts`** — extend `ViewModeKey`, add the three branches in `buildViewModeQuery`, add a unit test per branch. Smallest, most isolated change.
2. **`discoverCache.ts`** — add the three cache load/save pairs + tests.
3. **`Discover.tsx`** — wire the new state hooks, fetch effects, JSX rows, grid-gating, `loadTrending` + `loadMore` branches, snapshot normalisation. All in one pass since they're tightly coupled.
4. **Cleanup** — verify no dead code in the gated-off grid branches; confirm snapshot restoration still works for all view modes.

## Open questions for the plan

- **Default ordering inside Hidden gems.** `sort:stars desc` on `stars:50..500` clusters the top of the page near the upper bound. Plan should evaluate whether `sort:updated desc` (most recently updated first) gives a more "live" feel for the row treatment, while keeping `sort:stars desc` for the expanded grid where ordering is more obviously navigable. Pick during plan.
- **Hot today empty handling.** Pushed-in-last-1d narrows the result set further than `pushed:>7d`. If the search returns fewer than ~5 items, the row will look thin. Plan should decide: hide the row entirely (current `items.length === 0` guard) or widen the window to 2d as a fallback. Default suggestion: hide entirely — DiscoverRow already does this gracefully.
- **Row-data state proliferation in `Discover.tsx`.** The component already has `repos`, `rowRepos`, `rankedAgents`. Adding three more local states keeps the pattern but the file is getting heavy. Plan should evaluate whether a small `useCuratedRow(key)` hook is worth extracting (3 call sites × ~30 lines each = duplication worth abstracting), or whether the inline pattern stays for now. Default suggestion: extract the hook — it's a clear unit-of-purpose.

## Estimated size

- **0 new files** (everything fits in the 3 existing modules).
- **3 modified source files** + their tests.
- **~200-300 LOC total** including tests. Heavy-path per the user's CLAUDE.md scope filter.
