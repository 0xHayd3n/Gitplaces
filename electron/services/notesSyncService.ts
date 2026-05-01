import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getToken, getSyncEnabled, getSyncRepoOwner } from '../store'
import { putFileContents, getFileContentWithSha } from '../github'
import { SKILLS_BACKUP_REPO } from './skillSyncService'

let _win: BrowserWindow | null = null
let _db: Database.Database | null = null

export function startNotesSyncService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
}

function formatNoteFile(notes: string, updatedAt: number): string {
  return `<!-- updated: ${updatedAt} -->\n${notes}`
}

function parseUpdatedAt(content: string): number {
  const match = content.split('\n')[0].match(/^<!-- updated: (\d+) -->$/)
  return match ? parseInt(match[1], 10) : 0
}

export async function pushNote(
  repoId: string,
  owner: string,
  repoName: string,
  notes: string,
  updatedAt: number,
): Promise<void> {
  if (!getSyncEnabled()) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  const githubPath = `notes/${owner}/${repoName}.md`
  const content = formatNoteFile(notes, updatedAt)

  const row = _db!.prepare(
    'SELECT github_sha FROM repo_notes WHERE repo_id = ?'
  ).get(repoId) as { github_sha: string | null } | undefined
  const currentSha = row?.github_sha ?? undefined

  try {
    const result = await putFileContents(
      token, repoOwner, SKILLS_BACKUP_REPO, githubPath, content,
      `sync notes for ${owner}/${repoName}`, currentSha
    )
    _db!.prepare(
      'UPDATE repo_notes SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ?'
    ).run(result.content.sha, Date.now(), 'synced', repoId)
  } catch {
    _db!.prepare(
      'UPDATE repo_notes SET sync_status = ? WHERE repo_id = ?'
    ).run('failed', repoId)
  }
}

export async function pushAllPendingNotes(): Promise<void> {
  if (!getSyncEnabled()) return
  if (!_db) return

  type NoteRow = { repo_id: string; owner: string; repo_name: string; notes: string; updated_at: number }
  const rows = _db.prepare(`
    SELECT n.repo_id, r.owner, r.name AS repo_name, n.notes, n.updated_at
    FROM repo_notes n JOIN repos r ON r.id = n.repo_id
    WHERE n.sync_status = 'pending' OR n.sync_status = 'failed'
  `).all() as NoteRow[]

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
  for (const row of rows) {
    await pushNote(row.repo_id, row.owner, row.repo_name, row.notes, row.updated_at)
    await delay(250)
  }
}

export async function pullNote(
  repoId: string,
  owner: string,
  repoName: string,
): Promise<{ notes: string; updatedAt: number; sha: string } | null> {
  if (!getSyncEnabled()) return null
  const token = getToken()
  if (!token) return null
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return null

  const githubPath = `notes/${owner}/${repoName}.md`
  const remote = await getFileContentWithSha(token, repoOwner, SKILLS_BACKUP_REPO, githubPath)
  if (!remote) return null

  const updatedAt = parseUpdatedAt(remote.content)
  const notes = remote.content.split('\n').slice(1).join('\n')
  return { notes, updatedAt, sha: remote.sha }
}
