// src/types/recommendation.ts
import type { RepoRow } from './repo'

/** Document-frequency + IDF stats for both topics and description tokens, computed in one DB sweep. */
export interface CorpusStats {
  topicDocFrequency: Map<string, number>
  topicIdf: Map<string, number>
  descriptionDocFrequency: Map<string, number>
  descriptionIdf: Map<string, number>
  totalRepos: number
}

export interface EngagementProfile {
  /** Topics from clicked repos, recency-decayed (30-day half-life), normalized sum=1. */
  clickedTopicAffinity: Map<string, number>
  /** Owners likewise. */
  clickedOwnerAffinity: Map<string, number>
  /** Repo IDs the user has clicked recently — filtered out of recommendations. */
  clickedRepoIds: Set<string>
  /** Total clicks in the window (90 days). */
  clickCount: number
}

/**
 * Engine-internal profile built from the user's starred/saved repos.
 * Consumed by the recommendation engine (main process); not intended for direct renderer use.
 * The renderer should consume `RecommendationItem` / `Anchor` instead.
 */
export interface UserProfile {
  /** IDF-weighted, recency-decayed, normalized. Sum of values = 1.0. */
  topicAffinity: Map<string, number>
  /** Normalized, sum = 1.0. */
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
  /** Star-count percentiles across the user's starred/saved repos. */
  starScale: { median: number; p25: number; p75: number }
  /** Top ~20 starred/saved repos for anchor finding. */
  anchorPool: RepoRow[]
  /** Total number of starred + saved repos used to build this profile. */
  repoCount: number

  /** TF-IDF tokens from descriptions of the user's stars/saved, normalized sum=1. */
  descriptionAffinity: Map<string, number>
  /** Median age (days) of user's starred repos by `pushed_at`; informs adaptive freshness half-life. */
  freshnessPreference: number
  /** Click-derived signals + filter set. */
  engagement: EngagementProfile
}

export interface ScoreBreakdown {
  topic: number
  description: number
  bucket: number
  subType: number
  language: number
  scale: number
  freshness: number
  engagement: number
}

export interface Anchor {
  owner: string
  name: string
  /** Owner avatar URL (github.com/{owner}.png equivalent) — used by the recommended-card anchor strip. */
  avatar_url: string | null
  /** Structured tokens, e.g. "topic:ai-agent", "bucket:ai-ml", "sub:ai-coding", "language:Python". */
  reasons: string[]
  /** Similarity score (higher = more similar). Unbounded above — IDF-weighted topic overlap plus bucket/sub-type/language bumps; typical range 0.2–5. Used for ordering anchors, not for UI display. */
  similarity: number
}

export interface RecommendationItem {
  repo: RepoRow
  /** Composite weighted score in [0, 1]. */
  score: number
  scoreBreakdown: ScoreBreakdown
  /** Top 1-3 anchors ordered by similarity desc; empty if none cleared threshold. */
  anchors: Anchor[]
  /** Convenience: anchors[0] or null. */
  primaryAnchor: Anchor | null
}

/** Response envelope from the IPC handler. */
export interface RecommendationResponse {
  items: RecommendationItem[]
  /**
   * True when the handler fell back to stale cache due to an API failure.
   * Currently always false — stale-cache fallback was deferred (see plan Task 9 Option B);
   * the field is retained in the response shape so a future reintroduction won't require a schema change.
   */
  stale: boolean
  /** True when the user has <3 starred/saved repos. */
  coldStart: boolean
}
