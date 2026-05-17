import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import { runAnatomyBackfill } from './backfill'

function seed() {
  const db = new Database(':memory:')
  initSchema(db)
  db.prepare(`INSERT INTO repos (id,owner,name,topics,default_branch) VALUES ('r1','o','n1','[]','main')`).run()
  db.prepare(`INSERT INTO repos (id,owner,name,topics,default_branch) VALUES ('r2','o','n2','[]','main')`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active) VALUES ('r1','n1.skill.md','LEGACY1','v','t',1)`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active,anatomy_source) VALUES ('r2','.anatomy','[identity]','v','t',1,'generated')`).run()
  return db
}

describe('runAnatomyBackfill', () => {
  it('regenerates only legacy (non-anatomy) rows; sets the done flag; skips anatomy rows', async () => {
    const db = seed()
    const regen = vi.fn(async (_repoId: string) => ({ ok: true } as const))
    await runAnatomyBackfill(db, regen)
    expect(regen).toHaveBeenCalledTimes(1)
    expect(regen).toHaveBeenCalledWith('r1')
    expect((db.prepare("SELECT value FROM settings WHERE key='anatomyBackfillDone'").get() as { value: string }).value).toBe('true')
  })

  it('does not destroy a row when regen fails, and does not set done on partial failure', async () => {
    const db = seed()
    const regen = vi.fn(async () => ({ ok: false, error: 'clone failed' } as const))
    await runAnatomyBackfill(db, regen)
    expect((db.prepare("SELECT content FROM skills WHERE repo_id='r1'").get() as { content: string }).content).toBe('LEGACY1')
    const done = db.prepare("SELECT value FROM settings WHERE key='anatomyBackfillDone'").get() as { value: string } | undefined
    expect(done?.value).not.toBe('true')
  })

  it('is a no-op when already done', async () => {
    const db = seed()
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyBackfillDone','true')").run()
    const regen = vi.fn(async () => ({ ok: true } as const))
    await runAnatomyBackfill(db, regen)
    expect(regen).not.toHaveBeenCalled()
  })
})
