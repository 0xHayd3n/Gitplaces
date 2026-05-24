import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentRow, AgentFolderRow, AgentPreset, AgentRevision } from '../../src/types/agent'
import { parseAgentPresets } from '../../src/types/agent'
import { isValidHandle, dedupeHandle, slugifyName } from '../../src/utils/agentSlug'

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
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
  recordRevision(db, id, row.body, '[]', 'create', 'Created agent')
  return row
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
  // Read prior body if we'll need to detect a real change to snapshot. Only
  // care when patch.body is present.
  let priorBody: string | null = null
  if (patch.body !== undefined) {
    const prior = db.prepare('SELECT body FROM agents WHERE id = ?').get(id) as { body: string } | undefined
    priorBody = prior?.body ?? null
  }
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
  if (patch.body !== undefined && priorBody !== null && priorBody !== patch.body) {
    recordRevision(db, id, row.body, row.presets_json, 'body_edit', 'Edited body')
  }
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

// ── Presets ─────────────────────────────────────────────────────────

export const PRESET_NAME_MAX = 80
export const PRESETS_JSON_MAX = 64 * 1024

function assertAgentExists(db: Database.Database, agentId: string): void {
  const row = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
}

function readPresets(db: Database.Database, agentId: string): AgentPreset[] {
  const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string } | undefined
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
  return parseAgentPresets(row.presets_json)
}

function writePresets(db: Database.Database, agentId: string, presets: AgentPreset[]): void {
  const json = JSON.stringify(presets)
  if (json.length > PRESETS_JSON_MAX) {
    throw new Error(`Presets size ${json.length} exceeds ${PRESETS_JSON_MAX}`)
  }
  db.prepare(`UPDATE agents SET presets_json = ?, updated_at = ? WHERE id = ?`)
    .run(json, nowIso(), agentId)
}

// Slug length is bounded transitively by `slugifyName` (HANDLE_MAX = 64 chars).
// A numeric dedupe suffix (e.g. `-12`) can push past that, which is fine —
// preset slugs aren't constrained to the handle regex.
function derivePresetSlug(name: string, existing: AgentPreset[], exceptId?: string): string {
  const base = slugifyName(name)
  const taken = existing
    .filter(p => p.id !== exceptId)
    .map(p => p.slug)
  const lowerTaken = new Set(taken.map(s => s.toLowerCase()))
  if (!lowerTaken.has(base)) return base
  let i = 2
  while (lowerTaken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function assertPresetName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('Preset name must not be empty')
  if (trimmed.length > PRESET_NAME_MAX) {
    throw new Error(`Preset name length ${trimmed.length} exceeds ${PRESET_NAME_MAX}`)
  }
  return trimmed
}

export function createPreset(
  db: Database.Database,
  agentId: string,
  name: string,
  values: Record<string, string> = {},
): AgentPreset {
  assertAgentExists(db, agentId)
  const normalisedName = assertPresetName(name)
  const presets = readPresets(db, agentId)
  const preset: AgentPreset = {
    id: randomUUID(),
    name: normalisedName,
    slug: derivePresetSlug(normalisedName, presets),
    values: { ...values },
  }
  writePresets(db, agentId, [...presets, preset])
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Added preset "${preset.name}"`)
  return preset
}

export function updatePreset(
  db: Database.Database,
  agentId: string,
  presetId: string,
  patch: { name?: string; values?: Record<string, string> },
): AgentPreset {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const idx = presets.findIndex(p => p.id === presetId)
  if (idx < 0) throw new Error(`Unknown preset id: ${presetId}`)
  const current = presets[idx]

  let nextName = current.name
  let nextSlug = current.slug
  if (patch.name !== undefined) {
    nextName = assertPresetName(patch.name)
    nextSlug = derivePresetSlug(nextName, presets, presetId)
  }
  const nextValues = patch.values !== undefined ? { ...patch.values } : current.values

  const updated: AgentPreset = { id: current.id, name: nextName, slug: nextSlug, values: nextValues }
  const nextPresets = [...presets]
  nextPresets[idx] = updated
  writePresets(db, agentId, nextPresets)
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  const summary = patch.name !== undefined && patch.name.trim() !== current.name
    ? `Renamed preset "${current.name}" to "${nextName}"`
    : `Updated preset "${nextName}"`
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', summary)
  return updated
}

export function deletePreset(db: Database.Database, agentId: string, presetId: string): void {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const target = presets.find(p => p.id === presetId)
  if (!target) return  // no-op on unknown id, no snapshot
  const next = presets.filter(p => p.id !== presetId)
  writePresets(db, agentId, next)
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Deleted preset "${target.name}"`)
}

