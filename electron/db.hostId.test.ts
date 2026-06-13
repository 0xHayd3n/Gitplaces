// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

describe('host_id migration', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    initSchema(db)
  })

  const tables = [
    'repos',
    'profile_cache',
    'repo_security_cache',
    'repo_stats_cache',
    'repo_momentum_cache',
    'repo_releases_cache',
  ]

  for (const table of tables) {
    it(`${table} has a host_id column defaulting to gh:api.github.com`, () => {
      const cols = db
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>
      const hostId = cols.find(c => c.name === 'host_id')
      expect(hostId, `${table} should have host_id`).toBeDefined()
      expect(hostId!.notnull).toBe(1)
      expect(hostId!.dflt_value).toBe(`'gh:api.github.com'`)
    })
  }

  it('existing rows backfill to gh:api.github.com', () => {
    db.prepare(`INSERT INTO repos (id, owner, name) VALUES (?, ?, ?)`).run('1', 'alice', 'demo')
    const row = db.prepare(`SELECT host_id FROM repos WHERE id = '1'`).get() as { host_id: string }
    expect(row.host_id).toBe('gh:api.github.com')
  })

  it('migration is idempotent (running initSchema twice does not throw)', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})
