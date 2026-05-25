# Skill Parity Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend each agent with `tools` / `model` / `is_subagent` / `is_slash_command` / `argument_hint` columns, sync enabled agents to `~/.claude/agents/<handle>.md` and `~/.claude/commands/<handle>.md`, and round-trip those fields on import.

**Architecture:** Schema adds 7 columns to `agents`. A new pure-DB validation layer in `agentsService.ts` handles the 5 new public fields plus an internal `setSyncedAt` helper. A separate `agentFileSyncService.ts` module owns all filesystem writes — pure functions for path resolution and frontmatter generation, plus a `syncAgentToDisk` function called by every mutating IPC handler. The Settings tab in `AgentDetail.tsx` gains four new groups: Model dropdown, Tools picker, two Surface toggles (with a conflict dialog on first ON), and an Argument-hint input. Import roundtrip in `skillImportService.ts` picks up `model`, `tools`, and `argument-hint` from frontmatter.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3, Vitest + @testing-library/react, gray-matter (already a dep), Node `fs/promises` + `os.homedir()`.

**Spec:** [docs/superpowers/specs/2026-05-25-skill-parity-phase2-design.md](../specs/2026-05-25-skill-parity-phase2-design.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/db.ts` | Modify | Add Phase 25 migration block — 7 `ALTER TABLE` lines. |
| `src/types/agent.ts` | Modify | Extend `AgentRow` with 7 new fields; add `parseAgentTools` / `serializeAgentTools` helpers. |
| `electron/services/agentsService.ts` | Modify | Extend `CreateAgentInput`, `UpdateAgentPatch`, INSERT, patch builder. Add `MODEL_VALUES`, `assertValidTools`, `assertValidModel`, `setSyncedAt`. |
| `electron/services/agentsService.test.ts` | Modify | Tests for the new fields + setSyncedAt + validation. |
| `electron/services/agentFileSyncService.ts` | Create | `syncAgentToDisk`, `checkConflict`, `previewSubagentFile`, `previewSlashCommandFile`, `subagentPath`, `slashCommandPath`, `cleanupAgentFiles`. |
| `electron/services/agentFileSyncService.test.ts` | Create | Filesystem tests against a `CLAUDE_HOME`-scoped temp dir. |
| `electron/services/skillImportService.ts` | Modify | Extend `ParsedSkill`; add `parseModelFrontmatter` / `parseToolsFrontmatter` / `parseArgumentHint`; thread into `parseSkill` and `importSkill`. |
| `electron/services/skillImportService.test.ts` | Modify | New fixtures + tests for the new frontmatter fields. |
| `electron/services/__fixtures__/skills/with-model/SKILL.md` | Create | Fixture for model frontmatter. |
| `electron/services/__fixtures__/skills/with-tools/SKILL.md` | Create | Fixture for tools frontmatter (comma-separated). |
| `electron/services/__fixtures__/skills/with-tools-array/SKILL.md` | Create | Fixture for tools frontmatter (YAML array). |
| `electron/services/__fixtures__/skills/with-argument-hint/SKILL.md` | Create | Fixture for argument-hint frontmatter. |
| `electron/ipc/agentHandlers.ts` | Modify | Extend `create`/`update`/`delete` to call sync, persist `synced_*_at`, attach `syncWarning`. Add `agents:sync:checkConflict` / `retry` / `preview`. |
| `electron/preload.ts` | Modify | Extend `update` + `create` patch types; add `sync` namespace. |
| `src/env.d.ts` | Modify | Mirror preload changes. |
| `src/components/ModelDropdown.tsx` | Create | Small `<select>` with the four model values. |
| `src/components/ToolsPicker.tsx` | Create | Radio + checkbox grid; exports `STANDARD_CC_TOOLS`. |
| `src/components/ConflictDialog.tsx` | Create | Modal for first-time toggle-ON conflict. |
| `src/components/SurfaceToggle.tsx` | Create | Checkbox + sync status component (used twice in Settings tab). |
| `src/views/AgentDetail.tsx` | Modify | Extend `AgentSettingsTab` with the four new groups; wire toggle handlers; thread `syncWarning` into a toast. |
| `src/views/AgentDetail.css` | Modify | Styling for the new Settings groups, surface toggles, sync status, tools picker. |
| `src/views/AgentDetail.test.tsx` | Modify | Tests for the new Settings UI. |

---

## Phase A: Foundation (schema + types)

### Task 1: Phase 25 migration — 7 new columns on `agents`

**Files:**
- Modify: `electron/db.ts:278` (insert after the existing `idx_agent_files_agent` index, before the `Phase 20 – AI chat history` block)

- [ ] **Step 1: Add the migration block**

In `electron/db.ts`, after line 278 (the `CREATE INDEX IF NOT EXISTS idx_agent_files_agent` line), insert before the blank line preceding `// Phase 20`:

```ts
  // Phase 25 — Skill parity Phase 2: tools/model + subagent/slash-command surfaces
  try { db.exec(`ALTER TABLE agents ADD COLUMN tools TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'inherit'`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN is_slash_command INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN argument_hint TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN synced_subagent_at TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN synced_slash_command_at TEXT`) } catch {}
```

- [ ] **Step 2: Run the existing test suite to confirm no regression**

```bash
npm test -- electron/services/agentsService.test.ts
```

Expected: all existing tests PASS — the new columns default safely and don't affect any current code path.

- [ ] **Step 3: Commit**

```bash
git add electron/db.ts
git commit -m "feat(agents): Phase 25 migration — tools/model/surface columns"
```

### Task 2: TypeScript types for the new fields + helpers

**Files:**
- Modify: `src/types/agent.ts`

- [ ] **Step 1: Extend the `AgentRow` interface**

In `src/types/agent.ts`, find the `AgentRow` interface (currently ending at line 32 with `origin_imported_at`). Append the new fields after `origin_imported_at`:

```ts
  // Skill parity (Phase 2)
  tools: string | null              // JSON-serialized string[], NULL = inherit all
  model: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  is_subagent: 0 | 1
  is_slash_command: 0 | 1
  argument_hint: string | null
  synced_subagent_at: string | null
  synced_slash_command_at: string | null
```

- [ ] **Step 2: Add the tools helpers**

At the bottom of `src/types/agent.ts` (after `parseAgentPresets`), append:

```ts
export function parseAgentTools(json: string | null): string[] | null {
  if (json === null) return null
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string') : null
  } catch {
    return null
  }
}

export function serializeAgentTools(arr: string[] | null): string | null {
  if (arr === null) return null
  return JSON.stringify(arr)
}
```

- [ ] **Step 3: Verify TS compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -20
```

Expected: no new errors beyond the pre-existing AgentsSidebar one (carried over from Phase 1).

- [ ] **Step 4: Commit**

```bash
git add src/types/agent.ts
git commit -m "feat(agents): AgentRow types + parseAgentTools/serializeAgentTools"
```

---

## Phase B: Service layer (agentsService)

### Task 3: Validation helpers + `MODEL_VALUES` constant

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `electron/services/agentsService.test.ts`, append a new describe block at the bottom:

```ts
describe('validation helpers', () => {
  it('assertValidModel accepts the four canonical values', () => {
    expect(() => assertValidModel('sonnet')).not.toThrow()
    expect(() => assertValidModel('opus')).not.toThrow()
    expect(() => assertValidModel('haiku')).not.toThrow()
    expect(() => assertValidModel('inherit')).not.toThrow()
  })

  it('assertValidModel throws on unknown values', () => {
    expect(() => assertValidModel('gpt-4')).toThrow(/model/i)
    expect(() => assertValidModel('')).toThrow(/model/i)
  })

  it('assertValidTools accepts string arrays and null', () => {
    expect(() => assertValidTools(null)).not.toThrow()
    expect(() => assertValidTools([])).not.toThrow()
    expect(() => assertValidTools(['Read', 'Edit'])).not.toThrow()
  })

  it('assertValidTools rejects non-array and non-string entries', () => {
    expect(() => assertValidTools('Read, Edit' as any)).toThrow()
    expect(() => assertValidTools([123 as any])).toThrow()
  })
})
```

Add the imports at the top of the test file: `assertValidModel, assertValidTools` from `./agentsService`.

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentsService.test.ts -t "validation helpers"
```

Expected: 4 FAIL — `assertValidModel is not a function` etc.

- [ ] **Step 3: Add the helpers and `MODEL_VALUES`**

In `electron/services/agentsService.ts`, near the top of the file (after the existing `HEX_RE` declaration around line 10):

```ts
export const MODEL_VALUES = ['sonnet', 'opus', 'haiku', 'inherit'] as const
export type AgentModel = typeof MODEL_VALUES[number]

export function assertValidModel(value: unknown): asserts value is AgentModel {
  if (typeof value !== 'string' || !(MODEL_VALUES as readonly string[]).includes(value)) {
    throw new Error(`Invalid model: ${JSON.stringify(value)}`)
  }
}

