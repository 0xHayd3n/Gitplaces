// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'
import { migrateRepoIdHostPrefix } from './db-helpers'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

afterEach(() => { db.close() })

function insertRepo(row: { id: string; host_id: string; owner: string; name: string }) {
  db.prepare(
    `INSERT INTO repos (id, host_id, owner, name, topics) VALUES (?, ?, ?, ?, '[]')`
  ).run(row.id, row.host_id, row.owner, row.name)
}

describe('Phase 29 — host-prefix migration for repos.id', () => {
  it('leaves public-github rows with bare numeric ids untouched', () => {
    insertRepo({ id: '42', host_id: 'gh:api.github.com', owner: 'facebook', name: 'react' })
    migrateRepoIdHostPrefix(db)
    const row = db.prepare(`SELECT id FROM repos WHERE owner = 'facebook'`).get() as { id: string }
    expect(row.id).toBe('42')
  })

  it('prefixes non-GitHub rows with bare numeric ids', () => {
    insertRepo({ id: '7', host_id: 'gl:gitlab.com', owner: 'inkscape', name: 'inkscape' })
    insertRepo({ id: '99', host_id: 'gt:codeberg.org', owner: 'forgejo', name: 'forgejo' })
    migrateRepoIdHostPrefix(db)
    const gl = db.prepare(`SELECT id FROM repos WHERE host_id = 'gl:gitlab.com'`).get() as { id: string }
    const gt = db.prepare(`SELECT id FROM repos WHERE host_id = 'gt:codeberg.org'`).get() as { id: string }
    expect(gl.id).toBe('gl:gitlab.com:7')
    expect(gt.id).toBe('gt:codeberg.org:99')
  })

  it('prefixes GHE rows (non-public-github hostId)', () => {
    insertRepo({ id: '42', host_id: 'gh:github.acme.com/api/v3', owner: 'acme', name: 'tool' })
    migrateRepoIdHostPrefix(db)
    const row = db.prepare(`SELECT id FROM repos WHERE owner = 'acme'`).get() as { id: string }
    expect(row.id).toBe('gh:github.acme.com/api/v3:42')
  })

  it('is idempotent — already-prefixed rows stay unchanged', () => {
    insertRepo({ id: 'gl:gitlab.com:7', host_id: 'gl:gitlab.com', owner: 'inkscape', name: 'inkscape' })
    migrateRepoIdHostPrefix(db)
    const row = db.prepare(`SELECT id FROM repos WHERE owner = 'inkscape'`).get() as { id: string }
    expect(row.id).toBe('gl:gitlab.com:7')
  })

  it('leaves synthetic owner/name rows untouched (cascadeRepoId promotes them on fetch)', () => {
    insertRepo({ id: 'someuser/somerepo', host_id: 'gh:api.github.com', owner: 'someuser', name: 'somerepo' })
    migrateRepoIdHostPrefix(db)
    const row = db.prepare(`SELECT id FROM repos WHERE owner = 'someuser'`).get() as { id: string }
    expect(row.id).toBe('someuser/somerepo')
  })

  it('cascades FK refs in skills, collection_repos, sub_skills, last_commits, compare_diffs, repo_notes', () => {
    insertRepo({ id: '7', host_id: 'gl:gitlab.com', owner: 'inkscape', name: 'inkscape' })

    db.prepare(`INSERT INTO skills (repo_id, filename, content) VALUES ('7', 'SKILL.md', '')`).run()
    db.prepare(`INSERT INTO collections (id, name) VALUES ('c1', 'Mine')`).run()
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', '7')`).run()
    db.prepare(`INSERT INTO sub_skills (repo_id, skill_type, filename, content) VALUES ('7', 'system', 'x.md', '')`).run()
    db.prepare(`INSERT INTO last_commits (repo_id, tree_sha, path, message, committed_at, commit_sha) VALUES ('7', 't', 'p', 'm', '2024-01-01', 'sha')`).run()
    db.prepare(`INSERT INTO compare_diffs (repo_id, base_ref, head_ref, files_json, fetched_at) VALUES ('7', 'main', 'feat', '[]', 0)`).run()
    db.prepare(`INSERT INTO repo_notes (repo_id, notes) VALUES ('7', 'note')`).run()

    migrateRepoIdHostPrefix(db)

    expect((db.prepare(`SELECT repo_id FROM skills`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
    expect((db.prepare(`SELECT repo_id FROM collection_repos`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
    expect((db.prepare(`SELECT repo_id FROM sub_skills`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
    expect((db.prepare(`SELECT repo_id FROM last_commits`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
    expect((db.prepare(`SELECT repo_id FROM compare_diffs`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
    expect((db.prepare(`SELECT repo_id FROM repo_notes`).get() as { repo_id: string }).repo_id).toBe('gl:gitlab.com:7')
  })

  it('does not touch FK refs that point to GitHub rows', () => {
    insertRepo({ id: '42', host_id: 'gh:api.github.com', owner: 'facebook', name: 'react' })
    db.prepare(`INSERT INTO skills (repo_id, filename, content) VALUES ('42', 'SKILL.md', '')`).run()
    migrateRepoIdHostPrefix(db)
    expect((db.prepare(`SELECT repo_id FROM skills`).get() as { repo_id: string }).repo_id).toBe('42')
  })

  it('initSchema runs the migration automatically — idempotent on re-init', () => {
    insertRepo({ id: '7', host_id: 'gl:gitlab.com', owner: 'inkscape', name: 'inkscape' })
    initSchema(db)  // runs migration as part of init
    const after1 = (db.prepare(`SELECT id FROM repos WHERE owner = 'inkscape'`).get() as { id: string }).id
    initSchema(db)  // re-run; must be a no-op
    const after2 = (db.prepare(`SELECT id FROM repos WHERE owner = 'inkscape'`).get() as { id: string }).id
    expect(after1).toBe('gl:gitlab.com:7')
    expect(after2).toBe('gl:gitlab.com:7')
  })
})
