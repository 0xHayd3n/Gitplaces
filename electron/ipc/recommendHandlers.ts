import { createHash } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { getToken } from '../store'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { extractDominantColor } from '../color-extractor'
import { poolAll } from '../concurrency'
import type Database from 'better-sqlite3'
import {
  buildUserProfile,
  computeTopicStats,
  rankCandidates,
} from '../services/recommendationEngine'
import { planQueries, fetchCandidates } from '../services/recommendationFetcher'
import { cascadeRepoId } from '../db-helpers'
import type { RecommendationResponse, RecommendationItem } from '../../src/types/recommendation'
import type { RepoRow } from '../../src/types/repo'

export function computeProfileHash(starredIds: string[], savedIds: string[]): string {
  const s = [...starredIds].sort().join(',')
  const v = [...savedIds].sort().join(',')
  return createHash('sha256').update(`${s}|${v}`).digest('hex')
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
export async function getRecommendedHandler(): Promise<RecommendationResponse> {
  const db = getDb(app.getPath('userData'))
  const token = getToken()

  // GitHub disconnected — return empty without calling the API.
  if (!token) return { items: [], stale: false, coldStart: false }

  // 1. Load user repos
  const userRepos = db.prepare(
    'SELECT * FROM repos WHERE starred_at IS NOT NULL OR saved_at IS NOT NULL'
  ).all() as RepoRow[]

  // 2. Compute profile hash
  const starredIds = userRepos.filter((r) => r.starred_at).map((r) => String(r.id))
  const savedIds   = userRepos.filter((r) => r.saved_at).map((r) => String(r.id))
  const profileHash = computeProfileHash(starredIds, savedIds)

  // 3. Check L1 cache
  const cached = l1Cache.get(profileHash)
  if (cached && (Date.now() - cached.timestamp) < L1_TTL_MS) {
    return cached.response
  }

  // 4. Cold-start path (fewer than 3 user repos)
  if (userRepos.length < COLD_START_MIN_REPOS) {
    const coldCandidates = await fetchCandidates(token, [{ topic: '', coldStart: true }])

    // Upsert cold-start results to DB so they persist, then read back RepoRow shapes
    upsertCandidates(db, coldCandidates, profileHash)
    const coldByIdMap = readBackRows(db, coldCandidates)

    const items: RecommendationItem[] = coldCandidates
      .map((repo): RecommendationItem | null => {
        const row = coldByIdMap.get(String(repo.id))
        if (!row) {
          console.warn(`[recommend] cold-start: no DB row for repo ${repo.owner.login}/${repo.name} (id=${repo.id}) after upsert`)
          return null
        }
        return {
          repo: row,
          score: 0,
          scoreBreakdown: { topic: 0, description: 0, bucket: 0, subType: 0, language: 0, scale: 0, freshness: 0, engagement: 0 },
          anchors: [],
          primaryAnchor: null,
        }
      })
      .filter((item): item is RecommendationItem => item !== null)

    const response: RecommendationResponse = { items, stale: false, coldStart: true }

    // Cache L1
    l1Cache.set(profileHash, { timestamp: Date.now(), response })

    // Write L2 timestamp
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`recommended_cache_ts:${profileHash}`, String(Date.now()))

    return response
  }

  // 5. Normal path
  const topicRows = db.prepare(
    'SELECT topics FROM repos WHERE topics IS NOT NULL'
  ).all() as { topics: string }[]

  const topicStats = computeTopicStats(topicRows)
  const profile = buildUserProfile({ userRepos, topicStats })
  const queries = planQueries(profile)
  let candidates = await fetchCandidates(token, queries)

  // Filter repos the user already has or owns
  const existingIds = new Set(userRepos.map((r) => String(r.id)))
  const githubUsernameRow = db.prepare("SELECT value FROM settings WHERE key = 'github_username'").get() as { value: string } | undefined
  const githubUsername = githubUsernameRow?.value?.toLowerCase() ?? null
  candidates = candidates.filter((c) =>
    !existingIds.has(String(c.id)) &&
    (!githubUsername || c.owner.login.toLowerCase() !== githubUsername)
  )

  const ranked = rankCandidates(candidates, profile, topicStats)

  // Upsert all candidates to DB, then re-read rows to get RepoRow shapes
  upsertCandidates(db, candidates, profileHash)
  const byIdMap = readBackRows(db, candidates)

  // Map ranked items: swap item.repo (GitHubRepo) → RepoRow from DB
  const items: RecommendationItem[] = ranked
    .map((item): RecommendationItem | null => {
      const row = byIdMap.get(String(item.repo.id))
      if (!row) {
        console.warn(`[recommend] no DB row for repo ${item.repo.owner.login}/${item.repo.name} (id=${item.repo.id}) after upsert`)
        return null
      }
      return { ...item, repo: row }
    })
    .filter((item): item is RecommendationItem => item !== null)

  const response: RecommendationResponse = { items, stale: false, coldStart: false }

  // 6. Cache L1
  l1Cache.set(profileHash, { timestamp: Date.now(), response })

  // 7. Write L2 timestamp to settings
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(`recommended_cache_ts:${profileHash}`, String(Date.now()))

  return response
}

export function registerRecommendHandlers(): void {
  ipcMain.handle('github:getRecommended', async () => {
    return getRecommendedHandler()
  })
}
