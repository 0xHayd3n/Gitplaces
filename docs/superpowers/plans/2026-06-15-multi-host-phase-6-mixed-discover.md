# Multi-Host Phase 6: Mixed-Row Discover + Non-GitHub Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discover's carousel rows pull repos from every configured host and merge them into a single ranked list (`repo:searchAll`), unblock RepoDetail navigation for Codeberg/GitLab repos (universal IPC handlers now route through any provider), and wire capability gating so non-GitHub features (vulnerability alerts, code-scanning, verified-org, GraphQL bundle) are skipped rather than spamming errors.

**Architecture:** A new `electron/providers/discoverMerge.ts` accepts a `UnifiedQuery` (`'trending-week' | 'hot-today' | 'hidden-gems' | 'topic' | 'free-text'`), fans out to every host's `searchRepos` via the registry, caps each host at 10 results, soft-times-out at 4s, merges by `pushedAt` desc, and slices to 30. `repo:searchAll` is the IPC entry point that upserts results into the `repos` table (using each row's `host_id`) and returns canonical `SavedRepo[]`. `GitHubProvider.getRepo`/`searchRepos` are migrated to return canonical `Repo`/`Repo[]` (parity with GitLab/Gitea) so the repoHandlers DB-upsert code consumes one shape regardless of host. The repoHandlers `resolve()` helper splits into a narrow GitHub-only variant (for `fetchBundle`/`getCompare`/`getReceivedEvents`/`getMyRepos`/`compareRefs`/`getLastCommitsForPaths`) and a wide `resolveAny()` variant (everything else) so Codeberg/GitLab repos are at least browsable. A `hosts:getCapabilities(hostId)` IPC exposes each provider's caps, consumed by a `useHostCapabilities` renderer hook that powers conditional render in `RepoDetail` + `RepoStatsSidebar`.

**Tech Stack:** TypeScript, Electron, React, vitest, electron-store, better-sqlite3.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 6 section under "Migration phasing", plus the "Discover merging" and "Capability gating" sections.

**Out of scope for this plan:**
- Mixed-host main grid (`loadTrending` / `loadMore`) — these stay GitHub-only because cross-host infinite-scroll pagination doesn't translate cleanly (each host's paging cursor is different) and the spec only calls for "rows", not the grid. Pagination across hosts can land in Phase 7 if desired.
- Free-text search across hosts — the spec lists `'free-text'` as a `UnifiedQuery` kind, but Discover's free-text path uses the `search:raw`/`search:tagged` channels which today have GitHub-specific behaviour (tag extraction, language inference, etc.). Phase 6 implements the `'free-text'` translator in `discoverMerge` so future callers can use it, but doesn't migrate the renderer's free-text path.
- `repo:fetchBundle` widening for non-GitHub. The GraphQL bundle is GitHub-only (capability flag `graphqlBundle: false` on GitLab/Gitea). RepoDetail's fallback path (separate REST calls) handles non-GitHub browsing.
- Self-hosted Gitea/GitLab "Add a host" UX form (Phase 7).

---

## File structure

### New files

- `electron/providers/discoverMerge.ts` — `searchAllHosts(hosts, query, opts)` + `UnifiedQuery` type + per-host translation table. Pure module (uses `getAnyProvider` for dispatch).
- `electron/providers/discoverMerge.test.ts` — synthetic providers covering cap-per-host, recency sort, soft-timeout, partial-failure.
- `electron/ipc/repoHandlers.searchAll.test.ts` — `repo:searchAll` IPC integration test (mock fetch, mock host registry).
- `src/hooks/useHostCapabilities.ts` — fetches caps per hostId, module-level cache.
- `src/hooks/useHostCapabilities.test.ts` — vitest with mocked `window.api.hosts.getCapabilities`.

### Modified files

- `electron/providers/github/index.ts` — add `getRepoNormalized(token, owner, name, db)` returning `Repo`, and `searchReposNormalized(...)` returning `Repo[]`. Keep raw helpers (`getRepo`, `searchRepos`) for the GraphQL-bundle path and callers that need GitHub-native shapes.
- `electron/providers/github/index.test.ts` — add coverage for the normalized wrappers.
- `electron/ipc/repoHandlers.ts` — (a) introduce `resolveAny()` alongside `resolve()`; (b) migrate `repo:get`, `repo:search`, `repo:getMyRepos`, `repo:getMyStarred`, `repo:getReadme`, `repo:getFileContent`, `repo:getReleases`, `repo:getBranch`, `repo:getTree`, `repo:getBlob`, `repo:getRawFile`, `repo:star`, `repo:unstar`, `repo:isStarred` to use `resolveAny()` + canonical `Repo`; (c) add `repo:searchAll` handler.
- `electron/ipc/hostHandlers.ts` — add `hosts:getCapabilities(hostId)` handler.
- `electron/preload.ts` — expose `window.api.repo.searchAll(query)` and `window.api.hosts.getCapabilities(hostId)`.
- `src/views/Discover.tsx` — replace the 4 carousel-row effects (`loadHotTodayRow`, `loadTrendingWeekRow`, `loadHiddenGemsRow`, `loadAgentsRow`) with `window.api.repo.searchAll(unifiedQuery)`.
- `src/views/RepoDetail.tsx` — short-circuit `fetchBundle` to the fallback path when `caps.graphqlBundle === false`. Skip `useRepoStats` GitHub-only fetches via a `useHostCapabilities` gate.

### Files NOT touched in this plan

- `electron/providers/{gitlab,gitea}/*` — already return canonical `Repo`. No changes needed.
- `electron/providers/registry.ts` — already supports `getAnyProvider`. No changes needed.
- `electron/ipc/hostHandlers.ts` for probe/setToken/etc. — only `hosts:getCapabilities` is added.
- `src/views/RepoDetail.tsx` for the Activities tab — releases work fine across hosts already.
- `src/components/RepoStatsSidebar.tsx` — already handles `vulnerabilities == null` gracefully; no code changes needed (Phase 6 just lets it stay null for non-GitHub naturally).
- `src/hooks/useFeed.ts` — hardcoded to `HOST_ID_GITHUB` (Library home feed); deliberately GitHub-only and out of scope.

