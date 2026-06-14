// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  gitlabProjectToRepo,
  gitlabReleaseToRelease,
  gitlabUserToUser,
  gitlabStarredToStarredEntry,
} from './normalize'
import type { GitLabProject, GitLabRelease, GitLabUser } from './rest'

const HOST_ID = 'gl:gitlab.com'

const FIXTURE: GitLabProject = {
  id: 278964,
  description: 'GitLab is open source',
  name: 'GitLab',
  path: 'gitlab',
  path_with_namespace: 'gitlab-org/gitlab',
  default_branch: 'master',
  topics: ['gitlab', 'ruby'],
  web_url: 'https://gitlab.com/gitlab-org/gitlab',
  avatar_url: 'https://gitlab.com/uploads/-/system/project/avatar/278964/gitlab.png',
  star_count: 4500,
  forks_count: 5500,
  open_issues_count: 12100,
  created_at: '2014-08-29T00:00:00.000Z',
  last_activity_at: '2026-06-14T22:00:00.000Z',
  updated_at: '2026-06-14T22:00:00.000Z',
  archived: false,
  visibility: 'public',
  namespace: { id: 9970, name: 'GitLab.org', path: 'gitlab-org', kind: 'group', full_path: 'gitlab-org', avatar_url: 'https://gitlab.com/uploads/-/system/group/avatar/9970/group.png' },
  license: { key: 'mit', name: 'MIT License', nickname: null, html_url: null, source_url: null },
  statistics: { commit_count: 0, storage_size: 0, repository_size: 5_242_880, wiki_size: 0, lfs_objects_size: 0, job_artifacts_size: 0 },
  readme_url: 'https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md',
}

describe('gitlabProjectToRepo', () => {
  it('maps the standard fields', () => {
    const r = gitlabProjectToRepo(HOST_ID, FIXTURE)
    expect(r.hostId).toBe(HOST_ID)
    expect(r.hostType).toBe('gitlab')
    expect(r.hostNativeId).toBe(278964)
    expect(r.fullName).toBe('gitlab-org/gitlab')
    expect(r.owner).toBe('gitlab-org')
    expect(r.name).toBe('gitlab')
    expect(r.htmlUrl).toBe('https://gitlab.com/gitlab-org/gitlab')
    expect(r.description).toBe('GitLab is open source')
    expect(r.topics).toEqual(['gitlab', 'ruby'])
    expect(r.license).toBe('mit')
    expect(r.defaultBranch).toBe('master')
    expect(r.archived).toBe(false)
    expect(r.stars).toBe(4500)
    expect(r.forks).toBe(5500)
    expect(r.openIssues).toBe(12100)
    expect(r.createdAt).toBe('2014-08-29T00:00:00.000Z')
    expect(r.updatedAt).toBe('2026-06-14T22:00:00.000Z')
    expect(r.pushedAt).toBe('2026-06-14T22:00:00.000Z')   // last_activity_at
    expect(r.ownerAvatarUrl).toBe(FIXTURE.namespace.avatar_url)
  })

  it('converts repository_size from bytes → KB', () => {
    const r = gitlabProjectToRepo(HOST_ID, FIXTURE)
    // 5_242_880 bytes / 1024 = 5120 KB
    expect(r.size).toBe(5120)
  })

  it('defaults size to 0 when statistics is missing', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, statistics: undefined })
    expect(r.size).toBe(0)
  })

  it('falls back defaultBranch to "main" when null/empty', () => {
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, default_branch: null }).defaultBranch).toBe('main')
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('falls back ownerAvatarUrl to "" when namespace.avatar_url is null', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, namespace: { ...FIXTURE.namespace, avatar_url: null } })
    expect(r.ownerAvatarUrl).toBe('')
  })

  it('language is null (GitLab project endpoint does not expose it)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).language).toBeNull()
  })

  it('homepageUrl is null (GitLab project endpoint has no equivalent field)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).homepageUrl).toBeNull()
  })

  it('watchers mirrors stars (GitLab has no separate watcher count)', () => {
    expect(gitlabProjectToRepo(HOST_ID, FIXTURE).watchers).toBe(FIXTURE.star_count)
  })

  it('topics empty when missing', () => {
    const r = gitlabProjectToRepo(HOST_ID, { ...FIXTURE, topics: undefined as unknown as string[] })
    expect(r.topics).toEqual([])
  })

  it('license maps to null when license object is missing', () => {
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, license: null }).license).toBeNull()
    expect(gitlabProjectToRepo(HOST_ID, { ...FIXTURE, license: undefined }).license).toBeNull()
  })
})

describe('gitlabReleaseToRelease', () => {
  it('maps tag, name, body, publishedAt, prerelease', () => {
    const rel: GitLabRelease = {
      tag_name: 'v1.0.0',
      name: 'First release',
      released_at: '2026-01-01T00:00:00Z',
      description: 'release notes',
      upcoming_release: false,
      assets: { count: 1, links: [{ id: 1, name: 'src.tar.gz', url: 'https://x/y.tar.gz' }] },
    }
    const out = gitlabReleaseToRelease(rel)
    expect(out.tagName).toBe('v1.0.0')
    expect(out.name).toBe('First release')
    expect(out.publishedAt).toBe('2026-01-01T00:00:00Z')
    expect(out.body).toBe('release notes')
    expect(out.prerelease).toBe(false)
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0].name).toBe('src.tar.gz')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tar.gz')
    expect(out.assets[0].downloadCount).toBe(0)  // GitLab does not expose this
    expect(out.assets[0].size).toBe(0)           // ditto
  })

  it('treats upcoming_release === true as prerelease', () => {
    const rel: GitLabRelease = {
      tag_name: 'v2.0.0-rc1', name: null, released_at: '2026-06-01T00:00:00Z',
      description: null, upcoming_release: true,
    }
    expect(gitlabReleaseToRelease(rel).prerelease).toBe(true)
  })

  it('handles missing assets', () => {
    const rel: GitLabRelease = {
      tag_name: 'v3', name: null, released_at: '2026-06-01T00:00:00Z',
      description: null, upcoming_release: false,
    }
    expect(gitlabReleaseToRelease(rel).assets).toEqual([])
  })
})

describe('gitlabUserToUser', () => {
  it('maps username → login, avatar_url → avatarUrl, publicRepos defaults to 0', () => {
    const u: GitLabUser = { id: 1, username: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', web_url: 'https://gitlab.com/alice' }
    const out = gitlabUserToUser(u)
    expect(out.login).toBe('alice')
    expect(out.avatarUrl).toBe('https://x/a.png')
    // GitLab does not expose a public_repos count on /user; surface 0 until Phase 7
    // teaches the user-page renderer to call /users/:id/projects?visibility=public.
    expect(out.publicRepos).toBe(0)
  })
})

describe('gitlabStarredToStarredEntry', () => {
  it('uses last_activity_at as a stand-in for starred_at (no native field in GitLab v4)', () => {
    const out = gitlabStarredToStarredEntry(HOST_ID, FIXTURE)
    expect(out.starredAt).toBe(FIXTURE.last_activity_at)
    expect(out.repo.fullName).toBe('gitlab-org/gitlab')
  })
})
