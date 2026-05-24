import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Pin, Folder, FileText, Clock } from 'lucide-react'
import type { AgentRow, AgentFolderRow, AgentRevision, AgentPreset } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import { useToast } from '../contexts/Toast'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'
import { detectVariables } from '../utils/agentVariables'
import { AGENT_SCOPE, formatScopedHandle } from '../utils/agentScope'
import { isValidHandle } from '../utils/agentSlug'
import AgentVariablePresetBar from '../components/AgentVariablePresetBar'
import AgentHistoryTimeline from '../components/AgentHistoryTimeline'
import AgentSwatchPopover from '../components/AgentSwatchPopover'
import './AgentDetail.css'

type SaveStatus = 'idle' | 'saving' | 'saved'

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [agent, setAgent] = useState<AgentRow | null>(null)
  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [editing, setEditing] = useState(false)
  const [bodyDraft, setBodyDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [nameEditing, setNameEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [activeTab, setActiveTab] = useState<'prompt' | 'preview' | 'mcp' | 'history'>('prompt')
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<AgentRevision[]>([])
  const [revisionsLoaded, setRevisionsLoaded] = useState(false)
  const [takenHandles, setTakenHandles] = useState<string[]>([])

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setNameEditing(false)
    setActiveTab('prompt')
    setRevisions([])
    setRevisionsLoaded(false)
    if (bodyTimer.current) { clearTimeout(bodyTimer.current); bodyTimer.current = null }
    if (nameTimer.current) { clearTimeout(nameTimer.current); nameTimer.current = null }
    ;(async () => {
      const { folders, agents } = await window.api.agents.getAll()
      if (cancelled) return
      setFolders(folders)
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      setBodyDraft(a?.body ?? '')
      setNameDraft(a?.name ?? '')
      setEditing(a !== null && a.body === '')
      setTakenHandles(agents.filter(x => x.id !== id).map(x => x.handle))
    })()
    return () => { cancelled = true }
  }, [id])

  const presets = useMemo(
    () => (agent ? parseAgentPresets(agent.presets_json) : []),
    [agent],
  )

  // When the agent loads or its preset list changes, default the active preset
  // to the first one (or null if none).
  useEffect(() => {
    if (!agent) { setActivePresetId(null); return }
    setActivePresetId(prev => {
      if (prev && presets.some(p => p.id === prev)) return prev
      return presets[0]?.id ?? null
    })
  }, [agent, presets])

  // Fetch revisions when the History tab becomes active (lazy load — most
  // sessions never open History).
  useEffect(() => {
    if (activeTab !== 'history' || !id) return
    let cancelled = false
    setRevisionsLoaded(false)
    ;(async () => {
      const list = await window.api.agents.revisions.list(id)
      if (cancelled) return
      setRevisions(list)
      setRevisionsLoaded(true)
    })()
    return () => { cancelled = true }
  }, [activeTab, id])

  // Live updates: subscribe to 'agents:revision-added' and prepend matching
  // revisions to the timeline.
  useEffect(() => {
    if (!id) return
    const cb = (rev: AgentRevision) => {
      if (rev.agent_id !== id) return
      setRevisions(prev => [rev, ...prev])
    }
    window.api.agents.onRevisionAdded(cb)
    return () => window.api.agents.offRevisionAdded(cb)
  }, [id])

  const editingRef = useRef(false)
  const nameEditingRef = useRef(false)
  useEffect(() => { editingRef.current = editing }, [editing])
  useEffect(() => { nameEditingRef.current = nameEditing }, [nameEditing])

  useEffect(() => { if (editing) bodyRef.current?.focus() }, [editing])

  useEffect(() => {
    if (!id) return
    const cb = async () => {
      const { agents } = await window.api.agents.getAll()
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      if (!editingRef.current) setBodyDraft(a?.body ?? '')
      if (!nameEditingRef.current) setNameDraft(a?.name ?? '')
    }
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [id])

  const scheduleSaveBody = useCallback((value: string) => {
    if (!id) return
    setSaveStatus('saving')
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(async () => {
      try {
        await window.api.agents.update(id, { body: value })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
  }, [id])

  const scheduleSaveName = useCallback((value: string) => {
    if (!id) return
    if (nameTimer.current) clearTimeout(nameTimer.current)
    nameTimer.current = setTimeout(async () => {
      await window.api.agents.update(id, { name: value })
    }, 1500)
  }, [id])

  useEffect(() => () => {
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    if (nameTimer.current) clearTimeout(nameTimer.current)
  }, [])

  const currentFolderName = useMemo(() => {
    if (!agent || agent.folder_id === null) return 'Unfiled'
    return folders.find(f => f.id === agent.folder_id)?.name ?? 'Unfiled'
  }, [agent, folders])

  const liveBody = editing ? bodyDraft : (agent?.body ?? '')
  const description = useMemo(() => deriveDescription(liveBody), [liveBody])
  const bodyChars = liveBody.length

  const variables = useMemo(() => detectVariables(liveBody), [liveBody])
  const activePreset = useMemo(
    () => (activePresetId ? presets.find(p => p.id === activePresetId) ?? null : null),
    [presets, activePresetId],
  )

  const handleCopy = async () => {
    if (!agent) return
    const payload = buildPersonaPayload({
      handle: agent.handle,
      description,
      body: liveBody,
      presetSlug: activePreset?.slug ?? null,
      presetValues: activePreset?.values,
    })
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      toast('Copy failed', 'error')
      return
    }
    toast(`Copied @${agent.handle}${activePreset ? `/${activePreset.slug}` : ''}`, 'success')
    try {
      await window.api.agents.recordUse(agent.id, activePreset?.id ?? null)
    } catch {
      // Non-fatal; the copy already succeeded.
    }
  }

  const handleDelete = async () => {
    if (!id) return
    if (!confirm('Delete this agent? This cannot be undone.')) return
    await window.api.agents.delete(id)
    navigate('/library')
  }

  const handleDuplicate = async () => {
    if (!id) return
    const dup = await window.api.agents.duplicate(id)
    navigate(`/library/agent/${dup.id}`)
  }

  const handlePinToggle = async () => {
    if (!agent) return
    await window.api.agents.update(agent.id, { pinned: agent.pinned !== 1 })
  }

  const handleRestore = async (revisionId: string) => {
    if (!id) return
    if (!confirm('Restore this revision? Current body and presets will be replaced.')) return
    await window.api.agents.revisions.revert(id, revisionId)
    // The 'agents:changed' broadcast will refresh `agent`; the
    // 'agents:revision-added' broadcast will prepend the new revert snapshot.
  }

  if (!agent) return <div className="agent-detail-loading">Loading…</div>

  return (
    <div className="agent-detail">
      <header
        className="agent-detail-hero"
        style={{ ['--agent-color' as any]: agent.color_start ?? 'var(--accent)' }}
      >
        <AgentSwatchPopover agent={agent} />
        <div className="agent-detail-id-block">
          {nameEditing ? (
            <input
              className="agent-detail-title-input"
              aria-label="Name"
              value={nameDraft}
              onChange={e => { setNameDraft(e.target.value); scheduleSaveName(e.target.value) }}
              onBlur={() => setNameEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter') setNameEditing(false) }}
              maxLength={200}
              autoFocus
            />
          ) : (
            <h2
              className="agent-detail-title"
              onDoubleClick={() => setNameEditing(true)}
              title="Double-click to rename"
            >
              {nameDraft || agent.name}
            </h2>
          )}
          <HandleRow
            handle={agent.handle}
            agentId={agent.id}
            takenHandles={takenHandles}
            onCopied={(text) => toast(`Copied ${text}`, 'success')}
          />
          <div className="agent-detail-meta">
            <span className="agent-detail-chip"><Folder size={11} /> {currentFolderName}</span>
            <span className="agent-detail-chip"><FileText size={11} /> {(bodyChars / 1024).toFixed(1)} kb</span>
            <span className="agent-detail-chip"><Clock size={11} /> Updated {new Date(agent.updated_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="agent-detail-actions">
          <button
            type="button"
            className={'agent-detail-pin-btn' + (agent.pinned === 1 ? ' agent-detail-pin-btn--on' : '')}
            onClick={handlePinToggle}
            aria-label={agent.pinned === 1 ? 'Unpin' : 'Pin'}
            title={agent.pinned === 1 ? 'Unpin' : 'Pin'}
          >
            <Pin size={18} />
          </button>
        </div>
      </header>

      <nav className="agent-detail-tabs" role="tablist">
        {(['prompt', 'preview', 'mcp', 'history'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className="agent-detail-tab"
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'prompt' ? 'Prompt'
              : tab === 'preview' ? 'Preview'
              : tab === 'mcp' ? 'MCP'
              : 'History'}
          </button>
        ))}
      </nav>

      <div className="agent-detail-body">
        {activeTab === 'prompt' && (
          <>
            {variables.length > 0 && (
              <AgentVariablePresetBar
                agent={agent}
                variables={variables}
                activePresetId={activePresetId}
                onActivePresetChange={setActivePresetId}
              />
            )}
            {editing ? (
              <textarea
                ref={bodyRef}
                className="agent-detail-textarea"
                aria-label="Body"
                placeholder="Paste your markdown here…"
                value={bodyDraft}
                onChange={e => { setBodyDraft(e.target.value); scheduleSaveBody(e.target.value) }}
              />
            ) : (
              <div className="agent-detail-rendered">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.body}</ReactMarkdown>
              </div>
            )}
          </>
        )}
        {activeTab === 'preview' && (
          <div className="agent-detail-tab-placeholder">
            The Preview tab will render the full clipboard payload in a future phase. For now, see the preview block on the Prompt tab.
          </div>
        )}
        {activeTab === 'mcp' && (
          <AgentMcpTab agent={agent} presets={presets} />
        )}
        {activeTab === 'history' && (
          revisionsLoaded ? (
            <AgentHistoryTimeline
              revisions={revisions}
              onRestore={handleRestore}
            />
          ) : (
            <div className="agent-detail-tab-placeholder">Loading history…</div>
          )
        )}
      </div>

      <footer className="agent-detail-footer">
        <span
          className={
            'agent-detail-save-status' +
            (saveStatus === 'saving' ? ' agent-detail-save-status--saving' : '') +
            (saveStatus === 'saved' ? ' agent-detail-save-status--saved' : '')
          }
        >
          {saveStatus === 'saving' && 'saving…'}
          {saveStatus === 'saved' && 'saved ✓'}
        </span>
      </footer>
    </div>
  )
}

function HandleRow({
  handle,
  agentId,
  takenHandles,
  onCopied,
}: {
  handle: string
  agentId: string
  takenHandles: readonly string[]
  onCopied: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(handle)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(handle); setError(null) }, [handle])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const scope = AGENT_SCOPE

  const commit = async () => {
    const trimmed = draft.trim()
    if (trimmed === handle) { setEditing(false); return }
    if (!isValidHandle(trimmed)) { setError('Invalid handle'); return }
    if (takenHandles.includes(trimmed)) { setError('Handle already in use'); return }
    try {
      await window.api.agents.update(agentId, { handle: trimmed })
      setEditing(false); setError(null)
    } catch {
      setError('Save failed')
    }
  }

  const cancel = () => { setDraft(handle); setEditing(false); setError(null) }

  const onCopy = async () => {
    const text = formatScopedHandle(handle)
    try {
      await navigator.clipboard.writeText(text)
      onCopied(text)
    } catch {
      // toast handled by parent on failure path if needed
    }
  }

  return (
    <div className="agent-detail-handle-row">
      <span className="agent-detail-handle-at">@</span>
      <span className="agent-detail-handle-scope">{scope}/</span>
      {editing ? (
        <input
          ref={inputRef}
          className={'agent-detail-handle-input' + (error ? ' agent-detail-handle-input--error' : '')}
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null) }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          aria-label="Handle"
          title={error ?? ''}
          maxLength={64}
          size={Math.max(draft.length, 4)}
        />
      ) : (
        <span
          className="agent-detail-handle"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit"
        >
          {handle}
        </span>
      )}
      <button
        type="button"
        className="agent-detail-copy-handle"
        onClick={onCopy}
        aria-label={`Copy @${scope}/${handle}`}
        title={`Copy @${scope}/${handle}`}
      >
        <Copy size={13} />
      </button>
    </div>
  )
}

