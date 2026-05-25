// @vitest-environment node
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { parseSkill, discoverPlugins } from './skillImportService'

const FIXTURES = path.join(__dirname, '__fixtures__/skills')
const PLUGIN_FIXTURES = path.join(__dirname, '__fixtures__/plugins')

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
