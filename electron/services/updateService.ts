// electron/services/updateService.ts
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getToken, getGitHubUser, getApiKey } from '../store'
import { githubHeaders, getReadme, getReleases } from '../providers/github'
import { generateViaAnatomy, persistAnatomySkill, readFileOrNull } from '../anatomy/index'
import { ensureClone } from '../anatomy/clone'
import { spawnAnatomy, resolveAnatomyRuntime } from '../anatomy/runtime'
import { isAnatomyStale, type StalenessResult } from '../anatomy/staleness'

// ── Pure helpers (tested) ──────────────────────────────────────────────────────

/** Returns true if the upstream release tag differs from what we last stored. */
export function isNewerRelease(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return upstream !== stored
}

/** Returns true if the upstream pushed_at timestamp is more recent than stored. */
export function isNewerPushedAt(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return new Date(upstream).getTime() > new Date(stored).getTime()
}

type AnatomyProbe = (o: string, n: string, b: string, sc: string | null, t: string | null) => Promise<StalenessResult>

/** Anatomy-row staleness: pins to the .anatomy commit instead of releases. */
export async function isAnatomyRepoStale(
  owner: string, name: string, branch: string, storedCommit: string | null,
  token: string | null, probe: AnatomyProbe = isAnatomyStale,
): Promise<{ updateAvailable: boolean; upstreamVersion: string }> {
  const r = await probe(owner, name, branch, storedCommit, token)
  return {
    updateAvailable: r.stale && r.latestSha != null,
    upstreamVersion: r.latestSha ?? storedCommit ?? 'unknown',
  }
}

// ── Service state ─────────────────────────────────────────────────────────────

let _db: Database.Database | null = null
let _win: BrowserWindow | null = null
let _intervalId: ReturnType<typeof setInterval> | null = null

// ── clearUpdateFlag ───────────────────────────────────────────────────────────

export function clearUpdateFlag(repoId: string, upstreamVersion: string | null): void {
  _db?.prepare('UPDATE repos SET update_available = 0, stored_version = ? WHERE id = ?')
    .run(upstreamVersion, repoId)
  _win?.webContents.send('update:status-changed', { ids: [repoId] })
}

// ── checkRepo ─────────────────────────────────────────────────────────────────

export async function checkRepo(
  owner: string,
  name: string,
  storedVersion: string | null,
): Promise<{ updateAvailable: boolean; upstreamVersion: string } | null> {
  const token = getToken() ?? null
  const headers = githubHeaders(token)
  try {
    const relRes = await fetch(`https://api.github.com/repos/${owner}/${name}/releases/latest`, { headers })
    if (relRes.ok) {
      const rel = await relRes.json() as { tag_name: string }
      return { updateAvailable: isNewerRelease(rel.tag_name, storedVersion), upstreamVersion: rel.tag_name }
    }
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers })
    if (!repoRes.ok) return null
    const repo = await repoRes.json() as { pushed_at: string }
    return { updateAvailable: isNewerPushedAt(repo.pushed_at, storedVersion), upstreamVersion: repo.pushed_at }
  } catch {
    return null
  }
}

// ── applyForkSync ─────────────────────────────────────────────────────────────

export async function applyForkSync(repoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!_db) return { ok: false, error: 'Service not initialised' }
  const token = getToken()
  if (!token) return { ok: false, error: 'Not authenticated with GitHub' }
  const githubUser = getGitHubUser()?.username
  if (!githubUser) return { ok: false, error: 'GitHub user not found' }
  const row = _db.prepare('SELECT owner, name, upstream_version FROM repos WHERE id = ?').get(repoId) as
    { owner: string; name: string; upstream_version: string | null } | undefined
  if (!row) return { ok: false, error: 'Repo not found' }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubUser}/${row.name}/merge-upstream`,
      {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'main' }),
      },
    )
    if (!res.ok) {
      const err = await res.json() as { message?: string }
      return { ok: false, error: err.message ?? 'Fork sync failed' }
    }
    clearUpdateFlag(repoId, row.upstream_version)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── applySkillRegen ───────────────────────────────────────────────────────────
// Handles library-flavour regen. For codebase-flavour full support, see main.ts:1143.

export async function applySkillRegen(repoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!_db) return { ok: false, error: 'Service not initialised' }
  const token = getToken() ?? null
  const apiKey = getApiKey()
  const row = _db.prepare(
    'SELECT owner, name, language, topics, default_branch, type_bucket, type_sub, upstream_version FROM repos WHERE id = ?'
  ).get(repoId) as {
    owner: string; name: string; language: string | null; topics: string | null
    default_branch: string | null; type_bucket: string | null; type_sub: string | null; upstream_version: string | null
  } | undefined
  if (!row) return { ok: false, error: 'Repo not found' }

  try {
    const rt = resolveAnatomyRuntime({
      packaged: app.isPackaged, platform: process.platform,
      repoRoot: process.cwd(), resourcesPath: process.resourcesPath,
    })
    const a = await generateViaAnatomy(
      { token, owner: row.owner, name: row.name, defaultBranch: row.default_branch ?? 'main', apiKey: apiKey ?? undefined },
      { ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime: rt },
      path.join(app.getPath('userData'), 'anatomy-cache'),
    )
    await persistAnatomySkill(_db, app.getPath('userData'), repoId, row.owner, row.name, a, row.upstream_version ?? 'unknown')
    clearUpdateFlag(repoId, row.upstream_version)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── checkIsFork ───────────────────────────────────────────────────────────────

export async function checkIsFork(owner: string, name: string): Promise<boolean> {
  const token = getToken() ?? null
  const githubUser = getGitHubUser()?.username
  if (!token || !githubUser) return false
  try {
    const res = await fetch(`https://api.github.com/repos/${githubUser}/${name}`, { headers: githubHeaders(token) })
    if (!res.ok) return false
    const data = await res.json() as { fork?: boolean; parent?: { full_name?: string } }
    return data.fork === true && data.parent?.full_name === `${owner}/${name}`
  } catch {
    return false
  }
}

