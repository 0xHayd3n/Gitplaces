# Phase 2 — Agent File Format & DB Columns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `agents` table and its read/write pipelines so agent `.md` files can declare any provider/model (e.g. `model: openai/gpt-4o`, `model: openai-compatible:ollama-local/llama3.1:70b`) — while existing Anthropic-style agents continue working unchanged. Sync to `.claude/agents/` is gated so only Anthropic-flavoured agents get written there.

**Architecture:** Two new denormalized DB columns (`model_provider`, `model_endpoint_id`) populated by a new `parseAgentModel` function that delegates the heavy lifting to Phase 1's `parseModelRef`. The existing `model` column widens from a 4-value enum to a free-form string. Frontmatter writer reconstructs Claude-Code-compatible output for Anthropic agents and skips disk sync entirely for non-Anthropic agents. Zero user-visible behaviour change for users who only have Claude agents today.

**Tech Stack:** TypeScript, better-sqlite3, gray-matter, vitest. Reuses `parseModelRef` from `electron/llm/registry.ts` (Phase 1).

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md) — see the **Agent file format** and **Storage schema** sections.

**Branch policy:** Per `~/.claude/CLAUDE.md`, commit directly to `main`. No feature branches. Each task = its own commit.

**Test command:** Always `npm test`, never `npx vitest` (per memory note `feedback_vitest_rebuild`).

---

## File Structure

**Modified files:**

| Path | Change |
|---|---|
| `electron/db.ts` (around line 282, after Phase 25's ALTERs) | Add Phase 27 migration: two new ALTER TABLE statements + (idempotent) backfill |
| `src/types/agent.ts:33` | Widen `model: 'sonnet' \| 'opus' \| 'haiku' \| 'inherit'` → `model: string`; add `model_provider: string` and `model_endpoint_id: string \| null` |
| `electron/services/agentsService.ts:12–19, 183–191` (and the parallel UPDATE site) | Replace `MODEL_VALUES`/`assertValidModel` with a `parseModelRef`-backed validator; thread the two new columns through INSERT + UPDATE + normalize helpers |
| `electron/services/frontmatterFields.ts:9–17` | Add `parseAgentModel(raw)` returning `{ model, provider, endpoint }`. Keep the existing `parseModelFrontmatter` exported for any consumer that only wants the legacy short name |
| `electron/services/pluginImportService.ts:104–138` (parseSubagent) and `ParsedSubagent` type | Call `parseAgentModel`, return the three fields, propagate to import callers |
| `electron/services/agentFileSyncService.ts:47–72` | Update `MODEL_FRONTMATTER` map + `previewSubagentFile` to reconstruct frontmatter from the new fields. Gate disk sync in `syncAgentToDisk` (line 105 area) so non-CLI providers don't write `.claude/agents/*.md` |

**New files:**

| Path | Responsibility |
|---|---|
| `electron/db.phase27-multi-provider-migration.test.ts` | Verify the two new columns exist with correct defaults and the migration is idempotent |
| `electron/services/frontmatterFields.test.ts` | TDD coverage for `parseAgentModel` across legacy/full-id/new-format/inherit inputs |
| `electron/services/__fixtures__/subagents/openai-gpt4o.md` | Test fixture for `model: openai/gpt-4o` |
| `electron/services/__fixtures__/subagents/ollama-local-llama.md` | Test fixture for `model: openai-compatible:ollama-local/llama3.1:70b` |

**Files NOT modified** (intentional — Phase 2 keeps the surface tight):
- `electron/llm/` — the abstraction landed in Phase 1; this phase just uses it
- `src/views/AgentDetail.tsx`, `src/components/AgentOverviewTab.tsx` — the ModelDropdown shows Anthropic options today and continues to. Phase 4 adds non-Anthropic UI; for now non-Anthropic agents render their raw model string in the chip (`agent.model` is widened to `string`)
- `src/components/CreateAgentPanel.tsx` — agents created in-app continue to default to `inherit`/anthropic; non-Anthropic creation is a Phase 4 UI add
- `electron/main.ts` — no IPC change required; existing handlers pass through the new columns once they exist on the type

---

## Task 1: Add `model_provider` + `model_endpoint_id` columns (Phase 27 migration)

**Files:**
- Modify: `electron/db.ts` (after line 287, end of Phase 25 ALTER block)
- Create: `electron/db.phase27-multi-provider-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `electron/db.phase27-multi-provider-migration.test.ts`:

```ts
// electron/db.phase27-multi-provider-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('Phase 27 migration — multi-provider model columns', () => {
  it('adds model_provider column to agents with default "anthropic"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string; dflt_value: string | null; notnull: number }[]
    const col = cols.find(c => c.name === 'model_provider')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(1)
    // SQLite stores text defaults as quoted strings — normalize for the check
    expect(col?.dflt_value?.replace(/^'|'$/g, '')).toBe('anthropic')
  })

  it('adds model_endpoint_id column to agents as nullable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string; notnull: number }[]
    const col = cols.find(c => c.name === 'model_endpoint_id')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(0)
  })

  it('backfills existing rows with model_provider="anthropic"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`
      INSERT INTO agents (id, name, handle, folder_id, created_at, updated_at, description, model)
      VALUES ('a1', 'Test', 'test', NULL, 't', 't', '', 'sonnet')
    `).run()
    const row = db.prepare(`SELECT model_provider, model_endpoint_id FROM agents WHERE id='a1'`).get() as { model_provider: string; model_endpoint_id: string | null }
    expect(row.model_provider).toBe('anthropic')
    expect(row.model_endpoint_id).toBeNull()
  })

  it('is idempotent — running getDb twice does not error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    getDb(dir)
    expect(() => getDb(dir)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/db.phase27-multi-provider-migration.test.ts
```

Expected: `model_provider` and `model_endpoint_id` columns do not exist → tests fail with `col` being `undefined`.

- [ ] **Step 3: Add the migration to `electron/db.ts`**

Open `electron/db.ts`. After line 287 (the last Phase 25 ALTER), and before the existing Phase 20 `CREATE TABLE ai_chats` block at line 290, insert:

```ts
  // Phase 27 — Multi-provider agent support (see docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md)
  try { db.exec(`ALTER TABLE agents ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'anthropic'`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN model_endpoint_id TEXT`) } catch {}
