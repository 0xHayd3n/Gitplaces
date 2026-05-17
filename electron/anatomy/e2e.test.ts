import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureClone } from './clone'
import { spawnAnatomy } from './runtime'
import { generateViaAnatomy, readFileOrNull } from './index'

const node = process.platform === 'win32'
  ? join(process.cwd(), 'vendor', 'node22', 'node.exe')
  : join(process.cwd(), 'vendor', 'node22', 'bin', 'node')
const cli = join(process.cwd(), 'vendor', 'anatomy', 'anatomy-cli', 'dist', 'bin.js')
const token = process.env.GITHUB_TOKEN ?? null
// Network gate: anonymous multi-clone is GitHub-rate-limited (spurious 401s),
// so the real-repo e2e requires a token to be deterministic. Without one it
// skips — the engine's generated/fallback paths are covered by index.test.ts.
const runnable = existsSync(node) && existsSync(cli) && !!token
const runtime = { nodeBin: node, cliEntry: cli }

describe.runIf(runnable)('anatomy engine e2e (network + vendored CLI)', () => {
  // [label, owner, repo, defaultBranch] — branch must match the repo's real
  // default (express uses master, not main).
  const cases: Array<[string, string, string, string]> = [
    ['committed-anatomy', '0xHayd3n', 'anatomy', 'main'],
    ['generated-small', 'sindresorhus', 'is-odd', 'main'],
    ['edge-large', 'expressjs', 'express', 'master'],
  ]
  for (const [label, owner, name, branch] of cases) {
    it(`produces a verbatim .anatomy for ${label} (${owner}/${name})`, async () => {
      const cacheRoot = mkdtempSync(join(tmpdir(), 'an-e2e-'))
      const out = await generateViaAnatomy(
        { token, owner, name, defaultBranch: branch },
        { ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime }, cacheRoot,
      )
      expect(out.content).toMatch(/\[identity\]/)
      expect(out.content).toMatch(/\[generated\]/)
      expect(['committed', 'generated']).toContain(out.source)
      expect(out.brief.length).toBeGreaterThan(0)
    }, 180_000)
  }
})
