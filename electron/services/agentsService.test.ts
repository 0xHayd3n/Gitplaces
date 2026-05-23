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
    const a = createAgent(db, { name: 'A', body: '# A', folderId: f.id })
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
    const a = createAgent(db, { name: 'Editor', body: '# Editor\nbody', folderId: null })
    expect(a.name).toBe('Editor')
    expect(a.body).toBe('# Editor\nbody')
    expect(a.folder_id).toBeNull()
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.created_at).toBe(a.updated_at)
  })

  it('createAgent rejects when name exceeds AGENT_NAME_MAX', () => {
    const name = 'x'.repeat(AGENT_NAME_MAX + 1)
    expect(() => createAgent(db, { name, body: 'body', folderId: null }))
      .toThrow(/name.*length/i)
  })

  it('createAgent rejects when body exceeds AGENT_BODY_MAX', () => {
    const body = 'x'.repeat(AGENT_BODY_MAX + 1)
    expect(() => createAgent(db, { name: 'X', body, folderId: null }))
      .toThrow(/body.*length/i)
  })

  it('createAgent rejects unknown folderId', () => {
    expect(() => createAgent(db, { name: 'X', body: 'b', folderId: 'nope' }))
      .toThrow(/folder/i)
  })

  it('createAgent falls back to "Untitled agent" when name is empty after trim', () => {
    const a = createAgent(db, { name: '   ', body: 'b', folderId: null })
    expect(a.name).toBe('Untitled agent')
  })

  it('updateAgent applies a partial patch and bumps updated_at', async () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5))
    const u = updateAgent(db, a.id, { body: 'b2' })
    expect(u.body).toBe('b2')
    expect(u.name).toBe('A')
    expect(u.updated_at > a.updated_at).toBe(true)
  })

  it('updateAgent can set folder_id back to null', () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'A', body: 'b', folderId: f.id })
    const u = updateAgent(db, a.id, { folderId: null })
    expect(u.folder_id).toBeNull()
  })

  it('updateAgent rejects unknown folderId', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    expect(() => updateAgent(db, a.id, { folderId: 'nope' })).toThrow(/folder/i)
  })

  it('deleteAgent removes the row', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    deleteAgent(db, a.id)
    const all = getAllAgents(db)
    expect(all.agents.find(x => x.id === a.id)).toBeUndefined()
  })

  it('updateAgent with empty patch returns unchanged row', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
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
    const a = createAgent(db, { name: longName, body: 'b', folderId: null })
    const d = duplicateAgent(db, a.id)
    expect(d.name.length).toBeLessThanOrEqual(AGENT_NAME_MAX)
    expect(d.name.endsWith(' (copy)')).toBe(true)
  })

  it('duplicateAgent copies body+folder, names "X (copy)", assigns new id+timestamps', async () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'Original', body: 'body', folderId: f.id })
    await new Promise(r => setTimeout(r, 5))
    const d = duplicateAgent(db, a.id)
    expect(d.id).not.toBe(a.id)
    expect(d.name).toBe('Original (copy)')
    expect(d.body).toBe('body')
    expect(d.folder_id).toBe(f.id)
    expect(d.created_at >= a.created_at).toBe(true)
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
    const a1 = createAgent(db, { name: 'A1', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5))
    const a2 = createAgent(db, { name: 'A2', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5))
    const a3 = createAgent(db, { name: 'A3', body: 'b', folderId: null })
    const { agents } = getAllAgents(db)
    expect(agents.map(a => a.id)).toEqual([a3.id, a2.id, a1.id])
  })
})
