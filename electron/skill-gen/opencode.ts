import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import * as path from 'path'
import * as os from 'os'
import { buildEnv } from './legacy'

/**
 * Find the OpenCode binary. Checks common install locations:
 * - npm global: $APPDATA/npm/opencode.cmd (Windows), /usr/local/bin/opencode (POSIX)
 * - $HOME/.opencode/bin/opencode (the curl-installer location)
 * - $APPDATA/npm/node_modules/opencode-ai/bin/opencode
 */
export function findOpenCodeBinary(): string | null {
  const candidates: string[] = []
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(appdata, 'npm', 'opencode.cmd'),
      path.join(appdata, 'npm', 'opencode.exe'),
      path.join(appdata, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.cmd'),
      path.join(home, '.opencode', 'bin', 'opencode.exe'),
    )
  } else {
    candidates.push(
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
      path.join(home, '.npm-global', 'bin', 'opencode'),
      path.join(home, '.opencode', 'bin', 'opencode'),
    )
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * Detect whether OpenCode is installed and runnable.
 */
export async function detectOpenCode(): Promise<boolean> {
  return findOpenCodeBinary() !== null
}

/**
 * Check whether OpenCode is authenticated. Spawns `opencode auth status --json`.
 * Returns false if the CLI is missing, exits non-zero, or reports loggedIn:false.
 *
 * Note (Phase 6): the exact subcommand may be `opencode auth status` without
 * `--json`, or it may print human-readable text. Adapt parsing if needed —
 * the function contract is just boolean.
 */
export async function checkOpenCodeAuthStatus(): Promise<boolean> {
  const bin = findOpenCodeBinary()
  if (!bin) return false
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    const proc = spawn(bin, ['auth', 'status', '--json'], { env: buildEnv(true) })
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('close', (code: number) => {
      if (code !== 0) return resolve(false)
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { loggedIn?: boolean }
        resolve(Boolean(parsed.loggedIn))
      } catch {
        // Fallback: treat any non-error output as "logged in" (best-effort
        // when the CLI's output format isn't JSON).
        resolve(Buffer.concat(chunks).length > 0)
      }
    })
    proc.on('error', () => resolve(false))
  })
}

/**
 * Install OpenCode via npm. Streams progress to the callback.
 */
export async function installOpenCodeCLI(
  onProgress: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', 'opencode-ai'], {
      env: buildEnv(true),
      shell: process.platform === 'win32',
    })
    proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`opencode install failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Trigger OpenCode's OAuth login flow.
 *
 * Implementation pattern mirrors `loginClaude` in legacy.ts: spawn via
 * node-pty to give the CLI a TTY (so its built-in OAuth-loopback flow
 * picks up the callback URL automatically). Poll `checkOpenCodeAuthStatus`
 * with a 3-minute timeout. The CLI's actual subcommand may be
 * `opencode auth login` (most likely) or `opencode login` — adapt during
 * implementation if Step 1's verification showed otherwise.
 */
export async function loginOpenCode(
  onProgress: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const bin = findOpenCodeBinary()
  if (!bin) return { ok: false, error: 'OpenCode CLI not installed' }
  onProgress('Starting OpenCode login flow…')

  // Best-effort: spawn the auth-login subcommand. Don't await — let it run
  // in the background while we poll auth status.
  const proc = spawn(bin, ['auth', 'login'], {
    env: buildEnv(true),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
  proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))

  const startedAt = Date.now()
  const timeoutMs = 3 * 60 * 1000
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000))
    if (await checkOpenCodeAuthStatus()) {
      try { proc.kill() } catch { /* best-effort */ }
      onProgress('Login successful.')
      return { ok: true }
    }
  }
  try { proc.kill() } catch { /* best-effort */ }
  return { ok: false, error: 'Login timed out after 3 minutes' }
}

/**
 * Log out of OpenCode.
 */
export async function logoutOpenCode(): Promise<void> {
  const bin = findOpenCodeBinary()
  if (!bin) return
  return new Promise(resolve => {
    const proc = spawn(bin, ['auth', 'logout'], { env: buildEnv(true) })
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* best-effort */ }
      resolve()
    }, 5000)
    proc.on('close', () => { clearTimeout(timer); resolve() })
    proc.on('error', () => { clearTimeout(timer); resolve() })
  })
}
