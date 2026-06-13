# Multi-Host Repo Integration (GitHub + GitLab + Gitea)

**Status:** Draft — design approved 2026-06-14, awaiting plan
**Author:** Git-Suite
**Date:** 2026-06-14

## Problem

Git-Suite today treats GitHub as the only repository host. The codebase is wired to `api.github.com`, the renderer consumes GitHub's snake_case `GitHubRepo` shape directly, authentication is a single OAuth Device Flow token, and every Discover row queries GitHub Search.

Users store and collaborate on code in other places too — most notably GitLab and Gitea (including the public Codeberg instance and self-hosted company instances). We want Git-Suite to surface, save, and act on repositories from those hosts with feature parity, not just GitHub.

## Goals

- **Full feature parity** across hosts: search, browse, save, README/tree/file viewing, releases, stars, follows, profile pages, repo creation, push.
- **Four host types out of v1:** GitHub, gitlab.com, codeberg.org, plus self-hosted GitLab and self-hosted Gitea instances.
- **Mixed Discover rows:** "Trending This Week" / "Hot Today" / "Hidden Gems" pull from every configured host and merge results into one ranked list per row.
- **No GitHub-only assumptions leak into the renderer.** Components consume a single normalized `Repo` shape; per-host quirks live behind a provider boundary.

## Non-Goals

- Hosts beyond GitHub/GitLab/Gitea (Bitbucket, Sourcehut, etc.) — out of scope, but the provider abstraction must not preclude adding them later.
- Cross-host *concepts* that don't translate cleanly (GitLab security dashboards, Dependabot equivalents). These are hidden per host via capability flags; building unified normalizers for them is out of scope for v1.
- Cross-host search of personal libraries / starred repos. v1 keeps library views host-scoped where they already are.
- Migration off the existing OAuth Device Flow for GitHub. The GitHub provider keeps Device Flow; GitLab and Gitea use Personal Access Tokens.

## Constraints & Decisions (settled during brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Integration depth | Full parity with GitHub | User explicitly chose maximum scope. |
| Hosts in v1 | gitlab.com, codeberg.org, self-hosted Gitea, self-hosted GitLab | User selected all four. |
| Discover layout | Mixed into existing rows | Single unified rows, results merged from all hosts. |
| Data shape | Normalize to a new `Repo` type | Stops vendor vocabulary leaking into the renderer; pays off the moment any second host appears. |
| Self-hosted auth | Personal Access Token only | Universal across hosts; no OAuth app registration burden; simpler IPC and storage. |
| Cross-host ranking | Cap per host + recency sort | Each host gets airtime regardless of size; avoids GitHub drowning out smaller hosts. |
| Code organization | Provider adapter layer (`electron/providers/`) | One contract, one normalization point, one provider per host type. |

## Architecture

### Module layout

```
electron/
  providers/
    types.ts                ← RepoProvider interface, normalized Repo shape, capabilities
    registry.ts             ← ProviderRegistry: hostId → provider instance, owns token lookup
    github/
      index.ts              ← GitHubProvider (implements RepoProvider)
      rest.ts               ← lifted from current github.ts
      graphql.ts            ← lifted from current githubGraphql.ts
      normalize.ts          ← GitHub response → Repo
      search.ts             ← unified query → GitHub search qualifiers
    gitlab/
      index.ts              ← GitLabProvider
      rest.ts
      normalize.ts
      search.ts
    gitea/
      index.ts              ← GiteaProvider
      rest.ts
      normalize.ts
      search.ts
    discoverMerge.ts        ← cap-per-host + recency merge for searchAll
    hostConfig.ts           ← persisted host list (electron-store backed)
    tokenStore.ts           ← per-host PAT storage (electron-store, keyed by hostId)

  github.ts                 ← DELETED — folded into providers/github/
  githubGraphql.ts          ← DELETED — folded into providers/github/graphql.ts
  githubFetch.ts            ← KEPT — ETag cache is host-agnostic, reused by all providers
```

**Composition over inheritance.** No shared `BaseProvider` class. Each provider stands alone; shared helpers (e.g. `parseLinkHeader`, the `etagFetch` wrapper) are imported as functions where needed. The hosts diverge enough on auth headers, pagination, and search semantics that an abstract base adds more confusion than it removes.

