// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Database } from 'better-sqlite3'

vi.mock('../providers/github', () => ({
  putFileContents: vi.fn(),
}))

vi.mock('../store', () => ({
  getSyncEnabled: vi.fn(),
  getSyncRepoOwner: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('./skillSyncService', () => ({
  SKILLS_BACKUP_REPO: 'gitsuite-skills',
}))

vi.mock('./agentFileSyncService', () => ({
  previewSubagentFile: vi.fn((_agent, primary) => `--- FRONTMATTER ---\n${primary}`),
}))

import { putFileContents } from '../providers/github'
import { getSyncEnabled, getSyncRepoOwner, getToken } from '../store'
import {
  startAgentsBackupSyncService,
  pushAgent,
  pushAllPendingAgents,
  markAllAgentsPending,
} from './agentsBackupSyncService'

// Loose mock-statement shape: vi.fn() return types vary by stub, so we accept
// any callable here and let the production code do its own typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any
interface MockStmt {
  get: AnyFn
  run: AnyFn
  all: AnyFn
}

/**
 * Routes prepare(sql) to the right stub by matching substrings. Order matters:
 * earlier patterns win. Pass the SAME stub for queries that share a return
 * shape (e.g., two SELECT * FROM agents queries).
 */
function makeDb(routes: Array<{ match: string; stub: Partial<MockStmt> }>): Database {
  return {
    prepare: vi.fn((sql: string): MockStmt => {
      for (const r of routes) {
        if (sql.includes(r.match)) {
          return {
            get: r.stub.get ?? vi.fn(),
            run: r.stub.run ?? vi.fn(),
            all: r.stub.all ?? vi.fn(() => []),
          }
        }
      }
      // Unmatched query — return harmless empty stub. Tests that need to assert
      // on these should add an explicit route.
      return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) }
    }),
  } as unknown as Database
}

function makeWin(): BrowserWindow {
  return { webContents: { send: vi.fn() } } as unknown as BrowserWindow
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1', name: 'Agent 1', handle: 'agent-1', folder_id: null,
    color_start: '#000', color_end: null, emoji: null, pinned: 0, pinned_at: null,
    last_used_at: null, presets_json: '[]', created_at: 't', updated_at: 't',
    description: '', origin_plugin: null, origin_path: null, origin_version: null,
    origin_imported_at: null, tools: null, model: 'inherit',
    is_subagent: 0, is_slash_command: 0, argument_hint: null,
    synced_subagent_at: null, synced_slash_command_at: null,
    ...overrides,
  }
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1', agent_id: 'agent-1', filename: 'agent-1.md', content: 'BODY',
    sort_order: 0, created_at: 't', updated_at: 't',
    backup_github_sha: null, backup_synced_at: null, backup_sync_status: 'pending',
    ...overrides,
  }
}

describe('pushAgent', () => {
  beforeEach(() => {
    vi.mocked(getSyncEnabled).mockReturnValue(true)
    vi.mocked(getSyncRepoOwner).mockReturnValue('alice')
    vi.mocked(getToken).mockReturnValue('tok')
    vi.mocked(putFileContents).mockReset()
  })

  it('bails when sync disabled', async () => {
    vi.mocked(getSyncEnabled).mockReturnValue(false)
    startAgentsBackupSyncService(makeDb([]), makeWin())
    await pushAgent('agent-1')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('bails when no token', async () => {
    vi.mocked(getToken).mockReturnValue(undefined as unknown as string)
    startAgentsBackupSyncService(makeDb([]), makeWin())
    await pushAgent('agent-1')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('bails when no repo owner', async () => {
    vi.mocked(getSyncRepoOwner).mockReturnValue(undefined as unknown as string)
    startAgentsBackupSyncService(makeDb([]), makeWin())
    await pushAgent('agent-1')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('bails when agent not found', async () => {
    startAgentsBackupSyncService(makeDb([
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => undefined) } },
    ]), makeWin())
    await pushAgent('agent-1')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('pushes primary file with rendered frontmatter and no SHA on first push', async () => {
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha-1' } })
    const updateRun = vi.fn()
    startAgentsBackupSyncService(makeDb([
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'FROM agent_files WHERE agent_id', stub: { all: vi.fn(() => [fileRow()]) } },
      { match: 'UPDATE agent_files', stub: { run: updateRun } },
    ]), makeWin())

    await pushAgent('agent-1')

    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills',
      'agents/agent-1/agent-1.md',
      '--- FRONTMATTER ---\nBODY',
      expect.any(String),
      undefined,
    )
    // Records the returned SHA + 'synced'
    expect(updateRun).toHaveBeenCalledWith('sha-1', expect.any(Number), 'synced', 'file-1')
  })

  it('passes cached SHA on subsequent push', async () => {
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha-2' } })
    startAgentsBackupSyncService(makeDb([
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'FROM agent_files WHERE agent_id', stub: {
        all: vi.fn(() => [fileRow({ backup_github_sha: 'sha-1' })]),
      } },
    ]), makeWin())

    await pushAgent('agent-1')

    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills',
      'agents/agent-1/agent-1.md', expect.any(String), expect.any(String), 'sha-1',
    )
  })

  it('renders primary with frontmatter, secondaries raw', async () => {
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha-x' } })
    startAgentsBackupSyncService(makeDb([
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'FROM agent_files WHERE agent_id', stub: {
        all: vi.fn(() => [
          fileRow({ id: 'pf', filename: 'agent-1.md', content: 'PRIMARY', sort_order: 0 }),
          fileRow({ id: 'sf', filename: 'notes.md', content: 'RAW SECONDARY', sort_order: 1 }),
        ]),
      } },
    ]), makeWin())

    await pushAgent('agent-1')

    expect(putFileContents).toHaveBeenNthCalledWith(
      1, 'tok', 'alice', 'gitsuite-skills',
      'agents/agent-1/agent-1.md', '--- FRONTMATTER ---\nPRIMARY',
      expect.any(String), undefined,
    )
    expect(putFileContents).toHaveBeenNthCalledWith(
      2, 'tok', 'alice', 'gitsuite-skills',
      'agents/agent-1/notes.md', 'RAW SECONDARY',
      expect.any(String), undefined,
    )
  })

  it('marks file failed and emits IPC event on putFileContents error', async () => {
    vi.mocked(putFileContents).mockRejectedValue(new Error('nope'))
    const updateRun = vi.fn()
    const win = makeWin()
    startAgentsBackupSyncService(makeDb([
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'FROM agent_files WHERE agent_id', stub: { all: vi.fn(() => [fileRow()]) } },
      { match: 'UPDATE agent_files', stub: { run: updateRun } },
    ]), win)

    await pushAgent('agent-1')

    expect(updateRun).toHaveBeenCalledWith('failed', 'file-1')
    expect(win.webContents.send).toHaveBeenCalledWith(
      'agentsBackupSync:syncFailed',
      { handle: 'agent-1', filename: 'agent-1.md' },
    )
  })
})

