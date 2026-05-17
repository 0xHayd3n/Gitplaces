// Builds the vendored anatomy packages from source.
// @anatomy/cli depends on sibling @anatomy/validate (file:../anatomy-validate),
// so validate must be built first. Each package: install deps then `npm run build`
// (prebuild + tsc). Uses ambient npm (host Node must be >=22; verified here).
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANATOMY = join(ROOT, 'vendor', 'anatomy')

const major = Number(process.versions.node.split('.')[0])
if (major < 22) { console.error(`[build-anatomy] need Node >=22 to build, have ${process.versions.node}`); process.exit(1) }
if (!existsSync(join(ANATOMY, 'anatomy-cli'))) {
  console.error('[build-anatomy] submodule missing — run: git submodule update --init --recursive')
  process.exit(1)
}

const isWin = process.platform === 'win32'
const npm = (args, cwd) => execFileSync('npm', args, { cwd, stdio: 'inherit', shell: isWin })

function buildPkg(pkg) {
  const cwd = join(ANATOMY, pkg)
  console.log(`[build-anatomy] installing ${pkg}`)
  try {
    npm(['ci', '--no-audit', '--no-fund'], cwd)
  } catch {
    console.log(`[build-anatomy] npm ci failed for ${pkg}, falling back to npm install`)
    npm(['install', '--no-audit', '--no-fund'], cwd)
  }
  console.log(`[build-anatomy] building ${pkg}`)
  npm(['run', 'build'], cwd)
}

buildPkg('anatomy-validate')
buildPkg('anatomy-cli')

const binJs = join(ANATOMY, 'anatomy-cli', 'dist', 'bin.js')
if (!existsSync(binJs)) { console.error(`[build-anatomy] expected build output missing: ${binJs}`); process.exit(1) }
console.log(`[build-anatomy] built ${binJs}`)
