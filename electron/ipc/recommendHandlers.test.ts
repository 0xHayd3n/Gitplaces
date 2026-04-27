// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeProfileHash } from './recommendHandlers'
import type { GitHubRepo } from '../github'

// ---------------------------------------------------------------------------
// Mock electron, DB, store, and external helpers BEFORE importing the handler
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../store', () => ({
  getToken: vi.fn(),
}))

vi.mock('../color-extractor', () => ({
  extractDominantColor: vi.fn().mockResolvedValue({ h: 220, s: 0.25, l: 0.18 }),
}))

vi.mock('../db-helpers', () => ({
  cascadeRepoId: vi.fn(),
}))

vi.mock('../../src/lib/classifyRepoType', () => ({
  classifyRepoBucket: vi.fn().mockReturnValue({ bucket: 'dev-tools', subType: 'cli' }),
}))

// Fetcher mock — will be configured per test
vi.mock('../services/recommendationFetcher', () => ({
  planQueries: vi.fn(),
  fetchCandidates: vi.fn(),
}))

// Engine mock — keep simple so we don't depend on engine internals
vi.mock('../services/recommendationEngine', () => ({
  computeTopicStats: vi.fn().mockReturnValue({
    docFrequency: new Map(),
    totalRepos: 0,
    idf: new Map(),
  }),
  buildUserProfile: vi.fn().mockReturnValue({
    topicAffinity: new Map(),
    bucketDistribution: new Map(),
    subTypeDistribution: new Map(),
    languageWeights: new Map(),
    starScale: { median: 100, p25: 50, p75: 200 },
    anchorPool: [],
    repoCount: 0,
  }),
  rankCandidates: vi.fn().mockReturnValue([]),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGitHubRepo(id: number): GitHubRepo {
  return {
    id,
    full_name: `owner/repo-${id}`,
    name: `repo-${id}`,
    owner: { login: 'owner', avatar_url: '' },
    description: 'test repo',
    language: 'TypeScript',
    topics: ['typescript'],
    stargazers_count: 100,
    forks_count: 10,
    watchers_count: 100,
    open_issues_count: 5,
    size: 1000,
    license: null,
    homepage: null,
    updated_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-01-01T00:00:00Z',
    created_at: '2023-01-01T00:00:00Z',
    default_branch: 'main',
    archived: false,
  }
}

function makeRepoRow(id: string, starred = false, saved = false) {
  return {
    id,
    owner: 'owner',
    name: `repo-${id}`,
    description: null,
    language: 'TypeScript',
    topics: '["typescript"]',
    stars: 100,
    forks: 10,
    license: null,
    homepage: null,
    updated_at: null,
    pushed_at: null,
    saved_at: saved ? '2024-01-01T00:00:00Z' : null,
    starred_at: starred ? '2024-01-01T00:00:00Z' : null,
    type: null,
    banner_svg: null,
    discovered_at: null,
    discover_query: null,
    watchers: null,
    size: null,
    open_issues: null,
    default_branch: 'main',
    avatar_url: null,
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
  }
}

/** Build a minimal better-sqlite3 mock that returns given rows from `.all()` */
function makePreparedStmt(allRows: unknown[] = [], getRow: unknown = undefined) {
  return {
    all: vi.fn().mockReturnValue(allRows),
    get: vi.fn().mockReturnValue(getRow),
    run: vi.fn(),
  }
}

function makeDbMock(prepareImpl: (sql: string) => ReturnType<typeof makePreparedStmt>) {
  const txFn = vi.fn((cb: () => void) => {
    // Return a function that calls the callback immediately, matching db.transaction(...)()
    return () => cb()
  })
  return {
    prepare: vi.fn().mockImplementation(prepareImpl),
    transaction: txFn,
    pragma: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests for getRecommendedHandler / registerRecommendHandlers (Task 9)
// ---------------------------------------------------------------------------
describe('getRecommendedHandler', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset the L1 in-memory cache between tests by re-importing the module
    // We achieve cache isolation by always providing distinct DB states
  })

  it('disconnected: returns empty response and skips fetchCandidates when no token', async () => {
    vi.resetModules()

    const { getDb } = await import('../db')
    const { getToken } = await import('../store')
    const { fetchCandidates } = await import('../services/recommendationFetcher')

    vi.mocked(getToken).mockReturnValue(undefined)

    const db = makeDbMock(() => makePreparedStmt([], undefined))
    vi.mocked(getDb).mockReturnValue(db as never)

    const { getRecommendedHandler } = await import('./recommendHandlers')
    const result = await getRecommendedHandler()

    expect(result).toEqual({ items: [], stale: false, coldStart: false })
    expect(vi.mocked(fetchCandidates)).not.toHaveBeenCalled()
  })

  it('cold start: returns coldStart:true with empty-anchor items when user has fewer than 3 repos', async () => {
    vi.resetModules()

    const { getDb } = await import('../db')
    const { getToken } = await import('../store')
    const { fetchCandidates, planQueries } = await import('../services/recommendationFetcher')

    const popularRepo = makeGitHubRepo(99999)
    vi.mocked(fetchCandidates).mockResolvedValue([popularRepo])
    vi.mocked(planQueries).mockReturnValue([{ topic: '', coldStart: true }])
    vi.mocked(getToken).mockReturnValue('test-token')

    // Only 2 user repos => cold start
    const userRows = [makeRepoRow('1', true, false), makeRepoRow('2', false, true)]
    // The RepoRow we expect to be returned after the post-upsert DB read
    const coldRepoRow = makeRepoRow('99999')

    const db = makeDbMock((sql: string) => {
      if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
        return makePreparedStmt(userRows)
      }
      if (sql.includes('topics IS NOT NULL')) {
        return makePreparedStmt([])
      }
      if (sql.includes('SELECT * FROM repos WHERE id IN')) {
        return makePreparedStmt([coldRepoRow])
      }
      // For settings get (L1 cache check not relevant, but also L2 read)
      return makePreparedStmt([], undefined)
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const { getRecommendedHandler } = await import('./recommendHandlers')
    const result = await getRecommendedHandler()

    expect(result.coldStart).toBe(true)
    expect(result.stale).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].anchors).toEqual([])
    expect(result.items[0].score).toBe(0)
    expect(result.items[0].primaryAnchor).toBeNull()
    // item.repo is now a RepoRow re-read from DB, not the raw GitHubRepo
    expect(result.items[0].repo.id).toBe('99999')
    expect(result.items[0].repo.name).toBe('repo-99999')

    // fetchCandidates should have been called with a coldStart query
    expect(vi.mocked(fetchCandidates)).toHaveBeenCalledTimes(1)
    const [[_token, queries]] = vi.mocked(fetchCandidates).mock.calls
    expect(queries.some((q: { coldStart: boolean }) => q.coldStart === true)).toBe(true)
  })

  it('L1 cache hit: second call with same profile skips fetchCandidates', async () => {
    // This test uses a fresh module to avoid cross-test L1 cache pollution.
    // We isolate by using vi.resetModules() approach.
    vi.resetModules()

    const { getDb } = await import('../db')
    const { getToken } = await import('../store')
    const { fetchCandidates, planQueries } = await import('../services/recommendationFetcher')

    const repo = makeGitHubRepo(1001)
    vi.mocked(fetchCandidates).mockResolvedValue([repo])
    vi.mocked(planQueries).mockReturnValue([{ topic: 'typescript', coldStart: false }])
    vi.mocked(getToken).mockReturnValue('test-token')

    // 5 user repos — above cold start threshold
    const userRows = Array.from({ length: 5 }, (_, i) => makeRepoRow(String(i + 100), true, false))

    const db = makeDbMock((sql: string) => {
      if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
        return makePreparedStmt(userRows)
      }
      if (sql.includes('SELECT * FROM repos WHERE id IN')) {
        return makePreparedStmt([makeRepoRow('1001')])
      }
      return makePreparedStmt([], undefined)
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const { getRecommendedHandler } = await import('./recommendHandlers')

    await getRecommendedHandler()
    await getRecommendedHandler()

    // fetchCandidates should have been called only ONCE (L1 cache hit on second call)
    expect(vi.mocked(fetchCandidates)).toHaveBeenCalledTimes(1)
  })

  it('profile hash change invalidates L1 cache and calls fetchCandidates twice', async () => {
    vi.resetModules()

    const { getDb } = await import('../db')
    const { getToken } = await import('../store')
    const { fetchCandidates, planQueries } = await import('../services/recommendationFetcher')

    const repo = makeGitHubRepo(2001)
    vi.mocked(fetchCandidates).mockResolvedValue([repo])
    vi.mocked(planQueries).mockReturnValue([{ topic: 'typescript', coldStart: false }])
    vi.mocked(getToken).mockReturnValue('test-token')

    // First call: 5 repos
    const firstRows = Array.from({ length: 5 }, (_, i) => makeRepoRow(String(i + 200), true, false))
    // Second call: 6 repos (new starred repo added)
    const secondRows = [...firstRows, makeRepoRow('299', true, false)]

    const prepareCall = vi.fn()
      .mockImplementationOnce((sql: string) => {
        if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
          return makePreparedStmt(firstRows)
        }
        return makePreparedStmt([], undefined)
      })
      .mockImplementation((sql: string) => {
        if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
          return makePreparedStmt(secondRows)
        }
        return makePreparedStmt([], undefined)
      })

    // Use a smarter db mock that tracks calls
    const db = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
          return prepareCall(sql)
        }
        if (sql.includes('SELECT * FROM repos WHERE id IN')) {
          return makePreparedStmt([makeRepoRow('2001')])
        }
        return makePreparedStmt([], undefined)
      }),
      transaction: vi.fn((cb: () => void) => () => cb()),
      pragma: vi.fn(),
    }
    vi.mocked(getDb).mockReturnValue(db as never)

    const { getRecommendedHandler } = await import('./recommendHandlers')

    await getRecommendedHandler()
    await getRecommendedHandler()

    expect(vi.mocked(fetchCandidates)).toHaveBeenCalledTimes(2)
  })

  it('fetch failure propagates as error (Option B — no stale fallback)', async () => {
    vi.resetModules()

    const { getDb } = await import('../db')
    const { getToken } = await import('../store')
    const { fetchCandidates, planQueries } = await import('../services/recommendationFetcher')

    vi.mocked(fetchCandidates).mockRejectedValue(new Error('GitHub API rate limited'))
    vi.mocked(planQueries).mockReturnValue([{ topic: 'typescript', coldStart: false }])
    vi.mocked(getToken).mockReturnValue('test-token')

    const userRows = Array.from({ length: 5 }, (_, i) => makeRepoRow(String(i + 300), true, false))

    const db = makeDbMock((sql: string) => {
      if (sql.includes('starred_at IS NOT NULL OR saved_at IS NOT NULL')) {
        return makePreparedStmt(userRows)
      }
      return makePreparedStmt([], undefined)
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const { getRecommendedHandler } = await import('./recommendHandlers')

    await expect(getRecommendedHandler()).rejects.toThrow('GitHub API rate limited')
  })
})

describe('computeProfileHash', () => {
  it('returns stable hash for same inputs regardless of order', () => {
    const a = computeProfileHash(['1', '2', '3'], ['10', '20'])
    const b = computeProfileHash(['3', '1', '2'], ['20', '10'])
    expect(a).toBe(b)
  })

  it('differs when starred set changes', () => {
    const a = computeProfileHash(['1', '2'], [])
    const b = computeProfileHash(['1', '2', '3'], [])
    expect(a).not.toBe(b)
  })

  it('differs when saved set changes', () => {
    const a = computeProfileHash(['1'], ['10'])
    const b = computeProfileHash(['1'], ['10', '20'])
    expect(a).not.toBe(b)
  })

  it('handles empty sets deterministically', () => {
    const hash = computeProfileHash([], [])
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })
})
