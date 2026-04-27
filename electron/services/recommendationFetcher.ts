// electron/services/recommendationFetcher.ts
import { searchRepos } from '../github'
import type { GitHubRepo } from '../github'
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'

export interface QueryPlan {
  topic: string
  // `language` retained on the discriminator so historical `QueryPlan` literals
  // (e.g. cold-start fallbacks, deserialized cache entries) still typecheck;
  // `planQueries` no longer emits it because the standalone language query was
  // a major noise source — top-by-stars TS repos are topically orthogonal.
  // Language affinity is still captured in scoring via `categorySignal`.
  kind: 'topic' | 'pair' | 'subType' | 'engagement' | 'language' | 'coldStart' | 'longTail' | 'rareTopic'
  coldStart: boolean
  perPage: number
  sort: string
  /** Upper-bound stars filter for `longTail` queries; ignored by other kinds. */
  starCeiling?: number
}

const TOP_TOPICS_COUNT = 4
const TOP_SUBTYPES_COUNT = 2
const TOP_LONGTAIL_TOPICS_COUNT = 2
const TOP_RARE_TOPICS_COUNT = 2
const TOP_ENGAGEMENT_TOPICS_COUNT = 2
const ENGAGEMENT_MIN_CLICKS = 1
const PAIR_MIN_AFFINITY = 0.15
const STAR_THRESHOLD = 10
const LANGUAGE_STAR_THRESHOLD = 50
const LONGTAIL_CEILING_FLOOR = 500
// Global hard cap on candidate stars. Every non-cold-start query is bounded
// at `stars:10..MAX_STAR_CEILING` so the recommendation pool is always more
// niche than mainstream — anything more popular than this never enters the
// candidate set. Cold-start uses a separate code path (popular fallback for
// users with no preference data) and is not subject to this cap.
const MAX_STAR_CEILING = 5000
const COLD_START_THRESHOLD = 50000
const COLD_START_RESULTS = 100

export function planQueries(profile: UserProfile, corpus?: CorpusStats): QueryPlan[] {
  const topicEntries = [...profile.topicAffinity.entries()].sort((a, b) => b[1] - a[1])
  if (topicEntries.length === 0) {
    return [{ topic: '', kind: 'coldStart', coldStart: true, perPage: COLD_START_RESULTS, sort: 'stars' }]
  }

  const plans: QueryPlan[] = []
  const affinityTopics = new Set(topicEntries.slice(0, TOP_TOPICS_COUNT).map(([t]) => t))

  // Topic queries
  for (const topic of affinityTopics) {
    plans.push({ topic, kind: 'topic', coldStart: false, perPage: 30, sort: '' })
  }

  // Rare-topic queries — pick the highest-IDF topics from the user's stars
  // that didn't make the affinity top-4. Surfaces niche communities that
  // affinity ranking shadows when rare topics have low frequency.
  if (corpus) {
    const userTopics = [...profile.topicAffinity.keys()]
    const rare = userTopics
      .filter((t) => !affinityTopics.has(t))
      .map((t) => ({ topic: t, idf: corpus.topicIdf.get(t) ?? 0 }))
      .filter((x) => x.idf > 0)
      .sort((a, b) => b.idf - a.idf)
      .slice(0, TOP_RARE_TOPICS_COUNT)
    for (const { topic } of rare) {
      plans.push({ topic, kind: 'rareTopic', coldStart: false, perPage: 20, sort: '' })
    }
  }

  // Long-tail topic queries — tighter ceiling than the regular topic queries.
  // Skipped when the user's adapted ceiling equals the global cap: at that
  // point longTail and topic emit the same `stars:10..5000` query and only
  // produce duplicate API calls. Only emitted when p75 puts longTail strictly
  // below the global cap (i.e. niche-leaning users get an extra-strict pass).
  const starCeiling = Math.min(MAX_STAR_CEILING, Math.max(LONGTAIL_CEILING_FLOOR, profile.starScale.p75))
  if (starCeiling < MAX_STAR_CEILING) {
    for (const [topic] of topicEntries.slice(0, TOP_LONGTAIL_TOPICS_COUNT)) {
      plans.push({ topic, kind: 'longTail', coldStart: false, perPage: 25, sort: '', starCeiling })
    }
  }

  // Pair query — top-2 if both >= threshold
  if (topicEntries.length >= 2 && topicEntries[1][1] >= PAIR_MIN_AFFINITY) {
    plans.push({
      topic: `${topicEntries[0][0]} ${topicEntries[1][0]}`,
      kind: 'pair',
      coldStart: false,
      perPage: 25,
      sort: '',
    })
  }

  // SubType queries
  const subTypeEntries = [...profile.subTypeDistribution.entries()].sort((a, b) => b[1] - a[1])
  for (const [subTypeId] of subTypeEntries.slice(0, TOP_SUBTYPES_COUNT)) {
    const kw = getSubTypeKeyword(subTypeId)
    if (kw) plans.push({ topic: kw, kind: 'subType', coldStart: false, perPage: 25, sort: '' })
  }

  // Engagement queries (only if enough click data)
  if (profile.engagement.clickCount >= ENGAGEMENT_MIN_CLICKS) {
    const clickedEntries = [...profile.engagement.clickedTopicAffinity.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([t]) => !affinityTopics.has(t))
      .slice(0, TOP_ENGAGEMENT_TOPICS_COUNT)
    for (const [topic] of clickedEntries) {
      plans.push({ topic, kind: 'engagement', coldStart: false, perPage: 20, sort: '' })
    }
  }

  // No standalone `language` query: `language:X stars:>50 sort=stars` returns
  // top-by-stars repos in language X regardless of topic, which empirically
  // dominated the candidate pool with topically-irrelevant noise (microsoft/
  // TypeScript itself, iptv, vscode, etc. for TS users). Language affinity is
  // still captured in scoring via `categorySignal`.

  return plans
}

function buildSearchQuery(plan: QueryPlan): string {
  switch (plan.kind) {
    case 'coldStart':
      return `stars:>${COLD_START_THRESHOLD}`
    case 'topic':
    case 'engagement':
    case 'rareTopic':
      return `topic:${plan.topic} stars:${STAR_THRESHOLD}..${MAX_STAR_CEILING}`
    case 'longTail': {
      const ceiling = plan.starCeiling ?? LONGTAIL_CEILING_FLOOR
      return `topic:${plan.topic} stars:${STAR_THRESHOLD}..${ceiling}`
    }
    case 'pair': {
      const [a, b] = plan.topic.split(' ')
      return `topic:${a} topic:${b} stars:${STAR_THRESHOLD}..${MAX_STAR_CEILING}`
    }
    case 'subType':
      return `${plan.topic} stars:${STAR_THRESHOLD}..${MAX_STAR_CEILING}`
    case 'language':
      return `language:${plan.topic} stars:${LANGUAGE_STAR_THRESHOLD}..${MAX_STAR_CEILING}`
  }
}

export async function fetchCandidates(
  token: string | null,
  queries: QueryPlan[],
): Promise<GitHubRepo[]> {
  const seen = new Set<number>()
  const merged: GitHubRepo[] = []

  const results = await Promise.allSettled(
    queries.map(async (q) => searchRepos(token, buildSearchQuery(q), q.perPage, q.sort, 'desc', 1))
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const repo of r.value) {
        if (!seen.has(repo.id)) {
          seen.add(repo.id)
          merged.push(repo)
        }
      }
    }
  }
  return merged
}
