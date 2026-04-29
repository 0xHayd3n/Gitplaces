# GitHub Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Library view's empty placeholder with a live GitHub activity feed that polls `/users/{username}/received_events` every 5 minutes and shows high-signal events (star, fork, release, merged PR); a "Summary" button in the sidebar navigates back to it from any repo detail view.

**Architecture:** Renderer-side polling via the existing IPC channel — no new main-process services or DB tables. A `useFeed` hook manages fetch and `setInterval`; `ActivityFeed` + `ActivityEvent` components render the result; the Library empty state conditional and LibrarySidebar both get small additions.

**Tech Stack:** Electron IPC, React Context (`GitHubAuthContext`, `SavedReposContext`), React Router v6 (`useLocation`, `useNavigate`, `useMatch`), TypeScript, plain CSS (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-04-29-github-activity-feed-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `electron/github.ts` | Add `GitHubEvent*` types + `getReceivedEvents()` |
| Modify | `electron/preload.ts` | Expose `window.api.github.getReceivedEvents` |
| Modify | `electron/main.ts` | Add `ipcMain.handle('github:getReceivedEvents', ...)` |
| Modify | `src/env.d.ts` | Add `getReceivedEvents` to `Window.api.github` type |
| Create | `src/hooks/useFeed.ts` | Fetch + polling hook |
| Create | `src/components/ActivityEvent.tsx` | Single event card |
| Create | `src/components/ActivityEvent.css` | Event card styles |
| Create | `src/components/ActivityFeed.tsx` | Feed container + all states |
| Create | `src/components/ActivityFeed.css` | Feed container styles |
| Modify | `src/views/Library.tsx` | Swap empty-state div for `<ActivityFeed />` |
| Modify | `src/components/LibrarySidebar.tsx` | Add "Summary" button + `useLocation`/`useNavigate` |
| Modify | `src/components/LibrarySidebar.css` | Summary button styles + mini-mode hide rule |

---

## Task 1: Add GitHubEvent types and `getReceivedEvents` to electron/github.ts

**Files:**
- Modify: `electron/github.ts` — add after line 73 (end of `BlobResult` interface)

- [ ] **Step 1: Add the types and function**

Open `electron/github.ts`. After line 73 (the closing `}` of `BlobResult`), insert:

```ts
// ── Activity Feed ─────────────────────────────────────────────────

export interface GitHubEventActor {
  login: string
  avatar_url: string
}

export interface GitHubEventRepo {
  full_name: string  // GitHub API field is called "name" but holds "owner/repo" slug
}

export type GitHubEventPayload =
  | { action: 'started' }
  | { forkee: { full_name: string } }
  | { action: 'published'; release: { tag_name: string } }
  | { action: 'closed'; pull_request: { merged: boolean; title: string } }

export interface GitHubEvent {
  id: string
  type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
  actor: GitHubEventActor
  repo: GitHubEventRepo
  payload: GitHubEventPayload
  created_at: string
}

const HIGH_SIGNAL = new Set(['WatchEvent', 'ForkEvent', 'ReleaseEvent', 'PullRequestEvent'])

export async function getReceivedEvents(token: string, username: string): Promise<GitHubEvent[]> {
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/received_events?per_page=30`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)

  const raw = await res.json() as Array<{
    id: string
    type: string
    actor: { login: string; avatar_url: string }
    repo: { name: string }
    payload: Record<string, unknown>
    created_at: string
  }>

  return raw
    .filter(e => HIGH_SIGNAL.has(e.type))
    .filter(e => {
      if (e.type === 'PullRequestEvent') {
        const pr = e.payload as { action?: string; pull_request?: { merged?: boolean } }
        return pr.action === 'closed' && pr.pull_request?.merged === true
      }
      return true
    })
    .map(e => ({
      id: e.id,
      type: e.type as GitHubEvent['type'],
      actor: e.actor,
      repo: { full_name: e.repo.name },
      payload: e.payload as GitHubEventPayload,
      created_at: e.created_at,
    }))
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd D:/Coding/Git-Suite && npx tsc --noEmit
```

Expected: no errors on the new lines. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add electron/github.ts
git commit -m "feat(feed): add GitHubEvent types and getReceivedEvents to github.ts"
```

---

## Task 2: Wire up IPC — preload.ts and main.ts

**Files:**
- Modify: `electron/preload.ts` — add inside `github:` object after line 50
- Modify: `electron/main.ts` — add handler after line 840

- [ ] **Step 1: Add to preload.ts**

In `electron/preload.ts`, on line 50, after `getRawFile: ...`, add a new entry inside the `github` object (before the closing `},` on line 51):

