import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import type { CollectionRow, CollectionRepoRow, LibrarySavedRepo } from '../types/repo'
import { useToast } from '../contexts/Toast'
import CollDetail from '../components/CollDetail'
import { HOST_ID_GITHUB } from '../lib/hostIds'

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [coll, setColl] = useState<CollectionRow | null>((location.state as any)?.coll ?? null)
  const [detail, setDetail] = useState<CollectionRepoRow[]>([])
  const [libraryRows, setLibraryRows] = useState<LibrarySavedRepo[]>([])
  const [installing, setInstalling] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.library.getAll().then(setLibraryRows).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id) return
    const stateCol = (location.state as any)?.coll as CollectionRow | undefined
    if (!stateCol) {
      window.api.collection.getAll().then(colls => {
        setColl(colls.find(c => c.id === id) ?? null)
      }).catch(() => {})
    }
    window.api.collection.getDetail(id).then(setDetail).catch(() => {})
  }, [id, location.state])

  async function handleToggle() {
    if (!coll || !id) return
    const newActive = coll.active === 1 ? 0 : 1
    await window.api.collection.toggle(id, newActive)
    setColl(prev => prev ? { ...prev, active: newActive } : prev)
  }

  async function handleDelete() {
    if (!id) return
    await window.api.collection.delete(id)
    toast('Collection deleted', 'success')
    navigate('/library')
  }

  async function handleInstall(owner: string, name: string) {
    if (!id) return
    const key = `${owner}/${name}`
    setInstalling(prev => new Set(prev).add(key))
    try {
      await window.api.repo.save(HOST_ID_GITHUB, owner, name)
      await window.api.skill.generate(owner, name, { flavour: 'library' })
      const rows = await window.api.collection.getDetail(id)
      setDetail(rows)
      toast(`${name} installed`, 'success')
    } catch {
      toast(`Failed to install ${name}`, 'error')
    } finally {
      setInstalling(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  async function handleInstallAll() {
    if (!id) return
    const missing = detail.filter(r => r.saved === 0)
    await Promise.all(
      missing.map(async r => {
        const key = `${r.owner}/${r.name}`
        setInstalling(prev => new Set(prev).add(key))
        try {
          await window.api.repo.save(HOST_ID_GITHUB, r.owner, r.name)
          await window.api.skill.generate(r.owner, r.name, { flavour: 'library' })
        } catch {
          // individual failure — continue
        } finally {
          setInstalling(prev => { const s = new Set(prev); s.delete(key); return s })
        }
      })
    )
    const rows = await window.api.collection.getDetail(id)
    setDetail(rows)
    toast('All missing skills installed', 'success')
  }

  if (!coll) return null

  return (
    <CollDetail
      coll={coll}
      repos={detail}
      onToggle={handleToggle}
      onDelete={handleDelete}
      onInstall={handleInstall}
      onInstallAll={handleInstallAll}
      installing={installing}
    />
  )
}
