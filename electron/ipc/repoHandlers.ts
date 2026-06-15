// electron/ipc/repoHandlers.ts
//
// Host-id-aware mirror of the legacy github:* IPC channels. For Phase 3 only
// GitHub is registered, so every channel delegates to the GitHub provider when
// called with HOST_ID_GITHUB. Phases 4-5 will add GitLab/Gitea providers; this
// file does not need changes for them — the registry resolution handles it.

import { ipcMain, app } from 'electron'
import { getDb } from '../db'
import { getProvider, getAnyProvider, type AnyProvider } from '../providers/registry'
import { getToken } from '../providers/tokenStore'
import { HOST_ID_GITHUB } from '../providers/types'
import {
  githubReleaseToRelease,
  githubRepoToRepo,
} from '../providers/github/normalize'
import { listHosts } from '../providers/hostConfig'
import { searchAllHosts, type UnifiedQuery } from '../providers/discoverMerge'
import { repoRowToSavedRepo } from '../repoNormalize'
import { classifyRepoBucket } from '../../src/lib/classifyRepoType'
import { extractDominantColor } from '../color-extractor'
import { poolAll } from '../concurrency'
import { cascadeRepoId, readLastCommitCache, writeLastCommitCache, readCompareCache, writeCompareCache, repoRowId } from '../db-helpers'
import { getRepoUserEvents } from '../services/repoUserEvents'
import { getRepoStats, getRepoMomentum } from '../services/repoStats'
import { checkIsFork } from '../services/updateService'
import { enqueueRepo } from '../services/verificationService'
import { LRUCache } from '../lruCache'
import type { RepoRow } from '../db-row-types'
import type { GitHubProvider, LastCommitInfo, CompareSummary } from '../providers/github'
import type { Repo, SavedRepo, StarredEntry } from '../../src/types/repo'

/** Narrow accessor: returns only when the host is GitHub. Use for handlers
 *  that call GitHub-specific methods (fetchBundle, getCompare, getReceivedEvents,
 *  getMyRepos, compareRefs, getLastCommitsForPaths). */
function resolve(hostId: string): { provider: GitHubProvider; token: string | null } {
  const provider = getProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider, token }
}

/** Wide accessor: returns any registered provider. Use for handlers whose
 *  contract maps onto every host (getReadme, getReleases, star, etc.). */
function resolveAny(hostId: string): { provider: AnyProvider; token: string | null } {
  const provider = getAnyProvider(hostId)
  if (!provider) throw new Error(`Unknown host: ${hostId}`)
  const token = getToken(hostId)
  return { provider, token }
}

/** Shared upsert helper for `repo:search` and `repo:searchAll`. Writes each
 *  canonical Repo into the DB tagged with its hostId, kicks off background
 *  banner-color extraction, and returns the resulting SavedRepo[] (read back
 *  from the DB so caller-visible state matches whatever discovered_at /
 *  banner_color / saved_at the row had). */
