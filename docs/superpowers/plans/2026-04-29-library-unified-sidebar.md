# Library Unified Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the Library sidebar to show local filesystem projects alongside GitHub repos, with 6 icon-only filter tabs (All, Learned, Unstarred, Own, Recent, Archive), while removing the Recent/Archive side rail from the Create view.

**Architecture:** A new `LibraryEntry` union type wraps both `RepoRow` (GitHub) and `LocalProject` (filesystem). A pure `filterLibraryEntries` function handles all filter logic and is tested independently. Library.tsx fetches local projects from `window.api.projects?.scanFolder()`, reads recent visits from localStorage, and reads archived keys from `useArchivedRepos`.

**Tech Stack:** React, TypeScript, Vitest, Electron IPC (`window.api`), localStorage

> **Spec note:** The spec references `CreateSession` as the local project type. The actual type is `LocalProject` (from `window.api.projects?.scanFolder()`), which is what TemplateGallery already uses. This plan uses the correct type.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/types/library.ts` | `LocalProject`, `LibraryEntry` union types |
| Create | `src/lib/libraryFilter.ts` | Pure `filterLibraryEntries` function |
| Create | `src/lib/libraryFilter.test.ts` | Tests for all 6 filter segments |
| Modify | `src/components/LibrarySidebar.tsx` | New props, 6 icon tabs, unified rendering |
| Modify | `src/components/LibrarySidebar.css` | Local avatar + type icon styles |
| Modify | `src/views/Library.tsx` | Fetch local projects, recent visits, pass new props |
| Modify | `src/components/create/TemplateGallery.tsx` | Remove ProjectsSideRail and tab state |
| Delete | `src/components/create/ProjectsSideRail.tsx` | No longer needed |
| Delete | `src/components/create/ProjectsSideRail.css` | No longer needed |

---

## Task 1: Define shared types

**Files:**
- Create: `src/types/library.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/types/library.ts
import type { RepoRow } from './repo'

export interface LocalProject {
  name: string
  path: string
  isGit: boolean
  owner: string | null
  repoName: string | null
}

export type LibraryEntry =
  | { kind: 'repo'; row: RepoRow; isInstalled: boolean; isStarred: boolean }
  | { kind: 'local'; project: LocalProject }

export type ActiveSegment = 'all' | 'active' | 'unstarred' | 'own' | 'recent' | 'archive'
```

- [ ] **Step 2: Update TemplateGallery to import LocalProject from the new types file**

In `src/components/create/TemplateGallery.tsx`:
- Remove the inline `interface LocalProject { ... }` definition (lines 58–64)
- Add import at the top: `import type { LocalProject } from '../../types/library'`
- The rest of TemplateGallery is unchanged for now

- [ ] **Step 3: Commit**

```bash
git add src/types/library.ts src/components/create/TemplateGallery.tsx
git commit -m "feat(library): add LibraryEntry and LocalProject shared types"
```

---

## Task 2: Filter logic — TDD

**Files:**
- Create: `src/lib/libraryFilter.ts`
- Create: `src/lib/libraryFilter.test.ts`
- Reference: `src/lib/recentVisits.ts` (for `RecentEntry` type)

The filter function is pure — no React, no side effects. Test it before wiring it to the component.

- [ ] **Step 1: Write the failing tests first**

```typescript
// src/lib/libraryFilter.test.ts
import { describe, it, expect } from 'vitest'
import { filterLibraryEntries } from './libraryFilter'
import type { LibraryEntry, LocalProject } from '../types/library'
import type { RepoRow } from '../types/repo'
import type { LibraryRow } from '../types/repo'

// ── helpers ──────────────────────────────────────────────────────────

function makeRepo(owner: string, name: string, extra: Partial<RepoRow & LibraryRow> = {}): LibraryEntry {
  return {
    kind: 'repo',
    row: {
      id: `${owner}/${name}`,
      owner, name,
      description: null, language: null, topics: '[]',
      stars: null, forks: null, license: null, homepage: null,
      updated_at: null, pushed_at: null, saved_at: null, type: null,
      banner_svg: null, discovered_at: null, discover_query: null,
      watchers: null, size: null, open_issues: null,
      starred_at: '2024-01-01', unstarred_at: null,
      default_branch: 'main', avatar_url: null, banner_color: null,
      translated_description: null, translated_description_lang: null,
      translated_readme: null, translated_readme_lang: null,
      detected_language: null, verification_score: null,
      verification_tier: null, verification_signals: null,
      verification_checked_at: null, type_bucket: null, type_sub: null,
      og_image_url: null,
      ...extra,
    } as RepoRow & LibraryRow,
    isInstalled: (extra as LibraryRow).installed === 1,
    isStarred: true,
  }
}

