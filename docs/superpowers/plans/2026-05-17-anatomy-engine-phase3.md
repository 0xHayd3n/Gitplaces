# Anatomy Engine — Phase 3 Implementation Plan (Rip-out + Backfill)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make anatomy the unconditional master-skill engine — delete the legacy `skill-gen` master pipeline, keep only a slim component-sub-skill path (D12) and the frozen versioned-install path, remove the feature flag, and backfill existing installed skills to anatomy.

**Architecture:** The legacy `pipeline.generate/route` + classify + 6 non-component extractors/templates + the `index.ts` barrels + `prompts.ts` are deleted. A new **slim `electron/skill-gen/components.ts`** replaces `pipeline.generateComponents`, importing only the component-library extractor + a barrel-free prompt module + the minimal extraction/AI deps. The `anatomyEngineEnabled` flag is removed; `main.ts`/`updateService.ts` run anatomy unconditionally for the master skill. A settings-gated background **backfill** regenerates installed master skills through anatomy, replace-on-success-only.

**Tech Stack:** Electron 31 (Node 20 main) · TypeScript · better-sqlite3 · vitest · the Phase-1/2 anatomy engine (`electron/anatomy/`) · vendored anatomy CLI.

**HEAD:** `a029260` (Phases 1+2 complete; spec D12 recorded). Do not redo P1/P2.

---

## Binding scope decisions

- **D12 (spec):** keep `electron/skill-gen/extractors/component-library.ts` + the `get_components_skill` sub-skill generation as the single retained "build atop" exception. Master skill = raw `.anatomy`.
- **User decision (this plan):** the **versioned-install (`ref`) path is FROZEN** — `main.ts`'s `if (ref) { generateSkillViaLocalCLI → generateSkill }` branch and the `legacy.ts` functions it uses stay **100% untouched and unmigrated**. Not deleted, not anatomy-fied, "assess later". Phase 3 must not modify or break it.
- **Out of scope:** installer/electron-builder packaging; the pre-existing **RepoDetail.test.tsx** harness rot (11 failing tests at HEAD, unrelated to anatomy — tracked separately). Phase 3 UI verification uses `tsc` + the `AnatomyIndicators/View/MemoryPanel` suites + electron suites, NOT RepoDetail.test.tsx going green.

---

## Conventions (all tasks)

- **Branch:** work directly on `main`. No worktrees. No finishing-a-development-branch.
- **better-sqlite3 ABI dance:** if a test/rebuild fails `EBUSY`/`ERR_DLOPEN`, ensure the Electron app is closed, `npm rebuild better-sqlite3` once, use `npx vitest run <files>`; restore with `npx @electron/rebuild -f -o better-sqlite3` at the very end (Task 11).
- **Bash cwd persists** between commands and sub-shells may `cd` into `vendor/` — always run vitest as `cd /d/Coding/Git-Suite && npx vitest run <files>`.
- **No visual testing** (user preference) — RTL/jsdom only; never dev-server/screenshot.
- **Verify anchors at HEAD before every modify/delete** — line numbers shifted across P1/P2 + the user's type-cleanup. Each step says what to read first.
- **Deletion safety:** before `git rm` any module, `Grep` the whole repo for importers; only delete when the sole importers are other to-be-deleted modules or their `.test.ts`. After each deletion task, run the full electron regression.
- **Commits:** conventional; end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` via HEREDOC.

---

## Retained vs deleted (derived from the real import graph at HEAD)

**KEEP (component path + shared leaves + frozen ref-path deps):**
- `electron/skill-gen/extractors/component-library.ts` (+ `.test.ts`) — deps: `../types` only.
- `electron/skill-gen/github-files.ts` (deps `../github`, `./manifest-parser`), `manifest-parser.ts` (deps `./types`, `smol-toml`), `extraction-cache.ts`, `focus-inference.ts` (deps `./types`, `./legacy`), `validator.ts` (deps `./types`), `legacy.ts` (+ `login-helpers.ts`), `types.ts`. All retained (used by the slim component path and/or the frozen `ref` path).
- **NEW:** `electron/skill-gen/components-prompt.ts` (lift `buildComponentsPrompt` + `formatExtractionData` out of `templates/index.ts` — they use no template registry), `electron/skill-gen/components.ts` (slim `generateComponents`, no barrels).

**DELETE (master-only; proven unreferenced after the slim path lands):**
- `electron/skill-gen/pipeline.ts` (+ `.test.ts`), `prompts.ts`, `classifier.ts` (+ `.test.ts`).
- `electron/skill-gen/extractors/index.ts`, `library.ts`, `cli-tool.ts`, `framework.ts`, `monorepo.ts`, `infrastructure.ts`, `generic.ts` (+ their `.test.ts`).
- `electron/skill-gen/templates/index.ts`, `library.ts`, `cli-tool.ts`, `framework.ts`, `component-library.ts`, `monorepo.ts`, `infrastructure.ts`, `generic.ts` (+ `templates.test.ts`). (`component-library.ts` template is unused — `buildComponentsPrompt` never calls `getTemplate`.)
- `electron/anatomy/flag.ts` (+ `.test.ts`).

**MODIFY:** `electron/main.ts`, `electron/services/updateService.ts`, `electron/mcp-server.ts` (defensive only), `electron/db.ts` (backfill settings flag is runtime, not schema — see Task 8), `src/utils/skillParse.ts`, `src/views/RepoDetail.tsx`, `src/components/GenericDetail.tsx`. **NEW:** `electron/anatomy/backfill.ts` (+ `.test.ts`).

---

## Task 1: Lift the components prompt out of the template barrel

**Files:** Create `electron/skill-gen/components-prompt.ts` + `electron/skill-gen/components-prompt.test.ts`

- [ ] **Step 1: Read source.** Read `electron/skill-gen/templates/index.ts` lines 24-97 (`formatExtractionData`) and 173-249 (`buildComponentsPrompt`). These two functions use only `../types` + local logic — no template registry.

- [ ] **Step 2: Write the failing test**

```ts
// electron/skill-gen/components-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildComponentsPrompt } from './components-prompt'
import type { ExtractionResult } from './types'

