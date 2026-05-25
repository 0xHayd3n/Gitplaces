import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type Database from 'better-sqlite3'
import { slugifyName, dedupeHandle } from '../../src/utils/agentSlug'
import { createAgent, updateAgent, createFile, deleteFile, listFiles } from './agentsService'
import { hashHandleToColor } from '../../src/utils/colorHarmony'
import {
  parseModelFrontmatter,
  parseToolsFrontmatter,
  parseArgumentHint,
  type ImportedModel,
} from './frontmatterFields'

export { parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint, type ImportedModel }

export type ImportKind = 'skill' | 'subagent' | 'slashCommand'

export interface ParsedImportTargetBase {
  kind: ImportKind
  name: string
  handle: string
  description: string
  body: string
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
  model: ImportedModel
  tools: string[] | null
}

export interface ParsedSkill extends ParsedImportTargetBase {
  kind: 'skill'
  files: { filename: string; content: string }[]
  argumentHint: string | null
}

export interface ParsedSubagent extends ParsedImportTargetBase {
  kind: 'subagent'
  files: never[]
  argumentHint: null
  color: string | null
}

export interface ParsedSlashCommand extends ParsedImportTargetBase {
  kind: 'slashCommand'
  files: never[]
  argumentHint: string | null
}

export type ParsedImportTarget = ParsedSkill | ParsedSubagent | ParsedSlashCommand

export const COLOR_MAP: Record<string, string> = {
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green:  '#22c55e',
  cyan:   '#06b6d4',
  blue:   '#3b82f6',
  purple: '#a855f7',
  pink:   '#ec4899',
}

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']

export async function parseSkill(inputPath: string): Promise<ParsedSkill> {
  // Resolve to the skill directory. If user gave a SKILL.md path, use its parent.
  let skillDir = inputPath
  const stat = await fs.stat(inputPath).catch(() => null)
  if (!stat) throw new Error(`Path does not exist: ${inputPath}`)
  if (stat.isFile()) skillDir = path.dirname(inputPath)

  const skillMdPath = path.join(skillDir, 'SKILL.md')
  const skillMd = await fs.readFile(skillMdPath, 'utf-8').catch(() => null)
  if (skillMd === null) throw new Error(`SKILL.md not found in: ${skillDir}`)

  const parsed = matter(skillMd)
  const data = parsed.data as Record<string, unknown>
  const name = typeof data.name === 'string' && data.name.length > 0
    ? data.name
    : path.basename(skillDir)
  const description = typeof data.description === 'string' ? data.description : ''

  // Phase 2 — pick up structured fields
  const model = parseModelFrontmatter(data.model)
  const tools = parseToolsFrontmatter(data.tools)
  const argumentHint = parseArgumentHint(data['argument-hint'])

  // Warn about unknown frontmatter keys (still dropped — Phase 4 will round-trip)
  const known = new Set(['name', 'description', 'model', 'tools', 'argument-hint'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportService] Dropped frontmatter keys from ${skillDir}:`, dropped)
  }

  const files = await walkSkillFiles(skillDir)
  const handle = slugifyName(name)

  return {
    kind: 'skill',
    name,
    handle,
    description,
    body: parsed.content.trim(),
    files,
    origin: null, // populated by the importTarget caller
    model,
    tools,
    argumentHint,
  }
}

export async function parseSubagent(filePath: string): Promise<ParsedSubagent> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error(`Sub-agent file not found: ${filePath}`)
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const filenameStem = path.basename(filePath, '.md')
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : filenameStem
  const description = typeof data.description === 'string' ? data.description : ''
  const model = parseModelFrontmatter(data.model)
  const tools = parseToolsFrontmatter(data.tools)
  const color = typeof data.color === 'string' ? data.color : null

  const known = new Set(['name', 'description', 'tools', 'model', 'color'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportService] Dropped sub-agent frontmatter keys from ${filePath}:`, dropped)
  }

  return {
    kind: 'subagent',
    name,
    handle: slugifyName(name),
    description,
    body: parsed.content.trim(),
    files: [] as never[],
    origin: null,
    model,
    tools,
    argumentHint: null,
    color,
  }
}

