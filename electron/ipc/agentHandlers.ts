import { app, ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db'
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agents:changed')
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agents:getAll', async () => {
    const db = getDb(app.getPath('userData'))
    return getAllAgents(db)
  })

  ipcMain.handle('agents:create', async (_, input: CreateAgentInput) => {
    const db = getDb(app.getPath('userData'))
    const row = createAgent(db, input)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch) => {
    const db = getDb(app.getPath('userData'))
    const row = updateAgent(db, id, patch)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:delete', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    deleteAgent(db, id)
    broadcastChanged()
  })

  ipcMain.handle('agents:duplicate', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    const row = duplicateAgent(db, id)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:createFolder', async (_, name: string) => {
    const db = getDb(app.getPath('userData'))
    const row = createFolder(db, name)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:renameFolder', async (_, id: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    const row = renameFolder(db, id, name)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:deleteFolder', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    deleteFolder(db, id)
    broadcastChanged()
  })

  ipcMain.handle('agents:presets:create', async (
    _,
    agentId: string,
    name: string,
    values?: Record<string, string>,
  ) => {
    const db = getDb(app.getPath('userData'))
    const preset = createPreset(db, agentId, name, values)
    broadcastChanged()
    return preset
  })

  ipcMain.handle('agents:presets:update', async (
    _,
    agentId: string,
    presetId: string,
    patch: { name?: string; values?: Record<string, string> },
  ) => {
    const db = getDb(app.getPath('userData'))
    const preset = updatePreset(db, agentId, presetId, patch)
    broadcastChanged()
    return preset
  })

  ipcMain.handle('agents:presets:delete', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    deletePreset(db, agentId, presetId)
    broadcastChanged()
  })

  ipcMain.handle('agents:presets:duplicate', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    const preset = duplicatePreset(db, agentId, presetId)
    broadcastChanged()
    return preset
  })
}
