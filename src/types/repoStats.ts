export type HealthStatus = 'active' | 'slow' | 'stale'
export type IssueVelocity = 'healthy' | 'backlogged' | 'critical'

export interface SecurityAlert {
  number: number
  package: string
  ecosystem: string
  manifestPath: string
  severity: 'critical' | 'high' | 'moderate' | 'low'
  cveId: string | null
  ghsaId: string
  summary: string
  fixVersion: string | null
  url: string
}

export interface SeverityCounts {
  critical: number; high: number; moderate: number; low: number
}

export interface CodeScanningCounts {
  critical: number; high: number; medium: number; low: number; note: number; warning: number
}

export interface SecretScanningCounts {
  active: number; inactive: number; unknown: number
}

export interface RepoStats {
  vitals: {
    stars: number
    forks: number
    openIssues: number
    contributors: number | null
  }
  health: {
    score: number
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDate: string | null
    lastReleaseDaysAgo: number | null
    /** Exposed so the renderer can recompute `score` when releases later resolve,
     *  without refetching the entire stats bundle (`releaseScore` is just one of
     *  three weighted components in `computeHealthScore`). */
    daysSinceCommit?: number
  }
  momentum: {
    monthlyCommits: number[]
    trend: 'up' | 'stable' | 'down'
  } | null
  security: {
    available: boolean
    permissionDenied: boolean
    vulnerabilities: SeverityCounts | null
    dismissedVulnerabilities: SeverityCounts | null
    hasSecurityPolicy: boolean | null
    codeScanning: CodeScanningCounts | false | null
    secretScanning: SecretScanningCounts | null
    alerts: SecurityAlert[] | null
  }
  engagement: {
    starredAt: string | null
    forkedAt: string | null
    skillsLearned: number
  }
}