const extraction: ExtractionResult = {
  repoType: 'component-library', manifest: { ecosystem: 'node', name: 'ui' }, fileTree: [],
  components: [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }],
}

describe('buildComponentsPrompt (lifted, barrel-free)', () => {
  it('emits the [COMPONENTS] format and includes scanned component names', () => {
    const p = buildComponentsPrompt(extraction, 'README', 'o/n', null,
      [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }])
    expect(p).toContain('## [COMPONENTS]')
    expect(p).toContain('Button')
    expect(p).toContain('o/n')
  })
})
```

- [ ] **Step 3: Run → fail.** `cd /d/Coding/Git-Suite && npx vitest run electron/skill-gen/components-prompt.test.ts` → cannot find module.

- [ ] **Step 4: Implement** — create `electron/skill-gen/components-prompt.ts` with `import type { ExtractionResult } from './types'` then the **verbatim** bodies of `formatExtractionData` (templates/index.ts:24-97) and `buildComponentsPrompt` (templates/index.ts:173-249), exporting `buildComponentsPrompt`. (Copy the exact current source from Step 1 — do not paraphrase.)

- [ ] **Step 5: Run → pass.** Same command → PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add electron/skill-gen/components-prompt.ts electron/skill-gen/components-prompt.test.ts
git commit -m "$(cat <<'EOF'
refactor(skill-gen): lift buildComponentsPrompt out of the template barrel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Slim `electron/skill-gen/components.ts` (barrel-free generateComponents)

Replaces `pipeline.generateComponents` without `extractors/index` / `templates/index` / `classifier` / `pipeline` / `prompts`.

**Files:** Create `electron/skill-gen/components.ts` + `electron/skill-gen/components.test.ts`

- [ ] **Step 1: Read source.** Read `electron/skill-gen/pipeline.ts` (current) — the `GenerateInput` interface, `getOrExtract`, and `generateComponents` (the bottom function). Reproduce its behaviour minus the generic classify/barrels: hardcode `repoType: 'component-library'`, call `componentLibraryExtractor` directly.

- [ ] **Step 2: Write the failing test**

```ts
// electron/skill-gen/components.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateComponents, type ComponentsInput } from './components'

vi.mock('./github-files', () => ({
  fetchFileTree: vi.fn(async () => ['src/Button.tsx']),
  fetchManifest: vi.fn(async () => ({ filename: 'package.json', content: '{"name":"ui"}' })),
}))
vi.mock('./manifest-parser', () => ({ parseManifest: () => ({ ecosystem: 'node', name: 'ui' }) }))
vi.mock('./legacy', () => ({ generateWithRawPrompt: vi.fn(async () => '## [COMPONENTS]\n### Button') }))
vi.mock('./focus-inference', () => ({ inferFocusInstructions: vi.fn(async () => null) }))

const input: ComponentsInput = {
  token: 't', owner: 'o', name: 'n', language: 'TypeScript', topics: [], readme: 'R',
  version: 'v1', defaultBranch: 'main',
  scannedComponents: [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }],
}

