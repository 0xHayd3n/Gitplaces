// electron/services/userProfile.ts
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import type { RepoRow } from '../db-row-types'
import type { EngagementRow } from './engagementTracker'
import { buildTopicAffinity } from './signals/topicSignal'
import { buildDescriptionAffinity } from './signals/descriptionSignal'
import { buildFreshnessPreference } from './signals/freshnessSignal'
import { buildEngagementProfile } from './signals/engagementSignal'

// All starred + saved repos participate in anchoring; the prior 20-cap
// excluded most of larger libraries from ever appearing in "Because you
// starred …" explanations. The sort order is still meaningful: candidates
// iterate the pool and pick the best matches, so recency + signal-richness
// govern tie-breaking when multiple repos match equally.
const ANCHOR_POOL_SIZE = Number.POSITIVE_INFINITY

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return new Map(m)
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  return sortedAsc[Math.floor((sortedAsc.length - 1) * p)]
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

function signalRichness(r: RepoRow): number {
  let score = 0
  if (safeParseTopics(r.topics).length > 0) score += 1
  if (r.type_bucket) score += 1
  if (r.type_sub) score += 1
  if (r.language) score += 0.5
  return score
}

interface ClickedRepo {
  topics: string | null
  owner: string
}

export function buildUserProfile(params: {
  userRepos: RepoRow[]
  corpus: CorpusStats
  engagementEvents: EngagementRow[]
  clickedReposById: Map<string, ClickedRepo>
  now?: number
}): UserProfile {
  const { userRepos, corpus, engagementEvents, clickedReposById } = params
  const now = params.now ?? Date.now()

  const topicAffinity = buildTopicAffinity(userRepos, corpus, now)
  const descriptionAffinity = buildDescriptionAffinity(userRepos, corpus, now)

  const bucketRaw = new Map<string, number>()
  const subRaw = new Map<string, number>()
  const langRaw = new Map<string, number>()
  for (const r of userRepos) {
    if (r.type_bucket) bucketRaw.set(r.type_bucket, (bucketRaw.get(r.type_bucket) ?? 0) + 1)
    if (r.type_sub) subRaw.set(r.type_sub, (subRaw.get(r.type_sub) ?? 0) + 1)
    if (r.language) langRaw.set(r.language, (langRaw.get(r.language) ?? 0) + 1)
  }

  const starCounts = userRepos.map((r) => r.stars ?? 0).sort((a, b) => a - b)
  const starScale = {
    median: percentile(starCounts, 0.5),
    p25:    percentile(starCounts, 0.25),
    p75:    percentile(starCounts, 0.75),
  }

  const anchorPool = [...userRepos]
    .sort((a, b) => {
      const ta = a.starred_at ? new Date(a.starred_at).getTime() : 0
      const tb = b.starred_at ? new Date(b.starred_at).getTime() : 0
      if (tb !== ta) return tb - ta
      return signalRichness(b) - signalRichness(a)
    })
    .slice(0, ANCHOR_POOL_SIZE)

  return {
    topicAffinity,
    descriptionAffinity,
    bucketDistribution: normalize(bucketRaw),
    subTypeDistribution: normalize(subRaw),
    languageWeights: normalize(langRaw),
    starScale,
    anchorPool,
    repoCount: userRepos.length,
    freshnessPreference: buildFreshnessPreference(userRepos, now),
    engagement: buildEngagementProfile(engagementEvents, clickedReposById, now),
  }
}
