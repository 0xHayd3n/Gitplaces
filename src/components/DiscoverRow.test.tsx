import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverRow from './DiscoverRow'
import type { RepoRow } from '../types/repo'

vi.mock('./DitherBackground', () => ({
  default: () => <div data-testid="dither-bg" />,
}))
vi.mock('./LanguageIcon', () => ({
  default: ({ lang }: { lang: string }) => <span data-testid="lang-icon">{lang}</span>,
}))

vi.mock('../hooks/useBayerDither', () => ({ useBayerDither: vi.fn() }))

beforeAll(() => {
  // ResizeObserver is already stubbed in src/test/setup.ts, but the existing
  // test set it locally too — keep that for parity with prior behaviour.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const w = globalThis as unknown as { window: { api: Record<string, unknown> } }
  w.window.api = {
    ...(w.window.api ?? {}),
    settings: { getPreferredLanguage: vi.fn().mockResolvedValue('en') },
    translate: {
      check:     vi.fn().mockResolvedValue(null),
      translate: vi.fn().mockResolvedValue(null),
    },
    db: { cacheTranslatedDescription: vi.fn().mockResolvedValue(undefined) },
  }
})

function makeRepo(owner: string, name: string, overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: `${owner}/${name}`, owner, name,
    description: 'Sample description text.',
    language: 'TypeScript', stars: 1000, forks: 100,
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
    ...overrides,
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
    expect(screen.getByRole('button', { name: 'facebook/react' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'microsoft/vscode' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'golang/go' })).toBeTruthy()
  })

  it('renders "Recommended for You" section heading', () => {
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    expect(screen.getByText('Recommended for You')).toBeTruthy()
  })

  it('calls onMore when More button is clicked', async () => {
    const onMore = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={onMore} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByRole('button', { name: /see all/i }))
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('calls onNavigate with correct path when a card is clicked', async () => {
    const onNavigate = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={onNavigate} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByRole('button', { name: 'facebook/react' }))
    expect(onNavigate).toHaveBeenCalledWith('/repo/facebook/react')
  })

  it('renders the new card structure (title, author, description, language overlay)', () => {
    const { container } = render(
      <DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />,
    )
    // Pick the active card (first non-peek slot)
    expect(container.querySelector('.repo-card-title')).toBeTruthy()
    expect(container.querySelector('.repo-card-author')).toBeTruthy()
    expect(container.querySelector('.repo-card-description')).toBeTruthy()
    expect(container.querySelector('.repo-card-lang-overlay')).toBeTruthy()
  })

  it('does NOT render star button, license chip, recency stat, or tag chips', () => {
    const { container } = render(
      <DiscoverRow
        repos={[makeRepo('facebook', 'react', { topics: '["ui","library"]', license: 'MIT', pushed_at: new Date().toISOString() })]}
        activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3}
      />,
    )
    expect(container.querySelector('.repo-card-badge-br')).toBeNull()
    expect(container.querySelector('.discover-row-card-license')).toBeNull()
    expect(container.querySelector('.discover-row-card-stat')).toBeNull()
    expect(container.querySelector('.discover-row-card-tag')).toBeNull()
  })
})
