import type Database from 'better-sqlite3'
import { githubHeaders } from '../github'
import type { RepoStats, HealthStatus, IssueVelocity } from '../../src/types/repoStats'
import { getRepoSecurity } from './repoSecurity'

export function computeHealthScore(data: {
  daysSinceCommit: number
  openIssues: number
  lastReleaseDaysAgo: number | null
}): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const commitScore = clamp(1 - (data.daysSinceCommit - 7) / 173) * 100
  const issueScore = clamp(1 - data.openIssues / 200) * 100
  const releaseScore =
    data.lastReleaseDaysAgo === null
      ? 0
      : clamp(1 - (data.lastReleaseDaysAgo - 30) / 335) * 100
  return Math.round(commitScore * 0.4 + issueScore * 0.4 + releaseScore * 0.2)
}

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

  // All network calls run in parallel — security bundle is independent of the others
  const [repoRes, contributorRes, commitRes, activityRes, security] = await Promise.all([
    fetch(base,                                          { headers: h }).catch(() => null),
    fetch(`${base}/contributors?per_page=1`,             { headers: h }).catch(() => null),
    fetch(`${base}/commits?per_page=1`,                  { headers: h }).catch(() => null),
    fetch(`${base}/stats/commit_activity`,               { headers: h }).catch(() => null),
    getRepoSecurity(db, owner, name, token),
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
    if (weeks.length >= 26) {
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
    openIssues < 50 ? 'healthy' : openIssues <= 200 ? 'backlogged' : 'critical'

  return {
    vitals: {
      stars:       repoData?.stargazers_count ?? 0,
      forks:       repoData?.forks_count      ?? 0,
      openIssues,
      contributors,
    },
    health: { score, maintenance, issueVelocity, lastReleaseDate, lastReleaseDaysAgo },
    momentum,
    security,
    engagement: getEngagement(db, owner, name),
  }
}
