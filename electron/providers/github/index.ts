// electron/providers/github/index.ts
//
// GitHubProvider wraps the lifted REST + GraphQL helpers into a class so the
// ProviderRegistry can address them through a single object handle. Phase 1
// keeps the method signatures identical to the underlying free functions so
// IPC handlers and other call sites translate one-for-one.
//
// The free functions are also re-exported from here so any callers that still
// import them by name (after Task 8's path sweep) work without further churn.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import * as graphql from './graphql'
import { githubUserToUser, githubRepoToRepo } from './normalize'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
import type { User, Repo } from '../../../src/types/repo'

const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: true,
  codeScanningAlerts: true,
  events: true,
  trendingDiscovery: true,
  graphqlBundle: true,
  isVerifiedOrg: true,
}

export class GitHubProvider {
  readonly hostId = HOST_ID_GITHUB
  readonly hostType = 'github' as const
  readonly baseUrl = 'https://api.github.com'

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  startDeviceFlow = rest.startDeviceFlow
  pollDeviceToken = rest.pollDeviceToken
  getUser = rest.getUser

  /** Canonical-shape current user fetch. Wraps the legacy `getUser` so the
   *  IPC layer no longer has to know about provider-native shapes. */
  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getUser(token)
    return githubUserToUser(raw)
  }

  // ── Canonical-shape repo wrappers ──────────────────────────────
  //
  // GitLab/Gitea providers return canonical `Repo` directly. These wrappers
  // give the GitHub provider the same surface so repoHandlers consumes one
  // shape regardless of host. The raw `getRepo` / `searchRepos` methods stay
  // for GraphQL bundle paths and any callers that still need GitHub-native
  // fields (`stargazers_count`, `license.spdx_id`, etc.).

  async getRepoNormalized(
    token: string | null,
    owner: string,
    name: string,
    db?: Database.Database,
  ): Promise<Repo> {
    const raw = await rest.getRepo(token, owner, name, db)
    return githubRepoToRepo(raw)
  }

  async searchReposNormalized(
    token: string | null,
    query: string,
    perPage = 100,
    sort = 'stars',
    order = 'desc',
    page = 1,
  ): Promise<Repo[]> {
    const items = await rest.searchRepos(token, query, perPage, sort, order, page)
    return items.map(githubRepoToRepo)
  }

  // ── Repo metadata ──────────────────────────────────────────────
  getRepo(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getRepo(token, owner, name, db)
  }
  searchRepos = rest.searchRepos
  getDefaultBranch = rest.getDefaultBranch
  getReadme = rest.getReadme
  getReleases(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getReleases(token, owner, name, db)
  }
  getCompare = rest.getCompare
  compareRefs = rest.compareRefs

  // ── Content ────────────────────────────────────────────────────
  getRepoTree = rest.getRepoTree
  getFileContent = rest.getFileContent
  getFileContentWithSha = rest.getFileContentWithSha
  getBranch = rest.getBranch
  getTreeBySha = rest.getTreeBySha
  getRawFileBytes = rest.getRawFileBytes
  getBlobBySha = rest.getBlobBySha

  // ── Social ─────────────────────────────────────────────────────
  getStarred = rest.getStarred
  starRepo = rest.starRepo
  unstarRepo = rest.unstarRepo
  isRepoStarred(
    token: string | null,
    owner: string,
    name: string,
    db?: Database.Database,
  ) {
    return rest.isRepoStarred(token, owner, name, db)
  }
  getReceivedEvents = rest.getReceivedEvents

  // ── Profile ────────────────────────────────────────────────────
  getProfileUser = rest.getProfileUser
  getUserRepos = rest.getUserRepos
  getMyRepos = rest.getMyRepos
  getUserStarred = rest.getUserStarred
  getUserFollowing = rest.getUserFollowing
  getUserFollowers = rest.getUserFollowers
  checkIsFollowing = rest.checkIsFollowing
  followUser = rest.followUser
  unfollowUser = rest.unfollowUser
  getOrgVerified = rest.getOrgVerified

  // ── Write ──────────────────────────────────────────────────────
  createRepo = rest.createRepo
  putFileContents = rest.putFileContents

  // ── Topics ─────────────────────────────────────────────────────
  fetchGitHubTopics = rest.fetchGitHubTopics

  // ── GraphQL bundle ─────────────────────────────────────────────
  fetchRepoBundle = graphql.fetchRepoBundle
  fetchLastCommitsForPaths = graphql.fetchLastCommitsForPaths
}

// Singleton instance used by the registry.
export const githubProvider = new GitHubProvider()

// Re-export the underlying free functions so any caller using
// `import { getRepo } from '.../providers/github'` continues to compile.
export * from './rest'
export * from './graphql'

// Re-export the host-id constant for convenience.
export { HOST_ID_GITHUB } from '../types'
