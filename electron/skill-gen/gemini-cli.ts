import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'path'
import * as os from 'os'
import { buildEnv } from './legacy'

export function findGeminiBinary(): string | null {
  const candidates: string[] = []
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(appdata, 'npm', 'gemini.cmd'),
      path.join(appdata, 'npm', 'gemini.exe'),
      path.join(appdata, 'npm', 'node_modules', '@google', 'gemini-cli', 'bin', 'gemini.cmd'),
    )
  } else {
    candidates.push(
      '/usr/local/bin/gemini',
      '/opt/homebrew/bin/gemini',
      path.join(home, '.npm-global', 'bin', 'gemini'),
    )
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export async function detectGemini(): Promise<boolean> {
  return findGeminiBinary() !== null
}

/**
 * Gemini CLI stores OAuth creds in ~/.gemini/. The exact filename has shifted
 * over releases (oauth_creds.json, credentials.json). Treat the presence of
 * any credential-looking file in that dir as "logged in".
 */
export async function checkGeminiAuthStatus(): Promise<boolean> {
  if (!findGeminiBinary()) return false
  const dir = path.join(os.homedir(), '.gemini')
  try {
    const files = await fs.readdir(dir)
    return files.some(f =>
      f.endsWith('creds.json') || f === 'credentials.json' || f === 'oauth_creds.json',
    )
  } catch {
    return false
  }
}

export async function installGeminiCLI(
  onProgress: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', '@google/gemini-cli'], {
      env: buildEnv(true),
      shell: process.platform === 'win32',
    })
    proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`gemini-cli install failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Trigger Gemini's interactive OAuth login. The CLI typically opens a browser
 * on first invocation; we run it briefly and poll for credentials. Subcommand
 * names may vary across versions — adapt if needed.
 */
export async function loginGemini(
  onProgress: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const bin = findGeminiBinary()
  if (!bin) return { ok: false, error: 'Gemini CLI not installed' }
  onProgress('Starting Gemini login flow…')

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
    if (await checkGeminiAuthStatus()) {
      try { proc.kill() } catch { /* best-effort */ }
      onProgress('Login successful.')
      return { ok: true }
    }
  }
  try { proc.kill() } catch { /* best-effort */ }
  return { ok: false, error: 'Login timed out after 3 minutes' }
}

export async function logoutGemini(): Promise<void> {
  const dir = path.join(os.homedir(), '.gemini')
  try {
    const files = await fs.readdir(dir)
    await Promise.all(
      files
        .filter(f => f.endsWith('creds.json') || f === 'credentials.json' || f === 'oauth_creds.json')
        .map(f => fs.rm(path.join(dir, f), { force: true })),
    )
  } catch {
    // best-effort
  }
}
