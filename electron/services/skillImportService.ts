import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type Database from 'better-sqlite3'
import { slugifyName, dedupeHandle } from '../../src/utils/agentSlug'
import { createAgent, updateAgent, createFile, deleteFile, listFiles } from './agentsService'
import { hashHandleToColor } from '../../src/utils/colorHarmony'

export interface ParsedSkill {
  name: string
  handle: string
  description: string
  body: string
  files: { filename: string; content: string }[]
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
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

  // Warn about unknown frontmatter keys (Phase 1 drops them)
  const known = new Set(['name', 'description'])
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
    const abs = path.join(current, entry.name)
    if (entry.isDirectory()) {
      await walkRecursive(root, abs, out)
    } else if (entry.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (rel === 'SKILL.md') continue
      const content = await fs.readFile(abs, 'utf-8')
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
      updateAgent(db, existing.id, {
        name: skill.name,
        body: skill.body,
        description: skill.description,
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
      const oldFiles = listFiles(db, existing.id)
      for (const f of oldFiles) deleteFile(db, existing.id, f.id)
      skill.files.forEach((f, i) => {
        createFile(db, existing.id, { filename: f.filename, content: f.content, sortOrder: i })
      })
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
  const agent = createAgent(db, {
    name: skill.name,
    body: skill.body,
    folderId: opts.folderId,
    handle: skill.handle,
    colorStart,
    colorEnd: null,
    emoji: null,
    description: skill.description,
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
    agent.id,
  )
  skill.files.forEach((f, i) => {
    createFile(db, agent.id, { filename: f.filename, content: f.content, sortOrder: i })
  })
  return { agentId: agent.id, conflictResolved: resolution }
}
