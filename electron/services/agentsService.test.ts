// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import {
  createAgent, updateAgent, deleteAgent, duplicateAgent, getAllAgents,
  createFolder, renameFolder, deleteFolder,
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

describe('agentsService — agents', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent inserts and returns the row', () => {
    const a = createAgent(db, { name: 'Editor', body: '# Editor\nbody', folderId: null, handle: 'editor', colorStart: '#888888', colorEnd: null, emoji: null })
    expect(a.name).toBe('Editor')
    expect(a.body).toBe('# Editor\nbody')
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
    expect(u.body).toBe('b2')
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
    expect(u.body).toBe('b')
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
    expect(d.body).toBe('body')
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
  recordRevision, listRevisions,
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
    for (let i = 0; i < REVISION_RETENTION + 5; i++) recordRevision(db, agentId, 'x', '[]', 'body_edit', `a${i}`)
    for (let i = 0; i < 3; i++) recordRevision(db, b.id, 'x', '[]', 'body_edit', `b${i}`)
    const aCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    const bCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(b.id) as { n: number }).n
    expect(aCount).toBe(REVISION_RETENTION)
    expect(bCount).toBe(3)
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
    expect(listRevisions(db, agentId)).toEqual([])
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
