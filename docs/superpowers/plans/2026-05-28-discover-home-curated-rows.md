# Discover home curated rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `DiscoverGrid` on the Discover Home view with three new curated carousels (Hot today / Trending this week / Hidden gems), each expanding into its own deep-link-only view via clickable title.

**Architecture:** Extend `ViewModeKey` with three new modes whose queries fit the existing `buildViewModeQuery` switch. Each new row gets its own SWR cache pair mirroring `_popularModuleCache`. `Discover.tsx` gains three state hooks + three fetch effects + three JSX rows + a `showHomeRows` gate that hides the trailing `DiscoverGrid` when the rows are visible. Snapshot normalisation gets a whitelist update for the new modes; `loadTrending` and `loadMore` need no change because they already route through `buildTrendingQuery → buildViewModeQuery`, which Task 1 extends. The top pill nav is untouched — row title clicks (`onMore`) are the only entry into the new views.

**Tech Stack:** TypeScript, React, Vitest, react-router-dom, GitHub search API via `window.api.github.searchRepos`.

**Spec:** [docs/superpowers/specs/2026-05-28-discover-home-curated-rows-design.md](../specs/2026-05-28-discover-home-curated-rows-design.md)

---

## Task 1: Extend `ViewModeKey` and `buildViewModeQuery` with three new modes

**Files:**
- Modify: `src/lib/discoverQueries.ts` (lines 3-33)
- Create: `src/lib/discoverQueries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/discoverQueries.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildViewModeQuery, getViewModeSort } from './discoverQueries'

beforeEach(() => {
  // Fix "today" so the relative-date computations in buildViewModeQuery
  // produce deterministic strings we can assert on.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('buildViewModeQuery — hot-today', () => {
  it('returns pushed:>{yesterday} with no language filter', () => {
    expect(buildViewModeQuery('hot-today', '', '')).toBe('pushed:>2026-06-14')
  })

  it('appends language filter when langKey provided', () => {
    expect(buildViewModeQuery('hot-today', 'rust', '')).toBe('pushed:>2026-06-14 language:rust')
  })
})

describe('buildViewModeQuery — trending-week', () => {
  it('returns pushed:>{7 days ago} with no language filter', () => {
    expect(buildViewModeQuery('trending-week', '', '')).toBe('pushed:>2026-06-08')
  })

  it('appends language filter when langKey provided', () => {
    expect(buildViewModeQuery('trending-week', 'typescript', '')).toBe('pushed:>2026-06-08 language:typescript')
  })
})

describe('buildViewModeQuery — hidden-gems', () => {
  it('returns pushed:>{30 days ago} with stars range and no language filter', () => {
    expect(buildViewModeQuery('hidden-gems', '', '')).toBe('pushed:>2026-05-16 stars:50..500')
  })

  it('appends language filter while keeping the stars range', () => {
    expect(buildViewModeQuery('hidden-gems', 'go', '')).toBe('pushed:>2026-05-16 stars:50..500 language:go')
  })
})

describe('getViewModeSort — new view modes', () => {
  it('returns stars desc for hot-today', () => {
    expect(getViewModeSort('hot-today')).toEqual({ sort: 'stars', order: 'desc' })
  })
  it('returns stars desc for trending-week', () => {
    expect(getViewModeSort('trending-week')).toEqual({ sort: 'stars', order: 'desc' })
  })
  it('returns stars desc for hidden-gems', () => {
    expect(getViewModeSort('hidden-gems')).toEqual({ sort: 'stars', order: 'desc' })
  })
})

describe('buildViewModeQuery — existing modes unchanged', () => {
  it('home with no langKey still returns stars:>100', () => {
    expect(buildViewModeQuery('home', '', '')).toBe('stars:>100')
  })
  it('home with langKey still returns stars:>0 language:X', () => {
    expect(buildViewModeQuery('home', 'rust', '')).toBe('stars:>0 language:rust')
  })
  it('explicit trimmed search overrides the mode-specific base query', () => {
    expect(buildViewModeQuery('hot-today', '', 'react')).toBe('react')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/discoverQueries.test.ts`
Expected: TypeScript errors on `'hot-today'`, `'trending-week'`, `'hidden-gems'` not being assignable to `ViewModeKey`.

