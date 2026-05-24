// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('./mcp-launcher-core.cjs') as {
  getCatalog: (db: Database.Database) => Array<{ handle: string; name: string; description: string; presets: { slug: string; name: string }[] }>
  getAgentBody: (db: Database.Database, handle: string) => string | null
  getAgentBodyWithPreset: (db: Database.Database, handle: string, presetSlug: string) => string | null
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

function seedAgent(
  db: Database.Database,
  args: { id: string; name: string; handle: string; body: string; presets?: object[] },
): void {
  const presets = JSON.stringify(args.presets ?? [])
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, presets_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, '#000000', NULL, NULL, ?, 't', 't')
  `).run(args.id, args.name, args.handle, args.body, presets)
}

describe('mcp-launcher-core — getCatalog', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns one entry per agent', () => {
    seedAgent(db, { id: '1', name: 'Reviewer', handle: 'reviewer', body: '# A\nLook at code' })
    seedAgent(db, { id: '2', name: 'Therapist', handle: 'therapist', body: 'Listen carefully' })
    const catalog = core.getCatalog(db)
    expect(catalog.length).toBe(2)
    const handles = catalog.map(c => c.handle).sort()
    expect(handles).toEqual(['reviewer', 'therapist'])
  })

  it('catalog entries include name, handle, description, and presets list', () => {
    seedAgent(db, {
      id: '1', name: 'Reviewer', handle: 'reviewer', body: '# A\nLook at code',
      presets: [{ id: 'p1', name: 'Security', slug: 'security', values: {} }],
    })
    const [entry] = core.getCatalog(db)
    expect(entry.handle).toBe('reviewer')
    expect(entry.name).toBe('Reviewer')
    expect(entry.description).toContain('Look at code')
    expect(entry.presets).toEqual([{ slug: 'security', name: 'Security' }])
  })

  it('returns an empty array when there are no agents', () => {
    expect(core.getCatalog(db)).toEqual([])
  })
})

describe('mcp-launcher-core — getAgentBody', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns the raw body for a known handle', () => {
    seedAgent(db, { id: '1', name: 'R', handle: 'reviewer', body: 'Look at {{focus}}' })
    expect(core.getAgentBody(db, 'reviewer')).toBe('Look at {{focus}}')
  })

  it('does NOT substitute variables (raw body)', () => {
    seedAgent(db, { id: '1', name: 'R', handle: 'reviewer', body: 'See {{topic}} now' })
    expect(core.getAgentBody(db, 'reviewer')).toContain('{{topic}}')
  })

  it('returns null for an unknown handle', () => {
    expect(core.getAgentBody(db, 'no-such-handle')).toBeNull()
  })
})

describe('mcp-launcher-core — getAgentBodyWithPreset', () => {
  let db: Database.Database
  beforeEach(() => {
    db = freshDb()
    seedAgent(db, {
      id: '1', name: 'R', handle: 'reviewer', body: 'Look at {{focus}} for {{language}}',
      presets: [
        { id: 'p1', name: 'Security', slug: 'security', values: { focus: 'auth', language: 'TS' } },
      ],
    })
  })

  it('returns the body with the preset\'s values substituted', () => {
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'security'))
      .toBe('Look at auth for TS')
  })

  it('leaves missing variables as literal {{var}}', () => {
    db.prepare(`UPDATE agents SET presets_json = ? WHERE id = '1'`).run(
      JSON.stringify([{ id: 'p1', name: 'P', slug: 'partial', values: { focus: 'X' } }]),
    )
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'partial'))
      .toBe('Look at X for {{language}}')
  })

  it('returns null for an unknown handle', () => {
    expect(core.getAgentBodyWithPreset(db, 'nope', 'security')).toBeNull()
  })

  it('returns null for an unknown preset slug on a known handle', () => {
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'no-such-slug')).toBeNull()
  })
})
