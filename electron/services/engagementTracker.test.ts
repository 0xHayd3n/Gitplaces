// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { logClick, getRecentClicks, pruneOldEvents } from './engagementTracker'

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
  `)
  return db
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