```ts
    getReceivedEvents: (username: string) =>
      ipcRenderer.invoke('github:getReceivedEvents', username) as Promise<import('./github').GitHubEvent[]>,
```

The `github` block should now end:
```ts
    getRawFile: (owner: string, name: string, branch: string, path: string) => ipcRenderer.invoke('github:getRawFile', owner, name, branch, path),
    getReceivedEvents: (username: string) =>
      ipcRenderer.invoke('github:getReceivedEvents', username) as Promise<import('./github').GitHubEvent[]>,
  },
```

- [ ] **Step 2: Add IPC handler to main.ts**

In `electron/main.ts`, after line 840 (the closing `})` of `github:getBlob`), before line 842 (the `// ── SVG cache IPC` comment), insert:

```ts
ipcMain.handle('github:getReceivedEvents', async (_event, username: string) => {
  const token = getToken()
  if (!token) return []
  return getReceivedEvents(token, username)
})
```

- [ ] **Step 3: Add `getReceivedEvents` to the main.ts import**

`getReceivedEvents` is not currently imported in `electron/main.ts`. Find the line near the top of `main.ts` that imports from `'./github'` (e.g. it imports `getUser`, `getStarred`, `getRepo`, etc.). Add `getReceivedEvents` to that destructured import.

- [ ] **Step 4: Add `getReceivedEvents` to `src/env.d.ts`**

`src/env.d.ts` declares the `Window.api.github` type (the `getRawFile` entry is at line 93, `getBlob` at line 92, closing brace `}` at line 94). Add `getReceivedEvents` after `getRawFile` (before the closing `}`):

```ts
        getRawFile:       (owner: string, name: string, branch: string, path: string) => Promise<ArrayBuffer>
        getReceivedEvents: (username: string) => Promise<Array<{
          id: string
          type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
          actor: { login: string; avatar_url: string }
          repo: { full_name: string }
          payload: Record<string, unknown>
          created_at: string
        }>>
      }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts electron/main.ts src/env.d.ts
git commit -m "feat(feed): expose getReceivedEvents via IPC"
```

---

## Task 3: Build `useFeed` hook

**Files:**
- Create: `src/hooks/useFeed.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useFeed.ts`:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { useGitHubAuth } from '../contexts/GitHubAuth'

export interface GitHubFeedEvent {
  id: string
  type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
  actor: { login: string; avatar_url: string }
  repo: { full_name: string }
  payload: Record<string, unknown>
  created_at: string
}

interface FeedState {
  events: GitHubFeedEvent[]
  loading: boolean
  error: string | null
}

const POLL_MS = 5 * 60 * 1000

export function useFeed(): FeedState & { refresh: () => void } {
  const { user } = useGitHubAuth()
  const [events, setEvents] = useState<GitHubFeedEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async (login: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.github.getReceivedEvents(login) as GitHubFeedEvent[]
      setEvents(result)
    } catch {
      setError('Couldn\'t load activity')
    } finally {
      setLoading(false)
    }
  }, [])

  const startPolling = useCallback((login: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchEvents(login), POLL_MS)
  }, [fetchEvents])

  const refresh = useCallback(() => {
    if (!user?.login) return
    fetchEvents(user.login)
    startPolling(user.login)
  }, [user?.login, fetchEvents, startPolling])

  useEffect(() => {
    if (!user?.login) return
    fetchEvents(user.login)
    startPolling(user.login)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user?.login, fetchEvents, startPolling])

  return { events, loading, error, refresh }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. The `window.api.github.getReceivedEvents` call typechecks via the `src/env.d.ts` addition in Task 2, Step 4. Complete Task 2 before running this check.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFeed.ts
git commit -m "feat(feed): add useFeed polling hook"
```

---

## Task 4: Build `ActivityEvent` component

**Files:**
- Create: `src/components/ActivityEvent.tsx`
- Create: `src/components/ActivityEvent.css`

- [ ] **Step 1: Create the component**

Create `src/components/ActivityEvent.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { useSavedRepos } from '../contexts/SavedRepos'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityEvent.css'

