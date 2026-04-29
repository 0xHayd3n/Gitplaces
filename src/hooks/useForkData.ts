import { useState, useEffect } from 'react'
import type { RepoRow } from '../types/repo'

export interface ForkRepoData {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  avatarUrl: string
}

const cache = new Map<string, ForkRepoData | null>()

function rowToForkData(row: RepoRow): ForkRepoData {
  return {
    owner: row.owner,
    name: row.name,
    description: row.description,
    language: row.language,
    stars: row.stars,
    forks: row.forks,
    avatarUrl: row.avatar_url ?? `https://github.com/${row.owner}.png?size=200`,
  }
}

// Note: does not support changing originalFullName/forkFullName after mount.
// State is initialized from cache at first render only; re-mounting handles new inputs.
export function useForkData(
  originalFullName: string,
  forkFullName: string
): { original: ForkRepoData | null; fork: ForkRepoData | null; loading: boolean } {
  const bothCached = cache.has(originalFullName) && cache.has(forkFullName)

  const [original, setOriginal] = useState<ForkRepoData | null>(
    cache.get(originalFullName) ?? null
  )
  const [fork, setFork] = useState<ForkRepoData | null>(
    cache.get(forkFullName) ?? null
  )
  const [loading, setLoading] = useState(!bothCached)

  useEffect(() => {
    const fetches: Promise<void>[] = []

    if (!cache.has(originalFullName)) {
      const [owner, name] = originalFullName.split('/')
      fetches.push(
        window.api.github.getRepo(owner, name)
          .then(row => {
            const data = row ? rowToForkData(row) : null
            cache.set(originalFullName, data)
            setOriginal(data)
          })
          .catch(() => {
            cache.set(originalFullName, null)
            setOriginal(null)
          })
      )
    }

    if (!cache.has(forkFullName)) {
      const [owner, name] = forkFullName.split('/')
      fetches.push(
        window.api.github.getRepo(owner, name)
          .then(row => {
            const data = row ? rowToForkData(row) : null
            cache.set(forkFullName, data)
            setFork(data)
          })
          .catch(() => {
            cache.set(forkFullName, null)
            setFork(null)
          })
      )
    }

    if (fetches.length > 0) {
      Promise.allSettled(fetches).then(() => setLoading(false))
    }
  }, [originalFullName, forkFullName])

  return { original, fork, loading }
}
