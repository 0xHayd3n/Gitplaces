import matter from 'gray-matter'
import { getRepo, getBranch, getTreeBySha, getRawFileBytes } from '../github'
import { getToken } from '../store'
import type { DiscoveredSkill } from './skillImportService'

export class RepoNotAccessibleError extends Error {
  constructor(public readonly owner: string, public readonly repoName: string) {
    super(`Couldn't load ${owner}/${repoName}`)
    this.name = 'RepoNotAccessibleError'
  }
}

export interface RepoSkillIndex {
  owner: string
  name: string
  branch: string
  commitSha: string
  layout: 'skills-dir' | 'bare-root'
  skills: DiscoveredSkill[]
}

interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']

export async function discoverSkillsInRepo(
  owner: string,
  name: string,
): Promise<RepoSkillIndex> {
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
  if (skillsEntry) {
    const skills = await listSkillsUnderSkillsDir(token, owner, name, branch, skillsEntry.sha)
    return { owner, name, branch, commitSha, layout: 'skills-dir', skills }
  }

  const rootSkillMd = rootEntries.find(e => e.path === 'SKILL.md' && e.type === 'blob')
  if (rootSkillMd) {
    const skill = await summarizeBareRoot(token, owner, name, branch, rootEntries)
    return { owner, name, branch, commitSha, layout: 'bare-root', skills: skill ? [skill] : [] }
  }

  return { owner, name, branch, commitSha, layout: 'skills-dir', skills: [] }
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