export function assertValidTools(value: unknown): asserts value is string[] | null {
  if (value === null) return
  if (!Array.isArray(value)) throw new Error(`tools must be an array or null, got ${typeof value}`)
  for (const t of value) {
    if (typeof t !== 'string') throw new Error(`tools entries must be strings, got ${typeof t}`)
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentsService.test.ts -t "validation helpers"
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): MODEL_VALUES + assertValidModel/assertValidTools helpers"
```

### Task 4: `createAgent` and `updateAgent` accept the 5 new fields

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Append failing tests**

In `electron/services/agentsService.test.ts`, append a new describe block:

```ts
describe('agent skill-parity fields', () => {
  it('createAgent defaults all new fields safely', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    expect(agent.model).toBe('inherit')
    expect(agent.tools).toBeNull()
    expect(agent.argument_hint).toBeNull()
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
    expect(agent.synced_subagent_at).toBeNull()
    expect(agent.synced_slash_command_at).toBeNull()
  })

  it('createAgent accepts and persists the new fields', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, {
      ...baseInput(),
      model: 'opus',
      tools: JSON.stringify(['Read', 'Edit']),
      argumentHint: '[project]',
      isSubagent: true,
      isSlashCommand: true,
    })
    expect(agent.model).toBe('opus')
    expect(agent.tools).toBe('["Read","Edit"]')
    expect(agent.argument_hint).toBe('[project]')
    expect(agent.is_subagent).toBe(1)
    expect(agent.is_slash_command).toBe(1)
  })

  it('createAgent rejects an invalid model value', () => {
    const db = openMemoryDb()
    expect(() => createAgent(db, { ...baseInput(), model: 'gpt-4' as any })).toThrow(/model/i)
  })

  it('createAgent rejects non-string-array tools', () => {
    const db = openMemoryDb()
    expect(() => createAgent(db, { ...baseInput(), tools: 'Read, Edit' as any })).toThrow(/tools/i)
  })

  it('updateAgent patches each new field independently', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const after1 = updateAgent(db, agent.id, { model: 'haiku' })
    expect(after1.model).toBe('haiku')
    const after2 = updateAgent(db, agent.id, { tools: ['Read'] })
    expect(after2.tools).toBe('["Read"]')
    const after3 = updateAgent(db, agent.id, { tools: null })
    expect(after3.tools).toBeNull()
    const after4 = updateAgent(db, agent.id, { isSubagent: true })
    expect(after4.is_subagent).toBe(1)
    const after5 = updateAgent(db, agent.id, { isSlashCommand: true })
    expect(after5.is_slash_command).toBe(1)
    const after6 = updateAgent(db, agent.id, { argumentHint: '[arg]' })
    expect(after6.argument_hint).toBe('[arg]')
  })
})
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentsService.test.ts -t "skill-parity fields"
```

Expected: 5 FAIL — fields not in `CreateAgentInput` / `UpdateAgentPatch`.

- [ ] **Step 3: Extend `CreateAgentInput` and the INSERT**

In `electron/services/agentsService.ts`, find `CreateAgentInput` (line 124). Append the new optional fields after `description`:

```ts
export interface CreateAgentInput {
  name: string
  body: string
  folderId: string | null
  handle: string
  colorStart: string
  colorEnd: string | null
  emoji: string | null
  description?: string
  // Phase 2: skill parity
  model?: AgentModel
  tools?: string[] | string | null     // accepts either parsed array or pre-serialized JSON
  argumentHint?: string | null
  isSubagent?: boolean
  isSlashCommand?: boolean
}
```

In `createAgent` (line 135), after the existing validations and before the `db.prepare(\`INSERT…\`)` call, add the new validations and resolved values:

```ts
  // Phase 2 — normalise + validate the new optional fields
  const model = input.model ?? 'inherit'
  assertValidModel(model)

  let tools: string | null = null
  if (input.tools !== undefined && input.tools !== null) {
    if (typeof input.tools === 'string') {
      // Caller passed a pre-serialized JSON string — parse to validate, then re-serialize for canonical form
      let parsed: unknown
      try {
        parsed = JSON.parse(input.tools)
      } catch {
        throw new Error(`tools string must be valid JSON, got: ${input.tools}`)
      }
      assertValidTools(parsed)
      tools = JSON.stringify(parsed)
    } else {
      assertValidTools(input.tools)
      tools = JSON.stringify(input.tools)
    }
  }

  const argumentHint = input.argumentHint ?? null
  const isSubagent = input.isSubagent ? 1 : 0
  const isSlashCommand = input.isSlashCommand ? 1 : 0
```

Replace the INSERT to include the new columns. Find the existing INSERT (around line 148):

```ts
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, input.description ?? '', ts, ts)
```

Replace with:

```ts
  db.prepare(`
    INSERT INTO agents (
      id, name, handle, body, folder_id, color_start, color_end, emoji, description,
      tools, model, is_subagent, is_slash_command, argument_hint,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, input.description ?? '',
    tools, model, isSubagent, isSlashCommand, argumentHint,
    ts, ts,
  )
```

- [ ] **Step 4: Extend `UpdateAgentPatch` and the patch builder**

Find `UpdateAgentPatch` (line 157). Append after `description?: string`:

```ts
  model?: AgentModel
  tools?: string[] | null
  argumentHint?: string | null
  isSubagent?: boolean
  isSlashCommand?: boolean
```

In `updateAgent` (line 169), after the existing `patch.description` handling (around line 220), add:

```ts
  if (patch.model !== undefined) {
    assertValidModel(patch.model)
    sets.push('model = ?'); params.push(patch.model)
  }
  if (patch.tools !== undefined) {
    assertValidTools(patch.tools)
    sets.push('tools = ?'); params.push(patch.tools === null ? null : JSON.stringify(patch.tools))
  }
  if (patch.argumentHint !== undefined) {
    sets.push('argument_hint = ?'); params.push(patch.argumentHint)
  }
  if (patch.isSubagent !== undefined) {
    sets.push('is_subagent = ?'); params.push(patch.isSubagent ? 1 : 0)
  }
  if (patch.isSlashCommand !== undefined) {
    sets.push('is_slash_command = ?'); params.push(patch.isSlashCommand ? 1 : 0)
  }
```

- [ ] **Step 5: Run tests**

```bash
npm test -- electron/services/agentsService.test.ts -t "skill-parity fields"
```

Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): createAgent/updateAgent accept model/tools/argumentHint/surface flags"
```

### Task 5: `setSyncedAt` helper

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
  it('setSyncedAt updates synced_subagent_at independently of other columns', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as any
    expect(row.synced_subagent_at).toBe('2026-05-25T10:00:00.000Z')
    expect(row.synced_slash_command_at).toBeNull()
  })

  it('setSyncedAt with null clears the timestamp', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    setSyncedAt(db, agent.id, 'subagent', null)
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id) as any
    expect(row.synced_subagent_at).toBeNull()
  })

  it('setSyncedAt does NOT bump updated_at', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const before = (db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any).updated_at
    setSyncedAt(db, agent.id, 'subagent', '2026-05-25T10:00:00.000Z')
    const after = (db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agent.id) as any).updated_at
    expect(after).toBe(before)
  })
```

Add `setSyncedAt` to the test file's imports.

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentsService.test.ts -t "setSyncedAt"
```

Expected: 3 FAIL.

- [ ] **Step 3: Implement `setSyncedAt`**

In `electron/services/agentsService.ts`, append after the existing `updateAgent` function (around line 236):

```ts
export type SyncSurface = 'subagent' | 'slashCommand'

export function setSyncedAt(
  db: Database.Database,
  agentId: string,
  surface: SyncSurface,
  ts: string | null,
): void {
  const column = surface === 'subagent' ? 'synced_subagent_at' : 'synced_slash_command_at'
  // NOTE: deliberately does NOT touch updated_at — sync state is an implementation
  // detail, not a content edit, and getAllAgents sorts by updated_at.
  db.prepare(`UPDATE agents SET ${column} = ? WHERE id = ?`).run(ts, agentId)
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentsService.test.ts -t "setSyncedAt"
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): setSyncedAt helper for IPC-layer sync state tracking"
```

---

## Phase C: Filesystem sync service

### Task 6: `agentFileSyncService` — path helpers + `checkConflict`

**Files:**
- Create: `electron/services/agentFileSyncService.ts`
- Create: `electron/services/agentFileSyncService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `electron/services/agentFileSyncService.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  subagentPath,
  slashCommandPath,
  checkConflict,
} from './agentFileSyncService'

let tmpDir = ''

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sync-'))
  process.env.CLAUDE_HOME = tmpDir
})

afterEach(async () => {
  delete process.env.CLAUDE_HOME
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('path helpers', () => {
  it('subagentPath returns CLAUDE_HOME/agents/<handle>.md', () => {
    expect(subagentPath('foo')).toBe(path.join(tmpDir, 'agents', 'foo.md'))
  })

  it('slashCommandPath returns CLAUDE_HOME/commands/<handle>.md', () => {
    expect(slashCommandPath('foo')).toBe(path.join(tmpDir, 'commands', 'foo.md'))
  })
})

describe('checkConflict', () => {
  it('returns false for both surfaces when nothing exists', async () => {
    const r = await checkConflict('nonexistent')
    expect(r.subagentExists).toBe(false)
    expect(r.slashCommandExists).toBe(false)
  })

  it('detects an existing subagent file', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'agents', 'foo.md'), 'existing')
    const r = await checkConflict('foo')
    expect(r.subagentExists).toBe(true)
    expect(r.slashCommandExists).toBe(false)
  })

  it('detects an existing slash command file', async () => {
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'commands', 'foo.md'), 'existing')
    const r = await checkConflict('foo')
    expect(r.subagentExists).toBe(false)
    expect(r.slashCommandExists).toBe(true)
  })

  it('returns paths in the result', async () => {
    const r = await checkConflict('foo')
    expect(r.subagentPath).toBe(path.join(tmpDir, 'agents', 'foo.md'))
    expect(r.slashCommandPath).toBe(path.join(tmpDir, 'commands', 'foo.md'))
  })
})
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentFileSyncService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the path helpers and `checkConflict`**

