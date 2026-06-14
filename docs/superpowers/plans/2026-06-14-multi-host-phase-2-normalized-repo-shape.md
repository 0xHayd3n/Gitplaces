# Multi-Host Phase 2: Normalized `Repo` Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the snake_case `GitHubRepo` / `RepoRow` shapes consumed by the renderer with a single normalized camelCase `Repo` shape (and a `SavedRepo` extension for library extras). IPC handlers translate at the boundary; the DB schema stays snake_case.

**Architecture:** Add `Repo` and `SavedRepo` interfaces in `src/types/repo.ts`. Add normalize helpers in `electron/providers/github/normalize.ts` (`githubRepoToRepo`) and `electron/repoNormalize.ts` (`repoRowToSavedRepo`, `savedRepoToRow`). Every IPC handler that today returns `GitHubRepo` or `RepoRow` wraps its return value through these normalizers. Renderer files migrate from snake_case field accesses to camelCase, file by file, in logical groups. The old `GitHubRepo` interface is deleted at the end; `RepoRow` is downgraded to a main-process-only DB row type, never crossing the IPC boundary.

**Tech Stack:** TypeScript, React, Electron, better-sqlite3, vitest.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 2 section.

**Out of scope for this plan:** the `repo.*` / `hosts.*` IPC namespaces (Phase 3), GitLab/Gitea providers (Phases 4–5), the URL routing change to `/repo/:hostId/...` (Phase 3), mixed-row Discover (Phase 6).

---

## Field rename map (apply to every renderer file)

This map covers the union of `GitHubRepo` (live GitHub-API shape) and `RepoRow` (SQLite mirror), normalized to the new `Repo` / `SavedRepo` shape. Every renderer file migration in Tasks 6–13 follows this map.

### Core `Repo` fields (covers `GitHubRepo` and `RepoRow`)

| Old (snake_case) | New (camelCase) | Notes |
|---|---|---|
| `repo.id` (numeric, from GitHubRepo) | `repo.hostNativeId` | Renderers should NOT use this for routing; use `fullName`. |
| `repo.full_name` | `repo.fullName` |  |
| `repo.owner.login` (from GitHubRepo) | `repo.owner` | Now a string, not an object. |
| `repo.owner.avatar_url` (from GitHubRepo) | `repo.ownerAvatarUrl` |  |
| `repo.avatar_url` (from RepoRow) | `repo.ownerAvatarUrl` | Same field, renamed for consistency. |
| `repo.html_url` (from GitHubRepo) | `repo.htmlUrl` | RepoRow never had this field; synthesize from `https://github.com/{fullName}` in the normalizer. |
| `repo.homepage` | `repo.homepageUrl` |  |
| `repo.default_branch` | `repo.defaultBranch` |  |
| `repo.stargazers_count` (GitHubRepo) | `repo.stars` | RepoRow already uses `stars`. |
| `repo.forks_count` (GitHubRepo) | `repo.forks` | RepoRow already uses `forks`. |
| `repo.watchers_count` (GitHubRepo) | `repo.watchers` |  |
| `repo.open_issues_count` (GitHubRepo) | `repo.openIssues` | RepoRow uses `open_issues`. |
| `repo.open_issues` (RepoRow) | `repo.openIssues` |  |
| `repo.pushed_at` | `repo.pushedAt` |  |
| `repo.updated_at` | `repo.updatedAt` |  |
| `repo.created_at` | `repo.createdAt` |  |
| `repo.license.spdx_id` (GitHubRepo) | `repo.license` | Now a `string \| null`, not an object. |
| `repo.license` (RepoRow, already string) | `repo.license` | No change needed. |
| `repo.topics` (string[] on GitHubRepo) | `repo.topics` | string[]. Normalizer parses RepoRow's JSON-string. |
| `repo.topics` (JSON-string on RepoRow) | `repo.topics` | Normalizer calls `JSON.parse(row.topics)`. |
| `repo.archived` | `repo.archived` | No change. |
| `repo.size` | `repo.size` | KB on both sides. |
| `repo.description` | `repo.description` | No change. |
| `repo.language` | `repo.language` | No change. |
| `repo.name` | `repo.name` | No change. |

### `SavedRepo` extras (library / discovery / verification state — from `RepoRow` only)

| Old (snake_case) | New (camelCase) |
|---|---|
| `row.saved_at` | `savedAt` |
| `row.starred_at` | `starredAt` |
| `row.unstarred_at` | `unstarredAt` |
| `row.discovered_at` | `discoveredAt` |
| `row.discover_query` | `discoverQuery` |
| `row.banner_svg` | `bannerSvg` |
| `row.banner_color` | `bannerColor` |
| `row.og_image_url` | `ogImageUrl` |
| `row.type` | `type` |
| `row.type_bucket` | `typeBucket` |
| `row.type_sub` | `typeSub` |
| `row.translated_description` | `translatedDescription` |
| `row.translated_description_lang` | `translatedDescriptionLang` |
| `row.translated_readme` | `translatedReadme` |
| `row.translated_readme_lang` | `translatedReadmeLang` |
| `row.detected_language` | `detectedLanguage` |
| `row.verification_score` | `verificationScore` |
| `row.verification_tier` | `verificationTier` |
| `row.verification_signals` | `verificationSignals` |
| `row.verification_checked_at` | `verificationCheckedAt` |
| `row.is_forked` | `isForked` |
| `row.update_available` | `updateAvailable` |
| `row.update_checked_at` | `updateCheckedAt` |
| `row.upstream_version` | `upstreamVersion` |
| `row.stored_version` | `storedVersion` |
| `row.archived_at` | `archivedAt` |
| `row.forked_at` | `forkedAt` |
| `row.fetched_at` | `fetchedAt` |
| `row.starred_checked_at` | `starredCheckedAt` |
| `row.storybook_url` | `storybookUrl` |
| `row.host_id` (Phase 1) | `hostId` |

### `LibrarySavedRepo` extras (library:* IPC payloads — `LibraryRow extends RepoRow`)

| Old | New |
|---|---|
| `row.installed` | `installed` (unchanged — already camelCase-friendly) |
| `row.active` | `active` |
| `row.version` | `version` |
| `row.generated_at` | `generatedAt` |
| `row.enabled_components` | `enabledComponents` |
| `row.enabled_tools` | `enabledTools` |
| `row.tier` | `tier` |

### Other renamed shapes

`GitHubRelease` / `ReleaseRow` → `Release`:

| Old | New |
|---|---|
| `tag_name` | `tagName` |
| `published_at` | `publishedAt` |
| `prerelease` | `prerelease` (unchanged) |
| `assets[].browser_download_url` | `assets[].browserDownloadUrl` |
| `assets[].download_count` | `assets[].downloadCount` |

`GitHubStarredRepo` → `StarredEntry`:

| Old | New |
|---|---|
| `starred_at` | `starredAt` |
| `repo` (GitHubRepo) | `repo` (Repo) |

`GitHubUser` → `User`:

| Old | New |
|---|---|
| `login` | `login` (unchanged — already camelCase) |
| `avatar_url` | `avatarUrl` |
| `public_repos` | `publicRepos` |

---

## File structure

### New files
- `electron/repoNormalize.ts` — `repoRowToSavedRepo`, `savedRepoToRow`, plus library-row variants. Pure functions, no I/O.
- `electron/repoNormalize.test.ts` — golden tests for normalize round-trips.
- `electron/providers/github/normalize.ts` — `githubRepoToRepo`, `githubReleaseToRelease`, `githubUserToUser`, `githubStarredToStarredEntry`, `githubEventActorToUser`.
- `electron/providers/github/normalize.test.ts` — golden tests against real GitHub-API response fixtures.

