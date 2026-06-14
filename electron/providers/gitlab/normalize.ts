// electron/providers/gitlab/normalize.ts
//
// Translates GitLab provider-native shapes to the canonical renderer shapes
// (Repo / Release / User / StarredEntry). Pure functions, no I/O. Mirrors
// electron/providers/github/normalize.ts.
//
// Known asymmetries we accept in Phase 4:
//   - `language`     → null (GitLab /projects/:id doesn't surface a top language;
//                     fetching /projects/:id/languages is a Phase 6 polish item).
//   - `homepageUrl`  → null (no equivalent field on GitLab projects).
//   - `watchers`     → mirrors `star_count` (GitLab has no separate watcher count).
//   - `publicRepos`  → 0 (GitLab /user doesn't expose a count; renderer surfaces
//                     this only on profile pages, which Phase 4 doesn't touch).
//   - `starredAt`    → `last_activity_at` (GitLab v4 has no per-star timestamp).
//   - `size`         → bytes → KB conversion via `statistics.repository_size`.

import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GitLabProject,
  GitLabRelease,
  GitLabReleaseAssetLink,
  GitLabUser,
} from './rest'

export function gitlabProjectToRepo(hostId: string, g: GitLabProject): Repo {
  const sizeBytes = g.statistics?.repository_size ?? 0
  return {
    hostId,
    hostType: 'gitlab',
    hostNativeId: g.id,
    fullName: g.path_with_namespace,
    owner: g.namespace.path,
    name: g.path,
    htmlUrl: g.web_url,
    homepageUrl: null,
    description: g.description ?? null,
    language: null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: g.license?.key ?? null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: Math.round(sizeBytes / 1024),
    stars: g.star_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.star_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.last_activity_at,
    ownerAvatarUrl: g.namespace.avatar_url ?? '',
  }
}

function releaseAssetLinkToAsset(a: GitLabReleaseAssetLink): ReleaseAsset {
  return {
    name: a.name,
    size: 0,
    browserDownloadUrl: a.direct_asset_url ?? a.url,
    downloadCount: 0,
  }
}

export function gitlabReleaseToRelease(r: GitLabRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.released_at,
    body: r.description,
    assets: (r.assets?.links ?? []).map(releaseAssetLinkToAsset),
    prerelease: Boolean(r.upcoming_release),
  }
}

export function gitlabUserToUser(u: GitLabUser): User {
  return {
    login: u.username,
    avatarUrl: u.avatar_url,
    publicRepos: 0,
  }
}

export function gitlabStarredToStarredEntry(hostId: string, p: GitLabProject): StarredEntry {
  return {
    starredAt: p.last_activity_at,
    repo: gitlabProjectToRepo(hostId, p),
  }
}
