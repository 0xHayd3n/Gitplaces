import type Database from 'better-sqlite3'
import { githubHeaders } from '../github'
import type { RepoStats, HealthStatus, IssueVelocity } from '../../src/types/repoStats'

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
