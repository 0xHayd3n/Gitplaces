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

/** @deprecated Use CorpusStats. Retained as alias during the transition. Remove in cleanup task. */
export type TopicStats = {
  docFrequency: Map<string, number>
  totalRepos: number
  idf: Map<string, number>
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

export interface UserProfile {
  topicAffinity: Map<string, number>
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
  starScale: { median: number; p25: number; p75: number }
  anchorPool: RepoRow[]
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
  avatar_url: string | null
  reasons: string[]
  similarity: number
}

export interface RecommendationItem {
  repo: RepoRow
  score: number
  scoreBreakdown: ScoreBreakdown
  anchors: Anchor[]
  primaryAnchor: Anchor | null
}

export interface RecommendationResponse {
  items: RecommendationItem[]
  stale: boolean
  coldStart: boolean
}
