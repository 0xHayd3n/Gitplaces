// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

let db: Database.Database | undefined

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

afterEach(() => {
  if (db) db.close()
})

describe('versioned installs query', () => {
  it('returns version refs stripping the version: prefix, ignoring non-version sub_skills', () => {
    if (!db) throw new Error('db not initialized')
    // Seed a repo (only non-nullable columns required)
    db.prepare("INSERT INTO repos (id, owner, name) VALUES ('r1', 'owner', 'repo')").run()

    // One versioned sub-skill and one components sub-skill
    db.prepare("INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active) VALUES ('r1', 'version:v7.3.9', 'repo@v7.3.9.skill.md', '', 'v7.3.9', '', 1)").run()
    db.prepare("INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active) VALUES ('r1', 'components', 'repo.components.skill.md', '', '', '', 1)").run()

    const rows = db.prepare(
      "SELECT skill_type FROM sub_skills WHERE repo_id = ? AND skill_type LIKE 'version:%'"
    ).all('r1') as { skill_type: string }[]
    const refs = rows.map((r: { skill_type: string }) => r.skill_type.replace(/^version:/, ''))

    expect(refs).toEqual(['v7.3.9'])
  })
})

describe('recordFork SQL', () => {
  it('sets repos.forked_at to a non-null timestamp on first click', () => {
    if (!db) throw new Error('db not initialized')
    db.prepare("INSERT INTO repos (id, owner, name) VALUES ('r1', 'alice', 'repo')").run()

    db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=? AND forked_at IS NULL')
      .run(new Date().toISOString(), 'alice', 'repo')

    const row = db.prepare('SELECT forked_at FROM repos WHERE id=?').get('r1') as { forked_at: string | null }
    expect(row.forked_at).not.toBeNull()
    expect(typeof row.forked_at).toBe('string')
  })

  it('preserves the original timestamp on a second click', () => {
    if (!db) throw new Error('db not initialized')
    db.prepare("INSERT INTO repos (id, owner, name, forked_at) VALUES ('r1', 'alice', 'repo', '2026-04-01T00:00:00Z')").run()

    const result = db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=? AND forked_at IS NULL')
      .run(new Date().toISOString(), 'alice', 'repo')

    expect(result.changes).toBe(0)
    const row = db.prepare('SELECT forked_at FROM repos WHERE id=?').get('r1') as { forked_at: string | null }
    expect(row.forked_at).toBe('2026-04-01T00:00:00Z')
  })

  it('UPDATE silently no-ops for an unknown repo', () => {
    if (!db) throw new Error('db not initialized')
    const result = db.prepare('UPDATE repos SET forked_at=? WHERE owner=? AND name=? AND forked_at IS NULL')
      .run(new Date().toISOString(), 'unknown', 'repo')
    expect(result.changes).toBe(0)
  })
})

describe('setArchivedAt SQL', () => {
  it('archived=true sets archived_at to a non-null timestamp', () => {
    if (!db) throw new Error('db not initialized')
    db.prepare("INSERT INTO repos (id, owner, name) VALUES ('r1', 'alice', 'repo')").run()

    db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?')
      .run(new Date().toISOString(), 'alice', 'repo')

    const row = db.prepare('SELECT archived_at FROM repos WHERE id=?').get('r1') as { archived_at: string | null }
    expect(row.archived_at).not.toBeNull()
  })

  it('archived=false clears archived_at to NULL', () => {
    if (!db) throw new Error('db not initialized')
    db.prepare("INSERT INTO repos (id, owner, name, archived_at) VALUES ('r1', 'alice', 'repo', '2026-04-01T00:00:00Z')").run()

    db.prepare('UPDATE repos SET archived_at=? WHERE owner=? AND name=?')
      .run(null, 'alice', 'repo')

    const row = db.prepare('SELECT archived_at FROM repos WHERE id=?').get('r1') as { archived_at: string | null }
    expect(row.archived_at).toBeNull()
  })
})
