import { useState, useEffect } from 'react'
import type { LocalProject } from '../types/library'

// Module-level cache survives Library unmount/remount within a session, so
// navigating between /library and other tabs doesn't re-run the full project
// folder scan on the main process. The cache invalidates only when the user
// changes the projectsFolder setting.
let cachedProjects: LocalProject[] = []
let cachedFolder: string | null = null
let hasScanned = false

export function __resetLocalProjectsCache() {
  cachedProjects = []
  cachedFolder = null
  hasScanned = false
}

export function useLocalProjects(): LocalProject[] {
  const [projects, setProjects] = useState<LocalProject[]>(() => cachedProjects)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let folder: string | null = null
      try { folder = await window.api.settings.get('projectsFolder') } catch { return }

      if (hasScanned && folder === cachedFolder) {
        if (!cancelled) setProjects(cachedProjects)
        return
      }

      if (!folder) {
        cachedProjects = []
        cachedFolder = null
        hasScanned = true
        if (!cancelled) setProjects([])
        return
      }

      try {
        const result = await window.api.projects?.scanFolder(folder)
        if (!result) return
        cachedProjects = result
        cachedFolder = folder
        hasScanned = true
        if (!cancelled) setProjects(result)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  return projects
}
