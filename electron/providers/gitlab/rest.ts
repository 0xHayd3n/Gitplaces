// electron/providers/gitlab/rest.ts
//
// REST helpers for a GitLab instance. The `baseUrl` argument is the API root
// (e.g. "https://gitlab.com" or "https://gitlab.acme.com") — every helper
// appends "/api/v4/..." internally. Auth is a Personal Access Token sent in
// the `PRIVATE-TOKEN` header. All helpers accept `token: string | null` so
// they can also drive unauthenticated requests (public projects).

// ── Types (provider-native; normalize.ts translates to canonical shapes) ────

export interface GitLabUser {
  id: number
  username: string
  name: string
  avatar_url: string
  web_url: string
}

export interface GitLabNamespace {
  id: number
  name: string
  path: string
  kind: 'user' | 'group'
  full_path: string
  avatar_url: string | null
}

export interface GitLabProjectLicense {
  key: string                // SPDX-ish, lowercase ("mit", "apache-2.0")
  name: string
  nickname: string | null
  html_url: string | null
  source_url: string | null
}

export interface GitLabProjectStatistics {
  commit_count: number
  storage_size: number
  repository_size: number   // bytes
  wiki_size: number
  lfs_objects_size: number
  job_artifacts_size: number
}

export interface GitLabProject {
  id: number
  description: string | null
  name: string
  path: string
  path_with_namespace: string
  default_branch: string | null
  topics: string[]
  web_url: string
  avatar_url: string | null
  star_count: number
  forks_count: number
  open_issues_count: number
  created_at: string
  last_activity_at: string
  updated_at: string
  archived: boolean
  visibility: 'private' | 'internal' | 'public'
  namespace: GitLabNamespace
  license?: GitLabProjectLicense | null
  statistics?: GitLabProjectStatistics
  readme_url?: string | null
}

export interface GitLabReleaseAssetLink {
  id: number
  name: string
  url: string
  direct_asset_url?: string
}

export interface GitLabReleaseAssets {
  count: number
  sources?: { format: string; url: string }[]
  links?: GitLabReleaseAssetLink[]
}

export interface GitLabRelease {
  tag_name: string
  name: string | null
  description: string | null
  released_at: string
  upcoming_release: boolean
  assets?: GitLabReleaseAssets
}

export interface GitLabBranch {
  name: string
  commit: { id: string; parent_ids: string[] }
  default?: boolean
}

export interface GitLabTreeEntry {
  id: string                 // git sha
  name: string
  type: 'blob' | 'tree'
  path: string
  mode: string
}

export interface GitLabBlob {
  size: number
  encoding: 'base64'
  content: string
  sha: string
}

export interface GitLabStarredProject extends GitLabProject {}

// ── Headers ─────────────────────────────────────────────────────────────────

export function gitlabHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['PRIVATE-TOKEN'] = token
  return headers
}

function api(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v4${path}`
}

function projectId(owner: string, name: string): string {
  return encodeURIComponent(`${owner}/${name}`)
}

async function readError(res: Response, op: string): Promise<Error> {
  let body: unknown = null
  try { body = await res.json() } catch { /* ignore */ }
  const detail = body && typeof body === 'object' && 'message' in body
    ? ` — ${String((body as { message: unknown }).message)}`
    : ''
  return new Error(`GitLab API error: ${res.status}${detail} (${op})`)
}

// ── Server version (probe target) ────────────────────────────────────────────

export async function getServerVersion(baseUrl: string): Promise<{ version: string; revision?: string } | null> {
  try {
    const res = await fetch(api(baseUrl, '/version'), { headers: gitlabHeaders(null) })
    if (!res.ok) return null
    const body = await res.json() as { version?: unknown; revision?: unknown }
    if (typeof body?.version !== 'string') return null
    return { version: body.version, revision: typeof body.revision === 'string' ? body.revision : undefined }
  } catch {
    return null
  }
}

// ── Auth / identity ─────────────────────────────────────────────────────────

export async function getCurrentUser(baseUrl: string, token: string): Promise<GitLabUser> {
  const res = await fetch(api(baseUrl, '/user'), { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getCurrentUser')
  return res.json() as Promise<GitLabUser>
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function getProject(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<GitLabProject> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}?license=true&statistics=true`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getProject')
  return res.json() as Promise<GitLabProject>
}

const SORT_MAP: Record<string, string> = {
  stars: 'star_count',
  updated: 'last_activity_at',
  forks: 'forks_count',
  created: 'created_at',
}

export async function searchProjects(
  baseUrl: string,
  token: string | null,
  query: string,
  perPage = 100,
  sort = 'stars',
  order: 'asc' | 'desc' | string = 'desc',
  page = 1,
): Promise<GitLabProject[]> {
  const orderBy = SORT_MAP[sort] ?? 'star_count'
  const params = new URLSearchParams({
    search: query,
    order_by: orderBy,
    sort: order === 'asc' ? 'asc' : 'desc',
    per_page: String(perPage),
    page: String(page),
  })
  const res = await fetch(api(baseUrl, `/projects?${params.toString()}`), { headers: gitlabHeaders(token) })
  if (!res.ok) return []
  return res.json() as Promise<GitLabProject[]>
}

