// electron/services/diversityReranker.ts

interface SimRepo {
  topics: string[]
  bucket: string | null
  sub: string | null
  language: string | null
}

export function repoSimilarity(a: SimRepo, b: SimRepo): number {
  const setA = new Set(a.topics)
  const setB = new Set(b.topics)
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  const jaccard = union === 0 ? 0 : intersection / union

  let score = jaccard * 0.5
  if (a.bucket && a.bucket === b.bucket) score += 0.25
  if (a.sub    && a.sub    === b.sub)    score += 0.20
  if (a.language && a.language === b.language) score += 0.05
  return score
}

interface RerankItem {
  score: number
  repo: SimRepo & { id: string }
}

export interface MmrOptions {
  topK: number
  lambda: number
}

export function mmrRerank<T extends RerankItem>(items: T[], opts: MmrOptions): T[] {
  const remaining = [...items]
  const selected: T[] = []
  const lambda = opts.lambda

  while (remaining.length > 0 && selected.length < opts.topK) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      let maxSim = 0
      for (const s of selected) {
        const sim = repoSimilarity(cand.repo, s.repo)
        if (sim > maxSim) maxSim = sim
      }
      const mmrScore = lambda * cand.score - (1 - lambda) * maxSim
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i }
    }
    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}
