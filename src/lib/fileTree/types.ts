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