### Modified files
- `src/types/repo.ts` — add `Repo`, `SavedRepo`, `LibrarySavedRepo`, `Release`, `ReleaseAsset` (camelCase), `User`, `StarredEntry`. Mark `RepoRow`, `LibraryRow`, `StarredRepoRow`, `ReleaseRow` (the legacy snake_case shapes) as `@deprecated` until the migration completes.
- `src/types/library.ts` — re-export `LibrarySavedRepo` to keep the existing import path working; mark `LibraryRow` as `@deprecated`.
- `src/types/recommendation.ts` — replace the embedded `GitHubRepo` references with `Repo`.
- `src/env.d.ts` — update the `window.api.github.*` return-type declarations to use `Repo` / `Release` / `StarredEntry` / `User`.
- `electron/preload.ts` — update inline `import('./providers/github').XXX` type references to `import('../src/types/repo').XXX`.
- `electron/main.ts` — every IPC handler that currently returns `GitHubRepo[]`, `GitHubRelease[]`, `GitHubStarredRepo[]`, `GitHubUser`, `RepoRow[]`, or `LibraryRow[]` wraps its return through the matching normalizer.
- `electron/ipc/recommendHandlers.ts` — same translation at handler boundary.
- `electron/ipc/updateHandlers.ts` — same.
- The 46 renderer files using `RepoRow` / `LibraryRow` / `StarredRepoRow`.
- The 18 renderer files importing `GitHubRepo` / `GitHubRelease` / `GitHubStarredRepo` / `GitHubUser` / `GitHubEvent`.

### Deleted at end of plan
- `GitHubRepo`, `GitHubRelease`, `GitHubStarredRepo`, `GitHubUser`, and their relatives in `electron/providers/github/rest.ts` are NOT deleted — they remain the main-process input type to the normalizers. What IS deleted is any **renderer-side** re-export or use of them (everything outside `electron/`).
- `RepoRow`, `LibraryRow`, `StarredRepoRow`, `ReleaseRow` are removed from `src/types/repo.ts`. A copy of the shape stays inside `electron/db-row-types.ts` (new file) for main-process-only DB use.

### Files where `RepoRow` lives after Phase 2
- `electron/db-row-types.ts` (new) — defines `RepoRow`, `LibraryRow`, `StarredRepoRow` as main-process-only shapes mirroring the SQLite columns. Used by `electron/services/*` and `electron/main.ts` SQL helpers. The renderer never imports from this file.

---

## Notes for the executor

- Work directly on `main`. Do **not** create a feature branch or worktree.
- Use `npm test` for the full sqlite-aware suite. For individual provider/normalize tests that don't touch sqlite, `npx vitest run <path>` is fine (Phase 1 established this trade-off).
- The IPC layer migration in Task 5 is the only **atomic** step. Until Task 5 lands AND at least one renderer group migrates, the renderer is type-broken. Group tasks (6–12) bring it back to green. **Do not run the dev app between Tasks 5 and the last renderer task in the same batch** — the renderer will crash on undefined fields.
- Each renderer-group task lists its files. Apply the field rename map mechanically. If a file accesses a field not in the map, that's a bug in the map — surface it; don't invent a translation.
- After every group, run `npx tsc --noEmit` to confirm the affected files compile. Renderer Vitest specs that mock the IPC layer will need their mock return shapes updated as part of each group.
- Conventional-commit style; one commit per task.

---

## Task 1: Add normalized `Repo` and `SavedRepo` types

**Files:**
- Modify: `src/types/repo.ts`

- [ ] **Step 1: Add the new types**

Insert the following at the top of `src/types/repo.ts` (before the existing `RepoRow` interface). The legacy shapes stay below with `@deprecated` until Task 13 removes them.

```ts
import type { ProviderCapabilities, HostType } from '../../electron/providers/types'

/** Canonical normalized repository shape consumed across the renderer.
 *  Provider-agnostic — Phases 4–5 add GitLab + Gitea providers that produce the same shape. */
export interface Repo {
  hostId: string
  hostType: HostType
  hostNativeId: string | number
  fullName: string                 // "owner/repo"
  owner: string
  name: string
  htmlUrl: string
  homepageUrl: string | null
  description: string | null
  language: string | null
  topics: string[]
  license: string | null           // SPDX id where available
  defaultBranch: string
  archived: boolean
  size: number                     // KB
  stars: number
  forks: number
  watchers: number
  openIssues: number
  createdAt: string                // ISO 8601
  updatedAt: string                // ISO 8601
  pushedAt: string                 // ISO 8601
  ownerAvatarUrl: string
}

/** `Repo` plus library/discovery/verification state — what `library:*`/`starred:*`
 *  IPC channels return after Task 5. Mirror of the SavedRepo extras enumerated in the
 *  field rename map. Every field is nullable because pre-existing rows are populated
 *  lazily by separate flows (engagement, verification, classification, etc.). */
export interface SavedRepo extends Repo {
  savedAt: string | null
  starredAt: string | null
  unstarredAt: string | null
  discoveredAt: string | null
  discoverQuery: string | null
  bannerSvg: string | null
  bannerColor: string | null
  ogImageUrl: string | null
  type: string | null
  typeBucket: string | null
  typeSub: string | null
  translatedDescription: string | null
  translatedDescriptionLang: string | null
  translatedReadme: string | null
  translatedReadmeLang: string | null
  detectedLanguage: string | null
  verificationScore: number | null
  verificationTier: string | null
  verificationSignals: string | null
  verificationCheckedAt: number | null
  isForked: number | null
  updateAvailable: number | null
  updateCheckedAt: number | null
  upstreamVersion: string | null
  storedVersion: string | null
  archivedAt: string | null
  forkedAt: string | null
  fetchedAt: number | null
  starredCheckedAt: number | null
  storybookUrl: string | null
}

/** `SavedRepo` plus the columns added by `library:getAll` joining `skills`. */
export interface LibrarySavedRepo extends SavedRepo {
  installed: number                // 0 | 1
  active: number                   // 0 | 1
  version: string | null
  generatedAt: string | null
  enabledComponents: string | null
  enabledTools: string | null
  tier?: number
}

/** Single release entry (camelCase). Replaces both `GitHubRelease` (live API) and `ReleaseRow` (legacy renderer). */
export interface ReleaseAsset {
  name: string
  size: number
  browserDownloadUrl: string
  downloadCount: number
}
export interface Release {
  tagName: string
  name: string | null
  publishedAt: string
  body: string | null
  assets: ReleaseAsset[]
  prerelease: boolean
}

/** Authenticated user info. Replaces `GitHubUser`. */
export interface User {
  login: string
  avatarUrl: string
  publicRepos: number
}

/** Output of `github:getStarred`. Replaces `GitHubStarredRepo`. */
export interface StarredEntry {
  starredAt: string
  repo: Repo
}

/** Format a star count: 76200 → "76.2k", 500 → "500" */
export function formatStars(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
```

- [ ] **Step 2: Mark legacy shapes deprecated**

Find each of the legacy interfaces in the same file (`RepoRow`, `ReleaseRow`, `LibraryRow`, `StarredRepoRow`, `parseTopics`, the duplicate `formatStars`) and prepend a JSDoc:

```ts
/** @deprecated Use `SavedRepo` from this file. Removed in the Phase 2 finalisation pass. */
export interface RepoRow {
  ...
}
```

Apply the same prefix to `ReleaseRow`, `LibraryRow`, `StarredRepoRow`. Delete the old top-level `formatStars` if it conflicts with the new one defined in Step 1 (keep one).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero new errors. The legacy types are still in use; nothing breaks yet.

- [ ] **Step 4: Commit**

```bash
git add src/types/repo.ts
git commit -m "feat(types): add normalized Repo + SavedRepo + Release + User shapes"
```

---

## Task 2: Add `githubRepoToRepo` normalizer in the GitHub provider

