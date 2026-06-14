// electron/services/recommendationEngine.ts
import type { CorpusStats, UserProfile, ScoreBreakdown, Anchor } from '../../src/types/recommendation'
import type { GitHubRepo } from '../providers/github'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { scoreTopic } from './signals/topicSignal'
import { scoreDescription, tokenizeDescription } from './signals/descriptionSignal'
import { scoreCategory, categoryMismatchPenalty } from './signals/categorySignal'
import { scoreScale } from './signals/scaleSignal'
import { scoreFreshness } from './signals/freshnessSignal'
import { scoreEngagement } from './signals/engagementSignal'
import { mmrRerank, starTier } from './diversityReranker'

const WEIGHTS = {
  topic:       0.22,
  description: 0.13,
  subType:     0.20,
  bucket:      0.10,
  language:    0.07,
  scale:       0.05,
  freshness:   0.08,
  engagement:  0.15,
} as const

const RERANK_WINDOW = 200
const TOP_K = 100
const LAMBDA = 0.7

const ANCHOR_THRESHOLD = 0.2
const MAX_ANCHORS = 3
// `findAnchors` is called per candidate with a generous pool size so the
// diversification pass has alternatives to pick from. The pool is sliced down
// to MAX_ANCHORS after diversification.
//
// INVARIANT: ANCHOR_DIVERSIFY_POOL > MAX_ANCHORS — if these are equal the
// diversification pass has no room to substitute and silently becomes a no-op.
const ANCHOR_DIVERSIFY_POOL = 10
// Each prior use of an anchor in the result set divides its effective
// similarity by (1 + ANCHOR_USAGE_PENALTY × usage_count). 0.3 is gentle: a
// strong anchor still wins after a few uses if no comparable alternative
// exists, but weaker anchors get to surface when the strong one has already
// explained several cards.
const ANCHOR_USAGE_PENALTY = 0.3

export interface RankedItem {
  repo: GitHubRepo
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}

interface ScoringCandidate {
  topics: string[]
  descriptionTokens: string[]
  type_bucket: string | null
  type_sub: string | null
  language: string | null
  stars: number
  pushed_at: string | null
  archived: boolean
  owner: string
  id: number
}

