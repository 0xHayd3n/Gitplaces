// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import type { AgentRow } from '../../src/types/agent'
import {
  subagentPath,
  slashCommandPath,
  opencodeSubagentPath,
  checkConflict,
  previewSubagentFile,
  previewSlashCommandFile,
  previewOpenCodeSubagentFile,
  syncAgentToDisk,
  cleanupAgentFiles,
} from './agentFileSyncService'

let tmpDir = ''
let opencodeTmpDir = ''

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sync-'))
  opencodeTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sync-oc-'))
  process.env.CLAUDE_HOME = tmpDir
  process.env.OPENCODE_HOME = opencodeTmpDir
})

afterEach(async () => {
  delete process.env.CLAUDE_HOME
  delete process.env.OPENCODE_HOME
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(opencodeTmpDir, { recursive: true, force: true })
})

// Primary content used in every sync test below — passed explicitly into
// preview/sync calls since Task 3 moved body out of AgentRow's read path.
const BODY = 'Agent body content.'

function baseAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    name: 'My Agent',
    handle: 'my-agent',
    folder_id: null,
    color_start: '#888888',
    color_end: null,
    emoji: null,
    pinned: 0,
    pinned_at: null,
    last_used_at: null,
    presets_json: '[]',
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    description: 'A test agent.',
    origin_plugin: null,
    origin_path: null,
    origin_version: null,
    origin_imported_at: null,
    tools: null,
    model_provider: 'anthropic',
    model_endpoint_id: null,
    model: 'inherit',
    is_subagent: 0,
    is_slash_command: 0,
    argument_hint: null,
    synced_subagent_at: null,
    synced_slash_command_at: null,
    ...overrides,
  }
}

async function fileExists(p: string): Promise<boolean> {
  return fs.stat(p).then(s => s.isFile()).catch(() => false)
}

// ── Path helpers ────────────────────────────────────────────────────

describe('path helpers', () => {
  it('subagentPath returns CLAUDE_HOME/agents/<handle>.md', () => {
    expect(subagentPath('foo')).toBe(path.join(tmpDir, 'agents', 'foo.md'))
  })

  it('slashCommandPath returns CLAUDE_HOME/commands/<handle>.md', () => {
    expect(slashCommandPath('foo')).toBe(path.join(tmpDir, 'commands', 'foo.md'))
  })
})

// ── checkConflict ───────────────────────────────────────────────────

describe('checkConflict', () => {
  it('returns false for both surfaces when nothing exists', async () => {
    const r = await checkConflict('nonexistent')
    expect(r.subagentExists).toBe(false)
    expect(r.slashCommandExists).toBe(false)
  })

  it('detects an existing subagent file', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'agents', 'foo.md'), 'existing')
    const r = await checkConflict('foo')
    expect(r.subagentExists).toBe(true)
    expect(r.slashCommandExists).toBe(false)
  })

  it('detects an existing slash command file', async () => {
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'commands', 'foo.md'), 'existing')
    const r = await checkConflict('foo')
    expect(r.subagentExists).toBe(false)
    expect(r.slashCommandExists).toBe(true)
  })

  it('returns paths in the result', async () => {
    const r = await checkConflict('foo')
    expect(r.subagentPath).toBe(path.join(tmpDir, 'agents', 'foo.md'))
    expect(r.slashCommandPath).toBe(path.join(tmpDir, 'commands', 'foo.md'))
  })
})

// ── previewSubagentFile / previewSlashCommandFile ───────────────────

