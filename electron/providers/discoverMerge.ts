// electron/providers/discoverMerge.ts
//
// Multi-host Discover merger. Fans out a UnifiedQuery across every configured
// host via getAnyProvider().searchRepos, caps each host's contribution at
// capPerHost, soft-times-out slow hosts, merges by pushedAt desc, and slices
// to totalLimit. The Discover home rows call this through repo:searchAll.

import type { Repo } from '../../src/types/repo'
import type { HostInstance, HostType } from './types'
import { getAnyProvider } from './registry'

export type UnifiedQuery =
  | { kind: 'trending-week' }
  | { kind: 'hot-today' }
  | { kind: 'hidden-gems' }
  | { kind: 'popular' }
  | { kind: 'topic'; topic: string }
  | { kind: 'free-text'; freeText: string }

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
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().split('T')[0]
}

export function translateQuery(hostType: HostType, q: UnifiedQuery): TranslatedQuery {
  if (hostType === 'github') {
    switch (q.kind) {
      case 'trending-week': return { query: `created:>${daysAgo(7)}`, sort: 'stars', order: 'desc' }
      case 'hot-today':     return { query: `pushed:>${daysAgo(1)}`,  sort: 'updated', order: 'desc' }
      case 'hidden-gems':   return { query: 'stars:50..500',          sort: 'stars',   order: 'desc' }
      case 'popular':       return { query: 'stars:>100',             sort: 'stars',   order: 'desc' }
      case 'topic':         return { query: `topic:${q.topic}`,       sort: 'stars',   order: 'desc' }
      case 'free-text':     return { query: q.freeText,                sort: 'stars',   order: 'desc' }
    }
  }
  // GitLab + Gitea: free-text search; we let recency sort do the heavy lifting
  // and rank by pushedAt at merge. Per-host date-range filtering is a Phase 7
  // polish item (each host's query syntax is coarser than GitHub's).
  switch (q.kind) {
    case 'trending-week':
    case 'hot-today':     return { query: '', sort: 'updated', order: 'desc' }
    case 'hidden-gems':   return { query: '', sort: 'stars',   order: 'desc' }
    case 'popular':       return { query: '', sort: 'stars',   order: 'desc' }
    case 'topic':         return { query: q.topic,    sort: 'stars', order: 'desc' }
    case 'free-text':     return { query: q.freeText, sort: 'stars', order: 'desc' }
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
    return result.slice(0, opts.capPerHost)
  }))

  const merged = perHost.flat()
  merged.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
  return merged.slice(0, opts.totalLimit)
}
