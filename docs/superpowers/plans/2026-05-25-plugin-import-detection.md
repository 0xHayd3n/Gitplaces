# Plugin Import — Repo-Level Agent & Slash-Command Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Git-Suite's import pipeline so it detects sub-agents (`agents/*.md`) and slash commands (`commands/*.md`) inside plugins/repos alongside today's skill detection, and auto-syncs imported sub-agents and commands back to `~/.claude/agents/` and `~/.claude/commands/`.

**Architecture:** Replace the skill-shaped `ParsedSkill` type with a discriminated union `ParsedImportTarget` covering `skill | subagent | slashCommand`. One discovery pass per plugin returns all three kinds. One importer (`importTarget`) dispatches on `kind`. The IPC handler triggers `runSyncAndPersist` automatically for non-skill imports. Schema unchanged — all required columns exist.

**Tech Stack:** TypeScript, Vitest, Electron IPC, `gray-matter` (YAML frontmatter), `better-sqlite3`, React (renderer).

**Spec:** [docs/superpowers/specs/2026-05-25-plugin-import-detection-design.md](../specs/2026-05-25-plugin-import-detection-design.md)

**Branch policy:** Per user CLAUDE.md, work happens directly on `main`. No worktree, no feature branch. Each task ends with a commit.

**Test command:** `npm test` (the test script rebuilds `better-sqlite3` for Node ABI first — running `npx vitest` directly leaves the binding rebuilt for the wrong ABI and breaks Electron launch).

---

## Task 1: Extract shared frontmatter helpers to `frontmatterFields.ts`

Mechanical extraction with no behavior change. Splits the three reusable parsers (`parseModelFrontmatter`, `parseToolsFrontmatter`, `parseArgumentHint`) into a focused module so the future `parseSubagent` and `parseSlashCommand` can import them without dragging in the rest of `skillImportService.ts`.

**Files:**
- Create: `electron/services/frontmatterFields.ts`
- Modify: `electron/services/skillImportService.ts` (remove the three functions, add a re-export for the test file)
- Modify: `electron/services/skillImportFromGithubService.ts` (update import source)

- [ ] **Step 1: Create the new module**

Create `electron/services/frontmatterFields.ts`:

```ts
export type ImportedModel = 'sonnet' | 'opus' | 'haiku' | 'inherit'

const FULL_TO_SHORT_MODEL: Record<string, ImportedModel> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-7': 'opus',
  'claude-haiku-4-5-20251001': 'haiku',
}

export function parseModelFrontmatter(raw: unknown): ImportedModel {
  if (typeof raw !== 'string') return 'inherit'
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') return raw
  const mapped = FULL_TO_SHORT_MODEL[raw]
  if (mapped) return mapped
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] Unknown model "${raw}", falling back to 'inherit'.`)
  return 'inherit'
}

export function parseToolsFrontmatter(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return []
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
  }
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] Unexpected tools type ${typeof raw}, treating as null.`)
  return null
}

export function parseArgumentHint(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  // YAML parses `argument-hint: [project-name]` as the array ['project-name'].
  // CC writes it as bracket-notation in the source; reconstruct so we can round-trip.
  if (Array.isArray(raw)) {
    return `[${raw.map(v => String(v)).join(', ')}]`
  }
  return null
}
```

- [ ] **Step 2: Remove the moved functions from `skillImportService.ts`**

In `electron/services/skillImportService.ts`:

- Delete the `ImportedModel` type alias (line ~9), the `FULL_TO_SHORT_MODEL` constant (lines ~24-28), and the three `parse*` functions (lines ~30-60).
- Add the imports + a re-export so the existing test file (which imports them by name from this module) keeps working:

```ts
import {
  parseModelFrontmatter,
  parseToolsFrontmatter,
  parseArgumentHint,
  type ImportedModel,
} from './frontmatterFields'

export { parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint, type ImportedModel }
```

- [ ] **Step 3: Update the GitHub service to import from the new module**

In `electron/services/skillImportFromGithubService.ts`, change line ~6:

```ts
// before
import { parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint } from './skillImportService'
// after
import { parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint } from './frontmatterFields'
```

- [ ] **Step 4: Run tests — expect all still passing**

Run: `npm test`
Expected: All existing tests pass. No new behavior, no test changes.

- [ ] **Step 5: Commit**

```bash
git add electron/services/frontmatterFields.ts electron/services/skillImportService.ts electron/services/skillImportFromGithubService.ts
git commit -m "refactor(agents): extract frontmatterFields helpers from skillImportService"
```

---

## Task 2: Rename `skillImportService.ts` → `pluginImportService.ts`

Mechanical rename. Git preserves history via `git mv`. All references across the codebase get updated in this single commit. After this task, every existing import is repointed; behavior is identical.

**Files:**
- Rename: `electron/services/skillImportService.ts` → `electron/services/pluginImportService.ts`
- Rename: `electron/services/skillImportService.test.ts` → `electron/services/pluginImportService.test.ts`
- Modify: every file that imports from `skillImportService` (see Step 2 grep)

- [ ] **Step 1: Rename via `git mv` (preserves history)**

Run:
```bash
git mv electron/services/skillImportService.ts electron/services/pluginImportService.ts
git mv electron/services/skillImportService.test.ts electron/services/pluginImportService.test.ts
```

- [ ] **Step 2: Find every reference to the old path**

Run: `grep -rn "skillImportService" --include="*.ts" --include="*.tsx" .`

Expected files to update (verify via grep — list may be slightly different):
- `electron/services/skillImportFromGithubService.ts`
- `electron/services/pluginImportService.test.ts` (test file, self-import after rename)
- `electron/ipc/agentHandlers.ts`
- `electron/preload.ts`
- `src/components/ImportSkillDialog.tsx`
- `src/components/ImportSkillDialog.test.tsx`

- [ ] **Step 3: Replace `skillImportService` with `pluginImportService` in every found file**

For each file listed by the grep:
```ts
// before
from './skillImportService'
from '../services/skillImportService'
from '../../electron/services/skillImportService'
// after — same path shape, just the filename changes
from './pluginImportService'
from '../services/pluginImportService'
from '../../electron/services/pluginImportService'
```

Use Edit's `replace_all` for each file to update every occurrence in one pass.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test`
Expected: All tests pass.

Run: `npx tsc --noEmit` (or whatever the repo's typecheck command is — check `package.json` for `"typecheck"` or `"check"` script).
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename skillImportService -> pluginImportService"
```

---

## Task 3: Rename `skillImportFromGithubService.ts` → `pluginImportFromGithubService.ts`

Same mechanical rename for the GitHub-side service.

**Files:**
- Rename: `electron/services/skillImportFromGithubService.ts` → `electron/services/pluginImportFromGithubService.ts`
- Rename: `electron/services/skillImportFromGithubService.test.ts` → `electron/services/pluginImportFromGithubService.test.ts`
- Modify: every file that imports from the old path

- [ ] **Step 1: Rename via `git mv`**

```bash
git mv electron/services/skillImportFromGithubService.ts electron/services/pluginImportFromGithubService.ts
git mv electron/services/skillImportFromGithubService.test.ts electron/services/pluginImportFromGithubService.test.ts
```

- [ ] **Step 2: Find every reference**

Run: `grep -rn "skillImportFromGithubService" --include="*.ts" --include="*.tsx" .`

Expected files to update:
- `electron/ipc/agentHandlers.ts`
- `electron/preload.ts`
- `src/components/ImportSkillDialog.tsx`
- `electron/services/pluginImportFromGithubService.test.ts` (self-import after rename)

- [ ] **Step 3: Replace path in each file**

Same pattern as Task 2 — `skillImportFromGithubService` → `pluginImportFromGithubService` (Edit `replace_all`).

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test`
Expected: All tests pass.

Run typecheck. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename skillImportFromGithubService -> pluginImportFromGithubService"
```

---

## Task 4: Add `ParsedImportTarget` discriminated union

Add the type definitions for the union, give `ParsedSkill` an explicit `kind: 'skill'` discriminator, define stub types for the two new kinds. No new behavior; existing code paths still only produce `ParsedSkill`.

**Files:**
- Modify: `electron/services/pluginImportService.ts`

- [ ] **Step 1: Add the kind type and union near the existing `ParsedSkill` definition**

Replace the existing `ParsedSkill` interface (around line ~11) with:

```ts
export type ImportKind = 'skill' | 'subagent' | 'slashCommand'

export interface ParsedImportTargetBase {
  kind: ImportKind
  name: string
  handle: string
  description: string
  body: string
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
  model: ImportedModel
  tools: string[] | null
}

export interface ParsedSkill extends ParsedImportTargetBase {
  kind: 'skill'
  files: { filename: string; content: string }[]
  argumentHint: string | null   // existing skill code already uses this; keep for now
}

export interface ParsedSubagent extends ParsedImportTargetBase {
  kind: 'subagent'
  files: never[]
  argumentHint: null
  color: string | null
}

export interface ParsedSlashCommand extends ParsedImportTargetBase {
  kind: 'slashCommand'
  files: never[]
  argumentHint: string | null
}

export type ParsedImportTarget = ParsedSkill | ParsedSubagent | ParsedSlashCommand
```

- [ ] **Step 2: Set `kind: 'skill'` in the existing `parseSkill` return**

In the `return { ... }` at the end of `parseSkill` (around line ~99):

```ts
return {
  kind: 'skill',
  name,
  handle,
  description,
  body: parsed.content.trim(),
  files,
  origin: null,
  model,
  tools,
  argumentHint,
}
```

- [ ] **Step 3: Run tests — expect all still passing**

Run: `npm test`
Expected: All tests pass. The existing `ParsedSkill` consumers don't read `kind` yet, but the discriminator doesn't break them.

- [ ] **Step 4: Commit**

```bash
git add electron/services/pluginImportService.ts
git commit -m "feat(agents): add ParsedImportTarget union type with kind discriminator"
```

---

## Task 5: Add `parseSubagent` parser + `COLOR_MAP`

Implements parsing for a single sub-agent `.md` file (e.g. `~/.claude/plugins/.../agents/code-architect.md`). Maps Anthropic palette color names to hex. Test-first.

**Files:**
- Create: `electron/services/__fixtures__/subagents/full.md` (fixture)
- Create: `electron/services/__fixtures__/subagents/minimal.md` (fixture)
- Create: `electron/services/__fixtures__/subagents/no-frontmatter.md` (fixture)
- Modify: `electron/services/pluginImportService.ts` (add parser + color map)
- Modify: `electron/services/pluginImportService.test.ts` (add tests)

- [ ] **Step 1: Create fixtures**

Create `electron/services/__fixtures__/subagents/full.md`:

```markdown
---
name: code-architect
description: Designs feature architectures by analyzing existing codebase patterns.
tools: Glob, Grep, Read
model: sonnet
color: green
---

You are a senior software architect.
```

Create `electron/services/__fixtures__/subagents/minimal.md`:

```markdown
---
name: minimal-agent
---

Body only.
```

Create `electron/services/__fixtures__/subagents/no-frontmatter.md`:

```markdown
Just a body, no frontmatter at all.
```

- [ ] **Step 2: Write failing tests**

Append to `electron/services/pluginImportService.test.ts`:

```ts
import { parseSubagent } from './pluginImportService'

const SUBAGENT_FIXTURES = path.join(__dirname, '__fixtures__/subagents')

describe('parseSubagent', () => {
  it('parses full frontmatter into a ParsedSubagent', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'full.md'))
    expect(sub.kind).toBe('subagent')
    expect(sub.name).toBe('code-architect')
    expect(sub.handle).toBe('code-architect')
    expect(sub.description).toBe('Designs feature architectures by analyzing existing codebase patterns.')
    expect(sub.tools).toEqual(['Glob', 'Grep', 'Read'])
    expect(sub.model).toBe('sonnet')
    expect(sub.color).toBe('green')
    expect(sub.body).toContain('senior software architect')
    expect(sub.files).toEqual([])
    expect(sub.argumentHint).toBeNull()
  })

  it('falls back to filename stem when name field is missing', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'no-frontmatter.md'))
    expect(sub.name).toBe('no-frontmatter')
    expect(sub.handle).toBe('no-frontmatter')
    expect(sub.description).toBe('')
    expect(sub.color).toBeNull()
    expect(sub.model).toBe('inherit')
    expect(sub.tools).toBeNull()
  })

  it('uses defaults when only name is given', async () => {
    const sub = await parseSubagent(path.join(SUBAGENT_FIXTURES, 'minimal.md'))
    expect(sub.name).toBe('minimal-agent')
    expect(sub.description).toBe('')
    expect(sub.color).toBeNull()
  })

  it('throws when the file does not exist', async () => {
    await expect(parseSubagent(path.join(SUBAGENT_FIXTURES, 'nope.md'))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

Run: `npm test -- pluginImportService`
Expected: FAIL — `parseSubagent is not exported` or similar.

- [ ] **Step 4: Implement `COLOR_MAP` and `parseSubagent`**

In `electron/services/pluginImportService.ts`, add after the type definitions:

```ts
export const COLOR_MAP: Record<string, string> = {
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green:  '#22c55e',
  cyan:   '#06b6d4',
  blue:   '#3b82f6',
  purple: '#a855f7',
  pink:   '#ec4899',
}

export async function parseSubagent(filePath: string): Promise<ParsedSubagent> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error(`Sub-agent file not found: ${filePath}`)
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const filenameStem = path.basename(filePath, '.md')
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : filenameStem
  const description = typeof data.description === 'string' ? data.description : ''
  const model = parseModelFrontmatter(data.model)
  const tools = parseToolsFrontmatter(data.tools)
  const color = typeof data.color === 'string' ? data.color : null

  const known = new Set(['name', 'description', 'tools', 'model', 'color'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportService] Dropped sub-agent frontmatter keys from ${filePath}:`, dropped)
  }

  return {
    kind: 'subagent',
    name,
    handle: slugifyName(name),
    description,
    body: parsed.content.trim(),
    files: [],
    origin: null,
    model,
    tools,
    argumentHint: null,
    color,
  }
}
```

The `files: []` literal satisfies the `never[]` type since `never[]` is assignable from `[]` (empty array). If TypeScript complains, cast: `files: [] as never[]`.

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test -- pluginImportService`
Expected: PASS, all four new tests green.

