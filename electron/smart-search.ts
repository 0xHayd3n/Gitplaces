import { searchRepos as githubSearch } from './providers/github'

export interface SearchResult {
  id: number
  full_name: string
  owner: { login: string }
  name: string
  description: string | null
  language: string | null
  topics: string[]
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  pushed_at: string
  size: number
  default_branch: string
  score?: number
}

export interface SearchFilters {
  /** Map to pushed:>DATE */
  activity?: 'week' | 'month' | 'halfyear'
  /** Map to stars:>N */
  stars?: 100 | 1000 | 10000
  /** Map to license:SPDX-ID */
  license?: string
  /** Map to topic:X (each topic appended separately) */
  topics?: string[]
}

/** Build GitHub qualifier string from filter values (appended to query). */
export function buildFilterQuery(filters?: SearchFilters): string {
  if (!filters) return ''
  const parts: string[] = []

  if (filters.activity) {
    const since = new Date()
    if (filters.activity === 'week')     since.setDate(since.getDate() - 7)
    else if (filters.activity === 'month')    since.setDate(since.getDate() - 30)
    else if (filters.activity === 'halfyear') since.setDate(since.getDate() - 180)
    parts.push(`pushed:>${since.toISOString().split('T')[0]}`)
  }

  if (filters.stars) {
    parts.push(`stars:>${filters.stars}`)
  }

  if (filters.license) {
    parts.push(`license:${filters.license}`)
  }

  if (filters.topics && filters.topics.length > 0) {
    for (const t of filters.topics) {
      parts.push(`topic:${t}`)
    }
  }

  return parts.join(' ')
}

// Raw search — single query, fast
export async function rawSearch(
  token: string | null,
  query: string,
  language?: string,
  filters?: SearchFilters,
  page = 1,
): Promise<SearchResult[]> {
  let q = query
  if (language) q += ` language:${language}`
  const fq = buildFilterQuery(filters)
  if (fq) q += ` ${fq}`
  return githubSearch(token, q, 100, undefined, undefined, page) as Promise<SearchResult[]>
}

// Natural language search — multi-query with tags
export async function tagSearch(
  token: string | null,
  tags: string[],
  originalQuery: string,
  language?: string,
  filters?: SearchFilters,
  page = 1,
): Promise<SearchResult[]> {
  const langSuffix   = language ? ` language:${language}` : ''
  const filterSuffix = filters  ? ` ${buildFilterQuery(filters)}` : ''
  const suffix       = langSuffix + filterSuffix

  const topicQuery   = tags.slice(0, 3).map(t => `topic:${t}`).join(' ')
  const keywordQuery = tags.slice(0, 4).join(' ')

  const queries = [
    topicQuery   ? topicQuery   + suffix : null,
    keywordQuery ? keywordQuery + suffix : null,
    originalQuery + suffix,
  ].filter(Boolean) as string[]

  const results = await Promise.allSettled(
    queries.map(q => githubSearch(token, q, 100, undefined, undefined, page) as Promise<SearchResult[]>)
  )

  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const repo of result.value) {
        if (!seen.has(repo.full_name)) {
          seen.add(repo.full_name)
          merged.push(repo)
        }
      }
    }
  }

  return rankResults(merged, tags)
}

// Exported for testing
export function rankResults(repos: SearchResult[], tags: string[]): SearchResult[] {
  const now = Date.now()

  return repos
    .map(repo => {
      let score = 0

      const repoTopics = repo.topics ?? []
      const tagMatchCount = tags.filter(tag =>
        repoTopics.some(t => t.includes(tag) || tag.includes(t))
      ).length
      score += tagMatchCount * 30

      const pushedDaysAgo = (now - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24)
      if (pushedDaysAgo < 7)   score += 20
      else if (pushedDaysAgo < 30)  score += 10
      else if (pushedDaysAgo < 180) score += 5

      score += Math.log10(Math.max(repo.stargazers_count, 1)) * 8

      if (tagMatchCount >= 3 && repo.stargazers_count < 5000) score += 15
      if (tagMatchCount >= 4 && repo.stargazers_count < 1000) score += 20

      if (repo.size > 500000) score -= 10

      return { ...repo, score }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}