Create `electron/services/agentFileSyncService.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
}

export function subagentPath(handle: string): string {
  return path.join(claudeHome(), 'agents', `${handle}.md`)
}

export function slashCommandPath(handle: string): string {
  return path.join(claudeHome(), 'commands', `${handle}.md`)
}

async function fileExists(p: string): Promise<boolean> {
  return fs.stat(p).then(s => s.isFile()).catch(() => false)
}

export async function checkConflict(handle: string): Promise<{
  subagentExists: boolean
  slashCommandExists: boolean
  subagentPath: string
  slashCommandPath: string
}> {
  const sp = subagentPath(handle)
  const cp = slashCommandPath(handle)
  return {
    subagentExists: await fileExists(sp),
    slashCommandExists: await fileExists(cp),
    subagentPath: sp,
    slashCommandPath: cp,
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentFileSyncService.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts
git commit -m "feat(agents): agentFileSyncService — path helpers + checkConflict"
```

### Task 7: `previewSubagentFile` and `previewSlashCommandFile`

**Files:**
- Modify: `electron/services/agentFileSyncService.ts`
- Modify: `electron/services/agentFileSyncService.test.ts`

- [ ] **Step 1: Add a fixture-builder at the top of the test file**

Just under the imports in `agentFileSyncService.test.ts`, add:

```ts
import type { AgentRow } from '../../src/types/agent'

function baseAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    name: 'My Agent',
    handle: 'my-agent',
    body: 'Agent body content.',
    folder_id: null,
    color_start: '#888888',
    color_end: null,
    emoji: null,
    pinned: 0,
    pinned_at: null,
    last_used_at: null,
    presets_json: '[]',
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    description: 'A test agent.',
    origin_plugin: null,
    origin_path: null,
    origin_version: null,
    origin_imported_at: null,
    tools: null,
    model: 'inherit',
    is_subagent: 0,
    is_slash_command: 0,
    argument_hint: null,
    synced_subagent_at: null,
    synced_slash_command_at: null,
    ...overrides,
  }
}
```

- [ ] **Step 2: Append failing tests**

```ts
import { previewSubagentFile, previewSlashCommandFile } from './agentFileSyncService'

describe('previewSubagentFile', () => {
  it('writes name, description, and body — omits tools and model when defaults', () => {
    const out = previewSubagentFile(baseAgent())
    expect(out).toContain('name: my-agent')
    expect(out).toContain('description: A test agent.')
    expect(out).not.toContain('tools:')
    expect(out).not.toContain('model:')
    expect(out).toContain('Agent body content.')
  })

  it('emits comma-separated tools when array is non-empty', () => {
    const out = previewSubagentFile(baseAgent({ tools: '["Read","Edit","Bash"]' }))
    expect(out).toContain('tools: Read, Edit, Bash')
  })

  it('emits empty tools when array is []', () => {
    const out = previewSubagentFile(baseAgent({ tools: '[]' }))
    expect(out).toContain('tools:')
    // Empty tools should mean "no tools" — emit as an empty value, not missing line
  })

  it('emits the mapped model ID when non-inherit', () => {
    expect(previewSubagentFile(baseAgent({ model: 'sonnet' }))).toContain('model: claude-sonnet-4-6')
    expect(previewSubagentFile(baseAgent({ model: 'opus' }))).toContain('model: claude-opus-4-7')
    expect(previewSubagentFile(baseAgent({ model: 'haiku' }))).toContain('model: claude-haiku-4-5-20251001')
  })

  it('falls back to deriveDescription when description is empty', () => {
    const out = previewSubagentFile(baseAgent({ description: '', body: 'First line.\nSecond line.' }))
    // deriveDescription takes the first non-empty line or a heuristic — exact form is
    // tested in agentDescription tests; here we just assert the description: line is non-empty.
    expect(out).toMatch(/description: .+/)
  })

  it('uses a YAML block scalar when description contains newlines', () => {
    const out = previewSubagentFile(baseAgent({ description: 'Line one.\nLine two.' }))
    expect(out).toMatch(/description: \|/)
    expect(out).toContain('  Line one.')
    expect(out).toContain('  Line two.')
  })

  it('round-trips through gray-matter back to the same fields', async () => {
    const matter = (await import('gray-matter')).default
    const agent = baseAgent({
      tools: '["Read","Edit"]',
      model: 'sonnet',
      description: 'Multi\nline\ndesc.',
    })
    const written = previewSubagentFile(agent)
    const parsed = matter(written)
    expect(parsed.data.name).toBe('my-agent')
    expect(parsed.data.description).toBe('Multi\nline\ndesc.')
    expect(parsed.data.tools).toBe('Read, Edit')
    expect(parsed.data.model).toBe('claude-sonnet-4-6')
    expect(parsed.content.trim()).toBe('Agent body content.')
  })
})

describe('previewSlashCommandFile', () => {
  it('writes description and body — omits argument-hint when null', () => {
    const out = previewSlashCommandFile(baseAgent())
    expect(out).toContain('description: A test agent.')
    expect(out).not.toContain('argument-hint:')
    expect(out).toContain('Agent body content.')
  })

  it('emits argument-hint when non-empty', () => {
    const out = previewSlashCommandFile(baseAgent({ argument_hint: '[project-name]' }))
    expect(out).toContain('argument-hint: [project-name]')
  })

  it('does NOT emit name, tools, or model (slash command frontmatter is smaller)', () => {
    const out = previewSlashCommandFile(baseAgent({
      tools: '["Read"]',
      model: 'sonnet',
    }))
    expect(out).not.toContain('name:')
    expect(out).not.toContain('tools:')
    expect(out).not.toContain('model:')
  })
})
```

- [ ] **Step 3: Run tests (expect failure)**

```bash
npm test -- electron/services/agentFileSyncService.test.ts -t "previewSubagentFile|previewSlashCommandFile"
```

Expected: 9 FAIL.

- [ ] **Step 4: Implement the preview functions**

In `electron/services/agentFileSyncService.ts`, add the imports at the top:

```ts
import matter from 'gray-matter'
import type { AgentRow } from '../../src/types/agent'
import { parseAgentTools } from '../../src/types/agent'
import { deriveDescription } from '../../src/utils/agentDescription'
```

Add the model mapping constant:

```ts
export const MODEL_FRONTMATTER: Record<'sonnet' | 'opus' | 'haiku', string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5-20251001',
}
```

Add the preview functions:

```ts
function resolvedDescription(agent: AgentRow): string {
  const explicit = agent.description?.trim()
  if (explicit) return agent.description
  return deriveDescription(agent.body)
}

export function previewSubagentFile(agent: AgentRow): string {
  const data: Record<string, unknown> = {
    name: agent.handle,
    description: resolvedDescription(agent),
  }
  const tools = parseAgentTools(agent.tools)
  if (tools !== null) {
    data.tools = tools.join(', ')
  }
  if (agent.model !== 'inherit') {
    data.model = MODEL_FRONTMATTER[agent.model]
  }
  return matter.stringify(agent.body, data)
}

export function previewSlashCommandFile(agent: AgentRow): string {
  const data: Record<string, unknown> = {
    description: resolvedDescription(agent),
  }
  if (agent.argument_hint && agent.argument_hint.trim().length > 0) {
    data['argument-hint'] = agent.argument_hint
  }
  return matter.stringify(agent.body, data)
}
```

**Note on the import path for `deriveDescription`:** if the helper lives at `src/utils/agentDescription.ts`, that import works. If it's currently inline in `AgentDetail.tsx`, extract it to that file as a separate trivial step:

Run `grep -rn "export function deriveDescription" src/` to confirm location. If it's missing, create `src/utils/agentDescription.ts` exporting:

```ts
export function deriveDescription(body: string): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('---')) continue
    return line.slice(0, 200)
  }
  return ''
}
```

Then update wherever it's currently inlined to import from this file. Commit the extraction in its own commit if needed.

- [ ] **Step 5: Run tests**

```bash
npm test -- electron/services/agentFileSyncService.test.ts -t "previewSubagentFile|previewSlashCommandFile"
```

Expected: 9 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts src/utils/agentDescription.ts
git commit -m "feat(agents): previewSubagentFile + previewSlashCommandFile frontmatter generators"
```

### Task 8: `syncAgentToDisk` — write/delete/conflict/rename branches

**Files:**
- Modify: `electron/services/agentFileSyncService.ts`
- Modify: `electron/services/agentFileSyncService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { syncAgentToDisk, type SyncResult } from './agentFileSyncService'

