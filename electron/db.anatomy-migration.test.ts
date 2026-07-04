import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — anatomy columns', () => {
  it('adds anatomy_* columns to skills', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitplaces-db-'))
    const db = getDb(dir)
    const cols = (db.prepare("PRAGMA table_info('skills')").all() as { name: string }[]).map(c => c.name)
    for (const c of ['anatomy_memory', 'anatomy_commit', 'anatomy_fingerprint', 'anatomy_source', 'anatomy_brief', 'anatomy_verify']) {
      expect(cols).toContain(c)
    }
  })

  it('preserves existing skills rows (anatomy_source defaults null)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitplaces-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('r1','o','n','[]')`).run()
    db.prepare(`INSERT INTO skills (repo_id, filename, content, version, generated_at, active) VALUES ('r1','n.skill.md','','v1','now',1)`).run()
    const row = db.prepare(`SELECT anatomy_source FROM skills WHERE repo_id='r1'`).get() as { anatomy_source: string | null }
    expect(row.anatomy_source).toBeNull()
  })
})
