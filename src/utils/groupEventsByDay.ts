import type { GitHubFeedEvent } from '../hooks/useFeed'

export interface EventGroup {
  label: string
  events: GitHubFeedEvent[]
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
})

function dayKey(d: Date): string {
  return d.toDateString() // local-time, stable per-day key
}

function labelFor(eventDate: Date, now: Date): string {
  const todayKey = dayKey(now)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const eventKey = dayKey(eventDate)

  if (eventKey === todayKey) return 'Today'
  if (eventKey === dayKey(yesterday)) return 'Yesterday'
  if (eventDate.getFullYear() === now.getFullYear()) {
    return MONTH_DAY.format(eventDate)
  }
  return MONTH_DAY_YEAR.format(eventDate)
}

export function groupEventsByDay(
  events: GitHubFeedEvent[],
  now: Date = new Date(),
): EventGroup[] {
  const groups: EventGroup[] = []
  const indexByKey = new Map<string, number>()

  for (const event of events) {
    const date = new Date(event.created_at)
    const key = dayKey(date)
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = groups.length
      indexByKey.set(key, idx)
      groups.push({ label: labelFor(date, now), events: [] })
    }
    groups[idx].events.push(event)
  }

  return groups
}
