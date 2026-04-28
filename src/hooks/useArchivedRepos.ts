import { useState, useEffect, useCallback } from 'react'

const SETTINGS_KEY = 'archived_repos'

export function useArchivedRepos() {
  const [archivedSet, setArchivedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

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
    setArchivedSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      window.api.settings.set(SETTINGS_KEY, JSON.stringify([...next])).catch(() => {})
      return next
    })
  }, [])

  return { archivedSet, loading, toggle }
}
