// @vitest-environment node
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { parseSkill } from './skillImportService'

const FIXTURES = path.join(__dirname, '__fixtures__/skills')

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