### Provider contract

```ts
interface RepoProvider {
  readonly hostId: string                     // "gh:api.github.com", "gl:gitlab.com", "gt:codeberg.org"
  readonly hostType: 'github' | 'gitlab' | 'gitea'
  readonly baseUrl: string

  // Identity & auth
  getCurrentUser(token: string): Promise<User>

  // Repo metadata
  getRepo(token: string | null, owner: string, name: string): Promise<Repo>
  searchRepos(token: string | null, query: UnifiedQuery): Promise<Repo[]>

  // Content
  getReadme(token: string | null, owner: string, name: string, ref?: string): Promise<string | null>
  getTree(token: string | null, owner: string, name: string, ref: string): Promise<TreeEntry[]>
  getBlob(token: string | null, owner: string, name: string, sha: string): Promise<BlobResult>
  getFileContent(token: string | null, owner: string, name: string, path: string, ref?: string): Promise<string | null>
  getRawFileBytes(token: string | null, owner: string, name: string, ref: string, path: string): Promise<Buffer>

  // Releases & compare
  getReleases(token: string | null, owner: string, name: string): Promise<Release[]>
  getCompare(token: string | null, owner: string, name: string, base: string, head: string): Promise<CompareSummary>

  // Social / library
  isRepoStarred(token: string, owner: string, name: string): Promise<boolean>
  starRepo(token: string, owner: string, name: string): Promise<void>
  unstarRepo(token: string, owner: string, name: string): Promise<void>
  getStarred(token: string): Promise<StarredRepo[]>

  // User / profile
  getUser(token: string | null, login: string): Promise<UserProfile>
  getUserRepos(token: string | null, login: string): Promise<Repo[]>
  getUserFollowers(token: string | null, login: string): Promise<User[]>
  getUserFollowing(token: string | null, login: string): Promise<User[]>
  checkIsFollowing(token: string, login: string): Promise<boolean>
  followUser(token: string, login: string): Promise<void>
  unfollowUser(token: string, login: string): Promise<void>

  // Write
  createRepo(token: string, name: string, opts?: { private?: boolean }): Promise<Repo>
  putFileContents(
    token: string,
    owner: string,
    name: string,
    path: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<{ sha: string }>

  // Capabilities — declared per host so the renderer can hide unsupported features
  capabilities(): ProviderCapabilities

  // Required bundle — GitHub uses its GraphQL query; GitLab and Gitea compose
  // the equivalent shape from parallel REST calls. Renderers never branch on
  // host for bundle access; `caps.graphqlBundle` records *how* it was sourced
  // (single GraphQL call vs. composed REST) for telemetry / future tooling.
  getRepoBundle(token: string | null, owner: string, name: string): Promise<RepoBundle>

  // Telemetry
  rateLimit(): { remaining: number | null; resetAt: number | null }
}

interface ProviderCapabilities {
  vulnerabilityAlerts: boolean    // GitHub: yes; GitLab: different shape (not normalized); Gitea: no
  codeScanningAlerts: boolean     // GitHub only
  events: boolean                 // received_events activity feed; GitHub-only in v1
  trendingDiscovery: boolean      // host supports the queries discoverMerge produces
  graphqlBundle: boolean          // host exposes a bundled metadata fetch
  isVerifiedOrg: boolean          // GitHub-specific verified-org concept
}
```

### Normalized `Repo` shape

```ts
interface Repo {
  hostId: string                  // "gh:api.github.com"
  hostType: 'github' | 'gitlab' | 'gitea'

  // Host-native primary key. Renderer never uses it directly — it is a stable
  // identity for cache keys and host-side write operations.
  hostNativeId: string | number

  // Universal slug — renderer uses these everywhere
  fullName: string                // "owner/repo"
  owner: string
  name: string

  // URLs
  htmlUrl: string                 // browser-visitable
  homepageUrl: string | null

  // Metadata
  description: string | null
  language: string | null
  topics: string[]
  license: string | null          // SPDX where available
  defaultBranch: string
  archived: boolean
  size: number                    // KB; normalizer converts GitLab/Gitea byte counts

  // Counts
  stars: number
  forks: number
  watchers: number
  openIssues: number

  // Timestamps (ISO 8601)
  createdAt: string
  updatedAt: string
  pushedAt: string                // last push — used heavily by discover ranking

  // Owner avatar
  ownerAvatarUrl: string
}
```

