import { dayKey, labelFor } from './groupEventsByDay'
import type { RepoActivityItem } from '../types/repoActivity'

export interface RepoActivityGroup {
  label: string
  items: RepoActivityItem[]
}

export function groupRepoActivityByDay(
  items: RepoActivityItem[],
  now: Date = new Date(),
): RepoActivityGroup[] {
  const groups: RepoActivityGroup[] = []
  const idxByKey = new Map<string, number>()
  const todayKey = dayKey(now)
  const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  for (const item of items) {
    const date = new Date(item.ts)
    const key = dayKey(date)
    let idx = idxByKey.get(key)
    if (idx === undefined) {
      idx = groups.length
      idxByKey.set(key, idx)
      groups.push({ label: labelFor(date, now, todayKey, yesterdayKey), items: [] })
    }
    groups[idx].items.push(item)
  }
  return groups
}
