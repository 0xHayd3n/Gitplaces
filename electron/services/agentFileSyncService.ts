import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import type { AgentRow } from '../../src/types/agent'
import { parseAgentTools } from '../../src/types/agent'
import { deriveDescription } from '../../src/utils/copyPayload'

// ── Path resolution ─────────────────────────────────────────────────

export function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
}

export function subagentPath(handle: string): string {
  return path.join(claudeHome(), 'agents', `${handle}.md`)
}

export function slashCommandPath(handle: string): string {
  return path.join(claudeHome(), 'commands', `${handle}.md`)
}

async function fileExists(p: string): Promise<boolean> {
  return fs.stat(p).then(s => s.isFile()).catch(() => false)
}

// ── Conflict detection ──────────────────────────────────────────────

export async function checkConflict(handle: string): Promise<{
  subagentExists: boolean
  slashCommandExists: boolean
  subagentPath: string
  slashCommandPath: string
}> {
  const sp = subagentPath(handle)
  const cp = slashCommandPath(handle)
  return {
    subagentExists: await fileExists(sp),
    slashCommandExists: await fileExists(cp),
    subagentPath: sp,
    slashCommandPath: cp,
  }
}

// ── Frontmatter generation ──────────────────────────────────────────

const LEGACY_SHORT_TO_FULL: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5-20251001',
}

/**
 * Convert an agent's stored model string into the form Claude Code expects in
 * `.claude/agents/*.md` frontmatter:
 *   - 'inherit' → returns null (caller omits the field entirely)
 *   - 'sonnet'/'opus'/'haiku' → expanded to full Anthropic ID
 *   - 'anthropic/claude-sonnet-4-6' → stripped to 'claude-sonnet-4-6'
 *   - 'claude-sonnet-4-6' → returned as-is (already canonical)
 *
 * Non-Anthropic providers should never reach this function — the sync layer
 * gates them out before previewSubagentFile is called.
 */
function modelForClaudeFrontmatter(model: string): string | null {
  if (model === 'inherit') return null
  if (LEGACY_SHORT_TO_FULL[model]) return LEGACY_SHORT_TO_FULL[model]
  if (model.startsWith('anthropic/')) return model.slice('anthropic/'.length)
  return model
}

function resolvedDescription(agent: AgentRow, primaryContent: string): string {
  const explicit = agent.description?.trim()
  if (explicit) return explicit
  return deriveDescription(primaryContent)
}

export function previewSubagentFile(agent: AgentRow, primaryContent: string): string {
  const data: Record<string, unknown> = {
    name: agent.handle,
    description: resolvedDescription(agent, primaryContent),
  }
  const tools = parseAgentTools(agent.tools)
  if (tools !== null) {
    data.tools = tools.join(', ')
  }
  const claudeModel = modelForClaudeFrontmatter(agent.model)
  if (claudeModel !== null) {
    data.model = claudeModel
  }
  return matter.stringify(primaryContent, data)
}

export function previewSlashCommandFile(agent: AgentRow, primaryContent: string): string {
  const data: Record<string, unknown> = {
    description: resolvedDescription(agent, primaryContent),
  }
  if (agent.argument_hint && agent.argument_hint.trim().length > 0) {
    data['argument-hint'] = agent.argument_hint
  }
  return matter.stringify(primaryContent, data)
}

// ── Sync result types ───────────────────────────────────────────────

export type SyncOutcome =
  | { status: 'written'; path: string }
  | { status: 'deleted'; path: string }
  | { status: 'skipped' }
  | { status: 'conflict'; path: string }
  | { status: 'error'; path: string; message: string }

export interface SyncResult {
  subagent: SyncOutcome
  slashCommand: SyncOutcome
}

export interface SyncContext {
  oldHandle?: string         // when set, indicates a handle rename — delete the old-handle file first
  forceOverwrite?: boolean   // honored only when the toggle flips ON for the first time
}

// ── Sync ────────────────────────────────────────────────────────────

export async function syncAgentToDisk(
  agent: AgentRow,
  primaryContent: string,
  ctx: SyncContext = {},
): Promise<SyncResult> {
  const [subagent, slashCommand] = await Promise.all([
    syncOneSurface({
      // Only Anthropic agents sync to .claude/agents/. Other providers
      // (openai, google, opencode, openai-compatible) either have no CLI
      // runtime (openai/google/openai-compatible) or have their own sync
      // target landing in Phase 6 (opencode → .opencode/agents/).
      enabled: agent.is_subagent === 1 && agent.model_provider === 'anthropic',
      currentPath: subagentPath(agent.handle),
      oldPath: ctx.oldHandle ? subagentPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_subagent_at,
      content: () => previewSubagentFile(agent, primaryContent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
    syncOneSurface({
      enabled: agent.is_slash_command === 1,
      currentPath: slashCommandPath(agent.handle),
      oldPath: ctx.oldHandle ? slashCommandPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_slash_command_at,
      content: () => previewSlashCommandFile(agent, primaryContent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
  ])
  return { subagent, slashCommand }
}

interface SurfaceParams {
  enabled: boolean
  currentPath: string
  oldPath: string | null
  syncedAt: string | null
  content: () => string
  forceOverwrite: boolean
}

async function syncOneSurface(p: SurfaceParams): Promise<SyncOutcome> {
  const renamed = p.oldPath !== null && p.oldPath !== p.currentPath
  const owned = p.syncedAt !== null

  // Step 1: clean up the old-handle file if the handle changed AND we
  // previously owned a file at it. Skipping the delete when syncedAt is null
  // is critical — otherwise a rename clobbers a hand-authored file that
  // happens to share the old handle.
  if (renamed && owned) {
    try {
      await fs.rm(p.oldPath!, { force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', path: p.oldPath!, message }
    }
  }

  // Step 2: surface disabled — delete (or skip if never owned).
  if (!p.enabled) {
    if (!owned && !renamed) {
      return { status: 'skipped' }
    }
    try {
      await fs.rm(p.currentPath, { force: true })
      return { status: 'deleted', path: p.currentPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', path: p.currentPath, message }
    }
  }

  // Step 3: surface enabled — first-time conflict check.
  if (p.syncedAt === null && !p.forceOverwrite) {
    const exists = await fileExists(p.currentPath)
    if (exists) return { status: 'conflict', path: p.currentPath }
  }

  // Step 4: write.
  try {
    await fs.mkdir(path.dirname(p.currentPath), { recursive: true })
    await fs.writeFile(p.currentPath, p.content(), 'utf-8')
    return { status: 'written', path: p.currentPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', path: p.currentPath, message }
  }
}

// ── Cleanup (for delete-agent flows) ────────────────────────────────

export async function cleanupAgentFiles(
  handle: string,
  opts: { cleanSubagent: boolean; cleanSlashCommand: boolean },
): Promise<{ subagent: SyncOutcome; slashCommand: SyncOutcome }> {
  const subagent: SyncOutcome = opts.cleanSubagent
    ? await deleteSurfaceFile(subagentPath(handle))
    : { status: 'skipped' }
  const slashCommand: SyncOutcome = opts.cleanSlashCommand
    ? await deleteSurfaceFile(slashCommandPath(handle))
    : { status: 'skipped' }
  return { subagent, slashCommand }
}

async function deleteSurfaceFile(p: string): Promise<SyncOutcome> {
  try {
    await fs.rm(p, { force: true })
    return { status: 'deleted', path: p }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', path: p, message }
  }
}
