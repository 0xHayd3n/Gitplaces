import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentRow, AgentFolderRow } from '../../src/types/agent'
import { isValidHandle, dedupeHandle } from '../../src/utils/agentSlug'

export const AGENT_NAME_MAX = 200
export const AGENT_BODY_MAX = 1_048_576 // 1 MiB

const HEX_RE = /^#[0-9a-f]{6}$/i

function assertValidHandle(handle: string): void {
  if (!isValidHandle(handle)) throw new Error(`Invalid handle: ${JSON.stringify(handle)}`)
}

function assertValidHex(label: string, hex: string): void {
  if (!HEX_RE.test(hex)) throw new Error(`${label} must be a hex color, got ${JSON.stringify(hex)}`)
}

function assertHandleUnique(db: Database.Database, handle: string, exceptId?: string): void {
  const row = exceptId
    ? db.prepare(`SELECT id FROM agents WHERE handle = ? AND id <> ?`).get(handle, exceptId)
    : db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(handle)
  if (row) throw new Error(`Handle already in use: ${handle}`)
}

function nowIso(): string {
  return new Date().toISOString()
}

function normaliseName(input: string): string {
  const trimmed = input.trim()
  return trimmed.length === 0 ? 'Untitled agent' : trimmed
}

function normaliseFolderName(input: string): string {
  const trimmed = input.trim()
  return trimmed.length === 0 ? 'Untitled folder' : trimmed
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
  const normalised = normaliseFolderName(name)
  assertNameLen(normalised)
  const id = randomUUID()
  const created_at = nowIso()
  db.prepare(`
    INSERT INTO agent_folders (id, name, color_start, color_end, description, created_at)
    VALUES (?, ?, NULL, NULL, NULL, ?)
  `).run(id, normalised, created_at)
  return db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow
}

export function renameFolder(db: Database.Database, id: string, name: string): AgentFolderRow {
  const normalised = normaliseFolderName(name)
  assertNameLen(normalised)
  db.prepare('UPDATE agent_folders SET name = ? WHERE id = ?').run(normalised, id)
  const row = db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow | undefined
  if (!row) throw new Error(`Unknown folder id: ${id}`)
  return row
}

export function deleteFolder(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_folders WHERE id = ?').run(id)
}

// ── Agents ──────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  body: string
  folderId: string | null
  handle: string
  colorStart: string
  colorEnd: string | null
  emoji: string | null
}

export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const name = normaliseName(input.name)
  assertNameLen(name)
  assertBodyLen(input.body)
  if (input.folderId !== null) assertFolderExists(db, input.folderId)

  assertValidHandle(input.handle)
  assertHandleUnique(db, input.handle)
  assertValidHex('colorStart', input.colorStart)
  if (input.colorEnd !== null) assertValidHex('colorEnd', input.colorEnd)

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, ts, ts)
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export interface UpdateAgentPatch {
  name?: string
  body?: string
  folderId?: string | null
  handle?: string
  colorStart?: string
  colorEnd?: string | null
  emoji?: string | null
  pinned?: boolean
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
    sets.push('name = ?'); params.push(name)
  }
  if (patch.body !== undefined) {
    assertBodyLen(patch.body)
    sets.push('body = ?'); params.push(patch.body)
  }
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) assertFolderExists(db, patch.folderId)
    sets.push('folder_id = ?'); params.push(patch.folderId)
  }
  if (patch.handle !== undefined) {
    assertValidHandle(patch.handle)
    assertHandleUnique(db, patch.handle, id)
    sets.push('handle = ?'); params.push(patch.handle)
  }
  if (patch.colorStart !== undefined) {
    assertValidHex('colorStart', patch.colorStart)
    sets.push('color_start = ?'); params.push(patch.colorStart)
  }
  if (patch.colorEnd !== undefined) {
    if (patch.colorEnd !== null) assertValidHex('colorEnd', patch.colorEnd)
    sets.push('color_end = ?'); params.push(patch.colorEnd)
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?'); params.push(patch.emoji)
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?'); params.push(patch.pinned ? 1 : 0)
    if (patch.pinned) {
      sets.push('pinned_at = ?'); params.push(nowIso())
    }
    // when unpinning, leave pinned_at alone (preserved for re-pin UX)
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?'); params.push(nowIso())
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${id}`)
  return row
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
}

export function duplicateAgent(db: Database.Database, id: string): AgentRow {
  const src = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!src) throw new Error(`Unknown agent id: ${id}`)
  const suffix = ' (copy)'
  const baseName = src.name.length + suffix.length > AGENT_NAME_MAX
    ? src.name.slice(0, AGENT_NAME_MAX - suffix.length)
    : src.name

  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const dupHandle = dedupeHandle(src.handle, taken)

  return createAgent(db, {
    name: `${baseName}${suffix}`,
    body: src.body,
    folderId: src.folder_id,
    handle: dupHandle,
    colorStart: src.color_start ?? '#888888',
    colorEnd: src.color_end,
    emoji: src.emoji,
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