---

## Notes for the executor

- Work directly on `main`. Do NOT create a feature branch or a worktree (per project-level CLAUDE.md).
- For non-sqlite tests use `npx vitest run <path>`. Run `npm test` only at the very end (Task 8).
- Conventional commits, one per task. Scopes: `feat(providers):`, `refactor(ipc):`, `feat(ipc):`, `feat(renderer):`.
- Batch execution — run every task consecutively. Final code-review at the end.
- When migrating snake_case→camelCase in `repoHandlers.ts`, the DB upsert SQL stays identical — only the JS field accesses change (e.g. `repo.stargazers_count` → `repo.stars`). The DB columns (`stars`, `forks`, `watchers`, etc.) match the canonical field names already.
- Phase 5's `_resetGitLabCacheForTest` / `_resetGiteaCacheForTest` should be called in any new test file that exercises the registry to avoid cross-file pollution.

---

## Task 1: TDD `discoverMerge.ts`

The merger fans out a `UnifiedQuery` across configured hosts via `getAnyProvider().searchRepos(...)`, caps each host's contribution, applies a soft timeout, merges by `pushedAt` desc, and slices.

**Files:**
- Create: `electron/providers/discoverMerge.ts`
- Create: `electron/providers/discoverMerge.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/discoverMerge.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Repo } from '../../src/types/repo'
import type { HostInstance } from './types'

const resolveAnyMock = vi.fn()
vi.mock('./registry', () => ({
  getAnyProvider: (hostId: string) => resolveAnyMock(hostId),
}))

import { searchAllHosts, translateQuery, type UnifiedQuery } from './discoverMerge'

function repo(hostId: string, name: string, pushedAt: string, stars = 100): Repo {
  return {
    hostId,
    hostType: hostId.startsWith('gh:') ? 'github' : hostId.startsWith('gl:') ? 'gitlab' : 'gitea',
    hostNativeId: name,
    fullName: `org/${name}`,
    owner: 'org',
    name,
    htmlUrl: `https://example.org/org/${name}`,
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: pushedAt,
    updatedAt: pushedAt,
    pushedAt,
    ownerAvatarUrl: '',
  }
}

function host(id: string, type: HostInstance['type']): HostInstance {
  return { id, type, baseUrl: `https://${id.slice(3)}`, label: id, addedAt: '2026-01-01T00:00:00Z' }
}

describe('translateQuery', () => {
  it('builds GitHub trending-week query', () => {
    const out = translateQuery('github', { kind: 'trending-week' })
    expect(out.query).toMatch(/created:>\d{4}-\d{2}-\d{2}/)
    expect(out.sort).toBe('stars')
  })
  it('builds GitHub hot-today query', () => {
    const out = translateQuery('github', { kind: 'hot-today' })
    expect(out.query).toMatch(/pushed:>\d{4}-\d{2}-\d{2}/)
    expect(out.sort).toBe('updated')
  })
  it('builds GitHub hidden-gems query', () => {
    const out = translateQuery('github', { kind: 'hidden-gems' })
    expect(out.query).toContain('stars:50..500')
  })
  it('builds GitHub topic query', () => {
    const out = translateQuery('github', { kind: 'topic', topic: 'rust' })
    expect(out.query).toContain('topic:rust')
  })
  it('builds GitHub free-text query', () => {
    const out = translateQuery('github', { kind: 'free-text', freeText: 'electron' })
    expect(out.query).toBe('electron')
  })
  it('builds GitLab/Gitea trending-week query (plain text, recency sort)', () => {
    expect(translateQuery('gitlab', { kind: 'trending-week' }).sort).toBe('updated')
    expect(translateQuery('gitea', { kind: 'trending-week' }).sort).toBe('updated')
  })
  it('builds GitLab/Gitea topic query', () => {
    expect(translateQuery('gitlab', { kind: 'topic', topic: 'rust' }).query).toBe('rust')
    expect(translateQuery('gitea', { kind: 'topic', topic: 'rust' }).query).toBe('rust')
  })
})