### Identity model

Every IPC payload and DB row gains `hostId`. Composite repo identity = `(hostId, owner, name)`.

- `hostId` is a deterministic string derived from `${typePrefix}:${normalize(baseUrl)}`.
  - Examples: `gh:api.github.com`, `gl:gitlab.com`, `gl:gitlab.acme.com`, `gt:codeberg.org`, `gt:gitea.acme.com`.
- The string form (rather than an enum) is required because self-hosted instances are user-defined and cannot be enumerated at build time.
- DB migration adds a `host_id TEXT NOT NULL` column to every repo-keyed table, backfilled to `'gh:api.github.com'` for existing rows.

### Host instance config

```ts
interface HostInstance {
  id: string                // "gh:api.github.com" — deterministic from type+baseUrl
  type: 'github' | 'gitlab' | 'gitea'
  baseUrl: string           // API base, e.g. "https://api.github.com", "https://gitlab.com",
                            // "https://codeberg.org", or user-supplied for self-hosted
  label: string             // display name, user-editable (default "GitHub", "GitLab.com", "Codeberg", etc.)
  addedAt: string           // ISO 8601
  webUrl?: string           // optional UI hint for self-hosted ("https://gitlab.acme.com")
}
```

Three host instances are **seeded on first launch** (removable):

- `gh:api.github.com` — GitHub
- `gl:gitlab.com` — GitLab.com
- `gt:codeberg.org` — Codeberg

Self-hosted instances are added via a "Connections" pane: type + URL + label. Before saving we probe `${baseUrl}/api/v4/version` (GitLab) or `${baseUrl}/api/v1/version` (Gitea) to confirm the host responds with the expected shape.

### Token storage

- Per-host PAT stored in `electron-store` under `tokens.<hostId>`.
- The existing single `gh.token` migrates on first run to `tokens.gh:api.github.com`.
- Anonymous mode is supported for every host — providers accept `token: string | null` and respect host-specific unauthenticated rate limits.
- On token save, we call `getCurrentUser` to validate the token and store the resulting login as a sanity check on later loads.

### IPC surface

A parallel `window.api.repo.*` + `window.api.hosts.*` namespace is added; the existing `window.api.github.*` is migrated to it file-by-file and deleted in one final commit. Net end state is a single namespace.

```ts
// Repo operations
window.api.repo.get(hostId, owner, name)
window.api.repo.search(hostId, query, opts)            // single-host search
window.api.repo.searchAll(query, opts)                 // multi-host merged (Discover)
window.api.repo.getReleases(hostId, owner, name)
window.api.repo.getReadme(hostId, owner, name, ref?)
// ... full surface mirrors RepoProvider

// Host management
window.api.hosts.list()                                // HostInstance[]
window.api.hosts.add({ type, baseUrl, label })         // probes then persists
window.api.hosts.remove(hostId)
window.api.hosts.probe({ type, baseUrl })              // validate before adding
window.api.hosts.setToken(hostId, pat)                 // validates via getCurrentUser
window.api.hosts.clearToken(hostId)
window.api.hosts.getConnectedUser(hostId)              // null if no token / invalid
```

**Where `hostId` comes from in the renderer:**

- Repo-detail pages — passed in the URL (`/repo/:hostId/:owner/:name`).
- Discover rows — iterate `hosts.list()` and call `searchAll` with the full set.
- Library / saved repos — `hostId` persisted per row.
- A `useCurrentHost()` context hook provides a default for "act-against-a-host" actions like "Create new repo" (defaults to GitHub, user-switchable).

### URL routing

- Repo detail route changes from `/repo/:owner/:name` to `/repo/:hostId/:owner/:name`.
- Old-shape URLs (deep links, saved bookmarks) redirect via a small compat layer: resolve `hostId` from the saved-repos table where the repo is known; default to `gh:api.github.com` otherwise.

