// electron/db.agents-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — agent markdown section', () => {
  it('creates agent_folders table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agent_folders')").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'color_start', 'color_end', 'description', 'created_at',
    ]))
  })

  it('creates agents table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'body', 'folder_id', 'created_at', 'updated_at',
    ]))
  })

  it('creates idx_agents_folder and idx_agents_updated indexes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const indexes = db.prepare("PRAGMA index_list('agents')").all() as { name: string }[]
    const names = indexes.map(i => i.name)
    expect(names).toEqual(expect.arrayContaining(['idx_agents_folder', 'idx_agents_updated']))
  })

  it('ON DELETE SET NULL: deleting a folder nulls out folder_id on its agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES ('f1', 'Writing', '2026-05-23T00:00:00Z')`).run()
    db.prepare(`
      INSERT INTO agents (id, name, body, folder_id, created_at, updated_at)
      VALUES ('a1', 'Test', '# Test', 'f1', '2026-05-23T00:00:00Z', '2026-05-23T00:00:00Z')
    `).run()
    db.prepare(`DELETE FROM agent_folders WHERE id = 'f1'`).run()
    const row = db.prepare(`SELECT folder_id FROM agents WHERE id = 'a1'`).get() as { folder_id: string | null }
    expect(row.folder_id).toBeNull()
  })

  it('initialises cleanly on a pre-existing DB (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    getDb(dir)
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    expect(cols.length).toBeGreaterThan(0)
  })
})
