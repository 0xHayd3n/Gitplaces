import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Onboarding from './Onboarding'
import { GitHubAuthProvider } from '../contexts/GitHubAuth'

let navigatedTo = ''

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => (path: string) => { navigatedTo = path },
  }
})

function makeApi(overrides = {}) {
  let connected = false
  const user = { login: 'alice', avatarUrl: '', publicRepos: 5 }
  return {
    openExternal: vi.fn().mockResolvedValue(undefined),
    windowControls: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() },
    hosts: {
      startDeviceFlow: vi.fn().mockResolvedValue({
        deviceCode: 'dev-code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        verificationUriComplete: 'https://github.com/login/device?user_code=ABCD-1234',
        expiresIn: 900,
        interval: 5,
      }),
      pollDeviceToken: vi.fn(async () => { connected = true; return { user } }),
      cancelDeviceFlow: vi.fn().mockResolvedValue(undefined),
      openLoginPopup: vi.fn().mockResolvedValue(undefined),
      getConnectedUser: vi.fn(async () => connected ? user : null),
      clearToken: vi.fn().mockResolvedValue(undefined),
    },
    repo: {
      getMyStarred: vi.fn().mockResolvedValue([]),
    },
    settings: {
      get: vi.fn().mockResolvedValue('5'),
      set: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

function renderOnboarding() {
  return render(
    <GitHubAuthProvider>
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
      </MemoryRouter>
    </GitHubAuthProvider>
  )
}

beforeEach(() => {
  navigatedTo = ''
  Object.defineProperty(window, 'api', { value: makeApi(), writable: true, configurable: true })
})

// ── Screen 0 ────────────────────────────────────────────────────
describe('Screen 0 — Welcome', () => {
  it('shows screen 0 by default', () => {
    renderOnboarding()
    expect(screen.getByTestId('onboarding-screen-0')).toBeInTheDocument()
  })

  it('renders headline and sub text', () => {
    renderOnboarding()
    expect(screen.getByText(/Turn any GitHub repo into an/i)).toBeInTheDocument()
    expect(screen.getByText(/AI skill/i)).toBeInTheDocument()
  })

  it('Connect GitHub → advances to screen 1', () => {
    renderOnboarding()
    fireEvent.click(screen.getByText('Connect GitHub →'))
    expect(screen.getByTestId('onboarding-screen-1')).toBeInTheDocument()
  })

  it('Skip sets onboarding_complete and navigates to /discover', async () => {
    renderOnboarding()
    fireEvent.click(screen.getByText('Skip'))
    await waitFor(() => {
      expect(window.api.settings.set).toHaveBeenCalledWith('onboarding_complete', '1')
      expect(navigatedTo).toBe('/discover')
    })
  })

  it('does not show progress dots on screen 0', () => {
    renderOnboarding()
    expect(screen.queryByTestId('progress-dots')).not.toBeInTheDocument()
  })
})

// ── Screen 1 ────────────────────────────────────────────────────
describe('Screen 1 — Connect GitHub', () => {
  beforeEach(() => {
    renderOnboarding()
    fireEvent.click(screen.getByText('Connect GitHub →'))
  })

  it('shows screen 1', () => {
    expect(screen.getByTestId('onboarding-screen-1')).toBeInTheDocument()
  })

  it('shows progress dots', () => {
    expect(screen.getByTestId('progress-dots')).toBeInTheDocument()
  })

  it('shows Step 1 of 2 label', () => {
    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument()
  })

  it('Continue is disabled before connecting', () => {
    expect(screen.getByText('Continue →')).toBeDisabled()
  })

  it('Back returns to screen 0', () => {
    fireEvent.click(screen.getByText('← Back'))
    expect(screen.getByTestId('onboarding-screen-0')).toBeInTheDocument()
  })

  it('Connect starts the device flow and shows the user code', async () => {
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => {
      expect(window.api.hosts.startDeviceFlow).toHaveBeenCalledWith('gh:api.github.com')
      expect(screen.getByText('ABCD-1234')).toBeInTheDocument()
    })
  })

  it('after approval, Continue becomes enabled and shows connected state', async () => {
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => {
      expect(window.api.hosts.pollDeviceToken).toHaveBeenCalledWith('gh:api.github.com', 'dev-code', 5)
      expect(window.api.hosts.getConnectedUser).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('Continue →')).not.toBeDisabled()
    })
  })

  it('Continue advances to screen 2 when connected', async () => {
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('Continue →').closest('button')?.disabled === false)
    fireEvent.click(screen.getByText('Continue →'))
    expect(screen.getByTestId('onboarding-screen-2')).toBeInTheDocument()
  })

})

describe('Device flow cleanup', () => {
  it('cancels in-flight device flow on unmount', async () => {
    window.api.hosts.pollDeviceToken = vi.fn(() => new Promise(() => {})) // never resolves
    const { unmount } = renderOnboarding()
    fireEvent.click(screen.getByText('Connect GitHub →'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(window.api.hosts.startDeviceFlow).toHaveBeenCalled())
    unmount()
    expect(window.api.hosts.cancelDeviceFlow).toHaveBeenCalled()
  })
})

// ── Screen 2 ────────────────────────────────────────────────────
describe('Screen 2 — Done', () => {
  async function goToScreen2() {
    renderOnboarding()
    fireEvent.click(screen.getByText('Connect GitHub →'))
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => expect(window.api.hosts.pollDeviceToken).toHaveBeenCalled())
    await waitFor(() => {
      const btn = screen.getByText('Continue →')
      if ((btn as HTMLButtonElement).disabled) throw new Error('still disabled')
    })
    fireEvent.click(screen.getByText('Continue →'))
  }

  it('shows screen 2', async () => {
    await goToScreen2()
    expect(screen.getByTestId('onboarding-screen-2')).toBeInTheDocument()
  })

  it('shows HOW IT WORKS tip box', async () => {
    await goToScreen2()
    expect(screen.getByText('HOW IT WORKS')).toBeInTheDocument()
  })

  it('Open Gitplaces sets onboarding_complete and navigates to /discover', async () => {
    await goToScreen2()
    fireEvent.click(screen.getByText('Open Gitplaces →'))
    await waitFor(() => {
      expect(window.api.settings.set).toHaveBeenCalledWith('onboarding_complete', '1')
      expect(navigatedTo).toBe('/discover')
    })
  })

  it('Open Gitplaces fires getStarred in background', async () => {
    await goToScreen2()
    fireEvent.click(screen.getByText('Open Gitplaces →'))
    await waitFor(() => {
      expect(window.api.repo.getMyStarred).toHaveBeenCalledWith('gh:api.github.com')
    })
  })
})