describe('syncAgentToDisk', () => {
  it('writes the subagent file when is_subagent=1 and file does not exist', async () => {
    const agent = baseAgent({ is_subagent: 1 })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'written' })
    const written = await fs.readFile(subagentPath('my-agent'), 'utf-8')
    expect(written).toContain('name: my-agent')
  })

  it('writes the slash command file when is_slash_command=1', async () => {
    const agent = baseAgent({ is_slash_command: 1 })
    const result = await syncAgentToDisk(agent)
    expect(result.slashCommand).toMatchObject({ status: 'written' })
    const written = await fs.readFile(slashCommandPath('my-agent'), 'utf-8')
    expect(written).toContain('description:')
  })

  it('writes BOTH files when both surfaces are enabled', async () => {
    const agent = baseAgent({ is_subagent: 1, is_slash_command: 1 })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(result.slashCommand).toMatchObject({ status: 'written' })
    expect(await fileExists(subagentPath('my-agent'))).toBe(true)
    expect(await fileExists(slashCommandPath('my-agent'))).toBe(true)
  })

  it('returns skipped for surfaces that are off', async () => {
    const result = await syncAgentToDisk(baseAgent())
    expect(result.subagent).toMatchObject({ status: 'skipped' })
    expect(result.slashCommand).toMatchObject({ status: 'skipped' })
  })

  it('creates parent directories if missing', async () => {
    // tmpDir starts empty — agents/ and commands/ do not exist
    const agent = baseAgent({ is_subagent: 1 })
    await syncAgentToDisk(agent)
    expect(await fileExists(subagentPath('my-agent'))).toBe(true)
  })

  it('returns conflict when file exists, never synced, forceOverwrite=false', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'hand-authored content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: null })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'conflict' })
    // File should NOT have been overwritten
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toBe('hand-authored content')
  })

  it('overwrites silently when synced_subagent_at is non-null', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'previously synced content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toContain('name: my-agent')
  })

  it('overwrites with forceOverwrite=true even when never synced', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'hand-authored content')
    const agent = baseAgent({ is_subagent: 1, synced_subagent_at: null })
    const result = await syncAgentToDisk(agent, { forceOverwrite: true })
    expect(result.subagent).toMatchObject({ status: 'written' })
    expect(await fs.readFile(subagentPath('my-agent'), 'utf-8')).toContain('name: my-agent')
  })

  it('deletes the file when is_subagent flips off', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('my-agent'), 'previously synced')
    const agent = baseAgent({ is_subagent: 0, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('my-agent'))).toBe(false)
  })

  it('treats already-missing file as deleted success', async () => {
    const agent = baseAgent({ is_subagent: 0, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'deleted' })
  })

  it('renames: deletes old file and writes new when handle changed', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.writeFile(subagentPath('old-handle'), 'previously synced')
    const agent = baseAgent({ handle: 'new-handle', is_subagent: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    await syncAgentToDisk(agent, { oldHandle: 'old-handle' })
    expect(await fileExists(subagentPath('old-handle'))).toBe(false)
    expect(await fileExists(subagentPath('new-handle'))).toBe(true)
  })

  it('subagent error does not block slash command success', async () => {
    // Create a directory where the subagent file should go — makes write fail
    await fs.mkdir(subagentPath('my-agent'), { recursive: true })
    const agent = baseAgent({ is_subagent: 1, is_slash_command: 1, synced_subagent_at: '2026-05-20T00:00:00.000Z' })
    const result = await syncAgentToDisk(agent)
    expect(result.subagent).toMatchObject({ status: 'error' })
    expect(result.slashCommand).toMatchObject({ status: 'written' })
  })
})

// Helper used by syncAgentToDisk tests
async function fileExists(p: string): Promise<boolean> {
  return fs.stat(p).then(s => s.isFile()).catch(() => false)
}
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentFileSyncService.test.ts -t "syncAgentToDisk"
```

Expected: 12 FAIL.

- [ ] **Step 3: Implement `syncAgentToDisk`**

In `electron/services/agentFileSyncService.ts`, add the type exports near the top (after the imports):

```ts
export type SyncOutcome =
  | { status: 'written'; path: string }
  | { status: 'deleted'; path: string }
  | { status: 'skipped' }
  | { status: 'conflict'; path: string }
  | { status: 'error'; path: string; message: string }

export interface SyncResult {
  subagent: SyncOutcome
  slashCommand: SyncOutcome
}

