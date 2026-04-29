# Fork Event Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text fork event row in the ActivityFeed with a visual two-card layout showing the original repo (left) and the user's new fork (right), connected by an arrow, with metadata fetched via the existing Electron IPC bridge.

**Architecture:** A new `useForkData` hook fetches both repos via `window.api.github.getRepo` (existing IPC handler), caches results in a module-level Map, and returns `{ original, fork, loading }`. A new `ForkEventCard` component uses this hook to render two `ForkMiniCard` sub-components with skeletons while loading. `ActivityEvent` gets a single early-return guard that renders `ForkEventCard` for fork events, bypassing the existing text-rendering path.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, Electron IPC (`window.api.github.getRepo`)

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/hooks/useForkData.ts` | Create | Fetch + cache both repos via IPC, return `{ original, fork, loading }` |
| `src/hooks/useForkData.test.ts` | Create | Unit tests for hook |
| `src/components/ForkEventCard.tsx` | Create | Fork event UI: header + two mini cards + skeleton |
| `src/components/ForkEventCard.test.tsx` | Create | Component tests |
| `src/components/ForkEventCard.css` | Create | Styles for card, mini card, badge, skeleton |
| `src/components/ActivityEvent.tsx` | Modify | Add early-return guard + import |

---

## Task 1: `useForkData` hook

**Files:**
- Create: `src/hooks/useForkData.ts`
- Create: `src/hooks/useForkData.test.ts`

### Background

`window.api.github.getRepo(owner: string, name: string): Promise<RepoRow | null>` is declared in `electron/preload.ts:33` and handled in `electron/main.ts:622`. It fetches the repo from GitHub, upserts to SQLite, and returns the full `RepoRow`. The `RepoRow` type is at `src/types/repo.ts`. Fields we care about: `owner`, `name`, `description`, `language`, `stars`, `forks` — all present on the type.

`window.api` does not exist in the jsdom test environment, so each test file that uses it must define a mock on `window` before importing the hook.

The module-level cache persists across tests within the same test file unless you use unique `full_name` values per test (recommended) or call `vi.resetModules()`.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useForkData.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest'

const mockGetRepo = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: { github: { getRepo: mockGetRepo } },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// Import after window.api is defined
const { useForkData } = await import('./useForkData')

describe('useForkData', () => {
  it('starts loading and resolves both repos', async () => {
    mockGetRepo.mockImplementation(async (owner: string, name: string) => ({
      owner, name,
      description: `desc for ${name}`,
      language: 'TypeScript',
      stars: 100,
      forks: 10,
    }))

    const { result } = renderHook(() =>
      useForkData('acme/original-a1', 'user/fork-a1')
    )

    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toMatchObject({ owner: 'acme', name: 'original-a1', stars: 100 })
    expect(result.current.fork).toMatchObject({ owner: 'user', name: 'fork-a1', stars: 100 })
    expect(mockGetRepo).toHaveBeenCalledTimes(2)
  })

  it('stores null and does not retry when getRepo returns null', async () => {
    mockGetRepo.mockResolvedValue(null)

    const { result } = renderHook(() =>
      useForkData('acme/original-b2', 'user/fork-b2')
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toBeNull()
    expect(result.current.fork).toBeNull()
  })

  it('stores null and does not retry when getRepo rejects', async () => {
    mockGetRepo.mockRejectedValue(new Error('IPC error'))

    const { result } = renderHook(() =>
      useForkData('acme/original-c3', 'user/fork-c3')
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toBeNull()
    expect(result.current.fork).toBeNull()
  })

  it('skips API call for cached keys and resolves immediately', async () => {
    // First render populates cache for d4 keys
    mockGetRepo.mockResolvedValue({ owner: 'acme', name: 'original-d4', description: null, language: null, stars: 0, forks: 0 })
    const { unmount } = renderHook(() => useForkData('acme/original-d4', 'user/fork-d4'))
    await waitFor(() => expect(mockGetRepo).toHaveBeenCalledTimes(2))
    unmount()
    mockGetRepo.mockClear()

    // Second render — same keys, should hit cache
    const { result } = renderHook(() => useForkData('acme/original-d4', 'user/fork-d4'))
    expect(result.current.loading).toBe(false)
    expect(mockGetRepo).not.toHaveBeenCalled()
  })

  it('fetches only the uncached key on a partial cache hit', async () => {
    // Pre-populate cache for original-e5 from a prior render
    mockGetRepo.mockResolvedValueOnce({ owner: 'acme', name: 'original-e5', description: null, language: null, stars: 5, forks: 0 })
    mockGetRepo.mockResolvedValueOnce(null) // fork-e5 → null
    const { unmount } = renderHook(() => useForkData('acme/original-e5', 'user/fork-e5'))
    await waitFor(() => expect(mockGetRepo).toHaveBeenCalledTimes(2))
    unmount()
    mockGetRepo.mockClear()

    // New fork key fork-f6, same original — only fork should be fetched
    mockGetRepo.mockResolvedValueOnce({ owner: 'user', name: 'fork-f6', description: null, language: null, stars: 0, forks: 0 })
    const { result } = renderHook(() => useForkData('acme/original-e5', 'user/fork-f6'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockGetRepo).toHaveBeenCalledTimes(1)
    expect(mockGetRepo).toHaveBeenCalledWith('user', 'fork-f6')
    expect(result.current.original).toMatchObject({ stars: 5 })
    expect(result.current.fork).toMatchObject({ name: 'fork-f6' })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/hooks/useForkData.test.ts
```

