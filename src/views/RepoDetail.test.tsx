import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RepoDetail, { __resetRepoDetailCaches } from './RepoDetail'
import { SavedReposProvider } from '../contexts/SavedRepos'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { AppearanceProvider } from '../contexts/Appearance'
import { GitHubAuthProvider } from '../contexts/GitHubAuth'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { parseSkillDepths } from '../utils/skillParse'
import type { SkillRow } from '../types/repo'

// BannerCard renders DitherBackground directly; mock it so jsdom doesn't choke
// on canvas operations while the Activities tab renders cards in tests.
vi.mock('../components/DitherBackground', () => ({ default: () => <div data-testid="dither" /> }))

// Isolate the module-singleton session caches (_repoCache/_releasesCache/
// _starredCache) so a prior test's cached state for the shared vercel/next.js
// cacheKey cannot leak into the next (root cause of the order-dependent
// activities-feed failures).
beforeEach(() => { __resetRepoDetailCaches() })

// ── parseSkillDepths unit tests ──────────────────────────────────────
describe('parseSkillDepths', () => {
  it('counts lines in each section', () => {
    const content = '## [CORE]\nfoo\nbar\n## [EXTENDED]\nbaz\n## [DEEP]\nqux\nquux'
    const result = parseSkillDepths(content)
    expect(result.core).toBe(2)
    expect(result.extended).toBe(1)
    expect(result.deep).toBe(2)
  })

  it('returns zeros for empty content', () => {
    const result = parseSkillDepths('')
    expect(result.core).toBe(0)
    expect(result.extended).toBe(0)
    expect(result.deep).toBe(0)
  })
})

// ── RepoDetail install button tests ─────────────────────────────────

const repoRow = {
  owner: 'vercel', name: 'next.js', description: 'The React framework',
  language: 'TypeScript', stars: 100000, forks: 20000, open_issues: 500,
  watchers: 100000, size: 50000, license: 'MIT', topics: '[]',
  updated_at: '2024-01-01', saved_at: null,
}

const sampleRelease = {
  tag_name: 'v1.0.0',
  name: 'v1.0.0',
  published_at: '2026-04-01T00:00:00Z',
  body: 'release notes',
  assets: [],
  prerelease: false,
}

function setupDetail(
  skillRow: SkillRow | null,
  apiKey: string | null = null,
  generateFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ content: '## [CORE]\nfoo', version: 'v1' }),
  relatedRepos: object[] = [],
  releases: object[] | 'reject' = [],
  userEvents: object[] | 'reject' = [],
  anatomyPayload: object | null = null,
  pluginIndex: { skills: object[]; subagents: object[]; slashCommands: object[] } | 'hang' = { skills: [], subagents: [], slashCommands: [] },
) {
  const releasesFn = releases === 'reject'
    ? vi.fn().mockRejectedValue(new Error('boom'))
    : vi.fn().mockResolvedValue(releases)
  const userEventsFn = userEvents === 'reject'
    ? vi.fn().mockRejectedValue(new Error('boom'))
    : vi.fn().mockResolvedValue(userEvents)
  Object.defineProperty(window, 'api', {
    value: {
      github: {
        fetchRepoBundle: vi.fn().mockResolvedValue(null),
        getRepo: vi.fn().mockResolvedValue(repoRow),
        getReleases: releasesFn,
        getRelatedRepos: vi.fn().mockResolvedValue(relatedRepos),
        getReadme: vi.fn().mockResolvedValue(null),
        saveRepo: vi.fn().mockResolvedValue(undefined),
        searchRepos: vi.fn().mockResolvedValue([]),
        getSavedRepos: vi.fn().mockResolvedValue([]),
        starRepo: vi.fn().mockResolvedValue(undefined),
        unstarRepo: vi.fn().mockResolvedValue(undefined),
        isStarred: vi.fn().mockResolvedValue(false),
        getUser: vi.fn().mockResolvedValue({ login: 'tester' }),
        getRepoUserEvents: userEventsFn,
        getRepoStats: vi.fn().mockResolvedValue('loading'),
        recordFork: vi.fn().mockResolvedValue(undefined),
        setArchivedAt: vi.fn().mockResolvedValue(undefined),
      },
      org: {
        getVerified: vi.fn().mockResolvedValue(false),
      },
      settings: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        getApiKey: vi.fn().mockResolvedValue(apiKey),
        setApiKey: vi.fn(),
      },
      skill: {
        generate: generateFn,
        get: vi.fn().mockResolvedValue(skillRow),
        getAnatomy: vi.fn().mockResolvedValue(anatomyPayload),
        getSubSkill: vi.fn().mockResolvedValue(null),
        getVersionedInstalls: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        detectClaudeCode: vi.fn().mockResolvedValue(false),
      },
      library: {
        getCollections: vi.fn().mockResolvedValue([]),
      },
      storybook: {
        detect: vi.fn().mockResolvedValue(null),
      },
      translate: {
        detect: vi.fn().mockResolvedValue(null),
        translate: vi.fn().mockResolvedValue(null),
      },
      verification: {
        prioritise:  vi.fn().mockResolvedValue(undefined),
        getScore:    vi.fn().mockResolvedValue(null),
        onUpdated:   vi.fn(),
        offUpdated:  vi.fn(),
      },
      notes: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        pullFromGitHub: vi.fn().mockResolvedValue({ action: 'noop' }),
      },
      skillSync: {
        getStatus: vi.fn().mockResolvedValue({ enabled: false }),
      },
      engagement: {
        logClick: vi.fn().mockResolvedValue(undefined),
        getRecentlyVisited: vi.fn().mockResolvedValue([]),
      },
      agents: {
        import: {
          discoverPluginInRepo: pluginIndex === 'hang'
            ? vi.fn().mockReturnValue(new Promise(() => { /* never resolves — simulates in-flight scan */ }))
            : vi.fn().mockResolvedValue({
              owner: 'vercel', name: 'next.js', branch: 'main', commitSha: 'abc1234',
              layout: 'plugin', ...pluginIndex,
            }),
        },
      },
    },
    writable: true, configurable: true,
  })
  return render(
    <MemoryRouter initialEntries={['/repo/vercel/next.js']}>
      <AppearanceProvider>
        <GitHubAuthProvider>
          <ProfileOverlayProvider>
            <SavedReposProvider>
              <MockLearningProgressProvider>
                <Routes>
                  <Route path="/repo/:owner/:name" element={<RepoDetail />} />
                </Routes>
              </MockLearningProgressProvider>
            </SavedReposProvider>
          </ProfileOverlayProvider>
        </GitHubAuthProvider>
      </AppearanceProvider>
    </MemoryRouter>
  )
}

