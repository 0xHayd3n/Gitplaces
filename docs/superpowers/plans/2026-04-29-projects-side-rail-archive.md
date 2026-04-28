# Projects Side Rail & Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent side rail to the Projects page with Recent and Archive panels, an Archive action button in RepoDetail, and update default grid column count.

**Architecture:** A new `projects-shell` flex-row wrapper in `TemplateGallery` holds a 48px `ProjectsSideRail`, a 240px panel area (showing `RecentPanel` or `ArchivePanel`), and the existing gallery as `flex:1`. Archive state lives in Electron settings via `useArchivedRepos`; recent visits are plain localStorage writes via `recordRecentVisit`.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react, localStorage, `window.api.settings` (Electron IPC)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/hooks/useArchivedRepos.ts` | Settings-backed archive Set + toggle |
| Create | `src/hooks/useArchivedRepos.test.ts` | Tests for the hook |
| Create | `src/lib/recentVisits.ts` | `recordRecentVisit` + `getRecentVisits` pure functions |
| Create | `src/lib/recentVisits.test.ts` | Tests for recent visit logic |
| Create | `src/components/create/ProjectsSideRail.tsx` | Icon tab rail (Recent / Archive) |
| Create | `src/components/create/ProjectsSideRail.css` | All new layout styles (shell, rail, panel, items) |
| Create | `src/components/create/RecentPanel.tsx` | Recent repos list component |
| Create | `src/components/create/ArchivePanel.tsx` | Archived repos list component |
| Modify | `src/components/create/TemplateGallery.tsx` | Shell layout, integration, column defaults |
| Modify | `src/views/RepoDetail.tsx` | Archive button in action row |

---

## Task 1: `useArchivedRepos` hook

**Files:**
- Create: `src/hooks/useArchivedRepos.ts`
- Create: `src/hooks/useArchivedRepos.test.ts`

- [ ] **Step 1.1 — Write the failing tests**

Create `src/hooks/useArchivedRepos.test.ts`:

```typescript
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useArchivedRepos } from './useArchivedRepos'

function makeSettingsApi(stored: string | null = null) {
  return {
    settings: {
      get: vi.fn().mockResolvedValue(stored),
      set: vi.fn().mockResolvedValue(undefined),
    },
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: makeSettingsApi(),
    writable: true,
    configurable: true,
  })
})

describe('useArchivedRepos', () => {
  it('starts with loading=true and empty set', () => {
    window.api.settings.get = vi.fn().mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useArchivedRepos())
    expect(result.current.loading).toBe(true)
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('loading becomes false after settings resolve', async () => {
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('loads stored archive keys from settings', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(JSON.stringify(['alice/repo1', 'bob/repo2']))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.has('alice/repo1')).toBe(true)
    expect(result.current.archivedSet.has('bob/repo2')).toBe(true)
  })

  it('treats null settings value as empty archive', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(null)
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('treats settings read error as empty archive', async () => {
    window.api.settings.get = vi.fn().mockRejectedValue(new Error('IPC error'))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.archivedSet.size).toBe(0)
  })

  it('toggle adds a new key and writes to settings', async () => {
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggle('alice', 'myrepo'))
    expect(result.current.archivedSet.has('alice/myrepo')).toBe(true)
    expect(window.api.settings.set).toHaveBeenCalledWith(
      'archived_repos',
      JSON.stringify(['alice/myrepo'])
    )
  })

  it('toggle removes an existing key', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(JSON.stringify(['alice/myrepo']))
    const { result } = renderHook(() => useArchivedRepos())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.toggle('alice', 'myrepo'))
    expect(result.current.archivedSet.has('alice/myrepo')).toBe(false)
    expect(window.api.settings.set).toHaveBeenCalledWith('archived_repos', JSON.stringify([]))
  })
})
```

- [ ] **Step 1.2 — Run tests to confirm they fail**

```bash
npx vitest run src/hooks/useArchivedRepos.test.ts
```

Expected: `FAIL` — `useArchivedRepos` not found.

- [ ] **Step 1.3 — Implement the hook**

Create `src/hooks/useArchivedRepos.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'

