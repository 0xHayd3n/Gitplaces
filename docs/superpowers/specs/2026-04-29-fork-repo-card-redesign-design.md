# ForkMiniCard → ForkRepoCard Redesign

**Date:** 2026-04-29
**Status:** Approved

## Overview

Replace the compact `ForkMiniCard` components inside `ForkEventCard` with a new `ForkRepoCard` component that visually matches the `RepoCard` used in the Discover grid — same zone structure (dither header, info panel), same language icon badge treatment, same avatar placement, same footer stats.

## Visual design

Each fork event renders two `ForkRepoCard` instances side by side, separated by a circle-badge arrow. Each card has:

1. **Dither header (65px)** — `DitherBackground` canvas seeded with the owner's avatar URL. The fork card's right variant shows a "FORK" pill badge (top-right, blue, matching existing style).
2. **Info panel:**
   - Title row: `[28px avatar] [repo name, flex-grow] [language icon badge, right-aligned]`
   - Description (2-line clamp, 10.5px, muted)
   - Creator row: `[16px round avatar] [owner username, monospace]`
   - Stats footer: star count + fork count (fork count hidden on the fork card)
3. **Language badge** — reuses `.repo-card-icon-badge` / `LanguageIcon size={18} boxed`. 24×24 square, text label slides out left on hover.

The arrow between cards changes from a plain `→` character to a 30×30 circle (`background: #161b22`, `border: 1px solid #30363d`) centred in a 44px-wide flex column, vertically aligned to the card midpoint.

## Files

| File | Change |
|---|---|
| `src/components/ForkRepoCard.tsx` | New — the card component and its skeleton |
| `src/components/ForkRepoCard.css` | New — card-specific styles |
| `src/components/ForkEventCard.tsx` | Remove `ForkMiniCard` + `ForkMiniCardSkeleton`; import `ForkRepoCard`; replace arrow markup |
| `src/components/ForkEventCard.css` | Remove mini-card rules; restyle arrow to circle badge |
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

The component is an `<a>` tag linking to `https://github.com/${owner}/${name}` (target `_blank`, rel `noreferrer`), matching existing behaviour.

## Data

`useForkData` derives `avatarUrl` from the already-fetched owner string — no additional API call:

```ts
avatarUrl: `https://github.com/${data.owner}.png?size=40`
```

`ForkRepoData` gains `avatarUrl: string`. The hook already fetches owner from the GitHub repo API response; this field is derived inline before returning.

## Skeleton

`ForkRepoCardSkeleton` mirrors the three zones:

- Dither area: solid `#161b22` block, 65px, no shimmer
- Title row: shimmer pill (avatar) + shimmer bar (name) + shimmer square (badge)
- Description: two full-width shimmer lines
- Creator row: shimmer circle + short shimmer bar
- Stats: one short shimmer bar

Uses the existing `fork-shimmer` keyframe animation from `ForkEventCard.css`.

## What is not changing

- `ForkEventCard` outer structure (header with actor avatar, timestamp, border-bottom)
- `useForkData` fetch logic and error/fallback behaviour
- `ActivityFeed` and `useFeed` — no changes needed
- Card click behaviour (opens GitHub in new tab)
