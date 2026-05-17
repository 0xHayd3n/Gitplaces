# Anatomy Engine — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rule verification, `.anatomy`-commit-pinned staleness, the Repo Detail anatomy UI (replacing depth bars for anatomy rows), and MCP search/collection support for anatomy-sourced skills — all flag-gated behind the Phase 1 `anatomyEngineEnabled`, legacy untouched.

**Architecture:** Verification runs the vendored `anatomy validate --json` at generation time and persists a JSON summary in a new `skills.anatomy_verify` column. Staleness replaces the Phase 1 `staleness.ts` stub with a `GET /commits?path=.anatomy` probe wired into `updateService.checkRepo` for anatomy rows, reusing the existing `repos.update_available`/`checkAll` machinery. The renderer never parses TOML — a new `skill:getAnatomy` IPC parses in main (reusing `electron/anatomy/parse.ts`) and passes a structured model to three new React components shown in the existing Repo Detail "Skills Folder" tab.

**Tech Stack:** Electron 31 (Node 20 main) · TypeScript · better-sqlite3 · vitest · @testing-library/react (jsdom) · the Phase-1 vendored anatomy CLI (`vendor/anatomy/anatomy-cli/dist/bin.js`, Node 22 at `vendor/node22/`).

**HEAD:** `1704eb2` (Phase 1 complete + the user's type-cleanup commits applied). Phase 1 delivered `electron/anatomy/{types,flag,parse,runtime,clone,index,staleness(STUB),e2e}.ts`, the `skills.anatomy_*` columns, the `anatomyEngineEnabled` flag + branch seam, `handleGetSkill` raw-payload branch, and the vendored CLI submodule. Do **not** redo Phase 1.

---

## Conventions (all tasks)

- **Branch:** work directly on `main`. No worktrees.
- **better-sqlite3 ABI dance:** the live Electron app locks `better_sqlite3.node`. If a `npm rebuild`/test fails with `EBUSY`/`ERR_DLOPEN`: ensure the app is closed, run `npm rebuild better-sqlite3` once, then use `npx vitest run <files>` for all test steps. Before the Electron app is launched again, restore: `npx @electron/rebuild -f -o better-sqlite3`.
- **Test command:** `npx vitest run <file>` (NOT `npm test`, to avoid the rebuild/posttest churn).
- **No visual testing** (user preference): React components are verified with `@testing-library/react` + jsdom unit tests only. NEVER add dev-server/preview/screenshot steps. The user does visual QA.
- **Network-gated tests:** any test that spawns the vendored CLI or hits the network uses `describe.runIf(<vendored/condition>)` like Phase 1's `runtime.test.ts`/`e2e.test.ts`. Sandbox egress is restricted — unit tests must NOT hit real GitHub (inject fetch).
- **Commits:** conventional style, end with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer (HEREDOC for the message).

---

## File Structure

**Create:**
- `electron/anatomy/verify.ts` — `runAnatomyVerify()`: spawn `validate --json`, parse, classify rule kinds, graceful-skip.
- `electron/anatomy/verify.test.ts`
- `electron/services/updateService.anatomy.test.ts` — staleness branch tests (injected fetch/db).
- `src/components/AnatomyIndicators.tsx` — source badge · counts · freshness · fingerprint dot.
- `src/components/AnatomyIndicators.test.tsx`
- `src/components/AnatomyView.tsx` — identity pillars + verbatim rules/decisions + raw toggle.
- `src/components/AnatomyView.test.tsx`
- `src/components/AnatomyMemoryPanel.tsx` — entries newest-first, superseded collapsible.
- `src/components/AnatomyMemoryPanel.test.tsx`

**Modify:**
- `electron/anatomy/types.ts` — add `AnatomyVerifyResult`; add `verify` to `AnatomyGenerateOutput`.
- `electron/anatomy/index.ts` — run verify, persist `anatomy_verify`, surface verify warnings.
- `electron/anatomy/index.test.ts` — verify-path cases.
- `electron/anatomy/staleness.ts` — real implementation.
- `electron/anatomy/staleness.test.ts` — real tests.
- `electron/db.ts` — idempotent `ALTER TABLE skills ADD COLUMN anatomy_verify TEXT`.
- `electron/db.anatomy-migration.test.ts` — assert `anatomy_verify`.
- `electron/services/updateService.ts` — `checkRepo` anatomy branch.
- `electron/mcp-server.ts` — `handleSearchSkills` + `handleGetCollection` anatomy branches.
- `electron/mcp-server.test.ts` — anatomy search/collection cases.
- `electron/main.ts` — add `skill:getAnatomy` IPC handler.
- `electron/preload.ts` — add `skill.getAnatomy`.
- `src/types/repo.ts` — extend `SkillRow` with anatomy fields; add renderer anatomy types.
- `src/views/RepoDetail.tsx` — skill-tab branch for anatomy rows.
- `src/components/GenericDetail.tsx` — non-regression: anatomy rows show indicators, not depth bars.

---

## Task 1: DB migration — `anatomy_verify` column

**Files:**
- Modify: `electron/db.ts` (after line 278, the `anatomy_brief` ALTER)
- Modify: `electron/db.anatomy-migration.test.ts`

- [ ] **Step 1: Extend the migration test**

In `electron/db.anatomy-migration.test.ts`, add `'anatomy_verify'` to the column list in the first test:

```ts
    for (const c of ['anatomy_memory', 'anatomy_commit', 'anatomy_fingerprint', 'anatomy_source', 'anatomy_brief', 'anatomy_verify']) {
      expect(cols).toContain(c)
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/db.anatomy-migration.test.ts`
Expected: FAIL — `expected [ … ] to contain 'anatomy_verify'`.

- [ ] **Step 3: Add the migration**

In `electron/db.ts`, immediately after the line ``try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_brief       TEXT`) } catch {}`` (currently line 278), add:

```ts
  // Phase 2 — rule-verification summary (JSON: { ok, errors[], warnings[], rules[] })
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_verify TEXT`) } catch {}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/db.anatomy-migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.anatomy-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): add skills.anatomy_verify column migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `electron/anatomy/verify.ts` — run `validate --json`

The vendored CLI: `anatomy validate [<path>] [--require] [--no-strict] [--json]` — `--json` emits structured JSON to stdout, human text to stderr; exit 1 on validation failure / strict source-cross-check, exit 0 otherwise. The exact JSON shape is an external contract, so the parser is **defensive**: it extracts a boolean pass, error/warning message arrays, and per-rule entries when present, tolerating unknown fields.

**Files:**
- Modify: `electron/anatomy/types.ts`
- Create: `electron/anatomy/verify.ts`, `electron/anatomy/verify.test.ts`

- [ ] **Step 1: Add the result type**

In `electron/anatomy/types.ts`, append:

```ts
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
```

- [ ] **Step 2: Write the failing test**

```ts
// electron/anatomy/verify.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runAnatomyVerify, parseValidateJson } from './verify'
import type { ResolvedRuntime } from './runtime'

const rt: ResolvedRuntime = { nodeBin: '/n', cliEntry: '/c' }

describe('parseValidateJson', () => {
  it('maps a passing report', () => {
    const r = parseValidateJson(JSON.stringify({ ok: true, errors: [], warnings: ['desc too long'] }), 0)
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['desc too long'])
    expect(r.errors).toEqual([])
  })

  it('maps failures and rule results, classifying kinds', () => {
    const r = parseValidateJson(JSON.stringify({
      ok: false,
      errors: ['identity-integrity'],
      rules: [
        { statement: 'no console.log', kind: 'glob', passed: true },
        { statement: 'use ast', kind: 'ast-grep', passed: false, detail: 'matched 2' },
      ],
    }), 1)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('identity-integrity')
    expect(r.rules.find(x => x.kind === 'glob')!.status).toBe('pass')
    expect(r.rules.find(x => x.kind === 'ast-grep')!.status).toBe('fail')
  })

  it('marks semgrep rules unverified when the tool is unavailable', () => {
    const r = parseValidateJson(JSON.stringify({
      ok: true, errors: [],
      rules: [{ statement: 'pattern x', kind: 'semgrep', skipped: 'semgrep not installed' }],
    }), 0)
    expect(r.rules[0].status).toBe('unverified')
    expect(r.skipped).toContain('semgrep not installed')
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run electron/anatomy/verify.test.ts`
Expected: FAIL — cannot find module `./verify`.

- [ ] **Step 4: Implement**

```ts
// electron/anatomy/verify.ts
import type { ResolvedRuntime, SpawnResult } from './runtime'
import type { AnatomyVerifyResult, AnatomyRuleResult } from './types'

export interface VerifyDeps {
  runtime: ResolvedRuntime
  spawnAnatomy: (rt: ResolvedRuntime, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<SpawnResult>
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : JSON.stringify(x))
  return []
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

  const errors = asArray(raw.errors)
  const warnings = asArray(raw.warnings)
  const skipped: string[] = []
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run electron/anatomy/verify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Probe the real CLI contract (vendored)**

Run (PowerShell-safe; use the Bash tool):
```bash
cd /tmp && rm -rf vp && mkdir vp && cd vp && git init -q && printf '{"name":"x","version":"1.0.0"}' > package.json && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -qm i && "D:/Coding/Git-Suite/vendor/node22/node.exe" D:/Coding/Git-Suite/vendor/anatomy/anatomy-cli/dist/bin.js generate --repo . >/dev/null 2>&1; "D:/Coding/Git-Suite/vendor/node22/node.exe" D:/Coding/Git-Suite/vendor/anatomy/anatomy-cli/dist/bin.js validate --json --no-strict; echo "EXIT=$?"
```
Expected: JSON on stdout. **Inspect the real field names.** If they differ from the assumed `ok`/`errors`/`warnings`/`rules[].{statement,kind,passed,detail,skipped}`, adjust `parseValidateJson` field reads (keep the defensive fallback) and re-run Step 5 until green. Record the observed shape in the commit message.

- [ ] **Step 7: Commit**

```bash
git add electron/anatomy/verify.ts electron/anatomy/verify.test.ts electron/anatomy/types.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): verify.ts — defensive `validate --json` parser

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire verification into `index.ts`

**Files:**
- Modify: `electron/anatomy/types.ts`, `electron/anatomy/index.ts`, `electron/anatomy/index.test.ts`

- [ ] **Step 1: Add `verify` to the output type**

In `electron/anatomy/types.ts`, in `AnatomyGenerateOutput`, add after `warnings: string[]`:

```ts
  /** Rule-verification summary (Phase 2); null if verification could not run. */
  verify: import('./types').AnatomyVerifyResult | null
```

(Use a direct type reference instead of the `import(...)` if `AnatomyVerifyResult` is already in scope in the file — it is, since Task 2 added it to this same file. Write: `verify: AnatomyVerifyResult | null`.)

- [ ] **Step 2: Add the failing test**

In `electron/anatomy/index.test.ts`, extend the `deps()` helper's default `spawnAnatomy` mock so `validate --json` returns a JSON body, and add:

```ts
  it('runs verification and attaches the parsed result', async () => {
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run electron/anatomy/index.test.ts`
Expected: FAIL — `out.verify` is undefined / property missing.

- [ ] **Step 4: Implement in `index.ts`**

Add the import at the top of `electron/anatomy/index.ts`:

```ts
import { runAnatomyVerify } from './verify'
```

In `generateViaAnatomy`, after the `const briefRes = ...` / `const brief = ...` lines (currently lines 70-71) and before the `return {`, add:

```ts
  const verify = await runAnatomyVerify({ runtime: d.runtime, spawnAnatomy: d.spawnAnatomy }, clone.dir)
  if (verify.errors.length) warnings.push(`anatomy verify: ${verify.errors.slice(0, 3).join('; ')}`)
  for (const s of verify.skipped) warnings.push(`anatomy verify: ${s}`)
```

Add `verify,` to the returned object (after `warnings,`).

- [ ] **Step 5: Persist `anatomy_verify`**

In `persistAnatomySkill` (`electron/anatomy/index.ts`), update the INSERT to include the column. Change the column list, the `VALUES` list, the `ON CONFLICT` set list, and the `.run(...)` args:

- column list: append `, anatomy_verify` after `anatomy_brief`
- `VALUES (?, '.anatomy', ?, ?, ?, 1, NULL, 1, ?, ?, ?, ?, ?, ?)` → add one more `?` before the closing paren of the value-tuple's anatomy group (i.e. `… ?, ?, ?, ?, ?, ?, ?)` — 7 trailing `?`)
- `ON CONFLICT … DO UPDATE SET`: append `, anatomy_verify=excluded.anatomy_verify`
- `.run(...)`: change the final args to `… out.source, out.brief, out.verify ? JSON.stringify(out.verify) : null, out.commit)` — note `github_sha` (last `?`) still receives `out.commit`; insert the verify JSON arg immediately before it.

The full corrected statement:

```ts
  db.prepare(`
    INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier,
                        anatomy_memory, anatomy_commit, anatomy_fingerprint, anatomy_source, anatomy_brief, anatomy_verify, github_sha)
    VALUES (?, '.anatomy', ?, ?, ?, 1, NULL, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id) DO UPDATE SET
      filename=excluded.filename, content=excluded.content, version=excluded.version,
      generated_at=excluded.generated_at, anatomy_memory=excluded.anatomy_memory,
      anatomy_commit=excluded.anatomy_commit, anatomy_fingerprint=excluded.anatomy_fingerprint,
      anatomy_source=excluded.anatomy_source, anatomy_brief=excluded.anatomy_brief,
      anatomy_verify=excluded.anatomy_verify, github_sha=excluded.github_sha
  `).run(repoId, out.content, version, generated_at, out.memory, out.commit, out.fingerprint,
         out.source, out.brief, out.verify ? JSON.stringify(out.verify) : null, out.commit)
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run electron/anatomy/index.test.ts`
Expected: PASS (5 tests — the 4 existing + the new verify test). If an existing test's `spawnAnatomy` mock now receives an unhandled `validate --json` call and returns a non-JSON default, `parseValidateJson` still yields a tolerant result (no throw) so those tests stay green; confirm.

- [ ] **Step 7: Commit**

```bash
git add electron/anatomy/index.ts electron/anatomy/index.test.ts electron/anatomy/types.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): run + persist rule verification during generation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `staleness.ts` — real `.anatomy`-commit probe

**Files:**
- Modify: `electron/anatomy/staleness.ts`, `electron/anatomy/staleness.test.ts`

- [ ] **Step 1: Replace the test with real behaviour**

```ts
// electron/anatomy/staleness.test.ts
import { describe, it, expect, vi } from 'vitest'
import { isAnatomyStale } from './staleness'

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('isAnatomyStale', () => {
  it('not stale when latest .anatomy commit equals stored commit', async () => {
    const fetchFn = vi.fn(async () => res([{ sha: 'abc123' }]))
    const r = await isAnatomyStale('o', 'n', 'main', 'abc123', null, fetchFn)
    expect(r.stale).toBe(false)
    expect(r.latestSha).toBe('abc123')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/n/commits?path=.anatomy&sha=main&per_page=1',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('stale when latest differs from stored', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'old', null, vi.fn(async () => res([{ sha: 'new' }])))
    expect(r.stale).toBe(true)
    expect(r.latestSha).toBe('new')
  })

  it('not stale + reason when the repo has no .anatomy commits (empty array)', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'x', null, vi.fn(async () => res([])))
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/no \.anatomy commits/i)
  })

  it('not stale + reason on API error (never throws)', async () => {
    const r = await isAnatomyStale('o', 'n', 'main', 'x', null, vi.fn(async () => res({}, false, 403)))
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/api error 403/i)
  })

  it('not stale when storedCommit is null (nothing to compare)', async () => {
    const fetchFn = vi.fn(async () => res([{ sha: 'a' }]))
    const r = await isAnatomyStale('o', 'n', 'main', null, null, fetchFn)
    expect(r.stale).toBe(false)
    expect(r.reason).toMatch(/no stored commit/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/anatomy/staleness.test.ts`
Expected: FAIL — current stub ignores args / wrong arity / returns `phase2-not-implemented`.

- [ ] **Step 3: Implement**

```ts
// electron/anatomy/staleness.ts
// Pins staleness to the .anatomy file's last commit (spec D8): a repo is stale
// only when .anatomy itself changed upstream, not on any push. Pure + injected
// fetch so it is unit-testable without network (sandbox egress is restricted).
import { githubHeaders } from '../github'

export interface StalenessResult { stale: boolean; reason: string; latestSha: string | null }

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function isAnatomyStale(
  owner: string,
  name: string,
  branch: string,
  storedCommit: string | null,
  token: string | null,
  fetchFn: FetchFn = fetch,
): Promise<StalenessResult> {
  if (!storedCommit) return { stale: false, reason: 'no stored commit', latestSha: null }
  const url = `https://api.github.com/repos/${owner}/${name}/commits?path=.anatomy&sha=${branch}&per_page=1`
  try {
    const r = await fetchFn(url, { headers: githubHeaders(token) })
    if (!r.ok) return { stale: false, reason: `api error ${r.status}`, latestSha: null }
    const commits = await r.json() as Array<{ sha: string }>
    if (!Array.isArray(commits) || commits.length === 0) {
      return { stale: false, reason: 'no .anatomy commits upstream', latestSha: null }
    }
    const latestSha = commits[0].sha
    return { stale: latestSha !== storedCommit, reason: latestSha !== storedCommit ? 'anatomy drifted' : 'fresh', latestSha }
  } catch (err) {
    return { stale: false, reason: `probe failed: ${err instanceof Error ? err.message : String(err)}`, latestSha: null }
  }
}
```

(Confirm `githubHeaders` is exported from `electron/github` with signature `(token: string | null) => Record<string,string>` — it is used this way in `electron/services/updateService.ts:48`. If the export name differs, match the actual one used there.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/anatomy/staleness.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/staleness.ts electron/anatomy/staleness.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): real .anatomy-commit staleness probe

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire staleness into `updateService.checkRepo`

`electron/services/updateService.ts` `checkRepo(owner, name, storedVersion)` (currently lines 42-62) is called by `checkAll` (lines ~185-234) which writes `repos.update_available`. For anatomy rows we instead compare the `.anatomy` commit.

**Files:**
- Modify: `electron/services/updateService.ts`
- Create: `electron/services/updateService.anatomy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/services/updateService.anatomy.test.ts
import { describe, it, expect, vi } from 'vitest'
import { isAnatomyRepoStale } from './updateService'

describe('isAnatomyRepoStale', () => {
  it('delegates to the staleness probe and maps to updateAvailable', async () => {
    const probe = vi.fn(async () => ({ stale: true, reason: 'anatomy drifted', latestSha: 'new' }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'old', null, probe)
    expect(r).toEqual({ updateAvailable: true, upstreamVersion: 'new' })
  })

  it('not stale → updateAvailable false, keeps stored sha as upstream', async () => {
    const probe = vi.fn(async () => ({ stale: false, reason: 'fresh', latestSha: 'same' }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'same', null, probe)
    expect(r.updateAvailable).toBe(false)
  })

  it('null latestSha → not available (no signal)', async () => {
    const probe = vi.fn(async () => ({ stale: false, reason: 'api error 403', latestSha: null }))
    const r = await isAnatomyRepoStale('o', 'n', 'main', 'x', null, probe)
    expect(r).toEqual({ updateAvailable: false, upstreamVersion: 'x' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/services/updateService.anatomy.test.ts`
Expected: FAIL — `isAnatomyRepoStale` not exported.

- [ ] **Step 3: Implement the pure helper + branch**

In `electron/services/updateService.ts`, add the import near the other imports:

```ts
import { isAnatomyStale, type StalenessResult } from '../anatomy/staleness'
```

Add this exported pure helper (place it next to `checkRepo`, after `isNewerPushedAt`):

```ts
type AnatomyProbe = (o: string, n: string, b: string, sc: string | null, t: string | null) => Promise<StalenessResult>

/** Anatomy-row staleness: pins to the .anatomy commit instead of releases. */
export async function isAnatomyRepoStale(
  owner: string, name: string, branch: string, storedCommit: string | null,
  token: string | null, probe: AnatomyProbe = isAnatomyStale,
): Promise<{ updateAvailable: boolean; upstreamVersion: string }> {
  const r = await probe(owner, name, branch, storedCommit, token)
  return {
    updateAvailable: r.stale && r.latestSha != null,
    upstreamVersion: r.latestSha ?? storedCommit ?? 'unknown',
  }
}
```

In `checkAll` (the loop that calls `checkRepo`), branch for anatomy rows. Locate the `checkAll` query that selects rows (currently `SELECT id, owner, name, stored_version FROM repos WHERE saved_at IS NOT NULL`) and the `await checkRepo(row.owner, row.name, row.stored_version)` call inside the batch map. Replace that single call with:

```ts
      const anat = _db!.prepare(
        `SELECT s.anatomy_source, s.anatomy_commit, r.default_branch
         FROM skills s JOIN repos r ON r.id = s.repo_id WHERE s.repo_id = ?`
      ).get(row.id) as { anatomy_source: string | null; anatomy_commit: string | null; default_branch: string | null } | undefined
      const result = anat?.anatomy_source
        ? await isAnatomyRepoStale(row.owner, row.name, anat.default_branch ?? 'main', anat.anatomy_commit, getToken() ?? null)
        : await checkRepo(row.owner, row.name, row.stored_version)
```

(`getToken` is already imported in this file — used in `checkRepo`. `_db` is the module DB handle used throughout `checkAll`. Keep the rest of the batch logic — `update_available`/`upstream_version`/`update_checked_at` write and `changedIds` — unchanged; `result` keeps the same `{ updateAvailable, upstreamVersion } | null` shape.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/services/updateService.anatomy.test.ts electron/services/skillSyncService.test.ts electron/main.test.ts`
Expected: PASS (3 new + existing suites green — no regression to legacy update flow).

- [ ] **Step 5: Type-check the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "anatomy/staleness|services/updateService" || echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add electron/services/updateService.ts electron/services/updateService.anatomy.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): pin update checks to .anatomy commit for anatomy rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: MCP `handleSearchSkills` — anatomy raw-text search

**Files:**
- Modify: `electron/mcp-server.ts` (`handleSearchSkills`, currently lines 131-163)
- Modify: `electron/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('handleSearchSkills', …)` in `electron/mcp-server.test.ts` (uses the file's existing `makeDb`/`seedRepo`/`tmpDir`):

```ts
  it('searches raw .anatomy content for anatomy rows (no [CORE] needed)', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'o', 'n')
    db.prepare(
      `INSERT INTO skills (repo_id, filename, content, version, generated_at, active, anatomy_source)
       VALUES (?, '.anatomy', ?, 'v', 't', 1, 'generated')`
    ).run(repoId, '[identity]\nform="lib"\n\n[[rules]]\nstatement = "all DB writes go through db.ts"\n')
    const result = handleSearchSkills(db, tmpDir, 'db writes')
    expect(result.content[0].text).toContain('o/n')
    expect(result.content[0].text).toContain('Found in 1 skill(s)')
    db.close()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/mcp-server.test.ts`
Expected: FAIL — anatomy row has no file on disk + no `[CORE]`, so the current handler skips it.

- [ ] **Step 3: Implement**

In `handleSearchSkills`, change the row query to also fetch anatomy columns, and branch the per-skill body. Replace the `activeSkills` query and the `for` loop body:

```ts
  const activeSkills = db.prepare(`
    SELECT repos.owner, repos.name, skills.filename, skills.content AS db_content, skills.anatomy_source
    FROM skills
    INNER JOIN repos ON repos.id = skills.repo_id
    WHERE skills.active = 1
  `).all() as Array<{ owner: string; name: string; filename: string; db_content: string; anatomy_source: string | null }>

  const results: string[] = []
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return text('Empty search query')

  for (const skill of activeSkills) {
    let haystack: string
    if (skill.anatomy_source) {
      haystack = skill.db_content // raw .anatomy — search the whole document
    } else {
      const skillPath = path.join(dataDir, 'skills', skill.owner, skill.filename)
      if (!fs.existsSync(skillPath)) continue
      const content = fs.readFileSync(skillPath, 'utf8')
      const coreMatch = content.match(/## \[CORE\]([\s\S]*?)(?=## \[EXTENDED\]|$)/)
      haystack = coreMatch ? coreMatch[1] : content
    }
    const lower = haystack.toLowerCase()
    if (tokens.every(t => lower.includes(t))) {
      results.push(`${skill.owner}/${skill.name}:\n${haystack.slice(0, 300).trim()}...`)
    }
  }
```

(Leave the trailing `if (results.length === 0) …` / `return text(...)` unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/mcp-server.test.ts`
Expected: PASS (all existing + the new case; legacy file-based search unchanged).

- [ ] **Step 5: Commit**

```bash
git add electron/mcp-server.ts electron/mcp-server.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): search_skills matches raw .anatomy for anatomy rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: MCP `handleGetCollection` — anatomy budget mapping

**Files:**
- Modify: `electron/mcp-server.ts` (`handleGetCollection`, currently lines 165-201)
- Modify: `electron/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('handleGetCollection', …)`:

```ts
  it('uses anatomy_brief for depth=core and raw .anatomy for depth=full (anatomy rows)', () => {
    const db = makeDb()
    db.prepare(`INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1','Stack','user',1,'t')`).run()
    const repoId = seedRepo(db, 'o', 'n')
    db.prepare(
      `INSERT INTO skills (repo_id, filename, content, version, generated_at, active, anatomy_source, anatomy_brief)
       VALUES (?, '.anatomy', ?, 'v', 't', 1, 'generated', ?)`
    ).run(repoId, '[identity]\nform="full-raw"', 'BRIEF: form=lib')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)

    const core = handleGetCollection(db, tmpDir, 'Stack', 'core')
    expect(core.content[0].text).toContain('BRIEF: form=lib')
    expect(core.content[0].text).not.toContain('full-raw')

    const full = handleGetCollection(db, tmpDir, 'Stack', 'full')
    expect(full.content[0].text).toContain('full-raw')
    db.close()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/mcp-server.test.ts`
Expected: FAIL — anatomy row has no on-disk file, current handler skips it.

- [ ] **Step 3: Implement**

In `handleGetCollection`, extend the repos query and branch the per-repo body. Replace the `repos` query and the `for (const repo of repos)` loop:

```ts
  const repos = db.prepare(`
    SELECT repos.owner, repos.name, skills.filename,
           skills.content AS db_content, skills.anatomy_source, skills.anatomy_brief, skills.anatomy_memory
    FROM collection_repos
    JOIN repos ON repos.id = collection_repos.repo_id
    JOIN skills ON skills.repo_id = repos.id AND skills.active = 1
    WHERE collection_repos.collection_id = ?
  `).all(collection.id) as Array<{
    owner: string; name: string; filename: string
    db_content: string; anatomy_source: string | null; anatomy_brief: string | null; anatomy_memory: string | null
  }>

  if (repos.length === 0) return text(`Collection "${name}" has no active skills installed.`)

  const parts: string[] = []
  for (const repo of repos) {
    if (repo.anatomy_source) {
      const body = depth === 'core'
        ? (repo.anatomy_brief && repo.anatomy_brief.trim() ? repo.anatomy_brief : repo.db_content)
        : repo.db_content + (repo.anatomy_memory ? `\n\n# Lived experience (.anatomy-memory)\n\n${repo.anatomy_memory}` : '')
      parts.push(`# ${repo.owner}/${repo.name}\n\n${body}`)
      continue
    }
    if (!repo.filename) continue
    const skillPath = path.join(dataDir, 'skills', repo.owner, repo.filename)
    if (!fs.existsSync(skillPath)) continue
    const content = fs.readFileSync(skillPath, 'utf8')
    if (depth === 'core') {
      const coreMatch = content.match(/## \[CORE\]([\s\S]*?)(?=## \[EXTENDED\]|$)/)
      const coreSection = coreMatch ? `## [CORE]${coreMatch[1]}` : content
      parts.push(`# ${repo.owner}/${repo.name}\n\n${coreSection}`)
    } else {
      parts.push(`# ${repo.owner}/${repo.name}\n\n${content}`)
    }
  }
```

(Leave the trailing `if (parts.length === 0) …` / `return text(parts.join(...))` unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/mcp-server.test.ts`
Expected: PASS (all existing + the new case).

- [ ] **Step 5: Commit**

```bash
git add electron/mcp-server.ts electron/mcp-server.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): get_collection core=anatomy_brief, full=raw for anatomy rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `skill:getAnatomy` IPC + renderer types

The renderer cannot parse TOML (`smol-toml` is electron-externalized, main-only). Add an IPC that parses in main and returns a structured payload.

**Files:**
- Modify: `electron/main.ts` (add handler near `skill:get`, line ~1585), `electron/preload.ts`, `src/types/repo.ts`

- [ ] **Step 1: Add the IPC handler**

In `electron/main.ts`, add an import near the other anatomy imports (added in Phase 1 near line 28):

```ts
import { parseAnatomy, parseMemory } from './anatomy/parse'
```

After the `skill:get` handler (ends line 1585 `})`), add:

```ts
ipcMain.handle('skill:getAnatomy', async (_, owner: string, name: string) => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare(
    `SELECT s.content, s.anatomy_memory, s.anatomy_source, s.anatomy_commit,
            s.anatomy_fingerprint, s.anatomy_verify
     FROM skills s JOIN repos r ON s.repo_id = r.id WHERE r.owner = ? AND r.name = ?`
  ).get(owner, name) as {
    content: string; anatomy_memory: string | null; anatomy_source: string | null
    anatomy_commit: string | null; anatomy_fingerprint: string | null; anatomy_verify: string | null
  } | undefined
  if (!row || !row.anatomy_source) return null
  let model = null, memory: unknown[] = [], verify = null
  try { model = parseAnatomy(row.content) } catch { /* malformed — surface raw only */ }
  try { memory = parseMemory(row.anatomy_memory) } catch { memory = [] }
  try { verify = row.anatomy_verify ? JSON.parse(row.anatomy_verify) : null } catch { verify = null }
  return {
    source: row.anatomy_source,
    commit: row.anatomy_commit,
    fingerprint: row.anatomy_fingerprint,
    rawContent: row.content,
    rawMemory: row.anatomy_memory,
    model, memory, verify,
  }
})
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.ts`, inside the `skill:` object (after `getContent:` line 126-127), add:

```ts
    getAnatomy: (owner: string, name: string) =>
      ipcRenderer.invoke('skill:getAnatomy', owner, name),
```

- [ ] **Step 3: Extend renderer types**

In `src/types/repo.ts`, extend `SkillRow` (add after `tier?: number`):

```ts
  // Phase 1/2 — anatomy engine (present only for anatomy-sourced skills)
  anatomy_source?: string | null      // 'committed' | 'generated' | null
  anatomy_commit?: string | null
  anatomy_fingerprint?: string | null
  anatomy_memory?: string | null
  anatomy_brief?: string | null
  anatomy_verify?: string | null      // JSON AnatomyVerifyResult
```

And append the renderer-facing anatomy types:

```ts
export interface AnatomyModelView {
  identity: Record<string, unknown>
  generated: Record<string, unknown>
  operation?: Record<string, unknown>
  substance?: Record<string, unknown>
  rules: Array<{ statement: string; verify?: { kind: string } }>
  decisions: Array<{ decision: string; rationale?: string }>
}
export interface AnatomyMemoryEntryView {
  text: string; kind?: string; at?: string; superseded?: boolean
  last_verified_at?: string; verified_by?: string
}
export interface AnatomyVerifyView {
  ok: boolean; errors: string[]; warnings: string[]
  rules: Array<{ statement: string; kind: string; status: 'pass' | 'fail' | 'unverified'; detail?: string }>
  skipped: string[]
}
export interface AnatomyPayload {
  source: string; commit: string | null; fingerprint: string | null
  rawContent: string; rawMemory: string | null
  model: AnatomyModelView | null
  memory: AnatomyMemoryEntryView[]
  verify: AnatomyVerifyView | null
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "main\.ts|preload\.ts|types/repo" || echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types/repo.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): skill:getAnatomy IPC + renderer anatomy types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `AnatomyIndicators` component

**Files:**
- Create: `src/components/AnatomyIndicators.tsx`, `src/components/AnatomyIndicators.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/AnatomyIndicators.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyIndicators from './AnatomyIndicators'
import type { AnatomyPayload } from '../types/repo'

const base: AnatomyPayload = {
  source: 'committed', commit: 'abc1234', fingerprint: 'fp1', rawContent: '', rawMemory: null,
  model: { identity: {}, generated: { fingerprint: 'fp1' }, rules: [{ statement: 'r1' }, { statement: 'r2' }],
           decisions: [{ decision: 'd1' }] },
  memory: [{ text: 'm1' }],
  verify: { ok: true, errors: [], warnings: [], rules: [], skipped: [] },
}

describe('AnatomyIndicators', () => {
  it('shows source badge, counts, and fresh state', () => {
    render(<AnatomyIndicators payload={base} updateAvailable={0} />)
    expect(screen.getByText(/committed/i)).toBeInTheDocument()
    expect(screen.getByText(/2 rules/i)).toBeInTheDocument()
    expect(screen.getByText(/1 decision/i)).toBeInTheDocument()
    expect(screen.getByText(/1 memory/i)).toBeInTheDocument()
    expect(screen.getByText(/fresh/i)).toBeInTheDocument()
  })

  it('shows stale when updateAvailable=1', () => {
    render(<AnatomyIndicators payload={base} updateAvailable={1} />)
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('flags fingerprint mismatch', () => {
    const p = { ...base, model: { ...base.model!, generated: { fingerprint: 'DIFFERENT' } }, fingerprint: 'fp1' }
    render(<AnatomyIndicators payload={p} updateAvailable={0} />)
    expect(screen.getByText(/memory may be stale/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AnatomyIndicators.test.tsx`
Expected: FAIL — cannot find module `./AnatomyIndicators`.

- [ ] **Step 3: Implement**

```tsx
// src/components/AnatomyIndicators.tsx
import type { AnatomyPayload } from '../types/repo'

export default function AnatomyIndicators({
  payload, updateAvailable,
}: { payload: AnatomyPayload; updateAvailable: number | null }) {
  const rules = payload.model?.rules.length ?? 0
  const decisions = payload.model?.decisions.length ?? 0
  const mem = payload.memory.length
  const stale = updateAvailable === 1
  const fpAnatomy = (payload.model?.generated?.fingerprint as string | undefined) ?? payload.fingerprint
  const fpMismatch = !!payload.rawMemory && !!fpAnatomy && !!payload.fingerprint && fpAnatomy !== payload.fingerprint

  return (
    <div className="anatomy-indicators">
      <span className={`anatomy-source-badge anatomy-source-${payload.source}`}>{payload.source}</span>
      <span className="anatomy-count">{rules} rule{rules === 1 ? '' : 's'}</span>
      <span className="anatomy-count">{decisions} decision{decisions === 1 ? '' : 's'}</span>
      <span className="anatomy-count">{mem} memory {mem === 1 ? 'entry' : 'entries'}</span>
      <span className={`anatomy-freshness ${stale ? 'is-stale' : 'is-fresh'}`}>{stale ? 'stale' : 'fresh'}</span>
      {fpMismatch && <span className="anatomy-fp-warn">memory may be stale</span>}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/AnatomyIndicators.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AnatomyIndicators.tsx src/components/AnatomyIndicators.test.tsx
git commit -m "$(cat <<'EOF'
feat(anatomy): AnatomyIndicators component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `AnatomyView` component

**Files:**
- Create: `src/components/AnatomyView.tsx`, `src/components/AnatomyView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/AnatomyView.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyView from './AnatomyView'
import type { AnatomyPayload } from '../types/repo'

const payload: AnatomyPayload = {
  source: 'generated', commit: 'c1', fingerprint: 'fp', rawContent: '[identity]\nstack="ts"\n',
  rawMemory: null,
  model: {
    identity: { stack: 'ts', form: 'library', domain: 'tooling', function: 'demo' },
    generated: {},
    rules: [{ statement: 'no console.log', verify: { kind: 'glob' } }],
    decisions: [{ decision: 'serve verbatim', rationale: 'fidelity' }],
  },
  memory: [], verify: null,
}

describe('AnatomyView', () => {
  it('renders identity pillars and verbatim rules/decisions', () => {
    render(<AnatomyView payload={payload} />)
    expect(screen.getByText('library')).toBeInTheDocument()
    expect(screen.getByText('no console.log')).toBeInTheDocument()
    expect(screen.getByText(/serve verbatim/)).toBeInTheDocument()
    expect(screen.getByText(/fidelity/)).toBeInTheDocument()
  })

  it('toggles raw .anatomy view', () => {
    render(<AnatomyView payload={payload} />)
    expect(screen.queryByText(/\[identity\]/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /view raw/i }))
    expect(screen.getByText(/\[identity\]/)).toBeInTheDocument()
  })

  it('falls back to raw when model is null (malformed)', () => {
    render(<AnatomyView payload={{ ...payload, model: null }} />)
    expect(screen.getByText(/\[identity\]/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AnatomyView.test.tsx`
Expected: FAIL — cannot find module `./AnatomyView`.

- [ ] **Step 3: Implement**

```tsx
// src/components/AnatomyView.tsx
import { useState } from 'react'
import type { AnatomyPayload } from '../types/repo'

const PILLARS = ['stack', 'form', 'domain', 'function'] as const

export default function AnatomyView({ payload }: { payload: AnatomyPayload }) {
  const [raw, setRaw] = useState(false)
  const model = payload.model
  const showRaw = raw || !model

  return (
    <div className="anatomy-view">
      <div className="anatomy-view-toolbar">
        <button className="anatomy-raw-toggle" onClick={() => setRaw(r => !r)}>
          {showRaw && !model ? 'raw .anatomy (unparsed)' : raw ? 'structured view' : 'view raw .anatomy'}
        </button>
      </div>

      {showRaw ? (
        <pre className="anatomy-raw-pre">{payload.rawContent}</pre>
      ) : (
        <>
          <table className="anatomy-identity">
            <tbody>
              {PILLARS.map(p => (
                <tr key={p}>
                  <th>{p}</th>
                  <td>{String(model!.identity?.[p] ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {model!.rules.length > 0 && (
            <section className="anatomy-rules">
              <h4>Rules</h4>
              <ul>
                {model!.rules.map((r, i) => (
                  <li key={i}>
                    <span className="anatomy-rule-text">{r.statement}</span>
                    {r.verify?.kind && <span className="anatomy-rule-kind">[{r.verify.kind}]</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model!.decisions.length > 0 && (
            <section className="anatomy-decisions">
              <h4>Decisions</h4>
              <ul>
                {model!.decisions.map((d, i) => (
                  <li key={i}>
                    <span className="anatomy-decision-text">{d.decision}</span>
                    {d.rationale && <span className="anatomy-decision-rationale"> — {d.rationale}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/AnatomyView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AnatomyView.tsx src/components/AnatomyView.test.tsx
git commit -m "$(cat <<'EOF'
feat(anatomy): AnatomyView component (structured + raw toggle)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `AnatomyMemoryPanel` component

**Files:**
- Create: `src/components/AnatomyMemoryPanel.tsx`, `src/components/AnatomyMemoryPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/AnatomyMemoryPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyMemoryPanel from './AnatomyMemoryPanel'
import type { AnatomyMemoryEntryView } from '../types/repo'

const entries: AnatomyMemoryEntryView[] = [
  { text: 'older note', kind: 'gotcha', at: '2026-05-10T00:00:00Z' },
  { text: 'newest note', kind: 'convention', at: '2026-05-16T00:00:00Z' },
  { text: 'superseded note', kind: 'attempt', at: '2026-05-01T00:00:00Z', superseded: true },
]

describe('AnatomyMemoryPanel', () => {
  it('renders entries newest-first', () => {
    render(<AnatomyMemoryPanel entries={entries} />)
    const items = screen.getAllByTestId('anatomy-mem-entry')
    expect(items[0]).toHaveTextContent('newest note')
    expect(items[1]).toHaveTextContent('older note')
  })

  it('hides superseded entries behind a toggle', () => {
    render(<AnatomyMemoryPanel entries={entries} />)
    expect(screen.queryByText('superseded note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /superseded/i }))
    expect(screen.getByText('superseded note')).toBeInTheDocument()
  })

  it('renders nothing when there are no entries', () => {
    const { container } = render(<AnatomyMemoryPanel entries={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AnatomyMemoryPanel.test.tsx`
Expected: FAIL — cannot find module `./AnatomyMemoryPanel`.

- [ ] **Step 3: Implement**

```tsx
// src/components/AnatomyMemoryPanel.tsx
import { useState } from 'react'
import type { AnatomyMemoryEntryView } from '../types/repo'

function ts(at?: string): number { return at ? new Date(at).getTime() || 0 : 0 }

export default function AnatomyMemoryPanel({ entries }: { entries: AnatomyMemoryEntryView[] }) {
  const [showSuperseded, setShowSuperseded] = useState(false)
  if (entries.length === 0) return null

  const sorted = [...entries].sort((a, b) => ts(b.at) - ts(a.at))
  const active = sorted.filter(e => !e.superseded)
  const superseded = sorted.filter(e => e.superseded)

  const Entry = ({ e, dim }: { e: AnatomyMemoryEntryView; dim?: boolean }) => (
    <li data-testid="anatomy-mem-entry" className={`anatomy-mem-entry${dim ? ' is-superseded' : ''}`}>
      <div className="anatomy-mem-meta">
        {e.kind && <span className="anatomy-mem-kind">{e.kind}</span>}
        {e.at && <span className="anatomy-mem-date">{e.at.slice(0, 10)}</span>}
        {e.last_verified_at && <span className="anatomy-mem-verified">verified {e.last_verified_at.slice(0, 10)}</span>}
      </div>
      <div className="anatomy-mem-text">{e.text}</div>
    </li>
  )

  return (
    <section className="anatomy-memory-panel">
      <h4>Lived experience</h4>
      <ul>{active.map((e, i) => <Entry key={i} e={e} />)}</ul>
      {superseded.length > 0 && (
        <>
          <button className="anatomy-mem-toggle" onClick={() => setShowSuperseded(s => !s)}>
            {showSuperseded ? 'Hide' : 'Show'} {superseded.length} superseded
          </button>
          {showSuperseded && <ul>{superseded.map((e, i) => <Entry key={i} e={e} dim />)}</ul>}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/AnatomyMemoryPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AnatomyMemoryPanel.tsx src/components/AnatomyMemoryPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(anatomy): AnatomyMemoryPanel component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Integrate into Repo Detail + GenericDetail non-regression

**Files:**
- Modify: `src/views/RepoDetail.tsx` (skill tab, `activeTab === 'skill'` block at lines ~1676-1745)
- Modify: `src/components/GenericDetail.tsx`
- Modify: `src/views/RepoDetail.test.tsx`

- [ ] **Step 1: Add the failing integration test**

In `src/views/RepoDetail.test.tsx`, add a test that mounts the skill tab with an anatomy `skillRow` and asserts the anatomy view renders instead of depth bars. Mirror the file's existing mocking of `window.api` (inspect the top of `RepoDetail.test.tsx` for the established `window.api` mock; extend `skill.get` to return a row with `anatomy_source: 'generated'` and add a `skill.getAnatomy` mock returning an `AnatomyPayload`). Assert:

```ts
    // after navigating to the skill tab with an anatomy row mocked
    expect(await screen.findByText(/committed|generated/i)).toBeInTheDocument()
    expect(screen.queryByText(/~\d+ lines/)).not.toBeInTheDocument() // no depth bars
```

(Use the test file's existing render/navigation helper. If `RepoDetail.test.tsx` has no skill-tab test to copy, add a minimal one following its existing `render(<RepoDetail/>)` + `window.api` mock setup.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/RepoDetail.test.tsx`
Expected: FAIL — depth bars still render / anatomy view absent.

- [ ] **Step 3: Fetch the anatomy payload in RepoDetail**

In `src/views/RepoDetail.tsx`, near the existing `skillRow` state and its `window.api.skill.get(owner, name)` effect (around lines 887-896), add adjacent state + fetch:

```ts
  const [anatomyPayload, setAnatomyPayload] = useState<import('../types/repo').AnatomyPayload | null>(null)
```

In the same effect that sets `skillRow` (after the `.then(... setSkillRow ...)`), chain:

```ts
    window.api.skill.getAnatomy(owner, name).then(p => { if (!cancelled) setAnatomyPayload(p as any) }).catch(() => {})
```

(Match the existing effect's `cancelled` guard pattern used for `skillRow`.)

- [ ] **Step 4: Branch the skill-tab render**

In the `activeTab === 'skill'` block, replace the inner `skillRow ? ( … ) : ( … )` so that when `skillRow?.anatomy_source` is set it renders the anatomy UI. Add these imports at the top of the file:

```ts
import AnatomyIndicators from '../components/AnatomyIndicators'
import AnatomyView from '../components/AnatomyView'
import AnatomyMemoryPanel from '../components/AnatomyMemoryPanel'
```

Replace the opening of the skill-tab body (the `skillRow ? (` … just before the `<>` with the `skillFiles` IIFE) with an anatomy branch first:

```tsx
                {activeTab === 'skill' && (
                  skillRow ? (
                    skillRow.anatomy_source && anatomyPayload ? (
                      <div className="anatomy-skill-tab">
                        <AnatomyIndicators payload={anatomyPayload} updateAvailable={(repo?.update_available ?? 0) as number} />
                        <AnatomyView payload={anatomyPayload} />
                        <AnatomyMemoryPanel entries={anatomyPayload.memory} />
                      </div>
                    ) : (
                    <>
                      {/* …existing skillFiles IIFE / SkillFileContent block UNCHANGED… */}
                    </>
                    )
                  ) : (
                    <p className="repo-detail-placeholder">Learn this repo to generate a Skills Folder for Claude.</p>
                  )
                )}
```

Keep the entire existing `skillFiles`/picker/depth-bar/`SkillFileContent` block verbatim inside the new `: (` … `)` legacy branch. (`repo` is the existing repo row state in this component; `repo.update_available` exists on `RepoRow`.)

- [ ] **Step 5: GenericDetail non-regression**

In `src/components/GenericDetail.tsx`, the panel renders `<SkillDepthBars content={skillContent ?? ''} />` (line 83). For anatomy skills, `parseSkillDepths` yields 0/0/0 (no `## [CORE]`). Add a guard: fetch the row's anatomy flag and swap the indicator. At the top add:

```ts
import AnatomyIndicators from './AnatomyIndicators'
```

Extend the existing effect (lines 27-33) to also pull the anatomy payload:

```ts
  const [anatomy, setAnatomy] = useState<import('../types/repo').AnatomyPayload | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.skill.getAnatomy(row.owner, row.name).then(p => { if (!cancelled) setAnatomy(p as any) }).catch(() => {})
    return () => { cancelled = true }
  }, [row.owner, row.name])
```

Replace line 83 `<SkillDepthBars content={skillContent ?? ''} />` with:

```tsx
            {anatomy
              ? <AnatomyIndicators payload={anatomy} updateAvailable={(row.update_available ?? 0) as number} />
              : <SkillDepthBars content={skillContent ?? ''} />}
```

(`row` is `LibraryRow extends RepoRow` → `update_available` exists.)

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/views/RepoDetail.test.tsx src/components/AnatomyIndicators.test.tsx src/components/AnatomyView.test.tsx src/components/AnatomyMemoryPanel.test.tsx`
Expected: PASS (RepoDetail anatomy test + all 3 component suites). If `RepoDetail.test.tsx` has pre-existing unrelated failures at HEAD, confirm they are unrelated (run the suite on HEAD first if unsure) and ensure your new test passes + no new failures.

- [ ] **Step 7: Type-check the renderer**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "RepoDetail|GenericDetail|components/Anatomy" || echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx src/components/GenericDetail.tsx
git commit -m "$(cat <<'EOF'
feat(anatomy): render anatomy view in Repo Detail skill tab + Library

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full regression + ABI restore

- [ ] **Step 1: Run the full anatomy + touched suites**

Run:
```bash
npx vitest run electron/anatomy electron/db.anatomy-migration.test.ts electron/mcp-server.test.ts electron/main.test.ts electron/services/updateService.anatomy.test.ts electron/services/skillSyncService.test.ts src/components/AnatomyIndicators.test.tsx src/components/AnatomyView.test.tsx src/components/AnatomyMemoryPanel.test.tsx src/views/RepoDetail.test.tsx
```
Expected: all green; gated `e2e.test.ts`/`runtime.test.ts` spawn suites skip or pass per Phase-1 behaviour. No new failures vs HEAD.

- [ ] **Step 2: Restore the Electron ABI**

Run: `npx @electron/rebuild -f -o better-sqlite3`
Expected: `Rebuild Complete`. (So the live app launches; vitest ran under the Node ABI.)

- [ ] **Step 3: Final commit if anything pending**

```bash
git status --short
```
Expected: clean (all task commits already made). If the component WIP files (`RAD-LTT-Design.md`, `src/components/IframePreview.tsx`, the modified `src/components/Component*.tsx`) appear, leave them untouched — they are pre-existing, unrelated WIP.

---

## Out of Scope (Phase 3 — do NOT implement here)

- Deleting `electron/skill-gen/`; regenerating installed skills; flipping the `anatomyEngineEnabled` default.
- The deferred components-sub-skill question (spec §13 gate).
- Installer/electron-builder packaging of Node 22 + the CLI.

---

## Self-Review

**1. Spec coverage (spec §13 "Phase 2" + decisions):**
- D5 verify-too (glob built-in / ast-grep / semgrep graceful-skip) → Tasks 1-3 (`verify.ts` classifies kinds + `skipped`; `--no-strict`; never throws).
- D8 staleness pinned to `.anatomy` commit, reuse `update_available`/`checkAll` → Tasks 4-5.
- D7 budget via `anatomy_brief` → Task 7 (`get_collection` core=`anatomy_brief`).
- `search_skills` raw-text for anatomy rows → Task 6.
- UI in Repo Detail Skill-file tab: indicators replacing `SkillDepthBars`, structured anatomy view, `.anatomy-memory` panel → Tasks 8-12. Parse-in-main constraint honoured (Task 8 `skill:getAnatomy`, no TOML in renderer). No-visual-testing honoured (RTL/jsdom only).
- All flag-gated: anatomy rows are identified by `skills.anatomy_source` (only written when the Phase-1 flag-gated engine ran); legacy rows take the unchanged path in every modified handler/component. No gap.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". Task 2 Step 6 is an explicit run-and-observe contract probe with a defensive parser + concrete fallback (not a placeholder — same pattern as Phase-1 Task 1 Step 7). Task 1/12 reference exact current line numbers; Task 12 Step 1 instructs copying the test file's existing `window.api` mock pattern because that mock's exact shape is file-specific (the instruction is concrete: extend `skill.get` + add `skill.getAnatomy`).

**3. Type consistency:** `AnatomyVerifyResult`/`AnatomyRuleResult` defined Task 2, consumed Task 3 (output `verify`), persisted Task 3, parsed Task 8, viewed via `AnatomyVerifyView` (Task 8 renderer mirror). `StalenessResult` defined Task 4 (`{stale,reason,latestSha}`), consumed Task 5 (`isAnatomyRepoStale`). `AnatomyPayload`/`AnatomyModelView`/`AnatomyMemoryEntryView` defined Task 8, consumed Tasks 9-12. `skill:getAnatomy` IPC (Task 8) ↔ `window.api.skill.getAnatomy` (Task 8 preload) ↔ consumers (Task 12) consistent. `SkillRow.anatomy_source?` (Task 8) gates Task 12 branch. Migration column `anatomy_verify` (Task 1) matches the INSERT in Task 3 Step 5 and the SELECT in Tasks 6/7/8. Consistent.
