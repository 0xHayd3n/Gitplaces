# Discover redesign — Netflix-minimal top nav

**Date:** 2026-05-27
**Status:** Spec ready for plan
**Scope:** Discover view only (does not touch the global bottom Dock)

## Goal

Strip the Discover view to a Netflix-style minimal shell:

- A single horizontal pill bar at the top with **search + tabs**, no logo, no permanent filter button.
- A pure-rows Home view (no main grid).
- An Agents tab driven by the user's existing local prompt library.
- All active filters represented as removable chips above the only remaining grid views.

## Non-goals

- Touching the bottom Dock (global app nav stays).
- Building an external Agents marketplace / recommendation backend.
- Adding new filter types — surfaces existing language/subtype/stars/activity/license/verification filters through new UI.
- Mobile / narrow-width responsive design beyond what the existing `compact` pattern already provides.

## High-level shape

```
┌──────────────────────────────────────────────────────────────┐
│                  [🔍]  [ Home* ]  [ Recommended ]  [ Agents ] │   ← centered pill bar
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                                                      │    │
│  │                    Hero banner                       │    │
│  │                                                      │    │
│  │  Title                                               │    │
│  │  Description                                         │    │
│  │  [pill: Type] [pill: Language]   ← moved inline      │    │
│  │  by Owner                                            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Recommended for You  >                                      │   ← carousel row
│  [card] [card] [card] [card] [card]                          │
│                                                              │
│  Agents  >                                                   │   ← carousel row
│  [agent] [agent] [agent] [agent] [agent]                     │
│                                                              │
│  Most Popular                                                │   ← carousel row (no tab)
│  [card] [card] [card] [card] [card]                          │
└──────────────────────────────────────────────────────────────┘
```

When a tab other than Home is active, the hero + rows are replaced by a filter chip row and a vertical-scrolling grid of that tab's items.

## Components

### 1. Top nav (rewrite `DiscoverTopNav.tsx`)

A single centered pill bar. Two visual states:

| State    | Trigger                                 | Content                                              |
|----------|-----------------------------------------|------------------------------------------------------|
| Tabs     | default                                 | `[🔍]` search icon · 3 text tabs (Home / Recommended / Agents) |
| Searching | user clicks `[🔍]`                       | search icon stays leading, tabs fade out, input expands, trailing `[×]` to collapse |

- Active tab uses Netflix-style dark pill background (`background: rgba(0,0,0,0.7); border-radius: 999px`).
- Tab state is URL-driven via the existing `?view=` query param. `view=home` is implicit (omitted in URL).
- The existing `discover-top-nav--compact` scroll-docking behavior is preserved unchanged.
- No GitSuite logo. No persistent filter button. The `dtn-brand-*` block and the filter-button JSX are removed.
- Search expansion is **component-local state**; closing it implicitly restores the prior tab. Esc collapses.

Public contract: same `DiscoverSidebarProps` the panel content needs — this is the host change only.

### 2. Hero badge relocation (`DiscoverHero.tsx`)

`.discover-hero-content` drops its right-side `.discover-hero-badges` column. Badges move inline into `.discover-hero-text`, between description and owner:

```
discover-hero-text
├── discover-hero-title-row
├── discover-hero-desc
├── discover-hero-badges  (moved — now full pills, label visible inline)
└── discover-hero-owner-row
```

Pill style changes from icon-only-with-hover-reveal to **full pills with text always visible**. Reuses `.repo-card-pill` styling for consistency (rounded 999px, accent-tinted background, icon + label).

Right side of the hero stays vacant — the dithered avatar art shows through.

### 3. Filter chip row (`FilterChipRow.tsx`, new)

Sits inside `.discover-content-inner`, above the grid on Recommended/Agents tabs only. **Never rendered on Home** (Home's rows are curated and don't honour filters). **Not rendered on Recommended/Agents when no filters are active** and no panel is open — keeps chip-less tab states completely clean.

```
[ TypeScript × ]  [ Stars > 1k × ]  [ Verified × ]   [ + Filter ]
```