function makeLocal(name: string, owner: string | null = null): LibraryEntry {
  return {
    kind: 'local',
    project: { name, path: `/home/user/${name}`, isGit: true, owner, repoName: owner ? name : null },
  }
}

const baseOpts = {
  archivedSet: new Set<string>(),
  recentVisits: [] as import('./recentVisits').RecentEntry[],
  githubUsername: 'alice',
  unstarredRows: [] as import('../types/repo').StarredRepoRow[],
}

// ── all ───────────────────────────────────────────────────────────────

describe('all', () => {
  it('returns repos and local entries', () => {
    const entries = [makeRepo('alice', 'tool'), makeLocal('MyApp')]
    expect(filterLibraryEntries(entries, 'all', baseOpts)).toHaveLength(2)
  })
})

// ── active (Learned) ─────────────────────────────────────────────────

describe('active', () => {
  it('returns only installed repos with active=1', () => {
    const active = makeRepo('alice', 'tool', { installed: 1, active: 1 } as Partial<LibraryRow>)
    const inactive = makeRepo('alice', 'other', { installed: 1, active: 0 } as Partial<LibraryRow>)
    const uninstalled = makeRepo('bob', 'pkg')
    const local = makeLocal('MyApp')
    const result = filterLibraryEntries([active, inactive, uninstalled, local], 'active', baseOpts)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(active)
  })
})

// ── unstarred ─────────────────────────────────────────────────────────

describe('unstarred', () => {
  it('returns only unstarred repo entries (no local entries)', () => {
    const repo = makeRepo('alice', 'tool')
    const local = makeLocal('MyApp')
    const unstarredRow = { ...repo.row, unstarred_at: '2024-01-10' } as import('../types/repo').StarredRepoRow
    const opts = { ...baseOpts, unstarredRows: [unstarredRow] }
    const result = filterLibraryEntries([repo, local], 'unstarred', opts)
    expect(result).toHaveLength(1)
    expect((result[0] as { kind: 'repo' }).kind).toBe('repo')
  })
})

// ── own ──────────────────────────────────────────────────────────────

describe('own', () => {
  it('returns repos owned by githubUsername and all local entries', () => {
    const owned = makeRepo('alice', 'tool')
    const other = makeRepo('bob', 'lib')
    const local = makeLocal('MyApp')
    const result = filterLibraryEntries([owned, other, local], 'own', baseOpts)
    expect(result).toHaveLength(2)
    expect(result.some(e => e.kind === 'repo' && e.row.owner === 'alice')).toBe(true)
    expect(result.some(e => e.kind === 'local')).toBe(true)
  })
})

// ── recent ────────────────────────────────────────────────────────────

describe('recent', () => {
  it('returns entries matching recent visits, in recency order', () => {
    const repo1 = makeRepo('alice', 'tool')
    const repo2 = makeRepo('bob', 'lib')
    const local = makeLocal('MyApp')
    const recent = [
      { owner: 'bob', name: 'lib', avatar_url: null, navigatePath: '/repo/bob/lib', visitedAt: 2000 },
      { owner: 'alice', name: 'tool', avatar_url: null, navigatePath: '/repo/alice/tool', visitedAt: 1000 },
    ]
    const result = filterLibraryEntries([repo1, repo2, local], 'recent', { ...baseOpts, recentVisits: recent })
    expect(result).toHaveLength(2)
    expect((result[0] as { row: RepoRow }).row.name).toBe('lib')
    expect((result[1] as { row: RepoRow }).row.name).toBe('tool')
  })

  it('includes local entries that were recently visited', () => {
    const local = makeLocal('MyApp', null)
    const recent = [
      { owner: '', name: 'MyApp', avatar_url: null, navigatePath: '/local-project?path=...&name=MyApp', visitedAt: 3000 },
    ]
    const result = filterLibraryEntries([local], 'recent', { ...baseOpts, recentVisits: recent })
    expect(result).toHaveLength(1)
  })
})

