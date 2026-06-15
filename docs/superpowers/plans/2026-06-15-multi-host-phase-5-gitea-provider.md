# Multi-Host Phase 5: Gitea Provider + Codeberg Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GiteaProvider` paralleling the existing `GitHubProvider`/`GitLabProvider`, register it for any `gt:` host id (with `gt:codeberg.org` seeded on first launch), wire a Gitea probe into `hosts:probe`. The Connections settings pane (already shipped in Phase 4) renders Codeberg's row as soon as the seed lands; no UI changes are required here.

**Architecture:** Gitea's REST surface is mirrored into `electron/providers/gitea/{rest,normalize,index}.ts`, structurally identical to `electron/providers/gitlab/`. Provider methods return provider-native shapes (Gitea API responses); `normalize.ts` translates those into the canonical `Repo` / `Release` / `User` shapes. The registry is widened so `getAnyProvider('gt:codeberg.org')` returns a memoized `GiteaProvider` (lazy-constructed from the `HostInstance.baseUrl` lookup so self-hosted instances added later automatically work). The `hosts:probe` handler grows a `'gitea'` branch that fetches `${baseUrl}/api/v1/version` and reports `{ ok: true }` only if the response is a JSON object with a `version` string.

**Tech Stack:** TypeScript, Electron, React, vitest, electron-store, better-sqlite3.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 5 section under "Migration phasing".

**Gitea API differences from GitLab (the key reference points for this plan):**

| Aspect | GitLab | Gitea |
|---|---|---|
| API base | `${baseUrl}/api/v4/...` | `${baseUrl}/api/v1/...` |
| Auth header | `PRIVATE-TOKEN: <pat>` | `Authorization: token <pat>` |
| Repo noun | "project" — `/projects/{id}` | "repo" — `/repos/{owner}/{name}` |
| Repo id form | URL-encoded `owner/name` | Plain `owner/name` path segments |
| Repo search | `/projects?search=...&order_by=...` | `/repos/search?q=...&sort=...&order=...` |
| README | Multi-name probe via `/repository/files/{name}` | Single `/repos/{o}/{n}/readme` endpoint returns `{content, encoding}` |
| Tree | `/repository/tree?ref=...&recursive=true` | `/git/trees/{sha}?recursive=true` |
| Blob | `/repository/blobs/{sha}` | `/git/blobs/{sha}` |
| Raw file | `/repository/files/{path}/raw?ref=...` | `/raw/{ref}/{path}` (ref is URL path segment, no query) |
| Releases | `/projects/{id}/releases` | `/repos/{o}/{n}/releases` |
| Star user-current | POST `/projects/{id}/star` | PUT `/user/starred/{o}/{n}` |
| Unstar | POST `/projects/{id}/unstar` | DELETE `/user/starred/{o}/{n}` |
| Is-starred | No native query — scan `/users/{id}/starred_projects` | GET `/user/starred/{o}/{n}` (204 = starred, 404 = not) |
| Server version | `/api/v4/version` → `{ version, revision }` | `/api/v1/version` → `{ version }` |

**Gitea response asymmetries the normalizer absorbs:**

- `default_branch` may be an empty string for empty repos — fall back to `'main'`.
- `size` comes back in **KB** (parity with GitHub — NOT bytes like GitLab — so no `/1024` conversion).
- `topics` is `string[]` directly on the repo object (parity with GitHub; no need for `/topics` round-trip).
- `language` is not on the top-level repo endpoint → return `null` (parity with GitLab; Phase 6 can add `/languages` if needed).
- `watchers_count` is a real, separate field — use it directly (do NOT mirror stars the way the GitLab normalizer does).
- There is no `pushed_at` field — use `updated_at` for `Repo.pushedAt`.
- `homepageUrl` maps from Gitea's `website` field (Gitea exposes this; GitLab doesn't).

**Capability flags (`GiteaProvider.capabilities()` returns):**

```ts
{
  vulnerabilityAlerts: false,
  codeScanningAlerts: false,
  events: false,
  trendingDiscovery: true,    // /repos/search is good enough for Discover queries
  graphqlBundle: false,
  isVerifiedOrg: false,
}
```

**Out of scope for this plan:**
- Mixed-row Discover wiring (Phase 6).
- Self-hosted "Add a Gitea host" form, TLS-error surfacing, per-host health checks (Phase 7).
- Making Gitea repos actually browsable in `RepoDetail` or the Library views — Phase 5 only adds the provider plumbing + the seeded Codeberg connection. Navigating to `/repo/gt:codeberg.org/owner/name` is not expected to render a usable page; the renderer-side multi-host capability gating lands in Phase 6.

---

## File structure

### New files

- `electron/providers/gitea/rest.ts` — REST helpers paralleling `electron/providers/gitlab/rest.ts`. PAT auth via `Authorization: token <pat>` header, base URL constructor parameter so the same code path covers `codeberg.org` and self-hosted Gitea instances.
- `electron/providers/gitea/rest.test.ts` — vitest with `fetch` mocks, mirrors the pattern in `electron/providers/gitlab/rest.test.ts`.
- `electron/providers/gitea/normalize.ts` — `giteaRepoToRepo`, `giteaReleaseToRelease`, `giteaUserToUser`, `giteaStarredToStarredEntry`.
- `electron/providers/gitea/normalize.test.ts` — fixture-based golden tests.
- `electron/providers/gitea/index.ts` — `GiteaProvider` class + barrel exports. Takes `(hostId, baseUrl)` in its constructor so the registry can instantiate one per `HostInstance`.

### Modified files

