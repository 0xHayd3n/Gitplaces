# Multi-Host Phase 8: Cross-Host Parity Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three deferred items from Phase 7 — full GitHub Enterprise operations (not just probe), filter translation across hosts (so the Discover main grid stays multi-host when language/stars/license/activity filters are applied), and a full canonical `Repo` migration of the recommendation engine (drop the `repoToGitHubShape` shim).

**Architecture:** Phase 8 has three independent sections that can land in any order; they're packaged in one plan so a single code-review pass covers the whole multi-host completion. Section A widens `UnifiedQuery` with a `filters` object and gives `translateQuery` a per-host filter encoding (GitHub composes into the query string; GitLab/Gitea apply what they can via REST params and post-filter the rest via a new `postFilter` callback on `TranslatedQuery`). Section B refactors `GitHubProvider` to take `hostId + baseUrl` in its constructor, lifts the module-level `BASE` constant in `rest.ts` and `ENDPOINT` in `graphql.ts` into per-call parameters, and updates the registry to mint per-hostId GitHub provider instances (mirroring how GitLab/Gitea already work). Section C migrates `RankedItem.repo`, `ScoringCandidate`, and the IPC upsert from `GitHubRepo` (snake_case) to canonical `Repo` (camelCase + `hostId`/`hostNativeId`), dropping the `repoToGitHubShape` shim added in Phase 7's recommendation widening.

**Tech Stack:** TypeScript, Electron, React, vitest, electron-store, better-sqlite3.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 8 has no explicit spec section; it closes the items the original spec deferred to "future work" and the items Phase 7's brief explicitly marked out-of-scope (mixed-host main grid filter translation, GHE probe-only → full operations, recommendation engine canonical-Repo migration).

**Out of scope for this plan:**

- Secondary GitHub-only flows (anatomy staleness, plugin import service, skill sync, notes sync, agents backup, update service, repo security signals). These import free functions from `electron/providers/github` and remain pinned to public `api.github.com` — they're not exercised by the GHE host UX. A clear comment will note the boundary; widening them is a future improvement.
- GitHub Enterprise OAuth Device Flow. PAT-only auth for GHE hosts in v1 (consistent with the GitLab/Gitea pattern).
- Cross-host search of personal libraries / starred repos (Library views). The spec already excluded this from v1.
- New filter types beyond the existing four (`activity`, `stars`, `license`, language). Anything else is its own design discussion.

---

## File structure

### New files

- `electron/providers/github/rest.test.ts` is not new but gains a per-baseUrl test group covering GHE URL composition.

### Modified files (Section A — filter translation)

- `electron/providers/discoverMerge.ts` — `UnifiedQuery` gains an optional `filters: UnifiedFilters` field; `TranslatedQuery` gains an optional `postFilter: (repo: Repo) => boolean`; `translateQuery` encodes filters per host (GitHub via query qualifiers, GitLab/Gitea via params + postFilter); `searchAllHosts` applies `postFilter` to each host's results before merging.
- `electron/providers/discoverMerge.test.ts` — coverage for filter encoding per host + postFilter application.
- `src/views/Discover.tsx` — `toUnifiedQuery` widens to allow non-empty filters and language; the GitHub-only fallback path disappears when filters are translation-clean.

### Modified files (Section B — GHE full provider)

- `electron/providers/github/rest.ts` — all 34 `BASE` references replaced with a `baseUrl` parameter (defaulting to `'https://api.github.com'` for free-function back-compat).
- `electron/providers/github/graphql.ts` — `ENDPOINT` constant replaced with a `graphqlUrl` parameter (default `'https://api.github.com/graphql'`).
- `electron/providers/github/index.ts` — `GitHubProvider` takes `hostId` + `baseUrl` in its constructor; every method delegates to the free function with `this.baseUrl` / `this.graphqlUrl`; `githubProvider` becomes the public-instance singleton retained for legacy free-function callers.
- `electron/providers/registry.ts` — `getAnyProvider` mints a fresh `GitHubProvider(hostId, host.baseUrl)` per `gh:` hostId (other than `HOST_ID_GITHUB`), caching them like GitLab/Gitea.
- `electron/ipc/hostHandlers.ts` — `hosts:probe` allows `hosts:add` for any GHE URL that probes successfully (today the Add form already offers "GitHub Enterprise (probe only)" — the comment that says "operations not yet wired" gets removed once Section B lands).
- `src/views/settings/ConnectionsPanel.tsx` — the "(probe only)" hint on the GitHub Enterprise option in the Add-a-host form drops.

### Modified files (Section C — recommendation engine canonical Repo)

- `electron/services/recommendationEngine.ts` — `RankedItem.repo: GitHubRepo` → `RankedItem.repo: Repo`; `ScoringCandidate` reads canonical fields (`stars`, `pushedAt`, `topics`, `language`, `description`, `owner`, `hostId`, `hostNativeId`); `toScoringCandidate` accepts `Repo`.
- `electron/services/recommendationEngine.test.ts` — fixtures use canonical `Repo` instead of `GitHubRepo`.
- `electron/services/recommendationFetcher.ts` — drops the `repoToGitHubShape` shim; `fetchCandidates` returns `Repo[]`; GitHub results come through `githubRepoToRepo` like every other normalized path.
- `electron/services/recommendationFetcher.test.ts` — fixtures use canonical `Repo`.
- `electron/ipc/recommendHandlers.ts` — upsert reads canonical fields; the `byIdMap` keys by `${hostId}:${owner}/${name}` composite (drops the synthetic numeric-id hack).
- `electron/ipc/recommendHandlers.test.ts` — fixtures + assertions use canonical fields.
- `electron/providers/github/normalize.ts` — `repoToGitHubShape` removed (no remaining callers).

### Files NOT touched in this plan

- `electron/services/{agentsBackupSyncService,downloadService,notesSyncService,pluginImportFromGithubService,recommendationEngine.signals,repoSecurity,repoStats,skillSyncService,updateService}.ts` and `electron/anatomy/staleness.ts`, `electron/skill-gen/github-files.ts`, `electron/ipc/{createHandlers,updateHandlers}.ts` — these import `githubHeaders` / `getRepo` / `getTreeBySha` / `getRawFileBytes` / `putFileContents` / `createRepo` etc. directly as free functions and stay pinned to public `api.github.com`. They aren't part of the GHE repo browsing surface and widening them is a separate scope. A `PHASE 9 FOLLOW-UP` comment marks the boundary in `electron/providers/github/index.ts`.
- The signal scorers in `electron/services/signals/` — they already take the internal `ScoringCandidate` shape, not `GitHubRepo`. No changes needed; the migration is local to `recommendationEngine.toScoringCandidate`.

---

## Notes for the executor