## Discover merging

`providers/discoverMerge.ts` fans out a unified query across all configured hosts, caps each host's contribution, and merges by recency.

```ts
async function searchAllHosts(
  hosts: HostInstance[],
  query: UnifiedQuery,
  opts: { capPerHost: number; totalLimit: number },
): Promise<Repo[]>
```

**Algorithm:**

1. Translate `UnifiedQuery` per host (each provider's `search.ts` does this).
2. Fan out in parallel; per-host budget = `capPerHost` (default 10).
3. Soft timeout per host (4s). Hosts that time out contribute nothing this round; the row still renders.
4. Merge results, sort by `pushedAt` descending.
5. Slice to `totalLimit` (default 30).

**`UnifiedQuery` kinds:** `'trending-week' | 'hot-today' | 'hidden-gems' | 'topic' | 'free-text'` with optional `topic`, `minStars`, `language`, `freeText`.

**Per-host translation table:**

| UnifiedQuery | GitHub | GitLab | Gitea |
|---|---|---|---|
| `trending-week` | `search/repositories?q=created:>{7d}&sort=stars` | `/projects?order_by=star_count&statistics=true` + client-side date filter | `/repos/search?sort=updated&order=desc` + client-side filter |
| `hot-today` | `search/repositories?q=pushed:>{1d}&sort=updated` | `/projects?order_by=updated_at` + client-side push filter | `/repos/search?sort=updated` + client-side filter |
| `hidden-gems` | `search/repositories?q=stars:50..500&sort=stars` | `/projects` + client-side range | `/repos/search` + client-side range |
| `topic:rust` | `search/repositories?q=topic:rust` | `/projects?topic=rust` | `/repos/search?topic=rust` |
| `free-text` | `search/repositories?q={text}` | `/projects?search={text}` | `/repos/search?q={text}` |

GitLab and Gitea fall back to client-side filtering for ranges because their query syntax is coarser than GitHub's. The per-host cap means we are never paginating thousands of records to filter down — the worst case is ~10 retrieved per host per row.

**Failure handling:** providers that throw or time out contribute zero rows. The Discover header surfaces a small "host offline" badge when one or more configured hosts failed this fetch.

**Caching:** `http_etag_cache` keys are URLs; multi-host rows naturally produce one cache entry per host per query. The row-level TTL (already 6h for `trending-week`) lives in the renderer cache and is provider-agnostic — no change needed.

**Rate limits:** each provider tracks `X-RateLimit-Remaining` from response headers via `provider.rateLimit()`. The Discover loader checks budget before fanning out and skips a host that is under-budget for this round. No global throttle in v1; the per-host cap keeps the volume tight.

## Capability gating

Capability flags drive renderer behavior for features that don't translate cleanly:

- **Vulnerability alerts (Dependabot)** — `caps.vulnerabilityAlerts`. RepoDetail's security widget is hidden when `false` (no "Unavailable" empty state). GitLab's security dashboard has a different shape — out of scope for v1.
- **Code-scanning alerts** — `caps.codeScanningAlerts`. GitHub only.
- **Events feed** — `caps.events`. `received_events` activity feed is GitHub-only in v1; GitLab `/events` and Gitea `/users/{u}/activities/feeds` use different event types and are deferred.
- **GraphQL bundle** — `caps.graphqlBundle` reports whether the bundle came from a single GraphQL call (GitHub) or composed REST (GitLab, Gitea). All providers must implement `getRepoBundle`; the renderer never branches on host.
- **Verified org** — `caps.isVerifiedOrg`. GitHub-only; the badge is hidden on other hosts.
- **`size` units** — GitHub returns KB; GitLab/Gitea return bytes. Normalizer converts everything to KB.
- **Default branch fallback** — Some Gitea instances return an empty `default_branch` for empty repos; normalizer defaults to `'main'`.

## Migration phasing

This is too large for one commit. Each phase ends with a working, shippable app.

**Phase 1 — Provider layer for GitHub only, no UI change.**

- Create `providers/types.ts`, `providers/registry.ts`, `providers/github/`.
- Refactor `electron/github.ts` + `githubGraphql.ts` into the new structure.
- IPC handlers route via the registry; renderer keeps calling `window.api.github.*`.
- DB tables get `host_id` column with default `'gh:api.github.com'`; existing rows backfilled.
- Tests pass with no renderer changes.

**Phase 2 — Normalized `Repo` shape + renderer migration.**

- Introduce the normalized `Repo` interface.
- Migrate ~30 renderer files from `GitHubRepo` (snake_case) to `Repo` (camelCase) in logical groups.
- IPC handlers translate at the boundary.
- Snapshot / library entries reshaped on read.

**Phase 3 — `repo.*` IPC + URL routing.**

- Add `window.api.repo.*` and `window.api.hosts.*` parallel namespaces.
- Migrate renderer call sites file-by-file.
- Add `/repo/:hostId/:owner/:name` route alongside the existing route; compat redirect from the old shape.
- Delete `window.api.github.*` namespace in one final commit.

**Phase 4 — GitLab provider + host config UI.**

- Implement `GitLabProvider` (gitlab.com first; same code path covers self-hosted).
- Build the "Connections" pane: list hosts, add/remove instance, PAT entry, validate.
- Seed `gl:gitlab.com` on first run if missing.

**Phase 5 — Gitea provider + Codeberg seeding.**

- Implement `GiteaProvider`.
- Seed `gt:codeberg.org` on first run if missing.

**Phase 6 — Mixed-row Discover.**

- Replace `searchRepos` calls in Discover rows with `repo.searchAll`.
- Implement `discoverMerge.ts`.
- Wire capability gating in RepoDetail for non-GitHub hosts.

**Phase 7 — Self-hosted UX polish.**

- "Add instance" form with URL probe, TLS-error surfacing, editable label.
- Inline help for "How do I create a PAT?" per host type (link to the right docs page).
- Health check on app launch: ping each configured host's `/version` and surface unreachable instances in the Connections pane.

Each phase is its own spec/plan/PR. The user can stop after any phase and still have a coherent app.

**Next step: write an implementation plan for Phase 1 only.** The writing-plans pass should produce `docs/superpowers/plans/<date>-multi-host-phase-1-provider-layer.md` and scope itself to Phase 1's outcomes (provider layer for GitHub, no UI change, DB `host_id` column). Subsequent phases get their own plans when we are ready to start them.

## Testing

- **Per-provider unit tests** — each provider's REST/GraphQL calls mocked via `fetch` mocks (current `github.test.ts` pattern). Each provider gets parity coverage for the same operations.
- **Normalization golden tests** — for each provider, real-shape JSON fixture in → expected `Repo` out. Captures host quirks (size units, default branch fallback, empty topics, etc.) as a single source of truth.
- **`discoverMerge.ts` tests** — synthetic providers returning known repos; verify cap-per-host, recency sort, soft-timeout handling, partial-failure rendering.
- **Capability-gating tests** — RepoDetail components rendered with a fake provider declaring `vulnerabilityAlerts: false` → security widget absent.
- **Host registry integration tests** — add / remove host instances, token round-trip, probe validation, anonymous-mode rate-limit handling.
- **No live API calls in tests** — same as today.

## Open questions

None at design time. The phased rollout intentionally pushes uncertainty (e.g. exact GraphQL-bundle equivalents for GitLab/Gitea) into the phase where it gets investigated, rather than forcing it to be answered here.

## Risks

- **Self-hosted variance.** Gitea minor versions have changed search endpoints. The provider tracks the host's `/version` on probe and surfaces a clear error if an endpoint 404s.
- **Search semantic mismatch.** Per-host queries return different result orderings; the merge layer normalizes only on `pushedAt`. Users may notice that "trending" feels different per host. Acceptable trade for v1; we can revisit a normalized score later.
- **Renderer migration size.** Phase 2 touches ~30 files. Doing it in logical groups (RepoCard family, Discover family, Profile family) with green tests between groups keeps it tractable.
- **Token security.** PATs in `electron-store` use OS keychain when available (current GitHub token path); same protection level extends naturally to all hosts.