interface Props {
  event: GitHubFeedEvent
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function buildDescription(event: GitHubFeedEvent): { parts: Array<{ text: string; bold: boolean }> } {
  const actor = event.actor.login
  const repoFull = event.repo.full_name
  const [, repoName] = repoFull.split('/')

  switch (event.type) {
    case 'WatchEvent':
      return { parts: [
        { text: actor, bold: true },
        { text: ' starred ', bold: false },
        { text: repoFull, bold: true },
      ]}
    case 'ForkEvent': {
      const forkee = (event.payload as { forkee: { full_name: string } }).forkee.full_name
      return { parts: [
        { text: actor, bold: true },
        { text: ' forked ', bold: false },
        { text: repoFull, bold: true },
        { text: ' → ', bold: false },
        { text: forkee, bold: true },
      ]}
    }
    case 'ReleaseEvent': {
      const tag = (event.payload as { release: { tag_name: string } }).release.tag_name
      return { parts: [
        { text: actor, bold: true },
        { text: ' released ', bold: false },
        { text: tag, bold: true },
        { text: ' on ', bold: false },
        { text: repoFull, bold: true },
      ]}
    }
    case 'PullRequestEvent':
      return { parts: [
        { text: actor, bold: true },
        { text: ' merged a PR into ', bold: false },
        { text: repoFull, bold: true },
      ]}
  }
}

export default function ActivityEvent({ event }: Props) {
  const navigate = useNavigate()
  const { isSaved } = useSavedRepos()

  const [owner, name] = event.repo.full_name.split('/')
  const saved = isSaved(owner, name)

  const { parts } = buildDescription(event)

  const handleRepoClick = () => {
    if (saved) navigate(`/library/repo/${owner}/${name}`)
  }

  return (
    <div className="activity-event">
      <img
        className="activity-event-avatar"
        src={event.actor.avatar_url}
        alt={event.actor.login}
      />
      <p className="activity-event-desc">
        {parts.map((part, i) => {
          const isRepo = part.text === event.repo.full_name
          if (isRepo && saved) {
            return (
              <button key={i} className="activity-event-repo-link" onClick={handleRepoClick}>
                {part.text}
              </button>
            )
          }
          return part.bold
            ? <strong key={i}>{part.text}</strong>
            : <span key={i}>{part.text}</span>
        })}
      </p>
      <span className="activity-event-time">{relativeTime(event.created_at)}</span>
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `src/components/ActivityEvent.css`:

```css
.activity-event {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.activity-event:last-child {
  border-bottom: none;
}

.activity-event-avatar {
  width: 28px;
  height: 28px;
  min-width: 28px;
  border-radius: 50%;
  object-fit: cover;
  margin-top: 1px;
}

.activity-event-desc {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--t2);
  margin: 0;
}

.activity-event-desc strong {
  color: var(--t1);
  font-weight: 600;
}

.activity-event-repo-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--t1);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color 0.1s;
}

.activity-event-repo-link:hover {
  text-decoration-color: var(--t1);
}

.activity-event-time {
  font-size: 11px;
  color: var(--t4);
  white-space: nowrap;
  margin-top: 2px;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ActivityEvent.tsx src/components/ActivityEvent.css
git commit -m "feat(feed): add ActivityEvent card component"
```

---

## Task 5: Build `ActivityFeed` container

**Files:**
- Create: `src/components/ActivityFeed.tsx`
- Create: `src/components/ActivityFeed.css`

- [ ] **Step 1: Create the component**

Create `src/components/ActivityFeed.tsx`:

```tsx
import { RefreshCw } from 'lucide-react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useFeed } from '../hooks/useFeed'
import ActivityEvent from './ActivityEvent'
import './ActivityFeed.css'

export default function ActivityFeed() {
  const { user } = useGitHubAuth()
  const { events, loading, error, refresh } = useFeed()

  if (!user) {
    return (
      <div className="activity-feed activity-feed--empty">
        <p className="activity-feed-msg">Connect your GitHub account to see your activity</p>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <span className="activity-feed-title">Activity</span>
        <button className="activity-feed-refresh" onClick={refresh} title="Refresh" disabled={loading}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="activity-feed-body">
        {loading && events.length === 0 && (
          <div className="activity-feed-skeletons">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="activity-event-skeleton" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="activity-feed-msg activity-feed-msg--error">{error}</p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="activity-feed-msg">Nothing in your network yet</p>
        )}

        {events.map(event => (
          <ActivityEvent key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `src/components/ActivityFeed.css`:

```css
.activity-feed {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.activity-feed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.activity-feed-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--t3);
}

.activity-feed-refresh {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 4px;
  color: var(--t3);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: color 0.1s, background 0.1s;
}

.activity-feed-refresh:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--t2);
}

.activity-feed-refresh:disabled {
  opacity: 0.4;
  cursor: default;
}

.activity-feed-body {
  flex: 1;
  overflow-y: auto;
}

.activity-feed-msg {
  padding: 32px 16px;
  font-size: 13px;
  color: var(--t3);
  text-align: center;
  margin: 0;
}