- Work directly on `main`. Do NOT create a feature branch or a worktree (per project-level CLAUDE.md).
- For non-sqlite tests use `npx vitest run <path>`. Run `npm test` only at the very end (Section D Task 18). The user may have the dev app running; if `npm test` fails on a better-sqlite3 rebuild because of a file lock, pause and ask.
- Conventional commits, one per task. Scopes: `feat(providers):`, `feat(providers/github):`, `feat(ipc):`, `feat(renderer):`, `refactor(recommendation):`, `feat(discover):`.
- Batch execution — run every task consecutively. Final code-review at the end (per the user's `feedback_batch_execute_plans` memory).
- Each section is independent; if a section's commits get rolled back the others remain coherent. Order within this plan is A → B → C because Section C's removal of `repoToGitHubShape` is the cleanest endpoint.
- The `_resetGitLabCacheForTest` / `_resetGiteaCacheForTest` / `_resetCapabilitiesCacheForTest` helpers should be called in any test file that exercises the registry to avoid cross-file pollution. Section B adds `_resetGitHubCacheForTest` for the same reason (per-hostId GitHub providers are now cacheable).

---

# Section A — Filter translation across hosts

The current `toUnifiedQuery` in `Discover.tsx` returns `null` when any filter is set, forcing a GitHub-only `repo.search` call. Section A makes the unified path carry filters so the main grid stays multi-host even with filters applied.

## Task 1: Extend `UnifiedQuery` with a `filters` field + `postFilter` callback

The merger needs to know about filters so it can both (a) encode them into per-host queries when possible and (b) apply remaining filters client-side via `postFilter`.

**Files:**
- Modify: `electron/providers/discoverMerge.ts`
- Modify: `electron/providers/discoverMerge.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `electron/providers/discoverMerge.test.ts`. After the existing `'builds GitHub free-text query'` block, add a new describe group:

```ts
describe('translateQuery — filters', () => {
  it('GitHub: encodes language + minStars + license + activityWindow into the query', () => {
    const out = translateQuery('github', {
      kind: 'popular',
      filters: {
        language: 'typescript',
        minStars: 1000,
        license: 'mit',
        activityWindow: 'week',
      },
    })
    expect(out.query).toContain('stars:>100')
    expect(out.query).toContain('language:typescript')
    expect(out.query).toContain('stars:>=1000')
    expect(out.query).toContain('license:mit')
    expect(out.query).toMatch(/pushed:>\d{4}-\d{2}-\d{2}/)
    // GitHub encodes everything natively; no postFilter needed.
    expect(out.postFilter).toBeUndefined()
  })

  it('GitLab: encodes language + topic via params; postFilter applies minStars + license + activityWindow', () => {
    const out = translateQuery('gitlab', {
      kind: 'topic',
      topic: 'rust',
      filters: { language: 'rust', minStars: 1000, license: 'mit', activityWindow: 'week' },
    })
    // GitLab takes a search string, not qualifier syntax. The `query` field holds the topic name.
    expect(out.query).toBe('rust')
    // postFilter handles fields GitLab can't express in the search call.
    expect(typeof out.postFilter).toBe('function')
    const baseRepo = {
      hostId: 'gl:gitlab.com', hostType: 'gitlab' as const, hostNativeId: 1,
      fullName: 'o/n', owner: 'o', name: 'n', htmlUrl: '', homepageUrl: null,
      description: null, language: 'Rust', topics: [], license: 'MIT',
      defaultBranch: 'main', archived: false, size: 0, stars: 5000, forks: 0,
      watchers: 0, openIssues: 0, createdAt: '', updatedAt: '', pushedAt: new Date().toISOString(),
      ownerAvatarUrl: '',
    }
    expect(out.postFilter!(baseRepo)).toBe(true)
    expect(out.postFilter!({ ...baseRepo, stars: 50 })).toBe(false)
    expect(out.postFilter!({ ...baseRepo, license: 'Apache-2.0' })).toBe(false)
    // Activity window: a repo pushed 60 days ago shouldn't pass 'week'.
    const longAgo = new Date(Date.now() - 60 * 86400_000).toISOString()
    expect(out.postFilter!({ ...baseRepo, pushedAt: longAgo })).toBe(false)
  })

  it('Gitea: same postFilter-driven shape as GitLab', () => {
    const out = translateQuery('gitea', {
      kind: 'topic',
      topic: 'rust',
      filters: { minStars: 1000 },
    })
    expect(typeof out.postFilter).toBe('function')
    const baseRepo = {
      hostId: 'gt:codeberg.org', hostType: 'gitea' as const, hostNativeId: 1,
      fullName: 'o/n', owner: 'o', name: 'n', htmlUrl: '', homepageUrl: null,
      description: null, language: 'Rust', topics: [], license: null,
      defaultBranch: 'main', archived: false, size: 0, stars: 2000, forks: 0,
      watchers: 0, openIssues: 0, createdAt: '', updatedAt: '', pushedAt: '',
      ownerAvatarUrl: '',
    }
    expect(out.postFilter!(baseRepo)).toBe(true)
    expect(out.postFilter!({ ...baseRepo, stars: 50 })).toBe(false)
  })

  it('searchAllHosts applies postFilter to each host result before merging', async () => {
    const ghHost = host('gh:api.github.com', 'github')
    const glHost = host('gl:gitlab.com', 'gitlab')
    resolveAnyMock.mockImplementation((hostId: string) => {
      if (hostId === 'gh:api.github.com') return {
        searchRepos: vi.fn().mockResolvedValue([repo('gh:api.github.com', 'a', '2026-06-14T10:00:00Z', 5000)]),
      }
      if (hostId === 'gl:gitlab.com') return {
        // GitLab's search returns mixed stars; postFilter strips below 1000.
        searchRepos: vi.fn().mockResolvedValue([
          repo('gl:gitlab.com', 'b', '2026-06-13T10:00:00Z', 2000),
          repo('gl:gitlab.com', 'c', '2026-06-12T10:00:00Z', 50),
        ]),
      }
      return null
    })
    const out = await searchAllHosts([ghHost, glHost], {
      kind: 'topic', topic: 'rust', filters: { minStars: 1000 },
    }, { capPerHost: 10, totalLimit: 30 })
    expect(out.map(r => r.name).sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/discoverMerge.test.ts -t "translateQuery — filters"`

Expected: FAIL — `UnifiedQuery` doesn't have a `filters` field yet; `TranslatedQuery` doesn't have a `postFilter`.

- [ ] **Step 3: Extend `UnifiedQuery` + `TranslatedQuery` + `translateQuery`**

Edit `electron/providers/discoverMerge.ts`. Replace the type declarations and `translateQuery` function:

```ts
// ── Unified query + filter shape ─────────────────────────────────────────────

export interface UnifiedFilters {
  language?: string
  minStars?: number
  license?: string
  activityWindow?: 'week' | 'month' | 'halfyear'
}

export type UnifiedQuery =
  | { kind: 'trending-week'; filters?: UnifiedFilters }
  | { kind: 'hot-today'; filters?: UnifiedFilters }
  | { kind: 'hidden-gems'; filters?: UnifiedFilters }
  | { kind: 'popular'; filters?: UnifiedFilters }
  | { kind: 'topic'; topic: string; filters?: UnifiedFilters }
  | { kind: 'free-text'; freeText: string; filters?: UnifiedFilters }

export interface SearchAllOpts {
  capPerHost: number
  totalLimit: number
  timeoutMs?: number
  tokenForHost?: (hostId: string) => string | null
  page?: number
}

interface TranslatedQuery {
  query: string
  sort: string
  order: 'asc' | 'desc'
  /** When set, applied to each per-host result list before the host's
   *  contribution is sliced to capPerHost. Used by GitLab/Gitea to enforce
   *  filters their search API can't express natively (minStars, license,
   *  activity window). GitHub returns undefined here — its query qualifiers
   *  do native filtering. */
  postFilter?: (repo: Repo) => boolean
}

function activityCutoffMs(window: UnifiedFilters['activityWindow']): number | null {
  switch (window) {
    case 'week':     return 7 * 86400_000
    case 'month':    return 30 * 86400_000
    case 'halfyear': return 182 * 86400_000
    default:         return null
  }
}

function makePostFilter(filters: UnifiedFilters | undefined): TranslatedQuery['postFilter'] | undefined {
  if (!filters) return undefined
  const { minStars, license, activityWindow, language } = filters
  const activityMs = activityCutoffMs(activityWindow)
  // No filter to apply → return undefined so callers can skip the closure.
  if (minStars == null && !license && activityMs == null && !language) return undefined
  return (r: Repo) => {
    if (minStars != null && r.stars < minStars) return false
    if (license && (r.license ?? '').toLowerCase() !== license.toLowerCase()) return false
    if (language && (r.language ?? '').toLowerCase() !== language.toLowerCase()) return false
    if (activityMs != null) {
      const pushedAt = r.pushedAt ? new Date(r.pushedAt).getTime() : 0
      if (Date.now() - pushedAt > activityMs) return false
    }
    return true
  }
}

function githubFilterQualifiers(filters: UnifiedFilters | undefined): string {
  if (!filters) return ''
  const parts: string[] = []
  if (filters.language) parts.push(`language:${filters.language}`)
  if (filters.minStars != null) parts.push(`stars:>=${filters.minStars}`)
  if (filters.license) parts.push(`license:${filters.license}`)
  if (filters.activityWindow) {
    parts.push(`pushed:>${daysAgo(activityWindowDays(filters.activityWindow))}`)
  }
  return parts.join(' ')
}

function activityWindowDays(w: UnifiedFilters['activityWindow']): number {
  switch (w) {
    case 'week':     return 7
    case 'month':    return 30
    case 'halfyear': return 182
    default:         return 365
  }
}

export function translateQuery(hostType: HostType, q: UnifiedQuery): TranslatedQuery {
  const filterQuals = githubFilterQualifiers(q.filters)
  const compose = (base: string): string => [base, filterQuals].filter(Boolean).join(' ')

  if (hostType === 'github') {
    switch (q.kind) {
      case 'trending-week': return { query: compose(`created:>${daysAgo(7)}`), sort: 'stars', order: 'desc' }
      case 'hot-today':     return { query: compose(`pushed:>${daysAgo(1)}`),  sort: 'updated', order: 'desc' }
      case 'hidden-gems':   return { query: compose('stars:50..500'),          sort: 'stars',   order: 'desc' }
      case 'popular':       return { query: compose('stars:>100'),             sort: 'stars',   order: 'desc' }
      case 'topic':         return { query: compose(`topic:${q.topic}`),       sort: 'stars',   order: 'desc' }
      case 'free-text':     return { query: compose(q.freeText),                sort: 'stars',   order: 'desc' }
    }
  }

  // GitLab + Gitea — encode what each host's search supports natively (topic /
  // language) and push the remainder into `postFilter` for client-side filtering
  // after the per-host fetch.
  const postFilter = makePostFilter(q.filters)
  switch (q.kind) {
    case 'trending-week':
    case 'hot-today':     return { query: q.filters?.language ?? '', sort: 'updated', order: 'desc', postFilter }
    case 'hidden-gems':   return { query: q.filters?.language ?? '', sort: 'stars',   order: 'desc', postFilter }
    case 'popular':       return { query: q.filters?.language ?? '', sort: 'stars',   order: 'desc', postFilter }
    case 'topic':         return { query: q.topic,    sort: 'stars', order: 'desc', postFilter }
    case 'free-text':     return { query: q.freeText, sort: 'stars', order: 'desc', postFilter }
  }
}
```

- [ ] **Step 4: Apply `postFilter` inside `searchAllHosts`**

In `electron/providers/discoverMerge.ts`, update `searchAllHosts`:

```ts
export async function searchAllHosts(
  hosts: HostInstance[],
  query: UnifiedQuery,
  opts: SearchAllOpts,
): Promise<Repo[]> {
  const timeout = opts.timeoutMs ?? 4000
  const tokenForHost = opts.tokenForHost ?? (() => null)
  const page = opts.page ?? 1

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
    ) => Promise<Repo[]>)(token, translated.query, opts.capPerHost, translated.sort, translated.order, page)
    const result = await withTimeout(work, timeout)
    if (!Array.isArray(result)) return []
    const filtered = translated.postFilter ? result.filter(translated.postFilter) : result
    return filtered.slice(0, opts.capPerHost)
  }))

  const merged = perHost.flat()
  merged.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
  return merged.slice(0, opts.totalLimit)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run electron/providers/discoverMerge.test.ts`

Expected: every case PASSES.

- [ ] **Step 6: Commit**

```bash
git add electron/providers/discoverMerge.ts electron/providers/discoverMerge.test.ts
git commit -m "feat(providers): UnifiedQuery carries filters + postFilter callback"
```

---

## Task 2: Widen `toUnifiedQuery` in `Discover.tsx` to pass filters through

The renderer-side helper currently returns `null` when any filter is set. After Task 1, the merger can handle filters across hosts — so the helper should pass them through and stop falling back to GitHub-only.

**Files:**
- Modify: `src/views/Discover.tsx`

- [ ] **Step 1: Replace `toUnifiedQuery`**

Edit `src/views/Discover.tsx`. Find the `toUnifiedQuery` helper (around line 561). Replace its body with:

```ts
  /** Map a (viewMode, langKey, filters, subTypeKw) tuple to a `UnifiedQuery`.
   *  Filters compose into the UnifiedQuery's `filters` field; the merger
   *  encodes them per host (GitHub via query qualifiers, GitLab/Gitea via
   *  REST params + a postFilter for fields they can't express natively). */
  function toUnifiedQuery(
    vm: ViewModeKey,
    langKey: string,
    filters: SearchFilters,
    subTypeKw?: string,
  ): import('../../electron/providers/discoverMerge').UnifiedQuery | null {
    const unifiedFilters: import('../../electron/providers/discoverMerge').UnifiedFilters = {}
    if (langKey) unifiedFilters.language = langKey
    if (filters.stars) unifiedFilters.minStars = filters.stars
    if (filters.license) unifiedFilters.license = filters.license
    if (filters.activity) unifiedFilters.activityWindow = filters.activity
    const filtersPresent = Object.keys(unifiedFilters).length > 0
    const out = (q: import('../../electron/providers/discoverMerge').UnifiedQuery) =>
      filtersPresent
        ? { ...q, filters: unifiedFilters }
        : q

    // Sub-type filter: convert to a topic query when present. The merger
    // encodes the topic per host (topic: qualifier on GitHub, free-text on
    // GitLab/Gitea).
    if (subTypeKw) {
      const topic = subTypeKw.replace(/^topic:/, '').trim()
      if (topic.length === 0) return null
      return out({ kind: 'topic', topic })
    }

    switch (vm) {
      case 'home':
      case 'popular':       return out({ kind: 'popular' })
      case 'agents':        return out({ kind: 'topic', topic: 'ai-agent' })
      case 'hot-today':     return out({ kind: 'hot-today' })
      case 'trending-week': return out({ kind: 'trending-week' })
      case 'hidden-gems':   return out({ kind: 'hidden-gems' })
      case 'recommended':   return null  // handled by separate IPC
    }
    return null
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(discover): main grid stays multi-host when filters are applied"
```

---

# Section B — GHE full provider support

The `GitHubProvider` singleton hardcodes `BASE = 'https://api.github.com'` in `rest.ts` and `ENDPOINT = 'https://api.github.com/graphql'` in `graphql.ts`. Section B widens both via per-call parameters and refactors the provider class + registry to mint per-hostId instances.

## Task 3: Add `baseUrl` parameter to every function in `rest.ts`

Every function gets a `baseUrl: string` parameter inserted at the head of its argument list. The existing module-level `BASE` constant becomes the default value for the parameter.

**Files:**
- Modify: `electron/providers/github/rest.ts`

- [ ] **Step 1: Replace the module-level BASE handling with a per-call helper**

Edit `electron/providers/github/rest.ts`. Find the top of the file:

```ts
export const CLIENT_ID = 'Ov23liJxy53KWDh27mQx'
const BASE = 'https://api.github.com'
const SCOPE = 'read:user,repo'
```

Replace with:

```ts
export const CLIENT_ID = 'Ov23liJxy53KWDh27mQx'
const DEFAULT_BASE = 'https://api.github.com'
const SCOPE = 'read:user,repo'

/** Public-instance default used by the singleton `githubProvider` and any
 *  free-function callers that didn't pass a baseUrl explicitly. GHE
 *  instances pass their own `https://github.acme.com/api/v3`. */
export function defaultGitHubBase(): string { return DEFAULT_BASE }
```

- [ ] **Step 2: Update every function to take baseUrl as the first parameter**

For every `export async function ...` and `export function ...` in `electron/providers/github/rest.ts` that references `BASE`, insert `baseUrl: string = DEFAULT_BASE` as the first parameter. Replace every `${BASE}` template substitution with `${baseUrl}`.

The functions to update (preserve all other params and behaviour):
- `getReceivedEvents(baseUrl, token, username)`
- `getUser(baseUrl, token)`
- `getStarred(baseUrl, token)`
- `getRepo(baseUrl, token, owner, name, db?)`
- `searchRepos(baseUrl, token, query, perPage, sort, order, page)`
- `getReadme(baseUrl, token, owner, name, ref?)`
- `getDefaultBranch(baseUrl, token, owner, name)`
- `getReleases(baseUrl, token, owner, name, db?)`
- `getCompare(baseUrl, token, owner, name, base, head)`
- `starRepo(baseUrl, token, owner, name)`
- `unstarRepo(baseUrl, token, owner, name)`
- `isRepoStarred(baseUrl, token, owner, name, db?)`
- `fetchGitHubTopics(baseUrl, token)`
- `getProfileUser(baseUrl, token, username)`
- `getUserRepos(baseUrl, token, username, sort?)`
- `getMyRepos(baseUrl, token)`
- `getUserStarred(baseUrl, token, username)`
- `getUserFollowing(baseUrl, token, username)`
- `getUserFollowers(baseUrl, token, username)`
- `checkIsFollowing(baseUrl, token, username)`
- `followUser(baseUrl, token, username)`
- `unfollowUser(baseUrl, token, username)`
- `getOrgVerified(baseUrl, token, orgLogin)`
- `getBranch(baseUrl, token, owner, name, branch)`
- `getTreeBySha(baseUrl, token, owner, name, treeSha)`
- `getRawFileBytes(baseUrl, token, owner, name, ref, path)`
- `getBlobBySha(baseUrl, token, owner, name, sha)`
- `getRepoTree(baseUrl, token, owner, name, branch?)`
- `getFileContent(baseUrl, token, owner, name, path, ref?)`
- `getFileContentWithSha(baseUrl, token, owner, name, path, ref?)`
- `compareRefs(baseUrl, token, owner, name, base, head)`
- `createRepo(baseUrl, token, name, opts?)`
- `putFileContents(baseUrl, token, owner, name, path, content, message, sha?)`

The `startDeviceFlow` and `pollDeviceToken` functions hit `github.com` (not the API base) for the device-flow endpoints — leave them on `DEFAULT_BASE` for now since GHE OAuth flows are explicitly out of scope.

The `getServerVersion` function from Phase 7 already takes a baseUrl — no change needed.

The `classifyGhFetchError` helper is internal — no change.

The `githubHeaders` function takes only a token — no change.

- [ ] **Step 3: Add a back-compat default to every function signature**

The defaults on every function `baseUrl: string = DEFAULT_BASE` mean existing free-function callers like `import { searchRepos } from '../providers/github'; searchRepos(token, q, ...)` keep working unchanged at the call site — TypeScript adds `DEFAULT_BASE` implicitly when the first arg is a string (it's positional). However, this means any caller that DOES want to pass a baseUrl must put it FIRST.

We are NOT widening secondary free-function callers in this plan (see "Out of scope"). They continue using the default.

- [ ] **Step 4: Run the existing GitHub rest tests**

Run: `npx vitest run electron/providers/github/rest.test.ts`

Expected: all existing cases PASS (the per-call defaulting preserves behaviour).

- [ ] **Step 5: Add a per-baseUrl coverage test**

Append to `electron/providers/github/rest.test.ts`:

```ts
describe('GHE baseUrl plumbing', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits GHE base path /api/v3 when baseUrl is supplied', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ id: 1, name: 'r', full_name: 'o/r', owner: { login: 'o', avatar_url: '' } }),
      headers: { get: () => null },
    })
    const { getRepo } = await import('./rest')
    await getRepo('https://github.acme.com/api/v3', 'tok', 'o', 'r')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://github.acme.com/api/v3/repos/o/r',
      expect.any(Object),
    )
  })

  it('defaults to public api.github.com when baseUrl is omitted', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ id: 1, name: 'r', full_name: 'o/r', owner: { login: 'o', avatar_url: '' } }),
      headers: { get: () => null },
    })
    const { getRepo } = await import('./rest')
    // No baseUrl — falls back to DEFAULT_BASE.
    await getRepo(undefined as unknown as string, 'tok', 'o', 'r')
    expect((mockFetch.mock.calls[0][0] as string)).toContain('api.github.com/repos/o/r')
  })
})
```

- [ ] **Step 6: Run the new test**

Run: `npx vitest run electron/providers/github/rest.test.ts -t "GHE baseUrl plumbing"`

Expected: both cases PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/providers/github/rest.ts electron/providers/github/rest.test.ts
git commit -m "feat(providers/github): rest.ts functions take baseUrl as a parameter"
```

