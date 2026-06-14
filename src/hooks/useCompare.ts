import { useState, useEffect } from 'react'

export interface CompareSummaryData {
  base: string
  head: string
  htmlUrl: string
  totalCommits: number
  filesChanged: number
  additions: number
  deletions: number
  topFiles: { filename: string; status: string; additions: number; deletions: number }[]
  topAuthors: { login: string; avatarUrl: string; commits: number }[]
}

// Renderer-side cache mirroring the main-process LRU. Compare results between
// two immutable refs never change, so a hit is permanent for the session.
const cache = new Map<string, CompareSummaryData | null>()

// In-flight requests keyed identically. Coalesces concurrent renders (notably
// React strict-mode's double-mount) into a single IPC round-trip.
const inflight = new Map<string, Promise<CompareSummaryData | null>>()

function cacheKey(hostId: string, owner: string, repo: string, base: string, head: string): string {
  return `${hostId}|${owner}/${repo}/${base}...${head}`
}

function fetchOnce(key: string, hostId: string, owner: string, repo: string, base: string, head: string): Promise<CompareSummaryData | null> {
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = window.api.repo.getCompare(hostId, owner, repo, base, head)
    .then(result => {
      cache.set(key, result)
      return result as CompareSummaryData | null
    })
    .catch(() => {
      cache.set(key, null)
      return null
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
  return promise
}

export function useCompare(
  hostId: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
): { data: CompareSummaryData | null; loading: boolean; error: boolean } {
  const key = cacheKey(hostId, owner, repo, base, head)
  const [data, setData] = useState<CompareSummaryData | null>(cache.get(key) ?? null)
  const [loading, setLoading] = useState(!cache.has(key))
  const [error, setError] = useState(false)

  useEffect(() => {
    if (cache.has(key)) {
      setData(cache.get(key) ?? null)
      setLoading(false)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchOnce(key, hostId, owner, repo, base, head).then(result => {
      if (cancelled) return
      setData(result)
      setError(result === null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [key, hostId, owner, repo, base, head])

  return { data, loading, error }
}
