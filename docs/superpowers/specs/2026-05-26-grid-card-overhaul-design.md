# Grid card overhaul — Nexus-style redesign

**Date:** 2026-05-26
**Status:** Spec
**Scope:** Visual + structural rewrite of `RepoCard` (grid) and `DiscoverRow` carousel cards across the Discover surface.

## Goal

Replace the data-dense card design with a Nexus-Mods-inspired layout that emphasises image, title, single type-pill, author, and short description. Drop everything else from the card surface. Both card variants — the horizontal carousel cards on the Discover landing rows ("Recommended for You" / "Last Visited" / "Most Popular") and the larger grid cards in the dedicated tab views — adopt the same layout so the two surfaces stay visually consistent.

## Final layout

Top-to-bottom inside a single card:

1. **Image area** (~140px tall, full card width)
   - `DitherBackground` continues to render the avatar-derived dither pattern.
   - **Language icon overlay** (top-left, 30×30px, frosted-glass square with `backdrop-filter: blur(8px)`). Renders the real `LanguageIcon` component, not a letter shorthand. Hidden if `repo.language` is absent. Clickable → `onLanguageClick(repo.language)`.
2. **Title block** (padding `12px 14px 14px`, gap 1px between rows)
   - **Title:** `repo.name`, 14px, 700 weight, `letter-spacing: -0.01em`, single-line ellipsis.
   - **Author subtitle:** `by {repo.owner}`, 11px, 400 weight, muted (`rgba(255,255,255,0.5)`), single-line ellipsis. Clickable → `onOwnerClick(repo.owner)`.
3. **Type pill** (own row, `width: fit-content`)
   - Accent colour: `typeConfig.accentColor` (subtype-specific). Falls back to `getBucketColor(typeBucket)` if a bucket is known but no subtype matched. Background uses the accent at 15% opacity; border at 30% opacity; text colour near-white.
   - Subtype icon (from `getSubTypeConfig(typeSub).icon`) renders inside a 16px solid-coloured circle (accent at 100%) on the **left**.
   - Label: `typeConfig.label`.
   - Shape: fully rounded (`border-radius: 999px`), padding `3px 10px 3px 6px`, gap 6px, font-size 10.5px.
   - Clickable → `onSubtypeClick(typeSub)`.
   - Pill is hidden entirely when `typeConfig` is null AND no `typeBucket` is available (i.e. classifier produced no result).
4. **Description** (2-line clamp, `-webkit-line-clamp: 2`)
   - 11.5px, muted (`rgba(255,255,255,0.55)`), line-height 1.45.
   - Uses the existing description-translation pipeline; `displayDescription` continues to be the source.
   - Hidden if empty.

Card chrome: `border-radius: 10px`, 1px translucent border, subtle hover (border brightens, slight `translateY(-2px)`).

## What's removed

From both `RepoCard.tsx` and `DiscoverRow.tsx`:

- **Star button + count** (`.repo-card-badge-br`, `.repo-card-actions`). Starring moves to detail-page only.
- **Learn button + progress** (`.repo-card-badge-learn`). Learn lives on detail page.
- **Owner stat row** (`.repo-card-stat-owner` with person icon). Author moves to title-block subtitle.
- **Recency timestamp** (`.repo-card-stat` with clock icon).
- **License chip** (DiscoverRow only).
- **Topic/tag chip row** (`CardTags` component import + render). The `CardTags` component file is left in place in case it's used elsewhere — verify with grep during implementation and delete the file if it has no remaining consumers.
- **Anchor attribution strip** ("Because you starred…", `.repo-card-anchors`). Recommendation anchors stop being surfaced on the card; they remain in the data layer for ranking.
- **In-info avatar thumbnail** (`.repo-card-avatar`, the 30×30 image in the info panel). The dithered image already carries avatar identity.
- **Verification badge** rendered on the card (`<VerificationBadge>` inline with the name). The verification data continues to populate via `useVerification`; just not displayed on cards.
- **Verified-org badge** next to owner (`<VerifiedBadge>`). Same reason.

Component props that become unused are removed from the interface:

- `RepoCardProps`: `onTagClick`, `activeTags`, `verificationTier`, `verificationSignals`, `verificationResolving`, `anchors`, `onStar`, `onLearn`, `viewMode`. (`learnState` is *kept* — see "What's preserved" — it drives the glow class.)
- `DiscoverRowCardItem` props: nothing to add/remove besides what the JSX consumes.

Callers of `RepoCard` (notably `DiscoverGrid`) stop passing the removed props.

