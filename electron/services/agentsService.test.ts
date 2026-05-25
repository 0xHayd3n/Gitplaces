// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import {
  createAgent, updateAgent, deleteAgent, duplicateAgent, getAllAgents,
  createFolder, renameFolder, deleteFolder, updateFolder,
  listFiles, createFile, updateFile, deleteFile,
  assertValidModel, assertValidTools, setSyncedAt,
  getPrimaryFile, listRevisions,
  AGENT_NAME_MAX, AGENT_BODY_MAX,
} from './agentsService'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('agentsService — folders', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createFolder inserts a row and returns it', () => {
    const f = createFolder(db, 'Writing')
    expect(f.name).toBe('Writing')
    expect(f.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(f.created_at).toMatch(/T/)
    expect(f.color_start).toBeNull()
  })

  it('renameFolder updates the name', () => {
    const f = createFolder(db, 'Writing')
    const updated = renameFolder(db, f.id, 'Research')
    expect(updated.name).toBe('Research')
  })

  it('renameFolder throws when folder does not exist', () => {
    expect(() => renameFolder(db, 'nope', 'X')).toThrow(/folder/i)
  })

  it('createFolder falls back to "Untitled folder" when name is empty after trim', () => {
    const f = createFolder(db, '   ')
    expect(f.name).toBe('Untitled folder')
  })

  it('createFolder rejects when name exceeds AGENT_NAME_MAX', () => {
    const name = 'x'.repeat(AGENT_NAME_MAX + 1)
    expect(() => createFolder(db, name)).toThrow(/name.*length/i)
  })

  it('deleteFolder on unknown id is a no-op', () => {
    expect(() => deleteFolder(db, 'does-not-exist')).not.toThrow()
  })

  it('deleteFolder removes the row and nulls agents.folder_id', () => {
    const f = createFolder(db, 'Writing')
    const a = createAgent(db, { name: 'A', body: '# A', folderId: f.id, handle: 'a-1', colorStart: '#888888', colorEnd: null, emoji: null })
    deleteFolder(db, f.id)
    const all = getAllAgents(db)
    expect(all.folders.find(x => x.id === f.id)).toBeUndefined()
    expect(all.agents.find(x => x.id === a.id)?.folder_id).toBeNull()
  })
})

describe('agentsService — updateFolder', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('updates the folder name and returns the row', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { name: 'Research' })
    expect(updated.name).toBe('Research')
    expect(updated.id).toBe(f.id)
  })

  it('normalises a whitespace name to "Untitled folder"', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { name: '   ' })
    expect(updated.name).toBe('Untitled folder')
  })

  it('rejects names exceeding AGENT_NAME_MAX', () => {
    const f = createFolder(db, 'Writing')
    expect(() => updateFolder(db, f.id, { name: 'x'.repeat(AGENT_NAME_MAX + 1) }))
      .toThrow(/name.*length/i)
  })

  it('sets colorStart to a hex value', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { colorStart: '#22c55e' })
    expect(updated.color_start).toBe('#22c55e')
  })

  it('clears colorStart when null is passed', () => {
    const f = createFolder(db, 'Writing')
    updateFolder(db, f.id, { colorStart: '#22c55e' })
    const cleared = updateFolder(db, f.id, { colorStart: null })
    expect(cleared.color_start).toBeNull()
  })

  it('rejects invalid hex for colorStart', () => {
    const f = createFolder(db, 'Writing')
    expect(() => updateFolder(db, f.id, { colorStart: 'red' }))
      .toThrow(/hex/i)
  })

  it('sets and clears emoji', () => {
    const f = createFolder(db, 'Writing')
    const set = updateFolder(db, f.id, { emoji: '📝' })
    expect(set.emoji).toBe('📝')
    const cleared = updateFolder(db, f.id, { emoji: null })
    expect(cleared.emoji).toBeNull()
  })

  it('an empty patch is a no-op that still returns the row', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, {})
    expect(updated.name).toBe('Writing')
  })

  it('throws on unknown id', () => {
    expect(() => updateFolder(db, 'nope', { name: 'X' })).toThrow(/folder/i)
  })

  it('renameFolder still works after refactor (back-compat)', () => {
    const f = createFolder(db, 'Writing')
    const updated = renameFolder(db, f.id, 'Research')
    expect(updated.name).toBe('Research')
  })
})

