import { app, BrowserWindow, ipcMain, shell, protocol, net, session } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'
import os from 'os'
import Store from 'electron-store'
import type Database from 'better-sqlite3'
import { getDb, closeDb } from './db'
import { getToken, setToken, clearToken, setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner } from './store'
import { startDeviceFlow, pollDeviceToken, getUser, getStarred, getRepo, searchRepos, getReadme, getFileContent, getReleases, starRepo, unstarRepo, isRepoStarred, fetchGitHubTopics, getProfileUser, getUserRepos, getMyRepos, getUserStarred, getUserFollowing, getUserFollowers, checkIsFollowing, followUser, unfollowUser, getOrgVerified, getBranch, getTreeBySha, getBlobBySha, getRawFileBytes, getRepoTree, getReceivedEvents, getCompare, type CompareSummary } from './github'
import { openLoginPopup, closeLoginPopup } from './githubLoginPopup'
import { scanFromSources } from './mcp-scanner'
import type { McpScanResult } from '../src/types/mcp'
import { extractTags } from './tag-extractor'
import { extractDominantColor } from './color-extractor'
import { rawSearch, tagSearch, type SearchFilters } from './smart-search'
import { getRelatedTags } from './related-tags'
import { probeStorybookUrl, buildCandidates } from './storybookDetector'
import {
  generateSkill, generateSkillViaLocalCLI,
  generateComponentsSkill, generateComponentsSkillViaLocalCLI,
  detectClaudeCode, checkAuthStatus, findNpm, installClaudeCLI,
  triggerClaudeAuth, invalidateClaudePathCache, loginClaude,
  type SkillGenInput
} from './skill-gen/legacy'
import { route as pipelineRoute, generate as pipelineGenerate, generateComponents as pipelineGenerateComponents } from './skill-gen/pipeline'
import { prepareWrite } from './skill-gen/regeneration'
import { extractionCache } from './skill-gen/extraction-cache'
import { needsTranslation, translate as translateText } from './translator'
import { registerComponentsIPC, scanComponents } from './componentScanner'
import { registerBadgeProtocol } from './badgeProtocol'
import { registerGhImgProtocol } from './ghimgProtocol'
import { parseComponent } from '../src/utils/componentParser'
import { registerVerificationHandlers } from './ipc/verificationHandlers'
import { registerDownloadHandlers } from './ipc/downloadHandlers'
import { registerAiChatHandlers } from './ipc/aiChatHandlers'
import { registerTtsHandlers } from './ipc/ttsHandlers'
import { registerRecommendHandlers } from './ipc/recommendHandlers'
import { registerEngagementHandlers } from './ipc/engagementHandlers'
import { registerUpdateHandlers } from './ipc/updateHandlers'
import { startUpdateService, checkIsFork } from './services/updateService'
import { registerCreateHandlers, closeAllOnQuit } from './ipc/createHandlers'
import { startVerificationService, enqueueRepo } from './services/verificationService'
import { startSkillSyncService, push as skillSyncPush, pushAll as skillSyncPushAll, setupRepo as skillSyncSetupRepo } from './services/skillSyncService'
import { parseOgImage, isGenericGitHubOg } from './services/ogImageService'
import { sanitiseRef } from './sanitiseRef'
import type { CollectionRow, CollectionRepoRow } from '../src/types/repo'
import { classifyRepoBucket } from '../src/lib/classifyRepoType'
import { cascadeRepoId } from './db-helpers'
import { LRUCache } from './lruCache'
import { poolAll } from './concurrency'

// ── Community collections seed data ─────────────────────────────
export const COMMUNITY_COLLECTIONS = [
  {
    id: 'community-python-api',
    name: 'Python API Stack',
    description: 'Full production Python API setup — FastAPI, Pydantic, SQLAlchemy, Alembic, HTTPX.',
    owner: 'git-suite',
    repos: ['tiangolo/fastapi', 'pydantic/pydantic', 'sqlalchemy/sqlalchemy', 'sqlalchemy/alembic', 'encode/httpx'],
    color_start: '#3b82f6', color_end: '#6366f1',
  },
  {
    id: 'community-tui-toolkit',
    name: 'TUI Toolkit',
    description: 'Everything for terminal UIs in Go using the Charm ecosystem.',
    owner: 'charmbracelet-fan',
    repos: ['charmbracelet/bubbletea', 'charmbracelet/lipgloss', 'charmbracelet/bubbles', 'muesli/termenv'],
    color_start: '#4ade80', color_end: '#16a34a',
  },
  {
    id: 'community-react-ui',
    name: 'React UI Essentials',
    description: 'The standard React UI toolkit — components, animation, forms, validation, data fetching.',
    owner: 'frontend-collective',
    repos: ['shadcn-ui/ui', 'radix-ui/primitives', 'framer/motion', 'react-hook-form/react-hook-form', 'colinhacks/zod', 'TanStack/query'],
    color_start: '#facc15', color_end: '#f59e0b',
  },
] as const

export function seedCommunityCollections(db: Database.Database): void {
  // Idempotency: only seed if no community collections exist yet
  const existing = db.prepare("SELECT id FROM collections WHERE owner != 'user'").get()
  if (existing) return

  const now = new Date().toISOString()

  const insertColl = db.prepare(`
    INSERT OR IGNORE INTO collections (id, name, description, owner, active, created_at, color_start, color_end)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `)
  const insertStubRepo = db.prepare(`
    INSERT OR IGNORE INTO repos (id, owner, name, description, language, topics, stars, forks,
                                  license, homepage, updated_at, saved_at, type, banner_svg)
    VALUES (?, ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  `)
  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO collection_repos (collection_id, repo_id) VALUES (?, ?)
  `)

  db.transaction(() => {
    for (const coll of COMMUNITY_COLLECTIONS) {
      insertColl.run(coll.id, coll.name, coll.description, coll.owner, now, coll.color_start, coll.color_end)
      for (const slug of coll.repos) {
        const [owner, name] = slug.split('/')
        const stubId = `${owner}/${name}`
        insertStubRepo.run(stubId, owner, name)
        insertLink.run(coll.id, stubId)
      }
    }
  })()
}

export function getCollectionAll(db: Database.Database): CollectionRow[] {
  return db.prepare(`
    SELECT c.*,
      COUNT(cr.repo_id) as repo_count,
      SUM(CASE WHEN s.repo_id IS NOT NULL THEN 1 ELSE 0 END) as saved_count
    FROM collections c
    LEFT JOIN collection_repos cr ON cr.collection_id = c.id
    LEFT JOIN skills s ON s.repo_id = cr.repo_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all() as CollectionRow[]
}

export function getCollectionDetail(db: Database.Database, id: string): CollectionRepoRow[] {
  return db.prepare(`
    SELECT r.owner, r.name, r.language,
      s.version,
      CAST(length(s.content) AS INTEGER) as content_size,
      CASE WHEN s.repo_id IS NOT NULL THEN 1 ELSE 0 END as saved
    FROM collection_repos cr
    JOIN repos r ON r.id = cr.repo_id
    LEFT JOIN skills s ON s.repo_id = r.id
    WHERE cr.collection_id = ?
  `).all(id) as CollectionRepoRow[]
}

async function initTopicCache(token: string): Promise<void> {
  const db = getDb(app.getPath('userData'))
  const count = db.prepare('SELECT COUNT(*) as n FROM topic_cache').get() as { n: number }
  const lastFetch = db.prepare(
    'SELECT fetched_at FROM topic_cache ORDER BY fetched_at DESC LIMIT 1'
  ).get() as { fetched_at: string } | undefined

  const isStale = !lastFetch ||
    (Date.now() - new Date(lastFetch.fetched_at).getTime()) > 7 * 24 * 60 * 60 * 1000

  if (count.n === 0 || isStale) {
    try {
      const topics = await fetchGitHubTopics(token)
      const now = new Date().toISOString()
      const insert = db.prepare('INSERT OR REPLACE INTO topic_cache (topic, fetched_at) VALUES (?, ?)')
      const insertMany = db.transaction((ts: string[]) => {
        for (const topic of ts) insert.run(topic, now)
      })
      insertMany(topics)
    } catch {
      // Non-critical — silently ignore
    }
  }
}

function getCollectionColors(language: string | null): { color_start: string; color_end: string } {
  switch (language?.toLowerCase()) {
    case 'typescript':
    case 'javascript': return { color_start: '#a78bfa', color_end: '#7c3aed' }
    case 'go':         return { color_start: '#4ade80', color_end: '#16a34a' }
    case 'python':     return { color_start: '#3b82f6', color_end: '#6366f1' }
    case 'rust':       return { color_start: '#f87171', color_end: '#dc2626' }
    default:           return { color_start: '#34d399', color_end: '#0d9488' }
  }
}

// ── Window bounds store (separate from GitHub token store) ──────
interface WindowStoreSchema {
  windowBounds: { x?: number; y?: number; width: number; height: number }
  windowMaximized: boolean
}
const windowStore = new Store<WindowStoreSchema>()
let mainWindow: BrowserWindow | null = null
let mcpProcess: ReturnType<typeof spawn> | null = null
let deviceFlowAbort: AbortController | null = null

// ── MCP helpers ──────────────────────────────────────────────────────────────
function getClaudeConfigPath(): string | null {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'claude_desktop_config.json')
    default:
      return null
  }
}

function getMcpScriptPath(): string {
  return path.join(__dirname, 'mcp-server.js')
}

function startMCPServer(): void {
  const mcpScript = getMcpScriptPath()
  // Use the bundled Electron binary as a Node.js runtime via ELECTRON_RUN_AS_NODE=1.
  // This means the app works without Node.js installed on the user's machine, and
  // better-sqlite3 runs against the exact Node ABI it was compiled for.
  mcpProcess = spawn(process.execPath, [mcpScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  mcpProcess.on('error', (err) => console.error('[MCP] spawn error:', err))
  mcpProcess.on('exit', (code) => {
    console.log('[MCP] server exited with code:', code)
    mcpProcess = null
  })
}

// Register badge:// as a privileged scheme for image loading (must precede app.ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'badge', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'ghimg', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
])

