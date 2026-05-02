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

  it('returns 0 for the issue component when openIssues >= 200', () => {
    // commit=100 (0.4), issue=0 (0.4), release=100 (0.2) → 60
    expect(computeHealthScore({ daysSinceCommit: 0, openIssues: 200, lastReleaseDaysAgo: 0 }))
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
