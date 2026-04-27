// electron/services/corpusStats.ts
import type { CorpusStats } from '../../src/types/recommendation'
import { tokenizeDescription } from './signals/descriptionSignal'

interface RepoLike {
  topics: string | null
  description: string | null
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

export function computeCorpusStats(repos: RepoLike[]): CorpusStats {
  const topicDocFrequency = new Map<string, number>()
  const descriptionDocFrequency = new Map<string, number>()

  for (const r of repos) {
    const topics = new Set(safeParseTopics(r.topics))
    for (const t of topics) {
      topicDocFrequency.set(t, (topicDocFrequency.get(t) ?? 0) + 1)
    }
    const tokens = new Set(tokenizeDescription(r.description))
    for (const tok of tokens) {
      descriptionDocFrequency.set(tok, (descriptionDocFrequency.get(tok) ?? 0) + 1)
    }
  }

  const totalRepos = repos.length
  const topicIdf = new Map<string, number>()
  for (const [t, df] of topicDocFrequency) {
    topicIdf.set(t, Math.log(totalRepos / (1 + df)))
  }
  const descriptionIdf = new Map<string, number>()
  for (const [t, df] of descriptionDocFrequency) {
    descriptionIdf.set(t, Math.log(totalRepos / (1 + df)))
  }

  return { topicDocFrequency, topicIdf, descriptionDocFrequency, descriptionIdf, totalRepos }
}