describe('generateComponents (slim)', () => {
  it('returns validated [COMPONENTS] content via the component-library extractor', async () => {
    const r = await generateComponents(input)
    expect(r.content).toContain('## [COMPONENTS]')
  })
  it('never imports the extractor/template barrels', async () => {
    const src = (await import('node:fs')).readFileSync('electron/skill-gen/components.ts', 'utf8')
    expect(src).not.toMatch(/extractors\/index|templates\/index|\.\/classifier|\.\/pipeline|\.\/prompts/)
  })
})
```

- [ ] **Step 3: Run → fail.** `cd /d/Coding/Git-Suite && npx vitest run electron/skill-gen/components.test.ts` → cannot find module.

- [ ] **Step 4: Implement** `electron/skill-gen/components.ts`:

```ts
import { fetchFileTree, fetchRepoFiles, fetchManifest } from './github-files'
import { parseManifest } from './manifest-parser'
import { componentLibraryExtractor } from './extractors/component-library'
import { buildComponentsPrompt } from './components-prompt'
import { inferFocusInstructions } from './focus-inference'
import { validateComponents } from './validator'
import { generateWithRawPrompt } from './legacy'
import { extractionCache } from './extraction-cache'
import type { ExtractionResult, ManifestInfo, ValidationResult } from './types'

export interface ComponentsInput {
  token: string | null
  owner: string
  name: string
  language: string
  topics: string[]
  readme: string
  version: string
  defaultBranch: string
  apiKey?: string
  typeBucket?: string
  typeSub?: string
  scannedComponents?: Array<{ name: string; props: Array<{ name: string; type: string; required: boolean; defaultValue?: string }> }>
}

async function extract(input: ComponentsInput): Promise<ExtractionResult> {
  const { token, owner, name, defaultBranch } = input
  const fallback: ExtractionResult = { repoType: 'component-library', manifest: { ecosystem: 'unknown' }, fileTree: [] }
  if (!token) return fallback
  const cacheKey = `components:${owner}/${name}@${defaultBranch}`
  const cached = extractionCache.get(cacheKey)
  if (cached) return cached.extraction
  try {
    const fileTree = await fetchFileTree(token, owner, name, defaultBranch)
    const manifestResult = await fetchManifest(token, owner, name, fileTree)
    let manifest: ManifestInfo = { ecosystem: 'unknown' }
    if (manifestResult) manifest = parseManifest(manifestResult.filename, manifestResult.content)
    const filesToFetch = componentLibraryExtractor.getFilesToFetch(fileTree, manifest)
    const files = await fetchRepoFiles(token, owner, name, filesToFetch)
    const extracted = componentLibraryExtractor.extract(files, manifest)
    const extraction: ExtractionResult = { repoType: 'component-library', manifest, fileTree, ...extracted }
    extractionCache.set(cacheKey, { extraction, repoType: 'component-library' })
    return extraction
  } catch (err) {
    console.error('[components] extraction failed, using fallback:', err)
    return fallback
  }
}

export async function generateComponents(
  input: ComponentsInput,
): Promise<{ content: string; validation: ValidationResult }> {
  const repoFullName = `${input.owner}/${input.name}`
  const extraction = await extract(input)

  let focus: string | null = null
  try {
    focus = await inferFocusInstructions('component-library', extraction, input.readme.slice(0, 2000),
      { apiKey: input.apiKey, typeBucket: input.typeBucket, typeSub: input.typeSub })
  } catch (err) {
    console.error('[components] focus inference failed, continuing:', err)
  }

  const prompt = buildComponentsPrompt(extraction, input.readme, repoFullName, focus, input.scannedComponents)
  const raw = await generateWithRawPrompt(prompt, input.readme, {
    model: 'claude-haiku-4-5', maxTokens: 4096, apiKey: input.apiKey,
  })
  const { content, result } = validateComponents(raw, input.readme)
  return { content, validation: result }
}
```

(Confirm in Step 1 that `componentLibraryExtractor.getFilesToFetch/extract`, `inferFocusInstructions` signature, `generateWithRawPrompt` options, and `validateComponents` return shape match the current source; adjust the calls to the verified signatures if they differ — keep the no-barrel imports.)

- [ ] **Step 5: Run → pass.** Same command → PASS (2 tests, incl. the no-barrel guard).

- [ ] **Step 6: Commit**

```bash
git add electron/skill-gen/components.ts electron/skill-gen/components.test.ts
git commit -m "$(cat <<'EOF'
feat(skill-gen): slim barrel-free generateComponents (D12 retained path)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: main.ts — anatomy unconditional master + slim components + drop flag

**Files:** Modify `electron/main.ts` (skill:generate handler, ~1288–1551 at HEAD — verify)

- [ ] **Step 1: Read** `electron/main.ts` lines 20–33 (skill-gen + anatomy imports) and 1355–1455 (the `target master` branch + components block).

- [ ] **Step 2: Swap the components import.** Replace the `pipeline` components import. Find `import { route as pipelineRoute, generate as pipelineGenerate, generateComponents as pipelineGenerateComponents } from './skill-gen/pipeline'` and replace with:

```ts
import { generateComponents as generateComponentsSlim } from './skill-gen/components'
```

