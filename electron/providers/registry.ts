// electron/providers/registry.ts
//
// Maps a hostId to its concrete provider instance. Phase 1 only knows about
// the GitHub provider. Phases 4–5 register GitLab and Gitea providers; the
// shape of registerProvider() is stable so they can plug in without churn.

import { HOST_ID_GITHUB } from './types'
import { GitHubProvider, githubProvider } from './github'

type AnyProvider = GitHubProvider  // Phase 2 widens this to RepoProvider

const providers = new Map<string, AnyProvider>([[HOST_ID_GITHUB, githubProvider]])

export function getProvider(hostId: string): AnyProvider | null {
  return providers.get(hostId) ?? null
}

export function getDefaultProvider(): AnyProvider {
  const p = providers.get(HOST_ID_GITHUB)
  if (!p) throw new Error('default provider missing from registry — this is a bug')
  return p
}
