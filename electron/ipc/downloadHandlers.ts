import { ipcMain, app } from 'electron'
import { downloadRawFile, downloadRawFolder, downloadConverted, downloadRepoZip, downloadRepoConverted, exportBookmarks, getTopLevelFolders } from '../services/downloadService'
import { getDb } from '../db'
import { getToken } from '../providers/tokenStore'
import { HOST_ID_GITHUB } from '../providers/types'

export function registerDownloadHandlers(): void {
  ipcMain.handle('download:rawFile', (_event, params) => {
    return downloadRawFile(params)
  })

  ipcMain.handle('download:rawFolder', (_event, params) => {
    return downloadRawFolder(params)
  })

  ipcMain.handle('download:convert', (_event, params) => {
    return downloadConverted(params)
  })

  ipcMain.handle('download:repoZip', async (_event, owner: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('downloadFolder') as
      | { value: string }
      | undefined
    const downloadFolder = row?.value ?? require('path').join(app.getPath('userData'), 'downloads')
    const token = getToken(HOST_ID_GITHUB)
    return downloadRepoZip(owner, name, downloadFolder, token)
  })

  ipcMain.handle('download:pickFolder', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('download:getDefaultFolder', async () => {
    const path = require('path')
    return path.join(app.getPath('userData'), 'downloads')
  })

  ipcMain.handle('download:repoConverted', (_event, owner: string, name: string, format: 'pdf' | 'docx' | 'epub') =>
    downloadRepoConverted(owner, name, format),
  )

  ipcMain.handle('download:bookmarks', (_event, owner: string, name: string) =>
    exportBookmarks(owner, name),
  )

  ipcMain.handle('download:topLevelFolders', (_event, owner: string, name: string) =>
    getTopLevelFolders(owner, name),
  )
}
