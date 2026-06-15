// electron/providers/gitea/normalize.ts
//
// Translates Gitea provider-native shapes to the canonical renderer shapes
// (Repo / Release / User / StarredEntry). Pure functions, no I/O. Mirrors
// electron/providers/gitlab/normalize.ts.
//
// Known asymmetries we accept in Phase 5:
//   - `language`     → null (Gitea /repos/{o}/{n} doesn't surface a top language;
//                     fetching /languages is a Phase 6 polish item).
//   - `license`      → null (Phase 5 doesn't probe LICENSE files; same posture
//                     as the GitLab normalizer pre-Phase-6).
//   - `publicRepos`  → 0 (Gitea /user doesn't expose a count; renderer surfaces
//                     this only on profile pages, which Phase 5 doesn't touch).
//   - `starredAt`    → `updated_at` (no per-star timestamp from Gitea — the
//                     /user/starred endpoint returns repos, not star events).
//   - `pushedAt`     → `updated_at` (Gitea has no pushed_at field).
//   - `size`         → identity (Gitea already reports KB; no conversion).
//   - `watchers`     → uses watchers_count (NOT stars, unlike the GitLab path).

import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GiteaRepo,
  GiteaRelease,
  GiteaReleaseAsset,
  GiteaUser,
} from './rest'

export function giteaRepoToRepo(hostId: string, g: GiteaRepo): Repo {
  return {
    hostId,
    hostType: 'gitea',
    hostNativeId: g.id,
    fullName: g.full_name,
    owner: g.owner.login,
    name: g.name,
    htmlUrl: g.html_url,
    homepageUrl: g.website && g.website.length > 0 ? g.website : null,
    description: g.description ?? null,
    language: null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: g.size ?? 0,
    stars: g.stars_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.watchers_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.updated_at,
    ownerAvatarUrl: g.owner.avatar_url ?? '',
  }
}

function giteaReleaseAssetToAsset(a: GiteaReleaseAsset): ReleaseAsset {
  return {
    name: a.name,
    size: a.size ?? 0,
    browserDownloadUrl: a.browser_download_url,
    downloadCount: a.download_count ?? 0,
  }
}

export function giteaReleaseToRelease(r: GiteaRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.published_at,
    body: r.body,
    assets: (r.assets ?? []).map(giteaReleaseAssetToAsset),
    prerelease: Boolean(r.prerelease),
  }
}

export function giteaUserToUser(u: GiteaUser): User {
  return {
    login: u.login,
    avatarUrl: u.avatar_url,
    publicRepos: 0,
  }
}

export function giteaStarredToStarredEntry(hostId: string, r: GiteaRepo): StarredEntry {
  return {
    starredAt: r.updated_at,
    repo: giteaRepoToRepo(hostId, r),
  }
}
