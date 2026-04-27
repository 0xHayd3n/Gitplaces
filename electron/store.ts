import Store from 'electron-store'

interface GitHubStoreSchema {
  'github.token'?: string
  'github.username'?: string
  'github.avatarUrl'?: string
}

const githubStore = new Store<GitHubStoreSchema>()

export function getToken(): string | undefined {
  return githubStore.get('github.token')
}

export function setToken(token: string): void {
  githubStore.set('github.token', token)
}

export function clearToken(): void {
  githubStore.delete('github.token')
}

export function getGitHubUser(): { username: string; avatarUrl: string } | undefined {
  const username = githubStore.get('github.username')
  const avatarUrl = githubStore.get('github.avatarUrl')
  if (!username) return undefined
  return { username, avatarUrl: avatarUrl ?? '' }
}

export function setGitHubUser(username: string, avatarUrl: string): void {
  githubStore.set('github.username', username)
  githubStore.set('github.avatarUrl', avatarUrl)
}

export function clearGitHubUser(): void {
  githubStore.delete('github.username')
  githubStore.delete('github.avatarUrl')
}

interface ApiStoreSchema {
  'anthropic.apiKey'?: string
}

const apiStore = new Store<ApiStoreSchema>({ encryptionKey: 'git-suite-api-key-v1' })

export function getApiKey(): string | undefined {
  return apiStore.get('anthropic.apiKey')
}

export function setApiKey(key: string): void {
  apiStore.set('anthropic.apiKey', key)
}

interface SkillSyncStoreSchema {
  'skillSync.enabled': boolean
  'skillSync.repoOwner'?: string
}

const skillSyncStore = new Store<SkillSyncStoreSchema>()

export function getSyncEnabled(): boolean {
  return skillSyncStore.get('skillSync.enabled', false)
}

export function setSyncEnabled(v: boolean): void {
  skillSyncStore.set('skillSync.enabled', v)
}

export function getSyncRepoOwner(): string | undefined {
  return skillSyncStore.get('skillSync.repoOwner')
}

export function setSyncRepoOwner(v: string): void {
  skillSyncStore.set('skillSync.repoOwner', v)
}