**Files:**
- Create: `electron/providers/github/normalize.ts`
- Create: `electron/providers/github/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/providers/github/normalize.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  githubRepoToRepo,
  githubReleaseToRelease,
  githubUserToUser,
  githubStarredToStarredEntry,
} from './normalize'
import type { GitHubRepo, GitHubRelease, GitHubUser, GitHubStarredRepo } from './rest'

const FIXTURE_REPO: GitHubRepo = {
  id: 12345,
  full_name: 'vitejs/vite',
  name: 'vite',
  html_url: 'https://github.com/vitejs/vite',
  owner: { login: 'vitejs', avatar_url: 'https://avatars.githubusercontent.com/u/65625612?v=4' },
  description: 'Next generation frontend tooling. It\'s fast!',
  language: 'TypeScript',
  topics: ['build-tool', 'frontend'],
  stargazers_count: 76200,
  forks_count: 6800,
  watchers_count: 76200,
  open_issues_count: 412,
  size: 18900,
  license: { spdx_id: 'MIT' },
  homepage: 'https://vitejs.dev',
  updated_at: '2026-06-13T22:00:00Z',
  pushed_at: '2026-06-13T21:30:00Z',
  created_at: '2020-04-21T00:00:00Z',
  default_branch: 'main',
  archived: false,
}

describe('githubRepoToRepo', () => {
  it('maps all standard fields to camelCase', () => {
    const r = githubRepoToRepo(FIXTURE_REPO)
    expect(r.hostId).toBe('gh:api.github.com')
    expect(r.hostType).toBe('github')
    expect(r.hostNativeId).toBe(12345)
    expect(r.fullName).toBe('vitejs/vite')
    expect(r.owner).toBe('vitejs')
    expect(r.name).toBe('vite')
    expect(r.htmlUrl).toBe('https://github.com/vitejs/vite')
    expect(r.homepageUrl).toBe('https://vitejs.dev')
    expect(r.description).toBe(FIXTURE_REPO.description)
    expect(r.language).toBe('TypeScript')
    expect(r.topics).toEqual(['build-tool', 'frontend'])
    expect(r.license).toBe('MIT')
    expect(r.defaultBranch).toBe('main')
    expect(r.archived).toBe(false)
    expect(r.size).toBe(18900)
    expect(r.stars).toBe(76200)
    expect(r.forks).toBe(6800)
    expect(r.watchers).toBe(76200)
    expect(r.openIssues).toBe(412)
    expect(r.createdAt).toBe('2020-04-21T00:00:00Z')
    expect(r.updatedAt).toBe('2026-06-13T22:00:00Z')
    expect(r.pushedAt).toBe('2026-06-13T21:30:00Z')
    expect(r.ownerAvatarUrl).toBe('https://avatars.githubusercontent.com/u/65625612?v=4')
  })

  it('handles null license, null homepage, missing topics', () => {
    const r = githubRepoToRepo({
      ...FIXTURE_REPO,
      license: null,
      homepage: null,
      topics: undefined as unknown as string[],
    })
    expect(r.license).toBeNull()
    expect(r.homepageUrl).toBeNull()
    expect(r.topics).toEqual([])
  })

  it('falls back default_branch to "main" when empty', () => {
    const r = githubRepoToRepo({ ...FIXTURE_REPO, default_branch: '' })
    expect(r.defaultBranch).toBe('main')
  })
})

describe('githubReleaseToRelease', () => {
  it('maps release fields and asset fields to camelCase', () => {
    const rel: GitHubRelease = {
      tag_name: 'v5.0.0',
      name: 'Five',
      published_at: '2026-06-12T00:00:00Z',
      body: 'Release notes',
      prerelease: false,
      assets: [
        { name: 'vite.tgz', size: 1234, browser_download_url: 'https://x/y.tgz', download_count: 42 },
      ],
    }
    const out = githubReleaseToRelease(rel)
    expect(out.tagName).toBe('v5.0.0')
    expect(out.publishedAt).toBe('2026-06-12T00:00:00Z')
    expect(out.assets[0].browserDownloadUrl).toBe('https://x/y.tgz')
    expect(out.assets[0].downloadCount).toBe(42)
  })
})

describe('githubUserToUser', () => {
  it('maps avatar_url + public_repos', () => {
    const u: GitHubUser = { login: 'alice', avatar_url: 'https://x/a.png', public_repos: 17 }
    const out = githubUserToUser(u)
    expect(out).toEqual({ login: 'alice', avatarUrl: 'https://x/a.png', publicRepos: 17 })
  })
})

describe('githubStarredToStarredEntry', () => {
  it('lifts starred_at + nested repo', () => {
    const s: GitHubStarredRepo = { starred_at: '2026-01-15T10:00:00Z', repo: FIXTURE_REPO }
    const out = githubStarredToStarredEntry(s)
    expect(out.starredAt).toBe('2026-01-15T10:00:00Z')
    expect(out.repo.fullName).toBe('vitejs/vite')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/github/normalize.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `electron/providers/github/normalize.ts`:

```ts
// electron/providers/github/normalize.ts
//
// Adapter from the live GitHub REST shapes (snake_case) to the canonical
// camelCase shapes the renderer consumes. Pure functions, no I/O.

import { HOST_ID_GITHUB } from '../types'
import type {
  Repo,
  Release,
  ReleaseAsset,
  User,
  StarredEntry,
} from '../../../src/types/repo'
import type {
  GitHubRepo,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubUser,
  GitHubStarredRepo,
} from './rest'

export function githubRepoToRepo(g: GitHubRepo): Repo {
  return {
    hostId: HOST_ID_GITHUB,
    hostType: 'github',
    hostNativeId: g.id,
    fullName: g.full_name,
    owner: g.owner.login,
    name: g.name,
    htmlUrl: g.html_url,
    homepageUrl: g.homepage ?? null,
    description: g.description ?? null,
    language: g.language ?? null,
    topics: Array.isArray(g.topics) ? g.topics : [],
    license: g.license?.spdx_id ?? null,
    defaultBranch: g.default_branch && g.default_branch.length > 0 ? g.default_branch : 'main',
    archived: Boolean(g.archived),
    size: g.size ?? 0,
    stars: g.stargazers_count ?? 0,
    forks: g.forks_count ?? 0,
    watchers: g.watchers_count ?? 0,
    openIssues: g.open_issues_count ?? 0,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    pushedAt: g.pushed_at,
    ownerAvatarUrl: g.owner.avatar_url,
  }
}

function releaseAssetToAsset(a: GitHubReleaseAsset): ReleaseAsset {
  return {
    name: a.name,
    size: a.size,
    browserDownloadUrl: a.browser_download_url,
    downloadCount: a.download_count,
  }
}

export function githubReleaseToRelease(r: GitHubRelease): Release {
  return {
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.published_at,
    body: r.body,
    assets: (r.assets ?? []).map(releaseAssetToAsset),
    prerelease: Boolean(r.prerelease),
  }
}

export function githubUserToUser(u: GitHubUser): User {
  return {
    login: u.login,
    avatarUrl: u.avatar_url,
    publicRepos: u.public_repos,
  }
}

