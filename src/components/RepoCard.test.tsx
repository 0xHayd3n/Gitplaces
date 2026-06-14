import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RepoCard from './RepoCard'
import type { SavedRepo } from '../types/repo'
import { fixtureSavedRepo } from '../test-utils/repoFixtures'

vi.mock('./DitherBackground', () => ({
  default: () => <div data-testid="dither-bg" />,
}))
vi.mock('./LanguageIcon', () => ({
  default: ({ lang }: { lang: string }) => <span data-testid="lang-icon">{lang}</span>,
}))
// Stub the window.api surface the new RepoCard touches in its translate effect.
// Merge into existing window.api (src/test/setup.ts already stubs tts).
beforeAll(() => {
  const w = globalThis as unknown as { window: { api: Record<string, unknown> } }
  w.window.api = {
    ...(w.window.api ?? {}),
    settings: { getPreferredLanguage: vi.fn().mockResolvedValue('en') },
    translate: {
      check:     vi.fn().mockResolvedValue(null),
      translate: vi.fn().mockResolvedValue(null),
    },
    db: { cacheTranslatedDescription: vi.fn().mockResolvedValue(undefined) },
    // Old RepoCard calls org.getVerified in a useEffect; stub so it doesn't crash.
    org: { getVerified: vi.fn().mockResolvedValue(false) },
    // Old RepoCard has star/unstar handlers (only invoked on click, but stubs keep it safe).
    github: {
      starRepo:   vi.fn().mockResolvedValue(undefined),
      unstarRepo: vi.fn().mockResolvedValue(undefined),
    },
  }
})

function makeRepo(overrides: Partial<SavedRepo> = {}): SavedRepo {
  return fixtureSavedRepo({
    hostNativeId: 'kirillzyusko/react-native-keyboard-controller',
    fullName: 'kirillzyusko/react-native-keyboard-controller',
    owner: 'kirillzyusko',
    name: 'react-native-keyboard-controller',
    description: 'Keyboard manager which works in identical way on both iOS and Android.',
    language: 'TypeScript',
    stars: 1000,
    forks: 100,
    ...overrides,
  })
}

function renderCard(props: Partial<React.ComponentProps<typeof RepoCard>> = {}) {
  return render(<RepoCard repo={makeRepo()} onNavigate={vi.fn()} {...props} />)
}

describe('RepoCard (Nexus-style)', () => {
  it('renders title and description', () => {
    const { container } = renderCard()
    expect(container.querySelector('.repo-card-title')?.textContent).toBe('react-native-keyboard-controller')
    expect(container.querySelector('.repo-card-description')?.textContent)
      .toBe('Keyboard manager which works in identical way on both iOS and Android.')
  })

  it('renders the language overlay with the language icon when language is set', () => {
    const { container } = renderCard()
    const overlay = container.querySelector('.repo-card-lang-overlay')
    expect(overlay).toBeTruthy()
    expect(overlay?.querySelector('[data-testid="lang-icon"]')?.textContent).toBe('TypeScript')
  })

  it('hides the language overlay when language is absent', () => {
    const { container } = renderCard({ repo: makeRepo({ language: null }) })
    expect(container.querySelector('.repo-card-lang-overlay')).toBeNull()
  })

  it('renders a type pill with subtype label when typeSub is provided', () => {
    const { container } = renderCard({ typeSub: 'ui-library' })
    const pill = container.querySelector('.repo-card-pill')
    // The exact label depends on getSubTypeConfig; just assert pill is present
    // and that it contains the icon dot.
    expect(pill).toBeTruthy()
    expect(pill?.querySelector('.repo-card-pill-icon')).toBeTruthy()
  })

  it('hides the type pill when neither typeSub nor typeBucket is provided', () => {
    const { container } = renderCard()
    expect(container.querySelector('.repo-card-pill')).toBeNull()
  })

  it('does NOT render star button, learn button, tag chips, or anchor strip', () => {
    const { container } = renderCard({
      repo: makeRepo({ topics: ['mobile', 'keyboard', 'react-native'], starredAt: '2026-01-01' }),
    })
    expect(container.querySelector('.repo-card-badge-br')).toBeNull()
    expect(container.querySelector('.repo-card-badge-learn')).toBeNull()
    expect(container.querySelector('.repo-card-tag')).toBeNull()
    expect(container.querySelector('.repo-card-anchors')).toBeNull()
  })

  it('clicking the card calls onNavigate with /repo/:owner/:name', async () => {
    const onNavigate = vi.fn()
    const { container } = renderCard({ onNavigate })
    await userEvent.click(container.querySelector('.repo-card')!)
    expect(onNavigate).toHaveBeenCalledWith('/repo/kirillzyusko/react-native-keyboard-controller')
  })

  it('clicking the language overlay calls onLanguageClick (and not onNavigate)', async () => {
    const onLanguageClick = vi.fn()
    const onNavigate = vi.fn()
    const { container } = renderCard({ onLanguageClick, onNavigate })
    await userEvent.click(container.querySelector('.repo-card-lang-overlay')!)
    expect(onLanguageClick).toHaveBeenCalledWith('TypeScript')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clicking the type pill calls onSubtypeClick (and not onNavigate)', async () => {
    const onSubtypeClick = vi.fn()
    const onNavigate = vi.fn()
    const { container } = renderCard({ typeSub: 'ui-library', onSubtypeClick, onNavigate })
    await userEvent.click(container.querySelector('.repo-card-pill')!)
    expect(onSubtypeClick).toHaveBeenCalledWith('ui-library')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('applies starred glow class when repo.starredAt is set', () => {
    const { container } = renderCard({ repo: makeRepo({ starredAt: '2026-01-01' }) })
    expect(container.querySelector('.repo-card')?.classList.contains('repo-card-starred')).toBe(true)
  })

  it('applies learned glow class when learnState is LEARNED', () => {
    const { container } = renderCard({ learnState: 'LEARNED' })
    expect(container.querySelector('.repo-card')?.classList.contains('repo-card-learned')).toBe(true)
  })
})
