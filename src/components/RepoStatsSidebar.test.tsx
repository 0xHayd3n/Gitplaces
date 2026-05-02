// src/components/RepoStatsSidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoStatsSidebar } from './RepoStatsSidebar'
import type { RepoStats } from '../types/repoStats'

const mockStats: RepoStats = {
  vitals: { stars: 100, forks: 10, openIssues: 5, contributors: 89 },
  health: {
    score: 80, maintenance: 'active', issueVelocity: 'backlogged',
    lastReleaseDate: '2026-04-20T00:00:00Z', lastReleaseDaysAgo: 12,
  },
  momentum: { monthlyCommits: [12, 18, 10, 22, 19, 31], trend: 'up' },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 2, moderate: 1, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: '2026-02-03T00:00:00Z', skillsLearned: 2 },
}

const healthyStats: RepoStats = {
  ...mockStats,
  health: { score: 80, maintenance: 'active', issueVelocity: 'healthy', lastReleaseDate: '2026-04-20T00:00:00Z', lastReleaseDaysAgo: 12 },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
  momentum: { monthlyCommits: [10, 15, 20, 25, 28, 31], trend: 'up' },
}

const criticalStats: RepoStats = {
  ...mockStats,
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 3, moderate: 1, low: 2 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: false,
    codeScanning: false,
    secretScanning: null,
    alerts: null,
  },
}

const staleStats: RepoStats = {
  ...mockStats,
  health: { score: 30, maintenance: 'stale', issueVelocity: 'healthy', lastReleaseDate: null, lastReleaseDaysAgo: null },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: null,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
}

const middlingStats: RepoStats = {
  ...mockStats,
  health: { score: 55, maintenance: 'slow', issueVelocity: 'healthy', lastReleaseDate: null, lastReleaseDaysAgo: null },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: null,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
}

describe('RepoStatsSidebar', () => {
  it('renders loading skeleton when stats is loading', () => {
    const { container } = render(<RepoStatsSidebar stats="loading" />)
    expect(container.querySelector('.stats-sidebar-loading')).not.toBeNull()
  })

  it('renders error message when stats is error', () => {
    render(<RepoStatsSidebar stats="error" />)
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
  })

  it('renders vitals section labels', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText(/stars/i)).toBeInTheDocument()
    expect(screen.getByText(/forks/i)).toBeInTheDocument()
    expect(screen.getByText(/contributors/i)).toBeInTheDocument()
  })

  it('renders health score', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('renders total vulnerability count when security is available', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText(/3 vulnerabilit/i)).toBeInTheDocument()
  })

  it('renders "Security data not available" when available is false and not permission denied', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        available: false, permissionDenied: false, vulnerabilities: null,
        dismissedVulnerabilities: null, hasSecurityPolicy: null,
        codeScanning: null, secretScanning: null, alerts: null,
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/not available/i)).toBeInTheDocument()
  })

  it('renders computing label when momentum is null', () => {
    const stats: RepoStats = { ...mockStats, momentum: null }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/computing/i)).toBeInTheDocument()
  })

  it('renders engagement section with skills learned count', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // Verdict tests
  it('renders "Healthy" verdict for a well-maintained repo with no vulns', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when high vulnerabilities exist', () => {
    render(<RepoStatsSidebar stats={criticalStats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })

  it('renders "Needs attention" verdict for stale repo', () => {
    render(<RepoStatsSidebar stats={staleStats} />)
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('renders "Stable" verdict for middling repo with no critical signals', () => {
    render(<RepoStatsSidebar stats={middlingStats} />)
    expect(screen.getByText('Stable')).toBeInTheDocument()
  })

  // Collapse tests
  it('collapses Momentum section when header is clicked', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText(/Commits\/month/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Momentum/i }))
    expect(screen.queryByText(/Commits\/month/i)).not.toBeInTheDocument()
  })

  it('collapses Security section when header is clicked', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText(/Security policy/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Security/i }))
    expect(screen.queryByText(/Security policy/i)).not.toBeInTheDocument()
  })

  it('re-expands a collapsed section when header is clicked again', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    const btn = screen.getByRole('button', { name: /Momentum/i })
    fireEvent.click(btn)
    expect(screen.queryByText(/Commits\/month/i)).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText(/Commits\/month/i)).toBeInTheDocument()
  })

  // ── New test cases ──────────────────────────────────────────────────────────

  it('renders "Token lacks permission" when permissionDenied is true', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        available: false, permissionDenied: true, vulnerabilities: null,
        dismissedVulnerabilities: null, hasSecurityPolicy: null,
        codeScanning: null, secretScanning: null, alerts: null,
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/token lacks permission/i)).toBeInTheDocument()
  })

  it('renders dismissed vulnerabilities count when total > 0', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        dismissedVulnerabilities: { critical: 1, high: 2, moderate: 0, low: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/3 dismissed/i)).toBeInTheDocument()
  })

  it('renders code scanning alert count when codeScanning is a counts object', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        codeScanning: { critical: 0, high: 1, medium: 2, low: 0, note: 0, warning: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/3 alerts/i)).toBeInTheDocument()
  })

  it('renders code scanning Absent dot when codeScanning is false', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: { ...mockStats.security, hasSecurityPolicy: null, codeScanning: false },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/Code scanning/i)).toBeInTheDocument()
    expect(screen.getByText(/● Absent/)).toBeInTheDocument()
  })

  it('renders secret scanning row with active count when active > 0', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        secretScanning: { active: 2, inactive: 0, unknown: 1 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/2 active/i)).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when secretScanning has active > 0', () => {
    const stats: RepoStats = {
      ...healthyStats,
      security: {
        ...healthyStats.security,
        secretScanning: { active: 1, inactive: 0, unknown: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when codeScanning has critical > 0', () => {
    const stats: RepoStats = {
      ...healthyStats,
      security: {
        ...healthyStats.security,
        codeScanning: { critical: 1, high: 0, medium: 0, low: 0, note: 0, warning: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })
})