export async function parseSlashCommand(filePath: string): Promise<ParsedSlashCommand> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error(`Slash-command file not found: ${filePath}`)
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const name = path.basename(filePath, '.md')
  const description = typeof data.description === 'string' ? data.description : ''
  const argumentHint = parseArgumentHint(data['argument-hint'])

  const known = new Set(['description', 'argument-hint'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportService] Dropped slash-command frontmatter keys from ${filePath}:`, dropped)
  }

  return {
    kind: 'slashCommand',
    name,
    handle: slugifyName(name),
    description,
    body: parsed.content.trim(),
    files: [] as never[],
    origin: null,
    model: 'inherit',
    tools: null,
    argumentHint,
  }
}

async function walkSkillFiles(skillDir: string): Promise<{ filename: string; content: string }[]> {
  const collected: { filename: string; content: string }[] = []
  await walkRecursive(skillDir, skillDir, collected)
  return collected.sort((a, b) => a.filename.localeCompare(b.filename))
}

async function walkRecursive(
  root: string,
  current: string,
  out: { filename: string; content: string }[],
): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE_NAMES.has(entry.name)) continue
    if (IGNORE_SUFFIXES.some(s => entry.name.endsWith(s))) continue
    // Skip symlinks entirely — they can cycle, and a symlink-to-directory
    // throws EISDIR when read as a file.
    if (entry.isSymbolicLink()) continue
    const abs = path.join(current, entry.name)
    if (entry.isDirectory()) {
      await walkRecursive(root, abs, out)
    } else if (entry.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (rel === 'SKILL.md') continue
      // NOTE: we decode as UTF-8 unconditionally. Skills are conventionally
      // text — markdown, shell, JS, Python. A genuinely binary file in a skill
      // directory will be silently corrupted by this decode, which we accept
      // as a v1 limitation given how unusual that would be in practice.
      const content = await fs.readFile(abs, 'utf-8').catch(() => null)
      if (content === null) continue   // unreadable file (permissions, etc.) — skip
      out.push({ filename: rel, content })
    }
  }
}

// ── Plugin discovery ────────────────────────────────────────────────

export interface PluginManifest {
  name: string
  version: string | null
}

export async function readPluginManifest(pluginDir: string): Promise<PluginManifest> {
  const dirname = path.basename(pluginDir)

  // Prefer .claude-plugin/plugin.json (Anthropic canonical format).
  const claudeManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
  const claudeRaw = await fs.readFile(claudeManifestPath, 'utf-8').catch(() => null)
  if (claudeRaw !== null) {
    try {
      const m = JSON.parse(claudeRaw)
      return {
        name: typeof m.name === 'string' && m.name.length > 0 ? m.name : dirname,
        version: typeof m.version === 'string' ? m.version : null,
      }
    } catch {
      // Malformed — fall through to package.json
    }
  }

  // Fall back to package.json (legacy plugin layouts).
  const pkgPath = path.join(pluginDir, 'package.json')
  const pkgRaw = await fs.readFile(pkgPath, 'utf-8').catch(() => null)
  if (pkgRaw !== null) {
    try {
      const p = JSON.parse(pkgRaw)
      return {
        name: typeof p.name === 'string' && p.name.length > 0 ? p.name : dirname,
        version: typeof p.version === 'string' ? p.version : null,
      }
    } catch {
      // Malformed — fall through to dirname
    }
  }

  return { name: dirname, version: null }
}

export interface DiscoveredSkill {
  name: string
  path: string
  description: string | null
  fileCount: number
}

export interface DiscoveredSubagent {
  name: string
  path: string
  description: string | null
  color: string | null
}

export interface DiscoveredSlashCommand {
  name: string
  path: string
  description: string | null
  argumentHint: string | null
}

export interface DiscoveredPlugin {
  id: string         // hash of root path
  name: string
  version: string | null
  root: string
  skills: DiscoveredSkill[]
  subagents: DiscoveredSubagent[]
  slashCommands: DiscoveredSlashCommand[]
}

export async function discoverPlugins(roots: string[]): Promise<DiscoveredPlugin[]> {
  const out: DiscoveredPlugin[] = []
  for (const root of roots) {
    const exists = await fs.stat(root).catch(() => null)
    if (!exists || !exists.isDirectory()) continue
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = path.join(root, entry.name)

      const skillsDir = path.join(pluginDir, 'skills')
      const agentsDir = path.join(pluginDir, 'agents')
      const commandsDir = path.join(pluginDir, 'commands')

      const [skillsStat, agentsStat, commandsStat] = await Promise.all([
        fs.stat(skillsDir).catch(() => null),
        fs.stat(agentsDir).catch(() => null),
        fs.stat(commandsDir).catch(() => null),
      ])

      const skills = skillsStat?.isDirectory() ? await listSkillsInPluginDir(skillsDir) : []
      const subagents = agentsStat?.isDirectory() ? await listSubagentsInPluginDir(agentsDir) : []
      const slashCommands = commandsStat?.isDirectory() ? await listSlashCommandsInPluginDir(commandsDir) : []

      // Plugin gate: must have at least one populated kind.
      if (skills.length === 0 && subagents.length === 0 && slashCommands.length === 0) continue

      const manifest = await readPluginManifest(pluginDir)
      out.push({
        id: simpleHash(pluginDir),
        name: manifest.name,
        version: manifest.version,
        root: pluginDir,
        skills,
        subagents,
        slashCommands,
      })
    }
  }
  return out
}

async function listSubagentsInPluginDir(agentsDir: string): Promise<DiscoveredSubagent[]> {
  const out: DiscoveredSubagent[] = []
  const entries = await fs.readdir(agentsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.md')) continue
    if (IGNORE_NAMES.has(entry.name)) continue
    const filePath = path.join(agentsDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (raw === null) continue
    const filenameStem = path.basename(entry.name, '.md')
    let name = filenameStem
    let description: string | null = null
    let color: string | null = null
    try {
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string' && data.name.length > 0) name = data.name
      if (typeof data.description === 'string') description = data.description
      if (typeof data.color === 'string') color = data.color
    } catch {
      // Bad frontmatter — keep defaults
    }
    out.push({ name, path: filePath, description, color })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSlashCommandsInPluginDir(commandsDir: string): Promise<DiscoveredSlashCommand[]> {
  const out: DiscoveredSlashCommand[] = []
  const entries = await fs.readdir(commandsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.md')) continue
    if (IGNORE_NAMES.has(entry.name)) continue
    const filePath = path.join(commandsDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (raw === null) continue
    const name = path.basename(entry.name, '.md')
    let description: string | null = null
    let argumentHint: string | null = null
    try {
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.description === 'string') description = data.description
      argumentHint = parseArgumentHint(data['argument-hint'])
    } catch {
      // Bad frontmatter — keep defaults
    }
    out.push({ name, path: filePath, description, argumentHint })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSkillsInPluginDir(skillsDir: string): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = []
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(skillsDir, entry.name)
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const skillMd = await fs.readFile(skillMdPath, 'utf-8').catch(() => null)
    if (skillMd === null) continue
    let name = entry.name
    let description: string | null = null
    try {
      const parsed = matter(skillMd)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string') name = data.name
      if (typeof data.description === 'string') description = data.description
    } catch {
      // Bad frontmatter — keep defaults
    }
    const fileCount = await countSkillFiles(skillDir)
    out.push({ name, path: skillDir, description, fileCount })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function countSkillFiles(dir: string): Promise<number> {
  let n = 0
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (IGNORE_NAMES.has(e.name)) continue
      if (e.isDirectory()) await walk(path.join(d, e.name))
      else if (e.isFile()) n++
    }
  }
  await walk(dir)
  return n
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

// ── Import ──────────────────────────────────────────────────────────

export interface ImportOptions {
  folderId: string | null
  onConflict: 'overwrite' | 'skip' | 'rename'
}

export interface ImportResult {
  agentId: string
  conflictResolved: 'created' | 'overwritten' | 'skipped' | 'renamed'
}

export function importTarget(
  db: Database.Database,
  target: ParsedImportTarget,
  opts: ImportOptions,
): ImportResult {
  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const existing = db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(target.handle) as { id: string } | undefined

  if (existing) {
    if (opts.onConflict === 'skip') {
      return { agentId: existing.id, conflictResolved: 'skipped' }
    }
    if (opts.onConflict === 'overwrite') {
      // Wrap the whole overwrite in a transaction so we never leave the agent
      // in a half-imported state (body updated but files not yet replaced).
      const tx = db.transaction(() => {
        updateAgent(db, existing.id, {
          name: target.name,
          body: target.body,
          description: target.description,
          model: target.model,
          tools: target.tools,
          argumentHint: target.argumentHint,
        })
        const ts = new Date().toISOString()
        db.prepare(`
          UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
          WHERE id = ?
        `).run(
          target.origin?.plugin ?? null,
          target.origin?.path ?? null,
          target.origin?.pluginVersion ?? null,
          ts,
          existing.id,
        )
        // Skip the primary file (sort_order=0): updateAgent has already
        // overwritten its content via the body field. Siblings start at
        // sort_order=1. Only the skill kind has siblings.
        if (target.kind === 'skill') {
          const oldFiles = listFiles(db, existing.id)
          for (const f of oldFiles) {
            if (f.sort_order !== 0) deleteFile(db, existing.id, f.id)
          }
          target.files.forEach((f, i) => {
            createFile(db, existing.id, { filename: f.filename, content: f.content, sortOrder: i + 1 })
          })
        }
      })
      tx()
      return { agentId: existing.id, conflictResolved: 'overwritten' }
    }
    // rename
    const newHandle = dedupeHandle(target.handle, taken)
    return createFromScratch(db, { ...target, handle: newHandle } as ParsedImportTarget, opts, 'renamed')
  }

  return createFromScratch(db, target, opts, 'created')
}

function createFromScratch(
  db: Database.Database,
  target: ParsedImportTarget,
  opts: ImportOptions,
  resolution: 'created' | 'renamed',
): ImportResult {
  // Sub-agents seed color_start from the frontmatter color via COLOR_MAP;
  // skills and slash commands use the handle-hash fallback.
  const colorStart = target.kind === 'subagent' && target.color
    ? (COLOR_MAP[target.color] ?? hashHandleToColor(target.handle))
    : hashHandleToColor(target.handle)

  let agentId = ''
  // Transaction: agent insert, origin metadata, and (for skills) sibling
  // files must land together — a crash mid-import would otherwise leave the
  // agent in a half-imported state.
  const tx = db.transaction(() => {
    const agent = createAgent(db, {
      name: target.name,
      body: target.body,
      folderId: opts.folderId,
      handle: target.handle,
      colorStart,
      colorEnd: null,
      emoji: null,
      description: target.description,
      model: target.model,
      tools: target.tools,
      argumentHint: target.argumentHint,
      isSubagent: target.kind === 'subagent',
      isSlashCommand: target.kind === 'slashCommand',
    })
    agentId = agent.id
    const ts = new Date().toISOString()
    db.prepare(`
      UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
      WHERE id = ?
    `).run(
      target.origin?.plugin ?? null,
      target.origin?.path ?? null,
      target.origin?.pluginVersion ?? null,
      ts,
      agent.id,
    )
    // Siblings start at sort_order=1; sort_order=0 is the primary file
    // created by createAgent holding the body. Only skills carry siblings.
    if (target.kind === 'skill') {
      target.files.forEach((f, i) => {
        createFile(db, agent.id, { filename: f.filename, content: f.content, sortOrder: i + 1 })
      })
    }
  })
  tx()
  return { agentId, conflictResolved: resolution }
}

