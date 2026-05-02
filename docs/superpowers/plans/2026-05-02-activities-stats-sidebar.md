# Activities Stats Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a five-section enriched stats sidebar to the Activities tab showing GitHub vitals, a derived health score, commit momentum chart, security stub, and personal engagement data.

**Architecture:** A new service `getRepoStats` (in `electron/services/repoStats.ts`) makes 4 parallel GitHub API calls and reads local SQLite for engagement data. An IPC handler + preload bridge expose it to the renderer via `window.api.github.getRepoStats`. The `useRepoStats` hook manages loading/error state. `RepoStatsSidebar` renders all five sections and replaces the existing `stats-tile` block inside `statsSlotNode` in `RepoDetail.tsx` — `RepoNotes` and the Skills Folder tile are preserved.

**Tech Stack:** Electron IPC, better-sqlite3, GitHub REST API v3, React, inline SVG for charts, Vitest, @testing-library/react

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/types/repoStats.ts` | Create | `RepoStats` interface + status union types |
| `electron/services/repoStats.ts` | Create | `computeHealthScore` pure fn + `getRepoStats` service |
| `electron/services/repoStats.test.ts` | Create | Tests for both exported functions |
| `electron/main.ts` | Modify (after line 708) | Register `github:getRepoStats` IPC handler |
| `electron/preload.ts` | Modify (after line 38) | Expose `getRepoStats` on `window.api.github` |
| `src/env.d.ts` | Modify (after line 83) | Add type declaration for `getRepoStats` |
| `src/hooks/useRepoStats.ts` | Create | React hook, mirrors `useRepoUserEvents` pattern |
| `src/hooks/useRepoStats.test.ts` | Create | Hook tests with mocked IPC |
| `src/components/RepoStatsSidebar.tsx` | Create | Five-section sidebar component |
| `src/components/RepoStatsSidebar.css` | Create | Sidebar styles |
| `src/components/RepoStatsSidebar.test.tsx` | Create | Component tests |
| `src/views/RepoDetail.tsx` | Modify (lines 534, 1173–1199) | Wire hook + replace `stats-tile` block |

---

## Task 1: Type definitions

**Files:**
- Create: `src/types/repoStats.ts`

- [ ] **Step 1: Create the type file**

```typescript
// src/types/repoStats.ts
export type HealthStatus = 'active' | 'slow' | 'stale'
export type IssueVelocity = 'healthy' | 'backlogged' | 'critical'

export interface RepoStats {
  vitals: {
    stars: number
    forks: number
    openIssues: number
    contributors: number | null
  }
  health: {
    score: number                    // 0–100
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDate: string | null   // ISO date string; null = no releases
    lastReleaseDaysAgo: number | null
  }
  momentum: {
    monthlyCommits: number[]         // length 6, oldest first
    trend: 'up' | 'stable' | 'down'
  } | null                           // null = GitHub returned 202 (computing)
  security: {
    available: boolean
    vulnerabilities: { high: number; moderate: number; low: number } | null
    hasSecurityPolicy: boolean | null
    codeScanningEnabled: boolean | null
  }
  engagement: {
    starredAt: string | null
    forkedAt: string | null
    skillsLearned: number
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/repoStats.ts
git commit -m "feat(repo-stats): add RepoStats type"
```

---

## Task 2: computeHealthScore — TDD

**Files:**
- Create: `electron/services/repoStats.ts` (just the pure function for now)
- Create: `electron/services/repoStats.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// electron/services/repoStats.test.ts
import { describe, it, expect } from 'vitest'
import { computeHealthScore } from './repoStats'

describe('computeHealthScore', () => {
  it('returns 100 for a perfect repo (recent commit, zero issues, recent release)', () => {
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 0, lastReleaseDaysAgo: 0 }))
      .toBe(100)
  })

  it('returns 0 for a completely stale repo', () => {
    expect(computeHealthScore({ daysSinceCommit: 365, openIssues: 500, lastReleaseDaysAgo: 730 }))
      .toBe(0)
  })

  it('returns 0 for the commit component when last commit is > 180 days ago', () => {
    // commit=0, issue=100 (0.4), release=100 (0.2) → 60
    expect(computeHealthScore({ daysSinceCommit: 200, openIssues: 0, lastReleaseDaysAgo: 0 }))
      .toBe(60)
  })

