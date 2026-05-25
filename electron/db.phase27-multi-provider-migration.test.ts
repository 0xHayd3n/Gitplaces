// electron/db.phase27-multi-provider-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('Phase 27 migration — multi-provider model columns', () => {
  it('adds model_provider column to agents with default "anthropic"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string; dflt_value: string | null; notnull: number }[]
    const col = cols.find(c => c.name === 'model_provider')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(1)
    // SQLite stores text defaults as quoted strings — normalize for the check
    expect(col?.dflt_value?.replace(/^'|'$/g, '')).toBe('anthropic')
  })

  it('adds model_endpoint_id column to agents as nullable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string; notnull: number }[]
    const col = cols.find(c => c.name === 'model_endpoint_id')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(0)
  })

  it('backfills existing rows with model_provider="anthropic"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`
      INSERT INTO agents (id, name, handle, folder_id, created_at, updated_at, description, model)
      VALUES ('a1', 'Test', 'test', NULL, 't', 't', '', 'sonnet')
    `).run()
    const row = db.prepare(`SELECT model_provider, model_endpoint_id FROM agents WHERE id='a1'`).get() as { model_provider: string; model_endpoint_id: string | null }
    expect(row.model_provider).toBe('anthropic')
    expect(row.model_endpoint_id).toBeNull()
  })

  it('is idempotent — running getDb twice does not error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    getDb(dir)
    expect(() => getDb(dir)).not.toThrow()
  })
})
