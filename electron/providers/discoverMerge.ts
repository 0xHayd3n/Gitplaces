// electron/providers/discoverMerge.ts
//
// Multi-host Discover merger. Fans out a UnifiedQuery across every configured
// host via getAnyProvider().searchRepos, caps each host's contribution at
// capPerHost, soft-times-out slow hosts, merges by pushedAt desc, and slices
// to totalLimit. The Discover home rows call this through repo:searchAll.

import type { Repo } from '../../src/types/repo'
import type { HostInstance, HostType } from './types'
import { getAnyProvider } from './registry'

export interface UnifiedFilters {
  language?: string
  minStars?: number
  license?: string
  activityWindow?: 'week' | 'month' | 'halfyear'
}

export type UnifiedQuery =
  | { kind: 'trending-week'; filters?: UnifiedFilters }
  | { kind: 'hot-today'; filters?: UnifiedFilters }
  | { kind: 'hidden-gems'; filters?: UnifiedFilters }
  | { kind: 'popular'; filters?: UnifiedFilters }
  | { kind: 'topic'; topic: string; filters?: UnifiedFilters }
  | { kind: 'free-text'; freeText: string; filters?: UnifiedFilters }

export interface SearchAllOpts {
  capPerHost: number
  totalLimit: number
  /** Soft timeout per host. Hosts that take longer contribute nothing this round. */
  timeoutMs?: number
  /** Optional token lookup. Returns null if the host is unauthenticated (anonymous mode). */
  tokenForHost?: (hostId: string) => string | null
  /** 1-indexed page number passed to every per-host search. Each host's REST
   *  pagination has different page sizes, so a single `page` here means
   *  "next batch from every host" rather than a globally consistent offset. */
  page?: number
}

interface TranslatedQuery {
  query: string
  sort: string
  order: 'asc' | 'desc'
  /** When set, applied to each per-host result list before the host's
   *  contribution is sliced to capPerHost. Used by GitLab/Gitea to enforce
   *  filters their search API can't express natively (minStars, license,
   *  activity window). GitHub returns undefined here — its query qualifiers
   *  do native filtering. */
  postFilter?: (repo: Repo) => boolean
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().split('T')[0]
}

function activityCutoffMs(window: UnifiedFilters['activityWindow']): number | null {
  switch (window) {
    case 'week':     return 7 * 86400_000
    case 'month':    return 30 * 86400_000
    case 'halfyear': return 182 * 86400_000
    default:         return null
  }
}

function activityWindowDays(w: UnifiedFilters['activityWindow']): number {
  switch (w) {
    case 'week':     return 7
    case 'month':    return 30
    case 'halfyear': return 182
    default:         return 365
  }
}

function makePostFilter(filters: UnifiedFilters | undefined): TranslatedQuery['postFilter'] | undefined {
  if (!filters) return undefined
  const { minStars, license, activityWindow, language } = filters
  const activityMs = activityCutoffMs(activityWindow)
  if (minStars == null && !license && activityMs == null && !language) return undefined
  return (r: Repo) => {
    if (minStars != null && r.stars < minStars) return false
    if (license && (r.license ?? '').toLowerCase() !== license.toLowerCase()) return false
    if (language && (r.language ?? '').toLowerCase() !== language.toLowerCase()) return false
    if (activityMs != null) {
      const pushedAt = r.pushedAt ? new Date(r.pushedAt).getTime() : 0
      if (Date.now() - pushedAt > activityMs) return false
    }
    return true
  }
}

function githubFilterQualifiers(filters: UnifiedFilters | undefined): string {
  if (!filters) return ''
  const parts: string[] = []
  if (filters.language) parts.push(`language:${filters.language}`)
  if (filters.minStars != null) parts.push(`stars:>=${filters.minStars}`)
  if (filters.license) parts.push(`license:${filters.license}`)
  if (filters.activityWindow) {
    parts.push(`pushed:>${daysAgo(activityWindowDays(filters.activityWindow))}`)
  }
  return parts.join(' ')
}

export function translateQuery(hostType: HostType, q: UnifiedQuery): TranslatedQuery {
  const filterQuals = githubFilterQualifiers(q.filters)
  const compose = (base: string): string => [base, filterQuals].filter(Boolean).join(' ')

  if (hostType === 'github') {
    switch (q.kind) {
      case 'trending-week': return { query: compose(`created:>${daysAgo(7)}`), sort: 'stars', order: 'desc' }
      case 'hot-today':     return { query: compose(`pushed:>${daysAgo(1)}`),  sort: 'updated', order: 'desc' }
      case 'hidden-gems':   return { query: compose('stars:50..500'),          sort: 'stars',   order: 'desc' }
      case 'popular':       return { query: compose('stars:>100'),             sort: 'stars',   order: 'desc' }
      case 'topic':         return { query: compose(`topic:${q.topic}`),       sort: 'stars',   order: 'desc' }
      case 'free-text':     return { query: compose(q.freeText),                sort: 'stars',   order: 'desc' }
    }
  }
  // GitLab + Gitea: encode language natively as the search string when no
  // other query is present; push the remaining filters (minStars, license,
  // activityWindow, language exact match) into postFilter for client-side
  // filtering after the per-host fetch.
  const postFilter = makePostFilter(q.filters)
  switch (q.kind) {
    case 'trending-week':
    case 'hot-today':     return { query: q.filters?.language ?? '', sort: 'updated', order: 'desc', postFilter }
    case 'hidden-gems':   return { query: q.filters?.language ?? '', sort: 'stars',   order: 'desc', postFilter }
    case 'popular':       return { query: q.filters?.language ?? '', sort: 'stars',   order: 'desc', postFilter }
    case 'topic':         return { query: q.topic,    sort: 'stars', order: 'desc', postFilter }
    case 'free-text':     return { query: q.freeText, sort: 'stars', order: 'desc', postFilter }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(v => { clearTimeout(timer); resolve(v) })
     .catch(() => { clearTimeout(timer); resolve(null) })
  })
}

export async function searchAllHosts(
  hosts: HostInstance[],
  query: UnifiedQuery,
  opts: SearchAllOpts,
): Promise<Repo[]> {
  const timeout = opts.timeoutMs ?? 4000
  const tokenForHost = opts.tokenForHost ?? (() => null)
  const page = opts.page ?? 1

  const perHost = await Promise.all(hosts.map(async (host) => {
    const provider = getAnyProvider(host.id)
    if (!provider) return []
    const translated = translateQuery(host.type, query)
    const token = tokenForHost(host.id)
    const work = (provider.searchRepos as (
      token: string | null,
      query: string,
      perPage: number,
      sort: string,
      order: string,
      page: number,
    ) => Promise<Repo[]>)(token, translated.query, opts.capPerHost, translated.sort, translated.order, page)
    const result = await withTimeout(work, timeout)
    if (!Array.isArray(result)) return []
    const filtered = translated.postFilter ? result.filter(translated.postFilter) : result
    return filtered.slice(0, opts.capPerHost)
  }))

  const merged = perHost.flat()
  merged.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
  return merged.slice(0, opts.totalLimit)
}
