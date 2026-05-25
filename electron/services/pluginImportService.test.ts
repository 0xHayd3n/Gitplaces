// @vitest-environment node
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  parseSkill, discoverPlugins, importSkill,
  parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint,
  parseSubagent, COLOR_MAP, parseSlashCommand,
  readPluginManifest,
  importTarget,
} from './pluginImportService'
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
    const primary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(result.agentId) as { content: string }
    expect(primary.content).toContain('# Main')
    expect(agent.description).toBe('A skill that has sibling files.')
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    // 1 primary (body) + 2 siblings (notes.md, scripts/run.sh)
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it('overwrites an existing agent when onConflict=overwrite', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    const first = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, { ...skill, body: 'CHANGED BODY' }, { folderId: folder.id, onConflict: 'overwrite' })
    expect(second.conflictResolved).toBe('overwritten')
    expect(second.agentId).toBe(first.agentId)
    const primary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(first.agentId) as { content: string }
    expect(primary.content).toBe('CHANGED BODY')
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

describe('parseModelFrontmatter', () => {
  it('returns inherit when undefined/null/non-string', () => {
    expect(parseModelFrontmatter(undefined)).toBe('inherit')
    expect(parseModelFrontmatter(null)).toBe('inherit')
    expect(parseModelFrontmatter(42)).toBe('inherit')
  })
  it('passes through short forms', () => {
    expect(parseModelFrontmatter('sonnet')).toBe('sonnet')
    expect(parseModelFrontmatter('opus')).toBe('opus')
    expect(parseModelFrontmatter('haiku')).toBe('haiku')
    expect(parseModelFrontmatter('inherit')).toBe('inherit')
  })
  it('maps CC full-form model IDs to short forms', () => {
    expect(parseModelFrontmatter('claude-sonnet-4-6')).toBe('sonnet')
    expect(parseModelFrontmatter('claude-opus-4-7')).toBe('opus')
    expect(parseModelFrontmatter('claude-haiku-4-5-20251001')).toBe('haiku')
  })
  it('falls back to inherit on unknown model strings', () => {
    expect(parseModelFrontmatter('gpt-4')).toBe('inherit')
    expect(parseModelFrontmatter('claude-3-opus')).toBe('inherit')
  })
})

describe('parseToolsFrontmatter', () => {
  it('returns null for missing values', () => {
    expect(parseToolsFrontmatter(undefined)).toBeNull()
    expect(parseToolsFrontmatter(null)).toBeNull()
  })
  it('parses comma-separated strings', () => {
    expect(parseToolsFrontmatter('Read, Edit, Bash')).toEqual(['Read', 'Edit', 'Bash'])
  })
  it('trims whitespace around items', () => {
    expect(parseToolsFrontmatter('  Read ,Edit  , Bash')).toEqual(['Read', 'Edit', 'Bash'])
  })
  it('accepts YAML arrays directly', () => {
    expect(parseToolsFrontmatter(['Read', 'Edit'])).toEqual(['Read', 'Edit'])
  })
  it('returns [] for empty string', () => {
    expect(parseToolsFrontmatter('')).toEqual([])
  })
  it('filters non-string entries from arrays', () => {
    expect(parseToolsFrontmatter(['Read', 42, null, 'Edit'])).toEqual(['Read', 'Edit'])
  })
  it('returns null for unexpected types', () => {
    expect(parseToolsFrontmatter(42)).toBeNull()
    expect(parseToolsFrontmatter({ x: 1 })).toBeNull()
  })
})

describe('parseArgumentHint', () => {
  it('returns null for missing', () => {
    expect(parseArgumentHint(undefined)).toBeNull()
    expect(parseArgumentHint(null)).toBeNull()
  })
  it('returns the string when present', () => {
    expect(parseArgumentHint('[project-name]')).toBe('[project-name]')
  })
  it('reconstructs bracket notation from YAML-parsed arrays', () => {
    // `argument-hint: [project-name]` in YAML parses as ['project-name']
    expect(parseArgumentHint(['project-name'])).toBe('[project-name]')
    expect(parseArgumentHint(['arg-1', 'arg-2'])).toBe('[arg-1, arg-2]')
  })
  it('returns null for unexpected non-string non-array types', () => {
    expect(parseArgumentHint(42)).toBeNull()
    expect(parseArgumentHint({ x: 1 })).toBeNull()
  })
})

