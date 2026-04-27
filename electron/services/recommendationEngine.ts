// electron/services/recommendationEngine.ts

import type { TopicStats, UserProfile, ScoreBreakdown, Anchor } from '../../src/types/recommendation'
import type { RepoRow } from '../../src/types/repo'
import type { GitHubRepo } from '../../electron/github'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'

/**
 * Internal engine output shape — identical to RecommendationItem except
 * `repo` is a raw GitHubRepo (the handler swaps it for a RepoRow after upsert).
 */
export interface RankedItem {
  repo: GitHubRepo
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}

interface RepoLike {
  topics: string  // JSON string
}

function safeParseTopics(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function computeTopicStats(repos: RepoLike[]): TopicStats {
  const docFrequency = new Map<string, number>()
  for (const r of repos) {
    const topics = new Set(safeParseTopics(r.topics))
    for (const topic of topics) {
      docFrequency.set(topic, (docFrequency.get(topic) ?? 0) + 1)
    }
  }
  const totalRepos = repos.length
  const idf = new Map<string, number>()
  for (const [topic, df] of docFrequency) {
    idf.set(topic, Math.log(totalRepos / (1 + df)))
  }
  return { docFrequency, totalRepos, idf }
}

const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000
const IDF_FALLBACK_THRESHOLD = 100
const ANCHOR_POOL_SIZE = 20

function recencyWeight(starredAt: string | null, now: number): number {
  if (!starredAt) return 1.0  // saved-only repos contribute full weight
  const ageMs = now - new Date(starredAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS)
}

function normalizeMap(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.floor((sortedAsc.length - 1) * p)
  return sortedAsc[idx]
}

function signalRichness(r: RepoRow): number {
  let score = 0
  const topics = safeParseTopics(r.topics)
  if (topics.length > 0) score += 1
  if (r.type_bucket) score += 1
  if (r.type_sub) score += 1
  if (r.language) score += 0.5
  return score
}

export function buildUserProfile(params: {
  userRepos: RepoRow[]
  topicStats: TopicStats
  now?: number
}): UserProfile {
  const { userRepos, topicStats } = params
  const now = params.now ?? Date.now()
  const useIdf = topicStats.totalRepos >= IDF_FALLBACK_THRESHOLD

  // Topic affinity
  const rawTopicAffinity = new Map<string, number>()
  for (const r of userRepos) {
    const w = recencyWeight(r.starred_at, now)
    const topics = safeParseTopics(r.topics)
    for (const t of topics) {
      const idfWeight = useIdf ? (topicStats.idf.get(t) ?? 0) : 1
      // Skip topics with idf <= 0 (appear in essentially all repos, df >= N-1) when IDF is active
      if (useIdf && idfWeight <= 0) continue
      rawTopicAffinity.set(t, (rawTopicAffinity.get(t) ?? 0) + w * idfWeight)
    }
  }
  const topicAffinity = normalizeMap(rawTopicAffinity)

  // Bucket / subType / language distributions
  const bucketRaw = new Map<string, number>()
  const subRaw = new Map<string, number>()
  const langRaw = new Map<string, number>()
  for (const r of userRepos) {
    if (r.type_bucket) bucketRaw.set(r.type_bucket, (bucketRaw.get(r.type_bucket) ?? 0) + 1)
    if (r.type_sub) subRaw.set(r.type_sub, (subRaw.get(r.type_sub) ?? 0) + 1)
    if (r.language) langRaw.set(r.language, (langRaw.get(r.language) ?? 0) + 1)
  }

  // Star scale
  const starCounts = userRepos.map((r) => r.stars ?? 0).sort((a, b) => a - b)
  const starScale = {
    median: percentile(starCounts, 0.5),
    p25: percentile(starCounts, 0.25),
    p75: percentile(starCounts, 0.75),
  }

  // Anchor pool: sort by recency desc, break ties by signal richness desc; take top 20
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
    bucketDistribution: normalizeMap(bucketRaw),
    subTypeDistribution: normalizeMap(subRaw),
    languageWeights: normalizeMap(langRaw),
    starScale,
    anchorPool,
    repoCount: userRepos.length,
    // Stub fields populated in later tasks; engine.ts is rewritten in Task 16.
    descriptionAffinity: new Map(),
    freshnessPreference: 365,
    engagement: {
      clickedTopicAffinity: new Map(),
      clickedOwnerAffinity: new Map(),
      clickedRepoIds: new Set(),
      clickCount: 0,
    },
  }
}

