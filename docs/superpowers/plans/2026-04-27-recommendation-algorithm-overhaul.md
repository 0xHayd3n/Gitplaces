# Recommendation Algorithm Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-pass content-based recommender with a modular signal pipeline (six signals, MMR diversity rerank, broader candidate generation, implicit-click engagement) per [the design spec](../specs/2026-04-27-recommendation-algorithm-overhaul-design.md).

**Architecture:** Refactor [recommendationEngine.ts](../../../electron/services/recommendationEngine.ts) into a thin orchestrator. Each scoring concern becomes its own module under `electron/services/signals/`. New `diversityReranker.ts` and `engagementTracker.ts`. Broader `recommendationFetcher.ts` query plan. New `engagement_events` SQLite table + IPC + one Discover.tsx call site.

**Tech Stack:** TypeScript, Electron, better-sqlite3, vitest, React.

---

## Build & test commands

- **Typecheck (full project):** `npm run typecheck` (or `tsc --noEmit`)
- **Run a single test file:** `npx vitest run path/to/file.test.ts`
- **Run a single test by name:** `npx vitest run path/to/file.test.ts -t "test name"`
- **Run all tests:** `npx vitest run`

Each task's "expected" output assumes a clean working tree before the task begins.

---

## File map

### New files
| Path | Purpose |
|---|---|
| `electron/services/signals/topicSignal.ts` | Topic-affinity scorer |
| `electron/services/signals/topicSignal.test.ts` | Unit tests |
| `electron/services/signals/descriptionStopwords.ts` | Stopword list constant |
| `electron/services/signals/descriptionSignal.ts` | Description TF-IDF scorer + tokenizer + profile builder |
| `electron/services/signals/descriptionSignal.test.ts` | Unit tests |
| `electron/services/signals/categorySignal.ts` | Bucket / subType / language scorer |
| `electron/services/signals/categorySignal.test.ts` | Unit tests |
| `electron/services/signals/scaleSignal.ts` | Star-scale scorer (gem-friendly) |
| `electron/services/signals/scaleSignal.test.ts` | Unit tests |
| `electron/services/signals/freshnessSignal.ts` | `pushed_at` decay scorer |
| `electron/services/signals/freshnessSignal.test.ts` | Unit tests |
| `electron/services/signals/engagementSignal.ts` | Click-history scorer |
| `electron/services/signals/engagementSignal.test.ts` | Unit tests |
| `electron/services/userProfile.ts` | `buildUserProfile` coordinator |
| `electron/services/userProfile.test.ts` | Unit tests |
| `electron/services/corpusStats.ts` | `computeCorpusStats` (replaces `computeTopicStats`) |
| `electron/services/corpusStats.test.ts` | Unit tests |
| `electron/services/diversityReranker.ts` | MMR rerank + similarity helper |
| `electron/services/diversityReranker.test.ts` | Unit tests |
| `electron/services/engagementTracker.ts` | DB-backed click events |
| `electron/services/engagementTracker.test.ts` | Unit tests |
| `electron/ipc/engagementHandlers.ts` | Registers `engagement:logClick` |
| `electron/ipc/engagementHandlers.test.ts` | Unit tests |

### Modified files
| Path | Change |
|---|---|
| `src/types/recommendation.ts` | Add `CorpusStats`, `EngagementProfile`; extend `UserProfile`, `ScoreBreakdown`, `QueryPlan`. Keep `TopicStats` as deprecated alias during transition. |
| `electron/github.ts` | Add `archived: boolean` to `GitHubRepo` interface. |
| `electron/db.ts` | Add `engagement_events` table + indexes. |
| `electron/preload.ts` | Expose `engagement.logClick` to renderer. |
| `electron/main.ts` | Register `engagementHandlers`. |
| `electron/services/recommendationEngine.ts` | Rewrite as thin orchestrator. Remove old `scoreCandidate`, `computeTopicStats`, etc. |
| `electron/services/recommendationEngine.test.ts` | Rewrite as integration tests for orchestrator. |
| `electron/services/recommendationFetcher.ts` | New `planQueries` with 5 query kinds; `QueryPlan.kind` discriminator. |
| `electron/services/recommendationFetcher.test.ts` | Add tests for each new query kind + dedup. |
| `electron/ipc/recommendHandlers.ts` | New profile-hash inputs, engagement loading, prune scheduling, call new orchestrator. |
| `electron/ipc/recommendHandlers.test.ts` | Update mocks for new module shapes. |
| `src/views/Discover.tsx` | One added `engagement.logClick` call inside `navigateToRepo`. |
| `src/views/Discover.test.tsx` | Mock `window.api.engagement`; assert `logClick` is called from recommended view. |
| `src/env.d.ts` | Add `engagement` to the `Window['api']` type. |

---

## Task ordering principle

Bottom-up. Types and infrastructure land first so subsequent tasks don't break the build. The orchestrator (Task 16) is the cutover where the new pipeline replaces the old. Each task ends with a green test suite and a commit.

---

## Task 1: Extend recommendation types

**Files:**
- Modify: `src/types/recommendation.ts`
- Modify: `electron/services/recommendationEngine.ts` (only to keep build green by populating empty defaults for new fields)

**Goal:** Land all new type shapes. Keep existing engine compiling by emitting empty defaults for new `UserProfile` fields. No behavior change yet.

- [ ] **Step 1: Read current types**

Read [src/types/recommendation.ts](../../../src/types/recommendation.ts) end-to-end (76 lines) and the consumers in [electron/services/recommendationEngine.ts](../../../electron/services/recommendationEngine.ts) and [electron/ipc/recommendHandlers.ts](../../../electron/ipc/recommendHandlers.ts).

- [ ] **Step 2: Replace `src/types/recommendation.ts`**

```ts
// src/types/recommendation.ts
import type { RepoRow } from './repo'

/** Document-frequency + IDF stats for both topics and description tokens, computed in one DB sweep. */
export interface CorpusStats {
  topicDocFrequency: Map<string, number>
  topicIdf: Map<string, number>
  descriptionDocFrequency: Map<string, number>
  descriptionIdf: Map<string, number>
  totalRepos: number
}

/** @deprecated Use CorpusStats. Retained as alias during the transition. Remove in cleanup task. */
export type TopicStats = {
  docFrequency: Map<string, number>
  totalRepos: number
  idf: Map<string, number>
}

export interface EngagementProfile {
  /** Topics from clicked repos, recency-decayed (30-day half-life), normalized sum=1. */
  clickedTopicAffinity: Map<string, number>
  /** Owners likewise. */
  clickedOwnerAffinity: Map<string, number>
  /** Repo IDs the user has clicked recently — filtered out of recommendations. */
  clickedRepoIds: Set<string>
  /** Total clicks in the window (90 days). */
  clickCount: number
}

export interface UserProfile {
  topicAffinity: Map<string, number>
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
  starScale: { median: number; p25: number; p75: number }
  anchorPool: RepoRow[]
  repoCount: number

  /** TF-IDF tokens from descriptions of the user's stars/saved, normalized sum=1. */
  descriptionAffinity: Map<string, number>
  /** Median age (days) of user's starred repos by `pushed_at`; informs adaptive freshness half-life. */
  freshnessPreference: number
  /** Click-derived signals + filter set. */
  engagement: EngagementProfile
}

export interface ScoreBreakdown {
  topic: number
  description: number
  bucket: number
  subType: number
  language: number
  scale: number
  freshness: number
  engagement: number
}

export interface Anchor {
  owner: string
  name: string
  avatar_url: string | null
  reasons: string[]
  similarity: number
}

export interface RecommendationItem {
  repo: RepoRow
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}

export interface RecommendationResponse {
  items: RecommendationItem[]
  stale: boolean
  coldStart: boolean
}
```

- [ ] **Step 3: Patch all `UserProfile` and `ScoreBreakdown` construction sites with zero/empty defaults**

Extending the type in Step 2 will fail typecheck at every site that constructs a `UserProfile` or `ScoreBreakdown` literal. These are the sites at HEAD (verified by grep) — patch all of them inline:

**a) `electron/services/recommendationEngine.ts`** — locate `buildUserProfile`'s return block and append the new fields:

```ts
  return {
    topicAffinity,
    bucketDistribution: normalizeMap(bucketRaw),
    subTypeDistribution: normalizeMap(subRaw),
    languageWeights: normalizeMap(langRaw),
    starScale,
    anchorPool,
    repoCount: userRepos.length,
    // Stub fields populated in later tasks; engine.ts is rewritten in Task 16.
    descriptionAffinity: new Map(),
    freshnessPreference: 365,
    engagement: {
      clickedTopicAffinity: new Map(),
      clickedOwnerAffinity: new Map(),
      clickedRepoIds: new Set(),
      clickCount: 0,
    },
  }
```

Update `scoreCandidate`'s return to include the three new `ScoreBreakdown` fields:

```ts
  return {
    score,
    breakdown: { topic, bucket, subType, language, scale, description: 0, freshness: 0, engagement: 0 },
  }
```

**b) `electron/services/recommendationFetcher.test.ts:15`** — `emptyProfile()` returns `UserProfile`. Add the three new fields to its literal:

```ts
function emptyProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    topicAffinity: new Map(),
    bucketDistribution: new Map(),
    subTypeDistribution: new Map(),
    languageWeights: new Map(),
    starScale: { median: 100, p25: 50, p75: 200 },
    anchorPool: [],
    repoCount: 0,
    descriptionAffinity: new Map(),
    freshnessPreference: 365,
    engagement: {
      clickedTopicAffinity: new Map(),
      clickedOwnerAffinity: new Map(),
      clickedRepoIds: new Set(),
      clickCount: 0,
    },
    ...overrides,
  }
}
```

**c) `electron/services/recommendationEngine.test.ts:190`** — same `emptyProfile()` helper. Apply the identical patch (it's a copy of the same shape).

**d) `electron/ipc/recommendHandlers.ts`** — find the cold-start `RecommendationItem` literal (search for `scoreBreakdown: { topic: 0, bucket: 0`). Extend it:

```ts
        scoreBreakdown: { topic: 0, description: 0, bucket: 0, subType: 0, language: 0, scale: 0, freshness: 0, engagement: 0 },
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. (If a site you missed shows up as a literal-with-missing-field error, patch it inline with the same zero/empty defaults; the deprecated `TopicStats` alias keeps remaining old-shape mocks green.)

- [ ] **Step 5: Run existing tests to confirm no behaviour regression**

Run: `npx vitest run electron/services/recommendationEngine.test.ts electron/services/recommendationFetcher.test.ts electron/ipc/recommendHandlers.test.ts`
Expected: PASS. Tests don't read the new fields, only the type shape.

- [ ] **Step 6: Commit**

```bash
git add src/types/recommendation.ts electron/services/recommendationEngine.ts electron/services/recommendationFetcher.test.ts electron/services/recommendationEngine.test.ts electron/ipc/recommendHandlers.ts
git commit -m "feat(reco): extend types for description/freshness/engagement signals"
```

---

## Task 2: Add `archived` field to `GitHubRepo`

**Files:**
- Modify: `electron/github.ts`

**Goal:** Surface the `archived` boolean from the GitHub API response so the freshness signal can zero archived repos.

- [ ] **Step 1: Read current `GitHubRepo` interface**

[electron/github.ts:18-37](../../../electron/github.ts:18) — locate the interface block.

- [ ] **Step 2: Add `archived: boolean` field**

Add the field after `default_branch`:

```ts
export interface GitHubRepo {
  // ...existing fields...
  default_branch: string
  archived: boolean
}
```

The GitHub Search REST API includes `archived` in every repo object, so no fetch changes are needed.

- [ ] **Step 3: Patch any test fixtures that construct `GitHubRepo`**

Run: `npm run typecheck`

For each failing site that constructs a strict `GitHubRepo` literal, add `archived: false`. The known site at HEAD is the test fixture in `electron/ipc/recommendHandlers.test.ts` (look around lines 60–90 for `function ghRepo` or similar). Fetcher and engine test helpers use `as GitHubRepo` casts so they don't need patching.

Expected after patching: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/github.ts electron/ipc/recommendHandlers.test.ts
git commit -m "feat(reco): expose archived flag on GitHubRepo"
```