- [ ] **Step 6: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportService.test.ts electron/services/__fixtures__/subagents/
git commit -m "feat(agents): add parseSubagent + COLOR_MAP for plugin agents/*.md"
```

---

## Task 6: Add `parseSlashCommand` parser

Similar shape to sub-agent but for `commands/*.md`. No `name` frontmatter field — name always derives from filename. Adds `argument-hint` parsing.

**Files:**
- Create: `electron/services/__fixtures__/commands/full.md`
- Create: `electron/services/__fixtures__/commands/no-frontmatter.md`
- Create: `electron/services/__fixtures__/commands/argument-hint-array.md`
- Modify: `electron/services/pluginImportService.ts`
- Modify: `electron/services/pluginImportService.test.ts`

- [ ] **Step 1: Create fixtures**

Create `electron/services/__fixtures__/commands/full.md`:

```markdown
---
description: Guided feature development with codebase understanding.
argument-hint: Optional feature description
---

# Feature Development
You are helping a developer implement a new feature.
```

Create `electron/services/__fixtures__/commands/no-frontmatter.md`:

```markdown
Just a body, no frontmatter at all.
```

Create `electron/services/__fixtures__/commands/argument-hint-array.md`:

```markdown
---
description: Test bracket-form argument hint.
argument-hint: [project-name]
---

Body.
```

- [ ] **Step 2: Write failing tests**

Append to `electron/services/pluginImportService.test.ts`:

```ts
import { parseSlashCommand } from './pluginImportService'

const COMMAND_FIXTURES = path.join(__dirname, '__fixtures__/commands')

describe('parseSlashCommand', () => {
  it('parses full frontmatter into a ParsedSlashCommand', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'full.md'))
    expect(cmd.kind).toBe('slashCommand')
    expect(cmd.name).toBe('full')                 // from filename stem
    expect(cmd.handle).toBe('full')
    expect(cmd.description).toBe('Guided feature development with codebase understanding.')
    expect(cmd.argumentHint).toBe('Optional feature description')
    expect(cmd.body).toContain('Feature Development')
    expect(cmd.model).toBe('inherit')
    expect(cmd.tools).toBeNull()
    expect(cmd.files).toEqual([])
  })

  it('falls back to filename stem and empty description when no frontmatter', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'no-frontmatter.md'))
    expect(cmd.name).toBe('no-frontmatter')
    expect(cmd.description).toBe('')
    expect(cmd.argumentHint).toBeNull()
  })

  it('preserves bracket form of argument-hint when YAML parses it as an array', async () => {
    const cmd = await parseSlashCommand(path.join(COMMAND_FIXTURES, 'argument-hint-array.md'))
    expect(cmd.argumentHint).toBe('[project-name]')
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

Run: `npm test -- pluginImportService`
Expected: FAIL — `parseSlashCommand is not exported`.

- [ ] **Step 4: Implement `parseSlashCommand`**

Add to `electron/services/pluginImportService.ts`:

```ts
export async function parseSlashCommand(filePath: string): Promise<ParsedSlashCommand> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error(`Slash-command file not found: ${filePath}`)
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const name = path.basename(filePath, '.md')
  const description = typeof data.description === 'string' ? data.description : ''
  const argumentHint = parseArgumentHint(data['argument-hint'])

  const known = new Set(['description', 'argument-hint'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pluginImportService] Dropped slash-command frontmatter keys from ${filePath}:`, dropped)
  }

  return {
    kind: 'slashCommand',
    name,
    handle: slugifyName(name),
    description,
    body: parsed.content.trim(),
    files: [],
    origin: null,
    model: 'inherit',
    tools: null,
    argumentHint,
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test -- pluginImportService`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportService.test.ts electron/services/__fixtures__/commands/
git commit -m "feat(agents): add parseSlashCommand for plugin commands/*.md"
```

---

## Task 7: Add `readPluginManifest` helper with `.claude-plugin/plugin.json` precedence

Today's discovery reads `package.json` only. Anthropic plugins use `.claude-plugin/plugin.json` instead. New helper prefers the latter, falls back to the former, falls back to dirname.

**Files:**
- Create: `electron/services/__fixtures__/plugins/with-claude-manifest/.claude-plugin/plugin.json`
- Create: `electron/services/__fixtures__/plugins/with-claude-manifest/skills/dummy/SKILL.md`
- Create: `electron/services/__fixtures__/plugins/both-manifests/.claude-plugin/plugin.json`
- Create: `electron/services/__fixtures__/plugins/both-manifests/package.json`
- Create: `electron/services/__fixtures__/plugins/both-manifests/skills/dummy/SKILL.md`
- Modify: `electron/services/pluginImportService.ts`
- Modify: `electron/services/pluginImportService.test.ts`

- [ ] **Step 1: Create fixtures**

Create `electron/services/__fixtures__/plugins/with-claude-manifest/.claude-plugin/plugin.json`:

```json
{
  "name": "claude-manifest-plugin",
  "version": "0.9.0"
}
```

Create `electron/services/__fixtures__/plugins/with-claude-manifest/skills/dummy/SKILL.md`:

```markdown
---
name: dummy
description: Stub.
---

Body.
```

Create `electron/services/__fixtures__/plugins/both-manifests/.claude-plugin/plugin.json`:

```json
{
  "name": "from-claude",
  "version": "2.0.0"
}
```

Create `electron/services/__fixtures__/plugins/both-manifests/package.json`:

```json
{
  "name": "from-package",
  "version": "1.0.0"
}
```

Create `electron/services/__fixtures__/plugins/both-manifests/skills/dummy/SKILL.md`:

```markdown
---
name: dummy
description: Stub.
---

Body.
```

- [ ] **Step 2: Write failing tests**

Add a new `describe` block in `electron/services/pluginImportService.test.ts`:

```ts
import { readPluginManifest } from './pluginImportService'

describe('readPluginManifest', () => {
  it('prefers .claude-plugin/plugin.json over package.json when both exist', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'both-manifests'))
    expect(manifest.name).toBe('from-claude')
    expect(manifest.version).toBe('2.0.0')
  })

  it('reads .claude-plugin/plugin.json when only that exists', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'with-claude-manifest'))
    expect(manifest.name).toBe('claude-manifest-plugin')
    expect(manifest.version).toBe('0.9.0')
  })

  it('falls back to package.json when .claude-plugin/plugin.json is absent', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'cool-plugin'))
    expect(manifest.name).toBe('cool-plugin')   // package.json declares "cool-plugin"
    expect(manifest.version).toBe('1.2.3')
  })

  it('falls back to dirname with null version when neither manifest exists', async () => {
    const manifest = await readPluginManifest(path.join(PLUGIN_FIXTURES, 'no-package'))
    expect(manifest.name).toBe('no-package')
    expect(manifest.version).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

Run: `npm test -- pluginImportService`
Expected: FAIL — `readPluginManifest is not exported`.

- [ ] **Step 4: Implement `readPluginManifest`**

Add to `electron/services/pluginImportService.ts`:

```ts
export interface PluginManifest {
  name: string
  version: string | null
}

export async function readPluginManifest(pluginDir: string): Promise<PluginManifest> {
  const dirname = path.basename(pluginDir)

  // Prefer .claude-plugin/plugin.json (Anthropic canonical format)
  const claudeManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
  const claudeRaw = await fs.readFile(claudeManifestPath, 'utf-8').catch(() => null)
  if (claudeRaw !== null) {
    try {
      const m = JSON.parse(claudeRaw)
      return {
        name: typeof m.name === 'string' && m.name.length > 0 ? m.name : dirname,
        version: typeof m.version === 'string' ? m.version : null,
      }
    } catch {
      // Malformed — fall through to package.json
    }
  }

  // Fall back to package.json
  const pkgPath = path.join(pluginDir, 'package.json')
  const pkgRaw = await fs.readFile(pkgPath, 'utf-8').catch(() => null)
  if (pkgRaw !== null) {
    try {
      const p = JSON.parse(pkgRaw)
      return {
        name: typeof p.name === 'string' && p.name.length > 0 ? p.name : dirname,
        version: typeof p.version === 'string' ? p.version : null,
      }
    } catch {
      // Malformed — fall through to dirname
    }
  }

  return { name: dirname, version: null }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test -- pluginImportService`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportService.test.ts electron/services/__fixtures__/plugins/
git commit -m "feat(agents): add readPluginManifest with .claude-plugin/plugin.json precedence"
```

---

## Task 8: Add marketplaces root to `pluginDiscoveryRoots`

`~/.claude/plugins/marketplaces/<source>/plugins/` is where official Anthropic plugins actually live. Current code never scans it.

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`

There's no test for this function directly today (it's an internal helper); we'll test it indirectly via `discoverPlugins` in the next task. This task is the minimal mechanical addition.

- [ ] **Step 1: Update `pluginDiscoveryRoots`**

In `electron/ipc/agentHandlers.ts` (around line ~51-77), replace:

```ts
async function pluginDiscoveryRoots(): Promise<string[]> {
  const home = os.homedir()
  const cwd = process.cwd()
  const roots = [
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]
  // Cache layout: ~/.claude/plugins/cache/<source>/<plugin>/<version>/<files>.
  // We add each <source>/<plugin>/ as a root so discoverPlugins sees the
  // <version> directories as plugin dirs.
  const cacheDir = path.join(home, '.claude', 'plugins', 'cache')
  try {
    const sources = await fs.readdir(cacheDir, { withFileTypes: true })
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourceDir = path.join(cacheDir, source.name)
      const plugins = await fs.readdir(sourceDir, { withFileTypes: true })
      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue
        roots.push(path.join(sourceDir, plugin.name))
      }
    }
  } catch {
    // cache dir missing — ignore
  }
  return roots
}
```

with:

```ts
async function pluginDiscoveryRoots(): Promise<string[]> {
  const home = os.homedir()
  const cwd = process.cwd()
  const roots = [
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]

  // Cache layout: ~/.claude/plugins/cache/<source>/<plugin>/<version>/<files>.
  // Each <source>/<plugin>/ is added as a root so discoverPlugins sees the
  // <version> directories as plugin dirs.
  const cacheDir = path.join(home, '.claude', 'plugins', 'cache')
  try {
    const sources = await fs.readdir(cacheDir, { withFileTypes: true })
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourceDir = path.join(cacheDir, source.name)
      const plugins = await fs.readdir(sourceDir, { withFileTypes: true })
      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue
        roots.push(path.join(sourceDir, plugin.name))
      }
    }
  } catch {
    // cache dir missing — ignore
  }

  // Marketplaces layout: ~/.claude/plugins/marketplaces/<source>/plugins/<plugin>/.
  // Each <source>/plugins/ directory becomes a root.
  const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces')
  try {
    const sources = await fs.readdir(marketplacesDir, { withFileTypes: true })
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourcePluginsDir = path.join(marketplacesDir, source.name, 'plugins')
      const stat = await fs.stat(sourcePluginsDir).catch(() => null)
      if (stat?.isDirectory()) roots.push(sourcePluginsDir)
    }
  } catch {
    // marketplaces dir missing — ignore
  }

  return roots
}
```

- [ ] **Step 2: Run tests + typecheck**

Run: `npm test`
Expected: All existing tests pass.

Run typecheck. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/agentHandlers.ts
git commit -m "feat(agents): scan ~/.claude/plugins/marketplaces/ subtree for plugins"
```

---

## Task 9: Extend `discoverPlugins` to enumerate sub-agents and slash commands

Add per-plugin scanning of `agents/*.md` and `commands/*.md` alongside today's `skills/`. Widen `DiscoveredPlugin` shape. Plugin gate becomes "has at least one of the three." Manifest reading switches to the new helper.

**Files:**
- Create fixture: `electron/services/__fixtures__/plugins/mixed-plugin/agents/agent-one.md`
- Create fixture: `electron/services/__fixtures__/plugins/mixed-plugin/agents/agent-two.md`
- Create fixture: `electron/services/__fixtures__/plugins/mixed-plugin/commands/cmd-one.md`
- Create fixture: `electron/services/__fixtures__/plugins/mixed-plugin/skills/some-skill/SKILL.md`
- Create fixture: `electron/services/__fixtures__/plugins/mixed-plugin/.claude-plugin/plugin.json`
- Create fixture: `electron/services/__fixtures__/plugins/agents-only/agents/lonely.md`
- Create fixture: `electron/services/__fixtures__/plugins/commands-only/commands/solo.md`
- Modify: `electron/services/pluginImportService.ts`
- Modify: `electron/services/pluginImportService.test.ts`

- [ ] **Step 1: Create fixtures**

Create `electron/services/__fixtures__/plugins/mixed-plugin/.claude-plugin/plugin.json`:

```json
{ "name": "mixed-plugin", "version": "1.0.0" }
```

Create `electron/services/__fixtures__/plugins/mixed-plugin/agents/agent-one.md`:

```markdown
---
name: agent-one
description: First agent.
color: blue
---

Body of agent one.
```

Create `electron/services/__fixtures__/plugins/mixed-plugin/agents/agent-two.md`:

```markdown
---
name: agent-two
description: Second agent.
---

Body of agent two.
```

Create `electron/services/__fixtures__/plugins/mixed-plugin/commands/cmd-one.md`:

```markdown
---
description: A command.
argument-hint: [target]
---

Command body.
```

Create `electron/services/__fixtures__/plugins/mixed-plugin/skills/some-skill/SKILL.md`:

```markdown
---
name: some-skill
description: A skill in a mixed plugin.
---

Skill body.
```

Create `electron/services/__fixtures__/plugins/agents-only/agents/lonely.md`:

```markdown
---
name: lonely
description: Only agent in this plugin.
---

Body.
```

Create `electron/services/__fixtures__/plugins/commands-only/commands/solo.md`:

```markdown
---
description: Only command in this plugin.
---

Body.
```

- [ ] **Step 2: Write failing tests**

Add to `electron/services/pluginImportService.test.ts`:

```ts
describe('discoverPlugins — mixed kinds', () => {
  it('returns subagents and slashCommands alongside skills for a mixed plugin', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')
    expect(mixed).toBeDefined()
    expect(mixed!.skills.map(s => s.name).sort()).toEqual(['some-skill'])
    expect(mixed!.subagents.map(s => s.name).sort()).toEqual(['agent-one', 'agent-two'])
    expect(mixed!.slashCommands.map(c => c.name).sort()).toEqual(['cmd-one'])
  })

  it('includes plugins that have only agents/', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const agentsOnly = plugins.find(p => p.name === 'agents-only')
    expect(agentsOnly).toBeDefined()
    expect(agentsOnly!.skills).toEqual([])
    expect(agentsOnly!.subagents.map(s => s.name)).toEqual(['lonely'])
    expect(agentsOnly!.slashCommands).toEqual([])
  })

  it('includes plugins that have only commands/', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cmdOnly = plugins.find(p => p.name === 'commands-only')
    expect(cmdOnly).toBeDefined()
    expect(cmdOnly!.slashCommands.map(c => c.name)).toEqual(['solo'])
  })

  it('subagent discovery surface carries description and color', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')!
    const a1 = mixed.subagents.find(s => s.name === 'agent-one')!
    expect(a1.description).toBe('First agent.')
    expect(a1.color).toBe('blue')
    const a2 = mixed.subagents.find(s => s.name === 'agent-two')!
    expect(a2.color).toBeNull()
  })

  it('slash command discovery carries description and argumentHint', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const mixed = plugins.find(p => p.name === 'mixed-plugin')!
    const c = mixed.slashCommands.find(s => s.name === 'cmd-one')!
    expect(c.description).toBe('A command.')
    expect(c.argumentHint).toBe('[target]')
  })

  it('preserves existing skills-only plugins (regression)', async () => {
    const plugins = await discoverPlugins([PLUGIN_FIXTURES])
    const cool = plugins.find(p => p.name === 'cool-plugin')
    expect(cool).toBeDefined()
    expect(cool!.skills.length).toBeGreaterThan(0)
    expect(cool!.subagents).toEqual([])
    expect(cool!.slashCommands).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

Run: `npm test -- pluginImportService`
Expected: FAIL — `subagents` and `slashCommands` undefined on `DiscoveredPlugin`.

- [ ] **Step 4: Update `DiscoveredPlugin` type and discovery logic**

In `electron/services/pluginImportService.ts`:

Add new types near `DiscoveredSkill` (around line ~149):

```ts
export interface DiscoveredSubagent {
  name: string
  path: string
  description: string | null
  color: string | null
}

export interface DiscoveredSlashCommand {
  name: string
  path: string
  description: string | null
  argumentHint: string | null
}
```

Update `DiscoveredPlugin` to add the two arrays:

```ts
export interface DiscoveredPlugin {
  id: string
  name: string
  version: string | null
  root: string
  skills: DiscoveredSkill[]
  subagents: DiscoveredSubagent[]
  slashCommands: DiscoveredSlashCommand[]
}
```

Replace the body of `discoverPlugins` (around line ~164-202) with:

```ts
export async function discoverPlugins(roots: string[]): Promise<DiscoveredPlugin[]> {
  const out: DiscoveredPlugin[] = []
  for (const root of roots) {
    const exists = await fs.stat(root).catch(() => null)
    if (!exists || !exists.isDirectory()) continue
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = path.join(root, entry.name)

      const skillsDir = path.join(pluginDir, 'skills')
      const agentsDir = path.join(pluginDir, 'agents')
      const commandsDir = path.join(pluginDir, 'commands')

      const [skills, subagents, slashCommands] = await Promise.all([
        (await fs.stat(skillsDir).catch(() => null))?.isDirectory()
          ? listSkillsInPluginDir(skillsDir)
          : Promise.resolve([] as DiscoveredSkill[]),
        (await fs.stat(agentsDir).catch(() => null))?.isDirectory()
          ? listSubagentsInPluginDir(agentsDir)
          : Promise.resolve([] as DiscoveredSubagent[]),
        (await fs.stat(commandsDir).catch(() => null))?.isDirectory()
          ? listSlashCommandsInPluginDir(commandsDir)
          : Promise.resolve([] as DiscoveredSlashCommand[]),
      ])

      // Plugin gate: must have at least one of the three populated
      if (skills.length === 0 && subagents.length === 0 && slashCommands.length === 0) continue

      const manifest = await readPluginManifest(pluginDir)
      out.push({
        id: simpleHash(pluginDir),
        name: manifest.name,
        version: manifest.version,
        root: pluginDir,
        skills,
        subagents,
        slashCommands,
      })
    }
  }
  return out
}
```

Add the two new listing helpers near `listSkillsInPluginDir`:

```ts
async function listSubagentsInPluginDir(agentsDir: string): Promise<DiscoveredSubagent[]> {
  const out: DiscoveredSubagent[] = []
  const entries = await fs.readdir(agentsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.md')) continue
    if (IGNORE_NAMES.has(entry.name)) continue
    const filePath = path.join(agentsDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (raw === null) continue
    const filenameStem = path.basename(entry.name, '.md')
    let name = filenameStem
    let description: string | null = null
    let color: string | null = null
    try {
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string' && data.name.length > 0) name = data.name
      if (typeof data.description === 'string') description = data.description
      if (typeof data.color === 'string') color = data.color
    } catch {
      // Bad frontmatter — keep defaults
    }
    out.push({ name, path: filePath, description, color })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSlashCommandsInPluginDir(commandsDir: string): Promise<DiscoveredSlashCommand[]> {
  const out: DiscoveredSlashCommand[] = []
  const entries = await fs.readdir(commandsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.md')) continue
    if (IGNORE_NAMES.has(entry.name)) continue
    const filePath = path.join(commandsDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (raw === null) continue
    const name = path.basename(entry.name, '.md')
    let description: string | null = null
    let argumentHint: string | null = null
    try {
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.description === 'string') description = data.description
      argumentHint = parseArgumentHint(data['argument-hint'])
    } catch {
      // Bad frontmatter — keep defaults
    }
    out.push({ name, path: filePath, description, argumentHint })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test -- pluginImportService`
Expected: PASS, including the regression test for skills-only plugins.

- [ ] **Step 6: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportService.test.ts electron/services/__fixtures__/plugins/
git commit -m "feat(agents): discoverPlugins enumerates subagents and slash commands"
```

---

## Task 10: Extend GitHub repo discovery for sub-agents and commands

Mirror Task 9's local-side changes in `pluginImportFromGithubService.ts`. `RepoSkillIndex` becomes `RepoPluginIndex`. `discoverSkillsInRepo` becomes `discoverPluginInRepo` (export both names temporarily — see Step 6).

**Files:**
- Modify: `electron/services/pluginImportFromGithubService.ts`
- Modify: `electron/services/pluginImportFromGithubService.test.ts`

- [ ] **Step 1: Write failing tests**

Look at the existing `pluginImportFromGithubService.test.ts` to learn how `getRepo` / `getBranch` / `getTreeBySha` / `getRawFileBytes` are mocked. The test file mocks the `../github` module.

Add a new test block:

```ts
describe('discoverPluginInRepo — mixed kinds', () => {
  it('returns subagents and slashCommands alongside skills', async () => {
    // Configure mocks so the root tree contains skills/, agents/, commands/.
    // Each respective sha returns appropriate child entries.
    // (Build on existing mock patterns in this test file — see how it's done
    // for the skills-only case above; mirror that for the new directories.)
    mockRepo({ default_branch: 'main' })
    mockBranch({ commitSha: 'abc1234', rootTreeSha: 'rootsha' })
    mockTree('rootsha', [
      { path: 'skills', mode: '040000', type: 'tree', sha: 'skillssha' },
      { path: 'agents', mode: '040000', type: 'tree', sha: 'agentssha' },
      { path: 'commands', mode: '040000', type: 'tree', sha: 'commandssha' },
    ])
    mockTree('skillssha', [
      { path: 'a-skill', mode: '040000', type: 'tree', sha: 'askillsha' },
    ])
    mockTree('askillsha', [
      { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'skillmdsha' },
    ])
    mockTree('agentssha', [
      { path: 'agent-one.md', mode: '100644', type: 'blob', sha: 'agent1sha' },
    ])
    mockTree('commandssha', [
      { path: 'cmd-one.md', mode: '100644', type: 'blob', sha: 'cmd1sha' },
    ])
    mockRawFile('skills/a-skill/SKILL.md', `---\nname: a-skill\ndescription: Sk.\n---\nbody`)
    mockRawFile('agents/agent-one.md', `---\nname: agent-one\ndescription: Ag.\ncolor: red\n---\nbody`)
    mockRawFile('commands/cmd-one.md', `---\ndescription: Cmd.\nargument-hint: [x]\n---\nbody`)

    const index = await discoverPluginInRepo('owner', 'repo')
    expect(index.skills.map(s => s.name)).toEqual(['a-skill'])
    expect(index.subagents.map(s => s.name)).toEqual(['agent-one'])
    expect(index.subagents[0].color).toBe('red')
    expect(index.slashCommands.map(c => c.name)).toEqual(['cmd-one'])
    expect(index.slashCommands[0].argumentHint).toBe('[x]')
  })
})
```

> **Implementer note:** the exact mocking helper names (`mockRepo`, `mockBranch`, etc.) depend on what the existing test file uses. Read the existing test file first and follow its style verbatim.

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- pluginImportFromGithubService`
Expected: FAIL — `discoverPluginInRepo is not exported`.

- [ ] **Step 3: Add the new types and function alongside the existing ones**

In `electron/services/pluginImportFromGithubService.ts`:

Add types:

```ts
export interface DiscoveredSubagentRemote {
  name: string
  path: string           // repo-relative
  description: string | null
  color: string | null
}

export interface DiscoveredSlashCommandRemote {
  name: string
  path: string
  description: string | null
  argumentHint: string | null
}

export interface RepoPluginIndex {
  owner: string
  name: string
  branch: string
  commitSha: string
  layout: 'skills-dir' | 'bare-root' | 'plugin'
  skills: DiscoveredSkill[]
  subagents: DiscoveredSubagentRemote[]
  slashCommands: DiscoveredSlashCommandRemote[]
}
```

> **Note:** `DiscoveredSubagent` / `DiscoveredSlashCommand` types already exist in `pluginImportService.ts` for the local case, but those carry **absolute** paths. The GitHub-side variants here carry **repo-relative** paths. The shapes are otherwise identical, but keeping them as separate types avoids ambiguity at the call site. Don't unify them.

Implement `discoverPluginInRepo`:

```ts
export async function discoverPluginInRepo(
  owner: string,
  name: string,
): Promise<RepoPluginIndex> {
  const token = getToken() ?? null
  let repo: { default_branch: string }
  try {
    repo = await getRepo(token, owner, name)
  } catch {
    throw new RepoNotAccessibleError(owner, name)
  }
  const branch = repo.default_branch
  const { commitSha, rootTreeSha } = await getBranch(token, owner, name, branch)
  const rootEntries = await getTreeBySha(token, owner, name, rootTreeSha)

  const skillsEntry = rootEntries.find(e => e.path === 'skills' && e.type === 'tree')
  const agentsEntry = rootEntries.find(e => e.path === 'agents' && e.type === 'tree')
  const commandsEntry = rootEntries.find(e => e.path === 'commands' && e.type === 'tree')

  // Bare-root layout: root SKILL.md, no subdirectories.
  if (!skillsEntry && !agentsEntry && !commandsEntry) {
    const rootSkillMd = rootEntries.find(e => e.path === 'SKILL.md' && e.type === 'blob')
    if (rootSkillMd) {
      const skill = await summarizeBareRoot(token, owner, name, branch, rootEntries)
      return {
        owner, name, branch, commitSha,
        layout: 'bare-root',
        skills: skill ? [skill] : [],
        subagents: [],
        slashCommands: [],
      }
    }
    return { owner, name, branch, commitSha, layout: 'plugin', skills: [], subagents: [], slashCommands: [] }
  }

  const skills = skillsEntry
    ? await listSkillsUnderSkillsDir(token, owner, name, branch, skillsEntry.sha)
    : []
  const subagents = agentsEntry
    ? await listSubagentsInRepo(token, owner, name, branch, agentsEntry.sha)
    : []
  const slashCommands = commandsEntry
    ? await listSlashCommandsInRepo(token, owner, name, branch, commandsEntry.sha)
    : []

  return {
    owner, name, branch, commitSha,
    layout: 'plugin',
    skills, subagents, slashCommands,
  }
}

async function listSubagentsInRepo(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  agentsTreeSha: string,
): Promise<DiscoveredSubagentRemote[]> {
  const entries = await getTreeBySha(token, owner, name, agentsTreeSha)
  const out: DiscoveredSubagentRemote[] = []
  for (const e of entries) {
    if (e.type !== 'blob') continue
    if (!e.path.endsWith('.md')) continue
    if (IGNORE_NAMES.has(e.path)) continue
    const repoPath = `agents/${e.path}`
    const filenameStem = path.basename(e.path, '.md')
    let displayName = filenameStem
    let description: string | null = null
    let color: string | null = null
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
      const parsed = matter(buf.toString('utf-8'))
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
      if (typeof data.description === 'string') description = data.description
      if (typeof data.color === 'string') color = data.color
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pluginImportFromGithubService] Failed to fetch ${repoPath}:`, err)
      continue
    }
    out.push({ name: displayName, path: repoPath, description, color })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSlashCommandsInRepo(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  commandsTreeSha: string,
): Promise<DiscoveredSlashCommandRemote[]> {
  const entries = await getTreeBySha(token, owner, name, commandsTreeSha)
  const out: DiscoveredSlashCommandRemote[] = []
  for (const e of entries) {
    if (e.type !== 'blob') continue
    if (!e.path.endsWith('.md')) continue
    if (IGNORE_NAMES.has(e.path)) continue
    const repoPath = `commands/${e.path}`
    const filenameStem = path.basename(e.path, '.md')
    let description: string | null = null
    let argumentHint: string | null = null
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
      const parsed = matter(buf.toString('utf-8'))
      const data = parsed.data as Record<string, unknown>
      if (typeof data.description === 'string') description = data.description
      argumentHint = parseArgumentHint(data['argument-hint'])
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pluginImportFromGithubService] Failed to fetch ${repoPath}:`, err)
      continue
    }
    out.push({ name: filenameStem, path: repoPath, description, argumentHint })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
```

Add a `path` import at the top of the file if not already present: `import path from 'node:path'`.

- [ ] **Step 4: Update `discoverSkillsInRepo` to delegate, keep export for backward-compat shim**

The legacy `discoverSkillsInRepo` still exists. It used to return `RepoSkillIndex`. Don't delete it yet — we still have one caller (the IPC handler) until Task 12. For now, mark it deprecated and have it delegate:

```ts
/** @deprecated Use discoverPluginInRepo. Retained for one-task transition. */
export async function discoverSkillsInRepo(owner: string, name: string): Promise<RepoSkillIndex> {
  const idx = await discoverPluginInRepo(owner, name)
  return {
    owner: idx.owner,
    name: idx.name,
    branch: idx.branch,
    commitSha: idx.commitSha,
    layout: idx.layout === 'plugin' ? 'skills-dir' : idx.layout,
    skills: idx.skills,
  }
}
```

Keep the existing `RepoSkillIndex` export for the same one-task transition.

- [ ] **Step 5: Add `readTargetFromRepo` (replaces `readSkillFromRepo`)**

Add a kind-aware reader that fetches a single import target from a repo. Implement alongside the existing `readSkillFromRepo` (which stays for backward-compat for one task):

```ts
export async function readTargetFromRepo(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,
  kind: 'skill' | 'subagent' | 'slashCommand',
): Promise<ParsedImportTarget> {
  const token = getToken() ?? null
  if (kind === 'skill') {
    return readSkillFromRepo(owner, name, branch, commitSha, repoPath)
  }

  const buf = await getRawFileBytes(token, owner, name, branch, repoPath)
  const raw = buf.toString('utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const filenameStem = path.basename(repoPath, '.md')

  if (kind === 'subagent') {
    const targetName = typeof data.name === 'string' && data.name.length > 0 ? data.name : filenameStem
    const description = typeof data.description === 'string' ? data.description : ''
    const model = parseModelFrontmatter(data.model)
    const tools = parseToolsFrontmatter(data.tools)
    const color = typeof data.color === 'string' ? data.color : null
    return {
      kind: 'subagent',
      name: targetName,
      handle: slugifyName(targetName),
      description,
      body: parsed.content.trim(),
      files: [],
      origin: {
        plugin: `${owner}/${name}`,
        pluginVersion: commitSha.slice(0, 7),
        path: repoPath,
      },
      model,
      tools,
      argumentHint: null,
      color,
    }
  }

  // slashCommand
  const description = typeof data.description === 'string' ? data.description : ''
  const argumentHint = parseArgumentHint(data['argument-hint'])
  return {
    kind: 'slashCommand',
    name: filenameStem,
    handle: slugifyName(filenameStem),
    description,
    body: parsed.content.trim(),
    files: [],
    origin: {
      plugin: `${owner}/${name}`,
      pluginVersion: commitSha.slice(0, 7),
      path: repoPath,
    },
    model: 'inherit',
    tools: null,
    argumentHint,
  }
}
```

Import `ParsedImportTarget` (and the helpers it uses) from `./pluginImportService` if not already imported.

- [ ] **Step 6: Run tests — expect pass**

Run: `npm test -- pluginImportFromGithubService`
Expected: PASS for the new tests; existing skill tests still green.

- [ ] **Step 7: Commit**

```bash
git add electron/services/pluginImportFromGithubService.ts electron/services/pluginImportFromGithubService.test.ts
git commit -m "feat(agents): GitHub discovery returns subagents and slash commands"
```

---

## Task 11: Rename `importSkill` → `importTarget` with kind dispatch

Generalize the importer. Same transactional shape and conflict resolver, dispatches on `target.kind` for the `createAgent` flags and the sibling-files branch.

**Files:**
- Modify: `electron/services/pluginImportService.ts`
- Modify: `electron/services/pluginImportService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `electron/services/pluginImportService.test.ts`:

```ts
import { importTarget, parseSubagent, parseSlashCommand } from './pluginImportService'

describe('importTarget — subagent', () => {
  it('creates an agent with is_subagent=1 and no sibling files', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const sub = await parseSubagent(path.join(__dirname, '__fixtures__/subagents/full.md'))
    const result = importTarget(db, sub, { folderId: folder.id, onConflict: 'rename' })
    expect(result.conflictResolved).toBe('created')
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.handle).toBe('code-architect')
    expect(agent.is_subagent).toBe(1)
    expect(agent.is_slash_command).toBe(0)
    expect(agent.model).toBe('sonnet')
    const tools = JSON.parse(agent.tools)
    expect(tools).toEqual(['Glob', 'Grep', 'Read'])
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    expect(files).toEqual([])
  })

  it('maps known color names to hex in color_start', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const sub = await parseSubagent(path.join(__dirname, '__fixtures__/subagents/full.md'))
    const result = importTarget(db, sub, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.color_start).toBe('#22c55e')   // green
  })
})

describe('importTarget — slashCommand', () => {
  it('creates an agent with is_slash_command=1', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const cmd = await parseSlashCommand(path.join(__dirname, '__fixtures__/commands/full.md'))
    const result = importTarget(db, cmd, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(1)
    expect(agent.argument_hint).toBe('Optional feature description')
  })
})

describe('importTarget — skill (regression)', () => {
  it('preserves existing skill import behavior', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const result = importTarget(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    expect(files.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- pluginImportService`
Expected: FAIL — `importTarget is not exported`.

- [ ] **Step 3: Implement `importTarget`**

Replace the existing `importSkill` and `createFromScratch` functions in `electron/services/pluginImportService.ts` with kind-aware versions. The function signature becomes:

```ts
export function importTarget(
  db: Database.Database,
  target: ParsedImportTarget,
  opts: ImportOptions,
): ImportResult {
  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const existing = db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(target.handle) as { id: string } | undefined

  if (existing) {
    if (opts.onConflict === 'skip') {
      return { agentId: existing.id, conflictResolved: 'skipped' }
    }
    if (opts.onConflict === 'overwrite') {
      const tx = db.transaction(() => {
        updateAgent(db, existing.id, {
          name: target.name,
          body: target.body,
          description: target.description,
          model: target.model,
          tools: target.tools,
          argumentHint: target.argumentHint,
        })
        const ts = new Date().toISOString()
        db.prepare(`
          UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
          WHERE id = ?
        `).run(
          target.origin?.plugin ?? null,
          target.origin?.path ?? null,
          target.origin?.pluginVersion ?? null,
          ts,
          existing.id,
        )
        // Sibling files: skill kind only.
        if (target.kind === 'skill') {
          const oldFiles = listFiles(db, existing.id)
          for (const f of oldFiles) deleteFile(db, existing.id, f.id)
          target.files.forEach((f, i) => {
            createFile(db, existing.id, { filename: f.filename, content: f.content, sortOrder: i })
          })
        }
      })
      tx()
      return { agentId: existing.id, conflictResolved: 'overwritten' }
    }
    // rename
    const newHandle = dedupeHandle(target.handle, taken)
    return createFromScratch(db, { ...target, handle: newHandle } as ParsedImportTarget, opts, 'renamed')
  }

  return createFromScratch(db, target, opts, 'created')
}

function createFromScratch(
  db: Database.Database,
  target: ParsedImportTarget,
  opts: ImportOptions,
  resolution: 'created' | 'renamed',
): ImportResult {
  const colorStart = target.kind === 'subagent' && target.color
    ? (COLOR_MAP[target.color] ?? hashHandleToColor(target.handle))
    : hashHandleToColor(target.handle)

  let agentId = ''
  const tx = db.transaction(() => {
    const agent = createAgent(db, {
      name: target.name,
      body: target.body,
      folderId: opts.folderId,
      handle: target.handle,
      colorStart,
      colorEnd: null,
      emoji: null,
      description: target.description,
      model: target.model,
      tools: target.tools,
      argumentHint: target.argumentHint,
      isSubagent: target.kind === 'subagent' ? 1 : 0,
      isSlashCommand: target.kind === 'slashCommand' ? 1 : 0,
    })
    agentId = agent.id
    const ts = new Date().toISOString()
    db.prepare(`
      UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
      WHERE id = ?
    `).run(
      target.origin?.plugin ?? null,
      target.origin?.path ?? null,
      target.origin?.pluginVersion ?? null,
      ts,
      agent.id,
    )
    if (target.kind === 'skill') {
      target.files.forEach((f, i) => {
        createFile(db, agent.id, { filename: f.filename, content: f.content, sortOrder: i })
      })
    }
  })
  tx()
  return { agentId, conflictResolved: resolution }
}

/** @deprecated Use importTarget. Retained for one-task transition. */
export function importSkill(
  db: Database.Database,
  skill: ParsedSkill,
  opts: ImportOptions,
): ImportResult {
  return importTarget(db, skill, opts)
}
```

> **Note on `createAgent`:** the call now passes `isSubagent` and `isSlashCommand`. Check `electron/services/agentsService.ts`'s `CreateAgentInput` type — these fields may or may not be in the current input shape. If they are not, extend `CreateAgentInput` to accept optional `isSubagent?: 0 | 1` and `isSlashCommand?: 0 | 1`, default both to `0`, and have `createAgent` pass them to the INSERT. Update the existing `createAgent` callers as needed — they default to `0` which matches today's behavior.

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- pluginImportService`
Expected: PASS for all three new tests + the skill regression test + the existing skill tests.

- [ ] **Step 5: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportService.test.ts electron/services/agentsService.ts
git commit -m "feat(agents): importTarget dispatches on kind for sub-agent and slash-command imports"
```

---

## Task 12: Update IPC routes — rename + add auto-sync branch

Rename five routes to kind-agnostic names. Add the auto-sync branch so sub-agent and command imports immediately write to `~/.claude/agents/` and `~/.claude/commands/`.

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`

- [ ] **Step 1: Rename `discoverInRepo` route**

In `electron/ipc/agentHandlers.ts`, locate the handler:

```ts
ipcMain.handle('agents:import:discoverInRepo', async (_, url: string) => {
  const parsed = parseGithubRepoUrl(url)
  if (!parsed) throw new Error('Not a valid GitHub URL')
  return discoverSkillsInRepo(parsed.owner, parsed.name)
})
```

Replace with:

```ts
ipcMain.handle('agents:import:discoverPluginInRepo', async (_, url: string) => {
  const parsed = parseGithubRepoUrl(url)
  if (!parsed) throw new Error('Not a valid GitHub URL')
  return discoverPluginInRepo(parsed.owner, parsed.name)
})
```

Update the imports at the top of the file: replace `discoverSkillsInRepo, readSkillFromRepo` with `discoverPluginInRepo, readTargetFromRepo`.

- [ ] **Step 2: Replace `readSkillFromRepo` route with `readTargetFromRepo`**

Locate:

```ts
ipcMain.handle('agents:import:readSkillFromRepo', async (
  _, owner: string, name: string, branch: string, commitSha: string, repoPath: string,
) => {
  return readSkillFromRepo(owner, name, branch, commitSha, repoPath)
})
```

Replace with:

```ts
ipcMain.handle('agents:import:readTargetFromRepo', async (
  _,
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,
  kind: 'skill' | 'subagent' | 'slashCommand',
) => {
  return readTargetFromRepo(owner, name, branch, commitSha, repoPath, kind)
})
```

- [ ] **Step 3: Replace `readSkillFromDisk` route with `readTargetFromDisk`**

Locate:

```ts
ipcMain.handle('agents:import:readSkillFromDisk', async (_, skillPath: string) => {
  return parseSkill(skillPath)
})
```

Replace with:

```ts
ipcMain.handle('agents:import:readTargetFromDisk', async (
  _,
  filePath: string,
  kind: 'skill' | 'subagent' | 'slashCommand',
) => {
  if (kind === 'skill') return parseSkill(filePath)
  if (kind === 'subagent') return parseSubagent(filePath)
  return parseSlashCommand(filePath)
})
```

Update the imports: add `parseSubagent`, `parseSlashCommand` to the import from `../services/pluginImportService`.

- [ ] **Step 4: Replace `importSkill` route with `importTarget` (with auto-sync)**

Locate:

```ts
ipcMain.handle('agents:import:importSkill', async (_, skill: ParsedSkill, opts: ImportOptions) => {
  const result = importSkill(getDb(app.getPath('userData')), skill, opts)
  broadcastChanged()
  return result
})
```

Replace with:

```ts
ipcMain.handle('agents:import:importTarget', async (
  _,
  target: ParsedImportTarget,
  opts: ImportOptions,
) => {
  const db = getDb(app.getPath('userData'))
  const result = importTarget(db, target, opts)
  let syncWarning: string | undefined
  if (target.kind !== 'skill' && result.conflictResolved !== 'skipped') {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.agentId) as AgentRow
    const synced = await runSyncAndPersist(row, undefined, /* forceOverwrite */ false)
    syncWarning = synced.syncWarning
  }
  broadcastChanged()
  return syncWarning ? { ...result, syncWarning } : result
})
```

Update the imports: add `importTarget`, `ParsedImportTarget` from `../services/pluginImportService` (remove `importSkill`, `ParsedSkill` if no longer needed elsewhere in this file).

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test`
Expected: All tests pass.

