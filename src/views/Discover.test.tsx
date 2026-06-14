import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRef, useEffect } from 'react'
import Discover from './Discover'
import { fixtureSavedRepo } from '../test-utils/repoFixtures'
import { SavedReposProvider } from '../contexts/SavedRepos'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { SearchProvider, useSearch } from '../contexts/Search'
import { DEFAULT_LAYOUT_PREFS } from '../components/LayoutDropdown'

/** Renders an input and registers it as the sidebar inputRef in SearchContext.
 *  This allows Discover tests to fire events on the input via getByPlaceholderText. */
function SearchInputShim() {
  const ref = useRef<HTMLInputElement>(null)
  const { query, setQuery, setInputRef } = useSearch()
  useEffect(() => { setInputRef(ref) }, []) // run once on mount — setInputRef is stable, empty array is intentional
  return (
    <input
      ref={ref}
      placeholder="Search repos, or describe what you need…"
      value={query}
      onChange={e => setQuery(e.target.value)}
    />
  )
}

// Read src/App.test.tsx to see the makeApi() pattern, then replicate a minimal
// version here with the mocks needed for Discover tests.
// The window.api mock needs at minimum:
//   repo: { search, save, get, getRelated, getReadme, getReleases, getRecommended,
//           star, unstar, isStarred, getSaved, getFeed, extractColor, getOgImage }
//   settings: { getApiKey }
//   skill: { generate, get, delete }

function makeDiscoverApi(overrides?: {
  skillGet?: ReturnType<typeof vi.fn>
  skillGenerate?: ReturnType<typeof vi.fn>
  apiKey?: string | null
}) {
  const skillGet = overrides?.skillGet ?? vi.fn().mockResolvedValue(null)
  const skillGenerate = overrides?.skillGenerate ?? vi.fn().mockResolvedValue({ content: '## [CORE]\nfoo', version: 'v1' })
  const apiKey = overrides?.apiKey !== undefined ? overrides.apiKey : null

  Object.defineProperty(window, 'api', {
    value: {
      db: {
        setStarredAt: vi.fn().mockResolvedValue(undefined),
        cacheTranslatedDescription: vi.fn().mockResolvedValue(undefined),
      },
      repo: {
        extractColor: vi.fn().mockResolvedValue({ h: 0, s: 0, l: 0 }),
        getOgImage: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue([fixtureSavedRepo({
          hostNativeId: '12345',
          fullName: 'vercel/next.js',
          owner: 'vercel',
          name: 'next.js',
          description: 'The React framework',
          language: 'TypeScript',
          stars: 100000,
          forks: 20000,
          openIssues: 500,
          watchers: 100000,
          size: 50000,
          license: 'MIT',
          updatedAt: '2024-01-01',
        })]),
        save: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({}),
        getRelated: vi.fn().mockResolvedValue([]),
        getReadme: vi.fn().mockResolvedValue(null),
        getReleases: vi.fn().mockResolvedValue([]),
        getSaved: vi.fn().mockResolvedValue([]),
        getFeed: vi.fn().mockResolvedValue([]),
        star: vi.fn().mockResolvedValue(undefined),
        unstar: vi.fn().mockResolvedValue(undefined),
        isStarred: vi.fn().mockResolvedValue(false),
        getRecommended: vi.fn().mockResolvedValue({
          items: [{
            repo: fixtureSavedRepo({
              hostNativeId: '12345',
              fullName: 'vercel/next.js',
              owner: 'vercel',
              name: 'next.js',
              description: 'The React framework',
              language: 'TypeScript',
              stars: 100000,
              forks: 20000,
              openIssues: 500,
              watchers: 100000,
              size: 50000,
              license: 'MIT',
              updatedAt: '2024-01-01',
            }),
            score: 0,
            scoreBreakdown: { topic: 0, bucket: 0, subType: 0, language: 0, scale: 0 },
            anchors: [],
            primaryAnchor: null,
          }],
          stale: false,
          coldStart: false,
        }),
      },
      settings: {
        get: vi.fn(),
        set: vi.fn(),
        getApiKey: vi.fn().mockResolvedValue(apiKey),
        setApiKey: vi.fn(),
        getPreferredLanguage: vi.fn().mockResolvedValue('en'),
      },
      skill: {
        generate: skillGenerate,
        get: skillGet,
        delete: vi.fn().mockResolvedValue(undefined),
        detectClaudeCode: vi.fn().mockResolvedValue(false),
      },
      search: {
        raw:            vi.fn().mockResolvedValue([]),
        tagged:         vi.fn().mockResolvedValue([]),
        extractTags:    vi.fn().mockResolvedValue([]),
        getRelatedTags: vi.fn().mockResolvedValue([]),
        getTopics:      vi.fn().mockResolvedValue([]),
      },
      org: {
        getVerified: vi.fn().mockResolvedValue(false),
      },
      verification: {
        prioritise:     vi.fn().mockResolvedValue(undefined),
        getScore:       vi.fn().mockResolvedValue(null),
        getBatchScores: vi.fn().mockResolvedValue({}),
        onUpdated:      vi.fn(),
        offUpdated:     vi.fn(),
      },
      translate: {
        check: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockResolvedValue(null),
      },
      engagement: {
        logClick: vi.fn().mockResolvedValue(undefined),
        getRecentlyVisited: vi.fn().mockResolvedValue([]),
      },
      ai: {
        getChats:       vi.fn().mockResolvedValue([]),
        getChat:        vi.fn().mockResolvedValue(null),
        saveChat:       vi.fn().mockResolvedValue(1),
        deleteChat:     vi.fn().mockResolvedValue(undefined),
        sendMessage:    vi.fn().mockResolvedValue({ text: '', html: '' }),
        onStreamToken:  vi.fn(),
        offStreamToken: vi.fn(),
      },
    },
    writable: true, configurable: true,
  })
}

