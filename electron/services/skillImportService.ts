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

export interface ParsedSkill {
  name: string
  handle: string
  description: string
  body: string
  files: { filename: string; content: string }[]
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
  // Phase 2
  model: ImportedModel
  tools: string[] | null
  argumentHint: string | null
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
    console.warn(`[skillImportService] Dropped frontmatter keys from ${skillDir}:`, dropped)
  }

  const files = await walkSkillFiles(skillDir)
  const handle = slugifyName(name)

  return {
    name,
    handle,
    description,
    body: parsed.content.trim(),
    files,
    origin: null, // populated by importSkill caller
    model,
    tools,
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

export interface DiscoveredSkill {
  name: string
  path: string
  description: string | null
  fileCount: number
}

export interface DiscoveredPlugin {
  id: string         // hash of root path
  name: string
  version: string | null
  root: string
  skills: DiscoveredSkill[]
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
      const skillsStat = await fs.stat(skillsDir).catch(() => null)
      if (!skillsStat?.isDirectory()) continue
      const skills = await listSkillsInPluginDir(skillsDir)
      if (skills.length === 0) continue

      let name = entry.name
      let version: string | null = null
      const pkgPath = path.join(pluginDir, 'package.json')
      const pkgRaw = await fs.readFile(pkgPath, 'utf-8').catch(() => null)
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw)
          if (typeof pkg.name === 'string') name = pkg.name
          if (typeof pkg.version === 'string') version = pkg.version
        } catch {
          // Malformed package.json — fall back to dir name
        }
      }
      out.push({
        id: simpleHash(pluginDir),
        name,
        version,
        root: pluginDir,
        skills,
      })
    }
  }
  return out
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

export function importSkill(
  db: Database.Database,
  skill: ParsedSkill,
  opts: ImportOptions,
): ImportResult {
  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const existing = db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(skill.handle) as { id: string } | undefined

  if (existing) {
    if (opts.onConflict === 'skip') {
      return { agentId: existing.id, conflictResolved: 'skipped' }
    }
    if (opts.onConflict === 'overwrite') {
      // Wrap the whole overwrite in a transaction so we never leave the agent
      // in a half-imported state (body updated but files not yet replaced).
      const tx = db.transaction(() => {
        updateAgent(db, existing.id, {
          name: skill.name,
          body: skill.body,
          description: skill.description,
          model: skill.model,
          tools: skill.tools,
          argumentHint: skill.argumentHint,
        })
        const ts = new Date().toISOString()
        db.prepare(`
          UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
          WHERE id = ?
        `).run(
          skill.origin?.plugin ?? null,
          skill.origin?.path ?? null,
          skill.origin?.pluginVersion ?? null,
          ts,
          existing.id,
        )
        // Skip the primary file (sort_order=0): updateAgent has already
        // overwritten its content via the body field, and deleteFile refuses
        // to drop the primary. Siblings start at sort_order=1 to preserve
        // primary-file precedence.
        const oldFiles = listFiles(db, existing.id)
        for (const f of oldFiles) {
          if (f.sort_order !== 0) deleteFile(db, existing.id, f.id)
        }
        skill.files.forEach((f, i) => {
          createFile(db, existing.id, { filename: f.filename, content: f.content, sortOrder: i + 1 })
        })
      })
      tx()
      return { agentId: existing.id, conflictResolved: 'overwritten' }
    }
    // rename
    const newHandle = dedupeHandle(skill.handle, taken)
    return createFromScratch(db, { ...skill, handle: newHandle }, opts, 'renamed')
  }

  return createFromScratch(db, skill, opts, 'created')
}

function createFromScratch(
  db: Database.Database,
  skill: ParsedSkill,
  opts: ImportOptions,
  resolution: 'created' | 'renamed',
): ImportResult {
  const colorStart = hashHandleToColor(skill.handle)
  let agentId = ''
  // Transaction: agent insert, origin metadata, and file inserts must land
  // together — a crash mid-import would otherwise create an agent with no
  // files, which the user has to manually delete and re-import.
  const tx = db.transaction(() => {
    const agent = createAgent(db, {
      name: skill.name,
      body: skill.body,
      folderId: opts.folderId,
      handle: skill.handle,
      colorStart,
      colorEnd: null,
      emoji: null,
      description: skill.description,
      model: skill.model,
      tools: skill.tools,
      argumentHint: skill.argumentHint,
      // Deliberately leaves is_subagent / is_slash_command at default (0).
      // Importing should not auto-create files in ~/.claude/agents/.
    })
    agentId = agent.id
    const ts = new Date().toISOString()
    db.prepare(`
      UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
      WHERE id = ?
    `).run(
      skill.origin?.plugin ?? null,
      skill.origin?.path ?? null,
      skill.origin?.pluginVersion ?? null,
      ts,
      agent.id,
    )
    // Siblings start at sort_order=1; sort_order=0 is the primary file
    // created by createAgent holding the body content.
    skill.files.forEach((f, i) => {
      createFile(db, agent.id, { filename: f.filename, content: f.content, sortOrder: i + 1 })
    })
  })
  tx()
  return { agentId, conflictResolved: resolution }
}
