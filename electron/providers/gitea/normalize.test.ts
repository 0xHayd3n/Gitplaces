// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  giteaRepoToRepo,
  giteaReleaseToRelease,
  giteaUserToUser,
  giteaStarredToStarredEntry,
} from './normalize'
import type { GiteaRepo, GiteaRelease, GiteaUser } from './rest'

const HOST_ID = 'gt:codeberg.org'

const FIXTURE: GiteaRepo = {
  id: 42,
  name: 'demo',
  full_name: 'alice/demo',
  owner: {
    id: 1,
    login: 'alice',
    full_name: 'Alice',
    avatar_url: 'https://codeberg.org/avatars/alice.png',
    html_url: 'https://codeberg.org/alice',
  },
  description: 'a demo repo',
  website: 'https://example.com/demo',
  default_branch: 'main',
  topics: ['rust', 'cli'],
  html_url: 'https://codeberg.org/alice/demo',
  size: 5120,                         // already KB
  stars_count: 42,
  forks_count: 5,
  watchers_count: 7,
  open_issues_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-14T22:00:00Z',
  archived: false,
  private: false,
}

describe('giteaRepoToRepo', () => {
  it('maps the standard fields', () => {
    const r = giteaRepoToRepo(HOST_ID, FIXTURE)
    expect(r.hostId).toBe(HOST_ID)
    expect(r.hostType).toBe('gitea')
    expect(r.hostNativeId).toBe(42)
    expect(r.fullName).toBe('alice/demo')
    expect(r.owner).toBe('alice')
    expect(r.name).toBe('demo')
    expect(r.htmlUrl).toBe('https://codeberg.org/alice/demo')
    expect(r.description).toBe('a demo repo')
    expect(r.topics).toEqual(['rust', 'cli'])
    expect(r.defaultBranch).toBe('main')
    expect(r.archived).toBe(false)
    expect(r.stars).toBe(42)
    expect(r.forks).toBe(5)
    expect(r.openIssues).toBe(1)
    expect(r.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(r.updatedAt).toBe('2026-06-14T22:00:00Z')
    expect(r.ownerAvatarUrl).toBe(FIXTURE.owner.avatar_url)
  })

  it('uses updated_at for pushedAt (Gitea has no separate pushed_at)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).pushedAt).toBe(FIXTURE.updated_at)
  })

  it('uses watchers_count for watchers (NOT stars — Gitea exposes both)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).watchers).toBe(7)
  })

  it('keeps size as-is (Gitea returns KB, matching the canonical unit)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).size).toBe(5120)
  })

  it('maps website → homepageUrl, treating empty strings as null', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).homepageUrl).toBe('https://example.com/demo')
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, website: '' }).homepageUrl).toBeNull()
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, website: null }).homepageUrl).toBeNull()
  })

  it('falls back defaultBranch to "main" when null/empty (Gitea reports empty for empty repos)', () => {
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, default_branch: null }).defaultBranch).toBe('main')
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('topics empty when null/undefined', () => {
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, topics: null }).topics).toEqual([])
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, topics: undefined as unknown as string[] }).topics).toEqual([])
  })

  it('language is null (Gitea repo endpoint does not expose it — parity with GitLab)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).language).toBeNull()
  })

  it('license is null (Phase 5 does not fetch /contents/LICENSE — parity with GitLab)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).license).toBeNull()
  })
})

describe('giteaReleaseToRelease', () => {
  it('maps tag, name, body, publishedAt, prerelease', () => {
    const rel: GiteaRelease = {
      tag_name: 'v1.0.0',
      name: 'First release',
      published_at: '2026-01-01T00:00:00Z',
      body: 'release notes',
      prerelease: false,
      assets: [{ id: 1, name: 'src.tar.gz', size: 1234, browser_download_url: 'https://x/y.tar.gz', download_count: 9 }],
    }
    const out = giteaReleaseToRelease(rel)
    expect(out.tagName).toBe('v1.0.0')
    expect(out.name).toBe('First release')
    expect(out.publishedAt).toBe('2026-01-01T00:00:00Z')
    expect(out.body).toBe('release notes')
    expect(out.prerelease).toBe(false)
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0].name).toBe('src.tar.gz')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tar.gz')
    expect(out.assets[0].size).toBe(1234)
    expect(out.assets[0].downloadCount).toBe(9)
  })

  it('passes through prerelease === true', () => {
    const rel: GiteaRelease = {
      tag_name: 'v2.0.0-rc1', name: null, published_at: '2026-06-01T00:00:00Z',
      body: null, prerelease: true,
    }
    expect(giteaReleaseToRelease(rel).prerelease).toBe(true)
  })

  it('handles missing assets', () => {
    const rel: GiteaRelease = {
      tag_name: 'v3', name: null, published_at: '2026-06-01T00:00:00Z',
      body: null, prerelease: false,
    }
    expect(giteaReleaseToRelease(rel).assets).toEqual([])
  })
})

describe('giteaUserToUser', () => {
  it('maps login → login, avatar_url → avatarUrl, publicRepos defaults to 0', () => {
    const u: GiteaUser = { id: 1, login: 'alice', full_name: 'Alice', avatar_url: 'https://x/a.png', html_url: 'https://codeberg.org/alice' }
    const out = giteaUserToUser(u)
    expect(out.login).toBe('alice')
    expect(out.avatarUrl).toBe('https://x/a.png')
    // Gitea /user does not expose a public_repos count; surface 0 until Phase 7
    // teaches the user-page renderer to call /users/{login}/repos.
    expect(out.publicRepos).toBe(0)
  })
})

describe('giteaStarredToStarredEntry', () => {
  it('uses updated_at as a stand-in for starred_at (no native field in Gitea)', () => {
    const out = giteaStarredToStarredEntry(HOST_ID, FIXTURE)
    expect(out.starredAt).toBe(FIXTURE.updated_at)
    expect(out.repo.fullName).toBe('alice/demo')
  })
})
