import type Database from 'better-sqlite3'
import type { RepoUserEvent } from '../../src/types/repoUserEvents'

interface RepoRow {
  id: string
  starred_at: string | null
  archived_at: string | null
  forked_at: string | null
}
interface SkillRow { filename: string; generated_at: string | null }
interface SubSkillRow { filename: string; generated_at: string | null }

export function getRepoUserEvents(
  db: Database.Database,
  owner: string,
  name: string,
): RepoUserEvent[] {
  const repo = db.prepare(
    'SELECT id, starred_at, archived_at, forked_at FROM repos WHERE owner=? AND name=?'
  ).get(owner, name) as RepoRow | undefined
  if (!repo) return []

  const events: RepoUserEvent[] = []
  if (repo.starred_at)  events.push({ type: 'star',    ts: repo.starred_at })
  if (repo.archived_at) events.push({ type: 'archive', ts: repo.archived_at })
  if (repo.forked_at)   events.push({ type: 'fork',    ts: repo.forked_at })

  const master = db.prepare(
    'SELECT filename, generated_at FROM skills WHERE repo_id=? AND generated_at IS NOT NULL'
  ).get(repo.id) as SkillRow | undefined
  if (master?.generated_at) {
    events.push({ type: 'learn', ts: master.generated_at, skillFilename: master.filename, skillType: 'master' })
  }

  const components = db.prepare(
    `SELECT filename, generated_at FROM sub_skills WHERE repo_id=? AND skill_type='components' AND generated_at IS NOT NULL`
  ).get(repo.id) as SubSkillRow | undefined
  if (components?.generated_at) {
    events.push({ type: 'learn', ts: components.generated_at, skillFilename: components.filename, skillType: 'components' })
  }

  return events.sort((a, b) => b.ts.localeCompare(a.ts))
}