export async function getDefaultBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<string> {
  const p = await getProject(baseUrl, token, owner, name)
  return p.default_branch && p.default_branch.length > 0 ? p.default_branch : 'main'
}

// ── README / file content ───────────────────────────────────────────────────

const README_CANDIDATES = ['README.md', 'README', 'readme.md', 'README.rst']

export async function getReadme(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  ref?: string,
): Promise<string | null> {
  const resolvedRef = ref ?? await getDefaultBranch(baseUrl, token, owner, name)
  for (const candidate of README_CANDIDATES) {
    const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(candidate)}?ref=${encodeURIComponent(resolvedRef)}`)
    const res = await fetch(url, { headers: gitlabHeaders(token) })
    if (res.ok) {
      const body = await res.json() as { content?: string; encoding?: string }
      if (typeof body.content === 'string' && body.encoding === 'base64') {
        return Buffer.from(body.content, 'base64').toString('utf8')
      }
    }
  }
  return null
}

export async function getFileContent(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const resolvedRef = ref ?? await getDefaultBranch(baseUrl, token, owner, name)
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(resolvedRef)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res, 'getFileContent')
  const body = await res.json() as { content?: string; encoding?: string }
  if (typeof body.content !== 'string' || body.encoding !== 'base64') return null
  return Buffer.from(body.content, 'base64').toString('utf8')
}

// ── Releases ────────────────────────────────────────────────────────────────

export async function getReleases(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<GitLabRelease[]> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/releases?per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getReleases')
  return res.json() as Promise<GitLabRelease[]>
}

// ── Tree / branch / blob ────────────────────────────────────────────────────

export async function getBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  branch: string,
): Promise<{ commitSha: string; rootTreeSha: string }> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/branches/${encodeURIComponent(branch)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBranch')
  const body = await res.json() as GitLabBranch
  // GitLab's tree API takes a ref string (branch or commit sha), not a tree sha.
  // The renderer treats `rootTreeSha` as an opaque cache key, and GitLab's
  // tree endpoint accepts the commit sha as `ref`, so we use it for both.
  return { commitSha: body.commit.id, rootTreeSha: body.commit.id }
}

export async function getTreeBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  treeSha: string,
): Promise<GitLabTreeEntry[]> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/tree?ref=${encodeURIComponent(treeSha)}&recursive=true&per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getTreeBySha')
  const entries = await res.json() as Array<{ id: string; name: string; type: 'blob' | 'tree'; path: string; mode: string }>
  return entries
}

export async function getBlobBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  blobSha: string,
): Promise<{ content: string; rawBase64: string; size: number }> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/blobs/${encodeURIComponent(blobSha)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBlobBySha')
  const body = await res.json() as GitLabBlob
  return {
    content: Buffer.from(body.content, 'base64').toString('utf8'),
    rawBase64: body.content,
    size: body.size,
  }
}

export async function getRawFileBytes(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  ref: string,
  path: string,
): Promise<Buffer> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getRawFileBytes')
  return Buffer.from(await res.arrayBuffer())
}

// ── Social ──────────────────────────────────────────────────────────────────

export async function starProject(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/star`)
  const res = await fetch(url, { method: 'POST', headers: gitlabHeaders(token) })
  // 201 = newly starred; 304 = already starred — both fine.
  if (!res.ok && res.status !== 304) throw await readError(res, 'starProject')
}

export async function unstarProject(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/projects/${projectId(owner, name)}/unstar`)
  const res = await fetch(url, { method: 'POST', headers: gitlabHeaders(token) })
  // 201 = newly unstarred; 304 = was not starred — both fine.
  if (!res.ok && res.status !== 304) throw await readError(res, 'unstarProject')
}

export async function getStarredProjects(
  baseUrl: string,
  token: string,
): Promise<GitLabStarredProject[]> {
  // GitLab v4 has no /user/starred shortcut — fetch the current user, then
  // /users/:id/starred_projects.
  const me = await getCurrentUser(baseUrl, token)
  const url = api(baseUrl, `/users/${me.id}/starred_projects?per_page=100`)
  const res = await fetch(url, { headers: gitlabHeaders(token) })
  if (!res.ok) throw await readError(res, 'getStarredProjects')
  return res.json() as Promise<GitLabStarredProject[]>
}

export async function isProjectStarred(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<boolean> {
  if (!token) return false
  // GitLab v4 has no direct is-starred query — fall back to scanning the user's
  // starred list and matching the slug. Phase 6 will replace this with a cached
  // lookup once the multi-host Discover flow exercises it heavily.
  try {
    const starred = await getStarredProjects(baseUrl, token)
    const slug = `${owner}/${name}`.toLowerCase()
    return starred.some(p => p.path_with_namespace.toLowerCase() === slug)
  } catch {
    return false
  }
}