- [ ] **Step 3: Extend `ViewModeKey` and the `VIEW_MODES` array**

In `src/lib/discoverQueries.ts`, replace the existing `VIEW_MODES` constant (lines 3-7) with:

```typescript
export const VIEW_MODES = [
  { key: 'home',           label: 'Home',                accent: '#60a5fa' },
  { key: 'recommended',    label: 'Recommended',         accent: '#8b5cf6' },
  { key: 'agents',         label: 'Agents',              accent: '#f59e0b' },
  { key: 'hot-today',      label: 'Hot today',           accent: '#ef4444' },
  { key: 'trending-week',  label: 'Trending this week',  accent: '#f97316' },
  { key: 'hidden-gems',    label: 'Hidden gems',         accent: '#10b981' },
] as const
```

`ViewModeKey` (line 9) and `getViewModeAccent` (lines 11-13) need no changes — they derive from `VIEW_MODES`.

- [ ] **Step 4: Add the new switch branches in `buildViewModeQuery`**

In `src/lib/discoverQueries.ts`, replace the existing `buildViewModeQuery` function (lines 15-33) with:

```typescript
function daysAgoIsoDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

export function buildViewModeQuery(viewMode: ViewModeKey, langKey: string, search: string): string {
  const trimmed = search.trim()
  const langFilter = langKey ? `language:${langKey}` : ''

  if (trimmed) {
    return [trimmed, langFilter].filter(Boolean).join(' ')
  }

  switch (viewMode) {
    case 'recommended':
      return '' // handled by separate IPC handler
    case 'agents':
      return '' // agents come from window.api.agents.getAll(), not GitHub search
    case 'home':
      return langFilter
        ? `stars:>0 ${langFilter}`
        : 'stars:>100'
    case 'hot-today':
      return [`pushed:>${daysAgoIsoDate(1)}`, langFilter].filter(Boolean).join(' ')
    case 'trending-week':
      return [`pushed:>${daysAgoIsoDate(7)}`, langFilter].filter(Boolean).join(' ')
    case 'hidden-gems':
      return [`pushed:>${daysAgoIsoDate(30)} stars:50..500`, langFilter].filter(Boolean).join(' ')
  }
}
```

`getViewModeSort` (lines 35-37) needs no change — it already returns `{ sort: 'stars', order: 'desc' }` for any input.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/discoverQueries.test.ts`
Expected: all 12 tests pass.

- [ ] **Step 6: Type-check the broader codebase**

Run: `npm run build` (or whatever TypeScript check command exists — likely `tsc --noEmit` invoked via the build script).
Expected: no errors. The `ViewModeKey` change adds new union members but existing usages (`view === 'recommended' ? ...`) already use exhaustive checks that don't break on new members.

- [ ] **Step 7: Commit**

```bash
git add src/lib/discoverQueries.ts src/lib/discoverQueries.test.ts
git commit -m "feat(discover): add hot-today/trending-week/hidden-gems view modes

Extend ViewModeKey and buildViewModeQuery with three new modes whose base
queries fit the existing switch. Top nav still shows only Home/Recommended/
Agents; the new modes are entered via row title clicks (wired in a later
task).
"
```

---

## Task 2: Extend `discoverCache.ts` with three new SWR cache pairs

**Files:**
- Modify: `src/lib/discoverCache.ts`
- Modify: `src/lib/discoverCache.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following to the bottom of `src/lib/discoverCache.test.ts` (after line 132):