interface ScoringCandidate {
  topics: string[]
  type_bucket: string | null
  type_sub: string | null
  language: string | null
  stars: number
}

const WEIGHTS = {
  topic: 0.35,
  subType: 0.30,
  bucket: 0.15,
  language: 0.10,
  scale: 0.10,
} as const

export function scoreCandidate(
  candidate: ScoringCandidate,
  profile: UserProfile,
): { score: number; breakdown: ScoreBreakdown } {
  // topicScore
  let topicRaw = 0
  for (const t of candidate.topics) {
    topicRaw += profile.topicAffinity.get(t) ?? 0
  }
  const topic = Math.min(1.0, topicRaw)

  // bucketScore / subTypeScore / languageScore
  const bucket = candidate.type_bucket
    ? (profile.bucketDistribution.get(candidate.type_bucket) ?? 0)
    : 0
  const subType = candidate.type_sub
    ? (profile.subTypeDistribution.get(candidate.type_sub) ?? 0)
    : 0
  const language = candidate.language
    ? (profile.languageWeights.get(candidate.language) ?? 0)
    : 0

  // starScaleScore
  const medianLog = Math.log10(profile.starScale.median + 1)
  const candidateLog = Math.log10(candidate.stars + 1)
  const scale = Math.max(0, 1 - Math.abs(candidateLog - medianLog) / 2)

  const score =
    WEIGHTS.topic * topic +
    WEIGHTS.subType * subType +
    WEIGHTS.bucket * bucket +
    WEIGHTS.language * language +
    WEIGHTS.scale * scale

  return {
    score,
    breakdown: { topic, bucket, subType, language, scale, description: 0, freshness: 0, engagement: 0 },
  }
}

const ANCHOR_THRESHOLD = 0.2
const MAX_ANCHORS = 3

export function findAnchors(
  candidate: ScoringCandidate,
  profile: UserProfile,
  topicStats: TopicStats,
): Anchor[] {
  const candidateTopics = new Set(candidate.topics)
  const results: Anchor[] = []

  for (const anchor of profile.anchorPool) {
    const anchorTopics = new Set(safeParseTopics(anchor.topics))
    const reasons: string[] = []
    let similarity = 0

    for (const t of anchorTopics) {
      if (candidateTopics.has(t)) {
        similarity += topicStats.idf.get(t) ?? 1
        reasons.push(`topic:${t}`)
      }
    }
    if (anchor.type_bucket && anchor.type_bucket === candidate.type_bucket) {
      similarity += 0.3
      reasons.push(`bucket:${anchor.type_bucket}`)
    }
    if (anchor.type_sub && anchor.type_sub === candidate.type_sub) {
      similarity += 0.4
      reasons.push(`sub:${anchor.type_sub}`)
    }
    if (anchor.language && anchor.language === candidate.language) {
      similarity += 0.1
      reasons.push(`language:${anchor.language}`)
    }

    if (similarity >= ANCHOR_THRESHOLD) {
      results.push({
        owner: anchor.owner,
        name: anchor.name,
        avatar_url: anchor.avatar_url ?? null,
        reasons,
        similarity,
      })
    }
  }

  results.sort((a, b) => b.similarity - a.similarity)
  return results.slice(0, MAX_ANCHORS)
}

function toScoringCandidate(repo: GitHubRepo): ScoringCandidate {
  const topics = Array.isArray(repo.topics) ? repo.topics : []
  const classification = classifyRepoBucket({
    name: repo.name,
    description: repo.description ?? null,
    topics: JSON.stringify(topics),
  })
  return {
    topics,
    type_bucket: classification?.bucket ?? null,
    type_sub: classification?.subType ?? null,
    language: repo.language ?? null,
    stars: repo.stargazers_count ?? 0,
  }
}

export function rankCandidates(
  candidates: GitHubRepo[],
  profile: UserProfile,
  topicStats: TopicStats,
): RankedItem[] {
  const items: RankedItem[] = candidates.map((repo) => {
    const sc = toScoringCandidate(repo)
    const { score, breakdown } = scoreCandidate(sc, profile)
    const anchors = findAnchors(sc, profile, topicStats)
    return {
      repo,
      score,
      scoreBreakdown: breakdown,
      anchors,
      primaryAnchor: anchors[0] ?? null,
    }
  })
  items.sort((a, b) => b.score - a.score)
  return items
}