(Verify the exact current import line first — P1/P2/user-cleanup may have changed it. `generateSkill`, `generateSkillViaLocalCLI`, `generateComponentsSkill`, `generateComponentsSkillViaLocalCLI` from `./skill-gen/legacy` are RETAINED — do not touch those imports.)

- [ ] **Step 3: Remove the flag import.** Delete the line `import { isAnatomyEngineEnabled } from './anatomy/flag'`.

- [ ] **Step 4: Make anatomy unconditional for the non-ref master.** In the `if (target === 'all' || target === 'master')` block, the structure is `if (ref) {…legacy frozen…} else if (isAnatomyEngineEnabled(db)) {…anatomy…} else {…pipelineRoute…}`. Replace `} else if (isAnatomyEngineEnabled(db)) {` with `} else {`, and **delete the entire trailing `else { const routeResult = await pipelineRoute(...) … }` block** (the legacy master pipeline branch, ~lines 1389–1420 at HEAD — verify exact bounds; it ends just before `}` closing the `if (target...)`). The `if (ref) {…}` branch stays verbatim (frozen path).

- [ ] **Step 5: Swap the components call.** In the components block, replace `await pipelineGenerateComponents({ … })` with `await generateComponentsSlim({ … })` (same argument object — `ComponentsInput` is shape-compatible with the existing call args: token, owner, name, language, topics, readme, version, defaultBranch, apiKey, typeBucket, typeSub, scannedComponents). The `catch` legacy fallbacks (`generateComponentsSkillViaLocalCLI`, `generateComponentsSkill`) stay unchanged.

- [ ] **Step 6: Hard-fail state.** The non-ref master is now anatomy-only. `generateViaAnatomy` already throws typed errors (`anatomy clone failed…`, `anatomy: no .anatomy produced…`); the existing `skill:generate` IPC error path surfaces them to the renderer (no legacy fallback). Add no new code — confirm by reading that the handler has no try/catch that would swallow it into a silent success; if a broad catch exists, ensure it rethrows/returns an error shape (do not add a legacy fallback).

- [ ] **Step 7: Verify**

```bash
cd /d/Coding/Git-Suite && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "electron/main\.ts" || echo "tsc OK main.ts"
npx vitest run electron/main.test.ts
```
Expected: tsc clean for main.ts; `main.test.ts` green (flag removal + anatomy-unconditional must not regress it — if it referenced `anatomyEngineEnabled`, update those test setups to drop the flag).

- [ ] **Step 8: Commit**

```bash
git add electron/main.ts electron/main.test.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): master skill is unconditionally anatomy; slim components

Removes the anatomyEngineEnabled flag branch + legacy pipelineRoute
master path. Frozen if(ref) versioned-install path untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: updateService.ts — drop flag, anatomy unconditional

**Files:** Modify `electron/services/updateService.ts`

- [ ] **Step 1: Read** the current file — the import block (~1–15), `applySkillRegen` (the `isAnatomyEngineEnabled` branch added in P2), and `checkAll` (the `anat?.anatomy_source ? isAnatomyRepoStale : checkRepo` branch).

- [ ] **Step 2: Remove the flag.** Delete `import { isAnatomyEngineEnabled } from '../anatomy/flag'`. Delete `import { route as pipelineRoute } from '../skill-gen/pipeline'` (legacy master regen is being removed). Keep the anatomy imports + `isAnatomyStale`/`isAnatomyRepoStale`.

- [ ] **Step 3: `applySkillRegen` → anatomy unconditional.** Read the function. It has `if (isAnatomyEngineEnabled(_db)) { …anatomy regen… }` followed by the legacy `pipelineRoute('library', …)` body. Remove the `if (isAnatomyEngineEnabled(_db))` guard so the anatomy regen runs unconditionally, and **delete the trailing legacy `pipelineRoute`-based body** (everything from the old `try { const readme = … pipelineRoute … }` to the function's end that the anatomy branch already replaced). Ensure the function still returns the same `{ ok, error? }` shape and calls `clearUpdateFlag` on success (the anatomy branch already does).

- [ ] **Step 4: `checkAll`.** The branch `anat?.anatomy_source ? isAnatomyRepoStale(...) : checkRepo(...)` stays (defensive — handles not-yet-backfilled rows via `checkRepo`; after backfill all rows are anatomy). No change needed; confirm it does not reference the flag.

- [ ] **Step 5: Verify**

```bash
cd /d/Coding/Git-Suite && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "services/updateService" || echo "tsc OK updateService"
npx vitest run electron/services/updateService.anatomy.test.ts electron/services/skillSyncService.test.ts electron/main.test.ts
```
Expected: tsc clean; suites green.

- [ ] **Step 6: Commit**

```bash
git add electron/services/updateService.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): updateService regen/staleness unconditionally anatomy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete `electron/anatomy/flag.ts`

