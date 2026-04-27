import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Settings from './Settings'

function setupApi(opts: {
  apiKey?: string | null
  mcpConfigured?: boolean
  configPath?: string | null
  autoConfigResult?: { success: boolean; error?: string }
  snippet?: string
  testResult?: { running: boolean; skillCount: number }
}) {
  Object.defineProperty(window, 'api', {
    value: {
      settings: {
        getApiKey: vi.fn().mockResolvedValue(opts.apiKey ?? null),
        setApiKey: vi.fn().mockResolvedValue(undefined),
        getPreferredLanguage: vi.fn().mockResolvedValue('en'),
        setPreferredLanguage: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      skill: {
        detectClaudeCode: vi.fn().mockResolvedValue(false),
        checkAuthStatus: vi.fn().mockResolvedValue(false),
        onSetupProgress: vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress: vi.fn(),
        offLoginProgress: vi.fn(),
      },
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          configured: opts.mcpConfigured ?? false,
          configPath: opts.configPath ?? null,
        }),
        autoConfigure: vi.fn().mockResolvedValue(opts.autoConfigResult ?? { success: true }),
        getConfigSnippet: vi.fn().mockResolvedValue(
          opts.snippet ?? '{"mcpServers":{"git-suite":{}}}'
        ),
        testConnection: vi.fn().mockResolvedValue(
          opts.testResult ?? { running: false, skillCount: 0 }
        ),
      },
      download: {
        getDefaultFolder: vi.fn().mockResolvedValue('/default/downloads'),
        pickFolder: vi.fn().mockResolvedValue(null),
      },
      tts: {
        getVoices: vi.fn().mockResolvedValue([]),
        synthesize: vi.fn().mockResolvedValue({ audio: new ArrayBuffer(0), wordBoundaries: [] }),
        checkAvailable: vi.fn().mockResolvedValue(true),
      },
      skillSync: {
        getStatus: vi.fn().mockResolvedValue({ enabled: false, repoOwner: undefined, failedCount: 0, lastSynced: null }),
        onSyncFailed: vi.fn(),
        offSyncFailed: vi.fn(),
        setup: vi.fn(),
        disconnect: vi.fn(),
        retryFailed: vi.fn(),
      },
    },
    writable: true,
    configurable: true,
  })

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  })
}

describe('Settings — Claude Desktop section', () => {
  beforeEach(() => {
    setupApi({})
  })

  it('renders CLAUDE DESKTOP section title', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getAllByText(/CLAUDE DESKTOP/i).length).toBeGreaterThan(0)
    })
  })

  it('shows Not configured status when not configured', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Not configured/i)).toBeInTheDocument()
    })
  })

  it('shows Configured status when configured', async () => {
    setupApi({ mcpConfigured: true, configPath: '/path/to/config.json' })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/^Configured$/i)).toBeInTheDocument()
    })
  })

  it('shows config path when available', async () => {
    setupApi({ configPath: '/path/to/claude_desktop_config.json' })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/claude_desktop_config\.json/)).toBeInTheDocument()
    })
  })

  it('renders Auto-configure button', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Auto-configure Claude Desktop/i)).toBeInTheDocument()
    })
  })

  it('copies config snippet to clipboard', async () => {
    const snippet = '{"mcpServers":{"git-suite":{}}}'
    setupApi({ snippet })
    render(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /^Copy$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(snippet)
    })
  })

  it('renders Test connection button', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Test connection/i)).toBeInTheDocument()
    })
  })

  it('calls mcp.autoConfigure when Auto-configure clicked', async () => {
    setupApi({ mcpConfigured: false })
    render(<Settings />)
    await waitFor(() => screen.getByText(/Auto-configure/i))
    fireEvent.click(screen.getByText(/Auto-configure Claude Desktop/i))
    await waitFor(() => {
      expect(window.api.mcp.autoConfigure).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText(/Configured!/i)).toBeInTheDocument()
    })
  })

  it('shows failure message when autoConfigure fails', async () => {
    setupApi({ autoConfigResult: { success: false, error: 'Permission denied' } })
    render(<Settings />)
    await waitFor(() => screen.getByText(/Auto-configure Claude Desktop/i))
    fireEvent.click(screen.getByText(/Auto-configure Claude Desktop/i))
    await waitFor(() => {
      expect(screen.getByText(/Failed: Permission denied/i)).toBeInTheDocument()
    })
  })

  it('calls mcp.testConnection when Test connection clicked', async () => {
    setupApi({ testResult: { running: true, skillCount: 3 } })
    render(<Settings />)
    await waitFor(() => screen.getByText(/Test connection/i))
    fireEvent.click(screen.getByText(/Test connection/i))
    await waitFor(() => {
      expect(window.api.mcp.testConnection).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText(/Running — 3 active skills/i)).toBeInTheDocument()
    })
  })
})

describe('Settings — Text-to-Speech section', () => {
  beforeEach(() => {
    setupApi({})
    // Add tts and settings.get to the mock API
    ;(window.api as any).tts = {
      getVoices: vi.fn().mockResolvedValue([
        { shortName: 'en-US-AriaNeural', label: 'Aria (Female)' },
        { shortName: 'en-US-GuyNeural', label: 'Guy (Male)' },
      ]),
      synthesize: vi.fn().mockResolvedValue({ audio: new ArrayBuffer(0), wordBoundaries: [] }),
      checkAvailable: vi.fn().mockResolvedValue(true),
    }
    ;(window.api as any).settings.get = vi.fn().mockResolvedValue(null)
    ;(window.api as any).settings.set = vi.fn().mockResolvedValue(undefined)
  })

  it('renders TEXT-TO-SPEECH section title', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/TEXT-TO-SPEECH/)).toBeInTheDocument()
    })
  })

  it('renders voice dropdown with curated voices', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Aria (Female)')).toBeInTheDocument()
      expect(screen.getByText('Guy (Male)')).toBeInTheDocument()
    })
  })

  it('saves voice preference on change', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByText('Aria (Female)'))
    const select = screen.getByDisplayValue('Aria (Female)') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'en-US-GuyNeural' } })
    await waitFor(() => {
      expect(window.api.settings.set).toHaveBeenCalledWith('tts_voice', 'en-US-GuyNeural')
    })
  })

  it('renders Preview button', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Preview/)).toBeInTheDocument()
    })
  })
})
