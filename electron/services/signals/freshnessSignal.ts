const DAY_MS = 24 * 60 * 60 * 1000
const HALF_LIFE_FLOOR_DAYS = 180

interface FreshnessCandidate {
  pushed_at: string | null
  archived: boolean
}

interface RepoLike {
  pushed_at: string | null
}

export function scoreFreshness(
  candidate: FreshnessCandidate,
  freshnessPreference: number,
  now: number,
): number {
  if (candidate.archived) return 0
  if (!candidate.pushed_at) return 0.05
  const ageDays = (now - new Date(candidate.pushed_at).getTime()) / DAY_MS
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1
  const halfLife = Math.max(HALF_LIFE_FLOOR_DAYS, freshnessPreference)
  return Math.pow(0.5, ageDays / halfLife)
}

export function buildFreshnessPreference(userRepos: RepoLike[], now: number): number {
  const ages: number[] = []
  for (const r of userRepos) {
    if (!r.pushed_at) continue
    const days = (now - new Date(r.pushed_at).getTime()) / DAY_MS
    if (Number.isFinite(days) && days >= 0) ages.push(days)
  }
  if (ages.length === 0) return 365
  ages.sort((a, b) => a - b)
  return ages[Math.floor((ages.length - 1) / 2)]
}
