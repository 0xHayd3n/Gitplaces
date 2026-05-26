import { useState, useEffect, useCallback, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import { useAppearance, type BackgroundMode } from '../contexts/Appearance'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useGitHubLogin } from '../hooks/useGitHubLogin'
import IconAnthropic from '~icons/simple-icons/anthropic'
import IconOpenAI from '~icons/simple-icons/openai'
import IconGemini from '~icons/simple-icons/googlegemini'
import IconOllama from '~icons/simple-icons/ollama'

type SetupPhase = 'idle' | 'checking' | 'installing' | 'auth' | 'done' | 'error'
type LoginPhase = 'idle' | 'logging-in' | 'done' | 'error'
type CategoryId = 'providers' | 'claude-opencode' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'

type CustomConnector = { id: string; name: string; url: string; oauthClientId: string; oauthClientSecret: string }

type ProviderConfig = { enabled: boolean; apiKey?: string; organization?: string }
type OpenAICompatibleEndpoint = { id: string; label: string; baseUrl: string; apiKey?: string }
type DefaultRef = { provider: string; model: string; endpoint?: string } | undefined

// Curated model lists shown in the Defaults dropdowns and the provider-card
// hover tooltips. Update as new models ship. The Phase-4 plan calls this a
// follow-up "fancy picker" — kept renderer-side because it's pure UI metadata.
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

const UpdatesIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v6 M5 6l3-3 3 3" />
    <path d="M3.5 10a5.5 5.5 0 1 0 9.5-3.8" />
  </svg>
)

const ProvidersIcon = () => (
  <svg {...iconProps}>
    <circle cx="5" cy="8" r="2" />
    <circle cx="11" cy="4" r="2" />
    <circle cx="11" cy="12" r="2" />
    <path d="M7 8h2 M9 4H7l-2 4 2 4h2 M9 12h2" />
  </svg>
)

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

