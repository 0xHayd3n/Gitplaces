import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — enabled_tools', () => {
  it('adds enabled_tools column to skills', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitplaces-db-'))
    const db = getDb(dir)
    const info = db.prepare("PRAGMA table_info('skills')").all() as { name: string }[]
    expect(info.some(c => c.name === 'enabled_tools')).toBe(true)
  })

  it('preserves existing rows (enabled_tools defaults to null)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitplaces-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('r1', 'o', 'n', '[]')`).run()
    db.prepare(`INSERT INTO skills (repo_id, filename, content, version, generated_at, active) VALUES ('r1', 'n.skill.md', '', 'v1', 'now', 1)`).run()
    const row = db.prepare(`SELECT enabled_tools FROM skills WHERE repo_id = 'r1'`).get() as { enabled_tools: string | null }
    expect(row.enabled_tools).toBeNull()
  })
})