function AgentMcpTab({ agent, presets }: { agent: AgentRow; presets: AgentPreset[] }) {
  const { toast } = useToast()
  const [snippet, setSnippet] = useState<string | null>(null)
  useEffect(() => {
    window.api.agents.mcp.getConfigSnippet().then(setSnippet).catch(() => setSnippet(null))
  }, [])
  const copySnippet = async () => {
    if (!snippet) return
    try {
      await navigator.clipboard.writeText(snippet)
      toast('Copied MCP config', 'success')
    } catch {
      toast('Copy failed', 'error')
    }
  }
  return (
    <div className="agent-detail-mcp">
      <section className="agent-detail-mcp-section">
        <h3>Resources</h3>
        <p className="agent-detail-mcp-hint">
          Reference this agent from any MCP-capable client using these URIs:
        </p>
        <ul className="agent-detail-mcp-uris">
          <li><code>agent://{agent.handle}</code></li>
          {presets.map(p => (
            <li key={p.id}><code>agent://{agent.handle}/{p.slug}</code></li>
          ))}
        </ul>
      </section>
      <section className="agent-detail-mcp-section">
        <h3>Client configuration</h3>
        <p className="agent-detail-mcp-hint">
          Paste this snippet into your MCP client's config (e.g.{' '}
          <code>~/.claude/settings.json</code>):
        </p>
        <pre className="agent-detail-mcp-snippet">{snippet ?? 'Loading…'}</pre>
        <button
          type="button"
          className="agent-detail-action"
          onClick={copySnippet}
          disabled={!snippet}
        >
          Copy MCP config
        </button>
      </section>
    </div>
  )
}