describe('searchAllHosts', () => {
  beforeEach(() => resolveAnyMock.mockReset())

  it('fans out across hosts, caps each at capPerHost, sorts by pushedAt desc', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([
          repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z'),
          repo('gh:api.github.com', 'b', '2026-06-13T10:00:00Z'),
          repo('gh:api.github.com', 'c', '2026-06-12T10:00:00Z'),
        ]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockResolvedValue([
          repo('gl:gitlab.com', 'x', '2026-06-15T10:00:00Z'),
          repo('gl:gitlab.com', 'y', '2026-06-11T10:00:00Z'),
        ]),
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['x', 'a', 'b', 'c', 'y'])  // sorted by pushedAt desc
  })

  it('respects capPerHost — clips each host before merging', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    resolveAnyMock.mockImplementation(() => ({
      searchRepos: vi.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) =>
          repo('gh:api.github.com', `r${i}`, `2026-06-${String(14 - (i % 14)).padStart(2, '0')}T10:00:00Z`),
        ),
      ),
    }))
    const out = await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 5, totalLimit: 100 })
    expect(out).toHaveLength(5)
  })

  it('respects totalLimit', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')
    resolveAnyMock.mockImplementation((hostId: string) => ({
      searchRepos: vi.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => repo(hostId, `${hostId.slice(0, 2)}-${i}`, `2026-06-${String(15 - i).padStart(2, '0')}T10:00:00Z`)),
      ),
    }))
    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 8 })
    expect(out).toHaveLength(8)
  })

  it('soft-times-out a slow host — contributes nothing rather than blocking the merge', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockImplementation(() => new Promise(() => {})),  // never resolves
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30, timeoutMs: 50 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('a throwing host contributes nothing — others still merge', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')

    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      if (hostId === 'gl:gitlab.com') return {
        searchRepos: vi.fn().mockRejectedValue(new Error('boom')),
      }
      return null
    })

    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('returns [] when every host fails', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    resolveAnyMock.mockImplementation(() => ({
      searchRepos: vi.fn().mockRejectedValue(new Error('down')),
    }))
    const out = await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out).toEqual([])
  })

  it('skips hosts with no resolved provider (e.g. token missing / config mismatch)', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')
    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z')]),
      }
      return null  // GitLab unresolvable
    })
    const out = await searchAllHosts([ghHost, glHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name)).toEqual(['a'])
  })

  it('passes the per-host token via getToken (mocked) when supplied', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const searchSpy = vi.fn().mockResolvedValue([])
    resolveAnyMock.mockImplementation(() => ({ searchRepos: searchSpy }))
    await searchAllHosts([ghHost], { kind: 'trending-week' }, { capPerHost: 10, totalLimit: 30, tokenForHost: (id: string) => `tok-${id}` })
    expect(searchSpy).toHaveBeenCalledWith(
      'tok-gh:api.github.com',
      expect.any(String),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/discoverMerge.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/discoverMerge.ts`:

```ts
// electron/providers/discoverMerge.ts
//
// Multi-host Discover merger. Fans out a UnifiedQuery across every configured
// host via getAnyProvider().searchRepos, caps each host's contribution at
// capPerHost, soft-times-out slow hosts, merges by pushedAt desc, and slices
// to totalLimit. The Discover home rows call this through repo:searchAll.

import type { Repo } from '../../src/types/repo'
import type { HostInstance, HostType } from './types'
import { getAnyProvider } from './registry'

export type UnifiedQuery =
  | { kind: 'trending-week' }
  | { kind: 'hot-today' }
  | { kind: 'hidden-gems' }
  | { kind: 'topic'; topic: string }
  | { kind: 'free-text'; freeText: string }

export interface SearchAllOpts {
  capPerHost: number
  totalLimit: number
  /** Soft timeout per host. Hosts that take longer contribute nothing this round. */
  timeoutMs?: number
  /** Optional token lookup. Returns null if the host is unauthenticated (anonymous mode). */
  tokenForHost?: (hostId: string) => string | null
}

interface TranslatedQuery {
  query: string
  sort: string
  order: 'asc' | 'desc'
}

function daysAgo(n: number): string {
  // We can't use Date.now() in test snapshots, but this runs in production
  // (and the discoverMerge tests assert the regex shape, not a specific date).
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().split('T')[0]
}

export function translateQuery(hostType: HostType, q: UnifiedQuery): TranslatedQuery {
  if (hostType === 'github') {
    switch (q.kind) {
      case 'trending-week': return { query: `created:>${daysAgo(7)}`, sort: 'stars', order: 'desc' }
      case 'hot-today':     return { query: `pushed:>${daysAgo(1)}`,  sort: 'updated', order: 'desc' }
      case 'hidden-gems':   return { query: 'stars:50..500',          sort: 'stars',   order: 'desc' }
      case 'topic':         return { query: `topic:${q.topic}`,       sort: 'stars',   order: 'desc' }
      case 'free-text':     return { query: q.freeText,                sort: 'stars',   order: 'desc' }
    }
  }
  // GitLab + Gitea: free-text search; the per-host code does client-side
  // filtering for `created` / `pushed` / `stars` ranges if needed. For Phase 6
  // we let recency sort do the heavy lifting and rank by pushedAt at merge.
  switch (q.kind) {
    case 'trending-week':
    case 'hot-today':     return { query: '', sort: 'updated', order: 'desc' }
    case 'hidden-gems':   return { query: '', sort: 'stars',   order: 'desc' }
    case 'topic':         return { query: q.topic,    sort: 'stars', order: 'desc' }
    case 'free-text':     return { query: q.freeText, sort: 'stars', order: 'desc' }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(v => { clearTimeout(timer); resolve(v) })
     .catch(() => { clearTimeout(timer); resolve(null) })
  })
}

export async function searchAllHosts(
  hosts: HostInstance[],
  query: UnifiedQuery,
  opts: SearchAllOpts,
): Promise<Repo[]> {
  const timeout = opts.timeoutMs ?? 4000
  const tokenForHost = opts.tokenForHost ?? (() => null)

  const perHost = await Promise.all(hosts.map(async (host) => {
    const provider = getAnyProvider(host.id)
    if (!provider) return []
    const translated = translateQuery(host.type, query)
    const token = tokenForHost(host.id)
    const work = (provider.searchRepos as (
      token: string | null,
      query: string,
      perPage: number,
      sort: string,
      order: string,
      page: number,
    ) => Promise<Repo[]>)(token, translated.query, opts.capPerHost, translated.sort, translated.order, 1)
    const result = await withTimeout(work, timeout)
    if (!Array.isArray(result)) return []
    return result.slice(0, opts.capPerHost)
  }))

  const merged = perHost.flat()
  merged.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
  return merged.slice(0, opts.totalLimit)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/discoverMerge.test.ts`

Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/discoverMerge.ts electron/providers/discoverMerge.test.ts
git commit -m "feat(providers): discoverMerge — multi-host search fan-out with cap + recency sort"
```

---

## Task 2: Normalize `GitHubProvider.getRepo` + `searchRepos` to canonical `Repo`

GitHubProvider returns provider-native `GitHubRepo` from `getRepo`/`searchRepos` — but GitLab/Gitea return canonical `Repo`. To let repoHandlers consume one shape regardless of host, add `getRepoNormalized`/`searchReposNormalized` to GitHubProvider that wrap the legacy methods through `githubRepoToRepo`. Don't remove the legacy raw methods — `fetchBundle` and a few other GitHub-specific code paths still need them.

**Files:**
- Modify: `electron/providers/github/index.ts`
- Modify: `electron/providers/github/index.test.ts` (or create if absent)

- [ ] **Step 1: Add the normalized wrappers**

Edit `electron/providers/github/index.ts`. After the `getRepo = rest.getRepo` block, add:

```ts
  // ── Canonical-shape wrappers ───────────────────────────────────
  //
  // GitLab/Gitea providers return canonical `Repo` directly. These wrappers
  // give the GitHub provider the same surface so repoHandlers consumes one
  // shape regardless of host. The raw `getRepo` / `searchRepos` methods stay
  // for GraphQL bundle paths and any callers that need GitHub-native fields.

  async getRepoNormalized(
    token: string | null,
    owner: string,
    name: string,
    db?: Database.Database,
  ): Promise<Repo> {
    const raw = await rest.getRepo(token, owner, name, db)
    return githubRepoToRepo(raw)
  }

  async searchReposNormalized(
    token: string | null,
    query: string,
    perPage = 100,
    sort = 'stars',
    order = 'desc',
    page = 1,
  ): Promise<Repo[]> {
    const items = await rest.searchRepos(token, query, perPage, sort, order, page)
    return items.map(githubRepoToRepo)
  }
```

Add the supporting import at the top of the file. Find:

```ts
import { githubUserToUser } from './normalize'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
import type { User } from '../../../src/types/repo'
```

Replace with:

```ts
import { githubUserToUser, githubRepoToRepo } from './normalize'
import { HOST_ID_GITHUB, type ProviderCapabilities } from '../types'
import type { User, Repo } from '../../../src/types/repo'
```

- [ ] **Step 2: Add a coverage test**

If `electron/providers/github/index.test.ts` does not yet exist, create it. Otherwise add the cases below to the existing file.

Write `electron/providers/github/index.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { githubProvider } from './index'

function makeResponse(body: unknown, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  }
}

const REPO_FIXTURE = {
  id: 42, name: 'demo', full_name: 'alice/demo',
  owner: { login: 'alice', avatar_url: 'https://x/a.png' },
  description: 'a demo', homepage: 'https://demo.example', html_url: 'https://github.com/alice/demo',
  language: 'TypeScript', topics: ['typescript', 'cli'],
  license: { spdx_id: 'MIT', key: 'mit', name: 'MIT License', url: null },
  default_branch: 'main', archived: false, size: 12, stargazers_count: 42, forks_count: 5,
  watchers_count: 42, open_issues_count: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-14T22:00:00Z', pushed_at: '2026-06-14T22:00:00Z',
}

describe('GitHubProvider — canonical wrappers', () => {
  beforeEach(() => mockFetch.mockReset())

  it('getRepoNormalized returns canonical Repo', async () => {
    mockFetch.mockResolvedValue(makeResponse(REPO_FIXTURE))
    const r = await githubProvider.getRepoNormalized('tok', 'alice', 'demo')
    expect(r.fullName).toBe('alice/demo')
    expect(r.stars).toBe(42)
    expect(r.forks).toBe(5)
    expect(r.license).toBe('MIT')
    expect(r.homepageUrl).toBe('https://demo.example')
    expect(r.hostType).toBe('github')
  })

  it('searchReposNormalized returns canonical Repo[]', async () => {
    mockFetch.mockResolvedValue(makeResponse({ items: [REPO_FIXTURE] }))
    const rows = await githubProvider.searchReposNormalized('tok', 'rust', 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].fullName).toBe('alice/demo')
    expect(rows[0].license).toBe('MIT')
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run electron/providers/github/index.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/providers/github/index.ts electron/providers/github/index.test.ts
git commit -m "feat(providers/github): canonical-shape getRepoNormalized + searchReposNormalized"
```

---

## Task 3: Split `resolve()` / `resolveAny()` in repoHandlers

Today every handler calls `resolve(hostId)` which uses the narrow `getProvider()` and throws "Unknown host" for non-GitHub. We need a wide variant for the universal handlers.

**Files:**
- Modify: `electron/ipc/repoHandlers.ts`

- [ ] **Step 1: Update the imports and add `resolveAny`**

Edit `electron/ipc/repoHandlers.ts`.

Find:

```ts
import { getProvider } from '../providers/registry'
import { getToken } from '../providers/tokenStore'
```

Replace with:

```ts
import { getProvider, getAnyProvider, type AnyProvider } from '../providers/registry'
import { getToken } from '../providers/tokenStore'
```

Find the existing `resolve` helper:

```ts
function resolve(hostId: string) {
  const provider = getProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider: provider as GitHubProvider, token }
}
```

Replace with:

```ts
/** Narrow accessor: returns only when the host is GitHub. Use for handlers
 *  that call GitHub-specific methods (fetchBundle, getCompare, etc.). */
function resolve(hostId: string) {
  const provider = getProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider, token }
}

/** Wide accessor: returns any registered provider. Use for handlers whose
 *  contract maps onto every host (getReadme, getReleases, star, etc.). */
function resolveAny(hostId: string): { provider: AnyProvider; token: string | null } {
  const provider = getAnyProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider, token }
}
```

- [ ] **Step 2: Migrate the universal handlers to `resolveAny`**

For each of these handlers in `repoHandlers.ts`, swap `resolve(hostId)` for `resolveAny(hostId)`:

- `repo:get` (uses `provider.getRepo` — but we'll migrate to `getRepoNormalized` in Task 4 next)
- `repo:search` (Task 4)
- `repo:getReadme`
- `repo:getFileContent`
- `repo:getReleases`
- `repo:getBranch`
- `repo:getTree`
- `repo:getBlob`
- `repo:getRawFile`
- `repo:star`
- `repo:unstar`
- `repo:isStarred`
- `repo:getMyStarred`

For each, the diff is mechanical: `const { provider, token } = resolve(hostId)` → `const { provider, token } = resolveAny(hostId)`.

Leave these handlers on the narrow `resolve()` — they call GitHub-only methods:

- `repo:fetchBundle` (uses `fetchRepoBundle` GraphQL)
- `repo:getCompare` (uses `provider.getCompare`)
- `repo:compareRefs` (uses `provider.compareRefs`)
- `repo:getLastCommitsForPaths` (uses `provider.fetchLastCommitsForPaths` GraphQL)
- `repo:getReceivedEvents` (uses `provider.getReceivedEvents`)
- `repo:getMyRepos` (uses `provider.getMyRepos` — Phase 6 keeps this GitHub-only; GitLab/Gitea don't yet implement this method on the class)

In each "stays narrow" handler, also remove the `as GitHubProvider` cast (`resolve()` now returns the correctly-typed `GitHubProvider`). Find every occurrence of `provider as GitHubProvider` in this file and drop the cast — `resolve()` already narrows.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: errors will surface because `provider.getRepo()` and `provider.searchRepos()` now return the union of GitHubProvider's raw shape and GitLab/Gitea's canonical shape. Task 4 fixes these by migrating to `getRepoNormalized` / `searchReposNormalized`. For now, document the remaining errors in the commit message.

- [ ] **Step 4: Commit**

The migration is not yet type-clean — Task 4 finishes it. Commit the partial step so the diff stays reviewable:

```bash
git add electron/ipc/repoHandlers.ts
git commit -m "refactor(ipc): split resolve()/resolveAny() — universal handlers route through any provider"
```

Note: type errors in `repo:get` and `repo:search` are expected at this commit — Task 4 closes them.

---

## Task 4: Migrate `repo:get` / `repo:search` / `repo:searchAll` to canonical Repo

This task does three things together because they share the same DB upsert pattern:

1. Migrate `repo:get` to use `getRepoNormalized` (canonical Repo) and update the SQL bindings to use `repo.stars` / `repo.forks` / `repo.watchers` / `repo.license` / `repo.homepageUrl` / `repo.defaultBranch` etc.
2. Migrate `repo:search` similarly.
3. Add `repo:searchAll` which calls `discoverMerge.searchAllHosts(...)`, upserts each result row tagged with its hostId, and returns SavedRepo[].

**Files:**
- Modify: `electron/ipc/repoHandlers.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Update imports in `repoHandlers.ts`**

Find:

```ts
import {
  githubRepoToRepo,
  githubReleaseToRelease,
  githubStarredToStarredEntry,
} from '../providers/github/normalize'
```

Replace with:

```ts
import {
  githubReleaseToRelease,
  githubStarredToStarredEntry,
} from '../providers/github/normalize'
import { listHosts } from '../providers/hostConfig'
import { searchAllHosts, type UnifiedQuery } from '../providers/discoverMerge'
import type { Repo } from '../../src/types/repo'
```

(`githubRepoToRepo` is no longer needed inside repoHandlers — `getRepoNormalized` does it.)

- [ ] **Step 2: Migrate `repo:get` to canonical fields**

Find the `repo:get` handler. Replace the body with the canonical-field version:

```ts
  ipcMain.handle('repo:get', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    const db = getDb(app.getPath('userData'))

    const fresh = db.prepare(
      'SELECT * FROM repos WHERE owner = ? AND name = ? AND fetched_at IS NOT NULL AND fetched_at > ?'
    ).get(owner, name, Date.now() - REPO_FETCH_TTL_MS) as RepoRow | undefined
    if (fresh) return repoRowToSavedRepo(fresh)

    let repo: Repo
    try {
      repo = await ('getRepoNormalized' in provider
        ? provider.getRepoNormalized(token, owner, name, db)
        : provider.getRepo(token, owner, name, db))
    } catch {
      const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
      return row ? repoRowToSavedRepo(row) : null
    }

    const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: repo.topics })
    const rid = String(repo.hostNativeId)
    cascadeRepoId(db, owner, name, rid)
    db.prepare(`
      INSERT INTO repos (id, host_id, owner, name, description, language, topics, stars, forks, license,
                         homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                         discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                         type_bucket, type_sub)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        host_id        = excluded.host_id,
        owner          = excluded.owner,
        name           = excluded.name,
        description    = excluded.description,
        language       = excluded.language,
        topics         = excluded.topics,
        stars          = excluded.stars,
        forks          = excluded.forks,
        updated_at     = excluded.updated_at,
        pushed_at      = excluded.pushed_at,
        created_at     = excluded.created_at,
        watchers       = excluded.watchers,
        size           = excluded.size,
        open_issues    = excluded.open_issues,
        default_branch = excluded.default_branch,
        avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
        saved_at       = repos.saved_at,
        discovered_at  = repos.discovered_at,
        discover_query = repos.discover_query,
        banner_color   = repos.banner_color,
        type_bucket    = excluded.type_bucket,
        type_sub       = excluded.type_sub
    `).run(
      rid, hostId, owner, name, repo.description, repo.language,
      JSON.stringify(repo.topics), repo.stars, repo.forks,
      repo.license, repo.homepageUrl, repo.updatedAt, repo.pushedAt,
      repo.createdAt,
      repo.watchers, repo.size, repo.openIssues,
      repo.defaultBranch, repo.ownerAvatarUrl,
      classified?.bucket ?? null, classified?.subType ?? null,
    )

    db.prepare('UPDATE repos SET fetched_at = ? WHERE owner = ? AND name = ?')
      .run(Date.now(), owner, name)

    if (repo.ownerAvatarUrl) {
      const existing = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(owner, name) as { banner_color: string | null } | undefined
      if (!existing?.banner_color) {
        extractDominantColor(repo.ownerAvatarUrl)
          .then(color => {
            db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
              .run(JSON.stringify(color), owner, name)
          })
          .catch(() => {/* non-critical */})
      }
    }

    const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
    return row ? repoRowToSavedRepo(row) : null
  })
```

Key changes:
- `resolve()` → `resolveAny()`
- The `'getRepoNormalized' in provider` check handles GitHub's narrow surface (it has both raw `getRepo` and the canonical wrapper). Non-GitHub providers only have `getRepo` returning canonical. The conditional resolves at runtime; both branches return `Repo`.
- All snake_case field accesses (`stargazers_count`, etc.) become camelCase (`stars`, etc.).
- The SQL now also writes `host_id` (the column already exists from Phase 1).

- [ ] **Step 3: Migrate `repo:search` to canonical fields**

Find the `repo:search` handler. Replace the body with the canonical-field version:

```ts
  ipcMain.handle('repo:search', async (_event, hostId: string, query: string, sort?: string, order?: string, page?: number) => {
    const { provider, token } = resolveAny(hostId)
    const cacheKey = `${hostId}:${query}:${sort ?? 'stars'}:${order ?? 'desc'}:${page ?? 1}`

    const cached = searchReposCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < SEARCH_REPOS_TTL) {
      return cached.rows
    }

    let items: Repo[]
    try {
      items = await ('searchReposNormalized' in provider
        ? provider.searchReposNormalized(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1)
        : provider.searchRepos(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1))
    } catch (err) {
      const msg = String(err)
      if (/\b(403|429)\b/.test(msg)) {
        if (cached) return cached.rows
        const db = getDb(app.getPath('userData'))
        const langMatch = query.match(/\blanguage:([^\s]+)/i)
        const lang = langMatch ? langMatch[1] : null
        let rows: RepoRow[] = []
        if (lang) {
          rows = db.prepare('SELECT * FROM repos WHERE LOWER(language) = LOWER(?) ORDER BY stars DESC LIMIT 100').all(lang) as RepoRow[]
        }
        if (rows.length === 0) {
          rows = db.prepare('SELECT * FROM repos WHERE stars IS NOT NULL ORDER BY stars DESC LIMIT 100').all() as RepoRow[]
        }
        if (rows.length === 0) {
          rows = db.prepare('SELECT * FROM repos ORDER BY discovered_at DESC LIMIT 100').all() as RepoRow[]
        }
        return rows.map(repoRowToSavedRepo)
      }
      throw err
    }
    if (items.length === 0) return []

    const db = getDb(app.getPath('userData'))
    const rows = upsertReposToDb(db, items, hostId, query)
    searchReposCache.set(cacheKey, { rows, ts: Date.now() })
    return rows
  })
