import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { HOST_ID_GITHUB } from '../lib/hostIds'

/**
 * Compat shim for the old `/repo/:owner/:name` URL shape. Looks up the repo
 * in the saved-repos library to pick the right `hostId`, defaulting to
 * `HOST_ID_GITHUB` when not found (or when the saved-repo record predates the
 * hostId-aware schema and doesn't carry one). Then `<Navigate>`s to the new
 * `/repo/:hostId/:owner/:name` URL.
 *
 * Phase 3 only registers the GitHub provider, so the fallback always produces
 * a working route. Phase 4+ adds GitLab/Gitea — at that point, repos saved
 * against non-GitHub hosts will carry their own `hostId` and this redirect
 * will route them correctly without further changes.
 */
export function RepoRouteCompatRedirect() {
  const { owner, name } = useParams<{ owner: string; name: string }>()
  const [hostId, setHostId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function resolve() {
      if (!owner || !name) return
      const saved = await window.api.repo.getSaved()
      if (cancelled) return
      const match = saved.find(r => r.owner === owner && r.name === name) as
        | { owner: string; name: string; hostId?: string }
        | undefined
      setHostId(match?.hostId ?? HOST_ID_GITHUB)
    }
    void resolve()
    return () => { cancelled = true }
  }, [owner, name])

  if (!hostId || !owner || !name) return null
  return <Navigate to={`/repo/${encodeURIComponent(hostId)}/${owner}/${name}`} replace />
}
