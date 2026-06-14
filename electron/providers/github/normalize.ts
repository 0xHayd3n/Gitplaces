// electron/providers/github/normalize.ts
//
// Adapter from the live GitHub REST shapes (snake_case) to the canonical
// camelCase shapes the renderer consumes. Pure functions, no I/O.

import { HOST_ID_GITHUB } from '../types'
import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GitHubRepo,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubUser,
  GitHubStarredRepo,
} from './rest'

export function githubRepoToRepo(g: GitHubRepo): Repo {
  return {
    hostId: HOST_ID_GITHUB,
    hostType: 'github',
    hostNativeId: g.id,
    fullName: g.full_name,
    owner: g.owner.login,
    name: g.name,
    htmlUrl: g.html_url,
    homepageUrl: g.homepage ?? null,
    description: g.description ?? null,
    language: g.language ?? null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: g.license?.spdx_id ?? null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: g.size ?? 0,
    stars: g.stargazers_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.watchers_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.pushed_at,
    ownerAvatarUrl: g.owner.avatar_url,
  }
}

function releaseAssetToAsset(a: GitHubReleaseAsset): ReleaseAsset {
  return {
    name: a.name,
    size: a.size,
    browserDownloadUrl: a.browser_download_url,
    downloadCount: a.download_count,
  }
}

export function githubReleaseToRelease(r: GitHubRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.published_at,
    body: r.body,
    assets: (r.assets ?? []).map(releaseAssetToAsset),
    prerelease: Boolean(r.prerelease),
  }
}

export function githubUserToUser(u: GitHubUser): User {
  return {
    login: u.login,
    avatarUrl: u.avatar_url,
    publicRepos: u.public_repos,
  }
}

export function githubStarredToStarredEntry(s: GitHubStarredRepo): StarredEntry {
  return {
    starredAt: s.starred_at,
    repo: githubRepoToRepo(s.repo),
  }
}
