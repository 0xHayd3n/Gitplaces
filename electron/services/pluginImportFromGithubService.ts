import path from 'node:path'
import matter from 'gray-matter'
import { getRepo, getBranch, getTreeBySha, getRawFileBytes } from '../github'
import { getToken } from '../store'
import { slugifyName } from '../../src/utils/agentSlug'
import type { DiscoveredSkill, ParsedSkill, ParsedImportTarget, ParsedSubagent, ParsedSlashCommand } from './pluginImportService'
import { parseModelFrontmatter, parseAgentModel, parseToolsFrontmatter, parseArgumentHint } from './frontmatterFields'

export class RepoNotAccessibleError extends Error {
  constructor(public readonly owner: string, public readonly repoName: string) {
    super(`Couldn't load ${owner}/${repoName}`)
    this.name = 'RepoNotAccessibleError'
  }
}

export interface DiscoveredSubagentRemote {
  name: string
  path: string           // repo-relative
  description: string | null
  color: string | null
}

export interface DiscoveredSlashCommandRemote {
  name: string
  path: string
  description: string | null
  argumentHint: string | null
}

export interface RepoPluginIndex {
  owner: string
  name: string
  branch: string
  commitSha: string
  layout: 'skills-dir' | 'bare-root' | 'plugin'
  skills: DiscoveredSkill[]
  subagents: DiscoveredSubagentRemote[]
  slashCommands: DiscoveredSlashCommandRemote[]
}

interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']

export async function discoverPluginInRepo(
  owner: string,
  name: string,
): Promise<RepoPluginIndex> {
  const token = getToken() ?? null
  let repo: { default_branch: string }
  try {
    repo = await getRepo(token, owner, name)
  } catch {
    throw new RepoNotAccessibleError(owner, name)
  }
  const branch = repo.default_branch
  const { commitSha, rootTreeSha } = await getBranch(token, owner, name, branch)
  const rootEntries = await getTreeBySha(token, owner, name, rootTreeSha)

  const skillsEntry = rootEntries.find(e => e.path === 'skills' && e.type === 'tree')
  const agentsEntry = rootEntries.find(e => e.path === 'agents' && e.type === 'tree')
  const commandsEntry = rootEntries.find(e => e.path === 'commands' && e.type === 'tree')

  // Bare-root layout: a single SKILL.md at the repo root, no subdirs.
  if (!skillsEntry && !agentsEntry && !commandsEntry) {
    const rootSkillMd = rootEntries.find(e => e.path === 'SKILL.md' && e.type === 'blob')
    if (rootSkillMd) {
      const skill = await summarizeBareRoot(token, owner, name, branch, rootEntries)
      return {
        owner, name, branch, commitSha,
        layout: 'bare-root',
        skills: skill ? [skill] : [],
        subagents: [],
        slashCommands: [],
      }
    }
    return { owner, name, branch, commitSha, layout: 'plugin', skills: [], subagents: [], slashCommands: [] }
  }

  const skills = skillsEntry
    ? await listSkillsUnderSkillsDir(token, owner, name, branch, skillsEntry.sha)
    : []
  const subagents = agentsEntry
    ? await listSubagentsInRepo(token, owner, name, branch, agentsEntry.sha)
    : []
  const slashCommands = commandsEntry
    ? await listSlashCommandsInRepo(token, owner, name, branch, commandsEntry.sha)
    : []

  return {
    owner, name, branch, commitSha,
    layout: 'plugin',
    skills, subagents, slashCommands,
  }
}

async function listSubagentsInRepo(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  agentsTreeSha: string,
): Promise<DiscoveredSubagentRemote[]> {
  const entries = await getTreeBySha(token, owner, name, agentsTreeSha)
  const out: DiscoveredSubagentRemote[] = []
  for (const e of entries) {
    if (e.type !== 'blob') continue
    if (!e.path.endsWith('.md')) continue
    if (IGNORE_NAMES.has(e.path)) continue
    const repoPath = `agents/${e.path}`
    const filenameStem = path.basename(e.path, '.md')
    let displayName = filenameStem
    let description: string | null = null
    let color: string | null = null
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
      const parsed = matter(buf.toString('utf-8'))
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
      if (typeof data.description === 'string') description = data.description
      if (typeof data.color === 'string') color = data.color
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pluginImportFromGithubService] Failed to fetch ${repoPath}:`, err)
      continue
    }
    out.push({ name: displayName, path: repoPath, description, color })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSlashCommandsInRepo(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  commandsTreeSha: string,
): Promise<DiscoveredSlashCommandRemote[]> {
  const entries = await getTreeBySha(token, owner, name, commandsTreeSha)
  const out: DiscoveredSlashCommandRemote[] = []
  for (const e of entries) {
    if (e.type !== 'blob') continue
    if (!e.path.endsWith('.md')) continue
    if (IGNORE_NAMES.has(e.path)) continue
    const repoPath = `commands/${e.path}`
    const filenameStem = path.basename(e.path, '.md')
    let description: string | null = null
    let argumentHint: string | null = null
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
      const parsed = matter(buf.toString('utf-8'))
      const data = parsed.data as Record<string, unknown>
      if (typeof data.description === 'string') description = data.description
      argumentHint = parseArgumentHint(data['argument-hint'])
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pluginImportFromGithubService] Failed to fetch ${repoPath}:`, err)
      continue
    }
    out.push({ name: filenameStem, path: repoPath, description, argumentHint })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const BARE_ROOT_EXTRA_EXCLUDES = new Set([
  'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt',
  '.gitignore', '.gitattributes',
  'package.json', 'package-lock.json',
])

