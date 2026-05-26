// electron/db-helpers.ts
// Shared DB utilities used by both main.ts and IPC handlers.
import type Database from 'better-sqlite3'
import type { LastCommitInfo, CompareFile } from './github'

/**
 * Cascade-update the repo primary key from a synthetic "owner/name" ID to the
 * real numeric GitHub ID.  Must be called INSIDE a transaction so all updates
 * are atomic.  Uses deferred FK checks because child rows must temporarily
 * reference the new id before the parent row is updated (or vice-versa).
 */
export function cascadeRepoId(db: Database.Database, owner: string, name: string, newId: string): void {
  const existing = db.prepare('SELECT id FROM repos WHERE owner = ? AND name = ?')
    .get(owner, name) as { id: string } | undefined
  if (!existing || existing.id === newId) return          // nothing to fix

  const oldId = existing.id
  db.pragma('defer_foreign_keys = ON')

  // If the target numeric id already belongs to a different row, merge FK refs and delete it
  const target = db.prepare('SELECT id FROM repos WHERE id = ?').get(newId) as { id: string } | undefined
  if (target) {
    // Move FK refs from the stale (owner/name) row onto the target row, then delete stale row
    db.prepare('UPDATE collection_repos SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
    db.prepare('UPDATE skills SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
    db.prepare('UPDATE sub_skills SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
    db.prepare('DELETE FROM repos WHERE id = ?').run(oldId)
  } else {
    // Target id is free — just rename
    db.prepare('UPDATE repos SET id = ? WHERE id = ?').run(newId, oldId)
    db.prepare('UPDATE collection_repos SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
    db.prepare('UPDATE skills SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
    db.prepare('UPDATE sub_skills SET repo_id = ? WHERE repo_id = ?').run(newId, oldId)
  }
}

export function readLastCommitCache(
  db: Database.Database,
  repoId: string,
  treeSha: string,
  path: string,
): LastCommitInfo | null {
  const row = db.prepare(`
    SELECT message, author_login, author_avatar, committed_at, commit_sha
    FROM last_commits
    WHERE repo_id = ? AND tree_sha = ? AND path = ?
  `).get(repoId, treeSha, path) as LastCommitInfo | undefined
  return row ?? null
}

export function writeLastCommitCache(
  db: Database.Database,
  repoId: string,
  treeSha: string,
  path: string,
  info: LastCommitInfo,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO last_commits
      (repo_id, tree_sha, path, message, author_login, author_avatar, committed_at, commit_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(repoId, treeSha, path, info.message, info.author_login, info.author_avatar, info.committed_at, info.commit_sha)
}

const COMPARE_TTL_MS = 60 * 60 * 1000  // 1 hour

export function readCompareCache(
  db: Database.Database,
  repoId: string,
  baseRef: string,
  headRef: string,
): CompareFile[] | null {
  const row = db.prepare(`
    SELECT files_json, fetched_at FROM compare_diffs
    WHERE repo_id = ? AND base_ref = ? AND head_ref = ?
  `).get(repoId, baseRef, headRef) as { files_json: string; fetched_at: number } | undefined
  if (!row) return null
  if (Date.now() - row.fetched_at >= COMPARE_TTL_MS) {
    db.prepare(`DELETE FROM compare_diffs WHERE repo_id = ? AND base_ref = ? AND head_ref = ?`).run(repoId, baseRef, headRef)
    return null
  }
  return JSON.parse(row.files_json) as CompareFile[]
}

export function writeCompareCache(
  db: Database.Database,
  repoId: string,
  baseRef: string,
  headRef: string,
  files: CompareFile[],
): void {
  db.prepare(`
    INSERT OR REPLACE INTO compare_diffs (repo_id, base_ref, head_ref, files_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(repoId, baseRef, headRef, JSON.stringify(files), Date.now())
}

