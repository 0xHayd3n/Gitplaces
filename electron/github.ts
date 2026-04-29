export const CLIENT_ID = 'Ov23liJxy53KWDh27mQx'
const BASE = 'https://api.github.com'
const SCOPE = 'read:user,repo'

// Accept null — omit Authorization header for unauthenticated calls (60 req/hr)
export function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export interface GitHubUser {
  login: string
  avatar_url: string
  public_repos: number
}

export interface GitHubRepo {
  id: number
  full_name: string
  name: string
  html_url: string
  owner: { login: string; avatar_url: string }
  description: string | null
  language: string | null
  topics: string[]
  stargazers_count: number
  forks_count: number
  watchers_count: number
  open_issues_count: number
  size: number
  license: { spdx_id: string } | null
  homepage: string | null
  updated_at: string
  pushed_at: string
  created_at: string
  default_branch: string
  archived: boolean
}

export interface GitHubReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  download_count: number
}

export interface GitHubRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  assets: GitHubReleaseAsset[]
  prerelease: boolean
}

export interface GitHubStarredRepo {
  starred_at: string
  repo: GitHubRepo
}

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

export interface BlobResult {
  content: string
  rawBase64: string
  size: number
}

// ── Activity Feed ─────────────────────────────────────────────────

export interface GitHubEventActor {
  login: string
  avatar_url: string
}

export interface GitHubEventRepo {
  full_name: string  // GitHub API field is called "name" but holds "owner/repo" slug
}

export type GitHubEventPayload =
  | { type: 'WatchEvent'; action: 'started' }
  | { type: 'ForkEvent'; forkee: { full_name: string } }
  | {
      type: 'ReleaseEvent'
      action: 'published'
      release: {
        tag_name: string
        name?: string | null
        body?: string | null
        prerelease?: boolean | null
      }
    }
  | {
      type: 'PullRequestEvent'
      action: 'closed'
      pull_request: {
        merged: boolean
        title: string
        number: number
        body?: string | null
        user: { login: string; avatar_url: string }
        base: { sha: string; ref: string }
        head: { sha: string; ref: string }
      }
    }

export interface GitHubEvent {
  id: string
  type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
  actor: GitHubEventActor
  repo: GitHubEventRepo
  payload: GitHubEventPayload
  created_at: string
}

const HIGH_SIGNAL = new Set(['WatchEvent', 'ForkEvent', 'ReleaseEvent', 'PullRequestEvent'])

const RECEIVED_EVENTS_MAX_PAGES = 5
const RECEIVED_EVENTS_DEFAULT_CUTOFF_MS = 90 * 24 * 60 * 60 * 1000

type RawReceivedEvent = {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  repo: { name: string }
  payload: Record<string, unknown>
  created_at: string
}

function mapReceivedEvents(raw: RawReceivedEvent[]): GitHubEvent[] {
  return raw
    .filter(e => HIGH_SIGNAL.has(e.type))
    .filter(e => {
      if (e.type === 'PullRequestEvent') {
        const pr = e.payload as { action?: string; pull_request?: { merged?: boolean } }
        return pr.action === 'closed' && pr.pull_request?.merged === true
      }
      return true
    })
    .map(e => ({
      id: e.id,
      type: e.type as GitHubEvent['type'],
      actor: e.actor,
      repo: { full_name: e.repo.name },
      payload: { type: e.type, ...e.payload } as GitHubEventPayload,
      created_at: e.created_at,
    }))
}