async function summarizeBareRoot(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  rootEntries: TreeEntry[],
): Promise<DiscoveredSkill | null> {
  const filtered = rootEntries.filter(e => !BARE_ROOT_EXTRA_EXCLUDES.has(e.path))
  const fileCount = await countFilesRecursive(token, owner, name, filtered)

  let displayName = name   // repo name as default
  let description: string | null = null
  try {
    const buf = await getRawFileBytes(token, owner, name, branch, 'SKILL.md')
    const parsed = matter(buf.toString('utf-8'))
    const data = parsed.data as Record<string, unknown>
    if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
    if (typeof data.description === 'string') description = data.description
  } catch {
    // SKILL.md frontmatter unreadable — fall back to repo name
  }

  return { name: displayName, path: '.', description, fileCount }
}

async function listSkillsUnderSkillsDir(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  skillsTreeSha: string,
): Promise<DiscoveredSkill[]> {
  const subdirs = await getTreeBySha(token, owner, name, skillsTreeSha)
  const out: DiscoveredSkill[] = []
  for (const sd of subdirs) {
    if (sd.type !== 'tree' || IGNORE_NAMES.has(sd.path)) continue
    const repoPath = `skills/${sd.path}`
    const skill = await summarizeSkillDir(token, owner, name, branch, sd.sha, repoPath, sd.path)
    if (skill) out.push(skill)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function summarizeSkillDir(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  treeSha: string,
  repoPath: string,
  dirName: string,
): Promise<DiscoveredSkill | null> {
  const entries = await getTreeBySha(token, owner, name, treeSha)
  const hasSkillMd = entries.some(e => e.path === 'SKILL.md' && e.type === 'blob')
  if (!hasSkillMd) return null

  const fileCount = await countFilesRecursive(token, owner, name, entries)

  let displayName = dirName
  let description: string | null = null
  try {
    const buf = await getRawFileBytes(token, owner, name, branch, `${repoPath}/SKILL.md`)
    const parsed = matter(buf.toString('utf-8'))
    const data = parsed.data as Record<string, unknown>
    if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
    if (typeof data.description === 'string') description = data.description
  } catch {
    // Frontmatter unreadable — fall back to defaults
  }

  return { name: displayName, path: repoPath, description, fileCount }
}

async function countFilesRecursive(
  token: string | null,
  owner: string,
  name: string,
  entries: TreeEntry[],
): Promise<number> {
  let count = 0
  for (const e of entries) {
    if (IGNORE_NAMES.has(e.path)) continue
    if (IGNORE_SUFFIXES.some(s => e.path.endsWith(s))) continue
    if (e.type === 'blob') count++
    else if (e.type === 'tree') {
      const sub = await getTreeBySha(token, owner, name, e.sha)
      count += await countFilesRecursive(token, owner, name, sub)
    }
  }
  return count
}

// ── Per-skill fetch ────────────────────────────────────────────────

async function readSkillFromRepo(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,
): Promise<ParsedSkill> {
  const token = getToken() ?? null
  const fileIndex = await listFilesUnderRepoPath(token, owner, name, commitSha, repoPath)
  const isBareRoot = repoPath === '.'
  const skillMdPath = isBareRoot ? 'SKILL.md' : `${repoPath}/SKILL.md`

  // Fetch and parse SKILL.md (the body)
  const skillBuf = await getRawFileBytes(token, owner, name, branch, skillMdPath)
  const parsed = matter(skillBuf.toString('utf-8'))
  const data = parsed.data as Record<string, unknown>
  const skillName = typeof data.name === 'string' && data.name.length > 0
    ? data.name
    : (isBareRoot ? name : repoPath.split('/').pop()!)
  const description = typeof data.description === 'string' ? data.description : ''
  const model = parseModelFrontmatter(data.model)
  const tools = parseToolsFrontmatter(data.tools)
  const argumentHint = parseArgumentHint(data['argument-hint'])
  const known = new Set(['name', 'description', 'model', 'tools', 'argument-hint'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportFromGithubService] Dropped frontmatter keys from ${owner}/${name} ${repoPath}:`, dropped)
  }

  // Fetch sibling file contents, isolating per-file failures.
  const files: { filename: string; content: string }[] = []
  for (const filename of fileIndex) {
    if (filename === 'SKILL.md') continue   // already fetched as the body
    const fullPath = isBareRoot ? filename : `${repoPath}/${filename}`
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, fullPath)
      files.push({ filename, content: buf.toString('utf-8') })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pluginImportFromGithubService] Failed to fetch ${fullPath}:`, err)
    }
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename))

  return {
    kind: 'skill',
    name: skillName,
    handle: slugifyName(skillName),
    description,
    body: parsed.content.trim(),
    files,
    origin: {
      plugin: `${owner}/${name}`,
      pluginVersion: commitSha.slice(0, 7),
      path: repoPath,
    },
    model,
    tools,
    argumentHint,
  }
}