describe('previewSubagentFile', () => {
  it('writes name, description, and body — omits tools and model when defaults', () => {
    const out = previewSubagentFile(baseAgent(), BODY)
    expect(out).toContain('name: my-agent')
    expect(out).toContain('description: A test agent.')
    expect(out).not.toContain('tools:')
    expect(out).not.toContain('model:')
    expect(out).toContain('Agent body content.')
  })

  it('emits comma-separated tools when array is non-empty', () => {
    const out = previewSubagentFile(baseAgent({ tools: '["Read","Edit","Bash"]' }), BODY)
    // gray-matter may or may not quote — assert via round-trip parse rather than byte match
    const parsed = matter(out)
    expect(parsed.data.tools).toBe('Read, Edit, Bash')
  })

  it('emits empty tools when array is []', () => {
    const out = previewSubagentFile(baseAgent({ tools: '[]' }), BODY)
    const parsed = matter(out)
    // Empty array → empty string after join; YAML emits this as `tools: ''`
    expect(parsed.data.tools).toBe('')
  })

  it('emits the mapped model ID when non-inherit', () => {
    expect(matter(previewSubagentFile(baseAgent({ model: 'sonnet' }), BODY)).data.model).toBe('claude-sonnet-4-6')
    expect(matter(previewSubagentFile(baseAgent({ model: 'opus' }), BODY)).data.model).toBe('claude-opus-4-7')
    expect(matter(previewSubagentFile(baseAgent({ model: 'haiku' }), BODY)).data.model).toBe('claude-haiku-4-5-20251001')
  })

  it('strips the anthropic/ provider prefix when writing Claude Code frontmatter', () => {
    const agent = baseAgent({
      model: 'anthropic/claude-sonnet-4-6',
      model_provider: 'anthropic',
    })
    const out = previewSubagentFile(agent, BODY)
    expect(matter(out).data.model).toBe('claude-sonnet-4-6')
    expect(out).not.toMatch(/anthropic\//)
  })

  it('passes through full Anthropic IDs unchanged', () => {
    const agent = baseAgent({
      model: 'claude-sonnet-4-6',
      model_provider: 'anthropic',
    })
    expect(matter(previewSubagentFile(agent, BODY)).data.model).toBe('claude-sonnet-4-6')
  })

  it('falls back to deriveDescription when description is empty', () => {
    const out = previewSubagentFile(baseAgent({ description: '' }), 'First line.\nSecond line.')
    const parsed = matter(out)
    expect(typeof parsed.data.description).toBe('string')
    expect((parsed.data.description as string).length).toBeGreaterThan(0)
  })

  it('round-trips through gray-matter', () => {
    const agent = baseAgent({
      tools: '["Read","Edit"]',
      model: 'sonnet',
      description: 'Multi\nline\ndesc.',
    })
    const written = previewSubagentFile(agent, BODY)
    const parsed = matter(written)
    expect(parsed.data.name).toBe('my-agent')
    expect(parsed.data.description).toBe('Multi\nline\ndesc.')
    expect(parsed.data.tools).toBe('Read, Edit')
    expect(parsed.data.model).toBe('claude-sonnet-4-6')
    expect(parsed.content.trim()).toBe('Agent body content.')
  })
})

describe('previewSlashCommandFile', () => {
  it('writes description and body — omits argument-hint when null', () => {
    const out = previewSlashCommandFile(baseAgent(), BODY)
    const parsed = matter(out)
    expect(parsed.data.description).toBe('A test agent.')
    expect(parsed.data['argument-hint']).toBeUndefined()
    expect(parsed.content.trim()).toBe('Agent body content.')
  })

  it('emits argument-hint when non-empty', () => {
    const out = previewSlashCommandFile(baseAgent({ argument_hint: '[project-name]' }), BODY)
    const parsed = matter(out)
    expect(parsed.data['argument-hint']).toBe('[project-name]')
  })

  it('does NOT emit name, tools, or model (slash command frontmatter is smaller)', () => {
    const out = previewSlashCommandFile(baseAgent({
      tools: '["Read"]',
      model: 'sonnet',
    }), BODY)
    const parsed = matter(out)
    expect(parsed.data.name).toBeUndefined()
    expect(parsed.data.tools).toBeUndefined()
    expect(parsed.data.model).toBeUndefined()
  })
})

// ── syncAgentToDisk ─────────────────────────────────────────────────

describe('syncAgentToDisk', () => {
  it('writes the subagent file when is_subagent=1 and file does not exist', async () => {
    const agent = baseAgent({ is_subagent: 1 })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'written' })
    const written = await fs.readFile(subagentPath('my-agent'), 'utf-8')
    expect(written).toContain('name: my-agent')
  })

  it('does NOT sync non-Anthropic agents to .claude/agents/', async () => {
    // Even with is_subagent=1, an openai agent must skip the .claude/agents/ write.
    const agent = baseAgent({
      is_subagent: 1,
      model: 'openai/gpt-4o',
      model_provider: 'openai',
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'skipped' })
    // Confirm no file landed on disk.
    const exists = await fs.stat(subagentPath('my-agent')).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })

  it('does NOT sync openai-compatible agents to .claude/agents/', async () => {
    const agent = baseAgent({
      is_subagent: 1,
      model: 'openai-compatible:ollama-local/llama3.1:70b',
      model_provider: 'openai-compatible',
      model_endpoint_id: 'ollama-local',
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'skipped' })
  })

  it('writes the slash command file when is_slash_command=1', async () => {
    const agent = baseAgent({ is_slash_command: 1 })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.slashCommand).toMatchObject({ status: 'written' })
    const written = await fs.readFile(slashCommandPath('my-agent'), 'utf-8')
    expect(written).toContain('description:')
  })

  it('writes BOTH files when both surfaces are enabled', async () => {
    const agent = baseAgent({ is_subagent: 1, is_slash_command: 1 })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(result.slashCommand).toMatchObject({ status: 'written' })
    expect(await fileExists(subagentPath('my-agent'))).toBe(true)
    expect(await fileExists(slashCommandPath('my-agent'))).toBe(true)
  })

  it('returns skipped for surfaces that are off', async () => {
    const result = await syncAgentToDisk(baseAgent(), BODY)
    expect(result.subagent).toMatchObject({ status: 'skipped' })
    expect(result.slashCommand).toMatchObject({ status: 'skipped' })
  })

  it('creates parent directories if missing', async () => {
    const agent = baseAgent({ is_subagent: 1 })
    await syncAgentToDisk(agent, BODY)
    expect(await fileExists(subagentPath('my-agent'))).toBe(true)
  })

  it('returns conflict when file exists, never synced, forceOverwrite=false', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'hand-authored content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: null })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'conflict' })
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toBe('hand-authored content')
  })

  it('overwrites silently when synced_subagent_at is non-null', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'previously synced content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toContain('name: my-agent')
  })

  it('overwrites with forceOverwrite=true even when never synced', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'hand-authored content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: null })
    const result = await syncAgentToDisk(agent, BODY, { forceOverwrite: true })
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toContain('name: my-agent')
  })

  it('deletes the file when is_subagent flips off', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'previously synced')
    const agent = baseAgent({ is_subagent: 0, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('my-agent'))).toBe(false)
  })

  it('treats already-missing file as deleted success when previously synced', async () => {
    const agent = baseAgent({ is_subagent: 0, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'deleted' })
  })

  it('skips when surface off and never synced', async () => {
    const agent = baseAgent({ is_subagent: 0, synced_subagent_at: null })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'skipped' })
  })

  it('renames: deletes old file and writes new when handle changed', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('old-handle'), 'previously synced')
    const agent = baseAgent({ handle: 'new-handle', is_subagent: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    await syncAgentToDisk(agent, BODY, { oldHandle: 'old-handle' })
    expect(await fileExists(subagentPath('old-handle'))).toBe(false)
    expect(await fileExists(subagentPath('new-handle'))).toBe(true)
  })

  it('rename does NOT delete a hand-authored file at the old path when the surface was never synced', async () => {
    // User hand-authored ~/.claude/agents/old-handle.md outside of Git-Suite.
    // Surface has never been synced (syncedAt is null). A rename in Git-Suite
    // must NOT delete that file — we don't own it.
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('old-handle'), 'hand-authored, not ours')
    const agent = baseAgent({
      handle: 'new-handle',
      is_subagent: 0,
      synced_subagent_at: null,
    })
    await syncAgentToDisk(agent, BODY, { oldHandle: 'old-handle' })
    expect(await fileExists(subagentPath('old-handle'))).toBe(true)
    expect(await fs.readFile(subagentPath('old-handle'), 'utf-8')).toBe('hand-authored, not ours')
  })

  it('rename does delete the old file when the surface was previously synced, even if currently disabled', async () => {
    // is_subagent flipped off in the same update that also renames the handle.
    // The previously-synced old-handle file should still be cleaned up because
    // we owned it.
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('old-handle'), 'previously synced by us')
    const agent = baseAgent({
      handle: 'new-handle',
      is_subagent: 0,
      synced_subagent_at: '2026-05-20T00:00:00.000Z',
    })
    const result = await syncAgentToDisk(agent, BODY, { oldHandle: 'old-handle' })
    expect(await fileExists(subagentPath('old-handle'))).toBe(false)
    expect(result.subagent.status).toBe('deleted')
  })

  it('subagent error does not block slash command success', async () => {
    // Create a directory where the subagent file should go — makes write fail with EISDIR
    await fs.mkdir(subagentPath('my-agent'), { recursive: true })
    const agent = baseAgent({ is_subagent: 1, is_slash_command: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'error' })
    expect(result.slashCommand).toMatchObject({ status: 'written' })
  })
})

