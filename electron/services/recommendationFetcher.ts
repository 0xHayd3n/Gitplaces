// electron/services/recommendationFetcher.ts
import { searchRepos } from '../providers/github'
import { githubRepoToRepo } from '../providers/github/normalize'
import type { Repo } from '../../src/types/repo'
import type { CorpusStats, UserProfile } from '../../src/types/recommendation'
import { getSubTypeKeyword } from '../../src/lib/discoverQueries'
import { listHosts } from '../providers/hostConfig'
import { getToken } from '../providers/tokenStore'
import { searchAllHosts, type UnifiedQuery } from '../providers/discoverMerge'
import { HOST_ID_GITHUB } from '../providers/types'

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

/** A QueryPlan in unified shape if it can be translated cross-host; null
 *  otherwise (e.g. pair / longTail / language plans use compound GitHub
 *  qualifiers that don't translate cleanly to GitLab/Gitea). */
function planToUnifiedQuery(plan: QueryPlan): UnifiedQuery | null {
  switch (plan.kind) {
    case 'topic':
    case 'engagement':
    case 'rareTopic':
      return plan.topic ? { kind: 'topic', topic: plan.topic } : null
    case 'subType': {
      // subType plans store the GitHub-shaped keyword (e.g. "topic:ai-coding"
      // or a free phrase). Strip the qualifier prefix for the unified shape.
      const topic = plan.topic.replace(/^topic:/, '').trim()
      return topic ? { kind: 'topic', topic } : null
    }
    case 'coldStart':
      return { kind: 'popular' }
    // pair (two-topic), longTail (star-ceiling), language (language qualifier)
    // are GitHub-specific. Skip cross-host fan-out for these plans — they
    // still run against GitHub via searchRepos as before.
    case 'pair':
    case 'longTail':
    case 'language':
      return null
  }
}

/** Phase 8: `CandidateRepo` is just `Repo`. The Phase 7 shim that tagged a
 *  GitHubRepo with `_hostId` is gone — every candidate is already in
 *  canonical shape with a real `hostId` field. */
export type CandidateRepo = Repo

/** Fetch recommendation candidates. Pulls from GitHub (preserving the rich
 *  query semantics of the legacy QueryPlan system) AND fans the
 *  translatable plan kinds out across every other configured host via
 *  searchAllHosts. Returns a unified canonical `Repo[]` — every candidate
 *  carries its own `hostId`/`hostNativeId` so the engine + IPC upsert can
 *  attribute rows to the right host without a shim. */
export async function fetchCandidates(
  token: string | null,
  queries: QueryPlan[],
  page: number = 1,
): Promise<CandidateRepo[]> {
  const seen = new Set<string>()
  const merged: CandidateRepo[] = []

  function push(repos: CandidateRepo[]): void {
    for (const r of repos) {
      // Dedup by hostId+hostNativeId composite — preserves intra-host
      // numeric dedup while preventing cross-host collisions (each provider's
      // id space is independent so the same number can mean two different
      // repos).
      const key = `${r.hostId}:${r.hostNativeId}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(r)
      }
    }
  }

  // GitHub path — preserves the legacy buildSearchQuery semantics. Raw
  // GitHubRepo results normalize to canonical Repo via githubRepoToRepo
  // (which stamps hostId / hostType / camelCase fields).
  const ghResults = await Promise.allSettled(
    queries.map(async (q) => searchRepos(token, buildSearchQuery(q), q.perPage, q.sort, 'desc', page)),
  )
  for (const r of ghResults) {
    if (r.status === 'fulfilled') {
      push(r.value.map(githubRepoToRepo))
    }
  }

  // Other-host path — translate each plan that maps cleanly to UnifiedQuery
  // and fan out via searchAllHosts (which already returns canonical Repo[]).
  //
  // Defensive: listHosts() throws if hostConfig backend isn't initialized
  // (legacy unit tests that mock fetchCandidates don't bootstrap it). Treat
  // that as "no extra hosts" and skip the fan-out.
  let allHosts: ReturnType<typeof listHosts>
  try {
    allHosts = listHosts().filter(h => h.id !== HOST_ID_GITHUB)
  } catch {
    allHosts = []
  }
  if (allHosts.length > 0) {
    const unifiedQueries = queries
      .map(planToUnifiedQuery)
      .filter((q): q is UnifiedQuery => q !== null)
    const otherResults = await Promise.allSettled(
      unifiedQueries.map(uq => searchAllHosts(allHosts, uq, {
        capPerHost: 10,
        totalLimit: 30,
        timeoutMs: 4000,
        tokenForHost: (id) => getToken(id),
        page,
      })),
    )
    for (const r of otherResults) {
      if (r.status === 'fulfilled') {
        push(r.value)  // already canonical Repo[]
      }
    }
  }

  return merged
}