// ── Single-instance: just focus the existing window on relaunch. ────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ── Window ──────────────────────────────────────────────────────
function createWindow(): void {
  const DEFAULT_BOUNDS = { width: 1200, height: 720 }
  const savedRaw = windowStore.get('windowBounds', DEFAULT_BOUNDS)
  const wasMaximized = windowStore.get('windowMaximized', true)

  // Older versions shipped with minWidth: 1000. On ~1500px displays, Windows'
  // half-screen snap clamped the window to 1000px wide and that stale
  // "2/3 of the screen" width persisted into windowStore, re-applying on
  // every restart and masquerading as a broken half-snap. If we see that
  // exact width, treat it as a migration and fall back to defaults.
  const saved =
    savedRaw.width === 1000
      ? { ...savedRaw, width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height }
      : savedRaw

  mainWindow = new BrowserWindow({
    ...saved,
    // Low enough that Windows' half-screen snap produces an actual 1/2 split
    // on 1280+ screens. Prior value of 1000 forced a ~2/3 width on 1500px
    // displays since minWidth overrides the half-screen target.
    minWidth: 640,
    minHeight: 660,
    // On Windows, `frame: false` strips the native frame entirely which
    // disables Aero drag-to-edge snap — dragging the titlebar to the screen
    // edge used to leave the window at its current (often ~2/3-screen) size
    // instead of snapping to half. `titleBarStyle: 'hidden'` alone gives a
    // frameless look while keeping the native frame for snap.
    // On macOS, `titleBarStyle: 'hidden'` without `frame: false` reveals the
    // traffic lights, which conflict with the app's custom controls — so
    // keep the frameless setup on non-Windows platforms.
    frame: process.platform !== 'win32' ? false : undefined,
    titleBarStyle: 'hidden',
    // Windows: render the native min/max/close as a themed overlay in the
    // top-right corner. Keeps Aero snap (frame is preserved above) while
    // letting the rest of the title-bar area be ours to fill with custom UI.
    // titleBarOverlay intentionally omitted: we render custom React controls
    // (see src/components/Titlebar.tsx) so they can match the filter-button
    // styling exactly. titleBarStyle: 'hidden' alone preserves Aero snap.
    backgroundColor: '#0a0a0e',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium throttles rAF, timers, and React's MessageChannel scheduler
      // while the window is defocused; catch-up on refocus causes multi-second
      // main-thread lag on pages with heavy React trees (RepoDetail + README).
      backgroundThrottling: false,
    },
  })

  if (wasMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('close', () => {
    if (mainWindow) {
      windowStore.set('windowMaximized', mainWindow.isMaximized())
      if (!mainWindow.isMaximized()) {
        windowStore.set('windowBounds', mainWindow.getBounds())
      }
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }


  // Open external links in the default browser instead of inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigation to the app's own pages (dev server or file://)
    const appOrigin = process.env.ELECTRON_RENDERER_URL
    if (appOrigin && url.startsWith(appOrigin)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

}

// ── Window control IPC ──────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── Shell IPC ───────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

// ── GitHub IPC ──────────────────────────────────────────────────
// GitHub OAuth Device Flow — no client secret required.
// The renderer calls startDeviceFlow to get a user_code + verification URL,
// opens the browser for the user to approve, then calls pollDeviceToken which
// blocks until approval (or timeout / rejection).

ipcMain.handle('github:startDeviceFlow', async () => {
  deviceFlowAbort?.abort()
  deviceFlowAbort = new AbortController()
  const start = await startDeviceFlow()
  // Auto-open a small in-app popup at the pre-filled verification page.
  openLoginPopup(start.verificationUriComplete, mainWindow)
  return start
})

ipcMain.handle('github:pollDeviceToken', async (_event, deviceCode: string, interval: number) => {
  const controller = deviceFlowAbort ?? new AbortController()
  try {
    const token = await pollDeviceToken(deviceCode, interval, controller.signal)
    setToken(token)
    initTopicCache(token).catch(() => {}) // Non-blocking
  } finally {
    closeLoginPopup()
  }
})

ipcMain.handle('github:cancelDeviceFlow', () => {
  deviceFlowAbort?.abort()
  deviceFlowAbort = null
  closeLoginPopup()
})

ipcMain.handle('github:openLoginPopup', (_event, url: string) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return
  openLoginPopup(url, mainWindow)
})

ipcMain.handle('github:getUser', async () => {
  const token = getToken()
  if (!token) throw new Error('Not connected')
  const user = await getUser(token)
  setGitHubUser(user.login, user.avatar_url)
  const db = getDb(app.getPath('userData'))
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
  return { login: user.login, avatarUrl: user.avatar_url, publicRepos: user.public_repos }
})

ipcMain.handle('github:getStarred', async (_, force?: boolean) => {
  const token = getToken()
  if (!token) return // no token (user skipped onboarding)

  const db = getDb(app.getPath('userData'))
  const lastRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('last_starred_sync') as
    | { value: string }
    | undefined

  if (!force && lastRow && Date.now() - Number(lastRow.value) < 3_600_000) return // cache fresh

  const starredItems = await getStarred(token)

  const upsert = db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks,
                       license, homepage, updated_at, pushed_at, created_at, starred_at, saved_at, type, banner_svg,
                       default_branch, avatar_url, type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
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
      starred_at     = excluded.starred_at,
      default_branch = excluded.default_branch,
      avatar_url     = COALESCE(excluded.avatar_url, repos.avatar_url),
      saved_at       = repos.saved_at,
      type           = repos.type,
      banner_svg     = repos.banner_svg,
      banner_color   = repos.banner_color,
      type_bucket    = excluded.type_bucket,
      type_sub       = excluded.type_sub
  `)
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

  db.transaction(() => {
    for (const item of starredItems) {
      const repo = item.repo
      const rid = String(repo.id)
      cascadeRepoId(db, repo.owner.login, repo.name, rid)
      const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: JSON.stringify(repo.topics ?? []) })
      upsert.run(
        rid,
        repo.owner.login,
        repo.name,
        repo.description,
        repo.language,
        JSON.stringify(repo.topics ?? []),
        repo.stargazers_count,
        repo.forks_count,
        repo.license?.spdx_id ?? null,
        repo.homepage,
        repo.updated_at,
        repo.pushed_at,
        repo.created_at ?? null,
        item.starred_at,
        repo.default_branch ?? 'main',
        repo.owner.avatar_url ?? null,
        classified?.bucket ?? null,
        classified?.subType ?? null,
      )
    }
    setSetting.run('last_starred_sync', String(Date.now()))
    setSetting.run('starred_repo_count', String(starredItems.length))
  })()

  // Non-blocking: extract dominant colour for starred repos missing banner_color
  setImmediate(() => {
    const needColor = starredItems.filter(item => item.repo.owner.avatar_url)
    void poolAll(needColor, 3, async (item) => {
      const repo = item.repo
      const row = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(repo.owner.login, repo.name) as { banner_color: string | null } | undefined
      if (row?.banner_color) return
      const color = await extractDominantColor(repo.owner.avatar_url!)
      db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
        .run(JSON.stringify(color), repo.owner.login, repo.name)
    })
  })
})

ipcMain.handle('github:disconnect', async () => {
  clearToken()
  clearGitHubUser()
  const db = getDb(app.getPath('userData'))
  db.prepare('DELETE FROM settings WHERE key = ?').run('github_username')
})

ipcMain.handle('connectors:test', async (_event, url: string) => {
  try { new URL(url) } catch { return { ok: false, latencyMs: 0, error: 'Invalid URL' } }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { ok: false, latencyMs: 0, error: 'Only http:// and https:// URLs are supported' }
  }
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await net.fetch(url, { method: 'GET', signal: controller.signal })
    clearTimeout(timeout)
    return { ok: true, statusCode: res.status, latencyMs: Date.now() - start }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs: Date.now() - start, error: message }
  }
})

// In-memory cache for browse-tab search results (Popular / Forked / Rising).
// Keyed by query+sort+order+page.  Survives tab switches within a session.
const searchReposCache = new LRUCache<string, { rows: unknown[]; ts: number }>(20)
const SEARCH_REPOS_TTL = 10 * 60 * 1000 // 10 minutes

ipcMain.handle('github:searchRepos', async (_event, query: string, sort?: string, order?: string, page?: number) => {
  const token = getToken()
  if (!token) return [] // GitHub disconnected — skip API call
  const cacheKey = `${query}:${sort ?? 'stars'}:${order ?? 'desc'}:${page ?? 1}`

  const cached = searchReposCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < SEARCH_REPOS_TTL) {
    return cached.rows
  }

  // Graceful 403/429 fallback: GitHub's secondary rate limit 403s every endpoint
  // (incl. search). Rather than crashing Discover with an unhelpful error, fall
  // through to the most-recent data we already have so the user still sees
  // something while the lock-out clears.
  //   1. stale in-memory cache for this exact query (past TTL but valid data)
  //   2. language-filtered DB rows when the query carries `language:X`
  //   3. top-100-by-stars DB rows
  //   4. anything in the DB at all (last resort)
  let items: import('./github').GitHubRepo[]
  try {
    items = await searchRepos(token, query, 100, sort ?? 'stars', order ?? 'desc', page ?? 1)
  } catch (err) {
    const msg = String(err)
    if (/\b(403|429)\b/.test(msg)) {
      if (cached) return cached.rows
      const db = getDb(app.getPath('userData'))
      const langMatch = query.match(/\blanguage:([^\s]+)/i)
      const lang = langMatch ? langMatch[1] : null
      let rows: unknown[] = []
      if (lang) {
        rows = db.prepare('SELECT * FROM repos WHERE LOWER(language) = LOWER(?) ORDER BY stars DESC LIMIT 100').all(lang)
      }
      if (rows.length === 0) {
        rows = db.prepare('SELECT * FROM repos WHERE stars IS NOT NULL ORDER BY stars DESC LIMIT 100').all()
      }
      if (rows.length === 0) {
        rows = db.prepare('SELECT * FROM repos ORDER BY discovered_at DESC LIMIT 100').all()
      }
      return rows
    }
    throw err
  }
  if (items.length === 0) return []

  const db = getDb(app.getPath('userData'))
  const now = new Date().toISOString()

  const upsert = db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
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
      const rid = String(repo.id)
      cascadeRepoId(db, repo.owner.login, repo.name, rid)
      const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: JSON.stringify(repo.topics ?? []) })
      upsert.run(
        rid, repo.owner.login, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics ?? []), repo.stargazers_count, repo.forks_count,
        repo.license?.spdx_id ?? null, repo.homepage, repo.updated_at, repo.pushed_at,
        repo.created_at ?? null,
        now, query, repo.watchers_count, repo.size, repo.open_issues_count,
        repo.default_branch ?? 'main', repo.owner.avatar_url ?? null,
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()

  // Non-blocking: extract dominant colour for repos that don't have one yet
  setImmediate(() => {
    const needColor = items.filter(r => r.owner.avatar_url)
    void poolAll(needColor, 3, async (repo) => {
      const row = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
        .get(repo.owner.login, repo.name) as { banner_color: string | null } | undefined
      if (row?.banner_color) return
      const color = await extractDominantColor(repo.owner.avatar_url!)
      db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
        .run(JSON.stringify(color), repo.owner.login, repo.name)
    })
  })

  // Look up each result by owner/name — avoids stale discover_query overwrite bug
  const rows = items
    .map(r => db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(r.owner.login, r.name))
    .filter(Boolean)

  // Populate in-memory cache for this query so tab revisits cost 0 API calls
  searchReposCache.set(cacheKey, { rows, ts: Date.now() })

  return rows
})

ipcMain.handle('github:getRepo', async (_event, owner: string, name: string) => {
  const token = getToken()
  if (!token) return null // GitHub disconnected — skip API call
  const db = getDb(app.getPath('userData'))
  const repo = await getRepo(token, owner, name)

  const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: JSON.stringify(repo.topics ?? []) })
  const rid = String(repo.id)
  // Fix ID mismatches: star handler may have created rows with synthetic "owner/name" IDs
  cascadeRepoId(db, owner, name, rid)
  db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch, avatar_url,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
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
    String(repo.id), owner, name, repo.description, repo.language,
    JSON.stringify(repo.topics ?? []), repo.stargazers_count, repo.forks_count,
    repo.license?.spdx_id ?? null, repo.homepage, repo.updated_at, repo.pushed_at,
    repo.created_at ?? null,
    repo.watchers_count, repo.size, repo.open_issues_count,
    repo.default_branch ?? 'main', repo.owner.avatar_url ?? null,
    classified?.bucket ?? null, classified?.subType ?? null,
  )

  // Non-blocking: extract colour if missing
  if (repo.owner.avatar_url) {
    const existing = db.prepare('SELECT banner_color FROM repos WHERE owner = ? AND name = ?')
      .get(owner, name) as { banner_color: string | null } | undefined
    if (!existing?.banner_color) {
      extractDominantColor(repo.owner.avatar_url)
        .then(color => {
          db.prepare('UPDATE repos SET banner_color = ? WHERE owner = ? AND name = ?')
            .run(JSON.stringify(color), owner, name)
        })
        .catch(() => {/* non-critical */})
    }
  }

  return db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get(owner, name)
})

ipcMain.handle('github:getReadme', async (_event, owner: string, name: string) => {
  const token = getToken() ?? null
  return getReadme(token, owner, name)
})

ipcMain.handle('github:getFileContent', async (_event, owner: string, name: string, path: string) => {
  const token = getToken() ?? null
  return getFileContent(token, owner, name, path)
})

ipcMain.handle('github:getReleases', async (_event, owner: string, name: string) => {
  const token = getToken()
  if (!token) return [] // GitHub disconnected — skip API call
  return getReleases(token, owner, name)  // errors propagate to renderer → "Failed to load releases." UI state
})

ipcMain.handle('github:starRepo', async (_event, owner: string, name: string) => {
  const token = getToken()
  if (!token) throw new Error('Not connected')
  await starRepo(token, owner, name)
  const db = getDb(app.getPath('userData'))
  const now = new Date().toISOString()
  // Re-starring also clears unstarred_at so the row leaves the Unstarred filter.
  const updated = db.prepare('UPDATE repos SET starred_at = ?, unstarred_at = NULL WHERE owner = ? AND name = ?').run(now, owner, name)
  if (updated.changes === 0) {
    db.prepare(`
      INSERT INTO repos (id, owner, name, description, language, topics, stars, forks,
                         license, homepage, updated_at, saved_at, type, banner_svg, starred_at)
      VALUES (?, ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
    `).run(`${owner}/${name}`, owner, name, now)
  }
})

ipcMain.handle('github:unstarRepo', async (_event, owner: string, name: string) => {
  const token = getToken()
  if (!token) throw new Error('Not connected')
  await unstarRepo(token, owner, name)
  const db = getDb(app.getPath('userData'))
  const now = new Date().toISOString()
  db.prepare('UPDATE repos SET starred_at = NULL, unstarred_at = ? WHERE owner = ? AND name = ?').run(now, owner, name)
})

ipcMain.handle('github:isStarred', async (_event, owner: string, name: string) => {
  const token = getToken() ?? null
  return isRepoStarred(token, owner, name)
})

ipcMain.handle('github:saveRepo', async (_event, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  const ts = new Date().toISOString()
  const info = db.prepare('UPDATE repos SET saved_at = ? WHERE owner = ? AND name = ?')
    .run(ts, owner, name)
  if (info.changes === 0) throw new Error(`saveRepo: row not found for ${owner}/${name}`)
  // Enqueue at high priority so the verification badge appears promptly
  // Fetch language so verificationService can route to the correct registry
  const saved = db.prepare('SELECT language FROM repos WHERE id = ?').get(`${owner}/${name}`) as { language: string | null } | undefined
  enqueueRepo({ repoId: `${owner}/${name}`, owner, name, language: saved?.language ?? null, priority: 'high' })
  // Set initial stored_version baseline and check if user has forked this repo
  setImmediate(async () => {
    const token = getToken() ?? null
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (token) headers.Authorization = `Bearer ${token}`
    // Determine initial stored_version
    let storedVersion: string | null = null
    try {
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${name}/releases/latest`, { headers })
      if (relRes.ok) {
        const rel = await relRes.json() as { tag_name: string }
        storedVersion = rel.tag_name
      } else {
        const dbRow = db.prepare('SELECT pushed_at FROM repos WHERE owner = ? AND name = ?').get(owner, name) as { pushed_at: string | null } | undefined
        storedVersion = dbRow?.pushed_at ?? null
      }
    } catch { /* network failure — leave stored_version null */ }
    // Check fork status
    const isFork = await checkIsFork(owner, name)
    db.prepare('UPDATE repos SET stored_version = ?, is_forked = ? WHERE owner = ? AND name = ?')
      .run(storedVersion, isFork ? 1 : 0, owner, name)
  })
})

