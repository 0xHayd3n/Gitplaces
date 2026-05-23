# Library Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Library's left NavRail + six-mode filter chips with a simplified two-row top bar (home icon + Repos/Collections icon toggle + search) and collapsible Archived/Recently-unstarred sections pinned at the bottom of the list.

**Architecture:** Rewrite `LibrarySidebar` to own the top bar, mode state, and search state. When `mode === 'collections'`, it renders `<CollectionsSidebar>` as a sub-component (which gains an optional `searchTerm` prop). `Library.tsx` collapses from three columns (NavRail + Library panel + Collections panel) to two (single sidebar + main).

**Tech Stack:** React 18, react-router-dom v6, Vitest, @testing-library/react, plain CSS modules.

**Spec:** [docs/superpowers/specs/2026-05-23-library-sidebar-redesign-design.md](../specs/2026-05-23-library-sidebar-redesign-design.md)

---

## File map

**Modify:**
- `src/components/LibrarySidebar.tsx` — rewrite (new top bar, mode state, search state, collapsible sections)
- `src/components/LibrarySidebar.css` — rewrite (new top bar styles, mini-mode vertical reflow, remove old segment/header styles)
- `src/components/CollectionsSidebar.tsx` — add `searchTerm` prop, filter by name, remove `COLLECTIONS` header
- `src/views/Library.tsx` — drop NavRail render, drop `activePanel` state, drop URL→panel auto-switch effect, drop separate Collections column
- `src/views/Library.test.tsx` — rewrite NavRail-dependent tests
- `src/components/CollectionsSidebar.test.tsx` — add `searchTerm` filter test
- `src/types/library.ts` — remove `ActiveSegment` export

**Create:**
- `src/components/LibrarySidebar.test.tsx` — new test file for the rewritten component

**Delete:**
- `src/components/NavRail.tsx`
- `src/lib/libraryFilter.ts`
- `src/lib/libraryFilter.test.ts`

---

## Pre-flight check

Before Task 1, verify no other consumers depend on what we're deleting:

```bash
grep -rn "filterLibraryEntries\|ActiveSegment\|NavRail" src/
```

Expected matches are confined to: `LibrarySidebar.tsx`, `libraryFilter.ts`, `libraryFilter.test.ts`, `Library.tsx`, `Library.test.tsx`, `types/library.ts`. If anything else shows up, surface it before starting — it may require a follow-up task.

Also verify `<CollectionsSidebar` is only rendered from `Library.tsx`:

```bash
grep -rn "CollectionsSidebar" src/
```

Expected matches: `CollectionsSidebar.tsx`, `CollectionsSidebar.test.tsx`, `Library.tsx`. If rendered elsewhere, the `COLLECTIONS` header removal in Task 8 needs to be gated on a prop instead.

---

## Task 1: Decouple Library.tsx from LibrarySidebar's segment API

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/views/Library.tsx`

Goal: stop passing segment-related props between Library and LibrarySidebar so subsequent tasks can replace the internals without prop-mismatch errors. Sidebar will visually still show the old filter row in this intermediate state — that gets ripped out in Task 2.

- [ ] **Step 1: Remove segment props from LibrarySidebar's Props interface**

In `src/components/LibrarySidebar.tsx`, change the `Props` interface — delete these lines:

```ts
recentVisits: RecentEntry[]
githubUsername: string | null
activeSegment: ActiveSegment
onSegmentChange: (s: ActiveSegment) => void
unstarredRows: StarredRepoRow[]  // KEEP — still used by Task 6's Unstarred section
```

Final `Props`:

```ts
interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  localProjects: LocalProject[]
  archivedSet: Set<string>
  selectedId: string | null
  selectedLocalPath: string | null
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onSelectLocal: (project: LocalProject) => void
}
```

Also remove these imports at the top of the file (they're now unused):

```ts
import type { RecentEntry } from '../lib/recentVisits'
import { filterLibraryEntries } from '../lib/libraryFilter'
```

And remove `ActiveSegment` from the imports — change:

```ts
import type { LibraryEntry, LocalProject, ActiveSegment } from '../types/library'
export type { ActiveSegment }
```

to:

```ts
import type { LibraryEntry, LocalProject } from '../types/library'
```

In the function body, remove the destructured `recentVisits`, `githubUsername`, `activeSegment`, `onSegmentChange` from the props arg. Replace the `visible` `useMemo` (which calls `filterLibraryEntries`) with:

```ts
const visible = useMemo(() => {
  return allEntries.filter(e => {
    const key = e.kind === 'repo'
      ? `${e.row.owner}/${e.row.name}`
      : `${e.project.owner ?? ''}/${e.project.repoName ?? e.project.name}`
    return !archivedSet.has(key)
  })
}, [allEntries, archivedSet])
```

(This keeps archive-hiding behavior; everything else is just "show all".)

Remove the entire `<div className="library-sidebar-filter">...</div>` block from the JSX. Also remove the `EMPTY_STATES` Record and `SEGMENTS` array constants. Replace the empty-state message reference:

```tsx
{visible.length === 0 && (
  <div className="library-sidebar-empty">No repos or projects</div>
)}
```

- [ ] **Step 2: Update Library.tsx callsite**

In `src/views/Library.tsx`, the `<LibrarySidebar ...>` call currently passes 13 props. Remove these four:

```tsx
recentVisits={recentVisits}
githubUsername={user?.login ?? null}
activeSegment={activeSegment}
onSegmentChange={setActiveSegment}
```

Remove the now-unused state and import:

```ts
const [activeSegment, setActiveSegment] = useState<ActiveSegment>('all')
import type { LocalProject, ActiveSegment } from '../types/library'
```

becomes:

```ts
import type { LocalProject } from '../types/library'
```

Also remove the unused `useGitHubAuth` import + `const { user } = useGitHubAuth()` if `user` is no longer referenced elsewhere in the file. (Grep first: `grep -n "user\." src/views/Library.tsx`. If it's still used, leave the import.)

- [ ] **Step 3: Run the build to verify no TS errors**

Run: `npx tsc --noEmit`
Expected: no errors related to LibrarySidebar/Library props. Pre-existing errors elsewhere are OK.

- [ ] **Step 4: Run existing tests**

Run: `npm test -- LibrarySidebar Library libraryFilter`
Expected: `libraryFilter.test.ts` still passes (we haven't deleted it yet). `Library.test.tsx` may fail on the NavRail-dependent tests if `activeSegment` removal cascades — that's fine, they get rewritten in Task 10. If they pass, great.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/views/Library.tsx
git commit -m "refactor(library): drop segment filter props from LibrarySidebar API"
```

