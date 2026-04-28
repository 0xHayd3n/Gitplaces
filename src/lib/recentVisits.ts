const STORAGE_KEY = 'projects-recent-repos'
const MAX_ENTRIES = 30

export interface RecentEntry {
  owner: string
  name: string
  avatar_url: string | null
  navigatePath: string
  visitedAt: number
}

export function getRecentVisits(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RecentEntry[]) : []
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
