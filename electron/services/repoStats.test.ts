// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { computeHealthScore, getRepoStats } from './repoStats'

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

  it('returns 0 for the issue component at the boundary (openIssues = 200) and beyond', () => {
    // commit=100 (0.4), issue=0 (0.4), release=100 (0.2) → 60
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 200, lastReleaseDaysAgo: 0 }))
      .toBe(60)
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 201, lastReleaseDaysAgo: 0 }))
      .toBe(60)
  })
})

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
    CREATE TABLE repo_security_cache (
      owner TEXT NOT NULL, name TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );
    CREATE TABLE repo_stats_cache (
      owner TEXT NOT NULL, name TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );
    CREATE TABLE repo_momentum_cache (
      owner TEXT NOT NULL, name TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );
    CREATE TABLE http_etag_cache (
      url TEXT PRIMARY KEY,
      etag TEXT NOT NULL,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
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
  {
    number: 1,
    html_url: 'https://github.com/owner/repo/security/dependabot/1',
    dependency: { package: { name: 'lodash', ecosystem: 'npm' }, manifest_path: 'package.json' },
    security_vulnerability: { severity: 'high', first_patched_version: { identifier: '4.17.21' } },
    security_advisory: { ghsa_id: 'GHSA-1234', cve_id: 'CVE-2021-1234', summary: 'Prototype pollution' },
  },
  {
    number: 2,
    html_url: 'https://github.com/owner/repo/security/dependabot/2',
    dependency: { package: { name: 'axios', ecosystem: 'npm' }, manifest_path: 'package.json' },
    security_vulnerability: { severity: 'moderate', first_patched_version: null },
    security_advisory: { ghsa_id: 'GHSA-5678', cve_id: null, summary: 'SSRF vulnerability' },
  },
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
    // 3 main calls (repo, contributors, commits) + 5 security calls.
    // /stats/commit_activity is NO LONGER part of getRepoStats — it's lazy
    // (fetched only when the user expands the Momentum section). See Phase 1C.
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))                    // repo
      .mockResolvedValueOnce(okJson([{ login: 'a' }]))              // contributors (1, no Link)
      .mockResolvedValueOnce(okJson(commitsPayload))                 // commits (no pushed_at supplied)
      .mockResolvedValueOnce(okJson(alertsPayload))                  // open dependabot alerts
      .mockResolvedValueOnce(okJson([]))                             // dismissed dependabot alerts
      .mockResolvedValueOnce(okJson(profilePayload))                 // community/profile
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))   // code scanning
      .mockResolvedValueOnce(new Response('', { status: 404 }))     // secret scanning

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token')

    expect(result.vitals.stars).toBe(100)
    expect(result.vitals.forks).toBe(10)
    expect(result.vitals.openIssues).toBe(5)
    expect(result.vitals.contributors).toBe(1)
    expect(result.security.available).toBe(true)
    expect(result.security.vulnerabilities).toEqual({ critical: 0, high: 1, moderate: 1, low: 0 })
    expect(result.security.alerts).toHaveLength(2)
    // Momentum is null until the user expands the Momentum section (lazy).
    expect(result.momentum).toBeNull()
  })

  it('still returns vitals when commits call fails (partial failure)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockRejectedValueOnce(new Error('timeout'))                   // commits fails
      .mockResolvedValueOnce(okJson([]))                             // open dependabot
      .mockResolvedValueOnce(okJson([]))                             // dismissed dependabot
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('', { status: 200 }))     // code scanning
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token')

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

    const result = await getRepoStats(db, 'owner', 'repo', 'token')

    expect(result.engagement.starredAt).toBe('2026-01-12T00:00:00Z')
    expect(result.engagement.skillsLearned).toBe(2)
  })

  it('skips both /repos/{o}/{n} AND /commits when cachedRepoCore (with pushedAt) is provided', async () => {
    // Only 6 calls now: contributors + 5 security. Both /repos/ AND /commits
    // are skipped because cachedRepoCore supplies stars/forks/openIssues
    // (Win 3) AND pushedAt (Phase 1A — daysSinceCommit derives from it).
    mockFetch
      .mockResolvedValueOnce(okJson([]))                             // contributors
      .mockResolvedValueOnce(okJson([]))                             // open dependabot
      .mockResolvedValueOnce(okJson([]))                             // dismissed dependabot
      .mockResolvedValueOnce(okJson(profilePayload))                 // community/profile
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))   // code scanning
      .mockResolvedValueOnce(new Response('', { status: 404 }))     // secret scanning

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token',
      { stars: 250, forks: 12, openIssues: 7, pushedAt: new Date().toISOString() })

    // Vitals come from the cached core, not from a /repos/ fetch
    expect(result.vitals.stars).toBe(250)
    expect(result.vitals.forks).toBe(12)
    expect(result.vitals.openIssues).toBe(7)
    // Confirm no /repos or /commits call was made
    expect(mockFetch.mock.calls[0][0]).toContain('/contributors')
    expect(mockFetch.mock.calls.some(c => /\/commits\?/.test(c[0]))).toBe(false)
    // Total fetches: 6 (down from 9 in original; -1 for /repos, -1 for /commits, -1 for /commit_activity)
    expect(mockFetch).toHaveBeenCalledTimes(6)
    // daysSinceCommit derived from cached pushedAt
    expect(result.health.daysSinceCommit).toBeLessThanOrEqual(1)
  })

  it('exposes daysSinceCommit and leaves lastReleaseDate null (renderer enriches)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(commitsPayload))
      .mockResolvedValueOnce(okJson(activityPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token')

    // Service no longer takes lastReleaseDate; the renderer recomputes once
    // releases resolve via `computeHealthScore`.
    expect(result.health.lastReleaseDate).toBeNull()
    expect(result.health.lastReleaseDaysAgo).toBeNull()
    // daysSinceCommit is exposed so the renderer can do the recompute.
    expect(typeof result.health.daysSinceCommit).toBe('number')
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
      .mockResolvedValueOnce(okJson([]))                             // open dependabot
      .mockResolvedValueOnce(okJson([]))                             // dismissed dependabot
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('', { status: 200 }))     // code scanning
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const db = createTestDb()
    const result = await getRepoStats(db, 'owner', 'repo', 'token')

    expect(result.vitals.contributors).toBe(42)
  })

  // Tier 2 — 6h cache for the network-derived intermediates (contributors,
  // last commit). On a warm visit within the TTL these calls are served
  // entirely from the local DB.
  it('caches the stats intermediate after a fresh fetch and serves from cache on next call', async () => {
    // First call — full fetch path. 8 mocked responses (3 main + 5 security)
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([{ login: 'a' }]))
      .mockResolvedValueOnce(okJson(commitsPayload))
      .mockResolvedValueOnce(okJson([]))                             // open dependabot
      .mockResolvedValueOnce(okJson([]))                             // dismissed dependabot
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))   // code scanning
      .mockResolvedValueOnce(new Response('', { status: 404 }))     // secret scanning

    const db = createTestDb()
    const first = await getRepoStats(db, 'owner', 'repo', 'token')
    expect(first.vitals.contributors).toBe(1)

    const callsAfterFirst = mockFetch.mock.calls.length

    // Second call — security writes its own cache row in the first call so on
    // the warm path we expect: 0 stats-intermediate calls + 0 security calls
    // + 1 /repos/{o}/{n} call (no cachedRepoCore passed in this test).
    const second = await getRepoStats(db, 'owner', 'repo', 'token')
    const callsAfterSecond = mockFetch.mock.calls.length
    expect(callsAfterSecond - callsAfterFirst).toBe(1)
    expect(mockFetch.mock.calls[callsAfterFirst][0]).toBe('https://api.github.com/repos/owner/repo')

    // Cached values come through identically
    expect(second.vitals.contributors).toBe(1)
    expect(second.health.daysSinceCommit).toBe(first.health.daysSinceCommit)
  })

  it('warm load with cachedRepoCore + cached intermediate makes ZERO stats GitHub calls', async () => {
    // Seed both caches manually to simulate a 6h-warm visit
    const db = createTestDb()
    db.prepare(
      'INSERT INTO repo_stats_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
    ).run('owner', 'repo', Date.now(), JSON.stringify({
      daysSinceCommit: 5,
      contributors: 42,
    }))
    db.prepare(
      'INSERT INTO repo_security_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
    ).run('owner', 'repo', Date.now(), JSON.stringify({
      available: true, permissionDenied: false,
      vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
      dismissedVulnerabilities: null, hasSecurityPolicy: true,
      codeScanning: null, secretScanning: null, alerts: [],
    }))

    const result = await getRepoStats(db, 'owner', 'repo', 'token',
      { stars: 100, forks: 10, openIssues: 5 })

    // The whole point: zero GitHub calls on a hot warm visit.
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.vitals.stars).toBe(100)
    expect(result.vitals.contributors).toBe(42)
    expect(result.health.daysSinceCommit).toBe(5)
    // Momentum is now lazy (separate IPC), not part of the stats bundle.
    expect(result.momentum).toBeNull()
    expect(result.security.available).toBe(true)
  })

  it('refetches when the stats cache row is older than the 6h TTL', async () => {
    const db = createTestDb()
    // Insert an expired cache row (> 6h ago)
    db.prepare(
      'INSERT INTO repo_stats_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
    ).run('owner', 'repo', Date.now() - 21_600_001, JSON.stringify({
      daysSinceCommit: 999, contributors: 1,
    }))

    // Full mock chain for the refetch (8 calls now: 3 main + 5 security)
    mockFetch
      .mockResolvedValueOnce(okJson(repoPayload))
      .mockResolvedValueOnce(okJson([{ login: 'a' }, { login: 'b' }]))  // 2 contributors
      .mockResolvedValueOnce(okJson(commitsPayload))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson(profilePayload))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoStats(db, 'owner', 'repo', 'token')

    // Got the fresh value, not the expired cached one
    expect(result.vitals.contributors).toBe(2)
    // Stale cache row was overwritten with fresh data
    const refreshed = db.prepare(
      'SELECT data FROM repo_stats_cache WHERE owner=? AND name=?'
    ).get('owner', 'repo') as { data: string }
    expect(JSON.parse(refreshed.data).contributors).toBe(2)
  })
})