---

## Task 2: Replace LibrarySidebar chrome with new top-bar skeleton (home button only)

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Create: `src/components/LibrarySidebar.test.tsx`

Goal: rip out the header strip + activity row, replace with a new top-bar `<div>` containing only a home button. Subsequent tasks add the toggle, search, sections.

- [ ] **Step 1: Write the failing test**

Create `src/components/LibrarySidebar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LibrarySidebar from './LibrarySidebar'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { ToastProvider } from '../contexts/Toast'

function LocationDisplay() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

function wrap(ui: React.ReactElement, initialPath = '/library/repo/foo/bar') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MockLearningProgressProvider>
        <ToastProvider>
          <Routes>
            <Route path="*" element={<>{ui}<LocationDisplay /></>} />
          </Routes>
        </ToastProvider>
      </MockLearningProgressProvider>
    </MemoryRouter>
  )
}

const defaultProps = {
  installedRows: [],
  starredRows: [],
  unstarredRows: [],
  localProjects: [],
  archivedSet: new Set<string>(),
  selectedId: null,
  selectedLocalPath: null,
  onSelect: vi.fn(),
  onSelectLocal: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: { getAll: vi.fn().mockResolvedValue([]) },
  })
})

describe('LibrarySidebar — top bar', () => {
  it('renders a home button that navigates to /library', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    const homeBtn = screen.getByRole('button', { name: /home/i })
    expect(homeBtn).toBeInTheDocument()
    fireEvent.click(homeBtn)
    expect(screen.getByTestId('loc').textContent).toBe('/library')
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: FAIL with "Unable to find role: button, name: /home/i" (the old activity-row button has name "Activity", not "Home").

- [ ] **Step 3: Replace header strip + activity row with new top bar**

In `src/components/LibrarySidebar.tsx`:

Replace the `Activity` import:

```ts
import { Activity } from 'lucide-react'
```

with:

```ts
import { Home } from 'lucide-react'
```

Replace the JSX block at the start of `<aside className="library-sidebar">`:

```tsx
<div className="library-sidebar-header">REPOSITORIES</div>
<div className="library-activity-row">
  <button
    className={`library-activity-btn${isSummaryActive ? ' active' : ''}`}
    onClick={() => navigate('/library')}
  >
    <Activity size={11} />
    Activity
  </button>
</div>
```

with:

```tsx
<div className="library-sidebar-topbar">
  <div className="library-sidebar-topbar-row1">
    <button
      type="button"
      className={`library-sidebar-home${isSummaryActive ? ' active' : ''}`}
      onClick={() => navigate('/library')}
      aria-label="Home"
      title="Home"
    >
      <Home size={14} />
    </button>
  </div>
</div>
```

(CSS for `.library-sidebar-topbar*` classes comes in Task 11 — it'll look unstyled in the app until then, but tests pass.)

- [ ] **Step 4: Run the test — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): replace activity row with home button top bar"
```

---

## Task 3: Add Repos/Collections mode toggle to top bar

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe('LibrarySidebar — top bar', ...)` block in `LibrarySidebar.test.tsx`:

```tsx
it('renders a Repos/Collections toggle with Repos active by default', () => {
  wrap(<LibrarySidebar {...defaultProps} />)
  const reposBtn = screen.getByRole('button', { name: 'Repositories' })
  const collsBtn = screen.getByRole('button', { name: 'Collections' })
  expect(reposBtn).toHaveClass('active')
  expect(collsBtn).not.toHaveClass('active')
})

