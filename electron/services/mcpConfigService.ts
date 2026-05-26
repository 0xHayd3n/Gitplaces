import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

export type McpTarget = 'claude' | 'opencode' | 'gemini' | 'codex'

export type McpStatus = { configured: boolean; configPath: string | null }

type McpEntry = {
  command: string
  args: string[]
  env: Record<string, string>
}

export function buildGitSuiteEntry(execPath: string, scriptPath: string): McpEntry {
  return {
    command: execPath,
    args: [scriptPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

// ── Path resolution ────────────────────────────────────────────────

export function getClaudeConfigPath(): string | null {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'claude_desktop_config.json')
    default:
      return null
  }
}

export function getOpenCodeConfigPath(): string {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    return path.join(appdata, 'opencode', 'opencode.json')
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  return path.join(xdg, 'opencode', 'opencode.json')
}

export function getGeminiConfigPath(): string {
  return path.join(os.homedir(), '.gemini', 'settings.json')
}

export function getCodexConfigPath(): string {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

// ── Status readers ────────────────────────────────────────────────

export async function readClaudeStatus(): Promise<McpStatus> {
  const configPath = getClaudeConfigPath()
  if (!configPath) return { configured: false, configPath: null }
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { command?: string }> }
    if (!config.mcpServers || !('git-suite' in config.mcpServers)) {
      return { configured: false, configPath }
    }
    const entry = config.mcpServers['git-suite']
    if (entry?.command) {
      try { await fs.access(entry.command) } catch { return { configured: false, configPath } }
    }
    return { configured: true, configPath }
  } catch {
    return { configured: false, configPath }
  }
}

export async function readOpenCodeStatus(): Promise<McpStatus> {
  const configPath = getOpenCodeConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as { mcp?: Record<string, unknown> }
    if (!config.mcp || !('git-suite' in config.mcp)) {
      return { configured: false, configPath }
    }
    return { configured: true, configPath }
  } catch {
    return { configured: false, configPath }
  }
}

export async function readGeminiStatus(): Promise<McpStatus> {
  const configPath = getGeminiConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { command?: string }> }
    if (!config.mcpServers || !('git-suite' in config.mcpServers)) {
      return { configured: false, configPath }
    }
    const entry = config.mcpServers['git-suite']
    if (entry?.command) {
      try { await fs.access(entry.command) } catch { return { configured: false, configPath } }
    }
    return { configured: true, configPath }
  } catch {
    return { configured: false, configPath }
  }
}

export async function readCodexStatus(): Promise<McpStatus> {
  const configPath = getCodexConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = parseToml(raw) as { mcp_servers?: Record<string, { command?: string }> }
    if (!config.mcp_servers || !('git-suite' in config.mcp_servers)) {
      return { configured: false, configPath }
    }
    const entry = config.mcp_servers['git-suite']
    if (entry?.command) {
      try { await fs.access(entry.command) } catch { return { configured: false, configPath } }
    }
    return { configured: true, configPath }
  } catch {
    return { configured: false, configPath }
  }
}

// ── Auto-configure (write) ────────────────────────────────────────

async function readJsonOrEmpty(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function writeClaudeMcpConfig(entry: McpEntry): Promise<{ success: boolean; error?: string }> {
  const configPath = getClaudeConfigPath()
  if (!configPath) return { success: false, error: 'Unsupported platform' }
  try {
    const existing = await readJsonOrEmpty(configPath)
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>
    mcpServers['git-suite'] = entry
    existing.mcpServers = mcpServers
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function writeOpenCodeMcpConfig(entry: McpEntry): Promise<{ success: boolean; error?: string }> {
  const configPath = getOpenCodeConfigPath()
  try {
    const existing = await readJsonOrEmpty(configPath)
    const mcp = (existing.mcp ?? {}) as Record<string, unknown>
    // OpenCode's local-server schema: { type: 'local', command: [bin, ...args], environment }
    mcp['git-suite'] = {
      type: 'local',
      command: [entry.command, ...entry.args],
      environment: entry.env,
    }
    existing.mcp = mcp
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function writeGeminiMcpConfig(entry: McpEntry): Promise<{ success: boolean; error?: string }> {
  const configPath = getGeminiConfigPath()
  try {
    const existing = await readJsonOrEmpty(configPath)
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>
    mcpServers['git-suite'] = entry
    existing.mcpServers = mcpServers
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function writeCodexMcpConfig(entry: McpEntry): Promise<{ success: boolean; error?: string }> {
  const configPath = getCodexConfigPath()
  try {
    let existing: Record<string, unknown> = {}
    try {
      existing = parseToml(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>
    } catch {
      // file doesn't exist or invalid — start fresh
    }
    const mcpServers = (existing.mcp_servers ?? {}) as Record<string, unknown>
    mcpServers['git-suite'] = {
      command: entry.command,
      args: entry.args,
      env: entry.env,
    }
    existing.mcp_servers = mcpServers
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, stringifyToml(existing), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// ── Snippets (for the manual-config display) ──────────────────────

export function getClaudeMcpSnippet(entry: McpEntry): string {
  return JSON.stringify({ mcpServers: { 'git-suite': entry } }, null, 2)
}

export function getOpenCodeMcpSnippet(entry: McpEntry): string {
  return JSON.stringify({
    mcp: {
      'git-suite': {
        type: 'local',
        command: [entry.command, ...entry.args],
        environment: entry.env,
      },
    },
  }, null, 2)
}

export function getGeminiMcpSnippet(entry: McpEntry): string {
  return JSON.stringify({ mcpServers: { 'git-suite': entry } }, null, 2)
}

export function getCodexMcpSnippet(entry: McpEntry): string {
  return stringifyToml({
    mcp_servers: {
      'git-suite': {
        command: entry.command,
        args: entry.args,
        env: entry.env,
      },
    },
  })
}
