// electron/ipc/engagementHandlers.ts
import { app, ipcMain } from 'electron'
import { getDb } from '../db'
import { logClick } from '../services/engagementTracker'

export function registerEngagementHandlers(): void {
  ipcMain.handle('engagement:logClick', (_event, repoId: string, source: string) => {
    logClick(getDb(app.getPath('userData')), repoId, source)
  })
}