// ── checkAll ──────────────────────────────────────────────────────────────────

export async function checkAll(): Promise<void> {
  if (!_db) return
  const rows = _db.prepare(
    'SELECT id, owner, name, stored_version FROM repos WHERE saved_at IS NOT NULL'
  ).all() as { id: string; owner: string; name: string; stored_version: string | null }[]

  const changedIds: string[] = []
  const BATCH = 10
  const DELAY = 500

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await Promise.all(batch.map(async (row) => {
      const anat = _db!.prepare(
        `SELECT s.anatomy_source, s.anatomy_commit, r.default_branch
         FROM skills s JOIN repos r ON r.id = s.repo_id WHERE s.repo_id = ?`
      ).get(row.id) as { anatomy_source: string | null; anatomy_commit: string | null; default_branch: string | null } | undefined
      const result = anat?.anatomy_source
        ? await isAnatomyRepoStale(row.owner, row.name, anat.default_branch ?? 'main', anat.anatomy_commit, getToken() ?? null)
        : await checkRepo(row.owner, row.name, row.stored_version)
      if (!result) return
      const prev = (_db!.prepare('SELECT update_available FROM repos WHERE id = ?')
        .get(row.id) as { update_available: number } | undefined)
      const nowSec = Math.floor(Date.now() / 1000)
      _db!.prepare(
        'UPDATE repos SET update_available = ?, upstream_version = ?, update_checked_at = ? WHERE id = ?'
      ).run(result.updateAvailable ? 1 : 0, result.upstreamVersion, nowSec, row.id)
      if ((prev?.update_available === 1) !== result.updateAvailable) {
        changedIds.push(row.id)
      }
    }))
    if (i + BATCH < rows.length) {
      await new Promise<void>(r => setTimeout(r, DELAY))
    }
  }

  const autoSetting = (_db.prepare("SELECT value FROM settings WHERE key = 'autoUpdateEnabled'")
    .get() as { value: string } | undefined)?.value
  if (autoSetting === 'true') {
    const toUpdate = _db.prepare(
      'SELECT id, owner, name, is_forked FROM repos WHERE update_available = 1'
    ).all() as { id: string; owner: string; name: string; is_forked: number }[]
    for (const r of toUpdate) {
      if (r.is_forked) await applyForkSync(r.id).catch(() => {})
      const hasSkill = _db!.prepare('SELECT 1 FROM skills WHERE repo_id = ?').get(r.id)
      if (hasSkill) await applySkillRegen(r.id).catch(() => {})
      if (r.is_forked || hasSkill) {
        _win?.webContents.send('update:toast', { message: `Auto-updated: ${r.owner}/${r.name}` })
      }
    }
  }

  if (changedIds.length > 0) {
    _win?.webContents.send('update:status-changed', { ids: changedIds })
  }
}

// ── Service lifecycle ─────────────────────────────────────────────────────────

export function startUpdateService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
  const hoursStr = (db.prepare("SELECT value FROM settings WHERE key = 'updateCheckIntervalHours'")
    .get() as { value: string } | undefined)?.value ?? '24'
  const ms = Math.max(1, parseInt(hoursStr, 10)) * 60 * 60 * 1000
  void checkAll()
  _intervalId = setInterval(() => void checkAll(), ms)
}

export function stopUpdateService(): void {
  if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null }
}

export function restartUpdateService(): void {
  stopUpdateService()
  if (_db && _win) startUpdateService(_db, _win)
}
