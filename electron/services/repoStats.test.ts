import { describe, it, expect } from 'vitest'
import { computeHealthScore } from './repoStats'

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
