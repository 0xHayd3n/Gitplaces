// electron/providers/gitea/rest.ts
//
// REST helpers for a Gitea instance. The `baseUrl` argument is the API root
// (e.g. "https://codeberg.org" or "https://gitea.acme.com") — every helper
// appends "/api/v1/..." internally. Auth is a Personal Access Token sent in
// the `Authorization: token <pat>` header. All helpers accept `token: string | null`
// so they can also drive unauthenticated requests (public repos).

// ── Types (provider-native; normalize.ts translates to canonical shapes) ────

export interface GiteaUser {
  id: number
  login: string
  full_name: string
  avatar_url: string
  html_url: string
}

export interface GiteaRepoOwner {
  id: number
  login: string
  full_name?: string
  avatar_url: string
  html_url: string
}

export interface GiteaRepo {
  id: number
  name: string
  full_name: string
  owner: GiteaRepoOwner
  description: string | null
  website: string | null
  default_branch: string | null
  topics: string[] | null
  html_url: string
  size: number              // KB (parity with GitHub)
  stars_count: number
  forks_count: number
  watchers_count: number
  open_issues_count: number
  created_at: string
  updated_at: string
  archived: boolean
  private: boolean
  language?: string | null
}

export interface GiteaReleaseAsset {
  id: number
  name: string
  size: number
  browser_download_url: string
  download_count: number
}

export interface GiteaRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  prerelease: boolean
  assets?: GiteaReleaseAsset[]
}

export interface GiteaBranch {
  name: string
  commit: { id: string; parent_ids?: string[] }
}

export interface GiteaTreeEntry {
  sha: string
  path: string
  type: 'blob' | 'tree' | 'commit'
  mode: string
  size?: number
}

export interface GiteaTreeResponse {
  sha: string
  tree?: GiteaTreeEntry[]
  truncated?: boolean
}

export interface GiteaBlob {
  size: number
  encoding: 'base64'
  content: string
  sha: string
}

export type GiteaStarredRepo = GiteaRepo

// ── Headers ─────────────────────────────────────────────────────────────────

export function giteaHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `token ${token}`
  return headers
}

function api(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1${path}`
}

async function readError(res: Response, op: string): Promise<Error> {
  let body: unknown = null
  try { body = await res.json() } catch { /* ignore */ }
  const detail = body && typeof body === 'object' && 'message' in body
    ? ` — ${String((body as { message: unknown }).message)}`
    : ''
  return new Error(`Gitea API error: ${res.status}${detail} (${op})`)
}

// ── Server version (probe target) ────────────────────────────────────────────

export type ServerVersionResult =
  | { ok: true; version: string }
  | { ok: false; errorKind: 'tls' | 'network' | 'http' | 'json'; error: string }

const TLS_CODE_RE = /^(CERT_|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL)/i
const NETWORK_CODE_RE = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN)$/

function classifyFetchError(err: unknown, baseUrl: string): ServerVersionResult {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = typeof cause?.code === 'string' ? cause.code : ''
  if (TLS_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'tls', error: `TLS handshake failed (${code})` }
  }
  if (NETWORK_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} (${code})` }
  }
  const msg = (err as Error)?.message ?? String(err)
  return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} — ${msg}` }
}

export async function getServerVersion(baseUrl: string): Promise<ServerVersionResult> {
  let res: Response
  try {
    res = await fetch(api(baseUrl, '/version'), { headers: giteaHeaders(null) })
  } catch (err) {
    return classifyFetchError(err, baseUrl)
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    return {
      ok: false,
      errorKind: 'http',
      error: body ? `HTTP ${res.status} — ${body}` : `HTTP ${res.status}`,
    }
  }
  let body: { version?: unknown }
  try {
    body = await res.json() as { version?: unknown }
  } catch {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a Gitea instance (invalid JSON)` }
  }
  if (typeof body?.version !== 'string' || body.version.length === 0) {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a Gitea instance (no /api/v1/version)` }
  }
  return { ok: true, version: body.version }
}

// ── Auth / identity ─────────────────────────────────────────────────────────

export async function getCurrentUser(baseUrl: string, token: string): Promise<GiteaUser> {
  const res = await fetch(api(baseUrl, '/user'), { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getCurrentUser')
  return res.json() as Promise<GiteaUser>
}

// ── Repos ───────────────────────────────────────────────────────────────────

export async function getRepo(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<GiteaRepo> {
  const url = api(baseUrl, `/repos/${owner}/${name}`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getRepo')
  return res.json() as Promise<GiteaRepo>
}

const SEARCH_SORT = new Set(['stars', 'updated', 'forks', 'created'])

// Default per-page = 50, NOT 100 like the GitLab parallel. Gitea's
// /repos/search hard-caps `limit` at 50 server-side (Codeberg and most other
// Gitea instances configure ROUTE_RATELIMIT / DEFAULT_PAGING_NUM around this
// value). Requesting 100 silently returns 50 anyway. Phase 6's discoverMerge
// caps each host at 10, so this default is only exercised by the Library /
// starred views.
export async function searchRepos(
  baseUrl: string,
  token: string | null,
  query: string,
  perPage = 50,
  sort = 'stars',
  order: 'asc' | 'desc' | string = 'desc',
  page = 1,
): Promise<GiteaRepo[]> {
  const sortToken = SEARCH_SORT.has(sort) ? sort : 'stars'
  const params = new URLSearchParams({
    q: query,
    sort: sortToken,
    order: order === 'asc' ? 'asc' : 'desc',
    limit: String(perPage),
    page: String(page),
  })
  const res = await fetch(api(baseUrl, `/repos/search?${params.toString()}`), { headers: giteaHeaders(token) })
  if (!res.ok) return []
  const body = await res.json() as { data?: GiteaRepo[]; ok?: boolean }
  return Array.isArray(body?.data) ? body.data : []
}

export async function getDefaultBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<string> {
  const r = await getRepo(baseUrl, token, owner, name)
  return r.default_branch && r.default_branch.length > 0 ? r.default_branch : 'main'
}

// ── README / file content ───────────────────────────────────────────────────

export async function getReadme(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  ref?: string,
): Promise<string | null> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const res = await fetch(
    api(baseUrl, `/repos/${owner}/${name}/readme${qs}`),
    { headers: giteaHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res, 'getReadme')
  const body = await res.json() as { content?: string; encoding?: string }
  if (typeof body.content !== 'string' || body.encoding !== 'base64') return null
  return Buffer.from(body.content, 'base64').toString('utf8')
}

export async function getFileContent(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const url = api(baseUrl, `/repos/${owner}/${name}/contents/${path}${qs}`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
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
): Promise<GiteaRelease[]> {
  const url = api(baseUrl, `/repos/${owner}/${name}/releases?limit=50`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getReleases')
  return res.json() as Promise<GiteaRelease[]>
}

// ── Tree / branch / blob ────────────────────────────────────────────────────

export async function getBranch(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  branch: string,
): Promise<{ commitSha: string; rootTreeSha: string }> {
  const url = api(baseUrl, `/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBranch')
  const body = await res.json() as GiteaBranch
  // Gitea's git/trees endpoint accepts a commit sha as the {sha} segment, and
  // the renderer treats rootTreeSha as an opaque cache key — reuse the commit
  // sha for both so we don't have to round-trip to fetch the underlying tree sha.
  return { commitSha: body.commit.id, rootTreeSha: body.commit.id }
}