**Files:** Delete `electron/anatomy/flag.ts`, `electron/anatomy/flag.test.ts`

- [ ] **Step 1: Prove unreferenced.** `Grep` repo-wide for `anatomy/flag` and `isAnatomyEngineEnabled`:
```bash
cd /d/Coding/Git-Suite && (grep -rn "anatomy/flag\|isAnatomyEngineEnabled\|ANATOMY_FLAG_KEY" electron src --include=*.ts --include=*.tsx | grep -v "flag.test.ts" || echo "NO references")
```
Expected: `NO references` (Tasks 3–4 removed them). If any remain, fix them first.

- [ ] **Step 2: Delete + commit**

```bash
cd /d/Coding/Git-Suite && git rm electron/anatomy/flag.ts electron/anatomy/flag.test.ts
npx vitest run electron/anatomy 2>&1 | grep -E "Tests "
git commit -m "$(cat <<'EOF'
chore(anatomy): remove anatomyEngineEnabled flag (now unconditional)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: anatomy suite green (flag.test.ts gone, others unaffected).

---

## Task 6: Delete the legacy master pipeline + non-component extractors/templates

Order matters — delete leaves last. Each sub-step proves no non-deleted importer remains.

- [ ] **Step 1: Delete `pipeline.ts` + `prompts.ts`.** Prove no importers outside the delete set:
```bash
cd /d/Coding/Git-Suite && grep -rn "skill-gen/pipeline\|skill-gen/prompts" electron src --include=*.ts --include=*.tsx | grep -vE "pipeline\.test\.ts|/pipeline\.ts:|/prompts\.ts:"
```
Expected: no output (Task 3/4 removed `pipelineRoute`/`pipelineGenerate`; `prompts.ts` was only imported by `pipeline.ts`). Then:
```bash
git rm electron/skill-gen/pipeline.ts electron/skill-gen/pipeline.test.ts electron/skill-gen/prompts.ts
```

- [ ] **Step 2: Delete `classifier.ts`.**
```bash
cd /d/Coding/Git-Suite && grep -rn "skill-gen/classifier\|from './classifier'" electron src --include=*.ts | grep -vE "classifier\.(test\.)?ts:"
```
Expected: no output (only `pipeline.ts` used it). `git rm electron/skill-gen/classifier.ts electron/skill-gen/classifier.test.ts`.

- [ ] **Step 3: Delete the template barrel + 7 templates.** `buildComponentsPrompt` was lifted (Task 1); `getTemplate`/`buildPromptFromTemplate` were only used by `pipeline.ts` (deleted).
```bash
cd /d/Coding/Git-Suite && grep -rn "skill-gen/templates" electron src --include=*.ts --include=*.tsx | grep -vE "templates/.*\.ts:|templates\.test\.ts"
```
Expected: no output. Then `git rm` `electron/skill-gen/templates/{index,library,cli-tool,framework,component-library,monorepo,infrastructure,generic}.ts electron/skill-gen/templates/templates.test.ts`.

- [ ] **Step 4: Delete the extractor barrel + 6 non-component extractors.** Keep `extractors/component-library.ts` (+ test). `getExtractor` was only used by `pipeline.ts`; `generic.ts` imports `library`/`cli-tool` (all deleted together).
```bash
cd /d/Coding/Git-Suite && grep -rn "extractors/index\|extractors/library\|extractors/cli-tool\|extractors/framework\|extractors/monorepo\|extractors/infrastructure\|extractors/generic" electron src --include=*.ts | grep -vE "extractors/(index|library|cli-tool|framework|monorepo|infrastructure|generic)\.(test\.)?ts:"
```
Expected: no output. Then `git rm` `electron/skill-gen/extractors/{index,library,cli-tool,framework,monorepo,infrastructure,generic}.ts` + their `.test.ts`. **Do NOT delete `extractors/component-library.ts` / `.test.ts`.**

- [ ] **Step 5: Full electron regression**
```bash
cd /d/Coding/Git-Suite && npx vitest run electron 2>&1 | grep -E "Test Files|Tests "
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "electron/skill-gen|electron/main|electron/services" || echo "tsc OK (skill-gen/main/services)"
```
Expected: electron suites green (only deleted `.test.ts` gone); tsc clean for the touched areas. If tsc flags a dangling import, it's a missed reference — fix before commit.

- [ ] **Step 6: Commit**

```bash
git add -A electron/skill-gen
git commit -m "$(cat <<'EOF'
chore(skill-gen): delete legacy master pipeline + non-component extractors/templates

Retained per D12: extractors/component-library, github-files,
manifest-parser, extraction-cache, focus-inference, validator, legacy,
login-helpers, types, + new components.ts/components-prompt.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Renderer cleanup — retire `parseSkillDepths`, keep `parseComponents`

