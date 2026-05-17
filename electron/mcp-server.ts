import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── Data directory (cross-platform, matches Electron app.getPath('userData')) ──
export function getDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'git-suite')
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'git-suite')
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'git-suite')
  }
}

// ── Tool result shape ────────────────────────────────────────────────────────
// Declared as a `type` (not `interface`) deliberately: the MCP SDK's request
// handlers expect `ServerResult | Result`, whose schemas carry an implicit
// string index signature (Zod `$loose`). An interface is not assignable to an
// index-signatured type (interfaces are open to declaration merging); a closed
// type alias of identical shape is. Runtime behavior is unchanged.
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
}

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] }
}

// ── Tool handlers (exported for unit tests) ──────────────────────────────────

export function handleListSkills(db: Database.Database): ToolResult {
  const skills = db.prepare(`
    SELECT repos.owner, repos.name, repos.description, repos.language,
           skills.version, skills.filename
    FROM skills
    INNER JOIN repos ON repos.id = skills.repo_id
    WHERE skills.active = 1
  `).all() as Array<{
    owner: string; name: string; description: string | null
    language: string | null; version: string | null; filename: string
  }>

  if (skills.length === 0) return text('No active skills installed.')

  const subSkillMap = new Map<string, string[]>()
  const subs = db.prepare(`
    SELECT r.owner, r.name, ss.skill_type
    FROM sub_skills ss
    JOIN repos r ON r.id = ss.repo_id
    WHERE ss.active = 1
  `).all() as Array<{ owner: string; name: string; skill_type: string }>

  for (const s of subs) {
    const key = `${s.owner}/${s.name}`
    if (!subSkillMap.has(key)) subSkillMap.set(key, [])
    subSkillMap.get(key)!.push(s.skill_type)
  }

  const lines = skills.map((s) => {
    const key = `${s.owner}/${s.name}`
    const subTypes = subSkillMap.get(key) ?? []
    const subNote = subTypes.length > 0 ? ` | Sub-skills: ${subTypes.join(', ')}` : ''
    return (
      `${s.owner}/${s.name} (${s.language ?? 'unknown'}) — ${s.description ?? 'No description'}\n` +
      `  Version: ${s.version ?? 'unknown'} | File: ${s.filename}${subNote}`
    )
  })
  return text(lines.join('\n'))
}

export function handleGetSkill(
  dataDir: string, owner: string, repo: string, db?: Database.Database | null,
): ToolResult {
  if (db) {
    const row = db.prepare(`
      SELECT s.content, s.anatomy_memory, s.anatomy_source
      FROM skills s JOIN repos r ON r.id = s.repo_id
      WHERE r.owner = ? AND r.name = ? AND s.active = 1
    `).get(owner, repo) as { content: string; anatomy_memory: string | null; anatomy_source: string | null } | undefined
    if (row?.anatomy_source) {
      const mem = row.anatomy_memory
        ? `\n\n# Lived experience (.anatomy-memory)\n\n${row.anatomy_memory}` : ''
      return text(row.content + mem)
    }
  }
  const skillPath = path.join(dataDir, 'skills', owner, `${repo}.skill.md`)
  const resolved = path.resolve(skillPath)
  const base = path.resolve(path.join(dataDir, 'skills'))
  if (!resolved.startsWith(base + path.sep)) {
    return text(`Invalid skill path for ${owner}/${repo}`)
  }
  if (!fs.existsSync(resolved)) {
    return text(`No skill file found for ${owner}/${repo}`)
  }
  return text(fs.readFileSync(resolved, 'utf8'))
}

export function handleGetComponentsSkill(
  db: Database.Database,
  dataDir: string,
  owner: string,
  repo: string
): ToolResult {
  // filename is a basename only — construct full path from dataDir/skills/<owner>/
  const row = db.prepare(`
    SELECT ss.filename FROM sub_skills ss
    JOIN repos r ON ss.repo_id = r.id
    WHERE r.owner = ? AND r.name = ? AND ss.skill_type = 'components' AND ss.active = 1
  `).get(owner, repo) as { filename: string } | undefined

  if (!row) return text(`No components skill file found for ${owner}/${repo}`)

  const skillPath = path.join(dataDir, 'skills', owner, row.filename)
  const resolved = path.resolve(skillPath)
  const base = path.resolve(path.join(dataDir, 'skills'))
  if (!resolved.startsWith(base + path.sep)) return text(`Invalid skill path for ${owner}/${repo}`)
  if (!fs.existsSync(resolved)) return text(`Components skill file missing on disk for ${owner}/${repo}`)

  return text(fs.readFileSync(resolved, 'utf8'))
}