- One chip per active filter (language, subtype, stars, activity, license, verification, active tags).
- Each chip's `×` removes that filter individually.
- Trailing `+ Filter` button opens `FilterOverlay` anchored to itself.
- Chip style reuses `.repo-card-pill` look.

### 4. Filter overlay (`FilterOverlay.tsx`, new)

Popover anchored to the `+ Filter` button. Hosts the existing `FilterPanel` and `AdvancedPanel` content (no logic change — these components already implement the language/type/advanced UI; we just move where they live). Closes on outside click or Esc.

### 5. Agent card (`AgentCard.tsx` + `.css`, new)

Visually distinct from `RepoCard` — agents have no banner image, they have a color swatch + emoji. Card shape mirrors `RepoCard`'s ~230px height so the Home rows align:

```
┌──────────────────────────────┐
│   [swatch: gradient + emoji] │   ← 80px, linear-gradient(135deg, color_start, color_end), emoji ~32px
├──────────────────────────────┤
│  Agent Name                  │   ← 18px bold
│  @handle                     │   ← 12.5px muted
│  [Subagent] [Slash Command]  │   ← pills, only when is_subagent / is_slash_command === 1
│  Description, 2 lines max…   │   ← 14px, 2-line clamp
└──────────────────────────────┘
```

- Click navigates to `/agents/:id` (existing route).
- Swatch falls back to a neutral grey when `color_start` is null.

### 6. Agent ranking (`src/lib/agentRanking.ts`, new)

Pure function `rankAgents(agents: AgentRow[]): AgentRow[]`. Three concatenated tiers:

1. **Pinned** (`pinned === 1`), sorted by `pinned_at` desc.
2. **Recently used** (`last_used_at !== null` AND `pinned !== 1`), sorted by `last_used_at` desc.
3. **Unused** (`last_used_at === null` AND `pinned !== 1`), sorted by `created_at` desc — newer-first so freshly created/imported agents surface before stale unused ones.

Final list is `[...pinned, ...recent, ...unused].slice(0, 60)`. Unit-tested with fixture combinations covering all three tiers and tie-breaks within each.

### 7. `DiscoverRow` generalisation

The current `DiscoverRow.tsx` has an inline `DiscoverRowCardItem` hardcoded to `RepoRow`. Extract this as `DiscoverRowRepoCard.tsx`, add `DiscoverRowAgentCard.tsx`, and let `DiscoverRow` accept a `renderCard` prop. No change to the carousel layout / pagination logic.

### 8. `DiscoverGrid` agent branch

`DiscoverGrid.tsx` already branches on `layoutPrefs.mode` (grid/list). Add a parallel branch on the new `viewMode === 'agents'`: grid mode renders `AgentCard`, list mode renders `AgentListRow` (small sibling of `RepoListRow`, deferred if not needed in this pass).

### 9. `Discover.tsx` changes

- Replace `<GridHeader>` usage with `<FilterChipRow>`.
- The conditional Most Popular grid (under `<div className="discover-content-inner">`) becomes a third `<DiscoverRow>` carousel on Home.
- Add a branch for `viewMode === 'agents'`: fetch via `window.api.agents.getAll()`, pass through `rankAgents()`, render the chip row + grid.
- Snapshot restore: when a saved snapshot has `viewMode === 'last-visited'` or `'trending'`, normalise to `'all'` (Home).

## Data flow

**Home view:**
```
Discover.tsx
  ├── DiscoverHero (existing data: rowRepos[heroIndex])
  ├── DiscoverRow title="Recommended for You" repos={rowRepos}
  ├── DiscoverRow title="Agents"              agents={rankedAgents}
  └── DiscoverRow title="Most Popular"        repos={popularRepos}
```

**Recommended tab:**
```
Discover.tsx
  ├── FilterChipRow (active filters + + Filter button)
  └── DiscoverGrid visibleRepos={recommendedRepos}
```

**Agents tab:**
```
Discover.tsx
  ├── FilterChipRow (chips for language/type if applicable; agents may or may not honour them — see Open Questions)
  └── DiscoverGrid mode="agents" agents={rankedAgents}
```

## Removed code

