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

const MAX_PARALLEL = 6

export function useLastCommits(input: UseLastCommitsInput): UseLastCommitsResult {
  const [cache, setCache] = useState<Map<string, LastCommitInfo | null>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())
  const queue = useRef<PathSha[]>([])
  const activeCount = useRef(0)

  useEffect(() => {
    setCache(new Map())
    inFlight.current.clear()
    queue.current = []
    activeCount.current = 0
  }, [input.repoId, input.owner, input.name, input.ref])

  const pump = useCallback(() => {
    if (!input.repoId) return
    while (activeCount.current < MAX_PARALLEL && queue.current.length > 0) {
      const { path, sha } = queue.current.shift()!
      activeCount.current++
      window.api.github
        .getLastCommitForPath(input.repoId, input.owner, input.name, input.ref, path, sha)
        .then(info => {
          setCache(prev => {
            const next = new Map(prev)
            next.set(path, info)
            return next
          })
        })
        .catch(() => {
          // Silent: row renders without commit info.
        })
        .finally(() => {
          inFlight.current.delete(path)
          activeCount.current--
          pump()
        })
    }
  }, [input.repoId, input.owner, input.name, input.ref])

  const request = useCallback((rows: PathSha[]) => {
    for (const { path, sha } of rows) {
      if (cache.has(path)) continue
      if (inFlight.current.has(path)) continue
      inFlight.current.add(path)
      queue.current.push({ path, sha })
    }
    pump()
  }, [cache, pump])

  const get = useCallback((path: string) => {
    return cache.get(path)
  }, [cache])

  return { get, request }
}
