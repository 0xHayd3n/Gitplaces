// @vitest-environment node
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import Database from 'better-sqlite3'
import { parseSkill, discoverPlugins, importSkill } from './skillImportService'
import { initSchema } from '../db'
import { createFolder } from './agentsService'

const FIXTURES = path.join(__dirname, '__fixtures__/skills')
const PLUGIN_FIXTURES = path.join(__dirname, '__fixtures__/plugins')

function openDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('parseSkill', () => {
  it('reads a basic SKILL.md and returns name, description, body', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    expect(skill.name).toBe('basic-skill')
    expect(skill.description).toBe('A simple skill for testing import.')
    expect(skill.body).toContain('# Basic Skill')
    expect(skill.files).toEqual([])
    expect(skill.handle).toBe('basic-skill')
  })

  it('enumerates sibling .md files alphabetically, excluding ignore patterns and including scripts', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const filenames = skill.files.map(f => f.filename)
    expect(filenames).toContain('notes.md')
    expect(filenames).toContain('scripts/run.sh')
    expect(filenames).not.toContain('.DS_Store')
    expect(filenames).not.toContain('SKILL.md')
    // Alphabetical order
    expect(filenames).toEqual([...filenames].sort())
  })

  it('accepts a SKILL.md file path directly and uses its parent directory', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic', 'SKILL.md'))
    expect(skill.name).toBe('basic-skill')
  })

  it('throws when SKILL.md is missing', async () => {
    await expect(parseSkill(path.join(FIXTURES, 'does-not-exist'))).rejects.toThrow(/SKILL\.md|does not exist/i)
  })
})

describe('discoverPlugins', () => {
  it('finds plugins with skills/ subdirectories', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const names = plugins.map(p => p.name).sort()
    expect(names).toContain('cool-plugin')
    expect(names).toContain('no-package')
    expect(names).not.toContain('not-a-plugin')
  })

  it('reads version from package.json', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cool = plugins.find(p => p.name === 'cool-plugin')
    expect(cool?.version).toBe('1.2.3')
  })

  it('falls back to directory name when package.json is absent and version is null', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const noPkg = plugins.find(p => p.name === 'no-package')
    expect(noPkg).toBeDefined()
    expect(noPkg?.version).toBeNull()
  })

  it("lists each plugin's skills with name and fileCount", async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cool = plugins.find(p => p.name === 'cool-plugin')!
    expect(cool.skills.map(s => s.name).sort()).toEqual(['bar', 'foo'])
    expect(cool.skills[0].fileCount).toBeGreaterThanOrEqual(1)
  })

  it('returns empty when the root does not exist', async () => {
    const plugins = await discoverPlugins(['/path/that/does/not/exist'])
    expect(plugins).toEqual([])
  })
})

describe('importSkill', () => {
  it('creates a new agent with files when handle is unused', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    expect(result.conflictResolved).toBe('created')
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.handle).toBe('with-siblings')
    expect(agent.body).toContain('# Main')
    expect(agent.description).toBe('A skill that has sibling files.')
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    expect(files.length).toBeGreaterThanOrEqual(2) // notes.md + scripts/run.sh
  })

  it('overwrites an existing agent when onConflict=overwrite', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    const first = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, { ...skill, body: 'CHANGED BODY' }, { folderId: folder.id, onConflict: 'overwrite' })
    expect(second.conflictResolved).toBe('overwritten')
    expect(second.agentId).toBe(first.agentId)
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(first.agentId) as any
    expect(agent.body).toBe('CHANGED BODY')
  })

  it('skips when onConflict=skip and agent exists', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, { ...skill, body: 'CHANGED' }, { folderId: folder.id, onConflict: 'skip' })
    expect(second.conflictResolved).toBe('skipped')
  })

  it('renames with -2 suffix when onConflict=rename and handle is taken', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    expect(second.conflictResolved).toBe('renamed')
    const renamed = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(second.agentId) as any
    expect(renamed.handle).toBe('basic-skill-2')
  })
})