export function duplicatePreset(
  db: Database.Database,
  agentId: string,
  presetId: string,
): AgentPreset {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const src = presets.find(p => p.id === presetId)
  if (!src) throw new Error(`Unknown preset id: ${presetId}`)
  const suffix = ' (copy)'
  const baseName = src.name.length + suffix.length > PRESET_NAME_MAX
    ? src.name.slice(0, PRESET_NAME_MAX - suffix.length)
    : src.name
  const dupName = `${baseName}${suffix}`
  const dup: AgentPreset = {
    id: randomUUID(),
    name: dupName,
    slug: derivePresetSlug(dupName, presets),
    values: { ...src.values },
  }
  writePresets(db, agentId, [...presets, dup])
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Duplicated preset "${src.name}"`)
  return dup
}

// ── Revisions ───────────────────────────────────────────────────────

export const REVISION_RETENTION = 20

type RevisionKind = 'create' | 'body_edit' | 'preset_change' | 'revert'

function pruneRevisions(db: Database.Database, agentId: string): void {
  db.prepare(`
    DELETE FROM agent_revisions
    WHERE agent_id = ?
      AND id NOT IN (
        SELECT id FROM agent_revisions
        WHERE agent_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      )
  `).run(agentId, agentId, REVISION_RETENTION)
}

function rowToRevision(row: {
  id: string; agent_id: string; body: string; presets_json: string;
  summary: string; kind: string; created_at: string;
}): AgentRevision {
  return {
    id: row.id,
    agent_id: row.agent_id,
    body: row.body,
    presets: parseAgentPresets(row.presets_json),
    summary: row.summary,
    kind: row.kind as RevisionKind,
    created_at: row.created_at,
  }
}

export function recordRevision(
  db: Database.Database,
  agentId: string,
  body: string,
  presetsJson: string,
  kind: RevisionKind,
  summary: string,
): AgentRevision {
  assertAgentExists(db, agentId)
  const id = randomUUID()
  // Ensure strictly-monotonic created_at per agent so ORDER BY created_at is
  // a total ordering — Date.now() is ms-precision and a tight insert loop
  // routinely produces ties otherwise.
  const last = db.prepare(
    `SELECT created_at FROM agent_revisions WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(agentId) as { created_at: string } | undefined
  let created_at = nowIso()
  if (last && created_at <= last.created_at) {
    const bumped = new Date(new Date(last.created_at).getTime() + 1).toISOString()
    created_at = bumped
  }
  db.prepare(`
    INSERT INTO agent_revisions (id, agent_id, body, presets_json, summary, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, body, presetsJson, summary, kind, created_at)
  pruneRevisions(db, agentId)
  const row = db.prepare(`SELECT * FROM agent_revisions WHERE id = ?`).get(id) as
    | { id: string; agent_id: string; body: string; presets_json: string; summary: string; kind: string; created_at: string }
    | undefined
  if (!row) throw new Error('Revision was pruned immediately on insert (REVISION_RETENTION misconfigured)')
  return rowToRevision(row)
}

export function listRevisions(db: Database.Database, agentId: string): AgentRevision[] {
  assertAgentExists(db, agentId)
  const rows = db.prepare(`
    SELECT * FROM agent_revisions
    WHERE agent_id = ?
    ORDER BY created_at DESC, rowid DESC
  `).all(agentId) as {
    id: string; agent_id: string; body: string; presets_json: string;
    summary: string; kind: string; created_at: string;
  }[]
  return rows.map(rowToRevision)
}

export function revertToRevision(
  db: Database.Database,
  agentId: string,
  revisionId: string,
): AgentRow {
  assertAgentExists(db, agentId)
  const rev = db.prepare(`SELECT * FROM agent_revisions WHERE id = ?`).get(revisionId) as
    | { id: string; agent_id: string; body: string; presets_json: string; summary: string; kind: string; created_at: string }
    | undefined
  if (!rev) throw new Error(`Unknown revision id: ${revisionId}`)
  if (rev.agent_id !== agentId) throw new Error(`Revision ${revisionId} does not belong to agent ${agentId}`)

  db.prepare(`UPDATE agents SET body = ?, presets_json = ?, updated_at = ? WHERE id = ?`)
    .run(rev.body, rev.presets_json, nowIso(), agentId)

  recordRevision(db, agentId, rev.body, rev.presets_json, 'revert', `Reverted to "${rev.summary}"`)

  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  return row
}
