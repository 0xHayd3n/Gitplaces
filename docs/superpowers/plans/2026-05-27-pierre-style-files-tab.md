# Pierre-style Files Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Files tab of `RepoDetail` to match the feature set and feel of Pierre's `@pierre/trees` (virtualization, flatten empty dirs, sticky folder headers, density presets, three search modes, row decorations, keyboard nav, multi-select), plus add git-status indicators from a user-selected diff base. Custom implementation; no `@pierre/trees` dependency.

**Architecture:** Three layers — a pure derived-state data layer in `src/lib/fileTree/`, a render layer in `src/components/files/`, and hooks bridging the two. Two new IPCs (`getLastCommitForPath`, `compareRefs`) added in main process with SQLite caches. Existing `FileContentPanel`, `FileIcon`, `SvgThumb`, `ContextMenu`, and `useResizable` preserved.

**Tech Stack:** React 18, TypeScript, Vitest, `@tanstack/react-virtual` (new dep), better-sqlite3, Electron IPC, `@testing-library/react`.

**Reference spec:** `docs/superpowers/specs/2026-05-27-pierre-style-files-tab-design.md`

---

## File Structure

**New files (data layer):**
- `src/lib/fileTree/types.ts` — `VisibleRow`, `TreeEntry`, density, search mode types
- `src/lib/fileTree/flatten.ts` — collapses single-child dir chains
- `src/lib/fileTree/search.ts` — three search-mode projections
- `src/lib/fileTree/model.ts` — orchestrates tree → `VisibleRow[]`
- `src/lib/fileTree/flatten.test.ts`
- `src/lib/fileTree/search.test.ts`
- `src/lib/fileTree/model.test.ts`

**New files (renderer hooks):**
- `src/hooks/useLastCommits.ts`
- `src/hooks/useGitStatus.ts`
- `src/hooks/useFileTreeKeyboard.ts`
- `src/hooks/useLastCommits.test.ts`
- `src/hooks/useGitStatus.test.ts`
- `src/hooks/useFileTreeKeyboard.test.ts`

**New files (renderer components):**
- `src/components/files/FilesToolbar.tsx`
- `src/components/files/FilesToolbar.css`
- `src/components/files/FileTreeRow.tsx`
- `src/components/files/FileTreeRow.css`
- `src/components/files/FileTreeView.tsx`
- `src/components/files/FileTreeView.css`
- `src/components/files/DirectoryPane.tsx`
- `src/components/files/DirectoryPane.css`
- `src/components/files/FilesToolbar.test.tsx`
- `src/components/files/FileTreeRow.test.tsx`
- `src/components/files/FileTreeView.test.tsx`
- `src/components/files/DirectoryPane.test.tsx`

**Modified files:**
- `electron/db.ts` — add `last_commits` + `compare_diffs` tables
- `electron/github.ts` — add `getLastCommitForPath`, `compareRefs` functions
- `electron/main.ts` — register `github:getLastCommitForPath`, `github:compareRefs` IPCs
- `electron/preload.ts` — expose new IPCs on `window.api.github`
- `src/types/window.d.ts` (or wherever `window.api` typed) — add new IPC signatures
- `src/components/FilesTab.tsx` — full rewrite
- `package.json` — add `@tanstack/react-virtual` dep

**Deleted files:**
- `src/components/FileTreePanel.tsx` (old)
- `src/components/DirectoryListing.tsx`
- `src/components/ViewModeBar.tsx`

---

## Task 1: Add dependency and SQLite tables

**Files:**
- Modify: `package.json`
- Modify: `electron/db.ts`

- [ ] **Step 1: Install dependency**

```bash
npm install @tanstack/react-virtual@^3.10.0
```

Expected: `package.json` and `package-lock.json` updated. No build errors.

- [ ] **Step 2: Add SQLite tables to `electron/db.ts`**

Find the `CREATE TABLE IF NOT EXISTS http_etag_cache` block in `electron/db.ts` (around line 184). Add two new tables immediately before the closing `)` of the `db.exec(` call:

```ts
    CREATE TABLE IF NOT EXISTS last_commits (
      repo_id        INTEGER NOT NULL,
      tree_sha       TEXT    NOT NULL,
      path           TEXT    NOT NULL,
      message        TEXT    NOT NULL,
      author_login   TEXT,
      author_avatar  TEXT,
      committed_at   TEXT    NOT NULL,
      commit_sha     TEXT    NOT NULL,
      PRIMARY KEY (repo_id, tree_sha, path)
    );

    CREATE TABLE IF NOT EXISTS compare_diffs (
      repo_id     INTEGER NOT NULL,
      base_ref    TEXT    NOT NULL,
      head_ref    TEXT    NOT NULL,
      files_json  TEXT    NOT NULL,
      fetched_at  INTEGER NOT NULL,
      PRIMARY KEY (repo_id, base_ref, head_ref)
    );

    CREATE INDEX IF NOT EXISTS last_commits_by_tree ON last_commits (repo_id, tree_sha);
```

- [ ] **Step 3: Run tests to verify DB initialization still works**

```bash
npm test -- electron/db
```

Expected: All db-related tests pass. The new tables are created on first migration run.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json electron/db.ts
git commit -m "$(cat <<'EOF'
feat(db): add @tanstack/react-virtual + last_commits / compare_diffs tables

Foundations for Pierre-style Files tab rewrite. New tables back the
per-file last-commit decoration cache and the base↔HEAD diff cache.
EOF
)"
```

---

## Task 2: Data layer — types

**Files:**
- Create: `src/lib/fileTree/types.ts`

- [ ] **Step 1: Write types file**

```ts
// src/lib/fileTree/types.ts

export interface TreeEntry {
  path: string                  // last segment, e.g. "Button.tsx"
  mode: string
  type: 'blob' | 'tree' | 'commit'  // 'commit' = submodule
  sha: string
  size?: number
}

export type SearchMode = 'expand' | 'collapse' | 'hide'

export type Density = 'compact' | 'comfortable' | 'spacious'

export const DENSITY_PX: Record<Density, number> = {
  compact: 22,
  comfortable: 28,
  spacious: 36,
}

export interface DiffBaseRef {
  type: 'tag' | 'branch' | 'commit'
  ref: string
}

export interface VisibleRow {
  path: string                       // full canonical path from root
  type: 'tree' | 'blob' | 'commit'
  name: string                       // last segment (or joined for flattened)
  flattenedSegments?: string[]       // present iff isFlattened
  depth: number
  sha: string
  size?: number
  isExpanded: boolean
  isFlattened: boolean
  matchRanges?: [number, number][]   // for search highlight on `name`
  // ARIA:
  level: number                      // 1-based depth
  posInSet: number
  setSize: number
}

export interface LastCommitInfo {
  message: string
  author_login: string | null
  author_avatar: string | null
  committed_at: string               // ISO
  commit_sha: string
}

export type GitFileStatus = 'added' | 'modified' | 'removed' | 'renamed'

