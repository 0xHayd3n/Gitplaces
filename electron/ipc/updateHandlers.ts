// electron/ipc/updateHandlers.ts
import { ipcMain, app } from 'electron'
import { getDb } from '../db'
import { getToken } from '../store'
import { githubHeaders } from '../github'
import { checkAll, applyForkSync, applySkillRegen, restartUpdateService } from '../services/updateService'

export function registerUpdateHandlers(): void {

  // Trigger immediate full check outside normal interval (Settings "Check now")
  ipcMain.handle('update:check-now', async () => {
    await checkAll()
  })

  // Get MAX(update_checked_at) for the Settings "Last checked" display
  ipcMain.handle('update:last-checked', () => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare('SELECT MAX(update_checked_at) as ts FROM repos').get() as { ts: number | null } | undefined
    return { timestamp: row?.ts ?? null }
  })

  // Fetch diff/release notes before user confirms update
  ipcMain.handle('update:get-changes', async (_event, repoId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(
      'SELECT owner, name, stored_version, upstream_version, is_forked FROM repos WHERE id = ?'
    ).get(repoId) as { owner: string; name: string; stored_version: string | null; upstream_version: string | null; is_forked: number } | undefined
    if (!row) throw new Error('Repo not found')

    const token = getToken() ?? null
    const headers = githubHeaders(token)

    const result: {
      type: 'release' | 'commits'
      releaseNotes?: string
      commits?: { sha: string; message: string; author: string; date: string }[]
      upstreamVersion: string
    } = { type: 'commits', upstreamVersion: row.upstream_version ?? '' }

    if (row.is_forked && row.stored_version && row.upstream_version) {
      const compareRes = await fetch(
        `https://api.github.com/repos/${row.owner}/${row.name}/compare/${row.stored_version}...${row.upstream_version}`,
        { headers }
      )
      if (compareRes.ok) {
        const data = await compareRes.json() as { commits?: { sha: string; commit: { message: string; author: { name: string; date: string } } }[] }
        result.type = 'commits'
        result.commits = (data.commits ?? []).slice(0, 30).map(c => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
          date: c.commit.author.date,
        }))
        return result
      }
    }

    const relRes = await fetch(`https://api.github.com/repos/${row.owner}/${row.name}/releases/latest`, { headers })
    if (relRes.ok) {
      const rel = await relRes.json() as { body?: string | null; tag_name: string }
      result.type = 'release'
      result.releaseNotes = rel.body ?? ''
      result.upstreamVersion = rel.tag_name
      return result
    }

    const commitsRes = await fetch(
      `https://api.github.com/repos/${row.owner}/${row.name}/commits?per_page=20`,
      { headers }
    )
    if (commitsRes.ok) {
      const commits = await commitsRes.json() as { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
      result.commits = commits.slice(0, 20).map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
      }))
    }
    return result
  })

  // Fork sync
  ipcMain.handle('update:apply-fork-sync', async (_event, repoId: string) => {
    return applyForkSync(repoId)
  })

  // Skill regeneration — all logic is in updateService.applySkillRegen
  ipcMain.handle('update:apply-skill-regen', async (_event, repoId: string) => {
    return applySkillRegen(repoId)
  })

  // Restart polling interval (called when updateCheckIntervalHours setting changes)
  ipcMain.handle('update:restart-service', () => {
    restartUpdateService()
  })
}
