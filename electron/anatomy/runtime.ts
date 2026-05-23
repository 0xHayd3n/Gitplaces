// electron/anatomy/runtime.ts
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export interface RuntimeOpts {
  packaged: boolean
  platform: NodeJS.Platform
  repoRoot?: string
  resourcesPath?: string
}

export interface ResolvedRuntime { nodeBin: string; cliEntry: string }

export function resolveAnatomyRuntime(o: RuntimeOpts): ResolvedRuntime {
  const base = o.packaged ? (o.resourcesPath ?? '') : join(o.repoRoot ?? '', 'vendor')
  const node22Root = join(base, 'node22')
  const nodeBin = o.platform === 'win32'
    ? join(node22Root, 'node.exe')
    : join(node22Root, 'bin', 'node')
  const cliEntry = join(base, 'anatomy', 'anatomy-cli', 'dist', 'bin.js')
  return { nodeBin, cliEntry }
}

export function buildSpawnArgs(cliEntry: string, anatomyArgs: string[]): string[] {
  return [cliEntry, ...anatomyArgs]
}

export interface SpawnResult { stdout: string; stderr: string; code: number }

/** Spawn the vendored anatomy CLI under bundled Node 22. Arg array only — never a shell. */
export function spawnAnatomy(
  rt: ResolvedRuntime,
  anatomyArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    // 15-minute ceiling. Must exceed the anatomy CLI's internal claude-cli
    // per-attempt timeout (ANATOMY_CLAUDE_CLI_TIMEOUT_MS, set to 10min by
    // index.ts:23) with headroom for pass-1 scan + render + I/O on large
    // monorepos. Validate/render calls exit fast either way; this only
    // increases the safety net.
    execFile(
      rt.nodeBin,
      buildSpawnArgs(rt.cliEntry, anatomyArgs),
      { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as unknown as { code: number }).code : err ? 1 : 0
        if (err && code === 0) return reject(err) // spawn-level failure (ENOENT etc.)
        resolve({ stdout: String(stdout), stderr: String(stderr), code })
      },
    )
  })
}