**Files:** Modify `src/utils/skillParse.ts`, `src/views/RepoDetail.tsx`; check `src/components/SkillDepthBars.tsx`

- [ ] **Step 1: Read** `src/utils/skillParse.ts` (both `parseSkillDepths` and `parseComponents`) and `Grep` consumers:
```bash
cd /d/Coding/Git-Suite && grep -rn "parseSkillDepths\|SkillDepthBars\|parseComponents" src --include=*.ts --include=*.tsx | grep -v ".test."
```

- [ ] **Step 2: Decide per consumer.** `parseComponents` (used by the retained components sub-skill view) **stays**. `parseSkillDepths` + `SkillDepthBars` served the legacy master skill; the master is now always anatomy (AnatomyIndicators replaced the bars in P2's RepoDetail/GenericDetail). Remove `SkillDepthBars` usages only where they render the **master** skill and are already superseded by the anatomy branch; if a usage still legitimately renders a non-anatomy sub-skill, leave it. Make the minimal change: delete now-dead `parseSkillDepths`/`SkillDepthBars` references that are unreachable post-P2 anatomy branch; keep the function exported only if a live consumer remains (else delete `parseSkillDepths` + `SkillDepthBars.tsx` + their tests after proving unreferenced like Task 6 Step 1).

- [ ] **Step 3: RepoDetail.tsx** — remove the legacy `SECTION_COLORS`/`[CORE]` master rendering only if it is now unreachable (the P2 anatomy branch handles anatomy rows; post-backfill all master rows are anatomy, but keep the legacy `else` defensively until backfill is guaranteed — prefer leaving the defensive legacy master render in place and only deleting truly-dead `parseSkillDepths` plumbing). Conservative: minimal deletion, no behaviour change for un-backfilled rows.

- [ ] **Step 4: Verify**

```bash
cd /d/Coding/Git-Suite && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "skillParse|RepoDetail|GenericDetail|SkillDepthBars" || echo "tsc OK"
npx vitest run src/components/AnatomyIndicators.test.tsx src/components/AnatomyView.test.tsx src/components/AnatomyMemoryPanel.test.tsx src/utils/skillParse.test.ts
```
Expected: tsc clean; component + skillParse suites green. (RepoDetail.test.tsx NOT required green — pre-existing rot, separate task.)

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillParse.ts src/views/RepoDetail.tsx src/components/SkillDepthBars.tsx src/utils/skillParse.test.ts
git commit -m "$(cat <<'EOF'
chore(anatomy): retire legacy parseSkillDepths master plumbing; keep parseComponents

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: One-time backfill — regenerate installed skills through anatomy

**Files:** Create `electron/anatomy/backfill.ts` + `electron/anatomy/backfill.test.ts`; Modify `electron/main.ts` (invoke on app ready)

Settings-gated (`anatomyBackfillDone`), background, **replace-on-success-only** — a failed regen never destroys the existing skill row.

- [ ] **Step 1: Write the failing test**

```ts
// electron/anatomy/backfill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'
import { runAnatomyBackfill } from './backfill'

function seed(dir: string) {
  const db = getDb(dir)
  db.prepare(`INSERT INTO repos (id,owner,name,topics,default_branch) VALUES ('r1','o','n1','[]','main')`).run()
  db.prepare(`INSERT INTO repos (id,owner,name,topics,default_branch) VALUES ('r2','o','n2','[]','main')`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active) VALUES ('r1','n1.skill.md','LEGACY1','v','t',1)`).run()
  db.prepare(`INSERT INTO skills (repo_id,filename,content,version,generated_at,active,anatomy_source) VALUES ('r2','.anatomy','[identity]','v','t',1,'generated')`).run()
  return db
}