Expected: All 5 tests fail with "Cannot find module './useForkData'" or similar.

- [ ] **Step 3: Implement `useForkData`**

Create `src/hooks/useForkData.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { RepoRow } from '../types/repo'

export interface ForkRepoData {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
}

const cache = new Map<string, ForkRepoData | null>()

function rowToForkData(row: RepoRow): ForkRepoData {
  return {
    owner: row.owner,
    name: row.name,
    description: row.description,
    language: row.language,
    stars: row.stars,
    forks: row.forks,
  }
}

export function useForkData(
  originalFullName: string,
  forkFullName: string
): { original: ForkRepoData | null; fork: ForkRepoData | null; loading: boolean } {
  const bothCached = cache.has(originalFullName) && cache.has(forkFullName)

  const [original, setOriginal] = useState<ForkRepoData | null>(
    cache.get(originalFullName) ?? null
  )
  const [fork, setFork] = useState<ForkRepoData | null>(
    cache.get(forkFullName) ?? null
  )
  const [loading, setLoading] = useState(!bothCached)

  useEffect(() => {
    const fetches: Promise<void>[] = []

    if (!cache.has(originalFullName)) {
      const [owner, name] = originalFullName.split('/')
      fetches.push(
        window.api.github.getRepo(owner, name)
          .then(row => {
            const data = row ? rowToForkData(row) : null
            cache.set(originalFullName, data)
            setOriginal(data)
          })
          .catch(() => {
            cache.set(originalFullName, null)
          })
      )
    }

    if (!cache.has(forkFullName)) {
      const [owner, name] = forkFullName.split('/')
      fetches.push(
        window.api.github.getRepo(owner, name)
          .then(row => {
            const data = row ? rowToForkData(row) : null
            cache.set(forkFullName, data)
            setFork(data)
          })
          .catch(() => {
            cache.set(forkFullName, null)
          })
      )
    }

    if (fetches.length > 0) {
      Promise.allSettled(fetches).then(() => setLoading(false))
    }
  }, [originalFullName, forkFullName])

  return { original, fork, loading }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/hooks/useForkData.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useForkData.ts src/hooks/useForkData.test.ts
git commit -m "feat(feed): add useForkData hook with IPC fetch and session cache"
```

---

## Task 2: `ForkEventCard` component and CSS

**Files:**
- Create: `src/components/ForkEventCard.tsx`
- Create: `src/components/ForkEventCard.css`
- Create: `src/components/ForkEventCard.test.tsx`

### Background

`relativeTime` is a **private function defined locally inside `ActivityEvent.tsx`** (lines 10–19) — it is not exported from any shared utility. Copy it verbatim into `ForkEventCard.tsx` as a local private function rather than extracting it to a shared module (YAGNI — no other callers need it yet).

`GitHubFeedEvent` is exported from `src/hooks/useFeed.ts`.

The skeleton shimmer animation is defined as `@keyframes feed-shimmer` in `src/components/ActivityFeed.css` — do not re-declare it; define it locally in `ForkEventCard.css` using a distinct name (`fork-shimmer`) since CSS keyframe names from other stylesheets are not guaranteed to be available.

