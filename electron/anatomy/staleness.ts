// electron/anatomy/staleness.ts
// Pins staleness to the .anatomy file's last commit (spec D8): a repo is stale
// only when .anatomy itself changed upstream, not on any push. Pure + injected
// fetch so it is unit-testable without network (sandbox egress is restricted).
import { githubHeaders } from '../github'

export interface StalenessResult { stale: boolean; reason: string; latestSha: string | null }

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function isAnatomyStale(
  owner: string,
  name: string,
  branch: string,
  storedCommit: string | null,
  token: string | null,
  fetchFn: FetchFn = fetch,
): Promise<StalenessResult> {
  if (!storedCommit) return { stale: false, reason: 'no stored commit', latestSha: null }
  const url = `https://api.github.com/repos/${owner}/${name}/commits?path=.anatomy&sha=${branch}&per_page=1`
  try {
    const r = await fetchFn(url, { headers: githubHeaders(token) })
    if (!r.ok) return { stale: false, reason: `api error ${r.status}`, latestSha: null }
    const commits = await r.json() as Array<{ sha: string }>
    if (!Array.isArray(commits) || commits.length === 0) {
      return { stale: false, reason: 'no .anatomy commits upstream', latestSha: null }
    }
    const latestSha = commits[0].sha
    const stale = latestSha !== storedCommit
    return { stale, reason: stale ? 'anatomy drifted' : 'fresh', latestSha }
  } catch (err) {
    return { stale: false, reason: `probe failed: ${err instanceof Error ? err.message : String(err)}`, latestSha: null }
  }
}