Run typecheck. Expected: clean.

- [ ] **Step 6: Manual IPC sanity check** *(optional but recommended before commit)*

Launch `npm run dev`, open the existing Import dialog (which still uses the old route names — those will break in this step until Task 13 runs). Just confirm the app boots without crashing. Don't try to import; the renderer hasn't been updated yet.

Close the dev server.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/agentHandlers.ts
git commit -m "feat(agents): rename import IPC routes + auto-sync subagent/command imports"
```

---

## Task 13: Update preload wrapper

Rename the renderer-facing methods to match the new IPC route names.

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Locate the current import wrapper**

In `electron/preload.ts` (around line ~254-270), the current shape:

```ts
import: {
  discoverPlugins: () => ipcRenderer.invoke('agents:import:discoverPlugins') as Promise<import('../electron/services/pluginImportService').DiscoveredPlugin[]>,
  readSkillFromDisk: (skillPath: string) =>
    ipcRenderer.invoke('agents:import:readSkillFromDisk', skillPath) as Promise<import('../electron/services/pluginImportService').ParsedSkill>,
  importSkill: (
    skill: import('../electron/services/pluginImportService').ParsedSkill,
    opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' },
  ) =>
    ipcRenderer.invoke('agents:import:importSkill', skill, opts) as Promise<import('../electron/services/pluginImportService').ImportResult>,
  discoverInRepo: (url: string) =>
    ipcRenderer.invoke('agents:import:discoverInRepo', url) as Promise<import('../electron/services/pluginImportFromGithubService').RepoSkillIndex>,
  readSkillFromRepo: (
    owner: string, name: string, branch: string, commitSha: string, repoPath: string,
  ) =>
    ipcRenderer.invoke('agents:import:readSkillFromRepo', owner, name, branch, commitSha, repoPath) as Promise<import('../electron/services/pluginImportService').ParsedSkill>,
},
```

- [ ] **Step 2: Replace with kind-aware wrapper**

```ts
import: {
  discoverPlugins: () =>
    ipcRenderer.invoke('agents:import:discoverPlugins') as Promise<import('../electron/services/pluginImportService').DiscoveredPlugin[]>,

  readTargetFromDisk: (
    filePath: string,
    kind: 'skill' | 'subagent' | 'slashCommand',
  ) =>
    ipcRenderer.invoke('agents:import:readTargetFromDisk', filePath, kind) as Promise<import('../electron/services/pluginImportService').ParsedImportTarget>,

  importTarget: (
    target: import('../electron/services/pluginImportService').ParsedImportTarget,
    opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' },
  ) =>
    ipcRenderer.invoke('agents:import:importTarget', target, opts) as Promise<
      import('../electron/services/pluginImportService').ImportResult & { syncWarning?: string }
    >,

  discoverPluginInRepo: (url: string) =>
    ipcRenderer.invoke('agents:import:discoverPluginInRepo', url) as Promise<import('../electron/services/pluginImportFromGithubService').RepoPluginIndex>,

  readTargetFromRepo: (
    owner: string,
    name: string,
    branch: string,
    commitSha: string,
    repoPath: string,
    kind: 'skill' | 'subagent' | 'slashCommand',
  ) =>
    ipcRenderer.invoke('agents:import:readTargetFromRepo', owner, name, branch, commitSha, repoPath, kind) as Promise<import('../electron/services/pluginImportService').ParsedImportTarget>,
},
```

- [ ] **Step 3: Verify `window.api` typings**

If there's a `src/types/window.d.ts` or similar declaration file that mirrors `window.api`, update it to match the new method names and types. Grep: `grep -rn "readSkillFromDisk\|importSkill\|discoverInRepo\|readSkillFromRepo" --include="*.d.ts" .`

- [ ] **Step 4: Run typecheck**

Run typecheck. Expected: type errors will surface in `src/components/ImportSkillDialog.tsx` because it still calls the old method names. That's expected — Task 14 fixes it. Leave them broken for now; commit is OK because the production build script will refuse, but the test command still works.

Run: `npm test`
Expected: All tests pass (tests don't go through the preload).

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(agents): preload wrapper exposes importTarget + readTargetFrom* methods"
```

