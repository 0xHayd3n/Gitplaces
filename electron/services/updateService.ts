// electron/services/updateService.ts
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getToken, getGitHubUser, getApiKey } from '../store'
import { githubHeaders, getReadme, getReleases } from '../github'
import { route as pipelineRoute } from '../skill-gen/pipeline'
import { prepareWrite } from '../skill-gen/regeneration'

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
    const readme = await getReadme(token, row.owner, row.name)
    const releases = await getReleases(token, row.owner, row.name)
    const version = releases[0]?.tag_name ?? 'unknown'
    const topics = JSON.parse(row.topics ?? '[]') as string[]

    // pipelineRoute signature: (flavour: SkillFlavour, input: GenerateInput)
    // GenerateInput: { token, owner, name, language, topics, readme, version, defaultBranch, apiKey?, typeBucket?, typeSub? }
    // SkillFlavour is 'library' | 'codebase' | 'domain' — use 'library' for update regen
    const routeResult = await pipelineRoute('library', {
      token,
      owner: row.owner,
      name: row.name,
      language: row.language ?? '',
      topics,
      readme: readme ?? '',
      version,
      defaultBranch: row.default_branch ?? 'main',
      apiKey: apiKey ?? undefined,
      typeBucket: row.type_bucket ?? undefined,
      typeSub: row.type_sub ?? undefined,
    })

    // RouteResult is a discriminated union; 'codebase' has no .content — narrow first
    if (routeResult.flavour !== 'library' || !routeResult.content) return { ok: false, error: 'No content generated' }

    // Write skill file + update DB — library-flavour path (mirrors main.ts:1184-1229)
    const dir = path.join(app.getPath('userData'), 'skills', row.owner)
    await fs.mkdir(dir, { recursive: true })
    const skillPath = path.join(dir, `${row.name}.skill.md`)
    const storedSkill = (_db!.prepare('SELECT content FROM skills WHERE repo_id = ?')
      .get(repoId) as { content: string } | undefined)?.content ?? null
    const currentSkill = await fs.readFile(skillPath, 'utf8').catch(() => null)
    const generated_at = new Date().toISOString()
    const check = prepareWrite(routeResult.content, storedSkill, currentSkill)
    if (check.conflict) return { ok: false, error: 'Skill file has local edits in the generated block — regenerate manually' }

    await fs.writeFile(skillPath, check.merged!, 'utf8')
    _db!.prepare(`
      INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier)
      VALUES (?, ?, ?, ?, ?, 1, NULL, 1)
      ON CONFLICT(repo_id) DO UPDATE SET
        filename     = excluded.filename,
        content      = excluded.content,
        version      = excluded.version,
        generated_at = excluded.generated_at,
        tier         = excluded.tier
    `).run(repoId, `${row.name}.skill.md`, check.merged!, version, generated_at)

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
      const result = await checkRepo(row.owner, row.name, row.stored_version)
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