const SETTINGS_KEY = 'archived_repos'

export function useArchivedRepos() {
  const [archivedSet, setArchivedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.settings.get(SETTINGS_KEY)
      .then(raw => {
        try {
          const parsed = raw ? (JSON.parse(raw) as unknown) : []
          setArchivedSet(new Set(Array.isArray(parsed) ? (parsed as string[]) : []))
        } catch {
          setArchivedSet(new Set())
        }
      })
      .catch(() => setArchivedSet(new Set()))
      .finally(() => setLoading(false))
  }, [])

  const toggle = useCallback((owner: string, name: string) => {
    const key = `${owner}/${name}`
    setArchivedSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
      return next
    })
  }, [])

  return { archivedSet, loading, toggle }
}
```

- [ ] **Step 1.4 — Run tests to confirm they pass**

```bash
npx vitest run src/hooks/useArchivedRepos.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 1.5 — Commit**

```bash
git add src/hooks/useArchivedRepos.ts src/hooks/useArchivedRepos.test.ts
git commit -m "feat(projects): add useArchivedRepos hook"
```

---

## Task 2: `recordRecentVisit` utility

**Files:**
- Create: `src/lib/recentVisits.ts`
- Create: `src/lib/recentVisits.test.ts`

- [ ] **Step 2.1 — Write the failing tests**

Create `src/lib/recentVisits.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { recordRecentVisit, getRecentVisits } from './recentVisits'

const STORAGE_KEY = 'projects-recent-repos'

const entry = (name: string, owner = 'alice') => ({
  owner,
  name,
  avatar_url: null,
  navigatePath: `/repo/${owner}/${name}`,
})

beforeEach(() => localStorage.clear())

describe('getRecentVisits', () => {
  it('returns empty array when nothing stored', () => {
    expect(getRecentVisits()).toEqual([])
  })

  it('returns stored entries', () => {
    const stored = [{ owner: 'a', name: 'b', avatar_url: null, navigatePath: '/repo/a/b', visitedAt: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    expect(getRecentVisits()).toEqual(stored)
  })

  it('returns empty array on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(getRecentVisits()).toEqual([])
  })
})

describe('recordRecentVisit', () => {
  it('adds a new entry with visitedAt timestamp', () => {
    recordRecentVisit(entry('repo1'))
    const visits = getRecentVisits()
    expect(visits).toHaveLength(1)
    expect(visits[0].owner).toBe('alice')
    expect(visits[0].name).toBe('repo1')
    expect(typeof visits[0].visitedAt).toBe('number')
  })

  it('prepends new entries (newest first)', () => {
    recordRecentVisit(entry('repo1'))
    recordRecentVisit(entry('repo2'))
    const visits = getRecentVisits()
    expect(visits[0].name).toBe('repo2')
    expect(visits[1].name).toBe('repo1')
  })

  it('deduplicates — revisiting moves entry to front', () => {
    recordRecentVisit(entry('repo1'))
    recordRecentVisit(entry('repo2'))
    recordRecentVisit(entry('repo1'))
    const visits = getRecentVisits()
    expect(visits).toHaveLength(2)
    expect(visits[0].name).toBe('repo1')
    expect(visits[1].name).toBe('repo2')
  })

  it('caps at 30 entries, dropping oldest', () => {
    for (let i = 0; i < 35; i++) {
      recordRecentVisit(entry(`repo${i}`))
    }
    expect(getRecentVisits()).toHaveLength(30)
    expect(getRecentVisits()[0].name).toBe('repo34')
  })

  it('stores the provided navigatePath unchanged', () => {
    recordRecentVisit({ ...entry('repo1'), navigatePath: '/local-project?path=%2Ffoo&name=repo1&git=1' })
    expect(getRecentVisits()[0].navigatePath).toBe('/local-project?path=%2Ffoo&name=repo1&git=1')
  })
})
```

- [ ] **Step 2.2 — Run tests to confirm they fail**

