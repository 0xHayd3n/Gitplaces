import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Settings from './Settings'

function setupApi(opts: {
  mcpConfigured?: boolean
  configPath?: string | null
  anthropicKey?: string | null
} = {}) {
  Object.defineProperty(window, 'api', {
    value: {
      settings: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        getPreferredLanguage: vi.fn().mockResolvedValue('en'),
        setPreferredLanguage: vi.fn().mockResolvedValue(undefined),
      },
      skill: {
        detectClaudeCode: vi.fn().mockResolvedValue(false),
        checkAuthStatus:  vi.fn().mockResolvedValue(false),
        onSetupProgress:  vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress:  vi.fn(),
        offLoginProgress: vi.fn(),
        setup:        vi.fn().mockResolvedValue(undefined),
        loginClaude:  vi.fn().mockResolvedValue(undefined),
        logoutClaude: vi.fn().mockResolvedValue(undefined),
      },
      llm: {
        getProviderConfig: vi.fn().mockImplementation((p: string) =>
          Promise.resolve({ enabled: p === 'anthropic' && !!opts.anthropicKey, apiKey: p === 'anthropic' ? (opts.anthropicKey ?? undefined) : undefined })
        ),
        setProviderConfig: vi.fn().mockResolvedValue(undefined),
        listOpenAICompatibleEndpoints: vi.fn().mockResolvedValue([]),
        upsertOpenAICompatibleEndpoint: vi.fn().mockResolvedValue(undefined),
        removeOpenAICompatibleEndpoint: vi.fn().mockResolvedValue(undefined),
        getDefault: vi.fn().mockResolvedValue(undefined),
        setDefault: vi.fn().mockResolvedValue(undefined),
        testConnection: vi.fn().mockResolvedValue({ ok: true, sample: 'hi' }),
      },
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          configured: opts.mcpConfigured ?? false,
          configPath: opts.configPath ?? null,
        }),
        autoConfigure: vi.fn().mockResolvedValue({ success: true }),
        getConfigSnippet: vi.fn().mockResolvedValue('{"mcpServers":{"gitplaces":{}}}'),
        testConnection: vi.fn().mockResolvedValue({ running: false, skillCount: 0 }),
      },
      opencode: {
        detect: vi.fn().mockResolvedValue(false),
        checkAuthStatus: vi.fn().mockResolvedValue(false),
        setup: vi.fn().mockResolvedValue({ ok: true }),
        loginOpenCode: vi.fn().mockResolvedValue({ ok: true }),
        logoutOpenCode: vi.fn().mockResolvedValue(undefined),
        onSetupProgress: vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress: vi.fn(),
        offLoginProgress: vi.fn(),
      },
      gemini: {
        detect: vi.fn().mockResolvedValue(false),
        checkAuthStatus: vi.fn().mockResolvedValue(false),
        setup: vi.fn().mockResolvedValue({ ok: true }),
        loginGemini: vi.fn().mockResolvedValue({ ok: true }),
        logoutGemini: vi.fn().mockResolvedValue(undefined),
        onSetupProgress: vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress: vi.fn(),
        offLoginProgress: vi.fn(),
      },
      codex: {
        detect: vi.fn().mockResolvedValue(false),
        checkAuthStatus: vi.fn().mockResolvedValue(false),
        setup: vi.fn().mockResolvedValue({ ok: true }),
        loginCodex: vi.fn().mockResolvedValue({ ok: true }),
        logoutCodex: vi.fn().mockResolvedValue(undefined),
        onSetupProgress: vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress: vi.fn(),
        offLoginProgress: vi.fn(),
      },
      github: {
        disconnect: vi.fn().mockResolvedValue(undefined),
        openLoginPopup: vi.fn().mockResolvedValue(undefined),
      },
      skillSync: {
        getStatus: vi.fn().mockResolvedValue({ enabled: false, repoOwner: undefined, failedCount: 0, lastSynced: null }),
        onSyncFailed: vi.fn(),
        offSyncFailed: vi.fn(),
        setup: vi.fn(),
        disconnect: vi.fn(),
        retryFailed: vi.fn(),
      },
      connectors: {
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      download: {
        getDefaultFolder: vi.fn().mockResolvedValue('/default'),
        pickFolder: vi.fn().mockResolvedValue(null),
      },
      tts: {
        getVoices: vi.fn().mockResolvedValue([]),
        synthesize: vi.fn().mockResolvedValue({ audio: new ArrayBuffer(0), wordBoundaries: [] }),
        checkAvailable: vi.fn().mockResolvedValue(true),
      },
      updates: {
        lastChecked: vi.fn().mockResolvedValue({ timestamp: null }),
        checkNow: vi.fn().mockResolvedValue(undefined),
        restartService: vi.fn().mockResolvedValue(undefined),
      },
      openExternal: vi.fn().mockResolvedValue(undefined),
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

// Stub GitHubAuth + useGitHubLogin contexts — Settings imports them transitively via ConnectorsPanel.
vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useGitHubLogin', () => ({
  useGitHubLogin: () => ({
    status: 'idle',
    userCode: null,
    verificationUri: null,
    verificationUriComplete: null,
    error: null,
    start: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}))
vi.mock('../contexts/Appearance', () => ({
  useAppearance: () => ({ background: 'none', setBackground: vi.fn(), invertDarkImages: false, setInvertDarkImages: vi.fn() }),
}))

