// src/components/RepoStatsSidebar.test.tsx
import { render, screen } from '@testing-library/react'
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
    vulnerabilities: { high: 2, moderate: 1, low: 0 },
    hasSecurityPolicy: true, codeScanningEnabled: false,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: '2026-02-03T00:00:00Z', skillsLearned: 2 },
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
    // 2 high + 1 moderate + 0 low = 3 total
    expect(screen.getByText(/3 vulnerabilit/i)).toBeInTheDocument()
  })

  it('renders security unavailable state', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: { available: false, vulnerabilities: null, hasSecurityPolicy: null, codeScanningEnabled: null },
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
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
