import type Database from 'better-sqlite3'

export type RegenFn = (repoId: string) => Promise<{ ok: boolean; error?: string }>

const KEY = 'anatomyBackfillDone'

/**
 * Regenerate every installed master skill that is not yet anatomy-sourced.
 * Replace-on-success-only: regen (applySkillRegen) replaces the row only when
 * it succeeds, so a failure leaves the existing legacy row intact. The done
 * flag is set only when every legacy row regenerated successfully, so a partial
 * run retries on the next launch.
 */
export async function runAnatomyBackfill(db: Database.Database, regen: RegenFn): Promise<void> {
  const done = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined
  if (done?.value === 'true') return

  const legacy = db.prepare(`
    SELECT repo_id FROM skills
    WHERE active = 1 AND (anatomy_source IS NULL OR anatomy_source = '')
  `).all() as Array<{ repo_id: string }>

  let allOk = true
  for (const { repo_id } of legacy) {
    try {
      const r = await regen(repo_id)
      if (!r.ok) { allOk = false; console.error(`[anatomy-backfill] ${repo_id}: ${r.error ?? 'regen failed'}`) }
    } catch (err) {
      allOk = false
      console.error(`[anatomy-backfill] ${repo_id} threw:`, err)
    }
  }

  if (allOk) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'true')`).run(KEY)
  }
}