// ── archive ───────────────────────────────────────────────────────────

describe('archive', () => {
  it('returns archived repo entries', () => {
    const repo = makeRepo('alice', 'tool')
    const opts = { ...baseOpts, archivedSet: new Set(['alice/tool']) }
    const result = filterLibraryEntries([repo], 'archive', opts)
    expect(result).toHaveLength(1)
  })

  it('returns archived local entries', () => {
    const local = makeLocal('MyApp', 'alice')
    const opts = { ...baseOpts, archivedSet: new Set(['alice/MyApp']) }
    const result = filterLibraryEntries([local], 'archive', opts)
    expect(result).toHaveLength(1)
  })

  it('excludes non-archived entries', () => {
    const repo = makeRepo('alice', 'tool')
    expect(filterLibraryEntries([repo], 'archive', baseOpts)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failures (function not found)**

```bash
cd D:/Coding/Git-Suite && npx vitest run src/lib/libraryFilter.test.ts
```

Expected: error about missing module `./libraryFilter`

- [ ] **Step 3: Implement the filter function**

```typescript
// src/lib/libraryFilter.ts
import type { LibraryEntry, ActiveSegment } from '../types/library'
import type { StarredRepoRow, LibraryRow } from '../types/repo'
import type { RecentEntry } from './recentVisits'

export interface FilterOptions {
  archivedSet: Set<string>
  recentVisits: RecentEntry[]
  githubUsername: string | null
  unstarredRows: StarredRepoRow[]
}

function entryKey(entry: LibraryEntry): string {
  if (entry.kind === 'repo') return `${entry.row.owner}/${entry.row.name}`
  const { project } = entry
  return `${project.owner ?? ''}/${project.repoName ?? project.name}`
}

export function filterLibraryEntries(
  entries: LibraryEntry[],
  segment: ActiveSegment,
  opts: FilterOptions,
): LibraryEntry[] {
  const { archivedSet, recentVisits, githubUsername, unstarredRows } = opts

  switch (segment) {
    case 'all':
      return entries

    case 'active':
      return entries.filter(e => {
        if (e.kind !== 'repo') return false
        const row = e.row as LibraryRow
        return e.isInstalled && row.active === 1
      })

    case 'unstarred': {
      const unstarredKeys = new Set(unstarredRows.map(r => `${r.owner}/${r.name}`))
      return entries.filter(e => e.kind === 'repo' && unstarredKeys.has(`${e.row.owner}/${e.row.name}`))
    }

    case 'own':
      return entries.filter(e => {
        if (e.kind === 'local') return true
        return e.row.owner === githubUsername
      })

    case 'recent': {
      const recentMap = new Map<string, number>()
      recentVisits.forEach((r, i) => recentMap.set(`${r.owner}/${r.name}`, i))
      const matched = entries.filter(e => recentMap.has(entryKey(e)))
      return matched.sort((a, b) => (recentMap.get(entryKey(a)) ?? 999) - (recentMap.get(entryKey(b)) ?? 999))
    }

    case 'archive':
      return entries.filter(e => archivedSet.has(entryKey(e)))
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd D:/Coding/Git-Suite && npx vitest run src/lib/libraryFilter.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/libraryFilter.ts src/lib/libraryFilter.test.ts
git commit -m "feat(library): add filterLibraryEntries with tests"
```

---

## Task 3: CSS additions

**Files:**
- Modify: `src/components/LibrarySidebar.css`

- [ ] **Step 1: Add new styles at the end of the file**

Append to `src/components/LibrarySidebar.css`:

```css
/* ── Local project avatar ────────────────────────────── */

.library-sidebar-local-avatar {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
}

/* ── Type indicator icon (right end of row) ──────────── */

.library-sidebar-type-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.45;
}

.library-sidebar-type-icon.local {
  opacity: 0.55;
}
```

- [ ] **Step 2: Verify the filter row handles 6 buttons**

In `LibrarySidebar.css`, the existing `.library-sidebar-filter` rule uses `gap: 2px` with `flex`. Six `flex: 1` children in a 220px panel = ~33px each, which fits fine. No change needed to the filter row CSS.

- [ ] **Step 3: Commit**

```bash
git add src/components/LibrarySidebar.css
git commit -m "feat(library): add CSS for local avatar and type icon"
```

---

## Task 4: Rewrite LibrarySidebar

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`
- Reference: `src/lib/libraryFilter.ts`, `src/types/library.ts`, `src/lib/recentVisits.ts`

Replace the entire file content:

- [ ] **Step 1: Write the new LibrarySidebar.tsx**

```typescript
// src/components/LibrarySidebar.tsx
import { useState } from 'react'
import { Layers, Brain, User, History, Archive } from 'lucide-react'
import './LibrarySidebar.css'
import type { LibraryRow, StarredRepoRow, RepoRow } from '../types/repo'
import type { LibraryEntry, LocalProject, ActiveSegment } from '../types/library'
import type { RecentEntry } from '../lib/recentVisits'
import { filterLibraryEntries } from '../lib/libraryFilter'
import RepoContextMenu, { type RepoContextMenuTarget } from './RepoContextMenu'

export type { ActiveSegment }

interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  localProjects: LocalProject[]
  archivedSet: Set<string>
  recentVisits: RecentEntry[]
  githubUsername: string | null
  selectedId: string | null
  activeSegment: ActiveSegment
  onSegmentChange: (s: ActiveSegment) => void
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onSelectLocal: (project: LocalProject) => void
}

function DashedStar({ size = 11 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="2 1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.7 4.1L8 10.77l-3.7 1.96.7-4.1-3-2.93 4.15-.6z" />
    </svg>
  )
}

function GitHubIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function LocalIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: '#a78bfa' }}>
      <path d="M20 6h-2.18c.07-.44.18-.86.18-1a3 3 0 0 0-6 0c0 .14.11.56.18 1H10c-.27 0-2 .12-2 2v10c0 1.5 1.73 2 2 2h10c.27 0 2-.12 2-2V8c0-1.88-1.73-2-2-2zm-6-1a1 1 0 0 1 2 0c0 .14-.06.39-.11.6-.04.13-.07.27-.11.4h-1.56c-.04-.13-.07-.27-.11-.4-.05-.21-.11-.46-.11-.6zm6 13H10V8h2v1h6V8h2v10z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#a78bfa' }} aria-hidden="true">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

const EMPTY_STATES: Record<ActiveSegment, string> = {
  all: 'No repos or projects',
  active: 'No active skills',
  unstarred: 'Nothing unstarred in the last 30 days',
  own: 'No repos or projects owned by you',
  recent: 'Nothing viewed recently',
  archive: 'Nothing archived',
}

const SEGMENTS: { id: ActiveSegment; icon: React.ReactNode; label: string }[] = [
  { id: 'all',       icon: <Layers size={12} />,   label: 'All' },
  { id: 'active',    icon: <Brain size={12} />,    label: 'Learned' },
  { id: 'unstarred', icon: <DashedStar size={11} />, label: 'Unstarred' },
  { id: 'own',       icon: <User size={12} />,     label: 'Own' },
  { id: 'recent',    icon: <History size={12} />,  label: 'Recent' },
  { id: 'archive',   icon: <Archive size={12} />,  label: 'Archive' },
]

export default function LibrarySidebar({
  installedRows, starredRows, unstarredRows, localProjects,
  archivedSet, recentVisits, githubUsername,
  selectedId, activeSegment, onSegmentChange, onSelect, onSelectLocal,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; target: RepoContextMenuTarget } | null>(null)

  // Build unified entry list
  const allEntries: LibraryEntry[] = (() => {
    const map = new Map<string, LibraryEntry>()
    for (const row of installedRows) {
      map.set(row.id, { kind: 'repo', row, isInstalled: true, isStarred: row.starred_at != null })
    }
    for (const row of starredRows) {
      if (!map.has(row.id)) {
        map.set(row.id, { kind: 'repo', row, isInstalled: false, isStarred: true })
      }
    }
    for (const project of localProjects) {
      const key = `local:${project.path}`
      map.set(key, { kind: 'local', project })
    }
    return Array.from(map.values())
  })()

  const visible = filterLibraryEntries(allEntries, activeSegment, {
    archivedSet,
    recentVisits,
    githubUsername,
    unstarredRows,
  })

  const handleRepoContextMenu = (e: React.MouseEvent, entry: LibraryEntry & { kind: 'repo' }) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { owner: entry.row.owner, name: entry.row.name, isStarred: entry.isStarred },
    })
  }

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar-header">REPOSITORIES</div>
      <div className="library-sidebar-filter">
        {SEGMENTS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`library-sidebar-seg${activeSegment === id ? ' active' : ''}`}
            onClick={() => onSegmentChange(id)}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="library-sidebar-list">
        {visible.length === 0 && (
          <div className="library-sidebar-empty">{EMPTY_STATES[activeSegment]}</div>
        )}
        {visible.map(entry => {
          if (entry.kind === 'repo') {
            const { row, isInstalled } = entry
            return (
              <button
                key={row.id}
                className={`library-sidebar-item${selectedId === row.id ? ' selected' : ''}${isInstalled ? ' installed' : ' uninstalled'}`}
                onClick={() => onSelect(row, isInstalled)}
                onContextMenu={e => handleRepoContextMenu(e, entry)}
                title={`${row.owner}/${row.name}`}
              >
                <span className="library-sidebar-avatar">
                  {row.avatar_url
                    ? <img src={row.avatar_url} alt="" />
                    : <span className="library-sidebar-avatar-fallback">{(row.name?.[0] ?? '?').toUpperCase()}</span>
                  }
                </span>
                <span className="library-sidebar-name">{row.name}</span>
                <span className="library-sidebar-type-icon">
                  <GitHubIcon />
                </span>
              </button>
            )
          }

          // kind === 'local'
          const { project } = entry
          const localKey = `local:${project.path}`
          return (
            <button
              key={localKey}
              className={`library-sidebar-item installed${selectedId === localKey ? ' selected' : ''}`}
              onClick={() => onSelectLocal(project)}
              title={project.path}
            >
              <span className="library-sidebar-avatar library-sidebar-local-avatar">
                <FolderIcon />
              </span>
              <span className="library-sidebar-name">{project.name}</span>
              <span className="library-sidebar-type-icon local">
                <LocalIcon />
              </span>
            </button>
          )
        })}
      </div>

      {menu && (
        <RepoContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
cd D:/Coding/Git-Suite && npx tsc --noEmit
```

Fix any type errors before committing.

- [ ] **Step 3: Commit**

```bash
git add src/components/LibrarySidebar.tsx
git commit -m "feat(library): rewrite LibrarySidebar with 6 icon tabs and local project support"
```

---

## Task 5: Update Library.tsx

**Files:**
- Modify: `src/views/Library.tsx`
- Reference: `src/hooks/useArchivedRepos.ts`, `src/lib/recentVisits.ts`, `src/contexts/GitHubAuth.tsx`

- [ ] **Step 1: Rewrite Library.tsx**

```typescript
// src/views/Library.tsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useMatch, Routes, Route } from 'react-router-dom'
import { type LibraryRow, type StarredRepoRow, type RepoRow } from '../types/repo'
import type { CollectionRow } from '../types/repo'
import type { LocalProject, ActiveSegment } from '../types/library'
import { useToast } from '../contexts/Toast'
import { useRepoNav } from '../contexts/RepoNav'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useArchivedRepos } from '../hooks/useArchivedRepos'
import { getRecentVisits, recordRecentVisit } from '../lib/recentVisits'
import type { RecentEntry } from '../lib/recentVisits'
import NavRail from '../components/NavRail'
import LibrarySidebar from '../components/LibrarySidebar'
import CollectionsSidebar from '../components/CollectionsSidebar'
import RepoDetail from './RepoDetail'
import CollectionDetail from './CollectionDetail'

type ActivePanel = 'repos' | 'collections'

export default function Library() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { state: repoNav } = useRepoNav()
  const { user } = useGitHubAuth()
  const { archivedSet } = useArchivedRepos()
  const isMiniTab = repoNav.activeTab === 'files' || repoNav.activeTab === 'components'

  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null

  const [activePanel, setActivePanel] = useState<ActivePanel>('repos')
  const [rows, setRows] = useState<LibraryRow[]>([])
  const [starredRows, setStarredRows] = useState<StarredRepoRow[]>([])
  const [unstarredRows, setUnstarredRows] = useState<StarredRepoRow[]>([])
  const [activeSegment, setActiveSegment] = useState<ActiveSegment>('all')
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [recentVisits, setRecentVisits] = useState<RecentEntry[]>(() => getRecentVisits())

  const refreshRecentVisits = useCallback(() => {
    setRecentVisits(getRecentVisits())
  }, [])

  const refreshAll = useCallback(() => {
    window.api.library.getAll().then(setRows).catch(() => {
      toast('Failed to load library', 'error')
    })
    window.api.starred.getAll().then(setStarredRows).catch(() => {})
    window.api.starred.getRecentlyUnstarred().then(setUnstarredRows).catch(() => {})
  }, [toast])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Load local projects from projectsFolder setting
  useEffect(() => {
    window.api.settings.get('projectsFolder').then(folder => {
      if (folder) {
        window.api.projects?.scanFolder(folder).then(setLocalProjects).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.addEventListener('library:changed', refreshAll)
    return () => window.removeEventListener('library:changed', refreshAll)
  }, [refreshAll])

  const repoSelectedId = useMemo(() => {
    if (!repoMatch) return null
    const { owner, name } = repoMatch.params
    return (
      rows.find(r => r.owner === owner && r.name === name)?.id ??
      starredRows.find(r => r.owner === owner && r.name === name)?.id ??
      null
    )
  }, [repoMatch, rows, starredRows])

  const collSelectedId = collMatch?.params.id ?? null

  const handlePanelToggle = useCallback((panel: 'repos' | 'collections') => {
    setActivePanel(panel)
  }, [])

  const handleRepoSelect = useCallback((row: RepoRow, _isInstalled: boolean) => {
    recordRecentVisit({ owner: row.owner, name: row.name, avatar_url: row.avatar_url, navigatePath: `/library/repo/${row.owner}/${row.name}` })
    refreshRecentVisits()
    navigate(`/library/repo/${row.owner}/${row.name}`)
  }, [navigate, refreshRecentVisits])

  const handleLocalSelect = useCallback((project: LocalProject) => {
    const navPath = project.owner && project.repoName
      ? `/library/repo/${project.owner}/${project.repoName}`
      : `/local-project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}&git=${project.isGit ? '1' : '0'}`
    recordRecentVisit({ owner: project.owner ?? '', name: project.repoName ?? project.name, avatar_url: null, navigatePath: navPath })
    refreshRecentVisits()
    navigate(navPath)
  }, [navigate, refreshRecentVisits])

  const handleCollSelect = useCallback((id: string, coll: CollectionRow) => {
    navigate(`/library/collection/${id}`, { state: { coll, collectionName: coll.name } })
  }, [navigate])

  return (
    <div className="library-root-v2">
      <div className="discover-drag-strip" aria-hidden="true" />
      <NavRail activePanel={activePanel} onPanelToggle={handlePanelToggle} />

      <div
        className={`library-panel${activePanel === 'repos' ? '' : ' collapsed'}${isMiniTab ? ' mini' : ''}`}
        aria-hidden={activePanel !== 'repos'}
      >
        <LibrarySidebar
          installedRows={rows}
          starredRows={starredRows}
          unstarredRows={unstarredRows}
          localProjects={localProjects}
          archivedSet={archivedSet}
          recentVisits={recentVisits}
          githubUsername={user?.login ?? null}
          selectedId={repoSelectedId}
          activeSegment={activeSegment}
          onSegmentChange={setActiveSegment}
          onSelect={handleRepoSelect}
          onSelectLocal={handleLocalSelect}
        />
      </div>

      <div
        className={`library-panel${activePanel === 'collections' ? '' : ' collapsed'}`}
        aria-hidden={activePanel !== 'collections'}
      >
        <CollectionsSidebar
          selectedId={collSelectedId}
          onSelect={handleCollSelect}
        />
      </div>

      <main className="library-main">
        <div className="library-detail-area">
          {hasDetail ? (
            <Routes>
              <Route path="repo/:owner/:name" element={<RepoDetail />} />
              <Route path="collection/:id" element={<CollectionDetail />} />
            </Routes>
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
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd D:/Coding/Git-Suite && npx tsc --noEmit
```

Fix any errors before committing.

- [ ] **Step 3: Run tests**

```bash
cd D:/Coding/Git-Suite && npx vitest run src/lib/libraryFilter.test.ts
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/views/Library.tsx
git commit -m "feat(library): wire Library.tsx with local projects, recent visits, archived set"
```

---

## Task 6: Simplify TemplateGallery (remove side rail)

**Files:**
- Modify: `src/components/create/TemplateGallery.tsx`

TemplateGallery currently renders either `<RecentPanel />` or `<ArchivePanel />` based on `activeTab`. Remove that split — always show the gallery (non-archived projects). The `RecentPanel` and `ArchivePanel` views are accessed via Library now.

- [ ] **Step 1: Remove the side rail and tab logic from TemplateGallery**

Make these changes to `src/components/create/TemplateGallery.tsx`:

1. Remove imports:
   - `import ProjectsSideRail, { type SideRailTab } from './ProjectsSideRail'`
   - `import RecentPanel from './RecentPanel'`
   - `import ArchivePanel from './ArchivePanel'`

2. Remove state:
   - `const [activeTab, setActiveTab] = useState<SideRailTab>('recent')`

3. Remove the `archiveLoading` check from the loading condition in JSX — only check `loading`:
   - Change `{loading || archiveLoading ? (` to `{loading ? (`

4. In the JSX, remove the `<ProjectsSideRail ... />` element and the conditional render block:
   ```tsx
   // Remove this block entirely:
   {activeTab === 'recent'
     ? <RecentPanel />
     : <ArchivePanel archivedSet={archivedSet} allEntries={allEntries} />
   }
   ```

5. The `filtered` entries (which already exclude archived via `visibleEntries`) are what the gallery renders — no change needed to the grid logic.

The `useArchivedRepos` import and usage (`visibleEntries` filtering) stays — the gallery should still hide archived projects.

- [ ] **Step 2: Check if RecentPanel and ArchivePanel have other consumers**

```bash
cd D:/Coding/Git-Suite && grep -r "RecentPanel\|ArchivePanel" src/ --include="*.ts" --include="*.tsx"
```

If the only matches are the imports you just removed from TemplateGallery, also delete those files:

```bash
rm "D:/Coding/Git-Suite/src/components/create/RecentPanel.tsx"
rm "D:/Coding/Git-Suite/src/components/create/ArchivePanel.tsx"
# Also delete any co-located CSS files if they exist:
rm -f "D:/Coding/Git-Suite/src/components/create/RecentPanel.css"
rm -f "D:/Coding/Git-Suite/src/components/create/ArchivePanel.css"
```

If they are imported elsewhere, leave them and note it.

- [ ] **Step 3: Run TypeScript check**

```bash
cd D:/Coding/Git-Suite && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(create): remove ProjectsSideRail and tab split from TemplateGallery"
```

---

## Task 7: Delete ProjectsSideRail

**Files:**
- Delete: `src/components/create/ProjectsSideRail.tsx`
- Delete: `src/components/create/ProjectsSideRail.css`

- [ ] **Step 1: Confirm no remaining imports**

```bash
cd D:/Coding/Git-Suite && grep -r "ProjectsSideRail" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output (all imports removed in Task 6)

- [ ] **Step 2: Delete the files**

```bash
rm "D:/Coding/Git-Suite/src/components/create/ProjectsSideRail.tsx"
rm "D:/Coding/Git-Suite/src/components/create/ProjectsSideRail.css"
```

- [ ] **Step 3: Run TypeScript check to confirm clean build**

```bash
cd D:/Coding/Git-Suite && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run all tests**

```bash
cd D:/Coding/Git-Suite && npx vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(create): delete ProjectsSideRail component"
```

---

## Done

All tasks complete. The Library sidebar now shows local projects alongside GitHub repos with 6 icon-only filter tabs. The Create view is simplified to a flat gallery.
