// electron/anatomy/verify.ts
import type { ResolvedRuntime, SpawnResult } from './runtime'
import type { AnatomyVerifyResult, AnatomyRuleResult } from './types'

export interface VerifyDeps {
  runtime: ResolvedRuntime
  spawnAnatomy: (rt: ResolvedRuntime, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<SpawnResult>
}

// Real `anatomy validate --json` emits errors/warnings as objects
// { code, message, pointer } (not strings) and has no top-level rules[].
// Rule-skip signals appear as warnings, e.g.
// { code: "verify-semgrep-unavailable", message: "...Rule skipped.", pointer: "/rules/1/verify" }.
interface Issue { code?: string; message?: string; pointer?: string }

function messageOf(x: unknown): string {
  if (typeof x === 'string') return x
  if (x && typeof x === 'object') {
    const o = x as Issue
    if (typeof o.message === 'string') return o.message
    return JSON.stringify(x)
  }
  return String(x)
}

function normList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(messageOf) : []
}

function collectSkips(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const skips: string[] = []
  for (const w of v) {
    if (!w || typeof w !== 'object') continue
    const { code, message } = w as Issue
    const c = code ?? ''
    const m = message ?? ''
    if (/^verify-.*-unavailable$/.test(c) || /rule skipped/i.test(m)) {
      skips.push(c === 'verify-semgrep-unavailable' ? 'semgrep not installed' : (code ?? m))
    }
  }
  return skips
}

export function parseValidateJson(stdout: string, code: number): AnatomyVerifyResult {
  let raw: Record<string, unknown> | null = null
  try { raw = JSON.parse(stdout) as Record<string, unknown> } catch { raw = null }

  if (!raw) {
    return {
      ok: code === 0,
      errors: code === 0 ? [] : [`anatomy validate exited ${code} with non-JSON output`],
      warnings: [], rules: [], skipped: [],
    }
  }

  const errors = normList(raw.errors)
  const warnings = normList(raw.warnings)
  const skipped = collectSkips(raw.warnings)

  // This CLI version has no structured rules[]; keep a defensive read in case
  // a future/other path emits one (entries: { statement, kind, passed, skipped }).
  const rules: AnatomyRuleResult[] = Array.isArray(raw.rules)
    ? (raw.rules as Array<Record<string, unknown>>).map(rule => {
        const kind = typeof rule.kind === 'string' ? rule.kind : 'unknown'
        const statement = typeof rule.statement === 'string' ? rule.statement : ''
        const skip = typeof rule.skipped === 'string' ? rule.skipped : undefined
        if (skip) skipped.push(skip)
        const status: AnatomyRuleResult['status'] =
          skip ? 'unverified' : rule.passed === false ? 'fail' : 'pass'
        return { statement, kind, status, ...(typeof rule.detail === 'string' ? { detail: rule.detail } : {}) }
      })
    : []

  const ok = typeof raw.ok === 'boolean' ? raw.ok : (code === 0 && errors.length === 0)
  return { ok, errors, warnings, rules, skipped }
}

export async function runAnatomyVerify(d: VerifyDeps, dir: string): Promise<AnatomyVerifyResult> {
  // --no-strict: demote source-cross-check warnings (unused-dependency-claim,
  // literal-not-in-source) to non-fatal so verification never blocks generation.
  try {
    const r = await d.spawnAnatomy(d.runtime, ['validate', '--json', '--no-strict'], dir)
    return parseValidateJson(r.stdout, r.code)
  } catch (err) {
    return {
      ok: false,
      errors: [`anatomy verify failed: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [], rules: [], skipped: [],
    }
  }
}