function upsertReposToDb(
  db: ReturnType<typeof getDb>,
  items: Repo[],
  discoverQuery: string,
): SavedRepo[] {
  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO repos (id, host_id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      host_id        = excluded.host_id,
      owner          = excluded.owner,
      name           = excluded.name,
      description    = excluded.description,
      language       = excluded.language,
      topics         = excluded.topics,
      stars          = excluded.stars,
      forks          = excluded.forks,
      updated_at     = excluded.updated_at,
      pushed_at      = excluded.pushed_at,
      created_at     = excluded.created_at,
      discovered_at  = excluded.discovered_at,
      discover_query = excluded.discover_query,
      watchers       = excluded.watchers,
      size           = excluded.size,
      open_issues    = excluded.open_issues,
      default_branch = excluded.default_branch,
      avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
      saved_at       = repos.saved_at,
      banner_color   = repos.banner_color,
      type_bucket    = excluded.type_bucket,
      type_sub       = excluded.type_sub
  `)

  db.transaction(() => {
    for (const repo of items) {
      const rid = repoRowId(repo.hostId, repo.hostNativeId)
      cascadeRepoId(db, repo.owner, repo.name, rid)
      const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: repo.topics })
      upsert.run(
        rid, repo.hostId, repo.owner, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics), repo.stars, repo.forks,
        repo.license, repo.homepageUrl, repo.updatedAt, repo.pushedAt,
        repo.createdAt,
        now, discoverQuery, repo.watchers, repo.size, repo.openIssues,
        repo.defaultBranch, repo.ownerAvatarUrl,
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()

  setImmediate(() => {
    void poolAll(items.filter(r => r.ownerAvatarUrl), 3, async (repo) => {
      const row = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(repo.owner, repo.name) as { banner_color: string | null } | undefined
      if (row?.banner_color) return
      const color = await extractDominantColor(repo.ownerAvatarUrl)
      db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
        .run(JSON.stringify(color), repo.owner, repo.name)
    })
  })

  return items
    .map(r => db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(r.owner, r.name) as RepoRow | undefined)
    .filter((row): row is RepoRow => Boolean(row))
    .map(repoRowToSavedRepo)
}

// ── In-memory caches (mirror the github:* equivalents in main.ts) ────────────
const searchReposCache = new LRUCache<string, { rows: SavedRepo[]; ts: number }>(20)
const SEARCH_REPOS_TTL = 10 * 60 * 1000 // 10 minutes
const REPO_FETCH_TTL_MS = 30 * 60 * 1000
const RELEASES_CACHE_TTL_MS = 60 * 60 * 1000
const STAR_CHECK_TTL_MS = 30 * 60 * 1000
const COMPARE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const treeCache = new LRUCache<string, import('../providers/github').TreeEntry[]>(100)
const blobCache = new LRUCache<string, import('../providers/github').BlobResult>(50)
const branchCache = new LRUCache<string, { rootTreeSha: string; timestamp: number }>(50)
const BRANCH_TTL = 5 * 60 * 1000

export function registerRepoHandlers(): void {
  // ── Read ────────────────────────────────────────────────────────
  ipcMain.handle('repo:get', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    // GitHub aggressively rate-limits anonymous reads; the historical behaviour
    // is to bail early and surface the null to the renderer (which then shows a
    // login prompt). GitLab and Gitea serve public repos anonymously — let those
    // hosts through so Codeberg browsing works before the user pastes a PAT.
    if (!token && hostId === HOST_ID_GITHUB) return null
    const db = getDb(app.getPath('userData'))

    const fresh = db.prepare(
      'SELECT * FROM repos WHERE owner = ? AND name = ? AND fetched_at IS NOT NULL AND fetched_at > ?'
    ).get(owner, name, Date.now() - REPO_FETCH_TTL_MS) as RepoRow | undefined
    if (fresh) return repoRowToSavedRepo(fresh)

    let repo: Repo
    try {
      // GitHub's narrow surface still exposes the raw getRepo for the GraphQL
      // bundle path; getRepoNormalized wraps it. GitLab/Gitea only expose
      // getRepo (already canonical). The `in` check dispatches at runtime.
      repo = await ('getRepoNormalized' in provider
        ? provider.getRepoNormalized(token, owner, name, db)
        : provider.getRepo(token, owner, name))
    } catch {
      const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
      return row ? repoRowToSavedRepo(row) : null
    }

    const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: repo.topics })
    const rid = repoRowId(hostId, repo.hostNativeId)
    cascadeRepoId(db, owner, name, rid)
    db.prepare(`
      INSERT INTO repos (id, host_id, owner, name, description, language, topics, stars, forks, license,
                         homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                         discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                         type_bucket, type_sub)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        host_id        = excluded.host_id,
        owner          = excluded.owner,
        name           = excluded.name,
        description    = excluded.description,
        language       = excluded.language,
        topics         = excluded.topics,
        stars          = excluded.stars,
        forks          = excluded.forks,
        updated_at     = excluded.updated_at,
        pushed_at      = excluded.pushed_at,
        created_at     = excluded.created_at,
        watchers       = excluded.watchers,
        size           = excluded.size,
        open_issues    = excluded.open_issues,
        default_branch = excluded.default_branch,
        avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
        saved_at       = repos.saved_at,
        discovered_at  = repos.discovered_at,
        discover_query = repos.discover_query,
        banner_color   = repos.banner_color,
        type_bucket    = excluded.type_bucket,
        type_sub       = excluded.type_sub
    `).run(
      rid, hostId, owner, name, repo.description, repo.language,
      JSON.stringify(repo.topics), repo.stars, repo.forks,
      repo.license, repo.homepageUrl, repo.updatedAt, repo.pushedAt,
      repo.createdAt,
      repo.watchers, repo.size, repo.openIssues,
      repo.defaultBranch, repo.ownerAvatarUrl,
      classified?.bucket ?? null, classified?.subType ?? null,
    )

    db.prepare('UPDATE repos SET fetched_at = ? WHERE owner = ? AND name = ?')
      .run(Date.now(), owner, name)

    if (repo.ownerAvatarUrl) {
      const existing = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(owner, name) as { banner_color: string | null } | undefined
      if (!existing?.banner_color) {
        extractDominantColor(repo.ownerAvatarUrl)
          .then(color => {
            db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
              .run(JSON.stringify(color), owner, name)
          })
          .catch(() => {/* non-critical */})
      }
    }

    const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
    return row ? repoRowToSavedRepo(row) : null
  })

  ipcMain.handle('repo:search', async (_event, hostId: string, query: string, sort?: string, order?: string, page?: number) => {
    const { provider, token } = resolveAny(hostId)
    if (!token) return []
    const cacheKey = `${hostId}:${query}:${sort ?? 'stars'}:${order ?? 'desc'}:${page ?? 1}`

    const cached = searchReposCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < SEARCH_REPOS_TTL) {
      return cached.rows
    }

    let items: Repo[]
    try {
      items = await ('searchReposNormalized' in provider
        ? provider.searchReposNormalized(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1)
        : provider.searchRepos(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1))
    } catch (err) {
      const msg = String(err)
      if (/\b(403|429)\b/.test(msg)) {
        if (cached) return cached.rows
        const db = getDb(app.getPath('userData'))
        const langMatch = query.match(/\blanguage:([^\s]+)/i)
        const lang = langMatch ? langMatch[1] : null
        let rows: RepoRow[] = []
        if (lang) {
          rows = db.prepare('SELECT * FROM repos WHERE LOWER(language) = LOWER(?) ORDER BY stars DESC LIMIT 100').all(lang) as RepoRow[]
        }
        if (rows.length === 0) {
          rows = db.prepare('SELECT * FROM repos WHERE stars IS NOT NULL ORDER BY stars DESC LIMIT 100').all() as RepoRow[]
        }
        if (rows.length === 0) {
          rows = db.prepare('SELECT * FROM repos ORDER BY discovered_at DESC LIMIT 100').all() as RepoRow[]
        }
        return rows.map(repoRowToSavedRepo)
      }
      throw err
    }
    if (items.length === 0) return []

    const db = getDb(app.getPath('userData'))
    const rows = upsertReposToDb(db, items, query)
    searchReposCache.set(cacheKey, { rows, ts: Date.now() })
    return rows
  })

  ipcMain.handle('repo:searchAll', async (_event, query: UnifiedQuery, page?: number): Promise<SavedRepo[]> => {
    const hosts = listHosts()
    const items = await searchAllHosts(hosts, query, {
      capPerHost: 10,
      totalLimit: 30,
      timeoutMs: 4000,
      tokenForHost: (id) => getToken(id),
      page: page ?? 1,
    })
    if (items.length === 0) return []
    const db = getDb(app.getPath('userData'))
    return upsertReposToDb(db, items, JSON.stringify(query))
  })

  ipcMain.handle('repo:getReadme', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    return provider.getReadme(token, owner, name)
  })

  ipcMain.handle('repo:getFileContent', async (_event, hostId: string, owner: string, name: string, path: string) => {
    const { provider, token } = resolveAny(hostId)
    return provider.getFileContent(token, owner, name, path)
  })

  ipcMain.handle('repo:getReleases', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    if (!token) return []
    const db = getDb(app.getPath('userData'))

    const cached = db.prepare(
      'SELECT fetched_at, data FROM repo_releases_cache WHERE owner=? AND name=?'
    ).get(owner, name) as { fetched_at: number; data: string } | undefined
    if (cached && Date.now() - cached.fetched_at < RELEASES_CACHE_TTL_MS) {
      try {
        const parsed = JSON.parse(cached.data) as unknown[]
        // The cached blob may be raw `GitHubRelease[]` (snake_case) from GitHub
        // OR canonical `Release[]` (camelCase) from GitLab/Gitea. Discriminate
        // by checking for `tag_name` on the first row.
        return Array.isArray(parsed) && parsed.length > 0 && parsed[0] && 'tag_name' in (parsed[0] as object)
          ? (parsed as import('../providers/github').GitHubRelease[]).map(githubReleaseToRelease)
          : parsed as import('../../src/types/repo').Release[]
      } catch { /* fall through to refetch */ }
    }

    try {
      // GitHub's getReleases returns raw `GitHubRelease[]` (snake_case). GitLab
      // and Gitea already return canonical `Release[]`. We persist raw shapes
      // for GitHub (so the JSON cache round-trips through the existing
      // normalizer) and canonical shapes for the others.
      const fresh = await provider.getReleases(token, owner, name, db)
      db.prepare(
        'INSERT OR REPLACE INTO repo_releases_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
      ).run(owner, name, Date.now(), JSON.stringify(fresh))
      return Array.isArray(fresh) && fresh.length > 0 && 'tag_name' in fresh[0]
        ? (fresh as import('../providers/github').GitHubRelease[]).map(githubReleaseToRelease)
        : fresh as import('../../src/types/repo').Release[]
    } catch {
      if (cached) {
        try {
          const parsed = JSON.parse(cached.data) as import('../providers/github').GitHubRelease[]
          return parsed.map(githubReleaseToRelease)
        } catch { /* fall through */ }
      }
      return null
    }
  })

  ipcMain.handle('repo:getBranch', async (_event, hostId: string, owner: string, name: string, branch: string) => {
    const key = `${owner}/${name}/${branch}`
    const cached = branchCache.get(key)
    if (cached && Date.now() - cached.timestamp < BRANCH_TTL) {
      return { rootTreeSha: cached.rootTreeSha }
    }
    const { provider, token } = resolveAny(hostId)
    const result = await provider.getBranch(token, owner, name, branch)
    branchCache.set(key, { rootTreeSha: result.rootTreeSha, timestamp: Date.now() })
    return { rootTreeSha: result.rootTreeSha }
  })

  ipcMain.handle('repo:getTree', async (_event, hostId: string, owner: string, name: string, treeSha: string) => {
    const cached = treeCache.get(treeSha)
    if (cached) return cached
    const { provider, token } = resolveAny(hostId)
    const entries = await provider.getTreeBySha(token, owner, name, treeSha)
    // Normalize at the boundary: GitLab tree entries use `id` for the sha
    // field; GitHub and Gitea use `sha`. The canonical TreeEntry only models
    // blob + tree entries — submodule entries (type 'commit') aren't rendered
    // by the file browser, so they're filtered here rather than widening the
    // shared type.
    const normalized: import('../providers/github').TreeEntry[] = (entries as unknown[]).flatMap(e => {
      const v = e as { sha?: string; id?: string; path: string; type: string; mode: string; size?: number }
      if (v.type !== 'blob' && v.type !== 'tree') return []
      return [{ sha: v.sha ?? v.id ?? '', path: v.path, type: v.type, mode: v.mode, size: v.size }]
    })
    treeCache.set(treeSha, normalized)
    return normalized
  })

  ipcMain.handle('repo:getBlob', async (_event, hostId: string, owner: string, name: string, blobSha: string) => {
    const cached = blobCache.get(blobSha)
    if (cached) return cached
    const { provider, token } = resolveAny(hostId)
    const result = await provider.getBlobBySha(token, owner, name, blobSha)
    blobCache.set(blobSha, result)
    return result
  })

  ipcMain.handle('repo:getRawFile', async (_event, hostId: string, owner: string, name: string, branch: string, path: string) => {
    const { provider, token } = resolveAny(hostId)
    const buf = await provider.getRawFileBytes(token, owner, name, branch, path)
    return buf
  })

  ipcMain.handle('repo:getCompare', async (_event, hostId: string, owner: string, name: string, base: string, head: string) => {
    const key = `${owner}/${name}/${base}...${head}`
    const db = getDb(app.getPath('userData'))

    const row = db.prepare('SELECT data, fetched_at FROM compare_cache WHERE cache_key = ?').get(key) as
      | { data: string; fetched_at: string }
      | undefined

    if (row) {
      const age = Date.now() - new Date(row.fetched_at).getTime()
      if (age < COMPARE_CACHE_TTL_MS) {
        try {
          return JSON.parse(row.data) as CompareSummary
        } catch {
          db.prepare('DELETE FROM compare_cache WHERE cache_key = ?').run(key)
        }
      }
    }

    const { provider, token } = resolve(hostId)
    const summary = await provider.getCompare(token, owner, name, base, head)
    db.prepare('INSERT OR REPLACE INTO compare_cache (cache_key, data, fetched_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(summary), new Date().toISOString())
    return summary
  })

  ipcMain.handle('repo:compareRefs', async (
    _event,
    hostId: string,
    repoId: string,
    owner: string,
    name: string,
    base: string,
    head: string,
  ) => {
    const db = getDb(app.getPath('userData'))
    const cached = readCompareCache(db, repoId, base, head)
    if (cached) return cached
    const { provider, token } = resolve(hostId)
    try {
      const files = await provider.compareRefs(token, owner, name, base, head)
      writeCompareCache(db, repoId, base, head, files)
      return files
    } catch {
      return null
    }
  })

  ipcMain.handle('repo:getLastCommitsForPaths', async (
    _event,
    hostId: string,
    repoId: string,
    owner: string,
    name: string,
    ref: string,
    pathShas: { path: string; sha: string }[],
  ) => {
    const db = getDb(app.getPath('userData'))
    const result: Record<string, LastCommitInfo | null> = {}
    const missing: { path: string; sha: string }[] = []

    for (const { path, sha } of pathShas) {
      const cached = readLastCommitCache(db, repoId, sha, path)
      if (cached) {
        result[path] = cached
      } else {
        missing.push({ path, sha })
      }
    }

    if (missing.length === 0) return result

    const { provider, token } = resolve(hostId)
    if (!token) {
      for (const { path } of missing) result[path] = null
      return result
    }

    try {
      const fetched = await provider.fetchLastCommitsForPaths(
        token, owner, name, ref,
        missing.map(m => m.path),
      )
      for (const { path, sha } of missing) {
        const info = fetched.get(path) ?? null
        result[path] = info
        if (info) writeLastCommitCache(db, repoId, sha, path, info)
      }
    } catch {
      for (const { path } of missing) result[path] = null
    }

    return result
  })

  ipcMain.handle('repo:fetchBundle', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) return null
    const db = getDb(app.getPath('userData'))
    let bundle: Awaited<ReturnType<GitHubProvider['fetchRepoBundle']>>
    try {
      bundle = await provider.fetchRepoBundle(db, token, owner, name)
    } catch {
      return null
    }
    if (!bundle) return null

    const r = bundle.repo
    const classified = classifyRepoBucket({ name: r.name, description: r.description, topics: r.topics ?? [] })
    const rid = repoRowId(HOST_ID_GITHUB, r.id)
    cascadeRepoId(db, owner, name, rid)
    db.prepare(`
      INSERT INTO repos (id, host_id, owner, name, description, language, topics, stars, forks, license,
                         homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                         discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                         type_bucket, type_sub)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        host_id        = excluded.host_id,
        owner          = excluded.owner,
        name           = excluded.name,
        description    = excluded.description,
        language       = excluded.language,
        topics         = excluded.topics,
        stars          = excluded.stars,
        forks          = excluded.forks,
        updated_at     = excluded.updated_at,
        pushed_at      = excluded.pushed_at,
        created_at     = excluded.created_at,
        watchers       = excluded.watchers,
        size           = excluded.size,
        open_issues    = excluded.open_issues,
        default_branch = excluded.default_branch,
        avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
        saved_at       = repos.saved_at,
        discovered_at  = repos.discovered_at,
        discover_query = repos.discover_query,
        banner_color   = repos.banner_color,
        type_bucket    = excluded.type_bucket,
        type_sub       = excluded.type_sub
    `).run(
      rid, HOST_ID_GITHUB, owner, name, r.description, r.language,
      JSON.stringify(r.topics ?? []), r.stargazers_count, r.forks_count,
      r.license?.spdx_id ?? null, r.homepage, r.updated_at, r.pushed_at,
      r.created_at ?? null,
      r.watchers_count, r.size, r.open_issues_count,
      r.default_branch ?? 'main', r.owner.avatar_url ?? null,
      classified?.bucket ?? null, classified?.subType ?? null,
    )

    const now = Date.now()
    const starredAt = bundle.isStarred ? new Date().toISOString() : null
    db.prepare(
      'UPDATE repos SET fetched_at = ?, starred_checked_at = ?, starred_at = COALESCE(?, starred_at) WHERE owner = ? AND name = ?'
    ).run(now, now, starredAt, owner, name)

    db.prepare(
      'INSERT OR REPLACE INTO repo_releases_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
    ).run(owner, name, now, JSON.stringify(bundle.releases))

    const repoRow = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name) as RepoRow | undefined
    return {
      repoRow: repoRow ? repoRowToSavedRepo(repoRow) : null,
      releases: bundle.releases.map(githubReleaseToRelease),
      isStarred: bundle.isStarred,
      vulnerabilities: bundle.vulnerabilities,
      securityPolicyUrl: bundle.securityPolicyUrl,
      rootTree: bundle.rootTree,
    }
  })

  ipcMain.handle('repo:getReceivedEvents', async (_event, hostId: string, username: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) return []
    return provider.getReceivedEvents(token, username)
  })

  ipcMain.handle('repo:getMyRepos', async (_event, hostId: string) => {
    const { provider, token } = resolve(hostId)
    if (!token) throw new Error('Not authenticated')
    const repos = await provider.getMyRepos(token) as import('../providers/github').GitHubRepo[]
    return repos.map(githubRepoToRepo)
  })

  ipcMain.handle('repo:getMyStarred', async (_event, hostId: string, _force?: boolean): Promise<StarredEntry[]> => {
    const { provider, token } = resolveAny(hostId)
    if (!token) return []
    // GitHub's narrow surface still exposes raw getStarred for legacy callers;
    // getStarredNormalized wraps it. GitLab/Gitea getStarred returns canonical.
    return await ('getStarredNormalized' in provider
      ? provider.getStarredNormalized(token)
      : provider.getStarred(token))
  })

  // ── Mutate ──────────────────────────────────────────────────────
  ipcMain.handle('repo:star', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    if (!token) throw new Error('Not connected')
    await provider.starRepo(token, owner, name)
    const db = getDb(app.getPath('userData'))
    const now = new Date().toISOString()
    const updated = db.prepare(
      'UPDATE repos SET starred_at = ?, unstarred_at = NULL, starred_checked_at = ? WHERE owner = ? AND name = ?'
    ).run(now, Date.now(), owner, name)
    if (updated.changes === 0) {
      db.prepare(`
        INSERT INTO repos (id, owner, name, description, language, topics, stars, forks,
                           license, homepage, updated_at, saved_at, type, banner_svg, starred_at, starred_checked_at)
        VALUES (?, ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(`${owner}/${name}`, owner, name, now, Date.now())
    }
  })

  ipcMain.handle('repo:unstar', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    if (!token) throw new Error('Not connected')
    await provider.unstarRepo(token, owner, name)
    const db = getDb(app.getPath('userData'))
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE repos SET starred_at = NULL, unstarred_at = ?, starred_checked_at = ? WHERE owner = ? AND name = ?'
    ).run(now, Date.now(), owner, name)
  })

  ipcMain.handle('repo:isStarred', async (_event, hostId: string, owner: string, name: string) => {
    const { provider, token } = resolveAny(hostId)
    const db = getDb(app.getPath('userData'))

    const cached = db.prepare(
      'SELECT starred_at, starred_checked_at FROM repos WHERE owner=? AND name=?'
    ).get(owner, name) as { starred_at: string | null; starred_checked_at: number | null } | undefined
    if (cached?.starred_checked_at && Date.now() - cached.starred_checked_at < STAR_CHECK_TTL_MS) {
      return !!cached.starred_at
    }

    try {
      const live = await provider.isRepoStarred(token, owner, name)
      db.prepare('UPDATE repos SET starred_checked_at = ? WHERE owner=? AND name=?')
        .run(Date.now(), owner, name)
      return live
    } catch {
      return !!cached?.starred_at
    }
  })

  // ── Local DB ────────────────────────────────────────────────────
  ipcMain.handle('repo:save', async (_event, hostId: string, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    const ts = new Date().toISOString()
    const info = db.prepare('UPDATE repos SET saved_at = ? WHERE owner = ? AND name = ?')
      .run(ts, owner, name)
    if (info.changes === 0) throw new Error(`saveRepo: row not found for ${owner}/${name}`)
    const saved = db.prepare('SELECT id, language FROM repos WHERE owner = ? AND name = ?')
      .get(owner, name) as { id: string; language: string | null } | undefined
    if (!saved) throw new Error(`saveRepo: row not found for ${owner}/${name}`)
    enqueueRepo({ repoId: saved.id, owner, name, language: saved.language ?? null, priority: 'high' })
    setImmediate(async () => {
      let storedVersion: string | null = null
      try {
        const { provider, token } = resolveAny(hostId)
        const releases = await provider.getReleases(token, owner, name)
        if (Array.isArray(releases) && releases.length > 0) {
          // GitHubProvider.getReleases returns raw GitHubRelease[] (snake_case
          // `tag_name`). GitLab/Gitea providers return canonical Release[]
          // (camelCase `tagName`). Read whichever is present.
          const first = releases[0] as unknown as Record<string, unknown>
          storedVersion =
            (typeof first.tag_name === 'string' ? first.tag_name : null) ??
            (typeof first.tagName === 'string' ? first.tagName : null)
        }
      } catch {
        // Provider unknown or network failure — fall through to pushed_at.
      }
      if (!storedVersion) {
        const dbRow = db.prepare('SELECT pushed_at FROM repos WHERE owner = ? AND name = ?')
          .get(owner, name) as { pushed_at: string | null } | undefined
        storedVersion = dbRow?.pushed_at ?? null
      }
      const isFork = await checkIsFork(owner, name)
      db.prepare('UPDATE repos SET stored_version = ?, is_forked = ? WHERE owner = ? AND name = ?')
        .run(storedVersion, isFork ? 1 : 0, owner, name)
    })
  })

  ipcMain.handle('repo:getSaved', async () => {
    const db = getDb(app.getPath('userData'))
    return db.prepare('SELECT owner, name FROM repos WHERE saved_at IS NOT NULL').all()
  })

  ipcMain.handle('repo:getFeed', async () => {
    const db = getDb(app.getPath('userData'))
    return db.prepare(
      'SELECT owner, name FROM repos WHERE saved_at IS NOT NULL OR starred_at IS NOT NULL'
    ).all()
  })

  ipcMain.handle('repo:getRelated', async (_event, _hostId: string, owner: string, name: string, topicsJson: string) => {
    const db = getDb(app.getPath('userData'))
    const topics: string[] = (() => { try { return JSON.parse(topicsJson) } catch { return [] } })()
    const capped = topics.slice(0, 5)
    if (capped.length === 0) return []

    const escaped = capped.map(t => `%"${t.replace(/[%_]/g, '\\$&')}"%`)
    const placeholders = capped.map(() => `topics LIKE ? ESCAPE '\\'`).join(' OR ')
    const rows = db.prepare(
      `SELECT * FROM repos
       WHERE (${placeholders})
       AND NOT (owner = ? AND name = ?)
       ORDER BY stars DESC
       LIMIT 50`
    ).all(...escaped, owner, name) as RepoRow[]

    const seen = new Set<string>()
    return rows
      .filter((r) => {
        const key = `${r.owner}/${r.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 3)
      .map(repoRowToSavedRepo)
  })

  ipcMain.handle('repo:recordFork', async (_event, _hostId: string, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=? AND forked_at IS NULL')
      .run(new Date().toISOString(), owner, name)
  })

  ipcMain.handle('repo:setArchivedAt', async (_event, _hostId: string, owner: string, name: string, archived: boolean) => {
    const db = getDb(app.getPath('userData'))
    const ts = archived ? new Date().toISOString() : null
    db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?').run(ts, owner, name)
  })

  ipcMain.handle('repo:getRepoUserEvents', async (_event, _hostId: string, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    return getRepoUserEvents(db, owner, name)
  })

  ipcMain.handle('repo:getRepoStats', async (
    _event, hostId: string, owner: string, name: string
  ) => {
    const db = getDb(app.getPath('userData'))
    const token = getToken(hostId) ?? null
    const repoRow = db.prepare(
      'SELECT stars, forks, open_issues, pushed_at FROM repos WHERE owner=? AND name=?'
    ).get(owner, name) as { stars: number | null; forks: number | null; open_issues: number | null; pushed_at: string | null } | undefined
    const cachedCore = repoRow && repoRow.stars != null && repoRow.forks != null && repoRow.open_issues != null
      ? { stars: repoRow.stars, forks: repoRow.forks, openIssues: repoRow.open_issues, pushedAt: repoRow.pushed_at }
      : undefined
    return getRepoStats(db, owner, name, token, cachedCore)
  })

  ipcMain.handle('repo:getRepoMomentum', async (_event, hostId: string, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    const token = getToken(hostId) ?? null
    try {
      return await getRepoMomentum(db, owner, name, token)
    } catch {
      return null
    }
  })
}