  it('contributes 0 for the release component when lastReleaseDaysAgo is null', () => {
    // commit=100 (0.4), issue=100 (0.4), release=0 (0.2) → 80
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 0, lastReleaseDaysAgo: null }))
      .toBe(80)
  })

  it('returns 0 for the issue component when openIssues >= 200', () => {
    // commit=100 (0.4), issue=0 (0.4), release=100 (0.2) → 60
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 200, lastReleaseDaysAgo: 0 }))
      .toBe(60)
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test -- repoStats.test
```
Expected: 5 failures — `computeHealthScore` is not defined.

- [ ] **Step 3: Implement computeHealthScore**

```typescript
// electron/services/repoStats.ts
import type Database from 'better-sqlite3'
import { githubHeaders } from '../github'
import type { RepoStats, HealthStatus, IssueVelocity } from '../../src/types/repoStats'

export function computeHealthScore(data: {
  daysSinceCommit: number
  openIssues: number
  lastReleaseDaysAgo: number | null
}): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const commitScore  = clamp(1 - (data.daysSinceCommit - 7)        / 173) * 100
  const issueScore   = clamp(1 - data.openIssues                    / 200) * 100
  const releaseScore = data.lastReleaseDaysAgo === null
    ? 0
    : clamp(1 - (data.lastReleaseDaysAgo - 30) / 335) * 100
  return Math.round(commitScore * 0.4 + issueScore * 0.4 + releaseScore * 0.2)
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test -- repoStats.test
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/repoStats.ts electron/services/repoStats.test.ts
git commit -m "feat(repo-stats): add computeHealthScore with tests"
```

---

## Task 3: getRepoStats service — TDD

**Files:**
- Modify: `electron/services/repoStats.ts` (add full service)
- Modify: `electron/services/repoStats.test.ts` (add service tests)

- [ ] **Step 1: Write failing tests for the service**

Append to `electron/services/repoStats.test.ts`. The `describe`, `it`, and `expect` imports are already at the top of the file from Task 2 — add `vi` and `beforeEach` to that existing import line rather than duplicating it. Also add the `Database` import:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { computeHealthScore, getRepoStats } from './repoStats'

// ── helpers ──────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY, owner TEXT, name TEXT,
      starred_at TEXT, forked_at TEXT, archived_at TEXT, created_at TEXT
    );
    CREATE TABLE skills (repo_id TEXT, filename TEXT, generated_at TEXT);
    CREATE TABLE sub_skills (repo_id TEXT, skill_type TEXT, filename TEXT, generated_at TEXT);
  `)
  return db
}