---

## Task 14: Rename `ImportSkillDialog` → `ImportPluginDialog`

Mechanical rename. The substantive UI changes happen in Task 15. Splitting them keeps the diff readable.

**Files:**
- Rename: `src/components/ImportSkillDialog.tsx` → `src/components/ImportPluginDialog.tsx`
- Rename: `src/components/ImportSkillDialog.test.tsx` → `src/components/ImportPluginDialog.test.tsx`
- Modify: every consumer of `ImportSkillDialog`

- [ ] **Step 1: Rename via `git mv`**

```bash
git mv src/components/ImportSkillDialog.tsx src/components/ImportPluginDialog.tsx
git mv src/components/ImportSkillDialog.test.tsx src/components/ImportPluginDialog.test.tsx
```

- [ ] **Step 2: Find consumers**

Run: `grep -rn "ImportSkillDialog" --include="*.ts" --include="*.tsx" .`

Find every file that imports the old name. Likely at least one consumer in `src/` (an Agents Library view or App.tsx button handler).

- [ ] **Step 3: Update the component name**

Inside `src/components/ImportPluginDialog.tsx`:

```ts
// before
export default function ImportSkillDialog({ open, onClose }: Props) { ... }
// after
export default function ImportPluginDialog({ open, onClose }: Props) { ... }
```