---

## Task 4: Add `graphqlUrl` parameter to `graphql.ts`

Three `ENDPOINT` references — much simpler than `rest.ts`.

**Files:**
- Modify: `electron/providers/github/graphql.ts`

- [ ] **Step 1: Replace the module-level ENDPOINT with per-call parameters**

Edit `electron/providers/github/graphql.ts`. Find:

```ts
const ENDPOINT = 'https://api.github.com/graphql'
```

Replace with:

```ts
const DEFAULT_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

/** Compute the GraphQL endpoint URL for a given GitHub baseUrl.
 *  - api.github.com → api.github.com/graphql
 *  - GHE github.acme.com/api/v3 → github.acme.com/api/graphql */
export function graphqlEndpointFor(baseUrl: string): string {
  if (baseUrl === 'https://api.github.com') return DEFAULT_GRAPHQL_ENDPOINT
  // GHE: strip trailing /api/v3 (if present) and any trailing slash, then
  // append /api/graphql.
  const root = baseUrl.replace(/\/api\/v3\/?$/, '').replace(/\/+$/, '')
  return `${root}/api/graphql`
}
```

Find each `fetch(ENDPOINT, {` (there are 2) and add a `graphqlUrl: string = DEFAULT_GRAPHQL_ENDPOINT` parameter to the enclosing function. Replace `ENDPOINT` with `graphqlUrl` inside the fetch call.

