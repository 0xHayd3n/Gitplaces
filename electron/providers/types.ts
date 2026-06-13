// electron/providers/types.ts
//
// Shared types for the provider layer. Phase 1 only uses HostType, HostInstance,
// the HOST_ID_GITHUB constant, and a placeholder ProviderCapabilities. The full
// RepoProvider interface and normalized Repo shape are added in Phase 2 when the
// renderer migrates off the GitHubRepo shape.

export type HostType = 'github' | 'gitlab' | 'gitea'

export interface HostInstance {
  /** Deterministic ID: `${typePrefix}:${baseUrlHost}`, e.g. `gh:api.github.com`. */
  id: string
  type: HostType
  /** API base URL, e.g. `https://api.github.com`. */
  baseUrl: string
  /** User-editable display name, e.g. `GitHub`, `GitLab.com`, `Codeberg`. */
  label: string
  /** ISO 8601 timestamp the user added this instance (or first-launch seed). */
  addedAt: string
  /** Optional UI hint for self-hosted instances pointing at a separate web UI. */
  webUrl?: string
}

export interface ProviderCapabilities {
  vulnerabilityAlerts: boolean
  codeScanningAlerts: boolean
  events: boolean
  trendingDiscovery: boolean
  graphqlBundle: boolean
  isVerifiedOrg: boolean
}

export const HOST_ID_GITHUB = 'gh:api.github.com'

/** Computes a deterministic host ID from a host type and base URL. */
export function computeHostId(type: HostType, baseUrl: string): string {
  const prefix = type === 'github' ? 'gh' : type === 'gitlab' ? 'gl' : 'gt'
  const host = baseUrl
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  return `${prefix}:${host}`
}
