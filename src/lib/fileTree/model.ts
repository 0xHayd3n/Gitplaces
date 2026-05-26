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
  // Stable sort: directories before files, preserve original order within each group.
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return 0
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
