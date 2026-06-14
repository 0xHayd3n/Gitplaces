import { useState, useEffect, useRef } from 'react'
import type { LibrarySavedRepo } from '../types/repo'
import LangBadge from './LangBadge'

interface NewCollectionModalProps {
  libraryRows: LibrarySavedRepo[]
  onClose: () => void
  onCreate: (id: string) => void
}

export default function NewCollectionModal({
  libraryRows,
  onClose,
  onCreate,
}: NewCollectionModalProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [repoSearch, setRepoSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const filtered = libraryRows.filter(r =>
    `${r.owner}/${r.name}`.toLowerCase().includes(repoSearch.toLowerCase())
  )

  function toggleRepo(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    try {
      const id = await window.api.collection.create(name.trim(), desc.trim(), [...selected])
      onCreate(id)
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        aria-labelledby="new-collection-title"
      >
        <div className="coll-modal-title" id="new-collection-title">New collection</div>

        <div className="coll-modal-label">Name</div>
        <input
          className="coll-modal-input"
          placeholder="e.g. My API Stack"
          maxLength={40}
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />

        <div className="coll-modal-label">Description</div>
        <textarea
          className="coll-modal-textarea"
          placeholder="Optional"
          rows={3}
          value={desc}
          onChange={e => setDesc(e.target.value)}
        />

        <div className="coll-modal-label">Add skills from your library</div>
        <input
          className="coll-modal-input"
          placeholder="Search installed repos…"
          value={repoSearch}
          onChange={e => setRepoSearch(e.target.value)}
        />

        <div className="coll-modal-repo-list">
          {filtered.length === 0 && (
            <div style={{ padding: '12px', fontSize: 11, color: 'var(--t3)' }}>
              No installed repos found
            </div>
          )}
          {filtered.map(r => {
            const id = String(r.hostNativeId)
            return (
              <div
                key={id}
                className={`coll-modal-repo-row${selected.has(id) ? ' checked' : ''}`}
                onClick={() => toggleRepo(id)}
              >
                <LangBadge lang={r.language} size={18} />
                <span className="coll-modal-repo-name">{r.owner}/{r.name}</span>
                <div className={`coll-modal-repo-check${selected.has(id) ? ' checked' : ''}`}>
                  {selected.has(id) && '✓'}
                </div>
              </div>
            )
          })}
        </div>

        <div className="coll-modal-actions">
          <button className="coll-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="coll-modal-create"
            disabled={!name.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create collection'}
          </button>
        </div>
      </div>
    </div>
  )
}