export async function getTreeBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  treeSha: string,
): Promise<GiteaTreeEntry[]> {
  // PHASE 6 FOLLOW-UP: Gitea's tree endpoint may truncate large repos
  // (response.truncated === true) and supports per_page pagination via
  // ?page=&per_page=. Phase 5's UI never invokes this (renderer doesn't
  // browse non-GitHub repos yet) so the single-page recursive call is good
  // enough; Phase 6 can add a pagination loop when wiring multi-host browsing.
  const url = api(baseUrl, `/repos/${owner}/${name}/git/trees/${encodeURIComponent(treeSha)}?recursive=true`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getTreeBySha')
  const body = await res.json() as GiteaTreeResponse
  return Array.isArray(body?.tree) ? body.tree : []
}

export async function getBlobBySha(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
  blobSha: string,
): Promise<{ content: string; rawBase64: string; size: number }> {
  const url = api(baseUrl, `/repos/${owner}/${name}/git/blobs/${encodeURIComponent(blobSha)}`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getBlobBySha')
  const body = await res.json() as GiteaBlob
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
  // Gitea's raw endpoint puts ref + path in the URL path: /raw/{ref}/{path...}.
  // We URL-encode the ref segment (branch names can contain slashes) and each
  // segment of the path independently (preserving '/' separators).
  const refSeg = encodeURIComponent(ref)
  const pathSeg = path.split('/').map(encodeURIComponent).join('/')
  const url = api(baseUrl, `/repos/${owner}/${name}/raw/${refSeg}/${pathSeg}`)
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getRawFileBytes')
  return Buffer.from(await res.arrayBuffer())
}

// ── Social ──────────────────────────────────────────────────────────────────

export async function starRepo(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/user/starred/${owner}/${name}`)
  const res = await fetch(url, { method: 'PUT', headers: giteaHeaders(token) })
  // 204 = newly starred; 304 = already starred — both fine.
  if (!res.ok && res.status !== 304) throw await readError(res, 'starRepo')
}

export async function unstarRepo(
  baseUrl: string,
  token: string,
  owner: string,
  name: string,
): Promise<void> {
  const url = api(baseUrl, `/user/starred/${owner}/${name}`)
  const res = await fetch(url, { method: 'DELETE', headers: giteaHeaders(token) })
  // 204 = newly unstarred; 404 = was not starred — both fine.
  if (!res.ok && res.status !== 404) throw await readError(res, 'unstarRepo')
}

export async function isRepoStarred(
  baseUrl: string,
  token: string | null,
  owner: string,
  name: string,
): Promise<boolean> {
  if (!token) return false
  const url = api(baseUrl, `/user/starred/${owner}/${name}`)
  const res = await fetch(url, { method: 'GET', headers: giteaHeaders(token) })
  // 204 = starred; 404 = not starred. Any other status is treated as "unknown
  // → not starred" so the UI never falsely shows a star when auth is broken.
  return res.status === 204
}

export async function getStarredRepos(
  baseUrl: string,
  token: string,
): Promise<GiteaStarredRepo[]> {
  // PHASE 6 FOLLOW-UP: single page only (limit=50). Phase 5 doesn't render a
  // Gitea-aware Library view, so the first 50 entries are good enough; Phase 6
  // can add Link-header pagination when multi-host library aggregation lands.
  // Symmetric with the same limitation in gitlab/rest.ts → getStarredProjects.
  const url = api(baseUrl, '/user/starred?limit=50')
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getStarredRepos')
  return res.json() as Promise<GiteaStarredRepo[]>
}
