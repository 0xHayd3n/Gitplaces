import { useState, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import SectionBlock from './shared/SectionBlock'
import ProviderCard from './shared/ProviderCard'
import IconAnthropic from '~icons/simple-icons/anthropic'
import IconOpenAI from '~icons/simple-icons/openai'
import IconGemini from '~icons/simple-icons/googlegemini'
import IconOllama from '~icons/simple-icons/ollama'

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

      <SectionBlock title="CLI" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>CLI providers coming in Task 7.</div>
      </SectionBlock>

      <SectionBlock title="MCP" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>MCP exposure coming in Task 8.</div>
      </SectionBlock>

      <SectionBlock title="Custom MCP" badge="BETA" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Custom MCP coming in Task 9.</div>
      </SectionBlock>

      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
    </>
  )
}