const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'providers', label: 'Providers', icon: <ProvidersIcon /> },
  { id: 'claude-opencode', label: 'Claude Code & OpenCode', icon: <DesktopIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'language', label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads', label: 'Downloads', icon: <DownloadIcon /> },
  { id: 'projects', label: 'Projects', icon: <ProjectsIcon /> },
  { id: 'connectors', label: 'Connectors', icon: <ConnectorsIcon /> },
  { id: 'updates', label: 'Updates', icon: <UpdatesIcon /> },
]

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
    <div className="connector-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div className="connector-icon"><IconOllama width={20} height={20} style={{ color: 'var(--text)' }} /></div>
        <div className="connector-info" style={{ flex: 1 }}>
          <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
            Local / openai-compatible
            <InfoIcon title={PROVIDER_INFO_TOOLTIP['openai-compatible']} />
          </div>
        </div>
        <div className="connector-actions">
          <button className="settings-btn" onClick={() => setAdding(true)}>Add endpoint</button>
        </div>
      </div>

      {props.endpoints.length > 0 && (
        <div className="connector-list" style={{ marginLeft: 50 }}>
          {props.endpoints.map(ep => (
            <div key={ep.id} className="connector-row">
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
        <div className="connector-add-modal" style={{ marginLeft: 50 }}>
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
    </div>
  )
}

function DefaultsSection(props: {
  chatDefault:  DefaultRef
  setChatDefault: Dispatch<SetStateAction<DefaultRef>>
  skillDefault: DefaultRef
  setSkillDefault: Dispatch<SetStateAction<DefaultRef>>
  tagDefault:   DefaultRef
  setTagDefault: Dispatch<SetStateAction<DefaultRef>>
  anthropicConfigured: boolean
  openaiConfigured:    boolean
  googleConfigured:    boolean
  endpoints: OpenAICompatibleEndpoint[]
}) {
  const [saveError, setSaveError] = useState<string | null>(null)

  const availableProviders: { id: string; label: string }[] = []
  if (props.anthropicConfigured)  availableProviders.push({ id: 'anthropic',         label: 'Anthropic' })
  if (props.openaiConfigured)     availableProviders.push({ id: 'openai',            label: 'OpenAI' })
  if (props.googleConfigured)     availableProviders.push({ id: 'google',            label: 'Google Gemini' })
  if (props.endpoints.length > 0) availableProviders.push({ id: 'openai-compatible', label: 'Local / openai-compatible' })

  const saveRef = async (
    feature: 'chat' | 'skillGen' | 'tagExtract',
    ref: { provider: string; model: string; endpoint?: string },
    setter: Dispatch<SetStateAction<DefaultRef>>,
  ) => {
    setSaveError(null)
    try {
      await window.api.llm.setDefault(feature, ref)
      setter(ref)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const featureRow = (
    label: string,
    description: string,
    current: DefaultRef,
    feature: 'chat' | 'skillGen' | 'tagExtract',
    setter: Dispatch<SetStateAction<DefaultRef>>,
  ) => {
    const provider = current?.provider ?? ''
    const endpoint = current?.endpoint ?? ''
    const model    = current?.model    ?? ''

    const onProviderChange = (next: string) => {
      if (next === '') return
      if (next === 'openai-compatible') {
        const ep = props.endpoints[0]?.id
        if (!ep) return
        const carriedModel = current?.provider === 'openai-compatible' ? model : ''
        if (carriedModel) {
          saveRef(feature, { provider: 'openai-compatible', endpoint: ep, model: carriedModel }, setter)
        } else {
          // Set local state but don't save until model is typed
          setter({ provider: 'openai-compatible', endpoint: ep, model: '' })
        }
      } else {
        const known = KNOWN_MODELS_BY_PROVIDER[next as 'anthropic' | 'openai' | 'google']
        const firstModel = known?.[0]?.id
        if (!firstModel) return
        saveRef(feature, { provider: next, model: firstModel }, setter)
      }
    }

    const onEndpointChange = (next: string) => {
      if (provider !== 'openai-compatible') return
      if (model.trim()) {
        saveRef(feature, { provider, endpoint: next, model }, setter)
      } else {
        setter({ provider, endpoint: next, model: '' })
      }
    }

    const onModelSelectChange = (next: string) => {
      if (!provider || provider === 'openai-compatible') return
      saveRef(feature, { provider, model: next }, setter)
    }

    const onModelTextChange = (next: string) => {
      if (provider !== 'openai-compatible' || !endpoint) return
      setter({ provider, endpoint, model: next })
    }

    const onModelTextBlur = () => {
      if (provider !== 'openai-compatible' || !endpoint) return
      const trimmed = model.trim()
      if (trimmed) saveRef(feature, { provider, endpoint, model: trimmed }, setter)
    }

    const knownModels = provider !== '' && provider !== 'openai-compatible'
      ? KNOWN_MODELS_BY_PROVIDER[provider as 'anthropic' | 'openai' | 'google']
      : undefined

    return (
      <div className="settings-group-row settings-group-row--full">
        <div className="settings-group-row-main">
          <div className="settings-group-row-label">{label}</div>
          <div className="settings-group-row-sub">{description}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <select
            className="settings-input"
            value={provider}
            onChange={e => onProviderChange(e.target.value)}
            style={{ flex: '0 1 200px' }}
          >
            <option value="" disabled>— Select provider —</option>
            {availableProviders.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          {provider === 'openai-compatible' && (
            <>
              <select
                className="settings-input"
                value={endpoint}
                onChange={e => onEndpointChange(e.target.value)}
                style={{ flex: '0 1 180px' }}
              >
                {props.endpoints.map(ep => (
                  <option key={ep.id} value={ep.id}>{ep.label}</option>
                ))}
              </select>
              <input
                className="settings-input"
                placeholder="model name (e.g. llama3.1:70b)"
                value={model}
                onChange={e => onModelTextChange(e.target.value)}
                onBlur={onModelTextBlur}
                style={{ flex: '1 1 200px' }}
              />
            </>
          )}

          {knownModels && (
            <select
              className="settings-input"
              value={model}
              onChange={e => onModelSelectChange(e.target.value)}
              style={{ flex: '1 1 240px' }}
            >
              {!knownModels.find(m => m.id === model) && model && (
                <option value={model}>{model} (custom)</option>
              )}
              {knownModels.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    )
  }

  const empty = availableProviders.length === 0

  return (
    <div className="settings-group">
      <div className="settings-group-title">Defaults</div>
      <div className="settings-group-body">
        {empty ? (
          <div style={{ padding: '16px', fontSize: 12, color: 'var(--text2)' }}>
            Configure at least one provider above (add an API key or a local endpoint) to set defaults.
          </div>
        ) : (
          <>
            {featureRow(
              'Chat default',
              'Used by the AI Chat overlay when no agent specifies a model.',
              props.chatDefault, 'chat', props.setChatDefault,
            )}
            {featureRow(
              'Skill generation default',
              'Used when generating skills from repositories.',
              props.skillDefault, 'skillGen', props.setSkillDefault,
            )}
            {featureRow(
              'Tag extraction default',
              'Background task: extracts search tags from queries.',
              props.tagDefault, 'tagExtract', props.setTagDefault,
            )}
          </>
        )}
        {saveError && (
          <div style={{ padding: '8px 16px', color: 'var(--accent-red, #991b1b)', fontSize: 12 }}>
            Save error: {saveError}
          </div>
        )}
        <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text2)' }}>
          Note (Phase 4): defaults are stored but not yet read by the call sites — that wiring lands in a follow-up. Today the chat, skill gen, and tag extraction features continue to use their hardcoded Claude models.
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const { background, setBackground, invertDarkImages, setInvertDarkImages } = useAppearance()
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

  // Skills Backup sync state
  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean
    repoOwner: string | undefined
    failedCount: number
    lastSynced: number | null
  } | null>(null)
  const [syncConnecting, setSyncConnecting] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)

  // Updates state
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [checkIntervalHours, setCheckIntervalHours] = useState(24)
  const [lastCheckedTs, setLastCheckedTs] = useState<number | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [intervalDraft, setIntervalDraft] = useState(String(checkIntervalHours))

  // Providers state
  const [anthropicCfg,  setAnthropicCfg]  = useState<ProviderConfig>({ enabled: false })
  const [openaiCfg,     setOpenaiCfg]     = useState<ProviderConfig>({ enabled: false })
  const [googleCfg,     setGoogleCfg]     = useState<ProviderConfig>({ enabled: false })
  const [endpoints,     setEndpoints]     = useState<OpenAICompatibleEndpoint[]>([])
  const [chatDefault,   setChatDefault]   = useState<DefaultRef>(undefined)
  const [skillDefault,  setSkillDefault]  = useState<DefaultRef>(undefined)
  const [tagDefault,    setTagDefault]    = useState<DefaultRef>(undefined)
  const [testStatus,    setTestStatus]    = useState<Record<string, { ok: boolean; message?: string } | 'testing'>>({})

  useEffect(() => {
    window.api.skillSync.getStatus().then(setSyncStatus)
  }, [])

  useEffect(() => {
    window.api.settings.get('autoUpdateEnabled').then(val => {
      setAutoUpdateEnabled(val === 'true')
    }).catch(() => {})
    window.api.settings.get('updateCheckIntervalHours').then(val => {
      if (val) {
        const parsed = parseInt(val, 10) || 24
        setCheckIntervalHours(parsed)
        setIntervalDraft(String(parsed))
      }
    }).catch(() => {})
    window.api.updates.lastChecked().then(({ timestamp }) => {
      setLastCheckedTs(timestamp)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeCategory !== 'providers') return
    let cancelled = false
    ;(async () => {
      const api = window.api.llm
      const [a, o, g, eps, cd, sd, td] = await Promise.all([
        api.getProviderConfig('anthropic'),
        api.getProviderConfig('openai'),
        api.getProviderConfig('google'),
        api.listOpenAICompatibleEndpoints(),
        api.getDefault('chat'),
        api.getDefault('skillGen'),
        api.getDefault('tagExtract'),
      ])
      if (cancelled) return
      setAnthropicCfg(a)
      setOpenaiCfg(o)
      setGoogleCfg(g)
      setEndpoints(eps)
      setChatDefault(cd)
      setSkillDefault(sd)
      setTagDefault(td)
    })().catch(err => console.error('[settings] failed to load provider configs:', err))
    return () => { cancelled = true }
  }, [activeCategory])

  useEffect(() => {
    const onFailed = (_payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => {
      window.api.skillSync.getStatus().then(setSyncStatus)
    }
    window.api.skillSync.onSyncFailed(onFailed)
    return () => window.api.skillSync.offSyncFailed(onFailed)
  }, [])

  const handleSyncConnectClick = useCallback(() => {
    setSyncConfirmOpen(true)
  }, [])

  const handleSyncConfirm = useCallback(async () => {
    setSyncConfirmOpen(false)
    setSyncConnecting(true)
    setSyncError(null)
    const result = await window.api.skillSync.setup()
    setSyncConnecting(false)
    if (result.ok) {
      const status = await window.api.skillSync.getStatus()
      setSyncStatus(status)
    } else {
      setSyncError(result.error)
    }
  }, [])

  const handleSyncDisconnect = useCallback(async () => {
    await window.api.skillSync.disconnect()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])

  const handleSyncRetry = useCallback(async () => {
    await window.api.skillSync.retryFailed()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])

  const handleAutoUpdateToggle = useCallback(async (enabled: boolean) => {
    setAutoUpdateEnabled(enabled)
    await window.api.settings.set('autoUpdateEnabled', enabled ? 'true' : 'false')
  }, [])

  const handleIntervalChange = useCallback(async (hours: number) => {
    const clamped = Math.min(168, Math.max(1, hours))
    setCheckIntervalHours(clamped)
    setIntervalDraft(String(clamped))
    await window.api.settings.set('updateCheckIntervalHours', String(clamped))
    await window.api.updates.restartService()
  }, [])

  const handleCheckNow = useCallback(async () => {
    setUpdateChecking(true)
    try {
      await window.api.updates.checkNow()
      const { timestamp } = await window.api.updates.lastChecked()
      setLastCheckedTs(timestamp)
    } finally {
      setUpdateChecking(false)
    }
  }, [])

  // Connectors state
  const auth = useGitHubAuth()
  const githubLogin = useGitHubLogin()
  const githubUsername = auth.user?.login ?? null
  const githubConnecting = githubLogin.status === 'pending' || githubLogin.status === 'polling'
  const githubUserCode = githubLogin.userCode
  const githubVerificationUri = githubLogin.verificationUri
  const githubVerificationUriComplete = githubLogin.verificationUriComplete
  const githubError = githubLogin.error
  const [githubDisconnecting, setGithubDisconnecting] = useState(false)
  const [claudeLoggingOut, setClaudeLoggingOut] = useState(false)
  const [claudeDisconnectError, setClaudeDisconnectError] = useState<string | null>(null)
  const [connectorStatus, setConnectorStatus] = useState<Record<string, 'checking' | 'ok' | 'error'>>({})
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

  // OpenCode state
  const [opencodeInstalled, setOpencodeInstalled] = useState<boolean | null>(null)
  const [opencodeLoggedIn, setOpencodeLoggedIn] = useState<boolean | null>(null)
  const [opencodeSetupPhase, setOpencodeSetupPhase] = useState<SetupPhase>('idle')
  const [opencodeSetupLines, setOpencodeSetupLines] = useState<string[]>([])
  const [opencodeLoginPhase, setOpencodeLoginPhase] = useState<LoginPhase>('idle')
  const [opencodeLoginLines, setOpencodeLoginLines] = useState<string[]>([])

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
    window.api.opencode.detect().then(setOpencodeInstalled).catch(() => setOpencodeInstalled(false))
    window.api.opencode.checkAuthStatus().then(setOpencodeLoggedIn).catch(() => setOpencodeLoggedIn(false))
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

  const handleGitHubConnect = () => {
    githubLogin.start()
  }

  const handleGitHubDisconnect = async () => {
    githubLogin.reset()
    setGithubDisconnecting(true)
    try {
      await window.api.github.disconnect()
      await auth.refresh()
    } finally {
      setGithubDisconnecting(false)
    }
  }

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

  const resetAddForm = () => {
    setNewConnectorName('')
    setNewConnectorUrl('')
    setNewConnectorAdvanced(false)
    setNewConnectorOAuthId('')
    setNewConnectorOAuthSecret('')
    setShowAddConnector(false)
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

  const renderProviders = () => {
    const saveProvider = async (provider: 'anthropic' | 'openai' | 'google', cfg: ProviderConfig) => {
      await window.api.llm.setProviderConfig(provider, cfg)
    }

    const testProvider = async (provider: string, modelHint: string) => {
      setTestStatus(s => ({ ...s, [provider]: 'testing' }))
      const result = await window.api.llm.testConnection({ provider, model: modelHint })
      setTestStatus(s => ({ ...s, [provider]: { ok: result.ok, message: result.ok ? `OK: ${result.sample ?? ''}` : `${result.kind}: ${result.message}` } }))
    }

    const renderStatus = (provider: string) => {
      const s = testStatus[provider]
      if (s === 'testing') return <span className="connector-badge">Testing…</span>
      if (!s) return null
      if (s.ok) return <span className="connector-badge connected">{s.message}</span>
      return <span className="connector-badge" style={{ background: 'var(--accent-red-soft, #fee2e2)', color: 'var(--accent-red, #991b1b)' }}>{s.message}</span>
    }

    return (
      <>
        <div className="settings-group">
          <div className="settings-group-title">API providers</div>
          <div className="settings-group-body">

            {/* Anthropic card */}
            <div className="connector-row">
              <div className="connector-icon"><IconAnthropic width={20} height={20} style={{ color: 'var(--text)' }} /></div>
              <div className="connector-info">
                <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
                  Anthropic
                  <InfoIcon title={PROVIDER_INFO_TOOLTIP.anthropic} />
                </div>
                <input
                  className="settings-input"
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicCfg.apiKey ?? ''}
                  onChange={e => setAnthropicCfg({ ...anthropicCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                  onBlur={() => saveProvider('anthropic', anthropicCfg)}
                  style={{ marginTop: 8, width: '100%' }}
                />
              </div>
              <div className="connector-actions">
                <button className="settings-btn" disabled={!anthropicCfg.apiKey} onClick={() => testProvider('anthropic', 'claude-haiku-4-5-20251001')}>Test</button>
                {renderStatus('anthropic')}
              </div>
            </div>

            {/* OpenAI card */}
            <div className="connector-row">
              <div className="connector-icon"><IconOpenAI width={20} height={20} style={{ color: 'var(--text)' }} /></div>
              <div className="connector-info">
                <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
                  OpenAI
                  <InfoIcon title={PROVIDER_INFO_TOOLTIP.openai} />
                </div>
                <input
                  className="settings-input"
                  type="password"
                  placeholder="sk-..."
                  value={openaiCfg.apiKey ?? ''}
                  onChange={e => setOpenaiCfg({ ...openaiCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                  onBlur={() => saveProvider('openai', openaiCfg)}
                  style={{ marginTop: 8, width: '100%' }}
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
              </div>
              <div className="connector-actions">
                <button className="settings-btn" disabled={!openaiCfg.apiKey} onClick={() => testProvider('openai', 'gpt-4o')}>Test</button>
                {renderStatus('openai')}
              </div>
            </div>

            {/* Google card */}
            <div className="connector-row">
              <div className="connector-icon"><IconGemini width={20} height={20} style={{ color: 'var(--text)' }} /></div>
              <div className="connector-info">
                <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
                  Google Gemini
                  <InfoIcon title={PROVIDER_INFO_TOOLTIP.google} />
                </div>
                <input
                  className="settings-input"
                  type="password"
                  placeholder="g-..."
                  value={googleCfg.apiKey ?? ''}
                  onChange={e => setGoogleCfg({ ...googleCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                  onBlur={() => saveProvider('google', googleCfg)}
                  style={{ marginTop: 8, width: '100%' }}
                />
              </div>
              <div className="connector-actions">
                <button className="settings-btn" disabled={!googleCfg.apiKey} onClick={() => testProvider('google', 'gemini-2.5-pro')}>Test</button>
                {renderStatus('google')}
              </div>
            </div>

            {/* OpenAI-compatible card */}
            <OpenAICompatibleSection endpoints={endpoints} setEndpoints={setEndpoints} testProvider={testProvider} renderStatus={renderStatus} />

            {/* OpenCode card */}
            <div className="connector-row">
              <div className="connector-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)' }} aria-hidden="true">
                  <polyline points="8 6 2 12 8 18" />
                  <polyline points="16 6 22 12 16 18" />
                </svg>
              </div>
              <div className="connector-info">
                <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
                  OpenCode
                  <InfoIcon title="Subscription-based CLI agent runner. Supports Claude, GPT, Gemini, and local models via a single OAuth login." />
                </div>
                <div className="connector-desc" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className={`status-dot ${opencodeInstalled ? 'active' : 'inactive'}`} />
                    {opencodeInstalled === null ? 'Checking…' : opencodeInstalled ? 'Installed' : 'Not installed'}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className={`status-dot ${opencodeLoggedIn ? 'active' : 'inactive'}`} />
                    {opencodeLoggedIn === null ? 'Checking…' : opencodeLoggedIn ? 'Logged in' : 'Not logged in'}
                  </span>
                </div>
              </div>
              <div className="connector-actions">
                <button className="settings-btn" onClick={() => setActiveCategory('claude-opencode')}>
                  {opencodeInstalled && opencodeLoggedIn ? 'Manage' : 'Set up'}
                </button>
              </div>
            </div>

          </div>
        </div>

        <DefaultsSection
          chatDefault={chatDefault} setChatDefault={setChatDefault}
          skillDefault={skillDefault} setSkillDefault={setSkillDefault}
          tagDefault={tagDefault} setTagDefault={setTagDefault}
          anthropicConfigured={!!anthropicCfg.apiKey}
          openaiConfigured={!!openaiCfg.apiKey}
          googleConfigured={!!googleCfg.apiKey}
          endpoints={endpoints}
        />
      </>
    )
  }

  const renderConnectors = () => (
    <>
      {syncConfirmOpen && (
        <div className="coll-modal-overlay" onClick={() => setSyncConfirmOpen(false)}>
          <div className="coll-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="coll-modal-title">Connect Skills Backup</div>
            <p className="settings-hint" style={{ marginTop: 8, marginBottom: 16 }}>
              {syncStatus?.repoOwner
                ? <>Connect to your existing <strong>gitsuite-skills</strong> repo.</>
                : <>This will create a private repo <strong>gitsuite-skills</strong> on your GitHub account. Your skills will be pushed there automatically after each generation.</>}
            </p>
            <div className="coll-modal-actions">
              <button className="coll-modal-cancel" onClick={() => setSyncConfirmOpen(false)}>Cancel</button>
              <button className="coll-modal-create" onClick={handleSyncConfirm}>{syncStatus?.repoOwner ? 'Connect' : 'Create & Connect'}</button>
            </div>
          </div>
        </div>
      )}

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
                    <button className="settings-btn" onClick={() => {
                      const url = githubVerificationUriComplete ?? githubVerificationUri
                      if (url) window.api.github.openLoginPopup(url).catch(() => {})
                    }}>
                      Open login window
                    </button>
                    <button
                      className="settings-btn settings-btn--link"
                      onClick={() => githubLogin.cancel()}
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

          {githubError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{githubError}</p>
            </div>
          )}

          {/* Skills Backup */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--skills-backup">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">Skills Backup</div>
              <div className="connector-desc">
                {syncStatus?.enabled
                  ? syncStatus.failedCount > 0
                    ? 'Last sync failed.'
                    : syncStatus.lastSynced
                      ? <>
                          <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                            {syncStatus.repoOwner}/gitsuite-skills
                          </a>
                          {' — '}Last synced {new Date(syncStatus.lastSynced).toLocaleString()}
                        </>
                      : <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                          {syncStatus.repoOwner}/gitsuite-skills
                        </a>
                  : 'Back up your skills to GitHub'}
              </div>
            </div>
            <div className="connector-actions">
              {syncStatus?.enabled ? (
                syncStatus.failedCount > 0 ? (
                  <>
                    <button className="settings-btn" onClick={handleSyncRetry}>Retry</button>
                    <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                  </>
                ) : (
                  <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                )
              ) : syncConnecting ? (
                <span className="connector-status-text">Connecting…</span>
              ) : (
                <button
                  className="settings-btn"
                  onClick={handleSyncConnectClick}
                  disabled={!githubUsername}
                  title={!githubUsername ? 'Log in to GitHub first' : undefined}
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {syncError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{syncError}</p>
            </div>
          )}

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

          {claudeDisconnectError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{claudeDisconnectError}</p>
            </div>
          )}

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
                <div className="settings-setup-line muted">Waiting for browser login…</div>
              </div>
            </div>
          )}
          {loginPhase === 'error' && (
            <div className="connector-row connector-row--log">
              <div className="settings-setup-log" style={{ width: '100%' }}>
                {loginLines.map((line, i) => <div key={i} className={`settings-setup-line${i === loginLines.length - 1 ? ' error' : ''}`}>{line}</div>)}
                <div className="settings-inline-row" style={{ marginTop: 8 }}>
                  <button className="settings-btn" onClick={() => { setLoginPhase('idle'); setLoginLines([]) }}>Try again</button>
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
                  disabled={connectorStatus[c.id] === 'checking'}
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

  const renderClaudeOpenCode = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Claude Code</div>
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

      <div className="settings-group">
        <div className="settings-group-title">OpenCode</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Install status</div>
              <div className="settings-group-row-sub">
                <span className={`status-dot ${opencodeInstalled ? 'active' : 'inactive'}`} />
                {opencodeInstalled === null ? 'Checking…' : opencodeInstalled ? 'Installed' : 'Not installed'}
              </div>
            </div>
            {opencodeInstalled === false && (
              <button
                className="settings-btn"
                disabled={opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking'}
                onClick={handleOpencodeSetup}
              >
                {opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking' ? 'Installing…' : 'Install OpenCode'}
              </button>
            )}
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Authentication</div>
              <div className="settings-group-row-sub">
                <span className={`status-dot ${opencodeLoggedIn ? 'active' : 'inactive'}`} />
                {opencodeLoggedIn === null ? 'Checking…' : opencodeLoggedIn ? 'Logged in' : 'Not logged in'}
              </div>
            </div>
            {opencodeInstalled && opencodeLoggedIn === false && (
              <button
                className="settings-btn"
                disabled={opencodeLoginPhase === 'logging-in'}
                onClick={handleOpencodeLogin}
              >
                {opencodeLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login to OpenCode'}
              </button>
            )}
            {opencodeInstalled && opencodeLoggedIn === true && (
              <button className="settings-btn settings-btn--link" onClick={handleOpencodeLogout}>
                Logout
              </button>
            )}
          </div>

          {(opencodeSetupLines.length > 0 || opencodeLoginLines.length > 0) && (
            <div className="settings-group-row settings-group-row--full">
              <div className="settings-setup-log" style={{ width: '100%' }}>
                {[...opencodeSetupLines, ...opencodeLoginLines].map((line, i) => (
                  <div key={i} className="settings-setup-line">{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
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

      <div className="settings-group">
        <div className="settings-group-title">Images</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Invert dark images</div>
              <div className="settings-group-row-sub">
                Automatically inverts logos and banners with dark content so they&rsquo;re readable on dark backgrounds.
              </div>
            </div>
            <input
              type="checkbox"
              checked={invertDarkImages}
              onChange={(e) => setInvertDarkImages(e.target.checked)}
              aria-label="Invert dark images"
            />
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

  const renderUpdates = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Update Checks</div>
        <div className="settings-group-body">

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Auto-update</div>
              {autoUpdateEnabled && (
                <div className="settings-group-row-sub settings-hint-warn">
                  Auto-update for learned repos consumes Claude API credits automatically.
                </div>
              )}
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autoUpdateEnabled}
                onChange={e => handleAutoUpdateToggle(e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Check every (hours)</div>
            </div>
            <input
              type="number"
              className="settings-input-number"
              min={1}
              max={168}
              value={intervalDraft}
              onChange={e => setIntervalDraft(e.target.value)}
              onBlur={() => handleIntervalChange(parseInt(intervalDraft, 10) || 24)}
            />
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Last checked</div>
              <div className="settings-group-row-sub">
                {lastCheckedTs
                  ? (() => {
                      const diff = Math.floor((Date.now() / 1000 - lastCheckedTs) / 60)
                      if (diff < 1) return 'Just now'
                      if (diff < 60) return `${diff} minute${diff !== 1 ? 's' : ''} ago`
                      const h = Math.floor(diff / 60)
                      return `${h} hour${h !== 1 ? 's' : ''} ago`
                    })()
                  : 'Never'}
              </div>
            </div>
            <button
              className="settings-btn"
              onClick={handleCheckNow}
              disabled={updateChecking}
            >
              {updateChecking ? 'Checking…' : 'Check now'}
            </button>
          </div>

        </div>
      </div>
    </>
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
          {activeCategory === 'providers' && renderProviders()}
          {activeCategory === 'claude-opencode' && renderClaudeOpenCode()}
          {activeCategory === 'appearance' && renderAppearance()}
          {activeCategory === 'language' && renderLanguage()}
          {activeCategory === 'downloads' && renderDownloads()}
          {activeCategory === 'projects' && renderProjects()}
          {activeCategory === 'connectors' && renderConnectors()}
          {activeCategory === 'updates' && renderUpdates()}
        </div>
      </main>
    </div>
  )
}
