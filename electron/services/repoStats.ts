import type Database from 'better-sqlite3'
import { githubHeaders } from '../providers/github'
import { etagFetch, type ConditionalResponse } from '../githubFetch'
import type { RepoStats, HealthStatus, IssueVelocity } from '../../src/types/repoStats'
import { computeHealthScore } from '../../src/lib/healthScore'
import { getRepoSecurity } from './repoSecurity'

// Re-exported for backward compatibility with existing tests/imports.
export { computeHealthScore }

// ── private helpers ──────────────────────────────────────────────────────────

interface RepoCoreData {
  stargazers_count: number
  forks_count: number
  open_issues_count: number
}

interface WeekActivity { week: number; total: number }


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

export interface CachedRepoCore {
  stars: number
  forks: number
  openIssues: number
  /** ISO timestamp of the most recent push to any branch. Lets us skip a
   *  /commits?per_page=1 fetch — the value is identical to that endpoint's
   *  Date header but already lives on the repo row populated by getRepo. */
  pushedAt?: string | null
}

// 6h TTL — matches getRepoSecurity. Contributors/last-commit/momentum change
// slowly enough that a stale read within this window is fine; a warm visit
// then costs zero GitHub calls for the network-derived intermediates.
const STATS_CACHE_TTL_MS = 21_600_000

interface CachedStatsIntermediate {
  daysSinceCommit: number
  contributors: number | null
  momentum: RepoStats['momentum']
}

function readStatsCache(
  db: Database.Database,
  owner: string,
  name: string,
): CachedStatsIntermediate | null {
  const row = db.prepare(
    'SELECT fetched_at, data FROM repo_stats_cache WHERE owner=? AND name=?'
  ).get(owner, name) as { fetched_at: number; data: string } | undefined
  if (!row || Date.now() - row.fetched_at >= STATS_CACHE_TTL_MS) return null
  try { return JSON.parse(row.data) as CachedStatsIntermediate } catch { return null }
}

function writeStatsCache(
  db: Database.Database,
  owner: string,
  name: string,
  data: CachedStatsIntermediate,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO repo_stats_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
  ).run(owner, name, Date.now(), JSON.stringify(data))
}

async function fetchStatsIntermediate(
  db: Database.Database,
  base: string,
  h: HeadersInit,
  pushedAt: string | null | undefined,
): Promise<CachedStatsIntermediate> {
  // /commits?per_page=1 was previously fetched here just to derive the
  // last-commit date. That date is identical to `pushed_at` on the repo row
  // (already populated by getRepo), so we skip the call entirely when the
  // caller passes it in. Falls back to /commits only if pushed_at is missing.
  // /stats/commit_activity is now lazy — fetched separately when the user
  // expands the Momentum section (see getRepoMomentum below). Saves a heavy
  // call (the endpoint frequently returns 202 = computing).
  // Both fetches go through etagFetch — when the resource is unchanged GitHub
  // returns 304 Not Modified, which doesn't count against the rate limit.
  const needCommitFetch = !pushedAt
  const [contributorRes, commitRes] = await Promise.all([
    etagFetch(db, `${base}/contributors?per_page=1`, { headers: h }).catch(() => null),
    needCommitFetch
      ? etagFetch(db, `${base}/commits?per_page=1`, { headers: h }).catch(() => null)
      : Promise.resolve<ConditionalResponse | null>(null),
  ])

  // Contributor count via Link header pagination.
  // NOTE: a 304 response loses the Link header, so we cache the contributor
  // count alongside the stats intermediate (see writeStatsCache caller). The
  // Link path only fires on the initial 200; subsequent 304s use the cached
  // intermediate row, which already contains the count.
  let contributors: number | null = null
  if (contributorRes && (contributorRes.status === 200 || contributorRes.status === 304)) {
    const link = contributorRes.headers.get('Link')
    if (link) {
      const m = link.match(/[?&]page=(\d+)>; rel="last"/)
      contributors = m ? parseInt(m[1], 10) : 1
    } else {
      const parsed = await contributorRes.json()
      contributors = Array.isArray(parsed) ? parsed.length : null
    }
  }

  // Last commit date — prefer pushed_at when available (saves one fetch).
  let lastCommitDate: string | null = pushedAt ?? null
  if (!lastCommitDate && commitRes && (commitRes.status === 200 || commitRes.status === 304)) {
    const lastCommit = (await commitRes.json()) as
      { commit: { committer: { date: string } } }[] | null
    lastCommitDate = lastCommit?.[0]?.commit?.committer?.date ?? null
  }
  const daysSinceCommit = lastCommitDate
    ? Math.floor((Date.now() - new Date(lastCommitDate).getTime()) / 86_400_000)
    : 999

  return { daysSinceCommit, contributors, momentum: null }
}

// Standalone fetch for the Momentum section (lazy — only called when the
// collapsible is expanded). Returns null on 202 ("GitHub is computing stats")
// or any other non-success. 6h DB cache so repeated opens of the section are free.
const MOMENTUM_CACHE_TTL_MS = STATS_CACHE_TTL_MS