describe('pushAllPendingAgents', () => {
  beforeEach(() => {
    vi.mocked(getSyncEnabled).mockReturnValue(true)
    vi.mocked(getSyncRepoOwner).mockReturnValue('alice')
    vi.mocked(getToken).mockReturnValue('tok')
    vi.mocked(putFileContents).mockReset()
  })

  it('bails when no pending rows', async () => {
    startAgentsBackupSyncService(makeDb([
      { match: 'JOIN agents', stub: { all: vi.fn(() => []) } },
    ]), makeWin())
    await pushAllPendingAgents()
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('pushes pending rows grouped by agent', async () => {
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha-z' } })
    const pendingFile = {
      ...fileRow({ id: 'f1', filename: 'agent-1.md', content: 'BODY' }),
      handle: 'agent-1',
      agent_name: 'Agent 1',
      agent_id_alias: 'agent-1',
    }
    startAgentsBackupSyncService(makeDb([
      { match: 'JOIN agents', stub: { all: vi.fn(() => [pendingFile]) } },
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'sort_order = 0', stub: { get: vi.fn(() => ({ content: 'BODY' })) } },
      { match: 'backup_sync_status FROM agent_files WHERE id', stub: { get: vi.fn(() => ({ backup_sync_status: 'synced' })) } },
    ]), makeWin())

    await pushAllPendingAgents()
    expect(putFileContents).toHaveBeenCalledTimes(1)
  })

  it('emits summary event when any push failed', async () => {
    vi.mocked(putFileContents).mockRejectedValue(new Error('boom'))
    const pendingFile = {
      ...fileRow({ id: 'f1', filename: 'agent-1.md', content: 'BODY' }),
      handle: 'agent-1',
      agent_name: 'Agent 1',
      agent_id_alias: 'agent-1',
    }
    const win = makeWin()
    startAgentsBackupSyncService(makeDb([
      { match: 'JOIN agents', stub: { all: vi.fn(() => [pendingFile]) } },
      { match: 'FROM agents WHERE id', stub: { get: vi.fn(() => agentRow()) } },
      { match: 'sort_order = 0', stub: { get: vi.fn(() => ({ content: 'BODY' })) } },
      { match: 'backup_sync_status FROM agent_files WHERE id', stub: { get: vi.fn(() => ({ backup_sync_status: 'failed' })) } },
    ]), win)

    await pushAllPendingAgents()
    expect(win.webContents.send).toHaveBeenCalledWith(
      'agentsBackupSync:syncFailed',
      { summary: true, failCount: 1 },
    )
  })
})

describe('markAllAgentsPending', () => {
  it('updates only NULL rows to pending', () => {
    const run = vi.fn()
    const db = makeDb([{ match: 'UPDATE agent_files', stub: { run } }])
    markAllAgentsPending(db)
    expect(run).toHaveBeenCalled()
    // Verify the SQL targets NULL status only.
    const prepared = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(prepared).toContain("backup_sync_status = 'pending'")
    expect(prepared).toContain('IS NULL')
  })
})
