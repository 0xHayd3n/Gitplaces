// electron/anatomy/index.ts
import { join } from 'node:path'
import { readFile as fsReadFile, writeFile, mkdir } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { parseAnatomy, parseMemory } from './parse'
import { runAnatomyVerify } from './verify'
import type { ResolvedRuntime, SpawnResult } from './runtime'
import type { AnatomyGenerateInput, AnatomyGenerateOutput } from './types'

export type AnatomyPhase = 'cloning' | 'validating' | 'generating' | 'verifying' | 'persisting'

export interface AnatomyEngineDeps {
  ensureClone: (root: string, owner: string, name: string, branch: string, token: string | null) => Promise<{ dir: string; sha: string }>
  spawnAnatomy: (rt: ResolvedRuntime, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<SpawnResult>
  readFile: (p: string) => Promise<string | null>
  runtime: ResolvedRuntime
  /** Optional progress callback invoked at the start of each phase. */
  onProgress?: (phase: AnatomyPhase) => void
}

const BRIEF_BUDGET = 1500

async function tryGenerate(
  d: AnatomyEngineDeps, dir: string, apiKey?: string,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []
  // 10-minute ceiling for the claude-cli provider's per-attempt timeout.
  // Default in the anatomy CLI is 120s, which routinely tips over on
  // medium-large monorepos (e.g. mui/material-ui's pass-1 context).
  // Env-var override is honoured by anatomy CLI 1.0.1+ (ANATOMY_CLAUDE_CLI_TIMEOUT_MS).
  const env = {
    ...process.env,
    ANATOMY_CLAUDE_CLI_TIMEOUT_MS: '600000',
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  }
  // 1. claude-cli (no key)
  let r = await d.spawnAnatomy(d.runtime, ['generate', '--ai', '--provider', 'claude-cli', '--repo', dir], dir, env)
  if (r.code === 0) return { warnings }
  // 2. anthropic-http (needs key)
  if (apiKey) {
    r = await d.spawnAnatomy(d.runtime, ['generate', '--ai', '--provider', 'anthropic-http', '--repo', dir], dir, env)
    if (r.code === 0) { warnings.push('anatomy: generated via Anthropic API (Claude Code unavailable)'); return { warnings } }
  }
  // 3. Pass-1 deterministic (no --ai) — always produces a valid .anatomy
  r = await d.spawnAnatomy(d.runtime, ['generate', '--repo', dir], dir, env)
  if (r.code !== 0) throw new Error(`anatomy generate failed (all providers): ${r.stderr.slice(0, 500)}`)
  warnings.push('anatomy: AI enrichment unavailable — used deterministic Pass-1 (lower richness)')
  return { warnings }
}

export async function generateViaAnatomy(
  input: AnatomyGenerateInput,
  d: AnatomyEngineDeps,
  cacheRoot = join(process.cwd(), '.anatomy-cache'),
): Promise<AnatomyGenerateOutput> {
  const { token, owner, name, defaultBranch, apiKey } = input
  const emit = (phase: AnatomyPhase) => { try { d.onProgress?.(phase) } catch {} }

  emit('cloning')
  let clone: { dir: string; sha: string }
  try {
    clone = await d.ensureClone(cacheRoot, owner, name, defaultBranch, token)
  } catch (err) {
    throw new Error(`anatomy clone failed for ${owner}/${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const warnings: string[] = []
  let source: 'committed' | 'generated'

  emit('validating')
  const v = await d.spawnAnatomy(d.runtime, ['validate', '--require'], clone.dir)
  if (v.code === 0) {
    source = 'committed'
  } else {
    source = 'generated'
    emit('generating')
    const g = await tryGenerate(d, clone.dir, apiKey)
    warnings.push(...g.warnings)
  }

  const content = await d.readFile(join(clone.dir, '.anatomy'))
  if (content === null) throw new Error(`anatomy: no .anatomy produced for ${owner}/${name}`)
  const memory = await d.readFile(join(clone.dir, '.anatomy-memory'))

  const model = parseAnatomy(content)
  parseMemory(memory) // validate memory parses; surfaced in Phase 2 UI

  const briefRes = await d.spawnAnatomy(d.runtime, ['render', '--budget', String(BRIEF_BUDGET)], clone.dir)
  const brief = briefRes.code === 0 && briefRes.stdout.trim() ? briefRes.stdout : content

  emit('verifying')
  // Rule verification (spec D5): surface errors + warnings + skipped into the
  // existing skill-gen warnings array. Never blocks generation.
  const verify = await runAnatomyVerify({ runtime: d.runtime, spawnAnatomy: d.spawnAnatomy }, clone.dir)
  for (const e of verify.errors) warnings.push(`anatomy verify error: ${e}`)
  for (const w of verify.warnings) warnings.push(`anatomy verify: ${w}`)
  for (const s of verify.skipped) warnings.push(`anatomy verify: ${s} (rule unverified)`)

  return {
    content,
    memory,
    brief,
    commit: (model.generated.commit as string | undefined) ?? clone.sha ?? null,
    fingerprint: (model.generated.fingerprint as string | undefined) ?? null,
    source,
    warnings,
    verify,
  }
}

/** Persist verbatim — mirrors the legacy library path in main.ts:1506-1530. */
export async function persistAnatomySkill(
  db: Database.Database, userDataDir: string, repoId: string, owner: string, name: string,
  out: AnatomyGenerateOutput, version: string,
): Promise<void> {
  const dir = join(userDataDir, 'anatomy', owner, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '.anatomy'), out.content, 'utf8')
  if (out.memory) await writeFile(join(dir, '.anatomy-memory'), out.memory, 'utf8')
  const generated_at = new Date().toISOString()
  db.prepare(`
    INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier,
                        anatomy_memory, anatomy_commit, anatomy_fingerprint, anatomy_source, anatomy_brief, anatomy_verify, github_sha)
    VALUES (?, '.anatomy', ?, ?, ?, 1, NULL, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id) DO UPDATE SET
      filename=excluded.filename, content=excluded.content, version=excluded.version,
      generated_at=excluded.generated_at, anatomy_memory=excluded.anatomy_memory,
      anatomy_commit=excluded.anatomy_commit, anatomy_fingerprint=excluded.anatomy_fingerprint,
      anatomy_source=excluded.anatomy_source, anatomy_brief=excluded.anatomy_brief,
      anatomy_verify=excluded.anatomy_verify, github_sha=excluded.github_sha
  `).run(repoId, out.content, version, generated_at, out.memory, out.commit, out.fingerprint,
         out.source, out.brief, out.verify ? JSON.stringify(out.verify) : null, out.commit)
}

export const readFileOrNull = async (p: string): Promise<string | null> =>
  fsReadFile(p, 'utf8').catch(() => null)
