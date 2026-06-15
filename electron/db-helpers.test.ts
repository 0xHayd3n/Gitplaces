// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'
import { cascadeRepoId, repoRowId } from './db-helpers'

describe('repoRowId', () => {
  it('public github.com returns the bare native id (preserves existing PK format)', () => {
    expect(repoRowId('gh:api.github.com', 42)).toBe('42')
    expect(repoRowId('gh:api.github.com', '42')).toBe('42')
  })

  it('GitLab.com prefixes the host id', () => {
    expect(repoRowId('gl:gitlab.com', 42)).toBe('gl:gitlab.com:42')
  })

  it('Codeberg (Gitea) prefixes the host id', () => {
    expect(repoRowId('gt:codeberg.org', 7)).toBe('gt:codeberg.org:7')
  })

  it('GHE prefixes — distinct id space from public github.com', () => {
    expect(repoRowId('gh:github.acme.com/api/v3', 42)).toBe('gh:github.acme.com/api/v3:42')
  })

  it('coerces numeric native ids to strings', () => {
    const out = repoRowId('gl:gitlab.com', 100_000)
    expect(typeof out).toBe('string')
    expect(out).toBe('gl:gitlab.com:100000')
  })
})

describe('cascadeRepoId', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initSchema(db)
  })

  afterEach(() => { db.close() })

  // Inserts the stale (owner='alice', name='foo') row at `id` plus one child row
  // in every FK-child table that references repos(id). Used by both branches
  // so regressions in any of the six tables are caught.
  function seedStaleRowWithChildren(id: string) {
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES (?, 'alice', 'foo', '[]')`).run(id)
    db.prepare(`INSERT INTO collections (id, name) VALUES ('c1', 'C1')`).run()
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(id)
    db.prepare(`INSERT INTO skills (repo_id, filename, content) VALUES (?, 'skill.md', 'x')`).run(id)
    db.prepare(`INSERT INTO sub_skills (repo_id, skill_type, filename, content) VALUES (?, 'readme', 'r.md', 'r')`).run(id)
    db.prepare(`INSERT INTO last_commits (repo_id, tree_sha, path, message, committed_at, commit_sha) VALUES (?, 'tsha', 'p', 'm', '2024', 'csha')`).run(id)
    db.prepare(`INSERT INTO compare_diffs (repo_id, base_ref, head_ref, files_json, fetched_at) VALUES (?, 'main', 'feat', '[]', 0)`).run(id)
    db.prepare(`INSERT INTO repo_notes (repo_id, notes) VALUES (?, 'note')`).run(id)
  }

  function childRepoIds(): Record<string, string | undefined> {
    return {
      collection_repos: (db.prepare(`SELECT repo_id FROM collection_repos`).get() as { repo_id: string } | undefined)?.repo_id,
      skills:           (db.prepare(`SELECT repo_id FROM skills`).get() as { repo_id: string } | undefined)?.repo_id,
      sub_skills:       (db.prepare(`SELECT repo_id FROM sub_skills`).get() as { repo_id: string } | undefined)?.repo_id,
      last_commits:     (db.prepare(`SELECT repo_id FROM last_commits`).get() as { repo_id: string } | undefined)?.repo_id,
      compare_diffs:    (db.prepare(`SELECT repo_id FROM compare_diffs`).get() as { repo_id: string } | undefined)?.repo_id,
      repo_notes:       (db.prepare(`SELECT repo_id FROM repo_notes`).get() as { repo_id: string } | undefined)?.repo_id,
    }
  }

  it('rename-only path: cascades repo_id across every FK child table in lockstep', () => {
    seedStaleRowWithChildren('alice/foo')

    db.transaction(() => cascadeRepoId(db, 'alice', 'foo', '42'))()

    expect(db.prepare(`SELECT id FROM repos WHERE owner='alice' AND name='foo'`).get()).toEqual({ id: '42' })
    expect(db.prepare(`SELECT id FROM repos WHERE id='alice/foo'`).get()).toBeUndefined()

    expect(childRepoIds()).toEqual({
      collection_repos: '42',
      skills:           '42',
      sub_skills:       '42',
      last_commits:     '42',
      compare_diffs:    '42',
      repo_notes:       '42',
    })
  })

  it('merge-target path: moves every FK child from stale row to target, then deletes stale', () => {
    seedStaleRowWithChildren('alice/foo')
    // Pre-existing target row at id='42' — different owner/name avoids the
    // UNIQUE(owner, name) collision the merge branch can't resolve.
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('42', 'someone', 'else', '[]')`).run()

    db.transaction(() => cascadeRepoId(db, 'alice', 'foo', '42'))()

    expect(db.prepare(`SELECT id FROM repos WHERE id='alice/foo'`).get()).toBeUndefined()
    expect(db.prepare(`SELECT id FROM repos WHERE id='42'`).get()).toEqual({ id: '42' })

    expect(childRepoIds()).toEqual({
      collection_repos: '42',
      skills:           '42',
      sub_skills:       '42',
      last_commits:     '42',
      compare_diffs:    '42',
      repo_notes:       '42',
    })
  })
})