describe('parseSkill — Phase 2 fields', () => {
  it('picks up model from frontmatter', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-model'))
    expect(skill.model).toBe('sonnet')
  })

  it('picks up comma-separated tools', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    expect(skill.tools).toEqual(['Read', 'Edit', 'Bash'])
  })

  it('picks up YAML-array tools', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools-array'))
    expect(skill.tools).toEqual(['Read', 'Edit'])
  })

  it('picks up argument-hint', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-argument-hint'))
    expect(skill.argumentHint).toBe('[project-name]')
  })

  it('defaults to inherit/null when the new fields are absent', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    expect(skill.model).toBe('inherit')
    expect(skill.tools).toBeNull()
    expect(skill.argumentHint).toBeNull()
  })
})

describe('importSkill — Phase 2 fields', () => {
  it('populates the new columns on the agent row', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.model).toBe('inherit')   // with-tools.md has no model: line
    expect(agent.tools).toBe('["Read","Edit","Bash"]')
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
  })

  it('does NOT auto-flip is_subagent even when source had tools:', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT is_subagent FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
  })

  it('overwrite branch updates model/tools/argumentHint', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill1 = await parseSkill(path.join(FIXTURES, 'basic'))
    const first = importSkill(db, skill1, { folderId: folder.id, onConflict: 'rename' })
    const skill2 = await parseSkill(path.join(FIXTURES, 'with-tools'))
    const second = importSkill(db, { ...skill2, handle: skill1.handle }, { folderId: folder.id, onConflict: 'overwrite' })
    expect(second.agentId).toBe(first.agentId)
    const agent = db.prepare(`SELECT tools FROM agents WHERE id = ?`).get(first.agentId) as any
    expect(agent.tools).toBe('["Read","Edit","Bash"]')
  })
})

const SUBAGENT_FIXTURES = path.join(__dirname, '__fixtures__/subagents')

describe('parseSubagent', () => {
  it('parses full frontmatter into a ParsedSubagent', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'full.md'))
    expect(sub.kind).toBe('subagent')
    expect(sub.name).toBe('code-architect')
    expect(sub.handle).toBe('code-architect')
    expect(sub.description).toBe('Designs feature architectures by analyzing existing codebase patterns.')
    expect(sub.tools).toEqual(['Glob', 'Grep', 'Read'])
    expect(sub.model).toBe('sonnet')
    expect(sub.color).toBe('green')
    expect(sub.body).toContain('senior software architect')
    expect(sub.files).toEqual([])
    expect(sub.argumentHint).toBeNull()
  })

  it('falls back to filename stem when name field is missing', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'no-frontmatter.md'))
    expect(sub.name).toBe('no-frontmatter')
    expect(sub.handle).toBe('no-frontmatter')
    expect(sub.description).toBe('')
    expect(sub.color).toBeNull()
    expect(sub.model).toBe('inherit')
    expect(sub.tools).toBeNull()
  })

  it('uses defaults when only name is given', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'minimal.md'))
    expect(sub.name).toBe('minimal-agent')
    expect(sub.description).toBe('')
    expect(sub.color).toBeNull()
  })

  it('throws when the file does not exist', async () => {
    await expect(parseSubagent(path.join(SUBAGENT_FIXTURES, 'nope.md'))).rejects.toThrow()
  })
})

describe('COLOR_MAP', () => {
  it('maps the canonical Anthropic palette to hex', () => {
    expect(COLOR_MAP.red).toBe('#ef4444')
    expect(COLOR_MAP.orange).toBe('#f97316')
    expect(COLOR_MAP.yellow).toBe('#eab308')
    expect(COLOR_MAP.green).toBe('#22c55e')
    expect(COLOR_MAP.cyan).toBe('#06b6d4')
    expect(COLOR_MAP.blue).toBe('#3b82f6')
    expect(COLOR_MAP.purple).toBe('#a855f7')
    expect(COLOR_MAP.pink).toBe('#ec4899')
  })
})

const COMMAND_FIXTURES = path.join(__dirname, '__fixtures__/commands')

describe('parseSlashCommand', () => {
  it('parses full frontmatter into a ParsedSlashCommand', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'full.md'))
    expect(cmd.kind).toBe('slashCommand')
    expect(cmd.name).toBe('full')                 // from filename stem
    expect(cmd.handle).toBe('full')
    expect(cmd.description).toBe('Guided feature development with codebase understanding.')
    expect(cmd.argumentHint).toBe('Optional feature description')
    expect(cmd.body).toContain('Feature Development')
    expect(cmd.model).toBe('inherit')
    expect(cmd.tools).toBeNull()
    expect(cmd.files).toEqual([])
  })

  it('falls back to filename stem and empty description when no frontmatter', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'no-frontmatter.md'))
    expect(cmd.name).toBe('no-frontmatter')
    expect(cmd.description).toBe('')
    expect(cmd.argumentHint).toBeNull()
  })

  it('preserves bracket form of argument-hint when YAML parses it as an array', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'argument-hint-array.md'))
    expect(cmd.argumentHint).toBe('[project-name]')
  })

  it('throws when the file does not exist', async () => {
    await expect(parseSlashCommand(path.join(COMMAND_FIXTURES, 'nope.md'))).rejects.toThrow()
  })
})