function renderDiscover(initialEntry = '/discover?view=recommended') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SearchProvider>
        <SearchInputShim />
        <ProfileOverlayProvider>
          <SavedReposProvider>
            <MockLearningProgressProvider>
              <Discover />
            </MockLearningProgressProvider>
          </SavedReposProvider>
        </ProfileOverlayProvider>
      </SearchProvider>
    </MemoryRouter>
  )
}

describe('Discover install button', () => {
  beforeEach(() => {
    makeDiscoverApi()
  })

  it('shows "+ Learn" on cards when skill not installed', async () => {
    makeDiscoverApi({ skillGet: vi.fn().mockResolvedValue(null) })
    renderDiscover()
    await waitFor(() => screen.getByText('next.js'))
    expect(screen.getByText('+ Learn')).toBeInTheDocument()
  })

  it('shows "✓ Learned" when skill row exists on mount', async () => {
    makeDiscoverApi({
      skillGet: vi.fn().mockResolvedValue({
        repo_id: '12345', filename: 'next.js.skill.md',
        content: '## [CORE]\nfoo', version: 'v1',
        generated_at: '2024-01-01', active: 1, enabled_components: null,
      }),
    })
    renderDiscover()
    await waitFor(() => screen.getByText('✓ Learned'))
  })

  it('shows no-key message when clicking Learn without API key or Claude Code', async () => {
    makeDiscoverApi({
      apiKey: null,
      skillGenerate: vi.fn().mockRejectedValue(new Error('No API key set and Claude Code not found')),
    })
    renderDiscover()
    await waitFor(() => screen.getByText('next.js'))
    fireEvent.click(screen.getByText('+ Learn'))
    await waitFor(() => screen.getByText(/Add an API key in Settings/))
  })

  it('transitions to generating then learned on successful install', async () => {
    let resolveGenerate!: (v: { content: string; version: string }) => void
    const generatePromise = new Promise<{ content: string; version: string }>((res) => { resolveGenerate = res })
    makeDiscoverApi({
      apiKey: 'sk-ant-test',
      skillGenerate: vi.fn().mockReturnValue(generatePromise),
    })
    renderDiscover()
    await waitFor(() => screen.getByText('next.js'))
    fireEvent.click(screen.getByText('+ Learn'))
    await waitFor(() => screen.getByText('⟳ Learning...'))
    resolveGenerate({ content: '## [CORE]\nfoo', version: 'v1' })
    await waitFor(() => screen.getByText('✓ Learned'))
  })
})