The functions:
- `fetchRepoBundle(graphqlUrl, db, token, owner, name)` — first parameter
- `fetchLastCommitsForPaths(graphqlUrl, token, owner, name, ref, paths)` — first parameter

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors (type-check covers the parameter ordering; the GitHubProvider class still consumes graphql via the free function references — Task 5 wires `this.graphqlUrl` in).

- [ ] **Step 3: Commit**

```bash
git add electron/providers/github/graphql.ts
git commit -m "feat(providers/github): graphql.ts takes graphqlUrl as a parameter"
```

---

## Task 5: Refactor `GitHubProvider` to instance-per-hostId

The class now stores `hostId + baseUrl + graphqlUrl` and every method delegates to the underlying free function with those values injected.

**Files:**
- Modify: `electron/providers/github/index.ts`

- [ ] **Step 1: Rewrite the class with a constructor**

Edit `electron/providers/github/index.ts`. Replace the entire class declaration (everything from `export class GitHubProvider {` through the closing `}` and the `export const githubProvider = new GitHubProvider()` line) with:

```ts
const CAPS: ProviderCapabilities = {
  vulnerabilityAlerts: true,
  codeScanningAlerts: true,
  events: true,
  trendingDiscovery: true,
  graphqlBundle: true,
  isVerifiedOrg: true,
}

export class GitHubProvider {
  readonly hostId: string
  readonly hostType = 'github' as const
  readonly baseUrl: string
  readonly graphqlUrl: string

  constructor(hostId: string = HOST_ID_GITHUB, baseUrl: string = 'https://api.github.com') {
    this.hostId = hostId
    this.baseUrl = baseUrl
    this.graphqlUrl = graphqlEndpointFor(baseUrl)
  }

  capabilities(): ProviderCapabilities {
    return CAPS
  }

  // ── Auth / identity ────────────────────────────────────────────
  startDeviceFlow = rest.startDeviceFlow  // GHE device flow is out of scope; uses github.com
  pollDeviceToken = rest.pollDeviceToken
  getUser(token: string) { return rest.getUser(this.baseUrl, token) }

  async getCurrentUser(token: string): Promise<User> {
    const raw = await rest.getUser(this.baseUrl, token)
    return githubUserToUser(raw)
  }

  // ── Canonical-shape repo wrappers ──────────────────────────────
  async getRepoNormalized(token: string | null, owner: string, name: string, db?: Database.Database): Promise<Repo> {
    const raw = await rest.getRepo(this.baseUrl, token, owner, name, db)
    return githubRepoToRepo(raw)
  }

  async searchReposNormalized(token: string | null, query: string, perPage = 100, sort = 'stars', order = 'desc', page = 1): Promise<Repo[]> {
    const items = await rest.searchRepos(this.baseUrl, token, query, perPage, sort, order, page)
    return items.map(githubRepoToRepo)
  }

  async getStarredNormalized(token: string): Promise<StarredEntry[]> {
    const raw = await rest.getStarred(this.baseUrl, token)
    return raw.map(githubStarredToStarredEntry)
  }

  // ── Repo metadata ──────────────────────────────────────────────
  getRepo(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getRepo(this.baseUrl, token, owner, name, db)
  }
  searchRepos(token: string | null, query: string, perPage = 100, sort = 'stars', order = 'desc', page = 1) {
    return rest.searchRepos(this.baseUrl, token, query, perPage, sort, order, page)
  }
  getDefaultBranch(token: string | null, owner: string, name: string) {
    return rest.getDefaultBranch(this.baseUrl, token, owner, name)
  }
  getReadme(token: string | null, owner: string, name: string, ref?: string) {
    return rest.getReadme(this.baseUrl, token, owner, name, ref)
  }
  getReleases(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.getReleases(this.baseUrl, token, owner, name, db)
  }
  getCompare(token: string, owner: string, name: string, base: string, head: string) {
    return rest.getCompare(this.baseUrl, token, owner, name, base, head)
  }
  compareRefs(token: string, owner: string, name: string, base: string, head: string) {
    return rest.compareRefs(this.baseUrl, token, owner, name, base, head)
  }

  // ── Content ────────────────────────────────────────────────────
  getRepoTree(token: string | null, owner: string, name: string, branch?: string) {
    return rest.getRepoTree(this.baseUrl, token, owner, name, branch)
  }
  getFileContent(token: string | null, owner: string, name: string, path: string, ref?: string) {
    return rest.getFileContent(this.baseUrl, token, owner, name, path, ref)
  }
  getFileContentWithSha(token: string | null, owner: string, name: string, path: string, ref?: string) {
    return rest.getFileContentWithSha(this.baseUrl, token, owner, name, path, ref)
  }
  getBranch(token: string | null, owner: string, name: string, branch: string) {
    return rest.getBranch(this.baseUrl, token, owner, name, branch)
  }
  getTreeBySha(token: string | null, owner: string, name: string, treeSha: string) {
    return rest.getTreeBySha(this.baseUrl, token, owner, name, treeSha)
  }
  getRawFileBytes(token: string | null, owner: string, name: string, ref: string, path: string) {
    return rest.getRawFileBytes(this.baseUrl, token, owner, name, ref, path)
  }
  getBlobBySha(token: string | null, owner: string, name: string, sha: string) {
    return rest.getBlobBySha(this.baseUrl, token, owner, name, sha)
  }

  // ── Social ─────────────────────────────────────────────────────
  getStarred(token: string) { return rest.getStarred(this.baseUrl, token) }
  starRepo(token: string, owner: string, name: string) { return rest.starRepo(this.baseUrl, token, owner, name) }
  unstarRepo(token: string, owner: string, name: string) { return rest.unstarRepo(this.baseUrl, token, owner, name) }
  isRepoStarred(token: string | null, owner: string, name: string, db?: Database.Database) {
    return rest.isRepoStarred(this.baseUrl, token, owner, name, db)
  }
  getReceivedEvents(token: string, username: string) {
    return rest.getReceivedEvents(this.baseUrl, token, username)
  }

  // ── Profile ────────────────────────────────────────────────────
  getProfileUser(token: string, username: string) { return rest.getProfileUser(this.baseUrl, token, username) }
  getUserRepos(token: string, username: string, sort = 'stars') { return rest.getUserRepos(this.baseUrl, token, username, sort) }
  getMyRepos(token: string) { return rest.getMyRepos(this.baseUrl, token) }
  getUserStarred(token: string, username: string) { return rest.getUserStarred(this.baseUrl, token, username) }
  getUserFollowing(token: string, username: string) { return rest.getUserFollowing(this.baseUrl, token, username) }
  getUserFollowers(token: string, username: string) { return rest.getUserFollowers(this.baseUrl, token, username) }
  checkIsFollowing(token: string, username: string) { return rest.checkIsFollowing(this.baseUrl, token, username) }
  followUser(token: string, username: string) { return rest.followUser(this.baseUrl, token, username) }
  unfollowUser(token: string, username: string) { return rest.unfollowUser(this.baseUrl, token, username) }
  getOrgVerified(token: string, orgLogin: string) { return rest.getOrgVerified(this.baseUrl, token, orgLogin) }

  // ── Write ──────────────────────────────────────────────────────
  createRepo(token: string, name: string, opts?: { private?: boolean }) {
    return rest.createRepo(this.baseUrl, token, name, opts)
  }
  putFileContents(token: string, owner: string, name: string, path: string, content: string, message: string, sha?: string) {
    return rest.putFileContents(this.baseUrl, token, owner, name, path, content, message, sha)
  }

  // ── Topics ─────────────────────────────────────────────────────
  fetchGitHubTopics(token: string) { return rest.fetchGitHubTopics(this.baseUrl, token) }

  // ── GraphQL bundle ─────────────────────────────────────────────
  fetchRepoBundle(db: Database.Database, token: string, owner: string, name: string) {
    return graphql.fetchRepoBundle(this.graphqlUrl, db, token, owner, name)
  }
  fetchLastCommitsForPaths(token: string, owner: string, name: string, ref: string, paths: string[]) {
    return graphql.fetchLastCommitsForPaths(this.graphqlUrl, token, owner, name, ref, paths)
  }
}

// Singleton instance for the public github.com host. Legacy free-function
// callers (anatomy/staleness, plugin import, skill sync, etc.) keep using
// the underlying free functions with the default baseUrl — PHASE 9 FOLLOW-UP
// can widen those callers to use a per-hostId provider too.
export const githubProvider = new GitHubProvider()
```