export function handleSearchSkills(
  db: Database.Database,
  dataDir: string,
  query: string
): ToolResult {
  const activeSkills = db.prepare(`
    SELECT repos.owner, repos.name, skills.filename, skills.content AS db_content, skills.anatomy_source
    FROM skills
    INNER JOIN repos ON repos.id = skills.repo_id
    WHERE skills.active = 1
  `).all() as Array<{ owner: string; name: string; filename: string; db_content: string; anatomy_source: string | null }>

  const results: string[] = []
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return text('Empty search query')

  for (const skill of activeSkills) {
    let haystack: string
    if (skill.anatomy_source) {
      haystack = skill.db_content // raw .anatomy — search the whole document
    } else {
      const skillPath = path.join(dataDir, 'skills', skill.owner, skill.filename)
      if (!fs.existsSync(skillPath)) continue
      const content = fs.readFileSync(skillPath, 'utf8')
      const coreMatch = content.match(/## \[CORE\]([\s\S]*?)(?=## \[EXTENDED\]|$)/)
      haystack = coreMatch ? coreMatch[1] : content
    }
    const lower = haystack.toLowerCase()
    if (tokens.every(t => lower.includes(t))) {
      results.push(`${skill.owner}/${skill.name}:\n${haystack.slice(0, 300).trim()}...`)
    }
  }

  if (results.length === 0) return text(`No skill files contain information about "${query}"`)
  return text(`Found in ${results.length} skill(s):\n\n${results.join('\n\n')}`)
}

export function handleGetCollection(
  db: Database.Database,
  dataDir: string,
  name: string,
  depth: 'core' | 'full' = 'core'
): ToolResult {
  const collection = db.prepare(
    `SELECT id FROM collections WHERE lower(name) = lower(?) AND active = 1`
  ).get(name) as { id: string } | undefined

  if (!collection) return text(`No active collection named "${name}"`)

  // INNER JOIN so we only get repos that have an active skill.
  // Filter in the JOIN condition (not WHERE) keeps intent explicit.
  const repos = db.prepare(`
    SELECT repos.owner, repos.name, skills.filename
    FROM collection_repos
    JOIN repos ON repos.id = collection_repos.repo_id
    JOIN skills ON skills.repo_id = repos.id AND skills.active = 1
    WHERE collection_repos.collection_id = ?
  `).all(collection.id) as Array<{ owner: string; name: string; filename: string }>

  if (repos.length === 0) return text(`Collection "${name}" has no active skills installed.`)

  const parts: string[] = []
  for (const repo of repos) {
    if (!repo.filename) continue
    const skillPath = path.join(dataDir, 'skills', repo.owner, repo.filename)
    if (!fs.existsSync(skillPath)) continue
    const content = fs.readFileSync(skillPath, 'utf8')
    if (depth === 'core') {
      const coreMatch = content.match(/## \[CORE\]([\s\S]*?)(?=## \[EXTENDED\]|$)/)
      const coreSection = coreMatch ? `## [CORE]${coreMatch[1]}` : content
      parts.push(`# ${repo.owner}/${repo.name}\n\n${coreSection}`)
    } else {
      parts.push(`# ${repo.owner}/${repo.name}\n\n${content}`)
    }
  }

  if (parts.length === 0) return text(`Collection "${name}" has no readable skill files.`)
  return text(parts.join('\n\n---\n\n'))
}

// ── MCP server wiring ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dataDir = getDataDir()
  const dbPath = path.join(dataDir, 'gitsuite.db')

  const dbExists = fs.existsSync(dbPath)
  if (!dbExists) {
    process.stderr.write(`[git-suite-mcp] DB not found at ${dbPath}, starting in degraded mode\n`)
  }

  const db = dbExists ? new Database(dbPath, { readonly: true }) : null

  const server = new Server(
    { name: 'git-suite', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_skills',
        description:
          'List all installed Git Suite skills that are currently active. Use this to understand what repositories the user has installed as skills.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_skill',
        description:
          'Get the skill file for a specific repository. The skill file contains Core, Extended, and Deep sections — read as far as your context allows.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner/organisation' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'get_components_skill',
        description:
          'Get the components skill file for a component library repository. Contains per-component props, variants, import paths, and usage examples. Use this when working with UI components from an installed library.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner/organisation' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'search_skills',
        description:
          'Search across all installed skill files for information relevant to a query. Use this when you need to find which skill file contains information about a specific topic, pattern, or API.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_collection',
        description:
          'Get skill files in a named collection. Collections group related repositories together. Defaults to CORE sections only to save context; use depth=full for complete files.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Collection name' },
            depth: { type: 'string', enum: ['core', 'full'], description: 'How much of each skill to return (default: core)' },
          },
          required: ['name'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const input = (args ?? {}) as Record<string, string>

    if (!db && name !== 'get_skill') {
      return text('Git Suite database not found. Please open the Git Suite app first to initialize the database.')
    }

    switch (name) {
      case 'list_skills':
        return handleListSkills(db!)
      case 'get_skill':
        if (!input.owner || !input.repo) return text('Missing required parameters: owner, repo')
        return handleGetSkill(dataDir, input.owner, input.repo, db)
      case 'get_components_skill':
        if (!input.owner || !input.repo) return text('Missing required parameters: owner, repo')
        return handleGetComponentsSkill(db!, dataDir, input.owner, input.repo)
      case 'search_skills':
        if (!input.query) return text('Missing required parameter: query')
        return handleSearchSkills(db!, dataDir, input.query)
      case 'get_collection':
        if (!input.name) return text('Missing required parameter: name')
        return handleGetCollection(db!, dataDir, input.name, (input.depth === 'full' ? 'full' : 'core'))
      default:
        return text(`Unknown tool: ${name}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// Guard: only run the server when this file is executed directly (e.g. via Claude Desktop
// or the Electron child_process.spawn). When imported by tests, process.argv[1] points
// to the Vitest runner, not this file, so main() is safely skipped.
// (require.main === module is unreliable in Rollup CJS output; argv[1] is always correct.)
const scriptBasename = path.basename(process.argv[1] ?? '')
if (scriptBasename === 'mcp-server.js' || scriptBasename === 'mcp-server.ts') {
  main().catch((err) => {
    process.stderr.write(`[git-suite-mcp] Fatal: ${err}\n`)
    process.exit(1)
  })
}
