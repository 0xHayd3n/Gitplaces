// electron/providers/gitlab/index.ts
//
// GitLabProvider wraps the lifted REST helpers + the gitlab→canonical
// normalizers into one class so the ProviderRegistry can address GitLab
// instances through a uniform handle. Both gitlab.com and self-hosted
// GitLab instances use this single class — the constructor's baseUrl
// parameter is the only thing that differs.
//
// Phase 4 does not exercise repo-browsing methods through the renderer.
// They exist so the class surface matches GitHubProvider (the registry
// returns a union of the two) and so Phase 6 can wire them up without
// further provider-layer churn.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import {
  gitlabProjectToRepo,
  gitlabReleaseToRelease,
  gitlabUserToUser,
  gitlabStarredToStarredEntry,
} from './normalize'
import type { ProviderCapabilities } from '../types'
import type { Repo, Release, User, StarredEntry } from '../../../src/types/repo'

const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: false,
  codeScanningAlerts: false,
  events: false,
  trendingDiscovery: true,
  graphqlBundle: false,
  isVerifiedOrg: false,
}

export class GitLabProvider {
  readonly hostType = 'gitlab' as const

  constructor(
    public readonly hostId: string,
    public readonly baseUrl: string,
  ) {}

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getCurrentUser(this.baseUrl, token)
    return gitlabUserToUser(raw)
  }

  /** GitLab has no device-flow equivalent in v4. The Connections pane drives
   *  PAT entry directly via `hosts:setToken`. This method exists only so the
   *  shared `AnyProvider` union has a callable `startDeviceFlow` — if any caller
   *  ever invokes it for a GitLab host, throwing a clear error is the right
   *  outcome. */
  startDeviceFlow(): Promise<never> {
    return Promise.reject(new Error('GitLab uses Personal Access Tokens; device flow is not supported.'))
  }

  pollDeviceToken(): Promise<never> {
    return Promise.reject(new Error('GitLab uses Personal Access Tokens; device flow is not supported.'))
  }

  // ── Repo metadata (Phase 6 wires these to the renderer) ────────
  async getRepo(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Repo> {
    const raw = await rest.getProject(this.baseUrl, token, owner, name)
    return gitlabProjectToRepo(this.hostId, raw)
  }

  async searchRepos(
    token: string | null,
    query: string,
    perPage = 100,
    sort = 'stars',
    order = 'desc',
    page = 1,
  ): Promise<Repo[]> {
    const projects = await rest.searchProjects(this.baseUrl, token, query, perPage, sort, order, page)
    return projects.map(p => gitlabProjectToRepo(this.hostId, p))
  }

  getDefaultBranch(token: string | null, owner: string, name: string): Promise<string> {
    return rest.getDefaultBranch(this.baseUrl, token, owner, name)
  }

  getReadme(token: string | null, owner: string, name: string, ref?: string): Promise<string | null> {
    return rest.getReadme(this.baseUrl, token, owner, name, ref)
  }

  async getReleases(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Release[]> {
    const rels = await rest.getReleases(this.baseUrl, token, owner, name)
    return rels.map(gitlabReleaseToRelease)
  }

  getFileContent(token: string | null, owner: string, name: string, path: string, ref?: string): Promise<string | null> {
    return rest.getFileContent(this.baseUrl, token, owner, name, path, ref)
  }

  getBranch(token: string | null, owner: string, name: string, branch: string) {
    return rest.getBranch(this.baseUrl, token, owner, name, branch)
  }

  getTreeBySha(token: string | null, owner: string, name: string, treeSha: string) {
    return rest.getTreeBySha(this.baseUrl, token, owner, name, treeSha)
  }

  getBlobBySha(token: string | null, owner: string, name: string, blobSha: string) {
    return rest.getBlobBySha(this.baseUrl, token, owner, name, blobSha)
  }

  getRawFileBytes(token: string | null, owner: string, name: string, ref: string, path: string) {
    return rest.getRawFileBytes(this.baseUrl, token, owner, name, ref, path)
  }

  // ── Social ─────────────────────────────────────────────────────
  starRepo(token: string, owner: string, name: string): Promise<void> {
    return rest.starProject(this.baseUrl, token, owner, name)
  }

  unstarRepo(token: string, owner: string, name: string): Promise<void> {
    return rest.unstarProject(this.baseUrl, token, owner, name)
  }

  async getStarred(token: string): Promise<StarredEntry[]> {
    const projects = await rest.getStarredProjects(this.baseUrl, token)
    return projects.map(p => gitlabStarredToStarredEntry(this.hostId, p))
  }

  isRepoStarred(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<boolean> {
    return rest.isProjectStarred(this.baseUrl, token, owner, name)
  }
}

// Re-export the underlying types so callers can `import type` from the barrel.
export type {
  GitLabUser,
  GitLabProject,
  GitLabRelease,
  GitLabReleaseAssetLink,
  GitLabBranch,
  GitLabTreeEntry,
  GitLabBlob,
} from './rest'