(If your typecheck flagged additional files, include them in the `git add`.)

---

## Task 3: Add `engagement_events` table

**Files:**
- Modify: `electron/db.ts`

**Goal:** Persist click events. Additive schema change, idempotent.

- [ ] **Step 1: Add table + indexes to `initSchema`**

Append to the `db.exec(...)` block in [electron/db.ts](../../../electron/db.ts) (after the `ai_chats` table, before the trailing post-migration index block):

```sql
    CREATE TABLE IF NOT EXISTS engagement_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id     TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      source      TEXT NOT NULL,
      ts          INTEGER NOT NULL
    );
```

Add to the post-migration index block:

```sql
    CREATE INDEX IF NOT EXISTS idx_engagement_ts   ON engagement_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_engagement_repo ON engagement_events(repo_id);
```

- [ ] **Step 2: Run any DB migration tests**

Run: `npx vitest run electron/db.mcp-migration.test.ts`
Expected: PASS (additive change).

- [ ] **Step 3: Commit**

```bash
git add electron/db.ts
git commit -m "feat(reco): add engagement_events table"
```

---

## Task 4: Implement `engagementTracker.ts`

**Files:**
- Create: `electron/services/engagementTracker.ts`
- Create: `electron/services/engagementTracker.test.ts`

**Goal:** Wrap DB access for engagement events. Pure SQL behind named functions. Tested with in-memory better-sqlite3.

- [ ] **Step 1: Write failing tests**

Create `electron/services/engagementTracker.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { logClick, getRecentClicks, pruneOldEvents } from './engagementTracker'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE engagement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `)
  return db
}

describe('engagementTracker', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('logClick writes a row with current timestamp', () => {
    const before = Date.now()
    logClick(db, 'repo-1', 'recommended')
    const after = Date.now()
    const row = db.prepare('SELECT * FROM engagement_events').get() as any
    expect(row.repo_id).toBe('repo-1')
    expect(row.event_type).toBe('click')
    expect(row.source).toBe('recommended')
    expect(row.ts).toBeGreaterThanOrEqual(before)
    expect(row.ts).toBeLessThanOrEqual(after)
  })

  it('getRecentClicks returns rows newer than sinceMs, sorted by ts desc', () => {
    const now = Date.now()
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('old', 'click', 'recommended', now - 100_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('mid', 'click', 'recommended', now - 50_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('new', 'click', 'recommended', now - 10_000)
    const rows = getRecentClicks(db, now - 75_000)
    expect(rows.map(r => r.repo_id)).toEqual(['new', 'mid'])
  })

  it('getRecentClicks respects limit', () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
        .run(`r${i}`, 'click', 'recommended', now - i * 1000)
    }
    expect(getRecentClicks(db, 0, 3).length).toBe(3)
  })

  it('pruneOldEvents removes rows older than threshold', () => {
    const now = Date.now()
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('old', 'click', 'recommended', now - 200_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('new', 'click', 'recommended', now - 10_000)
    pruneOldEvents(db, now - 100_000)
    const remaining = db.prepare('SELECT repo_id FROM engagement_events').all() as { repo_id: string }[]
    expect(remaining.map(r => r.repo_id)).toEqual(['new'])
  })
})
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npx vitest run electron/services/engagementTracker.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `engagementTracker.ts`**

```ts
// electron/services/engagementTracker.ts
import type Database from 'better-sqlite3'

export interface EngagementRow {
  id: number
  repo_id: string
  event_type: string
  source: string
  ts: number
}

export function logClick(db: Database.Database, repoId: string, source: string): void {
  db.prepare(
    'INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)'
  ).run(repoId, 'click', source, Date.now())
}

export function getRecentClicks(
  db: Database.Database,
  sinceMs: number,
  limit = 500,
): EngagementRow[] {
  return db.prepare(
    'SELECT * FROM engagement_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?'
  ).all(sinceMs, limit) as EngagementRow[]
}

export function pruneOldEvents(db: Database.Database, olderThanMs: number): void {
  db.prepare('DELETE FROM engagement_events WHERE ts < ?').run(olderThanMs)
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `npx vitest run electron/services/engagementTracker.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add electron/services/engagementTracker.ts electron/services/engagementTracker.test.ts
git commit -m "feat(reco): engagement tracker (logClick / getRecentClicks / pruneOldEvents)"
```

---

## Task 5: Wire engagement IPC + renderer call

**Files:**
- Create: `electron/ipc/engagementHandlers.ts`
- Create: `electron/ipc/engagementHandlers.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`
- Modify: `src/views/Discover.tsx`
- Modify: `src/views/Discover.test.tsx`

**Goal:** Click events flow renderer → IPC → tracker → DB.

- [ ] **Step 1: Write failing test for the handler**

Create `electron/ipc/engagementHandlers.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: mockHandle },
}))

const mockLogClick = vi.fn()
vi.mock('../services/engagementTracker', () => ({
  logClick: mockLogClick,
}))

vi.mock('../db', () => ({
  getDb: vi.fn().mockReturnValue({}),
}))