- [ ] **Step 6: Write the failing component tests**

Create `src/components/ForkEventCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ForkEventCard } from './ForkEventCard'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import type { ForkRepoData } from '../hooks/useForkData'

vi.mock('../hooks/useForkData')

const mockUseForkData = vi.mocked(
  (await import('../hooks/useForkData')).useForkData
)

const forkEvent: GitHubFeedEvent = {
  id: '1',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
}

const originalData: ForkRepoData = {
  owner: 'anthropics',
  name: 'Databuddy',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 4200,
  forks: 312,
}

const forkData: ForkRepoData = {
  owner: 'zzzzshawn',
  name: 'Databuddy',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 0,
  forks: 0,
}

describe('ForkEventCard', () => {
  it('renders skeleton cards while loading', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: true })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByRole('generic', { hidden: true })
      .some(el => el.classList.contains('fork-mini-card--skeleton'))
    ).toBe(true)
    expect(screen.queryByText('Databuddy')).toBeNull()
  })

  it('renders actor header with login and timestamp', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText('zzzzshawn')).toBeInTheDocument()
    expect(screen.getByText(/forked a repository/)).toBeInTheDocument()
  })

  it('renders both repo names when loaded', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getAllByText('Databuddy')).toHaveLength(2)
  })

  it('renders fork badge only on the fork card', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText('fork')).toBeInTheDocument()
  })

  it('shows stars and forks on original card', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    expect(screen.getByText(/4,200/)).toBeInTheDocument()
    expect(screen.getByText(/312/)).toBeInTheDocument()
  })

  it('links original card to github.com/anthropics/Databuddy', () => {
    mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    const links = screen.getAllByRole('link')
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/anthropics/Databuddy')).toBe(true)
    expect(links.some(l => l.getAttribute('href') === 'https://github.com/zzzzshawn/Databuddy')).toBe(true)
  })

  it('falls back to repo name from event when API returns null', () => {
    mockUseForkData.mockReturnValue({ original: null, fork: null, loading: false })

    render(<ForkEventCard event={forkEvent} />)

    // Should still render repo names parsed from full_name
    expect(screen.getAllByText('Databuddy')).toHaveLength(2)
    expect(screen.getByText('anthropics')).toBeInTheDocument()
    expect(screen.getByText('zzzzshawn')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run tests to confirm they fail**

```bash
npx vitest run src/components/ForkEventCard.test.tsx
```

Expected: All tests fail with "Cannot find module './ForkEventCard'".

- [ ] **Step 8: Create `ForkEventCard.css`**

Create `src/components/ForkEventCard.css`:

```css
.fork-event {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 14px;
  border-bottom: 1px solid #21262d;
}

.fork-event__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8b949e;
}

.fork-event__avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
}

.fork-event__time {
  margin-left: auto;
  font-size: 11px;
  color: #484f58;
}

.fork-event__body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fork-event__arrow {
  color: #484f58;
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1;
}

/* Mini card */

.fork-mini-card {
  flex: 1;
  min-width: 0;
  display: block;
  padding: 10px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.15s;
}

.fork-mini-card:hover {
  border-color: #58a6ff;
}

.fork-mini-card--fork {
  border-color: #1f6feb;
  background: #0a1628;
}

.fork-mini-card--fork:hover {
  border-color: #58a6ff;
}

.fork-mini-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.fork-mini-card__owner {
  font-size: 10px;
  color: #8b949e;
  font-family: monospace;
}

.fork-mini-card__badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #58a6ff;
  background: #0d2044;
  border: 1px solid #1f6feb;
  padding: 1px 5px;
  border-radius: 3px;
}

.fork-mini-card__name {
  font-size: 13px;
  font-weight: 600;
  color: #58a6ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fork-mini-card__desc {
  font-size: 11px;
  color: #8b949e;
  margin-top: 4px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fork-mini-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 7px;
  font-size: 10px;
  color: #8b949e;
}

.fork-mini-card__lang {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fork-mini-card__lang-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3fb950;
  flex-shrink: 0;
}

/* Skeleton */

.fork-mini-card--skeleton {
  pointer-events: none;
}

