import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import { useToast } from '../contexts/Toast'

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
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load agent + folders
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setEditing(false)
    setNameEditing(false)
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
    })()
    return () => { cancelled = true }
  }, [id])

  const editingRef = useRef(false)
  const nameEditingRef = useRef(false)
  useEffect(() => { editingRef.current = editing }, [editing])
  useEffect(() => { nameEditingRef.current = nameEditing }, [nameEditing])

  // Listen for external changes
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

  const handleCopy = async () => {
    if (!agent) return
    const content = editing ? bodyDraft : agent.body
    await navigator.clipboard.writeText(content)
    toast('Copied to clipboard', 'success')
  }

  const handleFolderPick = async (folderId: string | null) => {
    if (!id) return
    setFolderMenuOpen(false)
    const updated = await window.api.agents.update(id, { folderId })
    setAgent(updated)
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

  if (!agent) {
    return <div style={{ padding: 24, color: 'var(--t3)' }}>Loading…</div>
  }

  return (
    <div className="agent-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={() => navigate('/library')} aria-label="Back">←</button>
        {nameEditing ? (
          <input
            value={nameDraft}
            onChange={e => { setNameDraft(e.target.value); scheduleSaveName(e.target.value) }}
            onBlur={() => setNameEditing(false)}
            onKeyDown={e => { if (e.key === 'Enter') setNameEditing(false) }}
            autoFocus
            style={{ flex: 1, font: 'inherit' }}
          />
        ) : (
          <h2 style={{ flex: 1, margin: 0, cursor: 'text' }} onClick={() => setNameEditing(true)}>
            {nameDraft || agent.name}
          </h2>
        )}
        <button type="button" onClick={handleDuplicate} aria-label="Duplicate">Duplicate</button>
        <button type="button" onClick={handleDelete} aria-label="Delete">Delete</button>
        <button type="button" onClick={() => setEditing(e => !e)} aria-label={editing ? 'Preview' : 'Edit'}>
          {editing ? 'Preview' : 'Edit'}
        </button>
      </header>

      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--t3)' }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="Folder"
            onClick={() => setFolderMenuOpen(o => !o)}
          >
            Folder: {currentFolderName} ▾
          </button>
          {folderMenuOpen && (
            <ul role="menu" style={{ position: 'absolute', background: 'var(--bg2)', border: '1px solid var(--border)', listStyle: 'none', padding: 4, margin: 0, zIndex: 10 }}>
              <li>
                <button role="menuitem" type="button" onClick={() => handleFolderPick(null)}>Unfiled</button>
              </li>
              {folders.map(f => (
                <li key={f.id}>
                  <button role="menuitem" type="button" onClick={() => handleFolderPick(f.id)}>{f.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span>Updated {new Date(agent.updated_at).toLocaleString()}</span>
        <span>· {(editing ? bodyDraft : agent.body).length} chars</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {editing ? (
          <textarea
            aria-label="Body"
            value={bodyDraft}
            onChange={e => { setBodyDraft(e.target.value); scheduleSaveBody(e.target.value) }}
            style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
          />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.body}</ReactMarkdown>
        )}
      </div>

      <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
        <button type="button" onClick={handleCopy}>Copy markdown</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          {saveStatus === 'saving' && 'saving…'}
          {saveStatus === 'saved' && 'saved ✓'}
        </span>
      </footer>
    </div>
  )
}
