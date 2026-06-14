import { useState, useEffect } from 'react'
import type { SavedRepo } from '../types/repo'
import { HOST_ID_GITHUB } from '../lib/hostIds'

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

function rowToForkData(row: SavedRepo): ForkRepoData {
  return {
    owner: row.owner,
    name: row.name,
    description: row.description,
    language: row.language,
    stars: row.stars,
    forks: row.forks,
    avatarUrl: row.ownerAvatarUrl || `https://github.com/${row.owner}.png?size=200`,
  }
}

// Single-repo variant. Shares the same module-level cache as useForkData so a
// repo fetched for a fork pair is reused when the same repo appears in a star
// event (and vice versa).
export function useRepoData(
  fullName: string
): { repo: ForkRepoData | null; loading: boolean } {
  const [repo, setRepo] = useState<ForkRepoData | null>(cache.get(fullName) ?? null)
  const [loading, setLoading] = useState(!cache.has(fullName))

  useEffect(() => {
    if (cache.has(fullName)) {
      setRepo(cache.get(fullName) ?? null)
      setLoading(false)
      return
    }
    const [owner, name] = fullName.split('/')
    window.api.repo.get(HOST_ID_GITHUB, owner, name)
      .then(row => {
        const data = row ? rowToForkData(row) : null
        cache.set(fullName, data)
        setRepo(data)
      })
      .catch(() => {
        cache.set(fullName, null)
        setRepo(null)
      })
      .finally(() => setLoading(false))
  }, [fullName])

  return { repo, loading }
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
        window.api.repo.get(HOST_ID_GITHUB, owner, name)
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
        window.api.repo.get(HOST_ID_GITHUB, owner, name)
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
