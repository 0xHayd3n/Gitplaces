// electron/providers/gitea/index.ts
//
// GiteaProvider wraps the lifted REST helpers + the gitea→canonical
// normalizers into one class so the ProviderRegistry can address Gitea
// instances through a uniform handle. Both codeberg.org and self-hosted
// Gitea instances use this single class — the constructor's baseUrl
// parameter is the only thing that differs.
//
// Phase 5 does not exercise repo-browsing methods through the renderer.
// They exist so the class surface matches GitLabProvider (the registry
// returns a union of the three) and so Phase 6 can wire them up without
// further provider-layer churn.

import type Database from 'better-sqlite3'
import * as rest from './rest'
import {
  giteaRepoToRepo,
  giteaReleaseToRelease,
  giteaUserToUser,
  giteaStarredToStarredEntry,
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

export class GiteaProvider {
  readonly hostType = 'gitea' as const

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
    return giteaUserToUser(raw)
  }

  /** Gitea has no device-flow equivalent in v1. The Connections pane drives
   *  PAT entry directly via `hosts:setToken`. This method exists only so the
   *  shared `AnyProvider` union has a callable `startDeviceFlow` — if any caller
   *  ever invokes it for a Gitea host, throwing a clear error is the right
   *  outcome. */
  startDeviceFlow(): Promise<never> {
    return Promise.reject(new Error('Gitea uses Personal Access Tokens; device flow is not supported.'))
  }

  pollDeviceToken(): Promise<never> {
    return Promise.reject(new Error('Gitea uses Personal Access Tokens; device flow is not supported.'))
  }

  // ── Repo metadata (Phase 6 wires these to the renderer) ────────
  async getRepo(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Repo> {
    const raw = await rest.getRepo(this.baseUrl, token, owner, name)
    return giteaRepoToRepo(this.hostId, raw)
  }

  async searchRepos(
    token: string | null,
    query: string,
    perPage = 50,
    sort = 'stars',
    order = 'desc',
    page = 1,
  ): Promise<Repo[]> {
    const repos = await rest.searchRepos(this.baseUrl, token, query, perPage, sort, order, page)
    return repos.map(r => giteaRepoToRepo(this.hostId, r))
  }

  getDefaultBranch(token: string | null, owner: string, name: string): Promise<string> {
    return rest.getDefaultBranch(this.baseUrl, token, owner, name)
  }

  getReadme(token: string | null, owner: string, name: string, ref?: string): Promise<string | null> {
    return rest.getReadme(this.baseUrl, token, owner, name, ref)
  }

  async getReleases(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<Release[]> {
    const rels = await rest.getReleases(this.baseUrl, token, owner, name)
    return rels.map(giteaReleaseToRelease)
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
    return rest.starRepo(this.baseUrl, token, owner, name)
  }

  unstarRepo(token: string, owner: string, name: string): Promise<void> {
    return rest.unstarRepo(this.baseUrl, token, owner, name)
  }

  async getStarred(token: string): Promise<StarredEntry[]> {
    const repos = await rest.getStarredRepos(this.baseUrl, token)
    return repos.map(r => giteaStarredToStarredEntry(this.hostId, r))
  }

  isRepoStarred(token: string | null, owner: string, name: string, _db?: Database.Database): Promise<boolean> {
    return rest.isRepoStarred(this.baseUrl, token, owner, name)
  }
}

// Re-export the underlying types so callers can `import type` from the barrel.
export type {
  GiteaUser,
  GiteaRepo,
  GiteaRelease,
  GiteaReleaseAsset,
  GiteaBranch,
  GiteaTreeEntry,
  GiteaBlob,
} from './rest'
