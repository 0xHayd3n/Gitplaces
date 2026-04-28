import { useState, useEffect, useCallback } from 'react'
import type { CollectionRow } from '../types/repo'
import NewCollectionModal from './NewCollectionModal'
import { useToast } from '../contexts/Toast'

interface CollectionsSidebarProps {
  selectedId: string | null
  onSelect: (id: string, coll: CollectionRow) => void
}

export default function CollectionsSidebar({ selectedId, onSelect }: CollectionsSidebarProps) {
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [showModal, setShowModal] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    const colls = await window.api.collection.getAll()
    setCollections(colls)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(newId: string) {
    setShowModal(false)
    const updated = await window.api.collection.getAll()
    setCollections(updated)
    toast('Collection created', 'success')
    const newColl = updated.find(c => c.id === newId)
    if (newColl) onSelect(newId, newColl)
  }

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar-header">COLLECTIONS</div>
      <div className="library-sidebar-list">
        {collections.length === 0 && (
          <div className="library-sidebar-empty">No collections</div>
        )}
        {collections.map(coll => (
          <button
            key={coll.id}
            type="button"
            data-collection-id={coll.id}
            className={`library-sidebar-item installed${selectedId === coll.id ? ' selected' : ''}`}
            onClick={() => onSelect(coll.id, coll)}
            title={coll.name}
          >
            <span
              className="library-sidebar-avatar"
              style={{ background: `linear-gradient(135deg, ${coll.color_start ?? 'var(--bg3)'}, ${coll.color_end ?? 'var(--bg4)'})` }}
            />
            <span className="library-sidebar-name">{coll.name}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '8px', flexShrink: 0 }}>
        <button
          type="button"
          className="library-sidebar-seg"
          style={{ width: '100%' }}
          onClick={() => setShowModal(true)}
        >
          + New collection
        </button>
      </div>

      {showModal && (
        <NewCollectionModal
          libraryRows={[]}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </aside>
  )
}