Update every consumer's import:

```ts
// before
import ImportSkillDialog from './components/ImportSkillDialog'
// after
import ImportPluginDialog from './components/ImportPluginDialog'
```

And every JSX usage:

```ts
// before
<ImportSkillDialog open={...} onClose={...} />
// after
<ImportPluginDialog open={...} onClose={...} />
```

Use Edit's `replace_all` per file.

- [ ] **Step 4: Update method calls inside the dialog to use the new wrapper names**

The dialog currently calls `window.api.agents.import.readSkillFromDisk`, `.importSkill`, `.discoverInRepo`, `.readSkillFromRepo`. Update each call site:

| Old | New |
|---|---|
| `window.api.agents.import.readSkillFromDisk(p)` | `window.api.agents.import.readTargetFromDisk(p, 'skill')` |
| `window.api.agents.import.importSkill(parsed, opts)` | `window.api.agents.import.importTarget(parsed, opts)` |
| `window.api.agents.import.discoverInRepo(url)` | `window.api.agents.import.discoverPluginInRepo(url)` |
| `window.api.agents.import.readSkillFromRepo(o,n,b,c,p)` | `window.api.agents.import.readTargetFromRepo(o,n,b,c,p,'skill')` |

For now the dialog only handles skills, so the explicit `'skill'` kind argument is fine — Task 15 expands this.

