import { useState, useEffect, useCallback, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import SectionBlock from './shared/SectionBlock'
import ProviderCard from './shared/ProviderCard'
import IconAnthropic from '~icons/simple-icons/anthropic'
import IconClaude from '~icons/simple-icons/claude'
import IconOpenAI from '~icons/simple-icons/openai'
import IconGemini from '~icons/simple-icons/googlegemini'
import IconOllama from '~icons/simple-icons/ollama'

type SetupPhase = 'idle' | 'checking' | 'installing' | 'auth' | 'done' | 'error'
type LoginPhase = 'idle' | 'logging-in' | 'done' | 'error'

const OpenCodeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)' }} aria-hidden="true">
    <polyline points="8 6 2 12 8 18" />
    <polyline points="16 6 22 12 16 18" />
  </svg>
)

type ProviderConfig = { enabled: boolean; apiKey?: string; organization?: string }
type OpenAICompatibleEndpoint = { id: string; label: string; baseUrl: string; apiKey?: string }

const KNOWN_MODELS_BY_PROVIDER: Record<'anthropic' | 'openai' | 'google', { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (1M context)' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o',       label: 'GPT-4o' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o mini' },
    { id: 'gpt-4.1',      label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { id: 'o3-mini',      label: 'o3-mini' },
  ],
  google: [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
}

const PROVIDER_INFO_TOOLTIP: Record<string, string> = {
  anthropic: 'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.anthropic.map(m => m.label).join('\n• '),
  openai:    'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.openai.map(m => m.label).join('\n• '),
  google:    'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.google.map(m => m.label).join('\n• '),
  'openai-compatible': 'Run any OpenAI-compatible API:\n• Ollama\n• LM Studio\n• llama.cpp\n• Custom self-hosted endpoints',
}

const InfoIcon = ({ title }: { title: string }) => (
  <span
    title={title}
    style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, opacity: 0.55, cursor: 'help', flexShrink: 0 }}
  >
    <svg
      width={12} height={12} viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="5" />
      <path d="M6 5.4v3" />
      <circle cx="6" cy="3.6" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  </span>
)