```bash
npx vitest run src/lib/recentVisits.test.ts
```

Expected: `FAIL` — module not found.

- [ ] **Step 2.3 — Implement the utility**

Create `src/lib/recentVisits.ts`:

```typescript
const STORAGE_KEY = 'projects-recent-repos'
const MAX_ENTRIES = 30

export interface RecentEntry {
  owner: string
  name: string
  avatar_url: string | null
  navigatePath: string
  visitedAt: number
}

export function getRecentVisits(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RecentEntry[]) : []
  } catch {
    return []
  }
}

export function recordRecentVisit(entry: Omit<RecentEntry, 'visitedAt'>): void {
  try {
    const key = `${entry.owner}/${entry.name}`
    const existing = getRecentVisits()
    const without = existing.filter(e => `${e.owner}/${e.name}` !== key)
    const next = [{ ...entry, visitedAt: Date.now() }, ...without].slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore write errors
  }
}
```

- [ ] **Step 2.4 — Run tests to confirm they pass**

```bash
npx vitest run src/lib/recentVisits.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 2.5 — Commit**

```bash
git add src/lib/recentVisits.ts src/lib/recentVisits.test.ts
git commit -m "feat(projects): add recordRecentVisit utility"
```

---

## Task 3: `ProjectsSideRail` component + CSS

**Files:**
- Create: `src/components/create/ProjectsSideRail.tsx`
- Create: `src/components/create/ProjectsSideRail.css`

- [ ] **Step 3.1 — Create the CSS file**

Create `src/components/create/ProjectsSideRail.css`:

```css
/* ── Shell layout ───────────────────────────────────────────────── */
.projects-shell {
  display: flex;
  flex-direction: row;
  height: 100%;
}

.projects-shell > .projects-gallery {
  flex: 1;
  min-width: 0;
}

/* ── Side rail ──────────────────────────────────────────────────── */
.projects-side-rail {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 44px;
  gap: 4px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--bg2);
}

.projects-side-rail-btn-wrap {
  position: relative;
  width: 36px;
}

.projects-side-rail-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  cursor: pointer;
  transition: background 150ms, color 150ms, opacity 150ms;
  opacity: 0.45;
}

.projects-side-rail-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  opacity: 0.8;
}

.projects-side-rail-btn.active {
  opacity: 1;
  color: var(--t1);
  background: rgba(255, 255, 255, 0.1);
}

.projects-side-rail-indicator {
  position: absolute;
  right: -7px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--t1);
}

/* ── Panel wrapper ──────────────────────────────────────────────── */
.projects-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--bg2);
}

.projects-panel-header {
  padding: 14px 14px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--t4);
  text-transform: uppercase;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.projects-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.projects-panel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  color: var(--t2);
  transition: background 100ms;
}

.projects-panel-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--t1);
}

.projects-panel-item:disabled {
  opacity: 0.35;
  cursor: default;
}

.projects-panel-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.projects-panel-avatar-fallback {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--bg3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--t3);
  text-transform: uppercase;
}

.projects-panel-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.projects-panel-empty {
  padding: 24px 14px;
  font-size: 12px;
  color: var(--t4);
  text-align: center;
}
```

- [ ] **Step 3.2 — Create the component**

Create `src/components/create/ProjectsSideRail.tsx`:

```typescript
import './ProjectsSideRail.css'

export type SideRailTab = 'recent' | 'archive'

interface Props {
  activeTab: SideRailTab
  onTabChange: (tab: SideRailTab) => void
}

function RecentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z" />
    </svg>
  )
}

const TABS: { id: SideRailTab; icon: React.ReactNode; label: string }[] = [
  { id: 'recent',  icon: <RecentIcon />,  label: 'Recent' },
  { id: 'archive', icon: <ArchiveIcon />, label: 'Archive' },
]