- `.dtn-brand-*` CSS classes and the `<div className="dtn-brand">` JSX block in `DiscoverTopNav.tsx`.
- `.dtn-search-filter-btn` and `.dtn-search-filter-label` (filter button no longer lives in nav).
- `.discover-hero-badges` CSS column rules; `.discover-hero-icon-badge-text` hover-reveal animation (badges always show text now).
- `GridHeader` usage in `Discover.tsx` (component itself can stay if used elsewhere; verify usage and either keep or delete).
- View modes `last-visited` and `trending` from `ViewModeKey`. The recently-visited row + carousel state in `Discover.tsx` is removed.
- `_popularModuleCache` and `loadCachedPopular` / `saveCachedPopular` are retained; their data now feeds the Most Popular row on Home instead of the main grid.

## URL contract

| URL                                  | Renders                                          |
|--------------------------------------|--------------------------------------------------|
| `/discover` or `/discover?view=home` | Home (hero + 3 rows)                             |
| `/discover?view=recommended`         | Recommended grid (with chip row when filtered)   |
| `/discover?view=agents`              | Agents grid (with chip row when filtered)        |
| `/discover?view=last-visited`        | Normalised to Home on mount                      |
| `/discover?view=trending` or `=all`  | Normalised to Home on mount                      |

Search expanded state is intentionally **not** in the URL — it's transient UI.

## Testing

New tests:
- `agentRanking.test.ts` — fixture covering all three tiers, ties, and the 60-cap.
- `AgentCard.test.tsx` — renders gradient swatch, emoji, name, handle, conditional Subagent/Slash pills, click → `/agents/:id`.
- `FilterChipRow.test.tsx` — chip per active filter, `×` clears one filter, `+ Filter` opens overlay, hides entire row when no filters and overlay closed.
- `FilterOverlay.test.tsx` — outside click / Esc closes; FilterPanel + AdvancedPanel tab switching works.

Updated tests:
- `DiscoverTopNav.test.tsx` — rewritten against new pill-bar contract (the current tests already reference stale Home/Browse buttons that don't exist; this is a clean-up point).
- `DiscoverHero.test.tsx` — assert badges render between description and owner; assert right-side column is gone.
- `Discover.test.tsx` (if exists) — Home renders three rows; tabs swap to chip row + grid; snapshot normalisation handles dropped view modes.

## Implementation order (for the plan)

1. **`AgentCard` + `agentRanking` + tests** (isolated unit, no integration yet).
2. **`FilterChipRow` + `FilterOverlay` + tests** (isolated; existing `FilterPanel`/`AdvancedPanel` are reused as-is).
3. **`DiscoverRow` generalisation** (`renderCard` prop).
4. **`DiscoverHero` badge relocation** (CSS + minor JSX shuffle, low blast radius).
5. **`DiscoverTopNav` rewrite** to the new pill bar (replaces filter button, drops brand).
6. **`Discover.tsx` wiring** — chip row + Most Popular row + Agents view + snapshot normalisation.
7. **Cleanup** — remove dead CSS, dead view modes from `ViewModeKey`, dead caches/state.

## Open questions for the plan

- **Do filters apply to the Agents tab?** Language filter doesn't apply naturally (agents have no language). Subtype doesn't apply either. Either (a) hide the chip row entirely on the Agents tab (recommended), or (b) keep it visible but only honour agent-relevant filters (none today → effectively (a)). Pick during plan.
- **Most Popular row pagination depth.** Today the carousel shows a small handful of items because the grid takes over. With no grid, do we let the row scroll horizontally through 100 items, or cap at 25? Pick during plan; default suggestion: 30 with horizontal pagination.
- **List mode for Agents.** Layout dropdown lets users toggle grid/list. Defer `AgentListRow` to a follow-up unless the user explicitly wants it; for now the layout-mode toggle is hidden / disabled on the Agents tab.

## Estimated size

- 5 new files (`AgentCard`, `agentRanking`, `FilterChipRow`, `FilterOverlay`, `DiscoverRowAgentCard`) + their `.css` siblings + tests.
- 6 modified files (`DiscoverTopNav`, `DiscoverHero`, `Discover`, `DiscoverRow`, `DiscoverGrid`, `discoverQueries`).
- ~600–900 LOC total including tests and CSS. Heavy-path.
