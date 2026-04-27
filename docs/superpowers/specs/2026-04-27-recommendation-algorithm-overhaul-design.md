# Recommendation Algorithm Overhaul — Design

**Date:** 2026-04-27
**Status:** Draft
**Scope:** Replace the current single-pass content-based recommender in `electron/services/recommendationEngine.ts` with a modular signal pipeline that broadens candidate generation, adds three new scoring signals, applies diversity reranking, and incorporates implicit click engagement.

---

## 1. Motivation

The current recommender ([recommendationEngine.ts](../../../electron/services/recommendationEngine.ts), [recommendationFetcher.ts](../../../electron/services/recommendationFetcher.ts)) is a reasonable v1 but has several concrete limitations:

1. **Self-reinforcing candidate pool.** Top-5 single-topic queries × 25 results = ~125 candidates, then scored by the same topics. Filter bubble by construction.
2. **No diversity.** Pure top-N by score; results cluster around the user's dominant topic.
3. **Topic-dominant (35%) but topics are sparse.** Many strong repos have no GitHub topics; they zero out the largest signal.
4. **No engagement signal.** Clicks, dismissals, and other behaviour aren't fed back.
5. **No freshness re-rank.** A 2018 archived repo with matching topics ties an active one.
6. **Star-scale matching can punish gems.** Under-the-radar repos score low on `scale` even when topically perfect.
7. **Bucket/sub-type misclassifications cascade** into 45% of the score with no fallback.

Collaborative filtering and dismiss-UI engagement are explicitly **out of scope** — this remains a content-based recommender driven entirely by the user's own stars/saved repos plus implicit click history.

---

## 2. Approach

**Modular scoring pipeline.** Refactor the engine into a thin orchestrator that composes per-signal scorers, adds a diversity rerank pass, and consumes a new engagement signal. Each scoring concern lives in its own file with a single, testable shape.

Alternatives considered:
- *Inline expansion* — keep `scoreCandidate` in `recommendationEngine.ts` and add fields. Rejected: file already at 287 LOC, projected to grow to ~700 with mixed concerns.
- *Two-pass post-processor* — leave engine alone, add a separate post-processing step. Rejected: bolts new signals on rather than treating them as first-class scoring components.

---

## 3. File layout

### New files (under `electron/services/`)

| File | Purpose |
|---|---|
| `signals/topicSignal.ts` | IDF-weighted topic affinity score. Extracted from current engine, math unchanged. |
| `signals/descriptionSignal.ts` | TF-IDF score over description tokens. NEW. |
| `signals/categorySignal.ts` | Bucket + subType + language scoring. Consolidates currently-scattered logic. |
| `signals/scaleSignal.ts` | Improved star-scale matching with floor for low-star gems. |
| `signals/freshnessSignal.ts` | `pushed_at` exponential decay with adaptive half-life. NEW. |
| `signals/engagementSignal.ts` | Implicit-click history boost. NEW. |
| `diversityReranker.ts` | MMR rerank pass. NEW. |
| `engagementTracker.ts` | DB-backed click event store. NEW. |
| `userProfile.ts` | Builds `UserProfile` by composing signal-specific builders. Extracted from engine. |

### Refactored files

| File | Change |
|---|---|
| `recommendationEngine.ts` | Becomes thin orchestrator: compose signals → score → rerank → return. |
| `recommendationFetcher.ts` | Expanded `planQueries`: multi-topic, subType, engagement-derived, language queries. |
| `ipc/recommendHandlers.ts` | Passes engagement events into engine, extends profile hash to include click state. |
| `electron/preload.ts` | Adds `engagement.logClick` to the renderer API surface. |
| `electron/main.ts` | Registers `engagementHandlers`. |
| `src/types/recommendation.ts` | Extended `UserProfile`, `ScoreBreakdown`, `CorpusStats` (renamed from `TopicStats`). |
| `src/views/Discover.tsx` | One added line in `navigateToRepo` to call `engagement.logClick`. |

### New IPC

| File | Purpose |
|---|---|
| `electron/ipc/engagementHandlers.ts` | Registers `engagement:logClick`. |

### Tests