## What's preserved

- `DitherBackground` for the image area.
- `getBucketColor` / `getSubTypeConfig` for pill colour + subtype icon.
- `LanguageIcon` for the image overlay.
- Description translation pipeline (the `displayDescription` effect with `getPreferredLang`, SQLite cache via `window.api.db.cacheTranslatedDescription`).
- Click-to-navigate to `/repo/:owner/:name`.
- Keyboard focus highlight (`.kb-focused` outline) — class application unchanged.
- Clickable owner subtitle → `onOwnerClick`/`openProfile`.
- Clickable language overlay → `onLanguageClick`.
- Clickable type pill → `onSubtypeClick`.
- **Starred glow border** (`.repo-card-starred`) and **learned glow border** (`.repo-card-learned`). The card *displays* these states from `repo.starred_at` / `learnState`, even though the buttons are gone. (`learnState` prop stays on `RepoCardProps` purely to drive the glow; the `onLearn` callback is dropped.)
- Anchors-by-id map and `anchors` prop: dropped from card; recommendation-engine wiring upstream untouched.

## CSS strategy

New shared class names under the existing `.repo-card-*` namespace. Both `RepoCard` and `DiscoverRow` adopt them so the inner card visuals stay 1:1 consistent. The outer carousel positioning (absolute layout, peek slots, transitions) in `DiscoverRow.css` stays unique.

**New classes (added to `src/styles/globals.css`):**

