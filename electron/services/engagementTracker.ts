// electron/services/engagementTracker.ts
import type Database from 'better-sqlite3'

export interface EngagementRow {
  id: number
  repo_id: string
  event_type: string
  source: string
  ts: number
}

export function logClick(db: Database.Database, repoId: string, source: string): void {
  db.prepare(
    'INSERT INTO engagement_events (repo_id, event_type, source, ts) VALUES (?, ?, ?, ?)'
  ).run(repoId, 'click', source, Date.now())
}

export function getRecentClicks(
  db: Database.Database,
  sinceMs: number,
  limit = 500,
): EngagementRow[] {
  return db.prepare(
    'SELECT * FROM engagement_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?'
  ).all(sinceMs, limit) as EngagementRow[]
}

export function pruneOldEvents(db: Database.Database, olderThanMs: number): void {
  db.prepare('DELETE FROM engagement_events WHERE ts < ?').run(olderThanMs)
}

export function getRecentlyVisited(db: Database.Database, limit = 16): unknown[] {
  return db.prepare(`
    SELECT r.* FROM repos r
    INNER JOIN (
      SELECT repo_id, MAX(ts) AS last_ts
      FROM engagement_events
      WHERE event_type = 'click'
      GROUP BY repo_id
    ) e ON e.repo_id = r.id
    ORDER BY e.last_ts DESC
    LIMIT ?
  `).all(limit) as unknown[]
}
