import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getToken, getSyncEnabled, getSyncRepoOwner } from '../store'
import { putFileContents } from '../github'
import { SKILLS_BACKUP_REPO } from './skillSyncService'
import type { AgentRow, AgentFile } from '../../src/types/agent'
import { previewSubagentFile } from './agentFileSyncService'

let _win: BrowserWindow | null = null
let _db: Database.Database | null = null

export function startAgentsBackupSyncService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
}

// Path layout in the gitsuite-skills repo: agents/{handle}/{filename}
// Primary file (sort_order=0) is rendered with full frontmatter so the backup
// is a complete, restorable copy. Secondary files are pushed raw.
function backupPathFor(handle: string, filename: string): string {
  return `agents/${handle}/${filename}`
}

function renderFileContent(agent: AgentRow, file: AgentFile, primaryContent: string): string {
  return file.sort_order === 0
    ? previewSubagentFile(agent, primaryContent)
    : file.content
}

// Push one file. Internal helper — callers should use pushAgent or pushAllPendingAgents.
async function pushOne(
  token: string,
  repoOwner: string,
  handle: string,
  file: AgentFile,
  rendered: string,
): Promise<void> {
  const githubPath = backupPathFor(handle, file.filename)
  const currentSha = file.backup_github_sha ?? undefined

  try {
    const result = await putFileContents(
      token, repoOwner, SKILLS_BACKUP_REPO, githubPath, rendered,
      `sync agent ${handle}/${file.filename}`, currentSha,
    )
    _db!.prepare(
      `UPDATE agent_files
       SET backup_github_sha = ?, backup_synced_at = ?, backup_sync_status = ?
       WHERE id = ?`,
    ).run(result.content.sha, Date.now(), 'synced', file.id)
  } catch {
    _db!.prepare(
      `UPDATE agent_files SET backup_sync_status = ? WHERE id = ?`,
    ).run('failed', file.id)
    _win?.webContents.send('agentsBackupSync:syncFailed', { handle, filename: file.filename })
  }
}

const PUSH_DELAY_MS = 250
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Push every file belonging to one agent. Caller is fire-and-forget; this
// won't throw. Bails silently when sync isn't configured.
export async function pushAgent(agentId: string): Promise<void> {
  if (!getSyncEnabled()) return
  if (!_db) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  const agent = _db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
  if (!agent) return
  const files = _db.prepare(
    `SELECT * FROM agent_files WHERE agent_id = ? ORDER BY sort_order ASC, filename ASC`,
  ).all(agentId) as AgentFile[]
  if (files.length === 0) return

  const primary = files.find(f => f.sort_order === 0)
  const primaryContent = primary?.content ?? ''

  for (const file of files) {
    const rendered = renderFileContent(agent, file, primaryContent)
    await pushOne(token, repoOwner, agent.handle, file, rendered)
    await delay(PUSH_DELAY_MS)
  }
}

// Bulk push every pending/failed agent file. Used on startup and after the
// user enables sync in Settings.
export async function pushAllPendingAgents(): Promise<void> {
  if (!getSyncEnabled()) return
  if (!_db) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  type Row = AgentFile & {
    handle: string
    agent_name: string
    agent_id_alias: string
  }
  const rows = _db.prepare(`
    SELECT f.*, a.handle, a.name AS agent_name, a.id AS agent_id_alias
    FROM agent_files f
    JOIN agents a ON a.id = f.agent_id
    WHERE f.backup_sync_status = 'pending' OR f.backup_sync_status = 'failed' OR f.backup_sync_status IS NULL
    ORDER BY a.id, f.sort_order ASC
  `).all() as Row[]

  if (rows.length === 0) return

  // Group by agent so we can render each agent's primary content once per batch.
  const byAgent = new Map<string, Row[]>()
  for (const r of rows) {
    const arr = byAgent.get(r.agent_id_alias) ?? []
    arr.push(r)
    byAgent.set(r.agent_id_alias, arr)
  }

  let failCount = 0
  for (const [agentId, agentRows] of byAgent) {
    const agent = _db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
    if (!agent) continue
    // Need the primary content even if the primary isn't in this batch (e.g.
    // only a secondary changed). Read it once.
    const primary = _db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`,
    ).get(agentId) as { content: string } | undefined
    const primaryContent = primary?.content ?? ''

    for (const file of agentRows) {
      const rendered = renderFileContent(agent, file, primaryContent)
      await pushOne(token, repoOwner, agent.handle, file, rendered)
      const after = _db.prepare(
        `SELECT backup_sync_status FROM agent_files WHERE id = ?`,
      ).get(file.id) as { backup_sync_status: string | null } | undefined
      if (after?.backup_sync_status === 'failed') failCount++
      await delay(PUSH_DELAY_MS)
    }
  }

  if (failCount > 0) {
    _win?.webContents.send('agentsBackupSync:syncFailed', { summary: true, failCount })
  }
}

// Mark every agent file as 'pending' so the next pushAllPendingAgents picks
// them up. Used when the user first enables sync — mirrors what
// skillSyncService.setupRepo does for skills.
export function markAllAgentsPending(db: Database.Database): void {
  db.prepare(
    `UPDATE agent_files SET backup_sync_status = 'pending' WHERE backup_sync_status IS NULL`,
  ).run()
}
