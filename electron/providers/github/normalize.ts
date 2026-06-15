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

/** Inverse adapter used by the recommendation engine, which is GitHub-shaped
 *  end-to-end. Converts a canonical `Repo` back to a GitHubRepo-compatible
 *  object — non-GitHub fields (hostId) ride along on `_hostId` for the IPC
 *  upsert to tag rows correctly. The synthetic `id` uses `Number(hostNativeId)`
 *  since all three providers store numeric native ids; collision risk across
 *  hosts is non-zero but the recommendation flow upserts by owner/name and
 *  only uses id as a Set key inside fetchCandidates dedup, where a composite
 *  string key is used instead. */
export function repoToGitHubShape(r: Repo): GitHubRepo & { _hostId: string } {
  return {
    id: typeof r.hostNativeId === 'number' ? r.hostNativeId : Number(r.hostNativeId) || 0,
    full_name: r.fullName,
    name: r.name,
    html_url: r.htmlUrl,
    owner: { login: r.owner, avatar_url: r.ownerAvatarUrl },
    description: r.description,
    language: r.language,
    topics: r.topics,
    stargazers_count: r.stars,
    forks_count: r.forks,
    watchers_count: r.watchers,
    open_issues_count: r.openIssues,
    size: r.size,
    license: r.license ? { spdx_id: r.license } : null,
    homepage: r.homepageUrl,
    updated_at: r.updatedAt,
    pushed_at: r.pushedAt,
    created_at: r.createdAt,
    default_branch: r.defaultBranch,
    archived: r.archived,
    _hostId: r.hostId,
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
