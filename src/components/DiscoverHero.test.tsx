import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverHero from './DiscoverHero'
import type { SavedRepo } from '../types/repo'
import { fixtureSavedRepo } from '../test-utils/repoFixtures'

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

const repo: SavedRepo = fixtureSavedRepo({
  hostNativeId: '1',
  fullName: 'vercel/next.js',
  owner: 'vercel',
  name: 'next.js',
  description: 'The React Framework',
  language: 'JavaScript',
  stars: 128000,
  forks: 27000,
  ownerAvatarUrl: 'https://example.com/avatar.png',
  pushedAt: '2024-01-01T00:00:00Z',
})

describe('DiscoverHero', () => {
  it('renders null when repo is null', () => {
    const { container } = render(
      <DiscoverHero repo={null} onNavigate={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders name', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByText('next.js')).toBeTruthy()
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

  it('renders language in meta', () => {
    render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    expect(screen.getByText('JavaScript')).toBeTruthy()
  })

  it('renders badges inside the text column (not as a right-side sibling)', () => {
    const { container } = render(<DiscoverHero repo={repo} onNavigate={vi.fn()} />)
    const text = container.querySelector('.discover-hero-text')
    expect(text).toBeTruthy()
    expect(text!.querySelector('.discover-hero-badges')).toBeTruthy()
    // The two-column layout's right sibling is gone
    expect(container.querySelector('.discover-hero-content > .discover-hero-badges')).toBeNull()
  })
})