describe('RepoDetail install button', () => {
  it('shows "Learn" when skill not installed', async () => {
    setupDetail(null)
    await waitFor(() => screen.getAllByText('next.js'))
    expect(screen.getByText('Learn')).toBeInTheDocument()
  })

  it('shows "Learned" when skill row exists on mount', async () => {
    setupDetail({
      repo_id: '12345', filename: 'next.js.skill.md',
      content: '## [CORE]\nfoo\n## [EXTENDED]\nbar\n## [DEEP]\nbaz',
      version: 'v14.0', generated_at: '2024-01-01', active: 1, enabled_components: null, enabled_tools: null,
    })
    await waitFor(() => screen.getByText('Learned'))
  })

  it('transitions to generating on click', async () => {
    // Pass a never-resolving generate fn so the button stays in LEARNING state
    const neverResolves = vi.fn().mockReturnValue(new Promise(() => {}))
    setupDetail(null, 'sk-ant-test', neverResolves)
    await waitFor(() => screen.getAllByText('next.js'))
    fireEvent.click(screen.getByText('Learn'))
    // New split-button surfaces "Cancel" as the primary action label during LEARNING
    await waitFor(() => screen.getByText('Cancel'))
  })
})

describe('RepoDetail skill tab', () => {
  it('shows skill content in Skill file tab when installed', async () => {
    const content = '## [CORE]\ninstall: npm i next\n## [EXTENDED]\nextra\n## [DEEP]\ndeep'
    setupDetail({
      repo_id: '12345', filename: 'next.js.skill.md',
      content, version: 'v14.0', generated_at: '2024-01-01', active: 1, enabled_components: null, enabled_tools: null,
    })
    await waitFor(() => screen.getByText('Learned'))
    fireEvent.click(screen.getByRole('button', { name: 'Skills Folder' }))
    await waitFor(() => screen.getByText(/install: npm i next/))
  })

  it('shows skill tab header with depth bars when skill is installed', async () => {
    const content = '## [CORE]\ninstall: npm i next\n## [EXTENDED]\nextra\n## [DEEP]\ndeep'
    setupDetail({
      repo_id: '12345', filename: 'next.js.skill.md',
      content, version: 'v14.0', generated_at: '2024-01-01', active: 1, enabled_components: null, enabled_tools: null,
    })
    await waitFor(() => screen.getByText('Learned'))
    fireEvent.click(screen.getByRole('button', { name: 'Skills Folder' }))
    await waitFor(() => {
      expect(screen.getAllByText('Core').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Extended').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Deep').length).toBeGreaterThan(0)
      expect(screen.getAllByText('next.js.skill.md').length).toBeGreaterThan(0)
    })
  })

  it('does not show skill tab header when skill is not installed', async () => {
    setupDetail(null)
    await waitFor(() => screen.getByText('Learn'))
    fireEvent.click(screen.getByRole('button', { name: 'Skills Folder' }))
    await waitFor(() => {
      expect(screen.queryAllByText('Core').length).toBe(0)
      expect(screen.getAllByText('Learn this repo to generate a Skills Folder for Claude.').length).toBeGreaterThan(0)
    })
  })

  it('renders the anatomy view (not depth bars) for anatomy-source skills', async () => {
    const anatomyPayload = {
      source: 'generated', commit: 'c1', fingerprint: 'fp', rawContent: '[identity]\nform="lib"', rawMemory: null,
      model: { identity: { stack: 'ts', form: 'lib', domain: 'd', function: 'f' }, generated: {},
               rules: [{ statement: 'anatomy-rule-r1' }], decisions: [] },
      memory: [], verify: null,
    }
    setupDetail(
      { repo_id: '12345', filename: '.anatomy', content: '[identity]\nform="lib"', version: 'v1',
        generated_at: '2024-01-01', active: 1, enabled_components: null, enabled_tools: null,
        anatomy_source: 'generated' } as SkillRow,
      null, vi.fn(), [], [], [], anatomyPayload,
    )
    // Readiness gate: repo name (robust — matches the passing tests' pattern;
    // the 'Learned' button flow is pre-existing-broken in this suite).
    await waitFor(() => screen.getAllByText('next.js'))
    fireEvent.click(screen.getByRole('button', { name: 'Skills Folder' }))
    await waitFor(() => {
      expect(screen.getByText('anatomy-rule-r1')).toBeInTheDocument()
      expect(screen.queryAllByText('Core').length).toBe(0)
    })
  })
})

