// electron/anatomy/runtime.ts
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

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

export interface SpawnAnatomyOptions {
  /** Called synchronously after spawn so callers can track / cancel the process. */
  onProcess?: (proc: ChildProcess) => void
}

const MAX_BUFFER_BYTES = 32 * 1024 * 1024
// 15-minute ceiling. Must exceed the anatomy CLI's internal claude-cli
// per-attempt timeout (ANATOMY_CLAUDE_CLI_TIMEOUT_MS, set to 10min by
// index.ts:23) with headroom for pass-1 scan + render + I/O on large
// monorepos. Validate/render calls exit fast either way; this only
// increases the safety net.
const TIMEOUT_MS = 15 * 60_000

/** Spawn the vendored anatomy CLI under bundled Node 22. Arg array only — never a shell.
 *  Streams stdout/stderr into memory with a 32MB cap; matches the previous execFile contract. */
export function spawnAnatomy(
  rt: ResolvedRuntime,
  anatomyArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: SpawnAnatomyOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(rt.nodeBin, buildSpawnArgs(rt.cliEntry, anatomyArgs), { cwd, env })
    opts.onProcess?.(proc)

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let bufferOverflow = false

    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, TIMEOUT_MS)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_BUFFER_BYTES) { bufferOverflow = true; proc.kill('SIGKILL'); return }
      stdout += chunk.toString('utf8')
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_BUFFER_BYTES) { bufferOverflow = true; proc.kill('SIGKILL'); return }
      stderr += chunk.toString('utf8')
    })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (bufferOverflow) return reject(new Error('spawnAnatomy: stdout/stderr exceeded 32MB'))
      if (timedOut) return reject(new Error('spawnAnatomy: 15-minute timeout exceeded'))
      resolve({ stdout, stderr, code: code ?? 1 })
    })
  })
}