describe('agentsService — agents', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent inserts and returns the row', () => {
    const a = createAgent(db, { name: 'Editor', body: '# Editor\nbody', folderId: null, handle: 'editor', colorStart: '#888888', colorEnd: null, emoji: null })
    expect(a.name).toBe('Editor')
    expect(getPrimaryFile(db, a.id).content).toBe('# Editor\nbody')
    expect(a.folder_id).toBeNull()
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.created_at).toBe(a.updated_at)
  })

  it('createAgent rejects when name exceeds AGENT_NAME_MAX', () => {
    const name = 'x'.repeat(AGENT_NAME_MAX + 1)
    expect(() => createAgent(db, { name, body: 'body', folderId: null, handle: 'too-long-name', colorStart: '#888888', colorEnd: null, emoji: null }))
      .toThrow(/name.*length/i)
  })

  it('createAgent rejects when body exceeds AGENT_BODY_MAX', () => {
    const body = 'x'.repeat(AGENT_BODY_MAX + 1)
    expect(() => createAgent(db, { name: 'X', body, folderId: null, handle: 'too-long-body', colorStart: '#888888', colorEnd: null, emoji: null }))
      .toThrow(/body.*length/i)
  })

  it('createAgent rejects unknown folderId', () => {
    expect(() => createAgent(db, { name: 'X', body: 'b', folderId: 'nope', handle: 'unknown-folder', colorStart: '#888888', colorEnd: null, emoji: null }))
      .toThrow(/folder/i)
  })

  it('createAgent falls back to "Untitled agent" when name is empty after trim', () => {
    const a = createAgent(db, { name: '   ', body: 'b', folderId: null, handle: 'untitled', colorStart: '#888888', colorEnd: null, emoji: null })
    expect(a.name).toBe('Untitled agent')
  })

  it('updateAgent applies a partial patch and bumps updated_at', async () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'patch-bumps', colorStart: '#888888', colorEnd: null, emoji: null })
    await new Promise(r => setTimeout(r, 5))
    const u = updateAgent(db, a.id, { body: 'b2' })
    expect(getPrimaryFile(db, u.id).content).toBe('b2')
    expect(u.name).toBe('A')
    expect(u.updated_at > a.updated_at).toBe(true)
  })

  it('updateAgent can set folder_id back to null', () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'A', body: 'b', folderId: f.id, handle: 'folder-null', colorStart: '#888888', colorEnd: null, emoji: null })
    const u = updateAgent(db, a.id, { folderId: null })
    expect(u.folder_id).toBeNull()
  })

  it('updateAgent rejects unknown folderId', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'reject-folder', colorStart: '#888888', colorEnd: null, emoji: null })
    expect(() => updateAgent(db, a.id, { folderId: 'nope' })).toThrow(/folder/i)
  })

  it('deleteAgent removes the row', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'delete-me', colorStart: '#888888', colorEnd: null, emoji: null })
    deleteAgent(db, a.id)
    const all = getAllAgents(db)
    expect(all.agents.find(x => x.id === a.id)).toBeUndefined()
  })

  it('updateAgent with empty patch returns unchanged row', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'empty-patch', colorStart: '#888888', colorEnd: null, emoji: null })
    const u = updateAgent(db, a.id, {})
    expect(u.name).toBe('A')
    expect(getPrimaryFile(db, u.id).content).toBe('b')
    expect(u.updated_at).toBe(a.updated_at)
  })

  it('updateAgent throws when agent does not exist', () => {
    expect(() => updateAgent(db, 'nope', { body: 'x' })).toThrow(/agent/i)
  })

  it('deleteAgent on unknown id is a no-op', () => {
    expect(() => deleteAgent(db, 'does-not-exist')).not.toThrow()
  })

  it('duplicateAgent truncates name when src.name is at AGENT_NAME_MAX', () => {
    const longName = 'x'.repeat(AGENT_NAME_MAX)
    const a = createAgent(db, { name: longName, body: 'b', folderId: null, handle: 'dup-truncate', colorStart: '#888888', colorEnd: null, emoji: null })
    const d = duplicateAgent(db, a.id)
    expect(d.name.length).toBeLessThanOrEqual(AGENT_NAME_MAX)
    expect(d.name.endsWith(' (copy)')).toBe(true)
  })

  it('duplicateAgent copies body+folder, names "X (copy)", assigns new id+timestamps', async () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'Original', body: 'body', folderId: f.id, handle: 'original', colorStart: '#888888', colorEnd: null, emoji: null })
    await new Promise(r => setTimeout(r, 5))
    const d = duplicateAgent(db, a.id)
    expect(d.id).not.toBe(a.id)
    expect(d.name).toBe('Original (copy)')
    expect(getPrimaryFile(db, d.id).content).toBe('body')
    expect(d.folder_id).toBe(f.id)
    expect(d.created_at >= a.created_at).toBe(true)
  })
})

