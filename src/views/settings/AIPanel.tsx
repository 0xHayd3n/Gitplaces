import { useState, useEffect, useCallback, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react'
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
type CustomConnector = { id: string; name: string; url: string; oauthClientId: string; oauthClientSecret: string }

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

type AITabId = 'api' | 'cli' | 'mcp'
type McpTarget = 'claude' | 'opencode' | 'gemini' | 'codex'

const MCP_TARGETS: McpTarget[] = ['claude', 'opencode', 'gemini', 'codex']
const emptyTargetMap = <T,>(value: T): Record<McpTarget, T> => ({
  claude:   value,
  opencode: value,
  gemini:   value,
  codex:    value,
})

export default function AIPanel() {
  const [activeAITab, setActiveAITab] = useState<AITabId>('api')

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

  // Gemini CLI state
  const [geminiInstalled, setGeminiInstalled] = useState<boolean | null>(null)
  const [geminiLoggedIn, setGeminiLoggedIn]   = useState<boolean | null>(null)
  const [geminiSetupPhase, setGeminiSetupPhase] = useState<SetupPhase>('idle')
  const [geminiSetupLines, setGeminiSetupLines] = useState<string[]>([])
  const [geminiLoginPhase, setGeminiLoginPhase] = useState<LoginPhase>('idle')
  const [geminiLoginLines, setGeminiLoginLines] = useState<string[]>([])

  // Codex CLI state
  const [codexInstalled, setCodexInstalled] = useState<boolean | null>(null)
  const [codexLoggedIn, setCodexLoggedIn]   = useState<boolean | null>(null)
  const [codexSetupPhase, setCodexSetupPhase] = useState<SetupPhase>('idle')
  const [codexSetupLines, setCodexSetupLines] = useState<string[]>([])
  const [codexLoginPhase, setCodexLoginPhase] = useState<LoginPhase>('idle')
  const [codexLoginLines, setCodexLoginLines] = useState<string[]>([])

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
    window.api.gemini.detect().then(setGeminiInstalled).catch(() => setGeminiInstalled(false))
    window.api.gemini.checkAuthStatus().then(setGeminiLoggedIn).catch(() => setGeminiLoggedIn(false))
    window.api.codex.detect().then(setCodexInstalled).catch(() => setCodexInstalled(false))
    window.api.codex.checkAuthStatus().then(setCodexLoggedIn).catch(() => setCodexLoggedIn(false))
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

  const handleGeminiSetup = async () => {
    setGeminiSetupPhase('installing')
    setGeminiSetupLines([])
    const cb = (payload: { phase: string; line?: string }) => {
      if (payload.line) setGeminiSetupLines(prev => [...prev, payload.line!])
      if (payload.phase === 'done') setGeminiSetupPhase('done')
      if (payload.phase === 'error') setGeminiSetupPhase('error')
    }
    window.api.gemini.onSetupProgress(cb)
    try {
      const result = await window.api.gemini.setup()
      if (result.ok) {
        setGeminiInstalled(true)
        setGeminiSetupPhase('done')
      } else {
        setGeminiSetupPhase('error')
      }
    } finally {
      window.api.gemini.offSetupProgress(cb)
    }
  }

  const handleGeminiLogin = async () => {
    setGeminiLoginPhase('logging-in')
    setGeminiLoginLines([])
    const cb = (payload: { message: string; isError?: boolean; done?: boolean }) => {
      setGeminiLoginLines(prev => [...prev, payload.message])
      if (payload.done) setGeminiLoginPhase(payload.isError ? 'error' : 'done')
    }
    window.api.gemini.onLoginProgress(cb)
    try {
      const result = await window.api.gemini.loginGemini()
      if (result.ok) {
        setGeminiLoggedIn(true)
        setGeminiLoginPhase('done')
      } else if (geminiLoginPhase !== 'error') {
        setGeminiLoginPhase('error')
      }
    } finally {
      window.api.gemini.offLoginProgress(cb)
    }
  }

  const handleGeminiLogout = async () => {
    await window.api.gemini.logoutGemini()
    setGeminiLoggedIn(false)
  }

  const handleCodexSetup = async () => {
    setCodexSetupPhase('installing')
    setCodexSetupLines([])
    const cb = (payload: { phase: string; line?: string }) => {
      if (payload.line) setCodexSetupLines(prev => [...prev, payload.line!])
      if (payload.phase === 'done') setCodexSetupPhase('done')
      if (payload.phase === 'error') setCodexSetupPhase('error')
    }
    window.api.codex.onSetupProgress(cb)
    try {
      const result = await window.api.codex.setup()
      if (result.ok) {
        setCodexInstalled(true)
        setCodexSetupPhase('done')
      } else {
        setCodexSetupPhase('error')
      }
    } finally {
      window.api.codex.offSetupProgress(cb)
    }
  }

  const handleCodexLogin = async () => {
    setCodexLoginPhase('logging-in')
    setCodexLoginLines([])
    const cb = (payload: { message: string; isError?: boolean; done?: boolean }) => {
      setCodexLoginLines(prev => [...prev, payload.message])
      if (payload.done) setCodexLoginPhase(payload.isError ? 'error' : 'done')
    }
    window.api.codex.onLoginProgress(cb)
    try {
      const result = await window.api.codex.loginCodex()
      if (result.ok) {
        setCodexLoggedIn(true)
        setCodexLoginPhase('done')
      } else if (codexLoginPhase !== 'error') {
        setCodexLoginPhase('error')
      }
    } finally {
      window.api.codex.offLoginProgress(cb)
    }
  }

  const handleCodexLogout = async () => {
    await window.api.codex.logoutCodex()
    setCodexLoggedIn(false)
  }

  // MCP exposure state (per-target: claude / opencode / gemini / codex)
  const [mcpStatus, setMcpStatus] = useState<Record<McpTarget, { configured: boolean; configPath: string | null }>>(
    emptyTargetMap({ configured: false, configPath: null }),
  )
  const [mcpSnippets, setMcpSnippets] = useState<Record<McpTarget, string>>(emptyTargetMap(''))
  const [mcpStatusLoaded, setMcpStatusLoaded] = useState(false)
  const [mcpCopied, setMcpCopied] = useState<Record<McpTarget, boolean>>(emptyTargetMap(false))
  const [mcpAutoConfig, setMcpAutoConfig] = useState<Record<McpTarget, { text: string; isError: boolean } | null>>(
    emptyTargetMap<{ text: string; isError: boolean } | null>(null),
  )
  const [mcpTestResult, setMcpTestResult] = useState<{ target: McpTarget; ok: boolean; text: string } | null>(null)
  const [mcpManualOpen, setMcpManualOpen] = useState<Record<McpTarget, boolean>>(emptyTargetMap(false))
  const [mcpPathShownAsTitle, setMcpPathShownAsTitle] = useState<Record<McpTarget, boolean>>(emptyTargetMap(false))
  const [mcpPathCopied, setMcpPathCopied] = useState<Record<McpTarget, boolean>>(emptyTargetMap(false))

  const loadMcpStatus = useCallback(async () => {
    const results = await Promise.all(
      MCP_TARGETS.flatMap(target => [
        window.api.mcp.getStatus(target).then(status => ({ target, status })),
        window.api.mcp.getConfigSnippet(target).then(snippet => ({ target, snippet })),
      ]),
    )
    const status = emptyTargetMap<{ configured: boolean; configPath: string | null }>({ configured: false, configPath: null })
    const snippets = emptyTargetMap('')
    for (const r of results) {
      if ('status' in r)  status[r.target]   = r.status
      if ('snippet' in r) snippets[r.target] = r.snippet
    }
    setMcpStatus(status)
    setMcpSnippets(snippets)
    setMcpStatusLoaded(true)
  }, [])

  useEffect(() => { loadMcpStatus() }, [loadMcpStatus])

  const handleAutoConfigure = async (target: McpTarget) => {
    setMcpAutoConfig(prev => ({ ...prev, [target]: null }))
    const result = await window.api.mcp.autoConfigure(target)
    if (result.success) {
      setMcpAutoConfig(prev => ({ ...prev, [target]: { text: 'Configured!', isError: false } }))
      await loadMcpStatus()
    } else {
      setMcpAutoConfig(prev => ({ ...prev, [target]: { text: `Failed: ${result.error ?? 'unknown error'}`, isError: true } }))
    }
    timers.current.push(setTimeout(() => {
      setMcpAutoConfig(prev => ({ ...prev, [target]: null }))
    }, 3000))
  }

  const handleCopy = async (target: McpTarget) => {
    await navigator.clipboard.writeText(mcpSnippets[target])
    setMcpCopied(prev => ({ ...prev, [target]: true }))
    timers.current.push(setTimeout(() => {
      setMcpCopied(prev => ({ ...prev, [target]: false }))
    }, 2000))
  }

  const handleCopyPath = async (target: McpTarget) => {
    const path = mcpStatus[target].configPath
    if (!path) return
    await navigator.clipboard.writeText(path)
    setMcpPathCopied(prev => ({ ...prev, [target]: true }))
    timers.current.push(setTimeout(() => {
      setMcpPathCopied(prev => ({ ...prev, [target]: false }))
    }, 1500))
  }

  const handleTestConnection = async (target: McpTarget) => {
    setMcpTestResult(null)
    const result = await window.api.mcp.testConnection()
    if (result.running) {
      setMcpTestResult({ target, ok: true, text: `Running — ${result.skillCount} active skill${result.skillCount !== 1 ? 's' : ''}` })
    } else {
      setMcpTestResult({ target, ok: false, text: 'Not running' })
    }
    timers.current.push(setTimeout(() => setMcpTestResult(null), 4000))
  }

  // Custom MCP state
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

  const tabs: { id: AITabId; label: string }[] = [
    { id: 'api', label: 'API / HTTPS' },
    { id: 'cli', label: 'CLI' },
    { id: 'mcp', label: 'MCP' },
  ]

  const MCP_CARD_INFO: Record<McpTarget, { name: string; description: string; configFile: string; icon: ReactNode }> = {
    claude:   { name: 'Claude Code MCP', description: "Let the Claude Code CLI call Gitplaces tools.", configFile: 'claude_desktop_config.json', icon: <IconClaude  width={20} height={20} style={{ color: 'var(--text)' }} /> },
    opencode: { name: 'OpenCode MCP',    description: "Let the OpenCode CLI call Gitplaces tools.",    configFile: 'opencode.json',              icon: <OpenCodeIcon /> },
    gemini:   { name: 'Gemini CLI MCP',  description: "Let the Gemini CLI call Gitplaces tools.",      configFile: 'settings.json',              icon: <IconGemini  width={20} height={20} style={{ color: 'var(--text)' }} /> },
    codex:    { name: 'Codex CLI MCP',   description: "Let the Codex CLI call Gitplaces tools.",       configFile: 'config.toml',                icon: <IconOpenAI  width={20} height={20} style={{ color: 'var(--text)' }} /> },
  }

  const renderMcpCard = (target: McpTarget): ReactNode => {
    const info        = MCP_CARD_INFO[target]
    const status      = mcpStatus[target]
    const snippet     = mcpSnippets[target]
    const autoConfig  = mcpAutoConfig[target]
    const isThisTest  = mcpTestResult?.target === target
    const isCopied    = mcpCopied[target]
    const manualOpen  = mcpManualOpen[target]
    const pathShownAsTitle = mcpPathShownAsTitle[target]
    const pathCopied  = mcpPathCopied[target]

    const testInline = isThisTest && mcpTestResult ? (
      <span style={{
        color: mcpTestResult.ok ? 'var(--accent-green, #16a34a)' : 'var(--accent-red, #991b1b)',
        fontSize: 11.5,
      }}>
        {mcpTestResult.text}
      </span>
    ) : (
      <button
        type="button"
        onClick={() => handleTestConnection(target)}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5,
        }}
      >
        Test
      </button>
    )

    const titleNode = pathShownAsTitle && status.configPath ? (
      <button
        type="button"
        autoFocus
        onClick={() => handleCopyPath(target)}
        onBlur={() => setMcpPathShownAsTitle(prev => ({ ...prev, [target]: false }))}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: 'inherit', cursor: 'pointer',
          font: 'inherit', wordBreak: 'break-all', textAlign: 'left',
        }}
        title="Click to copy"
      >
        {pathCopied ? 'Copied!' : status.configPath}
      </button>
    ) : info.name

    const pathToggleIcon = (
      <button
        type="button"
        // preventDefault on mousedown keeps the path button focused so its onBlur
        // doesn't fire and race the toggle's onClick. Click elsewhere → blur fires
        // → revert; click the icon → onClick toggles cleanly.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMcpPathShownAsTitle(prev => ({ ...prev, [target]: !prev[target] }))}
        disabled={!status.configPath}
        title={pathShownAsTitle ? 'Show name' : 'Show config file path'}
        aria-label={pathShownAsTitle ? 'Show name' : 'Show config file path'}
        style={{
          background: 'transparent', border: 'none', padding: 2,
          color: status.configPath ? 'var(--t2)' : 'var(--t3)',
          cursor: status.configPath ? 'pointer' : 'default',
          display: 'inline-flex', alignItems: 'center',
          opacity: status.configPath ? 0.7 : 0.35,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5z"/>
        </svg>
      </button>
    )

    const iconBtnStyle: React.CSSProperties = {
      padding: 6, lineHeight: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }

    return (
      <div key={target} style={{ marginBottom: 14 }}>
        <ProviderCard
          icon={info.icon}
          name={titleNode}
          chip="MCP"
          description={info.description}
          nameAccessory={pathToggleIcon}
          status={{
            tone: status.configured ? 'green' : 'gray',
            text: status.configured ? 'Configured' : 'Not configured',
          }}
          statusAccessory={testInline}
          actions={<>
            <button
              className="settings-btn"
              style={iconBtnStyle}
              onClick={() => handleAutoConfigure(target)}
              title="Auto-configure"
              aria-label="Auto-configure"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.2 3.2l2.1 2.1M10.7 10.7l2.1 2.1M3.2 12.8l2.1-2.1M10.7 5.3l2.1-2.1"/>
              </svg>
            </button>
            <button
              className="settings-btn settings-btn--ghost"
              style={iconBtnStyle}
              onClick={() => setMcpManualOpen(prev => ({ ...prev, [target]: !prev[target] }))}
              title="Manual configuration"
              aria-label="Manual configuration"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2.5c-1.5 0-2 1-2 2.2v1.5c0 .8-.3 1.3-1 1.3.7 0 1 .5 1 1.3v1.5c0 1.2.5 2.2 2 2.2M10 2.5c1.5 0 2 1 2 2.2v1.5c0 .8.3 1.3 1 1.3-.7 0-1 .5-1 1.3v1.5c0 1.2-.5 2.2-2 2.2"/>
              </svg>
            </button>
          </>}
        />

        {autoConfig && (
          <p className={`settings-hint${autoConfig.isError ? ' error' : ' success'}`} style={{ margin: '4px 0 0' }}>
            {autoConfig.text}
          </p>
        )}

        {manualOpen && (
          <div style={{ marginTop: 8 }}>
            <p className="settings-hint" style={{ margin: '0 0 4px' }}>
              Add this to <code>{info.configFile}</code>:
            </p>
            <div className="settings-mcp-snippet-row">
              <pre className="settings-mcp-snippet">{snippet}</pre>
              <button className="settings-btn settings-mcp-copy-btn" onClick={() => handleCopy(target)}>
                {isCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <p className="ai-tab-desc">
        Gitplaces' built-in AI features — the chat overlay, skill generation, and tag extraction —
        can each use a different provider and model. The transports below can be mixed and matched
        (e.g. an API key for chat, a CLI subscription for skill generation).
      </p>
      <div className="ai-tabs" role="tablist" aria-label="AI transport">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeAITab === t.id}
            className={`ai-tab${activeAITab === t.id ? ' active' : ''}`}
            onClick={() => setActiveAITab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeAITab === 'api' && (
        <div className="ai-tab-panel" role="tabpanel">
          <p className="ai-tab-desc">
            Gitplaces makes HTTPS calls to each provider directly using your API key. You pay the
            provider per token — no subscription needed. Best for fine-grained control over which
            model handles each feature.
          </p>

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
        </div>
      )}

      {activeAITab === 'cli' && (
        <div className="ai-tab-panel" role="tabpanel">
          <p className="ai-tab-desc">
            Gitplaces launches the CLI tool as a subprocess and communicates with it over stdio.
            Authentication and billing flow through your existing Claude.ai or OpenCode
            subscription rather than a per-token API key. Best if you're already paying for one
            of these tools.
          </p>

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

        <ProviderCard
          icon={<IconGemini width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Gemini CLI"
          chip="CLI"
          description="Google's CLI agent for Gemini models, using your Google account."
          status={
            geminiInstalled === null || geminiLoggedIn === null
              ? { tone: 'gray', text: 'Checking…' }
              : geminiInstalled && geminiLoggedIn
                ? { tone: 'green', text: 'Installed · Logged in' }
                : geminiInstalled
                  ? { tone: 'amber', text: 'Installed · Not logged in' }
                  : { tone: 'gray', text: 'Not installed' }
          }
          actions={
            geminiInstalled === false ? (
              <button
                className="settings-btn"
                disabled={geminiSetupPhase === 'installing' || geminiSetupPhase === 'checking'}
                onClick={handleGeminiSetup}
              >
                {geminiSetupPhase === 'installing' || geminiSetupPhase === 'checking' ? 'Installing…' : 'Install'}
              </button>
            ) : geminiInstalled && geminiLoggedIn === false ? (
              <button
                className="settings-btn"
                disabled={geminiLoginPhase === 'logging-in'}
                onClick={handleGeminiLogin}
              >
                {geminiLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login'}
              </button>
            ) : geminiInstalled && geminiLoggedIn ? (
              <button className="settings-btn settings-btn--link" onClick={handleGeminiLogout}>
                Logout
              </button>
            ) : null
          }
        />

        {(geminiSetupLines.length > 0 || geminiLoginLines.length > 0) && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {[...geminiSetupLines, ...geminiLoginLines].map((line, i) => (
              <div key={i} className="settings-setup-line">{line}</div>
            ))}
          </div>
        )}

        <ProviderCard
          icon={<IconOpenAI width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Codex CLI"
          chip="CLI"
          description="OpenAI's CLI agent for Codex/GPT models, using your ChatGPT or API account."
          status={
            codexInstalled === null || codexLoggedIn === null
              ? { tone: 'gray', text: 'Checking…' }
              : codexInstalled && codexLoggedIn
                ? { tone: 'green', text: 'Installed · Logged in' }
                : codexInstalled
                  ? { tone: 'amber', text: 'Installed · Not logged in' }
                  : { tone: 'gray', text: 'Not installed' }
          }
          actions={
            codexInstalled === false ? (
              <button
                className="settings-btn"
                disabled={codexSetupPhase === 'installing' || codexSetupPhase === 'checking'}
                onClick={handleCodexSetup}
              >
                {codexSetupPhase === 'installing' || codexSetupPhase === 'checking' ? 'Installing…' : 'Install'}
              </button>
            ) : codexInstalled && codexLoggedIn === false ? (
              <button
                className="settings-btn"
                disabled={codexLoginPhase === 'logging-in'}
                onClick={handleCodexLogin}
              >
                {codexLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login'}
              </button>
            ) : codexInstalled && codexLoggedIn ? (
              <button className="settings-btn settings-btn--link" onClick={handleCodexLogout}>
                Logout
              </button>
            ) : null
          }
        />

        {(codexSetupLines.length > 0 || codexLoginLines.length > 0) && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {[...codexSetupLines, ...codexLoginLines].map((line, i) => (
              <div key={i} className="settings-setup-line">{line}</div>
            ))}
          </div>
        )}
        </div>
      )}

      {activeAITab === 'mcp' && mcpStatusLoaded && (
        <div className="ai-tab-panel" role="tabpanel">
          <p className="ai-tab-desc">
            The Model Context Protocol lets AI tools share capabilities with each other. Below, you
            can expose Gitplaces as an MCP server so a CLI agent — Claude Code, OpenCode, Gemini, or
            Codex — can call its tools, or register third-party MCP servers as additional tool
            sources for Gitplaces itself.
          </p>

          {MCP_TARGETS.map(target => renderMcpCard(target))}

          <div className="ai-tab-section-label" style={{ marginTop: 20 }}>
            Custom MCP <span className="transport-chip beta" style={{ marginLeft: 6 }}>BETA</span>
          </div>
          <div className="section-block-body-desc">
            Third-party MCP servers Gitplaces can call as tool sources.
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
              Connect Gitplaces to your data and tools via a remote MCP server.
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
              Only use connectors from developers you trust. Gitplaces cannot verify that connectors will work as intended or that they won&rsquo;t change.
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
        </div>
      )}

    </>
  )
}