describe('registerEngagementHandlers', () => {
  beforeEach(() => {
    mockHandle.mockReset()
    mockLogClick.mockReset()
  })

  it('registers engagement:logClick and forwards arguments to logClick', async () => {
    const { registerEngagementHandlers } = await import('./engagementHandlers')
    registerEngagementHandlers()
    expect(mockHandle).toHaveBeenCalledWith('engagement:logClick', expect.any(Function))
    const handler = mockHandle.mock.calls[0][1]
    handler({}, 'repo-42', 'recommended')
    expect(mockLogClick).toHaveBeenCalledWith({}, 'repo-42', 'recommended')
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/ipc/engagementHandlers.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create `engagementHandlers.ts`**

```ts
// electron/ipc/engagementHandlers.ts
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { logClick } from '../services/engagementTracker'

export function registerEngagementHandlers(): void {
  ipcMain.handle('engagement:logClick', (_event, repoId: string, source: string) => {
    logClick(getDb(app.getPath('userData')), repoId, source)
  })
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/ipc/engagementHandlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `main.ts`**

Find the block in [electron/main.ts](../../../electron/main.ts) where other handler registrations live (search for `registerRecommendHandlers` or similar). Add the import and call:

```ts
import { registerEngagementHandlers } from './ipc/engagementHandlers'
// ... near other registrations:
registerEngagementHandlers()
```

- [ ] **Step 6: Expose to renderer in `preload.ts`**

Find the `contextBridge.exposeInMainWorld` block in [electron/preload.ts](../../../electron/preload.ts). Add an `engagement` key to the exposed `api` object:

```ts
engagement: {
  logClick: (repoId: string, source: string) =>
    ipcRenderer.invoke('engagement:logClick', repoId, source),
},
```

- [ ] **Step 7: Add type to `src/env.d.ts`**

Find the `Window['api']` declaration in [src/env.d.ts](../../../src/env.d.ts). Add an `engagement` member:

```ts
engagement: {
  logClick: (repoId: string, source: string) => Promise<void>
}
```

- [ ] **Step 8: Wire the call site in `Discover.tsx`**

Open [src/views/Discover.tsx](../../../src/views/Discover.tsx). Find the `navigateToRepo` callback (search for `function navigateToRepo` or `const navigateToRepo = useCallback`). The current body looks like:

```ts
const navigateToRepo = useCallback((path: string) => {
  const snap = liveSnapshotRef.current
  if (snap) saveDiscoverSnapshot({ ...snap, scrollTop: scrollRef.current?.scrollTop ?? 0 })
  const match = path.match(/^\/repo\/([^/]+)\/([^/]+)/)
  const repo = snap?.repos && match ? snap.repos.find(r => r.owner === match[1] && r.name === match[2]) : null
  navigate(path, { state: { ... } })
}, [navigate, location.pathname, location.search])
```

Add the engagement call after `repo` is resolved, before `navigate(...)`:

```ts
if (repo?.id) {
  window.api.engagement.logClick(repo.id, viewMode === 'recommended' ? 'recommended' : 'discover')
    .catch(() => { /* non-critical */ })
}
```

- [ ] **Step 9: Add Discover test for the call**

Open [src/views/Discover.test.tsx](../../../src/views/Discover.test.tsx). Wherever the test file mocks `window.api`, add an `engagement` mock:

```ts
window.api = {
  // ...existing mocks...
  engagement: { logClick: vi.fn().mockResolvedValue(undefined) },
} as any
```

**Important:** the recommended-view fixture (the one returned by the mocked `getRecommended`) must include an `id` field on each repo, since `navigateToRepo` guards `if (repo?.id)`. If the existing fixture omits `id`, add one (e.g. `id: '12345'`); the assertion below depends on it.

Then add a new test (placed near other navigation tests):

```ts
it('logs an engagement click when navigating to a repo from the recommended view', async () => {
  // Setup: render Discover with viewMode=recommended and at least one repo loaded.
  // Existing helpers in this file probably already do this — copy the pattern.
  // After clicking a repo card:
  // expect(window.api.engagement.logClick).toHaveBeenCalledWith('<repoId>', 'recommended')
})
```

If the test file already has navigation tests, copy the surrounding pattern. If the call signature differs, adapt — the assertion is the only thing that matters here.

- [ ] **Step 10: Run all relevant tests**

Run: `npx vitest run electron/ipc/engagementHandlers.test.ts src/views/Discover.test.tsx`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add electron/ipc/engagementHandlers.ts electron/ipc/engagementHandlers.test.ts electron/main.ts electron/preload.ts src/env.d.ts src/views/Discover.tsx src/views/Discover.test.tsx
git commit -m "feat(reco): wire engagement.logClick IPC + renderer call site"
```

---

## Task 6: `signals/topicSignal.ts`

**Files:**
- Create: `electron/services/signals/topicSignal.ts`
- Create: `electron/services/signals/topicSignal.test.ts`

**Goal:** Extract topic-affinity scoring + profile-builder helper from existing `recommendationEngine.ts` into its own module. Math unchanged.

- [ ] **Step 1: Write failing tests**

Create `electron/services/signals/topicSignal.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildTopicAffinity, scoreTopic } from './topicSignal'
import type { CorpusStats } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

function emptyCorpus(): CorpusStats {
  return {
    topicDocFrequency: new Map(),
    topicIdf: new Map(),
    descriptionDocFrequency: new Map(),
    descriptionIdf: new Map(),
    totalRepos: 0,
  }
}

describe('buildTopicAffinity', () => {
  it('returns empty map for empty repos', () => {
    expect(buildTopicAffinity([], emptyCorpus(), NOW).size).toBe(0)
  })

  it('weights topics by recency-decayed IDF and normalizes to sum=1', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 1], ['python', 2]]),
      totalRepos: 200, // above IDF_FALLBACK_THRESHOLD
    }
    const repos = [
      { topics: JSON.stringify(['rust']),   starred_at: new Date(NOW).toISOString() },
      { topics: JSON.stringify(['python']), starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    const total = [...aff.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
    // python has higher IDF, so higher weight
    expect(aff.get('python')!).toBeGreaterThan(aff.get('rust')!)
  })

  it('falls back to flat weighting when corpus < threshold', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 0.01]]),
      totalRepos: 10, // below threshold
    }
    const repos = [
      { topics: JSON.stringify(['rust', 'python']), starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    // Both topics should get equal weight (0.5 each) under flat fallback
    expect(aff.get('rust')).toBeCloseTo(0.5, 5)
    expect(aff.get('python')).toBeCloseTo(0.5, 5)
  })

  it('decays older starred_at by recency half-life', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      topicIdf: new Map([['rust', 1], ['python', 1]]),
      totalRepos: 200,
    }
    const repos = [
      { topics: JSON.stringify(['rust']), starred_at: new Date(NOW).toISOString() },
      { topics: JSON.stringify(['python']), starred_at: new Date(NOW - 90 * DAY).toISOString() },
    ] as any[]
    const aff = buildTopicAffinity(repos, corpus, NOW)
    // python is at 90-day half-life → ~0.5 weight vs rust's 1.0 → after normalize: rust ~0.667, python ~0.333
    expect(aff.get('rust')!).toBeGreaterThan(aff.get('python')!)
    expect(aff.get('python')!).toBeCloseTo(1 / 3, 1)
  })
})

describe('scoreTopic', () => {
  it('returns 0 for empty candidate topics', () => {
    expect(scoreTopic([], new Map([['rust', 0.5]]))).toBe(0)
  })

  it('sums affinities and caps at 1.0', () => {
    const aff = new Map([['rust', 0.4], ['python', 0.3], ['ai', 0.2]])
    expect(scoreTopic(['rust'], aff)).toBeCloseTo(0.4, 5)
    expect(scoreTopic(['rust', 'python'], aff)).toBeCloseTo(0.7, 5)
    // Suppose two topics summed to >1
    const big = new Map([['a', 0.8], ['b', 0.7]])
    expect(scoreTopic(['a', 'b'], big)).toBe(1)
  })

  it('ignores unknown topics', () => {
    expect(scoreTopic(['unknown'], new Map([['rust', 0.5]]))).toBe(0)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/signals/topicSignal.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `topicSignal.ts`**

```ts
// electron/services/signals/topicSignal.ts
import type { CorpusStats } from '../../../src/types/recommendation'

const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000
const IDF_FALLBACK_THRESHOLD = 100

interface RepoLike {
  topics: string | null
  starred_at: string | null
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

function recencyWeight(starredAt: string | null, now: number): number {
  if (!starredAt) return 1.0
  const ageMs = now - new Date(starredAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS)
}

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

export function buildTopicAffinity(
  userRepos: RepoLike[],
  corpus: CorpusStats,
  now: number,
): Map<string, number> {
  const useIdf = corpus.totalRepos >= IDF_FALLBACK_THRESHOLD
  const raw = new Map<string, number>()
  for (const r of userRepos) {
    const w = recencyWeight(r.starred_at, now)
    for (const t of safeParseTopics(r.topics)) {
      const idfWeight = useIdf ? (corpus.topicIdf.get(t) ?? 0) : 1
      if (useIdf && idfWeight <= 0) continue
      raw.set(t, (raw.get(t) ?? 0) + w * idfWeight)
    }
  }
  return normalize(raw)
}

export function scoreTopic(candidateTopics: string[], affinity: Map<string, number>): number {
  let total = 0
  for (const t of candidateTopics) {
    total += affinity.get(t) ?? 0
  }
  return Math.min(1.0, total)
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `npx vitest run electron/services/signals/topicSignal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/signals/topicSignal.ts electron/services/signals/topicSignal.test.ts
git commit -m "feat(reco): topicSignal module (extracted)"
```

---

## Task 7: `signals/descriptionSignal.ts`

**Files:**
- Create: `electron/services/signals/descriptionStopwords.ts`
- Create: `electron/services/signals/descriptionSignal.ts`
- Create: `electron/services/signals/descriptionSignal.test.ts`

**Goal:** Description tokenization, TF-IDF profile builder, candidate scorer.

- [ ] **Step 1: Create the stopword list**

`electron/services/signals/descriptionStopwords.ts`:

```ts
// Curated English + dev-noise stopwords. Treat as fixed for v1; tuning is a follow-up pass.
export const STOPWORDS = new Set<string>([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with',
  'this', 'that', 'from', 'have', 'they', 'will', 'would', 'there', 'their', 'what', 'about',
  'which', 'when', 'make', 'like', 'into', 'time', 'than', 'first', 'been', 'call', 'find',
  'long', 'down', 'come', 'made', 'part', 'over', 'such', 'take', 'only', 'know', 'look',
  'also', 'back', 'after', 'work', 'because', 'some', 'most', 'these', 'them', 'were', 'been',
  'being', 'does', 'each', 'just', 'more', 'much', 'must', 'other', 'same', 'used', 'very',
  'where', 'while', 'your', 'yours',
  // Dev noise (low discriminating power in repo descriptions)
  'tool', 'tools', 'app', 'apps', 'application', 'applications', 'library', 'libraries',
  'framework', 'frameworks', 'project', 'projects', 'code', 'simple', 'easy', 'fast',
  'lightweight', 'modern', 'awesome', 'best', 'small', 'minimal', 'clean', 'free', 'open',
  'source', 'using', 'made', 'built', 'build', 'support', 'supports', 'feature', 'features',
  'help', 'helps', 'helper', 'helpers', 'make', 'makes', 'making', 'create', 'creates',
  'creating', 'used', 'use', 'uses', 'using', 'works', 'work', 'working', 'based',
])
```

- [ ] **Step 2: Write failing tests**

`electron/services/signals/descriptionSignal.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  tokenizeDescription,
  buildDescriptionAffinity,
  scoreDescription,
} from './descriptionSignal'
import type { CorpusStats } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)

function emptyCorpus(): CorpusStats {
  return {
    topicDocFrequency: new Map(),
    topicIdf: new Map(),
    descriptionDocFrequency: new Map(),
    descriptionIdf: new Map(),
    totalRepos: 0,
  }
}

describe('tokenizeDescription', () => {
  it('lowercases and splits on non-word', () => {
    expect(tokenizeDescription('Rust CLI for Image Processing!')).toEqual(['rust', 'cli', 'image', 'processing'])
  })
  it('drops short tokens', () => {
    expect(tokenizeDescription('go a it cli')).toEqual(['cli'])
  })
  it('drops stopwords', () => {
    expect(tokenizeDescription('a tool for parsing yaml')).toEqual(['parsing', 'yaml'])
  })
  it('handles null/empty', () => {
    expect(tokenizeDescription(null)).toEqual([])
    expect(tokenizeDescription('')).toEqual([])
  })
  it('caps at 50 tokens', () => {
    const long = Array.from({ length: 100 }, (_, i) => `token${i}`).join(' ')
    expect(tokenizeDescription(long).length).toBe(50)
  })
})

describe('buildDescriptionAffinity', () => {
  it('returns empty map for repos with no descriptions', () => {
    const repos = [{ description: null, starred_at: null }] as any[]
    expect(buildDescriptionAffinity(repos, emptyCorpus(), NOW).size).toBe(0)
  })
  it('weights tokens by IDF and normalizes to sum=1', () => {
    const corpus: CorpusStats = {
      ...emptyCorpus(),
      descriptionIdf: new Map([['rust', 1], ['parser', 2]]),
      totalRepos: 200,
    }
    const repos = [
      { description: 'rust parser', starred_at: new Date(NOW).toISOString() },
    ] as any[]
    const aff = buildDescriptionAffinity(repos, corpus, NOW)
    const total = [...aff.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(aff.get('parser')!).toBeGreaterThan(aff.get('rust')!)
  })
})

describe('scoreDescription', () => {
  it('returns 0 for empty token list', () => {
    expect(scoreDescription([], new Map([['rust', 0.5]]))).toBe(0)
  })
  it('sums affinities, caps at 1', () => {
    const aff = new Map([['rust', 0.6], ['parser', 0.5]])
    expect(scoreDescription(['rust', 'parser'], aff)).toBe(1)
  })
})
```

- [ ] **Step 3: Run; expect failure**

Run: `npx vitest run electron/services/signals/descriptionSignal.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `descriptionSignal.ts`**

```ts
// electron/services/signals/descriptionSignal.ts
import { STOPWORDS } from './descriptionStopwords'
import type { CorpusStats } from '../../../src/types/recommendation'

const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000
const IDF_FALLBACK_THRESHOLD = 100
const MAX_TOKENS_PER_REPO = 50
const MIN_TOKEN_LEN = 3

interface RepoLike {
  description: string | null
  starred_at: string | null
}

function recencyWeight(starredAt: string | null, now: number): number {
  if (!starredAt) return 1.0
  const ageMs = now - new Date(starredAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS)
}

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

export function tokenizeDescription(desc: string | null): string[] {
  if (!desc) return []
  const tokens: string[] = []
  for (const raw of desc.toLowerCase().split(/\W+/)) {
    if (raw.length < MIN_TOKEN_LEN) continue
    if (STOPWORDS.has(raw)) continue
    tokens.push(raw)
    if (tokens.length >= MAX_TOKENS_PER_REPO) break
  }
  return tokens
}

export function buildDescriptionAffinity(
  userRepos: RepoLike[],
  corpus: CorpusStats,
  now: number,
): Map<string, number> {
  const useIdf = corpus.totalRepos >= IDF_FALLBACK_THRESHOLD
  const raw = new Map<string, number>()
  for (const r of userRepos) {
    const w = recencyWeight(r.starred_at, now)
    const seen = new Set<string>()
    for (const tok of tokenizeDescription(r.description)) {
      if (seen.has(tok)) continue
      seen.add(tok)
      const idfWeight = useIdf ? (corpus.descriptionIdf.get(tok) ?? 0) : 1
      if (useIdf && idfWeight <= 0) continue
      raw.set(tok, (raw.get(tok) ?? 0) + w * idfWeight)
    }
  }
  return normalize(raw)
}

export function scoreDescription(
  candidateTokens: string[],
  affinity: Map<string, number>,
): number {
  let total = 0
  const seen = new Set<string>()
  for (const tok of candidateTokens) {
    if (seen.has(tok)) continue
    seen.add(tok)
    total += affinity.get(tok) ?? 0
  }
  return Math.min(1.0, total)
}
```

- [ ] **Step 5: Run tests; expect pass**

Run: `npx vitest run electron/services/signals/descriptionSignal.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/signals/descriptionStopwords.ts electron/services/signals/descriptionSignal.ts electron/services/signals/descriptionSignal.test.ts
git commit -m "feat(reco): descriptionSignal module (TF-IDF over descriptions)"
```

---

## Task 8: `signals/categorySignal.ts`

**Files:**
- Create: `electron/services/signals/categorySignal.ts`
- Create: `electron/services/signals/categorySignal.test.ts`

**Goal:** Bucket / subType / language scoring as a single signal with three sub-fields.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreCategory } from './categorySignal'

describe('scoreCategory', () => {
  const profile = {
    bucketDistribution:  new Map([['ai-ml', 0.6], ['dev-tools', 0.4]]),
    subTypeDistribution: new Map([['ai-coding', 0.5]]),
    languageWeights:     new Map([['Python', 0.7]]),
  }

  it('reads each distribution', () => {
    expect(scoreCategory({ type_bucket: 'ai-ml', type_sub: 'ai-coding', language: 'Python' }, profile))
      .toEqual({ bucket: 0.6, subType: 0.5, language: 0.7 })
  })

  it('returns 0 for missing fields on candidate', () => {
    expect(scoreCategory({ type_bucket: null, type_sub: null, language: null }, profile))
      .toEqual({ bucket: 0, subType: 0, language: 0 })
  })

  it('returns 0 for unknown values', () => {
    expect(scoreCategory({ type_bucket: 'unknown', type_sub: 'unknown', language: 'Cobol' }, profile))
      .toEqual({ bucket: 0, subType: 0, language: 0 })
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/signals/categorySignal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/signals/categorySignal.ts

interface CategoryCandidate {
  type_bucket: string | null
  type_sub: string | null
  language: string | null
}

interface CategoryProfile {
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
}

export interface CategoryScore {
  bucket: number
  subType: number
  language: number
}

export function scoreCategory(
  candidate: CategoryCandidate,
  profile: CategoryProfile,
): CategoryScore {
  return {
    bucket:   candidate.type_bucket ? (profile.bucketDistribution.get(candidate.type_bucket) ?? 0) : 0,
    subType:  candidate.type_sub    ? (profile.subTypeDistribution.get(candidate.type_sub) ?? 0)   : 0,
    language: candidate.language    ? (profile.languageWeights.get(candidate.language) ?? 0)        : 0,
  }
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/signals/categorySignal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/signals/categorySignal.ts electron/services/signals/categorySignal.test.ts
git commit -m "feat(reco): categorySignal module"
```

---

## Task 9: `signals/scaleSignal.ts`

**Files:**
- Create: `electron/services/signals/scaleSignal.ts`
- Create: `electron/services/signals/scaleSignal.test.ts`

**Goal:** Gem-friendly star-scale matching.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreScale } from './scaleSignal'

describe('scoreScale', () => {
  it('exact match → 1.0', () => {
    expect(scoreScale(100, 100)).toBeCloseTo(1, 2)
  })
  it('above median: capped at 0.5 floor', () => {
    expect(scoreScale(10_000_000, 100)).toBeGreaterThanOrEqual(0.5)
  })
  it('below median: gem floor of 0.4', () => {
    expect(scoreScale(50, 50_000)).toBeGreaterThanOrEqual(0.4)
  })
  it('zero median treats candidate stars as ratio anchor', () => {
    // log10(0+1)=0; with median=0, identical → 1.0
    expect(scoreScale(0, 0)).toBeCloseTo(1, 2)
  })
  it('1 order of magnitude above median', () => {
    // log10(1001) - log10(101) ≈ 0.997
    // score above: 1 - 0.997/2 ≈ 0.50; floor kicks in
    expect(scoreScale(1000, 100)).toBeGreaterThanOrEqual(0.5)
  })
  it('1 order of magnitude below median', () => {
    // medianLog - candidateLog ≈ 1
    // score = max(0.4, 1 - 1/3) ≈ 0.667
    expect(scoreScale(10, 100)).toBeCloseTo(0.667, 2)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/signals/scaleSignal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/signals/scaleSignal.ts

export function scoreScale(candidateStars: number, medianStars: number): number {
  const candidateLog = Math.log10(candidateStars + 1)
  const medianLog    = Math.log10(medianStars + 1)
  if (candidateLog >= medianLog) {
    return Math.max(0.5, 1 - (candidateLog - medianLog) / 2)
  }
  return Math.max(0.4, 1 - (medianLog - candidateLog) / 3)
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/signals/scaleSignal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/signals/scaleSignal.ts electron/services/signals/scaleSignal.test.ts
git commit -m "feat(reco): scaleSignal with gem-friendly floor"
```

---

## Task 10: `signals/freshnessSignal.ts`

**Files:**
- Create: `electron/services/signals/freshnessSignal.ts`
- Create: `electron/services/signals/freshnessSignal.test.ts`

**Goal:** Freshness from `pushed_at` with adaptive half-life and archived → 0.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreFreshness, buildFreshnessPreference } from './freshnessSignal'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

describe('scoreFreshness', () => {
  it('archived → 0', () => {
    expect(scoreFreshness({ pushed_at: new Date(NOW).toISOString(), archived: true }, 365, NOW)).toBe(0)
  })
  it('null pushed_at → 0.05 baseline', () => {
    expect(scoreFreshness({ pushed_at: null, archived: false }, 365, NOW)).toBe(0.05)
  })
  it('just pushed → ~1.0', () => {
    expect(scoreFreshness({ pushed_at: new Date(NOW).toISOString(), archived: false }, 365, NOW)).toBeCloseTo(1, 2)
  })
  it('at half-life → ~0.5', () => {
    const halfLife = 365
    const ts = new Date(NOW - halfLife * DAY).toISOString()
    expect(scoreFreshness({ pushed_at: ts, archived: false }, halfLife, NOW)).toBeCloseTo(0.5, 2)
  })
  it('floor of 180 days for half-life', () => {
    // user's freshnessPreference is 30 (very young), but floor is 180
    const ts = new Date(NOW - 180 * DAY).toISOString()
    expect(scoreFreshness({ pushed_at: ts, archived: false }, 30, NOW)).toBeCloseTo(0.5, 2)
  })
})

describe('buildFreshnessPreference', () => {
  it('returns 365 for empty repos', () => {
    expect(buildFreshnessPreference([], NOW)).toBe(365)
  })
  it('returns median age in days from pushed_at', () => {
    const repos = [
      { pushed_at: new Date(NOW - 100 * DAY).toISOString() },
      { pushed_at: new Date(NOW - 200 * DAY).toISOString() },
      { pushed_at: new Date(NOW - 300 * DAY).toISOString() },
    ] as any[]
    expect(buildFreshnessPreference(repos, NOW)).toBe(200)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/signals/freshnessSignal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/signals/freshnessSignal.ts

const DAY_MS = 24 * 60 * 60 * 1000
const HALF_LIFE_FLOOR_DAYS = 180

interface FreshnessCandidate {
  pushed_at: string | null
  archived: boolean
}

interface RepoLike {
  pushed_at: string | null
}

export function scoreFreshness(
  candidate: FreshnessCandidate,
  freshnessPreference: number,
  now: number,
): number {
  if (candidate.archived) return 0
  if (!candidate.pushed_at) return 0.05
  const ageDays = (now - new Date(candidate.pushed_at).getTime()) / DAY_MS
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1
  const halfLife = Math.max(HALF_LIFE_FLOOR_DAYS, freshnessPreference)
  return Math.pow(0.5, ageDays / halfLife)
}

export function buildFreshnessPreference(userRepos: RepoLike[], now: number): number {
  const ages: number[] = []
  for (const r of userRepos) {
    if (!r.pushed_at) continue
    const days = (now - new Date(r.pushed_at).getTime()) / DAY_MS
    if (Number.isFinite(days) && days >= 0) ages.push(days)
  }
  if (ages.length === 0) return 365
  ages.sort((a, b) => a - b)
  return ages[Math.floor((ages.length - 1) / 2)]
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/signals/freshnessSignal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/signals/freshnessSignal.ts electron/services/signals/freshnessSignal.test.ts
git commit -m "feat(reco): freshnessSignal with adaptive half-life"
```

---

## Task 11: `signals/engagementSignal.ts`

**Files:**
- Create: `electron/services/signals/engagementSignal.ts`
- Create: `electron/services/signals/engagementSignal.test.ts`

**Goal:** Compute engagement score from clicked-topic and clicked-owner affinities; build profile from click events.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildEngagementProfile, scoreEngagement } from './engagementSignal'
import type { EngagementProfile } from '../../../src/types/recommendation'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

const empty: EngagementProfile = {
  clickedTopicAffinity: new Map(),
  clickedOwnerAffinity: new Map(),
  clickedRepoIds: new Set(),
  clickCount: 0,
}

describe('scoreEngagement', () => {
  it('returns 0 when clickCount is 0', () => {
    expect(scoreEngagement({ topics: ['rust'], owner: 'tokio-rs' }, empty)).toBe(0)
  })
  it('combines topic match (70%) + owner match (30%)', () => {
    const profile: EngagementProfile = {
      clickedTopicAffinity: new Map([['rust', 0.5]]),
      clickedOwnerAffinity: new Map([['tokio-rs', 0.5]]),
      clickedRepoIds: new Set(),
      clickCount: 5,
    }
    // 0.7 * 0.5 + 0.3 * 0.5 = 0.5
    expect(scoreEngagement({ topics: ['rust'], owner: 'tokio-rs' }, profile)).toBeCloseTo(0.5, 5)
  })
  it('caps at 1', () => {
    const profile: EngagementProfile = {
      clickedTopicAffinity: new Map([['rust', 1], ['cli', 1]]),
      clickedOwnerAffinity: new Map([['x', 1]]),
      clickedRepoIds: new Set(),
      clickCount: 5,
    }
    expect(scoreEngagement({ topics: ['rust', 'cli'], owner: 'x' }, profile)).toBe(1)
  })
})

describe('buildEngagementProfile', () => {
  it('returns empty profile when no events', () => {
    const p = buildEngagementProfile([], new Map(), NOW)
    expect(p.clickCount).toBe(0)
    expect(p.clickedTopicAffinity.size).toBe(0)
  })

  it('aggregates topics + owners with 30-day half-life decay, normalizes to sum=1', () => {
    const events = [
      { repo_id: 'r1', ts: NOW },
      { repo_id: 'r2', ts: NOW - 30 * DAY },
    ] as any[]
    const repos = new Map<string, any>([
      ['r1', { topics: JSON.stringify(['rust']), owner: 'a' }],
      ['r2', { topics: JSON.stringify(['python']), owner: 'b' }],
    ])
    const p = buildEngagementProfile(events, repos, NOW)
    expect(p.clickCount).toBe(2)
    // r2 at half-life → weight 0.5 vs r1's 1.0 → normalized: rust 0.667, python 0.333
    expect(p.clickedTopicAffinity.get('rust')!).toBeCloseTo(2 / 3, 1)
    expect(p.clickedTopicAffinity.get('python')!).toBeCloseTo(1 / 3, 1)
    expect(p.clickedRepoIds.has('r1')).toBe(true)
    expect(p.clickedRepoIds.has('r2')).toBe(true)
  })

  it('skips events with unknown repo_id', () => {
    const events = [{ repo_id: 'unknown', ts: NOW }] as any[]
    const p = buildEngagementProfile(events, new Map(), NOW)
    expect(p.clickCount).toBe(1)              // event count is the raw count
    expect(p.clickedTopicAffinity.size).toBe(0)
    expect(p.clickedRepoIds.has('unknown')).toBe(true)  // still filtered from recommendations
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/signals/engagementSignal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/signals/engagementSignal.ts
import type { EngagementProfile } from '../../../src/types/recommendation'
import type { EngagementRow } from '../engagementTracker'

const CLICK_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

interface RepoLike {
  topics: string | null
  owner: string
}

interface EngagementCandidate {
  topics: string[]
  owner: string
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

function recencyWeight(ts: number, now: number): number {
  const ageMs = now - ts
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / CLICK_HALF_LIFE_MS)
}

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

export function buildEngagementProfile(
  events: EngagementRow[],
  reposById: Map<string, RepoLike>,
  now: number,
): EngagementProfile {
  const topicRaw = new Map<string, number>()
  const ownerRaw = new Map<string, number>()
  const clickedRepoIds = new Set<string>()

  for (const ev of events) {
    clickedRepoIds.add(ev.repo_id)
    const repo = reposById.get(ev.repo_id)
    if (!repo) continue
    const w = recencyWeight(ev.ts, now)
    for (const t of safeParseTopics(repo.topics)) {
      topicRaw.set(t, (topicRaw.get(t) ?? 0) + w)
    }
    ownerRaw.set(repo.owner, (ownerRaw.get(repo.owner) ?? 0) + w)
  }

  return {
    clickedTopicAffinity: normalize(topicRaw),
    clickedOwnerAffinity: normalize(ownerRaw),
    clickedRepoIds,
    clickCount: events.length,
  }
}

export function scoreEngagement(
  candidate: EngagementCandidate,
  profile: EngagementProfile,
): number {
  if (profile.clickCount === 0) return 0
  let topicMatch = 0
  for (const t of candidate.topics) {
    topicMatch += profile.clickedTopicAffinity.get(t) ?? 0
  }
  const ownerMatch = profile.clickedOwnerAffinity.get(candidate.owner) ?? 0
  return Math.min(1, 0.7 * topicMatch + 0.3 * ownerMatch)
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/signals/engagementSignal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/signals/engagementSignal.ts electron/services/signals/engagementSignal.test.ts
git commit -m "feat(reco): engagementSignal module"
```

---

## Task 12: `corpusStats.ts`

**Files:**
- Create: `electron/services/corpusStats.ts`
- Create: `electron/services/corpusStats.test.ts`

**Goal:** Single-sweep computation of topic + description IDF.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeCorpusStats } from './corpusStats'

function repo(topics: string[], description: string | null = null) {
  return { topics: JSON.stringify(topics), description }
}

describe('computeCorpusStats', () => {
  it('returns zeros for empty input', () => {
    const s = computeCorpusStats([])
    expect(s.totalRepos).toBe(0)
    expect(s.topicIdf.size).toBe(0)
    expect(s.descriptionIdf.size).toBe(0)
  })

  it('counts topic doc-frequency', () => {
    const s = computeCorpusStats([repo(['rust', 'cli']), repo(['rust']), repo(['python'])])
    expect(s.topicDocFrequency.get('rust')).toBe(2)
    expect(s.topicDocFrequency.get('cli')).toBe(1)
    expect(s.totalRepos).toBe(3)
  })

  it('computes topic IDF as log(N / (1 + df))', () => {
    const s = computeCorpusStats([repo(['rust']), repo(['rust']), repo(['rust']), repo(['python'])])
    expect(s.topicIdf.get('rust')).toBeCloseTo(0, 5)            // log(4/4)=0
    expect(s.topicIdf.get('python')).toBeCloseTo(Math.log(2), 5)
  })

  it('counts description doc-frequency using tokenizer', () => {
    const s = computeCorpusStats([
      repo([], 'rust parser library'),
      repo([], 'rust cli'),
      repo([], 'python parser'),
    ])
    expect(s.descriptionDocFrequency.get('rust')).toBe(2)
    expect(s.descriptionDocFrequency.get('parser')).toBe(2)
    expect(s.descriptionDocFrequency.get('library')).toBeUndefined() // stopword
  })

  it('skips null descriptions', () => {
    const s = computeCorpusStats([repo(['rust'], null), repo(['rust'], 'rust thing')])
    expect(s.descriptionDocFrequency.get('rust')).toBe(1)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/corpusStats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/corpusStats.ts
import type { CorpusStats } from '../../src/types/recommendation'
import { tokenizeDescription } from './signals/descriptionSignal'

interface RepoLike {
  topics: string | null
  description: string | null
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function computeCorpusStats(repos: RepoLike[]): CorpusStats {
  const topicDocFrequency = new Map<string, number>()
  const descriptionDocFrequency = new Map<string, number>()

  for (const r of repos) {
    const topics = new Set(safeParseTopics(r.topics))
    for (const t of topics) {
      topicDocFrequency.set(t, (topicDocFrequency.get(t) ?? 0) + 1)
    }
    const tokens = new Set(tokenizeDescription(r.description))
    for (const tok of tokens) {
      descriptionDocFrequency.set(tok, (descriptionDocFrequency.get(tok) ?? 0) + 1)
    }
  }

  const totalRepos = repos.length
  const topicIdf = new Map<string, number>()
  for (const [t, df] of topicDocFrequency) {
    topicIdf.set(t, Math.log(totalRepos / (1 + df)))
  }
  const descriptionIdf = new Map<string, number>()
  for (const [t, df] of descriptionDocFrequency) {
    descriptionIdf.set(t, Math.log(totalRepos / (1 + df)))
  }

  return { topicDocFrequency, topicIdf, descriptionDocFrequency, descriptionIdf, totalRepos }
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/corpusStats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/corpusStats.ts electron/services/corpusStats.test.ts
git commit -m "feat(reco): corpusStats — single-sweep topic + description IDF"
```

---

## Task 13: `userProfile.ts`

**Files:**
- Create: `electron/services/userProfile.ts`
- Create: `electron/services/userProfile.test.ts`

**Goal:** Compose per-signal profile builders into a single `UserProfile`.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildUserProfile } from './userProfile'
import { computeCorpusStats } from './corpusStats'

const NOW = Date.UTC(2026, 3, 15)

function makeRepo(overrides: any = {}) {
  return {
    id: 'x', owner: 'o', name: 'n',
    description: null, language: null, topics: '[]', stars: 100,
    starred_at: null, saved_at: null, pushed_at: null,
    type_bucket: null, type_sub: null,
    ...overrides,
  }
}

describe('buildUserProfile', () => {
  it('produces all required UserProfile fields', () => {
    const userRepos = [makeRepo({ topics: JSON.stringify(['rust']), description: 'rust parser', language: 'Rust', type_bucket: 'dev-tools', type_sub: 'cli', starred_at: new Date(NOW).toISOString(), pushed_at: new Date(NOW - 30*86400000).toISOString() })]
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({
      userRepos: userRepos as any,
      corpus,
      engagementEvents: [],
      clickedReposById: new Map(),
      now: NOW,
    })
    expect(profile.topicAffinity).toBeInstanceOf(Map)
    expect(profile.descriptionAffinity).toBeInstanceOf(Map)
    expect(profile.bucketDistribution).toBeInstanceOf(Map)
    expect(profile.subTypeDistribution).toBeInstanceOf(Map)
    expect(profile.languageWeights).toBeInstanceOf(Map)
    expect(profile.starScale.median).toBe(100)
    expect(profile.anchorPool.length).toBe(1)
    expect(profile.repoCount).toBe(1)
    expect(profile.freshnessPreference).toBeGreaterThan(0)
    expect(profile.engagement.clickCount).toBe(0)
  })

  it('integrates engagement events into profile.engagement', () => {
    const userRepos = [makeRepo({ topics: JSON.stringify(['rust']) })]
    const corpus = computeCorpusStats(userRepos)
    const events = [{ id: 1, repo_id: 'r1', event_type: 'click', source: 'recommended', ts: NOW }]
    const clickedRepos = new Map([['r1', { topics: JSON.stringify(['ai']), owner: 'openai' }]])
    const profile = buildUserProfile({
      userRepos: userRepos as any,
      corpus,
      engagementEvents: events,
      clickedReposById: clickedRepos,
      now: NOW,
    })
    expect(profile.engagement.clickCount).toBe(1)
    expect(profile.engagement.clickedTopicAffinity.get('ai')).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/userProfile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/userProfile.ts
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import type { RepoRow } from '../../src/types/repo'
import type { EngagementRow } from './engagementTracker'
import { buildTopicAffinity } from './signals/topicSignal'
import { buildDescriptionAffinity } from './signals/descriptionSignal'
import { buildFreshnessPreference } from './signals/freshnessSignal'
import { buildEngagementProfile } from './signals/engagementSignal'

const ANCHOR_POOL_SIZE = 20

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  return sortedAsc[Math.floor((sortedAsc.length - 1) * p)]
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

function signalRichness(r: RepoRow): number {
  let score = 0
  if (safeParseTopics(r.topics).length > 0) score += 1
  if (r.type_bucket) score += 1
  if (r.type_sub) score += 1
  if (r.language) score += 0.5
  return score
}

interface ClickedRepo {
  topics: string | null
  owner: string
}

export function buildUserProfile(params: {
  userRepos: RepoRow[]
  corpus: CorpusStats
  engagementEvents: EngagementRow[]
  clickedReposById: Map<string, ClickedRepo>
  now?: number
}): UserProfile {
  const { userRepos, corpus, engagementEvents, clickedReposById } = params
  const now = params.now ?? Date.now()

  const topicAffinity = buildTopicAffinity(userRepos, corpus, now)
  const descriptionAffinity = buildDescriptionAffinity(userRepos, corpus, now)

  const bucketRaw = new Map<string, number>()
  const subRaw = new Map<string, number>()
  const langRaw = new Map<string, number>()
  for (const r of userRepos) {
    if (r.type_bucket) bucketRaw.set(r.type_bucket, (bucketRaw.get(r.type_bucket) ?? 0) + 1)
    if (r.type_sub) subRaw.set(r.type_sub, (subRaw.get(r.type_sub) ?? 0) + 1)
    if (r.language) langRaw.set(r.language, (langRaw.get(r.language) ?? 0) + 1)
  }

  const starCounts = userRepos.map((r) => r.stars ?? 0).sort((a, b) => a - b)
  const starScale = {
    median: percentile(starCounts, 0.5),
    p25:    percentile(starCounts, 0.25),
    p75:    percentile(starCounts, 0.75),
  }

  const anchorPool = [...userRepos]
    .sort((a, b) => {
      const ta = a.starred_at ? new Date(a.starred_at).getTime() : 0
      const tb = b.starred_at ? new Date(b.starred_at).getTime() : 0
      if (tb !== ta) return tb - ta
      return signalRichness(b) - signalRichness(a)
    })
    .slice(0, ANCHOR_POOL_SIZE)

  return {
    topicAffinity,
    descriptionAffinity,
    bucketDistribution: normalize(bucketRaw),
    subTypeDistribution: normalize(subRaw),
    languageWeights: normalize(langRaw),
    starScale,
    anchorPool,
    repoCount: userRepos.length,
    freshnessPreference: buildFreshnessPreference(userRepos, now),
    engagement: buildEngagementProfile(engagementEvents, clickedReposById, now),
  }
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/userProfile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/userProfile.ts electron/services/userProfile.test.ts
git commit -m "feat(reco): userProfile coordinator"
```

---

## Task 14: `diversityReranker.ts`

**Files:**
- Create: `electron/services/diversityReranker.ts`
- Create: `electron/services/diversityReranker.test.ts`

**Goal:** MMR rerank with similarity helper.

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mmrRerank, repoSimilarity } from './diversityReranker'

interface Item {
  score: number
  repo: { id: string; topics: string[]; bucket: string | null; sub: string | null; language: string | null }
}

function item(id: string, score: number, topics: string[] = [], bucket: string | null = null, sub: string | null = null, language: string | null = null): Item {
  return { score, repo: { id, topics, bucket, sub, language } }
}

describe('repoSimilarity', () => {
  it('identical repos → 1.0', () => {
    const a = { topics: ['rust', 'cli'], bucket: 'dev-tools', sub: 'cli', language: 'Rust' }
    expect(repoSimilarity(a, a)).toBeCloseTo(1, 5)
  })
  it('disjoint → 0', () => {
    const a = { topics: ['rust'], bucket: 'a', sub: 'a1', language: 'Rust' }
    const b = { topics: ['python'], bucket: 'b', sub: 'b1', language: 'Python' }
    expect(repoSimilarity(a, b)).toBe(0)
  })
  it('partial topic overlap', () => {
    const a = { topics: ['rust', 'cli'], bucket: null, sub: null, language: null }
    const b = { topics: ['rust', 'web'], bucket: null, sub: null, language: null }
    // jaccard = 1/3 ≈ 0.333; * 0.5 ≈ 0.167
    expect(repoSimilarity(a, b)).toBeCloseTo(0.167, 2)
  })
})

describe('mmrRerank', () => {
  it('first pick is the top-scored item', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.8, ['python']),
      item('c', 0.5, ['ai']),
    ]
    const result = mmrRerank(items, { topK: 3, lambda: 0.7 })
    expect(result[0].repo.id).toBe('a')
  })

  it('λ=1 → pure relevance order', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.8, ['rust']),
      item('c', 0.5, ['rust']),
    ]
    const result = mmrRerank(items, { topK: 3, lambda: 1 })
    expect(result.map(r => r.repo.id)).toEqual(['a', 'b', 'c'])
  })

  it('λ=0.7 prefers diverse second pick', () => {
    const items = [
      item('a', 0.9, ['rust']),
      item('b', 0.85, ['rust']),                  // very similar to a, slightly lower score
      item('c', 0.7,  ['python', 'web']),         // diverse, lower score
    ]
    const result = mmrRerank(items, { topK: 2, lambda: 0.5 })
    expect(result[0].repo.id).toBe('a')
    expect(result[1].repo.id).toBe('c')
  })

  it('respects topK', () => {
    const items = [item('a', 0.9), item('b', 0.8), item('c', 0.7)]
    const result = mmrRerank(items, { topK: 2, lambda: 0.7 })
    expect(result.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/diversityReranker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// electron/services/diversityReranker.ts

interface SimRepo {
  topics: string[]
  bucket: string | null
  sub: string | null
  language: string | null
}

export function repoSimilarity(a: SimRepo, b: SimRepo): number {
  const setA = new Set(a.topics)
  const setB = new Set(b.topics)
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  const jaccard = union === 0 ? 0 : intersection / union

  let score = jaccard * 0.5
  if (a.bucket && a.bucket === b.bucket) score += 0.25
  if (a.sub    && a.sub    === b.sub)    score += 0.20
  if (a.language && a.language === b.language) score += 0.05
  return score
}

interface RerankItem {
  score: number
  repo: SimRepo & { id: string }
}

export interface MmrOptions {
  topK: number
  lambda: number
}

export function mmrRerank<T extends RerankItem>(items: T[], opts: MmrOptions): T[] {
  const remaining = [...items]
  const selected: T[] = []
  const lambda = opts.lambda

  while (remaining.length > 0 && selected.length < opts.topK) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      let maxSim = 0
      for (const s of selected) {
        const sim = repoSimilarity(cand.repo, s.repo)
        if (sim > maxSim) maxSim = sim
      }
      const mmrScore = lambda * cand.score - (1 - lambda) * maxSim
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i }
    }
    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}
```

- [ ] **Step 4: Run; expect pass**

Run: `npx vitest run electron/services/diversityReranker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/diversityReranker.ts electron/services/diversityReranker.test.ts
git commit -m "feat(reco): MMR diversity reranker"
```

---

## Task 15: Refactor `recommendationFetcher.ts`

**Files:**
- Modify: `electron/services/recommendationFetcher.ts`
- Modify: `electron/services/recommendationFetcher.test.ts`

**Goal:** Replace the 5-single-topic plan with the 5-kind plan from spec §7.

- [ ] **Step 1: Read existing fetcher and tests**

[recommendationFetcher.ts](../../../electron/services/recommendationFetcher.ts) (53 lines), [recommendationFetcher.test.ts](../../../electron/services/recommendationFetcher.test.ts).

- [ ] **Step 2: Write failing tests**

Add the following test groups to `recommendationFetcher.test.ts` (alongside any existing tests; don't delete the cold-start coverage):

```ts
import type { UserProfile } from '../../src/types/recommendation'

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    topicAffinity: new Map(),
    bucketDistribution: new Map(),
    subTypeDistribution: new Map(),
    languageWeights: new Map(),
    starScale: { median: 100, p25: 50, p75: 200 },
    anchorPool: [],
    repoCount: 5,
    descriptionAffinity: new Map(),
    freshnessPreference: 365,
    engagement: {
      clickedTopicAffinity: new Map(),
      clickedOwnerAffinity: new Map(),
      clickedRepoIds: new Set(),
      clickCount: 0,
    },
    ...overrides,
  }
}

describe('planQueries (extended)', () => {
  it('emits topic queries for top-4 affinity topics', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4], ['cli', 0.3], ['parser', 0.2], ['async', 0.1], ['extra', 0.05]]),
    })
    const plans = planQueries(profile)
    const topicPlans = plans.filter(p => p.kind === 'topic')
    expect(topicPlans.length).toBe(4)
    expect(topicPlans.map(p => p.topic)).toEqual(['rust', 'cli', 'parser', 'async'])
  })

  it('emits subType queries for top-2 subTypes', () => {
    const profile = makeProfile({
      subTypeDistribution: new Map([['ai-coding', 0.5], ['cli-tool', 0.3], ['extra', 0.2]]),
      topicAffinity: new Map([['x', 1]]),
    })
    const plans = planQueries(profile)
    const subPlans = plans.filter(p => p.kind === 'subType')
    expect(subPlans.length).toBe(2)
  })

  it('emits a language query for #1 language', () => {
    const profile = makeProfile({
      languageWeights: new Map([['Rust', 0.6], ['Python', 0.4]]),
      topicAffinity: new Map([['x', 1]]),
    })
    const plans = planQueries(profile)
    const langPlans = plans.filter(p => p.kind === 'language')
    expect(langPlans.length).toBe(1)
    expect(langPlans[0].topic).toBe('Rust')
  })

  it('skips engagement queries when clickCount < 3', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1]]),
      engagement: {
        clickedTopicAffinity: new Map([['ai', 1]]),
        clickedOwnerAffinity: new Map(),
        clickedRepoIds: new Set(),
        clickCount: 2,
      },
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'engagement').length).toBe(0)
  })

  it('emits engagement queries for top clicked topics not in user-affinity top', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 1]]),
      engagement: {
        clickedTopicAffinity: new Map([['ai', 0.6], ['ml', 0.4]]),
        clickedOwnerAffinity: new Map(),
        clickedRepoIds: new Set(),
        clickCount: 5,
      },
    })
    const plans = planQueries(profile)
    const engagementPlans = plans.filter(p => p.kind === 'engagement')
    expect(engagementPlans.length).toBe(2)
    expect(engagementPlans.map(p => p.topic).sort()).toEqual(['ai', 'ml'])
  })

  it('cold-start when no topic affinity', () => {
    const plans = planQueries(makeProfile())
    expect(plans.length).toBe(1)
    expect(plans[0].coldStart).toBe(true)
    expect(plans[0].kind).toBe('coldStart')
  })
})
```

(Note: pair queries are not tested here because pair detection requires the user's repo list, which `planQueries` doesn't see in this design. Spec §7 says pair affinity uses the user's repos — for v1 we approximate by emitting pairs only when the top-2 topics co-occur in `topicAffinity` with strong values. **Pull this clarification into the implementation:** if top-2 topics each have affinity ≥ 0.15, emit one pair query of those two. Add a test:)

```ts
  it('emits a pair query when top-2 topics both have affinity ≥ 0.15', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.4], ['cli', 0.3], ['extra', 0.05]]),
    })
    const plans = planQueries(profile)
    const pairs = plans.filter(p => p.kind === 'pair')
    expect(pairs.length).toBe(1)
    expect(pairs[0].topic).toBe('rust cli')           // composite key, executor reads it as the search query terms
  })

  it('skips pair query when second topic too weak', () => {
    const profile = makeProfile({
      topicAffinity: new Map([['rust', 0.9], ['cli', 0.05]]),
    })
    const plans = planQueries(profile)
    expect(plans.filter(p => p.kind === 'pair').length).toBe(0)
  })
```

- [ ] **Step 3: Run tests; expect failure**

Run: `npx vitest run electron/services/recommendationFetcher.test.ts`
Expected: FAIL — `planQueries` doesn't return `kind`, doesn't emit subType/language/pair/engagement plans.

- [ ] **Step 4: Replace `recommendationFetcher.ts`**

```ts
// electron/services/recommendationFetcher.ts
import { searchRepos } from '../github'
import type { GitHubRepo } from '../github'
import type { UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'

export interface QueryPlan {
  topic: string
  kind: 'topic' | 'pair' | 'subType' | 'engagement' | 'language' | 'coldStart'
  coldStart: boolean
  perPage: number
  sort: string
}

const TOP_TOPICS_COUNT = 4
const TOP_SUBTYPES_COUNT = 2
const TOP_ENGAGEMENT_TOPICS_COUNT = 2
const ENGAGEMENT_MIN_CLICKS = 3
const PAIR_MIN_AFFINITY = 0.15
const STAR_THRESHOLD = 10
const LANGUAGE_STAR_THRESHOLD = 50
const COLD_START_THRESHOLD = 50000
const COLD_START_RESULTS = 100

export function planQueries(profile: UserProfile): QueryPlan[] {
  const topicEntries = [...profile.topicAffinity.entries()].sort((a, b) => b[1] - a[1])
  if (topicEntries.length === 0) {
    return [{ topic: '', kind: 'coldStart', coldStart: true, perPage: COLD_START_RESULTS, sort: 'stars' }]
  }

  const plans: QueryPlan[] = []

  // Topic queries
  for (const [topic] of topicEntries.slice(0, TOP_TOPICS_COUNT)) {
    plans.push({ topic, kind: 'topic', coldStart: false, perPage: 30, sort: '' })
  }

  // Pair query — top-2 if both ≥ threshold
  if (topicEntries.length >= 2 && topicEntries[1][1] >= PAIR_MIN_AFFINITY) {
    plans.push({
      topic: `${topicEntries[0][0]} ${topicEntries[1][0]}`,
      kind: 'pair',
      coldStart: false,
      perPage: 25,
      sort: '',
    })
  }

  // SubType queries
  const subTypeEntries = [...profile.subTypeDistribution.entries()].sort((a, b) => b[1] - a[1])
  for (const [subTypeId] of subTypeEntries.slice(0, TOP_SUBTYPES_COUNT)) {
    const kw = getSubTypeKeyword(subTypeId)
    if (kw) plans.push({ topic: kw, kind: 'subType', coldStart: false, perPage: 25, sort: '' })
  }

  // Engagement queries (only if enough click data)
  if (profile.engagement.clickCount >= ENGAGEMENT_MIN_CLICKS) {
    const userTopTopics = new Set(topicEntries.slice(0, TOP_TOPICS_COUNT).map(([t]) => t))
    const clickedEntries = [...profile.engagement.clickedTopicAffinity.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([t]) => !userTopTopics.has(t))
      .slice(0, TOP_ENGAGEMENT_TOPICS_COUNT)
    for (const [topic] of clickedEntries) {
      plans.push({ topic, kind: 'engagement', coldStart: false, perPage: 20, sort: '' })
    }
  }

  // Language query — #1 language
  const langEntries = [...profile.languageWeights.entries()].sort((a, b) => b[1] - a[1])
  if (langEntries.length > 0) {
    plans.push({ topic: langEntries[0][0], kind: 'language', coldStart: false, perPage: 25, sort: 'stars' })
  }

  return plans
}

function buildSearchQuery(plan: QueryPlan): string {
  switch (plan.kind) {
    case 'coldStart':
      return `stars:>${COLD_START_THRESHOLD}`
    case 'topic':
    case 'engagement':
      return `topic:${plan.topic} stars:>${STAR_THRESHOLD}`
    case 'pair': {
      const [a, b] = plan.topic.split(' ')
      return `topic:${a} topic:${b} stars:>${STAR_THRESHOLD}`
    }
    case 'subType':
      return `${plan.topic} stars:>${STAR_THRESHOLD}`
    case 'language':
      return `language:${plan.topic} stars:>${LANGUAGE_STAR_THRESHOLD}`
  }
}

export async function fetchCandidates(
  token: string | null,
  queries: QueryPlan[],
): Promise<GitHubRepo[]> {
  const seen = new Set<number>()
  const merged: GitHubRepo[] = []

  const results = await Promise.allSettled(
    queries.map(async (q) => searchRepos(token, buildSearchQuery(q), q.perPage, q.sort, 'desc', 1))
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const repo of r.value) {
        if (!seen.has(repo.id)) {
          seen.add(repo.id)
          merged.push(repo)
        }
      }
    }
  }
  return merged
}
```

- [ ] **Step 5: Run tests; expect pass**

Run: `npx vitest run electron/services/recommendationFetcher.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/recommendationFetcher.ts electron/services/recommendationFetcher.test.ts
git commit -m "feat(reco): broader candidate generation (5 query kinds)"
```

---

## Task 16: Cutover — rewrite `recommendationEngine.ts` as orchestrator

**Files:**
- Modify (rewrite): `electron/services/recommendationEngine.ts`
- Modify (rewrite): `electron/services/recommendationEngine.test.ts`

**Goal:** Replace the existing single-function scorer with a thin orchestrator that composes the new signals and reranker. This is the cutover task — after this, the new pipeline is live.

- [ ] **Step 1: Write failing integration tests**

Replace the contents of `electron/services/recommendationEngine.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { rankCandidates, findAnchors } from './recommendationEngine'
import { computeCorpusStats } from './corpusStats'
import { buildUserProfile } from './userProfile'
import type { GitHubRepo } from '../github'

const NOW = Date.UTC(2026, 3, 15)
const DAY = 24 * 60 * 60 * 1000

function userRepo(o: any) {
  return {
    id: 'u' + o.id, owner: o.owner ?? 'me', name: o.name ?? 'p',
    description: o.description ?? null, language: o.language ?? null,
    topics: JSON.stringify(o.topics ?? []), stars: o.stars ?? 100,
    starred_at: new Date(NOW).toISOString(), saved_at: null,
    pushed_at: new Date(NOW - 30 * DAY).toISOString(),
    type_bucket: o.bucket ?? null, type_sub: o.sub ?? null,
    forks: null, watchers: null, size: null, open_issues: null,
    updated_at: null, created_at: null, license: null, homepage: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    default_branch: 'main', avatar_url: null, og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null,
    verification_signals: null, verification_checked_at: null,
  }
}

function ghRepo(o: any): GitHubRepo {
  return {
    id: o.id, full_name: `${o.owner ?? 'oo'}/${o.name ?? 'rr'}`, name: o.name ?? 'rr',
    owner: { login: o.owner ?? 'oo', avatar_url: '' },
    description: o.description ?? null, language: o.language ?? null,
    topics: o.topics ?? [], stargazers_count: o.stars ?? 100,
    forks_count: 0, watchers_count: 0, open_issues_count: 0, size: 0,
    license: null, homepage: null,
    updated_at: new Date(NOW).toISOString(),
    pushed_at: o.pushed_at ?? new Date(NOW - 10 * DAY).toISOString(),
    created_at: new Date(NOW - 365 * DAY).toISOString(),
    default_branch: 'main', archived: o.archived ?? false,
  }
}

describe('rankCandidates (orchestrator)', () => {
  it('produces complete ScoreBreakdown for each candidate', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'], language: 'Rust', bucket: 'dev-tools', sub: 'cli' })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [ghRepo({ id: 1, topics: ['rust'], language: 'Rust' })]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked.length).toBe(1)
    expect(ranked[0].scoreBreakdown).toMatchObject({
      topic:       expect.any(Number),
      description: expect.any(Number),
      bucket:      expect.any(Number),
      subType:     expect.any(Number),
      language:    expect.any(Number),
      scale:       expect.any(Number),
      freshness:   expect.any(Number),
      engagement:  expect.any(Number),
    })
  })

  it('ranks topic-matching candidate above non-matching', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['unrelated'] }),
      ghRepo({ id: 2, topics: ['rust'] }),
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked[0].repo.id).toBe(2)
  })

  it('archived repos rank below non-archived even with topic match', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['rust'], archived: true }),
      ghRepo({ id: 2, topics: ['rust'], archived: false }),
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    expect(ranked[0].repo.id).toBe(2)
  })

  it('applies MMR rerank — diverse pick beats near-duplicate', () => {
    const userRepos = [userRepo({ id: 1, topics: ['rust', 'cli'] })] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const candidates = [
      ghRepo({ id: 1, topics: ['rust', 'cli'] }),
      ghRepo({ id: 2, topics: ['rust', 'cli'] }),       // near-duplicate of #1
      ghRepo({ id: 3, topics: ['rust', 'web'] }),       // diverse
    ]
    const ranked = rankCandidates(candidates, profile, corpus, NOW)
    // #1 first by score; #3 should appear before #2 due to MMR diversity
    expect(ranked[0].repo.id).toBe(1)
    const id3Pos = ranked.findIndex(r => r.repo.id === 3)
    const id2Pos = ranked.findIndex(r => r.repo.id === 2)
    expect(id3Pos).toBeLessThan(id2Pos)
  })
})

describe('findAnchors', () => {
  it('returns up to 3 anchors sorted by similarity', () => {
    const userRepos = [
      userRepo({ id: 1, owner: 'a', name: 'a1', topics: ['rust', 'cli'] }),
      userRepo({ id: 2, owner: 'b', name: 'b1', topics: ['rust'] }),
    ] as any
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({ userRepos, corpus, engagementEvents: [], clickedReposById: new Map(), now: NOW })
    const cand = { topics: ['rust', 'cli'], type_bucket: null, type_sub: null, language: null, stars: 100, owner: 'x' }
    const anchors = findAnchors(cand, profile, corpus)
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors[0].similarity).toBeGreaterThanOrEqual(anchors[anchors.length - 1].similarity)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npx vitest run electron/services/recommendationEngine.test.ts`
Expected: FAIL — current engine doesn't produce the new ScoreBreakdown shape, has no MMR.

- [ ] **Step 3: Replace `recommendationEngine.ts`**

```ts
// electron/services/recommendationEngine.ts
import type { CorpusStats, UserProfile, ScoreBreakdown, Anchor } from '../../src/types/recommendation'
import type { GitHubRepo } from '../github'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { scoreTopic } from './signals/topicSignal'
import { scoreDescription, tokenizeDescription } from './signals/descriptionSignal'
import { scoreCategory } from './signals/categorySignal'
import { scoreScale } from './signals/scaleSignal'
import { scoreFreshness } from './signals/freshnessSignal'
import { scoreEngagement } from './signals/engagementSignal'
import { mmrRerank } from './diversityReranker'

const WEIGHTS = {
  topic:       0.22,
  description: 0.13,
  subType:     0.20,
  bucket:      0.10,
  language:    0.07,
  scale:       0.05,
  freshness:   0.08,
  engagement:  0.15,
} as const

const RERANK_WINDOW = 200
const TOP_K = 100
const LAMBDA = 0.7

const ANCHOR_THRESHOLD = 0.2
const MAX_ANCHORS = 3

export interface RankedItem {
  repo: GitHubRepo
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}

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
  id: number
}

function toScoringCandidate(repo: GitHubRepo): ScoringCandidate {
  const topics = Array.isArray(repo.topics) ? repo.topics : []
  const classification = classifyRepoBucket({
    name: repo.name,
    description: repo.description ?? null,
    topics: JSON.stringify(topics),
  })
  return {
    topics,
    descriptionTokens: tokenizeDescription(repo.description),
    type_bucket: classification?.bucket ?? null,
    type_sub:    classification?.subType ?? null,
    language:    repo.language ?? null,
    stars:       repo.stargazers_count ?? 0,
    pushed_at:   repo.pushed_at ?? null,
    archived:    repo.archived ?? false,
    owner:       repo.owner.login,
    id:          repo.id,
  }
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function rankCandidates(
  candidates: GitHubRepo[],
  profile: UserProfile,
  corpus: CorpusStats,
  now?: number,
): RankedItem[] {
  const t = now ?? Date.now()

  const scored: RankedItem[] = candidates.map((repo) => {
    const sc = toScoringCandidate(repo)

    const topic       = scoreTopic(sc.topics, profile.topicAffinity)
    const description = scoreDescription(sc.descriptionTokens, profile.descriptionAffinity)
    const cat         = scoreCategory(sc, profile)
    const scale       = scoreScale(sc.stars, profile.starScale.median)
    const freshness   = scoreFreshness({ pushed_at: sc.pushed_at, archived: sc.archived }, profile.freshnessPreference, t)
    const engagement  = scoreEngagement({ topics: sc.topics, owner: sc.owner }, profile.engagement)

    const breakdown: ScoreBreakdown = {
      topic, description,
      bucket: cat.bucket, subType: cat.subType, language: cat.language,
      scale, freshness, engagement,
    }

    const score =
      WEIGHTS.topic       * topic +
      WEIGHTS.description * description +
      WEIGHTS.subType     * cat.subType +
      WEIGHTS.bucket      * cat.bucket +
      WEIGHTS.language    * cat.language +
      WEIGHTS.scale       * scale +
      WEIGHTS.freshness   * freshness +
      WEIGHTS.engagement  * engagement

    const rerankRepo = {
      id: String(repo.id),
      topics: sc.topics,
      bucket: sc.type_bucket,
      sub:    sc.type_sub,
      language: sc.language,
    }

    return {
      repo,
      score,
      scoreBreakdown: breakdown,
      anchors: [],
      primaryAnchor: null,
      // Internal field for reranker — typed via spread cast:
      _rerank: rerankRepo,
    } as RankedItem & { _rerank: typeof rerankRepo }
  })

  scored.sort((a, b) => b.score - a.score)

  // MMR rerank: adapt items to reranker shape
  const window = scored.slice(0, RERANK_WINDOW).map(item => ({
    score: item.score,
    repo: (item as any)._rerank,
    _orig: item,
  }))
  const reranked = mmrRerank(window, { topK: TOP_K, lambda: LAMBDA }).map(r => (r as any)._orig as RankedItem)

  // Anchors computed on reranked output
  for (const item of reranked) {
    const sc = toScoringCandidate(item.repo)
    const anchors = findAnchors(sc, profile, corpus)
    item.anchors = anchors
    item.primaryAnchor = anchors[0] ?? null
  }

  return reranked
}

export function findAnchors(
  candidate: { topics: string[]; type_bucket: string | null; type_sub: string | null; language: string | null },
  profile: UserProfile,
  corpus: CorpusStats,
): Anchor[] {
  const candidateTopics = new Set(candidate.topics)
  const results: Anchor[] = []

  for (const anchor of profile.anchorPool) {
    const anchorTopics = new Set(safeParseTopics(anchor.topics))
    const reasons: string[] = []
    let similarity = 0

    for (const t of anchorTopics) {
      if (candidateTopics.has(t)) {
        similarity += corpus.topicIdf.get(t) ?? 1
        reasons.push(`topic:${t}`)
      }
    }
    if (anchor.type_bucket && anchor.type_bucket === candidate.type_bucket) { similarity += 0.3; reasons.push(`bucket:${anchor.type_bucket}`) }
    if (anchor.type_sub    && anchor.type_sub    === candidate.type_sub)    { similarity += 0.4; reasons.push(`sub:${anchor.type_sub}`) }
    if (anchor.language    && anchor.language    === candidate.language)    { similarity += 0.1; reasons.push(`language:${anchor.language}`) }

    if (similarity >= ANCHOR_THRESHOLD) {
      results.push({
        owner: anchor.owner,
        name: anchor.name,
        avatar_url: anchor.avatar_url ?? null,
        reasons,
        similarity,
      })
    }
  }

  results.sort((a, b) => b.similarity - a.similarity)
  return results.slice(0, MAX_ANCHORS)
}
```

- [ ] **Step 4: Run engine tests; expect pass**

Run: `npx vitest run electron/services/recommendationEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite; expect failures only in `recommendHandlers.test.ts`**

Run: `npx vitest run`
Expected: handler tests fail because they mock the old engine surface (`computeTopicStats`, `buildUserProfile`, `rankCandidates` with old signatures). Those get fixed in Task 17.

- [ ] **Step 6: Commit**

```bash
git add electron/services/recommendationEngine.ts electron/services/recommendationEngine.test.ts
git commit -m "feat(reco): orchestrator composes signals + MMR rerank"
```

---

## Task 17: Update `recommendHandlers.ts`

**Files:**
- Modify: `electron/ipc/recommendHandlers.ts`
- Modify: `electron/ipc/recommendHandlers.test.ts`

**Goal:** Wire engagement loading, new profile hash, prune scheduling, new orchestrator call.

- [ ] **Step 1: Read current handler**

[recommendHandlers.ts](../../../electron/ipc/recommendHandlers.ts) (244 lines).

- [ ] **Step 2: Replace key sections**

Replace the import block and the relevant body sections of `getRecommendedHandler`. Specifically:

```ts
import { createHash } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { getToken } from '../store'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { extractDominantColor } from '../color-extractor'
import { poolAll } from '../concurrency'
import type Database from 'better-sqlite3'
import { rankCandidates } from '../services/recommendationEngine'
import { buildUserProfile } from '../services/userProfile'
import { computeCorpusStats } from '../services/corpusStats'
import { planQueries, fetchCandidates } from '../services/recommendationFetcher'
import { getRecentClicks, pruneOldEvents } from '../services/engagementTracker'
import { cascadeRepoId } from '../db-helpers'
import type { RecommendationResponse, RecommendationItem } from '../../src/types/recommendation'
import type { RepoRow } from '../../src/types/repo'

const ENGAGEMENT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS      = 7  * 24 * 60 * 60 * 1000
```

Update `computeProfileHash`:

```ts
export function computeProfileHash(
  starredIds: string[],
  savedIds: string[],
  clickedRepoIds: string[],
  latestClickTs: number,
): string {
  const s = [...starredIds].sort().join(',')
  const v = [...savedIds].sort().join(',')
  const c = [...clickedRepoIds].sort().join(',')
  // Hour-bucket the latest click ts so the cache survives many clicks per hour
  const tsBucket = Math.floor(latestClickTs / (60 * 60 * 1000))
  return createHash('sha256').update(`${s}|${v}|${c}|${tsBucket}`).digest('hex')
}
```

Add a prune helper inside the file (before `getRecommendedHandler`):

```ts
function maybePrune(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'engagement_last_prune'").get() as { value: string } | undefined
  const last = row ? parseInt(row.value, 10) : 0
  if (Date.now() - last < PRUNE_INTERVAL_MS) return
  pruneOldEvents(db, Date.now() - ENGAGEMENT_LOOKBACK_MS)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('engagement_last_prune', String(Date.now()))
}
```

Rewrite the body of `getRecommendedHandler`. The full new body (replace the entire function):

```ts
export async function getRecommendedHandler(): Promise<RecommendationResponse> {
  const db = getDb(app.getPath('userData'))
  const token = getToken()
  if (!token) return { items: [], stale: false, coldStart: false }

  maybePrune(db)

  // Load user repos
  const userRepos = db.prepare(
    'SELECT * FROM repos WHERE starred_at IS NOT NULL OR saved_at IS NOT NULL'
  ).all() as RepoRow[]

  // Load engagement events + clicked repos
  const engagementEvents = getRecentClicks(db, Date.now() - ENGAGEMENT_LOOKBACK_MS)
  const clickedIds = [...new Set(engagementEvents.map(e => e.repo_id))]
  const clickedReposById = new Map<string, { topics: string | null; owner: string }>()
  if (clickedIds.length > 0) {
    const placeholders = clickedIds.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, topics, owner FROM repos WHERE id IN (${placeholders})`).all(...clickedIds) as { id: string; topics: string | null; owner: string }[]
    for (const r of rows) clickedReposById.set(r.id, { topics: r.topics, owner: r.owner })
  }

  // Profile hash (now includes click state)
  const starredIds = userRepos.filter((r) => r.starred_at).map((r) => String(r.id))
  const savedIds   = userRepos.filter((r) => r.saved_at).map((r) => String(r.id))
  const latestClickTs = engagementEvents.length > 0 ? engagementEvents[0].ts : 0
  const profileHash = computeProfileHash(starredIds, savedIds, clickedIds, latestClickTs)

  // L1 cache
  const cached = l1Cache.get(profileHash)
  if (cached && (Date.now() - cached.timestamp) < L1_TTL_MS) {
    return cached.response
  }

  // Cold-start path (fewer than 3 user repos)
  if (userRepos.length < COLD_START_MIN_REPOS) {
    const coldCandidates = await fetchCandidates(token, [{
      topic: '', kind: 'coldStart', coldStart: true, perPage: 100, sort: 'stars',
    }])
    upsertCandidates(db, coldCandidates, profileHash)
    const coldByIdMap = readBackRows(db, coldCandidates)
    const items: RecommendationItem[] = coldCandidates
      .map((repo): RecommendationItem | null => {
        const row = coldByIdMap.get(String(repo.id))
        if (!row) return null
        return {
          repo: row, score: 0,
          scoreBreakdown: { topic: 0, description: 0, bucket: 0, subType: 0, language: 0, scale: 0, freshness: 0, engagement: 0 },
          anchors: [], primaryAnchor: null,
        }
      })
      .filter((i): i is RecommendationItem => i !== null)
    const response: RecommendationResponse = { items, stale: false, coldStart: true }
    l1Cache.set(profileHash, { timestamp: Date.now(), response })
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`recommended_cache_ts:${profileHash}`, String(Date.now()))
    return response
  }

  // Normal path
  const corpusRows = db.prepare('SELECT topics, description FROM repos').all() as { topics: string | null; description: string | null }[]
  const corpus = computeCorpusStats(corpusRows)
  const profile = buildUserProfile({ userRepos, corpus, engagementEvents, clickedReposById })
  const queries = planQueries(profile)
  let candidates = await fetchCandidates(token, queries)

  // Filter: not user-owned, not already user's, not recently clicked
  const existingIds = new Set(userRepos.map((r) => String(r.id)))
  const githubUsernameRow = db.prepare("SELECT value FROM settings WHERE key = 'github_username'").get() as { value: string } | undefined
  const githubUsername = githubUsernameRow?.value?.toLowerCase() ?? null
  candidates = candidates.filter((c) =>
    !existingIds.has(String(c.id)) &&
    !profile.engagement.clickedRepoIds.has(String(c.id)) &&
    (!githubUsername || c.owner.login.toLowerCase() !== githubUsername)
  )

  const ranked = rankCandidates(candidates, profile, corpus)

  upsertCandidates(db, candidates, profileHash)
  const byIdMap = readBackRows(db, candidates)

  const items: RecommendationItem[] = ranked
    .map((item): RecommendationItem | null => {
      const row = byIdMap.get(String(item.repo.id))
      if (!row) return null
      return { ...item, repo: row }
    })
    .filter((i): i is RecommendationItem => i !== null)

  const response: RecommendationResponse = { items, stale: false, coldStart: false }
  l1Cache.set(profileHash, { timestamp: Date.now(), response })
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`recommended_cache_ts:${profileHash}`, String(Date.now()))
  return response
}
```

- [ ] **Step 3: Update handler tests**

Open `electron/ipc/recommendHandlers.test.ts`. Update the engine mock and add new mocks for the modules now imported by the handler:

```ts
vi.mock('../services/recommendationEngine', () => ({
  rankCandidates: vi.fn().mockReturnValue([]),
}))

vi.mock('../services/userProfile', () => ({
  buildUserProfile: vi.fn().mockReturnValue({
    topicAffinity: new Map(), descriptionAffinity: new Map(),
    bucketDistribution: new Map(), subTypeDistribution: new Map(), languageWeights: new Map(),
    starScale: { median: 100, p25: 50, p75: 200 }, anchorPool: [], repoCount: 0,
    freshnessPreference: 365,
    engagement: { clickedTopicAffinity: new Map(), clickedOwnerAffinity: new Map(), clickedRepoIds: new Set(), clickCount: 0 },
  }),
}))

vi.mock('../services/corpusStats', () => ({
  computeCorpusStats: vi.fn().mockReturnValue({
    topicDocFrequency: new Map(), topicIdf: new Map(),
    descriptionDocFrequency: new Map(), descriptionIdf: new Map(),
    totalRepos: 0,
  }),
}))

vi.mock('../services/engagementTracker', () => ({
  getRecentClicks: vi.fn().mockReturnValue([]),
  pruneOldEvents: vi.fn(),
}))
```

Update `computeProfileHash` tests for the new 4-argument signature.

**Existing 2-arg call sites at HEAD** (verified by grep) — update each to pass `[]` and `0` for the new args, or rewrite to also exercise the new dimensions:

- `recommendHandlers.test.ts:349-350` — order-independence test
- `recommendHandlers.test.ts:355-356` — different starred sets
- `recommendHandlers.test.ts:361-362` — different saved sets
- `recommendHandlers.test.ts:367` — empty inputs

Then add the new tests for click-aware hashing:

```ts
describe('computeProfileHash (click-aware)', () => {
  it('changes when clicked repo set changes', () => {
    const a = computeProfileHash(['1'], ['2'], [], 0)
    const b = computeProfileHash(['1'], ['2'], ['3'], 0)
    expect(a).not.toBe(b)
  })
  it('survives within an hour bucket of click timestamps', () => {
    const t = 1_700_000_000_000  // arbitrary fixed
    const a = computeProfileHash(['1'], [], ['c'], t)
    const b = computeProfileHash(['1'], [], ['c'], t + 1000)  // same hour
    expect(a).toBe(b)
  })
})
```

Existing handler-flow tests (the ones that mock fetchers and end-to-end the call) should mostly still pass. Update the few assertions that rely on the old engine surface.

**Preserved from the existing handler:** module-level `l1Cache`, `L1_TTL_MS`, `COLD_START_MIN_REPOS`, `L1Entry`, `upsertCandidates`, and `readBackRows` are unchanged — only `getRecommendedHandler`'s body and `computeProfileHash`'s signature change in this task. Don't delete those.

- [ ] **Step 4: Run handler tests; expect pass**

Run: `npx vitest run electron/ipc/recommendHandlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: PASS across the board.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/recommendHandlers.ts electron/ipc/recommendHandlers.test.ts
git commit -m "feat(reco): handler — engagement loading + new orchestrator + click-aware cache hash"
```

---

## Task 18: Cleanup pass

**Files:**
- Modify: `src/types/recommendation.ts` (remove deprecated `TopicStats` alias if unused)
- Verify: no remaining references to old engine functions (`computeTopicStats`, `scoreCandidate`, old `buildUserProfile`, etc.)

**Goal:** Remove transitional cruft.

- [ ] **Step 1: Search for `TopicStats` usages**

Run: `grep -rn "TopicStats" --include="*.ts" --include="*.tsx" .`
Expected: Only the type alias declaration in `recommendation.ts`. If consumers exist, replace with `CorpusStats`.

- [ ] **Step 2: Remove the alias**

Edit `src/types/recommendation.ts` and delete the `TopicStats` block.

- [ ] **Step 3: Search for old function references**

Run: `grep -rn "computeTopicStats\|scoreCandidate" --include="*.ts" --include="*.tsx" .`
Expected: zero hits in production code (test-only references in deleted file are already gone after Task 16). If any production hit remains, the cutover missed something — update.

- [ ] **Step 4: Run typecheck and full tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/recommendation.ts
git commit -m "chore(reco): remove deprecated TopicStats alias"
```

---

## Done criteria

- [ ] All 18 tasks complete with green tests after each commit.
- [ ] `npm run typecheck` passes on the final commit.
- [ ] `npx vitest run` reports zero failures.
- [ ] Manual smoke test: launch the app, navigate to Discover → Recommended view, click a repo, return to Recommended, observe the recommendation set has shifted (engagement signal active).

## Out of scope (per spec §12)

- Collaborative filtering of any kind
- README fetching for text features
- Dismiss UI / negative engagement
- Score-breakdown debug tooltip
- Server-side anything

## Risks (per spec §13)

Reminder for the executor: weights are educated guesses, the description tokenizer may be noisy until the stopword list settles, and engagement scores will be sparse until users accumulate clicks. None of these block landing — they're tuning concerns for follow-up work.
