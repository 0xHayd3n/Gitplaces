import { useState, useEffect, useCallback, useRef } from 'react'
import { HOST_ID_GITHUB } from '../lib/hostIds'

const SETTINGS_KEY = 'archived_repos'

export function useArchivedRepos() {
  const [archivedSet, setArchivedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const archivedSetRef = useRef<Set<string>>(archivedSet)
  archivedSetRef.current = archivedSet

  useEffect(() => {
    window.api.settings.get(SETTINGS_KEY)
      .then(raw => {
        try {
          const parsed = raw ? (JSON.parse(raw) as unknown) : []
          setArchivedSet(new Set(Array.isArray(parsed) ? (parsed as string[]) : []))
        } catch {
          setArchivedSet(new Set())
        }
      })
      .catch(() => setArchivedSet(new Set()))
      .finally(() => setLoading(false))
  }, [])

  const toggle = useCallback((owner: string, name: string) => {
    const key = `${owner}/${name}`
    const next = new Set(archivedSetRef.current)
    const archived = !next.has(key)
    if (archived) next.add(key); else next.delete(key)
    setArchivedSet(next)
    window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
    // Phase 3: the hook currently only services GitHub repos; once multi-host
    // lands the caller will need to thread hostId through. Defaulting here
    // matches the pre-migration behaviour byte-for-byte.
    window.api.repo.setArchivedAt(HOST_ID_GITHUB, owner, name, archived).catch(() => {})
  }, [])

  return { archivedSet, loading, toggle }
}