// ── cleanupAgentFiles ───────────────────────────────────────────────

describe('cleanupAgentFiles', () => {
  it('removes both files when both are requested', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'a')
    await fs.writeFile(slashCommandPath('foo'), 'b')
    const r = await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'deleted' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('foo'))).toBe(false)
    expect(await fileExists(slashCommandPath('foo'))).toBe(false)
  })

  it('only removes requested surfaces', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'a')
    await fs.writeFile(slashCommandPath('foo'), 'b')
    const r = await cleanupAgentFiles('foo', { cleanSubagent: false, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'skipped' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('foo'))).toBe(true)
    expect(await fileExists(slashCommandPath('foo'))).toBe(false)
  })

  it('succeeds when files are already absent', async () => {
    const r = await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'deleted' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
  })

  it('removes ~/.opencode/agents/<handle>.md when cleanSubagent is true', async () => {
    // An opencode-provider agent's subagent file lives at the opencode path.
    // Cleanup must remove it on agent delete — otherwise the file is orphaned.
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('foo'), 'previously synced opencode agent')
    const r = await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: false })
    expect(r.subagent).toMatchObject({ status: 'deleted' })
    expect(await fileExists(opencodeSubagentPath('foo'))).toBe(false)
  })

  it('sweeps BOTH .claude and .opencode subagent paths when cleanSubagent is true', async () => {
    // If an agent flipped provider mid-life, both paths may exist. A delete should
    // sweep both regardless of the agent's current provider.
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'claude')
    await fs.writeFile(opencodeSubagentPath('foo'), 'opencode')
    await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: false })
    expect(await fileExists(subagentPath('foo'))).toBe(false)
    expect(await fileExists(opencodeSubagentPath('foo'))).toBe(false)
  })

  it('does NOT touch the opencode path when cleanSubagent is false', async () => {
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('foo'), 'opencode')
    await cleanupAgentFiles('foo', { cleanSubagent: false, cleanSlashCommand: true })
    expect(await fileExists(opencodeSubagentPath('foo'))).toBe(true)
  })
})