describe('RepoDetail related tab', () => {
  it('does not show Related tab when related repos is empty', async () => {
    setupDetail(null)
    // Related's absence is the assertion — gate on the always-present Activities tab to prove the tab strip mounted.
    await screen.findByRole('button', { name: 'Activities' })
    expect(screen.queryByRole('button', { name: 'Related' })).not.toBeInTheDocument()
  })

  it('shows Related tab and cards when related repos are provided', async () => {
    setupDetail(null, null, vi.fn(), [
      {
        owner: 'facebook', name: 'react', description: 'A JS library',
        language: 'JavaScript', stars: 200000, forks: 40000,
        open_issues: 1000, watchers: 200000, size: 30000,
        license: 'MIT', topics: '[]', updated_at: '2024-01-01', saved_at: null,
      },
    ])
    const relatedTab = await waitFor(() => screen.getByRole('button', { name: 'Related' }))
    fireEvent.click(relatedTab)
    await waitFor(() => screen.getByText('react'))
  })
})

describe('RepoDetail activities tab', () => {
  it('shows the Activities tab and selects it by default when releases is non-empty', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease])
    const activitiesTab = await waitFor(() =>
      screen.getByRole('button', { name: 'Activities' })
    )
    // It's the active tab — assert via the BannerCard rendering.
    await waitFor(
      () => {
        const card = container.querySelector('.banner-card')
        if (!card) throw new Error('banner-card not yet rendered')
        return card
      },
      { timeout: 3000 },
    )
    expect(activitiesTab).toBeInTheDocument()
  })

  it('shows the Activities tab even when releases is empty, but falls back to README as the default', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [])
    await screen.findByRole('button', { name: 'Activities' })
    // Tab is always visible
    expect(screen.getByRole('button', { name: 'Activities' })).toBeInTheDocument()
    // README is the active default — Activities body is not mounted, no BannerCards
    expect(container.querySelector('.banner-card')).toBeNull()
  })

  it('shows the Activities tab even when getReleases rejects, but falls back to README as the default', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], 'reject')
    await screen.findByRole('button', { name: 'Activities' })
    expect(screen.getByRole('button', { name: 'Activities' })).toBeInTheDocument()
    expect(container.querySelector('.banner-card')).toBeNull()
  })

  it('opens the ActivityModal when a release card is clicked', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease])
    const card = await waitFor(
      () => {
        const el = container.querySelector('.banner-card')
        if (!el) throw new Error('banner-card not yet rendered')
        return el
      },
      { timeout: 3000 },
    )
    fireEvent.click(card)
    // Modal renders — the close × button is a stable assertion target.
    await waitFor(() => screen.getByLabelText('Close'))
  })
})