- `electron/providers/registry.ts` — widen `AnyProvider` to `GitHubProvider | GitLabProvider | GiteaProvider`; add lazy Gitea instantiation keyed by `hostId`, sourced from `hostConfig.getHost`. Export `_resetGiteaCacheForTest` alongside `_resetGitLabCacheForTest`.
- `electron/providers/registry.test.ts` — add coverage for `getAnyProvider('gt:codeberg.org')` after `seedDefaultHosts` runs, and a `_resetGiteaCacheForTest` call in `beforeEach`.
- `electron/providers/hostConfig.ts` — extend `DEFAULT_HOSTS` with the Codeberg entry.
- `electron/providers/hostConfig.test.ts` — assert all three seeds (GitHub, GitLab.com, Codeberg) in stable membership; the existing self-hosted-addition test needs no change because it asserts the seeded count + the addition, which moves from 2 → 3 base count.
- `electron/ipc/hostHandlers.ts` — add a `type === 'gitea'` branch to `hosts:probe` calling Gitea's `getServerVersion`.
- `electron/ipc/hostHandlers.probe.test.ts` — add Gitea probe coverage. Update the existing "still falls through to 'not implemented' for unknown host types" case (it currently uses `'gitea'` as the "unknown" type — change to a literally unknown value).

### Files NOT touched in this plan

- `electron/providers/github/*`, `electron/providers/gitlab/*` — unchanged.
- `electron/ipc/hostHandlers.ts` — only the `hosts:probe` handler grows; the `hosts:setToken`/`hosts:getConnectedUser`/etc. handlers already route through `getAnyProvider(hostId)` which works for Gitea once Task 4 lands.
- `electron/ipc/repoHandlers.ts` — still casts the resolved provider as `GitHubProvider`; the cast is safe for Phase 5 because no UI path navigates to a non-GitHub repo yet. (Phase 6 will revisit this.)
- `src/views/settings/ConnectionsPanel.tsx` — already renders any host returned by `hosts.list()`, already has a Gitea icon, and the `patDocsUrl` helper already returns `${host.webUrl ?? host.baseUrl}/user/settings/applications` for `host.type === 'gitea'`. Confirm visually after Task 5; no code edits expected.
- `src/views/Settings.tsx` — Connections category already exists from Phase 4.

---

## Notes for the executor

