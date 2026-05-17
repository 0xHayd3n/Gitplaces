// electron/anatomy/clone.ts
import { join } from 'node:path'
import { mkdir, readdir, stat, rm } from 'node:fs/promises'
import http from 'isomorphic-git/http/node'
import git from 'isomorphic-git'
import * as fs from 'node:fs'

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

export interface CloneResult { dir: string; sha: string }

/** Shallow (depth:1) clone via isomorphic-git — produces a real .git anatomy can read. */
export async function ensureClone(
  cacheRoot: string, owner: string, name: string, branch: string, token: string | null,
): Promise<CloneResult> {
  const tmp = join(cacheRoot, safe(owner), `${safe(name)}@pending-${Date.now()}`)
  await mkdir(tmp, { recursive: true })
  await git.clone({
    fs, http, dir: tmp,
    url: `https://github.com/${owner}/${name}.git`,
    ref: branch, singleBranch: true, depth: 1,
    onAuth: () => (token ? { username: token } : {}),
  })
  const sha = await git.resolveRef({ fs, dir: tmp, ref: 'HEAD' })
  const finalDir = cacheDirFor(cacheRoot, owner, name, sha)
  await rm(finalDir, { recursive: true, force: true })
  await mkdir(join(finalDir, '..'), { recursive: true })
  await (await import('node:fs/promises')).rename(tmp, finalDir)
  return { dir: finalDir, sha }
}

export async function dirBytes(dir: string): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    total += e.isDirectory() ? await dirBytes(p) : (await stat(p)).size
  }
  return total
}
