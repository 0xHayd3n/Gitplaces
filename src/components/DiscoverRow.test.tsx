import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverRow from './DiscoverRow'
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

function makeRepo(owner: string, name: string): RepoRow {
  return {
    id: `${owner}/${name}`, owner, name,
    description: null, language: 'TypeScript', stars: 1000, forks: 100,
    topics: '[]', avatar_url: null, starred_at: null, unstarred_at: null, pushed_at: null,
    license: null, homepage: null, updated_at: null, saved_at: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    watchers: null, size: null, open_issues: null, default_branch: null,
    og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null, verification_signals: null,
    verification_checked_at: null, type_bucket: null, type_sub: null,
    is_forked: null, update_available: null, update_checked_at: null,
    upstream_version: null, stored_version: null,
  }
}

const repos = [
  makeRepo('facebook', 'react'),
  makeRepo('microsoft', 'vscode'),
  makeRepo('golang', 'go'),
]

describe('DiscoverRow', () => {
  it('renders null when repos is empty', () => {
    const { container } = render(
      <DiscoverRow repos={[]} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a card for each repo', () => {
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    expect(screen.getByText('facebook / react')).toBeTruthy()
    expect(screen.getByText('microsoft / vscode')).toBeTruthy()
    expect(screen.getByText('golang / go')).toBeTruthy()
  })

  it('renders "Recommended for You" section heading', () => {
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    expect(screen.getByText('Recommended for You')).toBeTruthy()
  })

  it('calls onMore when More button is clicked', async () => {
    const onMore = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={onMore} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('calls onNavigate with correct path when a card is clicked', async () => {
    const onNavigate = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={onNavigate} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByText('facebook / react'))
    expect(onNavigate).toHaveBeenCalledWith('/repo/facebook/react')
  })
})