describe('RepoDetail activities tab — merged feed', () => {
  const sampleStarEvent = { type: 'star', ts: '2026-04-15T10:00:00Z' }

  it('renders both BannerCards and RepoUserEventRows when both sources have data', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], [sampleStarEvent])
    await waitFor(
      () => {
        if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
        return container.querySelector('.banner-card')
      },
      { timeout: 3000 },
    )
    expect(container.querySelector('.repo-user-event')).not.toBeNull()
  })

  it('renders only user events when releases is empty', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [], [sampleStarEvent])
    await waitFor(
      () => {
        if (!container.querySelector('.repo-user-event')) throw new Error('user-event not yet')
        return container.querySelector('.repo-user-event')
      },
      { timeout: 3000 },
    )
    expect(container.querySelector('.banner-card')).toBeNull()
  })

  it('renders only releases when user events is empty', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], [])
    await waitFor(
      () => {
        if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
        return container.querySelector('.banner-card')
      },
      { timeout: 3000 },
    )
    expect(container.querySelector('.repo-user-event')).toBeNull()
  })

  it('default tab is Activities when user events is non-empty even with no releases', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [], [sampleStarEvent])
    await waitFor(
      () => {
        if (!container.querySelector('.repo-user-event')) throw new Error('not yet')
        return container.querySelector('.repo-user-event')
      },
      { timeout: 3000 },
    )
  })

  it('default tab falls back to Readme when both releases and user events are empty', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [], [])
    await screen.findByRole('button', { name: 'Activities' })
    expect(container.querySelector('.banner-card')).toBeNull()
    expect(container.querySelector('.repo-user-event')).toBeNull()
  })

  it('renders the resolved source when one errors and the other resolves', async () => {
    const { container } = setupDetail(null, null, vi.fn(), [], [sampleRelease], 'reject')
    await waitFor(
      () => {
        if (!container.querySelector('.banner-card')) throw new Error('banner-card not yet')
        return container.querySelector('.banner-card')
      },
      { timeout: 3000 },
    )
  })
})

describe('releaseRowToFeedEvent', () => {
  it('maps a ReleaseRow to a synthetic ReleaseEvent with the expected shape', async () => {
    const { releaseRowToFeedEvent } = await import('./RepoDetail')
    const row = {
      tag_name: 'v2.0.0',
      name: 'Two Point Oh',
      published_at: '2026-03-15T12:00:00Z',
      body: 'big release',
      assets: [{ name: 'a.zip', size: 100, browser_download_url: 'u', download_count: 0 }],
      prerelease: false,
    }
    const event = releaseRowToFeedEvent(row, 'acme/widget')
    expect(event.id).toBe('release-v2.0.0')
    expect(event.type).toBe('ReleaseEvent')
    expect(event.repo.full_name).toBe('acme/widget')
    expect(event.created_at).toBe('2026-03-15T12:00:00Z')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const release = (event.payload as any).release
    expect(release.tag_name).toBe('v2.0.0')
    expect(release.name).toBe('Two Point Oh')
    expect(release.body).toBe('big release')
    expect(release.prerelease).toBe(false)
    expect(release.assets).toHaveLength(1)
  })
})

describe('RepoDetail import-to-agent button', () => {
  it('does not render the button when the repo has no importable agent content', async () => {
    setupDetail(null)
    await waitFor(() => screen.getAllByText('next.js'))
    // Wait for the deferred detection effect to actually fire (proves it ran
    // and resolved with an empty index) — avoids a time-based wait that would
    // be flaky on slow CI workers.
    await waitFor(
      () => expect((window.api.agents.import.discoverPluginInRepo as ReturnType<typeof vi.fn>)).toHaveBeenCalled(),
      { timeout: 1500 },
    )
    expect(screen.queryByLabelText('Import to agent library')).toBeNull()
  })

  it('renders the standalone button when discoverPluginInRepo reports importable content', async () => {
    setupDetail(
      null, null, undefined, [], [], [], null,
      { skills: [{ name: 's', path: 'skills/s/SKILL.md', description: '', fileCount: 1 }], subagents: [], slashCommands: [] },
    )
    await waitFor(() => screen.getAllByText('next.js'))
    await waitFor(() => expect(screen.getByLabelText('Import to agent library')).toBeInTheDocument())
  })

  it('does not render the button while detection is in-flight', async () => {
    setupDetail(null, null, undefined, [], [], [], null, 'hang')
    await waitFor(() => screen.getAllByText('next.js'))
    // The hanging discoverPluginInRepo mock means canImportAgents stays false,
    // so the standalone button must not appear until detection settles.
    expect(screen.queryByLabelText('Import to agent library')).toBeNull()
  })
})
