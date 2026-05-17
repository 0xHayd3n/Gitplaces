import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAnatomyRuntime, buildSpawnArgs, spawnAnatomy } from './runtime'

describe('resolveAnatomyRuntime', () => {
  it('resolves dev paths from a given repo root', () => {
    const r = resolveAnatomyRuntime({ packaged: false, repoRoot: '/repo', platform: 'linux' })
    expect(r.nodeBin).toBe(join('/repo', 'vendor', 'node22', 'bin', 'node'))
    expect(r.cliEntry).toBe(join('/repo', 'vendor', 'anatomy', 'anatomy-cli', 'dist', 'index.js'))
  })

  it('uses node.exe on win32', () => {
    const r = resolveAnatomyRuntime({ packaged: false, repoRoot: 'C:\\repo', platform: 'win32' })
    expect(r.nodeBin).toBe(join('C:\\repo', 'vendor', 'node22', 'node.exe'))
  })

  it('resolves packaged paths under resourcesPath', () => {
    const r = resolveAnatomyRuntime({ packaged: true, resourcesPath: '/app/resources', platform: 'linux' })
    expect(r.cliEntry).toBe(join('/app/resources', 'anatomy', 'anatomy-cli', 'dist', 'index.js'))
  })
})

describe('buildSpawnArgs', () => {
  it('prepends the CLI entry to anatomy args', () => {
    expect(buildSpawnArgs('/x/cli.js', ['generate', '--ai'])).toEqual(['/x/cli.js', 'generate', '--ai'])
  })
})

const cli = join(process.cwd(), 'vendor', 'anatomy', 'anatomy-cli', 'dist', 'index.js')
const node = process.platform === 'win32'
  ? join(process.cwd(), 'vendor', 'node22', 'node.exe')
  : join(process.cwd(), 'vendor', 'node22', 'bin', 'node')
const vendored = existsSync(cli) && existsSync(node)

describe.runIf(vendored)('spawnAnatomy (vendored)', () => {
  it('runs `--help` and exits 0', async () => {
    const r = await spawnAnatomy({ nodeBin: node, cliEntry: cli }, ['--help'], process.cwd())
    expect(r.code).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/generate|validate|render/)
  }, 30_000)
})
