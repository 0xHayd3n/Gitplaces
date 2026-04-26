# Language Filter Drilldown

**Date:** 2026-04-26
**Status:** Draft

## Problem

The Language tab inside `FilterPanel` (in [src/components/DiscoverSidebar.tsx](src/components/DiscoverSidebar.tsx)) renders all 130+ languages by default, grouped into 10 "Use Case" domain categories or 24 "Platform" ecosystem categories. Even at the friendlier 10-domain view, every category and every language row is visible at once, producing a long vertical wall of icons and labels. As more languages are added (recent commits added 22+ blockchain and other niche languages), the panel keeps growing and becomes harder to scan.

The user reports the current presentation as visually overwhelming, regardless of which grouping mode is active.

## Goals

- Reduce the default-state visual surface area to a small, scannable grid — independent of how many languages exist in the catalogue.
- Support both usage modes equally well: targeted lookup ("I want Rust") and exploratory browsing ("show me what's in Web").
- Preserve all existing functionality: Use Case / Platform toggle, favourites, search, draft/Apply mechanics, item-count filtering in Library mode, selected-chip summary.
- Keep the change scoped to the Language tab — do not restructure the rest of the sidebar.

## Non-goals

- Changing the catalogue itself (no merging/splitting of categories, no new category schemas).
- Changing the Type tab (`REPO_BUCKETS`). Smaller list, different mental model — out of scope for this change.
- Dynamic popularity ranking, click history, "recently used" tracking. The Popular list is a hardcoded curation.
- Restructuring the rail / panel chrome / Advanced filters tab.

## Design

### Pattern: master → detail (inline replacement)

The Language tab acquires two sub-views inside the same panel, swapped in place:

1. **Default view** — a small grid of *category tiles*. No language rows visible.
2. **Drilled-in view** — replaces the tile grid with the language list for one category, plus a back-nav header.

A third state, **search-results view**, overrides both whenever the search input has text.

The panel itself, the rail, the tabs (Language / Type), the search input, the Use Case / Platform toggle, and the bottom selected-chips + Apply bar are unchanged in position and behavior. Only the body inside the Language tab is restructured.

### Default view

Top-to-bottom inside the Language tab body:

1. **Use Case / Platform grouping toggle** — kept as today, visible only in the default view.
2. **Favourites section** — kept as today: an expanded row-list above the tile grid, only rendered when `favLangs.size > 0`. Identical to current behavior.
3. **Tile grid** — replaces the current `bucket-group` row stacks. Each tile is a single button with category icon, name, and language count, e.g. `[🌐 Web — 12]`. The grid order is:
   - **🔥 Popular tile** (always shown, visually distinct via accent border or badge so it reads as special, not just another category).
   - **Category tiles** — 10 in Use Case mode (`DOMAIN_CATEGORIES` order), 24 in Platform mode (`LANG_CATEGORIES` order).

Tile counts:
- Discover mode: count = number of languages in that category.
- Library mode: count = number of languages in that category that have `itemCounts.byLanguage > 0`. Tiles with a zero count after filtering are hidden (consistent with how empty `bucket-group`s are hidden today).

### Drilled-in view

Triggered by clicking any tile (Popular or category). The tile grid and grouping toggle are replaced with:

1. **Back-nav header** — a single horizontal element: `← All Languages` link/button on the left, category icon + name on the right. Clicking the back arrow returns to the default view.
2. **Language list** — the same `subtype-row` rendering currently used inside `bucket-group`. One row per language, with star (favourite toggle), language icon, name, optional `(count)` in Library mode. Selection toggles `draftLanguages` exactly as today.

For the **Popular tile**, the language list is the curated set defined in `languages.ts` (see Data changes below). For category tiles, the list comes from `getLangsByDomainCategory(cat)` or `getLangsByCategory(cat)` depending on the active grouping mode.

The Use Case / Platform toggle is **hidden** while drilled in (only meaningful at the tile-grid level).

### Search-results view

Any non-empty value in the search input overrides both default and drilled-in views.

- Display: a single flat list of all languages whose `name` (case-insensitive) matches the query. No category headers; no tile grid; no toggle.
- Each row renders the same `subtype-row` component plus a small caption indicating which category the language belongs to in the active grouping mode (e.g. `Solidity · in Specialty` or `Solidity · in Blockchain`). This provides context without forcing the user to navigate.
- Ranking: name starts-with first, then name contains, then key contains. Ties broken by the catalogue's existing array order.
- Empty state: `No languages match "{query}"`.
- Library mode: same `itemCounts` filter applies — languages with zero items are excluded from results.
- Clearing the search (or pressing `Esc` while the input is focused) returns to whichever view the user was in (default or drilled-in).

### Grouping toggle behavior

- Visible only in the default view.
- Switching modes while in the default view re-renders the tile grid with the new category set.
- Switching modes is impossible from the drilled-in view (toggle is hidden) and from the search view (toggle is hidden). No edge case to handle there.

### State persistence

- `groupingMode` (Use Case / Platform): persists in localStorage as today (`'discover:languageGrouping'`).
- `favLangs`: persists in `window.api.settings` as today.
- `draftLanguages`, `selectedLanguages`: unchanged.
- **Active drill-in category**: session-only React state in `FilterPanel`. Closing/reopening the panel returns to the default tile grid. Reopening on the Language tab does not restore the previous drill-in.
- **Search is an override, not a mutation:** typing in the search input does not clear or change `drilledCategory`. When the search is cleared, the user returns to whichever view they were in before (default grid or drilled-in).
- **Tab switch resets drill-in:** switching from Language to Type and back returns to the default tile grid. Add `setDrilledCategory(null)` to the existing tab-switch handlers at [DiscoverSidebar.tsx:304,307](src/components/DiscoverSidebar.tsx:304), alongside the existing `setSearch('')` and `setActiveCategory(null)` resets.