export async function getReceivedEvents(
  token: string,
  username: string,
  cutoffMs: number = RECEIVED_EVENTS_DEFAULT_CUTOFF_MS,
): Promise<GitHubEvent[]> {
  const cutoff = Date.now() - cutoffMs
  const collected: GitHubEvent[] = []
  let url: string | null = `${BASE}/users/${encodeURIComponent(username)}/received_events?per_page=30`
  let pagesFetched = 0

  while (url && pagesFetched < RECEIVED_EVENTS_MAX_PAGES) {
    let res: Response
    try {
      res = await fetch(url, { headers: githubHeaders(token) })
    } catch (err) {
      if (pagesFetched === 0) throw err
      break // network failure on later page → return what we have
    }
    if (!res.ok) {
      if (pagesFetched === 0) throw new Error(`GitHub API error: ${res.status}`)
      break // rate limit or transient on later page → return what we have
    }

    const raw = await res.json() as RawReceivedEvent[]
    pagesFetched++
    collected.push(...mapReceivedEvents(raw))

    // Empty page → nothing more to find, even if a next-link is present.
    if (raw.length === 0) break

    // Early termination when the oldest event in this page is past the cutoff.
    // GitHub returns events newest-first, so once we cross the line subsequent
    // pages can only contain older events.
    const oldestTime = new Date(raw[raw.length - 1].created_at).getTime()
    if (oldestTime < cutoff) break

    const link = res.headers.get('Link') ?? ''
    const match = link.match(/<([^>]+)>;\s*rel="next"/)
    url = match ? match[1] : null
  }

  return collected.filter(e => new Date(e.created_at).getTime() >= cutoff)
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${BASE}/user`, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<GitHubUser>
}

export async function getStarred(token: string): Promise<GitHubStarredRepo[]> {
  const results: GitHubStarredRepo[] = []
  let url: string | null = `${BASE}/user/starred?per_page=100`
  let pagesFetched = 0

  // Build headers manually — githubHeaders() uses application/vnd.github+json
  // but the star+json variant is required to receive the starred_at timestamp.
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.star+json',
    Authorization: `Bearer ${token}`,
  }

  while (url && pagesFetched < 10) {
    const res: Response = await fetch(url, { headers })
    if (!res.ok) {
      // DIAGNOSTIC: capture rate-limit headers + body so we can tell rate
      // limit vs. scope vs. token-revocation 403s apart.
      const body = await res.text().catch(() => '<unreadable>')
      console.error('[getStarred 403/error]', {
        status:    res.status,
        url,
        scopes:    res.headers.get('x-oauth-scopes'),
        accepted:  res.headers.get('x-accepted-oauth-scopes'),
        rlLimit:   res.headers.get('x-ratelimit-limit'),
        rlRemain:  res.headers.get('x-ratelimit-remaining'),
        rlReset:   res.headers.get('x-ratelimit-reset'),
        rlResource:res.headers.get('x-ratelimit-resource'),
        retryAfter:res.headers.get('retry-after'),
        body:      body.slice(0, 400),
      })
      throw new Error(`GitHub API error: ${res.status}`)
    }
    const data = (await res.json()) as GitHubStarredRepo[]
    results.push(...data)
    pagesFetched++
    const link: string = res.headers.get('Link') ?? ''
    const match: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/)
    url = match ? match[1] : null
  }

  return results
}

export async function getRepo(token: string | null, owner: string, name: string): Promise<GitHubRepo> {
  const res = await fetch(`${BASE}/repos/${owner}/${name}`, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<GitHubRepo>
}

export async function searchRepos(
  token: string | null,
  query: string,
  perPage = 100,
  sort = 'stars',
  order = 'desc',
  page = 1,
): Promise<GitHubRepo[]> {
  const url = `${BASE}/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${page}`
  const res = await fetch(url, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { items: GitHubRepo[] }
  return data.items
}

export async function getReadme(token: string | null, owner: string, name: string, ref?: string): Promise<string | null> {
  const url = ref
    ? `${BASE}/repos/${owner}/${name}/readme?ref=${encodeURIComponent(ref)}`
    : `${BASE}/repos/${owner}/${name}/readme`
  const res = await fetch(url, { headers: githubHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { content: string; encoding: string }
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

export async function getDefaultBranch(
  token: string | null,
  owner: string,
  name: string,
): Promise<string> {
  const repo = await getRepo(token, owner, name)
  return repo.default_branch ?? 'main'
}

export async function getReleases(token: string | null, owner: string, name: string): Promise<GitHubRelease[]> {
  const res = await fetch(`${BASE}/repos/${owner}/${name}/releases?per_page=10`, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<GitHubRelease[]>
}

// ── Compare (release before/after summary) ─────────────────────────
// Compact projection of GitHub's compare API. We intentionally drop the full
// commit and file lists from the response — release widgets only need totals
// and a top-N preview. Cache results in the main process keyed on the ref
// pair, since compare results between two immutable refs never change.

export interface CompareSummary {
  base: string
  head: string
  htmlUrl: string
  totalCommits: number
  filesChanged: number
  additions: number
  deletions: number
  topFiles: { filename: string; status: string; additions: number; deletions: number }[]
  topAuthors: { login: string; avatarUrl: string; commits: number }[]
}

export async function getCompare(
  token: string | null,
  owner: string,
  name: string,
  base: string,
  head: string,
): Promise<CompareSummary> {
  const url = `${BASE}/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  const res = await fetch(url, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json() as {
    html_url: string
    total_commits: number
    files?: Array<{ filename: string; status: string; additions: number; deletions: number }>
    commits?: Array<{ author?: { login: string; avatar_url: string } | null; committer?: { login: string; avatar_url: string } | null }>
  }

  const files = data.files ?? []
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0)
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0)

  // Top 5 files by total churn for an at-a-glance "what changed" preview.
  const topFiles = [...files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 5)
    .map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))

  // Aggregate author commit counts; prefer `author` (GitHub user) over `committer`.
  const authorCounts = new Map<string, { login: string; avatarUrl: string; commits: number }>()
  for (const c of data.commits ?? []) {
    const a = c.author ?? c.committer
    if (!a?.login) continue
    const existing = authorCounts.get(a.login)
    if (existing) existing.commits++
    else authorCounts.set(a.login, { login: a.login, avatarUrl: a.avatar_url, commits: 1 })
  }
  const topAuthors = [...authorCounts.values()]
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 5)

  return {
    base,
    head,
    htmlUrl: data.html_url,
    totalCommits: data.total_commits,
    filesChanged: files.length,
    additions,
    deletions,
    topFiles,
    topAuthors,
  }
}

