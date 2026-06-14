import type { SavedRepo, LibrarySavedRepo } from './repo'

// Re-export so existing consumers can import LibrarySavedRepo from '../types/library'.
export type { LibrarySavedRepo } from './repo'

export interface LocalProject {
  name: string
  path: string
  isGit: boolean
  owner: string | null
  repoName: string | null
}

export type LibraryEntry =
  | { kind: 'repo'; row: SavedRepo; isInstalled: boolean; isStarred: boolean }
  | { kind: 'local'; project: LocalProject }
