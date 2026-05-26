# Pierre-style Files tab — design spec

**Date:** 2026-05-27
**Status:** Draft for plan-writing
**Inspiration:** [@pierre/trees](https://github.com/pierrecomputer/pierre/tree/main/packages/trees) and [trees.software](https://trees.software/)

## Goal

Rewrite the Files tab of `RepoDetail` to match the feature set and feel of Pierre's `@pierre/trees` library, without taking on `@pierre/trees` as a runtime dependency. We keep our existing IPC layer, blob-viewing components, and theming; we replace the tree rendering, directory listing, and toolbar wholesale.

## Scope

### In scope (rewrite)
- `src/components/FilesTab.tsx` — orchestrator, rewritten
- `src/components/FileTreePanel.tsx` — replaced
- `src/components/DirectoryListing.tsx` — replaced (and its four view modes dropped)
- `src/components/ViewModeBar.tsx` — replaced by new toolbar
- New: `src/lib/fileTree/` data layer (model, flatten, search, lastCommit, gitStatus)
- New: `src/components/files/` render layer (FileTreeRow, FileTreeView, FilesToolbar, DirectoryPane)
- New: `src/hooks/useFileTreeKeyboard.ts`, `useLastCommits.ts`, `useGitStatus.ts`

### Preserved
- `FileContentPanel.tsx` (file blob rendering — unchanged)
- `FileIcon.tsx`, `SvgThumb.tsx` (icon system)
- `ContextMenu.tsx` (rewired into new tree rows)
- `useResizable` for sidebar width
- All existing `window.api.github.*` IPCs (`getTree`, `getBlob`, `getBranch`, `getReadme`)
- Navigation history (back/forward/up/home + keyboard shortcuts Ctrl+B, Alt+arrows, Backspace)
- `RepoNav` context integration (breadcrumb publishing to NavBar)
- Per-repo SVG cache

### New IPCs (added in main process)
- `window.api.github.getLastCommitForPath(owner, name, path)` → `{ message, author_login, author_avatar, committed_at, sha } | null`. Calls `GET /repos/{owner}/{repo}/commits?path=X&per_page=1`. Uses existing GitHub client with ETag caching.
- `window.api.github.compareRefs(owner, name, base, head)` → `{ files: Array<{ path: string, status: 'added' | 'modified' | 'removed' | 'renamed' }> }`. Calls `GET /repos/{owner}/{repo}/compare/{base}...{head}`.
- Both IPCs read from / write to the new SQLite tables (`last_commits`, `compare_diffs`) so cache is shared across renderer reloads.

### Dropped from current code
- `details` / `list` / `small-icons` / `large-icons` view modes — replaced by single Pierre-style row layout
- `useLocalStorage` keys `files:viewMode`, `files:sortField`, `files:sortDirection`
- The `BookOpen` special-case icon for markdown folders — folder-content detection re-expressed via the row-decoration system

## Feature set (from Pierre)

All adopted:
1. **Virtualization** — only render visible rows
2. **Flatten empty directories** — collapse single-child dir chains into one row
3. **Sticky folder headers on scroll** — parent folder pins to viewport top
4. **Density presets** — compact (22px) / comfortable (28px, default) / spacious (36px)
5. **Three search modes** — expand-matches (default) / collapse-non-matches / hide-non-matches
6. **Row decorations** — file size, last-commit message + age, author avatar (always on, adapts to width)
7. **Keyboard navigation** — full ARIA tree role, arrow keys, type-to-focus, Home/End, Enter, Space
8. **Multi-select** — Shift+Click range, Ctrl+Click toggle, with bulk download actions
9. **Git status indicators** — added/modified/deleted/renamed dots from a user-selected diff base

## Architecture

Three layers, separated for testability.

### Data layer — `src/lib/fileTree/`

**`model.ts`** — pure derived state. Given:
- Raw tree entries from `treeData: Map<treeSha, TreeEntry[]>`
- Expansion state, search query, search mode, flatten setting

Returns `VisibleRow[]` to feed the virtualizer. Pure function, fully testable.

**`flatten.ts`** — single function. Given a directory's entries, recursively collapse single-child directory chains into one row with `flattenedSegments: string[]`. Stops at branching points or leaves.

**`search.ts`** — three projection functions, one per mode:
- `expandMatches(rows, query)` — auto-expands ancestor paths of matches; adds `matchRanges` for highlight
- `collapseNonMatches(rows, query)` — collapses anything not on a match path
- `hideNonMatches(rows, query)` — filters out non-matching subtrees entirely

**`lastCommit.ts`** — fetcher + SQLite-backed cache for per-path last-commit metadata. Uses GitHub REST `GET /repos/{owner}/{repo}/commits?path=X&per_page=1`. Concurrency-capped queue (max 6 parallel).

**`gitStatus.ts`** — fetcher + cache for diff between selected base and HEAD. Uses GitHub REST `GET /repos/{owner}/{repo}/compare/{base}...{head}`.

### Render layer — `src/components/files/`

**`FileTreeRow.tsx`** — single virtualised row.
- Icon (FileIcon / SvgThumb / folder)
- Name (with match highlight if applicable)
- For flattened rows: per-segment clickable breadcrumb of all collapsed segments
- Decorations: file size, last-commit message + age, author avatar
- Git-status dot in the gutter
- Memoised on `(path, isFocused, isSelected, isExpanded, hasLastCommit, gitStatus)`

**`FileTreeView.tsx`** — virtualised list using `@tanstack/react-virtual`.
- `useVirtualizer` with dynamic `estimateSize` from density preset
- Renders `FileTreeRow` per visible row
- Sticky folder headers: virtualised rows are absolutely positioned, so CSS `position: sticky` does not work natively. Instead, an overlay layer renders the ancestor-chain of the topmost visible row as fixed headers at the top of the scroll viewport. The overlay updates on virtualizer's `scrollOffset` changes (already part of the hook's return; no separate scroll listener). Headers stack by depth, outermost on top, each indented to its level.

