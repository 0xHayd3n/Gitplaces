import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useAppearance, type BackgroundMode } from '../contexts/Appearance'

type SetupPhase = 'idle' | 'checking' | 'installing' | 'auth' | 'done' | 'error'
type LoginPhase = 'idle' | 'logging-in' | 'done' | 'error'
type CategoryId = 'claude-desktop' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors'

type CustomConnector = { id: string; name: string; url: string; oauthClientId: string; oauthClientSecret: string }

const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
  { value: 'none', label: 'Default' },
  { value: 'dither', label: 'Dithered' },
]

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const DesktopIcon = () => (
  <svg {...iconProps}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M6 14.5h4 M8 11.5v3" />
  </svg>
)

const PaletteIcon = () => (
  <svg {...iconProps}>
    <path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8s2.9 6.5 6.5 6.5c.8 0 1.3-.6 1.3-1.3 0-.3-.1-.6-.3-.9-.2-.3-.3-.5-.3-.8 0-.7.6-1.3 1.3-1.3h1.5c2.2 0 4-1.8 4-4 0-3.1-2.9-6.2-6.5-6.2Z" />
    <circle cx="4.5" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="10" cy="4.4" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
  </svg>
)

const GlobeIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.6" ry="6.5" />
    <path d="M1.5 8h13" />
  </svg>
)

const DownloadIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2v8.5 M4.5 7l3.5 3.5L11.5 7 M2.5 13.5h11" />
  </svg>
)

const ProjectsIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 5.5h11 M2.5 8h11 M2.5 10.5h7" />
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
  </svg>
)

const ConnectorsIcon = () => (
  <svg {...iconProps}>
    <circle cx="3.5" cy="8" r="2" />
    <circle cx="12.5" cy="8" r="2" />
    <path d="M5.5 8h3.5 M7 6l2 2-2 2" />
  </svg>
)

const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'claude-desktop', label: 'Claude Desktop', icon: <DesktopIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'language', label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads', label: 'Downloads', icon: <DownloadIcon /> },
  { id: 'projects', label: 'Projects', icon: <ProjectsIcon /> },
  { id: 'connectors', label: 'Connectors', icon: <ConnectorsIcon /> },
]

