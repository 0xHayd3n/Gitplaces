# Anatomy Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the anatomy engine as a flag-gated alternative skill source — clone a repo, run the vendored anatomy CLI, store the raw `.anatomy`/`.anatomy-memory` verbatim, and serve it through the existing MCP `get_skill` — without touching the live legacy pipeline.

**Architecture:** New `electron/anatomy/` subsystem. A bundled Node ≥22 spawns the vendored `@anatomy/cli` (from-source git submodule — no npm package exists) against an `isomorphic-git` shallow clone. Output is stored verbatim in the existing `skills` table (new columns) + `userData/anatomy/<owner>/<repo>/`. A single settings flag (`anatomyEngineEnabled`, default OFF) branches `electron/main.ts` and `electron/services/updateService.ts` to the new engine; legacy `skill-gen` stays the live path.

**Tech Stack:** Electron 31 (Node 20 main) · TypeScript · better-sqlite3 · electron-vite (`externalizeDepsPlugin`) · vitest · `smol-toml` (already a dep) · `isomorphic-git@1.38.0` (new dep) · vendored `0xHayd3n/anatomy` CLI built with a fetched Node 22.

**Grounded scope refinements (deviations from spec §6, surfaced honestly):**
- Spec §6 said "electron-builder `extraResources`". **There is no electron-builder in this repo** (no dep, no `build` field; build is `electron-vite`). Installer/packaging wiring is therefore **explicitly out of Phase 1 scope**. Phase 1 proves the engine in `electron-vite dev` + `vitest` with runtime resolution via a `vendor/` dir; production packaging is a separate follow-up.
- Spec §6/D9 said "vendored `@anatomy/cli`". **No `@anatomy/cli` / `@anatomy/spec` exists on npm** (verified 404). The CLI is vendored as a **pinned git submodule** built from source.

---

## File Structure

**Create:**
- `.gitmodules` — pins `vendor/anatomy` → `https://github.com/0xHayd3n/anatomy`
- `vendor/anatomy/` — git submodule (the anatomy repo; CLI lives in `vendor/anatomy/anatomy-cli/`)
- `scripts/fetch-node22.mjs` — downloads Node ≥22 for the host platform into `vendor/node22/`
- `scripts/build-anatomy.mjs` — builds `vendor/anatomy/anatomy-cli` using `vendor/node22`
- `electron/anatomy/types.ts` — `AnatomyModel`, `MemoryEntry`, `AnatomyGenerateInput`, `AnatomyGenerateOutput`
- `electron/anatomy/flag.ts` — `isAnatomyEngineEnabled(db)`
- `electron/anatomy/parse.ts` — `parseAnatomy()`, `parseMemory()` (smol-toml; pure)
- `electron/anatomy/runtime.ts` — `resolveAnatomyRuntime()`, `spawnAnatomy()`
- `electron/anatomy/clone.ts` — `cacheDirFor()`, `exceedsCeiling()`, `selectEvictions()`, `ensureClone()`
- `electron/anatomy/index.ts` — `generateViaAnatomy()`, `persistAnatomySkill()`
- `electron/anatomy/staleness.ts` — Phase-2 typed stub
- `electron/anatomy/flag.test.ts`, `parse.test.ts`, `runtime.test.ts`, `clone.test.ts`, `index.test.ts`, `staleness.test.ts`
- `electron/anatomy/fixtures/sample.anatomy`, `sample.anatomy-memory`, `malformed.anatomy`
- `electron/db.anatomy-migration.test.ts`

**Modify:**
- `package.json` — add `isomorphic-git` dep; add `vendor`/`postinstall` scripts; add `.gitmodules` init
- `.gitignore` — ignore `vendor/node22/` and `anatomy-cache/`
- `electron/db.ts:270` — append idempotent anatomy column `ALTER`s
- `electron/main.ts:1371-1402` — flag branch around the non-ref `pipelineRoute` call
- `electron/services/updateService.ts:120-160` — flag branch in `applySkillRegen`
- `electron/mcp-server.ts:75-86,277-285` — `handleGetSkill` anatomy-row branch + call site
- `electron/mcp-server.test.ts` — anatomy `get_skill` cases

---

## Task 1: Add dependencies, vendor submodule, Node 22, gitignore

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `.gitmodules`, `scripts/fetch-node22.mjs`, `scripts/build-anatomy.mjs`

- [ ] **Step 1: Add the anatomy CLI as a pinned submodule**

Run:
```bash
git submodule add https://github.com/0xHayd3n/anatomy vendor/anatomy
cd vendor/anatomy && git rev-parse HEAD && cd ../..
```
Expected: `vendor/anatomy` created, a `.gitmodules` file written, prints the pinned commit SHA. Record that SHA in the commit message in Step 7.

- [ ] **Step 2: Add `isomorphic-git` dependency**