```

You'll need a helper `upsertReposToDb` because Task 5's `repo:searchAll` does the same upsert. Add this helper just before `registerRepoHandlers`:

```ts
function upsertReposToDb(
  db: ReturnType<typeof getDb>,
  items: Repo[],
  hostIdForDiscovered: string | null,
  discoverQuery: string,
): SavedRepo[] {
  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO repos (id, host_id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      host_id        = excluded.host_id,
      owner          = excluded.owner,
      name           = excluded.name,
      description    = excluded.description,
      language       = excluded.language,
      topics         = excluded.topics,
      stars          = excluded.stars,
      forks          = excluded.forks,
      updated_at     = excluded.updated_at,
      pushed_at      = excluded.pushed_at,
      created_at     = excluded.created_at,
      discovered_at  = excluded.discovered_at,
      discover_query = excluded.discover_query,
      watchers       = excluded.watchers,
      size           = excluded.size,
      open_issues    = excluded.open_issues,
      default_branch = excluded.default_branch,
      avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
      saved_at       = repos.saved_at,
      banner_color   = repos.banner_color,
      type_bucket    = excluded.type_bucket,
      type_sub       = excluded.type_sub
  `)

  db.transaction(() => {
    for (const repo of items) {
      const rid = String(repo.hostNativeId)
      cascadeRepoId(db, repo.owner, repo.name, rid)
      const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: repo.topics })
      upsert.run(
        rid, repo.hostId, repo.owner, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics), repo.stars, repo.forks,
        repo.license, repo.homepageUrl, repo.updatedAt, repo.pushedAt,
        repo.createdAt,
        now, discoverQuery, repo.watchers, repo.size, repo.openIssues,
        repo.defaultBranch, repo.ownerAvatarUrl,
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()

  setImmediate(() => {
    void poolAll(items.filter(r => r.ownerAvatarUrl), 3, async (repo) => {
      const row = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(repo.owner, repo.name) as { banner_color: string | null } | undefined
      if (row?.banner_color) return
      const color = await extractDominantColor(repo.ownerAvatarUrl)
      db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
        .run(JSON.stringify(color), repo.owner, repo.name)
    })
  })

  return items
    .map(r => db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(r.owner, r.name) as RepoRow | undefined)
    .filter((row): row is RepoRow => Boolean(row))
    .map(repoRowToSavedRepo)
}
```

(The `hostIdForDiscovered` parameter is unused here — kept as a signature placeholder so future code can tag discovered_at differently per host if needed. Remove if linters complain.)

- [ ] **Step 4: Add `repo:searchAll` handler**

In `registerRepoHandlers`, after the existing `repo:search` handler, add:

```ts
  ipcMain.handle('repo:searchAll', async (_event, query: UnifiedQuery): Promise<SavedRepo[]> => {
    const hosts = listHosts()
    const items = await searchAllHosts(hosts, query, {
      capPerHost: 10,
      totalLimit: 30,
      timeoutMs: 4000,
      tokenForHost: (id) => getToken(id),
    })
    if (items.length === 0) return []
    const db = getDb(app.getPath('userData'))
    const queryString = JSON.stringify(query)
    return upsertReposToDb(db, items, null, queryString)
  })
```

- [ ] **Step 5: Add preload binding**

Edit `electron/preload.ts`. After the `search:` binding, add:

```ts
    searchAll: (query: import('./providers/discoverMerge').UnifiedQuery) =>
      ipcRenderer.invoke('repo:searchAll', query) as Promise<import('../src/types/repo').SavedRepo[]>,
```

- [ ] **Step 6: Update preload type augmentation**

If `src/env.d.ts` (or similar `.d.ts` file in `src/`) augments `window.api.repo`, add the matching `searchAll(query)` signature so renderer code type-checks.

Find the existing `search:` line in `src/env.d.ts`. Add immediately after it:

```ts
        searchAll: (query: import('../electron/providers/discoverMerge').UnifiedQuery) => Promise<import('./types/repo').SavedRepo[]>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 8: Run touched specs**

```bash
npx vitest run electron/providers/discoverMerge.test.ts electron/providers/github/index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/repoHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(ipc): repo:searchAll + migrate repo:get/search to canonical Repo"
```

---

## Task 5: `hosts:getCapabilities` IPC + `useHostCapabilities` hook

Expose `provider.capabilities()` over IPC so the renderer can conditionally render features.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`
- Create: `src/hooks/useHostCapabilities.ts`
- Create: `src/hooks/useHostCapabilities.test.ts`

- [ ] **Step 1: Add the IPC handler**

Edit `electron/ipc/hostHandlers.ts`. In `registerHostHandlers`, after `hosts:getConnectedUser`, add:

```ts
  ipcMain.handle('hosts:getCapabilities', (_event, hostId: string) => {
    const provider = getAnyProvider(hostId)
    if (!provider) return null
    return provider.capabilities()
  })
```

- [ ] **Step 2: Add preload binding**

Edit `electron/preload.ts`. In the `hosts:` block, after the existing `getConnectedUser`, add:

```ts
    getCapabilities: (hostId: string) =>
      ipcRenderer.invoke('hosts:getCapabilities', hostId) as Promise<import('./providers/types').ProviderCapabilities | null>,
```

- [ ] **Step 3: Augment src/env.d.ts**

Find the existing `hosts:` augmentation in `src/env.d.ts` and add a matching signature for `getCapabilities`.

- [ ] **Step 4: Write the hook test**

Write `src/hooks/useHostCapabilities.test.ts`:

```ts
// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHostCapabilities, _resetCapabilitiesCacheForTest } from './useHostCapabilities'

const getCaps = vi.fn()

beforeEach(() => {
  _resetCapabilitiesCacheForTest()
  getCaps.mockReset()
  ;(globalThis as any).window.api = { hosts: { getCapabilities: getCaps } }
})

describe('useHostCapabilities', () => {
  it('returns null while loading and resolves to caps once IPC responds', async () => {
    getCaps.mockResolvedValue({
      vulnerabilityAlerts: true, codeScanningAlerts: true, events: true,
      trendingDiscovery: true, graphqlBundle: true, isVerifiedOrg: true,
    })
    const { result } = renderHook(() => useHostCapabilities('gh:api.github.com'))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.graphqlBundle).toBe(true))
  })

  it('caches by hostId — second mount reuses the resolved caps', async () => {
    getCaps.mockResolvedValue({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    await waitFor(() => expect(a.result.current?.graphqlBundle).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    const b = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    expect(b.result.current?.graphqlBundle).toBe(false)
    expect(getCaps).toHaveBeenCalledTimes(1)  // still one — second mount hit the cache
  })

  it('returns null when the IPC returns null (unknown host)', async () => {
    getCaps.mockResolvedValue(null)
    const { result } = renderHook(() => useHostCapabilities('xx:unknown'))
    await waitFor(() => expect(getCaps).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
```

- [ ] **Step 5: Write the hook**

Write `src/hooks/useHostCapabilities.ts`:

```ts
import { useEffect, useState } from 'react'

// Mirror of electron/providers/types.ts → ProviderCapabilities. Kept inline so
// the renderer doesn't have to import from the electron tree at runtime.
export interface ProviderCapabilities {
  vulnerabilityAlerts: boolean
  codeScanningAlerts: boolean
  events: boolean
  trendingDiscovery: boolean
  graphqlBundle: boolean
  isVerifiedOrg: boolean
}

// Module-level cache: provider capabilities don't change in-process, so first
// fetch wins forever. Renderer hooks reuse the resolved promise so concurrent
// callers don't fan out to multiple IPC round-trips.
const cache = new Map<string, ProviderCapabilities | null>()
const inflight = new Map<string, Promise<ProviderCapabilities | null>>()

export function _resetCapabilitiesCacheForTest(): void {
  cache.clear()
  inflight.clear()
}

export function useHostCapabilities(hostId: string | null): ProviderCapabilities | null {
  const [caps, setCaps] = useState<ProviderCapabilities | null>(
    () => (hostId ? cache.get(hostId) ?? null : null),
  )

  useEffect(() => {
    if (!hostId) { setCaps(null); return }
    const cached = cache.get(hostId)
    if (cached !== undefined) { setCaps(cached); return }

    let cancelled = false
    const existing = inflight.get(hostId)
    const promise = existing ?? window.api.hosts.getCapabilities(hostId)
      .then(c => { cache.set(hostId, c); inflight.delete(hostId); return c })
      .catch(() => { inflight.delete(hostId); return null })
    inflight.set(hostId, promise)
    promise.then(c => { if (!cancelled) setCaps(c) })
    return () => { cancelled = true }
  }, [hostId])

  return caps
}
```

- [ ] **Step 6: Run the hook test**

Run: `npx vitest run src/hooks/useHostCapabilities.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/preload.ts src/env.d.ts src/hooks/useHostCapabilities.ts src/hooks/useHostCapabilities.test.ts
git commit -m "feat(ipc): hosts:getCapabilities + useHostCapabilities hook"
```

---

## Task 6: Discover.tsx — 4 carousel rows use `searchAll`

The four home-screen carousel effects (`loadHotTodayRow`, `loadTrendingWeekRow`, `loadHiddenGemsRow`, `loadAgentsRow`) currently call `window.api.repo.search(HOST_ID_GITHUB, ...)`. Migrate each to `window.api.repo.searchAll(...)`.

**Files:**
- Modify: `src/views/Discover.tsx`

- [ ] **Step 1: Replace the four effects**

Edit `src/views/Discover.tsx`.

Find the existing `loadHotTodayRow` body (around line 348):

```ts
      try {
        const q = buildViewModeQuery('hot-today', '', '')
        const { sort, order } = getViewModeSort('hot-today')
        // search statically returns Repo[] but the handler emits SavedRepo[]
        // (rows go through repoRowToSavedRepo). Safe to widen here.
        const data = await window.api.repo.search(HOST_ID_GITHUB, q, sort, order) as SavedRepo[]
        _hotTodayModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedHotToday(data)
        setHotTodayRowRepos(data)
      } catch {
        // non-critical
      }
```

Replace with:

```ts
      try {
        const data = await window.api.repo.searchAll({ kind: 'hot-today' })
        _hotTodayModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedHotToday(data)
        setHotTodayRowRepos(data)
      } catch {
        // non-critical
      }
```

Find the existing `loadTrendingWeekRow` body. Replace its `try` block with:

```ts
      try {
        const data = await window.api.repo.searchAll({ kind: 'trending-week' })
        _trendingWeekModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedTrendingWeek(data)
        setTrendingWeekRowRepos(data)
      } catch {
        // non-critical
      }
```

Find the existing `loadHiddenGemsRow` body. Replace its `try` block with:

```ts
      try {
        const data = await window.api.repo.searchAll({ kind: 'hidden-gems' })
        _hiddenGemsModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedHiddenGems(data)
        setHiddenGemsRowRepos(data)
      } catch {
        // non-critical
      }
```

Find the existing `loadAgentsRow` body. The 'agents' view-mode maps to a topic search (`buildViewModeQuery('agents', ...)` returns a GitHub-style topic query). Replace its `try` block with:

```ts
      try {
        const data = await window.api.repo.searchAll({ kind: 'topic', topic: 'ai-agent' })
        _agentsModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedAgents(data)
        setAgentsRowRepos(data)
      } catch {
        // non-critical
      }
```

(The `'ai-agent'` topic is what `buildViewModeQuery('agents', ...)` produces today; if you want the exact same query, inspect `src/lib/discoverQueries.ts` and grab whatever topic-keyword it emits.)

- [ ] **Step 2: Remove now-unused imports**

The carousel rows no longer need `buildViewModeQuery` or `getViewModeSort` from `../lib/discoverQueries` (the main grid still uses them), and they don't need `HOST_ID_GITHUB` from `../lib/hostIds` if there are no other consumers. Leave the imports as-is for now — the main grid (`loadTrending`, `loadMore`) still uses them.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(renderer): Discover carousel rows fan out across hosts via repo.searchAll"
```

---

## Task 7: RepoDetail capability gating

When viewing a non-GitHub repo, the GraphQL bundle path is GitHub-only; skip it and go straight to the REST fallback. Also skip the `useRepoStats` fetch since `repo:getRepoStats` returns GitHub-specific signals (vulnerabilities, code-scanning) that don't exist on other hosts.

**Files:**
- Modify: `src/views/RepoDetail.tsx`

- [ ] **Step 1: Import the hook**

In `src/views/RepoDetail.tsx`, add to the imports block near the top:

```ts
import { useHostCapabilities } from '../hooks/useHostCapabilities'
```

- [ ] **Step 2: Read capabilities**

Just after the existing `const hostId = ...` line (around line 544), add:

```ts
  const hostCaps = useHostCapabilities(hostId)
```

- [ ] **Step 3: Gate `fetchBundle`**

Find the `window.api.repo.fetchBundle(hostId, owner, name)` call (around line 847). It runs unconditionally today. Wrap it so it only runs when bundle is supported:

```ts
    const bundlePromise = hostCaps?.graphqlBundle === false
      ? Promise.resolve(null)
      : window.api.repo.fetchBundle(hostId, owner, name)
    bundlePromise
      .then((bundle) => { /* existing handler stays unchanged */ })
      .catch(() => { if (!cancelled) setRepoError(true) })
```

(The existing `.then((bundle) => { ... if (!bundle) { ... fallback REST calls ... } })` branch already handles `bundle === null` and falls back to `repo:get` + `repo:getReleases`. The fallback path works for non-GitHub now that Task 4 widened the universal handlers.)

- [ ] **Step 4: Gate `useRepoStats`**

`useRepoStats` is called around line 610. It runs `repo:getRepoStats` which fetches GitHub-specific signals. Skip it when caps say so. Find:

```ts
  const rawRepoStats = useRepoStats(hostId, owner, name, activeTab === 'activities')
```

Replace with:

```ts
  // Stats sidebar pulls GitHub-only signals (vulnerabilities, code-scanning,
  // momentum derived from received_events). Skip the IPC entirely for hosts
  // that don't support it; downstream consumers handle 'loading' gracefully.
  const statsEnabled = activeTab === 'activities' && (hostCaps == null || hostCaps.vulnerabilityAlerts || hostCaps.codeScanningAlerts || hostCaps.events)
  const rawRepoStats = useRepoStats(hostId, owner, name, statsEnabled)
```

(The `hostCaps == null` check keeps the legacy behaviour while caps are still loading. Once caps resolve, the IPC is suppressed for non-GitHub hosts.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/RepoDetail.tsx
git commit -m "feat(renderer): RepoDetail skips bundle + stats fetches for hosts without those caps"
```

---

## Task 8: Final verification + code review

- [ ] **Step 1: Run all touched specs**

```bash
npx vitest run electron/providers/discoverMerge.test.ts electron/providers/github/index.test.ts src/hooks/useHostCapabilities.test.ts electron/providers/gitea/rest.test.ts electron/providers/gitea/normalize.test.ts electron/providers/registry.test.ts electron/providers/hostConfig.test.ts electron/ipc/hostHandlers.probe.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`

Expected: PASS modulo the pre-existing baseline failures from Phase 2/3 (Settings.test.tsx useNavigate, ActivityEvent release.name, ReadmeRenderer, vendor anatomy tests). If new failures appear in Discover.test.tsx or RepoDetail.test.tsx, they're likely caused by Task 6/7's changes and need fixes before commit.

- [ ] **Step 4: Hand off to the user**

Surface:
- Phase 6 complete. Discover home rows merge across hosts, Codeberg/GitLab repos are navigable, capability flags drive RepoDetail rendering.
- The main Discover grid (free-text / tagged / pagination) remains GitHub-only — explicitly out of scope per this plan.
- Next: Phase 7 — self-hosted UX polish (Add-a-host form, TLS-error surfacing, health-check on launch).