ipcMain.handle('github:getSavedRepos', async () => {
  const db = getDb(app.getPath('userData'))
  return db.prepare('SELECT owner, name FROM repos WHERE saved_at IS NOT NULL').all()
})

// Repos that should contribute to the activity feed: anything saved OR currently
// starred. Distinct from getSavedRepos (which only powers the Library "is saved"
// predicate) — the feed wants release coverage for every repo the user has shown
// interest in, including stars-only.
ipcMain.handle('github:getFeedRepos', async () => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(
    'SELECT owner, name FROM repos WHERE saved_at IS NOT NULL OR starred_at IS NOT NULL'
  ).all()
})

ipcMain.handle('github:getRelatedRepos', async (_event, owner: string, name: string, topicsJson: string) => {
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
  ).all(...escaped, owner, name) as Record<string, unknown>[]

  const seen = new Set<string>()
  return rows
    .filter((r) => {
      const key = `${r.owner}/${r.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 3)
})

// In-memory caches for Trees/Blobs API (SHA-keyed = immutable, never stale)
const treeCache = new LRUCache<string, import('./github').TreeEntry[]>(100)
const blobCache = new LRUCache<string, import('./github').BlobResult>(50)
const branchCache = new LRUCache<string, { rootTreeSha: string; timestamp: number }>(50)
const BRANCH_TTL = 5 * 60 * 1000 // 5 minutes

ipcMain.handle('github:getBranch', async (_event, owner: string, name: string, branch: string) => {
  const key = `${owner}/${name}/${branch}`
  const cached = branchCache.get(key)
  if (cached && Date.now() - cached.timestamp < BRANCH_TTL) {
    return { rootTreeSha: cached.rootTreeSha }
  }
  const token = getToken() ?? null
  const result = await getBranch(token, owner, name, branch)
  branchCache.set(key, { rootTreeSha: result.rootTreeSha, timestamp: Date.now() })
  return { rootTreeSha: result.rootTreeSha }
})

ipcMain.handle('github:getTree', async (_event, owner: string, name: string, treeSha: string) => {
  const cached = treeCache.get(treeSha)
  if (cached) return cached
  const token = getToken() ?? null
  const entries = await getTreeBySha(token, owner, name, treeSha)
  treeCache.set(treeSha, entries)
  return entries
})

ipcMain.handle('github:getRawFile', async (_event, owner: string, name: string, branch: string, path: string) => {
  const token = getToken() ?? null
  const buf = await getRawFileBytes(token, owner, name, branch, path)
  return buf // Buffer is transferred as Uint8Array over IPC
})

ipcMain.handle('github:getBlob', async (_event, owner: string, name: string, blobSha: string) => {
  const cached = blobCache.get(blobSha)
  if (cached) return cached
  const token = getToken() ?? null
  const result = await getBlobBySha(token, owner, name, blobSha)
  blobCache.set(blobSha, result)
  return result
})

ipcMain.handle('github:getReceivedEvents', async (_event, username: string) => {
  const token = getToken()
  if (!token) return []
  return getReceivedEvents(token, username)
})

// Persistent disk cache for compare summaries with a 30-day TTL.
// Refs are immutable so the response between two specific tags never changes;
// the TTL is just a safety/cleanup horizon (and an upgrade path if we ever
// extend the projected fields).
const COMPARE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

ipcMain.handle('github:getCompare', async (_event, owner: string, name: string, base: string, head: string) => {
  // `...` separator is safe: git refs cannot contain `...` per git-check-ref-rules,
  // so this can never collide between distinct (base, head) pairs.
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
        // Corrupted row — drop it so the refetch path can write a clean record
        // instead of leaving us permanently parse-failing on every cold start.
        db.prepare('DELETE FROM compare_cache WHERE cache_key = ?').run(key)
      }
    }
  }

  const token = getToken() ?? null
  const summary = await getCompare(token, owner, name, base, head)
  db.prepare('INSERT OR REPLACE INTO compare_cache (cache_key, data, fetched_at) VALUES (?, ?, ?)')
    .run(key, JSON.stringify(summary), new Date().toISOString())
  return summary
})

// ── SVG cache IPC ────────────────────────────────────────────────

function svgCacheFile(owner: string, name: string): string {
  return path.join(app.getPath('userData'), 'svg-cache', `${sanitiseRef(owner)}_${sanitiseRef(name)}.json`)
}

ipcMain.handle('svg-cache:prefetch', async (_event, owner: string, name: string, branch: string) => {
  const token = getToken() ?? null
  const allFiles = await getRepoTree(token, owner, name, branch).catch(() => [] as { path: string; type: string; sha: string }[])
  const svgFiles = allFiles.filter(f => f.type === 'blob' && f.path.toLowerCase().endsWith('.svg'))
  if (svgFiles.length === 0) return

  const result: Record<string, string> = {}
  // Conservative: small batches with a delay between them. GitHub trips the
  // secondary rate limit on bursty/parallel traffic, and that lock-out 403s
  // *all* subsequent requests (including search), breaking Discover. Concurrency
  // 3 + 250ms between batches keeps a 600-SVG repo well below the threshold.
  const CONCURRENCY = 3
  const DELAY_MS = 250
  let aborted = false

  for (let i = 0; i < svgFiles.length && !aborted; i += CONCURRENCY) {
    const batch = svgFiles.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map(async (file) => {
      const blob = await getBlobBySha(token, owner, name, file.sha)
      return { sha: file.sha, blob }
    }))
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        result[r.value.sha] = r.value.blob.content
        blobCache.set(r.value.sha, r.value.blob)
      } else if (/\b(403|429)\b/.test(String(r.reason))) {
        // Hit rate limit — bail out, save what we have
        aborted = true
      }
    }
    if (!aborted && i + CONCURRENCY < svgFiles.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  if (Object.keys(result).length === 0) return

  const dir = path.join(app.getPath('userData'), 'svg-cache')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(svgCacheFile(owner, name), JSON.stringify(result), 'utf-8')
})

ipcMain.handle('svg-cache:read', async (_event, owner: string, name: string) => {
  try {
    const raw = await fs.readFile(svgCacheFile(owner, name), 'utf-8')
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return null
  }
})

// ── Settings IPC ────────────────────────────────────────────────
ipcMain.handle('settings:get', async (_event, key: string) => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
})

ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
})

ipcMain.handle('settings:getApiKey', async () => getApiKey() ?? null)
ipcMain.handle('settings:setApiKey', async (_, key: string) => setApiKey(key))

// ── Starred IPC ─────────────────────────────────────────────────
ipcMain.handle('starred:getAll', async () => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(`
    SELECT
      repos.*,
      CASE WHEN skills.repo_id IS NOT NULL THEN 1 ELSE 0 END AS installed
    FROM repos
    LEFT JOIN skills ON repos.id = skills.repo_id
    WHERE repos.starred_at IS NOT NULL
    ORDER BY repos.starred_at DESC
  `).all()
})

ipcMain.handle('starred:getRecentlyUnstarred', async () => {
  const db = getDb(app.getPath('userData'))
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  return db.prepare(`
    SELECT
      repos.*,
      CASE WHEN skills.repo_id IS NOT NULL THEN 1 ELSE 0 END AS installed
    FROM repos
    LEFT JOIN skills ON repos.id = skills.repo_id
    WHERE repos.unstarred_at IS NOT NULL AND repos.unstarred_at >= ?
    ORDER BY repos.unstarred_at DESC
  `).all(cutoff)
})

// ── Skill IPC ───────────────────────────────────────────────────
// detectClaudeCode: just checks if the binary exists (not auth state)
ipcMain.handle('skill:detectClaudeCode', async () => detectClaudeCode())

// checkAuthStatus: is the user actually logged in?
ipcMain.handle('skill:checkAuthStatus', async () => checkAuthStatus())

ipcMain.handle('skill:setup', async (event) => {
  const send = (phase: string, message: string) =>
    event.sender.send('skill:setup-progress', { phase, message })

  try {
    // Phase 1: Check npm
    send('checking', 'Checking for npm…')
    const npmPath = await findNpm()
    if (!npmPath) {
      send('error', 'npm not found. Please install Node.js from nodejs.org first.')
      return { success: false, error: 'npm not found' }
    }
    send('checking', `Found npm at: ${npmPath}`)

    // Phase 2: Install
    send('installing', 'Installing @anthropic-ai/claude-code (this may take a minute)…')
    await installClaudeCLI((line) => send('installing', line))

    // Phase 3: Invalidate cache + detect
    invalidateClaudePathCache()
    send('installing', 'Install complete — locating claude binary…')
    const found = await detectClaudeCode()
    if (!found) {
      send('error', 'Installed but claude binary not found. Try restarting the app.')
      return { success: false, error: 'binary not found after install' }
    }

    // Phase 4: Auth
    send('auth', 'Opening browser for Claude login…')
    await triggerClaudeAuth()
    send('done', 'Claude Code is ready!')
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    send('error', msg)
    return { success: false, error: msg }
  }
})

ipcMain.handle('skill:loginClaude', async (event) => {
  // Login can run up to 3 min; guard sends in case the window closes mid-flow.
  const safeSend = (payload: { message: string; isError?: boolean; done?: boolean }) => {
    if (!event.sender.isDestroyed()) event.sender.send('skill:login-progress', payload)
  }
  try {
    await loginClaude((message) => safeSend({ message }))
    safeSend({ message: 'Logged in successfully!', done: true })
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    safeSend({ message: msg, isError: true })
    return { success: false, error: msg }
  }
})

ipcMain.handle('skill:logoutClaude', async () => {
  const { logoutClaude } = await import('./skill-gen/legacy')
  await logoutClaude()
})

ipcMain.handle('skill:generate', async (_, owner: string, name: string, options?: {
  flavour?: 'library' | 'codebase' | 'domain',
  enabledComponents?: string[],
  enabledTools?:      string[],
  target?: 'master' | 'components' | 'all',
  ref?: string,
}) => {
  const flavour = options?.flavour ?? 'library'
  const apiKey = getApiKey()

  const token = getToken() ?? null
  const ref = options?.ref
  const readme = await getReadme(token, owner, name, ref)
  if (ref && readme === null) throw new Error(`README not found at ref ${ref}`)
  const readmeContent = readme ?? ''
  const releases = ref ? [] : await getReleases(token, owner, name)
  const version = ref ?? (releases[0]?.tag_name ?? 'unknown')

  const db = getDb(app.getPath('userData'))
  const repo = db.prepare('SELECT id, language, topics, default_branch, type_bucket, type_sub FROM repos WHERE owner = ? AND name = ?').get(owner, name) as
    { id: string; language: string | null; topics: string | null; default_branch: string | null; type_bucket: string | null; type_sub: string | null } | undefined
  if (!repo) throw new Error(`Repo ${owner}/${name} not found in database`)

  const language = repo.language ?? ''
  const topics = JSON.parse(repo.topics ?? '[]') as string[]

  // Component detection
  const isComponents =
    topics.some((t: string) => ['components', 'ui-components', 'design-system', 'component-library'].includes(t)) ||
    /\bui\b|components|design.?system/i.test(name)

  if (isComponents) {
    db.prepare("UPDATE repos SET type='components' WHERE id=?").run(repo.id)
  }

  // Scan and parse components for the skill generation prompt
  let scannedComponents: SkillGenInput['scannedComponents']
  if (isComponents && !ref) {
    try {
      const branch = repo.default_branch ?? 'main'
      const scanResult = await scanComponents(owner, name, branch)
      scannedComponents = scanResult.components.map(c => {
        const pc = parseComponent(c.path, c.source, scanResult.framework)
        return {
          name: pc.name,
          props: pc.props.map(p => ({
            name: p.name,
            type: p.type,
            required: p.required,
            ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
          })),
        }
      })
      console.log(`[skill-gen] Scanned ${scannedComponents.length} components for ${owner}/${name}`)
    } catch (err) {
      console.error('[skill-gen] Component scan failed, falling back to README-only:', err)
    }
  }

  const target = ref ? 'master' : (options?.target ?? 'all')

  const skillInput = { owner, name, language, topics, readme: readmeContent, version, isComponents, enabledComponents: options?.enabledComponents, enabledTools: options?.enabledTools, scannedComponents }
  let content: string | undefined
  let systemContent: string | undefined
  let practiceContent: string | undefined
  let pipelineWarnings: string[] = []
  if (target === 'all' || target === 'master') {
    if (ref) {
      // Versioned installs (library only) — legacy path, ref-specific
      try {
        content = await generateSkillViaLocalCLI(skillInput)
      } catch (cliError) {
        console.error('[skill-gen] Local CLI error:', cliError)
        if (!apiKey) {
          const cliMsg = cliError instanceof Error ? cliError.message : String(cliError)
          throw new Error(
            /not logged in|claude login/i.test(cliMsg)
              ? cliMsg + ' Or add an Anthropic API key in Settings as a fallback.'
              : 'Claude Code unavailable and no API key set. Run `claude login` in a terminal or add an API key in Settings.'
          )
        }
        content = await generateSkill(skillInput, apiKey)
      }
    } else {
      const routeResult = await pipelineRoute(flavour, {
        token,
        owner,
        name,
        language,
        topics,
        readme: readmeContent,
        version,
        defaultBranch: repo.default_branch ?? 'main',
        apiKey: apiKey ?? undefined,
        typeBucket: repo.type_bucket ?? undefined,
        typeSub: repo.type_sub ?? undefined,
      })

      if (routeResult.flavour === 'codebase') {
        systemContent = routeResult.system
        practiceContent = routeResult.practice
        const allWarnings: string[] = []
        for (const v of [routeResult.systemValidation, routeResult.practiceValidation]) {
          allWarnings.push(...v.warnings.map(w => w.message))
          if (v.autoFixes > 0) allWarnings.push(`Auto-fixed ${v.autoFixes} issue(s)`)
        }
        pipelineWarnings = allWarnings
      } else {
        content = routeResult.content
        const v = routeResult.validation
        const warnings: string[] = []
        if (v.warnings.length > 0) warnings.push(...v.warnings.map(w => w.message))
        if (v.autoFixes > 0) warnings.push(`Auto-fixed ${v.autoFixes} issue(s) (hallucinated URLs, invalid references)`)
        pipelineWarnings = warnings
      }
    }
  }

  // ── Generate components sub-skill (if applicable) ────────────────
  let componentsContent: string | null = null
  if (isComponents && (target === 'all' || target === 'components')) {
    try {
      const compResult = await pipelineGenerateComponents({
        token,
        owner,
        name,
        language,
        topics,
        readme: readmeContent,
        version,
        defaultBranch: repo.default_branch ?? 'main',
        apiKey: apiKey ?? undefined,
        typeBucket: repo.type_bucket ?? undefined,
        typeSub: repo.type_sub ?? undefined,
        scannedComponents: skillInput.scannedComponents,
      })
      componentsContent = compResult.content
    } catch (compError) {
      console.error('[skill-gen] Components pipeline error, trying legacy:', compError)
      try {
        componentsContent = await generateComponentsSkillViaLocalCLI(skillInput)
      } catch {
        if (apiKey) {
          try { componentsContent = await generateComponentsSkill(skillInput, apiKey) } catch (e) {
            console.error('[skill-gen] Components API fallback error:', e)
          }
        }
      }
    }
  }

  // Append ## [SKILLS] section to master skill listing available sub-skills
  const dir = path.join(app.getPath('userData'), 'skills', owner)
  await fs.mkdir(dir, { recursive: true })
  const generated_at = new Date().toISOString()

  // ── Codebase flavour: write system + practice as sub_skills ─────────────────
  if (systemContent !== undefined && practiceContent !== undefined) {
    const systemFilename   = `${name}.system.skill.md`
    const practiceFilename = `${name}.practice.skill.md`
    const systemPath       = path.join(dir, systemFilename)
    const practicePath     = path.join(dir, practiceFilename)

    const storedSystem   = (db.prepare("SELECT content FROM sub_skills WHERE repo_id = ? AND skill_type = 'system'").get(repo.id) as { content: string } | undefined)?.content ?? null
    const storedPractice = (db.prepare("SELECT content FROM sub_skills WHERE repo_id = ? AND skill_type = 'practice'").get(repo.id) as { content: string } | undefined)?.content ?? null
    const currentSystem   = await fs.readFile(systemPath,   'utf8').catch(() => null)
    const currentPractice = await fs.readFile(practicePath, 'utf8').catch(() => null)

    const systemCheck   = prepareWrite(systemContent,   storedSystem,   currentSystem)
    const practiceCheck = prepareWrite(practiceContent, storedPractice, currentPractice)

    if (systemCheck.conflict || practiceCheck.conflict) {
      console.warn(`[skill-gen] Regeneration conflict detected for ${owner}/${name} — user has edited generated block`)
      return { conflict: true, version, generated_at, warnings: pipelineWarnings }
    }

    const finalSystem   = systemCheck.merged!
    const finalPractice = practiceCheck.merged!
    const upsertSubSkill = db.prepare(`
      INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(repo_id, skill_type) DO UPDATE SET
        filename     = excluded.filename,
        content      = excluded.content,
        version      = excluded.version,
        generated_at = excluded.generated_at
    `)
    await fs.writeFile(systemPath,   finalSystem,   'utf8')
    await fs.writeFile(practicePath, finalPractice, 'utf8')
    upsertSubSkill.run(repo.id, 'system',   systemFilename,   finalSystem,   version, generated_at)
    upsertSubSkill.run(repo.id, 'practice', practiceFilename, finalPractice, version, generated_at)
    // fire-and-forget; failure surfaces as toast, never blocks generation
    void skillSyncPush(repo.id, owner, systemFilename,   finalSystem,   'system')
    void skillSyncPush(repo.id, owner, practiceFilename, finalPractice, 'practice')
    return { system: finalSystem, practice: finalPractice, version, generated_at, warnings: pipelineWarnings }
  }

  // ── Library / domain flavour: single skill file ───────────────────────────
  if (content !== undefined) {
    if (ref) {
      const safe = sanitiseRef(ref)
      const filename = `${name}@${safe}.skill.md`
      await fs.writeFile(path.join(dir, filename), content, 'utf8')
      db.prepare(`
        INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(repo_id, skill_type) DO UPDATE SET
          filename     = excluded.filename,
          content      = excluded.content,
          version      = excluded.version,
          generated_at = excluded.generated_at
      `).run(repo.id, `version:${safe}`, filename, content, version, generated_at)
      // fire-and-forget; failure surfaces as toast, never blocks generation
      void skillSyncPush(repo.id, owner, filename, content, `version:${safe}`)
    } else {
      if (componentsContent) {
        content += `\n\n## [SKILLS]\ncomponents: ${name}.components.skill.md\n`
      }
      const skillPath = path.join(dir, `${name}.skill.md`)
      const storedSkill  = (db.prepare('SELECT content FROM skills WHERE repo_id = ?').get(repo.id) as { content: string } | undefined)?.content ?? null
      const currentSkill = await fs.readFile(skillPath, 'utf8').catch(() => null)
      const check = prepareWrite(content, storedSkill, currentSkill)

      if (check.conflict) {
        console.warn(`[skill-gen] Regeneration conflict detected for ${owner}/${name} — user has edited generated block`)
        return { conflict: true, version, generated_at, warnings: pipelineWarnings }
      }

      const final = check.merged!
      await fs.writeFile(skillPath, final, 'utf8')
      db.prepare(`
        INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier)
        VALUES (?, ?, ?, ?, ?, 1, NULL, 1)
        ON CONFLICT(repo_id) DO UPDATE SET
          filename     = excluded.filename,
          content      = excluded.content,
          version      = excluded.version,
          generated_at = excluded.generated_at,
          tier         = excluded.tier
      `).run(repo.id, `${name}.skill.md`, final, version, generated_at)
      content = final
      // fire-and-forget; failure surfaces as toast, never blocks generation
      void skillSyncPush(repo.id, owner, `${name}.skill.md`, final)
    }
  }

  if (!ref && componentsContent) {
    const compFilename = `${name}.components.skill.md`
    await fs.writeFile(path.join(dir, compFilename), componentsContent, 'utf8')
    db.prepare(`
      INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
      VALUES (?, 'components', ?, ?, ?, ?, 1)
      ON CONFLICT(repo_id, skill_type) DO UPDATE SET
        filename     = excluded.filename,
        content      = excluded.content,
        version      = excluded.version,
        generated_at = excluded.generated_at
    `).run(repo.id, compFilename, componentsContent, version, generated_at)
    // fire-and-forget; failure surfaces as toast, never blocks generation
    void skillSyncPush(repo.id, owner, compFilename, componentsContent, 'components')
  }

  return { content: content ?? null, version, generated_at, warnings: pipelineWarnings }
})


