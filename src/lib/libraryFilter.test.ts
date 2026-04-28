// src/lib/libraryFilter.test.ts
import { describe, it, expect } from 'vitest'
import { filterLibraryEntries } from './libraryFilter'
import type { LibraryEntry } from '../types/library'
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