One unit-test file alongside each new module, plus integration tests at the orchestrator and handler level (see §10).

**Total estimate:** ~12 new files, ~6 modified files, ~1500–1800 LOC including tests.

---

## 4. Type changes

### `CorpusStats` (renamed from `TopicStats`)

```ts
export interface CorpusStats {
  topicDocFrequency: Map<string, number>
  topicIdf: Map<string, number>
  descriptionDocFrequency: Map<string, number>   // NEW
  descriptionIdf: Map<string, number>            // NEW
  totalRepos: number
}
```

Built in a single sweep over the local repos table.

### `UserProfile`

```ts
export interface UserProfile {
  // Existing
  topicAffinity: Map<string, number>
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
  starScale: { median: number; p25: number; p75: number }
  anchorPool: RepoRow[]
  repoCount: number

  // NEW
  descriptionAffinity: Map<string, number>
  freshnessPreference: number                    // median age (days) of user's stars
  engagement: EngagementProfile
}

export interface EngagementProfile {
  clickedTopicAffinity: Map<string, number>
  clickedOwnerAffinity: Map<string, number>
  clickedRepoIds: Set<string>
  clickCount: number
}
```

### `ScoreBreakdown`

```ts
export interface ScoreBreakdown {
  topic: number
  description: number     // NEW
  bucket: number
  subType: number
  language: number
  scale: number
  freshness: number       // NEW
  engagement: number      // NEW
}
```

This is a breaking change to the type. The renderer does not currently read `scoreBreakdown` (verified by grep — only `score` and `anchors` are consumed). Safe to expand.

---

## 5. Scoring signals

Each signal is a pure function returning a value in `[0, 1]`. Final composite score is the weighted sum.

### 5.1 topicSignal

Extracted unchanged from current `scoreCandidate` topic branch. Sum of `profile.topicAffinity[t]` for each candidate topic, capped at 1.0.

### 5.2 descriptionSignal (NEW)

**Tokenization:**
- Lowercase
- Split on `\W+`
- Drop tokens of length < 3
- Drop stopwords from a ship-day baseline list: ~120 standard English stopwords (the, a, an, of, for, to, in, with, etc.) plus ~30 generic dev terms with low discriminating power (tool, tools, app, apps, library, libraries, framework, project, code, simple, easy, fast, lightweight, modern, awesome, best, the, etc.). The list is committed as `signals/descriptionStopwords.ts`. **Treat the list as fixed for v1**; additions/removals are a follow-up tuning pass, not part of this work.

**Profile build:**
- For each starred/saved repo, tokenize description
- For each token, contribute `recencyWeight * idf(token)` (using `corpus.descriptionIdf`)
- Normalize so sum = 1

**Candidate scoring:**
- Tokenize candidate description
- Sum `profile.descriptionAffinity[token]` over candidate tokens
- Cap at 1.0

**Empty description → 0.** Same shape as `topicSignal`. Compensates when GitHub topics are sparse.

### 5.3 categorySignal

Returns a sub-object so the engine can apply three independent weights:

```ts
{ bucket: number, subType: number, language: number }
```

Each value is read directly from the corresponding distribution in `UserProfile`. Missing field on candidate → 0.

### 5.4 scaleSignal (improved)

**Bug fix:** current formula zeros out gems. A 50-star repo with median 50k → score = 0.

**New formula:**

```
candidateLog = log10(stars + 1)
medianLog    = log10(median + 1)

if candidateLog >= medianLog:
  score = max(0.5, 1 - (candidateLog - medianLog) / 2)
else:
  score = max(0.4, 1 - (medianLog - candidateLog) / 3)
```

- Above median: penalty for being much higher (1 → 0.5)
- Below median: gentler decay, floor of 0.4 (gems retain a baseline)

### 5.5 freshnessSignal (NEW)

```
ageDays  = (now - pushed_at) / day
halfLife = max(180, profile.freshnessPreference)
score    = 0.5 ^ (ageDays / halfLife)
```

