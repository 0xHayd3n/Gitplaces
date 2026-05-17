// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

afterEach(() => { db.close() })

function insertRepo(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults = {
    id: '1', owner: 'alice', name: 'foo', description: null, language: 'Python',
    topics: '[]', stars: 100, forks: 10, license: null, homepage: null,
    updated_at: '2024-01-01', saved_at: null, type: null, banner_svg: null,
    discovered_at: null, discover_query: null, watchers: null, size: null, open_issues: null,
  }
  const row = { ...defaults, ...overrides }
  db.prepare(`
    INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                       homepage, updated_at, saved_at, type, banner_svg, discovered_at,
                       discover_query, watchers, size, open_issues)
    VALUES (@id, @owner, @name, @description, @language, @topics, @stars, @forks, @license,
            @homepage, @updated_at, @saved_at, @type, @banner_svg, @discovered_at,
            @discover_query, @watchers, @size, @open_issues)
  `).run(row)
}

describe('searchRepos upsert — saved_at preservation', () => {
  it('preserves saved_at when the same repo appears in a discover search', () => {
    // Simulate a previously-saved repo
    insertRepo({ saved_at: '2024-06-01T00:00:00Z' })

    // Simulate what searchRepos upsert does
    db.prepare(`
      INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                         homepage, updated_at, saved_at, type, banner_svg,
                         discovered_at, discover_query, watchers, size, open_issues)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(owner, name) DO UPDATE SET
        id             = excluded.id,
        description    = excluded.description,
        language       = excluded.language,
        topics         = excluded.topics,
        stars          = excluded.stars,
        forks          = excluded.forks,
        updated_at     = excluded.updated_at,
        discovered_at  = excluded.discovered_at,
        discover_query = excluded.discover_query,
        watchers       = excluded.watchers,
        size           = excluded.size,
        open_issues    = excluded.open_issues,
        saved_at       = repos.saved_at
    `).run('1', 'alice', 'foo', 'desc', 'Python', '[]', 200, 20, null, null,
           '2024-07-01', '2024-07-01T00:00:00Z', 'stars:>1000', 5, 1024, 3)

    const row = db.prepare('SELECT saved_at, stars FROM repos WHERE owner = ? AND name = ?').get('alice', 'foo') as Record<string, unknown>
    expect(row.saved_at).toBe('2024-06-01T00:00:00Z')  // preserved
    expect(row.stars).toBe(200)  // updated
  })
})

describe('getRepo upsert — preserves discovered_at and saved_at', () => {
  it('does not overwrite discovered_at or saved_at when re-fetching a repo', () => {
    insertRepo({ discovered_at: '2024-05-01T00:00:00Z', discover_query: 'stars:>1000', saved_at: '2024-06-01T00:00:00Z' })

    // Simulate what getRepo upsert does
    db.prepare(`
      INSERT INTO repos (id, owner, name, description, language, topics, stars, forks, license,
                         homepage, updated_at, saved_at, type, banner_svg,
                         discovered_at, discover_query, watchers, size, open_issues)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
      ON CONFLICT(owner, name) DO UPDATE SET
        id             = excluded.id,
        description    = excluded.description,
        language       = excluded.language,
        topics         = excluded.topics,
        stars          = excluded.stars,
        forks          = excluded.forks,
        updated_at     = excluded.updated_at,
        watchers       = excluded.watchers,
        size           = excluded.size,
        open_issues    = excluded.open_issues,
        saved_at       = repos.saved_at,
        discovered_at  = repos.discovered_at,
        discover_query = repos.discover_query
    `).run('1', 'alice', 'foo', 'updated desc', 'Python', '[]', 300, 30, null, null, '2024-08-01', 10, 2048, 5)

    const row = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').get('alice', 'foo') as Record<string, unknown>
    expect(row.saved_at).toBe('2024-06-01T00:00:00Z')       // preserved
    expect(row.discovered_at).toBe('2024-05-01T00:00:00Z')  // preserved
    expect(row.discover_query).toBe('stars:>1000')           // preserved
    expect(row.stars).toBe(300)                              // updated
  })
})

describe('saveRepo UPDATE', () => {
  it('sets saved_at on an existing row', () => {
    insertRepo()
    const ts = '2024-09-01T12:00:00.000Z'
    db.prepare('UPDATE repos SET saved_at = ? WHERE owner = ? AND name = ?').run(ts, 'alice', 'foo')
    const row = db.prepare('SELECT saved_at FROM repos WHERE owner = ? AND name = ?').get('alice', 'foo') as Record<string, unknown>
    expect(row.saved_at).toBe(ts)
  })

  it('no-ops silently when row does not exist', () => {
    const info = db.prepare('UPDATE repos SET saved_at = ? WHERE owner = ? AND name = ?').run('2024-01-01', 'ghost', 'missing')
    expect(info.changes).toBe(0)
  })
})

describe('discover cache key', () => {
  it('stores and retrieves a cache timestamp from settings', () => {
    const key = 'discover:stars:>1000'
    const now = String(Date.now())
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, now)
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string }
    expect(Number(row.value)).toBeCloseTo(Number(now), -3)
  })
})