- Work directly on `main`. Do NOT create a feature branch or a worktree (per project-level CLAUDE.md).
- For non-sqlite tests use `npx vitest run <path>` — direct vitest does not rebuild `better-sqlite3` for the Node ABI, which preserves Electron-launch sanity. Tests in this plan only mock `fetch` and electron-store — they do not touch sqlite.
- Run `npm test` only at the very end (Task 7). If the rebuild fails with a file lock, the user's dev app is running — pause and confirm before force-killing.
- Conventional-commit style; one commit per task. Use `feat(providers/gitea):`, `feat(providers):`, `feat(ipc):` as the type/scope prefixes (mirror Phase 4's cadence: rest → normalize → provider → registry → seed → probe).
- The user prefers batch execution — run every task consecutively without per-task pauses. The single code-review dispatch happens after Task 7.
- Today's date in any seed timestamp test fixtures: `2026-06-15`. When comparing seeded `addedAt` values, use a tolerance (`expect(Date.parse(...)).toBeGreaterThan(0)`) rather than equality.

---

## Task 1: TDD Gitea REST helpers

Mirror `electron/providers/gitlab/rest.ts`'s shape. Authentication is via `Authorization: token <pat>` header. All endpoints live under `${baseUrl}/api/v1/`. The module exports a `giteaHeaders(token)` helper plus a series of free functions; the file also re-exports types named with a `Gitea` prefix (e.g. `GiteaRepo`, `GiteaRelease`, `GiteaUser`, `GiteaStarredRepo`).

**Files:**
- Create: `electron/providers/gitea/rest.ts`
- Create: `electron/providers/gitea/rest.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/gitea/rest.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  giteaHeaders,
  getCurrentUser,
  getRepo,
  searchRepos,
  getReadme,
  getReleases,
  getBranch,
  getTreeBySha,
  getBlobBySha,
  getRawFileBytes,
  getFileContent,
  starRepo,
  unstarRepo,
  isRepoStarred,
  getServerVersion,
} from './rest'

const BASE = 'https://codeberg.org'

function makeResponse(body: unknown, headers: Record<string, string> = {}, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 401),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

describe('giteaHeaders', () => {
  it('uses Authorization: token <pat> when a token is supplied', () => {
    expect(giteaHeaders('tok')).toEqual(expect.objectContaining({ Authorization: 'token tok' }))
  })
  it('omits the Authorization header when null', () => {
    expect(giteaHeaders(null)).not.toHaveProperty('Authorization')
  })
})

describe('getCurrentUser', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /api/v1/user and returns the Gitea user payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 17, login: 'alice', full_name: 'Alice', avatar_url: 'https://x/a.png', html_url: 'https://codeberg.org/alice',
    }))
    const user = await getCurrentUser(BASE, 'tok')
    expect(user.login).toBe('alice')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'token tok' }) }),
    )
  })
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'unauthorized' }, {}, false, 401))
    await expect(getCurrentUser(BASE, 'tok')).rejects.toThrow(/Gitea API error: 401/)
  })
})

describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { version } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '1.21.0+gitea-x' }))
    const v = await getServerVersion(BASE)
    expect(v!.version).toBe('1.21.0+gitea-x')
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })
  it('normalizes a trailing slash on the base URL', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '1.22.0' }))
    await getServerVersion('https://codeberg.org/')
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })
  it('returns null when the response is JSON without a version field', async () => {
    mockFetch.mockResolvedValue(makeResponse({ unrelated: true }))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on network failure', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('network')))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on non-ok status', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getServerVersion(BASE)).toBeNull()
  })
})

describe('getRepo', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /api/v1/repos/{owner}/{name}', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 42, full_name: 'alice/demo', name: 'demo', owner: { id: 1, login: 'alice', avatar_url: '', html_url: '' },
      default_branch: 'main', archived: false, stars_count: 1, forks_count: 1, open_issues_count: 0,
      watchers_count: 7, topics: [], description: null, html_url: '', website: '',
      created_at: '', updated_at: '', size: 0,
    }))
    await getRepo(BASE, 'tok', 'alice', 'demo')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo',
      expect.any(Object),
    )
  })
})

describe('searchRepos', () => {
  beforeEach(() => mockFetch.mockReset())
  it('builds /repos/search?q=...&sort=...&order=...&page=... and unwraps the {data} envelope', async () => {
    mockFetch.mockResolvedValue(makeResponse({ data: [], ok: true }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'stars', 'desc', 2)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v1/repos/search')
    expect(call).toContain('q=rust')
    expect(call).toContain('sort=stars')
    expect(call).toContain('order=desc')
    expect(call).toContain('page=2')
    expect(call).toContain('limit=20')
  })
  it('maps sort=stars/updated/forks/created to the canonical Gitea sort tokens', async () => {
    mockFetch.mockResolvedValue(makeResponse({ data: [] }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'updated', 'desc', 1)
    expect(mockFetch.mock.calls[0][0] as string).toContain('sort=updated')
    mockFetch.mockResolvedValue(makeResponse({ data: [] }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'forks', 'desc', 1)
    expect(mockFetch.mock.calls[1][0] as string).toContain('sort=forks')
  })
  it('returns [] when Gitea errors out (parity with GitHub 422 behavior)', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'bad query' }, {}, false, 400))
    expect(await searchRepos(BASE, 'tok', '!!!', 20, 'stars', 'desc', 1)).toEqual([])
  })
  it('returns [] when the {data} envelope is missing', async () => {
    mockFetch.mockResolvedValue(makeResponse({ ok: true }))
    expect(await searchRepos(BASE, 'tok', 'rust', 20, 'stars', 'desc', 1)).toEqual([])
  })
})

describe('getReadme', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded README from /repos/{o}/{n}/readme', async () => {
    const content = Buffer.from('# hello\n').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('# hello\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/readme',
      expect.any(Object),
    )
  })
  it('passes ?ref=... when a ref is supplied', async () => {
    const content = Buffer.from('hi').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    await getReadme(BASE, 'tok', 'alice', 'demo', 'v1.0.0')
    expect(mockFetch.mock.calls[0][0] as string).toContain('?ref=v1.0.0')
  })
  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getReadme(BASE, 'tok', 'alice', 'demo')).toBeNull()
  })
  it('returns null when the response is not base64-encoded', async () => {
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'plain', content: '...' }))
    expect(await getReadme(BASE, 'tok', 'alice', 'demo')).toBeNull()
  })
})

describe('getReleases', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /releases?limit=50 and returns the array', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { tag_name: 'v1.0.0', name: 'One', published_at: '2026-01-01T00:00:00Z', body: 'first', prerelease: false, assets: [{ name: 'src.tar', browser_download_url: 'https://x/y', size: 10, download_count: 3 }] },
    ]))
    const rels = await getReleases(BASE, 'tok', 'alice', 'demo')
    expect(rels).toHaveLength(1)
    expect(rels[0].tag_name).toBe('v1.0.0')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v1/repos/alice/demo/releases?limit=50')
  })
})

describe('getBranch', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { commitSha, rootTreeSha } from the branch payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({ name: 'main', commit: { id: 'sha-xyz' } }))
    const r = await getBranch(BASE, 'tok', 'alice', 'demo', 'main')
    expect(r.commitSha).toBe('sha-xyz')
    // Gitea's tree API takes a sha (commit or tree), and the renderer treats
    // rootTreeSha as an opaque cache key — reuse the commit sha here.
    expect(r.rootTreeSha).toBe('sha-xyz')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/branches/main',
      expect.any(Object),
    )
  })
})

describe('getRawFileBytes', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /raw/{ref}/{path} (ref in path, NOT query)', async () => {
    mockFetch.mockResolvedValue(makeResponse('hello', { 'content-type': 'application/octet-stream' }))
    const buf = await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'main', 'src/x.ts')
    expect(buf).toBeInstanceOf(Buffer)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toBe('https://codeberg.org/api/v1/repos/alice/demo/raw/main/src/x.ts')
  })
  it('URL-encodes ref and path segments individually', async () => {
    mockFetch.mockResolvedValue(makeResponse('x'))
    await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'feat/branch-with-slash', 'dir/file name.ts')
    expect(mockFetch.mock.calls[0][0] as string)
      .toBe('https://codeberg.org/api/v1/repos/alice/demo/raw/feat%2Fbranch-with-slash/dir/file%20name.ts')
  })
})

describe('getBlobBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { content, rawBase64, size } from /git/blobs/{sha}', async () => {
    const rawBase64 = Buffer.from('blob').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ size: 4, encoding: 'base64', content: rawBase64, sha: 'sha-xyz' }))
    const out = await getBlobBySha(BASE, 'tok', 'alice', 'demo', 'sha-xyz')
    expect(out.size).toBe(4)
    expect(out.rawBase64).toBe(rawBase64)
    expect(out.content).toBe('blob')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/git/blobs/sha-xyz',
      expect.any(Object),
    )
  })
})

describe('starRepo / unstarRepo / isRepoStarred', () => {
  beforeEach(() => mockFetch.mockReset())
  it('star PUTs to /user/starred/{owner}/{name}', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 204))
    await starRepo(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://codeberg.org/api/v1/user/starred/alice/demo')
    expect((init as { method: string }).method).toBe('PUT')
  })
  it('unstar DELETEs the same path', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 204))
    await unstarRepo(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://codeberg.org/api/v1/user/starred/alice/demo')
    expect((init as { method: string }).method).toBe('DELETE')
  })
  it('isRepoStarred GETs /user/starred/{owner}/{name} and treats 204 as true, 404 as false', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, {}, true, 204))
    expect(await isRepoStarred(BASE, 'tok', 'alice', 'demo')).toBe(true)
    mockFetch.mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    expect(await isRepoStarred(BASE, 'tok', 'alice', 'demo')).toBe(false)
  })
  it('isRepoStarred returns false when no token is supplied (no auth → not starred)', async () => {
    expect(await isRepoStarred(BASE, null, 'alice', 'demo')).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('getTreeBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /git/trees/{sha}?recursive=true', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      sha: 'sha-root',
      tree: [{ sha: 'sha-a', path: 'README.md', type: 'blob', mode: '100644', size: 12 }],
      truncated: false,
    }))
    const entries = await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('README.md')
    expect(entries[0].type).toBe('blob')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toBe('https://codeberg.org/api/v1/repos/alice/demo/git/trees/sha-root?recursive=true')
  })
  it('returns [] when the response envelope is malformed', async () => {
    mockFetch.mockResolvedValue(makeResponse({ sha: 'sha-root' }))
    expect(await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')).toEqual([])
  })
})

describe('getFileContent', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded file content from /contents/{path}', async () => {
    const content = Buffer.from('const x = 1\n').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    const out = await getFileContent(BASE, 'tok', 'alice', 'demo', 'src/x.ts')
    expect(out).toBe('const x = 1\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/contents/src/x.ts',
      expect.any(Object),
    )
  })
  it('passes ?ref=... when supplied', async () => {
    const content = Buffer.from('hi').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    await getFileContent(BASE, 'tok', 'alice', 'demo', 'README.md', 'v1.0.0')
    expect(mockFetch.mock.calls[0][0] as string)
      .toBe('https://codeberg.org/api/v1/repos/alice/demo/contents/README.md?ref=v1.0.0')
  })
  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getFileContent(BASE, 'tok', 'alice', 'demo', 'nope.ts')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitea/rest.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/gitea/rest.ts`:

```ts
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

export async function getServerVersion(baseUrl: string): Promise<{ version: string } | null> {
  try {
    const res = await fetch(api(baseUrl, '/version'), { headers: giteaHeaders(null) })
    if (!res.ok) return null
    const body = await res.json() as { version?: unknown }
    if (typeof body?.version !== 'string') return null
    return { version: body.version }
  } catch {
    return null
  }
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
  const url = api(baseUrl, '/user/starred?limit=50')
  const res = await fetch(url, { headers: giteaHeaders(token) })
  if (!res.ok) throw await readError(res, 'getStarredRepos')
  return res.json() as Promise<GiteaStarredRepo[]>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitea/rest.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitea/rest.ts electron/providers/gitea/rest.test.ts
git commit -m "feat(providers/gitea): REST helpers + version probe + PAT auth"
```

---

## Task 2: TDD Gitea normalizers

Mirror `electron/providers/gitlab/normalize.ts`. Convert Gitea provider-native shapes (snake_case, KB-already-for-size, separate `watchers_count`) into the canonical `Repo` / `Release` / `User` shapes the renderer consumes.

**Files:**
- Create: `electron/providers/gitea/normalize.ts`
- Create: `electron/providers/gitea/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/gitea/normalize.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  giteaRepoToRepo,
  giteaReleaseToRelease,
  giteaUserToUser,
  giteaStarredToStarredEntry,
} from './normalize'
import type { GiteaRepo, GiteaRelease, GiteaUser } from './rest'

const HOST_ID = 'gt:codeberg.org'

const FIXTURE: GiteaRepo = {
  id: 42,
  name: 'demo',
  full_name: 'alice/demo',
  owner: {
    id: 1,
    login: 'alice',
    full_name: 'Alice',
    avatar_url: 'https://codeberg.org/avatars/alice.png',
    html_url: 'https://codeberg.org/alice',
  },
  description: 'a demo repo',
  website: 'https://example.com/demo',
  default_branch: 'main',
  topics: ['rust', 'cli'],
  html_url: 'https://codeberg.org/alice/demo',
  size: 5120,                         // already KB
  stars_count: 42,
  forks_count: 5,
  watchers_count: 7,
  open_issues_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-14T22:00:00Z',
  archived: false,
  private: false,
}

describe('giteaRepoToRepo', () => {
  it('maps the standard fields', () => {
    const r = giteaRepoToRepo(HOST_ID, FIXTURE)
    expect(r.hostId).toBe(HOST_ID)
    expect(r.hostType).toBe('gitea')
    expect(r.hostNativeId).toBe(42)
    expect(r.fullName).toBe('alice/demo')
    expect(r.owner).toBe('alice')
    expect(r.name).toBe('demo')
    expect(r.htmlUrl).toBe('https://codeberg.org/alice/demo')
    expect(r.description).toBe('a demo repo')
    expect(r.topics).toEqual(['rust', 'cli'])
    expect(r.defaultBranch).toBe('main')
    expect(r.archived).toBe(false)
    expect(r.stars).toBe(42)
    expect(r.forks).toBe(5)
    expect(r.openIssues).toBe(1)
    expect(r.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(r.updatedAt).toBe('2026-06-14T22:00:00Z')
    expect(r.ownerAvatarUrl).toBe(FIXTURE.owner.avatar_url)
  })

  it('uses updated_at for pushedAt (Gitea has no separate pushed_at)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).pushedAt).toBe(FIXTURE.updated_at)
  })

  it('uses watchers_count for watchers (NOT stars — Gitea exposes both)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).watchers).toBe(7)
  })

  it('keeps size as-is (Gitea returns KB, matching the canonical unit)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).size).toBe(5120)
  })

  it('maps website → homepageUrl, treating empty strings as null', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).homepageUrl).toBe('https://example.com/demo')
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, website: '' }).homepageUrl).toBeNull()
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, website: null }).homepageUrl).toBeNull()
  })

  it('falls back defaultBranch to "main" when null/empty (Gitea reports empty for empty repos)', () => {
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, default_branch: null }).defaultBranch).toBe('main')
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('topics empty when null/undefined', () => {
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, topics: null }).topics).toEqual([])
    expect(giteaRepoToRepo(HOST_ID, { ...FIXTURE, topics: undefined as unknown as string[] }).topics).toEqual([])
  })

  it('language is null (Gitea repo endpoint does not expose it — parity with GitLab)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).language).toBeNull()
  })

  it('license is null (Phase 5 does not fetch /contents/LICENSE — parity with GitLab)', () => {
    expect(giteaRepoToRepo(HOST_ID, FIXTURE).license).toBeNull()
  })
})

describe('giteaReleaseToRelease', () => {
  it('maps tag, name, body, publishedAt, prerelease', () => {
    const rel: GiteaRelease = {
      tag_name: 'v1.0.0',
      name: 'First release',
      published_at: '2026-01-01T00:00:00Z',
      body: 'release notes',
      prerelease: false,
      assets: [{ id: 1, name: 'src.tar.gz', size: 1234, browser_download_url: 'https://x/y.tar.gz', download_count: 9 }],
    }
    const out = giteaReleaseToRelease(rel)
    expect(out.tagName).toBe('v1.0.0')
    expect(out.name).toBe('First release')
    expect(out.publishedAt).toBe('2026-01-01T00:00:00Z')
    expect(out.body).toBe('release notes')
    expect(out.prerelease).toBe(false)
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0].name).toBe('src.tar.gz')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tar.gz')
    expect(out.assets[0].size).toBe(1234)
    expect(out.assets[0].downloadCount).toBe(9)
  })

  it('passes through prerelease === true', () => {
    const rel: GiteaRelease = {
      tag_name: 'v2.0.0-rc1', name: null, published_at: '2026-06-01T00:00:00Z',
      body: null, prerelease: true,
    }
    expect(giteaReleaseToRelease(rel).prerelease).toBe(true)
  })

  it('handles missing assets', () => {
    const rel: GiteaRelease = {
      tag_name: 'v3', name: null, published_at: '2026-06-01T00:00:00Z',
      body: null, prerelease: false,
    }
    expect(giteaReleaseToRelease(rel).assets).toEqual([])
  })
})

describe('giteaUserToUser', () => {
  it('maps login → login, avatar_url → avatarUrl, publicRepos defaults to 0', () => {
    const u: GiteaUser = { id: 1, login: 'alice', full_name: 'Alice', avatar_url: 'https://x/a.png', html_url: 'https://codeberg.org/alice' }
    const out = giteaUserToUser(u)
    expect(out.login).toBe('alice')
    expect(out.avatarUrl).toBe('https://x/a.png')
    // Gitea /user does not expose a public_repos count; surface 0 until Phase 7
    // teaches the user-page renderer to call /users/{login}/repos.
    expect(out.publicRepos).toBe(0)
  })
})

describe('giteaStarredToStarredEntry', () => {
  it('uses updated_at as a stand-in for starred_at (no native field in Gitea)', () => {
    const out = giteaStarredToStarredEntry(HOST_ID, FIXTURE)
    expect(out.starredAt).toBe(FIXTURE.updated_at)
    expect(out.repo.fullName).toBe('alice/demo')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitea/normalize.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/gitea/normalize.ts`:

```ts
// electron/providers/gitea/normalize.ts
//
// Translates Gitea provider-native shapes to the canonical renderer shapes
// (Repo / Release / User / StarredEntry). Pure functions, no I/O. Mirrors
// electron/providers/gitlab/normalize.ts.
//
// Known asymmetries we accept in Phase 5:
//   - `language`     → null (Gitea /repos/{o}/{n} doesn't surface a top language;
//                     fetching /languages is a Phase 6 polish item).
//   - `license`      → null (Phase 5 doesn't probe LICENSE files; same posture
//                     as the GitLab normalizer pre-Phase-6).
//   - `publicRepos`  → 0 (Gitea /user doesn't expose a count; renderer surfaces
//                     this only on profile pages, which Phase 5 doesn't touch).
//   - `starredAt`    → `updated_at` (no per-star timestamp from Gitea — the
//                     /user/starred endpoint returns repos, not star events).
//   - `pushedAt`     → `updated_at` (Gitea has no pushed_at field).
//   - `size`         → identity (Gitea already reports KB; no conversion).
//   - `watchers`     → uses watchers_count (NOT stars, unlike the GitLab path).

import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GiteaRepo,
  GiteaRelease,
  GiteaReleaseAsset,
  GiteaUser,
} from './rest'

export function giteaRepoToRepo(hostId: string, g: GiteaRepo): Repo {
  return {
    hostId,
    hostType: 'gitea',
    hostNativeId: g.id,
    fullName: g.full_name,
    owner: g.owner.login,
    name: g.name,
    htmlUrl: g.html_url,
    homepageUrl: g.website && g.website.length > 0 ? g.website : null,
    description: g.description ?? null,
    language: null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: g.size ?? 0,
    stars: g.stars_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.watchers_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.updated_at,
    ownerAvatarUrl: g.owner.avatar_url ?? '',
  }
}

function giteaReleaseAssetToAsset(a: GiteaReleaseAsset): ReleaseAsset {
  return {
    name: a.name,
    size: a.size ?? 0,
    browserDownloadUrl: a.browser_download_url,
    downloadCount: a.download_count ?? 0,
  }
}

export function giteaReleaseToRelease(r: GiteaRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.published_at,
    body: r.body,
    assets: (r.assets ?? []).map(giteaReleaseAssetToAsset),
    prerelease: Boolean(r.prerelease),
  }
}

export function giteaUserToUser(u: GiteaUser): User {
  return {
    login: u.login,
    avatarUrl: u.avatar_url,
    publicRepos: 0,
  }
}

export function giteaStarredToStarredEntry(hostId: string, r: GiteaRepo): StarredEntry {
  return {
    starredAt: r.updated_at,
    repo: giteaRepoToRepo(hostId, r),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitea/normalize.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitea/normalize.ts electron/providers/gitea/normalize.test.ts
git commit -m "feat(providers/gitea): normalize Repo/Release/User → canonical shapes"
```

---

## Task 3: Add `GiteaProvider` class

Build the provider class wrapping the Gitea REST + normalize helpers. The class implements the same surface as `GitLabProvider` for every method exercised through the registry (in Phase 5 only `getCurrentUser`, plus the throw-only `startDeviceFlow` / `pollDeviceToken` so the union type stays callable). Phase 6 will exercise the metadata/social methods.

**Files:**
- Create: `electron/providers/gitea/index.ts`

- [ ] **Step 1: Write the GiteaProvider barrel**

Write `electron/providers/gitea/index.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add electron/providers/gitea/index.ts
git commit -m "feat(providers/gitea): GiteaProvider class wrapping rest + normalize"
```

---

## Task 4: Register Gitea in the provider registry

Widen `AnyProvider` to a union of `GitHubProvider | GitLabProvider | GiteaProvider`. Lazy-construct a `GiteaProvider` per `hostId` (lookup `baseUrl` via `hostConfig.getHost`). Memoize so repeated lookups return the same instance. Export `_resetGiteaCacheForTest` alongside `_resetGitLabCacheForTest`.

**Files:**
- Modify: `electron/providers/registry.ts`
- Modify: `electron/providers/registry.test.ts`

- [ ] **Step 1: Update the failing test first**

Edit `electron/providers/registry.test.ts`.

Find the imports block:

```ts
import { getProvider, getAnyProvider, getDefaultProvider, _resetGitLabCacheForTest } from './registry'
import { GitHubProvider } from './github'
import { GitLabProvider } from './gitlab'
```

Replace with:

```ts
import { getProvider, getAnyProvider, getDefaultProvider, _resetGitLabCacheForTest, _resetGiteaCacheForTest } from './registry'
import { GitHubProvider } from './github'
import { GitLabProvider } from './gitlab'
import { GiteaProvider } from './gitea'
```

Find the `beforeEach`:

```ts
  beforeEach(() => {
    _resetGitLabCacheForTest()
    setHostConfigBackend(makeMapBackend())
    seedDefaultHosts()
  })
```

Replace with:

```ts
  beforeEach(() => {
    _resetGitLabCacheForTest()
    _resetGiteaCacheForTest()
    setHostConfigBackend(makeMapBackend())
    seedDefaultHosts()
  })
```

Find the existing `'returns null for unknown host ids'` test:

```ts
  it('returns null for unknown host ids', () => {
    expect(getProvider('gt:codeberg.org')).toBeNull()
    expect(getAnyProvider('gt:codeberg.org')).toBeNull()
    expect(getAnyProvider('gl:gitlab.acme.com')).toBeNull()  // not seeded
  })
```

Replace with:

```ts
  it('returns null for unknown host ids', () => {
    expect(getAnyProvider('gt:gitea.acme.com')).toBeNull()   // not seeded
    expect(getAnyProvider('gl:gitlab.acme.com')).toBeNull()  // not seeded
    expect(getAnyProvider('xx:nothing.example')).toBeNull()  // unknown prefix
  })
```

Find the existing `'getProvider returns null for non-GitHub host ids'` test:

```ts
  it('getProvider returns null for non-GitHub host ids (narrowed legacy accessor)', () => {
    // Legacy code paths (main.ts, repoHandlers.ts) call GitHub-specific methods.
    // getProvider intentionally narrows so those paths reject non-GitHub hosts
    // up front rather than failing later with method-not-found.
    expect(getProvider('gl:gitlab.com')).toBeNull()
  })
```

Replace with:

```ts
  it('getProvider returns null for non-GitHub host ids (narrowed legacy accessor)', () => {
    // Legacy code paths (main.ts, repoHandlers.ts) call GitHub-specific methods.
    // getProvider intentionally narrows so those paths reject non-GitHub hosts
    // up front rather than failing later with method-not-found.
    expect(getProvider('gl:gitlab.com')).toBeNull()
    expect(getProvider('gt:codeberg.org')).toBeNull()
  })
```

Then add three new test cases immediately after the `'getAnyProvider memoizes the GitLab instance across calls'` test:

```ts
  it('getAnyProvider returns a Gitea provider for gt:codeberg.org after seeding', () => {
    const p = getAnyProvider('gt:codeberg.org')
    expect(p).toBeInstanceOf(GiteaProvider)
    expect(p && p.baseUrl).toBe('https://codeberg.org')
    expect(p && p.hostType).toBe('gitea')
  })

  it('getAnyProvider memoizes the Gitea instance across calls', () => {
    const a = getAnyProvider('gt:codeberg.org')
    const b = getAnyProvider('gt:codeberg.org')
    expect(a).toBe(b)
  })

  it('GitLab and Gitea providers do not collide on memoization', () => {
    const gl = getAnyProvider('gl:gitlab.com')
    const gt = getAnyProvider('gt:codeberg.org')
    expect(gl).toBeInstanceOf(GitLabProvider)
    expect(gt).toBeInstanceOf(GiteaProvider)
    expect(gl).not.toBe(gt)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: FAIL — `_resetGiteaCacheForTest` does not exist; `getAnyProvider('gt:codeberg.org')` returns null today.

- [ ] **Step 3: Update the registry implementation**

Edit `electron/providers/registry.ts`. Replace the whole file with:

```ts
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

const gitlabProviders = new Map<string, GitLabProvider>()
const giteaProviders = new Map<string, GiteaProvider>()

function resolveAny(hostId: string): AnyProvider | null {
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
 * Test-only: drop the lazy Gitea provider cache. See `_resetGitLabCacheForTest`
 * for the same rationale.
 */
export function _resetGiteaCacheForTest(): void {
  giteaProviders.clear()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/registry.ts electron/providers/registry.test.ts
git commit -m "feat(providers): register Gitea + widen AnyProvider union"
```

---

## Task 5: Seed `gt:codeberg.org` on first launch

Extend `DEFAULT_HOSTS` so the Codeberg instance appears in the host list immediately after Task 4 lands. Existing seeds are preserved; the helper is still idempotent.

**Files:**
- Modify: `electron/providers/hostConfig.ts`
- Modify: `electron/providers/hostConfig.test.ts`

- [ ] **Step 1: Update the failing test first**

Edit `electron/providers/hostConfig.test.ts`.

Find the `'seedDefaultHosts seeds GitHub and GitLab.com on first run'` test:

```ts
  it('seedDefaultHosts seeds GitHub and GitLab.com on first run', () => {
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)

    const gh = hosts.find(h => h.id === HOST_ID_GITHUB)
    expect(gh).toBeDefined()
    expect(gh!.type).toBe('github')
    expect(gh!.baseUrl).toBe('https://api.github.com')
    expect(gh!.label).toBe('GitHub')

    const gl = hosts.find(h => h.id === 'gl:gitlab.com')
    expect(gl).toBeDefined()
    expect(gl!.type).toBe('gitlab')
    expect(gl!.baseUrl).toBe('https://gitlab.com')
    expect(gl!.label).toBe('GitLab.com')
  })
```

Replace with:

```ts
  it('seedDefaultHosts seeds GitHub, GitLab.com, and Codeberg on first run', () => {
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(3)

    const gh = hosts.find(h => h.id === HOST_ID_GITHUB)
    expect(gh).toBeDefined()
    expect(gh!.type).toBe('github')
    expect(gh!.baseUrl).toBe('https://api.github.com')
    expect(gh!.label).toBe('GitHub')

    const gl = hosts.find(h => h.id === 'gl:gitlab.com')
    expect(gl).toBeDefined()
    expect(gl!.type).toBe('gitlab')
    expect(gl!.baseUrl).toBe('https://gitlab.com')
    expect(gl!.label).toBe('GitLab.com')

    const gt = hosts.find(h => h.id === 'gt:codeberg.org')
    expect(gt).toBeDefined()
    expect(gt!.type).toBe('gitea')
    expect(gt!.baseUrl).toBe('https://codeberg.org')
    expect(gt!.label).toBe('Codeberg')
  })
```

Find `'seedDefaultHosts is idempotent across repeat calls'`:

```ts
  it('seedDefaultHosts is idempotent across repeat calls', () => {
    seedDefaultHosts()
    seedDefaultHosts()
    expect(listHosts()).toHaveLength(2)
  })
```

Replace with:

```ts
  it('seedDefaultHosts is idempotent across repeat calls', () => {
    seedDefaultHosts()
    seedDefaultHosts()
    expect(listHosts()).toHaveLength(3)
  })
```

Find `'seedDefaultHosts preserves a pre-existing GitHub entry but still adds GitLab'`:

```ts
  it('seedDefaultHosts preserves a pre-existing GitHub entry but still adds GitLab', () => {
    addHost({ type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub (renamed)' })
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.find(h => h.id === HOST_ID_GITHUB)!.label).toBe('GitHub (renamed)')
    expect(hosts.find(h => h.id === 'gl:gitlab.com')).toBeDefined()
  })
```

Replace with:

```ts
  it('seedDefaultHosts preserves pre-existing entries but still adds missing defaults', () => {
    addHost({ type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub (renamed)' })
    seedDefaultHosts()
    const hosts = listHosts()
    expect(hosts).toHaveLength(3)
    expect(hosts.find(h => h.id === HOST_ID_GITHUB)!.label).toBe('GitHub (renamed)')
    expect(hosts.find(h => h.id === 'gl:gitlab.com')).toBeDefined()
    expect(hosts.find(h => h.id === 'gt:codeberg.org')).toBeDefined()
  })
```

Find `'addHost adds a self-hosted instance with a computed id'`:

```ts
  it('addHost adds a self-hosted instance with a computed id', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme GitLab' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(3)
    expect(hosts.map(h => h.id).sort()).toEqual([
      'gh:api.github.com',
      'gl:gitlab.acme.com',
      'gl:gitlab.com',
    ])
  })
```

Replace with:

```ts
  it('addHost adds a self-hosted instance with a computed id', () => {
    seedDefaultHosts()
    addHost({ type: 'gitea', baseUrl: 'https://gitea.acme.com', label: 'Acme Gitea' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(4)
    expect(hosts.map(h => h.id).sort()).toEqual([
      'gh:api.github.com',
      'gl:gitlab.com',
      'gt:codeberg.org',
      'gt:gitea.acme.com',
    ])
  })
```

Find `'getHost returns null for unknown ids'`:

```ts
  it('getHost returns null for unknown ids', () => {
    seedDefaultHosts()
    expect(getHost('gt:codeberg.org')).toBeNull()
  })
```

`gt:codeberg.org` is now seeded, so this assertion is wrong. Replace with:

```ts
  it('getHost returns null for unknown ids', () => {
    seedDefaultHosts()
    expect(getHost('gt:gitea.acme.com')).toBeNull()
    expect(getHost('xx:nothing.example')).toBeNull()
  })
```

Find `'removeHost removes the given instance'`:

```ts
  it('removeHost removes the given instance', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme GitLab' })
    removeHost('gl:gitlab.acme.com')
    expect(listHosts()).toHaveLength(2)
    expect(getHost('gl:gitlab.acme.com')).toBeNull()
  })
```

The expected length changes because the seed count went from 2 to 3. Replace with:

```ts
  it('removeHost removes the given instance', () => {
    seedDefaultHosts()
    addHost({ type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme GitLab' })
    removeHost('gl:gitlab.acme.com')
    expect(listHosts()).toHaveLength(3)
    expect(getHost('gl:gitlab.acme.com')).toBeNull()
  })
```

The `'returns an empty list before seeding'` and `'addHost is rejected for duplicate ids'` tests still pass as-is — leave them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/hostConfig.test.ts`

Expected: FAIL — only the GitHub and GitLab instances are seeded.

- [ ] **Step 3: Update `DEFAULT_HOSTS`**

Edit `electron/providers/hostConfig.ts`. Find:

```ts
const DEFAULT_HOSTS: ReadonlyArray<Omit<HostInstance, 'addedAt'>> = [
  { id: HOST_ID_GITHUB, type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub' },
  { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' },
]
```

Replace with:

```ts
const DEFAULT_HOSTS: ReadonlyArray<Omit<HostInstance, 'addedAt'>> = [
  { id: HOST_ID_GITHUB, type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub' },
  { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' },
  { id: 'gt:codeberg.org', type: 'gitea', baseUrl: 'https://codeberg.org', label: 'Codeberg' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/hostConfig.test.ts`

Expected: all cases PASS.

Re-run the registry test to make sure the new seeded host is observable through the registry:

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/hostConfig.ts electron/providers/hostConfig.test.ts
git commit -m "feat(providers): seed gt:codeberg.org alongside GitHub and GitLab on first launch"
```

---

## Task 6: Wire Gitea into `hosts:probe`

`hosts:probe` today returns `{ ok: true }` for `gh:api.github.com`, validates GitLab via `/api/v4/version`, and falls through to `"Probe not implemented for host type '<type>' yet"` for everything else. Add a Gitea branch that calls `getServerVersion(baseUrl)` (from Task 1's REST module) and returns `{ ok: true }` when the response is a JSON object with a `version` string, otherwise `{ ok: false, error: "..." }`.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Modify: `electron/ipc/hostHandlers.probe.test.ts`

- [ ] **Step 1: Update the failing test first**

Edit `electron/ipc/hostHandlers.probe.test.ts`.

Find the existing `'still falls through to "not implemented" for unknown host types'` test:

```ts
  it('still falls through to "not implemented" for unknown host types', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://codeberg.org' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not implemented/i)
  })
```

The fixture used `gitea` as the "unknown" type, but Gitea is implemented now. Replace with:

```ts
  it('still falls through to "not implemented" for genuinely unknown host types', async () => {
    const probe = handlers.get('hosts:probe')!
    // Cast through unknown — the handler accepts any string at runtime; the
    // ProbeInput type narrows to the three known values for callers but the
    // implementation surfaces a clear error if it sees anything else.
    const out = await probe({}, { type: 'unknown' as unknown as 'github', baseUrl: 'https://nope.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not implemented/i)
  })
```

Then add a new `describe('hosts:probe — Gitea')` block immediately after the closing brace of the `'hosts:probe — GitLab'` block:

```ts
describe('hosts:probe — Gitea', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true } when /api/v1/version responds with a version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '1.21.0+gitea-x' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://codeberg.org' })
    expect(out).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })

  it('hits a self-hosted base URL when given one', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '1.22.0' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    await probe({}, { type: 'gitea', baseUrl: 'https://gitea.acme.com/' })
    // Trailing slash gets normalized inside getServerVersion.
    expect(mockFetch).toHaveBeenCalledWith('https://gitea.acme.com/api/v1/version', expect.any(Object))
  })

  it('returns { ok: false } when the server is unreachable', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://nope.example' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a Gitea/i)
  })

  it('returns { ok: false } when the response is not a Gitea version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ unrelated: true }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a Gitea/i)
  })

  it('returns { ok: false } on HTTP error status', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://example.com' }) as { ok: boolean }
    expect(out.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: FAIL — Gitea branch returns "not implemented" today; the renamed "unknown host types" test now uses a value that wasn't there before.

- [ ] **Step 3: Update `hosts:probe`**

Edit `electron/ipc/hostHandlers.ts`. Find the existing GitLab REST import:

```ts
import { getServerVersion as getGitLabServerVersion } from '../providers/gitlab/rest'
```

Replace with:

```ts
import { getServerVersion as getGitLabServerVersion } from '../providers/gitlab/rest'
import { getServerVersion as getGiteaServerVersion } from '../providers/gitea/rest'
```

Find the `hosts:probe` handler body:

```ts
  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a GitLab instance (no /api/v4/version)` }
    }

    // Gitea lands in Phase 5.
    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })
```

Replace with:

```ts
  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a GitLab instance (no /api/v4/version)` }
    }

    if (input.type === 'gitea') {
      const v = await getGiteaServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a Gitea instance (no /api/v1/version)` }
    }

    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: all cases (GitHub + GitLab + Gitea + unknown-fallthrough) PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/ipc/hostHandlers.probe.test.ts