```

The `DEFAULT 'anthropic'` clause backfills existing rows automatically on column add. The `try/catch` matches the existing migration pattern at lines 281–287 (idempotent — running on a DB that already has these columns is a no-op).

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/db.phase27-multi-provider-migration.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Confirm no other DB tests regressed**

```bash
npm test -- electron/db.
```

Expected: every other `electron/db.*.test.ts` continues to pass.

- [ ] **Step 6: Commit**

```bash
git add electron/db.ts electron/db.phase27-multi-provider-migration.test.ts
git commit -m "feat(db): phase 27 — add model_provider + model_endpoint_id to agents"
```

---

## Task 2: Widen `AgentRow.model` + add two new fields + update all row-literal fixtures

**Files:**
- Modify: `src/types/agent.ts:31–38`
- Modify (test fixtures, each gets `model_provider: 'anthropic', model_endpoint_id: null` added to existing `AgentRow` literals):
  - `src/views/AgentsLanding.test.tsx:29`
  - `src/views/AgentDetail.test.tsx:31` and `:250`
  - `src/components/AgentOverviewTab.test.tsx:14`
  - `src/components/AgentFilesTab.test.tsx:27`
  - `src/components/CreateAgentPanel.test.tsx:36`
  - `src/components/AgentsSidebar.test.tsx:19, :27, :35`

No new tests for this task — pure type/fixture widening; behaviour is exercised by later tasks. Verification is `npx tsc --noEmit` + `npm test` both clean.

- [ ] **Step 1: Update `src/types/agent.ts`**

Find lines 31–38 (the `// Skill parity (Phase 2)` block ending at `synced_slash_command_at`). Replace:

```ts
  // Skill parity (Phase 2)
  tools: string | null             // JSON-serialized string[]; NULL = inherit all
  model: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  is_subagent: 0 | 1
  is_slash_command: 0 | 1
  argument_hint: string | null
  synced_subagent_at: string | null
  synced_slash_command_at: string | null
```

With:

```ts
  // Skill parity (Phase 2)
  tools: string | null             // JSON-serialized string[]; NULL = inherit all
  /**
   * Raw `model:` string from frontmatter. Phase 2 widened this from the
   * legacy 4-value enum ('sonnet'|'opus'|'haiku'|'inherit') to free-form
   * string so non-Anthropic models can be stored verbatim:
   *   - Legacy short names: 'sonnet', 'opus', 'haiku', 'inherit'
   *   - Full Anthropic IDs: 'claude-sonnet-4-6'
   *   - Multi-provider form: 'openai/gpt-4o', 'openai-compatible:ollama-local/llama3.1:70b'
   * Always paired with the denormalized `model_provider` + `model_endpoint_id`
   * columns; consumers that need structured data should read those.
   */
  model: string
  /** Denormalized from `model`. Defaults to 'anthropic'. One of the 5 ProviderId values. */
  model_provider: string
  /** Denormalized from `model`. Only set when provider === 'openai-compatible'. */
  model_endpoint_id: string | null
  is_subagent: 0 | 1
  is_slash_command: 0 | 1
  argument_hint: string | null
  synced_subagent_at: string | null
  synced_slash_command_at: string | null
```

- [ ] **Step 2: Find the broken fixtures**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: type errors at every place an `AgentRow` literal is built — the new required `model_provider` field is missing from each. Capture the file:line list from the output; it should match the "Files" list above (~9 locations).

- [ ] **Step 3: Update each fixture**

For each `AgentRow` literal flagged by the typecheck, add `model_provider: 'anthropic'` and `model_endpoint_id: null` next to the existing `model:` field. Example — `src/views/AgentDetail.test.tsx` around line 31:

```ts
// BEFORE:
const fakeAgent: AgentRow = {
  // ... other fields ...
  model: 'inherit',
  is_subagent: 0,
  // ...
}

// AFTER:
const fakeAgent: AgentRow = {
  // ... other fields ...
  model: 'inherit',
  model_provider: 'anthropic',
  model_endpoint_id: null,
  is_subagent: 0,
  // ...
}
```

Apply this same diff (just the two new lines added after `model:`) to every flagged fixture. The values are always `'anthropic'` + `null` because every existing literal targets a Claude model.

- [ ] **Step 4: Re-run typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: **zero errors**.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pre-existing tests still pass (no behaviour change — just literal field additions).

