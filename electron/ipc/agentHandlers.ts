import { app, ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { getDb } from '../db'
import { discoverPlugins, parseSkill, importSkill, type ParsedSkill, type ImportOptions } from '../services/skillImportService'
import { discoverSkillsInRepo, readSkillFromRepo } from '../services/skillImportFromGithubService'
import { parseGithubRepoUrl } from '../../src/utils/parseGithubRepoUrl'
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder, updateFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  recordUse,
  listFiles, createFile, updateFile, deleteFile,
  setSyncedAt,
  type CreateAgentInput, type UpdateAgentPatch, type UpdateFolderPatch,
  type CreateFileInput, type UpdateFilePatch,
} from '../services/agentsService'
import {
  syncAgentToDisk, checkConflict, cleanupAgentFiles,
  previewSubagentFile, previewSlashCommandFile,
  type SyncResult,
} from '../services/agentFileSyncService'
import type { AgentRow } from '../../src/types/agent'

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

async function pluginDiscoveryRoots(): Promise<string[]> {
  const home = os.homedir()
  const cwd = process.cwd()
  const roots = [
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]
  // Cache layout: ~/.claude/plugins/cache/<source>/<plugin>/<version>/<files>.
  // We add each <source>/<plugin>/ as a root so discoverPlugins sees the
  // <version> directories as plugin dirs.
  const cacheDir = path.join(home, '.claude', 'plugins', 'cache')
  try {
    const sources = await fs.readdir(cacheDir, { withFileTypes: true })
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourceDir = path.join(cacheDir, source.name)
      const plugins = await fs.readdir(sourceDir, { withFileTypes: true })
      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue
        roots.push(path.join(sourceDir, plugin.name))
      }
    }
  } catch {
    // cache dir missing — ignore
  }
  return roots
}

/**
 * Sync the agent's body+frontmatter to ~/.claude/agents/ and/or
 * ~/.claude/commands/ as governed by is_subagent / is_slash_command.
 * Persists synced_*_at timestamps based on the SyncResult and returns the
 * refreshed row (plus a non-fatal syncWarning when any surface errored or
 * was blocked by a conflict).
 */
