// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('agent_folders.emoji — migration', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('agent_folders has an emoji column after initSchema', () => {
    const cols = db.prepare(`PRAGMA table_info(agent_folders)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('emoji')
  })

  it('emoji defaults to NULL on insert when not specified', () => {
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES (?, ?, ?)`)
      .run('f1', 'Writing', '2026-05-25T00:00:00Z')
    const row = db.prepare(`SELECT emoji FROM agent_folders WHERE id='f1'`).get() as { emoji: string | null }
    expect(row.emoji).toBeNull()
  })

  it('emoji round-trips when written', () => {
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES (?, ?, ?)`)
      .run('f1', 'Writing', '2026-05-25T00:00:00Z')
    db.prepare(`UPDATE agent_folders SET emoji = ? WHERE id = 'f1'`).run('📝')
    const row = db.prepare(`SELECT emoji FROM agent_folders WHERE id='f1'`).get() as { emoji: string }
    expect(row.emoji).toBe('📝')
  })

  it('initSchema is idempotent (running twice does not throw)', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})
