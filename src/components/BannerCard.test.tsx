import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BannerCard } from './BannerCard'

// DitherBackground uses canvas + ResizeObserver; mock to a simple stub for tests.
vi.mock('./DitherBackground', () => ({
  default: ({ avatarUrl }: { avatarUrl?: string }) => (
    <div data-testid="dither" data-avatar={avatarUrl ?? ''} />
  ),
}))

const baseProps = {
  tag: 'UPDATE',
  tier: 'normal' as const,
  title: 'v1.2.3 — Bug fixes',
  descriptionPreview: 'Fixes some bugs',
  versionLabel: 'v1.2.3',
  ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/6128107?v=4',
  repoFullName: 'vitejs/vite',
  occurredAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago
  onClick: vi.fn(),
}

describe('BannerCard', () => {
  it('renders the tag, title, and description', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('UPDATE')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3 — Bug fixes')).toBeInTheDocument()
    expect(screen.getByText('Fixes some bugs')).toBeInTheDocument()
  })

  it('renders the version label as overlay', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
  })

  it('renders the repo full name and a relative timestamp', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('vitejs/vite')).toBeInTheDocument()
    expect(screen.getByText(/5h ago/)).toBeInTheDocument()
  })

  it('passes the owner avatar URL into DitherBackground', () => {
    render(<BannerCard {...baseProps} />)
    const dither = screen.getByTestId('dither')
    expect(dither.getAttribute('data-avatar')).toBe(baseProps.ownerAvatarUrl)
  })

  it('applies the major modifier class for tier=major', () => {
    const { container } = render(<BannerCard {...baseProps} tier="major" tag="MAJOR UPDATE" />)
    expect(container.querySelector('.banner-card--major')).toBeInTheDocument()
    expect(container.querySelector('.banner-card__tag--major')).toBeInTheDocument()
  })

  it('applies the prerelease modifier class for tier=prerelease', () => {
    const { container } = render(<BannerCard {...baseProps} tier="prerelease" tag="PRE-RELEASE" />)
    expect(container.querySelector('.banner-card__tag--prerelease')).toBeInTheDocument()
  })

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<BannerCard {...baseProps} onClick={onClick} />)
    fireEvent.click(container.querySelector('.banner-card')!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