describe('agentsService — agents (handle/color/emoji)', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent accepts handle/colorStart/colorEnd/emoji and persists them', () => {
    const a = createAgent(db, {
      name: 'Reviewer',
      body: '',
      folderId: null,
      handle: 'reviewer',
      colorStart: '#6366f1',
      colorEnd: '#a855f7',
      emoji: '🔍',
    })
    expect(a.handle).toBe('reviewer')
    expect(a.color_start).toBe('#6366f1')
    expect(a.color_end).toBe('#a855f7')
    expect(a.emoji).toBe('🔍')
  })

  it('createAgent uses solid swatch when colorEnd is null', () => {
    const a = createAgent(db, {
      name: 'Solid',
      body: '',
      folderId: null,
      handle: 'solid',
      colorStart: '#10b981',
      colorEnd: null,
      emoji: null,
    })
    expect(a.color_end).toBeNull()
    expect(a.emoji).toBeNull()
  })

  it('createAgent rejects invalid handle', () => {
    expect(() => createAgent(db, {
      name: 'X', body: '', folderId: null,
      handle: 'Bad Handle!',
      colorStart: '#000000', colorEnd: null, emoji: null,
    })).toThrow(/handle/i)
  })

  it('createAgent rejects duplicate handle', () => {
    createAgent(db, { name: 'A', body: '', folderId: null, handle: 'taken', colorStart: '#000000', colorEnd: null, emoji: null })
    expect(() => createAgent(db, {
      name: 'B', body: '', folderId: null, handle: 'taken', colorStart: '#000000', colorEnd: null, emoji: null,
    })).toThrow(/handle/i)
  })

  it('updateAgent can change handle when no conflict', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'aaa', colorStart: '#000000', colorEnd: null, emoji: null })
    const updated = updateAgent(db, a.id, { handle: 'bbb' })
    expect(updated.handle).toBe('bbb')
  })

  it('updateAgent rejects handle that conflicts with another agent', () => {
    createAgent(db, { name: 'A', body: '', folderId: null, handle: 'aaa', colorStart: '#000000', colorEnd: null, emoji: null })
    const b = createAgent(db, { name: 'B', body: '', folderId: null, handle: 'bbb', colorStart: '#000000', colorEnd: null, emoji: null })
    expect(() => updateAgent(db, b.id, { handle: 'aaa' })).toThrow(/handle/i)
  })

  it('updateAgent accepts color/emoji patches', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    const updated = updateAgent(db, a.id, { colorStart: '#ffffff', colorEnd: '#000000', emoji: '🌟' })
    expect(updated.color_start).toBe('#ffffff')
    expect(updated.color_end).toBe('#000000')
    expect(updated.emoji).toBe('🌟')
  })

  it('updateAgent accepts pinned boolean and converts to 0/1 + sets pinned_at', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    const pinned = updateAgent(db, a.id, { pinned: true })
    expect(pinned.pinned).toBe(1)
    expect(pinned.pinned_at).toMatch(/T/)
    const unpinned = updateAgent(db, a.id, { pinned: false })
    expect(unpinned.pinned).toBe(0)
    // pinned_at is preserved on unpin
    expect(unpinned.pinned_at).toBe(pinned.pinned_at)
  })

  it('duplicateAgent generates a unique handle by appending -2 etc.', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'foo', colorStart: '#000000', colorEnd: null, emoji: null })
    const dup = duplicateAgent(db, a.id)
    expect(dup.handle).toBe('foo-2')
    const dup2 = duplicateAgent(db, a.id)
    expect(dup2.handle).toBe('foo-3')
  })
})

describe('agentsService — getAllAgents', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns folders sorted by name ASC', () => {
    createFolder(db, 'Zeta')
    createFolder(db, 'Alpha')
    createFolder(db, 'Mu')
    const { folders } = getAllAgents(db)
    expect(folders.map(f => f.name)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('returns agents sorted by updated_at DESC', async () => {
    const a1 = createAgent(db, { name: 'A1', body: 'b', folderId: null, handle: 'a1', colorStart: '#888888', colorEnd: null, emoji: null })
    await new Promise(r => setTimeout(r, 5))
    const a2 = createAgent(db, { name: 'A2', body: 'b', folderId: null, handle: 'a2', colorStart: '#888888', colorEnd: null, emoji: null })
    await new Promise(r => setTimeout(r, 5))
    const a3 = createAgent(db, { name: 'A3', body: 'b', folderId: null, handle: 'a3', colorStart: '#888888', colorEnd: null, emoji: null })
    const { agents } = getAllAgents(db)
    expect(agents.map(a => a.id)).toEqual([a3.id, a2.id, a1.id])
  })
})

import {
  createPreset, updatePreset, deletePreset, duplicatePreset,
  PRESET_NAME_MAX, PRESETS_JSON_MAX,
} from './agentsService'
import { parseAgentPresets } from '../../src/types/agent'

