// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { logClick, getRecentClicks, getRecentlyVisited, pruneOldEvents } from './engagementTracker'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE engagement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      stars INTEGER
    );
  `)
  return db
}

function insertRepo(db: Database.Database, id: string, owner = 'o', name = id) {
  db.prepare('INSERT INTO repos (id, owner, name) VALUES (?, ?, ?)').run(id, owner, name)
}

function insertClick(db: Database.Database, repoId: string, ts: number) {
  db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
    .run(repoId, 'click', 'discover', ts)
}

describe('engagementTracker', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('logClick writes a row with current timestamp', () => {
    const before = Date.now()
    logClick(db, 'repo-1', 'recommended')
    const after = Date.now()
    const row = db.prepare('SELECT * FROM engagement_events').get() as any
    expect(row.repo_id).toBe('repo-1')
    expect(row.event_type).toBe('click')
    expect(row.source).toBe('recommended')
    expect(row.ts).toBeGreaterThanOrEqual(before)
    expect(row.ts).toBeLessThanOrEqual(after)
  })

  it('getRecentClicks returns rows newer than sinceMs, sorted by ts desc', () => {
    const now = Date.now()
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('old', 'click', 'recommended', now - 100_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('mid', 'click', 'recommended', now - 50_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('new', 'click', 'recommended', now - 10_000)
    const rows = getRecentClicks(db, now - 75_000)
    expect(rows.map(r => r.repo_id)).toEqual(['new', 'mid'])
  })

  it('getRecentClicks respects limit', () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
        .run(`r${i}`, 'click', 'recommended', now - i * 1000)
    }
    expect(getRecentClicks(db, 0, 3).length).toBe(3)
  })

  it('getRecentlyVisited returns repos joined with their most recent click, newest first', () => {
    const now = Date.now()
    insertRepo(db, 'r1')
    insertRepo(db, 'r2')
    insertRepo(db, 'r3')
    insertClick(db, 'r1', now - 30_000)
    insertClick(db, 'r2', now - 10_000)
    insertClick(db, 'r3', now - 50_000)
    const rows = getRecentlyVisited(db) as { id: string }[]
    expect(rows.map(r => r.id)).toEqual(['r2', 'r1', 'r3'])
  })

  it('getRecentlyVisited dedupes by repo_id using the most recent click', () => {
    const now = Date.now()
    insertRepo(db, 'r1')
    insertRepo(db, 'r2')
    insertClick(db, 'r1', now - 60_000)
    insertClick(db, 'r2', now - 30_000)
    insertClick(db, 'r1', now - 5_000) // most recent — should bump r1 to top
    const rows = getRecentlyVisited(db) as { id: string }[]
    expect(rows.map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('getRecentlyVisited skips clicks for repos missing from the repos table', () => {
    const now = Date.now()
    insertRepo(db, 'r1')
    insertClick(db, 'r1', now - 10_000)
    insertClick(db, 'ghost', now - 5_000) // no row in repos
    const rows = getRecentlyVisited(db) as { id: string }[]
    expect(rows.map(r => r.id)).toEqual(['r1'])
  })

  it('getRecentlyVisited respects limit', () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      insertRepo(db, `r${i}`)
      insertClick(db, `r${i}`, now - i * 1000)
    }
    expect((getRecentlyVisited(db, 3) as unknown[]).length).toBe(3)
  })

  it('getRecentlyVisited returns an empty array when no clicks exist', () => {
    insertRepo(db, 'r1')
    expect(getRecentlyVisited(db)).toEqual([])
  })

  it('pruneOldEvents removes rows older than threshold', () => {
    const now = Date.now()
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('old', 'click', 'recommended', now - 200_000)
    db.prepare('INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)')
      .run('new', 'click', 'recommended', now - 10_000)
    pruneOldEvents(db, now - 100_000)
    const remaining = db.prepare('SELECT repo_id FROM engagement_events').all() as { repo_id: string }[]
    expect(remaining.map(r => r.repo_id)).toEqual(['new'])
  })
})