.activity-feed-msg--error {
  color: rgba(255, 100, 100, 0.8);
}

.activity-feed-skeletons {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.activity-event-skeleton {
  height: 52px;
  border-bottom: 1px solid var(--glass-border);
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.03) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: feed-shimmer 1.4s infinite;
}

@keyframes feed-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ActivityFeed.tsx src/components/ActivityFeed.css
git commit -m "feat(feed): add ActivityFeed container component"
```

---

## Task 6: Wire `ActivityFeed` into Library.tsx

**Files:**
- Modify: `src/views/Library.tsx`

- [ ] **Step 1: Add import**

In `src/views/Library.tsx`, add `ActivityFeed` to the import block near the other component imports (around line 12–16):

```ts
import ActivityFeed from '../components/ActivityFeed'
```

- [ ] **Step 2: Replace the empty-state div**

Find lines 174–188 in `src/views/Library.tsx`:

```tsx
          ) : (
            <div className="library-detail-empty">
              <div className="library-detail-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <h2 className="library-detail-empty-title">Your Library</h2>
              <p className="library-detail-empty-sub">
                {rows.length > 0
                  ? <>{rows.length} skill{rows.length !== 1 ? 's' : ''} installed{starredRows.length > 0 ? ` · ${starredRows.length} starred` : ''}</>
                  : 'No skills installed yet'}
              </p>
              <p className="library-detail-empty-hint">Select a repo or collection from the sidebar to view details.</p>
            </div>
          )}
```

Replace with:

```tsx
          ) : (
            <ActivityFeed />
          )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/Library.tsx
git commit -m "feat(feed): replace Library empty state with ActivityFeed"
```

---

## Task 7: Add "Summary" button to LibrarySidebar

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.css`

- [ ] **Step 1: Add router imports to LibrarySidebar.tsx**

In `src/components/LibrarySidebar.tsx`, update line 2 (the import line) to add `useLocation` and `useNavigate`:

```ts
import { useState, useMemo } from 'react'
```

becomes:

```ts
import { useState, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
```

- [ ] **Step 2: Call the hooks inside the component**

In `LibrarySidebar`'s function body (after line 95, where the `menu` state is declared), add:

```ts
  const location = useLocation()
  const navigate = useNavigate()
  const isSummaryActive = location.pathname === '/library'
```

- [ ] **Step 3: Add the Summary button to the JSX**

In the `return` block, the current JSX is (around line 128–141):

```tsx
    <aside className="library-sidebar">
      <div className="library-sidebar-header">REPOSITORIES</div>
      <div className="library-sidebar-filter">
```

Add a Summary button between the header and the filter row:

```tsx
    <aside className="library-sidebar">
      <div className="library-sidebar-header">REPOSITORIES</div>
      <button
        className={`library-summary-btn${isSummaryActive ? ' active' : ''}`}
        onClick={() => navigate('/library')}
      >
        Summary
      </button>
      <div className="library-sidebar-filter">
```

- [ ] **Step 4: Add Summary button styles to LibrarySidebar.css**

Add at the end of `src/components/LibrarySidebar.css`:

```css
/* ── Summary button ──────────────────────────────────── */

.library-summary-btn {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 7px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--glass-border);
  font-size: 12px;
  font-weight: 500;
  color: var(--t3);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.library-summary-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--t2);
}

.library-summary-btn.active {
  color: var(--t1);
  background: rgba(255, 255, 255, 0.06);
}

.library-panel.mini .library-summary-btn {
  display: none;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.css
git commit -m "feat(feed): add Summary button to LibrarySidebar"
```

---

## Task 8: End-to-end smoke check

- [ ] **Step 1: Run the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify feed loads**

Open the Library view (no repo selected). Confirm:
- The `ActivityFeed` renders (header "Activity" + refresh button visible)
- If logged in: events appear or "Nothing in your network yet" shows
- If not logged in: "Connect your GitHub account to see your activity" shows

- [ ] **Step 3: Verify repo navigation**

Click a repo in the sidebar. Confirm:
- `RepoDetail` replaces the feed
- "Summary" button in sidebar appears unselected/not highlighted

- [ ] **Step 4: Verify Summary navigation**

While viewing a repo, click the "Summary" button. Confirm:
- Feed re-appears in main area
- "Summary" button shows active/highlighted state

- [ ] **Step 5: Verify mini mode**

Navigate to a repo's Files tab (triggers mini mode). Confirm:
- "Summary" button is hidden
- Segment filter pills are also hidden (existing behavior unchanged)

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix(feed): smoke-check fixes"
```