ipcMain.handle('skill:get-versioned-installs', async (_, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  const repo = db.prepare('SELECT id FROM repos WHERE owner = ? AND name = ?').get(owner, name) as { id: string } | undefined
  if (!repo) return []
  const rows = db.prepare(
    "SELECT skill_type FROM sub_skills WHERE repo_id = ? AND skill_type LIKE 'version:%'"
  ).all(repo.id) as { skill_type: string }[]
  return rows.map(r => r.skill_type.replace(/^version:/, ''))
})

ipcMain.handle('skill:get', async (_, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(
    'SELECT s.* FROM skills s JOIN repos r ON s.repo_id = r.id WHERE r.owner = ? AND r.name = ?'
  ).get(owner, name) ?? null
})

ipcMain.handle('skill:delete', async (_, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(
    'DELETE FROM skills WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)'
  ).run(owner, name)
  const filePath = path.join(app.getPath('userData'), 'skills', owner, `${name}.skill.md`)
  await fs.unlink(filePath).catch(() => {})

  // Remove all sub-skill files and DB rows for this repo
  // sub.filename is a basename under skills/<owner>/
  const subSkills = db.prepare(
    `SELECT filename FROM sub_skills WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)`
  ).all(owner, name) as { filename: string }[]

  for (const sub of subSkills) {
    const subPath = path.join(app.getPath('userData'), 'skills', owner, sub.filename)
    await fs.unlink(subPath).catch(() => {})
  }

  db.prepare(
    `DELETE FROM sub_skills WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)`
  ).run(owner, name)
})

