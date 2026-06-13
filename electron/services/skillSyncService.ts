import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getToken, getSyncEnabled, getSyncRepoOwner, setSyncEnabled, setSyncRepoOwner } from '../store'
import { createRepo, putFileContents, getRepo } from '../providers/github'

export const SKILLS_BACKUP_REPO = 'gitsuite-skills'

let _win: BrowserWindow | null = null
let _db: Database.Database | null = null

export function startSkillSyncService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
}

// repoId is TEXT (repos.id is TEXT PRIMARY KEY)
export async function push(
  repoId: string,
  owner: string,
  filename: string,
  content: string,
  skillType?: string
): Promise<void> {
  if (!getSyncEnabled()) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  const githubPath = `${owner}/${filename}`

  let currentSha: string | undefined
  if (skillType) {
    const row = _db!.prepare(
      'SELECT github_sha FROM sub_skills WHERE repo_id = ? AND skill_type = ?'
    ).get(repoId, skillType) as { github_sha: string | null } | undefined
    currentSha = row?.github_sha ?? undefined
  } else {
    const row = _db!.prepare(
      'SELECT github_sha FROM skills WHERE repo_id = ?'
    ).get(repoId) as { github_sha: string | null } | undefined
    currentSha = row?.github_sha ?? undefined
  }

  try {
    const result = await putFileContents(
      token, repoOwner, SKILLS_BACKUP_REPO, githubPath, content,
      `sync ${filename}`, currentSha
    )
    const newSha = result.content.sha
    if (skillType) {
      _db!.prepare(
        'UPDATE sub_skills SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ? AND skill_type = ?'
      ).run(newSha, Date.now(), 'synced', repoId, skillType)
    } else {
      _db!.prepare(
        'UPDATE skills SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ?'
      ).run(newSha, Date.now(), 'synced', repoId)
    }
  } catch {
    if (skillType) {
      _db!.prepare(
        'UPDATE sub_skills SET sync_status = ? WHERE repo_id = ? AND skill_type = ?'
      ).run('failed', repoId, skillType)
    } else {
      _db!.prepare(
        'UPDATE skills SET sync_status = ? WHERE repo_id = ?'
      ).run('failed', repoId)
    }
    _win?.webContents.send('skillSync:syncFailed', { owner, filename })
  }
}

export async function pushAll(statusFilter?: 'pending' | 'failed' | 'all'): Promise<void> {
  if (!getSyncEnabled()) return
  if (!_db) return

  const buildWhere = (filter?: 'pending' | 'failed' | 'all') => {
    if (filter === 'all') return '1=1'
    if (filter === 'failed') return "sync_status = 'failed'"
    if (filter === 'pending') return "(sync_status = 'pending' OR sync_status IS NULL)"
    return "(sync_status = 'pending' OR sync_status IS NULL OR sync_status = 'failed')"
  }
  const where = buildWhere(statusFilter)

  type SkillRow = { repo_id: string; owner: string; filename: string; content: string }
  const primarySkills = _db!.prepare(
    `SELECT s.repo_id, r.owner, s.filename, s.content
     FROM skills s JOIN repos r ON r.id = s.repo_id
     WHERE ${where} AND s.active = 1`
  ).all() as SkillRow[]

  type SubSkillRow = { repo_id: string; owner: string; filename: string; skill_type: string; content: string }
  const subSkills = _db!.prepare(
    `SELECT ss.repo_id, r.owner, ss.filename, ss.skill_type, ss.content
     FROM sub_skills ss JOIN repos r ON r.id = ss.repo_id
     WHERE ${where} AND ss.active = 1`
  ).all() as SubSkillRow[]

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  for (const s of primarySkills) {
    await push(s.repo_id, s.owner, s.filename, s.content)
    await delay(250)
  }

  for (const s of subSkills) {
    // Pass the raw skill_type value including any 'version:' prefix
    await push(s.repo_id, s.owner, s.filename, s.content, s.skill_type)
    await delay(250)
  }

  const failed = _db!.prepare(
    "SELECT COUNT(*) as n FROM skills WHERE sync_status = 'failed'"
  ).get() as { n: number }
  const failedSub = _db!.prepare(
    "SELECT COUNT(*) as n FROM sub_skills WHERE sync_status = 'failed'"
  ).get() as { n: number }
  const failCount = failed.n + failedSub.n

  if (failCount > 0) {
    _win?.webContents.send('skillSync:syncFailed', { summary: true, failCount })
  }
}

export async function setupRepo(
  username: string
): Promise<{ ok: true; repoUrl: string } | { ok: false; error: string }> {
  const token = getToken()
  if (!token) return { ok: false, error: 'Not authenticated' }

  let repoUrl: string
  try {
    // getRepo throws on 404 — use catch to distinguish exists vs. needs creating
    const existing = await getRepo(token ?? null, username, SKILLS_BACKUP_REPO)
    repoUrl = existing.html_url
  } catch {
    try {
      const created = await createRepo(token, SKILLS_BACKUP_REPO)
      repoUrl = created.html_url
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  setSyncEnabled(true)
  setSyncRepoOwner(username)

  // Mark all unsynced skills as 'pending' so interrupted pushAll is resumable
  _db!.prepare(
    "UPDATE skills SET sync_status = 'pending' WHERE sync_status IS NULL"
  ).run()
  _db!.prepare(
    "UPDATE sub_skills SET sync_status = 'pending' WHERE sync_status IS NULL"
  ).run()
  // Same for agent backups — first-time setup should pick up every existing
  // agent. Triggering the actual push is main.ts's job (avoids a circular
  // import: agentsBackupSyncService already depends on this module for
  // SKILLS_BACKUP_REPO).
  _db!.prepare(
    "UPDATE agent_files SET backup_sync_status = 'pending' WHERE backup_sync_status IS NULL"
  ).run()

  // Fire-and-forget initial bulk sync — only push pending/failed rows
  void pushAll()

  return { ok: true, repoUrl }
}
