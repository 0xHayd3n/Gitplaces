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

## Types

Define in `electron/github.ts` alongside existing interfaces (`GitHubRepo`, `GitHubRelease`, etc.):

```ts
export interface GitHubEventActor {
  login: string
  avatar_url: string
}

export interface GitHubEventRepo {
  name: string  // "owner/repo" format
}

export type GitHubEventPayload =
  | { action: 'started' }                                                            // WatchEvent
  | { forkee: { full_name: string } }                                               // ForkEvent
  | { action: 'published'; release: { tag_name: string } }                         // ReleaseEvent
  | { action: 'closed'; pull_request: { merged: boolean; title: string } }         // PullRequestEvent

export interface GitHubEvent {
  id: string
  type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
  actor: GitHubEventActor
  repo: GitHubEventRepo
  payload: GitHubEventPayload
  created_at: string
}
```

These types are used in `electron/github.ts`, `electron/preload.ts`, and `src/hooks/useFeed.ts`.

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

**`electron/main.ts`** — handler with null token guard:
```ts
ipcMain.handle('github:getReceivedEvents', async (_, username: string) => {
  const token = getToken()
  if (!token) return []
  return getReceivedEvents(token, username)
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
- **Clickable repo name** — if the repo has an installed skill (`isSaved(owner, name)` returns true from `useSavedRepos()`), clicking navigates to `/library/repo/:owner/:name`; otherwise the text is non-interactive. Starred-only repos do not qualify.

---

## Navigation

### "Summary" button in LibrarySidebar

A new clickable row added above the existing segment filter pills (All, Learned, Unstarred, Own, Recent, Archive).

- Label: "Summary"
- Active state: highlighted when the current route is exactly `/library` (i.e., no repo selected)
- On click: `navigate('/library')` — clears repo selection, renders `ActivityFeed` in main area
- Active state is derived purely from the route; no new context or state needed

### Library.tsx change

`Library.tsx` renders the main content area via a conditional — not a `<Route index>`. The current pattern is:

```tsx
{hasDetail ? (
  <Routes>
    <Route path="repo/:owner/:name" element={<RepoDetail />} />
    <Route path="collection/:id" element={<CollectionDetail />} />
  </Routes>
) : (
  <div className="library-detail-empty">...</div>
)}
```

Replace the `<div className="library-detail-empty">` block with `<ActivityFeed />`:

```tsx
{hasDetail ? (
  <Routes>
    <Route path="repo/:owner/:name" element={<RepoDetail />} />
    <Route path="collection/:id" element={<CollectionDetail />} />
  </Routes>
) : (
  <ActivityFeed />
)}
```

No router restructure needed. When a repo is selected from the sidebar, the existing `navigate('/library/repo/:owner/:name')` call is unchanged — it sets `hasDetail` to true, replacing the feed with `RepoDetail`.

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

## Implementation Notes

- **`GitHubEventRepo.full_name`** — the GitHub Events API returns `event.repo.name` as the full `owner/repo` slug. Name it `full_name` in the interface (not `name`) to match `GitHubRepo` conventions and avoid confusion. `ActivityEvent` must split on `/` to extract `owner` and `repo` separately for navigation.
- **`useFeed` refresh interval** — `refresh()` must `clearInterval` the existing timer before calling `setInterval` again to avoid accumulating concurrent timers. Use a `useRef` to hold the interval ID, following the same pattern as `useArchivedRepos.ts`.
- **"Summary" button in mini mode** — `LibrarySidebar` collapses to 78px in mini mode via `.library-panel.mini`. The Summary button should be hidden in mini mode (matching the segment filter pills behavior), added via `.library-panel.mini .library-summary-btn { display: none }`.

---

## Out of Scope

- Pagination / infinite scroll (show latest 30 events only)
- Clicking non-library repos to open GitHub externally
- Configurable polling interval (hardcoded 5 minutes)
- Persisting events across app restarts (no DB involvement)
- Notification badges or unread indicators
