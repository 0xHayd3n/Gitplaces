// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('agents redesign — schema migration', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('agents table has all new columns', () => {
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('handle')
    expect(names).toContain('color_start')
    expect(names).toContain('color_end')
    expect(names).toContain('emoji')
    expect(names).toContain('pinned')
    expect(names).toContain('pinned_at')
    expect(names).toContain('last_used_at')
    expect(names).toContain('presets_json')
  })

  it('agent_revisions table exists with expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(agent_revisions)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['id', 'agent_id', 'body', 'presets_json', 'summary', 'kind', 'created_at']),
    )
  })

  it('indexes exist for pinned, last_used_at, revisions', () => {
    const idx = db.prepare(`PRAGMA index_list(agents)`).all() as { name: string; unique: number }[]
    expect(idx.find(i => i.name === 'idx_agents_pinned')).toBeDefined()
    expect(idx.find(i => i.name === 'idx_agents_last_used')).toBeDefined()

    const revIdx = db.prepare(`PRAGMA index_list(agent_revisions)`).all() as { name: string }[]
    expect(revIdx.find(i => i.name === 'idx_revisions_agent')).toBeDefined()
  })

  it('presets_json defaults to "[]" on new rows', () => {
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at) VALUES ('a1','A','b','t','t')`).run()
    const row = db.prepare(`SELECT presets_json, pinned FROM agents WHERE id='a1'`).get() as any
    expect(row.presets_json).toBe('[]')
    expect(row.pinned).toBe(0)
  })

  it('init is idempotent — running twice does not throw', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})

describe('agents redesign — backfill', () => {
  function dbWithPreRedesignRow(): Database.Database {
    const db = new Database(':memory:')
    initSchema(db)
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a1', 'Agent 1', '# A1', 't', 't')
    db.prepare(`UPDATE agents SET handle = '' WHERE id = 'a1'`).run()
    return db
  }

  it('backfill assigns a handle derived from the name', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const row = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    expect(row.handle).toBe('agent-1')
  })

  it('backfill assigns a color_start derived from the handle', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const row = db.prepare(`SELECT color_start, color_end FROM agents WHERE id='a1'`).get() as any
    expect(row.color_start).toMatch(/^#[0-9a-f]{6}$/)
    expect(row.color_end).toBeNull()
  })

  it('backfill is idempotent — running initSchema again does not change handles', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const first = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    initSchema(db)
    const second = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    expect(second.handle).toBe(first.handle)
  })

  it('backfill dedupes collisions across multiple rows', () => {
    const db = new Database(':memory:')
    initSchema(db)
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a1', 'Hello', '#', 't', 't')
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a2', 'Hello', '#', 't', 't')
    db.prepare(`UPDATE agents SET handle = ''`).run()
    initSchema(db)
    const handles = (db.prepare(`SELECT handle FROM agents ORDER BY id`).all() as any[]).map(r => r.handle)
    expect(handles[0]).toBe('hello')
    expect(handles[1]).toBe('hello-2')
  })

  it('UNIQUE index on handle is created (post-backfill)', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const idx = db.prepare(`PRAGMA index_list(agents)`).all() as { name: string; unique: number }[]
    expect(idx.find(i => i.name === 'idx_agents_handle')?.unique).toBe(1)
  })

  it('backfill inserts an initial "create" revision for each existing agent', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const revs = db.prepare(`SELECT kind, body, agent_id FROM agent_revisions WHERE agent_id='a1'`).all() as any[]
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
    expect(revs[0].body).toBe('# A1')
  })
})
