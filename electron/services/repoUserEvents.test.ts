// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import { getRepoUserEvents } from './repoUserEvents'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

function seedRepo(opts: {
  id?: string
  owner?: string
  name?: string
  starred_at?: string | null
  archived_at?: string | null
  forked_at?: string | null
} = {}) {
  const id = opts.id ?? 'r1'
  const owner = opts.owner ?? 'alice'
  const name = opts.name ?? 'repo'
  db.prepare('INSERT INTO repos (id, owner, name, starred_at, archived_at, forked_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, opts.starred_at ?? null, opts.archived_at ?? null, opts.forked_at ?? null)
  return { id, owner, name }
}

describe('getRepoUserEvents', () => {
  it('returns [] for a repo not in the DB', () => {
    const events = getRepoUserEvents(db, 'unknown', 'repo')
    expect(events).toEqual([])
  })

  it('returns a star event when starred_at is populated', () => {
    const r = seedRepo({ starred_at: '2026-04-01T00:00:00Z' })
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([{ type: 'star', ts: '2026-04-01T00:00:00Z' }])
  })

  it('returns an archive event when archived_at is populated', () => {
    const r = seedRepo({ archived_at: '2026-04-02T00:00:00Z' })
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([{ type: 'archive', ts: '2026-04-02T00:00:00Z' }])
  })

  it('returns a fork event when forked_at is populated', () => {
    const r = seedRepo({ forked_at: '2026-04-03T00:00:00Z' })
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([{ type: 'fork', ts: '2026-04-03T00:00:00Z' }])
  })

  it('returns a learn event with skillType=master from skills.generated_at', () => {
    const r = seedRepo()
    db.prepare('INSERT INTO skills (repo_id, filename, content, generated_at) VALUES (?, ?, ?, ?)')
      .run(r.id, 'repo.skill.md', '', '2026-04-04T00:00:00Z')
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([
      { type: 'learn', ts: '2026-04-04T00:00:00Z', skillFilename: 'repo.skill.md', skillType: 'master' },
    ])
  })

  it('returns a learn event with skillType=components from sub_skills.generated_at', () => {
    const r = seedRepo()
    db.prepare(`INSERT INTO sub_skills (repo_id, skill_type, filename, content, generated_at) VALUES (?, 'components', ?, ?, ?)`)
      .run(r.id, 'repo.components.skill.md', '', '2026-04-05T00:00:00Z')
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([
      { type: 'learn', ts: '2026-04-05T00:00:00Z', skillFilename: 'repo.components.skill.md', skillType: 'components' },
    ])
  })

  it('returns all populated events sorted desc by ts', () => {
    const r = seedRepo({
      starred_at: '2026-04-01T00:00:00Z',
      archived_at: '2026-04-03T00:00:00Z',
      forked_at: '2026-04-02T00:00:00Z',
    })
    db.prepare('INSERT INTO skills (repo_id, filename, content, generated_at) VALUES (?, ?, ?, ?)')
      .run(r.id, 'repo.skill.md', '', '2026-04-04T00:00:00Z')
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events.map(e => e.ts)).toEqual([
      '2026-04-04T00:00:00Z',
      '2026-04-03T00:00:00Z',
      '2026-04-02T00:00:00Z',
      '2026-04-01T00:00:00Z',
    ])
  })

  it('skips null timestamps', () => {
    const r = seedRepo()
    const events = getRepoUserEvents(db, r.owner, r.name)
    expect(events).toEqual([])
  })
})