export interface SyncContext {
  oldHandle?: string
  forceOverwrite?: boolean
}
```

Add the main function:

```ts
export async function syncAgentToDisk(
  agent: AgentRow,
  ctx: SyncContext = {},
): Promise<SyncResult> {
  const [subagent, slashCommand] = await Promise.all([
    syncOneSurface({
      surface: 'subagent',
      enabled: agent.is_subagent === 1,
      currentPath: subagentPath(agent.handle),
      oldPath: ctx.oldHandle ? subagentPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_subagent_at,
      content: () => previewSubagentFile(agent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
    syncOneSurface({
      surface: 'slashCommand',
      enabled: agent.is_slash_command === 1,
      currentPath: slashCommandPath(agent.handle),
      oldPath: ctx.oldHandle ? slashCommandPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_slash_command_at,
      content: () => previewSlashCommandFile(agent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
  ])
  return { subagent, slashCommand }
}

interface SurfaceParams {
  surface: 'subagent' | 'slashCommand'
  enabled: boolean
  currentPath: string
  oldPath: string | null      // path under the old handle, if handle changed
  syncedAt: string | null
  content: () => string       // lazy — only invoked when we actually write
  forceOverwrite: boolean
}

async function syncOneSurface(p: SurfaceParams): Promise<SyncOutcome> {
  // Step 1: handle handle-rename — delete the old file if it differs from the current path.
  if (p.oldPath && p.oldPath !== p.currentPath) {
    await fs.rm(p.oldPath, { force: true })
  }

  // Step 2: if surface is disabled, delete (or skip if never synced).
  if (!p.enabled) {
    if (p.syncedAt === null) {
      // We never owned this file; nothing to clean up.
      // Exception: handle rename of an OWNED file to a NOT-owned state happens
      // before this branch, so this only fires when the agent never had the
      // surface on.
      return { status: 'skipped' }
    }
    await fs.rm(p.currentPath, { force: true })
    return { status: 'deleted', path: p.currentPath }
  }

  // Step 3: surface enabled — check for first-time conflict.
  if (p.syncedAt === null && !p.forceOverwrite) {
    const exists = await fs.stat(p.currentPath).then(s => s.isFile()).catch(() => false)
    if (exists) return { status: 'conflict', path: p.currentPath }
  }

  // Step 4: write the file (mkdir -p, then writeFile).
  try {
    await fs.mkdir(path.dirname(p.currentPath), { recursive: true })
    await fs.writeFile(p.currentPath, p.content(), 'utf-8')
    return { status: 'written', path: p.currentPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', path: p.currentPath, message }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentFileSyncService.test.ts -t "syncAgentToDisk"
```

Expected: 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts
git commit -m "feat(agents): syncAgentToDisk — write/delete/conflict/rename branches"
```

### Task 9: `cleanupAgentFiles`

**Files:**
- Modify: `electron/services/agentFileSyncService.ts`
- Modify: `electron/services/agentFileSyncService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { cleanupAgentFiles } from './agentFileSyncService'

describe('cleanupAgentFiles', () => {
  it('removes both files when both are requested', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'a')
    await fs.writeFile(slashCommandPath('foo'), 'b')
    const r = await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'deleted' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('foo'))).toBe(false)
    expect(await fileExists(slashCommandPath('foo'))).toBe(false)
  })

  it('only removes requested surfaces', async () => {
    await fs.mkdir(path.join(tmpDir, 'agents'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'commands'), { recursive: true })
    await fs.writeFile(subagentPath('foo'), 'a')
    await fs.writeFile(slashCommandPath('foo'), 'b')
    const r = await cleanupAgentFiles('foo', { cleanSubagent: false, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'skipped' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
    expect(await fileExists(subagentPath('foo'))).toBe(true)
    expect(await fileExists(slashCommandPath('foo'))).toBe(false)
  })

  it('succeeds when files are already absent', async () => {
    const r = await cleanupAgentFiles('foo', { cleanSubagent: true, cleanSlashCommand: true })
    expect(r.subagent).toMatchObject({ status: 'deleted' })
    expect(r.slashCommand).toMatchObject({ status: 'deleted' })
  })
})
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentFileSyncService.test.ts -t "cleanupAgentFiles"
```

Expected: 3 FAIL.

- [ ] **Step 3: Implement `cleanupAgentFiles`**

In `electron/services/agentFileSyncService.ts`, append:

```ts
export async function cleanupAgentFiles(
  handle: string,
  opts: { cleanSubagent: boolean; cleanSlashCommand: boolean },
): Promise<{ subagent: SyncOutcome; slashCommand: SyncOutcome }> {
  const subagent: SyncOutcome = opts.cleanSubagent
    ? await deleteSurfaceFile(subagentPath(handle))
    : { status: 'skipped' }
  const slashCommand: SyncOutcome = opts.cleanSlashCommand
    ? await deleteSurfaceFile(slashCommandPath(handle))
    : { status: 'skipped' }
  return { subagent, slashCommand }
}

async function deleteSurfaceFile(p: string): Promise<SyncOutcome> {
  try {
    await fs.rm(p, { force: true })
    return { status: 'deleted', path: p }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', path: p, message }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentFileSyncService.test.ts
```

Expected: all PASS (including prior describe blocks).

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts
git commit -m "feat(agents): cleanupAgentFiles for delete-agent paths"
```

---

## Phase D: Import roundtrip

### Task 10: Parse helpers for the new frontmatter fields

**Files:**
- Modify: `electron/services/skillImportService.ts`
- Modify: `electron/services/skillImportService.test.ts`
- Create: `electron/services/__fixtures__/skills/with-model/SKILL.md`
- Create: `electron/services/__fixtures__/skills/with-tools/SKILL.md`
- Create: `electron/services/__fixtures__/skills/with-tools-array/SKILL.md`
- Create: `electron/services/__fixtures__/skills/with-argument-hint/SKILL.md`

- [ ] **Step 1: Create the fixture files**

Create `electron/services/__fixtures__/skills/with-model/SKILL.md`:

```markdown
---
name: with-model
description: Skill that specifies a model.
model: claude-sonnet-4-6
---

# Body

Content.
```

Create `electron/services/__fixtures__/skills/with-tools/SKILL.md`:

```markdown
---
name: with-tools
description: Skill with comma-separated tools.
tools: Read, Edit, Bash
---

# Body

Content.
```

Create `electron/services/__fixtures__/skills/with-tools-array/SKILL.md`:

```markdown
---
name: with-tools-array
description: Skill with YAML-array tools.
tools:
  - Read
  - Edit
---

# Body

Content.
```

Create `electron/services/__fixtures__/skills/with-argument-hint/SKILL.md`:

```markdown
---
name: with-argument-hint
description: Slash-command-style skill with argument-hint.
argument-hint: [project-name]
---

# Body

Content.
```

- [ ] **Step 2: Append failing tests**

In `electron/services/skillImportService.test.ts`:

```ts
import {
  parseModelFrontmatter,
  parseToolsFrontmatter,
  parseArgumentHint,
} from './skillImportService'

describe('parseModelFrontmatter', () => {
  it('returns inherit when undefined/null', () => {
    expect(parseModelFrontmatter(undefined)).toBe('inherit')
    expect(parseModelFrontmatter(null)).toBe('inherit')
  })
  it('passes through short forms', () => {
    expect(parseModelFrontmatter('sonnet')).toBe('sonnet')
    expect(parseModelFrontmatter('opus')).toBe('opus')
    expect(parseModelFrontmatter('haiku')).toBe('haiku')
    expect(parseModelFrontmatter('inherit')).toBe('inherit')
  })
  it('maps CC full-form model IDs', () => {
    expect(parseModelFrontmatter('claude-sonnet-4-6')).toBe('sonnet')
    expect(parseModelFrontmatter('claude-opus-4-7')).toBe('opus')
    expect(parseModelFrontmatter('claude-haiku-4-5-20251001')).toBe('haiku')
  })
  it('falls back to inherit on unknown values', () => {
    expect(parseModelFrontmatter('gpt-4')).toBe('inherit')
    expect(parseModelFrontmatter(42)).toBe('inherit')
  })
})

describe('parseToolsFrontmatter', () => {
  it('returns null for missing values', () => {
    expect(parseToolsFrontmatter(undefined)).toBeNull()
    expect(parseToolsFrontmatter(null)).toBeNull()
  })
  it('parses comma-separated strings', () => {
    expect(parseToolsFrontmatter('Read, Edit, Bash')).toEqual(['Read', 'Edit', 'Bash'])
  })
  it('trims whitespace around items', () => {
    expect(parseToolsFrontmatter('  Read ,Edit  , Bash')).toEqual(['Read', 'Edit', 'Bash'])
  })
  it('accepts YAML arrays directly', () => {
    expect(parseToolsFrontmatter(['Read', 'Edit'])).toEqual(['Read', 'Edit'])
  })
  it('returns [] for empty string', () => {
    expect(parseToolsFrontmatter('')).toEqual([])
  })
  it('rejects non-string array entries by filtering them out', () => {
    expect(parseToolsFrontmatter(['Read', 42, null, 'Edit'] as any)).toEqual(['Read', 'Edit'])
  })
})

describe('parseArgumentHint', () => {
  it('returns null for missing', () => {
    expect(parseArgumentHint(undefined)).toBeNull()
    expect(parseArgumentHint(null)).toBeNull()
  })
  it('returns the string when present', () => {
    expect(parseArgumentHint('[project-name]')).toBe('[project-name]')
  })
  it('returns null for non-string types', () => {
    expect(parseArgumentHint(42)).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests (expect failure)**

```bash
npm test -- electron/services/skillImportService.test.ts -t "parseModelFrontmatter|parseToolsFrontmatter|parseArgumentHint"
```

Expected: 13 FAIL.

- [ ] **Step 4: Implement the parse helpers**

In `electron/services/skillImportService.ts`, near the top (after the existing imports), append:

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
  console.warn(`[skillImportService] Unknown model "${raw}", falling back to 'inherit'.`)
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
  console.warn(`[skillImportService] Unexpected tools type ${typeof raw}, treating as null.`)
  return null
}

export function parseArgumentHint(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- electron/services/skillImportService.test.ts -t "parseModelFrontmatter|parseToolsFrontmatter|parseArgumentHint"
```

Expected: 13 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/skillImportService.ts electron/services/skillImportService.test.ts electron/services/__fixtures__/skills/with-model electron/services/__fixtures__/skills/with-tools electron/services/__fixtures__/skills/with-tools-array electron/services/__fixtures__/skills/with-argument-hint
git commit -m "feat(agents): parse helpers for model/tools/argument-hint frontmatter"
```

### Task 11: `parseSkill` and `importSkill` populate the new fields

**Files:**
- Modify: `electron/services/skillImportService.ts`
- Modify: `electron/services/skillImportService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('parseSkill — Phase 2 fields', () => {
  it('picks up model from frontmatter', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-model'))
    expect(skill.model).toBe('sonnet')
  })

  it('picks up comma-separated tools', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    expect(skill.tools).toEqual(['Read', 'Edit', 'Bash'])
  })

  it('picks up YAML-array tools', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools-array'))
    expect(skill.tools).toEqual(['Read', 'Edit'])
  })

  it('picks up argument-hint', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-argument-hint'))
    expect(skill.argumentHint).toBe('[project-name]')
  })

  it('defaults to inherit/null when the new fields are absent', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    expect(skill.model).toBe('inherit')
    expect(skill.tools).toBeNull()
    expect(skill.argumentHint).toBeNull()
  })
})

describe('importSkill — Phase 2 fields', () => {
  it('populates the new columns on the agent row', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.model).toBe('inherit')   // with-tools.md has no model: line
    expect(agent.tools).toBe('["Read","Edit","Bash"]')
    expect(agent.is_subagent).toBe(0)
    expect(agent.is_slash_command).toBe(0)
  })

  it('does NOT auto-flip is_subagent even when source had tools:', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-tools'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const agent = db.prepare(`SELECT is_subagent FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.is_subagent).toBe(0)
  })
})
```

`openDb` and `createFolder` are already imported in the existing test file.

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/skillImportService.test.ts -t "Phase 2 fields"
```

Expected: 7 FAIL.

- [ ] **Step 3: Extend `ParsedSkill` and `parseSkill`**

In `electron/services/skillImportService.ts`, extend the `ParsedSkill` interface (around line 9):

```ts
export interface ParsedSkill {
  name: string
  handle: string
  description: string
  body: string
  files: { filename: string; content: string }[]
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
  // Phase 2
  model: ImportedModel
  tools: string[] | null
  argumentHint: string | null
}
```

In `parseSkill`, after the existing `description` extraction (around line 37), add:

```ts
  const model = parseModelFrontmatter(data.model)
  const tools = parseToolsFrontmatter(data.tools)
  const argumentHint = parseArgumentHint(data['argument-hint'])
```

Update the "known frontmatter" set (around line 40):

```ts
  const known = new Set(['name', 'description', 'model', 'tools', 'argument-hint'])
```

Update the return value:

```ts
  return {
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

- [ ] **Step 4: Extend `importSkill`'s `createFromScratch`**

In `electron/services/skillImportService.ts`, find `createFromScratch` (around line 261). The `createAgent` call needs to pass the new fields. Modify the call:

```ts
    const agent = createAgent(db, {
      name: skill.name,
      body: skill.body,
      folderId: opts.folderId,
      handle: skill.handle,
      colorStart,
      colorEnd: null,
      emoji: null,
      description: skill.description,
      model: skill.model,
      tools: skill.tools,                  // CreateAgentInput accepts string[] | string | null
      argumentHint: skill.argumentHint,
      // Deliberately leaves is_subagent / is_slash_command at default (0).
      // Importing should not auto-create files in ~/.claude/agents/.
    })
```

Also extend the `overwrite` branch in `importSkill` (around line 224) to update the new fields:

```ts
        updateAgent(db, existing.id, {
          name: skill.name,
          body: skill.body,
          description: skill.description,
          model: skill.model,
          tools: skill.tools,
          argumentHint: skill.argumentHint,
        })
```

- [ ] **Step 5: Run tests**

```bash
npm test -- electron/services/skillImportService.test.ts
```

Expected: all PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add electron/services/skillImportService.ts electron/services/skillImportService.test.ts
git commit -m "feat(agents): parseSkill + importSkill thread model/tools/argument-hint"
```

---

## Phase E: IPC layer

### Task 12: `agents:update` and `agents:create` call `syncAgentToDisk`

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`

- [ ] **Step 1: Extend the imports at the top of `agentHandlers.ts`**

```ts
import {
  // existing imports...
  setSyncedAt,
} from '../services/agentsService'
import {
  syncAgentToDisk,
  checkConflict,
  cleanupAgentFiles,
  previewSubagentFile,
  previewSlashCommandFile,
  type SyncResult,
} from '../services/agentFileSyncService'
```

- [ ] **Step 2: Add a shared `runSyncAndPersist` helper**

Right above the first `ipcMain.handle('agents:create', ...)` registration (around line 77), add:

```ts
async function runSyncAndPersist(
  db: Database.Database,
  agentId: string,
  oldHandle: string | undefined,
  forceOverwrite: boolean | undefined,
): Promise<{ row: AgentRow; syncWarning?: string }> {
  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  const result = await syncAgentToDisk(row, { oldHandle, forceOverwrite })
  const ts = new Date().toISOString()
  if (result.subagent.status === 'written') setSyncedAt(db, agentId, 'subagent', ts)
  if (result.subagent.status === 'deleted') setSyncedAt(db, agentId, 'subagent', null)
  if (result.slashCommand.status === 'written') setSyncedAt(db, agentId, 'slashCommand', ts)
  if (result.slashCommand.status === 'deleted') setSyncedAt(db, agentId, 'slashCommand', null)
  const warnings: string[] = []
  if (result.subagent.status === 'error') warnings.push(`Subagent sync failed: ${result.subagent.message}`)
  if (result.slashCommand.status === 'error') warnings.push(`Slash-command sync failed: ${result.slashCommand.message}`)
  if (result.subagent.status === 'conflict') warnings.push(`Subagent file exists at ${result.subagent.path}; toggle was applied but file not written.`)
  if (result.slashCommand.status === 'conflict') warnings.push(`Slash-command file exists at ${result.slashCommand.path}; toggle was applied but file not written.`)
  const refreshed = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  return warnings.length > 0
    ? { row: refreshed, syncWarning: warnings.join(' ') }
    : { row: refreshed }
}
```

Add the `AgentRow` import at the top of the file:

```ts
import type { AgentRow } from '../../src/types/agent'
```

- [ ] **Step 3: Update the `agents:create` handler**

Find the existing `ipcMain.handle('agents:create', ...)` handler (around line 77). Replace it with:

```ts
  ipcMain.handle('agents:create', async (_, input: CreateAgentInput & { forceOverwrite?: boolean }) => {
    const db = getDb(app.getPath('userData'))
    const { forceOverwrite, ...createInput } = input
    const agent = createAgent(db, createInput)
    const { row, syncWarning } = await runSyncAndPersist(db, agent.id, undefined, forceOverwrite)
    broadcastChanged()
    return syncWarning ? { ...row, syncWarning } : row
  })
```

- [ ] **Step 4: Update the `agents:update` handler**

Find the existing `ipcMain.handle('agents:update', ...)` handler (around line 86). Replace it with:

```ts
  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch & { forceOverwrite?: boolean }) => {
    const db = getDb(app.getPath('userData'))
    const oldRow = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(id) as { handle: string } | undefined
    const oldHandle = oldRow?.handle
    const { forceOverwrite, ...updatePatch } = patch
    updateAgent(db, id, updatePatch)
    // Re-read to detect handle changes (which require oldHandle for sync rename).
    const newRow = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(id) as { handle: string }
    const handleChanged = oldHandle !== undefined && oldHandle !== newRow.handle
    const { row, syncWarning } = await runSyncAndPersist(
      db, id,
      handleChanged ? oldHandle : undefined,
      forceOverwrite,
    )
    broadcastChanged()
    return syncWarning ? { ...row, syncWarning } : row
  })
```

- [ ] **Step 5: Compile check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -10
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/agentHandlers.ts
git commit -m "feat(agents): IPC update/create call syncAgentToDisk + persist synced_at"
```

### Task 13: `agents:delete` calls `cleanupAgentFiles`; add `agents:sync:*` routes

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`

- [ ] **Step 1: Update the `agents:delete` handler**

Find the existing `ipcMain.handle('agents:delete', ...)` (around line 95). Replace with:

```ts
  ipcMain.handle('agents:delete', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(
      `SELECT handle, is_subagent, is_slash_command FROM agents WHERE id = ?`,
    ).get(id) as { handle: string; is_subagent: 0 | 1; is_slash_command: 0 | 1 } | undefined
    deleteAgent(db, id)
    if (row) {
      await cleanupAgentFiles(row.handle, {
        cleanSubagent: row.is_subagent === 1,
        cleanSlashCommand: row.is_slash_command === 1,
      })
    }
    broadcastChanged()
  })
```

- [ ] **Step 2: Add `agents:sync:checkConflict` / `retry` / `preview` handlers**

At the end of the `registerAgentHandlers` function (just before the closing `}` of the function, around line 265), append:

```ts
  ipcMain.handle('agents:sync:checkConflict', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(agentId) as { handle: string } | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    return checkConflict(row.handle)
  })

  ipcMain.handle('agents:sync:retry', async (_, agentId: string): Promise<SyncResult> => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    const result = await syncAgentToDisk(row)
    const ts = new Date().toISOString()
    if (result.subagent.status === 'written') setSyncedAt(db, agentId, 'subagent', ts)
    if (result.subagent.status === 'deleted') setSyncedAt(db, agentId, 'subagent', null)
    if (result.slashCommand.status === 'written') setSyncedAt(db, agentId, 'slashCommand', ts)
    if (result.slashCommand.status === 'deleted') setSyncedAt(db, agentId, 'slashCommand', null)
    broadcastChanged()
    return result
  })

  ipcMain.handle('agents:sync:preview', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
    if (!row) throw new Error(`Unknown agent id: ${agentId}`)
    return {
      subagent: row.is_subagent === 1 ? previewSubagentFile(row) : null,
      slashCommand: row.is_slash_command === 1 ? previewSlashCommandFile(row) : null,
    }
  })
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -10
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/agentHandlers.ts
git commit -m "feat(agents): delete handler cleans files + agents:sync:* routes"
```

### Task 14: Preload + `env.d.ts` route extensions

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 1: Extend the `update` and `create` patch types in `preload.ts`**

In `electron/preload.ts`, find the `agents.create` block (around line 172). Replace its patch type:

```ts
    create: (input: {
      name: string
      body: string
      folderId: string | null
      handle: string
      colorStart: string
      colorEnd: string | null
      emoji: string | null
      description?: string
      model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
      tools?: string[] | null
      argumentHint?: string | null
      isSubagent?: boolean
      isSlashCommand?: boolean
      forceOverwrite?: boolean
    }) =>
      ipcRenderer.invoke('agents:create', input) as Promise<import('../src/types/agent').AgentRow & { syncWarning?: string }>,
```

Find the `update` block (around line 182) and replace its patch type:

```ts
    update: (id: string, patch: {
      name?: string
      body?: string
      folderId?: string | null
      handle?: string
      colorStart?: string
      colorEnd?: string | null
      emoji?: string | null
      pinned?: boolean
      description?: string
      model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
      tools?: string[] | null
      argumentHint?: string | null
      isSubagent?: boolean
      isSlashCommand?: boolean
      forceOverwrite?: boolean
    }) =>
      ipcRenderer.invoke('agents:update', id, patch) as Promise<import('../src/types/agent').AgentRow & { syncWarning?: string }>,
```

- [ ] **Step 2: Add the `sync` namespace block**

In `electron/preload.ts`, after the existing `import: { ... }` block (around line 256, after the `readSkillFromRepo` definition), append a sibling `sync` block:

```ts
    sync: {
      checkConflict: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:checkConflict', agentId) as Promise<{
          subagentExists: boolean
          slashCommandExists: boolean
          subagentPath: string
          slashCommandPath: string
        }>,
      retry: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:retry', agentId) as Promise<import('../electron/services/agentFileSyncService').SyncResult>,
      preview: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:preview', agentId) as Promise<{
          subagent: string | null
          slashCommand: string | null
        }>,
    },
