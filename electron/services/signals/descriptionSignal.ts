// electron/services/signals/descriptionSignal.ts
import { STOPWORDS } from './descriptionStopwords'
import type { CorpusStats } from '../../../src/types/recommendation'

const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000
const IDF_FALLBACK_THRESHOLD = 100
const MAX_TOKENS_PER_REPO = 50
const MIN_TOKEN_LEN = 3

interface RepoLike {
  description: string | null
  starred_at: string | null
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

export function tokenizeDescription(desc: string | null): string[] {
  if (!desc) return []
  const tokens: string[] = []
  for (const raw of desc.toLowerCase().split(/\W+/)) {
    if (raw.length < MIN_TOKEN_LEN) continue
    if (STOPWORDS.has(raw)) continue
    tokens.push(raw)
    if (tokens.length >= MAX_TOKENS_PER_REPO) break
  }
  return tokens
}

export function buildDescriptionAffinity(
  userRepos: RepoLike[],
  corpus: CorpusStats,
  now: number,
): Map<string, number> {
  const useIdf = corpus.totalRepos >= IDF_FALLBACK_THRESHOLD
  const raw = new Map<string, number>()
  for (const r of userRepos) {
    const w = recencyWeight(r.starred_at, now)
    const seen = new Set<string>()
    for (const tok of tokenizeDescription(r.description)) {
      if (seen.has(tok)) continue
      seen.add(tok)
      const idfWeight = useIdf ? (corpus.descriptionIdf.get(tok) ?? 0) : 1
      if (useIdf && idfWeight <= 0) continue
      raw.set(tok, (raw.get(tok) ?? 0) + w * idfWeight)
    }
  }
  return normalize(raw)
}

export function scoreDescription(
  candidateTokens: string[],
  affinity: Map<string, number>,
): number {
  let total = 0
  const seen = new Set<string>()
  for (const tok of candidateTokens) {
    if (seen.has(tok)) continue
    seen.add(tok)
    total += affinity.get(tok) ?? 0
  }
  return Math.min(1.0, total)
}
