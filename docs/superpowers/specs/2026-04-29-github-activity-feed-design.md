# GitHub Activity Feed — Design Spec

**Date:** 2026-04-29  
**Status:** Approved

---

## Overview

Replace the "No skills installed yet" empty state in the Library's main content area with a live GitHub activity feed — the same network feed a user sees on GitHub.com's home page. When a user selects a repo from the sidebar, the feed is replaced by the existing `RepoDetail` view. A new "Summary" button in the sidebar lets the user navigate back to the feed at any time.

---

## Architecture

### Approach

Renderer-side polling. The feed component fetches and polls GitHub's `received_events` API via the existing IPC channel. No new main-process services or database tables required.

### New files

| File | Purpose |
|------|---------|
| `src/hooks/useFeed.ts` | Fetches and polls received_events; returns `{ events, loading, error, refresh }` |
| `src/components/ActivityFeed.tsx` | Feed container — header, scrollable event list, all states |
| `src/components/ActivityFeed.css` | Styles for the feed container and states |
| `src/components/ActivityEvent.tsx` | Single event card — avatar, description, timestamp |
| `src/components/ActivityEvent.css` | Styles for individual event cards |

### Modified files

| File | Change |
|------|--------|
| `electron/github.ts` | Add `getReceivedEvents(token, username)` |
| `electron/preload.ts` | Expose `window.api.github.getReceivedEvents(username)` |
| `electron/main.ts` | Add `ipcMain.handle('github:getReceivedEvents', ...)` handler |
| `src/views/Library.tsx` | Replace empty state `<Route index>` with `<ActivityFeed />` |
| `src/components/LibrarySidebar.tsx` | Add "Summary" item above segment filter pills |

---

## Data Flow

```
useFeed hook
  ├─ reads login from GitHubAuthContext
  ├─ on mount: fetch immediately
  ├─ setInterval(fetch, 5 minutes)
  └─ on unmount: clearInterval

fetch()
  → window.api.github.getReceivedEvents(login)
  → IPC: github:getReceivedEvents
  → getReceivedEvents(token, username) in electron/github.ts
  → GET /users/{username}/received_events?per_page=30
  → filter to: ReleaseEvent, ForkEvent, WatchEvent, PullRequestEvent (merged only)
  → return GitHubEvent[]
```

---

## IPC Layer

**`electron/github.ts`** — new function:
```ts
export async function getReceivedEvents(token: string, username: string): Promise<GitHubEvent[]>
```
- Hits `GET /users/{username}/received_events?per_page=30`
- Filters response to high-signal types: `ReleaseEvent`, `ForkEvent`, `WatchEvent`, `PullRequestEvent`
- For `PullRequestEvent`: only includes events where `payload.action === 'closed'` and `payload.pull_request.merged === true`
- Returns typed array; throws on non-2xx

**`electron/preload.ts`** — expose:
```ts
window.api.github.getReceivedEvents(username: string): Promise<GitHubEvent[]>
```

**`electron/main.ts`** — handler:
```ts
ipcMain.handle('github:getReceivedEvents', async (_, username: string) => {
  return getReceivedEvents(getToken(), username)
})
```

---

## Hook: `useFeed`

```ts
interface FeedState {
  events: GitHubEvent[]
  loading: boolean
  error: string | null
  refresh: () => void
}
```

- Reads `user.login` from `GitHubAuthContext`. If no user (unauthenticated), returns `{ events: [], loading: false, error: null, refresh: noop }` immediately — no fetch attempted.
- Fetches on mount, then polls every 5 minutes.
- On unmount, clears the interval.
- `refresh()` triggers an immediate out-of-cycle fetch and resets the interval timer.

---

## Components

### `ActivityFeed`

Container component rendered at the Library index route (`/library` with no repo selected).

**Layout:**
- Fixed header row: "Activity" label (left) + refresh icon button (right)
- Scrollable list of `ActivityEvent` cards below
- Matches the visual weight of the existing LibraryGrid/LibraryListRow area

**States:**
| State | Display |
|-------|---------|
| Unauthenticated | "Connect your GitHub account to see your activity" (no fetch) |
| Loading (first fetch) | Skeleton placeholder rows matching card height |
| Empty (zero events) | "Nothing in your network yet" |
| Error | "Couldn't load activity" + refresh button remains visible |
| Populated | Scrollable list of `ActivityEvent` rows |

### `ActivityEvent`

Single event card rendered as a compact row.

**Elements:**
- **Avatar** — circular avatar image from `event.actor.avatar_url` (no extra API call; included in Events API response)
- **Description** — human-readable sentence (bold actor name, bold repo/tag names):
  - `WatchEvent` → "**actor** starred **owner/repo**"
  - `ForkEvent` → "**actor** forked **owner/repo** → **actor/repo**"
  - `ReleaseEvent` → "**actor** released **v1.2.0** on **owner/repo**"
  - `PullRequestEvent` (merged) → "**actor** merged a PR into **owner/repo**"
- **Timestamp** — relative time ("3 hours ago") computed inline, no external library
- **Clickable repo name** — if the repo is in `SavedReposContext`, clicking navigates to `/library/repo/:owner/:name`; otherwise the text is non-interactive

---

## Navigation

### "Summary" button in LibrarySidebar

A new clickable row added above the existing segment filter pills (All, Learned, Unstarred, Own, Recent, Archive).

- Label: "Summary"
- Active state: highlighted when the current route is exactly `/library` (i.e., no repo selected)
- On click: `navigate('/library')` — clears repo selection, renders `ActivityFeed` in main area
- Active state is derived purely from the route; no new context or state needed

### Route change

`Library.tsx` currently renders an empty placeholder at its index route. This is replaced:

```tsx
// Before
<Route index element={<EmptyState />} />

// After
<Route index element={<ActivityFeed />} />
```

When a repo is selected from the sidebar, the existing `navigate('/library/repo/:owner/:name')` call is unchanged — it replaces the feed with `RepoDetail` as before.

---

## Event Type Reference

| GitHub type | Condition | Shown as |
|-------------|-----------|----------|
| `WatchEvent` | `payload.action === 'started'` | starred |
| `ForkEvent` | always | forked |
| `ReleaseEvent` | `payload.action === 'published'` | released |
| `PullRequestEvent` | `action === 'closed'` && `merged === true` | merged a PR |

All other event types are discarded before returning to the renderer.

---

## Out of Scope

- Pagination / infinite scroll (show latest 30 events only)
- Clicking non-library repos to open GitHub externally
- Configurable polling interval (hardcoded 5 minutes)
- Persisting events across app restarts (no DB involvement)
- Notification badges or unread indicators
