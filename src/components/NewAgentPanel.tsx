import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentFolderRow } from '../types/agent'

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

export default function NewAgentPanel() {
  const navigate = useNavigate()

  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const taRef = useRef<HTMLTextAreaElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const folderCreatingRef = useRef(false)

  useEffect(() => { taRef.current?.focus() }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await window.api.agents.getAll()
      if (!cancelled) setFolders(data.folders)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!nameTouched) setName(deriveName(body))
  }, [body, nameTouched])

  useEffect(() => {
    if (creatingFolder) folderInputRef.current?.focus()
  }, [creatingFolder])

  const currentFolderName = useMemo(() => {
    if (folderId === null) return 'Unfiled'
    return folders.find(f => f.id === folderId)?.name ?? 'Unfiled'
  }, [folderId, folders])

  const handleCreate = useCallback(async () => {
    if (body.length === 0) return
    setCreating(true)
    try {
      const row = await window.api.agents.create({
        name: name.trim() || 'Untitled agent',
        body,
        folderId,
      })
      navigate(`/library/agent/${row.id}`)
    } catch {
      setCreating(false)
    }
  }, [body, name, folderId, navigate])

  const handleFolderCreate = useCallback(async () => {
    if (folderCreatingRef.current) return
    const trimmed = newFolderName.trim()
    if (!trimmed) {
      setCreatingFolder(false)
      return
    }
    folderCreatingRef.current = true
    try {
      const f = await window.api.agents.createFolder(trimmed)
      setFolders(prev => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)))
      setFolderId(f.id)
      setCreatingFolder(false)
      setNewFolderName('')
    } finally {
      folderCreatingRef.current = false
    }
  }, [newFolderName])

  const handleFolderPick = (id: string | null) => {
    setFolderId(id)
    setFolderMenuOpen(false)
  }

  return (
    <div className="agent-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={() => navigate('/library')} aria-label="Back">←</button>
        <input
          aria-label="Name"
          value={name}
          onChange={e => { setName(e.target.value); setNameTouched(e.target.value !== '') }}
          placeholder="Name (auto-derived from first H1)"
          maxLength={200}
          style={{ flex: 1, font: 'inherit' }}
        />
      </header>

      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--t3)' }}>
        <div style={{ position: 'relative' }}>
          {!creatingFolder ? (
            <>
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
                  <li>
                    <button role="menuitem" type="button" onClick={() => { setFolderMenuOpen(false); setCreatingFolder(true) }}>+ New folder…</button>
                  </li>
                </ul>
              )}
            </>
          ) : (
            <input
              ref={folderInputRef}
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleFolderCreate() }}
              onBlur={handleFolderCreate}
              maxLength={200}
            />
          )}
        </div>
        <span>· {body.length} chars</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <textarea
          ref={taRef}
          aria-label="Body"
          placeholder="Paste your markdown here…"
          value={body}
          onChange={e => setBody(e.target.value)}
          style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
        />
      </div>

      <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          disabled={body.length === 0 || creating}
          onClick={handleCreate}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </footer>
    </div>
  )
}