```typescript
import {
  loadCachedHotToday, saveCachedHotToday,
  loadCachedTrendingWeek, saveCachedTrendingWeek,
  loadCachedHiddenGems, saveCachedHiddenGems,
} from './discoverCache'

const KEY_HOT_TODAY = 'discover-cache.hot-today.v1'
const KEY_TRENDING_WEEK = 'discover-cache.trending-week.v1'
const KEY_HIDDEN_GEMS = 'discover-cache.hidden-gems.v1'

describe('loadCachedHotToday', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedHotToday()).toBeNull()
  })
  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY_HOT_TODAY, 'not-json')
    expect(loadCachedHotToday()).toBeNull()
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_HOT_TODAY, JSON.stringify(stale))
    expect(loadCachedHotToday()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedHotToday([makeRepo('a'), makeRepo('b')])
    const result = loadCachedHotToday()
    expect(result).not.toBeNull()
    expect(result!.repos).toHaveLength(2)
    expect(result!.repos[0].name).toBe('a')
  })
})

describe('saveCachedHotToday', () => {
  it('caps stored entries at 100', () => {
    const many = Array.from({ length: 500 }, (_, i) => makeRepo(`r${i}`))
    saveCachedHotToday(many)
    expect(loadCachedHotToday()!.repos.length).toBeLessThanOrEqual(100)
  })
  it('does not throw on quota errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCachedHotToday([makeRepo('a')])).not.toThrow()
    spy.mockRestore()
  })
})

describe('loadCachedTrendingWeek', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedTrendingWeek()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedTrendingWeek([makeRepo('a')])
    expect(loadCachedTrendingWeek()!.repos[0].name).toBe('a')
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_TRENDING_WEEK, JSON.stringify(stale))
    expect(loadCachedTrendingWeek()).toBeNull()
  })
})

describe('loadCachedHiddenGems', () => {
  it('returns null when nothing stored', () => {
    expect(loadCachedHiddenGems()).toBeNull()
  })
  it('round-trips repos within TTL', () => {
    saveCachedHiddenGems([makeRepo('a')])
    expect(loadCachedHiddenGems()!.repos[0].name).toBe('a')
  })
  it('returns null when older than TTL', () => {
    const stale = { repos: [makeRepo('a')], fetchedAt: Date.now() - POPULAR_CACHE_TTL_MS - 1 }
    localStorage.setItem(KEY_HIDDEN_GEMS, JSON.stringify(stale))
    expect(loadCachedHiddenGems()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/discoverCache.test.ts`
Expected: import errors — the three new functions don't exist yet.

- [ ] **Step 3: Add the three new cache pairs to `discoverCache.ts`**

In `src/lib/discoverCache.ts`, add new key constants below the existing ones (after line 13):

```typescript
const KEY_HOT_TODAY = 'discover-cache.hot-today.v1'
const KEY_TRENDING_WEEK = 'discover-cache.trending-week.v1'
const KEY_HIDDEN_GEMS = 'discover-cache.hidden-gems.v1'
```

Then add the load/save function pairs at the bottom of the file (after line 77):

```typescript
export function loadCachedHotToday(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_HOT_TODAY)
}

export function saveCachedHotToday(repos: RepoRow[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_HOT_TODAY, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedTrendingWeek(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_TRENDING_WEEK)
}

export function saveCachedTrendingWeek(repos: RepoRow[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_TRENDING_WEEK, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}

export function loadCachedHiddenGems(): CachedPopular | null {
  return loadCache<CachedPopular>(KEY_HIDDEN_GEMS)
}

export function saveCachedHiddenGems(repos: RepoRow[]): void {
  try {
    const payload: CachedPopular = {
      repos: repos.slice(0, MAX_CACHED_ENTRIES),
      fetchedAt: Date.now(),
    }
    localStorage.setItem(KEY_HIDDEN_GEMS, JSON.stringify(payload))
  } catch {
    // non-critical
  }
}
```

`CachedPopular` is reused as-is since the payload shape (repos[] + fetchedAt) is identical across all three new datasets.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/discoverCache.test.ts`
Expected: all tests (existing + new) pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discoverCache.ts src/lib/discoverCache.test.ts
git commit -m "feat(discover): cache pairs for hot-today/trending-week/hidden-gems

Each new curated row gets its own persistent localStorage cache mirroring
loadCachedPopular: 24h TTL, 100-entry cap, SWR-friendly. The cache pairs
will be consumed by new state hooks in Discover.tsx in the next task.
"
```

---

## Task 3: Add state, module caches, and fetch effects in `Discover.tsx`

**Files:**
- Modify: `src/views/Discover.tsx`

- [ ] **Step 1: Add the three new module-level caches**

In `src/views/Discover.tsx`, extend the cache-import block (lines 37-40):

