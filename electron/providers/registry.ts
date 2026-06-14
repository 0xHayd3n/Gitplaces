// electron/providers/registry.ts
//
// Maps a hostId to its concrete provider instance.
//
// Phase 1 added GitHub. Phase 4 widens the union to include GitLab — both
// gitlab.com (seeded) and any self-hosted instance the user adds later via
// the Connections pane (Phase 7). GitLab providers are constructed lazily
// from `HostInstance.baseUrl` so the registry doesn't need a build-time
// list of self-hosted hosts.
//
// Phase 5 will append Gitea to the union the same way.

import { HOST_ID_GITHUB } from './types'
import { GitHubProvider, githubProvider } from './github'
import { GitLabProvider } from './gitlab'
import { getHost } from './hostConfig'

export type AnyProvider = GitHubProvider | GitLabProvider

const gitlabProviders = new Map<string, GitLabProvider>()

export function getProvider(hostId: string): AnyProvider | null {
  if (hostId === HOST_ID_GITHUB) return githubProvider

  if (hostId.startsWith('gl:')) {
    const cached = gitlabProviders.get(hostId)
    if (cached) return cached
    const host = getHost(hostId)
    if (!host || host.type !== 'gitlab') return null
    const inst = new GitLabProvider(hostId, host.baseUrl)
    gitlabProviders.set(hostId, inst)
    return inst
  }

  return null
}

export function getDefaultProvider(): GitHubProvider {
  return githubProvider
}
