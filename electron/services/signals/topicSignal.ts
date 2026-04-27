// electron/services/signals/topicSignal.ts
import type { CorpusStats } from '../../../src/types/recommendation'

const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000
const IDF_FALLBACK_THRESHOLD = 100

interface RepoLike {
  topics: string | null
  starred_at: string | null
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

function recencyWeight(starredAt: string | null, now: number): number {
  if (!starredAt) return 1.0
  const ageMs = now - new Date(starredAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1.0
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS)
}

function normalize(m: Map<string, number>): Map<string, number> {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return m
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, v / total)
  return out
}

export function buildTopicAffinity(
  userRepos: RepoLike[],
  corpus: CorpusStats,
  now: number,
): Map<string, number> {
  const useIdf = corpus.totalRepos >= IDF_FALLBACK_THRESHOLD
  const raw = new Map<string, number>()
  for (const r of userRepos) {
    const w = recencyWeight(r.starred_at, now)
    for (const t of safeParseTopics(r.topics)) {
      const idfWeight = useIdf ? (corpus.topicIdf.get(t) ?? 0) : 1
      if (useIdf && idfWeight <= 0) continue
      raw.set(t, (raw.get(t) ?? 0) + w * idfWeight)
    }
  }
  return normalize(raw)
}

export function scoreTopic(candidateTopics: string[], affinity: Map<string, number>): number {
  let total = 0
  for (const t of candidateTopics) {
    total += affinity.get(t) ?? 0
  }
  return Math.min(1.0, total)
}
