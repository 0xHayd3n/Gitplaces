import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'path'
import * as os from 'os'
import { buildEnv } from './legacy'

export function findCodexBinary(): string | null {
  const candidates: string[] = []
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(appdata, 'npm', 'codex.cmd'),
      path.join(appdata, 'npm', 'codex.exe'),
      path.join(appdata, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.cmd'),
    )
  } else {
    candidates.push(
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      path.join(home, '.npm-global', 'bin', 'codex'),
    )
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export async function detectCodex(): Promise<boolean> {
  return findCodexBinary() !== null
}

/**
 * Codex stores credentials in ~/.codex/. The presence of an auth.json /
 * credentials file means the user has logged in. Exact filename has varied
 * across releases.
 */
export async function checkCodexAuthStatus(): Promise<boolean> {
  if (!findCodexBinary()) return false
  const dir = path.join(os.homedir(), '.codex')
  try {
    const files = await fs.readdir(dir)
    return files.some(f =>
      f === 'auth.json' || f === 'credentials.json' || f.endsWith('creds.json'),
    )
  } catch {
    return false
  }
}

export async function installCodexCLI(
  onProgress: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', '@openai/codex'], {
      env: buildEnv(true),
      shell: process.platform === 'win32',
    })
    proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`codex install failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Trigger Codex login. Subcommand and flow may vary by version — current
 * versions launch a browser-based OAuth on `codex login`. We poll the
 * credentials path the same way the OpenCode flow does.
 */
export async function loginCodex(
  onProgress: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const bin = findCodexBinary()
  if (!bin) return { ok: false, error: 'Codex CLI not installed' }
  onProgress('Starting Codex login flow…')

  const proc = spawn(bin, ['login'], {
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
    if (await checkCodexAuthStatus()) {
      try { proc.kill() } catch { /* best-effort */ }
      onProgress('Login successful.')
      return { ok: true }
    }
  }
  try { proc.kill() } catch { /* best-effort */ }
  return { ok: false, error: 'Login timed out after 3 minutes' }
}

export async function logoutCodex(): Promise<void> {
  const dir = path.join(os.homedir(), '.codex')
  try {
    const files = await fs.readdir(dir)
    await Promise.all(
      files
        .filter(f => f === 'auth.json' || f === 'credentials.json' || f.endsWith('creds.json'))
        .map(f => fs.rm(path.join(dir, f), { force: true })),
    )
  } catch {
    // best-effort
  }
}
