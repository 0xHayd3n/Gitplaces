import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverHero from './DiscoverHero'
import type { RepoRow } from '../types/repo'

vi.mock('./DitherBackground', () => ({
  default: () => <div data-testid="dither-bg" />,
}))

vi.mock('../hooks/useBayerDither', () => ({ useBayerDither: vi.fn() }))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const repo: RepoRow = {
  id: '1', owner: 'vercel', name: 'next.js',
  description: 'The React Framework', language: 'JavaScript',
  stars: 128000, forks: 27000, topics: '[]',
  avatar_url: 'https://example.com/avatar.png',
  starred_at: null, unstarred_at: null, pushed_at: '2024-01-01T00:00:00Z',
  license: null, homepage: null, updated_at: null, saved_at: null,
  type: null, banner_svg: null, discovered_at: null, discover_query: null,
  watchers: null, size: null, open_issues: null, default_branch: null,
  og_image_url: null, banner_color: null,
  translated_description: null, translated_description_lang: null,
  translated_readme: null, translated_readme_lang: null, detected_language: null,
  verification_score: null, verification_tier: null, verification_signals: null,
  verification_checked_at: null, type_bucket: null, type_sub: null,
}

describe('DiscoverHero', () => {
  it('renders null when repo is null', () => {
    const { container } = render(
      <DiscoverHero repo={null} onNavigate={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders owner/name as title', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByText('vercel / next.js')).toBeTruthy()
  })

  it('renders description', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByText('The React Framework')).toBeTruthy()
  })

  it('calls onNavigate with correct path when hero is clicked', async () => {
    const onNavigate = vi.fn()
    const { container } = render(<DiscoverHero repo={repo} onNavigate={onNavigate} />)
    await userEvent.click(container.firstChild as HTMLElement)
    expect(onNavigate).toHaveBeenCalledWith('/repo/vercel/next.js')
  })

  it('renders DitherBackground with avatarUrl', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByTestId('dither-bg')).toBeTruthy()
  })

  it('renders language and star count in meta', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByText('JavaScript')).toBeTruthy()
    expect(screen.getByText(/128/)).toBeTruthy()
  })
})
