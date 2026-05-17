// electron/anatomy/types.ts

/** Parsed, read-only view of a .anatomy file — UI/metadata ONLY, never reshapes served content. */
export interface AnatomyModel {
  identity: { stack?: string; form?: string; domain?: string; function?: string; [k: string]: unknown }
  generated: { fingerprint?: string; commit?: string; at?: string; by?: string; [k: string]: unknown }
  operation?: Record<string, unknown>
  substance?: Record<string, unknown>
  rules: Array<{ statement: string; verify?: { kind: string; [k: string]: unknown } }>
  decisions: Array<{ decision: string; rationale?: string; [k: string]: unknown }>
}

export interface MemoryEntry {
  text: string
  kind?: string
  at?: string
  superseded?: boolean
  last_verified_at?: string
  verified_by?: string
  [k: string]: unknown
}

export interface AnatomyGenerateInput {
  token: string | null
  owner: string
  name: string
  defaultBranch: string
  /** Anthropic key from electron-store; enables the anthropic-http provider fallback. */
  apiKey?: string
}

/** Verbatim payloads + provenance. `content` is the raw .anatomy text — the served payload. */
export interface AnatomyGenerateOutput {
  content: string
  memory: string | null
  brief: string
  commit: string | null
  fingerprint: string | null
  source: 'committed' | 'generated'
  /** Non-fatal notices surfaced to the existing skill-gen warning UI. */
  warnings: string[]
  /** Rule-verification summary (Phase 2); null if verification could not run. */
  verify: AnatomyVerifyResult | null
}

export interface AnatomyRuleResult {
  statement: string
  kind: string            // 'glob' | 'ast-grep' | 'semgrep' | string
  status: 'pass' | 'fail' | 'unverified'
  detail?: string
}

export interface AnatomyVerifyResult {
  ok: boolean             // overall: no hard validation errors
  errors: string[]
  warnings: string[]
  rules: AnatomyRuleResult[]
  skipped: string[]       // e.g. ['semgrep not installed']
}
