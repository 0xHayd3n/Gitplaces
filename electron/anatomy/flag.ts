// electron/anatomy/flag.ts
import type Database from 'better-sqlite3'

export const ANATOMY_FLAG_KEY = 'anatomyEngineEnabled'

export function isAnatomyEngineEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ANATOMY_FLAG_KEY) as
    { value: string } | undefined
  return row?.value === 'true'
}