describe('Layout switcher integration in Discover', () => {
  beforeEach(() => {
    makeDiscoverApi()
    localStorage.clear()
  })

  it('renders a Layout button in the filter row', async () => {
    renderDiscover()
    await waitFor(() => expect(screen.getByRole('button', { name: /layout options/i })).toBeInTheDocument())
  })

  it('defaults to grid mode (no list rows visible)', async () => {
    renderDiscover()
    await waitFor(() => screen.getByText('next.js'))
    expect(document.querySelector('.discover-grid')).toBeInTheDocument()
    expect(document.querySelector('.repo-list-row')).not.toBeInTheDocument()
  })

  it('switches to list mode when List is selected in the dropdown', async () => {
    renderDiscover()
    await waitFor(() => screen.getByText('next.js'))
    fireEvent.click(screen.getByRole('button', { name: /layout options/i }))
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(document.querySelector('.repo-list-row')).toBeInTheDocument()
    expect(document.querySelector('.discover-grid')).not.toBeInTheDocument()
  })

  it('reads saved layout prefs from localStorage on mount', async () => {
    localStorage.setItem('discover-layout-prefs', JSON.stringify({ ...DEFAULT_LAYOUT_PREFS, mode: 'list' }))
    renderDiscover()
    await waitFor(() => expect(screen.getByText(/layout: list/i)).toBeInTheDocument())
  })

  it('falls back to DEFAULT_LAYOUT_PREFS when localStorage value is malformed', async () => {
    localStorage.setItem('discover-layout-prefs', 'not-valid-json{{{')
    renderDiscover()
    await waitFor(() => expect(screen.getByText(/layout: grid/i)).toBeInTheDocument())
  })
})

describe('Search history', () => {
  beforeEach(() => {
    localStorage.clear()
    makeDiscoverApi()
  })

  it('shows history dropdown with header when focusing empty input with history', async () => {
    localStorage.setItem('discover-search-history', JSON.stringify(['react', 'vue']))
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/)
    fireEvent.focus(input)
    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.getByText('vue')).toBeInTheDocument()
  })

  it('shows no dropdown when focusing empty input with no history', async () => {
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/)
    fireEvent.focus(input)
    expect(screen.queryByText('Recent searches')).not.toBeInTheDocument()
  })

  it('hides history and shows topic suggestions when typing', async () => {
    localStorage.setItem('discover-search-history', JSON.stringify(['react']))
    makeDiscoverApi({ })
    // Override getTopics to return something matchable
    ;(window.api.search.getTopics as ReturnType<typeof vi.fn>).mockResolvedValue(['typescript', 'testing'])
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/)
    fireEvent.focus(input)
    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'test' } })
    await waitFor(() => {
      expect(screen.queryByText('Recent searches')).not.toBeInTheDocument()
    })
  })

  it('clicking a history entry populates search input', async () => {
    localStorage.setItem('discover-search-history', JSON.stringify(['react frameworks']))
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByText('react frameworks'))
    await waitFor(() => {
      expect(input.value).toBe('react frameworks')
    })
  })

  it('clicking "x" removes entry without triggering search', async () => {
    localStorage.setItem('discover-search-history', JSON.stringify(['react', 'vue']))
    renderDiscover()
    await waitFor(() => expect(window.api.repo.getRecommended).toHaveBeenCalled())
    ;(window.api.repo.search as ReturnType<typeof vi.fn>).mockClear()
    const input = screen.getByPlaceholderText(/Search repos/)
    fireEvent.focus(input)
    const reactEntry = screen.getByText('react').closest('.discover-history-item')!
    fireEvent.mouseEnter(reactEntry)
    const removeBtn = reactEntry.querySelector('.discover-history-remove')!
    fireEvent.mouseDown(removeBtn)
    expect(screen.queryByText('react')).not.toBeInTheDocument()
    expect(screen.getByText('vue')).toBeInTheDocument()
    expect(window.api.repo.search).not.toHaveBeenCalled()
  })

  it('clicking "Clear all" removes all entries', async () => {
    localStorage.setItem('discover-search-history', JSON.stringify(['react', 'vue']))
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/)
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByText('Clear all'))
    expect(screen.queryByText('Recent searches')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('discover-search-history')!)).toEqual([])
  })

  it('executing a search adds query to history', async () => {
    renderDiscover()
    const input = screen.getByPlaceholderText(/Search repos/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'react frameworks' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const history = JSON.parse(localStorage.getItem('discover-search-history')!)
      expect(history).toContain('react frameworks')
    })
  })
})

describe('Recommended tab', () => {
  beforeEach(() => {
    localStorage.clear()
    makeDiscoverApi()
  })

  it('calls getRecommended on initial load', async () => {
    renderDiscover()
    await waitFor(() => {
      expect(window.api.repo.getRecommended).toHaveBeenCalled()
    })
  })
})