- [ ] **Step 6: Commit**

```bash
git add src/types/agent.ts src/views/AgentsLanding.test.tsx src/views/AgentDetail.test.tsx src/components/AgentOverviewTab.test.tsx src/components/AgentFilesTab.test.tsx src/components/CreateAgentPanel.test.tsx src/components/AgentsSidebar.test.tsx
git commit -m "refactor(types): widen AgentRow.model + add model_provider/model_endpoint_id"
```

(Adjust the staged file list if the typecheck flagged additional fixtures the plan didn't anticipate.)

---

## Task 3: Add `parseAgentModel` and update `parseModelFrontmatter` (TDD)

**Files:**
- Create: `electron/services/frontmatterFields.test.ts`
- Modify: `electron/services/frontmatterFields.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/services/frontmatterFields.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseAgentModel, parseModelFrontmatter } from './frontmatterFields'

describe('parseAgentModel', () => {
  it('parses legacy short names as anthropic', () => {
    expect(parseAgentModel('sonnet')).toEqual({ model: 'sonnet', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('opus')).toEqual({ model: 'opus', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('haiku')).toEqual({ model: 'haiku', provider: 'anthropic', endpoint: null })
  })

  it('parses "inherit" as anthropic with model="inherit"', () => {
    expect(parseAgentModel('inherit')).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
  })

  it('preserves full Anthropic IDs as anthropic', () => {
    expect(parseAgentModel('claude-sonnet-4-6')).toEqual({ model: 'claude-sonnet-4-6', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('claude-opus-4-7')).toEqual({ model: 'claude-opus-4-7', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('claude-haiku-4-5-20251001')).toEqual({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic', endpoint: null })
  })

  it('parses explicit provider/model form', () => {
    expect(parseAgentModel('openai/gpt-4o')).toEqual({ model: 'openai/gpt-4o', provider: 'openai', endpoint: null })
    expect(parseAgentModel('google/gemini-2.5-pro')).toEqual({ model: 'google/gemini-2.5-pro', provider: 'google', endpoint: null })
    expect(parseAgentModel('opencode/claude-sonnet-4-6')).toEqual({ model: 'opencode/claude-sonnet-4-6', provider: 'opencode', endpoint: null })
  })

  it('parses openai-compatible with endpoint', () => {
    expect(parseAgentModel('openai-compatible:ollama-local/llama3.1:70b')).toEqual({
      model: 'openai-compatible:ollama-local/llama3.1:70b',
      provider: 'openai-compatible',
      endpoint: 'ollama-local',
    })
  })

  it('parses openai-compatible without endpoint', () => {
    expect(parseAgentModel('openai-compatible/llama3.1:70b')).toEqual({
      model: 'openai-compatible/llama3.1:70b',
      provider: 'openai-compatible',
      endpoint: null,
    })
  })

  it('falls back to inherit + warning for unknown values', () => {
    // Mirrors the existing parseModelFrontmatter behavior: bad input → inherit, log warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAgentModel('bogus-not-a-model')).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back to inherit + warning for non-string input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAgentModel(undefined)).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel(42)).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    warn.mockRestore()
  })
})

describe('parseModelFrontmatter (legacy, still exported)', () => {
  it('keeps returning the 4-value short for back-compat consumers', () => {
    expect(parseModelFrontmatter('sonnet')).toBe('sonnet')
    expect(parseModelFrontmatter('claude-sonnet-4-6')).toBe('sonnet')
    expect(parseModelFrontmatter('inherit')).toBe('inherit')
    expect(parseModelFrontmatter('openai/gpt-4o')).toBe('inherit') // non-anthropic falls back to inherit
  })
})

// vi import needs to be at the top:
import { vi } from 'vitest'
```

(Move the `import { vi } from 'vitest'` line to the top of the file; it's listed at the bottom of the snippet only for visual grouping.)

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/services/frontmatterFields.test.ts
```

Expected: `parseAgentModel` is not exported → import fails.

- [ ] **Step 3: Update `electron/services/frontmatterFields.ts`**

Replace the entire file content with:

```ts
import { parseModelRef } from '../llm/registry'
import type { ProviderId } from '../llm/types'

export type ImportedModel = 'sonnet' | 'opus' | 'haiku' | 'inherit'

const FULL_TO_SHORT_MODEL: Record<string, ImportedModel> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-7': 'opus',
  'claude-haiku-4-5-20251001': 'haiku',
}

/**
 * LEGACY — Phase 1 short-name parser. Kept for back-compat with consumers
 * that only want the 4-value enum (e.g. UI chip rendering before the
 * Phase 4 multi-provider UI lands). For Phase 2+ persistence,
 * use {@link parseAgentModel} which returns structured provider data.
 */
export function parseModelFrontmatter(raw: unknown): ImportedModel {
  if (typeof raw !== 'string') return 'inherit'
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') return raw
  const mapped = FULL_TO_SHORT_MODEL[raw]
  if (mapped) return mapped
  // Non-anthropic provider strings (openai/gpt-4o, etc.) return 'inherit' here
  // — they're handled by parseAgentModel for proper storage.
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] parseModelFrontmatter: unknown model "${raw}", falling back to 'inherit'.`)
  return 'inherit'
}

export type ParsedAgentModel = {
  /** The model string as it should be stored in `agents.model` (raw, lossless). */
  model: string
  /** Denormalized provider id for `agents.model_provider`. */
  provider: ProviderId
  /** Denormalized endpoint id for `agents.model_endpoint_id` (only for openai-compatible). */
  endpoint: string | null
}

/**
 * Parse a frontmatter `model:` field into the three columns the Phase 2
 * agents schema stores. Accepts:
 *   - Legacy short names: 'sonnet' | 'opus' | 'haiku' | 'inherit' (kept verbatim in `model`)
 *   - Full Anthropic IDs: 'claude-sonnet-4-6' (kept verbatim; provider=anthropic)
 *   - New format: '<provider>/<model>' or 'openai-compatible:<endpoint>/<model>'
 *     (kept verbatim in `model`; provider/endpoint denormalized via parseModelRef)
 *
 * Unknown/malformed input falls back to `{ model: 'inherit', provider: 'anthropic', endpoint: null }`
 * with a console.warn, matching the safe-by-default behaviour of the legacy parser.
 */
export function parseAgentModel(raw: unknown): ParsedAgentModel {
  if (typeof raw !== 'string') {
    // eslint-disable-next-line no-console
    console.warn(`[frontmatterFields] parseAgentModel: non-string input ${typeof raw}, falling back to inherit.`)
    return { model: 'inherit', provider: 'anthropic', endpoint: null }
  }

  // Legacy short names + 'inherit' → keep verbatim, provider is implicitly anthropic.
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') {
    return { model: raw, provider: 'anthropic', endpoint: null }
  }

  // Full Anthropic IDs → keep verbatim, provider is anthropic.
  if (FULL_TO_SHORT_MODEL[raw]) {
    return { model: raw, provider: 'anthropic', endpoint: null }
  }

  // New format — delegate parsing to parseModelRef. The raw string is stored
  // verbatim in `model`; provider/endpoint come from the parsed ref.
  try {
    const ref = parseModelRef(raw)
    return {
      model: raw,
      provider: ref.provider,
      endpoint: ref.endpoint ?? null,
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[frontmatterFields] parseAgentModel: invalid model "${raw}" (${(err as Error).message}), falling back to inherit.`)
    return { model: 'inherit', provider: 'anthropic', endpoint: null }
  }
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

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/services/frontmatterFields.test.ts
```

Expected: all 9 tests pass (8 `parseAgentModel` `it()` blocks + 1 `parseModelFrontmatter` block).

- [ ] **Step 5: Commit**

```bash
git add electron/services/frontmatterFields.ts electron/services/frontmatterFields.test.ts
git commit -m "feat(frontmatter): parseAgentModel returns structured provider data"
```

---

## Task 4: Thread `model_provider` + `model_endpoint_id` through `agentsService.ts`

**Files:**
- Modify: `electron/services/agentsService.ts:12–19` (validator), and the INSERT/UPDATE/normalize sites
- Modify: `electron/services/agentsService.test.ts` (existing test file — add new cases)

This task is the most touchy: the agents service is the central CRUD layer, and many tests/callers thread `model` through it. Work carefully.

- [ ] **Step 1: Read the current shape of `agentsService.ts`**

`Read electron/services/agentsService.ts` end-to-end before editing. Note every reference to `model`, `MODEL_VALUES`, `assertValidModel`, and `AgentModel`. There are at least:
- Line 12: `MODEL_VALUES`
- Line 13: `AgentModel` type alias
- Line 15–19: `assertValidModel`
- Line 183–191: the agents INSERT
- A parallel UPDATE statement further down in the file (find by `UPDATE agents SET`)
- A `createAgent` / `updateAgent` function that defaults the model

Take a minute to map them all before editing.

- [ ] **Step 2: Write the failing test**

Add to `electron/services/agentsService.test.ts` (do NOT replace the file — append to the existing describe block). Find the existing describe block for agents creation and add these tests inside it:

```ts
// (inside the existing describe block for agent creation/CRUD)