describe('runAnatomyBackfill', () => {
  it('regenerates only legacy (non-anatomy) rows; sets the done flag; skips anatomy rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-bf-'))
    const db = seed(dir)
    const regen = vi.fn(async (repoId: string) => { if (repoId === 'r1') return { ok: true } as const; return { ok: true } as const })
    await runAnatomyBackfill(db, regen)
    expect(regen).toHaveBeenCalledTimes(1)             // only r1 (legacy); r2 already anatomy
    expect(regen).toHaveBeenCalledWith('r1')
    expect((db.prepare("SELECT value FROM settings WHERE key='anatomyBackfillDone'").get() as {value:string}).value).toBe('true')
  })

  it('does not destroy a row when regen fails, and does not set done on partial failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-bf-'))
    const db = seed(dir)
    const regen = vi.fn(async () => ({ ok: false, error: 'clone failed' } as const))
    await runAnatomyBackfill(db, regen)
    expect((db.prepare("SELECT content FROM skills WHERE repo_id='r1'").get() as {content:string}).content).toBe('LEGACY1')
    const done = db.prepare("SELECT value FROM settings WHERE key='anatomyBackfillDone'").get() as {value:string} | undefined
    expect(done?.value).not.toBe('true')
  })

  it('is a no-op when already done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-bf-'))
    const db = seed(dir)
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyBackfillDone','true')").run()
    const regen = vi.fn(async () => ({ ok: true } as const))
    await runAnatomyBackfill(db, regen)
    expect(regen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run → fail.** `cd /d/Coding/Git-Suite && npx vitest run electron/anatomy/backfill.test.ts` → cannot find module.

- [ ] **Step 3: Implement** `electron/anatomy/backfill.ts`:

```ts
import type Database from 'better-sqlite3'

export type RegenFn = (repoId: string) => Promise<{ ok: boolean; error?: string }>

const KEY = 'anatomyBackfillDone'

/**
 * Regenerate every installed master skill that is not yet anatomy-sourced.
 * Replace-on-success-only: a failed regen leaves the existing row intact.
 * The done flag is set only when every legacy row regenerated successfully.
 */
export async function runAnatomyBackfill(db: Database.Database, regen: RegenFn): Promise<void> {
  const done = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined
  if (done?.value === 'true') return

  const legacy = db.prepare(`
    SELECT repo_id FROM skills
    WHERE active = 1 AND (anatomy_source IS NULL OR anatomy_source = '')
  `).all() as Array<{ repo_id: string }>

  let allOk = true
  for (const { repo_id } of legacy) {
    try {
      const r = await regen(repo_id)
      if (!r.ok) { allOk = false; console.error(`[anatomy-backfill] ${repo_id}: ${r.error ?? 'regen failed'}`) }
    } catch (err) {
      allOk = false
      console.error(`[anatomy-backfill] ${repo_id} threw:`, err)
    }
  }

  if (allOk) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'true')`).run(KEY)
  }
}
```

- [ ] **Step 4: Run → pass.** Same command → PASS (3 tests).

- [ ] **Step 5: Wire into app start (non-blocking).** Read `electron/main.ts` for the existing post-`whenReady`/window-created startup section where services start (e.g. near `startUpdateService`). Add, after the DB + window exist, a fire-and-forget call. The `regen` adapter reuses the existing anatomy regen used by `updateService.applySkillRegen` — extract that into an exported helper or call `applySkillRegen` directly:

```ts
import { runAnatomyBackfill } from './anatomy/backfill'
import { applySkillRegen } from './services/updateService'
// …after db + updateService init, non-blocking:
void runAnatomyBackfill(getDb(app.getPath('userData')), (repoId) => applySkillRegen(repoId))
```

(Verify `applySkillRegen` is exported from `updateService.ts` and its signature is `(repoId: string) => Promise<{ok:boolean;error?:string}>` — it is, per Task 4. Confirm the startup site has `_db`/window initialised so `applySkillRegen`'s module state is set; place the call after `startUpdateService(db, win)`.)

- [ ] **Step 6: Verify**

```bash
cd /d/Coding/Git-Suite && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "anatomy/backfill|electron/main" || echo "tsc OK"
npx vitest run electron/anatomy/backfill.test.ts electron/main.test.ts
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add electron/anatomy/backfill.ts electron/anatomy/backfill.test.ts electron/main.ts
git commit -m "$(cat <<'EOF'
feat(anatomy): one-time settings-gated backfill of legacy skills

Replace-on-success-only; never destroys a row on regen failure; done
flag set only on full success so partial runs retry next launch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: MCP server — confirm defensive, no premature deletion

**Files:** Read-only check of `electron/mcp-server.ts` (+ a regression run)

Per spec §13 + scope: the `anatomy_source`-guarded branches in `handleGetSkill`/`handleSearchSkills`/`handleGetCollection` already serve both anatomy and legacy rows. Pre-backfill, legacy rows still exist; the branches must stay. `get_components_skill` is unchanged (retained).

- [ ] **Step 1:** Read `electron/mcp-server.ts` `handleGetSkill`/`handleSearchSkills`/`handleGetCollection`/`handleGetComponentsSkill`. Confirm none import or reference `anatomy/flag`, `skill-gen/pipeline`, or any deleted module.
```bash
cd /d/Coding/Git-Suite && grep -n "skill-gen/\|anatomy/flag" electron/mcp-server.ts || echo "mcp-server clean of deleted modules"
```
Expected: clean.

- [ ] **Step 2:** `cd /d/Coding/Git-Suite && npx vitest run electron/mcp-server.test.ts` → 24 green (unchanged from P2). No code change; this task is a guard.

- [ ] **Step 3:** No commit (no changes). If Step 1 found a dangling import, fix + commit with message `fix(anatomy): drop dangling deleted-module import in mcp-server`.

---

## Task 10: Full regression + dead-reference sweep