describe('Settings — sidebar IA', () => {
  beforeEach(() => { setupApi() })

  it('renders the AI sidebar entry', async () => {
    render(<Settings />)
    expect(screen.getByRole('button', { name: /^AI$/i })).toBeInTheDocument()
  })

  it('does NOT render the old "Providers" sidebar entry', () => {
    render(<Settings />)
    expect(screen.queryByRole('button', { name: /^Providers$/i })).not.toBeInTheDocument()
  })

  it('does NOT render the old "Claude Code & OpenCode" sidebar entry', () => {
    render(<Settings />)
    expect(screen.queryByRole('button', { name: /Claude Code & OpenCode/i })).not.toBeInTheDocument()
  })

  it('renders AI by default (no need to click)', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/API \/ HTTPS/i)).toBeInTheDocument()
    })
  })
})

describe('Settings — AI panel', () => {
  beforeEach(() => { setupApi() })

  it('renders three AI tabs (no Defaults tab)', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /API \/ HTTPS/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /^CLI$/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /^MCP$/ })).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: /^Defaults$/ })).not.toBeInTheDocument()
    })
  })

  it('renders the Anthropic provider card in the default API tab', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/^Anthropic$/)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/sk-ant-/)).toBeInTheDocument()
    })
  })

  it("renders Anthropic's Claude Code card after switching to the CLI tab", async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^CLI$/ }))
    expect(screen.queryByText(/Anthropic's Claude Code/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /^CLI$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Anthropic's Claude Code/)).toBeInTheDocument()
    })
  })

  it('MCP tab content is hidden until the MCP tab is selected', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^MCP$/ }))
    expect(screen.queryByText(/Claude Code MCP/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Claude Code MCP/i)).toBeInTheDocument()
    })
  })

  it('MCP tab includes the Custom MCP subsection', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^MCP$/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Custom MCP/i)).toBeInTheDocument()
      expect(screen.getByText(/\+ Add custom connector/i)).toBeInTheDocument()
    })
  })

  it('renders the AI section intro above the tabs', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Gitplaces' built-in AI features/i)).toBeInTheDocument()
    })
  })

  it('MCP tab shows all four MCP cards (Claude / OpenCode / Gemini / Codex), each with a Manual configuration toggle', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^MCP$/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Claude Code MCP/i)).toBeInTheDocument()
      expect(screen.getByText(/OpenCode MCP/i)).toBeInTheDocument()
      expect(screen.getByText(/Gemini CLI MCP/i)).toBeInTheDocument()
      expect(screen.getByText(/Codex CLI MCP/i)).toBeInTheDocument()
      // One Manual-configuration icon-toggle per card.
      expect(screen.getAllByRole('button', { name: /^Manual configuration$/i })).toHaveLength(4)
    })
  })

  it('CLI tab includes Gemini CLI and Codex CLI cards alongside Claude Code and OpenCode', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^CLI$/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^CLI$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Anthropic's Claude Code/)).toBeInTheDocument()
      expect(screen.getByText(/^OpenCode$/)).toBeInTheDocument()
      expect(screen.getByText(/^Gemini CLI$/)).toBeInTheDocument()
      expect(screen.getByText(/^Codex CLI$/)).toBeInTheDocument()
    })
  })

  it('Auto-configure on each MCP card dispatches with the correct target', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('tab', { name: /^MCP$/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    await waitFor(() => screen.getByText(/Codex CLI MCP/i))

    // Cards render in MCP_TARGETS order: claude, opencode, gemini, codex.
    const autoButtons = screen.getAllByRole('button', { name: /Auto-configure/i })
    expect(autoButtons).toHaveLength(4)

    fireEvent.click(autoButtons[1]) // OpenCode
    await waitFor(() => {
      expect(window.api.mcp.autoConfigure).toHaveBeenCalledWith('opencode')
    })

    fireEvent.click(autoButtons[2]) // Gemini
    await waitFor(() => {
      expect(window.api.mcp.autoConfigure).toHaveBeenCalledWith('gemini')
    })

    fireEvent.click(autoButtons[3]) // Codex
    await waitFor(() => {
      expect(window.api.mcp.autoConfigure).toHaveBeenCalledWith('codex')
    })
  })

  it('clicking Test on Anthropic card calls llm.testConnection', async () => {
    setupApi({ anthropicKey: 'sk-ant-test' })
    render(<Settings />)
    await waitFor(() => screen.getByText(/^Anthropic$/))
    const testButtons = screen.getAllByRole('button', { name: /^Test$/i })
    fireEvent.click(testButtons[0])
    await waitFor(() => {
      expect(window.api.llm.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic' })
      )
    })
  })
})

describe('Settings — Connectors panel', () => {
  beforeEach(() => { setupApi() })

  it('shows the AI tab by default, so Connectors panel only appears after click', async () => {
    render(<Settings />)
    expect(screen.queryByText(/Connect external services Gitplaces can read from/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Connectors$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Connect external services Gitplaces can read from/i)).toBeInTheDocument()
    })
  })

  it('renders GitHub and Skills Backup; does NOT render Claude subscription or Custom MCP rows', async () => {
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: /^Connectors$/ }))
    await waitFor(() => {
      expect(screen.getByText(/^GitHub$/)).toBeInTheDocument()
      expect(screen.getByText(/Skills Backup/i)).toBeInTheDocument()
    })
    // The Claude subscription row used to live here — it shouldn't anymore.
    expect(screen.queryByText(/skills use your subscription/i)).not.toBeInTheDocument()
    // The custom-connector add button also moved out.
    expect(screen.queryByText(/\+ Add custom connector/i)).not.toBeInTheDocument()
  })
})
