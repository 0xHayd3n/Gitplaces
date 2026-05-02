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