Run:
```bash
npm install isomorphic-git@1.38.0
```
Expected: `package.json` `dependencies` gains `"isomorphic-git": "1.38.0"`; install exits 0. (electron-vite's `externalizeDepsPlugin()` auto-externalizes it — no `electron.vite.config.ts` change needed.)

- [ ] **Step 3: Write `scripts/fetch-node22.mjs`**

```js
// Downloads an official Node >=22 runtime for the host platform into vendor/node22/.
// Idempotent: skips if vendor/node22/<bin> already exists.
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VER = 'v22.11.0'
const dest = join(ROOT, 'vendor', 'node22')
const platform = process.platform
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

const binRel =
  platform === 'win32' ? 'node.exe'
  : join('bin', 'node')
const binAbs = join(dest, binRel)
if (existsSync(binAbs)) { console.log('[fetch-node22] present, skipping'); process.exit(0) }

mkdirSync(dest, { recursive: true })
const osTag = platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux'
const ext = platform === 'win32' ? 'zip' : 'tar.gz'
const name = `node-${VER}-${osTag}-${arch}`
const url = `https://nodejs.org/dist/${VER}/${name}.${ext}`
console.log(`[fetch-node22] ${url}`)

const tmp = join(dest, `dl.${ext}`)
const res = await fetch(url)
if (!res.ok) { console.error(`[fetch-node22] HTTP ${res.status}`); process.exit(1) }
await pipeline(res.body, createWriteStream(tmp))

if (ext === 'zip') {
  execFileSync('tar', ['-xf', tmp, '-C', dest], { stdio: 'inherit' }) // bsdtar on Win10+
} else {
  execFileSync('tar', ['-xzf', tmp, '-C', dest], { stdio: 'inherit' })
}
// Flatten node-vX-os-arch/* into vendor/node22/*
execFileSync(process.execPath, ['-e', `
const {renameSync,readdirSync,rmSync}=require('fs');const {join}=require('path');
const d=${JSON.stringify(dest)};const inner=join(d,${JSON.stringify(name)});
for(const f of readdirSync(inner)) renameSync(join(inner,f), join(d,f));
rmSync(inner,{recursive:true,force:true}); rmSync(${JSON.stringify(tmp)},{force:true});
`], { stdio: 'inherit' })
console.log(`[fetch-node22] installed at ${binAbs}`)
```

- [ ] **Step 4: Write `scripts/build-anatomy.mjs`**

```js
// Builds the vendored anatomy CLI using the fetched Node 22.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const node22 = process.platform === 'win32'
  ? join(ROOT, 'vendor', 'node22', 'node.exe')
  : join(ROOT, 'vendor', 'node22', 'bin', 'node')
const cliDir = join(ROOT, 'vendor', 'anatomy', 'anatomy-cli')

if (!existsSync(node22)) { console.error('[build-anatomy] run fetch-node22 first'); process.exit(1) }
if (!existsSync(cliDir)) { console.error('[build-anatomy] submodule missing: git submodule update --init'); process.exit(1) }

const npmCli = join(dirname(node22), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
const run = (args) => execFileSync(node22, [npmCli, ...args], { cwd: cliDir, stdio: 'inherit' })
run(['ci'])
run(['run', 'build'])
console.log('[build-anatomy] built', join(cliDir, 'dist'))
```

- [ ] **Step 5: Wire `package.json` scripts**

Add to `package.json` `scripts` (keep existing keys):
```json
"vendor:node22": "node scripts/fetch-node22.mjs",
"vendor:anatomy": "git submodule update --init --recursive && node scripts/build-anatomy.mjs",
"vendor": "npm run vendor:node22 && npm run vendor:anatomy"
```

- [ ] **Step 6: Update `.gitignore`**

Append:
```
vendor/node22/
**/anatomy-cache/
```
(`vendor/anatomy/` is a submodule — tracked via `.gitmodules`, not ignored.)

- [ ] **Step 7: Run the vendor pipeline and verify the CLI contract**

Run:
```bash
npm run vendor
./vendor/node22/bin/node vendor/anatomy/anatomy-cli/dist/index.js --help
```
(Windows: `.\vendor\node22\node.exe vendor\anatomy\anatomy-cli\dist\index.js --help`)
Expected: help text listing `generate`, `validate`, `render`, `mcp`. **If the entry path is not `dist/index.js`**, inspect `vendor/anatomy/anatomy-cli/package.json` `bin`/`main` and record the real entry — it is consumed verbatim in Task 5 Step 3. Do not proceed until `--help` exits 0.

- [ ] **Step 8: Commit**

```bash
git add .gitmodules package.json package-lock.json .gitignore scripts/
git commit -m "build(anatomy): vendor anatomy CLI submodule + Node 22 + isomorphic-git (pinned <SHA from Step 1>)"
```

---

## Task 2: `electron/anatomy/types.ts`

**Files:**
- Create: `electron/anatomy/types.ts`

- [ ] **Step 1: Write the types (no test — pure declarations, exercised by later tasks)**

```ts
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
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `electron/anatomy/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add electron/anatomy/types.ts
git commit -m "feat(anatomy): add core type definitions"
```

---

## Task 3: DB migration — anatomy columns

**Files:**
- Modify: `electron/db.ts` (after line 270, the `sub_skills` sync-column block)
- Test: `electron/db.anatomy-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
// electron/db.anatomy-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — anatomy columns', () => {
  it('adds anatomy_* columns to skills', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = (db.prepare("PRAGMA table_info('skills')").all() as { name: string }[]).map(c => c.name)
    for (const c of ['anatomy_memory', 'anatomy_commit', 'anatomy_fingerprint', 'anatomy_source', 'anatomy_brief']) {
      expect(cols).toContain(c)
    }
  })

  it('preserves existing skills rows (anatomy_source defaults null)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO repos (id, owner, name, topics) VALUES ('r1','o','n','[]')`).run()
    db.prepare(`INSERT INTO skills (repo_id, filename, content, version, generated_at, active) VALUES ('r1','n.skill.md','','v1','now',1)`).run()
    const row = db.prepare(`SELECT anatomy_source FROM skills WHERE repo_id='r1'`).get() as { anatomy_source: string | null }
    expect(row.anatomy_source).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/db.anatomy-migration.test.ts`
Expected: FAIL — `expected [ ... ] to contain 'anatomy_memory'`.

- [ ] **Step 3: Add the migration**

In `electron/db.ts`, immediately after line 270 (`try { db.exec(\`ALTER TABLE sub_skills ADD COLUMN sync_status TEXT\`) } catch {}`), insert:

```ts
  // Anatomy engine columns (Phase 1) — raw .anatomy is stored in skills.content;
  // github_sha (added above) doubles as the anatomy commit pin.
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_memory      TEXT`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_commit      TEXT`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_fingerprint TEXT`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_source      TEXT`) } catch {}
  try { db.exec(`ALTER TABLE skills ADD COLUMN anatomy_brief       TEXT`) } catch {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- electron/db.anatomy-migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.anatomy-migration.test.ts
git commit -m "feat(anatomy): add idempotent skills.anatomy_* column migration"
```

---

## Task 4: `electron/anatomy/flag.ts` — engine flag

**Files:**
- Create: `electron/anatomy/flag.ts`, `electron/anatomy/flag.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/anatomy/flag.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'
import { isAnatomyEngineEnabled } from './flag'

describe('isAnatomyEngineEnabled', () => {
  it('defaults to false when unset', () => {
    const db = getDb(mkdtempSync(join(tmpdir(), 'git-suite-db-')))
    expect(isAnatomyEngineEnabled(db)).toBe(false)
  })

  it('is true only when the setting is exactly "true"', () => {
    const db = getDb(mkdtempSync(join(tmpdir(), 'git-suite-db-')))
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','true')").run()
    expect(isAnatomyEngineEnabled(db)).toBe(true)
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','1')").run()
    expect(isAnatomyEngineEnabled(db)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/anatomy/flag.test.ts`
Expected: FAIL — cannot find module `./flag`.

- [ ] **Step 3: Implement**

```ts
// electron/anatomy/flag.ts
import type Database from 'better-sqlite3'

export const ANATOMY_FLAG_KEY = 'anatomyEngineEnabled'

export function isAnatomyEngineEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ANATOMY_FLAG_KEY) as
    { value: string } | undefined
  return row?.value === 'true'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- electron/anatomy/flag.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/flag.ts electron/anatomy/flag.test.ts
git commit -m "feat(anatomy): add anatomyEngineEnabled flag helper"
```

---

## Task 5: `electron/anatomy/parse.ts` — TOML → model

**Files:**
- Create: `electron/anatomy/parse.ts`, `electron/anatomy/parse.test.ts`
- Create: `electron/anatomy/fixtures/sample.anatomy`, `sample.anatomy-memory`, `malformed.anatomy`

- [ ] **Step 1: Write the fixtures**

`electron/anatomy/fixtures/sample.anatomy`:
```toml
[identity]
stack = "TypeScript / Node"
form = "library"
domain = "git tooling"
function = "turns repos into agent knowledge"

[generated]
fingerprint = "fp_abc123"
commit = "deadbeefcafe"
at = "2026-05-17T00:00:00Z"
by = "anatomy@1.0.0 claude-cli"

[[rules]]
statement = "All DB writes go through electron/db.ts"
verify = { kind = "glob", pattern = "electron/db.ts" }

[[decisions]]
decision = "Serve anatomy verbatim"
rationale = "Reprojection loses citation fidelity"
```

`electron/anatomy/fixtures/sample.anatomy-memory`:
```toml
anatomy_memory_version = "0.2"
repo_fingerprint = "fp_abc123"

[[entries]]
text = "isomorphic-git shallow clone needs depth:1 or it OOMs on big repos"
kind = "gotcha"
at = "2026-05-16T12:00:00Z"

[[entries]]
text = "Old approach using tarball extract — superseded, anatomy needs real .git"
kind = "attempt"
at = "2026-05-10T09:00:00Z"
superseded = true
```

`electron/anatomy/fixtures/malformed.anatomy`:
```toml
[identity
stack = "broken
```

- [ ] **Step 2: Write the failing test**

```ts
// electron/anatomy/parse.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAnatomy, parseMemory } from './parse'

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8')

describe('parseAnatomy', () => {
  it('extracts identity, generated, rules, decisions', () => {
    const m = parseAnatomy(fx('sample.anatomy'))
    expect(m.identity.form).toBe('library')
    expect(m.generated.commit).toBe('deadbeefcafe')
    expect(m.rules).toHaveLength(1)
    expect(m.rules[0].statement).toMatch(/electron\/db\.ts/)
    expect(m.rules[0].verify?.kind).toBe('glob')
    expect(m.decisions[0].decision).toBe('Serve anatomy verbatim')
  })

  it('throws a typed error on malformed TOML', () => {
    expect(() => parseAnatomy(fx('malformed.anatomy'))).toThrow(/anatomy parse/i)
  })

  it('tolerates missing optional tables', () => {
    const m = parseAnatomy('[identity]\nform="x"\n[generated]\ncommit="c"\n')
    expect(m.rules).toEqual([])
    expect(m.decisions).toEqual([])
    expect(m.operation).toBeUndefined()
  })
})

describe('parseMemory', () => {
  it('parses entries and superseded flag', () => {
    const e = parseMemory(fx('sample.anatomy-memory'))
    expect(e).toHaveLength(2)
    expect(e[0].kind).toBe('gotcha')
    expect(e[1].superseded).toBe(true)
  })

  it('returns [] for null input', () => {
    expect(parseMemory(null)).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- electron/anatomy/parse.test.ts`
Expected: FAIL — cannot find module `./parse`.

- [ ] **Step 4: Implement**

```ts
// electron/anatomy/parse.ts
import { parse as parseToml } from 'smol-toml'
import type { AnatomyModel, MemoryEntry } from './types'

export function parseAnatomy(toml: string): AnatomyModel {
  let raw: Record<string, unknown>
  try {
    raw = parseToml(toml) as Record<string, unknown>
  } catch (err) {
    throw new Error(`anatomy parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const rules = Array.isArray(raw.rules) ? (raw.rules as AnatomyModel['rules']) : []
  const decisions = Array.isArray(raw.decisions) ? (raw.decisions as AnatomyModel['decisions']) : []
  return {
    identity: (raw.identity as AnatomyModel['identity']) ?? {},
    generated: (raw.generated as AnatomyModel['generated']) ?? {},
    operation: raw.operation as Record<string, unknown> | undefined,
    substance: raw.substance as Record<string, unknown> | undefined,
    rules,
    decisions,
  }
}

export function parseMemory(toml: string | null): MemoryEntry[] {
  if (!toml) return []
  try {
    const raw = parseToml(toml) as Record<string, unknown>
    return Array.isArray(raw.entries) ? (raw.entries as MemoryEntry[]) : []
  } catch (err) {
    throw new Error(`anatomy memory parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- electron/anatomy/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add electron/anatomy/parse.ts electron/anatomy/parse.test.ts electron/anatomy/fixtures/
git commit -m "feat(anatomy): TOML parser for .anatomy/.anatomy-memory"
```

---

## Task 6: `electron/anatomy/runtime.ts` — runtime resolution + spawn

**Files:**
- Create: `electron/anatomy/runtime.ts`, `electron/anatomy/runtime.test.ts`

- [ ] **Step 1: Write the failing test (pure resolution + arg building)**

```ts
// electron/anatomy/runtime.test.ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveAnatomyRuntime, buildSpawnArgs } from './runtime'

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/anatomy/runtime.test.ts`
Expected: FAIL — cannot find module `./runtime`.

- [ ] **Step 3: Implement**

```ts
// electron/anatomy/runtime.ts
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export interface RuntimeOpts {
  packaged: boolean
  platform: NodeJS.Platform
  repoRoot?: string
  resourcesPath?: string
}

export interface ResolvedRuntime { nodeBin: string; cliEntry: string }

export function resolveAnatomyRuntime(o: RuntimeOpts): ResolvedRuntime {
  const base = o.packaged ? (o.resourcesPath ?? '') : join(o.repoRoot ?? '', 'vendor')
  const node22Root = o.packaged ? join(base, 'node22') : join(base, 'node22')
  const nodeBin = o.platform === 'win32'
    ? join(node22Root, 'node.exe')
    : join(node22Root, 'bin', 'node')
  const cliEntry = o.packaged
    ? join(base, 'anatomy', 'anatomy-cli', 'dist', 'index.js')
    : join(base, 'anatomy', 'anatomy-cli', 'dist', 'index.js')
  return { nodeBin, cliEntry }
}

export function buildSpawnArgs(cliEntry: string, anatomyArgs: string[]): string[] {
  return [cliEntry, ...anatomyArgs]
}

export interface SpawnResult { stdout: string; stderr: string; code: number }

/** Spawn the vendored anatomy CLI under bundled Node 22. Arg array only — never a shell. */
export function spawnAnatomy(
  rt: ResolvedRuntime,
  anatomyArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    execFile(
      rt.nodeBin,
      buildSpawnArgs(rt.cliEntry, anatomyArgs),
      { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as unknown as { code: number }).code : err ? 1 : 0
        if (err && code === 0) return reject(err) // spawn-level failure (ENOENT etc.)
        resolve({ stdout: String(stdout), stderr: String(stderr), code })
      },
    )
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- electron/anatomy/runtime.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a gated real-spawn smoke test**

Append to `electron/anatomy/runtime.test.ts`:
```ts
import { existsSync } from 'node:fs'
import { spawnAnatomy } from './runtime'

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
```

Run: `npm test -- electron/anatomy/runtime.test.ts`
Expected: PASS; smoke `describe` runs only if `npm run vendor` was done, otherwise skipped (logged as skipped).

- [ ] **Step 6: Commit**

```bash
git add electron/anatomy/runtime.ts electron/anatomy/runtime.test.ts
git commit -m "feat(anatomy): runtime resolution + spawnAnatomy"
```

---

## Task 7: `electron/anatomy/clone.ts` — shallow clone + cache

**Files:**
- Create: `electron/anatomy/clone.ts`, `electron/anatomy/clone.test.ts`

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// electron/anatomy/clone.test.ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { cacheDirFor, exceedsCeiling, selectEvictions } from './clone'

describe('cacheDirFor', () => {
  it('namespaces by owner/repo@sha and sanitises', () => {
    expect(cacheDirFor('/c', 'o', 'n', 'abc')).toBe(join('/c', 'o', 'n@abc'))
    expect(cacheDirFor('/c', 'o/x', 'n', 'a')).toBe(join('/c', 'o_x', 'n@a'))
  })
})

describe('exceedsCeiling', () => {
  it('compares GitHub size (KB) to a byte ceiling', () => {
    expect(exceedsCeiling(300_000, 250 * 1024 * 1024)).toBe(true)   // ~293 MB
    expect(exceedsCeiling(1000, 250 * 1024 * 1024)).toBe(false)
  })
})

describe('selectEvictions', () => {
  const now = 1_000_000_000_000
  it('evicts oldest first when over budget', () => {
    const entries = [
      { dir: 'a', bytes: 100, mtimeMs: now - 5000 },
      { dir: 'b', bytes: 100, mtimeMs: now - 1000 },
    ]
    expect(selectEvictions(entries, 150, 14 * 864e5, now)).toEqual(['a'])
  })
  it('evicts entries older than maxAge regardless of budget', () => {
    const entries = [{ dir: 'old', bytes: 1, mtimeMs: now - 20 * 864e5 }]
    expect(selectEvictions(entries, 1e9, 14 * 864e5, now)).toEqual(['old'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/anatomy/clone.test.ts`
Expected: FAIL — cannot find module `./clone`.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- electron/anatomy/clone.test.ts`
Expected: PASS (5 tests). (`ensureClone`/`dirBytes` are integration-covered in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/clone.ts electron/anatomy/clone.test.ts
git commit -m "feat(anatomy): isomorphic-git shallow clone + LRU cache helpers"
```

---

## Task 8: `electron/anatomy/staleness.ts` — Phase-2 stub

**Files:**
- Create: `electron/anatomy/staleness.ts`, `electron/anatomy/staleness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/anatomy/staleness.test.ts
import { describe, it, expect } from 'vitest'
import { isAnatomyStale } from './staleness'

describe('isAnatomyStale (Phase 1 stub)', () => {
  it('always reports not-stale with a phase2 reason', async () => {
    expect(await isAnatomyStale('o', 'n', 'sha', null)).toEqual({ stale: false, reason: 'phase2-not-implemented' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/anatomy/staleness.test.ts`
Expected: FAIL — cannot find module `./staleness`.

- [ ] **Step 3: Implement the typed stub**

```ts
// electron/anatomy/staleness.ts
// Phase 1: typed seam only. Phase 2 implements the GitHub
// `GET /repos/{o}/{n}/commits?path=.anatomy&per_page=1` probe and wires it
// into updateService.checkRepo / repos.update_available.
export interface StalenessResult { stale: boolean; reason: string }

export async function isAnatomyStale(
  _owner: string, _name: string, _storedCommit: string | null, _token: string | null,
): Promise<StalenessResult> {
  return { stale: false, reason: 'phase2-not-implemented' }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- electron/anatomy/staleness.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/staleness.ts electron/anatomy/staleness.test.ts
git commit -m "feat(anatomy): Phase-2 staleness stub seam"
```

---

## Task 9: `electron/anatomy/index.ts` — orchestration

**Files:**
- Create: `electron/anatomy/index.ts`, `electron/anatomy/index.test.ts`

- [ ] **Step 1: Write the failing test (orchestration with injected deps)**

```ts
// electron/anatomy/index.test.ts
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
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/anatomy/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Implement**

```ts
// electron/anatomy/index.ts
import { join } from 'node:path'
import { readFile as fsReadFile, writeFile, mkdir } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { parseAnatomy, parseMemory } from './parse'
import type { ResolvedRuntime, SpawnResult } from './runtime'
import type { AnatomyGenerateInput, AnatomyGenerateOutput } from './types'

export interface AnatomyEngineDeps {
  ensureClone: (root: string, owner: string, name: string, branch: string, token: string | null) => Promise<{ dir: string; sha: string }>
  spawnAnatomy: (rt: ResolvedRuntime, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<SpawnResult>
  readFile: (p: string) => Promise<string | null>
  runtime: ResolvedRuntime
}

const BRIEF_BUDGET = 1500

async function tryGenerate(
  d: AnatomyEngineDeps, dir: string, apiKey?: string,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []
  const env = { ...process.env, ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}) }
  // 1. claude-cli (no key)
  let r = await d.spawnAnatomy(d.runtime, ['generate', '--ai', '--provider', 'claude-cli', '--repo', dir], dir, env)
  if (r.code === 0) return { warnings }
  // 2. anthropic-http (needs key)
  if (apiKey) {
    r = await d.spawnAnatomy(d.runtime, ['generate', '--ai', '--provider', 'anthropic-http', '--repo', dir], dir, env)
    if (r.code === 0) { warnings.push('anatomy: generated via Anthropic API (Claude Code unavailable)'); return { warnings } }
  }
  // 3. Pass-1 deterministic (no --ai) — always produces a valid .anatomy
  r = await d.spawnAnatomy(d.runtime, ['generate', '--repo', dir], dir, env)
  if (r.code !== 0) throw new Error(`anatomy generate failed (all providers): ${r.stderr.slice(0, 500)}`)
  warnings.push('anatomy: AI enrichment unavailable — used deterministic Pass-1 (lower richness)')
  return { warnings }
}

export async function generateViaAnatomy(
  input: AnatomyGenerateInput,
  d: AnatomyEngineDeps,
  cacheRoot = join(process.cwd(), '.anatomy-cache'),
): Promise<AnatomyGenerateOutput> {
  const { token, owner, name, defaultBranch, apiKey } = input
  let clone: { dir: string; sha: string }
  try {
    clone = await d.ensureClone(cacheRoot, owner, name, defaultBranch, token)
  } catch (err) {
    throw new Error(`anatomy clone failed for ${owner}/${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const warnings: string[] = []
  let source: 'committed' | 'generated'

  const v = await d.spawnAnatomy(d.runtime, ['validate', '--require'], clone.dir)
  if (v.code === 0) {
    source = 'committed'
  } else {
    source = 'generated'
    const g = await tryGenerate(d, clone.dir, apiKey)
    warnings.push(...g.warnings)
  }

  const content = await d.readFile(join(clone.dir, '.anatomy'))
  if (content === null) throw new Error(`anatomy: no .anatomy produced for ${owner}/${name}`)
  const memory = await d.readFile(join(clone.dir, '.anatomy-memory'))

  const model = parseAnatomy(content)
  parseMemory(memory) // validate memory parses; surfaced in Phase 2 UI

  const briefRes = await d.spawnAnatomy(d.runtime, ['render', '--budget', String(BRIEF_BUDGET)], clone.dir)
  const brief = briefRes.code === 0 && briefRes.stdout.trim() ? briefRes.stdout : content

  return {
    content,
    memory,
    brief,
    commit: (model.generated.commit as string | undefined) ?? clone.sha ?? null,
    fingerprint: (model.generated.fingerprint as string | undefined) ?? null,
    source,
    warnings,
  }
}

/** Persist verbatim — mirrors the legacy library path in main.ts:1506-1530. */
export async function persistAnatomySkill(
  db: Database.Database, userDataDir: string, repoId: string, owner: string, name: string,
  out: AnatomyGenerateOutput, version: string,
): Promise<void> {
  const dir = join(userDataDir, 'anatomy', owner, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '.anatomy'), out.content, 'utf8')
  if (out.memory) await writeFile(join(dir, '.anatomy-memory'), out.memory, 'utf8')
  const generated_at = new Date().toISOString()
  db.prepare(`
    INSERT INTO skills (repo_id, filename, content, version, generated_at, active, enabled_components, tier,
                        anatomy_memory, anatomy_commit, anatomy_fingerprint, anatomy_source, anatomy_brief, github_sha)
    VALUES (?, '.anatomy', ?, ?, ?, 1, NULL, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id) DO UPDATE SET
      filename=excluded.filename, content=excluded.content, version=excluded.version,
      generated_at=excluded.generated_at, anatomy_memory=excluded.anatomy_memory,
      anatomy_commit=excluded.anatomy_commit, anatomy_fingerprint=excluded.anatomy_fingerprint,
      anatomy_source=excluded.anatomy_source, anatomy_brief=excluded.anatomy_brief,
      github_sha=excluded.github_sha
  `).run(repoId, out.content, version, generated_at, out.memory, out.commit, out.fingerprint, out.source, out.brief, out.commit)
}

export const readFileOrNull = async (p: string): Promise<string | null> =>
  fsReadFile(p, 'utf8').catch(() => null)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- electron/anatomy/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/index.ts electron/anatomy/index.test.ts
git commit -m "feat(anatomy): generateViaAnatomy orchestration + verbatim persistence"
```

---

## Task 10: Branch seam — `main.ts` + `updateService.ts`

**Files:**
- Modify: `electron/main.ts:1371-1402`
- Modify: `electron/services/updateService.ts:120-160`

- [ ] **Step 1: Add the `main.ts` import**

At the top of `electron/main.ts`, near the existing skill-gen imports (line 26-27), add:
```ts
import { isAnatomyEngineEnabled } from './anatomy/flag'
import { generateViaAnatomy, persistAnatomySkill, readFileOrNull } from './anatomy/index'
import { ensureClone } from './anatomy/clone'
import { spawnAnatomy, resolveAnatomyRuntime } from './anatomy/runtime'
```

- [ ] **Step 2: Wrap the non-ref `pipelineRoute` block with the flag branch**

In `electron/main.ts`, the existing non-ref `else` block is lines 1371-1403:
```ts
    } else {
      const routeResult = await pipelineRoute(flavour, { ... })
      if (routeResult.flavour === 'codebase') { ... } else { ... }
    }
```
Replace the **opening** of that `else` (line 1371-1372) so it reads:
```ts
    } else if (isAnatomyEngineEnabled(db)) {
      const rt = resolveAnatomyRuntime({
        packaged: app.isPackaged, platform: process.platform,
        repoRoot: process.cwd(), resourcesPath: process.resourcesPath,
      })
      const a = await generateViaAnatomy(
        { token, owner, name, defaultBranch: repo.default_branch ?? 'main', apiKey: apiKey ?? undefined },
        { ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime: rt },
        path.join(app.getPath('userData'), 'anatomy-cache'),
      )
      await persistAnatomySkill(db, app.getPath('userData'), repo.id, owner, name, a, version)
      return { content: a.content, version, generated_at: new Date().toISOString(), warnings: a.warnings }
    } else {
      const routeResult = await pipelineRoute(flavour, {
```
(The remaining legacy `routeResult` body and its closing `}` are unchanged.)

- [ ] **Step 3: Verify the legacy path still type-checks and runs**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- electron/main.test.ts`
Expected: no type errors; existing `main.test.ts` suite stays green (flag defaults OFF → legacy path unchanged).

- [ ] **Step 4: Add the `updateService.ts` branch**

In `electron/services/updateService.ts`, add imports near line 9:
```ts
import { isAnatomyEngineEnabled } from '../anatomy/flag'
import { generateViaAnatomy, persistAnatomySkill, readFileOrNull } from '../anatomy/index'
import { ensureClone } from '../anatomy/clone'
import { spawnAnatomy, resolveAnatomyRuntime } from '../anatomy/runtime'
import { app } from 'electron'
import path from 'node:path'
```
In `applySkillRegen`, immediately after the `row` null-check (current line 109, before `try {` at 111), insert:
```ts
  if (isAnatomyEngineEnabled(_db)) {
    try {
      const rt = resolveAnatomyRuntime({
        packaged: app.isPackaged, platform: process.platform,
        repoRoot: process.cwd(), resourcesPath: process.resourcesPath,
      })
      const a = await generateViaAnatomy(
        { token, owner: row.owner, name: row.name, defaultBranch: row.default_branch ?? 'main', apiKey: apiKey ?? undefined },
        { ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime: rt },
        path.join(app.getPath('userData'), 'anatomy-cache'),
      )
      await persistAnatomySkill(_db, app.getPath('userData'), repoId, row.owner, row.name, a, row.upstream_version ?? 'unknown')
      clearUpdateFlag(repoId, row.upstream_version)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- electron/services/skillSyncService.test.ts electron/main.test.ts`
Expected: no type errors; suites green.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/services/updateService.ts
git commit -m "feat(anatomy): flag-gated branch seam in main.ts + updateService"
```

---

## Task 11: MCP `get_skill` raw-payload branch

**Files:**
- Modify: `electron/mcp-server.ts:75-86` (`handleGetSkill`), `:280-282` (call site)
- Modify: `electron/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `electron/mcp-server.test.ts` (mirror its existing `handleGetSkill` setup — temp dir + `getDb` + insert repo/skill rows):
```ts
import { handleGetSkill } from './mcp-server'
// ... within describe('handleGetSkill'):

it('returns raw .anatomy + memory for anatomy-source rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gs-mcp-'))
  const db = getDb(dir)
  db.prepare(`INSERT INTO repos (id,owner,name,topics) VALUES ('r','o','n','[]')`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active,anatomy_source,anatomy_memory)
              VALUES ('r','.anatomy','[identity]\nform="lib"','v','t',1,'generated','[[entries]]\ntext="gotcha"')`).run()
  const res = handleGetSkill(dir, 'o', 'n', db)
  expect(res.content[0].text).toMatch(/\[identity\]/)
  expect(res.content[0].text).toMatch(/Lived experience/)
  expect(res.content[0].text).toMatch(/gotcha/)
})

it('still reads the .skill.md file for legacy rows (no anatomy_source)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gs-mcp-'))
  const db = getDb(dir)
  const skillsDir = join(dir, 'skills', 'o'); mkdirSync(skillsDir, { recursive: true })
  writeFileSync(join(skillsDir, 'n.skill.md'), '## [CORE]\nlegacy', 'utf8')
  db.prepare(`INSERT INTO repos (id,owner,name,topics) VALUES ('r','o','n','[]')`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active) VALUES ('r','n.skill.md','x','v','t',1)`).run()
  expect(handleGetSkill(dir, 'o', 'n', db).content[0].text).toMatch(/legacy/)
})
```
(Add `mkdirSync, writeFileSync` to the `node:fs` import in the test file if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- electron/mcp-server.test.ts`
Expected: FAIL — `handleGetSkill` arity / anatomy branch missing.

- [ ] **Step 3: Modify `handleGetSkill`**

Replace `electron/mcp-server.ts:75-86` with:
```ts
export function handleGetSkill(
  dataDir: string, owner: string, repo: string, db: Database.Database | null,
): ToolResult {
  if (db) {
    const row = db.prepare(`
      SELECT s.content, s.anatomy_memory, s.anatomy_source
      FROM skills s JOIN repos r ON r.id = s.repo_id
      WHERE r.owner = ? AND r.name = ? AND s.active = 1
    `).get(owner, repo) as { content: string; anatomy_memory: string | null; anatomy_source: string | null } | undefined
    if (row?.anatomy_source) {
      const mem = row.anatomy_memory
        ? `\n\n# Lived experience (.anatomy-memory)\n\n${row.anatomy_memory}` : ''
      return text(row.content + mem)
    }
  }
  const skillPath = path.join(dataDir, 'skills', owner, `${repo}.skill.md`)
  const resolved = path.resolve(skillPath)
  const base = path.resolve(path.join(dataDir, 'skills'))
  if (!resolved.startsWith(base + path.sep)) return text(`Invalid skill path for ${owner}/${repo}`)
  if (!fs.existsSync(resolved)) return text(`No skill file found for ${owner}/${repo}`)
  return text(fs.readFileSync(resolved, 'utf8'))
}
```
Add `import type Database from 'better-sqlite3'` at the top if absent.

- [ ] **Step 4: Update the call site**

At `electron/mcp-server.ts:281-282` change:
```ts
      case 'get_skill':
        if (!input.owner || !input.repo) return text('Missing required parameters: owner, repo')
        return handleGetSkill(dataDir, input.owner, input.repo, db)
```
(`db` is in scope in the `CallToolRequestSchema` handler and may be `null` — the new signature accepts that.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- electron/mcp-server.test.ts`
Expected: PASS — new anatomy + legacy cases green, existing cases unaffected.

- [ ] **Step 6: Commit**

```bash
git add electron/mcp-server.ts electron/mcp-server.test.ts
git commit -m "feat(anatomy): get_skill returns raw .anatomy payload for anatomy rows"
```

---

## Task 12: End-to-end exit criterion (vendored, gated)

**Files:**
- Create: `electron/anatomy/e2e.test.ts`
- Create: `docs/superpowers/plans/anatomy-phase1-runbook.md`

- [ ] **Step 1: Write the gated end-to-end test**

```ts
// electron/anatomy/e2e.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureClone } from './clone'
import { spawnAnatomy } from './runtime'
import { generateViaAnatomy, readFileOrNull } from './index'

const node = process.platform === 'win32'
  ? join(process.cwd(), 'vendor', 'node22', 'node.exe')
  : join(process.cwd(), 'vendor', 'node22', 'bin', 'node')
const cli = join(process.cwd(), 'vendor', 'anatomy', 'anatomy-cli', 'dist', 'index.js')
const vendored = existsSync(node) && existsSync(cli)
const runtime = { nodeBin: node, cliEntry: cli }

describe.runIf(vendored)('anatomy engine e2e (network + vendored CLI)', () => {
  const cases: Array<[string, string, string]> = [
    ['committed-anatomy', '0xHayd3n', 'anatomy'],
    ['generated-small', 'sindresorhus', 'is-odd'],
    ['edge-large', 'expressjs', 'express'],
  ]
  for (const [label, owner, name] of cases) {
    it(`produces a verbatim .anatomy for ${label} (${owner}/${name})`, async () => {
      const cacheRoot = mkdtempSync(join(tmpdir(), 'an-e2e-'))
      const out = await generateViaAnatomy(
        { token: process.env.GITHUB_TOKEN ?? null, owner, name, defaultBranch: 'main' },
        { ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime }, cacheRoot,
      )
      expect(out.content).toMatch(/\[identity\]/)
      expect(out.content).toMatch(/\[generated\]/)
      expect(['committed', 'generated']).toContain(out.source)
      expect(out.brief.length).toBeGreaterThan(0)
    }, 180_000)
  }
})
```

- [ ] **Step 2: Write the runbook**

`docs/superpowers/plans/anatomy-phase1-runbook.md`:
```markdown
# Anatomy Phase 1 — Manual Exit Verification

Prereq: `npm run vendor` (fetches Node 22, builds the anatomy submodule).

1. Vendored unit/integration: `npm test -- electron/anatomy electron/db.anatomy-migration.test.ts`
   — all suites green; spawn/e2e suites RUN (not skipped).
2. Live app smoke (flag ON):
   - `npm run dev`
   - DevTools console / SQLite: `INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','true')`
   - Install `0xHayd3n/anatomy` (committed .anatomy) → confirm `skills.anatomy_source='committed'`,
     `.anatomy` written under `userData/anatomy/0xHayd3n/anatomy/`.
   - Install a repo with no .anatomy (e.g. `sindresorhus/is-odd`) → `anatomy_source='generated'`.
   - Install a large repo (e.g. `expressjs/express`) → succeeds or fails with a typed
     size/clone error (no crash).
   - Claude Desktop → `get_skill` for each → returns raw TOML (+ memory section).
3. Flag OFF (`'false'` or unset): repeat install of any repo → legacy `.skill.md`
   produced, `anatomy_source` NULL. Confirms zero legacy regression.
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: entire suite green. Anatomy spawn/e2e suites run if `npm run vendor` was done, else cleanly skipped (CI without Node 22 stays green).

- [ ] **Step 4: Commit**

```bash
git add electron/anatomy/e2e.test.ts docs/superpowers/plans/anatomy-phase1-runbook.md
git commit -m "test(anatomy): gated end-to-end exit-criterion suite + runbook"
```

---

## Out of Scope (Phase 2/3 — do NOT implement here)

- Rule verification (`anatomy validate --json`, ast-grep/semgrep) — Phase 2.
- SHA-pinned staleness polling wired into `updateService.checkRepo`/`checkAll` — Phase 2 (stub only in Task 8).
- UI: Skill-tab anatomy view, `.anatomy-memory` panel, native indicators replacing `SkillDepthBars` — Phase 2.
- `search_skills` / `get_collection` raw/`anatomy_brief` mapping — Phase 2.
- Deleting `electron/skill-gen/`, regenerating installed skills, flipping the flag default — Phase 3.
- electron-builder/installer packaging of Node 22 + the CLI — separate packaging follow-up (no electron-builder exists yet).
- Resolving the components sub-skill question — Phase 3 gate (spec §13).

---

## Self-Review

**Spec coverage (spec §13 "Phase 1"):** bundle Node22+CLI → Task 1; `electron/anatomy/` modules (runtime/clone/parse/index/staleness) → Tasks 6/7/5/9/8; flag + branch seam (main.ts:1519 path, updateService:99) → Tasks 4/10; idempotent column migration → Task 3; verbatim raw storage (DB + userData) → Task 9 `persistAnatomySkill`; pre-render `anatomy_brief` (budget 1500) → Task 9; `handleGetSkill` raw payload → Task 11; committed path via `validate --require` → Task 9; provider chain claude-cli→anthropic-http→Pass-1 → Task 9; flag default OFF / legacy live → Tasks 4,10 (verified Task 10 Step 3/5, Task 12 Step 2.3); ≥3-repo e2e + mirrored tests → Task 12. All covered.

**Placeholder scan:** No TBD/TODO. The only `<...>` is `<SHA from Step 1>` in Task 1 Step 8's commit message — an intentional value the engineer records from Step 1 output, not an unspecified implementation. Task 1 Step 7 explicitly instructs verifying/recording the real CLI entry path if it differs from `dist/index.js` (external-tool contract guard, not a placeholder).

**Type consistency:** `AnatomyGenerateInput`/`AnatomyGenerateOutput`/`AnatomyModel`/`MemoryEntry` defined Task 2, consumed unchanged in Tasks 5/9/11. `AnatomyEngineDeps` defined Task 9, used identically in Tasks 9/10/12. `resolveAnatomyRuntime`/`spawnAnatomy`/`buildSpawnArgs` signatures defined Task 6, called with matching args in Tasks 9/10/12. `isAnatomyEngineEnabled(db)` defined Task 4, called in Task 10. `handleGetSkill(dataDir,owner,repo,db)` new arity defined Task 11 Step 3 and updated at its only call site Task 11 Step 4. `persistAnatomySkill` columns match the Task 3 migration exactly. Consistent.