- [ ] **Step 1: Repo-wide dangling-import sweep**

```bash
cd /d/Coding/Git-Suite && grep -rn "skill-gen/pipeline\|skill-gen/prompts\|skill-gen/classifier\|skill-gen/templates\|extractors/index\|extractors/library\|extractors/cli-tool\|extractors/framework\|extractors/monorepo\|extractors/infrastructure\|extractors/generic\|anatomy/flag\|isAnatomyEngineEnabled" electron src --include=*.ts --include=*.tsx | grep -vE "\.test\.ts"
```
Expected: **no output**. Any hit is a missed reference — fix before proceeding.

- [ ] **Step 2: Full electron + anatomy + component regression**

```bash
cd /d/Coding/Git-Suite && npx vitest run electron src/components/AnatomyIndicators.test.tsx src/components/AnatomyView.test.tsx src/components/AnatomyMemoryPanel.test.tsx src/utils/skillParse.test.ts 2>&1 | grep -E "Test Files|Tests |FAIL"
```
Expected: all green except known-gated suites (anatomy `e2e.test.ts` token-gated skip; `runtime.test.ts` spawn smoke runs if vendored). NO failures from deleted-module breakage. RepoDetail.test.tsx is intentionally NOT in this set (pre-existing rot, separate task).

- [ ] **Step 3: Full typecheck**

```bash
cd /d/Coding/Git-Suite && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | grep -vE "mcp-server\.ts\(2[0-9][0-9]" | head -20 || echo "tsc OK (no new errors)"
```
Expected: no new errors in touched files. (Pre-existing unrelated errors, if any, are out of scope — compare against the HEAD baseline if unsure.)

- [ ] **Step 4: Restore Electron ABI**

```bash
cd /d/Coding/Git-Suite && npx @electron/rebuild -f -o better-sqlite3 2>&1 | tail -1
```
Expected: `Rebuild Complete` (so the app launches; vitest ran under the Node ABI).

- [ ] **Step 5: Final status + commit any sweep fixes**

```bash
cd /d/Coding/Git-Suite && git status --short
```
Pre-existing component WIP (`src/components/Component*`, `componentParser`, `iframeTemplate`, `RAD-LTT-Design.md`, `IframePreview.tsx`) stays untouched. If Step 1/3 required fixes, commit them: `git commit -m "fix(anatomy): clear dangling references after rip-out"`.

---

## Out of Scope (do NOT implement)

- The frozen `if (ref)` versioned-install path + its `legacy.ts` functions (`generateSkill`, `generateSkillViaLocalCLI`) — untouched, "assess later" (user decision).
- RepoDetail.test.tsx harness rot (separate flagged task).
- Installer/electron-builder packaging.
- Deleting `legacy.ts`/`validator.ts`/`focus-inference.ts` master-only dead code — retained whole (low-risk; type-only or shared with the frozen ref path / slim components path). A later cleanup may trim dead exports.

---

## Self-Review

**1. Spec coverage (spec §13 + D12 + user decision):**
- Delete legacy master pipeline → Tasks 3,4,6. Slim retained component path (D12) → Tasks 1,2 (+ main.ts wiring Task 3). Remove flag → Tasks 3,4,5. Backfill (replace-on-success-only) → Task 8. mcp-server defensive (no premature deletion) → Task 9. Renderer `parseSkillDepths` retire / keep `parseComponents` → Task 7. Hard-fail state (no legacy master fallback) → Task 3 Step 6. Frozen `ref` path untouched → asserted in Tasks 3/Out-of-scope. Dead-reference safety → Task 6 per-delete grep + Task 10 sweep. No gaps.

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Tasks 1–2 carry full code; Tasks 3,4,7 are surgical edits to large existing files so they specify *read exact lines first, then the precise replacement* (the anchor text varies with HEAD line drift — the read-then-edit instruction is concrete, not a placeholder). Task 8 carries the full backfill module + test. Task 6 deletions are gated on concrete grep commands with expected output.

**3. Type consistency:** `ComponentsInput` (Task 2) is shape-compatible with the existing `pipelineGenerateComponents` call args in main.ts (Task 3 Step 5 reuses the same object). `generateComponents` returns `{content,validation:ValidationResult}` (same as the old `pipeline.generateComponents`, so the `compResult.content` consumer in main.ts is unchanged). `RegenFn` = `(repoId)=>Promise<{ok;error?}>` matches `applySkillRegen`'s signature (Task 8 Step 5). `buildComponentsPrompt` signature preserved verbatim (Task 1). Retained modules (`github-files`, `manifest-parser`, `extractors/component-library`, `focus-inference`, `validator`, `legacy`, `extraction-cache`, `types`) keep their existing exports — Task 2 consumes them by their current signatures (verified in Task 2 Step 1). Consistent.