function okJson(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const repoPayload = {
  stargazers_count: 100, forks_count: 10, open_issues_count: 5,
}
const commitsPayload = [{ commit: { committer: { date: new Date().toISOString() } } }]
const activityPayload = Array.from({ length: 52 }, (_, i) => ({ week: i, total: i < 26 ? 5 : 10 }))
const alertsPayload = [
  { security_vulnerability: { severity: 'high' } },
  { security_vulnerability: { severity: 'moderate' } },
]
const profilePayload = { files: { security: { url: 'https://...' } } }

// ── tests ────────────────────────────────────────────────────────────────────

describe('getRepoStats', () => {
  const mockFetch = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  it('maps GitHub API responses to RepoStats', async () => {
    // 4 main calls + 3 security calls
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))                    // repo
      .mockResolvedValueOnce(okJson([{ login: 'a' }]))              // contributors (1, no Link)
      .mockResolvedValueOnce(okJson(commitsPayload))                 // commits
      .mockResolvedValueOnce(okJson(activityPayload))                // commit_activity
      .mockResolvedValueOnce(okJson(alertsPayload))                  // dependabot alerts
      .mockResolvedValueOnce(okJson(profilePayload))                 // community/profile
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))   // code scanning

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token', null)

    expect(result.vitals.stars).toBe(100)
    expect(result.vitals.forks).toBe(10)
    expect(result.vitals.openIssues).toBe(5)
    expect(result.vitals.contributors).toBe(1)
    expect(result.security.available).toBe(true)
    expect(result.security.vulnerabilities).toEqual({ high: 1, moderate: 1, low: 0 })
    expect(result.momentum).not.toBeNull()
    expect(result.momentum?.monthlyCommits).toHaveLength(6)
  })

  it('returns momentum: null when commit_activity returns 202', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(commitsPayload))
      .mockResolvedValueOnce(new Response('', { status: 202 }))     // 202 computing
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token', null)

    expect(result.momentum).toBeNull()
  })

  it('still returns vitals when commits call fails (partial failure)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockRejectedValueOnce(new Error('timeout'))                   // commits fails
      .mockResolvedValueOnce(okJson(activityPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token', null)

    expect(result.vitals.stars).toBe(100)         // vitals still populated
    expect(result.health.score).toBeGreaterThanOrEqual(0)  // score computed with fallback
  })

  it('reads engagement data from local DB', async () => {
    mockFetch.mockResolvedValue(okJson([]))  // all API calls return empty

    const db = createTestDb()
    db.prepare('INSERT INTO repos VALUES (?,?,?,?,?,?,?)').run(
      'r1', 'owner', 'repo', '2026-01-12T00:00:00Z', null, null, null
    )
    db.prepare('INSERT INTO skills VALUES (?,?,?)').run('r1', 'repo.skill.md', '2026-02-01T00:00:00Z')
    db.prepare('INSERT INTO sub_skills VALUES (?,?,?,?)').run('r1', 'components', 'repo.comp.skill.md', '2026-03-01T00:00:00Z')

    const result = await getRepoStats(db, 'owner', 'repo', 'token', null)

    expect(result.engagement.starredAt).toBe('2026-01-12T00:00:00Z')
    expect(result.engagement.skillsLearned).toBe(2)
  })

  it('parses contributor count from Link header', async () => {
    const contribRes = new Response('[]', {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/o/r/contributors?page=42>; rel="last"' },
    })
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(contribRes)
      .mockResolvedValueOnce(okJson(commitsPayload))
      .mockResolvedValueOnce(okJson(activityPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token', null)

    expect(result.vitals.contributors).toBe(42)
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test -- repoStats.test
```
Expected: the new 5 tests fail — `getRepoStats` is not defined.

- [ ] **Step 3: Implement the full service**

Add to `electron/services/repoStats.ts` (after the `computeHealthScore` export):

```typescript
// ── private helpers ──────────────────────────────────────────────────────────

interface RepoCoreData {
  stargazers_count: number
  forks_count: number
  open_issues_count: number
}

interface CommitItem {
  commit: { committer: { date: string } }
}

interface WeekActivity { week: number; total: number }

async function fetchSecurity(
  base: string,
  headers: Record<string, string>,
): Promise<RepoStats['security']> {
  try {
    const [alertsRes, profileRes, scanRes] = await Promise.all([
      fetch(`${base}/dependabot/alerts?state=open`, { headers }),
      fetch(`${base}/community/profile`,            { headers }),
      fetch(`${base}/code-scanning/alerts?per_page=1`, { headers }),
    ])
    if (alertsRes.status === 403) {
      return { available: false, vulnerabilities: null, hasSecurityPolicy: null, codeScanningEnabled: null }
    }
    const alerts: Array<{ security_vulnerability: { severity: string } }> =
      alertsRes.ok ? await alertsRes.json().catch(() => []) : []
    const profile: { files: { security: unknown } } | null =
      profileRes.ok ? await profileRes.json().catch(() => null) : null
    return {
      available: true,
      vulnerabilities: {
        high:     alerts.filter(a => a.security_vulnerability.severity === 'high').length,
        moderate: alerts.filter(a => a.security_vulnerability.severity === 'moderate').length,
        low:      alerts.filter(a => a.security_vulnerability.severity === 'low').length,
      },
      hasSecurityPolicy:  profile ? profile.files.security !== null : null,
      codeScanningEnabled: scanRes.status === 200 ? true : scanRes.status === 404 ? false : null,
    }
  } catch {
    return { available: false, vulnerabilities: null, hasSecurityPolicy: null, codeScanningEnabled: null }
  }
}

function getEngagement(
  db: Database.Database,
  owner: string,
  name: string,
): RepoStats['engagement'] {
  const row = db.prepare(
    'SELECT id, starred_at, forked_at FROM repos WHERE owner=? AND name=?'
  ).get(owner, name) as { id: string; starred_at: string | null; forked_at: string | null } | undefined

  if (!row) return { starredAt: null, forkedAt: null, skillsLearned: 0 }

  const masterCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM skills WHERE repo_id=? AND generated_at IS NOT NULL'
  ).get(row.id) as { cnt: number }).cnt
  const compCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM sub_skills WHERE repo_id=? AND generated_at IS NOT NULL'
  ).get(row.id) as { cnt: number }).cnt

  return { starredAt: row.starred_at, forkedAt: row.forked_at, skillsLearned: masterCount + compCount }
}

// ── public API ───────────────────────────────────────────────────────────────

export async function getRepoStats(
  db: Database.Database,
  owner: string,
  name: string,
  token: string | null,
  lastReleaseDate: string | null,
): Promise<RepoStats> {
  const h = githubHeaders(token)
  const base = `https://api.github.com/repos/${owner}/${name}`

  // Parallel main fetches — each wrapped in .catch so one failure doesn't reject all
  const [repoRes, contributorRes, commitRes, activityRes] = await Promise.all([
    fetch(base,                                          { headers: h }).catch(() => null),
    fetch(`${base}/contributors?per_page=1`,             { headers: h }).catch(() => null),
    fetch(`${base}/commits?per_page=1`,                  { headers: h }).catch(() => null),
    fetch(`${base}/stats/commit_activity`,               { headers: h }).catch(() => null),
  ])

  const repoData: RepoCoreData | null =
    repoRes?.ok ? await repoRes.json().catch(() => null) : null
  const lastCommit: CommitItem[] | null =
    commitRes?.ok ? await commitRes.json().catch(() => null) : null

  // Contributor count via Link header pagination
  let contributors: number | null = null
  if (contributorRes?.ok) {
    const link = contributorRes.headers.get('Link')
    if (link) {
      const m = link.match(/[?&]page=(\d+)>; rel="last"/)
      contributors = m ? parseInt(m[1], 10) : 1
    } else {
      const arr: unknown[] = await contributorRes.json().catch(() => [])
      contributors = Array.isArray(arr) ? arr.length : null
    }
  }

  // Commit activity — null on 202 ("GitHub is computing stats")
  let momentum: RepoStats['momentum'] = null
  if (activityRes?.status === 200) {
    const weeks: WeekActivity[] = await activityRes.json().catch(() => [])
    if (weeks.length >= 24) {
      const last24 = weeks.slice(-24)
      const monthly = Array.from({ length: 6 }, (_, i) =>
        last24.slice(i * 4, i * 4 + 4).reduce((s, w) => s + w.total, 0)
      )
      const first3 = monthly.slice(0, 3).reduce((a, b) => a + b, 0) / 3
      const last3  = monthly.slice(3).reduce((a, b) => a + b, 0) / 3
      const trend: 'up' | 'stable' | 'down' =
        last3 > first3 * 1.1 ? 'up' : last3 < first3 * 0.9 ? 'down' : 'stable'
      momentum = { monthlyCommits: monthly, trend }
    }
  }

  // Health score
  const lastCommitDate = lastCommit?.[0]?.commit?.committer?.date ?? null
  const daysSinceCommit = lastCommitDate
    ? Math.floor((Date.now() - new Date(lastCommitDate).getTime()) / 86_400_000)
    : 999
  const openIssues = repoData?.open_issues_count ?? 0
  const lastReleaseDaysAgo = lastReleaseDate
    ? Math.floor((Date.now() - new Date(lastReleaseDate).getTime()) / 86_400_000)
    : null

  const score = computeHealthScore({ daysSinceCommit, openIssues, lastReleaseDaysAgo })
  const maintenance: HealthStatus =
    daysSinceCommit < 30 ? 'active' : daysSinceCommit < 90 ? 'slow' : 'stale'
  const issueVelocity: IssueVelocity =
    openIssues < 50 ? 'healthy' : openIssues < 200 ? 'backlogged' : 'critical'

  return {
    vitals: {
      stars:       repoData?.stargazers_count ?? 0,
      forks:       repoData?.forks_count      ?? 0,
      openIssues,
      contributors,
    },
    health: { score, maintenance, issueVelocity, lastReleaseDate, lastReleaseDaysAgo },
    momentum,
    security: await fetchSecurity(base, h),
    engagement: getEngagement(db, owner, name),
  }
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npm run test -- repoStats.test
```
Expected: 10 passing (5 from Task 2 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add electron/services/repoStats.ts electron/services/repoStats.test.ts
git commit -m "feat(repo-stats): add getRepoStats service with tests"
```

---

## Task 4: IPC wiring

**Files:**
- Modify: `electron/main.ts` — after line 708
- Modify: `electron/preload.ts` — after line 38
- Modify: `src/env.d.ts` — after line 83

- [ ] **Step 1: Add IPC handler to `electron/main.ts`**

Insert after line 708 (after the `github:getRepoUserEvents` handler):

```typescript
ipcMain.handle('github:getRepoStats', async (
  _event, owner: string, name: string, lastReleaseDate: string | null
) => {
  const db = getDb(app.getPath('userData'))
  const token = getToken() ?? null
  return getRepoStats(db, owner, name, token, lastReleaseDate)
})
```

Also add the import at the top of `electron/main.ts` with the other service imports:
```typescript
import { getRepoStats } from './services/repoStats'
```

- [ ] **Step 2: Add preload bridge to `electron/preload.ts`**

Insert after line 38 (after the `getRepoUserEvents` entry):

```typescript
    getRepoStats: (owner: string, name: string, lastReleaseDate: string | null) =>
      ipcRenderer.invoke('github:getRepoStats', owner, name, lastReleaseDate),
```

- [ ] **Step 3: Add type declaration to `src/env.d.ts`**

Insert after line 83 (after the `getRepoUserEvents` type):

```typescript
        getRepoStats: (owner: string, name: string, lastReleaseDate: string | null) => Promise<import('./types/repoStats').RepoStats>
```

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts src/env.d.ts
git commit -m "feat(repo-stats): wire getRepoStats IPC handler and preload bridge"
```

---

## Task 5: useRepoStats hook — TDD

**Files:**
- Create: `src/hooks/useRepoStats.ts`
- Create: `src/hooks/useRepoStats.test.ts`

- [ ] **Step 1: Write the failing hook tests**

```typescript
// src/hooks/useRepoStats.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRepoStats } from './useRepoStats'
import type { RepoStats } from '../types/repoStats'

const mockGetRepoStats = vi.fn()
vi.stubGlobal('window', {
  api: { github: { getRepoStats: mockGetRepoStats } },
})

const mockStats: RepoStats = {
  vitals: { stars: 100, forks: 10, openIssues: 5, contributors: 20 },
  health: {
    score: 90, maintenance: 'active', issueVelocity: 'healthy',
    lastReleaseDate: '2026-04-01T00:00:00Z', lastReleaseDaysAgo: 31,
  },
  momentum: { monthlyCommits: [10, 20, 15, 30, 25, 40], trend: 'up' },
  security: {
    available: true,
    vulnerabilities: { high: 0, moderate: 1, low: 2 },
    hasSecurityPolicy: true, codeScanningEnabled: false,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: null, skillsLearned: 2 },
}

describe('useRepoStats', () => {
  beforeEach(() => mockGetRepoStats.mockReset())

  it('returns loading immediately without calling IPC when owner is undefined', () => {
    const { result } = renderHook(() => useRepoStats(undefined, 'repo', null))
    expect(result.current).toBe('loading')
    expect(mockGetRepoStats).not.toHaveBeenCalled()
  })

  it('transitions from loading to stats on success', async () => {
    mockGetRepoStats.mockResolvedValueOnce(mockStats)
    const { result } = renderHook(() => useRepoStats('owner', 'repo', null))
    expect(result.current).toBe('loading')
    await waitFor(() => expect(result.current).toEqual(mockStats))
  })

  it('transitions to error when IPC rejects', async () => {
    mockGetRepoStats.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useRepoStats('owner', 'repo', null))
    await waitFor(() => expect(result.current).toBe('error'))
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test -- useRepoStats.test
```
Expected: 3 failures — `useRepoStats` is not defined.

- [ ] **Step 3: Implement the hook**

```typescript
// src/hooks/useRepoStats.ts
import { useEffect, useState } from 'react'
import type { RepoStats } from '../types/repoStats'

export function useRepoStats(
  owner: string | undefined,
  name: string | undefined,
  lastReleaseDate: string | null,
): RepoStats | 'loading' | 'error' {
  const [stats, setStats] = useState<RepoStats | 'loading' | 'error'>('loading')

  useEffect(() => {
    if (!owner || !name) { setStats('loading'); return }
    let cancelled = false
    setStats('loading')
    window.api.github.getRepoStats(owner, name, lastReleaseDate)
      .then(s  => { if (!cancelled) setStats(s ?? 'error') })
      .catch(() => { if (!cancelled) setStats('error') })
    return () => { cancelled = true }
  }, [owner, name, lastReleaseDate])

  return stats
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npm run test -- useRepoStats.test
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRepoStats.ts src/hooks/useRepoStats.test.ts
git commit -m "feat(repo-stats): add useRepoStats hook with tests"
```

---

## Task 6: RepoStatsSidebar component — TDD

**Files:**
- Create: `src/components/RepoStatsSidebar.test.tsx`
- Create: `src/components/RepoStatsSidebar.tsx`
- Create: `src/components/RepoStatsSidebar.css`

- [ ] **Step 1: Write the failing component tests**

```typescript
// src/components/RepoStatsSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoStatsSidebar } from './RepoStatsSidebar'
import type { RepoStats } from '../types/repoStats'

const mockStats: RepoStats = {
  vitals: { stars: 100, forks: 10, openIssues: 5, contributors: 89 },
  health: {
    score: 80, maintenance: 'active', issueVelocity: 'backlogged',
    lastReleaseDate: '2026-04-20T00:00:00Z', lastReleaseDaysAgo: 12,
  },
  momentum: { monthlyCommits: [12, 18, 10, 22, 19, 31], trend: 'up' },
  security: {
    available: true,
    vulnerabilities: { high: 2, moderate: 1, low: 0 },
    hasSecurityPolicy: true, codeScanningEnabled: false,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: '2026-02-03T00:00:00Z', skillsLearned: 2 },
}

describe('RepoStatsSidebar', () => {
  it('renders loading skeleton when stats is loading', () => {
    const { container } = render(<RepoStatsSidebar stats="loading" />)
    expect(container.querySelector('.stats-sidebar-loading')).not.toBeNull()
  })

  it('renders error message when stats is error', () => {
    render(<RepoStatsSidebar stats="error" />)
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
  })

  it('renders vitals section labels', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText(/stars/i)).toBeInTheDocument()
    expect(screen.getByText(/forks/i)).toBeInTheDocument()
    expect(screen.getByText(/contributors/i)).toBeInTheDocument()
  })

  it('renders health score', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('renders total vulnerability count when security is available', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    // 2 high + 1 moderate + 0 low = 3 total
    expect(screen.getByText(/3 vulnerabilit/i)).toBeInTheDocument()
  })

  it('renders security unavailable state', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: { available: false, vulnerabilities: null, hasSecurityPolicy: null, codeScanningEnabled: null },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/not available/i)).toBeInTheDocument()
  })

  it('renders computing label when momentum is null', () => {
    const stats: RepoStats = { ...mockStats, momentum: null }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/computing/i)).toBeInTheDocument()
  })

  it('renders engagement section with skills learned count', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test -- RepoStatsSidebar.test
```
Expected: 8 failures.

- [ ] **Step 3: Implement the component**

```typescript
// src/components/RepoStatsSidebar.tsx
import { relativeTime } from '../utils/relativeTime'
import type { RepoStats, HealthStatus, IssueVelocity } from '../types/repoStats'
import './RepoStatsSidebar.css'

interface Props { stats: RepoStats | 'loading' | 'error' }

// Mirrors formatCount in RepoCard — avoids importing from a component file
function fmt(n: number | null | undefined): string {
  if (n == null) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const STATUS_COLOR: Record<'active' | 'slow' | 'stale' | 'healthy' | 'backlogged' | 'critical', string> = {
  active: 'var(--green)', slow: 'var(--yellow)', stale: 'var(--red)',
  healthy: 'var(--green)', backlogged: 'var(--yellow)', critical: 'var(--red)',
}

export function RepoStatsSidebar({ stats }: Props) {
  if (stats === 'loading') return <div className="stats-sidebar-loading" />
  if (stats === 'error')   return <div className="stats-sidebar-error">Failed to load stats.</div>

  const { vitals, health, momentum, security, engagement } = stats
  const totalVulns = security.vulnerabilities
    ? security.vulnerabilities.high + security.vulnerabilities.moderate + security.vulnerabilities.low
    : 0

  const healthColor = health.score >= 70 ? 'var(--green)' : health.score >= 40 ? 'var(--yellow)' : 'var(--red)'
  const circumference = 2 * Math.PI * 16
  const filled = (health.score / 100) * circumference

  return (
    <div className="stats-sidebar-enriched">

      {/* ── Vitals ── */}
      <section className="stats-section">
        <div className="stats-section-label">Vitals</div>
        <div className="stats-vitals-grid">
          {[
            { label: 'stars',        val: fmt(vitals.stars) },
            { label: 'forks',        val: fmt(vitals.forks) },
            { label: 'open issues',  val: fmt(vitals.openIssues) },
            { label: 'contributors', val: fmt(vitals.contributors) },
          ].map(({ label, val }) => (
            <div key={label} className="stats-vitals-cell">
              <span className="stats-vitals-val">{val}</span>
              <span className="stats-vitals-key">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="stats-divider" />

      {/* ── Health ── */}
      <section className="stats-section">
        <div className="stats-section-label">Health</div>
        <div className="stats-health-row">
          <svg width="44" height="44" viewBox="0 0 44 44" className="stats-donut">
            <circle cx="22" cy="22" r="16" fill="none" stroke="var(--bg3)" strokeWidth="5" />
            <circle
              cx="22" cy="22" r="16" fill="none"
              stroke={healthColor}
              strokeWidth="5"
              strokeDasharray={`${filled} ${circumference}`}
              strokeDashoffset={circumference / 4}
              strokeLinecap="round"
            />
            <text x="22" y="26" textAnchor="middle" fill="var(--t1)" fontSize="10" fontFamily="inherit" fontWeight="bold">
              {health.score}
            </text>
          </svg>
          <div>
            <div className="stats-health-label" style={{ color: healthColor }}>
              {health.maintenance === 'active' ? 'Actively maintained' :
               health.maintenance === 'slow'   ? 'Slowing down' : 'Stale'}
            </div>
            <div className="stats-health-sub">Score out of 100</div>
          </div>
        </div>
        <div className="stats-signal-list">
          <SignalRow label="Maintenance" status={health.maintenance} />
          <SignalRow label="Issue velocity" status={health.issueVelocity} />
          <div className="stats-signal">
            <span className="stats-signal-label">Last release</span>
            <span className="stats-signal-val">
              {health.lastReleaseDate ? relativeTime(health.lastReleaseDate) : 'No releases'}
            </span>
          </div>
        </div>
      </section>

      <div className="stats-divider" />

      {/* ── Momentum ── */}
      <section className="stats-section">
        <div className="stats-section-label">Momentum</div>
        {momentum === null ? (
          <div className="stats-computing">Stats computing on GitHub…</div>
        ) : (
          <>
            <div className="stats-bars">
              {momentum.monthlyCommits.map((count, i) => {
                const max = Math.max(...momentum.monthlyCommits, 1)
                return (
                  <div
                    key={i}
                    className={`stats-bar${i === 5 ? ' stats-bar--current' : ''}`}
                    style={{ height: `${Math.round((count / max) * 100)}%` }}
                  />
                )
              })}
            </div>
            <div className="stats-trend">
              {momentum.trend === 'up' ? '↑ Trending up' :
               momentum.trend === 'down' ? '↓ Declining' : '→ Stable'}
            </div>
            <div className="stats-bars-legend">Commits/month — last 6mo</div>
          </>
        )}
      </section>

      <div className="stats-divider" />

      {/* ── Security ── */}
      <section className="stats-section">
        <div className="stats-section-label">Security</div>
        {!security.available ? (
          <div className="stats-computing">Security data not available</div>
        ) : (
          <>
            {security.vulnerabilities && (
              <div className="stats-vuln-row">
                <span className="stats-vuln-icon">⚠</span>
                <div>
                  <div className="stats-vuln-count">
                    {totalVulns} {totalVulns === 1 ? 'vulnerability' : 'vulnerabilities'}
                  </div>
                  <div className="stats-vuln-breakdown">
                    {security.vulnerabilities.high}h · {security.vulnerabilities.moderate}m · {security.vulnerabilities.low}l
                  </div>
                </div>
              </div>
            )}
            <div className="stats-signal-list">
              {security.hasSecurityPolicy !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Security policy</span>
                  <Dot active={security.hasSecurityPolicy} />
                </div>
              )}
              {security.codeScanningEnabled !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Code scanning</span>
                  <Dot active={security.codeScanningEnabled} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <div className="stats-divider" />

      {/* ── Your Engagement ── */}
      <section className="stats-section">
        <div className="stats-section-label">Your Engagement</div>
        <div className="stats-signal-list">
          <div className="stats-signal">
            <span className="stats-signal-label">Starred</span>
            <span className="stats-signal-val">
              {engagement.starredAt ? relativeTime(engagement.starredAt) : '—'}
            </span>
          </div>
          {engagement.forkedAt && (
            <div className="stats-signal">
              <span className="stats-signal-label">Forked</span>
              <span className="stats-signal-val">{relativeTime(engagement.forkedAt)}</span>
            </div>
          )}
          <div className="stats-signal">
            <span className="stats-signal-label">Skills learned</span>
            <span className="stats-signal-val">{engagement.skillsLearned}</span>
          </div>
        </div>
      </section>

    </div>
  )
}

// ── private sub-components ───────────────────────────────────────────────────

function SignalRow({ label, status }: { label: string; status: HealthStatus | IssueVelocity }) {
  const labels: Record<string, string> = {
    active: 'Active', slow: 'Slow', stale: 'Stale',
    healthy: 'Healthy', backlogged: 'Backlogged', critical: 'Critical',
  }
  return (
    <div className="stats-signal">
      <span className="stats-signal-label">{label}</span>
      <span className="stats-signal-status" style={{ color: STATUS_COLOR[status] }}>
        ● {labels[status]}
      </span>
    </div>
  )
}

function Dot({ active }: { active: boolean }) {
  return (
    <span style={{ color: active ? 'var(--green)' : 'var(--red)' }}>
      ● {active ? 'Present' : 'Absent'}
    </span>
  )
}
```

- [ ] **Step 4: Create the CSS file**

```css
/* src/components/RepoStatsSidebar.css */

.stats-sidebar-loading {
  height: 120px;
  border-radius: 6px;
  background: var(--bg2);
  opacity: 0.5;
}

.stats-sidebar-error {
  font-size: 11px;
  color: var(--t3);
  padding: 8px 0;
}

.stats-sidebar-enriched {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.stats-section {
  padding: 10px 0;
}

.stats-section-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--accent);
  margin-bottom: 8px;
}

.stats-divider {
  height: 1px;
  background: var(--bg3);
}

/* Vitals */
.stats-vitals-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.stats-vitals-cell {
  background: var(--bg2);
  padding: 6px 8px;
  border-radius: 5px;
}

.stats-vitals-val {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
}

.stats-vitals-key {
  display: block;
  font-size: 9px;
  color: var(--t3);
}

/* Health */
.stats-health-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.stats-health-label {
  font-size: 11px;
  font-weight: 600;
}

.stats-health-sub {
  font-size: 9px;
  color: var(--t3);
}

/* Signals */
.stats-signal-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stats-signal {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.stats-signal-label { color: var(--t3); }
.stats-signal-val   { color: var(--t2); }
.stats-signal-status { font-size: 10px; }

/* Momentum bars */
.stats-bars {
  display: flex;
  gap: 3px;
  align-items: flex-end;
  height: 36px;
  margin-bottom: 4px;
}

.stats-bar {
  flex: 1;
  background: var(--bg3);
  border-radius: 2px 2px 0 0;
  min-height: 2px;
}

.stats-bar--current {
  background: var(--accent);
  opacity: 0.85;
}

.stats-trend {
  font-size: 10px;
  color: var(--t2);
  margin-bottom: 2px;
}

.stats-bars-legend {
  font-size: 9px;
  color: var(--t3);
}

.stats-computing {
  font-size: 10px;
  color: var(--t3);
  font-style: italic;
}

/* Security */
.stats-vuln-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: color-mix(in srgb, var(--red) 12%, transparent);
  border-radius: 5px;
  padding: 6px 8px;
  margin-bottom: 6px;
}

.stats-vuln-icon { font-size: 14px; }

.stats-vuln-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--red);
}

.stats-vuln-breakdown {
  font-size: 9px;
  color: var(--t3);
}
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
npm run test -- RepoStatsSidebar.test
```
Expected: 8 passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoStatsSidebar.tsx src/components/RepoStatsSidebar.css src/components/RepoStatsSidebar.test.tsx
git commit -m "feat(repo-stats): add RepoStatsSidebar component with tests"
```

---

## Task 7: RepoDetail wiring

**Files:**
- Modify: `src/views/RepoDetail.tsx`

- [ ] **Step 1: Add import at the top of RepoDetail.tsx**

Find the existing imports block and add:

```typescript
import { useRepoStats } from '../hooks/useRepoStats'
import { RepoStatsSidebar } from '../components/RepoStatsSidebar'
```

- [ ] **Step 2: Derive lastReleaseDate and call useRepoStats**

After line 534 (`const userEvents = useRepoUserEvents(owner, name)`), add:

```typescript
  const lastReleaseDate = Array.isArray(releases) && releases.length > 0
    ? (releases as ReleaseRow[])[0].published_at
    : null
  const repoStats = useRepoStats(owner, name, lastReleaseDate)

- [ ] **Step 3: Replace the stats-tile block in statsSlotNode**

In `statsSlotNode` (around line 1173), replace the block:

```typescript
      {/* ── Stats tile ── */}
      {repo && (
        <div className="stats-tile">
          ...
        </div>
      )}
```

with:

```typescript
      {/* ── Enriched stats sidebar ── */}
      <RepoStatsSidebar stats={repoStats} />
```

The `{repo && (…)}` guard is intentionally dropped — `RepoStatsSidebar` handles the loading state itself. The `RepoNotes` component above it (line 1170) and the Skills Folder tile below (line 1201+) are left unchanged.

- [ ] **Step 4: Run the full test suite**

```bash
npm run test
```
Expected: all tests pass. If TypeScript errors appear for `published_at`, adjust the field access in Step 2 to match the actual `ReleaseRow` type.

- [ ] **Step 5: Commit**

```bash
git add src/views/RepoDetail.tsx
git commit -m "feat(repo-stats): wire RepoStatsSidebar into RepoDetail Activities tab"
```
