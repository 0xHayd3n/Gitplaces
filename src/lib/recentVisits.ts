const STORAGE_KEY = 'projects-recent-repos'
const MAX_ENTRIES = 30

export interface RecentEntry {
  owner: string
  name: string
  ownerAvatarUrl: string | null
  navigatePath: string
  visitedAt: number
}

export function getRecentVisits(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<RecentEntry> & { avatar_url?: string | null }>
    // Tolerate older snake_case `avatar_url` entries written before Phase 2.
    return parsed.map(e => ({
      owner: e.owner ?? '',
      name: e.name ?? '',
      ownerAvatarUrl: e.ownerAvatarUrl ?? e.avatar_url ?? null,
      navigatePath: e.navigatePath ?? '',
      visitedAt: e.visitedAt ?? 0,
    }))
  } catch {
    return []
  }
}

export function recordRecentVisit(entry: Omit<RecentEntry, 'visitedAt'>): void {
  try {
    const key = `${entry.owner}/${entry.name}`
    const existing = getRecentVisits()
    const without = existing.filter(e => `${e.owner}/${e.name}` !== key)
    const next = [{ ...entry, visitedAt: Date.now() }, ...without].slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore write errors
  }
}
