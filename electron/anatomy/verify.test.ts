import { describe, it, expect, vi } from 'vitest'
import { runAnatomyVerify, parseValidateJson } from './verify'
import type { ResolvedRuntime } from './runtime'

const rt: ResolvedRuntime = { nodeBin: '/n', cliEntry: '/c' }

// Shapes below mirror the REAL `anatomy validate --json --no-strict` output
// observed from the vendored CLI (probed during implementation):
//   { ok, found, path, memory, errors:[], warnings:[{code,message,pointer}] }

describe('parseValidateJson', () => {
  it('maps a passing report (real trivial-repo shape)', () => {
    const r = parseValidateJson(
      JSON.stringify({ ok: true, found: true, path: './.anatomy', memory: { found: false }, errors: [], warnings: [] }),
      0,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.skipped).toEqual([])
  })

  it('extracts .message from object errors/warnings and flags ok=false', () => {
    const r = parseValidateJson(JSON.stringify({
      ok: false,
      errors: [{ code: 'identity-integrity', message: 'fingerprint mismatch', pointer: '/generated' }],
      warnings: [{ code: 'description-too-long', message: 'description exceeds 500 characters', pointer: '/description' }],
    }), 1)
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['fingerprint mismatch'])
    expect(r.warnings).toEqual(['description exceeds 500 characters'])
  })

  it('captures the semgrep-unavailable warning as a skip (graceful)', () => {
    const r = parseValidateJson(JSON.stringify({
      ok: true, errors: [],
      warnings: [{
        code: 'verify-semgrep-unavailable',
        message: 'verify rule with kind="semgrep" requires the semgrep binary on PATH. Rule skipped.',
        pointer: '/rules/1/verify',
      }],
    }), 0)
    expect(r.ok).toBe(true)
    expect(r.skipped).toContain('semgrep not installed')
  })

  it('still handles a hypothetical structured rules[] defensively', () => {
    const r = parseValidateJson(JSON.stringify({
      ok: false, errors: [],
      rules: [{ statement: 'use ast', kind: 'ast-grep', passed: false, detail: 'matched 2' }],
    }), 1)
    expect(r.rules[0]).toEqual({ statement: 'use ast', kind: 'ast-grep', status: 'fail', detail: 'matched 2' })
  })

  it('falls back to a tolerant shape on non-JSON stdout', () => {
    const r = parseValidateJson('not json at all', 1)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
})

describe('runAnatomyVerify', () => {
  it('spawns `validate --json --no-strict` in the clone dir and parses stdout', async () => {
    const spawn = vi.fn(async () => ({ stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }), stderr: '', code: 0 }))
    const r = await runAnatomyVerify({ runtime: rt, spawnAnatomy: spawn }, '/clone')
    expect(spawn).toHaveBeenCalledWith(rt, ['validate', '--json', '--no-strict'], '/clone')
    expect(r.ok).toBe(true)
  })

  it('never throws — a spawn failure becomes an unverified result', async () => {
    const spawn = vi.fn(async () => { throw new Error('ENOENT') })
    const r = await runAnatomyVerify({ runtime: rt, spawnAnatomy: spawn }, '/clone')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/verify failed/i)
  })
})