describe('agentsService — presets', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'Reviewer',
      body: 'Look at {{focus}} for {{language}}',
      folderId: null,
      handle: 'reviewer',
      colorStart: '#6366f1',
      colorEnd: null,
      emoji: null,
    })
    agentId = a.id
  })

  it('createPreset returns a preset with derived slug + given values', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth', language: 'TS' })
    expect(p.name).toBe('Security review')
    expect(p.slug).toBe('security-review')
    expect(p.values).toEqual({ focus: 'auth', language: 'TS' })
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('createPreset persists the preset to presets_json', () => {
    createPreset(db, agentId, 'Style nitpick', { focus: 'naming' })
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    const presets = parseAgentPresets(row.presets_json)
    expect(presets.length).toBe(1)
    expect(presets[0].name).toBe('Style nitpick')
  })

  it('createPreset defaults values to {} when omitted', () => {
    const p = createPreset(db, agentId, 'Empty')
    expect(p.values).toEqual({})
  })

  it('createPreset rejects empty/whitespace name', () => {
    expect(() => createPreset(db, agentId, '')).toThrow(/name/i)
    expect(() => createPreset(db, agentId, '   ')).toThrow(/name/i)
  })

  it('createPreset rejects name exceeding PRESET_NAME_MAX', () => {
    const name = 'x'.repeat(PRESET_NAME_MAX + 1)
    expect(() => createPreset(db, agentId, name)).toThrow(/name.*length/i)
  })

  it('createPreset rejects unknown agentId', () => {
    expect(() => createPreset(db, 'no-such-agent', 'X')).toThrow(/agent/i)
  })

  it('createPreset dedupes slug per agent when two presets share a slug', () => {
    const p1 = createPreset(db, agentId, 'Security review')
    const p2 = createPreset(db, agentId, 'Security review')
    expect(p1.slug).toBe('security-review')
    expect(p2.slug).toBe('security-review-2')
    expect(p1.id).not.toBe(p2.id)
  })

  it('updatePreset changes name and regenerates slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const updated = updatePreset(db, agentId, p.id, { name: 'Security audit' })
    expect(updated.name).toBe('Security audit')
    expect(updated.slug).toBe('security-audit')
    expect(updated.values).toEqual({ focus: 'auth' })
  })

  it('updatePreset can change values without affecting name/slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const updated = updatePreset(db, agentId, p.id, { values: { focus: 'SQL injection' } })
    expect(updated.name).toBe('Security review')
    expect(updated.slug).toBe('security-review')
    expect(updated.values).toEqual({ focus: 'SQL injection' })
  })

  it('updatePreset dedupes slug against OTHER presets when renaming', () => {
    createPreset(db, agentId, 'Style nitpick')
    const p = createPreset(db, agentId, 'Quick review')
    const updated = updatePreset(db, agentId, p.id, { name: 'Style nitpick' })
    expect(updated.slug).toBe('style-nitpick-2')
  })

  it('updatePreset is a no-op slug change when renaming to same name', () => {
    const p = createPreset(db, agentId, 'Security review')
    const updated = updatePreset(db, agentId, p.id, { name: 'Security review' })
    expect(updated.slug).toBe('security-review')
  })

  it('updatePreset throws on unknown presetId', () => {
    expect(() => updatePreset(db, agentId, 'no-such-preset', { name: 'X' })).toThrow(/preset/i)
  })

  it('deletePreset removes the preset', () => {
    const p = createPreset(db, agentId, 'Security review')
    deletePreset(db, agentId, p.id)
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    expect(parseAgentPresets(row.presets_json)).toEqual([])
  })

  it('deletePreset on unknown id is a no-op', () => {
    createPreset(db, agentId, 'X')
    expect(() => deletePreset(db, agentId, 'no-such-preset')).not.toThrow()
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    expect(parseAgentPresets(row.presets_json).length).toBe(1)
  })

  it('duplicatePreset copies values and appends " (copy)" to the name with unique slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const dup = duplicatePreset(db, agentId, p.id)
    expect(dup.name).toBe('Security review (copy)')
    expect(dup.slug).toBe('security-review-copy')
    expect(dup.values).toEqual({ focus: 'auth' })
    expect(dup.id).not.toBe(p.id)
  })

  it('createPreset rejects when serialised presets exceed PRESETS_JSON_MAX', () => {
    const bigValue = 'x'.repeat(1024)
    let count = 0
    expect(() => {
      while (count < 200) {
        createPreset(db, agentId, `Preset ${count++}`, { focus: bigValue })
      }
    }).toThrow(/presets.*size|too large/i)
  })

  it('updateAgent bumps updated_at when presets change', async () => {
    const before = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    await new Promise(r => setTimeout(r, 5))
    createPreset(db, agentId, 'P')
    const after = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    expect(after.updated_at > before.updated_at).toBe(true)
  })
})

import {
  recordRevision,
  REVISION_RETENTION,
} from './agentsService'

describe('agentsService — recordRevision + retention', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: '# A\nbody', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  it('inserts a revision and returns the row', () => {
    const rev = recordRevision(db, agentId, '# A\nv2', '[]', 'body_edit', 'Edited body')
    expect(rev.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rev.agent_id).toBe(agentId)
    expect(rev.body).toBe('# A\nv2')
    expect(rev.kind).toBe('body_edit')
    expect(rev.summary).toBe('Edited body')
    expect(rev.created_at).toMatch(/T/)
    expect(rev.presets).toEqual([])
  })

  it('parses presets_json into the returned revision.presets array', () => {
    const rev = recordRevision(
      db, agentId, '#', '[{"id":"p1","name":"x","slug":"x","values":{}}]',
      'preset_change', 'Added preset',
    )
    expect(rev.presets).toEqual([{ id: 'p1', name: 'x', slug: 'x', values: {} }])
  })

  it('REVISION_RETENTION is 20', () => {
    expect(REVISION_RETENTION).toBe(20)
  })

  it('prunes older revisions when count exceeds REVISION_RETENTION', () => {
    for (let i = 0; i < REVISION_RETENTION + 5; i++) {
      recordRevision(db, agentId, `v${i}`, '[]', 'body_edit', `edit ${i}`)
    }
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    expect(count).toBe(REVISION_RETENTION)
  })

  it('pruning keeps the most recent rows', () => {
    for (let i = 0; i < REVISION_RETENTION + 3; i++) {
      recordRevision(db, agentId, `v${i}`, '[]', 'body_edit', `edit ${i}`)
    }
    const summaries = (db.prepare(
      `SELECT summary FROM agent_revisions WHERE agent_id = ? ORDER BY created_at ASC`,
    ).all(agentId) as { summary: string }[]).map(r => r.summary)
    expect(summaries[0]).toBe('edit 3')
    expect(summaries[summaries.length - 1]).toBe(`edit ${REVISION_RETENTION + 2}`)
  })

  it('retention is per-agent — pruning one agent does not affect another', () => {
    const b = createAgent(db, { name: 'B', body: 'b', folderId: null, handle: 'b', colorStart: '#111111', colorEnd: null, emoji: null })
    // createAgent now records a 'create' snapshot for each agent; account for that.
    for (let i = 0; i < REVISION_RETENTION + 5; i++) recordRevision(db, agentId, 'x', '[]', 'body_edit', `a${i}`)
    for (let i = 0; i < 3; i++) recordRevision(db, b.id, 'x', '[]', 'body_edit', `b${i}`)
    const aCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    const bCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(b.id) as { n: number }).n
    expect(aCount).toBe(REVISION_RETENTION)
    // b has the create snapshot + 3 manual revisions
    expect(bCount).toBe(4)
  })

  it('FK cascade: deleting the agent removes its revisions', () => {
    recordRevision(db, agentId, 'x', '[]', 'body_edit', 'e')
    recordRevision(db, agentId, 'y', '[]', 'body_edit', 'f')
    deleteAgent(db, agentId)
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    expect(count).toBe(0)
  })
})

