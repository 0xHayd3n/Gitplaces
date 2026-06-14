// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { repoRowToSavedRepo, libraryRowToLibrarySavedRepo, savedRepoToRow } from './repoNormalize'
import type { RepoRow, LibraryRow } from './db-row-types'

const BASE_ROW: RepoRow = {
  id: 'gh-12345',
  owner: 'vitejs',
  name: 'vite',
  description: 'Frontend tooling',
  language: 'TypeScript',
  topics: '["build-tool","frontend"]',
  stars: 76200,
  forks: 6800,
  license: 'MIT',
  homepage: 'https://vitejs.dev',
  updated_at: '2026-06-13T22:00:00Z',
  pushed_at: '2026-06-13T21:30:00Z',
  created_at: '2020-04-21T00:00:00Z',
  saved_at: '2026-05-12T10:00:00Z',
  starred_at: null,
  unstarred_at: null,
  type: null,
  banner_svg: null,
  discovered_at: null,
  discover_query: null,
  watchers: 76200,
  size: 18900,
  open_issues: 412,
  default_branch: 'main',
  avatar_url: 'https://avatars.githubusercontent.com/u/65625612?v=4',
  og_image_url: null,
  banner_color: null,
  translated_description: null,
  translated_description_lang: null,
  translated_readme: null,
  translated_readme_lang: null,
  detected_language: null,
  verification_score: null,
  verification_tier: null,
  verification_signals: null,
  verification_checked_at: null,
  type_bucket: null,
  type_sub: null,
  is_forked: 0,
  update_available: 0,
  update_checked_at: null,
  upstream_version: null,
  stored_version: null,
  archived_at: null,
  forked_at: null,
  fetched_at: null,
  starred_checked_at: null,
  storybook_url: null,
  host_id: 'gh:api.github.com',
}

describe('repoRowToSavedRepo', () => {
  it('maps every column to its camelCase equivalent', () => {
    const r = repoRowToSavedRepo(BASE_ROW)
    expect(r.hostId).toBe('gh:api.github.com')
    expect(r.hostType).toBe('github')
    expect(r.hostNativeId).toBe('gh-12345')
    expect(r.fullName).toBe('vitejs/vite')
    expect(r.owner).toBe('vitejs')
    expect(r.name).toBe('vite')
    expect(r.htmlUrl).toBe('https://github.com/vitejs/vite')
    expect(r.homepageUrl).toBe('https://vitejs.dev')
    expect(r.topics).toEqual(['build-tool', 'frontend'])
    expect(r.stars).toBe(76200)
    expect(r.openIssues).toBe(412)
    expect(r.defaultBranch).toBe('main')
    expect(r.ownerAvatarUrl).toBe(BASE_ROW.avatar_url)
    expect(r.savedAt).toBe('2026-05-12T10:00:00Z')
  })

  it('parses an invalid topics JSON to []', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, topics: 'not-json' })
    expect(r.topics).toEqual([])
  })

  it('defaults defaultBranch to "main" when null/empty', () => {
    expect(repoRowToSavedRepo({ ...BASE_ROW, default_branch: null }).defaultBranch).toBe('main')
    expect(repoRowToSavedRepo({ ...BASE_ROW, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('zero-fills missing counts', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, stars: null, forks: null, watchers: null, open_issues: null, size: null })
    expect(r.stars).toBe(0)
    expect(r.forks).toBe(0)
    expect(r.watchers).toBe(0)
    expect(r.openIssues).toBe(0)
    expect(r.size).toBe(0)
  })

  it('inherits host_id from the row (multi-host preparation)', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, host_id: 'gl:gitlab.com' })
    expect(r.hostId).toBe('gl:gitlab.com')
    expect(r.hostType).toBe('gitlab')
  })
})

describe('libraryRowToLibrarySavedRepo', () => {
  it('adds installed / version / generatedAt / enabled* / tier', () => {
    const row: LibraryRow = {
      ...BASE_ROW,
      installed: 1,
      active: 1,
      version: 'v3.5.1',
      generated_at: '2026-06-01T12:00:00Z',
      enabled_components: '["Button","Modal"]',
      enabled_tools: null,
      tier: 2,
    }
    const r = libraryRowToLibrarySavedRepo(row)
    expect(r.installed).toBe(1)
    expect(r.version).toBe('v3.5.1')
    expect(r.generatedAt).toBe('2026-06-01T12:00:00Z')
    expect(r.enabledComponents).toBe('["Button","Modal"]')
    expect(r.tier).toBe(2)
  })
})

describe('savedRepoToRow', () => {
  it('round-trips through repoRowToSavedRepo → savedRepoToRow (lossless on the savedRepo fields)', () => {
    const saved = repoRowToSavedRepo(BASE_ROW)
    const row = savedRepoToRow(saved)
    // Round-trip the canonical subset (host_id, owner, name, description, etc.).
    expect(row.host_id).toBe(BASE_ROW.host_id)
    expect(row.owner).toBe(BASE_ROW.owner)
    expect(row.name).toBe(BASE_ROW.name)
    expect(row.description).toBe(BASE_ROW.description)
    expect(row.stars).toBe(BASE_ROW.stars)
    expect(row.default_branch).toBe(BASE_ROW.default_branch)
    expect(row.topics).toBe(BASE_ROW.topics)
  })
})