- Just-pushed → ~1.0
- At half-life → 0.5
- Multi-year stale → asymptotic to 0
- Archived repos: `score = 0`. The GitHub Search REST API returns an `archived` boolean per repo, but the current `GitHubRepo` type at [electron/github.ts:18-37](../../../electron/github.ts:18) does not declare it. **Required task:** add `archived: boolean` to the `GitHubRepo` interface and propagate it into the candidate flow. (No DB column needed — freshness is computed at scoring time, not persisted.)

Adaptive half-life: a user who stars older infrastructure repos shouldn't penalize older candidates as hard as a user who stars only this-month projects.

### 5.6 engagementSignal (NEW)

**Cold start:** if `clickCount === 0`, returns 0 for all candidates. Other signals carry the score.

**Otherwise:**
```
topicMatch = sum(profile.engagement.clickedTopicAffinity[t]) for t in candidate.topics
ownerMatch = profile.engagement.clickedOwnerAffinity[candidate.owner] || 0
score      = min(1, 0.7 * topicMatch + 0.3 * ownerMatch)
```

Already-clicked repo IDs are filtered out *before* scoring (see §9 orchestrator step 5), not via signal score.

### 5.7 Composite weights

```ts
const WEIGHTS = {
  topic:       0.22,   // was 0.35
  description: 0.13,   // NEW
  subType:     0.20,   // was 0.30
  bucket:      0.10,   // was 0.15
  language:    0.07,   // was 0.10
  scale:       0.05,   // was 0.10
  freshness:   0.08,   // NEW
  engagement:  0.15,   // NEW
}                      // sums to 1.00
```

Rationale: engagement is highly personalized once we have data, earns 15%. Description compensates for sparse topics. Freshness is a tiebreaker, not a dominant signal. Topic + subType still dominate (42% combined). Weights are constants in one file — easy to revisit.

---

## 6. Diversity reranker (MMR)

After scoring, results are reordered via Maximal Marginal Relevance.

**Inputs:** `RankedItem[]` sorted by `score` desc.
**Output:** Reordered `RankedItem[]`, same items.

### Algorithm

```
selected  = []
remaining = scored.slice(0, 200)   // top-200 by score
TOP_K     = 100
λ         = 0.7

while remaining.length > 0 and selected.length < TOP_K:
  best = argmax over remaining of:
    λ * item.score - (1 - λ) * max(similarity(item, s) for s in selected)
  selected.push(best); remaining.remove(best)

return selected
```

For the first pick, `selected` is empty; similarity term is 0, so first pick = top-scored item.

### Similarity

```
similarity(a, b) =
    jaccard(a.topics, b.topics) * 0.5
  + (a.bucket  === b.bucket  ? 0.25 : 0)
  + (a.sub     === b.sub     ? 0.20 : 0)
  + (a.language === b.language ? 0.05 : 0)
```

Range `[0, 1]`. Topic Jaccard does most of the work.

### Parameters

- `λ = 0.7` — 70% relevance, 30% diversity. Common starting point.
- `RERANK_WINDOW = 200` — top-200 by score is the input.
- `TOP_K = 100` — final list size, matches current single-page behaviour.

### Performance

O(n²) on the rerank window. n=200 → ~40k similarity computations per refresh. Trivial on a desktop.

---

## 7. Broader candidate generation

Replace the current 5×25 single-topic query plan with a diversified plan.

| Kind | Count | Per-query results | Query shape |
|---|---|---|---|
| `topic` | 4 | 30 | `topic:{T} stars:>10` for top-4 affinity topics |
| `pair` | 3 | 25 | `topic:{A} topic:{B} stars:>10` for top-3 co-occurring topic pairs |
| `subType` | 2 | 25 | `topic:{subTypeKeyword} stars:>10` for top-2 subTypes (uses existing `getSubTypeKeyword`) |
| `engagement` | up to 2 | 20 | `topic:{T} stars:>10` for top-2 clicked topics not already in user-affinity top |
| `language` | 1 | 25 | `language:{L} stars:>50` for #1 language |

**Pair affinity:** `profile.topicAffinity[a] * profile.topicAffinity[b]` if at least one user repo carries both topics; else 0.

**Engagement queries:** only emitted when `engagement.clickCount >= 3`.

**Total:** up to 12 queries → ~300 raw → dedup → ~200–250 unique candidates (up from 125).

