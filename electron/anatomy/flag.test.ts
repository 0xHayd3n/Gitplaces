import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'
import { isAnatomyEngineEnabled } from './flag'

describe('isAnatomyEngineEnabled', () => {
  it('defaults to false when unset', () => {
    const db = getDb(mkdtempSync(join(tmpdir(), 'git-suite-db-')))
    expect(isAnatomyEngineEnabled(db)).toBe(false)
  })

  it('is true only when the setting is exactly "true"', () => {
    const db = getDb(mkdtempSync(join(tmpdir(), 'git-suite-db-')))
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','true')").run()
    expect(isAnatomyEngineEnabled(db)).toBe(true)
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','1')").run()
    expect(isAnatomyEngineEnabled(db)).toBe(false)
  })
})