it('createAgent stores model_provider=anthropic and model_endpoint_id=null for legacy short names', () => {
  const db = freshDb()
  const folder = createFolder(db, 'F')
  const agent = createAgent(db, {
    name: 'Test',
    handle: 'test-1',
    folderId: folder.id,
    colorStart: '#000000',
    colorEnd: null,
    emoji: null,
    description: '',
    body: '',
    tools: null,
    model: 'sonnet',
    isSubagent: 0,
    isSlashCommand: 0,
    argumentHint: null,
  })
  expect(agent.model).toBe('sonnet')
  expect(agent.model_provider).toBe('anthropic')
  expect(agent.model_endpoint_id).toBeNull()
})

it('createAgent stores model_provider=openai for an openai/gpt-4o model', () => {
  const db = freshDb()
  const folder = createFolder(db, 'F')
  const agent = createAgent(db, {
    name: 'Test',
    handle: 'test-2',
    folderId: folder.id,
    colorStart: '#000000',
    colorEnd: null,
    emoji: null,
    description: '',
    body: '',
    tools: null,
    model: 'openai/gpt-4o',
    isSubagent: 0,
    isSlashCommand: 0,
    argumentHint: null,
  })
  expect(agent.model).toBe('openai/gpt-4o')
  expect(agent.model_provider).toBe('openai')
  expect(agent.model_endpoint_id).toBeNull()
})