```typescript
import {
  loadCachedPopular, saveCachedPopular,
  loadCachedRecommended, saveCachedRecommended,
  loadCachedHotToday, saveCachedHotToday,
  loadCachedTrendingWeek, saveCachedTrendingWeek,
  loadCachedHiddenGems, saveCachedHiddenGems,
} from '../lib/discoverCache'
```

Then add three new module-level cache constants immediately after `_popularModuleCache` (after line 82):

```typescript
let _hotTodayModuleCache: { repos: RepoRow[]; fetchedAt: number } | null = (() => {
  const persisted = loadCachedHotToday()
  return persisted ? { repos: persisted.repos, fetchedAt: persisted.fetchedAt } : null
})()

let _trendingWeekModuleCache: { repos: RepoRow[]; fetchedAt: number } | null = (() => {
  const persisted = loadCachedTrendingWeek()
  return persisted ? { repos: persisted.repos, fetchedAt: persisted.fetchedAt } : null
})()

let _hiddenGemsModuleCache: { repos: RepoRow[]; fetchedAt: number } | null = (() => {
  const persisted = loadCachedHiddenGems()
  return persisted ? { repos: persisted.repos, fetchedAt: persisted.fetchedAt } : null
})()
```

- [ ] **Step 2: Add the three row-data state hooks**

In `src/views/Discover.tsx`, immediately after the existing `const [rowRepos, setRowRepos] = useState<RepoRow[]>([])` declaration (line 126), add:

```typescript
const [hotTodayRowRepos, setHotTodayRowRepos] = useState<RepoRow[]>(
  () => _hotTodayModuleCache?.repos ?? []
)
const [trendingWeekRowRepos, setTrendingWeekRowRepos] = useState<RepoRow[]>(
  () => _trendingWeekModuleCache?.repos ?? []
)
const [hiddenGemsRowRepos, setHiddenGemsRowRepos] = useState<RepoRow[]>(
  () => _hiddenGemsModuleCache?.repos ?? []
)
```

- [ ] **Step 3: Import the query builder helpers**

Update the `discoverQueries` import block (lines 29-32):

```typescript
import {
  type ViewModeKey,
  buildViewModeQuery, getViewModeSort, getSubTypeKeyword,
} from '../lib/discoverQueries'
```

(No code change required — `buildViewModeQuery` and `getViewModeSort` are already imported. This step is verification only.)

Run: `git diff src/views/Discover.tsx -- :^*.test.tsx` to confirm no unintended import changes.

- [ ] **Step 4: Add the three fetch effects**

Immediately after the existing `loadHeroData` `useEffect` block (which ends around line 298), add:

```typescript
useEffect(() => {
  async function loadHotTodayRow() {
    if (_hotTodayModuleCache && Date.now() - _hotTodayModuleCache.fetchedAt < RECOMMENDED_TTL_MS) {
      return // in-session fresh
    }
    try {
      const q = buildViewModeQuery('hot-today', '', '')
      const { sort, order } = getViewModeSort('hot-today')
      const data = await window.api.github.searchRepos(q, sort, order)
      _hotTodayModuleCache = { repos: data, fetchedAt: Date.now() }
      saveCachedHotToday(data)
      setHotTodayRowRepos(data)
    } catch {
      // non-critical — row simply won't render fresh
    }
  }
  loadHotTodayRow()
}, [])

useEffect(() => {
  async function loadTrendingWeekRow() {
    if (_trendingWeekModuleCache && Date.now() - _trendingWeekModuleCache.fetchedAt < RECOMMENDED_TTL_MS) {
      return
    }
    try {
      const q = buildViewModeQuery('trending-week', '', '')
      const { sort, order } = getViewModeSort('trending-week')
      const data = await window.api.github.searchRepos(q, sort, order)
      _trendingWeekModuleCache = { repos: data, fetchedAt: Date.now() }
      saveCachedTrendingWeek(data)
      setTrendingWeekRowRepos(data)
    } catch {
      // non-critical
    }
  }
  loadTrendingWeekRow()
}, [])

useEffect(() => {
  async function loadHiddenGemsRow() {
    if (_hiddenGemsModuleCache && Date.now() - _hiddenGemsModuleCache.fetchedAt < RECOMMENDED_TTL_MS) {
      return
    }
    try {
      const q = buildViewModeQuery('hidden-gems', '', '')
      const { sort, order } = getViewModeSort('hidden-gems')
      const data = await window.api.github.searchRepos(q, sort, order)
      _hiddenGemsModuleCache = { repos: data, fetchedAt: Date.now() }
      saveCachedHiddenGems(data)
      setHiddenGemsRowRepos(data)
    } catch {
      // non-critical
    }
  }
  loadHiddenGemsRow()
}, [])
```