export async function starRepo(token: string, owner: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/user/starred/${owner}/${name}`, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Length': '0' },
  })
  if (!res.ok && res.status !== 204) throw new Error(`GitHub API error: ${res.status}`)
}

export async function unstarRepo(token: string, owner: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/user/starred/${owner}/${name}`, {
    method: 'DELETE',
    headers: githubHeaders(token),
  })
  if (!res.ok && res.status !== 204) throw new Error(`GitHub API error: ${res.status}`)
}

export async function isRepoStarred(token: string | null, owner: string, name: string): Promise<boolean> {
  if (!token) return false
  const res = await fetch(`${BASE}/user/starred/${owner}/${name}`, {
    headers: githubHeaders(token),
  })
  return res.status === 204
}

// ── GitHub Device Flow ──────────────────────────────────────────
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
//
// Device flow authenticates without a client secret, which is ideal for
// desktop apps where an embedded secret is not actually confidential.
// Enable "Device flow" in the OAuth App settings at github.com/settings/developers.
//
// 1. POST /login/device/code → { device_code, user_code, verification_uri, interval }
// 2. App shows user_code; user visits verification_uri_complete and approves.
// 3. App polls /login/oauth/access_token every `interval` seconds until the
//    token is issued or the device_code expires (default 15 minutes).

export interface DeviceFlowStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

interface DeviceTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
  interval?: number
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  })
  if (!res.ok) throw new Error(`Device flow start failed: ${res.status}`)
  const data = (await res.json()) as DeviceCodeResponse & { error?: string; error_description?: string }
  if (data.error) {
    throw new Error(
      data.error === 'device_flow_disabled'
        ? 'Device Flow is not enabled on this OAuth App. Enable it at github.com/settings/developers.'
        : data.error_description ?? data.error
    )
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete ?? `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}`,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export async function pollDeviceToken(deviceCode: string, interval: number, signal?: AbortSignal): Promise<string> {
  // Poll at `interval` seconds; GitHub returns slow_down to ask us to back off.
  let delayMs = Math.max(1, interval) * 1000
  while (true) {
    if (signal?.aborted) throw new Error('Authentication cancelled')
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delayMs)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Authentication cancelled')) }, { once: true })
    })

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = (await res.json()) as DeviceTokenResponse

    if (data.access_token) return data.access_token

    switch (data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        // GitHub tells us the new minimum interval; add a small buffer.
        delayMs = ((data.interval ?? interval) + 1) * 1000
        continue
      case 'expired_token':
        throw new Error('The device code expired before you approved. Please try again.')
      case 'access_denied':
        throw new Error('Authorization was denied.')
      default:
        throw new Error(data.error_description ?? data.error ?? 'Device flow failed')
    }
  }
}

export async function fetchGitHubTopics(token: string): Promise<string[]> {
  const topics: string[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `${BASE}/search/topics?q=is:featured&per_page=100&page=${page}`,
      {
        headers: {
          ...githubHeaders(token),
          Accept: 'application/vnd.github.mercy-preview+json',
        },
      }
    )
    if (!res.ok) break
    const data = (await res.json()) as { items?: { name: string }[] }
    if (!data.items?.length) break
    topics.push(...data.items.map((t) => t.name))
    if (data.items.length < 100) break
    page++
  }

  return topics
}

// ── Profile API ───────────────────────────────────────────────────

