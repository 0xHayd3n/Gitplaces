import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CollectionRow, CollectionRepoRow, LibrarySavedRepo } from '../types/repo'
import { useSearch } from '../contexts/Search'
import { useToast } from '../contexts/Toast'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import CollRow from '../components/CollRow'
import CollDetail from '../components/CollDetail'
import NewCollectionModal from '../components/NewCollectionModal'

export default function Collections() {
  const [searchParams] = useSearchParams()
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('select'))
  const [showDetail, setShowDetail] = useState(false)
  const [detail, setDetail] = useState<CollectionRepoRow[]>([])
  const { query: search } = useSearch()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [libraryRows, setLibraryRows] = useState<LibrarySavedRepo[]>([])
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  const selected = collections.find(c => c.id === selectedId) ?? null

  const load = useCallback(async () => {
    const colls = await window.api.collection.getAll()
    setCollections(colls)
    setSelectedId(prev => prev ?? colls[0]?.id ?? null)
    setLoaded(true)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.api.library.getAll().then(rows => setLibraryRows(rows))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setDetail([])
    window.api.collection.getDetail(selectedId).then(rows => setDetail(rows))
  }, [selectedId])

  async function handleToggle(id: string, newActive: number) {
    await window.api.collection.toggle(id, newActive)
    setCollections(prev => prev.map(c => c.id === id ? { ...c, active: newActive } : c))
  }

  async function handleDelete(id: string) {
    await window.api.collection.delete(id)
    setCollections(prev => prev.filter(c => c.id !== id))
    setSelectedId(prev => prev === id ? null : prev)
    toast('Collection deleted', 'success')
  }

  async function handleInstall(owner: string, name: string) {
    const key = `${owner}/${name}`
    setInstalling(prev => new Set(prev).add(key))
    try {
      await window.api.github.saveRepo(owner, name)
      await window.api.skill.generate(owner, name, { flavour: 'library' })
      if (selectedId) {
        const rows = await window.api.collection.getDetail(selectedId)
        setDetail(rows)
      }
      await load()
      toast(`${name} installed`, 'success')
    } catch {
      toast(`Failed to install ${name}`, 'error')
    } finally {
      setInstalling(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  async function handleInstallAll() {
    const missing = detail.filter(r => r.saved === 0)
    await Promise.all(
      missing.map(async r => {
        const key = `${r.owner}/${r.name}`
        setInstalling(prev => new Set(prev).add(key))
        try {
          await window.api.github.saveRepo(r.owner, r.name)
          await window.api.skill.generate(r.owner, r.name, { flavour: 'library' })
        } catch {
          // individual install failure — continue with others
        } finally {
          setInstalling(prev => { const s = new Set(prev); s.delete(key); return s })
        }
      })
    )
    if (selectedId) {
      const rows = await window.api.collection.getDetail(selectedId)
      setDetail(rows)
    }
    await load()
    toast('All missing skills installed', 'success')
  }

  async function handleCreate(newId: string) {
    setShowModal(false)
    await load()
    setSelectedId(newId)
    toast('Collection created', 'success')
  }

  const mine = collections.filter(c => c.owner === 'user')
  const community = collections.filter(c => c.owner !== 'user')
  const filterFn = (c: CollectionRow) =>
    c.name.toLowerCase().includes(search.toLowerCase())

  const allFiltered = [...mine.filter(filterFn), ...community.filter(filterFn)]

  const kbNav = useKeyboardNav({
    itemCount: allFiltered.length,
    onFocusChange: (idx) => {
      if (allFiltered[idx]) { setSelectedId(allFiltered[idx].id); setShowDetail(true) }
    },
    onSelect: (idx) => {
      if (allFiltered[idx]) { setSelectedId(allFiltered[idx].id); setShowDetail(true) }
    },
  })

  if (loaded && collections.length === 0) {
    return (
      <div className="collections-root">
        <div className="coll-empty-state">
          <div className="coll-empty-title">No collections yet</div>
          <div className="coll-empty-desc">Group your skills into collections for easy management</div>
          <button className="coll-new-btn" onClick={() => setShowModal(true)}>
            + New collection
          </button>
        </div>
        {showModal && (
          <NewCollectionModal
            libraryRows={libraryRows}
            onClose={() => setShowModal(false)}
            onCreate={handleCreate}
          />
        )}
      </div>
    )
  }

  return (
    <div className="collections-root">
      <div className="collections-topbar">
        <button className="coll-new-btn" onClick={() => setShowModal(true)}>
          + New collection
        </button>
      </div>

      <div className="collections-body">
        <div className={`collections-list${showDetail ? ' detail-active' : ''}`} onKeyDown={kbNav.containerProps.onKeyDown}>
          {mine.filter(filterFn).length > 0 && (
            <>
              <div className="coll-section-label">Mine</div>
              {mine.filter(filterFn).map(c => (
                <CollRow
                  key={c.id}
                  coll={c}
                  selected={c.id === selectedId}
                  onClick={() => { setSelectedId(c.id); setShowDetail(true) }}
                  onToggle={() => handleToggle(c.id, c.active === 1 ? 0 : 1)}
                />
              ))}
            </>
          )}
          {community.filter(filterFn).length > 0 && (
            <>
              <div className="coll-section-label">Community</div>
              {community.filter(filterFn).map(c => (
                <CollRow
                  key={c.id}
                  coll={c}
                  selected={c.id === selectedId}
                  onClick={() => { setSelectedId(c.id); setShowDetail(true) }}
                  onToggle={() => handleToggle(c.id, c.active === 1 ? 0 : 1)}
                />
              ))}
            </>
          )}
        </div>

        <div className={`collections-detail${showDetail ? ' detail-active' : ''}`}>
          <button className="responsive-back-btn" onClick={() => setShowDetail(false)}>← Back</button>
          {selected ? (
            <CollDetail
              coll={selected}
              repos={detail}
              onToggle={() => handleToggle(selected.id, selected.active === 1 ? 0 : 1)}
              onDelete={() => handleDelete(selected.id)}
              onInstall={handleInstall}
              onInstallAll={handleInstallAll}
              installing={installing}
            />
          ) : (
            <div className="coll-detail-empty">Select a collection</div>
          )}
        </div>
      </div>

      {showModal && (
        <NewCollectionModal
          libraryRows={libraryRows}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