### Selected-chips + Apply bar

Unchanged. Renders at the bottom of the panel across all three sub-views (default, drilled-in, search). All draft/Apply mechanics in [DiscoverSidebar.tsx:206–217](src/components/DiscoverSidebar.tsx:206) remain identical.

### Animation

A single CSS opacity/transform transition (~150ms) when swapping between default ↔ drilled-in ↔ search-results. No staggered children, no slide-in/out from off-canvas. Implementation can be a simple `opacity` cross-fade keyed on the active sub-view.

## Data changes

### `src/lib/languages.ts`

Add a hardcoded popular-languages export:

```typescript
/** Curated set of broadly popular languages, surfaced via the "Popular" tile in FilterPanel. */
export const POPULAR_LANGUAGES: string[] = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'c++', 'c', 'c#', 'ruby', 'php',
  'swift', 'kotlin', 'html', 'css',
]

/** Get LangDef[] for the popular tile, in the order defined above. */
export function getPopularLangs(): LangDef[] {
  return POPULAR_LANGUAGES
    .map(key => LANG_MAP.get(key))
    .filter((l): l is LangDef => l != null)
}
```

The list is stable, easy to tweak, and survives catalogue churn (missing entries are silently skipped).

## Component changes

### `src/components/DiscoverSidebar.tsx` — `FilterPanel`

New local state, scoped to the Language tab:

```typescript
const [drilledCategory, setDrilledCategory] = useState<
  | { kind: 'popular' }
  | { kind: 'domain', cat: DomainCategory }
  | { kind: 'ecosystem', cat: LangCategory }
  | null
>(null)
```

Render flow inside `activeTab === 'language'`:

```
if (search has text)              → render <SearchResults query={search} />
else if (drilledCategory != null) → render <DrilledIn category={drilledCategory} />
else                              → render <DefaultGrid />
```

Three new render functions / sub-components inside `FilterPanel` (kept inline; no new files needed):

- **`<DefaultGrid>`** — renders the grouping toggle, favourites section (extracted from current code), and the tile grid (Popular + categories). Tiles call `setDrilledCategory(...)` on click.
- **`<DrilledIn>`** — renders the back-nav header and the language list for the active drill-in. Reuses the existing `subtype-row` button rendering.
- **`<SearchResults>`** — renders the flat ranked list with category captions.

The existing `bucket-group` rendering blocks (lines [432–501](src/components/DiscoverSidebar.tsx:432)) are removed and their per-language row JSX is reused inside `<DrilledIn>` and `<SearchResults>`. Extract a small helper for the row markup to avoid duplication.

The entire **`category-filter-row`** in the sticky header (lines [313–386](src/components/DiscoverSidebar.tsx:313)) — including both the favourites star button (lines [323–332](src/components/DiscoverSidebar.tsx:323)) and the category dropdown trigger — becomes **Type-tab-only**. On the Language tab, both controls are redundant: the tile grid replaces the dropdown, and the always-expanded Favourites section above the grid replaces the star toggle.

Render the `category-filter-row` only when `activeTab === 'type'`. The `activeCategory === '_fav'` filter mechanism continues to drive the Type tab's favourites view exactly as today.

`toggleFavLang` (lines [243–252](src/components/DiscoverSidebar.tsx:243)) currently resets `activeCategory` to `null` when the last favourite is removed. Since `activeCategory` no longer affects the Language tab, that reset is harmless but dead for the Language tab and can be left in place (it still serves the Type tab's `toggleFavType`, which has identical structure).

### `src/components/DiscoverSidebar.css`

Add styles for:

- `.lang-tile-grid` — CSS grid, ~2 columns, gap matching existing visual rhythm.
- `.lang-tile` — rounded tile button, icon + label + count. Hover/focus states.
- `.lang-tile--popular` — accent border or badge for the Popular tile.
- `.lang-drillin-header` — back nav row.
- `.lang-search-row-caption` — small muted text for the `· in {Category}` suffix.

Existing `.bucket-group`, `.bucket-label`, `.subtype-row` styles are kept (still used inside the drilled-in and search views).

## Files Changed

| File | Change | Approx LOC |
|------|--------|-----------|
| `src/lib/languages.ts` | Add `POPULAR_LANGUAGES` + `getPopularLangs` | +12 |
| `src/components/DiscoverSidebar.tsx` | Restructure `FilterPanel` Language tab into default / drilled / search sub-views; remove Language-tab category dropdown | ~+150 / −80 |
| `src/components/DiscoverSidebar.css` | Tile grid + drill-in header + search caption styles | +60 |

Tests in `src/views/Discover.test.tsx` and any sidebar tests will need updates wherever they assert against the old "all categories visible" structure.

## Out of scope

- Type tab restructure (different mental model, smaller list).
- Recently-used tracking, dynamic Popular ranking, per-user popularity.
- Animation beyond a single 150ms cross-fade.
- Mobile/responsive layout changes — the panel is already a fixed-width sidebar and the tile grid degrades gracefully.
- Restoring the active drill-in across panel close/reopen.
- Restructuring the existing category schemas (Use Case vs Platform).

## Open questions

None outstanding. All section-by-section decisions during brainstorming were resolved:

- Inline replacement (not true two-column) — confirmed.
- Popular as a tile inside the grid — confirmed.
- Favourites as an expanded above-grid section (not a tile) — confirmed.
- Type tab unchanged — confirmed.