export async function getProfileUser(token: string, username: string): Promise<any> {
  const res = await fetch(`${BASE}/users/${username}`, { headers: githubHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<any>
}

export async function getUserRepos(token: string, username: string, sort = 'stars'): Promise<any[]> {
  const res = await fetch(`${BASE}/users/${username}/repos?sort=${sort}&per_page=30&type=public`, {
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<any[]>
}

export async function getMyRepos(token: string): Promise<any[]> {
  const pages: any[] = []
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${BASE}/user/repos?type=all&sort=pushed&per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    })
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const batch = await res.json() as any[]
    pages.push(...batch)
    if (batch.length < 100) break
  }
  return pages
}

export async function getUserStarred(token: string, username: string): Promise<any[]> {
  const res = await fetch(`${BASE}/users/${username}/starred?per_page=30`, {
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<any[]>
}

export async function getUserFollowing(token: string, username: string): Promise<any[]> {
  const res = await fetch(`${BASE}/users/${username}/following?per_page=50`, {
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<any[]>
}

export async function getUserFollowers(token: string, username: string): Promise<any[]> {
  const res = await fetch(`${BASE}/users/${username}/followers?per_page=50`, {
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json() as Promise<any[]>
}

export async function checkIsFollowing(token: string, username: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/user/following/${username}`, {
      headers: githubHeaders(token),
    })
    return res.status === 204
  } catch {
    return false
  }
}

export async function followUser(token: string, username: string): Promise<void> {
  const res = await fetch(`${BASE}/user/following/${username}`, {
    method: 'PUT',
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
}

export async function unfollowUser(token: string, username: string): Promise<void> {
  const res = await fetch(`${BASE}/user/following/${username}`, {
    method: 'DELETE',
    headers: githubHeaders(token),
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
}

/**
 * Returns true if the given login is a GitHub organisation with verified domain ownership.
 * Returns false for individual users, non-existent logins, or any API error.
 */
export async function getOrgVerified(token: string | null, orgLogin: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/orgs/${orgLogin}`, { headers: githubHeaders(token) })
    if (!res.ok) return false
    const data = await res.json() as Record<string, unknown>
    return data.is_verified === true
  } catch {
    return false
  }
}

export async function getRepoTree(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
): Promise<{ path: string; type: string; sha: string }[]> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as {
    tree: { path: string; type: string; sha: string }[]
    truncated: boolean
  }
  if (data.truncated) throw new Error('Repo tree too large (GitHub truncated the response)')
  return data.tree
}

export async function getFileContent(
  token: string | null,
  owner: string,
  name: string,
  path: string,
): Promise<string | null> {
  // Do NOT encodeURIComponent(path) — that encodes '/' as '%2F' which causes a 404.
  // Path segments (owner, name) are already safe; path is a tree path like src/components/Button.tsx.
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/contents/${path}`,
    { headers: githubHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { content?: string; encoding?: string }
  if (!data.content || data.encoding !== 'base64') return null
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
}

export async function getBranch(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
): Promise<{ commitSha: string; rootTreeSha: string }> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as {
    commit: { sha: string; commit: { tree: { sha: string } } }
  }
  return { commitSha: data.commit.sha, rootTreeSha: data.commit.commit.tree.sha }
}

export async function getTreeBySha(
  token: string | null,
  owner: string,
  name: string,
  treeSha: string,
): Promise<TreeEntry[]> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/git/trees/${treeSha}`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { sha: string; tree: TreeEntry[]; truncated: boolean }
  return data.tree
}

/** Fetch raw file bytes via api.github.com (same domain as all other API calls).
 *  Uses the Contents API with raw media type — returns binary, no base64. */
export async function getRawFileBytes(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw+json',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(
      `${BASE}/repos/${owner}/${name}/contents/${path}?ref=${branch}`,
      { headers, signal: controller.signal },
    )
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const buf = await res.arrayBuffer()
    return Buffer.from(buf)
  } finally {
    clearTimeout(timeout)
  }
}

export async function getBlobBySha(
  token: string | null,
  owner: string,
  name: string,
  blobSha: string,
): Promise<BlobResult> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/git/blobs/${blobSha}`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { sha: string; content: string; encoding: string; size: number }
  const raw = data.content.replace(/\s/g, '')
  const content = Buffer.from(raw, 'base64').toString('utf-8')
  return { content, rawBase64: raw, size: data.size }
}

export async function createRepo(
  token: string,
  name: string
): Promise<{ html_url: string }> {
  const res = await fetch(`${BASE}/user/repos`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: true, auto_init: true })
  })
  if (!res.ok) throw new Error(`createRepo failed: ${res.status}`)
  return res.json() as Promise<{ html_url: string }>
}

export async function putFileContents(
  token: string,
  repoOwner: string,
  repoName: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<{ content: { sha: string } }> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64')
  }
  if (sha) body.sha = sha
  // Do NOT encodeURIComponent(path) — that encodes '/' as '%2F' causing a 404
  const res = await fetch(`${BASE}/repos/${repoOwner}/${repoName}/contents/${path}`, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`putFileContents failed: ${res.status}`)
  return res.json() as Promise<{ content: { sha: string } }>
}
