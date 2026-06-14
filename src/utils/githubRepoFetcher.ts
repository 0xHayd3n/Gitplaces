// ── GitHub repo preview cache + IPC bridge ────────────────────────────────────
// Module-level singleton: survives React re-renders, shared across all
// ReadmeRenderer instances in the same renderer process.
// Mirrors the structure of linkPreviewFetcher.ts.

export interface GitHubRepoPreview {
  owner:       string
  name:        string
  description: string
  stars:       number
  avatarUrl:   string
}

const cache    = new Map<string, GitHubRepoPreview>()
const inflight = new Map<string, Promise<GitHubRepoPreview>>()

function cacheKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`
}

function placeholder(owner: string, name: string): GitHubRepoPreview {
  return { owner: owner.toLowerCase(), name: name.toLowerCase(), description: '', stars: 0, avatarUrl: '' }
}

/** Synchronous cache read — returns undefined if not yet fetched. */
export function getCachedRepoPreview(owner: string, name: string): GitHubRepoPreview | undefined {
  return cache.get(cacheKey(owner, name))
}

/**
 * Fetch repo metadata for `owner/name`.
 * - Returns cached value immediately if already fetched.
 * - Deduplicates concurrent requests (one IPC call max per repo).
 * - Never throws — returns a placeholder on any error or null result.
 */
export async function fetchRepoPreview(owner: string, name: string): Promise<GitHubRepoPreview> {
  const key = cacheKey(owner, name)

  const cached = cache.get(key)
  if (cached) return cached

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    try {
      const row = await window.api.github.getRepo(owner, name)
      const result: GitHubRepoPreview = row
        ? {
            owner:       owner.toLowerCase(),
            name:        name.toLowerCase(),
            description: row.description ?? '',
            stars:       row.stars        ?? 0,
            avatarUrl:   row.ownerAvatarUrl ?? '',
          }
        : placeholder(owner, name)
      cache.set(key, result)
      return result
    } catch {
      const fallback = placeholder(owner, name)
      cache.set(key, fallback)
      return fallback
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}