describe('readPluginManifest', () => {
  it('prefers .claude-plugin/plugin.json over package.json when both exist', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'both-manifests'))
    expect(manifest.name).toBe('from-claude')
    expect(manifest.version).toBe('2.0.0')
  })

  it('reads .claude-plugin/plugin.json when only that exists', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'with-claude-manifest'))
    expect(manifest.name).toBe('claude-manifest-plugin')
    expect(manifest.version).toBe('0.9.0')
  })

  it('falls back to package.json when .claude-plugin/plugin.json is absent', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'cool-plugin'))
    expect(manifest.name).toBe('cool-plugin')
    expect(manifest.version).toBe('1.2.3')
  })

  it('falls back to dirname with null version when neither manifest exists', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'no-package'))
    expect(manifest.name).toBe('no-package')
    expect(manifest.version).toBeNull()
  })
})

describe('discoverPlugins — mixed kinds', () => {
  it('returns subagents and slashCommands alongside skills for a mixed plugin', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')
    expect(mixed).toBeDefined()
    expect(mixed!.skills.map(s => s.name).sort()).toEqual(['some-skill'])
    expect(mixed!.subagents.map(s => s.name).sort()).toEqual(['agent-one', 'agent-two'])
    expect(mixed!.slashCommands.map(c => c.name).sort()).toEqual(['cmd-one'])
  })

  it('includes plugins that have only agents/', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const agentsOnly = plugins.find(p => p.name === 'agents-only')
    expect(agentsOnly).toBeDefined()
    expect(agentsOnly!.skills).toEqual([])
    expect(agentsOnly!.subagents.map(s => s.name)).toEqual(['lonely'])
    expect(agentsOnly!.slashCommands).toEqual([])
  })

  it('includes plugins that have only commands/', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cmdOnly = plugins.find(p => p.name === 'commands-only')
    expect(cmdOnly).toBeDefined()
    expect(cmdOnly!.slashCommands.map(c => c.name)).toEqual(['solo'])
  })

  it('subagent discovery surface carries description and color', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')!
    const a1 = mixed.subagents.find(s => s.name === 'agent-one')!
    expect(a1.description).toBe('First agent.')
    expect(a1.color).toBe('blue')
    const a2 = mixed.subagents.find(s => s.name === 'agent-two')!
    expect(a2.color).toBeNull()
  })

  it('slash command discovery carries description and argumentHint', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')!
    const c = mixed.slashCommands.find(s => s.name === 'cmd-one')!
    expect(c.description).toBe('A command.')
    expect(c.argumentHint).toBe('[target]')
  })

  it('preserves existing skills-only plugins with empty subagent/command arrays', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cool = plugins.find(p => p.name === 'cool-plugin')
    expect(cool).toBeDefined()
    expect(cool!.skills.length).toBeGreaterThan(0)
    expect(cool!.subagents).toEqual([])
    expect(cool!.slashCommands).toEqual([])
  })
})

describe('importTarget — subagent', () => {
  it('creates an agent with is_subagent=1 and no sibling files', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'full.md'))
    const result = importTarget(db, sub, { folderId: folder.id, onConflict: 'rename' })
    expect(result.conflictResolved).toBe('created')
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.handle).toBe('code-architect')
    expect(agent.is_subagent).toBe(1)
    expect(agent.is_slash_command).toBe(0)
    expect(agent.model).toBe('sonnet')
    expect(JSON.parse(agent.tools)).toEqual(['Glob', 'Grep', 'Read'])
    // Only the primary file (body) — no siblings
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ? AND sort_order != 0`).all(result.agentId) as any[]
    expect(files).toEqual([])
  })

  it('maps known color names to hex in color_start', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'full.md'))
    const result = importTarget(db, sub, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT color_start FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.color_start).toBe('#22c55e')   // green
  })

  it('falls back to hash-based color when frontmatter color is missing', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'minimal.md'))
    const result = importTarget(db, sub, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT color_start FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.color_start).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('importTarget — slashCommand', () => {
  it('creates an agent with is_slash_command=1', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'full.md'))
    const result = importTarget(db, cmd, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(1)
    expect(agent.argument_hint).toBe('Optional feature description')
  })
})

describe('importTarget — skill (regression)', () => {
  it('preserves existing skill import behavior with sibling files', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const result = importTarget(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
    // primary + 2 siblings (notes.md + scripts/run.sh)
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    expect(files.length).toBeGreaterThanOrEqual(3)
  })
})