export default function Settings() {
  const { background, setBackground } = useAppearance()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('connectors')
  const [claudeCodeInstalled, setClaudeCodeInstalled] = useState<boolean | null>(null)
  const [claudeCodeLoggedIn, setClaudeCodeLoggedIn] = useState<boolean | null>(null)
  const [preferredLanguage, setPreferredLanguage] = useState('en')
  const [downloadFolder, setDownloadFolder] = useState<string>('')
  const [defaultDownloadFolder, setDefaultDownloadFolder] = useState<string>('')
  const [projectsFolder, setProjectsFolder] = useState<string>('')

  // TTS voice state
  const [ttsVoices, setTtsVoices] = useState<{ shortName: string; label: string }[]>([])
  const [ttsVoice, setTtsVoice] = useState<string>('')
  const [ttsPreviewPlaying, setTtsPreviewPlaying] = useState(false)

  // Setup flow state
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle')
  const [setupLines, setSetupLines] = useState<string[]>([])

  // Login flow state
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const [loginLines, setLoginLines] = useState<string[]>([])
  const [loginNeedsCode, setLoginNeedsCode] = useState(false)
  const [loginCode, setLoginCode] = useState('')
  const [loginCodeSubmitted, setLoginCodeSubmitted] = useState(false)

  // Connectors state
  const [githubUsername, setGithubUsername] = useState<string | null>(null)
  const [githubConnecting, setGithubConnecting] = useState(false)
  const [githubUserCode, setGithubUserCode] = useState<string | null>(null)
  const [githubVerificationUri, setGithubVerificationUri] = useState<string | null>(null)
  const [githubDisconnecting, setGithubDisconnecting] = useState(false)
  const [claudeLoggingOut, setClaudeLoggingOut] = useState(false)
  const [connectorStatus, setConnectorStatus] = useState<Record<string, 'idle' | 'checking' | 'ok' | 'error'>>({})
  const [customConnectors, setCustomConnectors] = useState<CustomConnector[]>([])
  const [showAddConnector, setShowAddConnector] = useState(false)
  const [newConnectorName, setNewConnectorName] = useState('')
  const [newConnectorUrl, setNewConnectorUrl] = useState('')
  const [newConnectorAdvanced, setNewConnectorAdvanced] = useState(false)
  const [newConnectorOAuthId, setNewConnectorOAuthId] = useState('')
  const [newConnectorOAuthSecret, setNewConnectorOAuthSecret] = useState('')

  // Claude Desktop MCP state
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null)
  const [configSnippet, setConfigSnippet] = useState('')
  const [copied, setCopied] = useState(false)
  const [autoConfigStatus, setAutoConfigStatus] = useState<string | null>(null)
  const [autoConfigIsError, setAutoConfigIsError] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const loadMcpStatus = useCallback(async () => {
    const [status, snippet] = await Promise.all([
      window.api.mcp.getStatus(),
      window.api.mcp.getConfigSnippet(),
    ])
    setMcpConfigured(status.configured)
    setMcpConfigPath(status.configPath)
    setConfigSnippet(snippet)
  }, [])

  useEffect(() => {
    window.api.skill.detectClaudeCode().then(installed => {
      setClaudeCodeInstalled(installed)
      if (installed) window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      else setClaudeCodeLoggedIn(false)
    })
    loadMcpStatus()
    window.api.settings.getPreferredLanguage().then(setPreferredLanguage).catch(() => {})
    window.api.download.getDefaultFolder().then((val: string) => {
      setDefaultDownloadFolder(val)
    })
    window.api.settings.get('downloadFolder').then((val: string | null) => {
      setDownloadFolder(val ?? '')
    })
    window.api.settings.get('projectsFolder').then((val: string | null) => {
      setProjectsFolder(val ?? '')
    })
    window.api.tts.getVoices().then((voices: { shortName: string; label: string }[]) => {
      setTtsVoices(voices)
      if (voices.length > 0) {
        window.api.settings.get('tts_voice').then((saved: string | null) => {
          setTtsVoice(saved && voices.some(v => v.shortName === saved) ? saved : voices[0].shortName)
        })
      }
    }).catch(() => {})
    window.api.github.getUser().then(u => setGithubUsername(u.login)).catch(() => setGithubUsername(null))
    window.api.settings.get('customConnectors').then((raw: string | null) => {
      try { if (raw) setCustomConnectors(JSON.parse(raw)) } catch { /* ignore */ }
    })
  }, [loadMcpStatus])

  const handleChangeFolder = async () => {
    const result = await window.api.download.pickFolder()
    if (result) {
      await window.api.settings.set('downloadFolder', result)
      setDownloadFolder(result)
    }
  }

  const handleResetFolder = async () => {
    await window.api.settings.set('downloadFolder', '')
    setDownloadFolder('')
  }

  const handleChangeProjectsFolder = async () => {
    const result = await window.api.download.pickFolder()
    if (result) {
      await window.api.settings.set('projectsFolder', result)
      setProjectsFolder(result)
    }
  }

  const handleClearProjectsFolder = async () => {
    await window.api.settings.set('projectsFolder', '')
    setProjectsFolder('')
  }

  const savePreferredLanguage = async (lang: string) => {
    setPreferredLanguage(lang)
    await window.api.settings.setPreferredLanguage(lang)
  }

  const saveTtsVoice = async (voice: string) => {
    setTtsVoice(voice)
    await window.api.settings.set('tts_voice', voice)
  }

  const handleTtsPreview = async () => {
    if (ttsPreviewPlaying) return
    setTtsPreviewPlaying(true)
    try {
      const result = await window.api.tts.synthesize(
        'Hello, this is a preview of the selected voice.',
        ttsVoice,
      )
      const blob = new Blob([result.audio], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setTtsPreviewPlaying(false)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setTtsPreviewPlaying(false)
      }
      await audio.play()
    } catch {
      setTtsPreviewPlaying(false)
    }
  }

  const handleSetup = useCallback(async () => {
    setSetupPhase('checking')
    setSetupLines([])

    const onProgress = ({ phase, message }: { phase: string; message: string }) => {
      setSetupPhase(phase as SetupPhase)
      setSetupLines((prev) => [...prev, message])
    }

    window.api.skill.onSetupProgress(onProgress)
    try {
      await window.api.skill.setup()
      const installed = await window.api.skill.detectClaudeCode()
      setClaudeCodeInstalled(installed)
      if (installed) window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
    } finally {
      window.api.skill.offSetupProgress(onProgress)
    }
  }, [])

  const handleLogin = useCallback(async () => {
    setLoginPhase('logging-in')
    setLoginLines([])

    let hadError = false

    const onProgress = ({ message, isError, done }: { message: string; isError?: boolean; done?: boolean }) => {
      if (message === '__NEED_CODE__') { setLoginNeedsCode(true); return }
      setLoginLines((prev) => [...prev, message])
      if (isError) { hadError = true; setLoginPhase('error') }
      if (done)    {
        setLoginNeedsCode(false)
        setLoginCodeSubmitted(false)
        setLoginPhase('done')
        window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      }
    }

    window.api.skill.onLoginProgress(onProgress)
    try {
      await window.api.skill.loginClaude()
      if (!hadError) setLoginPhase('done')
    } catch {
      setLoginPhase('error')
    } finally {
      window.api.skill.offLoginProgress(onProgress)
    }
  }, [])

  const handleAutoConfigure = async () => {
    setAutoConfigStatus(null)
    const result = await window.api.mcp.autoConfigure()
    if (result.success) {
      setAutoConfigStatus('Configured!')
      setAutoConfigIsError(false)
      await loadMcpStatus()
    } else {
      setAutoConfigStatus(`Failed: ${result.error ?? 'unknown error'}`)
      setAutoConfigIsError(true)
    }
    timers.current.push(setTimeout(() => { setAutoConfigStatus(null); setAutoConfigIsError(false) }, 3000))
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configSnippet)
    setCopied(true)
    timers.current.push(setTimeout(() => setCopied(false), 2000))
  }

  const handleTestConnection = async () => {
    setTestResult(null)
    const result = await window.api.mcp.testConnection()
    if (result.running) {
      setTestResult(`Running — ${result.skillCount} active skill${result.skillCount !== 1 ? 's' : ''}`)
    } else {
      setTestResult('Not running')
    }
    timers.current.push(setTimeout(() => setTestResult(null), 4000))
  }

  const saveCustomConnectors = async (list: CustomConnector[]) => {
    setCustomConnectors(list)
    await window.api.settings.set('customConnectors', JSON.stringify(list))
  }

  const handleGitHubConnect = async () => {
    setGithubConnecting(true)
    setGithubUserCode(null)
    setGithubVerificationUri(null)
    try {
      const flow = await window.api.github.startDeviceFlow()
      setGithubUserCode(flow.userCode)
      setGithubVerificationUri(flow.verificationUri)
      await window.api.github.pollDeviceToken(flow.deviceCode, flow.interval)
      const user = await window.api.github.getUser()
      setGithubUsername(user.login)
    } catch {
      // cancelled or failed
    } finally {
      setGithubConnecting(false)
      setGithubUserCode(null)
      setGithubVerificationUri(null)
    }
  }

  const handleGitHubDisconnect = async () => {
    setGithubDisconnecting(true)
    try {
      await window.api.github.disconnect()
      setGithubUsername(null)
    } finally {
      setGithubDisconnecting(false)
    }
  }

  const handleClaudeDisconnect = async () => {
    setClaudeLoggingOut(true)
    try {
      await window.api.skill.logoutClaude()
      setClaudeCodeLoggedIn(false)
    } finally {
      setClaudeLoggingOut(false)
    }
  }

  const resetAddForm = () => {
    setNewConnectorName('')
    setNewConnectorUrl('')
    setNewConnectorAdvanced(false)
    setNewConnectorOAuthId('')
    setNewConnectorOAuthSecret('')
    setShowAddConnector(false)
  }

  const handleAddConnector = async () => {
    if (!newConnectorName.trim()) return
    const connector: CustomConnector = {
      id: Date.now().toString(),
      name: newConnectorName.trim(),
      url: newConnectorUrl.trim(),
      oauthClientId: newConnectorOAuthId.trim(),
      oauthClientSecret: newConnectorOAuthSecret.trim(),
    }
    await saveCustomConnectors([...customConnectors, connector])
    resetAddForm()
    testConnector(connector.id, connector.url)
  }

  const handleRemoveConnector = async (id: string) => {
    await saveCustomConnectors(customConnectors.filter(c => c.id !== id))
    setConnectorStatus(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const testConnector = async (id: string, url: string) => {
    if (!url) return
    setConnectorStatus(prev => ({ ...prev, [id]: 'checking' }))
    try {
      const result = await window.api.connectors.test(url)
      setConnectorStatus(prev => ({ ...prev, [id]: result.ok ? 'ok' : 'error' }))
    } catch {
      setConnectorStatus(prev => ({ ...prev, [id]: 'error' }))
    }
  }

  const renderConnectors = () => (
    <>
      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Allow Git Suite to reference other apps and services for more context.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">

          {/* GitHub */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--github">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">GitHub</div>
              <div className="connector-desc">
                {githubUsername ? `Connected as @${githubUsername}` : 'Connect your GitHub account'}
              </div>
            </div>
            <div className="connector-actions">
              {githubConnecting ? (
                githubUserCode ? (
                  <div className="connector-device-flow">
                    <span className="connector-code">{githubUserCode}</span>
                    <button className="settings-btn" onClick={() => window.api.openExternal(githubVerificationUri!)}>
                      Open browser
                    </button>
                    <button
                      className="settings-btn settings-btn--link"
                      onClick={() => { window.api.github.cancelDeviceFlow(); setGithubConnecting(false); setGithubUserCode(null) }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="connector-status-text">Connecting…</span>
                )
              ) : githubUsername ? (
                <>
                  <span className="connector-badge connected">Connected</span>
                  <button
                    className="settings-btn settings-btn--link connector-disconnect-btn"
                    disabled={githubDisconnecting}
                    onClick={handleGitHubDisconnect}
                  >
                    {githubDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button className="settings-btn" onClick={handleGitHubConnect}>Connect</button>
              )}
            </div>
          </div>

          {/* Claude */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--claude">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="currentColor">
                <path d="M32.5 7H15.5L7 24l8.5 17h17l8.5-17L32.5 7zm-4.2 22.8h-8.6l-4.3-5.8 4.3-5.8h8.6l4.3 5.8-4.3 5.8z"/>
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">Claude</div>
              <div className="connector-desc">
                {claudeCodeLoggedIn === true
                  ? 'Connected — skills use your subscription'
                  : claudeCodeInstalled === false
                    ? 'Claude Code not installed'
                    : 'Not connected'}
              </div>
            </div>
            <div className="connector-actions">
              {(setupPhase !== 'idle' && setupPhase !== 'done') || loginPhase === 'logging-in' ? (
                <span className="connector-status-text">
                  {setupPhase !== 'idle' && setupPhase !== 'done' ? 'Installing…' : 'Connecting…'}
                </span>
              ) : claudeCodeLoggedIn === true ? (
                <>
                  <span className="connector-badge connected">Connected</span>
                  <button
                    className="settings-btn settings-btn--link connector-disconnect-btn"
                    disabled={claudeLoggingOut}
                    onClick={handleClaudeDisconnect}
                  >
                    {claudeLoggingOut ? 'Logging out…' : 'Disconnect'}
                  </button>
                </>
              ) : claudeCodeInstalled === false && setupPhase === 'idle' ? (
                <button className="settings-btn" onClick={handleSetup}>Install</button>
              ) : claudeCodeLoggedIn === false && loginPhase === 'idle' ? (
                <button className="settings-btn" onClick={handleLogin}>Connect</button>
              ) : (
                <span className="connector-status-text">Checking…</span>
              )}
            </div>
          </div>

          {/* Setup / login progress — expands below the Claude row */}
          {setupPhase !== 'idle' && setupPhase !== 'done' && (
            <div className="connector-row connector-row--log">
              <div className="settings-setup-log" style={{ width: '100%' }}>
                {setupLines.map((line, i) => (
                  <div key={i} className={`settings-setup-line${setupPhase === 'error' && i === setupLines.length - 1 ? ' error' : ''}`}>{line}</div>
                ))}
                {setupPhase !== 'error' && <div className="settings-setup-line muted">…</div>}
              </div>
            </div>
          )}
          {setupPhase === 'done' && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint success">Claude installed and authenticated.</p>
            </div>
          )}
          {loginPhase === 'logging-in' && (
            <div className="connector-row connector-row--log">
              <div className="settings-setup-log" style={{ width: '100%' }}>
                {loginLines.map((line, i) => {
                  const urlMatch = line.match(/(https:\/\/\S+)/)
                  return (
                    <div key={i} className="settings-setup-line">
                      {urlMatch ? (
                        <><span>{line.slice(0, urlMatch.index)}</span>
                          <a href="#" style={{ color: 'var(--accent)', wordBreak: 'break-all' }} onClick={e => { e.preventDefault(); window.api.openExternal(urlMatch[1]) }}>{urlMatch[1]}</a>
                          <span>{line.slice((urlMatch.index ?? 0) + urlMatch[1].length)}</span></>
                      ) : line}
                    </div>
                  )
                })}
                {loginNeedsCode ? (
                  <div style={{ marginTop: 8 }}>
                    <p className="settings-hint" style={{ marginBottom: 6 }}>Paste the code shown in your browser:</p>
                    <div className="settings-inline-row">
                      <input
                        className="settings-input" type="text" value={loginCode} autoFocus
                        onChange={e => setLoginCode(e.target.value)}
                        placeholder="Paste authentication code…"
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && loginCode.trim()) {
                            const { ok } = await window.api.skill.loginSubmitCode(loginCode.trim())
                            setLoginCode(''); setLoginNeedsCode(false)
                            if (!ok) { setLoginLines(p => [...p, 'Session expired — please try again.']); setLoginPhase('error') }
                            else setLoginCodeSubmitted(true)
                          }
                        }}
                      />
                      <button className="settings-btn" disabled={!loginCode.trim()} onClick={async () => {
                        const { ok } = await window.api.skill.loginSubmitCode(loginCode.trim())
                        setLoginCode(''); setLoginNeedsCode(false)
                        if (!ok) { setLoginLines(p => [...p, 'Session expired — please try again.']); setLoginPhase('error') }
                        else setLoginCodeSubmitted(true)
                      }}>Submit</button>
                    </div>
                  </div>
                ) : <div className="settings-setup-line muted">{loginCodeSubmitted ? 'Verifying…' : 'Waiting for browser login…'}</div>}
              </div>
            </div>
          )}
          {loginPhase === 'error' && (
            <div className="connector-row connector-row--log">
              <div className="settings-setup-log" style={{ width: '100%' }}>
                {loginLines.map((line, i) => <div key={i} className={`settings-setup-line${i === loginLines.length - 1 ? ' error' : ''}`}>{line}</div>)}
                <div className="settings-inline-row" style={{ marginTop: 8 }}>
                  <button className="settings-btn" onClick={() => { setLoginPhase('idle'); setLoginLines([]); setLoginNeedsCode(false); setLoginCodeSubmitted(false) }}>Try again</button>
                </div>
              </div>
            </div>
          )}
          {loginPhase === 'done' && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint success">Logged in — skill generation now uses your Claude subscription.</p>
            </div>
          )}

          {/* Custom connectors */}
          {customConnectors.map(c => (
            <div key={c.id} className="connector-row">
              <div className="connector-icon connector-icon--custom">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
                </svg>
              </div>
              <div className="connector-info">
                <div className="connector-name">{c.name}</div>
                {c.url && <div className="connector-desc">{c.url}</div>}
              </div>
              <div className="connector-actions">
                {connectorStatus[c.id] === 'checking' ? (
                  <span className="connector-status-text">Checking…</span>
                ) : connectorStatus[c.id] === 'ok' ? (
                  <span className="connector-badge connected">Connected</span>
                ) : connectorStatus[c.id] === 'error' ? (
                  <span className="connector-badge error">Error</span>
                ) : null}
                <button
                  className="settings-btn settings-btn--link connector-disconnect-btn"
                  disabled={connectorStatus[c.id] === 'checking'}
                  onClick={() => testConnector(c.id, c.url)}
                >
                  Retest
                </button>
                <button
                  className="settings-btn settings-btn--link connector-disconnect-btn"
                  onClick={() => handleRemoveConnector(c.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add custom connector */}
      {showAddConnector ? (
        <div className="connector-add-modal">
          <div className="connector-modal-header">
            <span className="connector-modal-title">Add custom connector</span>
            <span className="connector-modal-beta">BETA</span>
          </div>
          <p className="connector-modal-desc">
            Connect Git Suite to your data and tools via a remote MCP server.
          </p>
          <div className="connector-modal-fields">
            <input
              className="settings-input connector-modal-input"
              type="text"
              placeholder="Name"
              value={newConnectorName}
              onChange={e => setNewConnectorName(e.target.value)}
              autoFocus
            />
            <input
              className="settings-input connector-modal-input"
              type="url"
              placeholder="Remote MCP server URL"
              value={newConnectorUrl}
              onChange={e => setNewConnectorUrl(e.target.value)}
            />
          </div>
          <button
            className="connector-advanced-toggle"
            onClick={() => setNewConnectorAdvanced(v => !v)}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: newConnectorAdvanced ? 'rotate(180deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }}>
              <path d="M2 4l4 4 4-4"/>
            </svg>
            Advanced settings
          </button>
          {newConnectorAdvanced && (
            <div className="connector-modal-fields">
              <input
                className="settings-input connector-modal-input"
                type="text"
                placeholder="OAuth Client ID (optional)"
                value={newConnectorOAuthId}
                onChange={e => setNewConnectorOAuthId(e.target.value)}
              />
              <input
                className="settings-input connector-modal-input"
                type="password"
                placeholder="OAuth Client Secret (optional)"
                value={newConnectorOAuthSecret}
                onChange={e => setNewConnectorOAuthSecret(e.target.value)}
              />
            </div>
          )}
          <p className="connector-modal-warning">
            Only use connectors from developers you trust. Git Suite cannot verify that connectors will work as intended or that they won&rsquo;t change.
          </p>
          <div className="connector-modal-actions">
            <button className="settings-btn settings-btn--ghost" onClick={resetAddForm}>Cancel</button>
            <button className="settings-btn" onClick={handleAddConnector} disabled={!newConnectorName.trim()}>Add</button>
          </div>
        </div>
      ) : (
        <button className="connector-add-btn" onClick={() => setShowAddConnector(true)}>
          + Add custom connector
        </button>
      )}
    </>
  )

  const renderClaudeDesktop = () => (
    <div className="settings-group">
      <div className="settings-group-title">Claude Desktop integration</div>
      <div className="settings-group-body">
        <div className="settings-group-row">
          <div className="settings-group-row-main">
            <div className="settings-group-row-label">Status</div>
            <div className="settings-group-row-sub">
              <span className={`status-dot ${mcpConfigured ? 'active' : 'inactive'}`} />
              {mcpConfigured ? 'Configured' : 'Not configured'}
            </div>
          </div>
          <button className="settings-btn" onClick={handleAutoConfigure}>
            Auto-configure
          </button>
        </div>

        {mcpConfigPath && (
          <div className="settings-group-row settings-group-row--full">
            <p className="settings-hint settings-mcp-path">
              Config file: {mcpConfigPath}
            </p>
          </div>
        )}

        {autoConfigStatus && (
          <div className="settings-group-row settings-group-row--full">
            <p className={`settings-hint${autoConfigIsError ? ' error' : ' success'}`}>{autoConfigStatus}</p>
          </div>
        )}

        <div className="settings-group-row settings-group-row--full">
          <div className="settings-group-row-label">Manual configuration</div>
          <p className="settings-hint" style={{ marginTop: 4 }}>
            Add this to <code>claude_desktop_config.json</code>:
          </p>
          <div className="settings-mcp-snippet-row">
            <pre className="settings-mcp-snippet">{configSnippet}</pre>
            <button className="settings-btn settings-mcp-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="settings-group-row">
          <div className="settings-group-row-main">
            <div className="settings-group-row-label">Test connection</div>
            <div className="settings-group-row-sub">
              {testResult ?? 'Verify the MCP server is reachable.'}
            </div>
          </div>
          <button className="settings-btn" onClick={handleTestConnection}>
            Test
          </button>
        </div>
      </div>
    </div>
  )

  const renderAppearance = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Theme</div>
        <div className="settings-group-body">
          <div className="settings-group-row settings-group-row--full">
            <div className="settings-group-row-label">Dark by design</div>
            <p className="settings-hint" style={{ marginTop: 4 }}>
              Git Suite is a dark-only app. The palette is tuned for long sessions
              reading code and READMEs; a light mode isn&rsquo;t planned.
            </p>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Background</div>
        <div className="settings-group-body">
          <div className="settings-group-row settings-group-row--full">
            <p className="settings-hint" style={{ marginBottom: 12 }}>
              Choose the wallpaper shown behind the app.
            </p>
            <div className="bg-picker" role="radiogroup" aria-label="Background style">
              {BACKGROUND_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={background === opt.value}
                  className={`bg-picker-option${background === opt.value ? ' selected' : ''}`}
                  onClick={() => setBackground(opt.value)}
                >
                  <div className={`bg-picker-preview bg-picker-preview--${opt.value}`} />
                  <div className="bg-picker-label">{opt.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )

  const renderLanguage = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Language</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Preferred language</div>
              <div className="settings-group-row-sub">
                Repo descriptions and READMEs in other languages will be automatically translated.
              </div>
            </div>
            <select
              className="settings-select"
              value={preferredLanguage}
              onChange={e => savePreferredLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="pt">Portuguese</option>
              <option value="it">Italian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese (Simplified)</option>
              <option value="ru">Russian</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="nl">Dutch</option>
              <option value="pl">Polish</option>
              <option value="tr">Turkish</option>
              <option value="vi">Vietnamese</option>
              <option value="id">Indonesian</option>
              <option value="sv">Swedish</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Text-to-Speech</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Voice</div>
              <div className="settings-group-row-sub">
                Requires internet connection. Falls back to browser voice when offline.
              </div>
            </div>
            <div className="settings-select-row">
              <select
                className="settings-select"
                value={ttsVoice}
                onChange={e => saveTtsVoice(e.target.value)}
              >
                {ttsVoices.map(v => (
                  <option key={v.shortName} value={v.shortName}>{v.label}</option>
                ))}
              </select>
              <button
                className="settings-btn"
                onClick={handleTtsPreview}
                disabled={ttsPreviewPlaying || !ttsVoice}
              >
                {ttsPreviewPlaying ? 'Playing…' : 'Preview'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )

  const renderDownloads = () => (
    <div className="settings-group">
      <div className="settings-group-title">Download location</div>
      <div className="settings-group-body">
        <div className="settings-group-row settings-group-row--full">
          <div className="settings-group-row-label">Folder</div>
          <div className="settings-group-row-sub" style={{ marginTop: 4 }}>
            Where downloaded repository ZIP files are saved.
          </div>
          <div className="settings-inline-row" style={{ marginTop: 10 }}>
            <span className="settings-path">
              {downloadFolder || defaultDownloadFolder || 'Loading…'}
            </span>
            <button className="settings-btn" onClick={handleChangeFolder}>Change</button>
            {downloadFolder && (
              <button className="settings-btn settings-btn--link" onClick={handleResetFolder}>
                Reset to default
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const renderProjects = () => (
    <div className="settings-group">
      <div className="settings-group-title">Projects folder</div>
      <div className="settings-group-body">
        <div className="settings-group-row settings-group-row--full">
          <div className="settings-group-row-label">Folder</div>
          <div className="settings-group-row-sub" style={{ marginTop: 4 }}>
            Local folders inside this directory are scanned and shown as projects in the Projects view. Git repos with a GitHub remote link directly to the repository.
          </div>
          <div className="settings-inline-row" style={{ marginTop: 10 }}>
            <span className="settings-path">
              {projectsFolder || 'No folder selected'}
            </span>
            <button className="settings-btn" onClick={handleChangeProjectsFolder}>
              {projectsFolder ? 'Change' : 'Choose folder'}
            </button>
            {projectsFolder && (
              <button className="settings-btn settings-btn--link" onClick={handleClearProjectsFolder}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const activeLabel = CATEGORIES.find(c => c.id === activeCategory)?.label ?? ''

  return (
    <div className="settings-view">
      <aside className="settings-sidebar">
        <h1 className="settings-title">Settings</h1>
        <nav className="settings-nav" aria-label="Settings categories">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              className={`settings-nav-item${activeCategory === cat.id ? ' active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              aria-current={activeCategory === cat.id ? 'page' : undefined}
            >
              <span className="settings-nav-icon">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-content">
        <div key={activeCategory} className="settings-pane">
          <h2 className="settings-pane-title">{activeLabel}</h2>
          {activeCategory === 'claude-desktop' && renderClaudeDesktop()}
          {activeCategory === 'appearance' && renderAppearance()}
          {activeCategory === 'language' && renderLanguage()}
          {activeCategory === 'downloads' && renderDownloads()}
          {activeCategory === 'projects' && renderProjects()}
          {activeCategory === 'connectors' && renderConnectors()}
        </div>
      </main>
    </div>
  )
}
