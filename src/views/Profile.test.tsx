import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { GitHubAuthProvider } from '../contexts/GitHubAuth'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { fixtureRepo } from '../test-utils/repoFixtures'
import Profile from './Profile'

// jsdom does not provide ResizeObserver — needed by DitherBackground inside RepoCard
let originalResizeObserver: typeof ResizeObserver
beforeAll(() => {
  originalResizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver
})

// vi.mock must be at module scope — Vitest hoists these to the top of the file.
// Store mockOpenProfile at module scope so PeopleTab and tests share the same reference.
const mockOpenProfile = vi.fn()

vi.mock('../contexts/ProfileOverlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/ProfileOverlay')>()
  return {
    ...actual,
    useProfileOverlay: () => ({
      openProfile:  mockOpenProfile,
      pushProfile:  vi.fn(),
      popProfile:   vi.fn(),
      closeProfile: vi.fn(),
      setStackAt:   vi.fn(),
      profileState: { isOpen: false, stack: [], currentUsername: '' },
    }),
  }
})

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    github: {
      getUser: vi.fn().mockResolvedValue({ login: 'alice', avatarUrl: '', publicRepos: 5 }),
    },
    profile: {
      getUser: vi.fn().mockResolvedValue({
        login: 'alice',
        name: 'Alice Smith',
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Test bio',
        location: 'NYC',
        company: 'Acme',
        blog: 'https://alice.dev',
        createdAt: '2020-01-15T00:00:00Z',
        publicRepos: 12,
        followers: 100,
        following: 50,
        htmlUrl: 'https://github.com/alice',
      }),
      getUserRepos: vi.fn().mockResolvedValue([]),
      getStarred:   vi.fn().mockResolvedValue([]),
      getFollowing: vi.fn().mockResolvedValue([]),
      getFollowers: vi.fn().mockResolvedValue([]),
      isFollowing:  vi.fn().mockResolvedValue(false),
      follow:       vi.fn().mockResolvedValue(undefined),
      unfollow:     vi.fn().mockResolvedValue(undefined),
    },
    org: {
      getVerified: vi.fn().mockResolvedValue(false),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getPreferredLanguage: vi.fn().mockResolvedValue('en'),
    },
    translate: {
      check: vi.fn().mockResolvedValue(null),
      translate: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  }
}

function renderProfile() {
  return render(
    <GitHubAuthProvider>
      <ProfileOverlayProvider>
        <MockLearningProgressProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <Routes>
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </MemoryRouter>
        </MockLearningProgressProvider>
      </ProfileOverlayProvider>
    </GitHubAuthProvider>
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'api', { value: makeApi(), writable: true, configurable: true })
})

describe('Profile — sidebar', () => {
  it('shows loading skeleton initially', () => {
    renderProfile()
    expect(document.querySelector('.profile-view-avatar-skeleton')).toBeInTheDocument()
  })

  it('renders display name after load', async () => {
    renderProfile()
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument())
  })

  it('renders @username after load', async () => {
    renderProfile()
    await waitFor(() => expect(screen.getByText('@alice')).toBeInTheDocument())
  })

  it('renders bio', async () => {
    renderProfile()
    await waitFor(() => expect(screen.getByText('Test bio')).toBeInTheDocument())
  })

  it('renders follower and following counts', async () => {
    renderProfile()
    await waitFor(() => {
      expect(screen.getAllByText('100').length).toBeGreaterThan(0)
      expect(screen.getAllByText('50').length).toBeGreaterThan(0)
    })
  })

  it('shows error state if getUser fails', async () => {
    Object.defineProperty(window, 'api', {
      value: makeApi({
        profile: {
          getUser: vi.fn().mockRejectedValue(new Error('fail')),
          getUserRepos: vi.fn().mockResolvedValue([]),
          getStarred: vi.fn().mockResolvedValue([]),
          getFollowing: vi.fn().mockResolvedValue([]),
          getFollowers: vi.fn().mockResolvedValue([]),
          isFollowing: vi.fn().mockResolvedValue(false),
          follow: vi.fn().mockResolvedValue(undefined),
          unfollow: vi.fn().mockResolvedValue(undefined),
        },
      }),
      writable: true, configurable: true,
    })
    renderProfile()
    await waitFor(() => expect(screen.getByText(/could not load profile/i)).toBeInTheDocument())
  })
})

