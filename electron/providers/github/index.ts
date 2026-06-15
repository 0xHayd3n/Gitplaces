// electron/providers/github/index.ts
//
// GitHubProvider wraps the REST + GraphQL helpers into a class so the
// ProviderRegistry can address them through a single object handle.
//
// Phase 8: the class takes a `hostId + baseUrl` in its constructor so the
// registry can mint per-hostId instances (mirroring GitLab/Gitea). Public
// instance (`api.github.com`) uses the singleton `githubProvider` exported
// at the bottom; GitHub Enterprise hosts get fresh instances per hostId
// from the registry.
//
// PHASE 9 FOLLOW-UP: legacy free-function callers in electron/anatomy/,
// electron/services/{download,plugin-import,skill-sync,notes-sync,update,
// agents-backup,repo-security,repo-stats}.ts and electron/skill-gen/
// hard-code the default public-instance baseUrl via the underlying free
// functions. They aren't part of the GHE repo browsing surface; widening
// them is its own scope.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import * as graphql from './graphql'
import { graphqlEndpointFor } from './graphql'
import { githubUserToUser, githubRepoToRepo, githubStarredToStarredEntry } from './normalize'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
import type { User, Repo, StarredEntry } from '../../../src/types/repo'

const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: true,
  codeScanningAlerts: true,
  events: true,
  trendingDiscovery: true,
  graphqlBundle: true,
  isVerifiedOrg: true,
}

export class GitHubProvider {
  readonly hostId: string
  readonly hostType = 'github' as const
  readonly baseUrl: string
  readonly graphqlUrl: string

  constructor(hostId: string = HOST_ID_GITHUB, baseUrl: string = 'https://api.github.com') {
    this.hostId = hostId
    this.baseUrl = baseUrl
    this.graphqlUrl = graphqlEndpointFor(baseUrl)
  }

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  //
  // GHE OAuth Device Flow is intentionally out of scope. The device-flow
  // endpoints hit github.com directly (not the API base) and PAT-only auth
  // matches the established GitLab/Gitea pattern for self-hosted instances.
  startDeviceFlow = rest.startDeviceFlow
  pollDeviceToken = rest.pollDeviceToken

