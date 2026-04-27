// electron/services/signals/engagementSignal.ts
import type { EngagementProfile } from '../../../src/types/recommendation'
import type { EngagementRow } from '../engagementTracker'

const CLICK_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

interface RepoLike {
  topics: string | null
  owner: string
}

interface EngagementCandidate {
  topics: string[]
  owner: string
}

function safeParseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

function recencyWeight(ts: number, now: number): number {
  const ageMs = now - ts
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / CLICK_HALF_LIFE_MS)
}

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

export function buildEngagementProfile(
  events: EngagementRow[],
  reposById: Map<string, RepoLike>,
  now: number,
): EngagementProfile {
  const topicRaw = new Map<string, number>()
  const ownerRaw = new Map<string, number>()
  const clickedRepoIds = new Set<string>()

  for (const ev of events) {
    clickedRepoIds.add(ev.repo_id)
    const repo = reposById.get(ev.repo_id)
    if (!repo) continue
    const w = recencyWeight(ev.ts, now)
    for (const t of safeParseTopics(repo.topics)) {
      topicRaw.set(t, (topicRaw.get(t) ?? 0) + w)
    }
    ownerRaw.set(repo.owner, (ownerRaw.get(repo.owner) ?? 0) + w)
  }

  return {
    clickedTopicAffinity: normalize(topicRaw),
    clickedOwnerAffinity: normalize(ownerRaw),
    clickedRepoIds,
    clickCount: events.length,
  }
}

export function scoreEngagement(
  candidate: EngagementCandidate,
  profile: EngagementProfile,
): number {
  if (profile.clickCount === 0) return 0
  let topicMatch = 0
  for (const t of candidate.topics) {
    topicMatch += profile.clickedTopicAffinity.get(t) ?? 0
  }
  const ownerMatch = profile.clickedOwnerAffinity.get(candidate.owner) ?? 0
  return Math.min(1, 0.7 * topicMatch + 0.3 * ownerMatch)
}
