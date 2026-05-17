import { describe, it, expect, vi } from 'vitest'
import { generateViaAnatomy } from './index'
import type { AnatomyEngineDeps } from './index'

function deps(over: Partial<AnatomyEngineDeps>): AnatomyEngineDeps {
  return {
    ensureClone: vi.fn(async () => ({ dir: '/clone', sha: 'sha1' })),
    spawnAnatomy: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    readFile: vi.fn(async (p: string) =>
      p.endsWith('.anatomy') ? '[identity]\nform="lib"\n[generated]\ncommit="sha1"\nfingerprint="fp"\n'
      : p.endsWith('.anatomy-memory') ? 'anatomy_memory_version="0.2"\nrepo_fingerprint="fp"\n'
      : null),
    runtime: { nodeBin: '/n', cliEntry: '/c' },
    ...over,
  }
}

describe('generateViaAnatomy', () => {
  it('uses committed .anatomy when `validate --require` exits 0', async () => {
    const d = deps({ spawnAnatomy: vi.fn(async (_rt, args) => ({ stdout: '', stderr: '', code: args[0] === 'validate' ? 0 : 1 })) })
    const out = await generateViaAnatomy({ token: null, owner: 'o', name: 'n', defaultBranch: 'main' }, d)
    expect(out.source).toBe('committed')
    expect(out.content).toMatch(/\[identity\]/)
    expect(out.commit).toBe('sha1')
    const calls = (d.spawnAnatomy as any).mock.calls.map((c: any[]) => c[1][0])
    expect(calls).toContain('validate')
    expect(calls).not.toContain('generate')
  })

  it('generates with claude-cli when no committed .anatomy', async () => {
    const d = deps({ spawnAnatomy: vi.fn(async (_rt, args) => ({ stdout: '', stderr: '', code: args[0] === 'validate' ? 1 : 0 })) })
    const out = await generateViaAnatomy({ token: null, owner: 'o', name: 'n', defaultBranch: 'main' }, d)
    expect(out.source).toBe('generated')
    const gen = (d.spawnAnatomy as any).mock.calls.find((c: any[]) => c[1][0] === 'generate')
    expect(gen[1]).toEqual(expect.arrayContaining(['generate', '--ai', '--provider', 'claude-cli']))
  })

  it('falls back claude-cli → anthropic-http → pass1', async () => {
    const seq: string[][] = []
    const d = deps({
      spawnAnatomy: vi.fn(async (_rt, args) => {
        seq.push(args)
        if (args[0] === 'validate') return { stdout: '', stderr: '', code: 1 }
        if (args.includes('claude-cli')) return { stdout: '', stderr: 'no claude', code: 3 }
        if (args.includes('anthropic-http')) return { stdout: '', stderr: 'no key', code: 3 }
        return { stdout: '', stderr: '', code: 0 } // pass-1 (no --ai)
      }),
    })
    const out = await generateViaAnatomy({ token: null, owner: 'o', name: 'n', defaultBranch: 'main', apiKey: 'k' }, d)
    expect(out.source).toBe('generated')
    expect(out.warnings.join(' ')).toMatch(/deterministic/i)
    expect(seq.some(a => a.includes('claude-cli'))).toBe(true)
    expect(seq.some(a => a.includes('anthropic-http'))).toBe(true)
    expect(seq.some(a => a[0] === 'generate' && !a.includes('--ai'))).toBe(true)
  })

  it('throws a typed error if clone fails', async () => {
    const d = deps({ ensureClone: vi.fn(async () => { throw new Error('network') }) })
    await expect(generateViaAnatomy({ token: null, owner: 'o', name: 'n', defaultBranch: 'main' }, d))
      .rejects.toThrow(/anatomy clone failed/i)
  })

  it('runs verification and attaches + surfaces the parsed result', async () => {
    const d = deps({
      spawnAnatomy: vi.fn(async (_rt, args) => {
        if (args[0] === 'validate' && args.includes('--json')) {
          return { stdout: JSON.stringify({ ok: true, errors: [], warnings: ['w1'] }), stderr: '', code: 0 }
        }
        if (args[0] === 'validate') return { stdout: '', stderr: '', code: 0 } // committed-path probe
        return { stdout: '', stderr: '', code: 0 }
      }),
    })
    const out = await generateViaAnatomy({ token: null, owner: 'o', name: 'n', defaultBranch: 'main' }, d)
    expect(out.verify).not.toBeNull()
    expect(out.verify!.ok).toBe(true)
    expect(out.warnings.join(' ')).toMatch(/w1/)
  })
})
