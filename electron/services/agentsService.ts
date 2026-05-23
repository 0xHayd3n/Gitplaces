import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentRow, AgentFolderRow } from '../../src/types/agent'

export const AGENT_NAME_MAX = 200
export const AGENT_BODY_MAX = 1_048_576 // 1 MiB

function nowIso(): string {
  return new Date().toISOString()
}

function normaliseName(input: string): string {
  const trimmed = input.trim()
  return trimmed.length === 0 ? 'Untitled agent' : trimmed
}

function assertNameLen(name: string): void {
  if (name.length > AGENT_NAME_MAX) {
    throw new Error(`Agent name length ${name.length} exceeds ${AGENT_NAME_MAX}`)
  }
}

function assertBodyLen(body: string): void {
  if (body.length > AGENT_BODY_MAX) {
    throw new Error(`Agent body length ${body.length} exceeds ${AGENT_BODY_MAX}`)
  }
}

function assertFolderExists(db: Database.Database, folderId: string): void {
  const row = db.prepare('SELECT id FROM agent_folders WHERE id = ?').get(folderId)
  if (!row) throw new Error(`Unknown folder id: ${folderId}`)
}

// ── Folders ─────────────────────────────────────────────────────────

export function createFolder(db: Database.Database, name: string): AgentFolderRow {
  const id = randomUUID()
  const created_at = nowIso()
  db.prepare(`
    INSERT INTO agent_folders (id, name, color_start, color_end, description, created_at)
    VALUES (?, ?, NULL, NULL, NULL, ?)
  `).run(id, name, created_at)
  return db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow
}

export function renameFolder(db: Database.Database, id: string, name: string): AgentFolderRow {
  db.prepare('UPDATE agent_folders SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow
}

export function deleteFolder(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_folders WHERE id = ?').run(id)
}

// ── Agents ──────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  body: string
  folderId: string | null
}

export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const name = normaliseName(input.name)
  assertNameLen(name)
  assertBodyLen(input.body)
  if (input.folderId !== null) assertFolderExists(db, input.folderId)

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(`
    INSERT INTO agents (id, name, body, folder_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, input.body, input.folderId, ts, ts)
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export interface UpdateAgentPatch {
  name?: string
  body?: string
  folderId?: string | null
}

export function updateAgent(
  db: Database.Database,
  id: string,
  patch: UpdateAgentPatch,
): AgentRow {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    const name = normaliseName(patch.name)
    assertNameLen(name)
    sets.push('name = ?')
    params.push(name)
  }
  if (patch.body !== undefined) {
    assertBodyLen(patch.body)
    sets.push('body = ?')
    params.push(patch.body)
  }
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) assertFolderExists(db, patch.folderId)
    sets.push('folder_id = ?')
    params.push(patch.folderId)
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?')
    params.push(nowIso())
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
}

export function duplicateAgent(db: Database.Database, id: string): AgentRow {
  const src = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!src) throw new Error(`Unknown agent id: ${id}`)
  return createAgent(db, {
    name: `${src.name} (copy)`,
    body: src.body,
    folderId: src.folder_id,
  })
}

// ── Aggregate read ──────────────────────────────────────────────────

export interface AgentsAllPayload {
  folders: AgentFolderRow[]
  agents:  AgentRow[]
}

export function getAllAgents(db: Database.Database): AgentsAllPayload {
  const folders = db.prepare('SELECT * FROM agent_folders ORDER BY name ASC').all() as AgentFolderRow[]
  const agents  = db.prepare('SELECT * FROM agents ORDER BY updated_at DESC').all() as AgentRow[]
  return { folders, agents }
}