**Rate limit:** 12 search calls per refresh. GitHub authenticated search limit is 30/min. Safely under. L1 cache (5 min) means most user navigations don't trigger fresh fetches.

**Cold start unchanged:** `stars:>50000` for users with <3 starred/saved repos.

**`QueryPlan` gains a discriminator** for telemetry and dedup audit:

```ts
export interface QueryPlan {
  topic: string
  kind: 'topic' | 'pair' | 'subType' | 'engagement' | 'language' | 'coldStart'
  coldStart: boolean
}
```

---

## 8. Engagement infrastructure

### 8.1 DB schema

```sql
CREATE TABLE IF NOT EXISTS engagement_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  source      TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engagement_ts   ON engagement_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_repo ON engagement_events(repo_id);
```

- `event_type`: `'click'` initially. Schema reserves room for future `'dismiss'`, `'hide'`.
- `source`: `'recommended'` | `'discover'` | `'search'` | `'profile'` | `'library'`. Only `'recommended'` and `'discover'` get logged in v1.
- Added to whatever DB-init pattern the codebase uses (`getDb` in `electron/db.ts`). Idempotent; no-op for existing users.

### 8.2 `engagementTracker.ts` API

```ts
export function logClick(db, repoId: string, source: string): void
export function getRecentClicks(db, sinceMs: number, limit?: number): EngagementRow[]
export function pruneOldEvents(db, olderThanMs: number): void
```

- Pruning runs at the start of `getRecommendedHandler` if last prune timestamp (in `settings`) is >7 days old.
- Retention: 90 days.

### 8.3 IPC

`electron/ipc/engagementHandlers.ts`:

```ts
ipcMain.handle('engagement:logClick', (_, repoId: string, source: string) => {
  logClick(getDb(...), repoId, source)
})
```

`electron/preload.ts` exposes:

```ts
engagement: {
  logClick: (repoId, source) => ipcRenderer.invoke('engagement:logClick', repoId, source),
}
```

### 8.4 Renderer integration

Single call site: `Discover.tsx` `navigateToRepo` ([Discover.tsx:767](../../../src/views/Discover.tsx:767)).

```ts
if (snap?.repos && match && repo) {
  window.api.engagement.logClick(
    repo.id,
    viewMode === 'recommended' ? 'recommended' : 'discover'
  )
}
```

Library, Starred, Profile, etc. are intentionally **not** instrumented in v1 — those repos are already chosen by the user and would noise the signal. Easy to add later (the `source` field is already there).

### 8.5 Profile builder consumption

`getRecommendedHandler` calls `getRecentClicks(db, Date.now() - 90*24*60*60*1000)` once per refresh. Loads matching `RepoRow` rows in a single batched `SELECT * FROM repos WHERE id IN (...)`. Passes both into `buildEngagementProfile`.

**Decay:** per click, weight = `0.5 ^ (ageDays / 30)` — 30-day half-life. Faster decay than the 90-day star half-life: clicks reflect current taste; we want the most recent signal to dominate.

---

## 9. Orchestrator flow

```
1. corpus       = computeCorpusStats(allRepos)             // single DB sweep
2. clickEvents  = getRecentClicks(db, since=90d)
3. profile      = buildUserProfile(userRepos, corpus, clickEvents, clickedRepos)
4. queries      = planQueries(profile)
5. candidates   = await fetchCandidates(token, queries)
                  .filter(notUserOwned)
                  .filter(notUserStarredOrSaved)
                  .filter(notRecentlyClicked)               // dedup against engagement
6. ranked       = scoreAll(candidates, profile, corpus)     // sorted by score desc
7. reranked     = mmrRerank(ranked.slice(0, 200), 100)
8. anchors      = findAnchors(reranked, profile, corpus)    // unchanged logic
9. return reranked
```

`anchors` continues to use only topic/category/language signals — adding description-token reasons would generate noisy explanations.

---

## 10. Testing strategy

### 10.1 Unit tests (one per signal/module)