ipcMain.handle('skill:getSubSkill', (_event, owner: string, name: string, skillType: string) => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(`
    SELECT ss.* FROM sub_skills ss
    JOIN repos r ON ss.repo_id = r.id
    WHERE r.owner = ? AND r.name = ? AND ss.skill_type = ?
  `).get(owner, name, skillType) ?? null
})

// ── Skill Sync IPC ──────────────────────────────────────────────
ipcMain.handle('skillSync:setup', async () => {
  const user = getGitHubUser()
  if (!user?.username) return { ok: false, error: 'Not authenticated' }
  return skillSyncSetupRepo(user.username)
})

ipcMain.handle('skillSync:disconnect', async () => {
  setSyncEnabled(false)
  return { ok: true }
})

ipcMain.handle('skillSync:retryFailed', async () => {
  void skillSyncPushAll('failed')
  return { ok: true }
})

ipcMain.handle('skillSync:getStatus', async () => {
  const db = getDb(app.getPath('userData'))
  const failedCount =
    (db.prepare("SELECT COUNT(*) as n FROM skills WHERE sync_status = 'failed'").get() as { n: number }).n +
    (db.prepare("SELECT COUNT(*) as n FROM sub_skills WHERE sync_status = 'failed'").get() as { n: number }).n
  const lastSynced = (db.prepare(
    `SELECT MAX(t) as t FROM (
       SELECT MAX(synced_at) as t FROM skills WHERE synced_at IS NOT NULL
       UNION ALL
       SELECT MAX(synced_at) as t FROM sub_skills WHERE synced_at IS NOT NULL
     )`
  ).get() as { t: number | null }).t
  return {
    enabled: getSyncEnabled(),
    repoOwner: getSyncRepoOwner(),
    failedCount,
    lastSynced
  }
})