it('clicking Collections toggle activates it', () => {
  wrap(<LibrarySidebar {...defaultProps} />)
  fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
  expect(screen.getByRole('button', { name: 'Collections' })).toHaveClass('active')
  expect(screen.getByRole('button', { name: 'Repositories' })).not.toHaveClass('active')
})
```

- [ ] **Step 2: Run tests — expect new ones to FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: 2 new tests FAIL with "Unable to find role: button, name: Repositories".

- [ ] **Step 3: Add mode state + toggle JSX**

In `src/components/LibrarySidebar.tsx`, add to imports:

```ts
import { useState } from 'react'  // already imported, just confirm
```

Inside the component, before the existing `useMemo` calls, add:

```ts
type Mode = 'repos' | 'collections'
const [mode, setMode] = useState<Mode>('repos')
```

Add small inline icon components near the top of the file (after the existing `DashedStar`, `GitHubIcon`, etc.):

```tsx
function ReposIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z" />
    </svg>
  )
}

function CollectionsIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    </svg>
  )
}
```

Update the `library-sidebar-topbar-row1` JSX to include the toggle:

```tsx
<div className="library-sidebar-topbar-row1">
  <button
    type="button"
    className={`library-sidebar-home${isSummaryActive ? ' active' : ''}`}
    onClick={() => navigate('/library')}
    aria-label="Home"
    title="Home"
  >
    <Home size={14} />
  </button>
  <div className="library-sidebar-toggle">
    <button
      type="button"
      className={`library-sidebar-toggle-btn${mode === 'repos' ? ' active' : ''}`}
      onClick={() => setMode('repos')}
      aria-label="Repositories"
      title="Repositories"
    >
      <ReposIcon />
    </button>
    <button
      type="button"
      className={`library-sidebar-toggle-btn${mode === 'collections' ? ' active' : ''}`}
      onClick={() => setMode('collections')}
      aria-label="Collections"
      title="Collections"
    >
      <CollectionsIcon />
    </button>
  </div>
</div>
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): add Repos/Collections mode toggle"
```

---

## Task 4: Add search input + name+owner filter

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `LibrarySidebar.test.tsx` inside a new describe block:

```tsx
import type { LibraryRow } from '../types/repo'

function makeRow(owner: string, name: string): LibraryRow {
  return {
    id: `${owner}/${name}`, owner, name, active: 1,
    description: null, language: null, topics: '[]',
    stars: null, forks: null, license: null, homepage: null,
    updated_at: null, pushed_at: null, saved_at: '2026-01-01', type: null,
    banner_svg: null, discovered_at: null, discover_query: null,
    watchers: null, size: null, open_issues: null, starred_at: null,
    default_branch: null, avatar_url: null, og_image_url: null,
    banner_color: null, translated_description: null,
    translated_description_lang: null, translated_readme: null,
    translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null,
    verification_signals: null, verification_checked_at: null,
    type_bucket: null, type_sub: null, version: null,
    generated_at: '2026-01-01T00:00:00.000Z',
    enabled_components: null, enabled_tools: null, tier: 1, installed: 1,
  } as LibraryRow
}

