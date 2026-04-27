// electron/services/recommendationEngine.ts
import type { CorpusStats, UserProfile, ScoreBreakdown, Anchor } from '../../src/types/recommendation'
import type { GitHubRepo } from '../github'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { scoreTopic } from './signals/topicSignal'
import { scoreDescription, tokenizeDescription } from './signals/descriptionSignal'
import { scoreCategory } from './signals/categorySignal'
import { scoreScale } from './signals/scaleSignal'
import { scoreFreshness } from './signals/freshnessSignal'
import { scoreEngagement } from './signals/engagementSignal'
import { mmrRerank } from './diversityReranker'

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
    topics: JSON.stringify(topics),
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

    const score =
      WEIGHTS.topic       * topic +
      WEIGHTS.description * description +
      WEIGHTS.subType     * cat.subType +
      WEIGHTS.bucket      * cat.bucket +
      WEIGHTS.language    * cat.language +
      WEIGHTS.scale       * scale +
      WEIGHTS.freshness   * freshness +
      WEIGHTS.engagement  * engagement

    const rerankRepo = {
      id: String(repo.id),
      topics: sc.topics,
      bucket: sc.type_bucket,
      sub:    sc.type_sub,
      language: sc.language,
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

  // Anchors computed on reranked output
  for (const item of reranked) {
    const sc = toScoringCandidate(item.repo)
    const anchors = findAnchors(sc, profile, corpus)
    item.anchors = anchors
    item.primaryAnchor = anchors[0] ?? null
  }

  return reranked
}

export function findAnchors(
  candidate: { topics: string[]; type_bucket: string | null; type_sub: string | null; language: string | null },
  profile: UserProfile,
  corpus: CorpusStats,
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
  return results.slice(0, MAX_ANCHORS)
}
