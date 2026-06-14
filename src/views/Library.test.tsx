import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Library from './Library'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { SearchProvider } from '../contexts/Search'
import { ToastProvider } from '../contexts/Toast'
import { GitHubAuthProvider } from '../contexts/GitHubAuth'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { fixtureLibrarySavedRepo } from '../test-utils/repoFixtures'

vi.mock('../components/CollectionsSidebar', () => ({
  default: () => <div data-testid="collections-sidebar" />,
}))

vi.mock('./RepoDetail', () => ({
  default: () => <div data-testid="repo-detail" />,
  primeRepoCacheFromRows: () => {},
}))

vi.mock('./CollectionDetail', () => ({
  default: () => <div data-testid="collection-detail" />,
}))

const mockRows = [
  fixtureLibrarySavedRepo({
    hostNativeId: 'repo-1',
    fullName: 'facebook/react',
    owner: 'facebook',
    name: 'react',
    language: 'TypeScript',
    description: 'A JS library',
    license: 'MIT',
    savedAt: '2026-01-01',
    type: 'skill',
    typeBucket: 'frameworks',
    typeSub: 'web-framework',
    version: 'v18.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
  }),
]

function renderLibrary(initialPath = '/library') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GitHubAuthProvider>
        <MockLearningProgressProvider>
          <ProfileOverlayProvider>
            <SearchProvider>
              <ToastProvider>
                <Library />
              </ToastProvider>
            </SearchProvider>
          </ProfileOverlayProvider>
        </MockLearningProgressProvider>
      </GitHubAuthProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('api', {
    library: { getAll: vi.fn().mockResolvedValue(mockRows) },
    starred: {
      getAll: vi.fn().mockResolvedValue([]),
      getRecentlyUnstarred: vi.fn().mockResolvedValue([]),
    },
    collection: { getAll: vi.fn().mockResolvedValue([]) },
    agents: {
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    updates: {
      onStatusChanged: vi.fn(),
      offStatusChanged: vi.fn(),
      onToast: vi.fn(),
      offToast: vi.fn(),
    },
    projects: {
      scanFolder: vi.fn().mockResolvedValue([]),
    },
    github: {
      setArchivedAt: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('Library', () => {
  it('renders the new sidebar with home button + mode toggle', async () => {
    renderLibrary()
    await screen.findByText('react')
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repositories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collections' })).toBeInTheDocument()
  })

  it('starts on the repos list by default', async () => {
    renderLibrary()
    await screen.findByText('react')
    expect(screen.getByRole('button', { name: 'Repositories' })).toHaveClass('active')
  })

  it('shows collections sidebar when Collections toggle is clicked', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await screen.findByText('react')
    await user.click(screen.getByRole('button', { name: 'Collections' }))
    expect(screen.getByTestId('collections-sidebar')).toBeInTheDocument()
  })
})
