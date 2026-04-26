# Language Filter Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagent-driven development is **not** appropriate here — tasks share component state and execute sequentially in the same files.

**Goal:** Replace the always-expanded language list inside `FilterPanel` with a tile-grid → drill-in pattern (default view → category contents), plus a search-results override and a curated "Popular" tile.

**Architecture:** Single-component restructure inside `FilterPanel` (in `src/components/DiscoverSidebar.tsx`). Three sub-views (default grid, drilled-in, search results) swap in place inside the Language tab body. Adds one new `drilledCategory` React state. Adds a hardcoded popular-languages export to `src/lib/languages.ts`. CSS additions for tile styling and drill-in header. The Type tab, the rail, the Advanced tab, and all draft/Apply mechanics are untouched.

**Tech Stack:** React, TypeScript, Vite, Vitest + React Testing Library, plain CSS modules.

**Spec:** [docs/superpowers/specs/2026-04-26-language-filter-drilldown-design.md](../specs/2026-04-26-language-filter-drilldown-design.md)

---

## Conventions used throughout this plan

- Working branch: **main** (per project `CLAUDE.md` — no feature branches).
- Each task ends with a commit. Commit messages use the existing conventional-commit style visible in `git log` (`feat(filter): …`, `refactor(filter): …`, etc.).
- Test command: `npm test -- <file>` (vitest in run mode).
- All file paths absolute or repo-rooted as shown.

---

## File map

| File | Role | Change type |
|------|------|------------|
| `src/lib/languages.ts` | Data source — adds `POPULAR_LANGUAGES` constant + `getPopularLangs()` helper | Add |
| `src/lib/languages.test.ts` | Tests for the new export/helper | Add tests |
| `src/components/DiscoverSidebar.tsx` | `FilterPanel` Language tab restructure: state, default grid, drilled-in view, search override; conditional `category-filter-row`; tab-switch reset | Modify (largest change) |
| `src/components/DiscoverSidebar.css` | Tile grid, tile button, Popular accent, drill-in header, search caption | Add styles (existing styles kept) |
| `src/components/DiscoverSidebar.test.tsx` | Tests for tile grid, drill-in, search results, tab-switch reset; updates one obsolete embedded-mode assertion | Modify + add |

No new files. The new sub-views (`DefaultGrid`, `DrilledIn`, `SearchResults`) are inline render functions/blocks inside `FilterPanel` to keep state colocated.

---

## Task 1 — Add `POPULAR_LANGUAGES` data export

**Files:**
- Modify: `src/lib/languages.ts` (append at the end of the file, after `getLangsByDomainCategory`)
- Modify (test): `src/lib/languages.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write failing tests for `POPULAR_LANGUAGES` and `getPopularLangs`**

Append to `src/lib/languages.test.ts`:

```typescript
import { POPULAR_LANGUAGES, getPopularLangs, LANG_MAP } from './languages'

describe('POPULAR_LANGUAGES', () => {
  it('lists 15 lowercase keys', () => {
    expect(POPULAR_LANGUAGES.length).toBe(15)
    for (const k of POPULAR_LANGUAGES) {
      expect(k).toBe(k.toLowerCase())
    }
  })

  it('every key resolves to a real LangDef in LANG_MAP', () => {
    for (const k of POPULAR_LANGUAGES) {
      expect(LANG_MAP.get(k), `${k} should exist in LANG_MAP`).toBeDefined()
    }
  })
})

