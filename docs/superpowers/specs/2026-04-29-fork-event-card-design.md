# Fork Event Card — Design Spec

**Date:** 2026-04-29
**Status:** Approved

## Overview

Replace the plain-text fork event row in the ActivityFeed with a visual two-card layout: the original repo on the left, an arrow in the middle, and the user's new fork on the right. Both cards show real metadata fetched from the GitHub API (description, language, stars/forks count).

## User-facing behaviour

- ForkEvents in the activity feed render a `ForkEventCard` instead of a text description.
- The card shows the actor header (`{actor} forked a repository · {timestamp}`) above two mini repo cards joined by an arrow (`→`).
- **Original repo card** (left): grey border, shows owner, repo name, description (2-line clamp), language dot, star count, fork count.
- **Fork card** (right): blue border, "fork" badge (top-right), shows owner, repo name, description, language. Star and fork counts are omitted — the fork card intentionally shows less metadata to visually distinguish it from the original.
- Hovering either card brightens its border to `#58a6ff`.
- Clicking either card opens `https://github.com/{owner}/{repo}` in a new tab.
- While API data is loading, both cards render animated skeleton placeholders.
- If either API fetch fails, the card falls back to displaying just the repo name and owner with no stats — the event remains useful.

## Components

### `ForkEventCard.tsx` (new)

Top-level component for a fork feed event.

**Props:** `{ event: GitHubFeedEvent }`

**Responsibilities:**
- Extracts `originalFullName` from `event.repo.full_name` and `forkFullName` from `(event.payload as { forkee: { full_name: string } }).forkee.full_name`.
- Calls `useForkData(originalFullName, forkFullName)`.
- Renders the actor header row: `event.actor.avatar_url` (20px circle), `event.actor.login` (bold), "forked a repository" text, and relative timestamp from `event.created_at` — right-aligned.
- Renders two `ForkMiniCard` sub-components separated by the arrow glyph.
- Renders skeleton cards when `loading === true`.

`ForkMiniCard` is a local sub-component inside the same file — it is only used here.

**`ForkMiniCard` props:**
```ts
interface ForkMiniCardProps {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  isFork: boolean
}
```

Renders as an `<a>` tag linking to `https://github.com/{owner}/{name}` (`target="_blank" rel="noreferrer"`).

### `ForkEventCard.css` (new)

Styles for `ForkEventCard` and `ForkMiniCard`. Follows the existing CSS-file-per-component pattern used throughout the project.

Key rules:
- `.fork-event` — flex column, gap 10px, padding matches existing event rows.
- `.fork-header` — flex row, 20px avatar, muted text, timestamp right-aligned.
- `.fork-body` — flex row, `align-items: center`, gap 8px.
- `.mini-card` — `flex: 1`, dark background, 8px border-radius, 1px border `#30363d`, 10px 12px padding, hover border `#58a6ff`.
- `.mini-card.fork-card` — border `#1f6feb`, background `#0a1628`.
- `.fork-badge` — 9px uppercase label, blue-on-dark-blue pill.
- `.fork-arrow` — muted colour `#484f58`, 18px, non-interactive.
- Skeleton shimmer animation matching `ActivityFeed.css` pattern.

### `useForkData.ts` (new)

**Signature:**
```ts
function useForkData(
  originalFullName: string,
  forkFullName: string
): { original: ForkRepoData | null; fork: ForkRepoData | null; loading: boolean }
```

**`ForkRepoData`:**
```ts
interface ForkRepoData {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
}
```

**Implementation:**
- This is an Electron app; the GitHub OAuth token lives in the main process and is never exposed to the renderer. All GitHub API calls from the renderer go through the `window.api.github` IPC bridge.
- Use `window.api.github.getRepo(owner, name)` to fetch each repo. This IPC handler already exists (`electron/main.ts`), handles auth internally, and returns a `RepoRow | null`. Map the relevant `RepoRow` fields to `ForkRepoData`: `description`, `language`, `stars`, `forks`.
- Module-level `Map<string, ForkRepoData | null>` cache — keyed by `full_name`. Populated on resolution (including `null` for failures); never invalidated within a session.
- On mount, each key is checked independently. Keys already in the cache (whether populated or `null`) are resolved immediately without a network call. Only uncached keys trigger `window.api.github.getRepo`. If both are cached, `loading` starts as `false` with no effect.
- Uncached repos are fetched in parallel via `Promise.allSettled`. Sets `loading: false` after all outstanding fetches settle.
- On IPC error or `null` return for a repo, stores `null` in the cache for that key so subsequent renders resolve immediately from cache without retrying.

### `ActivityEvent.tsx` (modify)

The `buildDescription()` function returns a `{ parts }` object — not JSX — so the integration point is **not** inside that switch. Instead, add an early return guard at the top of the `ActivityEvent` component render function (before `buildDescription` is called):

```tsx
if (event.type === 'ForkEvent') {
  return <ForkEventCard event={event} />
}
```

This short-circuits the text rendering path for fork events entirely. The existing `'ForkEvent'` case inside `buildDescription` can be left in place (it becomes dead code for fork events) or removed — either is acceptable.

## Data flow

```
FeedEvent (ForkEvent)
  └── event.repo.full_name          → originalFullName
  └── event.payload.forkee.full_name → forkFullName

ForkEventCard
  └── useForkData(originalFullName, forkFullName)
        ├── cache hit → return immediately
        └── cache miss → window.api.github.getRepo × 2 (parallel, IPC to main process)
              └── RepoRow → mapped to ForkRepoData { owner, name, description, language, stars, forks }

  └── render ForkMiniCard × 2 + arrow
        loading=true  → skeleton placeholders
        loading=false → populated cards
        fetch failed  → minimal card (name + owner only)
```

## File summary

| File | Change |
|---|---|
| `src/components/ForkEventCard.tsx` | New |
| `src/components/ForkEventCard.css` | New |
| `src/hooks/useForkData.ts` | New |
| `src/components/ActivityEvent.tsx` | Modify — add ForkEvent case |

Estimated scope: ~240 lines across 4 files.