**`FilesToolbar.tsx`** — replaces `ViewModeBar`.
- Search input (existing Ctrl+Shift+F focus shortcut preserved)
- Search mode dropdown: Expand matches / Collapse non-matches / Hide non-matches
- Density dropdown: Compact / Comfortable / Spacious
- Diff base dropdown: lists recent releases + branches (`main`, `master`) + `HEAD~N` shortcuts; "None" to disable

**`DirectoryPane.tsx`** — right pane.
- Nothing selected → root entries rendered in same row format as tree (flat, no indent)
- Directory selected → entries of that directory in same flat row format
- File selected → existing `FileContentPanel` (unchanged)
- Multi-select status bar at bottom when N>1: `"3 files selected · 14.2 KB total"`

**`FilesTab.tsx`** — orchestrator. Owns all state below. Wires data layer outputs into render layer.

### Hooks — `src/hooks/`

**`useFileTreeKeyboard.ts`** — full keyboard nav.
- Arrow Up/Down move focus
- Arrow Left collapses (or moves to parent if collapsed)
- Arrow Right expands (or moves to first child if expanded)
- Enter opens (file → blob panel; dir → expand + select)
- Space toggles expansion without changing selection
- Home/End jump to first/last visible row
- Type-to-focus: typed letters within 1s focus next file starting with the prefix
- Shift+Click extends selection from anchor to clicked row
- Ctrl+Click toggles a single row in/out of selection
- Roving tabindex on rows

**`useLastCommits.ts`** — manages last-commit fetch queue. Concurrency capped at 6. Pauses on fast scroll (debounced 200ms). Persists via `lastCommit.ts` cache.

**`useGitStatus.ts`** — fetches diff for current base selection. Single fetch per base; cached.

## State

### Per-tab state (in `FilesTab`)
```ts
expanded:       Map<path, treeSha>          // open directories
selected:       Set<path>                    // multi-select; first = anchor
focused:        path | null                  // keyboard focus
anchor:         path | null                  // for shift-click range
searchQuery:    string
searchMode:     'expand' | 'collapse' | 'hide'
density:        'compact' | 'comfortable' | 'spacious'
diffBase:       { type: 'tag' | 'branch' | 'commit', ref: string } | null
treeData:       Map<treeSha, TreeEntry[]>    // existing IPC cache, unchanged
```

### SQLite (new tables)