git commit -m "feat(ipc): hosts:probe validates Gitea via /api/v1/version"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all targeted vitest specs added or modified by this plan**

Run:

```bash
npx vitest run electron/providers/gitea/rest.test.ts electron/providers/gitea/normalize.test.ts electron/providers/registry.test.ts electron/providers/hostConfig.test.ts electron/ipc/hostHandlers.probe.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`

Expected: PASS (modulo the Phase 2/3 pre-existing-failure baseline). If `npm test` fails to rebuild `better-sqlite3` because of a file lock, the user's dev app is running — pause and ask before force-killing.

If new failures appear in tests not touched by this plan, they likely come from the seed-count change in Task 5 — any test that asserts `listHosts().length` exactly will need a small bump from 2 → 3. Grep for `listHosts` / `hosts:list` assertions and bring them into line with the new default.

- [ ] **Step 4: Confirm the seeded Codeberg instance shows up at runtime (skip if dev app cannot be launched)**

Per the user's preference (no visual testing — they verify UI changes themselves), do NOT launch `npm run dev`. Instead, flag in the handoff summary that the Connections pane should now list three rows: `GitHub`, `GitLab.com`, and `Codeberg`. The `ConnectionsPanel.tsx` already renders Gitea rows correctly (icon, PAT input, "How do I create a PAT?" link pointing at `${host.baseUrl}/user/settings/applications`).

- [ ] **Step 5: Hand off to the user**

Surface:
- Phase 5 complete. `GiteaProvider` exists, `gt:codeberg.org` is seeded, `hosts:probe` validates Gitea via `/api/v1/version`, and the existing Connections settings pane already supports Gitea rows.
- Phase 4's GitHub + GitLab plumbing is unchanged.
- Gitea repos are NOT yet browsable — `repoHandlers.ts` still casts the resolved provider as `GitHubProvider`. Phase 6 will widen that path when mixed-row Discover lands.
- Next: Phase 6 wires `repo.searchAll` and capability-gates RepoDetail for non-GitHub hosts so Codeberg / GitLab.com / self-hosted repos become navigable.