export function githubStarredToStarredEntry(s: GitHubStarredRepo): StarredEntry {
  return {
    starredAt: s.starred_at,
    repo: githubRepoToRepo(s.repo),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run electron/providers/github/normalize.test.ts`

Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/github/normalize.ts electron/providers/github/normalize.test.ts
git commit -m "feat(providers): add GitHub→normalized-Repo translation helpers"
```

---

## Task 3: Add DB-row → `SavedRepo` normalizer

**Files:**
- Create: `electron/repoNormalize.ts`
- Create: `electron/repoNormalize.test.ts`
- Create: `electron/db-row-types.ts` (mirror of the legacy `RepoRow` etc. for main-process internal use)

- [ ] **Step 1: Move the legacy DB shapes into a main-process-only file**

Create `electron/db-row-types.ts`:

```ts
// electron/db-row-types.ts
//
// Snake_case row shapes that mirror the SQLite schema. ONLY the main process
// imports from here — SELECT * results land in these types before normalizers
// produce the canonical camelCase Repo/SavedRepo shapes that cross IPC.
//
// The renderer must never import this file. If you find yourself reaching for
// it from src/, you want `Repo` or `SavedRepo` instead.

export interface RepoRow {
  id: string
  owner: string
  name: string
  description: string | null
  language: string | null
  topics: string                 // JSON: '["cli","rust"]'
  stars: number | null
  forks: number | null
  license: string | null
  homepage: string | null
  updated_at: string | null
  pushed_at: string | null
  created_at: string | null
  saved_at: string | null
  starred_at: string | null
  unstarred_at: string | null
  type: string | null
  banner_svg: string | null
  discovered_at: string | null
  discover_query: string | null
  watchers: number | null
  size: number | null
  open_issues: number | null
  default_branch: string | null
  avatar_url: string | null
  og_image_url: string | null
  banner_color: string | null
  translated_description: string | null
  translated_description_lang: string | null
  translated_readme: string | null
  translated_readme_lang: string | null
  detected_language: string | null
  verification_score: number | null
  verification_tier: string | null
  verification_signals: string | null
  verification_checked_at: number | null
  type_bucket: string | null
  type_sub: string | null
  is_forked: number | null
  update_available: number | null
  update_checked_at: number | null
  upstream_version: string | null
  stored_version: string | null
  archived_at: string | null
  forked_at: string | null
  fetched_at: number | null
  starred_checked_at: number | null
  storybook_url: string | null
  host_id: string                // Phase 1 added this column
}

export interface LibraryRow extends RepoRow {
  installed: number
  active: number
  version: string | null
  generated_at: string | null
  enabled_components: string | null
  enabled_tools: string | null
  tier?: number
}

export interface StarredRepoRow extends RepoRow {
  installed: number
}
```

- [ ] **Step 2: Write the failing test**

Write `electron/repoNormalize.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { repoRowToSavedRepo, libraryRowToLibrarySavedRepo, savedRepoToRow } from './repoNormalize'
import type { RepoRow, LibraryRow } from './db-row-types'

const BASE_ROW: RepoRow = {
  id: 'gh-12345',
  owner: 'vitejs',
  name: 'vite',
  description: 'Frontend tooling',
  language: 'TypeScript',
  topics: '["build-tool","frontend"]',
  stars: 76200,
  forks: 6800,
  license: 'MIT',
  homepage: 'https://vitejs.dev',
  updated_at: '2026-06-13T22:00:00Z',
  pushed_at: '2026-06-13T21:30:00Z',
  created_at: '2020-04-21T00:00:00Z',
  saved_at: '2026-05-12T10:00:00Z',
  starred_at: null,
  unstarred_at: null,
  type: null,
  banner_svg: null,
  discovered_at: null,
  discover_query: null,
  watchers: 76200,
  size: 18900,
  open_issues: 412,
  default_branch: 'main',
  avatar_url: 'https://avatars.githubusercontent.com/u/65625612?v=4',
  og_image_url: null,
  banner_color: null,
  translated_description: null,
  translated_description_lang: null,
  translated_readme: null,
  translated_readme_lang: null,
  detected_language: null,
  verification_score: null,
  verification_tier: null,
  verification_signals: null,
  verification_checked_at: null,
  type_bucket: null,
  type_sub: null,
  is_forked: 0,
  update_available: 0,
  update_checked_at: null,
  upstream_version: null,
  stored_version: null,
  archived_at: null,
  forked_at: null,
  fetched_at: null,
  starred_checked_at: null,
  storybook_url: null,
  host_id: 'gh:api.github.com',
}

describe('repoRowToSavedRepo', () => {
  it('maps every column to its camelCase equivalent', () => {
    const r = repoRowToSavedRepo(BASE_ROW)
    expect(r.hostId).toBe('gh:api.github.com')
    expect(r.hostType).toBe('github')
    expect(r.hostNativeId).toBe('gh-12345')
    expect(r.fullName).toBe('vitejs/vite')
    expect(r.owner).toBe('vitejs')
    expect(r.name).toBe('vite')
    expect(r.htmlUrl).toBe('https://github.com/vitejs/vite')
    expect(r.homepageUrl).toBe('https://vitejs.dev')
    expect(r.topics).toEqual(['build-tool', 'frontend'])
    expect(r.stars).toBe(76200)
    expect(r.openIssues).toBe(412)
    expect(r.defaultBranch).toBe('main')
    expect(r.ownerAvatarUrl).toBe(BASE_ROW.avatar_url)
    expect(r.savedAt).toBe('2026-05-12T10:00:00Z')
  })

  it('parses an invalid topics JSON to []', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, topics: 'not-json' })
    expect(r.topics).toEqual([])
  })

  it('defaults defaultBranch to "main" when null/empty', () => {
    expect(repoRowToSavedRepo({ ...BASE_ROW, default_branch: null }).defaultBranch).toBe('main')
    expect(repoRowToSavedRepo({ ...BASE_ROW, default_branch: '' }).defaultBranch).toBe('main')
  })

  it('zero-fills missing counts', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, stars: null, forks: null, watchers: null, open_issues: null, size: null })
    expect(r.stars).toBe(0)
    expect(r.forks).toBe(0)
    expect(r.watchers).toBe(0)
    expect(r.openIssues).toBe(0)
    expect(r.size).toBe(0)
  })

  it('inherits host_id from the row (multi-host preparation)', () => {
    const r = repoRowToSavedRepo({ ...BASE_ROW, host_id: 'gl:gitlab.com' })
    expect(r.hostId).toBe('gl:gitlab.com')
    expect(r.hostType).toBe('gitlab')
  })
})

describe('libraryRowToLibrarySavedRepo', () => {
  it('adds installed / version / generatedAt / enabled* / tier', () => {
    const row: LibraryRow = {
      ...BASE_ROW,
      installed: 1,
      active: 1,
      version: 'v3.5.1',
      generated_at: '2026-06-01T12:00:00Z',
      enabled_components: '["Button","Modal"]',
      enabled_tools: null,
      tier: 2,
    }
    const r = libraryRowToLibrarySavedRepo(row)
    expect(r.installed).toBe(1)
    expect(r.version).toBe('v3.5.1')
    expect(r.generatedAt).toBe('2026-06-01T12:00:00Z')
    expect(r.enabledComponents).toBe('["Button","Modal"]')
    expect(r.tier).toBe(2)
  })
})

describe('savedRepoToRow', () => {
  it('round-trips through repoRowToSavedRepo → savedRepoToRow (lossless on the savedRepo fields)', () => {
    const saved = repoRowToSavedRepo(BASE_ROW)
    const row = savedRepoToRow(saved)
    // Round-trip the canonical subset (host_id, owner, name, description, etc.).
    expect(row.host_id).toBe(BASE_ROW.host_id)
    expect(row.owner).toBe(BASE_ROW.owner)
    expect(row.name).toBe(BASE_ROW.name)
    expect(row.description).toBe(BASE_ROW.description)
    expect(row.stars).toBe(BASE_ROW.stars)
    expect(row.default_branch).toBe(BASE_ROW.default_branch)
    expect(row.topics).toBe(BASE_ROW.topics)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run electron/repoNormalize.test.ts`

Expected: FAIL — `repoNormalize` module not found.

- [ ] **Step 4: Write the implementation**

Write `electron/repoNormalize.ts`:

```ts
// electron/repoNormalize.ts
//
// SQLite-row (snake_case) ↔ canonical-Repo (camelCase) translation.
// All IPC handlers that read or write the `repos` family of tables run their
// payloads through these helpers so the renderer never sees snake_case fields.

import type { Repo, SavedRepo, LibrarySavedRepo } from '../src/types/repo'
import type { HostType } from './providers/types'
import type { RepoRow, LibraryRow } from './db-row-types'

function hostTypeFromHostId(hostId: string): HostType {
  if (hostId.startsWith('gh:')) return 'github'
  if (hostId.startsWith('gl:')) return 'gitlab'
  if (hostId.startsWith('gt:')) return 'gitea'
  // Default to github when unknown (e.g. legacy rows written before host_id existed).
  return 'github'
}

function parseTopicsJson(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function buildHtmlUrl(hostId: string, owner: string, name: string): string {
  // hostId is e.g. "gh:api.github.com" — the web URL strips the "api." subdomain.
  // Phase 3+ will plumb the canonical web URL through HostInstance.webUrl instead.
  if (hostId.startsWith('gh:')) return `https://github.com/${owner}/${name}`
  if (hostId.startsWith('gl:')) {
    const host = hostId.slice(3)
    return `https://${host}/${owner}/${name}`
  }
  if (hostId.startsWith('gt:')) {
    const host = hostId.slice(3)
    return `https://${host}/${owner}/${name}`
  }
  return `https://github.com/${owner}/${name}`
}

export function repoRowToSavedRepo(row: RepoRow): SavedRepo {
  const hostId = row.host_id ?? 'gh:api.github.com'
  const hostType = hostTypeFromHostId(hostId)
  return {
    hostId,
    hostType,
    hostNativeId: row.id,
    fullName: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    htmlUrl: buildHtmlUrl(hostId, row.owner, row.name),
    homepageUrl: row.homepage,
    description: row.description,
    language: row.language,
    topics: parseTopicsJson(row.topics),
    license: row.license,
    defaultBranch: row.default_branch && row.default_branch.length > 0 ? row.default_branch : 'main',
    archived: false,        // RepoRow has no archived flag; populated by separate flows
    size: row.size ?? 0,
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    watchers: row.watchers ?? 0,
    openIssues: row.open_issues ?? 0,
    createdAt: row.created_at ?? row.updated_at ?? '',
    updatedAt: row.updated_at ?? '',
    pushedAt: row.pushed_at ?? row.updated_at ?? '',
    ownerAvatarUrl: row.avatar_url ?? '',
    // ── SavedRepo extras ────────────────────────────────────────
    savedAt: row.saved_at,
    starredAt: row.starred_at,
    unstarredAt: row.unstarred_at,
    discoveredAt: row.discovered_at,
    discoverQuery: row.discover_query,
    bannerSvg: row.banner_svg,
    bannerColor: row.banner_color,
    ogImageUrl: row.og_image_url,
    type: row.type,
    typeBucket: row.type_bucket,
    typeSub: row.type_sub,
    translatedDescription: row.translated_description,
    translatedDescriptionLang: row.translated_description_lang,
    translatedReadme: row.translated_readme,
    translatedReadmeLang: row.translated_readme_lang,
    detectedLanguage: row.detected_language,
    verificationScore: row.verification_score,
    verificationTier: row.verification_tier,
    verificationSignals: row.verification_signals,
    verificationCheckedAt: row.verification_checked_at,
    isForked: row.is_forked,
    updateAvailable: row.update_available,
    updateCheckedAt: row.update_checked_at,
    upstreamVersion: row.upstream_version,
    storedVersion: row.stored_version,
    archivedAt: row.archived_at,
    forkedAt: row.forked_at,
    fetchedAt: row.fetched_at,
    starredCheckedAt: row.starred_checked_at,
    storybookUrl: row.storybook_url,
  }
}

export function libraryRowToLibrarySavedRepo(row: LibraryRow): LibrarySavedRepo {
  return {
    ...repoRowToSavedRepo(row),
    installed: row.installed,
    active: row.active,
    version: row.version,
    generatedAt: row.generated_at,
    enabledComponents: row.enabled_components,
    enabledTools: row.enabled_tools,
    tier: row.tier,
  }
}

/** Project a `SavedRepo` back to a `RepoRow` for INSERT/UPDATE statements.
 *  Lossless on the SavedRepo fields; loses `hostType` (derivable from host_id). */
export function savedRepoToRow(r: SavedRepo): RepoRow {
  return {
    id: typeof r.hostNativeId === 'string' ? r.hostNativeId : String(r.hostNativeId),
    owner: r.owner,
    name: r.name,
    description: r.description,
    language: r.language,
    topics: JSON.stringify(r.topics),
    stars: r.stars,
    forks: r.forks,
    license: r.license,
    homepage: r.homepageUrl,
    updated_at: r.updatedAt,
    pushed_at: r.pushedAt,
    created_at: r.createdAt,
    saved_at: r.savedAt,
    starred_at: r.starredAt,
    unstarred_at: r.unstarredAt,
    type: r.type,
    banner_svg: r.bannerSvg,
    discovered_at: r.discoveredAt,
    discover_query: r.discoverQuery,
    watchers: r.watchers,
    size: r.size,
    open_issues: r.openIssues,
    default_branch: r.defaultBranch,
    avatar_url: r.ownerAvatarUrl,
    og_image_url: r.ogImageUrl,
    banner_color: r.bannerColor,
    translated_description: r.translatedDescription,
    translated_description_lang: r.translatedDescriptionLang,
    translated_readme: r.translatedReadme,
    translated_readme_lang: r.translatedReadmeLang,
    detected_language: r.detectedLanguage,
    verification_score: r.verificationScore,
    verification_tier: r.verificationTier,
    verification_signals: r.verificationSignals,
    verification_checked_at: r.verificationCheckedAt,
    type_bucket: r.typeBucket,
    type_sub: r.typeSub,
    is_forked: r.isForked,
    update_available: r.updateAvailable,
    update_checked_at: r.updateCheckedAt,
    upstream_version: r.upstreamVersion,
    stored_version: r.storedVersion,
    archived_at: r.archivedAt,
    forked_at: r.forkedAt,
    fetched_at: r.fetchedAt,
    starred_checked_at: r.starredCheckedAt,
    storybook_url: r.storybookUrl,
    host_id: r.hostId,
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run electron/repoNormalize.test.ts`

Expected: PASS — 7 cases green.

- [ ] **Step 6: Commit**

```bash
git add electron/repoNormalize.ts electron/repoNormalize.test.ts electron/db-row-types.ts
git commit -m "feat(repoNormalize): translate SQLite rows ↔ SavedRepo"
```

---

## Task 4: Update preload + `window.api` return types

**Files:**
- Modify: `src/env.d.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Update `src/env.d.ts`**

Find every reference to `GitHubRepo`, `GitHubRelease`, `GitHubUser`, `GitHubStarredRepo`, `GitHubEvent`, `RepoRow`, `LibraryRow`, `StarredRepoRow` in the `Window.api.github.*` / `library.*` / `starred.*` channel return types and replace with the new shapes:

- `Promise<GitHubRepo>` → `Promise<Repo>`
- `Promise<GitHubRepo[]>` → `Promise<Repo[]>`
- `Promise<GitHubRelease[]>` → `Promise<Release[]>`
- `Promise<GitHubStarredRepo[]>` → `Promise<StarredEntry[]>`
- `Promise<GitHubUser>` → `Promise<User>`
- `Promise<GitHubEvent[]>` → `Promise<Event[]>` (use the existing renderer-side `Event` type or keep `GitHubEvent[]` for now if no normalized event shape exists — flag inline)
- `Promise<RepoRow[]>` → `Promise<SavedRepo[]>`
- `Promise<LibraryRow[]>` → `Promise<LibrarySavedRepo[]>`
- `Promise<StarredRepoRow[]>` → `Promise<LibrarySavedRepo[]>` (StarredRepoRow already extended RepoRow + installed)

The exact lines are spread across the `github`, `library`, `starred`, `repos`, `recommend` blocks. Run `git grep -n "GitHubRepo\|GitHubRelease\|GitHubUser\|GitHubStarredRepo\|RepoRow\|LibraryRow\|StarredRepoRow" src/env.d.ts` to enumerate them; update each in place.

- [ ] **Step 2: Update `electron/preload.ts`**

Find every inline type import like `import('./providers/github').GitHubRepo` and replace with `import('../src/types/repo').Repo` (or the corresponding new shape).

Run: `git grep -n "import('.\\/providers\\/github')\\." electron/preload.ts`

Apply the same shape-mapping as Step 1.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: errors. Many renderer files now mismatch (they consume snake_case but the type declaration says camelCase). These errors are exactly what Tasks 6–13 will fix. The error count is the migration progress indicator.

- [ ] **Step 4: Commit**

```bash
git add src/env.d.ts electron/preload.ts
git commit -m "refactor(preload): retype window.api.github/library returns as Repo/SavedRepo"
```

---

## Task 5: Wrap IPC handlers with normalizers (atomic boundary translation)

This is the big atomic change. Every IPC handler that returns repo / release / user / starred-entry data wraps its return value through the matching normalizer. After this commit, the IPC layer returns camelCase exclusively. The renderer will be broken until Tasks 6–13 land.

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/ipc/recommendHandlers.ts`
- Modify: `electron/ipc/updateHandlers.ts`
- Modify: `electron/ipc/createHandlers.ts` (only if it returns repo shapes)

- [ ] **Step 1: Import the normalizers in `main.ts`**

Add near the existing `./providers/github/graphql` import:

```ts
import {
  githubRepoToRepo,
  githubReleaseToRelease,
  githubUserToUser,
  githubStarredToStarredEntry,
} from './providers/github/normalize'
import {
  repoRowToSavedRepo,
  libraryRowToLibrarySavedRepo,
} from './repoNormalize'
import type { RepoRow, LibraryRow, StarredRepoRow } from './db-row-types'
```

- [ ] **Step 2: Wrap every github:* handler that returns `GitHubRepo`**

For each of these handlers, change the final `return X` to `return githubRepoToRepo(X)` (or `.map(githubRepoToRepo)` for arrays):

- `github:getRepo` — `return githubRepoToRepo(repo)`
- `github:searchRepos` — `return items.map(githubRepoToRepo)`
- `github:getUser` (returns `GitHubUser`) — `return githubUserToUser(user)` — note: existing code already projects to a custom shape `{ login, avatarUrl, publicRepos }`; just use the helper.
- `github:getStarred` — when reading from the live API, `items.map(githubStarredToStarredEntry)`. When reading from cache rows, see Step 4 below.
- `github:getReleases` — `return releases.map(githubReleaseToRelease)`
- `github:getMyRepos` — `return repos.map(githubRepoToRepo)`
- `github:getRecommended` (in `recommendHandlers.ts`) — `return items.map(githubRepoToRepo)`

Example transformation for `github:getRepo`:

**Before:**
```ts
ipcMain.handle('github:getRepo', async (_event, owner: string, name: string) => {
  ...
  let repo: Awaited<ReturnType<typeof gh.getRepo>>
  try {
    repo = await gh.getRepo(token, owner, name, db)
  } catch {
    return db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) ?? null
  }
  ...
  return repo
})
```

**After:**
```ts
ipcMain.handle('github:getRepo', async (_event, owner: string, name: string) => {
  ...
  let repo: Awaited<ReturnType<typeof gh.getRepo>>
  try {
    repo = await gh.getRepo(token, owner, name, db)
  } catch {
    const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
    return row ? repoRowToSavedRepo(row) : null
  }
  ...
  return githubRepoToRepo(repo)
})
```

(Note: when falling back to a stale DB row, return a `SavedRepo` instead of a raw `RepoRow`.)

- [ ] **Step 3: Wrap every handler that returns DB rows**

These return `RepoRow[]`, `LibraryRow[]`, or `StarredRepoRow[]` today. Add `.map(repoRowToSavedRepo)` (or the library variant):

- `github:getSavedRepos` → `return rows.map(repoRowToSavedRepo)`
- `github:getFeedRepos` → same
- `github:getRelatedRepos` → same
- `library:getAll` (find via `git grep`) → `return rows.map(libraryRowToLibrarySavedRepo)`
- `starred:getAll` → `return rows.map(libraryRowToLibrarySavedRepo)`
- `repos:getAll` / `repos:getOne` if they exist → same

Cast the SQL result to `RepoRow[]` (or `LibraryRow[]`) before mapping, since `better-sqlite3`'s `.all()` returns `unknown[]`.

- [ ] **Step 4: Update the `github:saveRepo` and similar write handlers**

For write handlers, the renderer now sends camelCase. Internally, translate to row via `savedRepoToRow` before SQL, OR re-build the SQL parameter list from the new camelCase keys. Pick whichever is simpler per handler. Most existing handlers already build the params explicitly; just rename the field accesses:
- `repo.stargazers_count` → `r.stars`
- `repo.full_name` → `r.fullName`
- … (apply the field rename map)

For `github:saveRepo` the input was the renderer-side `GitHubRepo`. Now it's `Repo`. Update the SQL upsert to read `r.stars` instead of `repo.stargazers_count`, etc.

- [ ] **Step 5: Update `recommendHandlers.ts` and `updateHandlers.ts`**

Same pattern. Find every `return X` where X is `GitHubRepo[]` or `RepoRow[]` and wrap.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors in `electron/`; many in `src/`. The src/ errors are exactly the migration target for Tasks 6–13.

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts electron/ipc/recommendHandlers.ts electron/ipc/updateHandlers.ts electron/ipc/createHandlers.ts
git commit -m "refactor(ipc): translate IPC handler returns to normalized Repo/SavedRepo"
```

---

## Task 6: Renderer group A — base card components

**Files (apply the field rename map to each):**
- Modify: `src/components/RepoCard.tsx`
- Modify: `src/components/RepoCard.test.tsx`
- Modify: `src/components/RepoListRow.tsx`
- Modify: `src/components/RepoListRow.test.tsx`
- Modify: `src/components/BannerCard.tsx`
- Modify: `src/components/BannerCard.test.tsx`
- Modify: `src/components/ForkRepoCard.tsx`
- Modify: `src/components/ForkRepoCard.test.tsx`
- Modify: `src/components/DiscoverRowRepoCard.tsx`
- Modify: `src/components/DiscoverRow.test.tsx` (uses the cards)
- Modify: `src/components/UpdateModal.tsx` (uses RepoRow extras)

For each file:

- [ ] **Step 1: Change the prop type from `RepoRow` / `GitHubRepo` to `SavedRepo` (or `Repo` if no library extras)**

`RepoCard.tsx` example:

```ts
// before
type Props = { repo: RepoRow; ... }

// after
import type { SavedRepo } from '../types/repo'
type Props = { repo: SavedRepo; ... }
```

- [ ] **Step 2: Apply the field rename map**

Search for every snake_case access in the file and replace per the table at the top of this plan:
- `repo.stargazers_count` → `repo.stars`
- `repo.owner.login` → `repo.owner`
- `repo.owner.avatar_url` → `repo.ownerAvatarUrl`
- `repo.avatar_url` → `repo.ownerAvatarUrl`
- `repo.full_name` → `repo.fullName`
- `repo.default_branch` → `repo.defaultBranch`
- `repo.pushed_at` → `repo.pushedAt`
- … etc, every match.

Use the editor's "Find in file" with case-sensitive snake_case patterns to enumerate.

- [ ] **Step 3: Update the test file's mock data**

Replace any `{ stargazers_count: 100 }`-style fixtures with `{ stars: 100, owner: 'x', ownerAvatarUrl: '…', ... }` matching the new shape. Add required new fields (`hostId: 'gh:api.github.com'`, `hostType: 'github'`, `hostNativeId`, `fullName`).

A minimal fixture factory helps — define once at the top of the test:

```ts
function fixtureSavedRepo(overrides: Partial<SavedRepo> = {}): SavedRepo {
  return {
    hostId: 'gh:api.github.com',
    hostType: 'github',
    hostNativeId: 1,
    fullName: 'octocat/Hello-World',
    owner: 'octocat',
    name: 'Hello-World',
    htmlUrl: 'https://github.com/octocat/Hello-World',
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    ownerAvatarUrl: 'https://x/a.png',
    savedAt: null, starredAt: null, unstarredAt: null,
    discoveredAt: null, discoverQuery: null,
    bannerSvg: null, bannerColor: null, ogImageUrl: null,
    type: null, typeBucket: null, typeSub: null,
    translatedDescription: null, translatedDescriptionLang: null,
    translatedReadme: null, translatedReadmeLang: null, detectedLanguage: null,
    verificationScore: null, verificationTier: null, verificationSignals: null, verificationCheckedAt: null,
    isForked: null, updateAvailable: null, updateCheckedAt: null,
    upstreamVersion: null, storedVersion: null,
    archivedAt: null, forkedAt: null,
    fetchedAt: null, starredCheckedAt: null, storybookUrl: null,
    ...overrides,
  }
}
```

- [ ] **Step 4: Run the test for this group**

Run: `npx vitest run src/components/RepoCard.test.tsx src/components/RepoListRow.test.tsx src/components/BannerCard.test.tsx src/components/ForkRepoCard.test.tsx src/components/DiscoverRow.test.tsx`

Expected: PASS. If a test asserts on a specific snake_case string in rendered output, the component will already be rendering the camelCase value, so the assertion needs updating accordingly.

- [ ] **Step 5: Type-check the touched files**

Run: `npx tsc --noEmit`

Expected: errors should be limited to files NOT yet migrated in later groups. The files modified in this group must show zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoCard.tsx src/components/RepoCard.test.tsx \
        src/components/RepoListRow.tsx src/components/RepoListRow.test.tsx \
        src/components/BannerCard.tsx src/components/BannerCard.test.tsx \
        src/components/ForkRepoCard.tsx src/components/ForkRepoCard.test.tsx \
        src/components/DiscoverRowRepoCard.tsx src/components/DiscoverRow.test.tsx \
        src/components/UpdateModal.tsx
git commit -m "refactor(cards): migrate base card components to Repo/SavedRepo"
```

---

## Task 7: Renderer group B — Discover view

**Files:**
- Modify: `src/views/Discover.tsx`
- Modify: `src/views/Discover.test.tsx` (if exists)
- Modify: `src/components/DiscoverHero.tsx`
- Modify: `src/components/DiscoverHero.test.tsx`
- Modify: `src/components/DiscoverGrid.tsx`
- Modify: `src/components/DiscoverRow.tsx`
- Modify: `src/lib/discoverCache.ts`
- Modify: `src/lib/discoverCache.test.ts`
- Modify: `src/lib/discoverStateStore.ts`

Apply the same procedure as Task 6 (Steps 1–5):
1. Change prop types from `RepoRow` / `GitHubRepo` to `Repo` (Discover rows show *live API* data — no library extras unless they hit local cache).
2. Apply the field rename map across snake_case accesses.
3. Update test fixtures using the `fixtureSavedRepo` factory (copy into the test file or extract to a shared helper at `src/test-utils/repoFixtures.ts`).
4. Run the test suite for the touched files.
5. Type-check.

- [ ] **Step 6: Commit**

```bash
git add src/views/Discover.tsx src/views/Discover.test.tsx \
        src/components/DiscoverHero.tsx src/components/DiscoverHero.test.tsx \
        src/components/DiscoverGrid.tsx src/components/DiscoverRow.tsx \
        src/lib/discoverCache.ts src/lib/discoverCache.test.ts \
        src/lib/discoverStateStore.ts
git commit -m "refactor(discover): migrate Discover view to normalized Repo shape"
```

---

## Task 8: Renderer group C — Library view

**Files:**
- Modify: `src/views/Library.tsx`
- Modify: `src/views/Library.test.tsx`
- Modify: `src/components/LibrarySidebar.tsx`
- Modify: `src/components/LibrarySidebar.test.tsx`
- Modify: `src/components/LibraryCard.tsx`
- Modify: `src/components/LibraryCard.test.tsx`
- Modify: `src/components/LibraryGrid.tsx`
- Modify: `src/components/LibraryGrid.test.tsx`
- Modify: `src/components/LibraryListRow.tsx`
- Modify: `src/components/LibraryFilesDetail.tsx`
- Modify: `src/components/LibraryFilesDetail.test.tsx`
- Modify: `src/views/Starred.tsx`
- Modify: `src/views/CollectionDetail.tsx`
- Modify: `src/views/Collections.tsx`
- Modify: `src/components/CollDetail.tsx`
- Modify: `src/components/NewCollectionModal.tsx`
- Modify: `src/components/GenericDetail.tsx`
- Modify: `src/types/library.ts` (re-export `LibrarySavedRepo`)

Apply Task 6's Steps 1–5 procedure. Most files here use `LibraryRow` / `StarredRepoRow` — replace with `LibrarySavedRepo`.

- [ ] **Step 6: Commit**

```bash
git add src/views/Library.tsx src/views/Library.test.tsx \
        src/components/LibrarySidebar.tsx src/components/LibrarySidebar.test.tsx \
        src/components/LibraryCard.tsx src/components/LibraryCard.test.tsx \
        src/components/LibraryGrid.tsx src/components/LibraryGrid.test.tsx \
        src/components/LibraryListRow.tsx \
        src/components/LibraryFilesDetail.tsx src/components/LibraryFilesDetail.test.tsx \
        src/views/Starred.tsx \
        src/views/CollectionDetail.tsx src/views/Collections.tsx \
        src/components/CollDetail.tsx src/components/NewCollectionModal.tsx \
        src/components/GenericDetail.tsx \
        src/types/library.ts
git commit -m "refactor(library): migrate Library + Starred + Collections to LibrarySavedRepo"
```

---

## Task 9: Renderer group D — Profile + people

**Files:**
- Modify: `src/views/Profile.tsx`
- Modify: `src/views/Profile.test.tsx`
- Modify: `src/components/ProfileOverlay.tsx`
- Modify: `src/components/PersonRow.tsx`

Apply Task 6's Steps 1–5. Profile renders both user info (`User`) and starred repos (`Repo[]`). Replace `GitHubUser` with `User`, `GitHubRepo` with `Repo`.

- [ ] **Step 6: Commit**

```bash
git add src/views/Profile.tsx src/views/Profile.test.tsx \
        src/components/ProfileOverlay.tsx src/components/PersonRow.tsx
git commit -m "refactor(profile): migrate Profile + PersonRow to normalized User + Repo"
```

---

## Task 10: Renderer group E — RepoDetail + content panes

**Files:**
- Modify: `src/views/RepoDetail.tsx`
- Modify: `src/views/RepoDetail.test.tsx`
- Modify: `src/components/FilesTab.tsx`
- Modify: `src/components/FileContentPanel.tsx`
- Modify: `src/components/ReadmeRenderer.tsx`
- Modify: `src/components/ReadmeRenderer.test.tsx`
- Modify: `src/components/CompareSummary.tsx`
- Modify: `src/components/CompareSummary.test.tsx`
- Modify: `src/components/ReleaseModalContent.tsx`
- Modify: `src/components/ReleaseModalContent.test.tsx`
- Modify: `src/components/PullRequestModalContent.tsx`
- Modify: `src/components/PullRequestModalContent.test.tsx`
- Modify: `src/components/RepoStatsSidebar.tsx` (if it uses repo fields)
- Modify: `src/components/files/DirectoryPane.tsx`
- Modify: `src/components/files/DirectoryPane.test.tsx`
- Modify: `src/lib/fileTree/model.ts`
- Modify: `src/lib/fileTree/model.test.ts`
- Modify: `src/lib/fileTree/flatten.ts`
- Modify: `src/lib/fileTree/flatten.test.ts`
- Modify: `src/lib/fileTree/types.ts`
- Modify: `src/components/files/fileViewers.tsx`

Apply Task 6's Steps 1–5. ReadmeRenderer reads `repo.html_url` for relative-URL resolution → `repo.htmlUrl`. Release modals read `release.tag_name` → `release.tagName`, `release.published_at` → `release.publishedAt`.

- [ ] **Step 6: Commit**

```bash
git add src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx \
        src/components/FilesTab.tsx src/components/FileContentPanel.tsx \
        src/components/ReadmeRenderer.tsx src/components/ReadmeRenderer.test.tsx \
        src/components/CompareSummary.tsx src/components/CompareSummary.test.tsx \
        src/components/ReleaseModalContent.tsx src/components/ReleaseModalContent.test.tsx \
        src/components/PullRequestModalContent.tsx src/components/PullRequestModalContent.test.tsx \
        src/components/RepoStatsSidebar.tsx \
        src/components/files/DirectoryPane.tsx src/components/files/DirectoryPane.test.tsx \
        src/lib/fileTree/model.ts src/lib/fileTree/model.test.ts \
        src/lib/fileTree/flatten.ts src/lib/fileTree/flatten.test.ts \
        src/lib/fileTree/types.ts \
        src/components/files/fileViewers.tsx
git commit -m "refactor(repo-detail): migrate RepoDetail + content panes to Repo/Release"
```

---

## Task 11: Renderer group F — Activity feed

**Files:**
- Modify: `src/components/ActivityEvent.tsx`
- Modify: `src/components/ActivityEvent.test.tsx`
- Modify: `src/components/ActivityModal.tsx`
- Modify: `src/components/ActivityModal.test.tsx`
- Modify: `src/components/ActivityFeed.test.tsx`
- Modify: `src/components/StarEventCard.tsx`
- Modify: `src/components/StarEventCard.test.tsx`
- Modify: `src/components/ForkEventCard.tsx`
- Modify: `src/components/ForkEventCard.test.tsx`
- Modify: `src/utils/groupEventsByDay.test.ts`
- Modify: `src/utils/groupRepoActivityByDay.test.ts`
- Modify: `src/hooks/useFeed.ts`
- Modify: `src/hooks/useForkData.ts`

Apply Task 6's Steps 1–5. Events have their own shape (`GitHubEvent`) — if no normalized `Event` shape yet exists, keep events on the snake-case API shape for now (since events aren't in the spec's normalized scope) but ensure repo references inside events are translated.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActivityEvent.tsx src/components/ActivityEvent.test.tsx \
        src/components/ActivityModal.tsx src/components/ActivityModal.test.tsx \
        src/components/ActivityFeed.test.tsx \
        src/components/StarEventCard.tsx src/components/StarEventCard.test.tsx \
        src/components/ForkEventCard.tsx src/components/ForkEventCard.test.tsx \
        src/utils/groupEventsByDay.test.ts src/utils/groupRepoActivityByDay.test.ts \
        src/hooks/useFeed.ts src/hooks/useForkData.ts
git commit -m "refactor(activity): migrate Activity feed components to Repo shape"
```

---

## Task 12: Renderer group G — components, utilities, stragglers

**Files:**
- Modify: `src/components/ComponentDetail.tsx`
- Modify: `src/components/ComponentExplorer.tsx`
- Modify: `src/components/ComponentDetailView.tsx`
- Modify: `src/components/MCPToolsDetail.tsx`
- Modify: `src/components/MCPToolsDetail.test.tsx`
- Modify: `src/components/NotInstalledDetail.tsx`
- Modify: `src/components/create/TemplateGallery.tsx`
- Modify: `src/components/create/RepoBrowser.tsx`
- Modify: `src/components/create/CreateMetaBar.tsx`
- Modify: `src/components/RepoContextMenu.tsx`
- Modify: `src/components/CloneOptionsPanel.tsx`
- Modify: `src/components/CloneOptionsPanel.test.tsx`
- Modify: `src/components/ImportPluginDialog.tsx`
- Modify: `src/components/ImportPluginDialog.test.tsx`
- Modify: `src/components/GitHubLoginPrompt.tsx`
- Modify: `src/contexts/GitHubAuth.tsx`
- Modify: `src/contexts/SavedRepos.tsx`
- Modify: `src/utils/githubRepoFetcher.ts`
- Modify: `src/utils/githubRepoFetcher.test.ts`
- Modify: `src/utils/githubRepoUrl.ts`
- Modify: `src/utils/githubRepoUrl.test.ts`
- Modify: `src/lib/recentVisits.ts`
- Modify: `src/lib/recentVisits.test.ts`
- Modify: `src/lib/classifyRepoType.ts`
- Modify: `src/lib/classifyRepoType.test.ts`
- Modify: `src/types/recommendation.ts`

Apply Task 6's Steps 1–5. `src/contexts/GitHubAuth.tsx` already uses a custom shape — just rename its `GitHubUser` import to `User`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ComponentDetail.tsx src/components/ComponentExplorer.tsx \
        src/components/ComponentDetailView.tsx \
        src/components/MCPToolsDetail.tsx src/components/MCPToolsDetail.test.tsx \
        src/components/NotInstalledDetail.tsx \
        src/components/create/TemplateGallery.tsx src/components/create/RepoBrowser.tsx \
        src/components/create/CreateMetaBar.tsx \
        src/components/RepoContextMenu.tsx \
        src/components/CloneOptionsPanel.tsx src/components/CloneOptionsPanel.test.tsx \
        src/components/ImportPluginDialog.tsx src/components/ImportPluginDialog.test.tsx \
        src/components/GitHubLoginPrompt.tsx \
        src/contexts/GitHubAuth.tsx src/contexts/SavedRepos.tsx \
        src/utils/githubRepoFetcher.ts src/utils/githubRepoFetcher.test.ts \
        src/utils/githubRepoUrl.ts src/utils/githubRepoUrl.test.ts \
        src/lib/recentVisits.ts src/lib/recentVisits.test.ts \
        src/lib/classifyRepoType.ts src/lib/classifyRepoType.test.ts \
        src/types/recommendation.ts
git commit -m "refactor(misc): migrate remaining renderer files to normalized Repo"
```

---

## Task 13: Delete legacy shapes from `src/`

**Files:**
- Modify: `src/types/repo.ts`
- Modify: `src/types/library.ts`

- [ ] **Step 1: Confirm no remaining consumers**

Run:

```bash
git grep -nE "\b(RepoRow|LibraryRow|StarredRepoRow|ReleaseRow|GitHubRepo|GitHubRelease|GitHubUser|GitHubStarredRepo)\b" -- src/
```

Expected: only the type definitions themselves remain (in `src/types/repo.ts`, `src/types/library.ts`). If any consumer remains, return to the appropriate group task.

- [ ] **Step 2: Delete the `@deprecated` legacy interfaces**

In `src/types/repo.ts`, remove:
- `RepoRow`
- `LibraryRow`
- `StarredRepoRow`
- `ReleaseRow`
- `ReleaseAsset` (the old one — keep the new camelCase one)
- The deprecated `parseTopics` (no longer needed; topics arrive as `string[]` now)
- The duplicate `formatStars` if any

Keep: `Repo`, `SavedRepo`, `LibrarySavedRepo`, `Release`, `ReleaseAsset` (new), `User`, `StarredEntry`, `formatStars`, `CollectionRow`, `CollectionRepoRow`, `SkillRow`, `SubSkillRow`, all anatomy types.

In `src/types/library.ts`, drop the `LibraryRow` re-export; re-export `LibrarySavedRepo` instead.

- [ ] **Step 3: Confirm renderer types no longer reference the GitHub provider snake_case shapes**

Run:

```bash
git grep -nE "import.*from.*['\"]electron/providers/github" -- src/
```

Expected: only `import type { HostType }` from `electron/providers/types` (used by `src/types/repo.ts` for the discriminator). No other crossings.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/repo.ts src/types/library.ts
git commit -m "refactor(types): delete legacy RepoRow / GitHubRepo / ReleaseRow from renderer"
```

---

## Task 14: Final verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 2: Confirm no snake_case repo fields remain in renderer code**

Run:

```bash
git grep -nE "\.(stargazers_count|forks_count|watchers_count|open_issues_count|full_name|html_url|default_branch|pushed_at|created_at|avatar_url|owner\.login|owner\.avatar_url|starred_at|saved_at|unstarred_at|fetched_at|starred_checked_at|type_bucket|type_sub|verification_score|update_available|update_checked_at|upstream_version|stored_version)\b" -- src/
```

Expected: zero matches. (Any remaining match is either a string literal — fine — or a missed migration — fix it.)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS — pre-existing src/ failures from before Phase 2 (BannerCard text drift, jsdom missing `requestIdleCallback`) may need test fixtures regenerated, since the BannerCard etc. now render different fields. Update assertions to match the camelCase pipeline.

- [ ] **Step 4: Build the production bundle**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 5: Smoke test the dev app**

Run: `npm run dev`

Smoke checklist:
- Discover rows render with the normalized data.
- Library shows saved repos (DB rows round-tripped through `repoRowToSavedRepo`).
- RepoDetail loads README, releases, file tree.
- Star / unstar persists.
- Profile renders followers, following, user repos.

If anything breaks, the gap is in one of the migration tasks — find the un-migrated component and apply the field map.

- [ ] **Step 6: Hand off to the user**

Surface to the user:
- Phase 2 complete. Renderer fully consumes the normalized `Repo` / `SavedRepo` shape.
- `RepoRow` and friends live only inside `electron/db-row-types.ts` now; the renderer never sees snake_case.
- IPC handlers translate at the boundary via `githubRepoToRepo` / `repoRowToSavedRepo`.
- Next: Phase 3 brainstorm/spec would add the parallel `window.api.repo.*` namespace, migrate every renderer call site from `window.api.github.*` to `window.api.repo.*`, and add the `/repo/:hostId/:owner/:name` route.