Also add the new import at the top of the file. Find:

```ts
import * as graphql from './graphql'
```

Replace with:

```ts
import * as graphql from './graphql'
import { graphqlEndpointFor } from './graphql'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the GitHub provider unit tests**

Run: `npx vitest run electron/providers/github/index.test.ts`

Expected: existing cases PASS — the class methods still produce the same output for the public-instance default.

- [ ] **Step 4: Commit**

```bash
git add electron/providers/github/index.ts
git commit -m "feat(providers/github): GitHubProvider takes hostId + baseUrl in constructor"
```

---

## Task 6: Mint per-hostId GitHub providers in the registry

The registry's `resolveAny` short-circuits the singleton for `HOST_ID_GITHUB`. For arbitrary `gh:` hostIds (i.e. GHE), it should lazily create a fresh `GitHubProvider(hostId, host.baseUrl)`.

**Files:**
- Modify: `electron/providers/registry.ts`

- [ ] **Step 1: Add the per-hostId cache + lazy lookup**

Edit `electron/providers/registry.ts`. Replace the `resolveAny` function:

```ts
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
```

Then add a test-only reset helper alongside the existing GitLab/Gitea ones:

```ts
/** Test-only: drop the lazy GHE provider cache. The public-instance
 *  singleton (`githubProvider`) is never cached here, so this only
 *  affects user-added GHE hosts. */