describe('agentsService — listRevisions', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    agentId = a.id
  })

  it('returns revisions newest first', async () => {
    recordRevision(db, agentId, 'v1', '[]', 'body_edit', 'first')
    await new Promise(r => setTimeout(r, 5))
    recordRevision(db, agentId, 'v2', '[]', 'body_edit', 'second')
    const revs = listRevisions(db, agentId)
    expect(revs[0].summary).toBe('second')
    expect(revs[1].summary).toBe('first')
  })

  it('returns an empty array when there are no revisions', () => {
    // createAgent now records a 'create' snapshot, so use a fresh DB without going
    // through createAgent — insert an agent row directly so there are zero revisions.
    const freshDbInner = new Database(':memory:')
    initSchema(freshDbInner)
    freshDbInner.prepare(`
      INSERT INTO agents (id, name, handle, folder_id, color_start, color_end, emoji, created_at, updated_at)
      VALUES ('bare', 'bare', 'bare', NULL, '#000000', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run()
    expect(listRevisions(freshDbInner, 'bare')).toEqual([])
  })

  it('throws on unknown agentId', () => {
    expect(() => listRevisions(db, 'no-such-agent')).toThrow(/agent/i)
  })

  it('parses presets_json on each row', () => {
    recordRevision(db, agentId, 'x', '[{"id":"p1","name":"x","slug":"x","values":{}}]', 'preset_change', 'p')
    const revs = listRevisions(db, agentId)
    expect(revs[0].presets).toEqual([{ id: 'p1', name: 'x', slug: 'x', values: {} }])
  })
})

describe('agentsService — snapshots on agent CRUD', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent inserts a "create" revision snapshot', () => {
    const a = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
    expect(revs[0].body).toBe('# A')
    expect(revs[0].summary).toMatch(/created/i)
  })

  it('updateAgent records a body_edit snapshot when body changes', () => {
    const a = createAgent(db, { name: 'A', body: 'v1', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { body: 'v2' })
    const revs = listRevisions(db, a.id)
    // newest first: body_edit, then create
    expect(revs[0].kind).toBe('body_edit')
    expect(revs[0].body).toBe('v2')
    expect(revs[1].kind).toBe('create')
  })

  it('updateAgent does NOT snapshot when body is unchanged', () => {
    const a = createAgent(db, { name: 'A', body: 'same', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { body: 'same' })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })

  it('updateAgent does NOT snapshot when only metadata fields change', () => {
    const a = createAgent(db, { name: 'A', body: 'v', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { name: 'B', emoji: '🌟' })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })

  it('updateAgent body_edit snapshot captures the current presets_json too', () => {
    const a = createAgent(db, { name: 'A', body: 'v', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    createPreset(db, a.id, 'P1')   // this records a preset_change snapshot (Task 3 adds the wiring; meanwhile assertion still holds because revs[0] will be the body_edit we make next)
    updateAgent(db, a.id, { body: 'v2' })
    const revs = listRevisions(db, a.id)
    expect(revs[0].kind).toBe('body_edit')
    expect(revs[0].presets.length).toBe(1)
    expect(revs[0].presets[0].name).toBe('P1')
  })
})

describe('agentsService — snapshots on preset CRUD', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: 'b', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  it('createPreset records a preset_change snapshot', () => {
    createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Added')
    expect(revs[0].summary).toContain('Security review')
    expect(revs[0].presets.length).toBe(1)
  })

  it('updatePreset records "Renamed" when name changes', () => {
    const p = createPreset(db, agentId, 'Old name')
    updatePreset(db, agentId, p.id, { name: 'New name' })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Renamed')
    expect(revs[0].summary).toContain('Old name')
    expect(revs[0].summary).toContain('New name')
  })

  it('updatePreset records "Updated" when only values change', () => {
    const p = createPreset(db, agentId, 'P')
    updatePreset(db, agentId, p.id, { values: { focus: 'auth' } })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Updated')
    expect(revs[0].summary).toContain('P')
  })

  it('updatePreset records "Renamed" when both name and values change', () => {
    const p = createPreset(db, agentId, 'P', { x: 'old' })
    updatePreset(db, agentId, p.id, { name: 'Q', values: { x: 'new' } })
    const revs = listRevisions(db, agentId)
    expect(revs[0].summary).toContain('Renamed')
  })

  it('deletePreset records a preset_change snapshot', () => {
    const p = createPreset(db, agentId, 'P')
    deletePreset(db, agentId, p.id)
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Deleted')
    expect(revs[0].summary).toContain('P')
  })

  it('deletePreset on unknown id does NOT snapshot', () => {
    createPreset(db, agentId, 'X')
    const before = listRevisions(db, agentId).length
    deletePreset(db, agentId, 'no-such-preset')
    expect(listRevisions(db, agentId).length).toBe(before)
  })

  it('duplicatePreset records a preset_change snapshot', () => {
    const p = createPreset(db, agentId, 'P')
    duplicatePreset(db, agentId, p.id)
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Duplicated')
    expect(revs[0].summary).toContain('P')
  })
})

import { revertToRevision } from './agentsService'

describe('agentsService — revertToRevision', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: 'v1', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
    updateAgent(db, agentId, { body: 'v2' })
    updateAgent(db, agentId, { body: 'v3' })
  })

  it('writes the older body back into the agent', () => {
    const revs = listRevisions(db, agentId)
    // revs[0] = body_edit(v3), revs[1] = body_edit(v2), revs[2] = create(v1)
    const v1 = revs[2]
    expect(v1.kind).toBe('create')
    expect(v1.body).toBe('v1')
    const restored = revertToRevision(db, agentId, v1.id)
    expect(getPrimaryFile(db, restored.id).content).toBe('v1')
  })

  it('inserts a new "revert" revision snapshot', () => {
    const revs = listRevisions(db, agentId)
    const v1 = revs[2]
    revertToRevision(db, agentId, v1.id)
    const after = listRevisions(db, agentId)
    expect(after[0].kind).toBe('revert')
    expect(after[0].body).toBe('v1')
    expect(after[0].summary).toMatch(/revert/i)
  })

  it('restores presets_json as well', () => {
    // Create a fresh agent with presets, capture a revision, then change presets, then revert.
    const fresh = createAgent(db, { name: 'B', body: 'b', folderId: null, handle: 'b', colorStart: '#000000', colorEnd: null, emoji: null })
    const p = createPreset(db, fresh.id, 'P', { x: 'old' })  // snapshot 'preset_change'
    const target = listRevisions(db, fresh.id)[0]  // the preset_change snapshot with the preset
    updatePreset(db, fresh.id, p.id, { values: { x: 'new' } })  // another snapshot
    const restored = revertToRevision(db, fresh.id, target.id)
    const presets = parseAgentPresets(restored.presets_json)
    expect(presets[0].values).toEqual({ x: 'old' })
  })

  it('throws on unknown revisionId', () => {
    expect(() => revertToRevision(db, agentId, 'no-such-rev')).toThrow(/revision/i)
  })

  it('throws when revision belongs to a different agent', () => {
    const b = createAgent(db, { name: 'B', body: 'x', folderId: null, handle: 'b', colorStart: '#000000', colorEnd: null, emoji: null })
    const otherRev = listRevisions(db, b.id)[0]
    expect(() => revertToRevision(db, agentId, otherRev.id)).toThrow(/revision/i)
  })
})

import { recordUse } from './agentsService'

describe('agentsService — recordUse', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: 'b', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  it('updates last_used_at to a fresh ISO timestamp', () => {
    const before = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(before.last_used_at).toBeNull()
    recordUse(db, agentId, null)
    const after = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(after.last_used_at).toMatch(/T/)
  })

  it('accepts a non-null presetId (forward compat, no per-preset tracking yet)', () => {
    expect(() => recordUse(db, agentId, 'p-xyz')).not.toThrow()
    const row = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(row.last_used_at).toMatch(/T/)
  })

  it('throws on unknown agentId', () => {
    expect(() => recordUse(db, 'no-such-agent', null)).toThrow(/agent/i)
  })

  it('does NOT bump updated_at — recent-use must not promote the agent in updated_at ordering', async () => {
    const before = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    await new Promise(r => setTimeout(r, 5))
    recordUse(db, agentId, null)
    const after = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    expect(after.updated_at).toBe(before.updated_at)
  })

  it('does NOT record a revision (recordUse is metadata-only)', () => {
    recordUse(db, agentId, null)
    const revs = listRevisions(db, agentId)
    // Should be just the initial 'create' revision from createAgent (Phase C).
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })
})

describe('agentsService — agent files', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  // Note: createAgent automatically creates a primary file row at sort_order=0
  // named <handle>.md. These tests use sibling files at sort_order >= 1, since
  // sort_order=0 is reserved for the primary.

  it('listFiles returns rows ordered by sort_order ascending (primary first)', () => {
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('f1', agentId, 'b.md', 'B', 2, '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('f2', agentId, 'aa.md', 'AA', 1, '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    const files = listFiles(db, agentId)
    expect(files.map(f => f.filename)).toEqual(['a.md', 'aa.md', 'b.md'])
  })

  it('createFile inserts a sibling file alongside the primary', () => {
    const file = createFile(db, agentId, { filename: 'notes.md', content: '# Hi', sortOrder: 1 })
    expect(file.filename).toBe('notes.md')
    expect(file.content).toBe('# Hi')
    expect(listFiles(db, agentId)).toHaveLength(2)  // primary + new sibling
  })

  it('createFile rejects duplicate filenames within an agent', () => {
    createFile(db, agentId, { filename: 'notes.md', content: 'a', sortOrder: 1 })
    expect(() => createFile(db, agentId, { filename: 'notes.md', content: 'b', sortOrder: 2 })).toThrow()
  })

  it('updateFile patches content and bumps updated_at', async () => {
    const f = createFile(db, agentId, { filename: 'notes.md', content: 'a', sortOrder: 1 })
    await new Promise(r => setTimeout(r, 5))
    const updated = updateFile(db, agentId, f.id, { content: 'b' })
    expect(updated.content).toBe('b')
    expect(updated.updated_at).not.toBe(f.updated_at)
  })

  it('updateFile can rename and rejects duplicate rename', () => {
    const f1 = createFile(db, agentId, { filename: 'aa.md', content: 'a', sortOrder: 1 })
    createFile(db, agentId, { filename: 'bb.md', content: 'b', sortOrder: 2 })
    const renamed = updateFile(db, agentId, f1.id, { filename: 'cc.md' })
    expect(renamed.filename).toBe('cc.md')
    expect(() => updateFile(db, agentId, f1.id, { filename: 'bb.md' })).toThrow()
  })

  it('deleteFile removes a sibling row (primary remains)', () => {
    const f = createFile(db, agentId, { filename: 'notes.md', content: 'a', sortOrder: 1 })
    deleteFile(db, agentId, f.id)
    expect(listFiles(db, agentId)).toHaveLength(1)  // primary still there
  })

  it('deleting the agent cascade-deletes its files (including the primary)', () => {
    createFile(db, agentId, { filename: 'notes.md', content: 'a', sortOrder: 1 })
    deleteAgent(db, agentId)
    const rows = db.prepare(`SELECT COUNT(*) as c FROM agent_files WHERE agent_id = ?`).get(agentId) as { c: number }
    expect(rows.c).toBe(0)
  })
})

describe('agentsService — description', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent accepts and persists description', () => {
    const agent = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
      description: 'My description',
    })
    expect(agent.description).toBe('My description')
  })

  it('createAgent defaults description to empty string when omitted', () => {
    const agent = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    expect(agent.description).toBe('')
  })

  it('updateAgent patches description', () => {
    const agent = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    const updated = updateAgent(db, agent.id, { description: 'New desc' })
    expect(updated.description).toBe('New desc')
  })
})

describe('validation helpers', () => {
  it('assertValidModel accepts the four canonical values', () => {
    expect(() => assertValidModel('sonnet')).not.toThrow()
    expect(() => assertValidModel('opus')).not.toThrow()
    expect(() => assertValidModel('haiku')).not.toThrow()
    expect(() => assertValidModel('inherit')).not.toThrow()
  })

  it('assertValidModel throws on unknown values', () => {
    expect(() => assertValidModel('gpt-4')).toThrow(/model/i)
    expect(() => assertValidModel('')).toThrow(/model/i)
    expect(() => assertValidModel(null)).toThrow(/model/i)
  })

  it('assertValidTools accepts string arrays and null', () => {
    expect(() => assertValidTools(null)).not.toThrow()
    expect(() => assertValidTools([])).not.toThrow()
    expect(() => assertValidTools(['Read', 'Edit'])).not.toThrow()
  })

  it('assertValidTools rejects non-array and non-string entries', () => {
    expect(() => assertValidTools('Read, Edit')).toThrow()
    expect(() => assertValidTools([123 as unknown as string])).toThrow()
  })
})

describe('agent skill-parity fields', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  function makeBaseInput(overrides: Partial<Parameters<typeof createAgent>[1]> = {}): Parameters<typeof createAgent>[1] {
    return {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#888888', colorEnd: null, emoji: null,
      ...overrides,
    }
  }

  it('createAgent defaults all new fields safely', () => {
    const agent = createAgent(db, makeBaseInput())
    expect(agent.model).toBe('inherit')
    expect(agent.tools).toBeNull()
    expect(agent.argument_hint).toBeNull()
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
    expect(agent.synced_subagent_at).toBeNull()
    expect(agent.synced_slash_command_at).toBeNull()
  })

  it('createAgent accepts and persists the new fields', () => {
    const agent = createAgent(db, makeBaseInput({
      model: 'opus',
      tools: ['Read', 'Edit'],
      argumentHint: '[project]',
      isSubagent: true,
      isSlashCommand: true,
    }))
    expect(agent.model).toBe('opus')
    expect(agent.tools).toBe('["Read","Edit"]')
    expect(agent.argument_hint).toBe('[project]')
    expect(agent.is_subagent).toBe(1)
    expect(agent.is_slash_command).toBe(1)
  })

  it('createAgent rejects an invalid model value', () => {
    expect(() => createAgent(db, makeBaseInput({ model: 'gpt-4' as any }))).toThrow(/model/i)
  })

  it('createAgent rejects non-array tools', () => {
    expect(() => createAgent(db, makeBaseInput({ tools: 'Read, Edit' as any }))).toThrow(/tools/i)
  })

  it('duplicateAgent carries Phase 2 content fields, drops surface toggles', () => {
    const a = createAgent(db, makeBaseInput({
      model: 'opus',
      tools: ['Read', 'Edit'],
      argumentHint: '[arg]',
      isSubagent: true,
      isSlashCommand: true,
    }))
    const d = duplicateAgent(db, a.id)
    expect(d.model).toBe('opus')
    expect(d.tools).toBe('["Read","Edit"]')
    expect(d.argument_hint).toBe('[arg]')
    // Surface toggles must NOT carry across — duplicating an agent that owns
    // ~/.claude/agents/foo.md should not auto-create another file with the new handle.
    expect(d.is_subagent).toBe(0)
    expect(d.is_slash_command).toBe(0)
  })

  it('updateAgent patches model, tools, argumentHint, isSubagent, isSlashCommand independently', () => {
    const agent = createAgent(db, makeBaseInput())
    const after1 = updateAgent(db, agent.id, { model: 'haiku' })
    expect(after1.model).toBe('haiku')
    const after2 = updateAgent(db, agent.id, { tools: ['Read'] })
    expect(after2.tools).toBe('["Read"]')
    const after3 = updateAgent(db, agent.id, { tools: null })
    expect(after3.tools).toBeNull()
    const after4 = updateAgent(db, agent.id, { isSubagent: true })
    expect(after4.is_subagent).toBe(1)
    const after5 = updateAgent(db, agent.id, { isSlashCommand: true })
    expect(after5.is_slash_command).toBe(1)
    const after6 = updateAgent(db, agent.id, { argumentHint: '[arg]' })
    expect(after6.argument_hint).toBe('[arg]')
    const after7 = updateAgent(db, agent.id, { argumentHint: null })
    expect(after7.argument_hint).toBeNull()
  })
})

describe('agentsService — primary file routing', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  function makeBaseInput(overrides: Partial<Parameters<typeof createAgent>[1]> = {}): Parameters<typeof createAgent>[1] {
    return {
      name: 'A', body: 'persona body', folderId: null,
      handle: 'a', colorStart: '#888888', colorEnd: null, emoji: null,
      ...overrides,
    }
  }

  it('createAgent writes the body to the primary file row at sort_order=0', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'persona body' }))
    const primary = db.prepare(
      `SELECT filename, content, sort_order FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { filename: string; content: string; sort_order: number }
    expect(primary.filename).toBe(`${agent.handle}.md`)
    expect(primary.content).toBe('persona body')
    expect(primary.sort_order).toBe(0)
  })

  it('updateAgent({ body }) writes to the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    updateAgent(db, agent.id, { body: 'v2' })
    const primary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { content: string }
    expect(primary.content).toBe('v2')
  })

  it('updateAgent({ handle }) renames the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ handle: 'old-name' }))
    updateAgent(db, agent.id, { handle: 'new-name' })
    const primary = db.prepare(
      `SELECT filename FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { filename: string }
    expect(primary.filename).toBe('new-name.md')
  })

  it('deleteFile throws when called on the primary file row', () => {
    const agent = createAgent(db, makeBaseInput())
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    expect(() => deleteFile(db, agent.id, primary.id)).toThrow(/primary/i)
  })

  it('updateFile({ filename }) throws when renaming the primary file row', () => {
    const agent = createAgent(db, makeBaseInput())
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    expect(() => updateFile(db, agent.id, primary.id, { filename: 'something-else.md' })).toThrow(/primary/i)
  })

  it('updateFile({ content }) is allowed on the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    updateFile(db, agent.id, primary.id, { content: 'v2' })
    const after = db.prepare(`SELECT content FROM agent_files WHERE id = ?`).get(primary.id) as { content: string }
    expect(after.content).toBe('v2')
  })

  it('duplicateAgent creates an independent primary file row for the duplicate', () => {
    const a = createAgent(db, makeBaseInput({ body: 'src body', handle: 'src' }))
    const d = duplicateAgent(db, a.id)
    const srcPrimary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(a.id) as { content: string }
    const dupPrimary = db.prepare(
      `SELECT filename, content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(d.id) as { filename: string; content: string }
    expect(srcPrimary.content).toBe('src body')
    expect(dupPrimary.content).toBe('src body')
    expect(dupPrimary.filename).toBe(`${d.handle}.md`)
    expect(d.handle).not.toBe(a.handle)
  })

  it('getPrimaryFile returns the primary row content', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'persona' }))
    const primary = getPrimaryFile(db, agent.id)
    expect(primary.content).toBe('persona')
    expect(primary.filename).toBe(`${agent.handle}.md`)
  })

  it('getPrimaryFile throws on unknown agent id', () => {
    expect(() => getPrimaryFile(db, 'no-such-agent')).toThrow(/agent/i)
  })

  it('updateAgent({ body }) records a body_edit revision when content changes', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    const before = listRevisions(db, agent.id).length
    updateAgent(db, agent.id, { body: 'v2' })
    const after = listRevisions(db, agent.id).length
    expect(after).toBe(before + 1)
    expect(listRevisions(db, agent.id)[0].body).toBe('v2')
  })
})

describe('setSyncedAt', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  function newAgent() {
    return createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#888888', colorEnd: null, emoji: null,
    })
  }

  it('updates synced_subagent_at independently of other columns', () => {
    const agent = newAgent()
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as any
    expect(row.synced_subagent_at).toBe('2026-05-25T10:00:00.000Z')
    expect(row.synced_slash_command_at).toBeNull()
  })

  it('clears the timestamp when passed null', () => {
    const agent = newAgent()
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    setSyncedAt(db, agent.id, 'subagent', null)
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as any
    expect(row.synced_subagent_at).toBeNull()
  })

  it('does NOT bump updated_at', () => {
    const agent = newAgent()
    const before = (db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any).updated_at
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    const after = (db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any).updated_at
    expect(after).toBe(before)
  })

  it('handles slashCommand surface separately from subagent', () => {
    const agent = newAgent()
    setSyncedAt(db, agent.id, 'slashCommand', '2026-05-25T10:00:00.000Z')
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as any
    expect(row.synced_subagent_at).toBeNull()
    expect(row.synced_slash_command_at).toBe('2026-05-25T10:00:00.000Z')
  })
})