```

- [ ] **Step 3: Mirror the changes in `src/env.d.ts`**

In `src/env.d.ts`, find the `agents.create` declaration (around line 190). Replace with:

```ts
        create(input: {
          name: string
          body: string
          folderId: string | null
          handle: string
          colorStart: string
          colorEnd: string | null
          emoji: string | null
          description?: string
          model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
          tools?: string[] | null
          argumentHint?: string | null
          isSubagent?: boolean
          isSlashCommand?: boolean
          forceOverwrite?: boolean
        }): Promise<import('./types/agent').AgentRow & { syncWarning?: string }>
```

Find the `agents.update` declaration (around line 199). Replace with:

```ts
        update(id: string, patch: {
          name?: string
          body?: string
          folderId?: string | null
          handle?: string
          colorStart?: string
          colorEnd?: string | null
          emoji?: string | null
          pinned?: boolean
          description?: string
          model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
          tools?: string[] | null
          argumentHint?: string | null
          isSubagent?: boolean
          isSlashCommand?: boolean
          forceOverwrite?: boolean
        }): Promise<import('./types/agent').AgentRow & { syncWarning?: string }>
```

After the existing `import` namespace (around line 248), add the `sync` namespace:

```ts
        sync: {
          checkConflict(agentId: string): Promise<{
            subagentExists: boolean
            slashCommandExists: boolean
            subagentPath: string
            slashCommandPath: string
          }>
          retry(agentId: string): Promise<import('../electron/services/agentFileSyncService').SyncResult>
          preview(agentId: string): Promise<{
            subagent: string | null
            slashCommand: string | null
          }>
        }
```

- [ ] **Step 4: Compile check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts src/env.d.ts
git commit -m "feat(agents): preload + env.d.ts route extensions for sync + new patch fields"
```

---

## Phase F: UI

### Task 15: `ModelDropdown` component

**Files:**
- Create: `src/components/ModelDropdown.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react'

export type AgentModelValue = 'sonnet' | 'opus' | 'haiku' | 'inherit'

interface ModelDropdownProps {
  value: AgentModelValue
  onChange: (next: AgentModelValue) => void
  id?: string
}

export function ModelDropdown({ value, onChange, id }: ModelDropdownProps) {
  return (
    <select
      id={id}
      className="agent-detail-settings-select"
      value={value}
      onChange={e => onChange(e.target.value as AgentModelValue)}
    >
      <option value="inherit">Inherit (Claude Code default)</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
      <option value="haiku">Haiku</option>
    </select>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ModelDropdown.tsx
git commit -m "feat(agents): ModelDropdown component"
```

### Task 16: `ToolsPicker` component + `STANDARD_CC_TOOLS`

