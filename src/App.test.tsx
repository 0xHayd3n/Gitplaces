import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import App from './App'

function makeApi(overrides: Partial<typeof window.api> = {}) {
  return {
    windowControls: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() },
    hosts: {
      startDeviceFlow: vi.fn(), pollDeviceToken: vi.fn(), cancelDeviceFlow: vi.fn(),
      openLoginPopup: vi.fn().mockResolvedValue(undefined),
      getConnectedUser: vi.fn().mockResolvedValue(null),
      clearToken: vi.fn().mockResolvedValue(undefined),
    },
    repo: {
      getMyStarred: vi.fn().mockResolvedValue([]),
      getSaved: vi.fn().mockResolvedValue([]),
      getFeed: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      getReadme: vi.fn().mockResolvedValue(null),
      getReleases: vi.fn().mockResolvedValue([]),
      getCompare: vi.fn().mockResolvedValue(null),
      getRelated: vi.fn().mockResolvedValue([]),
      getRecommended: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getApiKey: vi.fn().mockResolvedValue(null),
      setApiKey: vi.fn().mockResolvedValue(undefined),
    },
    skill: {
      generate: vi.fn().mockResolvedValue({ content: '', version: 'unknown' }),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
      detectClaudeCode: vi.fn().mockResolvedValue(false),
    },
    mcp: {
      getStatus: vi.fn().mockResolvedValue({ configured: false, configPath: null }),
    },
    search: {
      raw:            vi.fn().mockResolvedValue([]),
      tagged:         vi.fn().mockResolvedValue([]),
      extractTags:    vi.fn().mockResolvedValue([]),
      getRelatedTags: vi.fn().mockResolvedValue([]),
      getTopics:      vi.fn().mockResolvedValue([]),
    },
    profile: {
      getUser:      vi.fn().mockResolvedValue(null),
      getUserRepos: vi.fn().mockResolvedValue([]),
      getStarred:   vi.fn().mockResolvedValue([]),
      getFollowing: vi.fn().mockResolvedValue([]),
      getFollowers: vi.fn().mockResolvedValue([]),
      isFollowing:  vi.fn().mockResolvedValue(false),
      follow:       vi.fn().mockResolvedValue(undefined),
      unfollow:     vi.fn().mockResolvedValue(undefined),
    },
    verification: {
      prioritise:  vi.fn().mockResolvedValue(undefined),
      getScore:    vi.fn().mockResolvedValue(null),
      onUpdated:   vi.fn(),
      offUpdated:  vi.fn(),
    },
    ...overrides,
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'api', { value: makeApi(), writable: true, configurable: true })
})

describe('App onboarding gate', () => {
  it('renders the app shell immediately without waiting for settings', () => {
    // settings.get never resolves — app should render optimistically instead of blocking
    window.api.settings.get = vi.fn().mockReturnValue(new Promise(() => {}))
    const { container } = render(<App />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows onboarding when onboarding_complete is not set', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(null)
    render(<App />)
    // Sidebar is always rendered; Onboarding view appears in main
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-screen-0')).toBeInTheDocument()
    })
  })

  it('shows main app when onboarding_complete is "1"', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue('1')
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-screen-0')).not.toBeInTheDocument()
    })
  })

  it('fires background starred sync when onboarding complete', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue('1')
    render(<App />)
    await waitFor(() => {
      expect(window.api.repo.getMyStarred).toHaveBeenCalledWith('gh:api.github.com')
    })
  })

  it('does not fire sync when onboarding not complete', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue(null)
    render(<App />)
    await waitFor(() => screen.getByTestId('onboarding-screen-0'))
    expect(window.api.repo.getMyStarred).not.toHaveBeenCalled()
  })
})
