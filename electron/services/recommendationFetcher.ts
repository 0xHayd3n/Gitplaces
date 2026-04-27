// electron/services/recommendationFetcher.ts
import { searchRepos } from '../github'
import type { GitHubRepo } from '../github'
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'

export interface QueryPlan {
  topic: string
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

  // Long-tail topic queries — caps stars on the upside so niche repos can enter the pool.
  // Ceiling adapts to the user's taste tier (p75) but never below 500.
  // The nominal star ranges of `topic` (>10) and `longTail` (10..N) overlap, but
  // GitHub's best-match sort favors higher stars within each filter, so the two
  // queries return effectively disjoint working sets — `topic` skews 10k+, while
  // `longTail` is bounded at N. Both calls add distinct candidates.
  const starCeiling = Math.max(LONGTAIL_CEILING_FLOOR, profile.starScale.p75)
  for (const [topic] of topicEntries.slice(0, TOP_LONGTAIL_TOPICS_COUNT)) {
    plans.push({ topic, kind: 'longTail', coldStart: false, perPage: 25, sort: '', starCeiling })
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

  // Language query — #1 language
  const langEntries = [...profile.languageWeights.entries()].sort((a, b) => b[1] - a[1])
  if (langEntries.length > 0) {
    plans.push({ topic: langEntries[0][0], kind: 'language', coldStart: false, perPage: 25, sort: 'stars' })
  }

  return plans
}

function buildSearchQuery(plan: QueryPlan): string {
  switch (plan.kind) {
    case 'coldStart':
      return `stars:>${COLD_START_THRESHOLD}`
    case 'topic':
    case 'engagement':
    case 'rareTopic':
      return `topic:${plan.topic} stars:>${STAR_THRESHOLD}`
    case 'longTail': {
      const ceiling = plan.starCeiling ?? LONGTAIL_CEILING_FLOOR
      return `topic:${plan.topic} stars:${STAR_THRESHOLD}..${ceiling}`
    }
    case 'pair': {
      const [a, b] = plan.topic.split(' ')
      return `topic:${a} topic:${b} stars:>${STAR_THRESHOLD}`
    }
    case 'subType':
      return `${plan.topic} stars:>${STAR_THRESHOLD}`
    case 'language':
      return `language:${plan.topic} stars:>${LANGUAGE_STAR_THRESHOLD}`
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
