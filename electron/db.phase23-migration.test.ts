// electron/db.phase23-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — Phase 23 update notifications', () => {
  it('adds is_forked column to repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'is_forked')).toBe(true)
  })

  it('adds update_available column to repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'update_available')).toBe(true)
  })

  it('adds stored_version, upstream_version, update_checked_at columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('repos')").all() as { name: string }[]
    expect(cols.some(c => c.name === 'stored_version')).toBe(true)
    expect(cols.some(c => c.name === 'upstream_version')).toBe(true)
    expect(cols.some(c => c.name === 'update_checked_at')).toBe(true)
  })

  it('is_forked defaults to 0 for existing rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('o/n', 'o', 'n', '[]')`).run()
    const row = db.prepare(`SELECT is_forked, update_available FROM repos WHERE id = 'o/n'`).get() as { is_forked: number; update_available: number }
    expect(row.is_forked).toBe(0)
    expect(row.update_available).toBe(0)
  })
})