/**
 * Returns relative paths (relative to repoPath, or to repo root for '.') of all
 * files under the given subtree, excluding ignored names and (for bare-root)
 * the extra-excluded files.
 *
 * Note: we pass `commitSha` directly to getTreeBySha as the root ref. GitHub's
 * Git Trees API accepts either tree SHAs or commit SHAs (it resolves the commit
 * to its root tree). This saves a getBranch call per read.
 */
async function listFilesUnderRepoPath(
  token: string | null,
  owner: string,
  name: string,
  commitSha: string,
  repoPath: string,
): Promise<string[]> {
  const isBareRoot = repoPath === '.'
  let entries = await getTreeBySha(token, owner, name, commitSha)
  if (!isBareRoot) {
    const segments = repoPath.split('/')
    for (const seg of segments) {
      const next = entries.find(e => e.path === seg && e.type === 'tree')
      if (!next) throw new Error(`Path not found in repo: ${repoPath}`)
      entries = await getTreeBySha(token, owner, name, next.sha)
    }
  }

  const out: string[] = []
  await collectFilesRecursive(token, owner, name, entries, '', isBareRoot, out)
  return out
}

async function collectFilesRecursive(
  token: string | null,
  owner: string,
  name: string,
  entries: TreeEntry[],
  prefix: string,
  isBareRoot: boolean,
  out: string[],
): Promise<void> {
  for (const e of entries) {
    if (IGNORE_NAMES.has(e.path)) continue
    if (IGNORE_SUFFIXES.some(s => e.path.endsWith(s))) continue
    if (isBareRoot && prefix === '' && BARE_ROOT_EXTRA_EXCLUDES.has(e.path)) continue
    const rel = prefix ? `${prefix}/${e.path}` : e.path
    if (e.type === 'blob') out.push(rel)
    else if (e.type === 'tree') {
      const sub = await getTreeBySha(token, owner, name, e.sha)
      await collectFilesRecursive(token, owner, name, sub, rel, isBareRoot, out)
    }
  }
}

// ── Per-target fetch (kind-aware) ──────────────────────────────────

export async function readTargetFromRepo(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,
  kind: 'skill' | 'subagent' | 'slashCommand',
): Promise<ParsedImportTarget> {
  if (kind === 'skill') {
    return readSkillFromRepo(owner, name, branch, commitSha, repoPath)
  }

  const token = getToken() ?? null
  const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
  const parsed = matter(buf.toString('utf-8'))
  const data = parsed.data as Record<string, unknown>
  const filenameStem = path.basename(repoPath, '.md')

  if (kind === 'subagent') {
    const targetName = typeof data.name === 'string' && data.name.length > 0 ? data.name : filenameStem
    const description = typeof data.description === 'string' ? data.description : ''
    const model = parseAgentModel(data.model).model
    const tools = parseToolsFrontmatter(data.tools)
    const color = typeof data.color === 'string' ? data.color : null
    const sub: ParsedSubagent = {
      kind: 'subagent',
      name: targetName,
      handle: slugifyName(targetName),
      description,
      body: parsed.content.trim(),
      files: [] as never[],
      origin: {
        plugin: `${owner}/${name}`,
        pluginVersion: commitSha.slice(0, 7),
        path: repoPath,
      },
      model,
      tools,
      argumentHint: null,
      color,
    }
    return sub
  }

  // slashCommand
  const description = typeof data.description === 'string' ? data.description : ''
  const argumentHint = parseArgumentHint(data['argument-hint'])
  const cmd: ParsedSlashCommand = {
    kind: 'slashCommand',
    name: filenameStem,
    handle: slugifyName(filenameStem),
    description,
    body: parsed.content.trim(),
    files: [] as never[],
    origin: {
      plugin: `${owner}/${name}`,
      pluginVersion: commitSha.slice(0, 7),
      path: repoPath,
    },
    model: 'inherit',
    tools: null,
    argumentHint,
  }
  return cmd
}