describe('LibrarySidebar — search', () => {
  const rows = [
    makeRow('playcanvas', 'supersplat-viewer'),
    makeRow('mui', 'material-ui'),
    makeRow('vercel', 'react-video-ascii'),
  ]

  it('renders all repos when search is empty', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    expect(screen.getByText('supersplat-viewer')).toBeInTheDocument()
    expect(screen.getByText('material-ui')).toBeInTheDocument()
    expect(screen.getByText('react-video-ascii')).toBeInTheDocument()
  })

  it('filters by repo name substring', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'material' } })
    expect(screen.getByText('material-ui')).toBeInTheDocument()
    expect(screen.queryByText('supersplat-viewer')).not.toBeInTheDocument()
  })

  it('filters by owner substring', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'playc' } })
    expect(screen.getByText('supersplat-viewer')).toBeInTheDocument()
    expect(screen.queryByText('material-ui')).not.toBeInTheDocument()
  })

  it('is case-insensitive', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={rows} />)
    const search = screen.getByPlaceholderText('Search repositories')
    fireEvent.change(search, { target: { value: 'MATERIAL' } })
    expect(screen.getByText('material-ui')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: 4 new tests FAIL with "Unable to find placeholder: Search repositories".

- [ ] **Step 3: Add search state + input + filter**

In `src/components/LibrarySidebar.tsx`, add to imports:

```ts
import { Search } from 'lucide-react'
```

Inside the component, alongside `mode`, add:

```ts
const [searchTerm, setSearchTerm] = useState('')
```

Update the `visible` `useMemo` to also filter by search term:

```ts
const visible = useMemo(() => {
  const q = searchTerm.trim().toLowerCase()
  return allEntries.filter(e => {
    const key = e.kind === 'repo'
      ? `${e.row.owner}/${e.row.name}`
      : `${e.project.owner ?? ''}/${e.project.repoName ?? e.project.name}`
    if (archivedSet.has(key)) return false
    if (!q) return true
    if (e.kind === 'repo') {
      return e.row.name.toLowerCase().includes(q) || e.row.owner.toLowerCase().includes(q)
    }
    return e.project.name.toLowerCase().includes(q)
  })
}, [allEntries, archivedSet, searchTerm])
```

Add a row-2 inside the topbar block, immediately after `library-sidebar-topbar-row1`:

```tsx
<div className="library-sidebar-topbar-row2">
  <div className="library-sidebar-search">
    <Search size={11} className="library-sidebar-search-icon" />
    <input
      type="text"
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder={mode === 'repos' ? 'Search repositories' : 'Search collections'}
      className="library-sidebar-search-input"
    />
  </div>
</div>
```

Also: when the user toggles mode via clicking the buttons, reset search. Replace the two toggle button onClicks:

```tsx
onClick={() => setMode('repos')}
```

with:

```tsx
onClick={() => { setMode('repos'); setSearchTerm('') }}
```

and likewise for collections.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): add search input with name+owner filter"
```

---

## Task 5: Add collapsible Archived section at bottom of list

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append a new describe to `LibrarySidebar.test.tsx`:

```tsx
describe('LibrarySidebar — archived section', () => {
  const liveRow = makeRow('foo', 'live-repo')
  const archivedRow = makeRow('bar', 'archived-repo')
  const archivedSet = new Set(['bar/archived-repo'])

  it('hides archived repos from main list', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    expect(screen.getByText('live-repo')).toBeInTheDocument()
    expect(screen.queryByText('archived-repo')).not.toBeInTheDocument()
  })

  it('shows a collapsed Archived (N) section when there are archived items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    const header = screen.getByRole('button', { name: /archived \(1\)/i })
    expect(header).toBeInTheDocument()
    // Body collapsed: archived-repo not visible
    expect(screen.queryByText('archived-repo')).not.toBeInTheDocument()
  })

  it('expands Archived section on click to reveal items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow, archivedRow]} archivedSet={archivedSet} />)
    fireEvent.click(screen.getByRole('button', { name: /archived \(1\)/i }))
    expect(screen.getByText('archived-repo')).toBeInTheDocument()
  })

  it('hides Archived section entirely when no archived items', () => {
    wrap(<LibrarySidebar {...defaultProps} installedRows={[liveRow]} archivedSet={new Set()} />)
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: new tests FAIL.

- [ ] **Step 3: Implement archived section**

In `src/components/LibrarySidebar.tsx`, alongside other state, add:

```ts
const [archivedOpen, setArchivedOpen] = useState(false)
```

Add a `useMemo` for archived entries, after `visible`:

```ts
const archivedEntries = useMemo(() => {
  const q = searchTerm.trim().toLowerCase()
  return allEntries.filter(e => {
    if (e.kind !== 'repo') return false
    const key = `${e.row.owner}/${e.row.name}`
    if (!archivedSet.has(key)) return false
    if (!q) return true
    return e.row.name.toLowerCase().includes(q) || e.row.owner.toLowerCase().includes(q)
  })
}, [allEntries, archivedSet, searchTerm])
```

After the `visible.map(...)` block inside `library-sidebar-list`, before the menu render, add:

```tsx
{archivedEntries.length > 0 && (
  <div className="library-sidebar-section">
    <button
      type="button"
      className="library-sidebar-section-header"
      onClick={() => setArchivedOpen(o => !o)}
      aria-expanded={archivedOpen}
    >
      <span className="library-sidebar-section-caret">{archivedOpen ? '▾' : '▸'}</span>
      Archived ({archivedEntries.length})
    </button>
    {archivedOpen && archivedEntries.map(entry => {
      if (entry.kind !== 'repo') return null
      const { row } = entry
      return (
        <SidebarRepoRow
          key={`archived-${row.id}`}
          row={row}
          isInstalled={entry.isInstalled}
          selected={selectedId === row.id}
          onSelect={() => onSelect(row, entry.isInstalled)}
          onContextMenu={(e) => handleRepoContextMenu(e, entry)}
        />
      )
    })}
  </div>
)}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): add collapsible Archived section"
```

---

## Task 6: Add collapsible Recently unstarred section

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `LibrarySidebar.test.tsx`:

```tsx
describe('LibrarySidebar — recently unstarred section', () => {
  const unstarredRow = {
    ...makeRow('zed', 'unstarred-repo'),
    starred_at: null,
    unstarred_at: '2026-05-22T00:00:00Z',
  } as unknown as import('../types/repo').StarredRepoRow

  it('shows a collapsed Recently unstarred (N) section when there are items', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[unstarredRow]} />)
    expect(screen.getByRole('button', { name: /recently unstarred \(1\)/i })).toBeInTheDocument()
    expect(screen.queryByText('unstarred-repo')).not.toBeInTheDocument()
  })

  it('expands to reveal items on click', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[unstarredRow]} />)
    fireEvent.click(screen.getByRole('button', { name: /recently unstarred \(1\)/i }))
    expect(screen.getByText('unstarred-repo')).toBeInTheDocument()
  })

  it('hides Recently unstarred section entirely when empty', () => {
    wrap(<LibrarySidebar {...defaultProps} unstarredRows={[]} />)
    expect(screen.queryByRole('button', { name: /recently unstarred/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: new tests FAIL.

- [ ] **Step 3: Implement Recently unstarred section**

In `src/components/LibrarySidebar.tsx`, add another state:

```ts
const [unstarredOpen, setUnstarredOpen] = useState(false)
```

Add a `useMemo` for filtered unstarred rows:

```ts
const visibleUnstarred = useMemo(() => {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return unstarredRows
  return unstarredRows.filter(r =>
    r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)
  )
}, [unstarredRows, searchTerm])
```

After the archived section block (still inside `library-sidebar-list`):

```tsx
{visibleUnstarred.length > 0 && (
  <div className="library-sidebar-section">
    <button
      type="button"
      className="library-sidebar-section-header"
      onClick={() => setUnstarredOpen(o => !o)}
      aria-expanded={unstarredOpen}
    >
      <span className="library-sidebar-section-caret">{unstarredOpen ? '▾' : '▸'}</span>
      Recently unstarred ({visibleUnstarred.length})
    </button>
    {unstarredOpen && visibleUnstarred.map(row => (
      <SidebarRepoRow
        key={`unstarred-${row.id}`}
        row={row}
        isInstalled={false}
        selected={selectedId === row.id}
        onSelect={() => onSelect(row, false)}
        onContextMenu={(e) => handleRepoContextMenu(e, { kind: 'repo', row, isInstalled: false, isStarred: false })}
      />
    ))}
  </div>
)}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): add Recently unstarred collapsible section"
```

---

## Task 7: Add URL-driven mode auto-switch

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `LibrarySidebar.test.tsx`:

```tsx
describe('LibrarySidebar — URL-driven mode', () => {
  it('starts in collections mode when URL is /library/collection/:id', () => {
    wrap(<LibrarySidebar {...defaultProps} />, '/library/collection/abc')
    expect(screen.getByRole('button', { name: 'Collections' })).toHaveClass('active')
  })

  it('starts in repos mode when URL is /library/repo/:owner/:name', () => {
    wrap(<LibrarySidebar {...defaultProps} />, '/library/repo/foo/bar')
    expect(screen.getByRole('button', { name: 'Repositories' })).toHaveClass('active')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: collection-mode test FAILS (default `'repos'` is set initially).

- [ ] **Step 3: Implement URL-driven mode init + transition effect**

In `src/components/LibrarySidebar.tsx`, replace:

```ts
import { useLocation, useNavigate } from 'react-router-dom'
```

with:

```ts
import { useLocation, useNavigate, useMatch } from 'react-router-dom'
```

Add to imports:

```ts
import { useEffect } from 'react'  // confirm useEffect is imported
```

Replace the `mode` state initialization to consult URL on first render:

```ts
const collMatch = useMatch('/library/collection/:id')
const repoMatch = useMatch('/library/repo/:owner/:name')
const [mode, setMode] = useState<Mode>(collMatch ? 'collections' : 'repos')
```

Add two effects below the state declarations:

```ts
useEffect(() => {
  if (collMatch) setMode('collections')
}, [collMatch?.params.id])

useEffect(() => {
  if (repoMatch) setMode('repos')
}, [repoMatch?.params.owner, repoMatch?.params.name])
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): auto-switch mode based on URL"
```

---

## Task 8: Update CollectionsSidebar — add searchTerm prop, remove header

**Files:**
- Modify: `src/components/CollectionsSidebar.tsx`
- Modify: `src/components/CollectionsSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('CollectionsSidebar', ...)` block in `src/components/CollectionsSidebar.test.tsx`:

```tsx
it('filters collections by name when searchTerm is set', async () => {
  const onSelect = vi.fn()
  wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} searchTerm="python" />)
  expect(await screen.findByText('Python API')).toBeInTheDocument()
  expect(screen.queryByText('My Stack')).not.toBeInTheDocument()
})

it('is case-insensitive', async () => {
  const onSelect = vi.fn()
  wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} searchTerm="STACK" />)
  expect(await screen.findByText('My Stack')).toBeInTheDocument()
})

it('no longer renders a COLLECTIONS header', async () => {
  wrap(<CollectionsSidebar selectedId={null} onSelect={vi.fn()} />)
  await screen.findByText('My Stack')
  expect(screen.queryByText(/^COLLECTIONS$/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- CollectionsSidebar.test`
Expected: new tests FAIL.

- [ ] **Step 3: Update CollectionsSidebar**

In `src/components/CollectionsSidebar.tsx`:

Update the props interface:

```ts
interface CollectionsSidebarProps {
  selectedId: string | null
  onSelect: (id: string, coll: CollectionRow) => void
  searchTerm?: string
}
```

Update the component signature:

```ts
export default function CollectionsSidebar({ selectedId, onSelect, searchTerm = '' }: CollectionsSidebarProps) {
```

Add a filtered list `useMemo` before the return (add `useMemo` import if missing):

```ts
const visibleCollections = useMemo(() => {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return collections
  return collections.filter(c => c.name.toLowerCase().includes(q))
}, [collections, searchTerm])
```

In the JSX, change `collections.map(coll => ...)` to `visibleCollections.map(coll => ...)`, and update the empty-state condition to use `visibleCollections.length === 0`.

Remove this line entirely:

```tsx
<div className="library-sidebar-header">COLLECTIONS</div>
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- CollectionsSidebar.test`
Expected: all PASS (including the 4 pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/CollectionsSidebar.tsx src/components/CollectionsSidebar.test.tsx
git commit -m "feat(collections-sidebar): add searchTerm prop, remove header"
```

---

## Task 9: Render CollectionsSidebar from LibrarySidebar when mode=collections

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `LibrarySidebar.test.tsx`:

```tsx
describe('LibrarySidebar — collections mode rendering', () => {
  it('renders the collections list when mode=collections', async () => {
    vi.stubGlobal('api', {
      collection: {
        getAll: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'My Collection', description: null, owner: 'me',
            active: 1, created_at: '2026-01-01', color_start: '#000', color_end: '#fff',
            repo_count: 0, saved_count: 0 },
        ]),
      },
    })
    wrap(<LibrarySidebar {...defaultProps} collSelectedId={null} onSelectColl={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(await screen.findByText('My Collection')).toBeInTheDocument()
  })

  it('changes search placeholder when in collections mode', () => {
    wrap(<LibrarySidebar {...defaultProps} collSelectedId={null} onSelectColl={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(screen.getByPlaceholderText('Search collections')).toBeInTheDocument()
  })
})
```

Also update `defaultProps` at the top of the test file to include the new props:

```tsx
const defaultProps = {
  installedRows: [],
  starredRows: [],
  unstarredRows: [],
  localProjects: [],
  archivedSet: new Set<string>(),
  selectedId: null,
  selectedLocalPath: null,
  collSelectedId: null,
  onSelect: vi.fn(),
  onSelectLocal: vi.fn(),
  onSelectColl: vi.fn(),
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- LibrarySidebar.test`
Expected: new tests FAIL (LibrarySidebar doesn't render CollectionsSidebar yet).

- [ ] **Step 3: Wire CollectionsSidebar into LibrarySidebar**

In `src/components/LibrarySidebar.tsx`:

Add imports:

```ts
import CollectionsSidebar from './CollectionsSidebar'
import type { CollectionRow } from '../types/repo'
```

Extend the Props interface:

```ts
interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  localProjects: LocalProject[]
  archivedSet: Set<string>
  selectedId: string | null
  selectedLocalPath: string | null
  collSelectedId: string | null
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onSelectLocal: (project: LocalProject) => void
  onSelectColl: (id: string, coll: CollectionRow) => void
}
```

Destructure the new props:

```ts
export default function LibrarySidebar({
  installedRows, starredRows, unstarredRows, localProjects,
  archivedSet,
  selectedId, selectedLocalPath, collSelectedId,
  onSelect, onSelectLocal, onSelectColl,
}: Props) {
```

In the JSX, wrap the entire `library-sidebar-list` block with a mode-conditional:

```tsx
{mode === 'repos' ? (
  <div className="library-sidebar-list">
    {/* ...existing visible.map, archived section, unstarred section... */}
  </div>
) : (
  <div className="library-sidebar-list">
    <CollectionsSidebar
      selectedId={collSelectedId}
      onSelect={onSelectColl}
      searchTerm={searchTerm}
    />
  </div>
)}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- LibrarySidebar.test CollectionsSidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx
git commit -m "feat(library-sidebar): render CollectionsSidebar in collections mode"
```

---

## Task 10: Update Library.tsx — drop NavRail, drop activePanel state, update tests

**Files:**
- Modify: `src/views/Library.tsx`
- Modify: `src/views/Library.test.tsx`

- [ ] **Step 1: Update Library.test.tsx to match new structure**

In `src/views/Library.test.tsx`, **replace** these tests (NavRail-dependent):

```tsx
it('renders the nav rail with Repositories and Collections buttons', ...)
it('Repositories panel is open by default', ...)
it('clicking Repos button again collapses the panel', ...)
it('switching to Collections panel shows the collections sidebar', ...)
```

With these:

```tsx
it('renders the new sidebar with home button + mode toggle', async () => {
  renderLibrary()
  await screen.findByText('react')
  expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Repositories' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Collections' })).toBeInTheDocument()
})

it('starts on the repos list by default', async () => {
  renderLibrary()
  await screen.findByText('react')
  expect(screen.getByRole('button', { name: 'Repositories' })).toHaveClass('active')
})

it('shows collections sidebar when Collections toggle is clicked', async () => {
  const user = userEvent.setup()
  renderLibrary()
  await screen.findByText('react')
  await user.click(screen.getByRole('button', { name: 'Collections' }))
  // The CollectionsSidebar mock renders this test id
  expect(screen.getByTestId('collections-sidebar')).toBeInTheDocument()
})
```

Keep the other tests (`shows empty state...`, `shows repo count...`, `No skills installed yet`) as-is.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- Library.test`
Expected: new tests FAIL (Library still renders NavRail, not the new sidebar structure).

- [ ] **Step 3: Update Library.tsx**

In `src/views/Library.tsx`:

Remove these imports:

```ts
import NavRail from '../components/NavRail'
import CollectionsSidebar from '../components/CollectionsSidebar'
```

Remove state and related effect:

```ts
const [activePanel, setActivePanel] = useState<ActivePanel>('repos')
// ...
useEffect(() => {
  if (collMatch) setActivePanel('collections')
  else if (repoMatch) setActivePanel('repos')
}, [collMatch, repoMatch])

const handlePanelToggle = useCallback((panel: 'repos' | 'collections') => {
  setActivePanel(panel)
}, [])
```

Remove `type ActivePanel = 'repos' | 'collections'` near the top.

Replace this JSX block:

```tsx
<NavRail activePanel={activePanel} onPanelToggle={handlePanelToggle} />

<div className={`library-panel${activePanel === 'repos' ? '' : ' collapsed'}${isMiniTab ? ' mini' : ''}`}
     aria-hidden={activePanel !== 'repos'}>
  <LibrarySidebar ... />
</div>

<div className={`library-panel${activePanel === 'collections' ? '' : ' collapsed'}`}
     aria-hidden={activePanel !== 'collections'}>
  <CollectionsSidebar selectedId={collSelectedId} onSelect={handleCollSelect} />
</div>
```

With:

```tsx
<div className={`library-panel${isMiniTab ? ' mini' : ''}`}>
  <LibrarySidebar
    installedRows={rows}
    starredRows={starredRows}
    unstarredRows={unstarredRows}
    localProjects={localProjects}
    archivedSet={archivedSet}
    selectedId={repoSelectedId}
    selectedLocalPath={selectedLocalPath}
    collSelectedId={collSelectedId}
    onSelect={handleRepoSelect}
    onSelectLocal={handleLocalSelect}
    onSelectColl={handleCollSelect}
  />
</div>
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- Library.test LibrarySidebar.test CollectionsSidebar.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/Library.tsx src/views/Library.test.tsx
git commit -m "refactor(library): drop NavRail and two-panel split, single sidebar now"
```

---

## Task 11: Rewrite LibrarySidebar.css for new top bar + mini mode

**Files:**
- Modify: `src/components/LibrarySidebar.css`

- [ ] **Step 1: Remove obsolete styles**

In `src/components/LibrarySidebar.css`, delete these rule blocks entirely:

- `.library-sidebar-header { ... }`
- `.library-sidebar-filter { ... }`
- `.library-sidebar-seg { ... }` (and the `:hover` and `.active` variants)
- `.library-activity-row { ... }`
- `.library-activity-btn { ... }` (and the `:hover` and `.active` variants)
- `.library-panel.mini .library-sidebar-header { display: none }`
- `.library-panel.mini .library-sidebar-filter { display: none }`
- `.library-panel.mini .library-activity-row { display: none }`

- [ ] **Step 2: Add new top bar styles**

Append to `src/components/LibrarySidebar.css`:

```css
/* ── Top bar ─────────────────────────────────────────── */

.library-sidebar-topbar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--glass-border);
  -webkit-app-region: drag;
}

.library-sidebar-topbar-row1 {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 6px;
}

.library-sidebar-topbar-row2 {
  padding: 0 10px 8px;
}

.library-sidebar-home {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--t2);
  cursor: pointer;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  transition: background 0.1s, color 0.1s;
}

.library-sidebar-home:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--t1);
}

.library-sidebar-home.active {
  background: rgba(255, 255, 255, 0.18);
  color: var(--t1);
}

.library-sidebar-toggle {
  display: flex;
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  padding: 1px;
  -webkit-app-region: no-drag;
}

.library-sidebar-toggle-btn {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 4px 0;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--t3);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.library-sidebar-toggle-btn:hover {
  color: var(--t2);
}

.library-sidebar-toggle-btn.active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--t1);
}

.library-sidebar-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  -webkit-app-region: no-drag;
}

.library-sidebar-search-icon {
  opacity: 0.5;
  flex-shrink: 0;
}

.library-sidebar-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 11px;
  color: var(--t1);
  font-family: inherit;
}

.library-sidebar-search-input::placeholder {
  color: var(--t3);
}

/* ── Collapsible sections (Archived, Recently unstarred) ─ */

.library-sidebar-section {
  border-top: 1px solid var(--glass-border);
  margin-top: 8px;
}

.library-sidebar-section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  font-size: 10px;
  color: var(--t3);
  cursor: pointer;
  text-align: left;
}

.library-sidebar-section-header:hover {
  color: var(--t2);
}

.library-sidebar-section-caret {
  font-size: 9px;
  width: 10px;
  display: inline-block;
}

/* ── Mini-mode vertical reflow ───────────────────────── */

.library-panel.mini .library-sidebar-topbar-row1 {
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}

.library-panel.mini .library-sidebar-home {
  width: 36px;
  height: 36px;
  border-radius: 6px;
}

.library-panel.mini .library-sidebar-toggle {
  flex-direction: column;
  flex: 0 0 auto;
  padding: 1px;
}

.library-panel.mini .library-sidebar-toggle-btn {
  width: 32px;
  height: 22px;
}

.library-panel.mini .library-sidebar-topbar-row2 {
  display: none;
}

.library-panel.mini .library-sidebar-section {
  display: none;
}

.library-panel.mini .library-sidebar-topbar {
  border-bottom: none;
}
```

- [ ] **Step 3: Verify in the app**

Tell the user: "CSS rewrite done. Please open the app and verify the sidebar looks correct in:
1. Repos mode (full width)
2. Collections mode
3. Mini mode (open a repo, switch to Files or Components tab)

I can't visually verify, but the test suite has structural assertions."

- [ ] **Step 4: Commit**

```bash
git add src/components/LibrarySidebar.css
git commit -m "style(library-sidebar): rewrite CSS for new top bar + mini mode"
```

---

## Task 12: Delete dead code

**Files:**
- Delete: `src/components/NavRail.tsx`
- Delete: `src/lib/libraryFilter.ts`
- Delete: `src/lib/libraryFilter.test.ts`
- Modify: `src/types/library.ts`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "from.*NavRail\|filterLibraryEntries\|ActiveSegment" src/
```

Expected: zero matches (other than the files about to be deleted). If anything else shows up, stop and surface it.

- [ ] **Step 2: Delete files**

```bash
git rm src/components/NavRail.tsx
git rm src/lib/libraryFilter.ts
git rm src/lib/libraryFilter.test.ts
```

- [ ] **Step 3: Remove ActiveSegment type from src/types/library.ts**

Open `src/types/library.ts` and delete this line:

```ts
export type ActiveSegment = 'all' | 'active' | 'unstarred' | 'own' | 'recent' | 'archive'
```

Keep `LocalProject` and `LibraryEntry` exports.

- [ ] **Step 4: Run typecheck and full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/library.ts
git commit -m "chore: remove NavRail, libraryFilter, ActiveSegment (dead after redesign)"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Ask user to verify in app**

User tests UI themselves (per project preference — see CLAUDE.md / auto-memory). Ask the user to verify:

1. **Repos mode (full width):** home button + Repos/Collections toggle in row 1, search in row 2, list below. Search filters by name and owner.
2. **Collections mode:** toggle to Collections, list shows collections, search placeholder reads "Search collections" and filters by name.
3. **URL deep link:** navigating directly to `/library/collection/<id>` opens with Collections toggle active. Navigating directly to `/library/repo/<owner>/<name>` opens with Repos toggle active.
4. **Archived section:** if there are archived repos, a "▸ Archived (N)" header appears at bottom. Clicking expands. Archived items don't appear in main list.
5. **Recently unstarred section:** same pattern, when there are recently-unstarred repos.
6. **Mini mode:** open a repo, switch to Files or Components tab. Sidebar shrinks. Home icon + vertical toggle stack visible. Search hides. Avatar list shown.
7. **Home button:** clicking returns to `/library` (Activity feed view).

Wait for user feedback. If something is off visually, the CSS in Task 11 may need adjustments — fix inline.

- [ ] **Step 4: Final commit (if anything was adjusted)**

If no further changes were needed, no commit. Otherwise:

```bash
git add <files>
git commit -m "fix(library-sidebar): <adjustment description>"
```

---

## Spec coverage check (self-review)

| Spec requirement | Task |
|---|---|
| Delete NavRail | 10, 12 |
| Two-row top bar (home + toggle + search) | 2, 3, 4, 11 |
| Drop six filter chips | 1 |
| Archived section collapsible at bottom | 5, 11 |
| Recently unstarred section collapsible at bottom | 6, 11 |
| Search filters name + owner | 4 |
| Search filters collections by name | 8 |
| Search placeholder changes per mode | 4, 9 |
| Search resets on toggle (manual mode change) | 4 |
| Mini mode vertical reflow | 11 |
| URL-driven mode switch (transition-only effect) | 7 |
| CollectionsSidebar gains searchTerm prop, drops COLLECTIONS header | 8 |
| Library.tsx loses NavRail + activePanel state + separate columns | 10 |
| Delete libraryFilter.ts, libraryFilter.test.ts | 12 |
| Remove ActiveSegment type | 12 |

All requirements mapped.