.fork-skeleton {
  background: linear-gradient(90deg, #21262d 25%, #2d333b 50%, #21262d 75%);
  background-size: 400% 100%;
  border-radius: 4px;
  animation: fork-shimmer 1.5s infinite;
  height: 10px;
  margin-bottom: 6px;
}

.fork-skeleton:last-child {
  margin-bottom: 0;
}

.fork-skeleton--owner {
  width: 55px;
}

.fork-skeleton--name {
  height: 14px;
  width: 70%;
  margin-bottom: 8px;
}

.fork-skeleton--desc-full {
  width: 100%;
}

.fork-skeleton--desc-short {
  width: 65%;
}

.fork-skeleton--meta {
  width: 80px;
  margin-top: 4px;
}

@keyframes fork-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 9: Create `ForkEventCard.tsx`**

Create `src/components/ForkEventCard.tsx`:

```tsx
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useForkData } from '../hooks/useForkData'
import type { ForkRepoData } from '../hooks/useForkData'
import './ForkEventCard.css'

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

interface ForkMiniCardProps {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  isFork: boolean
}

function ForkMiniCard({ owner, name, description, language, stars, forks, isFork }: ForkMiniCardProps) {
  return (
    <a
      className={`fork-mini-card${isFork ? ' fork-mini-card--fork' : ''}`}
      href={`https://github.com/${owner}/${name}`}
      target="_blank"
      rel="noreferrer"
    >
      <div className="fork-mini-card__top">
        <span className="fork-mini-card__owner">{owner}</span>
        {isFork && <span className="fork-mini-card__badge">fork</span>}
      </div>
      <div className="fork-mini-card__name">{name}</div>
      {description && <div className="fork-mini-card__desc">{description}</div>}
      {(language || (!isFork && stars !== null)) && (
        <div className="fork-mini-card__meta">
          {language && (
            <span className="fork-mini-card__lang">
              <span className="fork-mini-card__lang-dot" />
              {language}
            </span>
          )}
          {!isFork && stars !== null && (
            <span>★ {stars.toLocaleString()}</span>
          )}
          {!isFork && forks !== null && (
            <span>⑂ {forks.toLocaleString()}</span>
          )}
        </div>
      )}
    </a>
  )
}

function ForkMiniCardSkeleton() {
  return (
    <div className="fork-mini-card fork-mini-card--skeleton">
      <div className="fork-skeleton fork-skeleton--owner" />
      <div className="fork-skeleton fork-skeleton--name" />
      <div className="fork-skeleton fork-skeleton--desc-full" />
      <div className="fork-skeleton fork-skeleton--desc-short" />
      <div className="fork-skeleton fork-skeleton--meta" />
    </div>
  )
}

interface Props {
  event: GitHubFeedEvent
}

export function ForkEventCard({ event }: Props) {
  const originalFullName = event.repo.full_name
  const forkFullName = (event.payload as { forkee: { full_name: string } }).forkee.full_name

  const { original, fork, loading } = useForkData(originalFullName, forkFullName)

  const [originalOwner, originalName] = originalFullName.split('/')
  const [forkOwner, forkName] = forkFullName.split('/')

  return (
    <div className="fork-event">
      <div className="fork-event__header">
        <img
          className="fork-event__avatar"
          src={event.actor.avatar_url}
          alt={event.actor.login}
        />
        <span>
          <strong>{event.actor.login}</strong> forked a repository
        </span>
        <span className="fork-event__time">{relativeTime(event.created_at)}</span>
      </div>
      <div className="fork-event__body">
        {loading ? (
          <>
            <ForkMiniCardSkeleton />
            <span className="fork-event__arrow">→</span>
            <ForkMiniCardSkeleton />
          </>
        ) : (
          <>
            <ForkMiniCard
              owner={original?.owner ?? originalOwner}
              name={original?.name ?? originalName}
              description={original?.description ?? null}
              language={original?.language ?? null}
              stars={original?.stars ?? null}
              forks={original?.forks ?? null}
              isFork={false}
            />
            <span className="fork-event__arrow">→</span>
            <ForkMiniCard
              owner={fork?.owner ?? forkOwner}
              name={fork?.name ?? forkName}
              description={fork?.description ?? null}
              language={fork?.language ?? null}
              stars={fork?.stars ?? null}
              forks={fork?.forks ?? null}
              isFork={true}
            />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Run tests to confirm they pass**

```bash
npx vitest run src/components/ForkEventCard.test.tsx
```

Expected: All 7 tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/components/ForkEventCard.tsx src/components/ForkEventCard.css src/components/ForkEventCard.test.tsx
git commit -m "feat(feed): add ForkEventCard component with mini cards and skeleton"
```

---

## Task 3: Wire into `ActivityEvent`

**Files:**
- Modify: `src/components/ActivityEvent.tsx` (lines 1–4 for imports, after line 63 for guard)

### Background

`ActivityEvent.tsx` structure (confirmed):
- Lines 1–4: imports (`useNavigate`, `useSavedRepos`, `GitHubFeedEvent`, CSS)
- Line 61: `export default function ActivityEvent({ event }: Props) {` — **default export, not named**
- Line 62: `const navigate = useNavigate()` — **hook, must not be skipped**
- Line 63: `const { isSaved } = useSavedRepos()` — **hook, must not be skipped**
- Line 65 onward: `const [owner, name] = event.repo.full_name.split('/')` and derived values

The early-return guard goes **after line 63** (both hooks called) and **before line 65** (derived values). This respects the Rules of Hooks — hooks are always called, we just exit before using their values for fork events.

- [ ] **Step 12: Write the integration test**

Check if `src/components/ActivityEvent.test.tsx` exists:

```bash
ls src/components/ActivityEvent.test.tsx 2>/dev/null && echo "exists" || echo "not found"
```

If it exists, add the following test cases to the existing describe block. If not, create the file with this content:

```tsx
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ActivityEvent from './ActivityEvent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./ForkEventCard', () => ({
  ForkEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="fork-event-card">{event.repo.full_name}</div>
  ),
}))

// useSavedRepos returns { isSaved, saveRepo, loading } — mock accordingly
vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: () => false, saveRepo: vi.fn(), loading: false }),
}))