describe('Profile — tab bar', () => {
  it('shows all four tabs', async () => {
    renderProfile()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /repos/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /starred/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /following/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /followers/i })).toBeInTheDocument()
    })
  })

  it('Repos tab is active by default', async () => {
    renderProfile()
    await waitFor(() => {
      const tab = screen.getByRole('button', { name: /^repos/i })
      expect(tab.className).toContain('active')
    })
  })
})

describe('ReposTab', () => {
  it('shows repos after fetch', async () => {
    Object.defineProperty(window, 'api', {
      value: makeApi({
        profile: {
          ...makeApi().profile,
          getUserRepos: vi.fn().mockResolvedValue([
            fixtureRepo({
              hostNativeId: 1,
              fullName: 'alice/my-repo',
              owner: 'alice',
              name: 'my-repo',
              description: 'A repo',
              language: 'TypeScript',
              stars: 42,
              forks: 3,
              watchers: 42,
              size: 100,
              openIssues: 0,
              updatedAt: '2024-01-01T00:00:00Z',
            }),
          ]),
        },
      }),
      writable: true, configurable: true,
    })
    renderProfile()
    await waitFor(() => expect(screen.getByText('my-repo')).toBeInTheDocument())
  })

  it('re-fetches with new sort param when sort changes', async () => {
    const getUserRepos = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      value: makeApi({ profile: { ...makeApi().profile, getUserRepos } }),
      writable: true, configurable: true,
    })
    renderProfile()
    await waitFor(() => screen.getByRole('button', { name: /updated/i }))
    fireEvent.click(screen.getByRole('button', { name: /updated/i }))
    await waitFor(() => {
      expect(getUserRepos).toHaveBeenCalledWith('alice', 'updated')
    })
  })
})

describe('StarredTab', () => {
  it('shows starred repos after fetch', async () => {
    Object.defineProperty(window, 'api', {
      value: makeApi({
        profile: {
          ...makeApi().profile,
          getStarred: vi.fn().mockResolvedValue([
            fixtureRepo({
              hostNativeId: 2,
              fullName: 'other/cool-lib',
              owner: 'other',
              name: 'cool-lib',
              description: null,
              language: 'Go',
              stars: 999,
              forks: 10,
              watchers: 999,
              size: 200,
              openIssues: 5,
              updatedAt: '2024-03-01T00:00:00Z',
            }),
          ]),
        },
      }),
      writable: true, configurable: true,
    })
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /^starred/i }))
    await waitFor(() => expect(screen.getByText('cool-lib')).toBeInTheDocument())
  })

  it('does not re-fetch when sort changes (client-side sort)', async () => {
    const getStarred = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      value: makeApi({ profile: { ...makeApi().profile, getStarred } }),
      writable: true, configurable: true,
    })
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /^starred/i }))
    await waitFor(() => getStarred.mock.calls.length > 0)
    const callsBefore = getStarred.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /recent/i }))
    await new Promise(r => setTimeout(r, 100))
    expect(getStarred.mock.calls.length).toBe(callsBefore)
  })
})

describe('PeopleTab', () => {
  const personApi = {
    ...makeApi().profile,
    getFollowing: vi.fn().mockResolvedValue([
      { login: 'bob', avatarUrl: 'https://example.com/bob.png', publicRepos: 0, name: null, bio: null },
    ]),
    getFollowers: vi.fn().mockResolvedValue([
      { login: 'carol', avatarUrl: 'https://example.com/carol.png', publicRepos: 0, name: null, bio: null },
    ]),
  }

  beforeEach(() => {
    personApi.getFollowing.mockClear()
    personApi.getFollowers.mockClear()
    Object.defineProperty(window, 'api', {
      value: makeApi({ profile: personApi }),
      writable: true, configurable: true,
    })
  })

  it('renders people in Following tab', async () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /following/i }))
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument())
  })

  it('renders people in Followers tab', async () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /followers/i }))
    await waitFor(() => expect(screen.getByText('carol')).toBeInTheDocument())
  })

  it('clicking a person opens ProfileOverlay', async () => {
    mockOpenProfile.mockClear()
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /following/i }))
    await waitFor(() => screen.getByText('bob'))
    fireEvent.click(screen.getByText('bob'))
    expect(mockOpenProfile).toHaveBeenCalledWith('bob')
  })
})