describe('getPopularLangs', () => {
  it('returns LangDef[] in the order defined by POPULAR_LANGUAGES', () => {
    const popular = getPopularLangs()
    expect(popular.length).toBe(POPULAR_LANGUAGES.length)
    expect(popular.map(l => l.key)).toEqual(POPULAR_LANGUAGES)
  })

  it('returns only fully populated LangDef entries (smoke check)', () => {
    const popular = getPopularLangs()
    for (const def of popular) {
      expect(def.name).toBeDefined()
      expect(def.key).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- src/lib/languages.test.ts`
Expected: 4 new tests fail with "POPULAR_LANGUAGES is not exported" / "getPopularLangs is not a function".

- [ ] **Step 3: Implement the export and helper**

Append to `src/lib/languages.ts`:

```typescript
/** Curated set of broadly popular languages, surfaced via the "Popular" tile in FilterPanel. */
export const POPULAR_LANGUAGES: string[] = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'c++', 'c', 'c#', 'ruby', 'php',
  'swift', 'kotlin', 'html', 'css',
]

/** Get LangDef[] for the popular tile, in the order defined above. Silently skips missing keys. */
export function getPopularLangs(): LangDef[] {
  return POPULAR_LANGUAGES
    .map(key => LANG_MAP.get(key))
    .filter((l): l is LangDef => l != null)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- src/lib/languages.test.ts`
Expected: all tests pass (the 4 new ones plus all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/languages.ts src/lib/languages.test.ts
git commit -m "feat(languages): add POPULAR_LANGUAGES curated list + getPopularLangs helper"
```

---

## Task 2 — Extract per-language row into a helper render function (preparatory refactor)

This task introduces no behavior change. It pulls the duplicated `subtype-row` button JSX (currently rendered inline inside two `bucket-group` map blocks, lines [411–429](../../src/components/DiscoverSidebar.tsx) and [442–462](../../src/components/DiscoverSidebar.tsx) and [477–497](../../src/components/DiscoverSidebar.tsx)) into a single helper so the upcoming sub-views can reuse it.

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx` — add helper, replace three inline JSX blocks with calls to it.

- [ ] **Step 1: Add the row helper**

Inside `FilterPanel`, immediately above the `return (` statement, add:

```tsx
/** Renders one selectable language row. Used by Favourites section, drilled-in view, and search results. */
const renderLangRow = (def: LangDef, opts?: { caption?: string }) => {
  const selected = draftLanguages.includes(def.key)
  const isFav = favLangs.has(def.key)
  const langCount = itemCounts?.byLanguage.get(def.key)
  return (
    <button
      key={def.key}
      className={`subtype-row${selected ? ' selected' : ''}`}
      style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
      onClick={() => toggleLanguage(def.key)}
    >
      <span
        className={`subtype-star${isFav ? ' starred' : ''}`}
        onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}
      >
        <Star size={10} />
      </span>
      <LanguageIcon lang={def.key} size={16} boxed />
      <span className="subtype-label">
        {def.name}{langCount != null && ` (${langCount})`}
        {opts?.caption && <span className="lang-row-caption"> · {opts.caption}</span>}
      </span>
    </button>
  )
}
```

You will need to import `LangDef` at the top of the file. Find the existing import:

```tsx
import { LANG_CATEGORIES, getLangsByCategory, DOMAIN_CATEGORIES, getLangsByDomainCategory, LANG_MAP, getLangColor } from '../lib/languages'
```

…and add `type LangDef`:

```tsx
import { LANG_CATEGORIES, getLangsByCategory, DOMAIN_CATEGORIES, getLangsByDomainCategory, LANG_MAP, getLangColor, type LangDef } from '../lib/languages'
```

- [ ] **Step 2: Replace the three inline JSX blocks with `renderLangRow(def)` calls**

In the Favourites section (currently inside the `{favLangs.size > 0 && (!activeCategory || activeCategory === '_fav') && !search && (` block), replace the inner button JSX with `renderLangRow(def)`. Note: the existing favourites block uses `starred` unconditionally on the star — `renderLangRow` uses `isFav`, which is `true` here because `favLangs.has(def.key)` is what made the row appear. Behavior is preserved.

In both the `groupingMode === 'domain'` branch and the `else` branch (the `LANG_CATEGORIES.filter(...).map(...)` block), replace each inner `langs.map(def => { ... return (<button …>…</button>) })` with `langs.map(def => renderLangRow(def))`.

- [ ] **Step 3: Run all sidebar tests to confirm no regression**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: all tests pass (no behavior change).

- [ ] **Step 4: Run the broader test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/DiscoverSidebar.tsx
git commit -m "refactor(filter): extract per-language row into renderLangRow helper"
```

---

## Task 3 — Add `drilledCategory` state + DefaultGrid sub-view (tile grid)

This is the **largest task**. It introduces the new state, the tile-grid render path, and the conditional logic that selects between sub-views. The DrilledIn and SearchResults sub-views are added in Tasks 4 and 5; in this task, clicking a tile sets the state but the drilled-in view is still rendered using the existing bucket-group code (so the UX briefly goes from "everything visible" to "tile grid → click → still everything visible" — fully resolved by the end of Task 4).

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx`
- Modify: `src/components/DiscoverSidebar.css`
- Modify (test): `src/components/DiscoverSidebar.test.tsx`

- [ ] **Step 1: Write failing tests for the default tile grid**

Add a new `describe` block to `src/components/DiscoverSidebar.test.tsx`:

```tsx
describe('FilterPanel — language tile grid (default view)', () => {
  beforeEach(() => localStorage.clear())

  it('renders Popular tile and category tiles, not language rows, when no search and no drill-in', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // Popular tile is always visible
    expect(screen.getByRole('button', { name: /Popular/ })).toBeInTheDocument()
    // Domain category tiles are visible (Use Case is the default mode)
    expect(screen.getByRole('button', { name: /^Systems/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Web/ })).toBeInTheDocument()
    // Individual language rows should NOT be in the default view
    expect(screen.queryByRole('button', { name: /^Rust$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Python$/ })).not.toBeInTheDocument()
  })

  it('shows tile counts that match the catalogue', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // The Systems domain has 15 languages in the catalogue (verified via getLangsByDomainCategory)
    expect(screen.getByRole('button', { name: /Systems.*\(15\)/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: the 2 new tests fail. (Existing tests will also start failing once Step 3 lands — that's fine and expected, we'll reconcile in Task 5.)

- [ ] **Step 3: Add `drilledCategory` state**

Inside `FilterPanel`, near the existing `useState` calls (after `const [activeCategory, setActiveCategory] = useState<string | null>(null)`), add:

```tsx
type DrilledCategory =
  | { kind: 'popular' }
  | { kind: 'domain', cat: DomainCategory }
  | { kind: 'ecosystem', cat: LangCategory }

const [drilledCategory, setDrilledCategory] = useState<DrilledCategory | null>(null)
```

`DomainCategory` and `LangCategory` are already imported via the existing `import type { LangCategory, DomainCategory, GroupingMode } from '../lib/languages'`.

You will also need to import the new helper:

```tsx
import { ..., getPopularLangs } from '../lib/languages'
```

- [ ] **Step 4: Add the tile grid render block**

Inside `activeTab === 'language' && (...)`, **replace the entire range from `<div className="filter-grouping-toggle">` (line 392) through the closing `</div>` of `<div className="categories-grid categories-grid--lang">` (line 502)** with the following structure. This is a single contiguous replacement — both the existing grouping toggle block AND the existing categories-grid block are being replaced, because the new structure re-emits a (conditionally rendered) grouping toggle inside the new layout.

```tsx
{/* Grouping toggle — visible only in the default grid view */}
{!drilledCategory && !search && (
  <div className="filter-grouping-toggle">
    <button
      className={`filter-grouping-btn${groupingMode === 'domain' ? ' active' : ''}`}
      onClick={() => setGroupingMode('domain')}
    >
      Use Case
    </button>
    <button
      className={`filter-grouping-btn${groupingMode === 'ecosystem' ? ' active' : ''}`}
      onClick={() => setGroupingMode('ecosystem')}
    >
      Platform
    </button>
  </div>
)}

<div className="categories-grid categories-grid--lang">
  {/* Favourites section — always above the tile grid (default view only) */}
  {!drilledCategory && !search && favLangs.size > 0 && (
    <div className="bucket-group" style={{ '--rows': favLangs.size + 2 } as React.CSSProperties}>
      <div className="bucket-label"><Star size={11} /> Favourites</div>
      {[...favLangs].map(key => {
        const def = LANG_MAP.get(key)
        return def ? renderLangRow(def) : null
      })}
    </div>
  )}

  {/* DEFAULT VIEW — tile grid */}
  {!drilledCategory && !search && (
    <div className="lang-tile-grid">
      {/* Popular tile */}
      {(() => {
        const popularCount = itemCounts
          ? getPopularLangs().filter(l => (itemCounts.byLanguage.get(l.key) ?? 0) > 0).length
          : getPopularLangs().length
        if (popularCount === 0) return null
        return (
          <button
            className="lang-tile lang-tile--popular"
            onClick={() => setDrilledCategory({ kind: 'popular' })}
          >
            <PiStarFill size={16} />
            <span className="lang-tile-name">Popular</span>
            <span className="lang-tile-count">({popularCount})</span>
          </button>
        )
      })()}

      {/* Category tiles */}
      {groupingMode === 'domain'
        ? DOMAIN_CATEGORIES.map(cat => {
            const count = (itemCounts
              ? getLangsByDomainCategory(cat).filter(l => (itemCounts.byLanguage.get(l.key) ?? 0) > 0)
              : getLangsByDomainCategory(cat)).length
            if (count === 0) return null
            const Icon = DOMAIN_CAT_ICONS[cat]
            return (
              <button
                key={cat}
                className="lang-tile"
                onClick={() => setDrilledCategory({ kind: 'domain', cat })}
              >
                <Icon size={16} />
                <span className="lang-tile-name">{cat}</span>
                <span className="lang-tile-count">({count})</span>
              </button>
            )
          })
        : LANG_CATEGORIES.map(cat => {
            const count = (itemCounts
              ? getLangsByCategory(cat).filter(l => (itemCounts.byLanguage.get(l.key) ?? 0) > 0)
              : getLangsByCategory(cat)).length
            if (count === 0) return null
            const Icon = LANG_CAT_ICONS[cat]
            return (
              <button
                key={cat}
                className="lang-tile"
                onClick={() => setDrilledCategory({ kind: 'ecosystem', cat })}
              >
                <Icon size={16} />
                <span className="lang-tile-name">{cat}</span>
                <span className="lang-tile-count">({count})</span>
              </button>
            )
          })
      }
    </div>
  )}

  {/* DRILLED-IN VIEW — added in Task 4 */}
  {drilledCategory && !search && (
    <div className="lang-drillin-placeholder">
      {/* TEMPORARY: render the original bucket-group blocks while drilled in,
          so the user still sees languages. Task 4 replaces this with the proper drill-in view. */}
      {(() => {
        const langs = drilledCategory.kind === 'popular'
          ? getPopularLangs()
          : drilledCategory.kind === 'domain'
            ? getLangsByDomainCategory(drilledCategory.cat)
            : getLangsByCategory(drilledCategory.cat)
        const visible = itemCounts
          ? langs.filter(l => (itemCounts.byLanguage.get(l.key) ?? 0) > 0)
          : langs
        return (
          <div className="bucket-group">
            <div className="bucket-label">
              <button onClick={() => setDrilledCategory(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginRight: 8 }}>← All</button>
              {drilledCategory.kind === 'popular' ? 'Popular' : drilledCategory.cat}
            </div>
            {visible.map(def => renderLangRow(def))}
          </div>
        )
      })()}
    </div>
  )}

  {/* SEARCH RESULTS VIEW — added in Task 5 */}
  {search && (
    <div className="lang-search-placeholder">
      {/* TEMPORARY: render filtered bucket-groups using the existing logic so search still works.
          Task 5 replaces this with the flat ranked list. */}
      {(groupingMode === 'domain' ? DOMAIN_CATEGORIES.map(cat => ({ cat, langs: getLangsByDomainCategory(cat) })) : LANG_CATEGORIES.map(cat => ({ cat, langs: getLangsByCategory(cat) })))
        .map(({ cat, langs }) => {
          const filtered = langs
            .filter(def => def.name.toLowerCase().includes(search.toLowerCase()))
            .filter(def => !itemCounts || (itemCounts.byLanguage.get(def.key) ?? 0) > 0)
          if (!filtered.length) return null
          return (
            <div key={cat} className="bucket-group">
              <div className="bucket-label">{cat}</div>
              {filtered.map(def => renderLangRow(def))}
            </div>
          )
        })}
    </div>
  )}
</div>
```

**Notes on the placeholders:**
The `drilledCategory && !search` and `search` branches above are intentionally temporary — they preserve user-visible behavior (drill-in shows category contents; search filters) while Tasks 4 and 5 build out the proper sub-views. This keeps each task individually shippable and the test suite sensible between commits.

The `PiStarFill` icon for the Popular tile is already imported.

- [ ] **Step 5: Add CSS for the tile grid and tiles**

Append to `src/components/DiscoverSidebar.css`:

```css
/* ── Language tile grid (default view) ───────────────── */

.lang-tile-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 4px 8px 8px 8px;
}

.lang-tile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--t2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  text-align: left;
  min-width: 0;
}

.lang-tile:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: var(--t1);
}

.lang-tile svg {
  flex-shrink: 0;
  opacity: 0.75;
}

.lang-tile-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lang-tile-count {
  font-size: var(--text-xs);
  color: var(--t3);
  flex-shrink: 0;
}

.lang-tile--popular {
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.08);
}

.lang-tile--popular:hover {
  border-color: rgba(251, 191, 36, 0.6);
  background: rgba(251, 191, 36, 0.14);
}

.lang-tile--popular svg {
  color: #fbbf24;
  opacity: 1;
}
```

- [ ] **Step 6: Update existing tests that asserted on the all-categories layout**

The existing test `FilterPanel — embedded mode > 'filters bucket-groups by controlled search prop'` (line 177) still passes because Rust appears in the search-results placeholder and Python is filtered out. Run the suite to confirm.

The existing test `DiscoverSidebar — itemCounts > 'annotates bucket labels with counts and omits empty buckets'` (line 88) targets the **Type tab** and is unaffected.

The existing assertion `expect(screen.queryByRole('button', { name: /All Languages/ })).not.toBeInTheDocument()` in the embedded-mode test (line 160) referred to the dropdown trigger label. The dropdown is still present (we remove it for the Language tab in Task 6), so this assertion still passes for now. After Task 6 it will pass even more emphatically.

- [ ] **Step 7: Run the test suite and confirm all pass**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: all pre-existing tests pass + the 2 new tile-grid tests pass.

Run: `npm test`
Expected: full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/components/DiscoverSidebar.tsx src/components/DiscoverSidebar.css src/components/DiscoverSidebar.test.tsx
git commit -m "feat(filter): replace language list with tile grid + drilledCategory state"
```

---

## Task 4 — Build the proper DrilledIn view (back-nav header)

Replaces the placeholder drill-in render added in Task 3 with the spec'd layout: a polished back-nav header + language list.

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx`
- Modify: `src/components/DiscoverSidebar.css`
- Modify (test): `src/components/DiscoverSidebar.test.tsx`

- [ ] **Step 1: Write failing tests for drill-in behavior**

Add to `DiscoverSidebar.test.tsx`:

```tsx
describe('FilterPanel — language drill-in', () => {
  beforeEach(() => localStorage.clear())

  it('clicking a category tile reveals that category\'s languages', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Drill into Systems
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    // Now language rows from Systems should be visible
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Go$/ })).toBeInTheDocument()
    // Other categories' tiles should NOT be visible
    expect(screen.queryByRole('button', { name: /^Web \(/ })).not.toBeInTheDocument()
  })

  it('clicking the Popular tile reveals popular languages', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /Popular/ }))
    expect(screen.getByRole('button', { name: /^JavaScript$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Python$/ })).toBeInTheDocument()
  })

  it('back button returns to the tile grid', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    await user.click(screen.getByRole('button', { name: /All Languages/ }))
    // Tiles are visible again
    expect(screen.getByRole('button', { name: /^Web/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rust$/ })).not.toBeInTheDocument()
  })

  it('hides the grouping toggle while drilled in', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.queryByRole('button', { name: 'Use Case' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: the 4 new tests fail (the back button has different text in the placeholder; the toggle is still visible in some paths; etc.).

- [ ] **Step 3: Replace the drill-in placeholder with the proper view**

In `DiscoverSidebar.tsx`, find the block added in Task 3:

```tsx
{drilledCategory && !search && (
  <div className="lang-drillin-placeholder">
    {/* TEMPORARY ... */}
  </div>
)}
```

Replace it with:

```tsx
{drilledCategory && !search && (() => {
  const drillTitle = drilledCategory.kind === 'popular'
    ? 'Popular'
    : drilledCategory.cat
  const DrillIcon = drilledCategory.kind === 'popular'
    ? PiStarFill
    : drilledCategory.kind === 'domain'
      ? DOMAIN_CAT_ICONS[drilledCategory.cat]
      : LANG_CAT_ICONS[drilledCategory.cat]
  const langs = drilledCategory.kind === 'popular'
    ? getPopularLangs()
    : drilledCategory.kind === 'domain'
      ? getLangsByDomainCategory(drilledCategory.cat)
      : getLangsByCategory(drilledCategory.cat)
  const visible = itemCounts
    ? langs.filter(l => (itemCounts.byLanguage.get(l.key) ?? 0) > 0)
    : langs
  return (
    <div className="lang-drillin">
      <div className="lang-drillin-header">
        <button
          className="lang-drillin-back"
          onClick={() => setDrilledCategory(null)}
          aria-label="All Languages"
        >
          <ChevronLeft size={14} />
          <span>All Languages</span>
        </button>
        <span className="lang-drillin-title">
          <DrillIcon size={14} />
          {drillTitle}
        </span>
      </div>
      <div className="lang-drillin-list">
        {visible.map(def => renderLangRow(def))}
      </div>
    </div>
  )
})()}
```

Add `ChevronLeft` to the existing `lucide-react` import at the top of the file:

```tsx
import {
  X, ShieldCheck, Shield, SlidersHorizontal, Search, ChevronDown, ChevronLeft, Star,
} from 'lucide-react'
```

- [ ] **Step 4: Add CSS for the drill-in view**

Append to `src/components/DiscoverSidebar.css`:

```css
/* ── Language drill-in view ──────────────────────────── */

.lang-drillin {
  padding: 4px 8px 8px 8px;
}

.lang-drillin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 4px 8px 4px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.lang-drillin-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--t2);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.1s, color 0.1s;
}

.lang-drillin-back:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--t1);
}

.lang-drillin-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lang-drillin-title svg {
  opacity: 0.7;
}

.lang-drillin-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
```

- [ ] **Step 5: Run drill-in tests**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: the 4 drill-in tests pass; all earlier tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/DiscoverSidebar.tsx src/components/DiscoverSidebar.css src/components/DiscoverSidebar.test.tsx
git commit -m "feat(filter): replace drill-in placeholder with back-nav header + list"
```

---

## Task 5 — Build the proper SearchResults override (flat ranked list)

Replaces the search placeholder added in Task 3 with a flat ranked list of matching languages plus a `· in {Category}` caption for each.

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx`
- Modify: `src/components/DiscoverSidebar.css`
- Modify (test): `src/components/DiscoverSidebar.test.tsx`

- [ ] **Step 1: Write failing tests for search behavior**

Add to `DiscoverSidebar.test.tsx`:

```tsx
describe('FilterPanel — language search results', () => {
  beforeEach(() => localStorage.clear())

  it('shows a flat list of matching languages when search has text', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    // Rust row visible
    expect(screen.getByRole('button', { name: /^Rust/ })).toBeInTheDocument()
    // No tile grid visible
    expect(screen.queryByRole('button', { name: /^Systems \(/ })).not.toBeInTheDocument()
    // No grouping toggle
    expect(screen.queryByRole('button', { name: 'Use Case' })).not.toBeInTheDocument()
  })

  it('ranks name-starts-with matches before name-contains matches', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Query "el" — prefix matches: Elixir, Elm, EJS. Contains matches: Haskell.
    // Verifies the Step-3 ranking (startsWith before contains).
    await user.type(screen.getByPlaceholderText('Search languages...'), 'el')
    const langButtons = screen.getAllByRole('button').filter(b => {
      const t = b.textContent || ''
      return /^(Elixir|Elm|EJS|Haskell)\b/.test(t)
    })
    const prefixIdx = langButtons.findIndex(b => /^Elixir\b/.test(b.textContent || ''))
    const containsIdx = langButtons.findIndex(b => /^Haskell\b/.test(b.textContent || ''))
    expect(prefixIdx).toBeGreaterThanOrEqual(0)
    expect(containsIdx).toBeGreaterThanOrEqual(0)
    expect(prefixIdx, 'Elixir (prefix match) should rank before Haskell (contains match)').toBeLessThan(containsIdx)
  })

  it('shows category caption (· in <Category>) on each row', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'rust')
    // The caption is suffixed inside the same button; assert it appears in the document
    expect(screen.getByText(/· Systems/)).toBeInTheDocument()
  })

  it('shows empty state when no language matches', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.type(screen.getByPlaceholderText('Search languages...'), 'zzznosuchlang')
    expect(screen.getByText(/No languages match/)).toBeInTheDocument()
  })

  it('does not reset drilledCategory when typing a search', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Drill into Systems
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    // Now type a search — search overrides the drill-in view
    await user.type(screen.getByPlaceholderText('Search languages...'), 'python')
    expect(screen.getByRole('button', { name: /^Python/ })).toBeInTheDocument()
    // Clear the search by selecting all + delete
    const input = screen.getByPlaceholderText('Search languages...') as HTMLInputElement
    await user.clear(input)
    // Should return to the drilled-in Systems view, not the default grid
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Web \(/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: most of the new tests fail (the placeholder doesn't have the empty state, no caption rendered, etc.).

- [ ] **Step 3: Replace the search placeholder with the proper view**

In `DiscoverSidebar.tsx`, find the block added in Task 3:

```tsx
{search && (
  <div className="lang-search-placeholder">
    {/* TEMPORARY ... */}
  </div>
)}
```

Replace it with:

```tsx
{search && (() => {
  const q = search.toLowerCase()
  // Build ranked, deduplicated list across the entire catalogue
  const startsWith: LangDef[] = []
  const contains: LangDef[] = []
  const keyContains: LangDef[] = []
  const seen = new Set<string>()
  for (const def of LANGUAGES) {
    if (itemCounts && (itemCounts.byLanguage.get(def.key) ?? 0) === 0) continue
    const name = def.name.toLowerCase()
    const key = def.key.toLowerCase()
    if (seen.has(def.key)) continue
    if (name.startsWith(q)) {
      startsWith.push(def); seen.add(def.key)
    } else if (name.includes(q)) {
      contains.push(def); seen.add(def.key)
    } else if (key.includes(q)) {
      keyContains.push(def); seen.add(def.key)
    }
  }
  const matches = [...startsWith, ...contains, ...keyContains]

  if (matches.length === 0) {
    return <div className="lang-search-empty">No languages match "{search}"</div>
  }

  return (
    <div className="lang-search-results">
      {matches.map(def => {
        const caption = groupingMode === 'domain'
          ? def.domainCategory
          : def.category
        return renderLangRow(def, { caption })
      })}
    </div>
  )
})()}
```

You will need to import `LANGUAGES` (the full array) at the top:

```tsx
import { LANG_CATEGORIES, getLangsByCategory, DOMAIN_CATEGORIES, getLangsByDomainCategory, LANG_MAP, getLangColor, getPopularLangs, LANGUAGES, type LangDef } from '../lib/languages'
```

- [ ] **Step 4: Add CSS for search results and caption**

Append to `src/components/DiscoverSidebar.css`:

```css
/* ── Language search results ─────────────────────────── */

.lang-search-results {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 8px 8px 8px;
}

.lang-row-caption {
  color: var(--t3);
  font-weight: var(--weight-normal);
  font-size: var(--text-xs);
  margin-left: 4px;
}

.lang-search-empty {
  padding: 16px 12px;
  color: var(--t3);
  font-size: var(--text-sm);
  text-align: center;
}
```

- [ ] **Step 5: Run search tests**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: all 5 new search tests pass; all earlier tests still pass.

If the existing test `'filters bucket-groups by controlled search prop'` (line 177) now fails because the search-results render no longer uses `bucket-group` headers, update it to assert against the flat-list output:

```tsx
it('filters to a flat list of matching languages by controlled search prop', () => {
  render(<FilterPanel {...filterPanelProps} embedded activeTab="language" search="rust" />)
  expect(screen.getByText(/^Rust$/)).toBeInTheDocument()
  // Python should be filtered out
  expect(screen.queryByText(/^Python$/)).not.toBeInTheDocument()
})
```

(The test name was already misleading — "bucket-groups" — so renaming it is appropriate.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/components/DiscoverSidebar.tsx src/components/DiscoverSidebar.css src/components/DiscoverSidebar.test.tsx
git commit -m "feat(filter): replace search placeholder with flat ranked list + captions"
```

---

## Task 6 — Make `category-filter-row` Type-tab-only + tab-switch reset for `drilledCategory`

Two small touches to round out the spec.

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx`
- Modify (test): `src/components/DiscoverSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `DiscoverSidebar.test.tsx`:

```tsx
describe('FilterPanel — sticky header chrome', () => {
  beforeEach(() => localStorage.clear())

  it('hides the category dropdown when the Language tab is active', () => {
    render(<FilterPanel {...filterPanelProps} />)
    // The dropdown trigger has the text "All Languages" or "All Types"
    expect(screen.queryByRole('button', { name: /All Languages/ })).not.toBeInTheDocument()
  })

  it('shows the category dropdown when the Type tab is active', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: /^Type/ }))
    expect(screen.getByRole('button', { name: /All Types/ })).toBeInTheDocument()
  })
})

describe('FilterPanel — tab switching resets drill-in', () => {
  beforeEach(() => localStorage.clear())

  it('switching from Language → Type → Language returns to the default tile grid', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    // Drill into Systems
    await user.click(screen.getByRole('button', { name: /^Systems/ }))
    expect(screen.getByRole('button', { name: /^Rust$/ })).toBeInTheDocument()
    // Switch to Type tab
    await user.click(screen.getByRole('button', { name: /^Type/ }))
    // Switch back to Language
    await user.click(screen.getByRole('button', { name: /^Language/ }))
    // Should be on the default tile grid, not the Systems drill-in
    expect(screen.getByRole('button', { name: /^Systems \(/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rust$/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: 3 new tests fail.

- [ ] **Step 3: Conditionally render `category-filter-row` for Type tab only**

In `DiscoverSidebar.tsx`, find the IIFE block that renders the category dropdown (currently lines [313–386](../../src/components/DiscoverSidebar.tsx)):

```tsx
{/* Category filter dropdown */}
{(() => {
  const currentCat = ...
  return (
    <div className="category-filter-row">
      ...
    </div>
  )
})()}
```

Wrap the entire block with an `activeTab === 'type' && (...)` guard:

```tsx
{/* Category filter dropdown — Type tab only (Language tab uses the tile grid instead) */}
{activeTab === 'type' && (() => {
  const currentCat = activeCategory && activeCategory !== '_fav' ? activeCategory : null
  // … rest unchanged …
})()}
```

The block originally branches internally on `activeTab === 'language'` vs `'type'` to populate the dropdown menu. Since we now only render this for the Type tab, that internal `activeTab === 'language' ? … : …` ternary collapses to just the Type-tab branch. Simplify:

- `TriggerIcon` becomes `currentCat ? BUCKET_NAV_ICONS[currentCat] : null`
- `triggerLabel` becomes `currentCat ? REPO_BUCKETS.find(b => b.id === currentCat)?.label ?? currentCat : 'All Types'`
- The dropdown menu items are the `REPO_BUCKETS.map(...)` block; drop the `LANG_CATEGORIES.map(...)` branch and the surrounding ternary
- The "All" option becomes `'All Types'`

- [ ] **Step 4: Add `setDrilledCategory(null)` to the tab-switch handlers**

Find the two existing tab-switch buttons (lines [304, 307](../../src/components/DiscoverSidebar.tsx)):

```tsx
<button className={`panel-tab${activeTab === 'language' ? ' active' : ''}`} onClick={() => { setActiveTab('language'); setSearch(''); setActiveCategory(null); setDropdownOpen(false) }}>
  Language{...}
</button>
<button className={`panel-tab${activeTab === 'type' ? ' active' : ''}`} onClick={() => { setActiveTab('type'); setSearch(''); setActiveCategory(null); setDropdownOpen(false) }}>
  Type{...}
</button>
```

Add `setDrilledCategory(null)` to both `onClick` handlers:

```tsx
<button className={`panel-tab${activeTab === 'language' ? ' active' : ''}`} onClick={() => { setActiveTab('language'); setSearch(''); setActiveCategory(null); setDropdownOpen(false); setDrilledCategory(null) }}>
  Language{...}
</button>
<button className={`panel-tab${activeTab === 'type' ? ' active' : ''}`} onClick={() => { setActiveTab('type'); setSearch(''); setActiveCategory(null); setDropdownOpen(false); setDrilledCategory(null) }}>
  Type{...}
</button>
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/components/DiscoverSidebar.test.tsx`
Expected: 3 new tests pass; all earlier tests still pass.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/components/DiscoverSidebar.tsx src/components/DiscoverSidebar.test.tsx
git commit -m "feat(filter): scope dropdown to Type tab + reset drill-in on tab switch"
```

---

## Task 7 — Final review, manual smoke test, and code-reviewer dispatch

Per project `CLAUDE.md`, small UI/CSS work executes inline and gets **one** final code-review pass across the whole diff.

- [ ] **Step 1: Verify the full test suite is green**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Type-check**

`package.json` does not define a dedicated typecheck script. Run TypeScript directly:

Run: `npx tsc --noEmit`
Expected: no type errors. (The `vite build` step also type-checks, but `tsc --noEmit` is faster for an isolated check.)

- [ ] **Step 3: Manual smoke test (user runs the app)**

The user has a memory note that they test UI changes themselves — do not launch the dev server. Hand off with a short note describing what to try:

- Default view: Popular tile + 10 (Use Case) or 24 (Platform) category tiles, no language rows visible.
- Click a tile: drills in, language list appears with back-nav header.
- Click "← All Languages": returns to tile grid.
- Toggle Use Case ↔ Platform: tile set changes (10 vs 24).
- Type in search: flat list with `· in {Category}` captions; clear search returns to where you were.
- Switch to Type tab and back: drill-in is reset; default tile grid shown.
- Library mode: tiles with zero items hidden; existing item-count behavior preserved.

- [ ] **Step 4: Dispatch one `superpowers:code-reviewer` agent across the diff from main**

Use the `git diff main..HEAD` (or whatever the merge-base is at the start of this work) to scope the review.

- [ ] **Step 5: Address review findings inline, then done.**

If the reviewer surfaces issues that reveal the work was substantially heavier than estimated, finish fixes inline rather than retroactively switching to a heavier process.

---

## Out of scope (re-stated for the implementer)

- Any change to the Type tab rendering (it keeps the existing `bucket-group` layout).
- Any change to the rail, the panel chrome, the Advanced filters tab.
- Any change to the catalogue itself (no new categories, no merges).
- Any persistence of `drilledCategory` across panel close/reopen (intentional).
- **Cross-fade animation between sub-views** — the spec calls for a ~150ms opacity cross-fade when swapping default ↔ drilled-in ↔ search. The plan deliberately omits this to keep the change minimal; the inherited `.subtype-row` / `.lang-tile` hover transitions are sufficient. If the animation is wanted, add it as a follow-up — wrap the three sub-view branches in an `AnimatePresence` (or a CSS keyed `key` prop with `transition: opacity 150ms`).
