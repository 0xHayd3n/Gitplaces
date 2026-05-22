// electron/anatomy/clone.ts
import { join, dirname } from 'node:path'
import { mkdir, readdir, stat, rm, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const safe = (s: string) => s.replace(/[^\w.-]/g, '_')

export function cacheDirFor(root: string, owner: string, name: string, sha: string): string {
  return join(root, safe(owner), `${safe(name)}@${safe(sha)}`)
}

export function exceedsCeiling(githubSizeKb: number, maxBytes: number): boolean {
  return githubSizeKb * 1024 > maxBytes
}

export interface CacheEntry { dir: string; bytes: number; mtimeMs: number }

export function selectEvictions(
  entries: CacheEntry[], budgetBytes: number, maxAgeMs: number, now: number,
): string[] {
  const evict = new Set<string>()
  for (const e of entries) if (now - e.mtimeMs > maxAgeMs) evict.add(e.dir)
  const live = entries.filter(e => !evict.has(e.dir)).sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = live.reduce((s, e) => s + e.bytes, 0)
  for (const e of live) {
    if (total <= budgetBytes) break
    evict.add(e.dir); total -= e.bytes
  }
  return entries.filter(e => evict.has(e.dir)).map(e => e.dir)
}

/** Runs `git <args>` in `cwd`; returns stdout. Throws on non-zero exit. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

const defaultGitRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  })
  return stdout
}

export interface CloneResult { dir: string; sha: string }

/**
 * Shallow (depth:1) clone via native git. Previously used isomorphic-git, which
 * fans out parallel file writes via Promise.allSettled and reliably hits
 * EMFILE on large monorepos (mui/material-ui, kubernetes, etc. — ~40k+ files
 * on Windows). Native git serialises checkout properly.
 */
export async function ensureClone(
  cacheRoot: string, owner: string, name: string, branch: string, token: string | null,
  gitRunner: GitRunner = defaultGitRunner,
): Promise<CloneResult> {
  const tmp = join(cacheRoot, safe(owner), `${safe(name)}@pending-${Date.now()}`)
  await mkdir(dirname(tmp), { recursive: true })

  let promoted = false
  try {
    const url = token
      ? `https://x-access-token:${token}@github.com/${owner}/${name}.git`
      : `https://github.com/${owner}/${name}.git`
    await gitRunner(
      ['clone', '--depth=1', '--single-branch', '--branch', branch, url, tmp],
      dirname(tmp),
    )
    const sha = (await gitRunner(['rev-parse', 'HEAD'], tmp)).trim()
    const finalDir = cacheDirFor(cacheRoot, owner, name, sha)
    await rm(finalDir, { recursive: true, force: true })
    await rename(tmp, finalDir)
    promoted = true
    return { dir: finalDir, sha }
  } finally {
    if (!promoted) {
      await rm(tmp, { recursive: true, force: true })
        .catch(err => console.warn(`[anatomy clone] cleanup failed for ${tmp}:`, (err as Error).message))
    }
  }
}

export async function dirBytes(dir: string): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    total += e.isDirectory() ? await dirBytes(p) : (await stat(p)).size
  }
  return total
}