**Files:**
- Create: `src/components/ToolsPicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react'

export const STANDARD_CC_TOOLS = [
  'Read', 'Write', 'Edit',
  'Glob', 'Grep',
  'Bash',
  'WebFetch', 'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
  'ExitPlanMode',
] as const

interface ToolsPickerProps {
  value: string[] | null            // null = inherit; [] = no tools; array = restrict
  onChange: (next: string[] | null) => void
}

export function ToolsPicker({ value, onChange }: ToolsPickerProps) {
  const restrict = value !== null
  const checked = new Set(value ?? [])

  const customTools = (value ?? []).filter(t => !(STANDARD_CC_TOOLS as readonly string[]).includes(t))

  const toggleRestrict = (next: boolean) => {
    onChange(next ? [] : null)
  }

  const toggleTool = (tool: string) => {
    const current = value ?? []
    onChange(current.includes(tool)
      ? current.filter(t => t !== tool)
      : [...current, tool])
  }

  return (
    <div className="agent-detail-tools-picker">
      <label className="agent-detail-tools-radio">
        <input
          type="radio"
          name="tools-mode"
          checked={!restrict}
          onChange={() => toggleRestrict(false)}
        />
        <span>Inherit all (no restriction)</span>
      </label>
      <label className="agent-detail-tools-radio">
        <input
          type="radio"
          name="tools-mode"
          checked={restrict}
          onChange={() => toggleRestrict(true)}
        />
        <span>Restrict to:</span>
      </label>
      {restrict && (
        <div className="agent-detail-tools-grid">
          {STANDARD_CC_TOOLS.map(tool => (
            <label key={tool} className="agent-detail-tools-checkbox">
              <input
                type="checkbox"
                checked={checked.has(tool)}
                onChange={() => toggleTool(tool)}
              />
              <span>{tool}</span>
            </label>
          ))}
          {customTools.length > 0 && (
            <div className="agent-detail-tools-custom">
              <div className="agent-detail-tools-custom-label">Custom (from import):</div>
              {customTools.map(tool => (
                <label key={tool} className="agent-detail-tools-checkbox">
                  <input
                    type="checkbox"
                    checked={checked.has(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  <span>{tool}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ToolsPicker.tsx
git commit -m "feat(agents): ToolsPicker component + STANDARD_CC_TOOLS const"
```

### Task 17: `ConflictDialog` component

**Files:**
- Create: `src/components/ConflictDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react'
import { AlertTriangle, FolderOpen } from 'lucide-react'

interface ConflictDialogProps {
  open: boolean
  surface: 'subagent' | 'slash command'
  path: string
  onCancel: () => void
  onOverwrite: () => void
}

export function ConflictDialog({ open, surface, path, onCancel, onOverwrite }: ConflictDialogProps) {
  if (!open) return null
  const openContainingFolder = () => {
    void window.api.openExternal(`file://${path.replace(/[^/\\]+$/, '')}`)
  }
  return (
    <div className="agent-detail-modal-backdrop" onClick={onCancel}>
      <div className="agent-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="agent-detail-modal-header">
          <AlertTriangle size={16} />
          <h3>{surface === 'subagent' ? 'Subagent file exists' : 'Slash command file exists'}</h3>
        </div>
        <div className="agent-detail-modal-body">
          <p>A file already exists at:</p>
          <pre className="agent-detail-modal-path">{path}</pre>
          <p>
            Enabling "{surface === 'subagent' ? 'Available as subagent' : 'Available as slash command'}"
            will overwrite it with the content from this agent. The existing file's content will be lost.
          </p>
          <button
            type="button"
            className="agent-detail-modal-link"
            onClick={openContainingFolder}
          >
            <FolderOpen size={13} /> Open containing folder
          </button>
        </div>
        <div className="agent-detail-modal-footer">
          <button type="button" className="agent-detail-settings-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="agent-detail-settings-btn agent-detail-settings-btn--danger"
            onClick={onOverwrite}
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ConflictDialog.tsx
git commit -m "feat(agents): ConflictDialog component"
```

### Task 18: `SurfaceToggle` component

**Files:**
- Create: `src/components/SurfaceToggle.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useState } from 'react'
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import { ConflictDialog } from './ConflictDialog'
import { useToast } from '../contexts/Toast'

interface SurfaceToggleProps {
  agentId: string
  kind: 'subagent' | 'slashCommand'
  enabled: boolean
  syncedAt: string | null
}

const KIND_LABEL: Record<SurfaceToggleProps['kind'], string> = {
  subagent: 'Available as subagent',
  slashCommand: 'Available as slash command',
}

const KIND_FOR_DIALOG: Record<SurfaceToggleProps['kind'], 'subagent' | 'slash command'> = {
  subagent: 'subagent',
  slashCommand: 'slash command',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}

export function SurfaceToggle({ agentId, kind, enabled, syncedAt }: SurfaceToggleProps) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<{ path: string } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const applyToggle = async (next: boolean, forceOverwrite = false) => {
    setPending(true)
    try {
      const patch: any = kind === 'subagent'
        ? { isSubagent: next, forceOverwrite }
        : { isSlashCommand: next, forceOverwrite }
      const result = await window.api.agents.update(agentId, patch)
      if (result.syncWarning) {
        setLastError(result.syncWarning)
        toast(result.syncWarning, 'error')
      } else {
        setLastError(null)
      }
    } finally {
      setPending(false)
    }
  }

  const onCheckboxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked
    if (!next) {
      await applyToggle(false)
      return
    }
    // Toggle ON — check conflict first if never synced
    if (syncedAt === null) {
      const conflictInfo = await window.api.agents.sync.checkConflict(agentId)
      const exists = kind === 'subagent' ? conflictInfo.subagentExists : conflictInfo.slashCommandExists
      const conflictPath = kind === 'subagent' ? conflictInfo.subagentPath : conflictInfo.slashCommandPath
      if (exists) {
        setConflict({ path: conflictPath })
        return
      }
    }
    await applyToggle(true)
  }

  const onOverwrite = async () => {
    setConflict(null)
    await applyToggle(true, true)
  }

  const onRetry = async () => {
    setPending(true)
    try {
      const result = await window.api.agents.sync.retry(agentId)
      const failed = (result.subagent.status === 'error' && kind === 'subagent')
        || (result.slashCommand.status === 'error' && kind === 'slashCommand')
      if (failed) {
        const surface = kind === 'subagent' ? result.subagent : result.slashCommand
        const message = surface.status === 'error' ? surface.message : 'Unknown sync error'
        setLastError(message)
        toast(message, 'error')
      } else {
        setLastError(null)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="agent-detail-surface-toggle">
      <label className="agent-detail-surface-toggle-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={onCheckboxChange}
        />
        <span>{KIND_LABEL[kind]}</span>
      </label>
      {enabled && (
        <div className="agent-detail-surface-toggle-status">
          {lastError ? (
            <span className="agent-detail-surface-toggle-error">
              <AlertCircle size={11} /> Sync failed.{' '}
              <button type="button" className="agent-detail-modal-link" onClick={onRetry}>
                <RefreshCw size={11} /> Retry
              </button>
            </span>
          ) : syncedAt === null ? (
            <span className="agent-detail-surface-toggle-pending">Will sync on next save.</span>
          ) : (
            <span className="agent-detail-surface-toggle-synced">
              Synced {relativeTime(syncedAt)}
              <ExternalLink size={11} />
            </span>
          )}
        </div>
      )}
      <ConflictDialog
        open={conflict !== null}
        surface={KIND_FOR_DIALOG[kind]}
        path={conflict?.path ?? ''}
        onCancel={() => setConflict(null)}
        onOverwrite={onOverwrite}
      />
    </div>
  )
}
```

**Note on `useToast`:** the existing `src/contexts/Toast.tsx` exports `useToast()` returning `{ toast(message, level) }`. The MCP tab in `AgentDetail.tsx` already uses this hook — follow that pattern.

- [ ] **Step 2: Commit**

```bash
git add src/components/SurfaceToggle.tsx
git commit -m "feat(agents): SurfaceToggle component with conflict-dialog flow"
```

### Task 19: Wire the new controls into `AgentSettingsTab` + tests

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append failing tests to `AgentDetail.test.tsx`**

First, extend `baseAgent` at the top of the test file to include the new fields:

```ts
const baseAgent: AgentRow = {
  // existing fields...
  tools: null,
  model: 'inherit',
  is_subagent: 0,
  is_slash_command: 0,
  argument_hint: null,
  synced_subagent_at: null,
  synced_slash_command_at: null,
}
```

Then append these tests in a new `describe` block:

```tsx
describe('Settings tab — Phase 2 fields', () => {
  it('renders the Model dropdown with the current value selected', async () => {
    const agent = { ...baseAgent, model: 'opus' as const }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const select = screen.getByLabelText(/Model/i) as HTMLSelectElement
    expect(select.value).toBe('opus')
  })

  it('changing the model dropdown calls update', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const select = screen.getByLabelText(/Model/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'opus' } })
    expect((window as any).api.agents.update).toHaveBeenCalledWith(
      baseAgent.id,
      expect.objectContaining({ model: 'opus' }),
    )
  })

  it('Tools picker — Inherit all radio is selected when tools is null', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const radios = screen.getAllByRole('radio')
    const inheritRadio = radios.find(r => r.closest('label')?.textContent?.includes('Inherit all'))
    expect((inheritRadio as HTMLInputElement)?.checked).toBe(true)
  })

  it('Tools picker — toggling a tool calls update with the new array', async () => {
    const agent = { ...baseAgent, tools: '[]' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const readCheckbox = screen.getByLabelText('Read')
    fireEvent.click(readCheckbox)
    expect((window as any).api.agents.update).toHaveBeenCalledWith(
      baseAgent.id,
      expect.objectContaining({ tools: ['Read'] }),
    )
  })

  it('Subagent toggle ON with no conflict calls update with isSubagent: true', async () => {
    ;(window as any).api.agents.sync = {
      checkConflict: vi.fn().mockResolvedValue({
        subagentExists: false, slashCommandExists: false,
        subagentPath: '/p/a/my-agent.md', slashCommandPath: '/p/c/my-agent.md',
      }),
    }
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const checkbox = screen.getByLabelText(/Available as subagent/i)
    fireEvent.click(checkbox)
    await new Promise(r => setTimeout(r, 0))
    expect((window as any).api.agents.update).toHaveBeenCalledWith(
      baseAgent.id,
      expect.objectContaining({ isSubagent: true, forceOverwrite: false }),
    )
  })

  it('Subagent toggle ON with conflict opens ConflictDialog and Cancel keeps toggle off', async () => {
    ;(window as any).api.agents.sync = {
      checkConflict: vi.fn().mockResolvedValue({
        subagentExists: true, slashCommandExists: false,
        subagentPath: '/p/a/my-agent.md', slashCommandPath: '/p/c/my-agent.md',
      }),
    }
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/Available as subagent/i))
    await screen.findByText(/Subagent file exists/i)
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    expect((window as any).api.agents.update).not.toHaveBeenCalled()
  })

  it('Argument hint input is hidden when is_slash_command=0 and visible when 1', async () => {
    const agent = { ...baseAgent, is_slash_command: 1 as const }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    expect(screen.getByLabelText(/Argument hint/i)).toBeTruthy()
  })
})
```

The existing test setup must include `(window as any).api.agents.update = vi.fn()` if not already mocked. Confirm by reading the existing `setup()` function in the test file.

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Phase 2 fields"
```

