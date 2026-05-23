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
