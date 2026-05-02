// electron/githubFetch.ts
//
// ETag-aware wrapper around `fetch` for GitHub REST endpoints.
//
// GitHub supports conditional requests: send `If-None-Match: <etag>` and the
// server returns 304 Not Modified when the resource is unchanged — and a 304
// does NOT count against the primary rate limit (only the 5 search-API calls
// have their own separate budget).
//
// On a typical "user revisits a repo" flow this means we make the *same* HTTP
// requests as before, but most of them are 304s — effectively free. The data
// itself is served from the local SQLite cache.
//
// Usage from inside main-process services:
//
//   import { getDb } from './db'
//   import { etagFetch } from './githubFetch'
//   const db = getDb(...)
//   const res = await etagFetch(db, url, { headers: githubHeaders(token) })
//   // `res` looks like a normal Response. If GitHub returned 304, the body
//   // comes from the cache and `res.fromCache === true`.
//
// The wrapper:
//   1. Reads any cached etag for the URL.
//   2. Adds `If-None-Match: <etag>` to the request headers.
//   3. On 200: stores the new etag + body, returns a Response built from the body.
//   4. On 304: returns a Response built from the cached body.
//   5. On any other status / network error: passes through unchanged.

import type Database from 'better-sqlite3'

interface CachedRow {
  etag: string
  body: string
  fetched_at: number
}

export interface ConditionalResponse {
  /** True when the response body came from the local cache (HTTP 304). */
  fromCache: boolean
  /** HTTP status of the upstream response (200, 304, or whatever else). */
  status: number
  /** Response headers as exposed by `fetch`. Note: a Response built from a
   *  cached body will lose Link/X-RateLimit headers. Callers that need those
   *  must use `fetch` directly. */
  headers: Headers
  /** Resolved JSON. `null` if the body wasn't valid JSON (or upstream errored). */
  json: () => Promise<unknown>
  /** Raw response body as text. */
  text: () => Promise<string>
}

function readCache(db: Database.Database, url: string): CachedRow | null {
  const row = db.prepare(
    'SELECT etag, body, fetched_at FROM http_etag_cache WHERE url = ?'
  ).get(url) as CachedRow | undefined
  return row ?? null
}

function writeCache(db: Database.Database, url: string, etag: string, body: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO http_etag_cache (url, etag, body, fetched_at) VALUES (?,?,?,?)'
  ).run(url, etag, body, Date.now())
}

export async function etagFetch(
  db: Database.Database,
  url: string,
  init: RequestInit = {},
): Promise<ConditionalResponse> {
  const cached = readCache(db, url)

  // Merge If-None-Match into existing headers without clobbering caller-set ones.
  const headers = new Headers(init.headers)
  if (cached && !headers.has('If-None-Match')) {
    headers.set('If-None-Match', cached.etag)
  }

  const res = await fetch(url, { ...init, headers })

  // 304 — server says nothing changed. Use the cached body. No rate-limit hit.
  if (res.status === 304 && cached) {
    return {
      fromCache: true,
      status: 304,
      headers: res.headers,
      json: async () => { try { return JSON.parse(cached.body) } catch { return null } },
      text: async () => cached.body,
    }
  }

  // 200 — stash the new etag/body for next time.
  if (res.ok) {
    const body = await res.text()
    const etag = res.headers.get('ETag')
    if (etag) writeCache(db, url, etag, body)
    return {
      fromCache: false,
      status: res.status,
      headers: res.headers,
      json: async () => { try { return JSON.parse(body) } catch { return null } },
      text: async () => body,
    }
  }

  // Anything else (4xx, 5xx, network errors that didn't throw): pass through
  // without caching. We DO read the body once so the caller can json()/text() it.
  const body = await res.text().catch(() => '')
  return {
    fromCache: false,
    status: res.status,
    headers: res.headers,
    json: async () => { try { return JSON.parse(body) } catch { return null } },
    text: async () => body,
  }
}
