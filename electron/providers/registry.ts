// electron/providers/registry.ts
//
// Maps a hostId to its concrete provider instance.
//
// Phase 1 added GitHub. Phase 4 widened the registry to also know about GitLab —
// both gitlab.com (seeded) and any self-hosted instance the user adds later via
// the Connections pane. Phase 5 appends Gitea the same way: gt:codeberg.org is
// seeded on first launch, and any user-added gt: instance lazily resolves through
// the same hostConfig lookup.
//
// Two accessors are exposed:
//   - getProvider(hostId)     → GitHubProvider | null
//     Legacy callers (electron/main.ts, electron/ipc/repoHandlers.ts) call
//     GitHub-specific methods (getRepoTree, getProfileUser, getUserFollowing…)
//     that don't exist on GitLab or Gitea. This accessor returns null for
//     non-GitHub hosts so those paths surface "Unknown host" rather than
//     method-not-found at runtime. Phase 6 widens these paths when multi-host
//     browsing lands.
//   - getAnyProvider(hostId)  → AnyProvider | null
//     Host-management code (electron/ipc/hostHandlers.ts) treats every
//     provider uniformly: getCurrentUser/startDeviceFlow/pollDeviceToken/
//     capabilities all exist on every class. This accessor returns whatever
//     provider matches the hostId.

import { HOST_ID_GITHUB } from './types'
import { GitHubProvider, githubProvider } from './github'
import { GitLabProvider } from './gitlab'
import { GiteaProvider } from './gitea'
import { getHost } from './hostConfig'

export type AnyProvider = GitHubProvider | GitLabProvider | GiteaProvider

const githubProviders = new Map<string, GitHubProvider>()
const gitlabProviders = new Map<string, GitLabProvider>()
const giteaProviders = new Map<string, GiteaProvider>()

function resolveAny(hostId: string): AnyProvider | null {
  if (hostId === HOST_ID_GITHUB) return githubProvider

  if (hostId.startsWith('gh:')) {
    const cached = githubProviders.get(hostId)
    if (cached) return cached
    const host = getHost(hostId)
    if (!host || host.type !== 'github') return null
    const inst = new GitHubProvider(hostId, host.baseUrl)
    githubProviders.set(hostId, inst)
    return inst
  }

  if (hostId.startsWith('gl:')) {
    const cached = gitlabProviders.get(hostId)
    if (cached) return cached
    const host = getHost(hostId)
    if (!host || host.type !== 'gitlab') return null
    const inst = new GitLabProvider(hostId, host.baseUrl)
    gitlabProviders.set(hostId, inst)
    return inst
  }

  if (hostId.startsWith('gt:')) {
    const cached = giteaProviders.get(hostId)
    if (cached) return cached
    const host = getHost(hostId)
    if (!host || host.type !== 'gitea') return null
    const inst = new GiteaProvider(hostId, host.baseUrl)
    giteaProviders.set(hostId, inst)
    return inst
  }

  return null
}

export function getProvider(hostId: string): GitHubProvider | null {
  const p = resolveAny(hostId)
  return p instanceof GitHubProvider ? p : null
}

export function getAnyProvider(hostId: string): AnyProvider | null {
  return resolveAny(hostId)
}

export function getDefaultProvider(): GitHubProvider {
  return githubProvider
}

/**
 * Test-only: drop the lazy GitLab provider cache so a subsequent test can
 * resolve a fresh provider against a freshly-set hostConfig backend. Without
 * this, cross-file test pollution can keep a provider bound to a previous
 * test's baseUrl.
 */
export function _resetGitLabCacheForTest(): void {
  gitlabProviders.clear()
}

/**
 * Test-only: drop the lazy GHE provider cache. The public-instance
 * singleton (`githubProvider`) is never cached here, so this only
 * affects user-added GitHub Enterprise hosts.
 */
export function _resetGitHubCacheForTest(): void {
  githubProviders.clear()
}

/**
 * Test-only: drop the lazy Gitea provider cache. See `_resetGitLabCacheForTest`
 * for the same rationale.
 */
export function _resetGiteaCacheForTest(): void {
  giteaProviders.clear()
}