// ── Library IPC ─────────────────────────────────────────────────
ipcMain.handle('library:getAll', async () => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(`
    SELECT r.*, s.active, s.version, s.generated_at, s.tier,
           s.enabled_components, s.enabled_tools
    FROM repos r
    INNER JOIN skills s ON r.id = s.repo_id
    ORDER BY s.generated_at DESC
  `).all()
})

ipcMain.handle('skill:getContent', async (_, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(`
    SELECT s.filename, s.content
    FROM skills s
    JOIN repos r ON s.repo_id = r.id
    WHERE r.owner = ? AND r.name = ?
  `).get(owner, name) as { filename: string; content: string } | undefined
})

ipcMain.handle('skill:toggle', async (_, owner: string, name: string, active: number) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(
    'UPDATE skills SET active = ? WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)'
  ).run(active, owner, name)
})

ipcMain.handle('skill:setEnabledComponents', async (_, owner: string, name: string, enabled: string[]) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(
    'UPDATE skills SET enabled_components = ? WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)'
  ).run(JSON.stringify(enabled), owner, name)
})

ipcMain.handle('skill:setEnabledTools', async (_, owner: string, name: string, enabled: string[]) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(
    'UPDATE skills SET enabled_tools = ? WHERE repo_id = (SELECT id FROM repos WHERE owner = ? AND name = ?)'
  ).run(JSON.stringify(enabled), owner, name)
})

ipcMain.handle('mcp:scanTools', async (_, owner: string, name: string): Promise<McpScanResult> => {
  const token = getToken() ?? null

  const db = getDb(app.getPath('userData'))
  const repo = db.prepare('SELECT id, default_branch FROM repos WHERE owner = ? AND name = ?').get(owner, name) as
    { id: string; default_branch: string | null } | undefined
  if (!repo) throw new Error(`Repo ${owner}/${name} not found`)
  const branch = repo.default_branch ?? 'main'

  const tree = await getRepoTree(token, owner, name, branch).catch(() => [])
  const isSource = (p: string) => /\.(ts|tsx|js|mjs|py)$/.test(p) && (p.startsWith('src/') || !p.includes('/'))
  const sourcePaths = tree.filter(e => e.type === 'blob' && isSource(e.path)).slice(0, 50).map(e => e.path)

  const staticSources = (await Promise.all(
    sourcePaths.map(p => getFileContent(token, owner, name, p).catch(() => null))
  )).filter((s): s is string => typeof s === 'string')

  const manifestCandidates = ['tools.json', 'mcp.json', '.mcp/tools.json']
  let manifestSource: string | null = null
  for (const p of manifestCandidates) {
    const s = await getFileContent(token, owner, name, p).catch(() => null)
    if (s) { manifestSource = s; break }
  }

  const readmeSource = await getReadme(token, owner, name).catch(() => null)

  const result = scanFromSources({ staticSources, manifestSource, readmeSource })

  const filename = `${name}-mcp-tools.json`
  db.prepare(`
    INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
    VALUES (?, 'mcp-tools', ?, ?, NULL, ?, 1)
    ON CONFLICT(repo_id, skill_type) DO UPDATE SET
      filename = excluded.filename,
      content  = excluded.content,
      generated_at = excluded.generated_at
  `).run(repo.id, filename, JSON.stringify(result), result.detectedAt)

  return result
})

ipcMain.handle('library:getCollections', async (_, repoId: string) => {
  const db = getDb(app.getPath('userData'))
  return db.prepare(`
    SELECT c.id, c.name FROM collections c
    JOIN collection_repos cr ON cr.collection_id = c.id
    WHERE cr.repo_id = ?
  `).all(repoId) as { id: string; name: string }[]
})

// ── Collection IPC ───────────────────────────────────────────────
ipcMain.handle('collection:getAll', async () => {
  const db = getDb(app.getPath('userData'))
  return getCollectionAll(db)
})

ipcMain.handle('collection:getDetail', async (_, id: string) => {
  const db = getDb(app.getPath('userData'))
  return getCollectionDetail(db, id)
})

ipcMain.handle('collection:create', async (_, name: string, description: string, repoIds: string[]) => {
  const db = getDb(app.getPath('userData'))
  const id = `user-${Date.now()}`
  const now = new Date().toISOString()

  // Pick colors from most common language among selected repos
  const langs = repoIds.length > 0
    ? (db.prepare(`SELECT language FROM repos WHERE id IN (${repoIds.map(() => '?').join(',')})`)
        .all(...repoIds) as { language: string | null }[]).map(r => r.language)
    : []
  const langCounts: Record<string, number> = {}
  for (const l of langs) if (l) langCounts[l] = (langCounts[l] ?? 0) + 1
  const topLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const { color_start, color_end } = getCollectionColors(topLang)

  const insertLink = db.prepare('INSERT OR IGNORE INTO collection_repos (collection_id, repo_id) VALUES (?, ?)')
  db.transaction(() => {
    db.prepare(`
      INSERT INTO collections (id, name, description, owner, active, created_at, color_start, color_end)
      VALUES (?, ?, ?, 'user', 1, ?, ?, ?)
    `).run(id, name, description || null, now, color_start, color_end)
    for (const repoId of repoIds) {
      insertLink.run(id, repoId)
    }
  })()

  return id
})

ipcMain.handle('collection:delete', async (_, id: string) => {
  const db = getDb(app.getPath('userData'))
  // Only allow deleting user-created collections
  const coll = db.prepare('SELECT owner FROM collections WHERE id = ?').get(id) as { owner: string } | undefined
  if (!coll || coll.owner !== 'user') return
  db.transaction(() => {
    db.prepare('DELETE FROM collection_repos WHERE collection_id = ?').run(id)
    db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  })()
})

ipcMain.handle('collection:toggle', async (_, id: string, active: number) => {
  const db = getDb(app.getPath('userData'))
  const clamped = active === 0 ? 0 : 1
  db.prepare('UPDATE collections SET active = ? WHERE id = ?').run(clamped, id)
})

// ── MCP IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('mcp:getStatus', async () => {
  const configPath = getClaudeConfigPath()
  if (!configPath) return { configured: false, configPath: null }
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as Record<string, unknown>
    const servers = config.mcpServers as Record<string, unknown> | undefined
    if (servers == null || !('git-suite' in servers)) return { configured: false, configPath }
    // Validate the configured command path still exists on disk
    const entry = servers['git-suite'] as { command?: string } | undefined
    if (entry?.command) {
      try { await fs.access(entry.command) } catch { return { configured: false, configPath } }
    }
    return { configured: true, configPath }
  } catch {
    return { configured: false, configPath }
  }
})