async function runSyncAndPersist(
  agentId: string,
  oldHandle: string | undefined,
  forceOverwrite: boolean | undefined,
): Promise<{ row: AgentRow; syncWarning?: string }> {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  const result = await syncAgentToDisk(row, { oldHandle, forceOverwrite })
  const ts = new Date().toISOString()
  if (result.subagent.status === 'written') setSyncedAt(db, agentId, 'subagent', ts)
  if (result.subagent.status === 'deleted') setSyncedAt(db, agentId, 'subagent', null)
  if (result.slashCommand.status === 'written') setSyncedAt(db, agentId, 'slashCommand', ts)
  if (result.slashCommand.status === 'deleted') setSyncedAt(db, agentId, 'slashCommand', null)
  const warnings: string[] = []
  if (result.subagent.status === 'error') warnings.push(`Subagent sync failed: ${result.subagent.message}`)
  if (result.slashCommand.status === 'error') warnings.push(`Slash-command sync failed: ${result.slashCommand.message}`)
  if (result.subagent.status === 'conflict') warnings.push(`Subagent file exists at ${result.subagent.path}; toggle was applied but file not written.`)
  if (result.slashCommand.status === 'conflict') warnings.push(`Slash-command file exists at ${result.slashCommand.path}; toggle was applied but file not written.`)
  const refreshed = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  return warnings.length > 0
    ? { row: refreshed, syncWarning: warnings.join(' ') }
    : { row: refreshed }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agents:getAll', async () => {
    const db = getDb(app.getPath('userData'))
    return getAllAgents(db)
  })

  ipcMain.handle('agents:create', async (_, input: CreateAgentInput & { forceOverwrite?: boolean }) => {
    const db = getDb(app.getPath('userData'))
    const { forceOverwrite, ...createInput } = input
    const agent = createAgent(db, createInput)
    const { row, syncWarning } = await runSyncAndPersist(agent.id, undefined, forceOverwrite)
    broadcastChanged()
    // New agent has no prior revision; createAgent always inserts a `create` snapshot.
    broadcastRevisionAddedIfNew(row.id, null)
    return syncWarning ? { ...row, syncWarning } : row
  })

  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch & { forceOverwrite?: boolean }) => {
    const db = getDb(app.getPath('userData'))
    const priorRevId = latestRevisionId(id)
    const oldRow = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(id) as { handle: string } | undefined
    const oldHandle = oldRow?.handle
    const { forceOverwrite, ...updatePatch } = patch
    updateAgent(db, id, updatePatch)
    const newRow = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(id) as { handle: string }
    const handleChanged = oldHandle !== undefined && oldHandle !== newRow.handle
    const { row, syncWarning } = await runSyncAndPersist(
      id,
      handleChanged ? oldHandle : undefined,
      forceOverwrite,
    )
    broadcastChanged()
    broadcastRevisionAddedIfNew(id, priorRevId)
    return syncWarning ? { ...row, syncWarning } : row
  })

  ipcMain.handle('agents:delete', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(
      `SELECT handle, is_subagent, is_slash_command FROM agents WHERE id = ?`,
    ).get(id) as { handle: string; is_subagent: 0 | 1; is_slash_command: 0 | 1 } | undefined
    deleteAgent(db, id)
    if (row) {
      await cleanupAgentFiles(row.handle, {
        cleanSubagent: row.is_subagent === 1,
        cleanSlashCommand: row.is_slash_command === 1,
      })
    }
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

  ipcMain.handle('agents:updateFolder', async (_, id: string, patch: UpdateFolderPatch) => {
    const db = getDb(app.getPath('userData'))
    const row = updateFolder(db, id, patch)
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

  ipcMain.handle('agents:files:list', async (_, agentId: string) => {
    return listFiles(getDb(app.getPath('userData')), agentId)
  })

  ipcMain.handle('agents:files:create', async (_, agentId: string, input: CreateFileInput) => {
    const file = createFile(getDb(app.getPath('userData')), agentId, input)
    broadcastChanged()
    return file
  })

  ipcMain.handle('agents:files:update', async (_, agentId: string, fileId: string, patch: UpdateFilePatch) => {
    const file = updateFile(getDb(app.getPath('userData')), agentId, fileId, patch)
    broadcastChanged()
    return file
  })

  ipcMain.handle('agents:files:delete', async (_, agentId: string, fileId: string) => {
    deleteFile(getDb(app.getPath('userData')), agentId, fileId)
    broadcastChanged()
  })

  ipcMain.handle('agents:import:discoverPlugins', async () => {
    const roots = await pluginDiscoveryRoots()
    return discoverPlugins(roots)
  })

  ipcMain.handle('agents:import:readSkillFromDisk', async (_, skillPath: string) => {
    return parseSkill(skillPath)
  })

  ipcMain.handle('agents:import:importSkill', async (_, skill: ParsedSkill, opts: ImportOptions) => {
    const result = importSkill(getDb(app.getPath('userData')), skill, opts)
    broadcastChanged()
    return result
  })

  ipcMain.handle('agents:import:discoverInRepo', async (_, url: string) => {
    const parsed = parseGithubRepoUrl(url)
    if (!parsed) throw new Error('Not a valid GitHub URL')
    return discoverSkillsInRepo(parsed.owner, parsed.name)
  })

  ipcMain.handle('agents:import:readSkillFromRepo', async (
    _, owner: string, name: string, branch: string, commitSha: string, repoPath: string,
  ) => {
    return readSkillFromRepo(owner, name, branch, commitSha, repoPath)
  })

  ipcMain.handle('agents:mcp:getConfigSnippet', async () => {
    // In packaged builds the launcher lives inside asar by default, which
    // Node can't execute. We emit the path it *would* have if the build is
    // configured to unpack `electron/` via electron-builder's `asarUnpack`.
    // Until that build config lands, packaged users will need to point at
    // the unpacked location themselves.
    const launcherPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'mcp-launcher.cjs')
      : path.join(app.getAppPath(), 'electron', 'mcp-launcher.cjs')
    const dbPath = path.join(app.getPath('userData'), 'gitsuite.db')
    const snippet = {
      mcpServers: {
        'git-suite-agents': {
          command: 'node',
          args: [launcherPath, dbPath],
        },
      },
    }
    return JSON.stringify(snippet, null, 2)
  })

  ipcMain.handle('agents:sync:checkConflict', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(agentId) as { handle: string } | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    return checkConflict(row.handle)
  })

  ipcMain.handle('agents:sync:retry', async (_, agentId: string): Promise<SyncResult> => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    const result = await syncAgentToDisk(row)
    const ts = new Date().toISOString()
    if (result.subagent.status === 'written') setSyncedAt(db, agentId, 'subagent', ts)
    if (result.subagent.status === 'deleted') setSyncedAt(db, agentId, 'subagent', null)
    if (result.slashCommand.status === 'written') setSyncedAt(db, agentId, 'slashCommand', ts)
    if (result.slashCommand.status === 'deleted') setSyncedAt(db, agentId, 'slashCommand', null)
    broadcastChanged()
    return result
  })

  ipcMain.handle('agents:sync:preview', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    return {
      subagent: row.is_subagent === 1 ? previewSubagentFile(row) : null,
      slashCommand: row.is_slash_command === 1 ? previewSlashCommandFile(row) : null,
    }
  })
}