export async function getRepoMomentum(
  db: Database.Database,
  owner: string,
  name: string,
  token: string | null,
): Promise<RepoStats['momentum']> {
  const cached = db.prepare(
    'SELECT fetched_at, data FROM repo_momentum_cache WHERE owner=? AND name=?'
  ).get(owner, name) as { fetched_at: number; data: string } | undefined
  if (cached && Date.now() - cached.fetched_at < MOMENTUM_CACHE_TTL_MS) {
    try { return JSON.parse(cached.data) as RepoStats['momentum'] } catch { /* fall through to refetch */ }
  }

  const h = githubHeaders(token)
  const base = `https://api.github.com/repos/${owner}/${name}`
  const res = await etagFetch(db, `${base}/stats/commit_activity`, { headers: h }).catch(() => null)
  if (!res || (res.status !== 200 && res.status !== 304)) return null
  const weeks = (await res.json()) as WeekActivity[] | null
  if (!weeks || weeks.length < 26) return null
  const last26 = weeks.slice(-26)
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const start = Math.floor(i * 26 / 6)
    const end   = Math.floor((i + 1) * 26 / 6)
    return last26.slice(start, end).reduce((s, w) => s + w.total, 0)
  })
  const first3 = monthly.slice(0, 3).reduce((a, b) => a + b, 0) / 3
  const last3  = monthly.slice(3).reduce((a, b) => a + b, 0) / 3
  const trend: 'up' | 'stable' | 'down' =
    last3 > first3 * 1.1 ? 'up' : last3 < first3 * 0.9 ? 'down' : 'stable'
  const result = { monthlyCommits: monthly, trend }

  db.prepare(
    'INSERT OR REPLACE INTO repo_momentum_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
  ).run(owner, name, Date.now(), JSON.stringify(result))

  return result
}

export async function getRepoStats(
  db: Database.Database,
  owner: string,
  name: string,
  token: string | null,
  cachedRepoCore?: CachedRepoCore,
): Promise<RepoStats> {
  const h = githubHeaders(token)
  const base = `https://api.github.com/repos/${owner}/${name}`

  // Network-derived intermediates are cached for 6h. On hit we skip three
  // GitHub calls (contributors, commits, commit_activity) entirely. Security
  // has its own equivalent cache inside getRepoSecurity.
  const cachedIntermediate = readStatsCache(db, owner, name)

  // Repo core: skip the /repos/{o}/{n} fetch when the IPC handler supplied
  // values from the local `repos` row (populated by `github:getRepo`). Saves
  // one more GitHub call.
  const repoFetchPromise = cachedRepoCore
    ? Promise.resolve(null)
    : fetch(base, { headers: h }).catch(() => null)

  const intermediatePromise: Promise<CachedStatsIntermediate> = cachedIntermediate
    ? Promise.resolve(cachedIntermediate)
    : fetchStatsIntermediate(db, base, h, cachedRepoCore?.pushedAt ?? null)

  const [repoRes, intermediate, security] = await Promise.all([
    repoFetchPromise,
    intermediatePromise,
    getRepoSecurity(db, owner, name, token),
  ])

  // Persist a fresh fetch (skipped on cache hit — same object identity check)
  if (cachedIntermediate === null) {
    writeStatsCache(db, owner, name, intermediate)
  }

  const repoData: RepoCoreData | null = cachedRepoCore
    ? { stargazers_count: cachedRepoCore.stars, forks_count: cachedRepoCore.forks, open_issues_count: cachedRepoCore.openIssues }
    : (repoRes?.ok ? await repoRes.json().catch(() => null) : null)

  // Health score. `lastReleaseDate` is no longer a parameter — the renderer
  // recomputes the score client-side once releases resolve (using the exported
  // `computeHealthScore` and the `daysSinceCommit` we expose below). This lets
  // `getRepoStats` fetch ONCE per page load instead of twice.
  const { daysSinceCommit, contributors, momentum } = intermediate
  const openIssues = repoData?.open_issues_count ?? 0

  const score = computeHealthScore({ daysSinceCommit, openIssues, lastReleaseDaysAgo: null })
  const maintenance: HealthStatus =
    daysSinceCommit < 30 ? 'active' : daysSinceCommit < 90 ? 'slow' : 'stale'
  const issueVelocity: IssueVelocity =
    openIssues < 50 ? 'healthy' : openIssues <= 200 ? 'backlogged' : 'critical'

  return {
    vitals: {
      stars:       repoData?.stargazers_count ?? 0,
      forks:       repoData?.forks_count      ?? 0,
      openIssues,
      contributors,
    },
    health: { score, maintenance, issueVelocity, lastReleaseDate: null, lastReleaseDaysAgo: null, daysSinceCommit },
    momentum,
    security,
    engagement: getEngagement(db, owner, name),
  }
}