const makeForkEvent = (): GitHubFeedEvent => ({
  id: '99',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date().toISOString(),
})

const makeWatchEvent = (): GitHubFeedEvent => ({
  id: '100',
  type: 'WatchEvent',
  actor: { login: 'alice', avatar_url: 'https://example.com/a.png' },
  repo: { full_name: 'some/repo' },
  payload: {},
  created_at: new Date().toISOString(),
})

describe('ActivityEvent ForkEvent integration', () => {
  it('renders ForkEventCard for ForkEvent', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeForkEvent()} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('fork-event-card')).toBeInTheDocument()
    expect(screen.getByText('anthropics/Databuddy')).toBeInTheDocument()
  })

  it('does not render ForkEventCard for non-fork events', () => {
    render(
      <MemoryRouter>
        <ActivityEvent event={makeWatchEvent()} />
      </MemoryRouter>
    )
    expect(screen.queryByTestId('fork-event-card')).toBeNull()
  })
})
```

- [ ] **Step 13: Run the integration test to confirm it fails**

```bash
npx vitest run src/components/ActivityEvent.test.tsx
```

Expected: The ForkEvent test fails because `ForkEventCard` isn't rendered yet.

- [ ] **Step 14: Add import and early-return guard to `ActivityEvent.tsx`**

Add to the import section at the top of `src/components/ActivityEvent.tsx` (after the existing imports):

```tsx
import { ForkEventCard } from './ForkEventCard'
```

Then add the early-return guard immediately after `const { isSaved } = useSavedRepos()` (line 63) and before the next line:

```tsx
  if (event.type === 'ForkEvent') {
    return <ForkEventCard event={event} />
  }
```

The result should look like:

```tsx
export default function ActivityEvent({ event }: Props) {
  const navigate = useNavigate()
  const { isSaved } = useSavedRepos()

  if (event.type === 'ForkEvent') {
    return <ForkEventCard event={event} />
  }

  const [owner, name] = event.repo.full_name.split('/')
  // ... rest unchanged
```

- [ ] **Step 15: Run all tests to confirm everything passes**

```bash
npx vitest run src/components/ActivityEvent.test.tsx src/components/ForkEventCard.test.tsx src/hooks/useForkData.test.ts
```

Expected: All tests pass. If any fail due to missing context providers or import issues, fix those now before committing.

- [ ] **Step 16: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: All existing tests continue to pass.

- [ ] **Step 17: Commit**

```bash
git add src/components/ActivityEvent.tsx src/components/ActivityEvent.test.tsx
git commit -m "feat(feed): render ForkEventCard for fork events in ActivityFeed"
```
