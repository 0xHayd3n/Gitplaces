// electron/ipc/engagementHandlers.ts
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { logClick, getRecentlyVisited } from '../services/engagementTracker'

export function registerEngagementHandlers(): void {
  ipcMain.handle('engagement:logClick', (_event, repoId: string, source: string) => {
    logClick(getDb(app.getPath('userData')), repoId, source)
  })
  ipcMain.handle('engagement:getRecentlyVisited', (_event, limit?: number) => {
    return getRecentlyVisited(getDb(app.getPath('userData')), limit)
  })
}
