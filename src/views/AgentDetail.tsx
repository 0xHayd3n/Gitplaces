import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import { useToast } from '../contexts/Toast'
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
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Load agent + folders
  useEffect(() => {
    if (!id) return
    let cancelled = false
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
      // Auto-enter edit mode when opening an empty agent (just-created)
      setEditing(a !== null && a.body === '')
    })()
    return () => { cancelled = true }
  }, [id])

  const editingRef = useRef(false)
  const nameEditingRef = useRef(false)
  useEffect(() => { editingRef.current = editing }, [editing])
  useEffect(() => { nameEditingRef.current = nameEditing }, [nameEditing])

  // Autofocus textarea whenever edit mode becomes active
  useEffect(() => {
    if (editing) bodyRef.current?.focus()
  }, [editing])

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
    return <div className="agent-detail-loading">Loading…</div>
  }

  const bodyChars = (editing ? bodyDraft : agent.body).length

  return (
    <div className="agent-detail">
      <header className="agent-detail-header">
        <button
          type="button"
          className="agent-detail-back"
          onClick={() => navigate('/library')}
          aria-label="Back"
          title="Back to Library"
        >
          ←
        </button>
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
            onClick={() => setNameEditing(true)}
            title="Click to rename"
          >
            {nameDraft || agent.name}
          </h2>
        )}
        <button
          type="button"
          className="agent-detail-action"
          onClick={handleDuplicate}
          aria-label="Duplicate"
        >
          Duplicate
        </button>
        <button
          type="button"
          className="agent-detail-action agent-detail-action--danger"
          onClick={handleDelete}
          aria-label="Delete"
        >
          Delete
        </button>
        <button
          type="button"
          className="agent-detail-action agent-detail-action--primary"
          onClick={() => setEditing(e => !e)}
          aria-label={editing ? 'Preview' : 'Edit'}
        >
          {editing ? 'Preview' : 'Edit'}
        </button>
      </header>

      <div className="agent-detail-meta">
        <div className="agent-detail-folder-wrap">
          <button
            type="button"
            className="agent-detail-folder-button"
            onClick={() => setFolderMenuOpen(o => !o)}
            aria-label="Folder"
            aria-haspopup="true"
            aria-expanded={folderMenuOpen}
          >
            Folder: {currentFolderName} ▾
          </button>
          {folderMenuOpen && (
            <ul role="menu" className="agent-detail-folder-menu">
              <li>
                <button role="menuitem" type="button" onClick={() => handleFolderPick(null)}>
                  Unfiled
                </button>
              </li>
              {folders.map(f => (
                <li key={f.id}>
                  <button role="menuitem" type="button" onClick={() => handleFolderPick(f.id)}>
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span>Updated {new Date(agent.updated_at).toLocaleString()}</span>
        <span>· {bodyChars} chars</span>
      </div>

      <div className="agent-detail-body">
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
      </div>

      <footer className="agent-detail-footer">
        <button type="button" className="agent-detail-action" onClick={handleCopy}>
          Copy markdown
        </button>
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