describe('Engagement tracking', () => {
  beforeEach(() => {
    localStorage.clear()
    makeDiscoverApi()
  })

  it('logs an engagement click when navigating to a repo from the recommended view', async () => {
    renderDiscover('/discover?view=recommended')
    // Wait for the recommended repo to appear
    await waitFor(() => screen.getByText('next.js'))
    // Click the repo card (repo.name text is rendered inside the card's clickable root)
    const nameEl = screen.getByText('next.js')
    const card = nameEl.closest('.repo-card') as HTMLElement
    fireEvent.click(card)
    await waitFor(() => {
      expect((window.api.engagement.logClick as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('12345', 'recommended')
    })
  })
})

describe('Discover search suggestions', () => {
  function makeApiWithTopics(topics: string[]) {
    makeDiscoverApi({})
    // Override just the getTopics mock
    Object.defineProperty(window, 'api', {
      value: {
        ...(window as any).api,
        search: {
          ...(window as any).api.search,
          getTopics: vi.fn().mockResolvedValue(topics),
        },
      },
      writable: true, configurable: true,
    })
  }

  it('shows a subtype suggestion when the query matches a subtype label', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => expect(screen.getByText('UI Library')).toBeInTheDocument())
  })

  it('shows the bucket label badge alongside the subtype suggestion', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => expect(screen.getByText('· Frameworks')).toBeInTheDocument())
  })

  it('shows subtype suggestions even before allTopics has loaded', async () => {
    // getTopics returns empty — subtype pass should still run
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'build' } })
    await waitFor(() => expect(screen.getByText('Build Tool')).toBeInTheDocument())
  })

  it('still shows topic suggestions after subtypes when topics are loaded', async () => {
    makeApiWithTopics(['ui-components', 'ui-kit'])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => {
      expect(screen.getByText('UI Library')).toBeInTheDocument()
      expect(screen.getByText('ui-components')).toBeInTheDocument()
    })
  })

  it('shows no suggestions for an empty query', async () => {
    makeApiWithTopics(['react', 'vue'])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => {
      expect(screen.queryByText('react')).not.toBeInTheDocument()
    })
  })

  it('renders a colored dot for subtype suggestions (not the hex icon)', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('UI Library'))
    // Subtype items use ● not ⬡
    const subtypeRow = screen.getByText('UI Library').closest('div')!
    expect(subtypeRow.textContent).toContain('●')
    expect(subtypeRow.textContent).not.toContain('⬡')
  })

  it('renders a hex icon for topic suggestions', async () => {
    makeApiWithTopics(['ui-components'])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('ui-components'))
    const topicRow = screen.getByText('ui-components').closest('div')!
    expect(topicRow.textContent).toContain('⬡')
  })

  it('clicking a subtype suggestion clears the query', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('UI Library'))
    fireEvent.mouseDown(screen.getByText('UI Library').closest('div[style]')!)
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
  })

  it('clicking a subtype suggestion triggers a search API call via the type filter', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const searchSpy = (window as any).api.repo.search as ReturnType<typeof vi.fn>
    searchSpy.mockClear()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('UI Library'))
    fireEvent.mouseDown(screen.getByText('UI Library').closest('div[style]')!)
    // The selectedSubtypes useEffect fires a search when selectedSubtypes changes
    await waitFor(() => expect(searchSpy).toHaveBeenCalled())
  })

  it('pressing Enter on a highlighted subtype suggestion clears the query', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('UI Library'))
    // Arrow down to highlight the first suggestion (UI Library)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Query should be cleared after selecting a subtype via keyboard
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
  })

  it('pressing Enter on a highlighted subtype suggestion triggers a search API call', async () => {
    makeApiWithTopics([])
    renderDiscover()
    const searchSpy = (window as any).api.repo.search as ReturnType<typeof vi.fn>
    searchSpy.mockClear()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'ui' } })
    await waitFor(() => screen.getByText('UI Library'))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The selectedSubtypes useEffect fires a search (via loadTrending → repo.search)
    await waitFor(() => expect(searchSpy).toHaveBeenCalled())
  })

  it('pressing Enter on a highlighted topic suggestion completes the text in the input', async () => {
    // Use a topic that won't match any subtype label so it's the first (and only) suggestion
    makeApiWithTopics(['storybook-addon'])
    renderDiscover()
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.change(input, { target: { value: 'storybook' } })
    await waitFor(() => screen.getByText('storybook-addon'))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Input should be completed with the full topic label
    await waitFor(() =>
      expect((input as HTMLInputElement).value.trim()).toBe('storybook-addon')
    )
  })
})