| File | Coverage |
|---|---|
| `signals/topicSignal.test.ts` | IDF math, normalization, cap at 1.0, IDF fallback when corpus < threshold |
| `signals/descriptionSignal.test.ts` | Tokenizer (stopwords, length filter, punctuation), TF-IDF math, normalization, cap, empty description → 0 |
| `signals/categorySignal.test.ts` | Reads distributions correctly, missing fields → 0, unknown bucket → 0 |
| `signals/scaleSignal.test.ts` | Gem case (50 stars vs median 50k → ≥0.4), above-median (≥0.5), exact median (1.0), zero median |
| `signals/freshnessSignal.test.ts` | Fresh ≈1.0, half-life ≈0.5, very old ≈0, archived = 0.05, adaptive half-life |
| `signals/engagementSignal.test.ts` | Empty engagement → 0, topic match contributes, owner match contributes, decay applied |
| `diversityReranker.test.ts` | First pick is top-scored, second pick avoids nearest neighbour, similarity edge cases, λ=1 → pure relevance, λ=0 → max diversity |
| `engagementTracker.test.ts` | logClick writes row, getRecentClicks filters and limits, pruneOldEvents removes only old rows |

### 10.2 Integration tests

| File | Coverage |
|---|---|
| `recommendationFetcher.test.ts` (extended) | Each new query kind (`pair`, `subType`, `engagement`, `language`), dedup across kinds |
| `recommendationEngine.test.ts` (rewritten) | Cold-start path, full path, single-signal-disabled (weight=0) doesn't affect others, ScoreBreakdown shape matches new signals |
| `recommendHandlers.test.ts` (extended) | Engagement events loaded into profile, prune runs when stale, weekly prune flag respected, cache hash includes click state |
| `Discover.test.tsx` (extended) | `engagement.logClick` invoked when navigating to repo from recommended view |

### 10.3 TDD discipline

Each signal goes through a red-test-first pass per the user's universal `superpowers:test-driven-development` rule. Test backbone is in place before implementation logic.

### 10.4 Backwards compatibility

- DB schema additive only; existing tables untouched.
- Renderer API surface gains one method; no removals.
- `RecommendationItem.scoreBreakdown` shape extended with three new fields. No consumer reads this field today (verified). Safe.

---

## 11. Cache invalidation

Current `profileHash` ([recommendHandlers.ts:19-23](../../../electron/ipc/recommendHandlers.ts:19)) hashes `starredIds + savedIds`. Click-driven changes wouldn't invalidate the L1 cache.

**New hash:**

```
sha256(
  starredIds.sorted.join(',')
  | savedIds.sorted.join(',')
  | clickedRepoIds.sorted.join(',')
  | latestClickTs.bucketedToHour
)
```

Hour-bucketing the latest click timestamp gives ~hourly refresh granularity without thrashing the cache on every single click.

---

## 12. Out of scope

Explicitly excluded from this design:

- Collaborative filtering of any kind (no follow-graph, no stargazer-overlap, no co-star inference)
- README fetching for text features (descriptions only)
- Dismiss UI / negative engagement signals (clicks only, positive only)
- Score-breakdown tooltip / debug UI
- Server-side anything

Each of these remains feasible as a future phase without disturbing the architecture established here.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Weight tuning is guesswork** without an eval set | Weights are constants in one file; ship and revisit based on observation |
| **Description tokenizer noise** (common dev terms like "tool", "library") | IDF naturally suppresses common terms; cap on max tokens per repo (~50); stopword list extensible |
| **Engagement signal sparse early on** | `clickCount === 0` short-circuits the signal; `clickCount < 3` effectively zero-weights it; other signals carry until clicks accumulate |
| **MMR removes a clearly-best item from the top spot** with low λ | λ=0.7 keeps top item in place (similarity term is 0 for first pick); only affects positions 2+ |
| **Adaptive freshness half-life** could be too long for users who only star very old repos | `max(180, freshnessPreference)` floor ensures freshness still has discriminating power |

---

## 14. Rollout

Single landing on `main` (per universal CLAUDE.md branch policy). No feature flag — replaces the existing recommender on next app launch. Existing users get an empty `engagement_events` table and degraded engagement scores until they click a few things, which is the correct behaviour. New schema is additive (`CREATE IF NOT EXISTS`), no migration needed beyond first-launch table creation.
