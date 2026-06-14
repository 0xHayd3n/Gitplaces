// electron/ipc/engagementHandlers.ts
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { logClick, getRecentlyVisited } from '../services/engagementTracker'
import { repoRowToSavedRepo } from '../repoNormalize'
import type { RepoRow } from '../db-row-types'

export function registerEngagementHandlers(): void {
  ipcMain.handle('engagement:logClick', (_event, repoId: string, source: string) => {
    logClick(getDb(app.getPath('userData')), repoId, source)
  })
  ipcMain.handle('engagement:getRecentlyVisited', (_event, limit?: number) => {
    const db = getDb(app.getPath('userData'))
    return (getRecentlyVisited(db, limit) as RepoRow[]).map(repoRowToSavedRepo)
  })
}