it('createAgent captures the endpoint for an openai-compatible model', () => {
  const db = freshDb()
  const folder = createFolder(db, 'F')
  const agent = createAgent(db, {
    name: 'Test',
    handle: 'test-3',
    folderId: folder.id,
    colorStart: '#000000',
    colorEnd: null,
    emoji: null,
    description: '',
    body: '',
    tools: null,
    model: 'openai-compatible:ollama-local/llama3.1:70b',
    isSubagent: 0,
    isSlashCommand: 0,
    argumentHint: null,
  })
  expect(agent.model).toBe('openai-compatible:ollama-local/llama3.1:70b')
  expect(agent.model_provider).toBe('openai-compatible')
  expect(agent.model_endpoint_id).toBe('ollama-local')
})

it('updateAgent re-derives model_provider when model changes from sonnet to openai/gpt-4o', () => {
  const db = freshDb()
  const folder = createFolder(db, 'F')
  const agent = createAgent(db, {
    name: 'Test',
    handle: 'test-4',
    folderId: folder.id,
    colorStart: '#000000',
    colorEnd: null,
    emoji: null,
    description: '',
    body: '',
    tools: null,
    model: 'sonnet',
    isSubagent: 0,
    isSlashCommand: 0,
    argumentHint: null,
  })
  const updated = updateAgent(db, agent.id, { model: 'openai/gpt-4o' })
  expect(updated.model).toBe('openai/gpt-4o')
  expect(updated.model_provider).toBe('openai')
})

it('rejects an unparseable model string', () => {
  const db = freshDb()
  const folder = createFolder(db, 'F')
  expect(() => createAgent(db, {
    name: 'Test',
    handle: 'test-5',
    folderId: folder.id,
    colorStart: '#000000',
    colorEnd: null,
    emoji: null,
    description: '',
    body: '',
    tools: null,
    model: 'mystery-provider/with-bad/format',
    isSubagent: 0,
    isSlashCommand: 0,
    argumentHint: null,
  })).toThrow(/invalid model/i)
})
```

(If `agentsService.test.ts` doesn't already define a `freshDb()` helper, copy the pattern from `electron/db.agents-migration.test.ts` lines 10–11: `const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-')); const db = getDb(dir)` — wrap in a local helper at the top of the test file.)

- [ ] **Step 3: Run test, verify failure**

```bash
npm test -- electron/services/agentsService.test.ts
```

Expected: the new tests fail because (a) the INSERT doesn't populate the two new columns and (b) `createAgent` ignores the new fields when constructing the row.

- [ ] **Step 4: Update `electron/services/agentsService.ts`**

Make three coordinated changes.

**Change A — Replace `MODEL_VALUES` / `AgentModel` / `assertValidModel` (lines 12–19) and add a `parseAgentModel` import at the top:**

Add to the imports block at the top of the file (alongside the existing `import` statements):

```ts
import { parseAgentModel } from './frontmatterFields'
```

Then replace the 8 lines at 12–19 (the legacy `MODEL_VALUES` / `AgentModel` / `assertValidModel`) with:

```ts
/**
 * Validate a model string by attempting to parse it. Throws if the string
 * is non-parseable; on success, returns the structured form (caller can
 * destructure into the three DB columns).
 *
 * Phase 2: replaces the legacy `assertValidModel` (which only accepted the
 * 4-value short-name enum) with a parser-backed validator that accepts the
 * full multi-provider grammar from `parseModelRef`.
 */
export function parseAndValidateModel(value: unknown): ReturnType<typeof parseAgentModel> {
  if (typeof value !== 'string') {
    throw new Error(`Invalid model: expected string, got ${typeof value}`)
  }
  const parsed = parseAgentModel(value)
  // parseAgentModel falls back to inherit + warning for unknown — that's the
  // right default for frontmatter from external files but NOT for user input.
  // If the input wasn't recognized AND didn't legitimately mean inherit,
  // reject it here.
  if (parsed.model === 'inherit' && value !== 'inherit') {
    throw new Error(`Invalid model: ${JSON.stringify(value)} is not a recognized model reference`)
  }
  return parsed
}
```

