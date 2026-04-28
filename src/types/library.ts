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