ipcMain.handle('mcp:autoConfigure', async () => {
  const configPath = getClaudeConfigPath()
  if (!configPath) return { success: false, error: 'Unsupported platform' }
  try {
    let existing: Record<string, unknown> = {}
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      existing = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>
    mcpServers['git-suite'] = {
      command: process.execPath,
      args: [getMcpScriptPath()],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
    existing.mcpServers = mcpServers
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('mcp:getConfigSnippet', async () => {
  const snippet = {
    mcpServers: {
      'git-suite': {
        command: process.execPath,
        args: [getMcpScriptPath()],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    },
  }
  return JSON.stringify(snippet, null, 2)
})

ipcMain.handle('mcp:testConnection', async () => {
  if (!mcpProcess || mcpProcess.exitCode !== null) {
    return { running: false, skillCount: 0 }
  }
  try {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE active = 1`).get() as { count: number }
    return { running: true, skillCount: row.count }
  } catch {
    return { running: true, skillCount: 0 }
  }
})

// ── Search IPC ──────────────────────────────────────────────────

ipcMain.handle('search:getTopics', async () => {
  const db = getDb(app.getPath('userData'))

  // 1. Featured topics from cache (populated on login/startup)
  const cached = (db.prepare('SELECT topic FROM topic_cache').all() as { topic: string }[])
    .map(r => r.topic)

  // 2. Topics from every repo the user has already seen — always available
  const repoRows = db.prepare(
    "SELECT topics FROM repos WHERE topics IS NOT NULL AND topics != '[]' AND topics != ''"
  ).all() as { topics: string }[]
  const fromRepos: string[] = []
  for (const row of repoRows) {
    try {
      const arr = JSON.parse(row.topics) as string[]
      for (const t of arr) if (t && !fromRepos.includes(t)) fromRepos.push(t)
    } catch { /* skip malformed */ }
  }

  // Merge, deduplicate, sort alphabetically so prefix matching feels natural
  return [...new Set([...cached, ...fromRepos])].sort()
})

ipcMain.handle('search:extractTags', async (_, query: string) => {
  const apiKey = getApiKey()
  if (!apiKey) return []
  const db = getDb(app.getPath('userData'))
  const rows = db.prepare('SELECT topic FROM topic_cache').all() as { topic: string }[]
  const topics = rows.map(r => r.topic)
  return extractTags(query, topics, apiKey)
})

// Shared helper: upsert raw GitHub results to DB and return RepoRows in original order
function upsertAndReturnRepoRows(db: Database.Database, results: any[], query: string): any[] {
  if (results.length === 0) return []
  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, pushed_at, created_at, saved_at, type, banner_svg,
                       discovered_at, discover_query, watchers, size, open_issues, default_branch,
                       type_bucket, type_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
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
      saved_at       = repos.saved_at,
      type_bucket    = excluded.type_bucket,
      type_sub       = excluded.type_sub
  `)
  const select = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?')
  db.transaction(() => {
    for (const repo of results) {
      const rid = String(repo.id)
      cascadeRepoId(db, repo.owner.login, repo.name, rid)
      const classified = classifyRepoBucket({ name: repo.name, description: repo.description, topics: JSON.stringify(repo.topics ?? []) })
      upsert.run(
        rid, repo.owner.login, repo.name, repo.description, repo.language,
        JSON.stringify(repo.topics ?? []), repo.stargazers_count, repo.forks_count,
        repo.license?.spdx_id ?? null, repo.homepage, repo.updated_at, repo.pushed_at,
        repo.created_at ?? null,
        now, query, repo.watchers_count ?? null, repo.size, repo.open_issues_count ?? null,
        repo.default_branch ?? 'main',
        classified?.bucket ?? null, classified?.subType ?? null,
      )
    }
  })()
  return results.map(r => select.get(r.owner.login, r.name)).filter(Boolean)
}

ipcMain.handle('search:raw', async (_, query: string, language?: string, filters?: SearchFilters, page?: number) => {
  const token = getToken() ?? null
  const db = getDb(app.getPath('userData'))
  const p = page ?? 1
  const filterKey = filters ? JSON.stringify(filters) : ''
  const cacheKey = `raw:${query}:${language ?? 'all'}:${filterKey}:p${p}`
  const TTL = 30 * 60 * 1000

  const cached = db.prepare(
    'SELECT results, fetched_at FROM search_cache WHERE cache_key = ?'
  ).get(cacheKey) as { results: string; fetched_at: string } | undefined

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL) {
    return JSON.parse(cached.results)
  }

  const apiResults = await rawSearch(token, query, language, filters, p)
  const rows = upsertAndReturnRepoRows(db, apiResults, query)

  db.prepare(
    'INSERT OR REPLACE INTO search_cache (cache_key, results, fetched_at) VALUES (?, ?, ?)'
  ).run(cacheKey, JSON.stringify(rows), new Date().toISOString())

  return rows
})

ipcMain.handle('search:tagged', async (_, tags: string[], originalQuery: string, language?: string, filters?: SearchFilters, page?: number) => {
  const token = getToken() ?? null
  const db = getDb(app.getPath('userData'))
  const p = page ?? 1
  const filterKey = filters ? JSON.stringify(filters) : ''
  const cacheKey = `tagged:${[...tags].sort().join(',')}:${language ?? 'all'}:${filterKey}:p${p}`
  const TTL = 60 * 60 * 1000

  const cached = db.prepare(
    'SELECT results, fetched_at FROM search_cache WHERE cache_key = ?'
  ).get(cacheKey) as { results: string; fetched_at: string } | undefined

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL) {
    return JSON.parse(cached.results)
  }

  const apiResults = await tagSearch(token, tags, originalQuery, language, filters, p)
  const rows = upsertAndReturnRepoRows(db, apiResults, originalQuery)

  db.prepare(
    'INSERT OR REPLACE INTO search_cache (cache_key, results, fetched_at) VALUES (?, ?, ?)'
  ).run(cacheKey, JSON.stringify(rows), new Date().toISOString())

  return rows
})

ipcMain.handle('search:getRelatedTags', async (_, results: any[], currentTags: string[]) => {
  return getRelatedTags(results, currentTags)
})

// ── Org verified badge IPC ───────────────────────────────────────

ipcMain.handle('org:getVerified', async (_, orgLogin: string) => {
  const db = getDb(app.getPath('userData'))
  const cached = db.prepare(
    'SELECT owner_is_verified FROM repos WHERE owner = ? LIMIT 1'
  ).get(orgLogin) as { owner_is_verified: number | null } | undefined

  // Cache hit: row exists and has been fetched before (not NULL)
  if (cached !== undefined && cached.owner_is_verified !== null) {
    return cached.owner_is_verified === 1
  }

  // Cache miss: call GitHub API
  const token = getToken() ?? null
  const verified = await getOrgVerified(token, orgLogin)

  // Persist result against every repo from this owner
  db.prepare('UPDATE repos SET owner_is_verified = ? WHERE owner = ?')
    .run(verified ? 1 : 0, orgLogin)

  // Also cache in profile_cache if a row exists
  db.prepare('UPDATE profile_cache SET is_verified = ? WHERE username = ?')
    .run(verified ? 1 : 0, orgLogin)

  return verified
})

// ── Repo colour extraction IPC ───────────────────────────────────

ipcMain.handle('repo:extractColor', async (_, avatarUrl: string, repoId: string) => {
  const db = getDb(app.getPath('userData'))
  const color = await extractDominantColor(avatarUrl)
  db.prepare('UPDATE repos SET banner_color = ? WHERE id = ?').run(JSON.stringify(color), repoId)
  return color
})

// ── Storybook IPC ───────────────────────────────────────────────────────────

ipcMain.handle('storybook:detect', async (_event, owner: string, name: string, extraCandidates?: string[]) => {
  const db = getDb(app.getPath('userData'))

  // 1. Return cached URL if already confirmed
  const cached = db.prepare('SELECT storybook_url FROM repos WHERE owner = ? AND name = ?')
    .get(owner, name) as { storybook_url: string | null } | undefined
  if (cached?.storybook_url) {
    return cached.storybook_url
  }

  // 2. Build candidates from DB homepage + GitHub Pages pattern + extras
  const repoRow = db.prepare('SELECT homepage FROM repos WHERE owner = ? AND name = ?')
    .get(owner, name) as { homepage: string | null } | undefined
  const candidates = buildCandidates(owner, name, repoRow?.homepage ?? null, extraCandidates ?? [])

  // 3. Probe candidates in order — first hit wins
  for (const candidate of candidates) {
    const found = await probeStorybookUrl(candidate)
    if (found) {
      db.prepare('UPDATE repos SET storybook_url = ? WHERE owner = ? AND name = ?')
        .run(found, owner, name)
      return found
    }
  }

  // 4. Not found — return null without writing to DB so detection retries next visit
  return null
})

ipcMain.handle('storybook:getIndex', async (_event, storybookUrl: string) => {
  const base = storybookUrl.replace(/\/$/, '')
  const candidates = [
    `${base}/index.json`,
    `${base}/stories.json`,
    `${base}/storybook-static/index.json`,
    `${base}/storybook-static/stories.json`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      return await res.json()
    } catch {
      // try next
    }
  }
  return null
})

registerComponentsIPC()
registerVerificationHandlers()
registerDownloadHandlers()
registerAiChatHandlers()
registerTtsHandlers()
registerRecommendHandlers()
registerEngagementHandlers()
registerUpdateHandlers()
registerCreateHandlers()

// ── Profile IPC ──────────────────────────────────────────────────

ipcMain.handle('profile:getUser', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  const db = getDb(app.getPath('userData'))
  const TTL = 10 * 60 * 1000
  const cached = db.prepare('SELECT data, fetched_at FROM profile_cache WHERE username = ?').get(username) as { data: string; fetched_at: string } | undefined
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL) {
    return JSON.parse(cached.data)
  }
  const user = await getProfileUser(token, username)
  db.prepare('INSERT OR REPLACE INTO profile_cache (username, data, fetched_at) VALUES (?, ?, ?)').run(username, JSON.stringify(user), new Date().toISOString())
  return user
})

ipcMain.handle('profile:getUserRepos', async (_, username: string, sort?: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return getUserRepos(token, username, sort)
})

ipcMain.handle('github:getMyRepos', async () => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return getMyRepos(token)
})

ipcMain.handle('projects:scanFolder', async (_event, folderPath: string) => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')

  let entries: string[]
  try { entries = fs.readdirSync(folderPath) } catch { return [] }

  const results: { name: string; path: string; isGit: boolean; owner: string | null; repoName: string | null }[] = []

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry)
    let stat: import('fs').Stats
    try { stat = fs.statSync(fullPath) } catch { continue }
    if (!stat.isDirectory()) continue

    const gitDir = path.join(fullPath, '.git')
    const isGit = fs.existsSync(gitDir)
    let owner: string | null = null
    let repoName: string | null = null

    if (isGit) {
      const configPath = path.join(gitDir, 'config')
      try {
        const cfg = fs.readFileSync(configPath, 'utf8')
        const httpsMatch = cfg.match(/url\s*=\s*https?:\/\/github\.com\/([^/\s]+)\/([^/\s.]+)/)
        const sshMatch   = cfg.match(/url\s*=\s*git@github\.com:([^/\s]+)\/([^/\s.]+)/)
        const m = httpsMatch ?? sshMatch
        if (m) { owner = m[1]; repoName = m[2].replace(/\.git$/, '') }
      } catch { /* no config readable */ }
    }

    results.push({ name: entry, path: fullPath, isGit, owner, repoName })
  }

  return results
})

ipcMain.handle('projects:openFolder', async (_event, folderPath: string) => {
  shell.openPath(folderPath)
})

ipcMain.handle('projects:readFile', async (_event, folderPath: string, filename: string) => {
  const fullPath = path.join(folderPath, filename)
  try {
    return await fs.readFile(fullPath, 'utf8')
  } catch {
    return null
  }
})

ipcMain.handle('projects:listDir', async (_event, folderPath: string, subPath: string) => {
  const targetDir = subPath ? path.join(folderPath, subPath) : folderPath
  try {
    const names = await fs.readdir(targetDir)
    const entries = await Promise.all(
      names
        .filter(n => !n.startsWith('.') || n === '.env')
        .map(async name => {
          const full = path.join(targetDir, name)
          try {
            const stat = await fs.stat(full)
            return { name, path: subPath ? `${subPath}/${name}` : name, type: stat.isDirectory() ? 'dir' as const : 'file' as const, size: stat.isFile() ? stat.size : null }
          } catch {
            return null
          }
        })
    )
    const filtered = entries.filter((e): e is NonNullable<typeof e> => e !== null)
    filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return filtered
  } catch {
    return []
  }
})

ipcMain.handle('projects:renameFolder', async (_event, folderPath: string, newName: string) => {
  const parent = path.dirname(folderPath)
  const dest = path.join(parent, newName)
  await fs.rename(folderPath, dest)
  return dest
})

ipcMain.handle('projects:writeFile', async (_event, folderPath: string, filename: string, content: string) => {
  const fullPath = path.join(folderPath, filename)
  await fs.writeFile(fullPath, content, 'utf8')
})

ipcMain.handle('profile:getStarred', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return getUserStarred(token, username)
})

ipcMain.handle('profile:getFollowing', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return getUserFollowing(token, username)
})

ipcMain.handle('profile:getFollowers', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return getUserFollowers(token, username)
})

ipcMain.handle('profile:isFollowing', async (_, username: string) => {
  const token = getToken()
  if (!token) return false
  return checkIsFollowing(token, username)
})

ipcMain.handle('profile:follow', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return followUser(token, username)
})

ipcMain.handle('profile:unfollow', async (_, username: string) => {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  return unfollowUser(token, username)
})

// ── DB helpers IPC ──────────────────────────────────────────────
ipcMain.handle('db:setStarredAt', async (_, repoId: string, value: string | null) => {
  const db = getDb(app.getPath('userData'))
  db.prepare('UPDATE repos SET starred_at = ? WHERE id = ?').run(value, repoId)
})

