import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RepoListRow from './RepoListRow'
import type { RepoRow } from '../types/repo'
import { DEFAULT_LAYOUT_PREFS } from './LayoutDropdown'
import type { ListDensity, ListFields } from './LayoutDropdown'
import { SavedReposProvider } from '../contexts/SavedRepos'

function makeApi() {
  Object.defineProperty(window, 'api', {
    value: {
      github: {
        searchRepos: vi.fn().mockResolvedValue([]),
        saveRepo: vi.fn().mockResolvedValue(undefined),
        getRepo: vi.fn().mockResolvedValue({}),
        getRelatedRepos: vi.fn().mockResolvedValue([]),
        getReadme: vi.fn().mockResolvedValue(null),
        getReleases: vi.fn().mockResolvedValue([]),
        getSavedRepos: vi.fn().mockResolvedValue([]),
        starRepo: vi.fn().mockResolvedValue(undefined),
        unstarRepo: vi.fn().mockResolvedValue(undefined),
      },
      db: {
        setStarredAt: vi.fn().mockResolvedValue(undefined),
      },
      settings: {
        get: vi.fn(),
        set: vi.fn(),
        getApiKey: vi.fn().mockResolvedValue(null),
        setApiKey: vi.fn(),
      },
      skill: {
        generate: vi.fn().mockResolvedValue({ content: '## [CORE]\nfoo', version: 'v1' }),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        detectClaudeCode: vi.fn().mockResolvedValue(false),
      },
      search: {
        raw: vi.fn().mockResolvedValue([]),
        tagged: vi.fn().mockResolvedValue([]),
        extractTags: vi.fn().mockResolvedValue([]),
        getRelatedTags: vi.fn().mockResolvedValue([]),
        getTopics: vi.fn().mockResolvedValue([]),
      },
      org: {
        getVerified: vi.fn().mockResolvedValue(false),
      },
      verification: {
        prioritise: vi.fn().mockResolvedValue(undefined),
        getScore: vi.fn().mockResolvedValue(null),
        onUpdated: vi.fn(),
        offUpdated: vi.fn(),
      },
    },
    writable: true,
    configurable: true,
  })
}

const baseRepo: RepoRow = {
  id: 'abc123',
  owner: 'vercel',
  name: 'next.js',
  description: 'The React framework for production',
  language: 'TypeScript',
  stars: 120000,
  forks: 25000,
  open_issues: 500,
  watchers: 120000,
  size: 50000,
  license: 'MIT',
  topics: '[]',
  updated_at: '2024-01-01',
  saved_at: null,
  starred_at: null,
  unstarred_at: null,
  banner_color: null,
  discovered_at: null,
  verification_score: null,
  verification_tier: null,
  verification_signals: null,
  verification_checked_at: null,
  homepage: null,
  pushed_at: null,
  type: null,
  banner_svg: null,
  discover_query: null,
  default_branch: null,
  avatar_url: null,
  translated_description: null,
  translated_description_lang: null,
  translated_readme: null,
  translated_readme_lang: null,
  detected_language: null,
  type_bucket: null,
  type_sub: null,
}

async function renderRow(
  overrides: Partial<RepoRow> = {},
  density: ListDensity = 'comfortable',
  fields: ListFields = DEFAULT_LAYOUT_PREFS.fields,
  verificationTier: 'verified' | 'likely' | null = null,
) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <SavedReposProvider>
        <MemoryRouter>
          <RepoListRow
            repo={{ ...baseRepo, ...overrides }}
            onNavigate={vi.fn()}
            onTagClick={vi.fn()}
            density={density}
            fields={fields}
            verificationTier={verificationTier}
          />
        </MemoryRouter>
      </SavedReposProvider>
    )
  })
  return result
}

describe('RepoListRow', () => {
  beforeEach(() => {
    makeApi()
  })

  it('always renders repo name and owner', async () => {
    await renderRow()
    expect(screen.getByText('next.js')).toBeInTheDocument()
    expect(screen.getByText(/vercel/i)).toBeInTheDocument()
  })

  it('renders description when fields.description is true', async () => {
    await renderRow({}, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, description: true })
    expect(screen.getByText('The React framework for production')).toBeInTheDocument()
  })

  it('hides description when fields.description is false', async () => {
    await renderRow({}, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, description: false })
    expect(screen.queryByText('The React framework for production')).not.toBeInTheDocument()
  })

  it('applies compact density class', async () => {
    const { container } = await renderRow({}, 'compact')
    expect(container.firstChild).toHaveClass('repo-list-row--compact')
  })

  it('applies comfortable density class', async () => {
    const { container } = await renderRow({}, 'comfortable')
    expect(container.firstChild).toHaveClass('repo-list-row--comfortable')
  })

  it('renders stars stat when fields.stats is true', async () => {
    await renderRow({}, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, stats: true })
    expect(screen.getByText(/120/)).toBeInTheDocument()
  })

  it('hides stats when fields.stats is false', async () => {
    await renderRow({ stars: 99999 }, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, stats: false })
    expect(screen.queryByText(/99\.9k/)).not.toBeInTheDocument()
  })

  it('renders no verification badge when verificationTier is null', async () => {
    await renderRow({}, 'comfortable', DEFAULT_LAYOUT_PREFS.fields, null)
    expect(screen.queryByText(/official/i)).not.toBeInTheDocument()
  })

  it('renders "Official" when verificationTier is "verified" and fields.verification is true', async () => {
    await renderRow({}, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, verification: true }, 'verified')
    expect(screen.getByText('Official')).toBeInTheDocument()
  })

  it('renders "Likely Official" when verificationTier is "likely"', async () => {
    await renderRow({}, 'comfortable', { ...DEFAULT_LAYOUT_PREFS.fields, verification: true }, 'likely')
    expect(screen.getByText('Likely Official')).toBeInTheDocument()
  })
})