export function _resetGitHubCacheForTest(): void {
  githubProviders.clear()
}
```

- [ ] **Step 2: Update the `getProvider` narrow accessor**

The existing `getProvider(hostId)` returns `GitHubProvider | null` and is used by handlers that call GitHub-only methods. After Task 6, it should return the GHE provider for `gh:` hostIds too (since they're all `GitHubProvider` instances). The implementation already does the right thing via `p instanceof GitHubProvider` — no change.

- [ ] **Step 3: Run registry tests**

Run: `npx vitest run electron/providers/registry.test.ts`

Expected: PASS (existing tests still cover the public-instance + GitLab + Gitea paths).

- [ ] **Step 4: Add a GHE registry test**

Append to `electron/providers/registry.test.ts`:

```ts
describe('getAnyProvider — GHE', () => {
  beforeEach(() => {
    _resetGitHubCacheForTest()
    setHostConfigBackend(new MapBackend())
  })

  it('mints a per-hostId GitHubProvider for a non-default gh: hostId', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const provider = getAnyProvider('gh:github.acme.com/api/v3')
    expect(provider).toBeInstanceOf(GitHubProvider)
    expect((provider as GitHubProvider).baseUrl).toBe('https://github.acme.com/api/v3')
  })

  it('caches the GHE provider — repeated lookups return the same instance', () => {
    addHost({ type: 'github', baseUrl: 'https://github.acme.com/api/v3', label: 'Acme' })
    const a = getAnyProvider('gh:github.acme.com/api/v3')
    const b = getAnyProvider('gh:github.acme.com/api/v3')
    expect(a).toBe(b)
  })

  it('returns null for a gh: hostId not present in hostConfig', () => {
    expect(getAnyProvider('gh:unknown.acme.com')).toBeNull()
  })

  it('public-instance singleton still resolves for HOST_ID_GITHUB', () => {
    expect(getAnyProvider(HOST_ID_GITHUB)).toBe(githubProvider)
  })
})
```

The `MapBackend` test helper should already exist in the test file (used by the GitLab/Gitea blocks). Reuse it.

- [ ] **Step 5: Run the new test**

Run: `npx vitest run electron/providers/registry.test.ts -t "GHE"`

Expected: all 4 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/providers/registry.ts electron/providers/registry.test.ts
git commit -m "feat(providers): registry mints per-hostId GitHubProvider for GHE hosts"
```

---

## Task 7: Drop the GHE "(probe only)" caveat in the Add-a-host form

After Task 6, GHE hosts are first-class. The form's hint that said "GitHub Enterprise (probe only)" can drop.

**Files:**
- Modify: `src/views/settings/ConnectionsPanel.tsx`

- [ ] **Step 1: Update the dropdown option text**

Edit `src/views/settings/ConnectionsPanel.tsx`. Find:

```tsx
<option value="github">GitHub Enterprise (probe only)</option>
```

Replace with:

```tsx
<option value="github">GitHub Enterprise</option>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/ConnectionsPanel.tsx
git commit -m "feat(renderer): drop '(probe only)' caveat — GHE is now fully operational"
```

---

# Section C — Recommendation engine canonical Repo migration

Drop the `repoToGitHubShape` shim and migrate the engine to consume canonical `Repo` directly.

## Task 8: Migrate `ScoringCandidate` + `toScoringCandidate` to canonical Repo

The engine's internal scoring candidate currently reads GitHubRepo (snake_case) fields. Switch it to canonical `Repo`.

**Files:**
- Modify: `electron/services/recommendationEngine.ts`
- Modify: `electron/services/recommendationEngine.test.ts`

- [ ] **Step 1: Update the imports + RankedItem type**

Edit `electron/services/recommendationEngine.ts`. Find:

```ts
import type { GitHubRepo } from '../providers/github'
```

Replace with:

```ts
import type { Repo } from '../../src/types/repo'
```

Find the `RankedItem` interface:

```ts
export interface RankedItem {
  repo: GitHubRepo
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}
```

Replace with:

```ts
export interface RankedItem {
  repo: Repo
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}
```

- [ ] **Step 2: Migrate ScoringCandidate**