// ── checkConflict — opencode branch ─────────────────────────────────

describe('checkConflict — opencode branch', () => {
  it('detects an existing opencode subagent file when modelProvider is opencode', async () => {
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('foo'), 'existing opencode agent')
    const r = await checkConflict('foo', 'opencode')
    expect(r.subagentExists).toBe(true)
    expect(r.subagentPath).toBe(opencodeSubagentPath('foo'))
  })

  it('does NOT report a conflict on the claude path for an opencode-provider agent', async () => {
    // A hand-authored claude-path file must not block enabling an opencode subagent —
    // they target different surfaces.
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'hand-authored claude')
    const r = await checkConflict('foo', 'opencode')
    expect(r.subagentExists).toBe(false)
    expect(r.subagentPath).toBe(opencodeSubagentPath('foo'))
  })
})

// ── opencode subagent sync ──────────────────────────────────────────

describe('opencodeSubagentPath', () => {
  it('returns OPENCODE_HOME/agents/<handle>.md', () => {
    expect(opencodeSubagentPath('foo')).toBe(path.join(opencodeTmpDir, 'agents', 'foo.md'))
  })
})

describe('previewOpenCodeSubagentFile', () => {
  it('writes name, description, and body — omits tools and model when defaults', () => {
    const out = previewOpenCodeSubagentFile(baseAgent({ model_provider: 'opencode' }), BODY)
    const parsed = matter(out)
    expect(parsed.data.name).toBe('my-agent')
    expect(parsed.data.description).toBe('A test agent.')
    expect(parsed.data.tools).toBeUndefined()
    expect(parsed.data.model).toBeUndefined()
    expect(parsed.content.trim()).toBe('Agent body content.')
  })

  it('emits comma-separated tools when array is non-empty', () => {
    const out = previewOpenCodeSubagentFile(
      baseAgent({ model_provider: 'opencode', tools: '["Read","Edit","Bash"]' }),
      BODY,
    )
    expect(matter(out).data.tools).toBe('Read, Edit, Bash')
  })

  it('strips the opencode/ provider prefix from the model field', () => {
    const out = previewOpenCodeSubagentFile(
      baseAgent({ model_provider: 'opencode', model: 'opencode/claude-sonnet-4-6' }),
      BODY,
    )
    expect(matter(out).data.model).toBe('claude-sonnet-4-6')
    expect(out).not.toMatch(/opencode\//)
  })

  it('passes bare model ids through unchanged', () => {
    const out = previewOpenCodeSubagentFile(
      baseAgent({ model_provider: 'opencode', model: 'claude-sonnet-4-6' }),
      BODY,
    )
    expect(matter(out).data.model).toBe('claude-sonnet-4-6')
  })

  it('omits the model field entirely when model is "inherit"', () => {
    const out = previewOpenCodeSubagentFile(
      baseAgent({ model_provider: 'opencode', model: 'inherit' }),
      BODY,
    )
    expect(matter(out).data.model).toBeUndefined()
    expect(out).not.toMatch(/^model:/m)
  })
})

describe('syncAgentToDisk — opencode branch', () => {
  it('writes the agent to ~/.opencode/agents/<handle>.md when model_provider is opencode', async () => {
    const agent = baseAgent({
      is_subagent: 1,
      model_provider: 'opencode',
      model: 'opencode/claude-sonnet-4-6',
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'written', path: opencodeSubagentPath('my-agent') })
    expect(await fileExists(opencodeSubagentPath('my-agent'))).toBe(true)
    const written = await fs.readFile(opencodeSubagentPath('my-agent'), 'utf-8')
    expect(written).toContain('name: my-agent')
    expect(written).toContain('model: claude-sonnet-4-6')
  })

  it('does NOT sync the opencode agent to .claude/agents/', async () => {
    const agent = baseAgent({
      is_subagent: 1,
      model_provider: 'opencode',
      model: 'opencode/claude-sonnet-4-6',
    })
    await syncAgentToDisk(agent, BODY)
    expect(await fileExists(subagentPath('my-agent'))).toBe(false)
  })

  it('does NOT sync the anthropic agent to .opencode/agents/', async () => {
    const agent = baseAgent({
      is_subagent: 1,
      model_provider: 'anthropic',
      model: 'sonnet',
    })
    await syncAgentToDisk(agent, BODY)
    expect(await fileExists(opencodeSubagentPath('my-agent'))).toBe(false)
    expect(await fileExists(subagentPath('my-agent'))).toBe(true)
  })

  it('returns skipped when opencode agent has is_subagent=0 and never synced', async () => {
    const agent = baseAgent({
      is_subagent: 0,
      model_provider: 'opencode',
      synced_subagent_at: null,
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'skipped' })
  })

  it('deletes the opencode file when is_subagent flips off after previous sync', async () => {
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('my-agent'), 'previously synced')
    const agent = baseAgent({
      is_subagent: 0,
      model_provider: 'opencode',
      synced_subagent_at: '2026-05-20T00:00:00.000Z',
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'deleted' })
    expect(await fileExists(opencodeSubagentPath('my-agent'))).toBe(false)
  })

  it('returns conflict when opencode file exists, never synced, forceOverwrite=false', async () => {
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('my-agent'), 'hand-authored opencode agent')
    const agent = baseAgent({
      is_subagent: 1,
      model_provider: 'opencode',
      synced_subagent_at: null,
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'conflict' })
    expect(await fs.readFile(opencodeSubagentPath('my-agent'), 'utf-8')).toBe('hand-authored opencode agent')
  })

  it('renames the opencode file when handle changes', async () => {
    await fs.mkdir(path.join(opencodeTmpDir, 'agents'), { recursive: true })
    await fs.writeFile(opencodeSubagentPath('old-handle'), 'previously synced')
    const agent = baseAgent({
      handle: 'new-handle',
      is_subagent: 1,
      model_provider: 'opencode',
      synced_subagent_at: '2026-05-20T00:00:00.000Z',
    })
    await syncAgentToDisk(agent, BODY, { oldHandle: 'old-handle' })
    expect(await fileExists(opencodeSubagentPath('old-handle'))).toBe(false)
    expect(await fileExists(opencodeSubagentPath('new-handle'))).toBe(true)
  })

  it('opencode subagent + claude slash command can coexist for one agent', async () => {
    // Edge case: an agent might be set up as a slash command (Claude Code surface)
    // even though its primary provider is opencode. Each surface is independent.
    const agent = baseAgent({
      is_subagent: 1,
      is_slash_command: 1,
      model_provider: 'opencode',
      model: 'opencode/claude-sonnet-4-6',
    })
    const result = await syncAgentToDisk(agent, BODY)
    expect(result.subagent).toMatchObject({ status: 'written', path: opencodeSubagentPath('my-agent') })
    expect(result.slashCommand).toMatchObject({ status: 'written' })
    expect(await fileExists(opencodeSubagentPath('my-agent'))).toBe(true)
    expect(await fileExists(slashCommandPath('my-agent'))).toBe(true)
    expect(await fileExists(subagentPath('my-agent'))).toBe(false)
  })
})
