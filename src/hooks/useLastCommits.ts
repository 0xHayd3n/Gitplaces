import { useCallback, useEffect, useRef, useState } from 'react'
import type { LastCommitInfo } from '../lib/fileTree/types'

interface UseLastCommitsInput {
  repoId: string | null
  owner: string
  name: string
  ref: string
}

interface PathSha {
  path: string
  sha: string
}

interface UseLastCommitsResult {
  get(path: string): LastCommitInfo | null | undefined
  request(rows: PathSha[]): void
}

export function useLastCommits(input: UseLastCommitsInput): UseLastCommitsResult {
  const [cache, setCache] = useState<Map<string, LastCommitInfo | null>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())

  // Reset when the repo/ref changes — the in-memory cache is keyed by path
  // alone, so a new ref means we have to fetch fresh data even for paths
  // that overlap.
  useEffect(() => {
    setCache(new Map())
    inFlight.current.clear()
  }, [input.repoId, input.owner, input.name, input.ref])

  const request = useCallback((rows: PathSha[]) => {
    if (!input.repoId) return
    // Drop paths we already know about (cached) or are currently fetching.
    const missing: PathSha[] = []
    for (const r of rows) {
      if (cache.has(r.path)) continue
      if (inFlight.current.has(r.path)) continue
      inFlight.current.add(r.path)
      missing.push(r)
    }
    if (missing.length === 0) return

    void window.api.github
      .getLastCommitsForPaths(input.repoId, input.owner, input.name, input.ref, missing)
      .then(result => {
        setCache(prev => {
          const next = new Map(prev)
          for (const r of missing) {
            next.set(r.path, result[r.path] ?? null)
          }
          return next
        })
      })
      .catch(() => {
        // Silent: rows render without commit info.
      })
      .finally(() => {
        for (const r of missing) inFlight.current.delete(r.path)
      })
  }, [cache, input.repoId, input.owner, input.name, input.ref])

  const get = useCallback((path: string) => cache.get(path), [cache])

  return { get, request }
}