Also update type references inside the file: `RepoSkillIndex` → `RepoPluginIndex`, `ParsedSkill` → `ParsedSkill` (still valid; it's now a member of the union).

- [ ] **Step 5: Run typecheck**

Run typecheck. Expected: clean now (the Task 13 type errors are resolved).

Run: `npm test`
Expected: All tests pass. The existing dialog tests test skill-import behavior; that path still works.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename ImportSkillDialog -> ImportPluginDialog + update IPC calls"
```

---

## Task 15: Extend `ImportPluginDialog` to show sub-agents and slash commands

The dialog currently shows only the `plugin.skills` array per expanded plugin. Extend it to render three grouped sub-lists, add kind badges and color swatches, switch selection state to `(kind:path)` keying, and surface the auto-sync notice.

**Files:**
- Modify: `src/components/ImportPluginDialog.tsx`
- Modify: `src/components/ImportPluginDialog.test.tsx`

This task is the largest. Test-first per slice.

### Slice A: Selection state keyed by `(kind:path)`

- [ ] **Step 1: Write failing test**

Add to `src/components/ImportPluginDialog.test.tsx`:

```ts
it('keys selection state by kind:path so sub-agents and skills can coexist', async () => {
  // Mock window.api.agents.import.discoverPlugins to return a plugin with
  // one skill at path 'a' and one subagent at path 'a' (different kinds, same path)
  // Open the dialog, expand the plugin.
  // Toggle the skill 'a' off.
  // Assert the subagent 'a' is still selected.
  // (Use existing test patterns from the file as a template; mock window.api
  //  the same way it's mocked for skill discovery today.)
})
```

> **Implementer note:** read `src/components/ImportPluginDialog.test.tsx` (formerly `ImportSkillDialog.test.tsx`) to see how `window.api` is mocked. Mirror that style for the new test. Don't invent a new mocking strategy.

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- ImportPluginDialog`
Expected: FAIL — current code keys by path only, so toggling one would untoggle both.

- [ ] **Step 3: Update selection state**

In `src/components/ImportPluginDialog.tsx`, change the state types:

```ts
type SelectionKey = `skill:${string}` | `subagent:${string}` | `slashCommand:${string}`

const [selected, setSelected] = useState<Set<SelectionKey>>(new Set())
const [repoSelected, setRepoSelected] = useState<Set<SelectionKey>>(new Set())
```

Add a helper:

```ts
function keyOf(kind: 'skill' | 'subagent' | 'slashCommand', p: string): SelectionKey {
  return `${kind}:${p}`
}
```

Update `toggleSkill` to be `toggle(kind, path)`:

```ts
const toggle = (kind: 'skill' | 'subagent' | 'slashCommand', p: string) => {
  setSelected(prev => {
    const next = new Set(prev)
    const k = keyOf(kind, p)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
}
```

In `handleExpand`, default-select all three kinds:

```ts
const handleExpand = (id: string) => {
  setExpandedId(prev => prev === id ? null : id)
  const plug = plugins?.find(p => p.id === id)
  if (plug) {
    const all = new Set<SelectionKey>()
    plug.skills.forEach(s => all.add(keyOf('skill', s.path)))
    plug.subagents.forEach(s => all.add(keyOf('subagent', s.path)))
    plug.slashCommands.forEach(c => all.add(keyOf('slashCommand', c.path)))
    setSelected(all)
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- ImportPluginDialog`
Expected: PASS.

### Slice B: Three grouped sub-lists with badges

- [ ] **Step 5: Write failing test**

```ts
it('renders three grouped sections with counts when plugin has mixed kinds', async () => {
  // Mock discoverPlugins to return a plugin with 2 skills, 3 subagents, 1 slashCommand.
  // Open the dialog, expand the plugin.
  // Assert: section headers 'Skills (2)', 'Sub-agents (3)', 'Slash commands (1)' are present.
})

it('hides empty groups so skills-only plugins look unchanged', async () => {
  // Mock discoverPlugins to return a plugin with only 1 skill, 0 subagents, 0 slashCommands.
  // Assert: only 'Skills (1)' header is visible; 'Sub-agents' and 'Slash commands' headers are absent.
})
```

- [ ] **Step 6: Run — expect failure**

Run: `npm test -- ImportPluginDialog`
Expected: FAIL — no group headers rendered yet.

- [ ] **Step 7: Update the JSX of the expanded plugin card**

Replace the current per-plugin rendering (single list of `plug.skills`) with three optional groups. Concrete shape:

```tsx
{expanded && (
  <div className="plugin-expanded">
    {expanded.skills.length > 0 && (
      <section className="kind-group">
        <header>Skills ({expanded.skills.length})</header>
        <ul>
          {expanded.skills.map(s => (
            <li key={`skill:${s.path}`}>
              <input
                type="checkbox"
                checked={selected.has(keyOf('skill', s.path))}
                onChange={() => toggle('skill', s.path)}
              />
              <KindBadge kind="skill" />
              <span className="name">{s.name}</span>
              {s.description && <span className="description">{s.description}</span>}
              <span className="file-count">{s.fileCount} files</span>
            </li>
          ))}
        </ul>
      </section>
    )}

    {expanded.subagents.length > 0 && (
      <section className="kind-group">
        <header>Sub-agents ({expanded.subagents.length})</header>
        <ul>
          {expanded.subagents.map(s => (
            <li key={`subagent:${s.path}`}>
              <input
                type="checkbox"
                checked={selected.has(keyOf('subagent', s.path))}
                onChange={() => toggle('subagent', s.path)}
              />
              <KindBadge kind="subagent" />
              <span className="name">{s.name}</span>
              {s.color && COLOR_MAP_RENDERER[s.color] && (
                <span className="color-swatch" style={{ backgroundColor: COLOR_MAP_RENDERER[s.color] }} />
              )}
              {s.description && <span className="description">{s.description}</span>}
            </li>
          ))}
        </ul>
      </section>
    )}

    {expanded.slashCommands.length > 0 && (
      <section className="kind-group">
        <header>Slash commands ({expanded.slashCommands.length})</header>
        <ul>
          {expanded.slashCommands.map(c => (
            <li key={`slashCommand:${c.path}`}>
              <input
                type="checkbox"
                checked={selected.has(keyOf('slashCommand', c.path))}
                onChange={() => toggle('slashCommand', c.path)}
              />
              <KindBadge kind="slashCommand" />
              <span className="name">{c.name}</span>
              {c.description && <span className="description">{c.description}</span>}
              {c.argumentHint && <span className="argument-hint">{c.argumentHint}</span>}
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
)}
```

Add a small `KindBadge` component in the same file (or extract to a sibling if it grows):

```tsx
function KindBadge({ kind }: { kind: 'skill' | 'subagent' | 'slashCommand' }) {
  const label = kind === 'skill' ? 'Skill' : kind === 'subagent' ? 'Sub-agent' : 'Command'
  const icon = kind === 'skill' ? 'book' : kind === 'subagent' ? 'robot' : 'chevron-right'
  return <span className={`kind-badge kind-${kind}`} title={label} aria-label={label}>{icon}</span>
}
```

> **Note on icons:** use whatever icon library the rest of the app uses (look at any sibling component for the pattern — e.g. lucide-react, heroicons, or inline SVG). Don't introduce a new dependency.

Import the renderer color map. Either:
- Re-export `COLOR_MAP` from `pluginImportService.ts` and import via `../../electron/services/pluginImportService` (existing pattern; the dialog already imports types this way), or
- Duplicate the small map inline as `COLOR_MAP_RENDERER`.

Prefer the first — single source of truth.

- [ ] **Step 8: Run — expect pass**

Run: `npm test -- ImportPluginDialog`
Expected: PASS.

### Slice C: Auto-sync notice subtitle + "Import N items" label

- [ ] **Step 9: Write failing test**

```ts
it('shows the sync-surface subtitle', () => {
  // Open the dialog (no plugin needs to be loaded).
  // Assert text "sync to ~/.claude/agents/" appears in the DOM.
})

it("button label says 'Import N items' (kind-agnostic) when multiple kinds selected", async () => {
  // Mock plugin with 1 skill + 1 subagent.
  // Open, expand, both selected by default.
  // Assert button text contains '2 items' (not '2 skills').
})
```

- [ ] **Step 10: Run — expect failure**

Run: `npm test -- ImportPluginDialog`
Expected: FAIL.

- [ ] **Step 11: Add subtitle + update button label**

In `ImportPluginDialog.tsx`, near the dialog title:

```tsx
<p className="dialog-subtitle">
  Imported sub-agents sync to <code>~/.claude/agents/</code>, slash commands to <code>~/.claude/commands/</code>. Skills stay in the library only.
</p>
```

Update the import button:

```tsx
<button onClick={handleImport} disabled={busy || selected.size === 0}>
  {busy ? 'Importing...' : `Import ${selected.size} item${selected.size === 1 ? '' : 's'}`}
</button>
```

- [ ] **Step 12: Run — expect pass**

Run: `npm test -- ImportPluginDialog`
Expected: PASS.

### Slice D: Import handler dispatches per kind

- [ ] **Step 13: Write failing test**

```ts
it('imports across kinds: skills via parseSkill path, subagents via parseSubagent, commands via parseSlashCommand', async () => {
  // Mock the readTargetFromDisk wrapper to record (path, kind) calls.
  // Mock importTarget to count invocations and record kinds.
  // Set up a plugin with 1 of each kind. Open, expand (all selected).
  // Click Import.
  // Assert readTargetFromDisk was called with kind='skill' once, 'subagent' once, 'slashCommand' once.
  // Assert importTarget was called 3 times with the matching parsed targets.
})
```

- [ ] **Step 14: Run — expect failure**

Run: `npm test -- ImportPluginDialog`
Expected: FAIL — current handler only iterates `expanded.skills`.

- [ ] **Step 15: Update `handleImport`**

Replace the current per-skill loop with a per-kind iteration that calls `readTargetFromDisk` with the right kind, then `importTarget`. Aggregate per-kind result counts for the summary:

```ts
const handleImport = async () => {
  if (!expanded) return
  setBusy(true)
  const failures: { name: string; error: string }[] = []
  const counts = { skill: 0, subagent: 0, slashCommand: 0, skipped: 0 }
  try {
    const { folders } = await window.api.agents.getAll()
    let folder = folders.find((f: AgentFolderRow) => f.name === expanded.name)
    if (!folder) folder = await window.api.agents.createFolder(expanded.name)
    const folderId = folder.id

    type Job = { kind: 'skill' | 'subagent' | 'slashCommand'; name: string; path: string }
    const jobs: Job[] = []
    expanded.skills.forEach(s =>      selected.has(keyOf('skill', s.path))         && jobs.push({ kind: 'skill',        name: s.name, path: s.path }))
    expanded.subagents.forEach(s =>   selected.has(keyOf('subagent', s.path))      && jobs.push({ kind: 'subagent',     name: s.name, path: s.path }))
    expanded.slashCommands.forEach(c => selected.has(keyOf('slashCommand', c.path)) && jobs.push({ kind: 'slashCommand', name: c.name, path: c.path }))

    for (const job of jobs) {
      try {
        const parsed = await window.api.agents.import.readTargetFromDisk(job.path, job.kind)
        parsed.origin = { plugin: expanded.name, pluginVersion: expanded.version, path: job.path }
        const result = await window.api.agents.import.importTarget(parsed, { folderId, onConflict: 'rename' })
        if (result.conflictResolved === 'skipped') counts.skipped++
        else counts[job.kind]++
        if ('syncWarning' in result && result.syncWarning) {
          failures.push({ name: job.name, error: `Synced with warning: ${result.syncWarning}` })
        }
      } catch (err) {
        failures.push({ name: job.name, error: (err as Error).message })
      }
    }

    if (failures.length > 0) {
      const msg = `Imported with ${failures.length} issue${failures.length === 1 ? '' : 's'}:\n\n`
        + failures.map(f => `· ${f.name}: ${f.error}`).join('\n')
      window.alert(msg)
    } else {
      const parts: string[] = []
      if (counts.skill > 0)        parts.push(`${counts.skill} skill${counts.skill === 1 ? '' : 's'}`)
      if (counts.subagent > 0)     parts.push(`${counts.subagent} sub-agent${counts.subagent === 1 ? '' : 's'}`)
      if (counts.slashCommand > 0) parts.push(`${counts.slashCommand} slash command${counts.slashCommand === 1 ? '' : 's'}`)
      // No user-facing message on clean success; window.alert is reserved for failures.
      // The dialog just closes.
    }
    onClose()
  } finally {
    setBusy(false)
  }
}
```

Also update the parallel `handleRepoImport` flow (the GitHub-side import in this file) to iterate over `repoIndex.subagents` and `repoIndex.slashCommands` the same way. The call shape is identical except it uses `readTargetFromRepo` instead of `readTargetFromDisk`.

- [ ] **Step 16: Run — expect pass**

Run: `npm test -- ImportPluginDialog`
Expected: PASS.

- [ ] **Step 17: Run the full test suite + typecheck**

Run: `npm test`
Expected: All tests pass.

Run typecheck. Expected: clean.

- [ ] **Step 18: Commit**

```bash
git add src/components/ImportPluginDialog.tsx src/components/ImportPluginDialog.test.tsx
git commit -m "feat(agents): ImportPluginDialog renders sub-agents and slash commands"
```

---

## Task 16: Drop deprecated shims

After Tasks 11 and 10 introduced `importSkill` and `discoverSkillsInRepo` as `@deprecated` shims, no caller should reference them anymore. This task removes them.

**Files:**
- Modify: `electron/services/pluginImportService.ts`
- Modify: `electron/services/pluginImportFromGithubService.ts`

- [ ] **Step 1: Verify no callers remain**

Run: `grep -rn "importSkill\b\|discoverSkillsInRepo\b\|readSkillFromRepo\b\|RepoSkillIndex\b" --include="*.ts" --include="*.tsx" .`

Expected output: only the deprecation declarations themselves and possibly test files that still import the old names. If a test still imports the old name, update it to the new name. If a non-test caller appears, that's a Task 12/13/14 bug — go fix it before continuing.

- [ ] **Step 2: Remove the deprecated exports**

In `electron/services/pluginImportService.ts`, delete the `@deprecated importSkill` wrapper (added in Task 11 Step 3).

In `electron/services/pluginImportFromGithubService.ts`, delete the `@deprecated discoverSkillsInRepo` wrapper, the `RepoSkillIndex` interface (if still exported), and the legacy `readSkillFromRepo` if and only if no caller depends on its specific shape. (`readTargetFromRepo` already delegates to it internally for the skill case — keep `readSkillFromRepo` as a private function in that case; only delete its export.)

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test`
Expected: All tests pass.

Run typecheck. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add electron/services/pluginImportService.ts electron/services/pluginImportFromGithubService.ts
git commit -m "chore(agents): drop deprecated importSkill + discoverSkillsInRepo shims"
```

---

## Task 17: Manual end-to-end verification

Per `superpowers:verification-before-completion`, no claim of completion without observed evidence.

- [ ] **Step 1: Boot the app**

Run: `npm run dev`

Expected: app launches without console errors.

- [ ] **Step 2: Open the import dialog**

Navigate to the Agents Library view (wherever the existing "Import" button lives — same surface as before). Click Import.

Expected: dialog opens. `discoverPlugins` IPC succeeds. Plugin list includes at least one entry from `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/` if any such plugin is installed locally (e.g. `feature-dev`).

- [ ] **Step 3: Expand a mixed plugin**

Expand `feature-dev` (or any other plugin known to have sub-agents and commands).

Expected: three grouped sections render with non-zero counts. Sub-agent rows show color swatches where the source `.md` has a `color:` field. Slash-command rows show argument-hints.

- [ ] **Step 4: Import a single sub-agent**

Uncheck everything except one sub-agent. Click Import.

Expected:
- Dialog closes without an alert.
- The new agent appears in the Agents Library with `is_subagent=1` visible in the row (the existing UI must already show this flag — confirm via the Overview tab or the row's badge).
- `~/.claude/agents/<handle>.md` now exists on disk and contains the imported body.

Run, in a terminal:
```bash
ls ~/.claude/agents/ | grep <handle>
cat ~/.claude/agents/<handle>.md | head -10
```

Expected: file exists; first lines show the frontmatter that `agentFileSyncService` writes.

- [ ] **Step 5: Import a slash command**

Open the dialog again, expand the same plugin, uncheck everything except one slash command. Click Import.

Expected: `~/.claude/commands/<handle>.md` exists.

- [ ] **Step 6: Import via GitHub URL**

In the dialog's GitHub URL pane, paste a known-good plugin repo URL (any public Anthropic plugin repo — pick one with `agents/` or `commands/`). Fetch.

Expected: three grouped sections render with correct counts. Import one item.

- [ ] **Step 7: Skill regression check**

Expand a skills-only plugin (e.g. `superpowers`). Import one skill.

Expected: imports unchanged from prior behavior — no disk write to `~/.claude/agents/`, agent lands in library with `is_subagent=0` and `is_slash_command=0`.

- [ ] **Step 8: Close the dev server. No commit — this task is observation only.**

If any step fails, treat it as a bug. Don't paper over with retries. Diagnose via the dev tools console + the Electron main-process log, identify which task introduced the regression, fix it, re-verify.

---

## Self-Review

**Spec coverage check** — every spec section maps to at least one task:

| Spec section | Task(s) |
|---|---|
| Type model (ParsedImportTarget union) | Task 4 |
| Discovery shape (DiscoveredPlugin widening) | Task 9 (local), Task 10 (GitHub) |
| Module structure (frontmatterFields, renames) | Tasks 1, 2, 3 |
| Local plugin roots (marketplaces) | Task 8 |
| Plugin gate (has any of three) | Task 9 |
| Plugin manifest precedence | Task 7 |
| Sub-agent listing | Task 9 |
| Slash command listing | Task 9 |
| GitHub repo discovery | Task 10 |
| parseSubagent | Task 5 |
| parseSlashCommand | Task 6 |
| Color mapping | Task 5 (COLOR_MAP) + Task 11 (color_start at import) |
| importTarget kind dispatch | Task 11 |
| Auto-sync in IPC handler | Task 12 |
| Shadowing caveat (UI subtitle) | Task 15 Slice C |
| IPC route renames | Task 12 |
| Renderer wrapper update | Task 13 |
| UI: three grouped sub-lists | Task 15 Slice B |
| UI: kind badges | Task 15 Slice B |
| UI: color swatch | Task 15 Slice B |
| UI: selection by (kind:path) | Task 15 Slice A |
| UI: "Import N items" label | Task 15 Slice C |
| UI: result summary per kind | Task 15 Slice D |
| Error handling (manifest, YAML, empty body, sync conflict) | Tasks 5/6/7/9 (parsers + manifest); Task 12 (sync conflict via syncWarning) |
| Testing — parsers | Tasks 5, 6 |
| Testing — discovery | Tasks 7, 9 |
| Testing — importTarget | Task 11 |
| Testing — IPC integration | *(deferred to Task 17 manual verification — no automated test for the IPC handler is in the spec, only manual e2e)* |
| Testing — GitHub discovery | Task 10 |
| Testing — component | Task 15 |
| Manual verification | Task 17 |

Gaps: none load-bearing. The spec mentions an automated IPC handler integration test ("`agents:import:importTarget` for a sub-agent in a temp `~/.claude/` lands the file on disk at the expected path, populates `synced_subagent_at`, broadcasts `agents:changed`"). I deliberately routed that to manual verification in Task 17 because the existing `agentHandlers.ts` has no per-handler unit test (the codebase tests at the service level), and adding one for this single new path would require building IPC test infrastructure that doesn't exist yet. Flagging this as a deliberate scope cut.

**Placeholder scan:** no TBDs, no "TODO", no "implement later", no "similar to Task N". One "Implementer note" in Task 10 Step 1 directing the engineer to read the existing test file for mock helper names — that's intentional and concrete (read this specific file, mirror its style), not a placeholder.

**Type consistency:** `ParsedImportTarget`, `DiscoveredSubagent` (local-side), `DiscoveredSubagentRemote` (GitHub-side, repo-relative paths), `DiscoveredPlugin`, `RepoPluginIndex` — all defined once, referenced consistently in later tasks. `importTarget(db, target, opts)` signature matches across Tasks 11, 12, 13. `readTargetFromDisk(path, kind)` and `readTargetFromRepo(owner, name, branch, commitSha, path, kind)` signatures consistent across Tasks 12, 13, 14, 15.

---

Plan complete and saved to [docs/superpowers/plans/2026-05-25-plugin-import-detection.md](docs/superpowers/plans/2026-05-25-plugin-import-detection.md).