// ── getRepoMomentum ──────────────────────────────────────────────────────────

describe('getRepoMomentum', () => {
  const mockFetch = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  it('fetches and returns commit_activity-derived momentum on cache miss', async () => {
    mockFetch.mockResolvedValueOnce(okJson(activityPayload))
    const db = createTestDb()
    const { getRepoMomentum } = await import('./repoStats')
    const result = await getRepoMomentum(db, 'owner', 'repo', 'token')

    expect(result?.monthlyCommits).toHaveLength(6)
    expect(['up', 'down', 'stable']).toContain(result?.trend)
    // Cached for next call
    const cached = db.prepare('SELECT data FROM repo_momentum_cache WHERE owner=? AND name=?')
      .get('owner', 'repo') as { data: string }
    expect(cached).toBeDefined()
  })

  it('returns null on 202 (computing) and does NOT cache the null', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }))
    const db = createTestDb()
    const { getRepoMomentum } = await import('./repoStats')
    const result = await getRepoMomentum(db, 'owner', 'repo', 'token')

    expect(result).toBeNull()
    // No cache row written — next call will retry
    const cached = db.prepare('SELECT data FROM repo_momentum_cache WHERE owner=? AND name=?')
      .get('owner', 'repo') as { data: string } | undefined
    expect(cached).toBeUndefined()
  })

  it('serves cached momentum without a network call on warm hit', async () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO repo_momentum_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
    ).run('owner', 'repo', Date.now(), JSON.stringify({
      monthlyCommits: [1, 2, 3, 4, 5, 6], trend: 'up',
    }))

    const { getRepoMomentum } = await import('./repoStats')
    const result = await getRepoMomentum(db, 'owner', 'repo', 'token')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result?.trend).toBe('up')
  })
})