  getUser(token: string) { return rest.getUser(token, this.baseUrl) }

  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getUser(token, this.baseUrl)
    return githubUserToUser(raw)
  }

  // ── Canonical-shape repo wrappers ──────────────────────────────
  async getRepoNormalized(
    token: string | null,
    owner: string,
    name: string,
    db?: Database.Database,
  ): Promise<Repo> {
    const raw = await rest.getRepo(token, owner, name, db, this.baseUrl)
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
    const items = await rest.searchRepos(token, query, perPage, sort, order, page, this.baseUrl)
    return items.map(githubRepoToRepo)
  }

  async getStarredNormalized(token: string): Promise<StarredEntry[]> {
    const raw = await rest.getStarred(token, this.baseUrl)
    return raw.map(githubStarredToStarredEntry)
  }

  // ── Repo metadata ──────────────────────────────────────────────
  getRepo(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getRepo(token, owner, name, db, this.baseUrl)
  }
  searchRepos(token: string | null, query: string, perPage = 100, sort = 'stars', order = 'desc', page = 1) {
    return rest.searchRepos(token, query, perPage, sort, order, page, this.baseUrl)
  }
  getDefaultBranch(token: string | null, owner: string, name: string) {
    return rest.getDefaultBranch(token, owner, name, this.baseUrl)
  }
  getReadme(token: string | null, owner: string, name: string, ref?: string) {
    return rest.getReadme(token, owner, name, ref, this.baseUrl)
  }
  getReleases(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getReleases(token, owner, name, db, this.baseUrl)
  }
  getCompare(token: string | null, owner: string, name: string, base: string, head: string) {
    return rest.getCompare(token, owner, name, base, head, this.baseUrl)
  }
  compareRefs(token: string | null, owner: string, name: string, base: string, head: string) {
    return rest.compareRefs(token, owner, name, base, head, this.baseUrl)
  }

  // ── Content ────────────────────────────────────────────────────
  getRepoTree(token: string | null, owner: string, name: string, branch: string) {
    return rest.getRepoTree(token, owner, name, branch, this.baseUrl)
  }
  getFileContent(token: string | null, owner: string, name: string, path: string) {
    return rest.getFileContent(token, owner, name, path, this.baseUrl)
  }
  getFileContentWithSha(token: string | null, owner: string, name: string, path: string) {
    return rest.getFileContentWithSha(token, owner, name, path, this.baseUrl)
  }
  getBranch(token: string | null, owner: string, name: string, branch: string) {
    return rest.getBranch(token, owner, name, branch, this.baseUrl)
  }
  getTreeBySha(token: string | null, owner: string, name: string, treeSha: string) {
    return rest.getTreeBySha(token, owner, name, treeSha, this.baseUrl)
  }
  getRawFileBytes(token: string | null, owner: string, name: string, branch: string, path: string) {
    return rest.getRawFileBytes(token, owner, name, branch, path, this.baseUrl)
  }
  getBlobBySha(token: string | null, owner: string, name: string, blobSha: string) {
    return rest.getBlobBySha(token, owner, name, blobSha, this.baseUrl)
  }

  // ── Social ─────────────────────────────────────────────────────
  getStarred(token: string) { return rest.getStarred(token, this.baseUrl) }
  starRepo(token: string, owner: string, name: string) { return rest.starRepo(token, owner, name, this.baseUrl) }
  unstarRepo(token: string, owner: string, name: string) { return rest.unstarRepo(token, owner, name, this.baseUrl) }
  isRepoStarred(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.isRepoStarred(token, owner, name, db, this.baseUrl)
  }
  getReceivedEvents(token: string, username: string) {
    return rest.getReceivedEvents(token, username, undefined, this.baseUrl)
  }

  // ── Profile ────────────────────────────────────────────────────
  getProfileUser(token: string, username: string) {
    return rest.getProfileUser(token, username, this.baseUrl)
  }
  getUserRepos(token: string, username: string, sort = 'stars') {
    return rest.getUserRepos(token, username, sort, this.baseUrl)
  }
  getMyRepos(token: string) {
    return rest.getMyRepos(token, this.baseUrl)
  }
  getUserStarred(token: string, username: string) {
    return rest.getUserStarred(token, username, this.baseUrl)
  }
  getUserFollowing(token: string, username: string) {
    return rest.getUserFollowing(token, username, this.baseUrl)
  }
  getUserFollowers(token: string, username: string) {
    return rest.getUserFollowers(token, username, this.baseUrl)
  }
  checkIsFollowing(token: string, username: string) {
    return rest.checkIsFollowing(token, username, this.baseUrl)
  }
  followUser(token: string, username: string) {
    return rest.followUser(token, username, this.baseUrl)
  }
  unfollowUser(token: string, username: string) {
    return rest.unfollowUser(token, username, this.baseUrl)
  }
  getOrgVerified(token: string | null, orgLogin: string) {
    return rest.getOrgVerified(token, orgLogin, this.baseUrl)
  }

  // ── Write ──────────────────────────────────────────────────────
  createRepo(token: string, name: string) {
    return rest.createRepo(token, name, this.baseUrl)
  }
  putFileContents(token: string, owner: string, name: string, path: string, content: string, message: string, sha?: string) {
    return rest.putFileContents(token, owner, name, path, content, message, sha, this.baseUrl)
  }

  // ── Topics ─────────────────────────────────────────────────────
  fetchGitHubTopics(token: string) {
    return rest.fetchGitHubTopics(token, this.baseUrl)
  }

  // ── GraphQL bundle ─────────────────────────────────────────────
  fetchRepoBundle(db: Database.Database, token: string, owner: string, name: string) {
    return graphql.fetchRepoBundle(db, token, owner, name, this.graphqlUrl)
  }
  fetchLastCommitsForPaths(token: string, owner: string, name: string, ref: string, paths: string[]) {
    return graphql.fetchLastCommitsForPaths(token, owner, name, ref, paths, this.graphqlUrl)
  }
}

// Singleton instance for the public github.com host. Legacy free-function
// callers (anatomy/staleness, plugin import, skill sync, etc.) keep using
// the underlying free functions with the default baseUrl — PHASE 9 FOLLOW-UP
// can widen those callers to use a per-hostId provider too.
export const githubProvider = new GitHubProvider()

// Re-export the underlying free functions so any caller using
// `import { getRepo } from '.../providers/github'` continues to compile.
export * from './rest'
export * from './graphql'

// Re-export the host-id constant for convenience.
export { HOST_ID_GITHUB } from '../types'
