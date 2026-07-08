import Database from 'better-sqlite3'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { slugifyName, dedupeHandle } from '../src/utils/agentSlug'
import { hashHandleToColor } from '../src/utils/colorHarmony'
import { migrateRepoIdHostPrefix } from './db-helpers'

/**
 * Runs an idempotent column migration (`ALTER TABLE … ADD/DROP COLUMN`).
 *
 * SQLite has no `IF NOT EXISTS` for columns, so re-running these on an
 * already-migrated database throws `duplicate column name` (add) or
 * `no such column` (drop). Those are expected on subsequent launches and are
 * ignored. Any *other* error — a typo in the SQL, an unknown table, a bad
 * default — indicates a real bug, so it is rethrown instead of being silently
 * swallowed (the previous `catch {}` hid these entirely).
 */
function migrateColumn(db: Database.Database, sql: string): void {
  try {
    db.exec(sql)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/duplicate column name|no such column/i.test(msg)) return
    throw err
  }
}

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

    CREATE TABLE IF NOT EXISTS repo_security_cache (
      owner      TEXT NOT NULL,
      name       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );

    -- Caches the network-derived intermediates from getRepoStats:
    --   { daysSinceCommit, contributors }
    -- (from /contributors; pushed_at on the repos row supplies daysSinceCommit).
    -- 6h TTL — see STATS_CACHE_TTL_MS in services/repoStats.ts.
    CREATE TABLE IF NOT EXISTS repo_stats_cache (
      owner      TEXT NOT NULL,
      name       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );

    -- Caches /stats/commit_activity payload. Separate table because momentum
    -- is now lazily fetched (only when the Momentum section is expanded), so
    -- it has a different fetch lifecycle than the rest of the stats bundle.
    CREATE TABLE IF NOT EXISTS repo_momentum_cache (
      owner      TEXT NOT NULL,
      name       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );

    -- Caches /releases?per_page=100 payload. 1h TTL — releases publish
    -- infrequently and stale-by-an-hour is acceptable for the Activities tab.
    CREATE TABLE IF NOT EXISTS repo_releases_cache (
      owner      TEXT NOT NULL,
      name       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );

    CREATE TABLE IF NOT EXISTS agent_folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color_start TEXT,
      color_end   TEXT,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      folder_id   TEXT REFERENCES agent_folders(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_folder  ON agents(folder_id);
    CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);

    -- ETag cache for conditional GitHub REST requests (If-None-Match).
    -- Rows are keyed by full URL since the same URL may be hit from multiple
    -- code paths. A 304 response from GitHub does NOT count against the
    -- primary rate limit, so this is the cheapest way to keep data fresh.
    CREATE TABLE IF NOT EXISTS http_etag_cache (
      url        TEXT PRIMARY KEY,
      etag       TEXT NOT NULL,
      body       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS repos_owner_name ON repos (owner, name);
    CREATE INDEX IF NOT EXISTS repos_saved_at         ON repos(saved_at);

    CREATE TABLE IF NOT EXISTS last_commits (
      repo_id        TEXT    NOT NULL REFERENCES repos(id),
      tree_sha       TEXT    NOT NULL,
      path           TEXT    NOT NULL,
      message        TEXT    NOT NULL,
      author_login   TEXT,
      author_avatar  TEXT,
      committed_at   TEXT    NOT NULL,
      commit_sha     TEXT    NOT NULL,
      PRIMARY KEY (repo_id, tree_sha, path)
    );

    CREATE TABLE IF NOT EXISTS compare_diffs (
      repo_id     TEXT    NOT NULL REFERENCES repos(id),
      base_ref    TEXT    NOT NULL,
      head_ref    TEXT    NOT NULL,
      files_json  TEXT    NOT NULL,
      fetched_at  INTEGER NOT NULL,
      PRIMARY KEY (repo_id, base_ref, head_ref)
    );

    CREATE INDEX IF NOT EXISTS last_commits_by_tree ON last_commits (repo_id, tree_sha);
  `)

  // Phase 3 migrations — idempotent via migrateColumn (SQLite has no ALTER TABLE ... IF NOT EXISTS)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN discovered_at TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN discover_query TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN watchers INTEGER`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN size INTEGER`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN open_issues INTEGER`)

  // Phase 7 migration
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN starred_at TEXT`)

  // Phase 9 migration
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN default_branch TEXT DEFAULT 'main'`)

  // Phase 10 migration — avatar colour extraction
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN avatar_url   TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN banner_color TEXT`) // JSON: {"h":220,"s":0.6,"l":0.18}

  // Phase 11 migration — verified org badge (NULL = unset/needs fetch; 0 = not verified; 1 = verified)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN owner_is_verified INTEGER`)
  migrateColumn(db, `ALTER TABLE profile_cache ADD COLUMN is_verified INTEGER`)

  // Phase 12 migration — translation cache
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN translated_description TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN translated_description_lang TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN translated_readme TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN translated_readme_lang TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN detected_language TEXT`)

  // Phase 13 migration — pushed_at (last code push, more meaningful than updated_at)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN pushed_at TEXT`)

  // Phase 14 migration — Storybook detection cache
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN storybook_url TEXT`)

  // Phase 15 migration — repo verification system
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN verification_score    INTEGER DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN verification_tier     TEXT    DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN verification_signals  TEXT    DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN verification_checked_at INTEGER DEFAULT NULL`)

  // Phase 16 migration — nested repo type system
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN type_bucket TEXT`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN type_sub    TEXT`)

  // Phase 17 migration — skill generation tier tracking
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN tier INTEGER DEFAULT 1`)

  // Library MCP tools picker — subset of enabled MCP tools per skill
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN enabled_tools TEXT`)

  // Phase 18 migration — OG image preview cache
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN og_image_url TEXT DEFAULT NULL`)

  // Phase 19 migration — repo creation date for Rising view badges
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN created_at TEXT`)

  // Phase 22 migration — recently-unstarred tracking (powers the Unstarred filter)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN unstarred_at TEXT`)

  // Phase 23 migration — call-reduction caches:
  //   fetched_at         = epoch ms when /repos/{o}/{n} last refreshed (TTL skip in github:getRepo)
  //   starred_checked_at = epoch ms when /user/starred/{o}/{n} last verified (TTL skip in github:isStarred)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN fetched_at INTEGER`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN starred_checked_at INTEGER`)

  // Phase 24 — Skill parity Phase 1: description + origin tracking + agent_files
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN origin_plugin TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN origin_path TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN origin_version TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN origin_imported_at TEXT`)

  db.exec(`CREATE TABLE IF NOT EXISTS agent_files (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (agent_id, filename),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_files_agent ON agent_files(agent_id)`)

  // Phase 25 — Skill parity Phase 2: tools/model + subagent/slash-command surfaces
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN tools TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'inherit'`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN is_slash_command INTEGER NOT NULL DEFAULT 0`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN argument_hint TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN synced_subagent_at TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN synced_slash_command_at TEXT`)

  // Phase 27 — Multi-provider agent support (see docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'anthropic'`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN model_endpoint_id TEXT`)

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

  // Repo notes (user's private per-repo notes, synced to gitplaces-skills)
  db.exec(`CREATE TABLE IF NOT EXISTS repo_notes (
    repo_id      TEXT PRIMARY KEY REFERENCES repos(id),
    notes        TEXT NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL DEFAULT 0,
    sync_status  TEXT NOT NULL DEFAULT 'pending',
    synced_at    INTEGER,
    github_sha   TEXT
  )`)

  // Skill GitHub sync columns
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN github_sha TEXT`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN synced_at INTEGER`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN sync_status TEXT`)
  migrateColumn(db, `ALTER TABLE sub_skills ADD COLUMN github_sha TEXT`)
  migrateColumn(db, `ALTER TABLE sub_skills ADD COLUMN synced_at INTEGER`)
  migrateColumn(db, `ALTER TABLE sub_skills ADD COLUMN sync_status TEXT`)

  // Anatomy engine columns (Phase 1) — raw .anatomy is stored in skills.content;
  // github_sha (added above) doubles as the anatomy commit pin.
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_memory      TEXT`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_commit      TEXT`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_fingerprint TEXT`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_source      TEXT`)
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_brief       TEXT`)

  // Phase 2 — rule-verification summary (JSON: { ok, errors[], warnings[], rules[] })
  migrateColumn(db, `ALTER TABLE skills ADD COLUMN anatomy_verify TEXT`)

  // Phase 23 migration — update notifications
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN is_forked         INTEGER DEFAULT 0`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN update_available  INTEGER DEFAULT 0`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN update_checked_at INTEGER DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN upstream_version  TEXT    DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN stored_version    TEXT    DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN archived_at       TEXT    DEFAULT NULL`)
  migrateColumn(db, `ALTER TABLE repos ADD COLUMN forked_at         TEXT    DEFAULT NULL`)

  // Agents polish — folder emoji
  migrateColumn(db, `ALTER TABLE agent_folders ADD COLUMN emoji TEXT`)

  // Agents redesign — new columns on existing agents table.
  // Note: the UNIQUE constraint on `handle` is added in a later migration
  // step after backfill writes valid values into existing rows.
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN handle       TEXT NOT NULL DEFAULT ''`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN color_start  TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN color_end    TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN emoji        TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN pinned       INTEGER NOT NULL DEFAULT 0`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN pinned_at    TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN last_used_at TEXT`)
  migrateColumn(db, `ALTER TABLE agents ADD COLUMN presets_json TEXT NOT NULL DEFAULT '[]'`)

  // Agents redesign — edit-history snapshots table (writes wired up in Phase C)
  db.exec(`CREATE TABLE IF NOT EXISTS agent_revisions (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    body         TEXT NOT NULL,
    presets_json TEXT NOT NULL,
    summary      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )`)

  // Agents redesign — backfill pass for rows that pre-existed the redesign.
  // Idempotent: only touches rows where handle = ''. Body column may have
  // been dropped by Phase 26 on a previous init — in that case nothing here
  // needs to run (post-Phase-26 agents always have a primary file row, not a
  // body column).
  {
    const needsBackfill = (() => {
      try {
        return db
          .prepare(`SELECT id, name, body FROM agents WHERE handle = ''`)
          .all() as { id: string; name: string; body: string }[]
      } catch {
        return []  // body column already dropped — no pre-redesign rows to backfill
      }
    })()

    if (needsBackfill.length > 0) {
      // Existing taken handles (across the whole table — not just the needs-backfill subset)
      const taken = new Set<string>(
        (db.prepare(`SELECT handle FROM agents WHERE handle <> ''`).all() as { handle: string }[])
          .map(r => r.handle),
      )

      const updateHandle = db.prepare(
        `UPDATE agents SET handle = ?, color_start = ?, color_end = NULL WHERE id = ?`,
      )
      const insertRevision = db.prepare(
        `INSERT INTO agent_revisions (id, agent_id, body, presets_json, summary, kind, created_at)
         VALUES (?, ?, ?, '[]', ?, 'create', ?)`,
      )

      const txn = db.transaction(() => {
        const nowIso = new Date().toISOString()
        for (const row of needsBackfill) {
          const slug = slugifyName(row.name)
          const handle = dedupeHandle(slug, Array.from(taken))
          taken.add(handle)
          const colorStart = hashHandleToColor(handle)
          updateHandle.run(handle, colorStart, row.id)
          insertRevision.run(randomUUID(), row.id, row.body, 'Initial agent', nowIso)
        }
      })
      txn()
    }
  }

  // UNIQUE index added AFTER backfill so duplicates can't violate it mid-migration.
  // Partial index excludes empty-string handles so transient pre-backfill rows
  // (and test fixtures simulating pre-redesign state) can coexist without
  // tripping the constraint before backfill runs.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_handle ON agents(handle) WHERE handle <> ''`)
  } catch (err) {
    // Expected only if pre-backfill duplicate handles still exist; log so the
    // (rare) case where the uniqueness guarantee is missing is observable.
    console.warn('[db] could not create unique handle index (duplicate handles?):', err)
  }

  // Phase 26 — Body-as-file: backfill a primary agent_files row per agent.
  // Placed AFTER the handle-backfill block above so every agent has a valid
  // handle to name its primary file with. The agents.body column is intentionally
  // kept for the duration of this branch; Task 9 drops it once every consumer
  // has switched to reading the primary file. Writers in the meantime dual-write
  // to keep the column and the primary row in sync. Idempotent on re-run: agents
  // that already have a <handle>.md file are skipped (and promoted to
  // sort_order=0 if needed).
  const agentsForPhase26 = (() => {
    try {
      return db.prepare(
        `SELECT id, handle, body, created_at, updated_at FROM agents`
      ).all() as Array<{
        id: string; handle: string; body: string; created_at: string; updated_at: string;
      }>
    } catch {
      // body column already dropped by a prior Phase 26 run — nothing to backfill.
      return []
    }
  })()
  for (const a of agentsForPhase26) {
    const existing = db.prepare(
      `SELECT id, sort_order FROM agent_files WHERE agent_id = ? AND filename = ?`
    ).get(a.id, `${a.handle}.md`) as { id: string; sort_order: number } | undefined
    if (existing) {
      if (existing.sort_order !== 0) {
        db.prepare(`UPDATE agent_files SET sort_order = 1 WHERE agent_id = ? AND sort_order = 0`).run(a.id)
        db.prepare(`UPDATE agent_files SET sort_order = 0 WHERE id = ?`).run(existing.id)
      }
      continue
    }
    db.prepare(`UPDATE agent_files SET sort_order = 1 WHERE agent_id = ? AND sort_order = 0`).run(a.id)
    try {
      db.prepare(`
        INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(`pf-${a.id}`, a.id, `${a.handle}.md`, a.body ?? '', a.created_at, a.updated_at)
    } catch (err) {
      console.warn(`[phase 26] skip backfill for agent ${a.id}:`, err)
    }
  }
  // Phase 26 (cont.) — drop agents.body once every agent has its primary file row.
  // Idempotent across re-runs (try/catch ignores "no such column" on second pass).
  migrateColumn(db, `ALTER TABLE agents DROP COLUMN body`)

  // Agents backup sync — per-file mirroring to the user's gitplaces-skills repo.
  // Tracked per-file (not per-agent) so adding/editing one file doesn't re-push
  // every file in the agent.
  migrateColumn(db, `ALTER TABLE agent_files ADD COLUMN backup_github_sha   TEXT`)
  migrateColumn(db, `ALTER TABLE agent_files ADD COLUMN backup_synced_at    INTEGER`)
  migrateColumn(db, `ALTER TABLE agent_files ADD COLUMN backup_sync_status  TEXT`)

  // Phase 28 — multi-host: tag repo-scoped rows with their host of origin.
  // Existing rows backfill to 'gh:api.github.com' via the DEFAULT clause.
  // See docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md
  migrateColumn(db, `ALTER TABLE repos                ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)
  migrateColumn(db, `ALTER TABLE profile_cache        ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)
  migrateColumn(db, `ALTER TABLE repo_security_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)
  migrateColumn(db, `ALTER TABLE repo_stats_cache     ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)
  migrateColumn(db, `ALTER TABLE repo_momentum_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)
  migrateColumn(db, `ALTER TABLE repo_releases_cache  ADD COLUMN host_id TEXT NOT NULL DEFAULT 'gh:api.github.com'`)

  // Phase 29 — host-prefix non-GitHub `repos.id` values so cross-host
  // collisions on the single-column PK become impossible. Public github.com
  // keeps the bare numeric id (preserves existing rows). See
  // db-helpers.migrateRepoIdHostPrefix for the full rationale and FK cascade.
  migrateRepoIdHostPrefix(db)

  // Post-migration indexes (reference columns added via ALTER TABLE)
  db.exec(`
    CREATE INDEX IF NOT EXISTS repos_starred_at      ON repos(starred_at);
    CREATE INDEX IF NOT EXISTS repos_unstarred_at    ON repos(unstarred_at);
    CREATE INDEX IF NOT EXISTS repos_type_bucket     ON repos(type_bucket);
    CREATE INDEX IF NOT EXISTS idx_engagement_ts     ON engagement_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_engagement_repo   ON engagement_events(repo_id);
    CREATE INDEX IF NOT EXISTS repos_update_available ON repos(update_available);
    CREATE INDEX IF NOT EXISTS idx_agents_pinned    ON agents(pinned, pinned_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agents_last_used ON agents(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_revisions_agent  ON agent_revisions(agent_id, created_at DESC);
  `)
}

let _db: Database.Database | null = null

export function getDb(userData: string): Database.Database {
  if (!_db) {
    _db = new Database(path.join(userData, 'gitplaces.db'))
    initSchema(_db)
  }
  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}