function OpenAICompatibleSection(props: {
  endpoints: OpenAICompatibleEndpoint[]
  setEndpoints: Dispatch<SetStateAction<OpenAICompatibleEndpoint[]>>
  testProvider: (provider: string, modelHint: string) => Promise<void>
  renderStatus: (provider: string) => ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const [newId,    setNewId]    = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newUrl,   setNewUrl]   = useState('')
  const [newKey,   setNewKey]   = useState('')

  const submitAdd = async () => {
    if (!newId.trim() || !newLabel.trim() || !newUrl.trim()) return
    const ep = { id: newId.trim(), label: newLabel.trim(), baseUrl: newUrl.trim(), apiKey: newKey.trim() || undefined }
    await window.api.llm.upsertOpenAICompatibleEndpoint(ep)
    const fresh = await window.api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
    setAdding(false)
    setNewId(''); setNewLabel(''); setNewUrl(''); setNewKey('')
  }

  const removeEp = async (id: string) => {
    await window.api.llm.removeOpenAICompatibleEndpoint(id)
    const fresh = await window.api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
  }

  return (
    <ProviderCard
      icon={<IconOllama width={20} height={20} style={{ color: 'var(--text)' }} />}
      name="Local / OpenAI-compatible"
      chip="API"
      description="Ollama, LM Studio, llama.cpp, or any OpenAI-compatible endpoint."
      nameAccessory={<InfoIcon title={PROVIDER_INFO_TOOLTIP['openai-compatible']} />}
      actions={<button className="settings-btn" onClick={() => setAdding(true)}>Add endpoint</button>}
    >
      {props.endpoints.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {props.endpoints.map(ep => (
            <div key={ep.id} className="connector-row" style={{ marginTop: 6 }}>
              <div className="connector-info" style={{ flex: 1 }}>
                <div className="connector-name">{ep.label}</div>
                <div className="connector-desc">{ep.baseUrl} <span style={{ opacity: 0.6 }}>(id: {ep.id})</span></div>
              </div>
              <div className="connector-actions">
                <button className="settings-btn" onClick={() => props.testProvider(`openai-compatible:${ep.id}`, 'gpt-3.5-turbo')}>Test</button>
                {props.renderStatus(`openai-compatible:${ep.id}`)}
                <button className="settings-btn settings-btn--link" onClick={() => removeEp(ep.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="connector-add-modal" style={{ marginTop: 10 }}>
          <div className="connector-modal-header"><strong>Add openai-compatible endpoint</strong></div>
          <div className="connector-modal-fields" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="settings-input" placeholder="id (slug, e.g. ollama-local)" value={newId}    onChange={e => setNewId(e.target.value)} />
            <input className="settings-input" placeholder="Display label"                value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            <input className="settings-input" placeholder="Base URL (e.g. http://localhost:11434/v1)" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
            <input className="settings-input" type="password" placeholder="API key (optional, leave blank for local)" value={newKey} onChange={e => setNewKey(e.target.value)} />
          </div>
          <div className="connector-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="settings-btn settings-btn--ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="settings-btn" onClick={submitAdd}>Add</button>
          </div>
        </div>
      )}
    </ProviderCard>
  )
}

export default function AIPanel() {
  // Providers state
  const [anthropicCfg, setAnthropicCfg] = useState<ProviderConfig>({ enabled: false })
  const [openaiCfg,    setOpenaiCfg]    = useState<ProviderConfig>({ enabled: false })
  const [googleCfg,    setGoogleCfg]    = useState<ProviderConfig>({ enabled: false })
  const [endpoints,    setEndpoints]    = useState<OpenAICompatibleEndpoint[]>([])
  const [testStatus,   setTestStatus]   = useState<Record<string, { ok: boolean; message?: string } | 'testing'>>({})

  // Claude Code state
  const [claudeCodeInstalled, setClaudeCodeInstalled] = useState<boolean | null>(null)
  const [claudeCodeLoggedIn, setClaudeCodeLoggedIn]   = useState<boolean | null>(null)
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle')
  const [setupLines, setSetupLines] = useState<string[]>([])
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const [loginLines, setLoginLines] = useState<string[]>([])
  const [claudeLoggingOut, setClaudeLoggingOut] = useState(false)
  const [claudeDisconnectError, setClaudeDisconnectError] = useState<string | null>(null)

  // OpenCode state
  const [opencodeInstalled, setOpencodeInstalled] = useState<boolean | null>(null)
  const [opencodeLoggedIn, setOpencodeLoggedIn]   = useState<boolean | null>(null)
  const [opencodeSetupPhase, setOpencodeSetupPhase] = useState<SetupPhase>('idle')
  const [opencodeSetupLines, setOpencodeSetupLines] = useState<string[]>([])
  const [opencodeLoginPhase, setOpencodeLoginPhase] = useState<LoginPhase>('idle')
  const [opencodeLoginLines, setOpencodeLoginLines] = useState<string[]>([])

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    window.api.skill.detectClaudeCode().then(installed => {
      setClaudeCodeInstalled(installed)
      if (installed) window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      else setClaudeCodeLoggedIn(false)
    })
    window.api.opencode.detect().then(setOpencodeInstalled).catch(() => setOpencodeInstalled(false))
    window.api.opencode.checkAuthStatus().then(setOpencodeLoggedIn).catch(() => setOpencodeLoggedIn(false))
  }, [])

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
      setLoginLines((prev) => [...prev, message])
      if (isError) { hadError = true; setLoginPhase('error') }
      if (done) {
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

  const handleClaudeDisconnect = async () => {
    setClaudeLoggingOut(true)
    setClaudeDisconnectError(null)
    try {
      await window.api.skill.logoutClaude()
      setClaudeCodeLoggedIn(false)
    } catch {
      setClaudeDisconnectError('Logout failed — please try again.')
    } finally {
      setClaudeLoggingOut(false)
    }
  }

  const handleOpencodeSetup = async () => {
    setOpencodeSetupPhase('installing')
    setOpencodeSetupLines([])
    const cb = (payload: { phase: string; line?: string }) => {
      if (payload.line) setOpencodeSetupLines(prev => [...prev, payload.line!])
      if (payload.phase === 'done') setOpencodeSetupPhase('done')
      if (payload.phase === 'error') setOpencodeSetupPhase('error')
    }
    window.api.opencode.onSetupProgress(cb)
    try {
      const result = await window.api.opencode.setup()
      if (result.ok) {
        setOpencodeInstalled(true)
        setOpencodeSetupPhase('done')
      } else {
        setOpencodeSetupPhase('error')
      }
    } finally {
      window.api.opencode.offSetupProgress(cb)
    }
  }

  const handleOpencodeLogin = async () => {
    setOpencodeLoginPhase('logging-in')
    setOpencodeLoginLines([])
    const cb = (payload: { message: string; isError?: boolean; done?: boolean }) => {
      setOpencodeLoginLines(prev => [...prev, payload.message])
      if (payload.done) setOpencodeLoginPhase(payload.isError ? 'error' : 'done')
    }
    window.api.opencode.onLoginProgress(cb)
    try {
      const result = await window.api.opencode.loginOpenCode()
      if (result.ok) {
        setOpencodeLoggedIn(true)
        setOpencodeLoginPhase('done')
      } else if (opencodeLoginPhase !== 'error') {
        setOpencodeLoginPhase('error')
      }
    } finally {
      window.api.opencode.offLoginProgress(cb)
    }
  }

  const handleOpencodeLogout = async () => {
    await window.api.opencode.logoutOpenCode()
    setOpencodeLoggedIn(false)
  }

  // MCP exposure state
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null)
  const [mcpStatusLoaded, setMcpStatusLoaded] = useState(false)
  const [configSnippet, setConfigSnippet]   = useState('')
  const [copied, setCopied]                 = useState(false)
  const [autoConfigStatus, setAutoConfigStatus] = useState<string | null>(null)
  const [autoConfigIsError, setAutoConfigIsError] = useState(false)
  const [testResult, setTestResult]         = useState<string | null>(null)

  const loadMcpStatus = useCallback(async () => {
    const [status, snippet] = await Promise.all([
      window.api.mcp.getStatus(),
      window.api.mcp.getConfigSnippet(),
    ])
    setMcpConfigured(status.configured)
    setMcpConfigPath(status.configPath)
    setConfigSnippet(snippet)
    setMcpStatusLoaded(true)
  }, [])

  useEffect(() => { loadMcpStatus() }, [loadMcpStatus])

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

  // Custom MCP state
  type CustomConnector = { id: string; name: string; url: string; oauthClientId: string; oauthClientSecret: string }
  const [connectorStatus, setConnectorStatus] = useState<Record<string, 'checking' | 'ok' | 'error'>>({})
  const [customConnectors, setCustomConnectors] = useState<CustomConnector[]>([])
  const [showAddConnector, setShowAddConnector] = useState(false)
  const [newConnectorName, setNewConnectorName] = useState('')
  const [newConnectorUrl, setNewConnectorUrl] = useState('')
  const [newConnectorAdvanced, setNewConnectorAdvanced] = useState(false)
  const [newConnectorOAuthId, setNewConnectorOAuthId] = useState('')
  const [newConnectorOAuthSecret, setNewConnectorOAuthSecret] = useState('')

  useEffect(() => {
    window.api.settings.get('customConnectors').then((raw: string | null) => {
      try { if (raw) setCustomConnectors(JSON.parse(raw)) } catch { /* ignore */ }
    })
  }, [])

  const saveCustomConnectors = async (list: CustomConnector[]) => {
    setCustomConnectors(list)
    await window.api.settings.set('customConnectors', JSON.stringify(list))
  }

  const testConnector = async (id: string, url: string) => {
    if (!url) return
    try { new URL(url) } catch { return }
    if (!url.startsWith('http://') && !url.startsWith('https://')) return
    setConnectorStatus(prev => ({ ...prev, [id]: 'checking' }))
    try {
      const result = await window.api.connectors.test(url)
      setConnectorStatus(prev => ({ ...prev, [id]: result.ok ? 'ok' : 'error' }))
    } catch {
      setConnectorStatus(prev => ({ ...prev, [id]: 'error' }))
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const api = window.api.llm
      const [a, o, g, eps] = await Promise.all([
        api.getProviderConfig('anthropic'),
        api.getProviderConfig('openai'),
        api.getProviderConfig('google'),
        api.listOpenAICompatibleEndpoints(),
      ])
      if (cancelled) return
      setAnthropicCfg(a)
      setOpenaiCfg(o)
      setGoogleCfg(g)
      setEndpoints(eps)
    })().catch(err => console.error('[AIPanel] failed to load provider configs:', err))
    return () => { cancelled = true }
  }, [])

  const saveProvider = async (provider: 'anthropic' | 'openai' | 'google', cfg: ProviderConfig) => {
    await window.api.llm.setProviderConfig(provider, cfg)
  }

  const testProvider = async (provider: string, modelHint: string) => {
    setTestStatus(s => ({ ...s, [provider]: 'testing' }))
    const result = await window.api.llm.testConnection({ provider, model: modelHint })
    setTestStatus(s => ({ ...s, [provider]: { ok: result.ok, message: result.ok ? `OK: ${result.sample ?? ''}` : `${result.kind}: ${result.message}` } }))
  }

  const renderStatus = (provider: string): ReactNode => {
    const s = testStatus[provider]
    if (s === 'testing') return <span className="connector-badge">Testing…</span>
    if (!s) return null
    if (s.ok) return <span className="connector-badge connected">{s.message}</span>
    return <span className="connector-badge" style={{ background: 'var(--accent-red-soft, #fee2e2)', color: 'var(--accent-red, #991b1b)' }}>{s.message}</span>
  }

  const apiCount = 4

  return (
    <>
      <SectionBlock title="API / HTTPS" count={apiCount} defaultExpanded>
        <div className="section-block-body-desc">Git Suite calls these models directly using your API key.</div>

        <ProviderCard
          icon={<IconAnthropic width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Anthropic"
          chip="API"
          description="Claude Opus, Sonnet, Haiku."
          nameAccessory={<InfoIcon title={PROVIDER_INFO_TOOLTIP.anthropic} />}
          actions={<>
            <button className="settings-btn" disabled={!anthropicCfg.apiKey} onClick={() => testProvider('anthropic', 'claude-haiku-4-5-20251001')}>Test</button>
            {renderStatus('anthropic')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="sk-ant-..."
            value={anthropicCfg.apiKey ?? ''}
            onChange={e => setAnthropicCfg({ ...anthropicCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('anthropic', anthropicCfg)}
            style={{ width: '100%' }}
          />
        </ProviderCard>

        <ProviderCard
          icon={<IconOpenAI width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="OpenAI"
          chip="API"
          description="GPT-4o, GPT-4.1, o3-mini."
          nameAccessory={<InfoIcon title={PROVIDER_INFO_TOOLTIP.openai} />}
          actions={<>
            <button className="settings-btn" disabled={!openaiCfg.apiKey} onClick={() => testProvider('openai', 'gpt-4o')}>Test</button>
            {renderStatus('openai')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="sk-..."
            value={openaiCfg.apiKey ?? ''}
            onChange={e => setOpenaiCfg({ ...openaiCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('openai', openaiCfg)}
            style={{ width: '100%' }}
          />
          <input
            className="settings-input"
            type="text"
            placeholder="Organization ID (optional)"
            value={openaiCfg.organization ?? ''}
            onChange={e => setOpenaiCfg({ ...openaiCfg, organization: e.target.value || undefined })}
            onBlur={() => saveProvider('openai', openaiCfg)}
            style={{ marginTop: 4, width: '100%' }}
          />
        </ProviderCard>

        <ProviderCard
          icon={<IconGemini width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Google Gemini"
          chip="API"
          description="Gemini 2.5 Pro, Flash; Gemini 1.5."
          nameAccessory={<InfoIcon title={PROVIDER_INFO_TOOLTIP.google} />}
          actions={<>
            <button className="settings-btn" disabled={!googleCfg.apiKey} onClick={() => testProvider('google', 'gemini-2.5-pro')}>Test</button>
            {renderStatus('google')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="g-..."
            value={googleCfg.apiKey ?? ''}
            onChange={e => setGoogleCfg({ ...googleCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('google', googleCfg)}
            style={{ width: '100%' }}
          />
        </ProviderCard>

        <OpenAICompatibleSection
          endpoints={endpoints}
          setEndpoints={setEndpoints}
          testProvider={testProvider}
          renderStatus={renderStatus}
        />
      </SectionBlock>

      <SectionBlock title="CLI" count={2} defaultExpanded>
        <div className="section-block-body-desc">
          Git Suite spawns the CLI tool and talks to it via stdio. Uses your subscription.
        </div>

        <ProviderCard
          icon={<IconClaude width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Anthropic's Claude Code"
          chip="CLI"
          description="Anthropic's CLI agent. Runs Claude via your Claude.ai subscription."
          status={
            claudeCodeInstalled === null
              ? { tone: 'gray', text: 'Checking…' }
              : claudeCodeLoggedIn === true
                ? { tone: 'green', text: 'Installed · Logged in' }
                : claudeCodeInstalled === false
                  ? { tone: 'gray', text: 'Not installed' }
                  : { tone: 'amber', text: 'Installed · Not logged in' }
          }
          actions={
            (setupPhase !== 'idle' && setupPhase !== 'done') || loginPhase === 'logging-in' ? (
              <span className="connector-status-text">
                {setupPhase !== 'idle' && setupPhase !== 'done' ? 'Installing…' : 'Connecting…'}
              </span>
            ) : claudeCodeLoggedIn === true ? (
              <button
                className="settings-btn settings-btn--link connector-disconnect-btn"
                disabled={claudeLoggingOut}
                onClick={handleClaudeDisconnect}
              >
                {claudeLoggingOut ? 'Logging out…' : 'Disconnect'}
              </button>
            ) : claudeCodeInstalled === false && setupPhase === 'idle' ? (
              <button className="settings-btn" onClick={handleSetup}>Install</button>
            ) : claudeCodeLoggedIn === false && loginPhase === 'idle' ? (
              <button className="settings-btn" onClick={handleLogin}>Connect</button>
            ) : (
              <span className="connector-status-text">Checking…</span>
            )
          }
        />

        {claudeDisconnectError && (
          <p className="settings-hint error" style={{ margin: '4px 0' }}>{claudeDisconnectError}</p>
        )}

        {setupPhase !== 'idle' && setupPhase !== 'done' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {setupLines.map((line, i) => (
              <div key={i} className={`settings-setup-line${setupPhase === 'error' && i === setupLines.length - 1 ? ' error' : ''}`}>{line}</div>
            ))}
            {setupPhase !== 'error' && <div className="settings-setup-line muted">…</div>}
          </div>
        )}
        {setupPhase === 'done' && (
          <p className="settings-hint success">Claude installed and authenticated.</p>
        )}
        {loginPhase === 'logging-in' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {loginLines.map((line, i) => {
              const urlMatch = line.match(/(https:\/\/\S+)/)
              return (
                <div key={i} className="settings-setup-line">
                  {urlMatch ? (
                    <>
                      <span>{line.slice(0, urlMatch.index)}</span>
                      <a href="#" style={{ color: 'var(--accent)', wordBreak: 'break-all' }} onClick={e => { e.preventDefault(); window.api.openExternal(urlMatch[1]) }}>{urlMatch[1]}</a>
                      <span>{line.slice((urlMatch.index ?? 0) + urlMatch[1].length)}</span>
                    </>
                  ) : line}
                </div>
              )
            })}
            <div className="settings-setup-line muted">Waiting for browser login…</div>
          </div>
        )}
        {loginPhase === 'error' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {loginLines.map((line, i) => <div key={i} className={`settings-setup-line${i === loginLines.length - 1 ? ' error' : ''}`}>{line}</div>)}
            <div className="settings-inline-row" style={{ marginTop: 8 }}>
              <button className="settings-btn" onClick={() => { setLoginPhase('idle'); setLoginLines([]) }}>Try again</button>
            </div>
          </div>
        )}
        {loginPhase === 'done' && (
          <p className="settings-hint success">Logged in — skill generation now uses your Claude subscription.</p>
        )}

        <ProviderCard
          icon={<OpenCodeIcon />}
          name="OpenCode"
          chip="CLI"
          description="CLI fork supporting Claude, GPT, Gemini, and local models via one OAuth login."
          status={
            opencodeInstalled === null || opencodeLoggedIn === null
              ? { tone: 'gray', text: 'Checking…' }
              : opencodeInstalled && opencodeLoggedIn
                ? { tone: 'green', text: 'Installed · Logged in' }
                : opencodeInstalled
                  ? { tone: 'amber', text: 'Installed · Not logged in' }
                  : { tone: 'gray', text: 'Not installed' }
          }
          actions={
            opencodeInstalled === false ? (
              <button
                className="settings-btn"
                disabled={opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking'}
                onClick={handleOpencodeSetup}
              >
                {opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking' ? 'Installing…' : 'Install'}
              </button>
            ) : opencodeInstalled && opencodeLoggedIn === false ? (
              <button
                className="settings-btn"
                disabled={opencodeLoginPhase === 'logging-in'}
                onClick={handleOpencodeLogin}
              >
                {opencodeLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login'}
              </button>
            ) : opencodeInstalled && opencodeLoggedIn ? (
              <button className="settings-btn settings-btn--link" onClick={handleOpencodeLogout}>
                Logout
              </button>
            ) : null
          }
        />

        {(opencodeSetupLines.length > 0 || opencodeLoginLines.length > 0) && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {[...opencodeSetupLines, ...opencodeLoginLines].map((line, i) => (
              <div key={i} className="settings-setup-line">{line}</div>
            ))}
          </div>
        )}
      </SectionBlock>

      {mcpStatusLoaded && (
        <SectionBlock
          title="MCP"
          count={1}
          defaultExpanded={!mcpConfigured}
        >
          <div className="section-block-body-desc">
            Expose Git Suite's tools to Claude Code CLI via the Model Context Protocol.
          </div>

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
        </SectionBlock>
      )}

      <SectionBlock title="Custom MCP" count={customConnectors.length} badge="BETA" defaultExpanded={false}>
        <div className="section-block-body-desc">
          Third-party MCP servers Git Suite can call as tool sources.
        </div>

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
                disabled={connectorStatus[c.id] === 'checking'}
                onClick={() => handleRemoveConnector(c.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {showAddConnector ? (
          <div className="connector-add-modal" style={{ marginTop: 10 }}>
            <div className="connector-modal-header">
              <span className="connector-modal-title">Add custom connector</span>
              <span className="connector-modal-beta">BETA</span>
            </div>
            <p className="connector-modal-desc">
              Connect Git Suite to your data and tools via a remote MCP server.
            </p>
            <div className="connector-modal-fields">
              <input className="settings-input connector-modal-input" type="text" placeholder="Name" value={newConnectorName} onChange={e => setNewConnectorName(e.target.value)} autoFocus />
              <input className="settings-input connector-modal-input" type="url" placeholder="Remote MCP server URL" value={newConnectorUrl} onChange={e => setNewConnectorUrl(e.target.value)} />
            </div>
            <button className="connector-advanced-toggle" onClick={() => setNewConnectorAdvanced(v => !v)} type="button">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: newConnectorAdvanced ? 'rotate(180deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }}>
                <path d="M2 4l4 4 4-4"/>
              </svg>
              Advanced settings
            </button>
            {newConnectorAdvanced && (
              <div className="connector-modal-fields">
                <input className="settings-input connector-modal-input" type="text" placeholder="OAuth Client ID (optional)" value={newConnectorOAuthId} onChange={e => setNewConnectorOAuthId(e.target.value)} />
                <input className="settings-input connector-modal-input" type="password" placeholder="OAuth Client Secret (optional)" value={newConnectorOAuthSecret} onChange={e => setNewConnectorOAuthSecret(e.target.value)} />
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
      </SectionBlock>

      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
    </>
  )
}