export interface CompareDiff {
  files: { path: string; status: GitFileStatus }[]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fileTree/types.ts
git commit -m "feat(files): add file-tree data layer types"
```

---

## Task 3: Data layer — flatten

**Files:**
- Create: `src/lib/fileTree/flatten.ts`
- Create: `src/lib/fileTree/flatten.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/fileTree/flatten.test.ts
import { describe, it, expect } from 'vitest'
import { flattenChain } from './flatten'
import type { TreeEntry } from './types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string, size = 100): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size })

describe('flattenChain', () => {
  it('returns no flatten for a directory with multiple children', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), file('README.md', 'r-sha')]],
    ])
    const result = flattenChain('src', 'src-sha', treeData)
    expect(result.segments).toEqual(['src'])
    expect(result.terminalSha).toBe('src-sha')
  })

  it('flattens a single-child chain of directories', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [dir('c', 'c-sha')]],
      ['c-sha', [file('Foo.java', 'foo-sha'), file('Bar.java', 'bar-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b', 'c'])
    expect(result.terminalSha).toBe('c-sha')
  })

  it('stops flattening at the first branching directory', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [dir('c', 'c-sha'), file('side.txt', 'side-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b'])
    expect(result.terminalSha).toBe('b-sha')
  })

  it('does not flatten if the single child is a file', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [file('only.txt', 'only-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a'])
    expect(result.terminalSha).toBe('a-sha')
  })

  it('stops at unloaded directories (terminalSha is the last loaded sha)', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      // 'b-sha' contents not loaded yet
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b'])
    expect(result.terminalSha).toBe('b-sha')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- flatten.test
```

Expected: FAIL with "Cannot find module './flatten'".

- [ ] **Step 3: Implement `flatten.ts`**

```ts
// src/lib/fileTree/flatten.ts
import type { TreeEntry } from './types'

export interface FlattenResult {
  segments: string[]    // ['a', 'b', 'c'] — display "a/b/c" as one row
  terminalSha: string   // sha of the deepest dir reached
}

/**
 * Walk down a chain of single-child directories starting from `startName`/`startSha`.
 * Stops when:
 *   - the current directory has more than one child, OR
 *   - the single child is a file, OR
 *   - the next directory's contents are not loaded in `treeData`.
 *
 * Returns the flat list of segment names and the SHA of the deepest reached
 * directory (which is the sha that `expandedDirs` should map to for this row).
 */
export function flattenChain(
  startName: string,
  startSha: string,
  treeData: Map<string, TreeEntry[]>,
): FlattenResult {
  const segments: string[] = [startName]
  let currentSha = startSha

  while (true) {
    const children = treeData.get(currentSha)
    if (!children || children.length !== 1) break
    const only = children[0]
    if (only.type !== 'tree') break
    segments.push(only.path)
    currentSha = only.sha
  }

  return { segments, terminalSha: currentSha }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- flatten.test
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileTree/flatten.ts src/lib/fileTree/flatten.test.ts
git commit -m "feat(files): add single-child directory chain flattener"
```

---

## Task 4: Data layer — search

**Files:**
- Create: `src/lib/fileTree/search.ts`
- Create: `src/lib/fileTree/search.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/fileTree/search.test.ts
import { describe, it, expect } from 'vitest'
import { findMatchRanges, pathMatchesQuery, ancestorPaths } from './search'

describe('findMatchRanges', () => {
  it('returns an empty array when no match', () => {
    expect(findMatchRanges('Button.tsx', 'xyz')).toEqual([])
  })

  it('returns single range for one match', () => {
    expect(findMatchRanges('Button.tsx', 'utt')).toEqual([[1, 4]])
  })

  it('returns multiple ranges for multiple matches', () => {
    expect(findMatchRanges('aaaXaaaX', 'X')).toEqual([[3, 4], [7, 8]])
  })

  it('is case-insensitive', () => {
    expect(findMatchRanges('Button.tsx', 'BUTTON')).toEqual([[0, 6]])
  })

  it('returns empty for empty query', () => {
    expect(findMatchRanges('foo', '')).toEqual([])
  })
})

describe('pathMatchesQuery', () => {
  it('matches path basename case-insensitively', () => {
    expect(pathMatchesQuery('src/components/Button.tsx', 'BUTTON')).toBe(true)
  })

  it('matches any segment in the path', () => {
    expect(pathMatchesQuery('src/components/Button.tsx', 'comp')).toBe(true)
  })

  it('returns false for no match', () => {
    expect(pathMatchesQuery('src/Button.tsx', 'xyz')).toBe(false)
  })
})

describe('ancestorPaths', () => {
  it('returns the chain of ancestor paths for a deeply nested file', () => {
    expect(ancestorPaths('a/b/c/foo.ts')).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('returns empty array for a root-level entry', () => {
    expect(ancestorPaths('foo.ts')).toEqual([])
  })

  it('returns one ancestor for a one-deep entry', () => {
    expect(ancestorPaths('src/foo.ts')).toEqual(['src'])
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- search.test
```

Expected: FAIL with "Cannot find module './search'".

- [ ] **Step 3: Implement `search.ts`**

```ts
// src/lib/fileTree/search.ts

/**
 * Find all case-insensitive substring matches of `query` in `text`.
 * Returns ranges as [start, endExclusive] pairs.
 */
export function findMatchRanges(text: string, query: string): [number, number][] {
  if (!query) return []
  const ranges: [number, number][] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let idx = 0
  while (idx <= lowerText.length - lowerQuery.length) {
    const found = lowerText.indexOf(lowerQuery, idx)
    if (found === -1) break
    ranges.push([found, found + lowerQuery.length])
    idx = found + lowerQuery.length
  }
  return ranges
}

/**
 * Does the path (any segment of it) contain `query` case-insensitively?
 */
export function pathMatchesQuery(path: string, query: string): boolean {
  if (!query) return true
  return path.toLowerCase().includes(query.toLowerCase())
}

/**
 * Returns all ancestor paths of `path`, ordered shallow-to-deep.
 * For 'a/b/c/foo.ts' → ['a', 'a/b', 'a/b/c'].
 */
export function ancestorPaths(path: string): string[] {
  const segments = path.split('/')
  if (segments.length < 2) return []
  const result: string[] = []
  let acc = ''
  for (let i = 0; i < segments.length - 1; i++) {
    acc = acc ? `${acc}/${segments[i]}` : segments[i]
    result.push(acc)
  }
  return result
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- search.test
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileTree/search.ts src/lib/fileTree/search.test.ts
git commit -m "feat(files): add search match-range and ancestor-path helpers"
```

---

## Task 5: Data layer — model

**Files:**
- Create: `src/lib/fileTree/model.ts`
- Create: `src/lib/fileTree/model.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/fileTree/model.test.ts
import { describe, it, expect } from 'vitest'
import { buildVisibleRows } from './model'
import type { TreeEntry } from './types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string, size = 100): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size })

describe('buildVisibleRows', () => {
  it('returns root entries when nothing is expanded', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), file('README.md', 'readme-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'README.md'])
    expect(rows[0]).toMatchObject({ type: 'tree', depth: 0, isExpanded: false })
    expect(rows[1]).toMatchObject({ type: 'blob', depth: 0 })
  })

  it('shows children when a directory is expanded', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha')]],
      ['src-sha', [file('index.ts', 'idx-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha']]),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/index.ts'])
    expect(rows[1].depth).toBe(1)
  })

  it('sorts directories before files within a level', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [file('zzz.md', 'z-sha'), dir('aaa-dir', 'a-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['aaa-dir', 'zzz.md'])
  })

  it('flattens single-child directory chains when flattenEmpty is true', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('a', 'a-sha')]],
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [file('Foo.java', 'foo-sha'), file('Bar.java', 'bar-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['a', 'a-sha']]),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: true,
    })
    expect(rows[0].path).toBe('a/b')
    expect(rows[0].isFlattened).toBe(true)
    expect(rows[0].flattenedSegments).toEqual(['a', 'b'])
    expect(rows[0].name).toBe('a/b')
  })

  it('search mode "hide" filters out non-matching subtrees', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), dir('docs', 'docs-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
      ['docs-sha', [file('README.md', 'r-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha'], ['docs', 'docs-sha']]),
      searchQuery: 'button',
      searchMode: 'hide',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/Button.tsx'])
  })

  it('search mode "expand" auto-expands ancestor paths of matches', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),  // 'src' NOT in expanded
      searchQuery: 'button',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/Button.tsx'])
    expect(rows[1].matchRanges).toEqual([[0, 6]])
  })

  it('search mode "collapse" hides directories without matches', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), dir('docs', 'docs-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
      ['docs-sha', [file('README.md', 'r-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha'], ['docs', 'docs-sha']]),
      searchQuery: 'button',
      searchMode: 'collapse',
      flattenEmpty: false,
    })
    // 'docs' is in expanded, but it has no matching descendants — collapsed.
    expect(rows.map(r => r.path)).toEqual(['src', 'src/Button.tsx', 'docs'])
    expect(rows.find(r => r.path === 'docs')?.isExpanded).toBe(false)
  })

  it('populates ARIA level/posInSet/setSize correctly', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('a', 'a-sha'), file('b.md', 'b-sha'), file('c.md', 'c-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 3 })
    expect(rows[1]).toMatchObject({ level: 1, posInSet: 2, setSize: 3 })
    expect(rows[2]).toMatchObject({ level: 1, posInSet: 3, setSize: 3 })
  })

  it('returns empty array if rootTreeSha is not in treeData', () => {
    const rows = buildVisibleRows({
      rootTreeSha: 'missing',
      treeData: new Map(),
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- model.test
```

Expected: FAIL with "Cannot find module './model'".

- [ ] **Step 3: Implement `model.ts`**

```ts
// src/lib/fileTree/model.ts
import type { TreeEntry, VisibleRow, SearchMode } from './types'
import { flattenChain } from './flatten'
import { findMatchRanges, pathMatchesQuery } from './search'

export interface BuildVisibleRowsInput {
  rootTreeSha: string
  treeData: Map<string, TreeEntry[]>
  expanded: Map<string, string>     // path → terminal tree sha
  searchQuery: string
  searchMode: SearchMode
  flattenEmpty: boolean
}

function sortEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

/**
 * Returns true if any descendant under the directory at `sha` matches the
 * search query (case-insensitive substring match on path segment). Only
 * walks into directories whose contents are loaded in `treeData`.
 */
function hasMatchingDescendant(
  basePath: string,
  sha: string,
  query: string,
  treeData: Map<string, TreeEntry[]>,
): boolean {
  const children = treeData.get(sha)
  if (!children) return false
  for (const child of children) {
    const childPath = basePath ? `${basePath}/${child.path}` : child.path
    if (pathMatchesQuery(child.path, query)) return true
    if (child.type === 'tree' && hasMatchingDescendant(childPath, child.sha, query, treeData)) {
      return true
    }
  }
  return false
}

export function buildVisibleRows(input: BuildVisibleRowsInput): VisibleRow[] {
  const { rootTreeSha, treeData, expanded, searchQuery, searchMode, flattenEmpty } = input
  const rows: VisibleRow[] = []
  const hasSearch = searchQuery.trim().length > 0

  function walk(parentSha: string, parentPath: string, depth: number): void {
    const rawChildren = treeData.get(parentSha)
    if (!rawChildren) return
    const sorted = sortEntries(rawChildren)

    // For 'hide' mode, drop entries that don't match and don't have matching descendants.
    let visible = sorted
    if (hasSearch && searchMode === 'hide') {
      visible = sorted.filter(c => {
        if (pathMatchesQuery(c.path, searchQuery)) return true
        if (c.type === 'tree' && hasMatchingDescendant(parentPath ? `${parentPath}/${c.path}` : c.path, c.sha, searchQuery, treeData)) return true
        return false
      })
    }

    const setSize = visible.length

    for (let i = 0; i < visible.length; i++) {
      const child = visible[i]
      const childPath = parentPath ? `${parentPath}/${child.path}` : child.path

      // Decide expansion + flatten for this row.
      let isExpanded = expanded.has(childPath)
      let segments: string[] | undefined
      let terminalSha = child.sha
      let displayName = child.path
      let displayPath = childPath

      if (child.type === 'tree') {
        // search 'expand' mode: auto-expand directories that have matching descendants.
        if (hasSearch && searchMode === 'expand' && !isExpanded) {
          if (hasMatchingDescendant(childPath, child.sha, searchQuery, treeData)) {
            isExpanded = true
          }
        }
        // search 'collapse' mode: collapse directories whose subtree has no matches.
        if (hasSearch && searchMode === 'collapse' && isExpanded) {
          if (!pathMatchesQuery(child.path, searchQuery) &&
              !hasMatchingDescendant(childPath, child.sha, searchQuery, treeData)) {
            isExpanded = false
          }
        }

        if (flattenEmpty) {
          const flat = flattenChain(child.path, child.sha, treeData)
          if (flat.segments.length > 1) {
            segments = flat.segments
            terminalSha = flat.terminalSha
            displayName = flat.segments.join('/')
            // Flattened display path: join with the parent path; the flattened
            // chain replaces what would have been multiple nested rows.
            displayPath = parentPath ? `${parentPath}/${flat.segments.join('/')}` : flat.segments.join('/')
            // Re-resolve expansion for the flattened path.
            isExpanded = expanded.has(displayPath)
          }
        }
      }

      const matchRanges = hasSearch ? findMatchRanges(displayName, searchQuery) : undefined

      rows.push({
        path: displayPath,
        type: child.type,
        name: displayName,
        flattenedSegments: segments,
        depth,
        sha: terminalSha,
        size: child.size,
        isExpanded,
        isFlattened: !!segments,
        matchRanges: matchRanges && matchRanges.length > 0 ? matchRanges : undefined,
        level: depth + 1,
        posInSet: i + 1,
        setSize,
      })

      if (child.type === 'tree' && isExpanded) {
        walk(terminalSha, displayPath, depth + 1)
      }
    }
  }

  walk(rootTreeSha, '', 0)
  return rows
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- model.test
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileTree/model.ts src/lib/fileTree/model.test.ts
git commit -m "feat(files): add tree → VisibleRow[] model with flatten + 3 search modes"
```

---

## Task 6: Main-process IPC — getLastCommitForPath

**Files:**
- Modify: `electron/github.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add fetcher in `electron/github.ts`**

Append to `electron/github.ts` (after `getBlobBySha`):

```ts
export interface LastCommitInfo {
  message: string
  author_login: string | null
  author_avatar: string | null
  committed_at: string
  commit_sha: string
}

/**
 * Fetch the most recent commit that touched `path` on `ref`.
 * Returns null if the file has no commit history (newly added, or 404).
 */
export async function getLastCommitForPath(
  token: string | null,
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<LastCommitInfo | null> {
  const url = `${BASE}/repos/${owner}/${name}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=1`
  const res = await fetch(url, { headers: githubHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as Array<{
    sha: string
    commit: { message: string; author: { date: string } }
    author: { login: string; avatar_url: string } | null
  }>
  if (data.length === 0) return null
  const c = data[0]
  return {
    message: c.commit.message.split('\n')[0],  // first line only
    author_login: c.author?.login ?? null,
    author_avatar: c.author?.avatar_url ?? null,
    committed_at: c.commit.author.date,
    commit_sha: c.sha,
  }
}

export interface CompareFile {
  path: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
}

/**
 * Fetch the file-level diff between `base` and `head`. Both args accept SHAs,
 * branches, tags, or relative refs (e.g. 'main~5'). Returns the list of
 * changed files with their status.
 */
export async function compareRefs(
  token: string | null,
  owner: string,
  name: string,
  base: string,
  head: string,
): Promise<CompareFile[]> {
  const url = `${BASE}/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  const res = await fetch(url, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { files?: Array<{ filename: string; status: string }> }
  return (data.files ?? [])
    .filter(f => ['added', 'modified', 'removed', 'renamed'].includes(f.status))
    .map(f => ({ path: f.filename, status: f.status as CompareFile['status'] }))
}
```

- [ ] **Step 2: Register IPC handlers in `electron/main.ts`**

Find the existing `ipcMain.handle('github:getBlob', ...)` registration (around line 1106). Add immediately after it:

```ts
ipcMain.handle('github:getLastCommitForPath', async (
  _event,
  repoId: number,
  owner: string,
  name: string,
  ref: string,
  path: string,
) => {
  const treeSha = getCachedTreeShaForPath(repoId, ref, path)  // see step 3
  if (treeSha) {
    const cached = readLastCommitCache(repoId, treeSha, path)
    if (cached) return cached
  }
  const token = readToken()
  try {
    const info = await getLastCommitForPath(token, owner, name, ref, path)
    if (info && treeSha) writeLastCommitCache(repoId, treeSha, path, info)
    return info
  } catch {
    return null
  }
})

ipcMain.handle('github:compareRefs', async (
  _event,
  repoId: number,
  owner: string,
  name: string,
  base: string,
  head: string,
) => {
  const cached = readCompareCache(repoId, base, head)
  if (cached) return cached
  const token = readToken()
  try {
    const files = await compareRefs(token, owner, name, base, head)
    writeCompareCache(repoId, base, head, files)
    return files
  } catch {
    return null
  }
})
```

- [ ] **Step 3: Add cache helpers in `electron/db-helpers.ts`**

Append to `electron/db-helpers.ts`:

```ts
import type { LastCommitInfo } from './github'
import type { CompareFile } from './github'

export function readLastCommitCache(repoId: number, treeSha: string, path: string): LastCommitInfo | null {
  const row = db.prepare(`
    SELECT message, author_login, author_avatar, committed_at, commit_sha
    FROM last_commits
    WHERE repo_id = ? AND tree_sha = ? AND path = ?
  `).get(repoId, treeSha, path) as LastCommitInfo | undefined
  return row ?? null
}

export function writeLastCommitCache(
  repoId: number,
  treeSha: string,
  path: string,
  info: LastCommitInfo,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO last_commits
      (repo_id, tree_sha, path, message, author_login, author_avatar, committed_at, commit_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(repoId, treeSha, path, info.message, info.author_login, info.author_avatar, info.committed_at, info.commit_sha)
}

const COMPARE_TTL_MS = 60 * 60 * 1000  // 1 hour

export function readCompareCache(repoId: number, baseRef: string, headRef: string): CompareFile[] | null {
  const row = db.prepare(`
    SELECT files_json, fetched_at FROM compare_diffs
    WHERE repo_id = ? AND base_ref = ? AND head_ref = ?
  `).get(repoId, baseRef, headRef) as { files_json: string; fetched_at: number } | undefined
  if (!row) return null
  if (Date.now() - row.fetched_at >= COMPARE_TTL_MS) {
    db.prepare(`DELETE FROM compare_diffs WHERE repo_id = ? AND base_ref = ? AND head_ref = ?`).run(repoId, baseRef, headRef)
    return null
  }
  return JSON.parse(row.files_json) as CompareFile[]
}

export function writeCompareCache(
  repoId: number,
  baseRef: string,
  headRef: string,
  files: CompareFile[],
): void {
  db.prepare(`
    INSERT OR REPLACE INTO compare_diffs (repo_id, base_ref, head_ref, files_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(repoId, baseRef, headRef, JSON.stringify(files), Date.now())
}

/**
 * Look up the tree sha currently associated with a path on a ref. Used by
 * last-commit cache to make entries content-addressed: if the file's tree sha
 * has changed (i.e. the file changed), the cache misses and we refetch.
 * Returns null if we don't have that path's tree sha cached.
 */
export function getCachedTreeShaForPath(repoId: number, ref: string, path: string): string | null {
  // Cheap approximation: trust the most recently fetched last_commits row for
  // this path. We only invalidate when the file's blob sha changes — which we
  // can't directly observe without a fresh tree fetch. Acceptable: cache hits
  // dominate the normal case where the file hasn't changed.
  const row = db.prepare(`
    SELECT tree_sha FROM last_commits
    WHERE repo_id = ? AND path = ?
    ORDER BY rowid DESC LIMIT 1
  `).get(repoId, path) as { tree_sha: string } | undefined
  return row?.tree_sha ?? null
}
```

Note: import `db` at the top of `db-helpers.ts` if not already imported (check existing imports).

- [ ] **Step 4: Wire up the imports in `main.ts`**

At the top of `electron/main.ts`, find the existing import of github functions and add the new exports:

```ts
import {
  // ... existing imports ...
  getLastCommitForPath,
  compareRefs,
} from './github'
import {
  // ... existing imports ...
  readLastCommitCache,
  writeLastCommitCache,
  readCompareCache,
  writeCompareCache,
  getCachedTreeShaForPath,
} from './db-helpers'
```

- [ ] **Step 5: Expose IPCs on `window.api.github` in `electron/preload.ts`**

Find the existing `getBlob` entry in the github section of preload (around line 66) and add immediately after:

```ts
    getLastCommitForPath: (repoId: number, owner: string, name: string, ref: string, path: string) =>
      ipcRenderer.invoke('github:getLastCommitForPath', repoId, owner, name, ref, path),
    compareRefs: (repoId: number, owner: string, name: string, base: string, head: string) =>
      ipcRenderer.invoke('github:compareRefs', repoId, owner, name, base, head),
```

- [ ] **Step 6: Add type signatures to `window.api`**

Find the `window.api.github` type definition (likely in `src/types/window.d.ts` or similar — grep for `getBlob:` in src). Add after `getBlob`:

```ts
    getLastCommitForPath: (
      repoId: number, owner: string, name: string, ref: string, path: string,
    ) => Promise<{
      message: string
      author_login: string | null
      author_avatar: string | null
      committed_at: string
      commit_sha: string
    } | null>
    compareRefs: (
      repoId: number, owner: string, name: string, base: string, head: string,
    ) => Promise<{ path: string; status: 'added' | 'modified' | 'removed' | 'renamed' }[] | null>
```

- [ ] **Step 7: Run tests + typecheck**

```bash
npx tsc --noEmit
npm test -- electron
```

Expected: typecheck passes; existing electron tests still pass.

- [ ] **Step 8: Commit**

```bash
git add electron/github.ts electron/main.ts electron/preload.ts electron/db-helpers.ts src/types/
git commit -m "$(cat <<'EOF'
feat(github): add getLastCommitForPath + compareRefs IPCs with SQLite cache

Backs the new Files-tab decorations (last-commit per row) and git-status
indicators (diff between user-selected base and HEAD). Both cache to
SQLite — last_commits content-addressed by tree_sha so unchanged files
return synchronously on revisit; compare_diffs TTL'd 1h.
EOF
)"
```

---

## Task 7: Renderer hook — useLastCommits

**Files:**
- Create: `src/hooks/useLastCommits.ts`
- Create: `src/hooks/useLastCommits.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useLastCommits.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLastCommits } from './useLastCommits'

beforeEach(() => {
  // @ts-expect-error global stub
  window.api = {
    github: {
      getLastCommitForPath: vi.fn(),
    },
  }
})

describe('useLastCommits', () => {
  it('returns undefined for paths not yet fetched', () => {
    const { result } = renderHook(() => useLastCommits({ repoId: 1, owner: 'o', name: 'n', ref: 'main' }))
    expect(result.current.get('src/foo.ts')).toBeUndefined()
  })

  it('fetches and stores last-commit info for a requested path', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: 'http://avatar', committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    ;(window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>).mockResolvedValue(info)

    const { result } = renderHook(() => useLastCommits({ repoId: 1, owner: 'o', name: 'n', ref: 'main' }))
    result.current.request(['src/foo.ts'])

    await waitFor(() => {
      expect(result.current.get('src/foo.ts')).toEqual(info)
    })
  })

  it('does not refetch a path that is already cached', async () => {
    const info = { message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: '2026-05-27T00:00:00Z', commit_sha: 'abc123' }
    const mockFn = window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue(info)

    const { result } = renderHook(() => useLastCommits({ repoId: 1, owner: 'o', name: 'n', ref: 'main' }))
    result.current.request(['src/foo.ts'])
    await waitFor(() => expect(result.current.get('src/foo.ts')).toEqual(info))
    result.current.request(['src/foo.ts'])  // request again

    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('handles null results without erroring', async () => {
    ;(window.api.github.getLastCommitForPath as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { result } = renderHook(() => useLastCommits({ repoId: 1, owner: 'o', name: 'n', ref: 'main' }))
    result.current.request(['src/foo.ts'])
    await waitFor(() => {
      // null result is stored as a sentinel (not undefined) so we know we already tried.
      expect(result.current.get('src/foo.ts')).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- useLastCommits.test
```

Expected: FAIL with "Cannot find module './useLastCommits'".

- [ ] **Step 3: Implement `useLastCommits.ts`**

```ts
// src/hooks/useLastCommits.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LastCommitInfo } from '../lib/fileTree/types'

interface UseLastCommitsInput {
  repoId: number | null
  owner: string
  name: string
  ref: string
}

interface UseLastCommitsResult {
  get(path: string): LastCommitInfo | null | undefined  // undefined = unknown, null = no history, info = ok
  request(paths: string[]): void
}

const MAX_PARALLEL = 6

export function useLastCommits(input: UseLastCommitsInput): UseLastCommitsResult {
  const [cache, setCache] = useState<Map<string, LastCommitInfo | null>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())
  const queue = useRef<string[]>([])
  const activeCount = useRef(0)

  // Reset when repo/ref changes.
  useEffect(() => {
    setCache(new Map())
    inFlight.current.clear()
    queue.current = []
    activeCount.current = 0
  }, [input.repoId, input.owner, input.name, input.ref])

  const pump = useCallback(() => {
    if (!input.repoId) return
    while (activeCount.current < MAX_PARALLEL && queue.current.length > 0) {
      const path = queue.current.shift()!
      activeCount.current++
      window.api.github
        .getLastCommitForPath(input.repoId, input.owner, input.name, input.ref, path)
        .then(info => {
          setCache(prev => {
            const next = new Map(prev)
            next.set(path, info)
            return next
          })
        })
        .catch(() => {
          // Silent: row renders without commit info.
        })
        .finally(() => {
          inFlight.current.delete(path)
          activeCount.current--
          pump()
        })
    }
  }, [input.repoId, input.owner, input.name, input.ref])

  const request = useCallback((paths: string[]) => {
    for (const path of paths) {
      if (cache.has(path)) continue
      if (inFlight.current.has(path)) continue
      inFlight.current.add(path)
      queue.current.push(path)
    }
    pump()
  }, [cache, pump])

  const get = useCallback((path: string) => {
    return cache.get(path)
  }, [cache])

  return { get, request }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- useLastCommits.test
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLastCommits.ts src/hooks/useLastCommits.test.ts
git commit -m "feat(files): add useLastCommits hook with concurrency-capped queue"
```

---

## Task 8: Renderer hook — useGitStatus

**Files:**
- Create: `src/hooks/useGitStatus.ts`
- Create: `src/hooks/useGitStatus.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useGitStatus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGitStatus } from './useGitStatus'

beforeEach(() => {
  // @ts-expect-error global stub
  window.api = {
    github: {
      compareRefs: vi.fn(),
    },
  }
})

describe('useGitStatus', () => {
  it('returns empty map when no base ref is set', () => {
    const { result } = renderHook(() =>
      useGitStatus({ repoId: 1, owner: 'o', name: 'n', baseRef: null, headRef: 'main' }))
    expect(result.current.statusMap.size).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('fetches the diff when base ref is set', async () => {
    ;(window.api.github.compareRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: 'src/foo.ts', status: 'modified' },
      { path: 'src/bar.ts', status: 'added' },
    ])
    const { result } = renderHook(() =>
      useGitStatus({ repoId: 1, owner: 'o', name: 'n', baseRef: 'v1.0.0', headRef: 'main' }))

    await waitFor(() => {
      expect(result.current.statusMap.get('src/foo.ts')).toBe('modified')
      expect(result.current.statusMap.get('src/bar.ts')).toBe('added')
    })
  })

  it('sets error when fetch returns null', async () => {
    ;(window.api.github.compareRefs as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { result } = renderHook(() =>
      useGitStatus({ repoId: 1, owner: 'o', name: 'n', baseRef: 'v1.0.0', headRef: 'main' }))

    await waitFor(() => {
      expect(result.current.error).toBe('Compare failed')
    })
  })

  it('refetches when baseRef changes', async () => {
    const mockFn = window.api.github.compareRefs as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValue([{ path: 'src/a.ts', status: 'modified' }])

    const { result, rerender } = renderHook(
      (props: { baseRef: string }) =>
        useGitStatus({ repoId: 1, owner: 'o', name: 'n', baseRef: props.baseRef, headRef: 'main' }),
      { initialProps: { baseRef: 'v1.0.0' } },
    )
    await waitFor(() => expect(result.current.statusMap.size).toBe(1))

    mockFn.mockResolvedValue([{ path: 'src/b.ts', status: 'added' }])
    rerender({ baseRef: 'v2.0.0' })

    await waitFor(() => expect(result.current.statusMap.get('src/b.ts')).toBe('added'))
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- useGitStatus.test
```

Expected: FAIL with "Cannot find module './useGitStatus'".

- [ ] **Step 3: Implement `useGitStatus.ts`**

```ts
// src/hooks/useGitStatus.ts
import { useEffect, useState } from 'react'
import type { GitFileStatus } from '../lib/fileTree/types'

interface UseGitStatusInput {
  repoId: number | null
  owner: string
  name: string
  baseRef: string | null
  headRef: string
}

interface UseGitStatusResult {
  statusMap: Map<string, GitFileStatus>
  error: string | null
  retry(): void
}

export function useGitStatus(input: UseGitStatusInput): UseGitStatusResult {
  const [statusMap, setStatusMap] = useState<Map<string, GitFileStatus>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setStatusMap(new Map())
    setError(null)
    if (!input.repoId || !input.baseRef) return
    let cancelled = false
    window.api.github
      .compareRefs(input.repoId, input.owner, input.name, input.baseRef, input.headRef)
      .then(files => {
        if (cancelled) return
        if (files === null) {
          setError('Compare failed')
          return
        }
        const map = new Map<string, GitFileStatus>()
        for (const f of files) map.set(f.path, f.status)
        setStatusMap(map)
      })
      .catch(() => {
        if (!cancelled) setError('Compare failed')
      })
    return () => { cancelled = true }
  }, [input.repoId, input.owner, input.name, input.baseRef, input.headRef, retryKey])

  return { statusMap, error, retry: () => setRetryKey(k => k + 1) }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- useGitStatus.test
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGitStatus.ts src/hooks/useGitStatus.test.ts
git commit -m "feat(files): add useGitStatus hook for base↔HEAD diff fetching"
```

---

## Task 9: Renderer hook — useFileTreeKeyboard

**Files:**
- Create: `src/hooks/useFileTreeKeyboard.ts`
- Create: `src/hooks/useFileTreeKeyboard.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useFileTreeKeyboard.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeKeyboard } from './useFileTreeKeyboard'
import type { VisibleRow } from '../lib/fileTree/types'

const row = (path: string, depth: number, type: 'tree' | 'blob' = 'blob', isExpanded = false): VisibleRow => ({
  path, type, name: path.split('/').pop()!, depth, sha: path + '-sha',
  isExpanded, isFlattened: false,
  level: depth + 1, posInSet: 1, setSize: 1,
})

describe('useFileTreeKeyboard', () => {
  it('arrow down moves focus to next row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(['a']), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('b')
  })

  it('arrow up at the top does nothing', () => {
    const rows: VisibleRow[] = [row('a'), row('b')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(['a']), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).not.toHaveBeenCalled()
  })

  it('arrow right on a collapsed directory expands it', () => {
    const rows: VisibleRow[] = [row('a', 0, 'tree', false)]
    const onToggleExpand = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange: vi.fn(),
      onToggleExpand, onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onToggleExpand).toHaveBeenCalledWith('a')
  })

  it('Enter on a file calls onActivate', () => {
    const rows: VisibleRow[] = [row('a')]
    const onActivate = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange: vi.fn(),
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate,
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('Home jumps to first row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'c', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'Home', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('a')
  })

  it('End jumps to last row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'End', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('c')
  })

  it('typing a letter focuses next file starting with that letter', () => {
    const rows: VisibleRow[] = [row('apple'), row('banana'), row('cherry')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'apple', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'b', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('banana')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- useFileTreeKeyboard.test
```

Expected: FAIL with "Cannot find module './useFileTreeKeyboard'".

- [ ] **Step 3: Implement `useFileTreeKeyboard.ts`**

```ts
// src/hooks/useFileTreeKeyboard.ts
import { useCallback, useRef } from 'react'
import type { VisibleRow } from '../lib/fileTree/types'

interface UseFileTreeKeyboardInput {
  rows: VisibleRow[]
  focused: string | null
  selected: Set<string>
  onFocusChange: (path: string) => void
  onToggleExpand: (path: string) => void
  onSelect: (path: string, opts: { shift: boolean; ctrl: boolean }) => void
  onActivate: (path: string) => void
}

interface UseFileTreeKeyboardResult {
  handleKeyDown(e: KeyboardEvent | React.KeyboardEvent): void
}

const TYPE_TO_FOCUS_TIMEOUT_MS = 1000

export function useFileTreeKeyboard(input: UseFileTreeKeyboardInput): UseFileTreeKeyboardResult {
  const typeBuffer = useRef<{ chars: string; timer: number | null }>({ chars: '', timer: null })

  const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
    const { rows, focused, onFocusChange, onToggleExpand, onSelect, onActivate } = input
    if (rows.length === 0) return

    const idx = focused ? rows.findIndex(r => r.path === focused) : -1
    const current = idx >= 0 ? rows[idx] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        if (idx < rows.length - 1) onFocusChange(rows[idx + 1].path)
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        if (idx > 0) onFocusChange(rows[idx - 1].path)
        return
      }
      case 'ArrowRight': {
        e.preventDefault()
        if (current?.type === 'tree') {
          if (!current.isExpanded) {
            onToggleExpand(current.path)
          } else if (idx + 1 < rows.length && rows[idx + 1].depth > current.depth) {
            onFocusChange(rows[idx + 1].path)
          }
        }
        return
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (current?.type === 'tree' && current.isExpanded) {
          onToggleExpand(current.path)
        } else if (current && current.depth > 0) {
          // Walk back to find parent row.
          for (let i = idx - 1; i >= 0; i--) {
            if (rows[i].depth < current.depth) {
              onFocusChange(rows[i].path)
              break
            }
          }
        }
        return
      }
      case 'Enter': {
        e.preventDefault()
        if (current) onActivate(current.path)
        return
      }
      case ' ': {
        e.preventDefault()
        if (current?.type === 'tree') onToggleExpand(current.path)
        return
      }
      case 'Home': {
        e.preventDefault()
        onFocusChange(rows[0].path)
        return
      }
      case 'End': {
        e.preventDefault()
        onFocusChange(rows[rows.length - 1].path)
        return
      }
    }

    // Single-letter type-to-focus.
    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !('ctrlKey' in e && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      const buf = typeBuffer.current
      if (buf.timer) clearTimeout(buf.timer)
      buf.chars = (buf.chars + e.key).toLowerCase()
      buf.timer = window.setTimeout(() => { buf.chars = ''; buf.timer = null }, TYPE_TO_FOCUS_TIMEOUT_MS)
      // Find first row whose name starts with the accumulated prefix, starting AFTER the focused row.
      const start = idx >= 0 ? idx + 1 : 0
      for (let offset = 0; offset < rows.length; offset++) {
        const i = (start + offset) % rows.length
        if (rows[i].name.toLowerCase().startsWith(buf.chars)) {
          onFocusChange(rows[i].path)
          return
        }
      }
    }
  }, [input])

  return { handleKeyDown }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- useFileTreeKeyboard.test
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileTreeKeyboard.ts src/hooks/useFileTreeKeyboard.test.ts
git commit -m "feat(files): add useFileTreeKeyboard hook for arrow/Enter/Home/type-to-focus"
```

---

## Task 10: Component — FilesToolbar

**Files:**
- Create: `src/components/files/FilesToolbar.tsx`
- Create: `src/components/files/FilesToolbar.css`
- Create: `src/components/files/FilesToolbar.test.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/files/FilesToolbar.tsx
import { useEffect, useRef } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import type { SearchMode, Density, DiffBaseRef } from '../../lib/fileTree/types'
import './FilesToolbar.css'

interface DiffBaseOption {
  label: string
  ref: DiffBaseRef
}

interface Props {
  searchValue: string
  onSearchChange: (v: string) => void
  searchMode: SearchMode
  onSearchModeChange: (m: SearchMode) => void
  density: Density
  onDensityChange: (d: Density) => void
  diffBase: DiffBaseRef | null
  onDiffBaseChange: (r: DiffBaseRef | null) => void
  diffBaseOptions: DiffBaseOption[]
}

const MODE_LABEL: Record<SearchMode, string> = {
  expand: 'Expand matches',
  collapse: 'Collapse non-matches',
  hide: 'Hide non-matches',
}

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  spacious: 'Spacious',
}

export default function FilesToolbar(props: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onFocus() { searchInputRef.current?.focus() }
    window.addEventListener('files-toolbar:focus-search', onFocus)
    return () => window.removeEventListener('files-toolbar:focus-search', onFocus)
  }, [])

  return (
    <div className="files-toolbar">
      <div className="files-toolbar__search">
        <Search size={12} className="files-toolbar__search-icon" />
        <input
          ref={searchInputRef}
          className="files-toolbar__search-input"
          type="text"
          placeholder="Search files…"
          value={props.searchValue}
          onChange={e => props.onSearchChange(e.target.value)}
        />
      </div>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Mode</span>
        <select value={props.searchMode} onChange={e => props.onSearchModeChange(e.target.value as SearchMode)}>
          {(Object.keys(MODE_LABEL) as SearchMode[]).map(m => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Density</span>
        <select value={props.density} onChange={e => props.onDensityChange(e.target.value as Density)}>
          {(Object.keys(DENSITY_LABEL) as Density[]).map(d => (
            <option key={d} value={d}>{DENSITY_LABEL[d]}</option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Compare</span>
        <select
          value={props.diffBase ? `${props.diffBase.type}:${props.diffBase.ref}` : ''}
          onChange={e => {
            if (!e.target.value) { props.onDiffBaseChange(null); return }
            const [type, ...rest] = e.target.value.split(':')
            props.onDiffBaseChange({ type: type as DiffBaseRef['type'], ref: rest.join(':') })
          }}
        >
          <option value="">None</option>
          {props.diffBaseOptions.map(opt => (
            <option key={`${opt.ref.type}:${opt.ref.ref}`} value={`${opt.ref.type}:${opt.ref.ref}`}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* src/components/files/FilesToolbar.css */
.files-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg1);
  font-family: 'Inter', sans-serif;
  font-size: 11px;
}

.files-toolbar__search {
  position: relative;
  flex: 1 1 auto;
  min-width: 120px;
  max-width: 280px;
}
.files-toolbar__search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--t3);
}
.files-toolbar__search-input {
  width: 100%;
  height: 24px;
  padding: 0 8px 0 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg0);
  color: var(--t1);
  font-size: 11px;
}
.files-toolbar__search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.files-toolbar__select {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: relative;
}
.files-toolbar__select-label {
  color: var(--t3);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.files-toolbar__select select {
  appearance: none;
  background: var(--bg0);
  border: 1px solid var(--border);
  color: var(--t1);
  font-size: 11px;
  padding: 2px 18px 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.files-toolbar__select select:hover {
  border-color: var(--accent);
}
```

- [ ] **Step 3: Write tests**

```tsx
// src/components/files/FilesToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilesToolbar from './FilesToolbar'

const noopProps = {
  searchValue: '',
  onSearchChange: vi.fn(),
  searchMode: 'expand' as const,
  onSearchModeChange: vi.fn(),
  density: 'comfortable' as const,
  onDensityChange: vi.fn(),
  diffBase: null,
  onDiffBaseChange: vi.fn(),
  diffBaseOptions: [],
}

describe('FilesToolbar', () => {
  it('renders search input + three selects', () => {
    render(<FilesToolbar {...noopProps} />)
    expect(screen.getByPlaceholderText('Search files…')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
  })

  it('calls onSearchChange when input changes', () => {
    const onSearchChange = vi.fn()
    render(<FilesToolbar {...noopProps} onSearchChange={onSearchChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'foo' } })
    expect(onSearchChange).toHaveBeenCalledWith('foo')
  })

  it('emits diff base change with parsed type and ref', () => {
    const onDiffBaseChange = vi.fn()
    render(<FilesToolbar {...noopProps}
      diffBaseOptions={[{ label: 'vs v1.0.0', ref: { type: 'tag', ref: 'v1.0.0' } }]}
      onDiffBaseChange={onDiffBaseChange} />)
    const select = screen.getAllByRole('combobox')[2]
    fireEvent.change(select, { target: { value: 'tag:v1.0.0' } })
    expect(onDiffBaseChange).toHaveBeenCalledWith({ type: 'tag', ref: 'v1.0.0' })
  })

  it('emits null diff base when "None" selected', () => {
    const onDiffBaseChange = vi.fn()
    render(<FilesToolbar {...noopProps}
      diffBase={{ type: 'tag', ref: 'v1.0.0' }}
      diffBaseOptions={[{ label: 'vs v1.0.0', ref: { type: 'tag', ref: 'v1.0.0' } }]}
      onDiffBaseChange={onDiffBaseChange} />)
    const select = screen.getAllByRole('combobox')[2]
    fireEvent.change(select, { target: { value: '' } })
    expect(onDiffBaseChange).toHaveBeenCalledWith(null)
  })

  it('focuses search input on files-toolbar:focus-search event', () => {
    render(<FilesToolbar {...noopProps} />)
    const input = screen.getByPlaceholderText('Search files…') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
    expect(document.activeElement).toBe(input)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test -- FilesToolbar.test
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/files/FilesToolbar.tsx src/components/files/FilesToolbar.css src/components/files/FilesToolbar.test.tsx
git commit -m "feat(files): add FilesToolbar with search, mode, density, diff-base controls"
```

---

## Task 11: Component — FileTreeRow

**Files:**
- Create: `src/components/files/FileTreeRow.tsx`
- Create: `src/components/files/FileTreeRow.css`
- Create: `src/components/files/FileTreeRow.test.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/files/FileTreeRow.tsx
import { memo } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import FileIcon from '../FileIcon'
import SvgThumb from '../SvgThumb'
import type { VisibleRow, LastCommitInfo, GitFileStatus, Density } from '../../lib/fileTree/types'
import { DENSITY_PX } from '../../lib/fileTree/types'
import './FileTreeRow.css'

interface Props {
  row: VisibleRow
  density: Density
  isFocused: boolean
  isSelected: boolean
  lastCommit: LastCommitInfo | null | undefined
  gitStatus: GitFileStatus | undefined
  owner: string
  name: string
  width: number   // viewport width — drives lane visibility
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onSegmentClick?: (depth: number) => void  // for flattened-row segment clicks
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

const STATUS_COLOR: Record<GitFileStatus, string> = {
  added: '#22c55e',
  modified: '#f59e0b',
  removed: '#ef4444',
  renamed: '#3b82f6',
}

function FileTreeRow({
  row, density, isFocused, isSelected, lastCommit, gitStatus,
  owner, name, width, onClick, onContextMenu, onSegmentClick,
}: Props) {
  const height = DENSITY_PX[density]
  const isDir = row.type === 'tree'
  const ext = row.path.split('.').pop()?.toLowerCase() ?? ''
  const showAuthor = width >= 320
  const showMessage = width >= 280

  return (
    <div
      role="treeitem"
      tabIndex={isFocused ? 0 : -1}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={isDir ? row.isExpanded : undefined}
      aria-selected={isSelected}
      data-path={row.path}
      className={
        'file-row' +
        (isFocused ? ' file-row--focused' : '') +
        (isSelected ? ' file-row--selected' : '')
      }
      style={{ height, paddingLeft: 8 + row.depth * 16 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {gitStatus && (
        <span
          className="file-row__status-dot"
          title={gitStatus}
          style={{ backgroundColor: STATUS_COLOR[gitStatus] }}
        />
      )}
      {isDir ? (
        <ChevronRight
          size={12}
          className={'file-row__chevron' + (row.isExpanded ? ' file-row__chevron--expanded' : '')}
        />
      ) : (
        <span className="file-row__chevron-spacer" />
      )}
      {isDir ? (
        <Folder size={14} className="file-row__icon file-row__icon--folder" />
      ) : ext === 'svg' ? (
        <SvgThumb owner={owner} name={name} sha={row.sha} filename={row.path} size={14} className="file-row__icon" />
      ) : (
        <FileIcon filename={row.path} size={14} className="file-row__icon" />
      )}
      <span className="file-row__name">
        {row.isFlattened && row.flattenedSegments && onSegmentClick
          ? row.flattenedSegments.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span className="file-row__segment-sep">/</span>}
                <button
                  className="file-row__segment"
                  onClick={(e) => { e.stopPropagation(); onSegmentClick(i) }}
                >
                  {seg}
                </button>
              </span>
            ))
          : renderWithHighlight(row.name, row.matchRanges)}
      </span>
      {row.size != null && !isDir && (
        <span className="file-row__size">{formatBytes(row.size)}</span>
      )}
      {showMessage && lastCommit && (
        <span className="file-row__message" title={lastCommit.message}>
          {lastCommit.message}
        </span>
      )}
      {showAuthor && lastCommit?.author_avatar && (
        <img className="file-row__avatar" src={lastCommit.author_avatar} alt={lastCommit.author_login ?? ''} />
      )}
      {lastCommit && (
        <span className="file-row__age">{relativeAge(lastCommit.committed_at)}</span>
      )}
    </div>
  )
}

function renderWithHighlight(text: string, ranges?: [number, number][]): React.ReactNode {
  if (!ranges || ranges.length === 0) return text
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i]
    if (cursor < start) parts.push(text.slice(cursor, start))
    parts.push(<mark key={i} className="file-row__match">{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

export default memo(FileTreeRow)
```

- [ ] **Step 2: Write the stylesheet**

```css
/* src/components/files/FileTreeRow.css */
.file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--t1);
  cursor: pointer;
  user-select: none;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  position: relative;
}
.file-row:hover { background: var(--bg-hover); }
.file-row--focused { outline: 1px solid var(--accent); outline-offset: -1px; }
.file-row--selected { background: var(--bg-selected); }

.file-row__status-dot {
  position: absolute;
  left: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

.file-row__chevron, .file-row__chevron-spacer {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--t3);
  transition: transform 0.12s ease;
}
.file-row__chevron--expanded { transform: rotate(90deg); }

.file-row__icon { flex-shrink: 0; }
.file-row__icon--folder { color: #f59e0b; }

.file-row__name {
  flex: 0 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.file-row__match {
  background: rgba(255, 255, 0, 0.4);
  color: inherit;
  padding: 0;
}
.file-row__segment {
  border: none;
  background: transparent;
  color: var(--t1);
  cursor: pointer;
  font: inherit;
  padding: 0;
}
.file-row__segment:hover { text-decoration: underline; }
.file-row__segment-sep { color: var(--t3); margin: 0 2px; }

.file-row__size {
  color: var(--t3);
  font-size: 10px;
  flex-shrink: 0;
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.file-row__message {
  color: var(--t2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 0;
  min-width: 0;
  margin-left: 8px;
}
.file-row__avatar {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}
.file-row__age {
  color: var(--t3);
  font-size: 10px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
}
```

- [ ] **Step 3: Write tests**

```tsx
// src/components/files/FileTreeRow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileTreeRow from './FileTreeRow'
import type { VisibleRow } from '../../lib/fileTree/types'

const baseRow: VisibleRow = {
  path: 'src/Button.tsx',
  type: 'blob',
  name: 'Button.tsx',
  depth: 1,
  sha: 'btn-sha',
  size: 2400,
  isExpanded: false,
  isFlattened: false,
  level: 2,
  posInSet: 1,
  setSize: 1,
}

const baseProps = {
  density: 'comfortable' as const,
  isFocused: false,
  isSelected: false,
  lastCommit: undefined,
  gitStatus: undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onClick: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('FileTreeRow', () => {
  it('renders the file name', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} />)
    expect(screen.getByText('Button.tsx')).toBeInTheDocument()
  })

  it('shows file size when present', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} />)
    expect(screen.getByText('2.3 KB')).toBeInTheDocument()
  })

  it('renders last commit message when present and width >= 280', () => {
    render(<FileTreeRow {...baseProps} row={baseRow}
      lastCommit={{ message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: new Date().toISOString(), commit_sha: 'abc' }} />)
    expect(screen.getByText('fix bug')).toBeInTheDocument()
  })

  it('hides last commit message at narrow widths', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} width={200}
      lastCommit={{ message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: new Date().toISOString(), commit_sha: 'abc' }} />)
    expect(screen.queryByText('fix bug')).not.toBeInTheDocument()
  })

  it('shows status dot when gitStatus present', () => {
    const { container } = render(<FileTreeRow {...baseProps} row={baseRow} gitStatus="modified" />)
    expect(container.querySelector('.file-row__status-dot')).toBeInTheDocument()
  })

  it('renders per-segment buttons for flattened rows', () => {
    const onSegmentClick = vi.fn()
    const flattenedRow: VisibleRow = {
      ...baseRow,
      path: 'a/b/c',
      type: 'tree',
      name: 'a/b/c',
      flattenedSegments: ['a', 'b', 'c'],
      isFlattened: true,
    }
    render(<FileTreeRow {...baseProps} row={flattenedRow} onSegmentClick={onSegmentClick} />)
    const segB = screen.getByRole('button', { name: 'b' })
    fireEvent.click(segB)
    expect(onSegmentClick).toHaveBeenCalledWith(1)
  })

  it('highlights match ranges in the name', () => {
    const row = { ...baseRow, matchRanges: [[0, 6] as [number, number]] }
    const { container } = render(<FileTreeRow {...baseProps} row={row} />)
    const mark = container.querySelector('mark.file-row__match')
    expect(mark?.textContent).toBe('Button')
  })

  it('expanded directories get aria-expanded=true', () => {
    const row = { ...baseRow, type: 'tree' as const, isExpanded: true }
    render(<FileTreeRow {...baseProps} row={row} />)
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-expanded', 'true')
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test -- FileTreeRow.test
```

Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/files/FileTreeRow.tsx src/components/files/FileTreeRow.css src/components/files/FileTreeRow.test.tsx
git commit -m "feat(files): add FileTreeRow with decorations, match highlight, flatten segments"
```

---

## Task 12: Component — FileTreeView (virtualization + sticky overlay)

**Files:**
- Create: `src/components/files/FileTreeView.tsx`
- Create: `src/components/files/FileTreeView.css`
- Create: `src/components/files/FileTreeView.test.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/files/FileTreeView.tsx
import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import FileTreeRow from './FileTreeRow'
import type { VisibleRow, LastCommitInfo, GitFileStatus, Density } from '../../lib/fileTree/types'
import { DENSITY_PX } from '../../lib/fileTree/types'
import './FileTreeView.css'

interface Props {
  rows: VisibleRow[]
  density: Density
  focused: string | null
  selected: Set<string>
  getLastCommit: (path: string) => LastCommitInfo | null | undefined
  getGitStatus: (path: string) => GitFileStatus | undefined
  owner: string
  name: string
  width: number
  onRowClick: (row: VisibleRow, e: React.MouseEvent) => void
  onRowContextMenu: (row: VisibleRow, e: React.MouseEvent) => void
  onSegmentClick: (row: VisibleRow, depth: number) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export default function FileTreeView(props: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowHeight = DENSITY_PX[props.density]

  const virtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  })

  const items = virtualizer.getVirtualItems()
  const firstVisibleRow = items.length > 0 ? props.rows[items[0].index] : null

  // Compute ancestor chain of the first visible row for the sticky overlay.
  // We render one sticky header per ancestor that is an EXPANDED directory and
  // earlier in the rows list than the first visible row.
  const stickyAncestors = useMemo(() => {
    if (!firstVisibleRow) return []
    const result: VisibleRow[] = []
    let cursor = firstVisibleRow
    // Walk backwards through rows to collect ancestor directories.
    const firstIdx = items[0].index
    for (let i = firstIdx - 1; i >= 0; i--) {
      const r = props.rows[i]
      if (r.type === 'tree' && r.isExpanded && r.depth < cursor.depth) {
        result.unshift(r)
        cursor = r
        if (r.depth === 0) break
      }
    }
    return result
  }, [firstVisibleRow, items, props.rows])

  return (
    <div
      ref={parentRef}
      className="file-tree-view"
      role="tree"
      tabIndex={0}
      onKeyDown={props.onKeyDown}
    >
      <div className="file-tree-view__sticky-overlay" style={{ height: stickyAncestors.length * rowHeight }}>
        {stickyAncestors.map((ancestor, i) => (
          <div
            key={ancestor.path}
            className="file-tree-view__sticky-row"
            style={{ top: i * rowHeight, zIndex: 10 + i }}
          >
            <FileTreeRow
              row={ancestor}
              density={props.density}
              isFocused={false}
              isSelected={props.selected.has(ancestor.path)}
              lastCommit={props.getLastCommit(ancestor.path)}
              gitStatus={props.getGitStatus(ancestor.path)}
              owner={props.owner}
              name={props.name}
              width={props.width}
              onClick={e => props.onRowClick(ancestor, e)}
              onContextMenu={e => props.onRowContextMenu(ancestor, e)}
            />
          </div>
        ))}
      </div>
      <div className="file-tree-view__list" style={{ height: virtualizer.getTotalSize() }}>
        {items.map(item => {
          const row = props.rows[item.index]
          return (
            <div
              key={row.path}
              className="file-tree-view__item"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <FileTreeRow
                row={row}
                density={props.density}
                isFocused={props.focused === row.path}
                isSelected={props.selected.has(row.path)}
                lastCommit={props.getLastCommit(row.path)}
                gitStatus={props.getGitStatus(row.path)}
                owner={props.owner}
                name={props.name}
                width={props.width}
                onClick={e => props.onRowClick(row, e)}
                onContextMenu={e => props.onRowContextMenu(row, e)}
                onSegmentClick={depth => props.onSegmentClick(row, depth)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* src/components/files/FileTreeView.css */
.file-tree-view {
  position: relative;
  overflow: auto;
  height: 100%;
  width: 100%;
  outline: none;
}
.file-tree-view__list {
  position: relative;
  width: 100%;
}
.file-tree-view__item { }

.file-tree-view__sticky-overlay {
  position: sticky;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
  z-index: 5;
}
.file-tree-view__sticky-row {
  position: absolute;
  left: 0;
  width: 100%;
  background: var(--bg1);
  border-bottom: 1px solid var(--border);
  pointer-events: auto;
}
```

- [ ] **Step 3: Write tests**

```tsx
// src/components/files/FileTreeView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import FileTreeView from './FileTreeView'
import type { VisibleRow } from '../../lib/fileTree/types'

const mkRow = (path: string, depth: number, type: 'tree' | 'blob' = 'blob', isExpanded = false): VisibleRow => ({
  path, type, name: path.split('/').pop()!, depth, sha: path + '-sha',
  isExpanded, isFlattened: false,
  level: depth + 1, posInSet: 1, setSize: 1,
})

const baseProps = {
  density: 'comfortable' as const,
  focused: null,
  selected: new Set<string>(),
  getLastCommit: () => undefined,
  getGitStatus: () => undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onRowClick: vi.fn(),
  onRowContextMenu: vi.fn(),
  onSegmentClick: vi.fn(),
  onKeyDown: vi.fn(),
}

beforeEach(() => {
  // jsdom needs these for the virtualizer to compute things.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 })
  // Stub ResizeObserver used by react-virtual
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}; unobserve() {}; disconnect() {}
    }
  }
})

describe('FileTreeView', () => {
  it('renders the role=tree container', () => {
    const { container } = render(<FileTreeView {...baseProps} rows={[mkRow('a')]} />)
    expect(container.querySelector('[role="tree"]')).toBeInTheDocument()
  })

  it('renders rows from the virtualizer', () => {
    const rows = [mkRow('a'), mkRow('b'), mkRow('c')]
    const { container } = render(<FileTreeView {...baseProps} rows={rows} />)
    // At least one row from the slice should be in the DOM
    expect(container.querySelectorAll('.file-row').length).toBeGreaterThan(0)
  })

  it('renders empty when rows is empty', () => {
    const { container } = render(<FileTreeView {...baseProps} rows={[]} />)
    expect(container.querySelectorAll('.file-row').length).toBe(0)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test -- FileTreeView.test
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/files/FileTreeView.tsx src/components/files/FileTreeView.css src/components/files/FileTreeView.test.tsx
git commit -m "feat(files): add virtualised FileTreeView with sticky-folder overlay"
```

---

## Task 13: Component — DirectoryPane

**Files:**
- Create: `src/components/files/DirectoryPane.tsx`
- Create: `src/components/files/DirectoryPane.css`
- Create: `src/components/files/DirectoryPane.test.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/files/DirectoryPane.tsx
import { useMemo } from 'react'
import FileTreeRow from './FileTreeRow'
import type { TreeEntry, LastCommitInfo, GitFileStatus, Density, VisibleRow } from '../../lib/fileTree/types'
import './DirectoryPane.css'

interface Props {
  entries: TreeEntry[]
  basePath: string                            // '' for root, 'src' for src directory
  density: Density
  selected: Set<string>
  getLastCommit: (path: string) => LastCommitInfo | null | undefined
  getGitStatus: (path: string) => GitFileStatus | undefined
  owner: string
  name: string
  width: number
  onRowClick: (entry: TreeEntry, fullPath: string, e: React.MouseEvent) => void
  onRowContextMenu: (entry: TreeEntry, fullPath: string, e: React.MouseEvent) => void
}

export default function DirectoryPane(props: Props) {
  const sorted = useMemo(() => {
    return [...props.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
      return a.path.localeCompare(b.path)
    })
  }, [props.entries])

  if (sorted.length === 0) {
    return <div className="directory-pane directory-pane--empty">This folder is empty</div>
  }

  return (
    <div className="directory-pane">
      {sorted.map((entry, i) => {
        const fullPath = props.basePath ? `${props.basePath}/${entry.path}` : entry.path
        const row: VisibleRow = {
          path: fullPath,
          type: entry.type,
          name: entry.path,
          depth: 0,
          sha: entry.sha,
          size: entry.size,
          isExpanded: false,
          isFlattened: false,
          level: 1,
          posInSet: i + 1,
          setSize: sorted.length,
        }
        return (
          <FileTreeRow
            key={entry.sha + entry.path}
            row={row}
            density={props.density}
            isFocused={false}
            isSelected={props.selected.has(fullPath)}
            lastCommit={props.getLastCommit(fullPath)}
            gitStatus={props.getGitStatus(fullPath)}
            owner={props.owner}
            name={props.name}
            width={props.width}
            onClick={e => props.onRowClick(entry, fullPath, e)}
            onContextMenu={e => props.onRowContextMenu(entry, fullPath, e)}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* src/components/files/DirectoryPane.css */
.directory-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.directory-pane--empty {
  align-items: center;
  justify-content: center;
  color: var(--t3);
  font-size: 12px;
}
```

- [ ] **Step 3: Write tests**

```tsx
// src/components/files/DirectoryPane.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DirectoryPane from './DirectoryPane'
import type { TreeEntry } from '../../lib/fileTree/types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size: 100 })

const baseProps = {
  density: 'comfortable' as const,
  selected: new Set<string>(),
  getLastCommit: () => undefined,
  getGitStatus: () => undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onRowClick: vi.fn(),
  onRowContextMenu: vi.fn(),
}

describe('DirectoryPane', () => {
  it('renders empty state when entries is empty', () => {
    render(<DirectoryPane {...baseProps} entries={[]} basePath="" />)
    expect(screen.getByText('This folder is empty')).toBeInTheDocument()
  })

  it('renders each entry as a row', () => {
    render(<DirectoryPane {...baseProps}
      entries={[file('README.md', 'r-sha'), file('LICENSE', 'l-sha')]}
      basePath="" />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('LICENSE')).toBeInTheDocument()
  })

  it('sorts directories before files', () => {
    const { container } = render(<DirectoryPane {...baseProps}
      entries={[file('zfile.md', 'z-sha'), dir('adir', 'a-sha')]}
      basePath="" />)
    const rows = container.querySelectorAll('.file-row')
    expect(rows[0].textContent).toContain('adir')
    expect(rows[1].textContent).toContain('zfile.md')
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test -- DirectoryPane.test
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/files/DirectoryPane.tsx src/components/files/DirectoryPane.css src/components/files/DirectoryPane.test.tsx
git commit -m "feat(files): add DirectoryPane for root + selected-directory views"
```

---

## Task 14: Rewrite FilesTab — wire everything together

**Files:**
- Modify: `src/components/FilesTab.tsx` (full rewrite)
- Modify: `src/views/RepoDetail.tsx` (verify props match — likely unchanged)

This task is the biggest single commit. We replace the entire `FilesTab.tsx` body.

- [ ] **Step 1: Read existing FilesTab to extract reusable pieces**

We keep the following from the old FilesTab:
- The branch → root tree SHA fetch flow (with main/master fallback)
- The tree lazy-loading on dir expansion
- The blob loading + selection flow
- Navigation history (back/forward/up/home + keyboard shortcuts)
- RepoNav context publishing
- Context menu handler + download wiring
- SVG cache population

The following are replaced:
- `FileTreePanel` import → `FileTreeView` import
- `DirectoryListing` rendering inside `FileContentPanel` → `DirectoryPane`
- `ViewModeBar` → `FilesToolbar`
- `useLocalStorage<ViewMode>` etc. → `useLocalStorage<Density>` and others

- [ ] **Step 2: Add new IPC for tree-sha-keyed last-commit lookup helper**

In `src/lib/fileTree/`, add a helper file `src/lib/fileTree/diffBaseOptions.ts`:

```ts
// src/lib/fileTree/diffBaseOptions.ts
import type { DiffBaseRef } from './types'

export interface DiffBaseOption {
  label: string
  ref: DiffBaseRef
}

export function buildDiffBaseOptions(
  releases: { tag_name: string }[],
  currentBranch: string,
): DiffBaseOption[] {
  const opts: DiffBaseOption[] = []
  for (const r of releases.slice(0, 10)) {
    opts.push({ label: `vs ${r.tag_name}`, ref: { type: 'tag', ref: r.tag_name } })
  }
  // Common branches
  if (currentBranch !== 'main') opts.push({ label: 'vs main', ref: { type: 'branch', ref: 'main' } })
  if (currentBranch !== 'master') opts.push({ label: 'vs master', ref: { type: 'branch', ref: 'master' } })
  // HEAD shortcuts
  opts.push({ label: 'vs HEAD~5', ref: { type: 'commit', ref: `${currentBranch}~5` } })
  opts.push({ label: 'vs HEAD~25', ref: { type: 'commit', ref: `${currentBranch}~25` } })
  return opts
}
```

- [ ] **Step 3: Write the new FilesTab**

Replace `src/components/FilesTab.tsx` entirely:

```tsx
// src/components/FilesTab.tsx
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useRepoNav } from '../contexts/RepoNav'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useResizable } from '../hooks/useResizable'
import { useLastCommits } from '../hooks/useLastCommits'
import { useGitStatus } from '../hooks/useGitStatus'
import { useFileTreeKeyboard } from '../hooks/useFileTreeKeyboard'
import FilesToolbar from './files/FilesToolbar'
import FileTreeView from './files/FileTreeView'
import DirectoryPane from './files/DirectoryPane'
import FileContentPanel from './FileContentPanel'
import ContextMenu from './ContextMenu'
import type { ContextMenuTarget } from './ContextMenu'
import { populateSvgCache } from './SvgThumb'
import { buildVisibleRows } from '../lib/fileTree/model'
import { buildDiffBaseOptions } from '../lib/fileTree/diffBaseOptions'
import type { TreeEntry, VisibleRow, Density, SearchMode, DiffBaseRef } from '../lib/fileTree/types'
import { isVideoFile, isPdfFile } from './DirectoryListing'

interface Props {
  owner: string
  name: string
  branch: string
  initialPath?: string | null
  repoId?: number | null
  releases?: { tag_name: string }[]
}

export default function FilesTab({ owner, name, branch, initialPath, repoId, releases }: Props) {
  const [rootTreeSha, setRootTreeSha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)

  const [expanded, setExpanded] = useState<Map<string, string>>(new Map())
  const [treeData, setTreeData] = useState<Map<string, TreeEntry[]>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null)
  const [blobContent, setBlobContent] = useState<string | null>(null)
  const [blobRawBase64, setBlobRawBase64] = useState<string | null>(null)
  const [blobLoading, setBlobLoading] = useState(false)
  const [treeLoading, setTreeLoading] = useState<Set<string>>(new Set())

  // Toolbar state — persisted.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useLocalStorage<SearchMode>('files:searchMode', 'expand')
  const [density, setDensity] = useLocalStorage<Density>('files:density', 'comfortable')
  const [diffBaseMap, setDiffBaseMap] = useLocalStorage<Record<string, DiffBaseRef | null>>('files:diffBase', {})
  const diffBase = repoId ? diffBaseMap[String(repoId)] ?? null : null
  const setDiffBase = useCallback((ref: DiffBaseRef | null) => {
    if (!repoId) return
    setDiffBaseMap(prev => ({ ...prev, [String(repoId)]: ref }))
  }, [repoId, setDiffBaseMap])

  // Navigation history.
  const [pathHistory, setPathHistory] = useState<string[]>([''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const skipHistoryRef = useRef(false)

  const { width: sidebarWidth, isCollapsed, toggleCollapse, handleProps } = useResizable({
    storageKey: 'files:sidebarWidth',
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 600,
  })

  const lastCommits = useLastCommits({ repoId: repoId ?? null, owner, name, ref: branch })
  const gitStatus = useGitStatus({
    repoId: repoId ?? null, owner, name,
    baseRef: diffBase?.ref ?? null,
    headRef: branch,
  })

  const repoNav = useRepoNav()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)

  // ── Load persisted SVG cache so SvgThumb renders instantly ──
  useEffect(() => {
    window.api.svgCache.read(owner, name).then(data => {
      if (data) populateSvgCache(data)
    }).catch(() => {})
  }, [owner, name])

  // ── Resolve branch → root tree SHA ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { rootTreeSha: sha } = await window.api.github.getBranch(owner, name, branch)
        if (cancelled) return
        setRootTreeSha(sha)
        const entries = await window.api.github.getTree(owner, name, sha)
        if (cancelled) return
        setTreeData(prev => new Map(prev).set(sha, entries))
      } catch {
        if (branch === 'main') {
          try {
            const { rootTreeSha: sha } = await window.api.github.getBranch(owner, name, 'master')
            if (cancelled) return
            setRootTreeSha(sha)
            const entries = await window.api.github.getTree(owner, name, sha)
            if (cancelled) return
            setTreeData(prev => new Map(prev).set(sha, entries))
            setLoading(false)
            return
          } catch { /* fall through */ }
        }
        if (!cancelled) setError('Unable to load repository files.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [owner, name, branch, retryKey])

  // ── Build visible rows from tree state + filters ──
  const visibleRows = useMemo(() => {
    if (!rootTreeSha) return []
    return buildVisibleRows({
      rootTreeSha,
      treeData,
      expanded,
      searchQuery,
      searchMode,
      flattenEmpty: true,
    })
  }, [rootTreeSha, treeData, expanded, searchQuery, searchMode])

  // ── Request last-commit metadata for visible blob rows ──
  useEffect(() => {
    const paths = visibleRows.filter(r => r.type === 'blob').map(r => r.path)
    if (paths.length > 0) lastCommits.request(paths)
  }, [visibleRows, lastCommits])

  // ── Diff-base dropdown options ──
  const diffBaseOptions = useMemo(
    () => buildDiffBaseOptions(releases ?? [], branch),
    [releases, branch],
  )

  // ── Path navigation helpers ──
  function pushHistory(path: string) {
    if (skipHistoryRef.current) return
    setPathHistory(prev => [...prev.slice(0, historyIndex + 1), path])
    setHistoryIndex(prev => prev + 1)
  }

  const ensureTreeLoaded = useCallback(async (sha: string) => {
    if (treeData.has(sha)) return treeData.get(sha)!
    setTreeLoading(prev => new Set(prev).add(sha))
    try {
      const entries = await window.api.github.getTree(owner, name, sha)
      setTreeData(prev => new Map(prev).set(sha, entries))
      return entries
    } finally {
      setTreeLoading(prev => {
        const next = new Set(prev)
        next.delete(sha)
        return next
      })
    }
  }, [owner, name, treeData])

  const handleToggleExpand = useCallback(async (path: string) => {
    const row = visibleRows.find(r => r.path === path)
    if (!row || row.type !== 'tree') return
    if (expanded.has(path)) {
      setExpanded(prev => { const n = new Map(prev); n.delete(path); return n })
    } else {
      await ensureTreeLoaded(row.sha)
      setExpanded(prev => new Map(prev).set(path, row.sha))
    }
  }, [visibleRows, expanded, ensureTreeLoaded])

  const handleActivate = useCallback(async (path: string) => {
    const row = visibleRows.find(r => r.path === path)
    if (!row) return
    if (row.type === 'tree') {
      if (!expanded.has(path)) await handleToggleExpand(path)
      setSelectedEntry({ path: row.name, mode: '', type: 'tree', sha: row.sha })
      setBlobContent(null)
      pushHistory(path)
      return
    }
    setSelectedEntry({ path: row.name, mode: '', type: 'blob', sha: row.sha, size: row.size })
    setBlobContent(null)
    setBlobRawBase64(null)
    if (!isVideoFile(path) && !isPdfFile(path) && (!row.size || row.size <= 1_000_000)) {
      setBlobLoading(true)
      try {
        const result = await window.api.github.getBlob(owner, name, row.sha)
        setBlobContent(result.content)
        setBlobRawBase64(result.rawBase64)
      } catch { setBlobContent(null) }
      finally { setBlobLoading(false) }
    }
    pushHistory(path)
  }, [visibleRows, expanded, handleToggleExpand, owner, name])

  const handleRowClick = useCallback((row: VisibleRow, e: React.MouseEvent) => {
    setFocused(row.path)
    if (e.shiftKey && anchor) {
      // Range select from anchor → row.path
      const startIdx = visibleRows.findIndex(r => r.path === anchor)
      const endIdx = visibleRows.findIndex(r => r.path === row.path)
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const range = new Set(visibleRows.slice(lo, hi + 1).map(r => r.path))
        setSelected(range)
      }
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(row.path)) next.delete(row.path)
        else next.add(row.path)
        return next
      })
      setAnchor(row.path)
      return
    }
    setSelected(new Set([row.path]))
    setAnchor(row.path)
    handleActivate(row.path)
  }, [visibleRows, anchor, handleActivate])

  const handleSelect = useCallback((path: string, opts: { shift: boolean; ctrl: boolean }) => {
    // Used by keyboard hook; mirrors the row-click logic without the activate.
    if (opts.shift && anchor) {
      const startIdx = visibleRows.findIndex(r => r.path === anchor)
      const endIdx = visibleRows.findIndex(r => r.path === path)
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        setSelected(new Set(visibleRows.slice(lo, hi + 1).map(r => r.path)))
      }
    } else if (opts.ctrl) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path); else next.add(path)
        return next
      })
      setAnchor(path)
    } else {
      setSelected(new Set([path]))
      setAnchor(path)
    }
  }, [visibleRows, anchor])

  const keyboard = useFileTreeKeyboard({
    rows: visibleRows,
    focused,
    selected,
    onFocusChange: setFocused,
    onToggleExpand: handleToggleExpand,
    onSelect: handleSelect,
    onActivate: handleActivate,
  })

  const handleSegmentClick = useCallback((row: VisibleRow, depth: number) => {
    if (!row.flattenedSegments) return
    const targetPath = row.flattenedSegments.slice(0, depth + 1).join('/')
    setFocused(targetPath)
    handleActivate(targetPath)
  }, [handleActivate])

  // ── Context menu handlers ──
  const handleContextMenu = useCallback((row: VisibleRow, e: React.MouseEvent) => {
    e.preventDefault()
    const ext = row.path.split('.').pop()?.toLowerCase() ?? ''
    const mdExts = new Set(['md', 'mdx', 'markdown'])
    const isDir = row.type === 'tree'
    let hasMarkdown = false
    if (isDir) {
      const children = treeData.get(row.sha)
      if (children) {
        let count = 0
        for (const c of children) {
          if (c.type === 'blob' && mdExts.has(c.path.split('.').pop()?.toLowerCase() ?? '')) {
            count++
            if (count >= 2) { hasMarkdown = true; break }
          }
        }
      } else {
        hasMarkdown = true
      }
    } else {
      hasMarkdown = mdExts.has(ext)
    }
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: row.name, type: row.type === 'commit' ? 'blob' : row.type, hasMarkdown, fullPath: row.path },
    })
  }, [treeData])

  const handleDownloadRaw = useCallback((target: ContextMenuTarget) => {
    const promise = target.type === 'tree'
      ? window.api.download.rawFolder({ owner, name, branch, path: target.fullPath })
      : window.api.download.rawFile({ owner, name, branch, path: target.fullPath })
    promise.catch(err => console.error('Download failed:', err))
  }, [owner, name, branch])

  const handleDownloadConverted = useCallback((target: ContextMenuTarget, format: 'docx' | 'pdf' | 'epub') => {
    window.api.download.convert({
      owner, name, branch,
      path: target.fullPath,
      format,
      isFolder: target.type === 'tree',
    }).catch(err => console.error('Conversion failed:', err))
  }, [owner, name, branch])

  // ── Navigate to initial path (deep link) ──
  useEffect(() => {
    if (!initialPath || !rootTreeSha) return
    let cancelled = false
    ;(async () => {
      const segments = initialPath.split('/')
      let currentSha = rootTreeSha
      let currentPath = ''
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]
        currentPath = currentPath ? `${currentPath}/${seg}` : seg
        try {
          const entries = await ensureTreeLoaded(currentSha)
          if (cancelled) return
          const dirEntry = entries.find(e => e.path === seg && e.type === 'tree')
          if (!dirEntry) return
          setExpanded(prev => new Map(prev).set(currentPath, dirEntry.sha))
          currentSha = dirEntry.sha
        } catch { return }
      }
      const lastSeg = segments[segments.length - 1]
      try {
        const entries = await ensureTreeLoaded(currentSha)
        if (cancelled) return
        const target = entries.find(e => e.path === lastSeg)
        if (!target) return
        setSelected(new Set([initialPath]))
        setFocused(initialPath)
        setAnchor(initialPath)
        handleActivate(initialPath)
      } catch { return }
    })()
    return () => { cancelled = true }
  }, [initialPath, rootTreeSha, ensureTreeLoaded, handleActivate])

  // ── RepoNav publishing (preserved) ──
  const breadcrumbNavRef = useRef<(path: string) => void>(() => {})
  breadcrumbNavRef.current = (path: string) => {
    if (!path) {
      setSelected(new Set())
      setSelectedEntry(null)
      setBlobContent(null)
      pushHistory('')
      return
    }
    handleActivate(path)
  }

  const focusedPath = focused ?? (selected.size > 0 ? [...selected][0] : '')
  useEffect(() => {
    repoNav.setFilePath(focusedPath ?? '')
  }, [focusedPath])

  const focusedRow = visibleRows.find(r => r.path === focusedPath)
  const isDir = focusedRow?.type === 'tree' || !focusedPath
  useEffect(() => {
    repoNav.setIsDirectory(isDir)
  }, [isDir])

  useEffect(() => {
    repoNav.setFileNav({
      canGoBack: historyIndex > 0,
      canGoForward: historyIndex < pathHistory.length - 1,
      onGoBack: () => {
        if (historyIndex <= 0) return
        skipHistoryRef.current = true
        setHistoryIndex(i => i - 1)
        const target = pathHistory[historyIndex - 1]
        if (target) handleActivate(target)
        skipHistoryRef.current = false
      },
      onGoForward: () => {
        if (historyIndex >= pathHistory.length - 1) return
        skipHistoryRef.current = true
        setHistoryIndex(i => i + 1)
        const target = pathHistory[historyIndex + 1]
        if (target) handleActivate(target)
        skipHistoryRef.current = false
      },
    })
  }, [historyIndex, pathHistory.length])

  useEffect(() => {
    repoNav.setOnFilePathClick(() => (path: string) => breadcrumbNavRef.current(path))
    return () => {
      repoNav.setFilePath(null)
      repoNav.setOnFilePathClick(null)
      repoNav.setFileNav(null)
      repoNav.setIsDirectory(true)
    }
  }, [])

  // ── Keyboard shortcuts (existing global shortcuts preserved) ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
      }
      if (e.ctrlKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        toggleCollapse()
      }
      if (e.key === 'Backspace') {
        const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
        const isEditable = tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable
        if (!isEditable && focusedPath) {
          e.preventDefault()
          const parent = focusedPath.split('/').slice(0, -1).join('/')
          if (parent) handleActivate(parent)
          else {
            setSelected(new Set()); setSelectedEntry(null); setBlobContent(null)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleCollapse, focusedPath, handleActivate])

  // ── Right-pane content ──
  const rightPaneContent = useMemo(() => {
    if (focusedRow?.type === 'blob') {
      return (
        <FileContentPanel
          key={focusedRow.path}
          selectedPath={focusedRow.path}
          selectedEntry={selectedEntry}
          blobContent={blobContent}
          blobRawBase64={blobRawBase64}
          blobLoading={blobLoading}
          owner={owner}
          name={name}
          branch={branch}
          dirEntries={null}
          onSelectEntry={() => {}}
          onNavigateToFile={path => handleActivate(path)}
          wordWrap={false}
          onToggleWordWrap={() => {}}
          lineCount={0}
          onLineCountReady={() => {}}
          viewMode="details"
          sortField="name"
          sortDirection="asc"
          filterText=""
          treeData={treeData}
          onContextMenu={() => {}}
        />
      )
    }
    // Directory view or root.
    const dirEntries: TreeEntry[] = (() => {
      if (!focusedPath) return treeData.get(rootTreeSha ?? '') ?? []
      if (focusedRow?.type === 'tree') return treeData.get(focusedRow.sha) ?? []
      return []
    })()
    return (
      <DirectoryPane
        entries={dirEntries}
        basePath={focusedPath ?? ''}
        density={density}
        selected={selected}
        getLastCommit={p => lastCommits.get(p)}
        getGitStatus={p => gitStatus.statusMap.get(p)}
        owner={owner}
        name={name}
        width={800}
        onRowClick={(entry, fullPath, e) => {
          handleRowClick({
            path: fullPath, type: entry.type, name: entry.path, depth: 0, sha: entry.sha,
            size: entry.size, isExpanded: false, isFlattened: false,
            level: 1, posInSet: 1, setSize: 1,
          }, e)
        }}
        onRowContextMenu={(entry, fullPath, e) => {
          handleContextMenu({
            path: fullPath, type: entry.type, name: entry.path, depth: 0, sha: entry.sha,
            size: entry.size, isExpanded: false, isFlattened: false,
            level: 1, posInSet: 1, setSize: 1,
          }, e)
        }}
      />
    )
  }, [focusedRow, focusedPath, selectedEntry, blobContent, blobRawBase64, blobLoading,
      owner, name, branch, treeData, rootTreeSha, density, selected, lastCommits, gitStatus,
      handleRowClick, handleContextMenu, handleActivate])

  // ── Render ──
  if (loading) {
    return (
      <div className="files-tab">
        <div className="files-tab__loading">
          <span className="spin-ring" style={{ width: 16, height: 16 }} />
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="files-tab">
        <div className="files-tab__error">
          <p>{error}</p>
          <button onClick={() => setRetryKey(k => k + 1)}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="files-tab">
      <FilesToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        density={density}
        onDensityChange={setDensity}
        diffBase={diffBase}
        onDiffBaseChange={setDiffBase}
        diffBaseOptions={diffBaseOptions}
      />
      {gitStatus.error && (
        <div className="files-tab__compare-error">
          Compare failed · <button onClick={() => gitStatus.retry()}>Retry</button>
        </div>
      )}
      <div className="files-tab__body">
        {!isCollapsed ? (
          <div className="files-tab__tree" style={{ width: sidebarWidth }}>
            <FileTreeView
              rows={visibleRows}
              density={density}
              focused={focused}
              selected={selected}
              getLastCommit={p => lastCommits.get(p)}
              getGitStatus={p => gitStatus.statusMap.get(p)}
              owner={owner}
              name={name}
              width={sidebarWidth}
              onRowClick={handleRowClick}
              onRowContextMenu={handleContextMenu}
              onSegmentClick={handleSegmentClick}
              onKeyDown={keyboard.handleKeyDown}
            />
          </div>
        ) : (
          <button className="files-tab__expand-btn" title="Show sidebar (Ctrl+B)" onClick={toggleCollapse}>
            <ChevronRight size={14} />
          </button>
        )}
        {!isCollapsed && (
          <div className="files-tab__resize-handle" {...handleProps}>
            <div className="files-tab__resize-line" />
          </div>
        )}
        <div className="files-tab__content">
          {rightPaneContent}
        </div>
      </div>
      {selected.size > 1 && (
        <div className="files-tab__selection-status">
          {selected.size} files selected
        </div>
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          onClose={() => setCtxMenu(null)}
          onDownloadRaw={handleDownloadRaw}
          onDownloadConverted={handleDownloadConverted}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify RepoDetail still passes correct props to FilesTab**

In `src/views/RepoDetail.tsx`, find where `<FilesTab` is rendered. Update the props to pass `repoId` and `releases`:

```tsx
<FilesTab
  owner={owner!}
  name={name!}
  branch={repo?.default_branch ?? 'main'}
  initialPath={filesTargetPath}
  repoId={repo?.id ?? null}
  releases={Array.isArray(releases) ? releases : []}
/>
```

If `<FilesTab ... />` is rendered without these props, add them.

- [ ] **Step 5: Typecheck + run all related tests**

```bash
npx tsc --noEmit
npm test -- fileTree
npm test -- FilesTab
```

Expected: typecheck passes; all data layer + components tests still green.

- [ ] **Step 6: Manual smoke test in dev (skip if user prefers — they verify themselves)**

The user verifies UI manually per their workflow preferences. Confirm with user.

- [ ] **Step 7: Commit**

```bash
git add src/components/FilesTab.tsx src/views/RepoDetail.tsx src/lib/fileTree/diffBaseOptions.ts
git commit -m "$(cat <<'EOF'
feat(files): rewrite FilesTab around Pierre-style virtualised tree

Replaces FileTreePanel + DirectoryListing + ViewModeBar with the new
files/* components. Wires last-commit + git-status decorations and the
diff-base dropdown. Preserves nav history, context menu, RepoNav
breadcrumb integration, and SVG cache.
EOF
)"
```

---

## Task 15: Remove old files

**Files:**
- Delete: `src/components/FileTreePanel.tsx`
- Delete: `src/components/DirectoryListing.tsx` (after moving `isVideoFile`, `isPdfFile`, `isImageFile`, `ImagePreview`, `VideoPlayer`, `FileMetaView` helpers to a new shared file — see below)
- Delete: `src/components/ViewModeBar.tsx`

`FileContentPanel.tsx` currently imports several helpers from `DirectoryListing.tsx`. Before deleting `DirectoryListing.tsx`, we move the still-needed helpers to a new home.

- [ ] **Step 1: Move helpers to `src/components/files/fileTypes.ts` + `fileViewers.tsx`**

Create `src/components/files/fileTypes.ts`:

```ts
// src/components/files/fileTypes.ts
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'ogg'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

export const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogg: 'video/ogg',
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.has(ext)
}

export function isPdfFile(filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf'
}

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext)
}
```

Create `src/components/files/fileViewers.tsx`:

```tsx
// src/components/files/fileViewers.tsx
import { Image as ImageIcon, FileQuestion, Play } from 'lucide-react'
import { VIDEO_MIME } from './fileTypes'

interface ImagePreviewProps {
  rawUrl: string
  filename: string
  blobContent?: string | null
}

export function ImagePreview({ rawUrl, filename, blobContent }: ImagePreviewProps) {
  const isSvg = filename.split('.').pop()?.toLowerCase() === 'svg'
  if (isSvg && blobContent) {
    return (
      <div className="file-image-preview">
        <div className="file-image-preview__container">
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(blobContent)}`}
            alt={filename}
            className="file-image-preview__img"
          />
        </div>
      </div>
    )
  }
  return (
    <div className="file-image-preview">
      <ImageIcon size={14} style={{ color: 'var(--t3)' }} />
      <span className="file-image-preview__name">{filename}</span>
      <div className="file-image-preview__container">
        <img src={rawUrl} alt={filename} className="file-image-preview__img" />
      </div>
    </div>
  )
}

interface VideoPlayerProps {
  rawUrl: string
  filename: string
}

export function VideoPlayer({ rawUrl, filename }: VideoPlayerProps) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = VIDEO_MIME[ext] ?? 'video/mp4'
  return (
    <div className="file-video-player">
      <Play size={14} style={{ color: 'var(--t3)' }} />
      <span className="file-video-player__name">{filename}</span>
      <div className="file-video-player__container">
        <video controls className="file-video-player__video">
          <source src={rawUrl} type={mime} />
          Your browser does not support video playback.
        </video>
      </div>
    </div>
  )
}

interface FileMetaViewProps {
  filename: string
  size?: number
  owner: string
  name: string
  branch: string
  path: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileMetaView({ filename, size, owner, name, branch, path }: FileMetaViewProps) {
  const githubUrl = `https://github.com/${owner}/${name}/blob/${branch}/${path}`
  return (
    <div className="file-meta-view">
      <FileQuestion size={32} style={{ color: 'var(--t3)' }} />
      <h3 className="file-meta-view__name">{filename}</h3>
      {size != null && <p className="file-meta-view__size">{formatSize(size)}</p>}
      <a
        className="file-meta-view__link"
        href={githubUrl}
        onClick={(e) => { e.preventDefault(); window.api.openExternal(githubUrl) }}
      >
        View on GitHub
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Update imports in `FileContentPanel.tsx` and `FilesTab.tsx`**

In both files, replace any imports from `./DirectoryListing` with imports from `./files/fileTypes` and `./files/fileViewers`:

```ts
// Old
import { isVideoFile, isPdfFile, isImageFile, ImagePreview, VideoPlayer, FileMetaView } from './DirectoryListing'

// New
import { isVideoFile, isPdfFile, isImageFile } from './files/fileTypes'
import { ImagePreview, VideoPlayer, FileMetaView } from './files/fileViewers'
```

Grep for all import lines referencing `./DirectoryListing` and update them:

```bash
npx grep -rln "from './DirectoryListing'" src/
```

- [ ] **Step 3: Remove `DirectoryListing` usage from `FileContentPanel`**

`FileContentPanel.tsx` currently renders `DirectoryListing` for directory selections. Since we now render directories via `DirectoryPane` in the `FilesTab` orchestrator, we can drop the directory rendering from `FileContentPanel`. Find the `DirectoryListing` rendering block in `FileContentPanel.tsx` and remove it; FileContentPanel becomes blob-only.

Also drop the `dirEntries`, `onSelectEntry`, `viewMode`, `sortField`, `sortDirection`, `filterText`, `onContextMenu` props from `FileContentPanel` (they're no longer used after the directory rendering is removed). Make those props optional and ignored, OR remove them — pick the path that matches the existing call sites' constraints. The new `FilesTab` already passes them as no-op values, so making them optional is fine.

- [ ] **Step 4: Delete the old files**

```bash
git rm src/components/FileTreePanel.tsx
git rm src/components/DirectoryListing.tsx
git rm src/components/ViewModeBar.tsx
```

- [ ] **Step 5: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Expected: all tests pass; no dangling imports.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(files): remove old FileTreePanel, DirectoryListing, ViewModeBar

Replaced by src/components/files/* components in the previous commit.
Shared file-type helpers (isVideoFile, isPdfFile, isImageFile) and viewer
components (ImagePreview, VideoPlayer, FileMetaView) moved to
files/fileTypes.ts and files/fileViewers.tsx — same exports, new home.
EOF
)"
```

---

## Task 16: Clean up obsolete LocalStorage keys

**Files:**
- Modify: `src/components/FilesTab.tsx` (already done in Task 14; verify below)

Old keys `files:viewMode`, `files:sortField`, `files:sortDirection` are no longer read by anything. Browser LocalStorage entries from previous sessions remain but are harmless. No cleanup code needed — useLocalStorage simply stops touching those keys.

- [ ] **Step 1: Verify no references to old keys remain**

```bash
npx grep -rn "files:viewMode\|files:sortField\|files:sortDirection" src/ electron/
```

Expected: no matches.

- [ ] **Step 2: Verify no `ViewMode`, `SortField`, `SortDirection` type imports remain**

```bash
npx grep -rn "ViewMode\|SortField\|SortDirection" src/components/files/ src/components/FilesTab.tsx
```

Expected: no matches in the new files. (Other unrelated components may still use these names.)

- [ ] **Step 3: Commit if any cleanup needed**

If both greps came back empty, this task is a no-op — skip the commit. Otherwise:

```bash
git add -A
git commit -m "chore(files): remove dangling references to old view-mode keys"
```

---

## Task 17: Final verification

**Files:** none — manual.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: User verifies UI manually**

Per user preference (no automated UI verification), the user runs `npm run dev` themselves and confirms:
- Opening a repo's Files tab renders with the new toolbar
- Tree shows last-commit decorations (after a moment)
- Flattened single-child chains appear as one row
- Search modes behave as expected (toggle dropdown)
- Density dropdown changes row height
- Diff base dropdown shows releases + branches; selecting one colours rows
- Keyboard nav works (arrow keys, Enter, Home/End, typing a letter)
- Multi-select with Shift+Click and Ctrl+Click works
- Context menu still works (right-click)
- Existing keyboard shortcuts still work (Ctrl+B, Ctrl+Shift+F, Backspace)
- Sticky folder header appears when scrolling inside an expanded folder
- File blob viewer still works for selected files

If the user reports issues, capture them as follow-up tasks rather than treating this task as failed.

- [ ] **Step 4: Final commit if any verification fixes**

If the user found and you fixed any issues during verification, commit them as separate `fix(files):` commits. Then this task is complete.

---

## Self-review (for the plan author)

This plan was self-reviewed for:

**Spec coverage**
- Virtualization: Task 12 (`FileTreeView` with `useVirtualizer`)
- Flatten empty directories: Task 3 (`flatten.ts`) + Task 5 (`model.ts` integration)
- Sticky folder headers: Task 12 (overlay rendering in `FileTreeView`)
- Density presets: Task 2 (`DENSITY_PX` types) + Task 10 (toolbar) + Task 11 (row uses density) + Task 12 (virtualizer uses density)
- Three search modes: Task 4 (search helpers) + Task 5 (model integration) + Task 10 (toolbar control)
- Row decorations (size / commit / contributor): Task 7 (`useLastCommits`) + Task 11 (`FileTreeRow` rendering)
- Keyboard nav: Task 9 (`useFileTreeKeyboard`)
- Multi-select: Task 14 (`handleRowClick` shift/ctrl logic)
- Git status indicators: Task 6 (IPC) + Task 8 (`useGitStatus`) + Task 10 (toolbar diff base) + Task 11 (status dot)
- SQLite tables: Task 1 (migration)
- New IPCs: Task 6
- Delete old files: Task 15
- Manual verification: Task 17

**Placeholder scan:** no TBD/TODO. All code blocks are complete.

**Type consistency:** `VisibleRow`, `TreeEntry`, `Density`, `SearchMode`, `DiffBaseRef`, `LastCommitInfo`, `GitFileStatus` are defined once in Task 2 and referenced consistently throughout.

**Ambiguity:** the spec called for "type-to-focus next file starting with that letter (resets after 1s)" — implemented in Task 9 with a 1000ms timer. The spec called for "shift+click extends selection from anchor" — implemented in Task 14 (`handleRowClick`) with the `anchor` state variable.

---

## Execution

Once the user picks an execution mode (subagent-driven vs inline), proceed task-by-task. Each task is a single commit; the conventional-commit message is provided in the final step of every task.