Expected: 7 FAIL — new UI elements don't exist yet.

- [ ] **Step 3: Extend `AgentSettingsTab` in `AgentDetail.tsx`**

In `src/views/AgentDetail.tsx`, find `AgentSettingsTab` at line 502. Add the new imports at the top of the file:

```ts
import { ModelDropdown } from '../components/ModelDropdown'
import { ToolsPicker } from '../components/ToolsPicker'
import { SurfaceToggle } from '../components/SurfaceToggle'
import { parseAgentTools } from '../types/agent'
```

Add a `useToast` import if not already present (the existing MCP tab uses it).

Replace the entire `AgentSettingsTab` function body (lines 502-575) with:

```tsx
function AgentSettingsTab({
  agent,
  folders,
  onCopyPayload,
  onDuplicate,
  onDelete,
}: {
  agent: AgentRow
  folders: AgentFolderRow[]
  onCopyPayload: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const onFolderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    window.api.agents.update(agent.id, {
      folderId: value === '__unfiled' ? null : value,
    })
  }

  const onModelChange = (next: 'sonnet' | 'opus' | 'haiku' | 'inherit') => {
    window.api.agents.update(agent.id, { model: next })
  }

  const onToolsChange = (next: string[] | null) => {
    window.api.agents.update(agent.id, { tools: next })
  }

  const onArgumentHintChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    window.api.agents.update(agent.id, { argumentHint: v.length === 0 ? null : v })
  }

  const tools = parseAgentTools(agent.tools)

  return (
    <div className="agent-detail-settings-grid">
      <label className="agent-detail-settings-label" htmlFor="agent-settings-folder">Folder</label>
      <div className="agent-detail-settings-field">
        <select
          id="agent-settings-folder"
          value={agent.folder_id ?? '__unfiled'}
          onChange={onFolderChange}
        >
          <option value="__unfiled">Unfiled</option>
          {folders.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="agent-detail-settings-hint">Move this agent into a folder in the sidebar.</div>
      </div>

      <div className="agent-detail-settings-divider">Claude Code surfaces</div>
      <div className="agent-detail-settings-label">Surface</div>
      <div className="agent-detail-settings-field">
        <SurfaceToggle
          agentId={agent.id}
          kind="subagent"
          enabled={agent.is_subagent === 1}
          syncedAt={agent.synced_subagent_at}
        />
        <SurfaceToggle
          agentId={agent.id}
          kind="slashCommand"
          enabled={agent.is_slash_command === 1}
          syncedAt={agent.synced_slash_command_at}
        />
      </div>

      {agent.is_slash_command === 1 && (
        <>
          <label className="agent-detail-settings-label" htmlFor="agent-settings-argument-hint">
            Argument hint
          </label>
          <div className="agent-detail-settings-field">
            <input
              id="agent-settings-argument-hint"
              type="text"
              value={agent.argument_hint ?? ''}
              onChange={onArgumentHintChange}
              placeholder="[project-name]"
              className="agent-detail-settings-input"
            />
            <div className="agent-detail-settings-hint">
              Shown after /{agent.handle} in the slash menu.
            </div>
          </div>
        </>
      )}

      <div className="agent-detail-settings-divider">Model &amp; tools</div>
      <label className="agent-detail-settings-label" htmlFor="agent-settings-model">Model</label>
      <div className="agent-detail-settings-field">
        <ModelDropdown id="agent-settings-model" value={agent.model} onChange={onModelChange} />
        <div className="agent-detail-settings-hint">
          Written to frontmatter when non-inherit.
        </div>
      </div>

      <div className="agent-detail-settings-label">Tools</div>
      <div className="agent-detail-settings-field">
        <ToolsPicker value={tools} onChange={onToolsChange} />
        <div className="agent-detail-settings-hint">
          Restrict the agent to a specific subset of Claude Code's tools.
        </div>
      </div>

      <div className="agent-detail-settings-label">Export prompt</div>
      <div className="agent-detail-settings-field">
        <button
          type="button"
          className="agent-detail-settings-btn"
          onClick={onCopyPayload}
        >
          <Copy size={13} /> Copy entire prompt
        </button>
        <div className="agent-detail-settings-hint">
          Copies the full rendered persona markdown to the clipboard — for chats without the MCP server.
        </div>
      </div>

      <div className="agent-detail-settings-label">Manage</div>
      <div className="agent-detail-settings-field">
        <div className="agent-detail-settings-row-actions">
          <button
            type="button"
            className="agent-detail-settings-btn"
            onClick={onDuplicate}
          >
            <CopyPlus size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="agent-detail-settings-btn agent-detail-settings-btn--danger"
            onClick={onDelete}
          >
            <Trash2 size={13} /> Delete agent
          </button>
        </div>
        <div className="agent-detail-settings-hint">
          Duplicate creates a copy with a new handle. Delete cannot be undone.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the CSS**

In `src/views/AgentDetail.css`, append at the bottom:

```css
.agent-detail-settings-divider {
  grid-column: 1 / -1;
  font-size: 11px;
  font-weight: 600;
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.agent-detail-settings-input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--t1);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  width: 240px;
}

.agent-detail-settings-select {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--t1);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
}

.agent-detail-surface-toggle {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.agent-detail-surface-toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--t1);
  cursor: pointer;
}

.agent-detail-surface-toggle-status {
  font-size: 11px;
  color: var(--t3);
  padding-left: 22px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-detail-surface-toggle-pending {
  color: var(--t3);
  font-style: italic;
}

.agent-detail-surface-toggle-synced {
  color: var(--t3);
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-detail-surface-toggle-error {
  color: #ef4444;
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-detail-tools-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-detail-tools-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--t1);
  cursor: pointer;
}

.agent-detail-tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 4px 12px;
  padding: 8px 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
}

.agent-detail-tools-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--t1);
  cursor: pointer;
}

.agent-detail-tools-custom {
  grid-column: 1 / -1;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.agent-detail-tools-custom-label {
  font-size: 11px;
  color: var(--t3);
  font-style: italic;
  margin-bottom: 4px;
}

.agent-detail-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-detail-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 420px;
  max-width: 540px;
  padding: 0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.agent-detail-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.agent-detail-modal-header h3 {
  font-size: 14px;
  margin: 0;
  color: var(--t1);
  font-weight: 600;
}

.agent-detail-modal-body {
  padding: 16px;
  font-size: 13px;
  color: var(--t2);
  line-height: 1.5;
}

.agent-detail-modal-body p {
  margin: 0 0 10px;
}

.agent-detail-modal-path {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  word-break: break-all;
  margin: 8px 0;
}

.agent-detail-modal-link {
  background: none;
  border: none;
  color: var(--accent-text);
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.agent-detail-modal-link:hover {
  text-decoration: underline;
}

.agent-detail-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 5: Run the component tests**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Phase 2 fields"
```

Expected: 7 PASS.

- [ ] **Step 6: Run the full test suite to catch any regressions**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx src/views/AgentDetail.css
git commit -m "feat(agents): Settings tab — model/tools/surface toggles/argument-hint"
```

---

## Self-review

After implementing all tasks, run the following before declaring Phase 2 complete:

- [ ] **Run all tests:**

```bash
npm test
```

Expected: green.

- [ ] **Full TS compile check:**

```bash
npx tsc --noEmit
```

Expected: only the pre-existing AgentsSidebar error (not a Phase 2 regression).

- [ ] **Manual smoke test** — execute steps 1–12 from the spec's manual smoke test section.

- [ ] **Dispatch the code-reviewer agent over the whole diff:**

```bash
# Get the SHA of the last pre-Phase-2 commit (the docs commit before any code lands)
PHASE2_BASE=$(git log --oneline | grep "docs(agents): Phase 2 design spec" | head -1 | awk '{print $1}')
```

Then dispatch `superpowers:code-reviewer` with the prompt referencing the spec and the diff range `$PHASE2_BASE..HEAD`.

---

## Notes for the executor

- **No worktree** — per the user's `~/.claude/CLAUDE.md`, work directly on `main`. Do not invoke `superpowers:using-git-worktrees` or `superpowers:finishing-a-development-branch`.
- **`npm test`, not `npx vitest`** — per the user's memory note, `npx vitest` leaves `better-sqlite3` built for the Node ABI and breaks Electron launch.
- **No dev server / no UI screenshots** — per the user's memory note, the user tests the UI themselves.
- **One final review at the end** — per the user's CLAUDE.md light/heavy path guidance, this is a Heavy task but the sub-tasks are sequential with tight dependencies. Run `superpowers:code-reviewer` once at the end against the full diff (`$PHASE2_BASE..HEAD`), not per-task.
- **gray-matter output quirks** — `matter.stringify` may quote `tools: 'Read, Edit'` because of the commas. CC's parser accepts both quoted and unquoted forms — the round-trip test verifies parse equivalence, not byte equivalence.
- **`deriveDescription` location** — verify with grep whether it's already exported from `src/utils/agentDescription.ts`. If it lives inline in `AgentDetail.tsx`, extract it as a one-line refactor in Task 7 before adding the sync service that imports it.