export default function ProjectsSideRail({ activeTab, onTabChange }: Props) {
  return (
    <div className="projects-side-rail">
      {TABS.map(({ id, icon, label }) => (
        <div key={id} className="projects-side-rail-btn-wrap">
          <button
            type="button"
            className={`projects-side-rail-btn${activeTab === id ? ' active' : ''}`}
            onClick={() => { if (activeTab !== id) onTabChange(id) }}
            title={label}
            aria-label={label}
          >
            {icon}
          </button>
          {activeTab === id && <div className="projects-side-rail-indicator" />}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3.3 — Commit**

```bash
git add src/components/create/ProjectsSideRail.tsx src/components/create/ProjectsSideRail.css
git commit -m "feat(projects): add ProjectsSideRail component and panel styles"
```

---

## Task 4: `RecentPanel` and `ArchivePanel` components

**Files:**
- Create: `src/components/create/RecentPanel.tsx`
- Create: `src/components/create/ArchivePanel.tsx`

The panel components render inside the CSS `.projects-panel` wrapper. Both import `ProjectsSideRail.css` for shared panel styles.

- [ ] **Step 4.1 — Create `RecentPanel`**

Create `src/components/create/RecentPanel.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import { getRecentVisits } from '../../lib/recentVisits'

export default function RecentPanel() {
  const navigate = useNavigate()
  const entries = getRecentVisits()

  return (
    <div className="projects-panel">
      <div className="projects-panel-header">Recent</div>
      <div className="projects-panel-list">
        {entries.length === 0 ? (
          <div className="projects-panel-empty">No recent repos</div>
        ) : (
          entries.map(entry => (
            <button
              key={`${entry.owner}/${entry.name}`}
              type="button"
              className="projects-panel-item"
              onClick={() => navigate(entry.navigatePath)}
            >
              {entry.avatar_url ? (
                <img src={entry.avatar_url} alt="" className="projects-panel-avatar" />
              ) : (
                <span className="projects-panel-avatar-fallback">
                  {(entry.name[0] ?? '?').toUpperCase()}
                </span>
              )}
              <span className="projects-panel-name">{entry.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4.2 — Create `ArchivePanel`**

`ArchivePanel` receives `archivedSet` (from the hook in `TemplateGallery`) and `allEntries` (the pre-filter list, also from `TemplateGallery`) to resolve metadata.

First, define a shared `ProjectEntry` type. This will be exported from `TemplateGallery.tsx` in Task 5, but write `ArchivePanel` to import it from there.

Create `src/components/create/ArchivePanel.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import type { ProjectEntry } from './TemplateGallery'

interface Props {
  archivedSet: Set<string>
  allEntries: ProjectEntry[]
}

export default function ArchivePanel({ archivedSet, allEntries }: Props) {
  const navigate = useNavigate()
  const archiveKeys = [...archivedSet]

  return (
    <div className="projects-panel">
      <div className="projects-panel-header">Archive</div>
      <div className="projects-panel-list">
        {archiveKeys.length === 0 ? (
          <div className="projects-panel-empty">No archived repos</div>
        ) : (
          archiveKeys.map(key => {
            const [owner, ...rest] = key.split('/')
            const name = rest.join('/')
            const entry = allEntries.find(e => `${e.row.owner}/${e.row.name}` === key)

            if (!entry) {
              return (
                <button key={key} type="button" className="projects-panel-item" disabled>
                  <span className="projects-panel-avatar-fallback">
                    {(name[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="projects-panel-name">{name}</span>
                </button>
              )
            }

            const { row, hasGithub, localPath, isGitRepo } = entry
            const path = !hasGithub && localPath
              ? `/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`
              : `/repo/${row.owner}/${row.name}`

            return (
              <button
                key={key}
                type="button"
                className="projects-panel-item"
                onClick={() => navigate(path)}
              >
                {row.avatar_url ? (
                  <img src={row.avatar_url} alt="" className="projects-panel-avatar" />
                ) : (
                  <span className="projects-panel-avatar-fallback">
                    {(row.name[0] ?? '?').toUpperCase()}
                  </span>
                )}
                <span className="projects-panel-name">{row.name}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4.3 — Commit**

```bash
git add src/components/create/RecentPanel.tsx src/components/create/ArchivePanel.tsx
git commit -m "feat(projects): add RecentPanel and ArchivePanel components"
```

---

## Task 5: Wire up `TemplateGallery`

**Files:**
- Modify: `src/components/create/TemplateGallery.tsx`

This task restructures the `TemplateGallery` component to add the shell layout, integrate the new components, record recent visits, filter archived entries, and change default column count.

- [ ] **Step 5.1 — Export `ProjectEntry` type and update column defaults**

In `src/components/create/TemplateGallery.tsx`:

**a)** After the `LocalProject` interface (around line 52), add an exported type:

```typescript
export interface ProjectEntry {
  row: RepoRow
  isLocal: boolean
  isGitRepo: boolean
  localPath: string | null
  hasGithub: boolean
}
```

**b)** Change line 134:
```typescript
// Before:
const DEFAULT_COLS = 5
// After:
const DEFAULT_COLS = 6
```

**c)** Change line 256 (the popover options array):
```typescript
// Before:
{[3, 4, 5, 6, 7].map(n => (
// After:
{[4, 5, 6, 7, 8].map(n => (
```

- [ ] **Step 5.2 — Add imports and hook call**

At the top of the file, add these imports after existing imports:

```typescript
import { useState as _useState } from 'react'  // already imported, no change needed
import { useArchivedRepos } from '../../hooks/useArchivedRepos'
import { recordRecentVisit } from '../../lib/recentVisits'
import ProjectsSideRail, { type SideRailTab } from './ProjectsSideRail'
import RecentPanel from './RecentPanel'
import ArchivePanel from './ArchivePanel'
```

Inside `TemplateGallery()`, after the existing state declarations (around line 144), add:

```typescript
const [activeTab, setActiveTab] = useState<SideRailTab>('recent')
const { archivedSet, loading: archiveLoading } = useArchivedRepos()
```

- [ ] **Step 5.3 — Update `allEntries` typing and compute `visibleEntries`**

The existing code builds `allEntries` at line 197. Update the variable to use the exported `ProjectEntry` type (TypeScript will infer it correctly; this is just for documentation):

After line 197 (`const allEntries = [...localEntries, ...githubOnlyEntries]`), add:

```typescript
const visibleEntries = allEntries.filter(
  ({ row }) => !archivedSet.has(`${row.owner}/${row.name}`)
)
```

Then on line 200, change `allEntries.filter` to `visibleEntries.filter`:

```typescript
// Before:
const filtered = allEntries.filter(({ row }) =>
// After:
const filtered = visibleEntries.filter(({ row }) =>
```

- [ ] **Step 5.4 — Update `loading` guard to include `archiveLoading`**

The existing `loading` state (line 141) tracks the GitHub repos fetch. The grid should also wait for `archiveLoading` to resolve. Find the loading skeleton block (around line 268):

```typescript
// Before:
{loading ? (
// After:
{loading || archiveLoading ? (
```

- [ ] **Step 5.5 — Update `onNavigate` to record recent visits**

Find the `onNavigate` callback inside the grid render (around line 292). Replace:

```typescript
// Before:
onNavigate={path => {
  if (!hasGithub && localPath) {
    navigate(`/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`)
  } else {
    navigate(path)
  }
}}

// After:
onNavigate={path => {
  const actualPath = !hasGithub && localPath
    ? `/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`
    : path
  recordRecentVisit({ owner: row.owner, name: row.name, avatar_url: row.avatar_url, navigatePath: actualPath })
  navigate(actualPath)
}}
```

- [ ] **Step 5.6 — Restructure the JSX to add the shell**

Replace the outer `return` of `TemplateGallery`. The existing `<div className="projects-gallery">` becomes the inner main content; a new `<div className="projects-shell">` wraps everything:

```typescript
return (
  <div className="projects-shell">
    <ProjectsSideRail activeTab={activeTab} onTabChange={setActiveTab} />
    {activeTab === 'recent'
      ? <RecentPanel />
      : <ArchivePanel archivedSet={archivedSet} allEntries={allEntries} />
    }
    <div className="projects-gallery">
      <div className="discover-drag-strip" aria-hidden="true" />
      {/* Hero */}
      <div className="projects-hero">
        {/* ...all existing hero JSX unchanged... */}
      </div>

      {/* Unified grid */}
      <div className="projects-repos-section">
        {/* ...all existing repos-section JSX unchanged, but using `filtered` (from visibleEntries)... */}
      </div>
    </div>
  </div>
)
```

The interior JSX (hero, search, type shortcuts, repos header, grid) is **unchanged** — only the outer wrapper changes from `<div className="projects-gallery">` to the three-column shell structure above.

- [ ] **Step 5.7 — Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any type errors before committing.

- [ ] **Step 5.8 — Commit**

```bash
git add src/components/create/TemplateGallery.tsx
git commit -m "feat(projects): wire shell layout, recent tracking, archive filtering, update col defaults"
```

---

## Task 6: Archive button in `RepoDetail`

**Files:**
- Modify: `src/views/RepoDetail.tsx`

`RepoDetail.tsx` is a large file (~1900 lines). The changes are confined to:
1. The `RepoArticleActionRowProps` type (around line 1805)
2. The `RepoArticleActionRow` function (around line 1826)
3. The main `RepoDetail` component body (adds hook call + derived value)
4. The `<RepoArticleActionRow ... />` call site (around line 1760)

- [ ] **Step 6.1 — Import the hook and derive `archived`**

At the top of `RepoDetail.tsx`, add the import (after existing imports):

```typescript
import { useArchivedRepos } from '../hooks/useArchivedRepos'
```

Inside the main `RepoDetail` function body, after the existing `useVerification()` hook call, add:

```typescript
const { archivedSet, loading: archiveLoading, toggle: toggleArchive } = useArchivedRepos()
const archived = !archiveLoading && !!owner && !!name && archivedSet.has(`${owner}/${name}`)
```

Add the handler alongside `handleStar` / `handleFork`:

```typescript
const handleArchive = useCallback(() => {
  if (!owner || !name) return
  toggleArchive(owner, name)
}, [owner, name, toggleArchive])
```

- [ ] **Step 6.2 — Update `RepoArticleActionRowProps` and the component**

Find `RepoArticleActionRowProps` (around line 1805). Add two props:

```typescript
type RepoArticleActionRowProps = {
  // ...existing props...
  archived: boolean
  onArchive: () => void
}
```

Update the function signature to destructure them:

```typescript
function RepoArticleActionRow({
  learnState, starred, starWorking, starCount,
  cloneOpen, onToggleClone,
  onLearn, onUnlearn, onStar, onFork,
  translationStatus,
  archived, onArchive,         // ← add these
}: RepoArticleActionRowProps) {
```

Add the Archive button after the Fork button (around line 1892):

```typescript
      <button
        className={`article-action-btn${archived ? ' article-action-btn--archive-on' : ''}`}
        onClick={onArchive}
        title={archived ? 'Remove from archive' : 'Archive this repo'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z" />
        </svg>
        <span>{archived ? 'Unarchive' : 'Archive'}</span>
      </button>
```

- [ ] **Step 6.3 — Pass props at the call site**

Find the `<RepoArticleActionRow ... />` call site (around line 1760). Add `archived` and `onArchive`:

```typescript
<RepoArticleActionRow
  learnState={learnState}
  starred={starred}
  starWorking={starWorking}
  starCount={repo?.stars ?? 0}
  cloneOpen={cloneOpen}
  onToggleClone={() => setCloneOpen(v => !v)}
  onLearn={handleLearn}
  onUnlearn={handleUnlearn}
  onStar={handleStar}
  onFork={handleFork}
  archived={archived}
  onArchive={handleArchive}
  translationStatus={activeTab === 'readme' ? { ... } : null}
/>
```

- [ ] **Step 6.4 — Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.5 — Run full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass plus the new hook/utility tests.

- [ ] **Step 6.6 — Commit**

```bash
git add src/views/RepoDetail.tsx
git commit -m "feat(projects): add Archive button to RepoDetail action bar"
```
