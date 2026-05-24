import { app, ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db'
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  recordUse,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agents:changed')
  }
}

function latestRevisionId(agentId: string): string | null {
  const db = getDb(app.getPath('userData'))
  return listRevisions(db, agentId)[0]?.id ?? null
}

function broadcastRevisionAddedIfNew(agentId: string, priorRevId: string | null): void {
  const db = getDb(app.getPath('userData'))
  const revs = listRevisions(db, agentId)
  if (revs.length === 0) return
  const rev = revs[0]
  if (rev.id === priorRevId) return  // no new revision was actually inserted
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agents:revision-added', rev)
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
    // New agent has no prior revision; createAgent always inserts a `create` snapshot.
    broadcastRevisionAddedIfNew(row.id, null)
    return row
  })

  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(id)
    const row = updateAgent(db, id, patch)
    broadcastChanged()
    broadcastRevisionAddedIfNew(id, priorRevId)
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
    const priorRevId = latestRevisionId(agentId)
    const preset = createPreset(db, agentId, name, values)
    broadcastChanged()
    broadcastRevisionAddedIfNew(agentId, priorRevId)
    return preset
  })

  ipcMain.handle('agents:presets:update', async (
    _,
    agentId: string,
    presetId: string,
    patch: { name?: string; values?: Record<string, string> },
  ) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(agentId)
    const preset = updatePreset(db, agentId, presetId, patch)
    broadcastChanged()
    broadcastRevisionAddedIfNew(agentId, priorRevId)
    return preset
  })

  ipcMain.handle('agents:presets:delete', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(agentId)
    deletePreset(db, agentId, presetId)
    broadcastChanged()
    broadcastRevisionAddedIfNew(agentId, priorRevId)
  })

  ipcMain.handle('agents:presets:duplicate', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(agentId)
    const preset = duplicatePreset(db, agentId, presetId)
    broadcastChanged()
    broadcastRevisionAddedIfNew(agentId, priorRevId)
    return preset
  })

  ipcMain.handle('agents:revisions:list', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    return listRevisions(db, agentId)
  })

  ipcMain.handle('agents:revisions:revert', async (_, agentId: string, revisionId: string) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(agentId)
    const row = revertToRevision(db, agentId, revisionId)
    broadcastChanged()
    broadcastRevisionAddedIfNew(agentId, priorRevId)
    return row
  })

  ipcMain.handle('agents:recordUse', async (_, agentId: string, presetId: string | null) => {
    const db = getDb(app.getPath('userData'))
    recordUse(db, agentId, presetId)
    broadcastChanged()
  })
}