- `.repo-card-image` — image area, 140px tall, relative-positioned. Contains `DitherBackground` + overlay.
- `.repo-card-lang-overlay` — 30×30 frosted-glass square, top-left, holds the `LanguageIcon`.
- `.repo-card-body` — padding container, flex column, gap 8px.
- `.repo-card-title-block` — flex column, gap 1px (title + subtitle).
- `.repo-card-title` — 14px/700, single-line ellipsis. (Renames the current `.repo-card-name`.)
- `.repo-card-author` — 11px/400, muted, single-line ellipsis, hoverable colour bump.
- `.repo-card-pill` — fully rounded stadium pill with `--pill-accent` custom property for bucket colour.
- `.repo-card-pill-icon` — 16px solid-colour circle on the left of the pill.
- `.repo-card-desc` — 11.5px, 2-line clamp, muted. (Replaces the current `.repo-card-desc` justified-text styling; Knuth-Plass justification is dropped since clamped lines don't benefit from it.)

**Classes removed (from globals.css and DiscoverRow.css):**

- `.repo-card-actions`, `.repo-card-badge-br`, `.repo-card-badge-learn`, `.repo-card-badge-tl`
- `.repo-card-top`, `.repo-card-top-text`, `.repo-card-avatar`, `.repo-card-name`
- `.repo-card-grow`, `.repo-card-footer`, `.repo-card-footer-left`, `.repo-card-footer-badges`
- `.repo-card-stats`, `.repo-card-stat`, `.repo-card-stat-owner`
- `.repo-card-tags`, `.repo-card-tag`, `.repo-card-tag-text`, `.repo-card-tag-icon`
- `.repo-card-icon-badge` and friends (`.repo-card-icon-badge-icon`, `.repo-card-icon-badge-text`, `.repo-card-subtype-icon`)
- `.repo-card-anchors`, `.repo-card-anchors-label`, `.repo-card-anchor-chips`, `.repo-card-anchor-chip`, `.repo-card-anchor-avatar`, `.repo-card-anchor-name`
- Equivalent `.discover-row-card-*` classes in `DiscoverRow.css` (top/avatar/footer/stats/tag clusters).

**Classes preserved:**

- `.repo-card`, `.repo-card:hover`, `.repo-card.kb-focused`
- `.repo-card-starred`, `.repo-card-learned` (glow borders driven by data)
- `.repo-card-dither` → kept as alias for `.repo-card-image` for skeleton compatibility, or renamed if the skeleton is updated. Decide during implementation; default to keeping the alias so `.repo-card-skeleton-dither` stays meaningful.
- `.dither-canvas`, `.corner-glass*` (DitherBackground internals).
- `DiscoverRow.css`: outer carousel structure (`.discover-row`, `.discover-row-header`, `.discover-row-carousel`, `.discover-row-card` wrapper, `.discover-row-card--peek`, `.discover-row-card--p0`, `.discover-row-nav-zone*`, skeleton classes) all preserved.

## Component contract

### `RepoCard` (after)

```ts
interface RepoCardProps {
  repo: RepoRow
  onNavigate: (path: string) => void
  onOwnerClick?: (owner: string) => void
  onLanguageClick?: (lang: string) => void
  onSubtypeClick?: (subtypeId: string) => void
  typeSub?: string | null
  typeBucket?: string | null
  focused?: boolean
  learnState?: 'UNLEARNED' | 'LEARNING' | 'LEARNED'  // drives glow only
}
```

`useLearningProgress` is no longer called inside the card (no progress display). The `learnState` prop alone is enough to apply the glow class. The `viewMode` prop is dropped — it only fed an unused `_accentColor` and the now-removed anchor strip; the unused local should be deleted too. Caller (`DiscoverGrid`) stops passing it.

### `DiscoverRowCardItem` (after)

Internal to `DiscoverRow.tsx`. Same props as today minus all the action/state callbacks. Renders the same inner JSX as `RepoCard`. The outer `<button>` wrapper stays for carousel positioning.

### Pure presentational helper (optional)

Consider extracting a `<RepoCardBody>` sub-component that takes `{ repo, displayDescription, typeConfig, onOwnerClick, onSubtypeClick }` and renders title-block + pill + description. Both `RepoCard` and `DiscoverRow` would import it. Decision: extract if and only if it cleanly shares; if either site needs site-specific differences in the body, keep duplicated JSX. Make the call during implementation.

## Behaviour changes

| Behaviour | Before | After |
|---|---|---|
| Star a repo from card | One-click via overlay button | Removed — must open detail page |
| Learn a repo from card | One-click via overlay button | Removed — must open detail page |
| See learn progress on card | Progress % shown in button | Removed (only glow remains) |
| Filter by topic from card | Click tag chip | Removed (no chips). Use filter bar/search instead |
| Filter by language from card | Click footer language badge | **Preserved** — click language overlay on image |
| Filter by subtype from card | Click footer type badge | **Preserved** — click type pill |
| Open profile from card | Click owner stat | **Preserved** — click "by author" subtitle |
| See verification tier on card | Inline badge + signals | Removed (data still resolved in DB) |
| See "Because you starred…" anchors | Strip below card | Removed |

## Out of scope

- `DiscoverHero` (the large hero card at the top of the landing) — different component, not touched.
- `RepoDetail` page — star/learn live there, no changes needed for this overhaul.
- List-mode rows (`RepoListRow`) — separate component used in list view, not touched.
- `CardTags` component file — left in place; only removed from card consumers. If a follow-up grep shows it's unused everywhere, delete the file in a small cleanup commit.
- Sidebar filters, top nav, search behaviour — all untouched.
- Recommendation engine (`useRecommendations`, `getRecommended`) — anchor data still produced, just not surfaced on cards.

## Testing

- **`src/components/RepoCard.test.tsx`** — rewrite. New assertions:
  - Renders title, author subtitle, pill with subtype icon, description.
  - Does NOT render star button, learn button, tag chips, recency stat, verification badge, anchor strip.
  - Clicking owner subtitle calls `onOwnerClick`.
  - Clicking pill calls `onSubtypeClick`.
  - Clicking language overlay calls `onLanguageClick`.
  - `repo.starred_at` truthy still applies `.repo-card-starred`.
  - `learnState === 'LEARNED'` still applies `.repo-card-learned`.
- **`src/components/DiscoverRow.test.tsx`** — update existing tests. Drop assertions about star button / license / recency / tag rendering. Assert new title-block / pill / description structure. Carousel positioning and nav assertions stay intact.
- **`src/views/RepoDetail.badgePill.test.tsx`** — verify unaffected (it tests the detail page badge pill, not card pills).
- **Visual smoke test:** load Discover landing, switch to Recommended tab, switch to Last-Visited tab, switch to Most-Popular tab — confirm cards render with new layout in all four contexts (3 landing rows + 3 dedicated tab grids share the same card components).

## Open implementation decisions (defer to plan)

- Whether to extract `<RepoCardBody>` as a shared sub-component or duplicate the JSX in both sites. Decide based on which produces less coupling.
- Whether to remove the `Knuth-Plass justification` block from `RepoCard.tsx` (the `useLayoutEffect` with `justifyContent`) entirely, or keep it gated. Recommendation: remove — with 2-line clamp, justification is no longer needed.
- Whether to delete `CardTags` entirely or leave the file. Recommendation: grep, delete if unused.
- Whether to rename `.repo-card-dither` → `.repo-card-image` or keep both classes during the transition. Recommendation: rename, update `.repo-card-skeleton-dither` to match for consistency.
