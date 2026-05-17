// Provisions a Node >=22 runtime at vendor/node22/ for the anatomy engine.
//
// Phase 1 (dev/test; packaging deferred per spec §6/D9): if the host already
// runs Node >=22, copy that self-contained binary — no network, no archive
// extraction (Git-Bash GNU tar can't unzip and misreads `D:\` as a host).
// Pinned-version bundling for production packaging is a separate follow-up.
import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(ROOT, 'vendor', 'node22')
const isWin = process.platform === 'win32'
const binAbs = isWin ? join(dest, 'node.exe') : join(dest, 'bin', 'node')

if (existsSync(binAbs)) { console.log('[fetch-node22] present, skipping'); process.exit(0) }

const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  console.error(`[fetch-node22] host Node is ${process.versions.node} (<22).`)
  console.error('[fetch-node22] install Node >=22 and re-run, or vendor a Node 22 binary into vendor/node22/ manually.')
  process.exit(1)
}

mkdirSync(dirname(binAbs), { recursive: true })
rmSync(join(dest, 'dl.zip'), { force: true })
rmSync(join(dest, 'dl.tar.gz'), { force: true })
copyFileSync(process.execPath, binAbs)
if (!isWin) chmodSync(binAbs, 0o755)

console.log(`[fetch-node22] provisioned Node ${process.versions.node} -> ${binAbs}`)
