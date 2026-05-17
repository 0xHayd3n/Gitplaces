// electron/anatomy/staleness.ts
// Phase 1: typed seam only. Phase 2 implements the GitHub
// `GET /repos/{o}/{n}/commits?path=.anatomy&per_page=1` probe and wires it
// into updateService.checkRepo / repos.update_available.
export interface StalenessResult { stale: boolean; reason: string }

export async function isAnatomyStale(
  _owner: string, _name: string, _storedCommit: string | null, _token: string | null,
): Promise<StalenessResult> {
  return { stale: false, reason: 'phase2-not-implemented' }
}
