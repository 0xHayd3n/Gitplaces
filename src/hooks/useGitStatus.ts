import { useEffect, useState } from 'react'
import type { GitFileStatus } from '../lib/fileTree/types'

interface UseGitStatusInput {
  repoId: string | null
  owner: string
  name: string
  baseRef: string | null
  headRef: string
}

interface UseGitStatusResult {
  statusMap: Map<string, GitFileStatus>
  error: string | null
  retry(): void
}

export function useGitStatus(input: UseGitStatusInput): UseGitStatusResult {
  const [statusMap, setStatusMap] = useState<Map<string, GitFileStatus>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setStatusMap(new Map())
    setError(null)
    if (!input.repoId || !input.baseRef) return
    let cancelled = false
    window.api.github
      .compareRefs(input.repoId, input.owner, input.name, input.baseRef, input.headRef)
      .then(files => {
        if (cancelled) return
        if (files === null) {
          setError('Compare failed')
          return
        }
        const map = new Map<string, GitFileStatus>()
        for (const f of files) map.set(f.path, f.status)
        setStatusMap(map)
      })
      .catch(() => {
        if (!cancelled) setError('Compare failed')
      })
    return () => { cancelled = true }
  }, [input.repoId, input.owner, input.name, input.baseRef, input.headRef, retryKey])

  return { statusMap, error, retry: () => setRetryKey(k => k + 1) }
}
