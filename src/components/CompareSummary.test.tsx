import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { CompareSummary } from './CompareSummary'
import { HOST_ID_GITHUB } from '../lib/hostIds'
import type { CompareSummaryData } from '../hooks/useCompare'

vi.mock('../hooks/useCompare', () => ({
  useCompare: vi.fn(),
}))

const mockUseCompare = vi.mocked(
  (await import('../hooks/useCompare')).useCompare
)

const data: CompareSummaryData = {
  base: 'v1.0.0',
  head: 'v1.1.0',
  htmlUrl: 'https://github.com/foo/bar/compare/v1.0.0...v1.1.0',
  totalCommits: 12,
  filesChanged: 5,
  additions: 234,
  deletions: 56,
  topFiles: [
    { filename: 'src/index.ts', status: 'modified', additions: 100, deletions: 20 },
    { filename: 'README.md', status: 'modified', additions: 30, deletions: 10 },
  ],
  topAuthors: [
    { login: 'alice', avatarUrl: 'https://example.com/a.png', commits: 8 },
    { login: 'bob',   avatarUrl: 'https://example.com/b.png', commits: 4 },
  ],
}

describe('CompareSummary', () => {
  it('renders skeleton while loading', () => {
    mockUseCompare.mockReturnValue({ data: null, loading: true, error: false })
    const { container } = render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    expect(container.querySelector('.compare-summary--skeleton')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('v1.1.0')).toBeInTheDocument()
  })

  it('renders refs, totals, and diff stats when loaded', () => {
    mockUseCompare.mockReturnValue({ data, loading: false, error: false })
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('v1.1.0')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText(/commits/)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText(/files/)).toBeInTheDocument()
    expect(screen.getByText('+234')).toBeInTheDocument()
    expect(screen.getByText('−56')).toBeInTheDocument()
  })

  it('renders the top file list', () => {
    mockUseCompare.mockReturnValue({ data, loading: false, error: false })
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('renders the top authors with their avatars', () => {
    mockUseCompare.mockReturnValue({ data, loading: false, error: false })
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    expect(screen.getByAltText('alice')).toBeInTheDocument()
    expect(screen.getByAltText('bob')).toBeInTheDocument()
  })

  it('falls back to a link when the API errors', () => {
    mockUseCompare.mockReturnValue({ data: null, loading: false, error: true })
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/foo/bar/compare/v1.0.0...v1.1.0')
    expect(screen.getByText(/View changelog on GitHub/)).toBeInTheDocument()
  })

  it('renders the first-release variant without fetching when base is null', () => {
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base={null} head="v0.1.0" />)
    expect(mockUseCompare).not.toHaveBeenCalled()
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
    expect(screen.getByText(/first release/i)).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/foo/bar/commits/v0.1.0')
  })

  it('links the loaded card to the GitHub compare URL', () => {
    mockUseCompare.mockReturnValue({ data, loading: false, error: false })
    render(<CompareSummary hostId={HOST_ID_GITHUB} owner="foo" repo="bar" base="v1.0.0" head="v1.1.0" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/foo/bar/compare/v1.0.0...v1.1.0')
  })
})