(Keep the existing `assertValidTools` and `assertValidHandle` below — only replace the model-related lines. Before deleting `MODEL_VALUES` / `AgentModel`, run `grep -r 'MODEL_VALUES\|AgentModel[^a-zA-Z]' electron/ src/` to confirm no consumers exist outside `agentsService.ts` and its test. If any do, fix them in the same commit — they shouldn't, given the audit in Step 1.)

**Change B — Find every call site that previously called `assertValidModel(input.model)` and replace with the parse+destructure pattern.** The pattern at the create site (in `createAgent`):

```ts
// OLD:
assertValidModel(input.model)
const model = input.model

// NEW:
const parsed = parseAndValidateModel(input.model)
const model = parsed.model
const modelProvider = parsed.provider
const modelEndpointId = parsed.endpoint
```

Then add `modelProvider` and `modelEndpointId` to the INSERT.

**Change C — Update the INSERT (line 183–191):**

Old:
```ts
INSERT INTO agents (
  id, name, handle, folder_id, color_start, color_end, emoji, description,
  tools, model, is_subagent, is_slash_command, argument_hint,
  created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

New:
```ts
INSERT INTO agents (
  id, name, handle, folder_id, color_start, color_end, emoji, description,
  tools, model, model_provider, model_endpoint_id,
  is_subagent, is_slash_command, argument_hint,
  created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And update the `.run()` arguments to pass `modelProvider` and `modelEndpointId` in the same positions.

**Change D — Update the parallel `updateAgent` UPDATE statement.** Find it (search for `UPDATE agents SET`). Whenever `model = ?` appears in the SET list, ensure that when the caller passes `model`, the function ALSO re-derives `model_provider` and `model_endpoint_id` using `parseAndValidateModel`, and updates all three columns together. The cleanest pattern:

```ts
// In updateAgent, near the top:
let modelProvider: string | undefined
let modelEndpointId: string | null | undefined
if (patch.model !== undefined) {
  const parsed = parseAndValidateModel(patch.model)
  patch.model = parsed.model
  modelProvider = parsed.provider
  modelEndpointId = parsed.endpoint
}

// ... then in the SET-clause builder, when adding 'model = ?', also add:
if (modelProvider !== undefined) {
  setClauses.push('model_provider = ?')
  values.push(modelProvider)
  setClauses.push('model_endpoint_id = ?')
  values.push(modelEndpointId)
}
```

(The exact shape depends on how `updateAgent` is structured today — read it before editing. The principle is "if model changes, the two denormalized columns change with it".)

**Change E — Update the `getAgent` SELECT / row mapping.** Find the SELECT statement that materializes an `AgentRow`. Add `model_provider` and `model_endpoint_id` to the projected columns (or confirm `SELECT *` is in use, in which case nothing to change).

- [ ] **Step 5: Run test, verify pass**

```bash
npm test -- electron/services/agentsService.test.ts
```

Expected: all pre-existing tests + the 5 new tests pass. If the existing tests fail because `model_provider`/`model_endpoint_id` are missing from a row literal in the test, update those literals to include the two new fields (default `'anthropic'` and `null`).

- [ ] **Step 6: Confirm typecheck is clean**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. Cascading errors from Task 2's widening should now be resolved (every row built from the DB will include the new columns).

- [ ] **Step 7: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): persist model_provider + model_endpoint_id, validate via parseAgentModel"
```

---

## Task 5: Wire `parseAgentModel` into `parseSubagent` (sync IN)

**Files:**
- Modify: `electron/services/pluginImportService.ts:114, 125–138` (the `parseSubagent` function and `ParsedSubagent` return type)
- Modify: `electron/services/pluginImportService.test.ts` — extend if there's a subagent parsing test

- [ ] **Step 1: Find the `ParsedSubagent` type definition**

In `electron/services/pluginImportService.ts`, locate the `ParsedSubagent` type (it's near `parseSubagent` at line 104, likely above it). Read its current shape.

- [ ] **Step 2: Update the type**

Replace the `model: ImportedModel` field on `ParsedSubagent` with:

```ts
model: string                       // raw model string from frontmatter (lossless)
modelProvider: string               // denormalized via parseAgentModel
modelEndpointId: string | null      // denormalized via parseAgentModel (null unless openai-compatible)
```

(Remove the `ImportedModel` import from this file if it's no longer used after Step 3.)

- [ ] **Step 3: Update `parseSubagent`**

Find line 114 in the current file:

```ts
const model = parseModelFrontmatter(data.model)
```

Replace with:

```ts
const parsedModel = parseAgentModel(data.model)
```

Find the return statement (lines 125–138). Replace:

```ts
return {
  kind: 'subagent',
  name,
  handle: slugifyName(name),
  description,
  body: parsed.content.trim(),
  files: [] as never[],
  origin: null,
  model,
  tools,
  argumentHint: null,
  color,
}
```

With:

```ts
return {
  kind: 'subagent',
  name,
  handle: slugifyName(name),
  description,
  body: parsed.content.trim(),
  files: [] as never[],
  origin: null,
  model: parsedModel.model,
  modelProvider: parsedModel.provider,
  modelEndpointId: parsedModel.endpoint,
  tools,
  argumentHint: null,
  color,
}
```

Update the import at the top of the file:

```ts
// Replace this:
import { parseModelFrontmatter, parseToolsFrontmatter, parseArgumentHint } from './frontmatterFields'

// With this:
import { parseAgentModel, parseToolsFrontmatter, parseArgumentHint } from './frontmatterFields'
```

- [ ] **Step 4: Find every consumer of `ParsedSubagent.model`**

Grep for `parsedSubagent.model` / `subagent.model` / `.model` in callers (likely `electron/ipc/agentHandlers.ts` and similar). Each consumer that previously read `parsedSubagent.model` and passed it to `createAgent({ model })` is now also responsible for passing the structured data through — but since Task 4's `createAgent` re-parses internally, callers can just pass `parsedSubagent.model` as before; the new columns will be derived.

**So the only Step-4 work is**: confirm callers don't break. Run:

```bash
npm test -- electron/services/pluginImportService.test.ts electron/ipc/agentHandlers.test.ts
```

Expected: pass. If any caller test explicitly inspected `parsedSubagent.model` as an enum value (e.g. `expect(result.model).toBe('sonnet')`), it should continue to work because the raw frontmatter string for legacy agents is still `'sonnet'`.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (except the pre-existing failures unrelated to this work — `vendor/anatomy/anatomy-cli`, `ImportPluginDialog`, `ReadmeRenderer`).

- [ ] **Step 6: Commit**

```bash
git add electron/services/pluginImportService.ts
git commit -m "feat(import): parseSubagent returns model_provider + model_endpoint_id"
```

---

## Task 6: Update sync OUT (`previewSubagentFile`) + gate non-Anthropic sync + add fixtures

**Files:**
- Modify: `electron/services/agentFileSyncService.ts:47–72` (MODEL_FRONTMATTER and previewSubagentFile)
- Modify: `electron/services/agentFileSyncService.ts:105–135` area (the `syncAgentToDisk` function and `syncOneSurface` helper) for the gating logic
- Modify: `electron/services/agentFileSyncService.test.ts` — add new test cases
- Create: `electron/services/__fixtures__/subagents/openai-gpt4o.md`
- Create: `electron/services/__fixtures__/subagents/ollama-local-llama.md`

- [ ] **Step 1: Create the new test fixtures**

Create `electron/services/__fixtures__/subagents/openai-gpt4o.md`:

```yaml
---
name: openai-researcher
description: Researches topics using GPT-4o.
tools: search_skills, get_skill
model: openai/gpt-4o
---

You are a research agent powered by OpenAI's GPT-4o.
```

Create `electron/services/__fixtures__/subagents/ollama-local-llama.md`:

```yaml
---
name: local-llama-agent
description: Runs locally against Ollama.
model: openai-compatible:ollama-local/llama3.1:70b
---

You are a local agent running on a Llama 3.1 70B model via Ollama.
```

- [ ] **Step 2: Write the failing tests**

Append to `electron/services/agentFileSyncService.test.ts` (do not replace — add to the appropriate describe block):

```ts
// (inside the existing describe block for previewSubagentFile)

it('strips the anthropic/ provider prefix when writing Claude Code frontmatter', () => {
  const agent: AgentRow = makeAgent({
    handle: 'test-1',
    model: 'anthropic/claude-sonnet-4-6',
    model_provider: 'anthropic',
    model_endpoint_id: null,
  })
  const out = previewSubagentFile(agent, 'Body content.')
  // Frontmatter should contain `model: claude-sonnet-4-6` — prefix stripped.
  expect(out).toMatch(/^model: claude-sonnet-4-6$/m)
  expect(out).not.toMatch(/anthropic\//)
})

it('writes legacy short names (sonnet/opus/haiku) verbatim, expanded to full Anthropic IDs', () => {
  const agent: AgentRow = makeAgent({
    handle: 'test-2',
    model: 'sonnet',
    model_provider: 'anthropic',
    model_endpoint_id: null,
  })
  const out = previewSubagentFile(agent, 'Body.')
  expect(out).toMatch(/^model: claude-sonnet-4-6$/m)
})

it('omits the model frontmatter line for `inherit`', () => {
  const agent: AgentRow = makeAgent({
    handle: 'test-3',
    model: 'inherit',
    model_provider: 'anthropic',
    model_endpoint_id: null,
  })
  const out = previewSubagentFile(agent, 'Body.')
  expect(out).not.toMatch(/^model:/m)
})

// (inside the existing describe block for syncAgentToDisk)

it('does NOT sync non-Anthropic agents to .claude/agents/', async () => {
  // Even with is_subagent=1, an openai agent must skip the .claude/agents/ write.
  const agent: AgentRow = makeAgent({
    handle: 'openai-agent',
    model: 'openai/gpt-4o',
    model_provider: 'openai',
    model_endpoint_id: null,
    is_subagent: 1,
  })
  const result = await syncAgentToDisk(agent, 'Body.', {})
  expect(result.subagent.status).toBe('skipped')
})

it('syncs anthropic agents normally', async () => {
  const agent: AgentRow = makeAgent({
    handle: 'anthropic-agent',
    model: 'sonnet',
    model_provider: 'anthropic',
    model_endpoint_id: null,
    is_subagent: 1,
  })
  const result = await syncAgentToDisk(agent, 'Body.', {})
  expect(result.subagent.status).toBe('written')
})
```

(If `makeAgent` doesn't exist as a helper in this test file, add one at the top:

```ts
function makeAgent(overrides: Partial<AgentRow>): AgentRow {
  return {
    id: 'a-test',
    name: 'Test',
    handle: 'test',
    folder_id: null,
    color_start: '#000000',
    color_end: null,
    emoji: null,
    pinned: 0,
    pinned_at: null,
    last_used_at: null,
    presets_json: '[]',
    created_at: 't',
    updated_at: 't',
    description: '',
    origin_plugin: null,
    origin_path: null,
    origin_version: null,
    origin_imported_at: null,
    tools: null,
    model: 'inherit',
    model_provider: 'anthropic',
    model_endpoint_id: null,
    is_subagent: 0,
    is_slash_command: 0,
    argument_hint: null,
    synced_subagent_at: null,
    synced_slash_command_at: null,
    ...overrides,
  }
}
```

If a similar factory exists in `electron/services/agentsService.test.ts` or another test file, prefer reusing or relocating it to a shared `__fixtures__/agentFactory.ts` rather than duplicating.)

- [ ] **Step 3: Run tests, verify failure**

```bash
npm test -- electron/services/agentFileSyncService.test.ts
```

Expected: new tests fail because (a) the writer doesn't strip `anthropic/` prefix and (b) `syncAgentToDisk` doesn't gate by provider.

- [ ] **Step 4: Update `previewSubagentFile` and `MODEL_FRONTMATTER`**

In `electron/services/agentFileSyncService.ts`, replace the `MODEL_FRONTMATTER` constant (lines 47–51) with a helper function and update `previewSubagentFile` (lines 59–72):

```ts
// ── Frontmatter generation ──────────────────────────────────────────

const LEGACY_SHORT_TO_FULL: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5-20251001',
}

/**
 * Convert an agent's stored model string into the form Claude Code expects in
 * `.claude/agents/*.md` frontmatter:
 *   - 'inherit' → returns null (caller omits the field entirely)
 *   - 'sonnet'/'opus'/'haiku' → expanded to full Anthropic ID
 *   - 'anthropic/claude-sonnet-4-6' → stripped to 'claude-sonnet-4-6'
 *   - 'claude-sonnet-4-6' → returned as-is (already canonical)
 */
function modelForClaudeFrontmatter(model: string): string | null {
  if (model === 'inherit') return null
  if (LEGACY_SHORT_TO_FULL[model]) return LEGACY_SHORT_TO_FULL[model]
  if (model.startsWith('anthropic/')) return model.slice('anthropic/'.length)
  return model
}

function resolvedDescription(agent: AgentRow, primaryContent: string): string {
  const explicit = agent.description?.trim()
  if (explicit) return explicit
  return deriveDescription(primaryContent)
}

export function previewSubagentFile(agent: AgentRow, primaryContent: string): string {
  const data: Record<string, unknown> = {
    name: agent.handle,
    description: resolvedDescription(agent, primaryContent),
  }
  const tools = parseAgentTools(agent.tools)
  if (tools !== null) {
    data.tools = tools.join(', ')
  }
  const claudeModel = modelForClaudeFrontmatter(agent.model)
  if (claudeModel !== null) {
    data.model = claudeModel
  }
  return matter.stringify(primaryContent, data)
}
```

(`MODEL_FRONTMATTER` becomes private — `LEGACY_SHORT_TO_FULL` replaces it inside `modelForClaudeFrontmatter`. If any other module imports `MODEL_FRONTMATTER`, grep for that first and decide whether to keep it exported as an alias.)

- [ ] **Step 5: Gate `syncAgentToDisk` by provider**

Update the `syncAgentToDisk` function (line 105 area). Find the two `syncOneSurface` calls inside `Promise.all(...)`. The first call (subagent) needs a provider gate:

```ts
// OLD (existing):
syncOneSurface({
  enabled: agent.is_subagent === 1,
  // ...
}),

// NEW:
syncOneSurface({
  // Only Anthropic agents sync to .claude/agents/. Other providers
  // (openai, google, opencode, openai-compatible) either have no CLI
  // runtime (openai/google/openai-compatible) or have their own sync
  // target landing in Phase 6 (opencode → .opencode/agents/).
  enabled: agent.is_subagent === 1 && agent.model_provider === 'anthropic',
  // ...
}),
```

The slash-command sync stays unchanged (slash commands are a Claude Code concept and don't apply to non-Claude agents at all — gating by provider here is also valid, but optional for Phase 2).

- [ ] **Step 6: Run tests, verify pass**

```bash
npm test -- electron/services/agentFileSyncService.test.ts
```

Expected: all tests pass (the 5 new + every pre-existing test).

- [ ] **Step 7: Full sweep**

```bash
npm test
```

Expected: all tests pass except the pre-existing unrelated failures.

- [ ] **Step 8: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts electron/services/__fixtures__/subagents/openai-gpt4o.md electron/services/__fixtures__/subagents/ollama-local-llama.md
git commit -m "feat(agents): gate sync by provider + strip anthropic/ prefix in frontmatter"
```

---

## Phase 2 done — verification checklist

After Task 6:

- [ ] `npm test` passes end-to-end (pre-existing unrelated failures noted as such)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline 19be47c..HEAD` shows six new commits in this phase
- [ ] Manual smoke test:
  - Launch the app (`npm run dev`)
  - Import an existing agent file from a plugin or GitHub — it still works, `agent.model` retains the same value, `agent.model_provider === 'anthropic'`
  - Create a new agent in the UI with model = 'sonnet' — sync to disk produces the same `.claude/agents/<handle>.md` as before
  - Inspect the DB (via SQLite browser or `electron/db.ts` queries) and confirm `model_provider`/`model_endpoint_id` columns exist with sensible values

Phase 2 ships **zero user-visible behaviour change for Claude users**. The agent type/storage now CAN hold non-Anthropic models, and non-Anthropic agents WILL be excluded from `.claude/agents/` sync, but no UI exists yet to create one (that's Phase 4). The fixture files prove the parser handles new format end-to-end.

## Out of scope (deferred to later phases)

- Settings UI for selecting non-Anthropic models when creating/editing agents → Phase 4
- OpenCode `.opencode/agents/` sync target → Phase 6
- The in-app runner that actually executes non-Anthropic agents → Phase 5
- Migration of existing `model` short names to canonical form (e.g. backfilling `'sonnet'` → `'claude-sonnet-4-6'`) — not needed; both forms remain valid forever
