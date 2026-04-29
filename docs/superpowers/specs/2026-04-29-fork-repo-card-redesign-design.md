# ForkMiniCard → ForkRepoCard Redesign

**Date:** 2026-04-29
**Status:** Approved

## Overview

Replace the compact `ForkMiniCard` components inside `ForkEventCard` with a new `ForkRepoCard` component that visually matches the `RepoCard` used in the Discover grid — same zone structure (dither header, info panel), same language icon badge treatment, same avatar placement, same footer stats.

## Visual design

Each fork event renders two `ForkRepoCard` instances side by side, separated by a circle-badge arrow. Each card has:

1. **Dither header (65px)** — `DitherBackground` canvas seeded with the owner's avatar URL. Pass `fallbackGradient` derived from `getLangColor(language)` as a two-stop pair (`[getLangColor(language), '#0d1117']`); if `language` is null use `['#1a1f2e', '#0d1117']`. Wrap `DitherBackground` in a `.fork-repo-card__dither` div defined in `ForkRepoCard.css` (`position: relative; height: 65px; overflow: hidden`) — do **not** reuse `.repo-card-dither` to avoid inheriting Discover-grid media-query overrides. The fork card's right variant shows a "FORK" pill badge (top-right) — styles defined in `ForkRepoCard.css` (not reused from `ForkEventCard.css`): `background: #0d2044`, `border: 1px solid #1f6feb`, `color: #58a6ff`, `font-size: 8px`, `font-weight: 700`, `text-transform: uppercase`, `padding: 2px 6px`, `border-radius: 3px`.
2. **Info panel:**
   - Title row: `[28px avatar] [repo name, flex-grow] [language icon badge, right-aligned]`
   - Description (2-line clamp, 10.5px, muted) — omit the element entirely when `description` is null
   - Creator row: `[16px round avatar] [owner username, monospace]` — the avatar reuses the same `avatarUrl` prop displayed at 16px width/height
   - Stats footer: star count + fork count using `formatCount()` from `RepoCard.tsx` (e.g. "1.2k", not `.toLocaleString()`); fork count hidden on the fork card (`isFork === true`)
3. **Language badge** — reuses `.repo-card-icon-badge` / `LanguageIcon size={18} boxed`. 24×24 square, text label slides out left on hover. Omit entirely when `language` is null.

The arrow between cards changes from a plain `→` character to a 30×30 circle (`background: #161b22`, `border: 1px solid #30363d`) centred in a 44px-wide flex column, vertically aligned to the card midpoint (`align-self: center`).

## Files

| File | Change |
|---|---|
| `src/components/ForkRepoCard.tsx` | New — the card component and its skeleton |
| `src/components/ForkRepoCard.css` | New — card-specific styles (including dither wrapper and FORK pill badge) |
| `src/components/ForkEventCard.tsx` | Remove `ForkMiniCard` + `ForkMiniCardSkeleton`; import `ForkRepoCard`; replace arrow markup |
| `src/components/ForkEventCard.css` | Remove mini-card rules; restyle arrow to circle badge; **retain** `@keyframes fork-shimmer` |
| `src/hooks/useForkData.ts` | Add `avatarUrl: string` to `ForkRepoData` |

## Component interface

```ts
// ForkRepoCard.tsx
interface ForkRepoCardProps {
  owner: string
  name: string
  avatarUrl: string        // https://github.com/${owner}.png?size=40
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  isFork: boolean
}
```

The component is an `<a>` tag linking to `https://github.com/${owner}/${name}` (`target="_blank"`, `rel="noreferrer"`), matching existing behaviour.

## Card layout

`.fork-event__body` uses `display: flex; align-items: center`. Each `ForkRepoCard` has `flex: 1; min-width: 0` so both cards share the available width equally and long names truncate cleanly. No responsive breakpoint or vertical stacking needed — the activity feed column is a fixed width where the side-by-side layout always fits.

## Data

`useForkData` derives `avatarUrl` from the already-fetched owner string — no additional API call:

```ts
avatarUrl: `https://github.com/${data.owner}.png?size=40`
```

`ForkRepoData` gains `avatarUrl: string`. The hook already fetches owner from the GitHub repo API response; this field is derived inline before returning.

**Fallback path:** when the hook returns `null` for either repo (network failure / 404), `ForkEventCard` constructs `avatarUrl` from the full-name split: `https://github.com/${ownerFromFullName}.png?size=40`. The `avatarUrl` prop on `ForkRepoCard` is always a string — never undefined.

## Skeleton

`ForkRepoCardSkeleton` mirrors the three zones:

- Dither area: solid `#161b22` block, 65px, no shimmer
- Title row: shimmer pill (avatar 28px) + shimmer bar (name ~60%) + shimmer square (badge 24px)
- Description: two full-width shimmer lines
- Creator row: shimmer circle (16px) + short shimmer bar (~50px)
- Stats: one short shimmer bar (~80px)

Uses the `fork-shimmer` keyframe retained in `ForkEventCard.css`.

## What is not changing

- `ForkEventCard` outer structure (header with actor avatar, timestamp, border-bottom)
- `useForkData` fetch logic and error/fallback behaviour
- `ActivityFeed` and `useFeed` — no changes needed
- Card click behaviour (opens GitHub in new tab)
