import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'

const baseProps = {
  owner: 'anthropics',
  name: 'Databuddy',
  avatarUrl: 'https://github.com/anthropics.png?size=40',
  description: 'Open-source analytics platform',
  language: 'TypeScript',
  stars: 4200,
  forks: 312,
  isFork: false,
}

describe('ForkRepoCard', () => {
  it('renders as a link to the correct GitHub URL', () => {
    render(<ForkRepoCard {...baseProps} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/anthropics/Databuddy')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders the repo name', () => {
    render(<ForkRepoCard {...baseProps} />)
    expect(screen.getByText('Databuddy')).toBeInTheDocument()
  })

  it('renders the dither zone', () => {
    const { container } = render(<ForkRepoCard {...baseProps} />)
    expect(container.querySelector('.repo-card-dither')).toBeInTheDocument()
  })

  it('renders avatar with owner src in title row', () => {
    render(<ForkRepoCard {...baseProps} />)
    const imgs = screen.getAllByRole('img')
    expect(imgs.some(img => img.getAttribute('src') === baseProps.avatarUrl)).toBe(true)
  })

  it('renders description when provided', () => {
    render(<ForkRepoCard {...baseProps} />)
    expect(screen.getByText('Open-source analytics platform')).toBeInTheDocument()
  })

  it('omits description element when null', () => {
    render(<ForkRepoCard {...baseProps} description={null} />)
    expect(screen.queryByText('Open-source analytics platform')).toBeNull()
  })

  it('renders language badge when language provided', () => {
    const { container } = render(<ForkRepoCard {...baseProps} />)
    expect(container.querySelector('.repo-card-icon-badge')).toBeInTheDocument()
  })

  it('omits language badge when language is null', () => {
    const { container } = render(<ForkRepoCard {...baseProps} language={null} />)
    expect(container.querySelector('.repo-card-icon-badge')).toBeNull()
  })

  it('renders owner in footer stats', () => {
    render(<ForkRepoCard {...baseProps} />)
    expect(screen.getByText('anthropics')).toBeInTheDocument()
  })

  it('renders stats using formatCount format', () => {
    render(<ForkRepoCard {...baseProps} />)
    expect(screen.getByText(/4\.2k/)).toBeInTheDocument()
    expect(screen.getByText(/312/)).toBeInTheDocument()
  })

  it('source card: no FORK badge, forks stat visible', () => {
    render(<ForkRepoCard {...baseProps} isFork={false} />)
    expect(screen.queryByText('fork')).toBeNull()
    expect(screen.getByText(/312/)).toBeInTheDocument()
  })

  it('fork card: shows FORK badge, hides forks stat', () => {
    render(<ForkRepoCard {...baseProps} isFork={true} />)
    expect(screen.getByText('fork')).toBeInTheDocument()
    expect(screen.queryByText(/312/)).toBeNull()
  })

  it('fork card has blue border class', () => {
    const { container } = render(<ForkRepoCard {...baseProps} isFork={true} />)
    expect(container.firstChild).toHaveClass('fork-repo-card--fork')
  })
})

describe('ForkRepoCardSkeleton', () => {
  it('renders skeleton class', () => {
    const { container } = render(<ForkRepoCardSkeleton />)
    expect(container.querySelector('.fork-repo-card--skeleton')).toBeInTheDocument()
  })

  it('renders dither zone in skeleton', () => {
    const { container } = render(<ForkRepoCardSkeleton />)
    expect(container.querySelector('.repo-card-dither')).toBeInTheDocument()
  })
})
