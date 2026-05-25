// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

// `initSchema` runs Phase 26 which drops `agents.body`. To exercise the migration
// backfill, the test needs to simulate the pre-migration state: re-add the body
// column on the freshly-initialised DB, INSERT pre-migration agent rows, then
// call initSchema again — that re-entry runs Phase 26 against the seeded rows.
function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  // Re-add body so test fixtures can simulate the pre-Phase-26 state.
  db.exec(`ALTER TABLE agents ADD COLUMN body TEXT NOT NULL DEFAULT ''`)
  return db
}

function seedAgent(db: Database.Database, overrides: Partial<{
  id: string; handle: string; body: string;
}> = {}): string {
  const id = overrides.id ?? `a-${Math.random().toString(36).slice(2, 8)}`
  const handle = overrides.handle ?? 'my-agent'
  const body = overrides.body ?? 'Agent body content.'
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji,
      created_at, updated_at, description, model)
    VALUES (?, 'Test', ?, ?, NULL, '#888888', NULL, NULL,
      '2026-05-25T00:00:00.000Z', '2026-05-25T00:00:00.000Z', '', 'inherit')
  `).run(id, handle, body)
  return id
}

describe('Phase 26 migration — body → primary file + drop body column', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('backfills a primary file row when an agent existed pre-migration', () => {
    const id = seedAgent(db, { handle: 'foo', body: 'hello world' })
    initSchema(db)  // re-entry triggers Phase 26 backfill + DROP COLUMN
    const row = db.prepare(
      `SELECT filename, content, sort_order FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { filename: string; content: string; sort_order: number } | undefined
    expect(row).toBeDefined()
    expect(row!.filename).toBe('foo.md')
    expect(row!.content).toBe('hello world')
    expect(row!.sort_order).toBe(0)
  })

  it('creates a primary file row with empty content when body is empty', () => {
    const id = seedAgent(db, { handle: 'empty', body: '' })
    initSchema(db)
    const row = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { content: string }
    expect(row.content).toBe('')
  })

  it('shifts any pre-existing sibling at sort_order = 0 to sort_order = 1', () => {
    const id = seedAgent(db, { handle: 'sib', body: 'main body' })
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES ('sibling-x', ?, 'reference.md', 'reference content', 0,
        '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    `).run(id)
    initSchema(db)
    const rows = db.prepare(
      `SELECT filename, sort_order FROM agent_files WHERE agent_id = ? ORDER BY sort_order ASC`
    ).all(id) as { filename: string; sort_order: number }[]
    expect(rows).toEqual([
      { filename: 'sib.md',       sort_order: 0 },
      { filename: 'reference.md', sort_order: 1 },
    ])
  })

  it('promotes an existing <handle>.md to sort_order=0 when it sits at a non-zero position', () => {
    const id = seedAgent(db, { handle: 'promo', body: 'body content' })
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES ('preex', ?, 'promo.md', 'pre-existing content', 2,
        '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    `).run(id)
    initSchema(db)
    const row = db.prepare(
      `SELECT id, filename, content, sort_order FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { id: string; filename: string; content: string; sort_order: number }
    expect(row.id).toBe('preex')
    expect(row.filename).toBe('promo.md')
    expect(row.content).toBe('pre-existing content')
  })

  it('migration is idempotent — re-running creates no duplicates', () => {
    const id = seedAgent(db, { handle: 'idem' })
    initSchema(db)
    initSchema(db)
    const rows = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).all(id)
    expect(rows.length).toBe(1)
  })

  it('drops the agents.body column after Phase 26 runs against pre-migration data', () => {
    seedAgent(db)
    initSchema(db)  // Phase 26 backfills and drops body
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]
    expect(cols.map(c => c.name)).not.toContain('body')
  })
})
