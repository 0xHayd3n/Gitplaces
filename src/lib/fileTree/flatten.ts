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
