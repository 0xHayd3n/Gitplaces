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

// ---------------------------------------------------------------------------
// L1 in-memory cache
// ---------------------------------------------------------------------------
const L1_TTL_MS = 5 * 60 * 1000  // 5 minutes
const COLD_START_MIN_REPOS = 3

interface L1Entry {
  timestamp: number
  response: RecommendationResponse
}

const l1Cache = new Map<string, L1Entry>()

// ---------------------------------------------------------------------------
// Helper: maybe prune old engagement events
// ---------------------------------------------------------------------------
function maybePrune(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'engagement_last_prune'").get() as { value: string } | undefined
  const last = row ? parseInt(row.value, 10) : 0
  if (Date.now() - last < PRUNE_INTERVAL_MS) return
  pruneOldEvents(db, Date.now() - ENGAGEMENT_LOOKBACK_MS)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('engagement_last_prune', String(Date.now()))
}

// ---------------------------------------------------------------------------
// Helper: upsert ranked candidates into the repos table
// ---------------------------------------------------------------------------
function upsertCandidates(
  db: Database.Database,
  candidates: Awaited<ReturnType<typeof fetchCandidates>>,
  profileHash: string,
): void {
  const now = new Date().toISOString()

  const upsert = db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner          = excluded.owner,
      name           = excluded.name,
      description    = excluded.description,
      language       = excluded.language,
      topics         = excluded.topics,
      stars          = excluded.stars,
      forks          = excluded.forks,
      updated_at     = excluded.updated_at,
      pushed_at      = excluded.pushed_at,
      created_at     = excluded.created_at,
      discovered_at  = excluded.discovered_at,
      discover_query = excluded.discover_query,
      watchers       = excluded.watchers,
      size           = excluded.size,
      open_issues    = excluded.open_issues,
      default_branch = excluded.default_branch,
      avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
      saved_at       = repos.saved_at,
      banner_color   = repos.banner_color,
      type_bucket    = excluded.type_bucket,
      type_sub       = excluded.type_sub
  `)

  db.transaction(() => {
    for (const repo of candidates) {
      const rid = String(repo.id)
      cascadeRepoId(db, repo.owner.login, repo.name, rid)
      const classified = classifyRepoBucket({
        name: repo.name,
        description: repo.description,
        topics: JSON.stringify(repo.topics ?? []),
      })
      upsert.run(
        rid, repo.owner.login, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics ?? []), repo.stargazers_count, repo.forks_count,
        repo.license?.spdx_id ?? null, repo.homepage, repo.updated_at, repo.pushed_at,
        repo.created_at ?? null,
        now, `recommended:${profileHash}`, repo.watchers_count, repo.size, repo.open_issues_count,
        repo.default_branch ?? 'main', repo.owner.avatar_url ?? null,
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()

  // Non-blocking: extract dominant colour
  setImmediate(() => {
    const needColor = candidates.filter(r => r.owner.avatar_url)
    void poolAll(needColor, 3, async (repo) => {
      const row = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(repo.owner.login, repo.name) as { banner_color: string | null } | undefined
      if (row?.banner_color) return
      const color = await extractDominantColor(repo.owner.avatar_url!)
      db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
        .run(JSON.stringify(color), repo.owner.login, repo.name)
    })
  })
}

// ---------------------------------------------------------------------------
// Helper: re-read upserted rows from DB into a map keyed by id (for result assembly)
// ---------------------------------------------------------------------------
function readBackRows(
  db: Database.Database,
  githubRepos: Awaited<ReturnType<typeof fetchCandidates>>,
): Map<string, RepoRow> {
  const ids = githubRepos.map(c => String(c.id))
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM repos WHERE id IN (${placeholders})`).all(...ids) as RepoRow[]
  return new Map(rows.map(r => [String(r.id), r]))
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function getRecommendedHandler(
  page: number = 1,
  excludeIds: string[] = [],
): Promise<RecommendationResponse> {
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

  // L1 cache — page 1 only. Subsequent pages bypass cache so scrolling fetches
  // fresh GitHub search pages on each call.
  if (page === 1) {
    const cached = l1Cache.get(profileHash)
    if (cached && (Date.now() - cached.timestamp) < L1_TTL_MS) {
      return cached.response
    }
  }

  const excludeSet = new Set(excludeIds)

  // Cold-start path (fewer than 3 user repos)
  if (userRepos.length < COLD_START_MIN_REPOS) {
    const coldCandidates = await fetchCandidates(token, [{
      topic: '', kind: 'coldStart', coldStart: true, perPage: 100, sort: 'stars',
    }], page)
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
    const filteredItems = excludeSet.size > 0
      ? items.filter(i => !excludeSet.has(String(i.repo.id)))
      : items
    const response: RecommendationResponse = { items: filteredItems, stale: false, coldStart: true }
    if (page === 1) {
      l1Cache.set(profileHash, { timestamp: Date.now(), response })
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`recommended_cache_ts:${profileHash}`, String(Date.now()))
    }
    return response
  }

  // Normal path
  const corpusRows = db.prepare('SELECT topics, description FROM repos').all() as { topics: string | null; description: string | null }[]
  const corpus = computeCorpusStats(corpusRows)
  const profile = buildUserProfile({ userRepos, corpus, engagementEvents, clickedReposById })
  const queries = planQueries(profile, corpus)
  let candidates = await fetchCandidates(token, queries, page)

  // Filter: not user-owned, not already user's, not recently clicked, not already shown
  const existingIds = new Set(userRepos.map((r) => String(r.id)))
  const githubUsernameRow = db.prepare("SELECT value FROM settings WHERE key = 'github_username'").get() as { value: string } | undefined
  const githubUsername = githubUsernameRow?.value?.toLowerCase() ?? null
  candidates = candidates.filter((c) =>
    !existingIds.has(String(c.id)) &&
    !excludeSet.has(String(c.id)) &&
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

  // Fallback: if the niche-only candidate pool yielded nothing (e.g. user's
  // topics are dominated by repos above MAX_STAR_CEILING), fall back to the
  // cold-start popular pool so the UI is never empty. Honour `page` and
  // `excludeIds` so subsequent scroll fetches surface new mainstream picks.
  if (items.length === 0) {
    const coldCandidates = await fetchCandidates(token, [{
      topic: '', kind: 'coldStart', coldStart: true, perPage: 100, sort: 'stars',
    }], page)
    if (coldCandidates.length > 0) {
      upsertCandidates(db, coldCandidates, profileHash)
      const coldByIdMap = readBackRows(db, coldCandidates)
      const fallbackItems: RecommendationItem[] = coldCandidates
        .map((repo): RecommendationItem | null => {
          const row = coldByIdMap.get(String(repo.id))
          if (!row) return null
          return {
            repo: row, score: 0,
            scoreBreakdown: { topic: 0, description: 0, bucket: 0, subType: 0, language: 0, scale: 0, freshness: 0, engagement: 0 },
            anchors: [], primaryAnchor: null,
          }
        })
        .filter((i): i is RecommendationItem => i !== null && !excludeSet.has(String(i.repo.id)))
      const response: RecommendationResponse = { items: fallbackItems, stale: false, coldStart: true }
      if (page === 1) l1Cache.set(profileHash, { timestamp: Date.now(), response })
      return response
    }
  }

  const response: RecommendationResponse = { items, stale: false, coldStart: false }
  if (page === 1) {
    l1Cache.set(profileHash, { timestamp: Date.now(), response })
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`recommended_cache_ts:${profileHash}`, String(Date.now()))
  }
  return response
}

export function registerRecommendHandlers(): void {
  ipcMain.handle('github:getRecommended', async (_event, page?: number, excludeIds?: string[]) => {
    return getRecommendedHandler(page ?? 1, excludeIds ?? [])
  })
}