The effects intentionally don't list dependencies — they run once on mount, same pattern as `loadHeroData`.

- [ ] **Step 5: Verify type-check passes**

Run: `npm run build`
Expected: no type errors. The new state hooks and effects are self-contained.

- [ ] **Step 6: Verify existing tests still pass**

Run: `npm test`
Expected: all tests pass. The new state hooks default to empty arrays when no cache; the new effects swallow errors. Discover.test.tsx already mocks `searchRepos` to return one item, so the new effects will succeed silently.

- [ ] **Step 7: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(discover): hydrate hot-today/trending-week/hidden-gems row data

Add module-level SWR caches, useState hooks, and one fetch effect per row,
mirroring the existing _popularModuleCache + loadHeroData pattern. Rows
are not yet rendered — JSX wiring lands in the next task.
"
```

---

## Task 4: Render the three new rows on Home and gate the grid off

**Files:**
- Modify: `src/views/Discover.tsx`

- [ ] **Step 1: Introduce the `showHomeRows` boolean**

Immediately above the JSX `return (` (around line 1050), add:

```typescript
const showHomeRows =
  viewMode === 'home'
  && !topicMode
  && selectedSubtypes.length === 0
  && !inSearchResults
```

(`inSearchResults` is declared at line 1027-1031 and is in scope here.)

- [ ] **Step 2: Rewrite the home/grid JSX to be mutually exclusive**

In `src/views/Discover.tsx`, replace the current home-rows block + `discover-content-inner` block (lines 1098-1225) with the structure below. Note: this preserves every existing prop and callback exactly — only the order, the surrounding conditional, and three added `DiscoverRow` instances change.

```tsx
{showHomeRows ? (
  <>
    {rowRepos.length > 0
      ? <DiscoverHero repo={rowRepos[heroIndex] ?? null} onNavigate={navigateToRepo} />
      : <div className="discover-hero discover-hero--skeleton" />}

    {rowRepos.length > 0 && (
      <DiscoverRow<RepoRow>
        title="Recommended for You"
        items={rowRepos}
        activeIndex={heroIndex}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onMore={() => setViewMode('recommended')}
        onPause={setHeroPaused}
        onAdvance={(delta) => {
          const visible = Math.min(effectiveCols, rowRepos.length)
          const max = Math.max(0, rowRepos.length - visible)
          setHeroIndex((i) => Math.max(0, Math.min(max, i + delta)))
        }}
      />
    )}

    {rankedAgents.length > 0 && (
      <DiscoverRow<AgentRow>
        title="Agents"
        items={rankedAgents}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={a => a.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowAgentCard
            agent={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
          />
        )}
        onMore={() => setViewMode('agents')}
        onAdvance={() => {/* static list; horizontal scroll deferred */}}
      />
    )}

    {hotTodayRowRepos.length > 0 && (
      <DiscoverRow<RepoRow>
        title="Hot today"
        items={hotTodayRowRepos}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onMore={() => setViewMode('hot-today')}
        onAdvance={() => {/* static list; horizontal scroll deferred */}}
      />
    )}

    {trendingWeekRowRepos.length > 0 && (
      <DiscoverRow<RepoRow>
        title="Trending this week"
        items={trendingWeekRowRepos}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onMore={() => setViewMode('trending-week')}
        onAdvance={() => {/* static list; horizontal scroll deferred */}}
      />
    )}

    {repos.length > 0 && (
      <DiscoverRow<RepoRow>
        title="Most Popular"
        items={repos.slice(0, 30)}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onAdvance={() => {/* static list; horizontal scroll deferred */}}
      />
    )}

    {hiddenGemsRowRepos.length > 0 && (
      <DiscoverRow<RepoRow>
        title="Hidden gems"
        items={hiddenGemsRowRepos}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onMore={() => setViewMode('hidden-gems')}
        onAdvance={() => {/* static list; horizontal scroll deferred */}}
      />
    )}
  </>
) : (
  <div className="discover-content-inner">
    {viewMode !== 'home' && (
      <FilterChipRow
        selectedLanguages={selectedLanguages}
        selectedSubtypes={selectedSubtypes}
        activeTags={activeTags}
        filters={appliedFilters}
        activeVerification={activeVerification}
        onRemoveLanguage={(lang) => setSelectedLanguages(prev => prev.filter(l => l !== lang))}
        onRemoveSubtype={(id) => setSelectedSubtypes(prev => prev.filter(s => s !== id))}
        onRemoveTag={(tag) => {
          const next = activeTags.filter(t => t !== tag)
          setActiveTags(next)
          if (next.length === 0) {
            setTopicMode(false)
            loadTrending(appliedFilters)
          } else {
            runTagSearch(next)
          }
        }}
        onClearAdvanced={(key) => setAppliedFilters(prev => ({ ...prev, [key]: undefined }))}
        onVerificationToggle={handleVerificationToggle}
        onSelectedLanguagesChange={setSelectedLanguages}
        onSelectedSubtypesChange={setSelectedSubtypes}
        onFilterChange={setAppliedFilters}
      />
    )}

    {error && <div className="discover-status">Failed to load — {error}</div>}

    <DiscoverGrid
      loading={loading}
      loadingMore={loadingMore}
      error={error}
      visibleRepos={visibleRepos}
      agents={viewMode === 'agents' ? rankedAgents : undefined}
      discoverQuery={discoverQuery}
      layoutPrefs={effectiveLayoutPrefs}
      sentinelRef={sentinelRef}
      gridRef={gridRef}
      verification={verification}
      onNavigate={navigateToRepo}
      onTagClick={addTag}
      onOwnerClick={openProfile}
      focusIndex={kbFocusIndex}
      viewMode={viewMode}
      onStar={handleStar}
      onLanguageClick={handleLanguageClick}
      onSubtypeClick={handleSelectSubtype}
      anchorsByRepoId={anchorsByRepoId}
    />
  </div>
)}
```

- [ ] **Step 3: Verify type-check passes**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: all tests pass. The home-view assertions in `Discover.test.tsx` (none specifically check for a grid presence on home) are unaffected. The non-home test paths still render `DiscoverGrid` exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(discover): render three new curated rows on home, gate grid off

Home view is now purely hero + 6 carousels. The trailing DiscoverGrid is
mutually exclusive with the rows via a single showHomeRows boolean. Row
order: Recommended for You / Agents / Hot today / Trending this week /
Most Popular / Hidden gems.

The new rows' onMore callbacks point at their respective view modes, but
those modes don't yet have grid wiring — next task.
"
```

---

## Task 5: Snapshot normalisation for the new view modes

**Files:**
- Modify: `src/views/Discover.tsx`

**Why this task is small:** `loadTrending`'s else-branch (lines 513-522) already calls `buildTrendingQuery(vm, langKey, filters, subKw)`, which in turn calls `buildViewModeQuery(vm, lang, '')`. Since Task 1 extended `buildViewModeQuery` to handle the new view modes and `getViewModeSort` already returns `stars desc` for any input, the existing else-branch handles `viewMode === 'hot-today' | 'trending-week' | 'hidden-gems'` correctly with **no code change**. Same applies to the `else` branch in `loadMore` (lines 838-846). Only the snapshot-normalisation block needs explicit updating.

A side-effect of this routing: the existing `buildTrendingQuery` adds activity/stars/license filter parts on top of the base query. For hidden-gems (`stars:50..500`), if the user stacks a `stars:>N` filter, the query ends up with both clauses. GitHub will intersect them — an empty set if conflicting. Acceptable for v1 since the chip row visibly shows both filters and the user can remove either. Noted as a follow-up in the open questions section of the spec.

- [ ] **Step 1: Extend snapshot normalisation**

In the snapshot-restoration `useEffect` (currently lines 343-362), replace the `snapshotView` ternary chain (lines 348-351) with:

```typescript
      const snapshotView: ViewModeKey =
          raw === 'recommended'    ? 'recommended'
        : raw === 'agents'         ? 'agents'
        : raw === 'hot-today'      ? 'hot-today'
        : raw === 'trending-week'  ? 'trending-week'
        : raw === 'hidden-gems'    ? 'hidden-gems'
        : 'home'
```

Also widen the cast on line 347 so TypeScript accepts the new values:

```typescript
      const raw = restoredSnapshot.current.viewMode as ViewModeKey | 'all' | 'last-visited' | 'trending'
```

(`'trending'` was already in the list-of-legacy-modes the original code normalised away; adding it explicitly silences a potential type-narrowing warning when comparing `raw === 'trending-week'` since `'trending'` ⊂ `'trending-week'` prefix can confuse readers — explicit is safer.)

- [ ] **Step 2: Verify type-check passes**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 3: Verify all tests pass**

Run: `npm test`
Expected: all tests pass. No existing test exercises the new view modes' grid-mode behavior — the new branches are inert until a user visits one of the new URLs or clicks an `onMore` chevron.

- [ ] **Step 4: Manual smoke check**

The user has confirmed they test UI changes themselves, so this is a hand-off, not an automated step. Note for the user:

- Visit `/discover` → home should show hero + 6 row carousels (Recommended for You / Agents / Hot today / Trending this week / Most Popular / Hidden gems). No grid below.
- Click "Hot today ›" → URL becomes `/discover?view=hot-today`, hero/rows disappear, a `FilterChipRow` + full grid of recently-pushed top-starred repos renders. Infinite scroll loads more.
- Repeat for "Trending this week ›" and "Hidden gems ›". Hidden gems grid should show repos with 50-500 stars.
- Click a card on any of these views → repo page opens. Back button → returns to the same view mode (snapshot restored).
- Top nav still shows three pills (Home / Recommended / Agents). Switching to Home from one of the new views works.

- [ ] **Step 5: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(discover): preserve new view modes through snapshot restore

Snapshot normalisation explicitly whitelists hot-today / trending-week /
hidden-gems so back-navigation lands on the correct view. loadTrending
and loadMore need no change because they already route through
buildTrendingQuery -> buildViewModeQuery, which Task 1 extended to handle
the new modes.
"
```

---

## Self-review

After all five tasks complete, verify:

**Spec coverage:**
- ✓ Three new view modes added (Task 1, spec §New view modes)
- ✓ Three new caches added (Task 2, spec §Caching strategy)
- ✓ Three new module-level + state + fetch effects (Task 3, spec §Components §3 "State")
- ✓ `showHomeRows` gating + three row JSX (Task 4, spec §Components §3 "Grid-gating" and "New row JSX")
- ✓ `loadTrending` query routing — implicit via Task 1's `buildViewModeQuery` extension (spec §Components §3 "Expanded view: query routing")
- ✓ `loadMore` pagination — implicit via the same routing (spec §Components §3 "Expanded view: loadMore pagination")
- ✓ Snapshot normalisation (Task 5, spec §Components §3 "Snapshot restoration")
- ✓ Tests for queries (Task 1) and cache (Task 2). UI integration is verified via existing `Discover.test.tsx` not regressing.

**Type consistency:**
- `ViewModeKey` values used across tasks: `'hot-today'`, `'trending-week'`, `'hidden-gems'` (kebab-case, consistent).
- Storage keys: `'discover-cache.hot-today.v1'`, `'discover-cache.trending-week.v1'`, `'discover-cache.hidden-gems.v1'` (dot-separator, consistent with existing).
- State hook names: `hotTodayRowRepos`, `trendingWeekRowRepos`, `hiddenGemsRowRepos` (camelCase, consistent).
- Module cache names: `_hotTodayModuleCache`, `_trendingWeekModuleCache`, `_hiddenGemsModuleCache` (underscore + camelCase, consistent with existing).

**Final verification:**

After Task 5's commit, run:

```bash
npm test
npm run build
git log --oneline -6
```

Expected:
- All tests pass.
- No TypeScript errors.
- 5 new commits on `main` (one per task), each with a clean conventional-commit message.
