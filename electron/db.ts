import Database from 'better-sqlite3'
import path from 'path'

export function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')        // 64 MB
  db.pragma('mmap_size = 268435456')       // 256 MB
  db.pragma('temp_store = MEMORY')

  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id          TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      language    TEXT,
      topics      TEXT,
      stars       INTEGER,
      forks       INTEGER,
      license     TEXT,
      homepage    TEXT,
      updated_at     TEXT,
      saved_at       TEXT,
      type           TEXT,
      banner_svg     TEXT,
      discovered_at  TEXT,
      discover_query TEXT,
      watchers       INTEGER,
      size           INTEGER,
      open_issues    INTEGER
    );

    CREATE TABLE IF NOT EXISTS skills (
      repo_id            TEXT PRIMARY KEY REFERENCES repos(id),
      filename           TEXT NOT NULL,
      content            TEXT NOT NULL,
      version            TEXT,
      generated_at       TEXT,
      active             INTEGER DEFAULT 1,
      enabled_components TEXT
    );

    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      owner       TEXT DEFAULT 'user',
      active      INTEGER DEFAULT 1,
      created_at  TEXT,
      color_start TEXT,
      color_end   TEXT
    );

    CREATE TABLE IF NOT EXISTS collection_repos (
      collection_id TEXT REFERENCES collections(id),
      repo_id       TEXT REFERENCES repos(id),
      PRIMARY KEY (collection_id, repo_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sub_skills (
      repo_id      TEXT NOT NULL REFERENCES repos(id),
      skill_type   TEXT NOT NULL,
      filename     TEXT NOT NULL,
      content      TEXT NOT NULL,
      version      TEXT,
      generated_at TEXT,
      active       INTEGER DEFAULT 1,
      PRIMARY KEY (repo_id, skill_type)
    );

    CREATE TABLE IF NOT EXISTS topic_cache (
      topic      TEXT PRIMARY KEY,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key  TEXT PRIMARY KEY,
      results    TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS profile_cache (
      username   TEXT PRIMARY KEY,
      data       TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS compare_cache (
      cache_key  TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS create_sessions (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      template_id    TEXT NOT NULL,
      tool_type      TEXT NOT NULL,
      repo_ids       TEXT NOT NULL DEFAULT '[]',
      chat_history   TEXT NOT NULL DEFAULT '[]',
      local_path     TEXT,
      publish_status TEXT NOT NULL DEFAULT 'draft',
      github_repo_url TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS repos_owner_name ON repos (owner, name);
    CREATE INDEX IF NOT EXISTS repos_saved_at         ON repos(saved_at);
  `)

  // Phase 3 migrations — idempotent via try/catch (SQLite has no ALTER TABLE ... IF NOT EXISTS)
  try { db.exec(`ALTER TABLE repos ADD COLUMN discovered_at TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN discover_query TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN watchers INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN size INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN open_issues INTEGER`) } catch {}

  // Phase 7 migration
  try { db.exec(`ALTER TABLE repos ADD COLUMN starred_at TEXT`) } catch {}

  // Phase 9 migration
  try { db.exec(`ALTER TABLE repos ADD COLUMN default_branch TEXT DEFAULT 'main'`) } catch {}

  // Phase 10 migration — avatar colour extraction
  try { db.exec(`ALTER TABLE repos ADD COLUMN avatar_url   TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN banner_color TEXT`) } catch {} // JSON: {"h":220,"s":0.6,"l":0.18}

  // Phase 11 migration — verified org badge (NULL = unset/needs fetch; 0 = not verified; 1 = verified)
  try { db.exec(`ALTER TABLE repos ADD COLUMN owner_is_verified INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE profile_cache ADD COLUMN is_verified INTEGER`) } catch {}

  // Phase 12 migration — translation cache
  try { db.exec(`ALTER TABLE repos ADD COLUMN translated_description TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN translated_description_lang TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN translated_readme TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN translated_readme_lang TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN detected_language TEXT`) } catch {}

  // Phase 13 migration — pushed_at (last code push, more meaningful than updated_at)
  try { db.exec(`ALTER TABLE repos ADD COLUMN pushed_at TEXT`) } catch {}

  // Phase 14 migration — Storybook detection cache
  try { db.exec(`ALTER TABLE repos ADD COLUMN storybook_url TEXT`) } catch {}

  // Phase 15 migration — repo verification system
  try { db.exec(`ALTER TABLE repos ADD COLUMN verification_score    INTEGER DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN verification_tier     TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN verification_signals  TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN verification_checked_at INTEGER DEFAULT NULL`) } catch {}

  // Phase 16 migration — nested repo type system
  try { db.exec(`ALTER TABLE repos ADD COLUMN type_bucket TEXT`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN type_sub    TEXT`) } catch {}

  // Phase 17 migration — skill generation tier tracking
  try { db.exec(`ALTER TABLE skills ADD COLUMN tier INTEGER DEFAULT 1`) } catch {}

  // Library MCP tools picker — subset of enabled MCP tools per skill
  try { db.exec(`ALTER TABLE skills ADD COLUMN enabled_tools TEXT`) } catch {}

  // Phase 18 migration — OG image preview cache
  try { db.exec(`ALTER TABLE repos ADD COLUMN og_image_url TEXT DEFAULT NULL`) } catch {}

  // Phase 19 migration — repo creation date for Rising view badges
  try { db.exec(`ALTER TABLE repos ADD COLUMN created_at TEXT`) } catch {}

  // Phase 22 migration — recently-unstarred tracking (powers the Unstarred filter)
  try { db.exec(`ALTER TABLE repos ADD COLUMN unstarred_at TEXT`) } catch {}

  // Phase 20 – AI chat history
  db.exec(`CREATE TABLE IF NOT EXISTS ai_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // Phase 21 – engagement tracking
  db.exec(`CREATE TABLE IF NOT EXISTS engagement_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id     TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    source      TEXT NOT NULL,
    ts          INTEGER NOT NULL
  )`)

  // Skill GitHub sync columns
  try { db.exec(`ALTER TABLE skills ADD COLUMN github_sha TEXT`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN synced_at INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN sync_status TEXT`) } catch {}
  try { db.exec(`ALTER TABLE sub_skills ADD COLUMN github_sha TEXT`) } catch {}
  try { db.exec(`ALTER TABLE sub_skills ADD COLUMN synced_at INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE sub_skills ADD COLUMN sync_status TEXT`) } catch {}

  // Phase 23 migration — update notifications
  try { db.exec(`ALTER TABLE repos ADD COLUMN is_forked         INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_available  INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN update_checked_at INTEGER DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN upstream_version  TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN stored_version    TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN archived_at       TEXT    DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE repos ADD COLUMN forked_at         TEXT    DEFAULT NULL`) } catch {}

  // Post-migration indexes (reference columns added via ALTER TABLE)
  db.exec(`
    CREATE INDEX IF NOT EXISTS repos_starred_at      ON repos(starred_at);
    CREATE INDEX IF NOT EXISTS repos_unstarred_at    ON repos(unstarred_at);
    CREATE INDEX IF NOT EXISTS repos_type_bucket     ON repos(type_bucket);
    CREATE INDEX IF NOT EXISTS idx_engagement_ts     ON engagement_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_engagement_repo   ON engagement_events(repo_id);
    CREATE INDEX IF NOT EXISTS repos_update_available ON repos(update_available);
  `)
}

let _db: Database.Database | null = null

export function getDb(userData: string): Database.Database {
  if (!_db) {
    _db = new Database(path.join(userData, 'gitsuite.db'))
    initSchema(_db)
  }
  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}
