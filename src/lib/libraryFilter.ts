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
      return entries.slice()

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
      // recentVisits is assumed newest-first (as returned by getRecentVisits())
      // entries are ordered by their position in that array, not by visitedAt
      const recentMap = new Map<string, number>()
      recentVisits.forEach((r, i) => recentMap.set(`${r.owner}/${r.name}`, i))
      const matched = entries.filter(e => recentMap.has(entryKey(e)))
      return matched.sort((a, b) => (recentMap.get(entryKey(a)) ?? 999) - (recentMap.get(entryKey(b)) ?? 999))
    }

    case 'archive':
      return entries.filter(e => archivedSet.has(entryKey(e)))
  }
}
