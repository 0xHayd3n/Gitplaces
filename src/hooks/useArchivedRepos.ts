import { useState, useEffect, useCallback, useRef } from 'react'

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
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setArchivedSet(next)
    window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
  }, [])

  return { archivedSet, loading, toggle }
}