**`last_commits`**
- Schema: `(repo_id TEXT REFERENCES repos(id), tree_sha TEXT, path TEXT, message TEXT, author_login TEXT, author_avatar TEXT, committed_at TEXT, sha TEXT, PRIMARY KEY (repo_id, tree_sha, path))`
- Content-addressed by `tree_sha` so entries never go stale for unchanged files
- No TTL; entries are invalidated implicitly when the file's SHA changes

**`compare_diffs`**
- Schema: `(repo_id TEXT REFERENCES repos(id), base_ref TEXT, head_ref TEXT, files_json TEXT, fetched_at INTEGER, PRIMARY KEY (repo_id, base_ref, head_ref))`
- TTL: 1 hour (HEAD can move)

### LocalStorage (per-user)
- `files:density` → `'comfortable'` (single global key)
- `files:searchMode` → `'expand'` (single global key)
- `files:sidebarWidth` → existing
- `files:diffBase` → JSON map `{ [repoId: string]: { type, ref } }` — last-used diff base per repo, single global key

## VisibleRow shape

```ts
interface VisibleRow {
  path: string                      // canonical full path from root
  type: 'tree' | 'blob' | 'commit'  // 'commit' = git submodule
  name: string                      // last segment (or joined segments for flattened)
  flattenedSegments?: string[]      // per-segment array for clickable breadcrumb
  depth: number                     // for indent calc
  sha: string                       // entry sha
  size?: number
  isExpanded: boolean
  isFlattened: boolean
  matchRanges?: [number, number][]  // for search highlight
  // ARIA tree:
  level: number                     // 1-based depth
  posInSet: number
  setSize: number
}
```

Decorations (last commit, git status) are NOT in `VisibleRow`. They are fetched lazily by `FileTreeRow` via hooks. This keeps the model pure and the fetches viewport-scoped.

## UI

### Toolbar layout
```
[🔍 Search ▼]  [Mode: Expand ▼]  [Density: Comfortable ▼]  [Compare: v1.2.0 ▼]
```

### Row layout (varies by density)
```
[git-status-dot] [icon] [name]            [size]  [last-commit-msg] [author-avatar] [age]
```

At narrow widths (sidebar < 280px), the last-commit message and author avatar are hidden; size and age remain.

### Flattened row example
```
📁 src / main / java / com / foo                                              2d ago
```
Each segment is independently clickable; clicking jumps focus to the row at that level (auto-expanding chain to reveal it).

### Sticky folder header
When user scrolls inside an expanded folder, the folder name pins to the top of the viewport with its indent level. For deep nesting, multiple folder headers stack — outermost on top.

### Right pane states
1. **Nothing selected** → root entries as flat rows
2. **Directory selected** → entries of that dir as flat rows
3. **File selected** → existing `FileContentPanel`
4. **Multi-select active** → status bar at bottom: `"N files selected · X.X MB total"`

### Multi-select actions
Context menu on a multi-selection:
- Download selected (raw zip)
- Download selected as DOCX / PDF / EPUB (markdown files only — disabled if selection has none)

Single-row context menu: existing options (download raw, convert formats) — unchanged.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ↑ / ↓ | Move focus |
| ← | Collapse, or move to parent |
| → | Expand, or move to first child |
| Enter | Open (file: blob panel; dir: expand + select) |
| Space | Toggle expansion without changing selection |
| Home / End | First / last visible row |
| Letters (within 1s) | Type-to-focus next matching file |
| Shift+Click | Extend selection from anchor |
| Ctrl+Click | Toggle row in/out of selection |
| Ctrl+B | Toggle sidebar (preserved) |
| Ctrl+Shift+F | Focus search (preserved) |
| Alt+← / Alt+→ | History back / forward (preserved) |
| Alt+↑ / Backspace | Navigate up (preserved) |

## Implementation choices

### Virtualization library
**Choice: `@tanstack/react-virtual`** (~12KB, hooks-based, supports variable row heights for density switching). New dependency.

Considered: `react-window` (older API, less ergonomic for variable row heights when density switches — would require key-resetting the list), hand-rolled (~150 LOC, too fiddly for the gain).

### Last-commit fetching
**Choice: REST `GET /repos/{owner}/{repo}/commits?path=X&per_page=1`** per visible row, throttled to 6 parallel, cached by `(repo_id, tree_sha, path)` in SQLite.

Rationale: GitHub's GraphQL Tree type doesn't expose history per file. REST is the canonical path. Caching by `tree_sha` makes cache hits permanent for unchanged files. Lazy: only fetch for rows currently rendered in the viewport.

