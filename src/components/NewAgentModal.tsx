import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentFolderRow } from '../types/agent'

interface Props {
  folders: AgentFolderRow[]
  onClose: () => void
  onCreated: (newId: string) => void
}

function deriveName(body: string): string {
  for (const line of body.split('\n')) {
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1) return h1[1].trim().slice(0, 200)
  }
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed.slice(0, 60)
  }
  return ''
}

export default function NewAgentModal({ folders, onClose, onCreated }: Props) {
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [localFolders, setLocalFolders] = useState<AgentFolderRow[]>(folders)

  const overlayRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { taRef.current?.focus() }, [])

  useEffect(() => {
    if (!nameTouched) setName(deriveName(body))
  }, [body, nameTouched])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (creatingFolder) folderInputRef.current?.focus()
  }, [creatingFolder])

  const handleCreate = useCallback(async () => {
    if (body.length === 0) return
    setCreating(true)
    try {
      const row = await window.api.agents.create({
        name: name.trim() || 'Untitled agent',
        body,
        folderId,
      })
      onCreated(row.id)
    } finally {
      setCreating(false)
    }
  }, [body, name, folderId, onCreated])

  const handleFolderCreate = useCallback(async () => {
    const trimmed = newFolderName.trim()
    if (!trimmed) {
      setCreatingFolder(false)
      return
    }
    const f = await window.api.agents.createFolder(trimmed)
    setLocalFolders(prev => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)))
    setFolderId(f.id)
    setCreatingFolder(false)
    setNewFolderName('')
  }, [newFolderName])

  return (
    <div
      className="coll-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="coll-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-agent-title"
      >
        <div className="coll-modal-title" id="new-agent-title">New agent</div>

        <div className="coll-modal-label">Folder</div>
        {!creatingFolder ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="coll-modal-input"
              value={folderId ?? ''}
              onChange={e => setFolderId(e.target.value === '' ? null : e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">Unfiled</option>
              {localFolders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="coll-modal-cancel"
              onClick={() => setCreatingFolder(true)}
            >
              + New folder
            </button>
          </div>
        ) : (
          <input
            ref={folderInputRef}
            className="coll-modal-input"
            placeholder="Folder name"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleFolderCreate() }}
            onBlur={handleFolderCreate}
            maxLength={200}
          />
        )}

        <div className="coll-modal-label">Name</div>
        <input
          className="coll-modal-input"
          aria-label="Name"
          maxLength={200}
          value={name}
          onChange={e => { setName(e.target.value); setNameTouched(true) }}
        />

        <div className="coll-modal-label">Body</div>
        <textarea
          ref={taRef}
          className="coll-modal-textarea"
          placeholder="Paste your markdown here…"
          rows={12}
          value={body}
          onChange={e => setBody(e.target.value)}
          style={{ fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
        />

        <div className="coll-modal-actions">
          <button className="coll-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="coll-modal-create"
            disabled={body.length === 0 || creating}
            onClick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
