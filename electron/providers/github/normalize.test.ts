// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  githubRepoToRepo,
  githubReleaseToRelease,
  githubUserToUser,
  githubStarredToStarredEntry,
} from './normalize'
import type { GitHubRepo, GitHubRelease, GitHubUser, GitHubStarredRepo } from './rest'

const FIXTURE_REPO: GitHubRepo = {
  id: 12345,
  full_name: 'vitejs/vite',
  name: 'vite',
  html_url: 'https://github.com/vitejs/vite',
  owner: { login: 'vitejs', avatar_url: 'https://avatars.githubusercontent.com/u/65625612?v=4' },
  description: 'Next generation frontend tooling. It\'s fast!',
  language: 'TypeScript',
  topics: ['build-tool', 'frontend'],
  stargazers_count: 76200,
  forks_count: 6800,
  watchers_count: 76200,
  open_issues_count: 412,
  size: 18900,
  license: { spdx_id: 'MIT' },
  homepage: 'https://vitejs.dev',
  updated_at: '2026-06-13T22:00:00Z',
  pushed_at: '2026-06-13T21:30:00Z',
  created_at: '2020-04-21T00:00:00Z',
  default_branch: 'main',
  archived: false,
}

describe('githubRepoToRepo', () => {
  it('maps all standard fields to camelCase', () => {
    const r = githubRepoToRepo(FIXTURE_REPO)
    expect(r.hostId).toBe('gh:api.github.com')
    expect(r.hostType).toBe('github')
    expect(r.hostNativeId).toBe(12345)
    expect(r.fullName).toBe('vitejs/vite')
    expect(r.owner).toBe('vitejs')
    expect(r.name).toBe('vite')
    expect(r.htmlUrl).toBe('https://github.com/vitejs/vite')
    expect(r.homepageUrl).toBe('https://vitejs.dev')
    expect(r.description).toBe(FIXTURE_REPO.description)
    expect(r.language).toBe('TypeScript')
    expect(r.topics).toEqual(['build-tool', 'frontend'])
    expect(r.license).toBe('MIT')
    expect(r.defaultBranch).toBe('main')
    expect(r.archived).toBe(false)
    expect(r.size).toBe(18900)
    expect(r.stars).toBe(76200)
    expect(r.forks).toBe(6800)
    expect(r.watchers).toBe(76200)
    expect(r.openIssues).toBe(412)
    expect(r.createdAt).toBe('2020-04-21T00:00:00Z')
    expect(r.updatedAt).toBe('2026-06-13T22:00:00Z')
    expect(r.pushedAt).toBe('2026-06-13T21:30:00Z')
    expect(r.ownerAvatarUrl).toBe('https://avatars.githubusercontent.com/u/65625612?v=4')
  })

  it('handles null license, null homepage, missing topics', () => {
    const r = githubRepoToRepo({
      ...FIXTURE_REPO,
      license: null,
      homepage: null,
      topics: undefined as unknown as string[],
    })
    expect(r.license).toBeNull()
    expect(r.homepageUrl).toBeNull()
    expect(r.topics).toEqual([])
  })

  it('falls back default_branch to "main" when empty', () => {
    const r = githubRepoToRepo({ ...FIXTURE_REPO, default_branch: '' })
    expect(r.defaultBranch).toBe('main')
  })
})

describe('githubReleaseToRelease', () => {
  it('maps release fields and asset fields to camelCase', () => {
    const rel: GitHubRelease = {
      tag_name: 'v5.0.0',
      name: 'Five',
      published_at: '2026-06-12T00:00:00Z',
      body: 'Release notes',
      prerelease: false,
      assets: [
        { name: 'vite.tgz', size: 1234, browser_download_url: 'https://x/y.tgz', download_count: 42 },
      ],
    }
    const out = githubReleaseToRelease(rel)
    expect(out.tagName).toBe('v5.0.0')
    expect(out.publishedAt).toBe('2026-06-12T00:00:00Z')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tgz')
    expect(out.assets[0].downloadCount).toBe(42)
  })
})

describe('githubUserToUser', () => {
  it('maps avatar_url + public_repos', () => {
    const u: GitHubUser = { login: 'alice', avatar_url: 'https://x/a.png', public_repos: 17 }
    const out = githubUserToUser(u)
    expect(out).toEqual({ login: 'alice', avatarUrl: 'https://x/a.png', publicRepos: 17 })
  })
})

describe('githubStarredToStarredEntry', () => {
  it('lifts starred_at + nested repo', () => {
    const s: GitHubStarredRepo = { starred_at: '2026-01-15T10:00:00Z', repo: FIXTURE_REPO }
    const out = githubStarredToStarredEntry(s)
    expect(out.starredAt).toBe('2026-01-15T10:00:00Z')
    expect(out.repo.fullName).toBe('vitejs/vite')
  })
})