Trade-off: heavy scrolling burns API quota on first visit. Mitigated by viewport-only fetching + scroll-end debounce. Acceptable per user discussion.

Considered: GraphQL with alias batching (similar rate cost), local clone with `isomorphic-git log` (fastest but requires clone).

### Git status diff
**Choice: REST `GET /repos/{owner}/{repo}/compare/{base}...{head}`** — one call returns full file list with statuses. `head` is the repo's current default-branch HEAD (or whichever branch is being viewed); `base` is the user-selected ref from the toolbar dropdown. The GitHub compare endpoint accepts SHAs, branches, tags, and relative refs (e.g. `main~5`) for both sides, so no client-side resolution is needed. Cached by `(repo_id, base_ref, head_ref)` for 1 hour.

### Density presets
Three values: compact (22px row), comfortable (28px, default), spacious (36px). Affects `estimateSize` in the virtualizer. Persisted in `files:density` localStorage.

### Search modes
- `expand-matches` (default) — auto-expand ancestor folders of matches, highlight matched substring via `matchRanges`
- `collapse-non-matches` — collapse anything that doesn't lead to a match
- `hide-non-matches` — filter view; current behavior
- Mode persisted in `files:searchMode`

## Error handling

| Failure | Behavior |
|---|---|
| Tree fetch fails | Existing retry button (unchanged) |
| Last-commit fetch fails for a row | Row renders without commit info, silently. No retry. |
| Compare API fails | Toolbar shows "Compare failed · Retry" link; status decorations off for that base |
| Rate-limit hit | Pause queue 60s, log to console, resume. Decorations populate slowly. |

## Edge cases

- **Empty repo** — tree empty-state message (existing pattern)
- **Single-file repo** — no flattening; single row
- **Submodules** (`type: 'commit'`) — show with submodule icon, no expansion. Currently the code only handles `'blob'` / `'tree'`; we add defensive handling.
- **Symlinks** (`mode: '120000'`) — show with link badge, click navigates to target if resolvable
- **Binary / large blobs** — unchanged; `FileContentPanel` handles
- **Very deep flattening** — single row with horizontal scroll on hover when path overflows
- **Empty search results** — empty-state "No files match 'foo'"
- **Branch fallback** — existing main→master fallback preserved

## Performance budget

- Virtualization caps DOM to ~50 rows regardless of repo size
- `useVirtualizer` re-measures only on density change
- Last-commit queue: max 6 parallel; paused on fast scroll; resumed on scroll-end (200ms debounce)
- `last_commits` cache hits return synchronously on revisit
- Search projection debounced 100ms (200ms for >10k-row trees)
- Sticky folder headers are CSS-only — no scroll listeners

## Testing

### Unit tests (Vitest)
- `model.ts` — fixture trees, each search mode tested, expansion state interactions
- `flatten.ts` — single-child chains, branching points, root-level cases, empty dirs
- `search.ts` — match ranges, ancestor expansion logic, empty results
- `lastCommit.ts`, `gitStatus.ts` — mocked IPC, cache hit/miss, concurrency cap, rate-limit pause

### Component tests (Testing Library)
- `FileTreeRow` — decoration rendering at each density, match highlight, git-status dot states
- Keyboard nav — arrow keys, Enter, Space, Home/End, type-to-focus
- Multi-select — Shift+Click range, Ctrl+Click toggle
- Search mode switching — UI behavior for all three modes

### Fixtures
- Realistic ~500-file repo fixture (mirrors a real OSS project's tree) for virtualization correctness

### No visual regression tests
Per user preference, no screenshot/Percy/visual diff testing. User verifies UI manually.

## Out of scope

Not part of this rewrite:
- Drag-and-drop (read-only viewer; no destination)
- Inline rename (read-only)
- Mutation API (`add` / `move` / `remove`)
- SSR
- Shadow DOM / `unsafeCSS` escape hatch
- Custom row decoration renderer API for downstream consumers — decorations are hardcoded to our three lanes (size, commit, avatar)

## Open questions

None at spec time. All decisions confirmed in brainstorming session.

## Next step

Pass this spec to `superpowers:writing-plans` to produce an implementation plan with concrete file-by-file tasks.