function toScoringCandidate(repo: GitHubRepo): ScoringCandidate {
  const topics = Array.isArray(repo.topics) ? repo.topics : []
  const classification = classifyRepoBucket({
    name: repo.name,
    description: repo.description ?? null,
    topics,
  })
  return {
    topics,
    descriptionTokens: tokenizeDescription(repo.description),
    type_bucket: classification?.bucket ?? null,
    type_sub:    classification?.subType ?? null,
    language:    repo.language ?? null,
    stars:       repo.stargazers_count ?? 0,
    pushed_at:   repo.pushed_at ?? null,
    archived:    repo.archived ?? false,
    owner:       repo.owner.login,
    id:          repo.id,
  }
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

export function rankCandidates(
  candidates: GitHubRepo[],
  profile: UserProfile,
  corpus: CorpusStats,
  now?: number,
): RankedItem[] {
  const t = now ?? Date.now()

  const scored: RankedItem[] = candidates.map((repo) => {
    const sc = toScoringCandidate(repo)

    const topic       = scoreTopic(sc.topics, profile.topicAffinity)
    const description = scoreDescription(sc.descriptionTokens, profile.descriptionAffinity)
    const cat         = scoreCategory(sc, profile)
    const scale       = scoreScale(sc.stars, profile.starScale.median)
    const freshness   = scoreFreshness({ pushed_at: sc.pushed_at, archived: sc.archived }, profile.freshnessPreference, t)
    const engagement  = scoreEngagement({ topics: sc.topics, owner: sc.owner }, profile.engagement)

    const breakdown: ScoreBreakdown = {
      topic, description,
      bucket: cat.bucket, subType: cat.subType, language: cat.language,
      scale, freshness, engagement,
    }

    const positiveScore =
      WEIGHTS.topic       * topic +
      WEIGHTS.description * description +
      WEIGHTS.subType     * cat.subType +
      WEIGHTS.bucket      * cat.bucket +
      WEIGHTS.language    * cat.language +
      WEIGHTS.scale       * scale +
      WEIGHTS.freshness   * freshness +
      WEIGHTS.engagement  * engagement

    // Negative signal: dock score for candidates classified into buckets/subTypes
    // the user has zero stars in. Counteracts the additive-positive bias that lets
    // off-cluster repos (e.g. job-listings, edu-platforms) rank via topic+scale alone.
    const score = Math.max(0, positiveScore - categoryMismatchPenalty(sc, profile))

    const rerankRepo = {
      id: String(repo.id),
      topics: sc.topics,
      bucket: sc.type_bucket,
      sub:    sc.type_sub,
      language: sc.language,
      tier: starTier(sc.stars),
    }

    return {
      repo,
      score,
      scoreBreakdown: breakdown,
      anchors: [],
      primaryAnchor: null,
      _rerank: rerankRepo,
    } as RankedItem & { _rerank: typeof rerankRepo }
  })

  scored.sort((a, b) => b.score - a.score)

  // MMR rerank: adapt items to reranker shape
  const window = scored.slice(0, RERANK_WINDOW).map(item => ({
    score: item.score,
    repo: (item as any)._rerank,
    _orig: item,
  }))
  const reranked = mmrRerank(window, { topK: TOP_K, lambda: LAMBDA }).map(r => (r as any)._orig as RankedItem)

  // Anchors computed on reranked output. Request a generous pool per item so
  // the diversification pass has alternatives to choose from when the
  // raw-similarity top anchor has already explained several other cards.
  for (const item of reranked) {
    const sc = toScoringCandidate(item.repo)
    item.anchors = findAnchors(sc, profile, corpus, ANCHOR_DIVERSIFY_POOL)
    item.primaryAnchor = item.anchors[0] ?? null
  }

  diversifyAnchors(reranked)

  // Drop candidates we have no anchor for: if no user repo was similar enough
  // to the candidate to clear the anchor threshold, we can't credibly explain
  // why we're surfacing it ("Because you starred …" would be empty). Better to
  // omit than to show a hollow rec. Cold-start path uses a separate code path
  // and is not affected.
  const anchored = reranked.filter((item) => item.anchors.length > 0)

  // Empty-list fallback: if the user's anchorPool produces no anchors for any
  // candidate (e.g. anchorPool entries lack topics/bucket/lang signal), fall
  // back to the top reranked items so the UI is never blank. The card will
  // render with primaryAnchor=null in that branch.
  return anchored.length > 0 ? anchored : reranked.slice(0, 10)
}

/**
 * Spread anchor usage across the result set so a few rich-tag user repos
 * (e.g. one tagged `ai`+`ui`+`agent`) don't anchor every single card. Iterates
 * items in display order; for each item, sorts its candidate anchor pool by
 * `similarity / (1 + 0.3 × prior_usage)` and keeps the top MAX_ANCHORS. Strong
 * anchors still win when the alternatives are much weaker; weaker anchors win
 * only when the strong ones have already been used several times.
 *
 * Mutates each item's `anchors` and `primaryAnchor` in place.
 */
export function diversifyAnchors(items: RankedItem[]): void {
  const usage = new Map<string, number>()
  for (const item of items) {
    if (item.anchors.length === 0) continue
    const ranked = item.anchors
      .map((a) => {
        const key = `${a.owner}/${a.name}`
        const adjusted = a.similarity / (1 + ANCHOR_USAGE_PENALTY * (usage.get(key) ?? 0))
        return { anchor: a, adjusted }
      })
      .sort((x, y) => y.adjusted - x.adjusted)

    const top = ranked.slice(0, MAX_ANCHORS).map((r) => r.anchor)
    item.anchors = top
    item.primaryAnchor = top[0] ?? null
    for (const a of top) {
      const key = `${a.owner}/${a.name}`
      usage.set(key, (usage.get(key) ?? 0) + 1)
    }
  }
}

export function findAnchors(
  candidate: { topics: string[]; type_bucket: string | null; type_sub: string | null; language: string | null },
  profile: UserProfile,
  corpus: CorpusStats,
  maxAnchors: number = MAX_ANCHORS,
): Anchor[] {
  const candidateTopics = new Set(candidate.topics)
  const results: Anchor[] = []

  for (const anchor of profile.anchorPool) {
    const anchorTopics = new Set(safeParseTopics(anchor.topics))
    const reasons: string[] = []
    let similarity = 0

    for (const t of anchorTopics) {
      if (candidateTopics.has(t)) {
        const idf = corpus.topicIdf.get(t) ?? 1
        similarity += idf > 0 ? idf : 1
        reasons.push(`topic:${t}`)
      }
    }
    if (anchor.type_bucket && anchor.type_bucket === candidate.type_bucket) { similarity += 0.3; reasons.push(`bucket:${anchor.type_bucket}`) }
    if (anchor.type_sub    && anchor.type_sub    === candidate.type_sub)    { similarity += 0.4; reasons.push(`sub:${anchor.type_sub}`) }
    if (anchor.language    && anchor.language    === candidate.language)    { similarity += 0.1; reasons.push(`language:${anchor.language}`) }

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
  return results.slice(0, maxAnchors)
}