Find the `ScoringCandidate` interface and the `toScoringCandidate` function. Replace both with:

```ts
interface ScoringCandidate {
  topics: string[]
  descriptionTokens: string[]
  type_bucket: string | null
  type_sub: string | null
  language: string | null
  stars: number
  pushed_at: string | null
  archived: boolean
  owner: string
  /** Composite host-prefixed id, e.g. "gh:api.github.com:42" — used inside
   *  the engine for dedup. Replaces the legacy `id: number` since each host
   *  has its own numeric id space and cross-host collisions are possible. */
  id: string
}

function toScoringCandidate(repo: Repo): ScoringCandidate {
  const topics = Array.isArray(repo.topics) ? repo.topics : []
  const classification = classifyRepoBucket({
    name: repo.name,
    description: repo.description ?? null,
    topics,
  })
  return {
    topics,
    descriptionTokens: tokenizeDescription(repo.description),
    type_bucket: classification?.bucket ?? null,
    type_sub:    classification?.subType ?? null,
    language:    repo.language ?? null,
    stars:       repo.stars,
    pushed_at:   repo.pushedAt,
    archived:    repo.archived,
    owner:       repo.owner,
    id:          `${repo.hostId}:${repo.hostNativeId}`,
  }
}
```

- [ ] **Step 3: Update internal references in `rankCandidates`**

Find every place in `recommendationEngine.ts` that reads `repo.stargazers_count` / `repo.pushed_at` / `repo.owner.login` / `repo.owner.avatar_url` (snake_case) and replace with the canonical equivalents. Specifically search for these patterns and replace:

- `repo.stargazers_count` → `repo.stars`
- `repo.pushed_at` → `repo.pushedAt`
- `repo.created_at` → `repo.createdAt`
- `repo.updated_at` → `repo.updatedAt`
- `repo.owner.login` → `repo.owner`
- `repo.owner.avatar_url` → `repo.ownerAvatarUrl`
- `repo.full_name` → `repo.fullName`
- `repo.html_url` → `repo.htmlUrl`
- `repo.id` → use `repo.hostNativeId` if it's actually being used as an id; or build `${repo.hostId}:${repo.hostNativeId}` for a composite key
- `repo.forks_count` → `repo.forks`
- `repo.watchers_count` → `repo.watchers`
- `repo.open_issues_count` → `repo.openIssues`
- `repo.license?.spdx_id` → `repo.license`
- `repo.default_branch` → `repo.defaultBranch`
- `repo.homepage` → `repo.homepageUrl`

These changes are mechanical — apply across the whole file.

- [ ] **Step 4: Update the engine test fixtures**

Edit `electron/services/recommendationEngine.test.ts`. Find the `ghRepo` helper (or equivalent) and replace it with a canonical-Repo factory:

```ts
import type { Repo } from '../../src/types/repo'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    hostId: 'gh:api.github.com',
    hostType: 'github',
    hostNativeId: 1,
    fullName: 'o/n',
    owner: 'o',
    name: 'n',
    htmlUrl: '',
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars: 100,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    pushedAt: '2020-01-01T00:00:00Z',
    ownerAvatarUrl: '',
    ...overrides,
  }
}
```

Replace every `ghRepo({...})` call in the test file with `makeRepo({...})`. Adapt field names per the mapping in Step 3.

- [ ] **Step 5: Run the engine tests**

Run: `npx vitest run electron/services/recommendationEngine.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/recommendationEngine.ts electron/services/recommendationEngine.test.ts
git commit -m "refactor(recommendation): engine consumes canonical Repo, drops GitHubRepo dependency"
```

---

## Task 9: Migrate `fetchCandidates` to return `Repo[]`

The fetcher returns canonical `Repo` directly. The GitHub path normalizes via `githubRepoToRepo`; non-GitHub hosts already return canonical Repo. Drop the `repoToGitHubShape` shim.

**Files:**
- Modify: `electron/services/recommendationFetcher.ts`
- Modify: `electron/services/recommendationFetcher.test.ts`

- [ ] **Step 1: Update imports + return types**

Edit `electron/services/recommendationFetcher.ts`. Find:

```ts
import { searchRepos } from '../providers/github'
import type { GitHubRepo } from '../providers/github'
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'
import { listHosts } from '../providers/hostConfig'
import { getToken } from '../providers/tokenStore'
import { searchAllHosts, type UnifiedQuery } from '../providers/discoverMerge'
import { repoToGitHubShape } from '../providers/github/normalize'
import { HOST_ID_GITHUB } from '../providers/types'
```

Replace with:

```ts
import { searchRepos } from '../providers/github'
import { githubRepoToRepo } from '../providers/github/normalize'
import type { Repo } from '../../src/types/repo'
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'
import { listHosts } from '../providers/hostConfig'
import { getToken } from '../providers/tokenStore'
import { searchAllHosts, type UnifiedQuery } from '../providers/discoverMerge'
import { HOST_ID_GITHUB } from '../providers/types'
```

Find:

```ts
export type CandidateRepo = GitHubRepo & { _hostId?: string }
```

Replace with:

```ts
/** Phase 8: `CandidateRepo` is just `Repo`. The Phase 7 shim that tagged a
 *  GitHubRepo with `_hostId` is gone — every candidate is already in
 *  canonical shape with a real `hostId` field. */
export type CandidateRepo = Repo
```

- [ ] **Step 2: Rewrite `fetchCandidates`**

Replace the `fetchCandidates` function body with:

```ts
export async function fetchCandidates(
  token: string | null,
  queries: QueryPlan[],
  page: number = 1,
): Promise<CandidateRepo[]> {
  const seen = new Set<string>()
  const merged: CandidateRepo[] = []

  function push(repos: CandidateRepo[]): void {
    for (const r of repos) {
      const key = `${r.hostId}:${r.hostNativeId}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(r)
      }
    }
  }

  // GitHub path — normalize the raw GitHubRepo to canonical Repo.
  const ghResults = await Promise.allSettled(
    queries.map(async (q) => searchRepos(undefined as unknown as string, token, buildSearchQuery(q), q.perPage, q.sort, 'desc', page)),
  )
  for (const r of ghResults) {
    if (r.status === 'fulfilled') {
      push(r.value.map(githubRepoToRepo))
    }
  }

  // Other-host path — searchAllHosts returns canonical Repo[] already.
  let allHosts: ReturnType<typeof listHosts>
  try {
    allHosts = listHosts().filter(h => h.id !== HOST_ID_GITHUB)
  } catch {
    allHosts = []
  }
  if (allHosts.length > 0) {
    const unifiedQueries = queries
      .map(planToUnifiedQuery)
      .filter((q): q is UnifiedQuery => q !== null)
    const otherResults = await Promise.allSettled(
      unifiedQueries.map(uq => searchAllHosts(allHosts, uq, {
        capPerHost: 10,
        totalLimit: 30,
        timeoutMs: 4000,
        tokenForHost: (id) => getToken(id),
        page,
      })),
    )
    for (const r of otherResults) {
      if (r.status === 'fulfilled') {
        push(r.value)  // already canonical Repo[]
      }
    }
  }

  return merged
}
```

The `undefined as unknown as string` first-arg to `searchRepos` is a sentinel that triggers the function's default `DEFAULT_BASE`. Section B intentionally made every free function in `rest.ts` accept this pattern.

- [ ] **Step 3: Update the test fixture**

Edit `electron/services/recommendationFetcher.test.ts`. Find the `ghRepo` helper and replace it with a canonical-Repo factory (same shape as the one added to `recommendationEngine.test.ts` in Task 8). The fetcher test's `mockSearch` returns from `searchRepos` which is mocked — the mock should return GitHubRepo (the raw search result), and the fetcher converts. So the test fixture stays GitHubRepo-shaped for the mock return, but the assertions are against canonical Repo:

Find places that assert `result.map(r => r.id)`. Replace with `result.map(r => r.hostNativeId)` (the canonical Repo's id field).

Find `expect(result[0]._hostId).toBe('gh:api.github.com')` (added in Phase 7). Replace with `expect(result[0].hostId).toBe('gh:api.github.com')` since canonical Repo has `hostId` first-class.

- [ ] **Step 4: Run the fetcher tests**

Run: `npx vitest run electron/services/recommendationFetcher.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/recommendationFetcher.ts electron/services/recommendationFetcher.test.ts
git commit -m "refactor(recommendation): fetchCandidates returns canonical Repo, drops shim"
```

---

## Task 10: Migrate the IPC handler to canonical Repo

The IPC handler's upsert + byIdMap lookup currently key by `String(repo.id)`. Switch to canonical fields and the composite hostId+native-id key.

**Files:**
- Modify: `electron/ipc/recommendHandlers.ts`
- Modify: `electron/ipc/recommendHandlers.test.ts`

- [ ] **Step 1: Update imports + upsert**

Edit `electron/ipc/recommendHandlers.ts`. Find the `upsertCandidates` function. Replace the body of the `db.transaction(() => { ... })` block with:

```ts
  db.transaction(() => {
    for (const repo of candidates) {
      const rid = String(repo.hostNativeId)
      const hostId = repo.hostId
      cascadeRepoId(db, repo.owner, repo.name, rid)
      const classified = classifyRepoBucket({
        name: repo.name,
        description: repo.description,
        topics: repo.topics ?? [],
      })
      upsert.run(
        rid, hostId, repo.owner, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics ?? []), repo.stars, repo.forks,
        repo.license, repo.homepageUrl, repo.updatedAt, repo.pushedAt,
        repo.createdAt ?? null,
        now, `recommended:${profileHash}`, repo.watchers, repo.size, repo.openIssues,
        repo.defaultBranch, repo.ownerAvatarUrl,
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()
```

The `setImmediate` block at the bottom that calls `extractDominantColor` also reads `repo.owner.avatar_url` and `repo.owner.login` — update those to `repo.ownerAvatarUrl` and `repo.owner`.

- [ ] **Step 2: Update the byIdMap lookups**

Find every `byIdMap.get(String(repo.id))` and `coldByIdMap.get(String(repo.id))` (around lines 203, 248, 267). Replace `repo.id` with `repo.hostNativeId`. The map keys themselves are still strings — only the field access changes.

- [ ] **Step 3: Drop the HOST_ID_GITHUB default fallback**

The Phase 7 code defaulted `_hostId ?? HOST_ID_GITHUB` because the shim's tag was optional. Now `hostId` is mandatory on canonical Repo — no fallback needed. Remove the `import { HOST_ID_GITHUB } from '../providers/types'` line if it has no other use in the file.

- [ ] **Step 4: Update the test fixtures**

Edit `electron/ipc/recommendHandlers.test.ts`. Replace any `makeGitHubRepo(...)` helper invocations with a canonical-Repo factory. Field accesses in assertions move from snake_case to camelCase.

The mock for `fetchCandidates` should return canonical `Repo[]` now.

- [ ] **Step 5: Run the handler tests**

Run: `npx vitest run electron/ipc/recommendHandlers.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/recommendHandlers.ts electron/ipc/recommendHandlers.test.ts
git commit -m "refactor(recommendation): IPC handler reads canonical Repo fields"
```

---

## Task 11: Remove `repoToGitHubShape` from normalize.ts

No remaining callers — the shim is dead.

**Files:**
- Modify: `electron/providers/github/normalize.ts`

- [ ] **Step 1: Delete the function**

Edit `electron/providers/github/normalize.ts`. Remove the entire `repoToGitHubShape` function block (including its docstring).

- [ ] **Step 2: Verify nothing else imports it**

Run: `grep -rn repoToGitHubShape electron src 2>&1 | head -10`

Expected: 0 hits (we deleted the only caller in Task 9).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add electron/providers/github/normalize.ts
git commit -m "refactor(providers/github): drop unused repoToGitHubShape shim"
```

---

# Section D — Final verification

## Task 12: Run all touched specs

- [ ] **Step 1: Run the full Phase-8-touched spec set**

```bash
npx vitest run electron/providers/discoverMerge.test.ts electron/providers/github/rest.test.ts electron/providers/github/index.test.ts electron/providers/registry.test.ts electron/services/recommendationEngine.test.ts electron/services/recommendationFetcher.test.ts electron/ipc/recommendHandlers.test.ts electron/ipc/hostHandlers.probe.test.ts electron/ipc/hostHandlers.healthCheck.test.ts src/hooks/useHostCapabilities.test.ts electron/providers/gitlab/rest.test.ts electron/providers/gitea/rest.test.ts
```

Expected: every case PASSES.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`

Expected: PASS modulo the 3 pre-existing baseline failures from Phases 6/7 (`vendor/anatomy/.../mcp-memory-tools.test.ts`, `src/components/ImportPluginDialog.test.tsx`, `src/components/ReadmeRenderer.test.tsx`). If `npm test` fails on a better-sqlite3 rebuild because of a file lock, pause and ask.

- [ ] **Step 4: Dispatch a single code-reviewer agent**

Use the Agent tool with `subagent_type: 'code-reviewer'`. Scope: `git diff <last-phase-7-commit>..HEAD`. Brief the reviewer on:
- The plan path: `docs/superpowers/plans/2026-06-15-multi-host-phase-8-cross-host-parity.md`
- Three independent sections (filter translation, GHE full provider, recommendation engine canonical Repo) packaged in one plan for a unified review pass
- Specifically watch for: regression in GitHub-only flows (anatomy, downloads, plugin imports — they should be unaffected since the free functions default baseUrl to public github.com), recommendation engine score parity (canonical-vs-snake_case field reads can silently change behavior), filter translation correctness for GitLab/Gitea (post-filter applied per-host, results sliced after filter not before).

- [ ] **Step 5: Hand off to the user**

Surface:
- Phase 8 complete. GHE is fully operational (probe → add → setToken → repo browsing works against any GHE base URL). Filter translation keeps the Discover main grid multi-host even with language/stars/license/activity filters. Recommendation engine consumes canonical Repo end-to-end — the Phase 7 shim is gone.
- Remaining items beyond Phase 8: secondary free-function callers (anatomy staleness, plugin import, skill sync, notes sync, agents backup, download service, repo security, repo stats, update service, skill-gen) are still pinned to public github.com via the default baseUrl. A `PHASE 9 FOLLOW-UP` comment in `electron/providers/github/index.ts` flags them.
- GHE OAuth Device Flow is intentionally not wired. PAT-only auth for GHE matches the GitLab/Gitea pattern; full OAuth is out of scope.