ipcMain.handle('db:cacheTranslatedDescription', async (_, repoId: string, text: string, targetLang: string, detectedLang: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(`
    UPDATE repos SET
      translated_description = ?,
      translated_description_lang = ?,
      detected_language = ?
    WHERE id = ?
  `).run(text, targetLang, detectedLang, repoId)
})

ipcMain.handle('db:cacheTranslatedReadme', async (_, repoId: string, text: string, targetLang: string, detectedLang: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare(`
    UPDATE repos SET
      translated_readme = ?,
      translated_readme_lang = ?,
      detected_language = ?
    WHERE id = ?
  `).run(text, targetLang, detectedLang, repoId)
})

// ── Language preference IPC ─────────────────────────────────────
ipcMain.handle('settings:getPreferredLanguage', async () => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferred_language'").get() as { value: string } | undefined
  return row?.value ?? 'en'
})

ipcMain.handle('settings:setPreferredLanguage', async (_, lang: string) => {
  const db = getDb(app.getPath('userData'))
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('preferred_language', ?)").run(lang)
})

// ── Translation IPC ─────────────────────────────────────────────
ipcMain.handle('translate:check', async (_, text: string, targetLang: string, minLength?: number) => {
  return needsTranslation(text, targetLang, minLength)
})

ipcMain.handle('translate:translate', async (_, text: string, targetLang: string) => {
  return translateText(text, targetLang)
})

// ── Link preview metadata fetch ───────────────────────────────────────────
// Pre-compiled OG / meta regexes.
// Each field has four variants: (prop→content | content→prop) × (double | single quotes).
// Separating quote styles is required so a value like "It's great" isn't truncated
// at the apostrophe the way a [^"']+ capture would be.
function firstMatch(patterns: RegExp[], text: string): string {
  for (const re of patterns) { const m = re.exec(text); if (m?.[1]) return m[1] }
  return ''
}
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
    .replace(/&#x27;/gi, "'").replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g,    (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// ── OG image preview ──────────────────────────────────────────────
let ogFetchCount = 0
const OG_MAX_CONCURRENT = 2

ipcMain.handle('repo:getOgImage', async (_event, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))

  // 1. Check cache (query by owner+name, not by id — id is a numeric GitHub ID)
  const row = db.prepare('SELECT og_image_url FROM repos WHERE owner = ? AND name = ?').get(owner, name) as
    { og_image_url: string | null } | undefined
  if (row && row.og_image_url !== null) {
    return row.og_image_url || null          // '' → null for frontend
  }

  // 2. Concurrency gate
  if (ogFetchCount >= OG_MAX_CONCURRENT) return null
  ogFetchCount++

  const cacheEmpty = () => {
    try { db.prepare('UPDATE repos SET og_image_url = ? WHERE owner = ? AND name = ?').run('', owner, name) } catch {}
  }

  try {
    const url = `https://github.com/${owner}/${name}`
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 8000)

    const res = await net.fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!res.ok) { clearTimeout(timeout); cacheEmpty(); return null }

    // Read at most 100 KB — <head> is always within that
    const reader = res.body?.getReader()
    if (!reader) { clearTimeout(timeout); cacheEmpty(); return null }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
      if (total >= 100_000) break
    }
    clearTimeout(timeout)
    reader.cancel().catch(() => {})

    const html = new TextDecoder().decode(
      chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c })
    )

    const headEnd = html.search(/<\/head>|<body[\s>]/i)
    const head = headEnd > -1 ? html.slice(0, headEnd) : html

    let imageUrl = parseOgImage(head)

    // Resolve relative URLs
    if (imageUrl) {
      try { imageUrl = new URL(imageUrl, url).href } catch { imageUrl = null }
    }

    // Filter out generic GitHub OG cards
    if (!imageUrl || isGenericGitHubOg(imageUrl)) {
      cacheEmpty()
      return null
    }

    // Cache custom OG image
    try { db.prepare('UPDATE repos SET og_image_url = ? WHERE owner = ? AND name = ?').run(imageUrl, owner, name) } catch {}
    return imageUrl
  } catch {
    cacheEmpty()
    return null
  } finally {
    ogFetchCount--
  }
})

const OG_TITLE_RE = [
  /<meta[^>]+property=["']og:title["'][^>]+content="([^"]+)"/i,
  /<meta[^>]+property=["']og:title["'][^>]+content='([^']+)'/i,
  /<meta[^>]+content="([^"]+)"[^>]+property=["']og:title["']/i,
  /<meta[^>]+content='([^']+)'[^>]+property=["']og:title["']/i,
]
const TW_TITLE_RE = [  // twitter:title fallback — common on sites without og:title
  /<meta[^>]+name=["']twitter:title["'][^>]+content="([^"]+)"/i,
  /<meta[^>]+name=["']twitter:title["'][^>]+content='([^']+)'/i,
  /<meta[^>]+content="([^"]+)"[^>]+name=["']twitter:title["']/i,
  /<meta[^>]+content='([^']+)'[^>]+name=["']twitter:title["']/i,
]
const OG_DESCRIPTION_RE = [
  /<meta[^>]+property=["']og:description["'][^>]+content="([^"]+)"/i,
  /<meta[^>]+property=["']og:description["'][^>]+content='([^']+)'/i,
  /<meta[^>]+content="([^"]+)"[^>]+property=["']og:description["']/i,
  /<meta[^>]+content='([^']+)'[^>]+property=["']og:description["']/i,
]
const OG_IMAGE_RE = [
  /<meta[^>]+property=["']og:image["'][^>]+content="([^"]+)"/i,
  /<meta[^>]+property=["']og:image["'][^>]+content='([^']+)'/i,
  /<meta[^>]+content="([^"]+)"[^>]+property=["']og:image["']/i,
  /<meta[^>]+content='([^']+)'[^>]+property=["']og:image["']/i,
]
const META_DESC_RE = [
  /<meta[^>]+name=["']description["'][^>]+content="([^"]+)"/i,
  /<meta[^>]+name=["']description["'][^>]+content='([^']+)'/i,
  /<meta[^>]+content="([^"]+)"[^>]+name=["']description["']/i,
  /<meta[^>]+content='([^']+)'[^>]+name=["']description["']/i,
]

ipcMain.handle('fetch-link-preview', async (_event, url: string) => {
  const EMPTY = { title: '', description: '', imageUrl: '', faviconUrl: '', domain: '' }

  let domain = ''
  try {
    const parsedUrl = new URL(url)
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) return EMPTY
    domain = parsedUrl.hostname
  } catch { return EMPTY }

  try {
    const res = await net.fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return { ...EMPTY, domain }

    // Read at most 100 KB — <head> is always within that
    const reader = res.body?.getReader()
    if (!reader) return { ...EMPTY, domain }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
      if (total >= 100_000) break
    }
    reader.cancel().catch(() => {})
    if (chunks.length === 0) return { ...EMPTY, domain }
    const html = new TextDecoder().decode(
      chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c })
    )

    // Only parse up to </head> or <body
    const headEnd = html.search(/<\/head>|<body[\s>]/i)
    const head = headEnd > -1 ? html.slice(0, headEnd) : html

    const title       = decodeHtmlEntities(
      firstMatch(OG_TITLE_RE, head) ||
      firstMatch(TW_TITLE_RE, head) ||
      head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || ''
    )
    const description = decodeHtmlEntities(
      firstMatch(OG_DESCRIPTION_RE, head) || firstMatch(META_DESC_RE, head)
    )
    let   imageUrl    = firstMatch(OG_IMAGE_RE, head)
    const faviconRaw  = head.match(/<link[^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1]
                     ?? head.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["']/i)?.[1]
                     ?? ''

    // Resolve relative URLs
    const origin = new URL(url).origin
    if (imageUrl) {
      try { imageUrl = new URL(imageUrl, url).href } catch { imageUrl = '' }
    }
    let faviconUrl = `${origin}/favicon.ico`
    if (faviconRaw) {
      try { faviconUrl = new URL(faviconRaw, url).href } catch {}
    }

    return { title, description, imageUrl, faviconUrl, domain }
  } catch {
    return { ...EMPTY, domain }
  }
})

// ── App lifecycle ───────────────────────────────────────────────

app.whenReady().then(() => {
  // Grant permissions (including microphone for speech-to-text)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true)
  })

  registerBadgeProtocol()
  registerGhImgProtocol()
  extractionCache.init(path.join(app.getPath('userData'), 'extraction-cache'))
  const db = getDb(app.getPath('userData'))
  seedCommunityCollections(db)

  // Migration: chroma-weighted hue extraction (v3) produces more accurate banner colors.
  // Clear all previously-extracted banner_color values so they re-extract on next sync.
  const extVer = (db.prepare("SELECT value FROM settings WHERE key = 'color_extractor_version'").get() as { value: string } | undefined)?.value
  if (extVer !== '3') {
    db.prepare('UPDATE repos SET banner_color = NULL').run()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('color_extractor_version', '3')").run()
  }

  // Backfill type_bucket/type_sub for repos classified before Phase 16 — deferred so window opens immediately
  setImmediate(() => {
    const unclassified = db.prepare(
      'SELECT id, name, description, topics FROM repos WHERE type_bucket IS NULL'
    ).all() as { id: number; name: string; description: string | null; topics: string }[]
    if (unclassified.length > 0) {
      const updateType = db.prepare(
        'UPDATE repos SET type_bucket = ?, type_sub = ? WHERE id = ?'
      )
      const backfill = db.transaction(() => {
        for (const row of unclassified) {
          const classified = classifyRepoBucket({ name: row.name, description: row.description, topics: row.topics ?? '[]' })
          updateType.run(classified?.bucket ?? null, classified?.subType ?? null, row.id)
        }
      })
      backfill()
    }
  })

  setImmediate(() => startMCPServer())
  createWindow()
  if (mainWindow) {
    startVerificationService(db, mainWindow)
    startSkillSyncService(db, mainWindow)
    startUpdateService(db, mainWindow)
  }
  const existingToken = getToken()
  if (existingToken) initTopicCache(existingToken).catch(() => {}) // Non-blocking
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  closeAllOnQuit()
  mcpProcess?.kill()
  closeDb()
})
