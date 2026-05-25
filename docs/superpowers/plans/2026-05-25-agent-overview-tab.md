# Agent Overview Tab + Body-as-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Prompt` tab in `AgentDetail` with an `Overview` tab (Layout C — hero + two-column split), and migrate `agent.body` to a primary row in `agent_files` (filename `<handle>.md`, `sort_order = 0`) so every consumer reads body through one file-based path.

**Architecture:** Phase 26 DB migration backfills a primary `agent_files` row per agent (the `agents.body` column is kept through Tasks 1–8 as a transitional dual-write; Task 9 drops it once provably dead). The service layer (`agentsService.ts`) gains a `getPrimaryFile()` reader and guards on `deleteFile`/`updateFile`/handle rename. Writers dual-write body content to both the column and the primary file row in a single transaction so the two are always in sync. The sync layer (`agentFileSyncService.ts`) takes primary content as an argument instead of reading it off the agent row. A new `agents:primaryContent(id)` IPC route lets the renderer fetch body content; `AgentDetail.tsx` uses it on agent load, hosts the new Overview component, and removes Prompt. `AgentFilesTab.tsx` drops its synthetic `'main'` code path. The MCP launcher and skill importer route through the primary file row. Task 9 stops the dual-write, drops the `agents.body` column, and drops the `AgentRow.body` field.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3 (SQLite 3.47+), Vitest + @testing-library/react, `lucide-react` icons, `gray-matter` (already a dep).

**Spec:** [docs/superpowers/specs/2026-05-25-agent-overview-tab-design.md](../specs/2026-05-25-agent-overview-tab-design.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/db.ts` | Modify | Phase 26 migration — backfill primary `agent_files` rows (Task 1). Drop `agents.body` column (Task 9). |
| `electron/db.body-to-primary-file.migration.test.ts` | Create | Migration tests: backfill, sort_order shift, idempotency, drop verification. |
| `electron/services/agentsService.ts` | Modify | Add `getPrimaryFile()`. Route `createAgent`/`updateAgent(body)` through primary file. Auto-rename primary on handle change. Guards: cannot delete or rename the primary row. Update `duplicateAgent` and revision callers. |
| `electron/services/agentsService.test.ts` | Modify | New tests for primary file behaviour + guards; remove tests that asserted `agent.body` column behaviour. |
| `electron/services/agentFileSyncService.ts` | Modify | `previewSubagentFile(agent, primaryContent)`, `previewSlashCommandFile(agent, primaryContent)` take content as a second argument. |
| `electron/services/agentFileSyncService.test.ts` | Modify | Update tests to pass `primaryContent`; remove tests that read `agent.body`. |
| `electron/ipc/agentHandlers.ts` | Modify | New `agents:primaryContent` route. `runSyncAndPersist` + `agents:sync:retry` + `agents:sync:preview` fetch primary content before generating previews. |
| `electron/preload.ts` | Modify | Expose `agents.primaryContent(id)`. |
| `src/env.d.ts` | Modify | Ambient type for `agents.primaryContent`. |
| `electron/mcp-launcher.cjs` | Modify | Query primary file row instead of `agents.body`. |
| `electron/services/skillImportService.ts` | (Verify only) | No code change — `createAgent` already handles primary file. Tests confirm. |
| `src/types/agent.ts` | Modify | Remove `body` from `AgentRow` (final task). |
| `src/components/AgentOverviewTab.tsx` | Create | Overview component — hero + 2-column split with surface cards, files preview, recent revisions. |
| `src/components/AgentOverviewTab.test.tsx` | Create | Component tests covering empty states, preset row visibility, action wiring. |
| `src/views/AgentDetail.tsx` | Modify | Drop Prompt tab, default `activeTab='overview'`, fetch primary content on load, wire Overview, route body writes via `agents:files:update`. |
| `src/views/AgentDetail.test.tsx` | Modify | Update tests: no `'prompt'` tab; default Overview; primary content fetched; preset bar on Overview; "Open in editor" navigates to Files. |
| `src/components/AgentFilesTab.tsx` | Modify | Remove `'main'` synthetic. Mark primary file (★). Block delete + rename. Show variable bar above editor when primary is active. |
| `src/components/AgentFilesTab.test.tsx` | Create | (No tests exist today.) Cover primary-file marker, delete/rename guards, variable bar visibility. |
| `src/views/AgentDetail.css` | Modify | Styles for Overview component. |

---

## Phase 1: Data path

### Task 1: Phase 26 migration — backfill primary `agent_files` rows

**Files:**
- Modify: `electron/db.ts:287` (insert new Phase 26 block after Phase 25)
- Create: `electron/db.body-to-primary-file.migration.test.ts`

- [ ] **Step 1: Write the migration test file**

Create `electron/db.body-to-primary-file.migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

function seedAgent(db: Database.Database, overrides: Partial<{
  id: string; handle: string; body: string;
}> = {}) {
  const id = overrides.id ?? `a-${Math.random().toString(36).slice(2, 8)}`
  const handle = overrides.handle ?? 'my-agent'
  const body = overrides.body ?? 'Agent body content.'
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji,
      created_at, updated_at, description, model)
    VALUES (?, 'Test', ?, ?, NULL, '#888888', NULL, NULL,
      '2026-05-25T00:00:00.000Z', '2026-05-25T00:00:00.000Z', '', 'inherit')
  `).run(id, handle, body)
  return id
}

describe('Phase 26 migration — body → primary file', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('backfills a primary file row when an agent is added pre-migration', () => {
    // Simulate pre-Phase-26 state: insert an agent directly without a primary
    // file row. (initSchema already ran in freshDb but had no agents to migrate.)
    // Re-running initSchema then triggers Phase 26's backfill for the new agent.
    const id = seedAgent(db, { handle: 'foo', body: 'hello world' })
    db.prepare(`DELETE FROM agent_files WHERE agent_id = ? AND sort_order = 0`).run(id)
    initSchema(db)
    const row = db.prepare(
      `SELECT filename, content, sort_order FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { filename: string; content: string; sort_order: number } | undefined
    expect(row).toBeDefined()
    expect(row!.filename).toBe('foo.md')
    expect(row!.content).toBe('hello world')
    expect(row!.sort_order).toBe(0)
  })

  it('creates a primary file row with empty content when body is empty', () => {
    const id = seedAgent(db, { handle: 'empty', body: '' })
    db.prepare(`DELETE FROM agent_files WHERE agent_id = ? AND sort_order = 0`).run(id)
    initSchema(db)
    const row = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { content: string }
    expect(row.content).toBe('')
  })

  it('shifts any pre-existing sibling at sort_order = 0 to sort_order = 1', () => {
    const id = seedAgent(db, { handle: 'sib', body: 'main body' })
    db.prepare(`DELETE FROM agent_files WHERE agent_id = ?`).run(id)
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES ('sibling-x', ?, 'reference.md', 'reference content', 0,
        '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    `).run(id)
    initSchema(db)  // idempotent re-run triggers the shift + backfill
    const rows = db.prepare(
      `SELECT filename, sort_order FROM agent_files WHERE agent_id = ? ORDER BY sort_order ASC`
    ).all(id) as { filename: string; sort_order: number }[]
    expect(rows).toEqual([
      { filename: 'sib.md',       sort_order: 0 },
      { filename: 'reference.md', sort_order: 1 },
    ])
  })

  it('migration is idempotent — re-running creates no duplicates', () => {
    const id = seedAgent(db, { handle: 'idem' })
    db.prepare(`DELETE FROM agent_files WHERE agent_id = ? AND sort_order = 0`).run(id)
    initSchema(db)
    initSchema(db)
    const rows = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).all(id)
    expect(rows.length).toBe(1)
  })

  it('keeps the agents.body column intact after Task 1 (drop happens in Task 9)', () => {
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('body')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run body-to-primary-file`
Expected: FAIL — most tests fail (no Phase 26 migration yet); some may also fail because the test's INSERT into `agents` still references the `body` column (we'll drop it in this same migration).

- [ ] **Step 3: Add the Phase 26 migration block**

Insert into `electron/db.ts` immediately after line 287 (the Phase 25 `synced_slash_command_at` line):

```ts
  // Phase 26 — Body-as-file: backfill a primary agent_files row per agent.
  // The agents.body column is intentionally kept for the duration of this branch;
  // Task 9 drops it once every consumer has switched to reading the primary file.
  // Writers in Tasks 2–8 dual-write to both the column and the primary row to
  // keep them in sync. Idempotent on re-run: agents that already have a primary
  // file row are skipped.
  const agentsWithBody = db.prepare(
    `SELECT id, handle, body, created_at, updated_at FROM agents`
  ).all() as Array<{
    id: string; handle: string; body: string; created_at: string; updated_at: string;
  }>
  for (const a of agentsWithBody) {
    const existing = db.prepare(
      `SELECT 1 FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(a.id)
    if (existing) continue
    // Shift any sibling at sort_order=0 out of the way before claiming the slot.
    db.prepare(
      `UPDATE agent_files SET sort_order = 1 WHERE agent_id = ? AND sort_order = 0`
    ).run(a.id)
    try {
      db.prepare(`
        INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(
        `pf-${a.id}`, a.id, `${a.handle}.md`, a.body ?? '', a.created_at, a.updated_at,
      )
    } catch (err) {
      // Log + skip — one bad row shouldn't block the migration. Idempotent re-run
      // will retry after the underlying issue is fixed.
      console.warn(`[phase 26] skip backfill for agent ${a.id}:`, err)
    }
  }
```

**Note on ID format:** the prefix `pf-${a.id}` keeps the primary-file rows identifiable in the DB without colliding with `randomUUID()`-style IDs used elsewhere. They're stable across re-runs (idempotent).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run body-to-primary-file`
Expected: PASS — all 5 tests pass.

Also run the broader agent suite to confirm nothing else broke yet (other tests still depend on `agent.body` reading-from-column behaviour, so some failures here are expected and tracked by later tasks):

Run: `npm test -- --run agent 2>&1 | tail -20`
Expected: many failures in `agentsService.test.ts` and others — they'll be addressed in Task 2.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.body-to-primary-file.migration.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): Phase 26 migration — backfill primary agent_files rows

For every agent, create an agent_files row at sort_order=0 named <handle>.md
with the body column's content. Existing siblings at sort_order=0 step down
to 1. Idempotent on re-run.

Body column is intentionally kept — Task 9 drops it after every consumer
has switched to reading the primary file. During Tasks 2–8 writers
dual-write to keep the column and the primary row in sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: agentsService — primary file routing + guards

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

`createAgent`, `updateAgent`, `duplicateAgent`, and revision callers all need to route body through the primary file row. New `getPrimaryFile()` helper. Guards on `deleteFile`/`updateFile` for primary rows.

- [ ] **Step 1: Add the failing tests**

Append to `electron/services/agentsService.test.ts` (inside the existing `describe('agentsService — Phase 2 fields', ...)` or a new `describe('agentsService — primary file', ...)`):

```ts
describe('agentsService — primary file routing', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent writes the body to the primary file row, not an agents column', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'persona body' }))
    const primary = db.prepare(
      `SELECT filename, content, sort_order FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { filename: string; content: string; sort_order: number }
    expect(primary.filename).toBe(`${agent.handle}.md`)
    expect(primary.content).toBe('persona body')
    expect(primary.sort_order).toBe(0)
    // AgentRow no longer carries body
    expect((agent as any).body).toBeUndefined()
  })

  it('updateAgent({ body }) writes to the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    updateAgent(db, agent.id, { body: 'v2' })
    const primary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { content: string }
    expect(primary.content).toBe('v2')
  })

  it('updateAgent({ handle }) renames the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ handle: 'old-name' }))
    updateAgent(db, agent.id, { handle: 'new-name' })
    const primary = db.prepare(
      `SELECT filename FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { filename: string }
    expect(primary.filename).toBe('new-name.md')
  })

  it('deleteFile throws when called on the primary file row', () => {
    const agent = createAgent(db, makeBaseInput())
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    expect(() => deleteFile(db, agent.id, primary.id)).toThrow(/primary/i)
  })

  it('updateFile({ filename }) throws when renaming the primary file row', () => {
    const agent = createAgent(db, makeBaseInput())
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    expect(() => updateFile(db, agent.id, primary.id, { filename: 'something-else.md' })).toThrow(/primary/i)
  })

  it('updateFile({ content }) works on the primary file row', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    const primary = db.prepare(
      `SELECT id FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(agent.id) as { id: string }
    updateFile(db, agent.id, primary.id, { content: 'v2' })
    const after = db.prepare(`SELECT content FROM agent_files WHERE id = ?`).get(primary.id) as { content: string }
    expect(after.content).toBe('v2')
  })

  it('duplicateAgent creates an independent primary file row for the duplicate', () => {
    const a = createAgent(db, makeBaseInput({ body: 'src body', handle: 'src' }))
    const d = duplicateAgent(db, a.id)
    const srcPrimary = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(a.id) as { content: string }
    const dupPrimary = db.prepare(
      `SELECT filename, content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(d.id) as { filename: string; content: string }
    expect(srcPrimary.content).toBe('src body')
    expect(dupPrimary.content).toBe('src body')
    expect(dupPrimary.filename).toBe(`${d.handle}.md`)
    expect(d.handle).not.toBe(a.handle)  // duplicate has its own handle
  })

  it('getPrimaryFile returns the primary row content', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'persona' }))
    const primary = getPrimaryFile(db, agent.id)
    expect(primary.content).toBe('persona')
    expect(primary.filename).toBe(`${agent.handle}.md`)
  })

  it('getPrimaryFile throws on unknown agent id', () => {
    expect(() => getPrimaryFile(db, 'no-such-agent')).toThrow(/agent/i)
  })

  it('updateAgent({ body }) records a revision when body content changes', () => {
    const agent = createAgent(db, makeBaseInput({ body: 'v1' }))
    const before = listRevisions(db, agent.id).length
    updateAgent(db, agent.id, { body: 'v2' })
    const after = listRevisions(db, agent.id).length
    expect(after).toBe(before + 1)
    expect(listRevisions(db, agent.id)[0].body).toBe('v2')
  })
})
```

Also update / remove any existing tests in `agentsService.test.ts` that asserted on `agent.body` directly — these will surface as TS errors once `AgentRow.body` is removed (Task 9). For now they may still pass if `body` exists as a non-typed property; flag and rewrite where needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run agentsService.test`
Expected: the new tests fail — `getPrimaryFile` not exported; guards not in place; createAgent still writes to `body` column which doesn't exist.

- [ ] **Step 3: Add `getPrimaryFile` + guards + body routing**

In `electron/services/agentsService.ts`:

**3a.** Add the helper near the bottom of the agent-files section, after `deleteFile`:

```ts
export interface PrimaryFile {
  id: string
  filename: string
  content: string
  updated_at: string
}

export function getPrimaryFile(db: Database.Database, agentId: string): PrimaryFile {
  assertAgentExists(db, agentId)
  const row = db.prepare(
    `SELECT id, filename, content, updated_at FROM agent_files
     WHERE agent_id = ? AND sort_order = 0`
  ).get(agentId) as PrimaryFile | undefined
  if (!row) throw new Error(`Agent ${agentId} has no primary file row`)
  return row
}

function isPrimaryFile(db: Database.Database, agentId: string, fileId: string): boolean {
  const row = db.prepare(
    `SELECT sort_order FROM agent_files WHERE id = ? AND agent_id = ?`
  ).get(fileId, agentId) as { sort_order: number } | undefined
  return row?.sort_order === 0
}
```

**3b.** Update `deleteFile` and `updateFile` to guard against primary-row mutations. Locate the current `deleteFile` and `updateFile` exports near the end of the file:

```ts
export function deleteFile(db: Database.Database, agentId: string, fileId: string): void {
  if (isPrimaryFile(db, agentId, fileId)) {
    throw new Error(`Cannot delete the primary file (sort_order=0) for agent ${agentId}`)
  }
  db.prepare(`DELETE FROM agent_files WHERE id = ? AND agent_id = ?`).run(fileId, agentId)
}

export function updateFile(
  db: Database.Database,
  agentId: string,
  fileId: string,
  patch: UpdateFilePatch,
): AgentFile {
  if (patch.filename !== undefined && isPrimaryFile(db, agentId, fileId)) {
    throw new Error(`Cannot rename the primary file (sort_order=0) for agent ${agentId}`)
  }
  // … existing body of updateFile unchanged
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.filename !== undefined) {
    assertValidFilename(patch.filename)
    sets.push('filename = ?'); params.push(patch.filename)
  }
  if (patch.content !== undefined) { sets.push('content = ?'); params.push(patch.content) }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(patch.sortOrder) }
  if (sets.length === 0) {
    return db.prepare(`SELECT * FROM agent_files WHERE id = ? AND agent_id = ?`).get(fileId, agentId) as AgentFile
  }
  sets.push('updated_at = ?'); params.push(nowIso())
  params.push(fileId, agentId)
  db.prepare(`UPDATE agent_files SET ${sets.join(', ')} WHERE id = ? AND agent_id = ?`).run(...params)
  return db.prepare(`SELECT * FROM agent_files WHERE id = ?`).get(fileId) as AgentFile
}
```

**3c.** Update `createAgent` — keep writing to the `body` column (dual-write through Task 8), additionally write the primary `agent_files` row. Wrap the multi-statement writes in a transaction so partial failures don't leave the DB inconsistent. Locate the existing `createAgent` and update:

```ts
export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const name = normaliseName(input.name)
  assertNameLen(name)
  assertBodyLen(input.body)
  if (input.folderId !== null) assertFolderExists(db, input.folderId)

  assertValidHandle(input.handle)
  assertHandleUnique(db, input.handle)
  assertValidHex('colorStart', input.colorStart)
  if (input.colorEnd !== null) assertValidHex('colorEnd', input.colorEnd)

  const model = input.model ?? 'inherit'
  assertValidModel(model)

  const toolsInput = input.tools ?? null
  assertValidTools(toolsInput)
  const tools = toolsInput === null ? null : JSON.stringify(toolsInput)

  const argumentHint = input.argumentHint ?? null
  const isSubagent = input.isSubagent ? 1 : 0
  const isSlashCommand = input.isSlashCommand ? 1 : 0

  const id = randomUUID()
  const ts = nowIso()

  const insert = db.transaction(() => {
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
    // Primary file row — dual-write of the same content. Task 9 drops agents.body
    // once every consumer is reading from agent_files.
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(`pf-${id}`, id, `${input.handle}.md`, input.body, ts, ts)
  })
  insert()

  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
  recordRevision(db, id, input.body, '[]', 'create', 'Created agent')
  return row
}
```

**3d.** Update `updateAgent` — remove body from the SET clause and instead update the primary file row; add primary-file rename when handle changes:

Locate the existing `updateAgent` body. Replace the section that handles `patch.body` and the handle change:

```ts
export function updateAgent(
  db: Database.Database,
  id: string,
  patch: UpdateAgentPatch,
): AgentRow {
  // Capture prior primary content if patch.body is present, so we can detect a real change for revisions.
  let priorBody: string | null = null
  if (patch.body !== undefined) {
    const prior = db.prepare(
      `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
    ).get(id) as { content: string } | undefined
    priorBody = prior?.content ?? null
  }
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    const name = normaliseName(patch.name)
    assertNameLen(name)
    sets.push('name = ?'); params.push(name)
  }
  // Dual-write body to agents.body (kept through Task 8 for branch-green safety).
  // The primary file row is updated below in lockstep.
  if (patch.body !== undefined) {
    assertBodyLen(patch.body)
    sets.push('body = ?'); params.push(patch.body)
  }
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) assertFolderExists(db, patch.folderId)
    sets.push('folder_id = ?'); params.push(patch.folderId)
  }
  if (patch.handle !== undefined) {
    assertValidHandle(patch.handle)
    assertHandleUnique(db, patch.handle, id)
    sets.push('handle = ?'); params.push(patch.handle)
  }
  if (patch.colorStart !== undefined) {
    assertValidHex('colorStart', patch.colorStart)
    sets.push('color_start = ?'); params.push(patch.colorStart)
  }
  if (patch.colorEnd !== undefined) {
    if (patch.colorEnd !== null) assertValidHex('colorEnd', patch.colorEnd)
    sets.push('color_end = ?'); params.push(patch.colorEnd)
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?'); params.push(patch.emoji)
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?'); params.push(patch.pinned ? 1 : 0)
    if (patch.pinned) {
      sets.push('pinned_at = ?'); params.push(nowIso())
    }
  }
  if (patch.description !== undefined) {
    sets.push('description = ?'); params.push(patch.description)
  }
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

  const ts = nowIso()
  const apply = db.transaction(() => {
    if (sets.length > 0) {
      sets.push('updated_at = ?'); params.push(ts)
      params.push(id)
      db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    }
    // Body — dual-write to primary file row (lockstep with agents.body update above)
    if (patch.body !== undefined) {
      db.prepare(
        `UPDATE agent_files SET content = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
      ).run(patch.body, ts, id)
    }
    // Handle rename — also rename the primary file row
    if (patch.handle !== undefined) {
      db.prepare(
        `UPDATE agent_files SET filename = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
      ).run(`${patch.handle}.md`, ts, id)
    }
  })
  apply()

  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${id}`)
  if (patch.body !== undefined && priorBody !== null && priorBody !== patch.body) {
    recordRevision(db, id, patch.body, row.presets_json, 'body_edit', 'Edited body')
  }
  return row
}
```

**3e.** Update `duplicateAgent` to copy primary file content:

```ts
export function duplicateAgent(db: Database.Database, id: string): AgentRow {
  const src = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!src) throw new Error(`Unknown agent id: ${id}`)
  const srcPrimary = getPrimaryFile(db, id)
  const suffix = ' (copy)'
  const baseName = src.name.length + suffix.length > AGENT_NAME_MAX
    ? src.name.slice(0, AGENT_NAME_MAX - suffix.length)
    : src.name

  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const dupHandle = dedupeHandle(src.handle, taken)

  return createAgent(db, {
    name: `${baseName}${suffix}`,
    body: srcPrimary.content,
    folderId: src.folder_id,
    handle: dupHandle,
    colorStart: src.color_start ?? '#888888',
    colorEnd: src.color_end,
    emoji: src.emoji,
    description: src.description,
    model: src.model,
    tools: parseAgentTools(src.tools),
    argumentHint: src.argument_hint,
  })
}
```

**3f.** Update `revertToRevision` to write the revision's body into the primary file row, not into an `agents.body` column:

```ts
export function revertToRevision(
  db: Database.Database,
  agentId: string,
  revisionId: string,
): AgentRow {
  assertAgentExists(db, agentId)
  const rev = db.prepare(`SELECT * FROM agent_revisions WHERE id = ?`).get(revisionId) as
    | { id: string; agent_id: string; body: string; presets_json: string; summary: string; kind: string; created_at: string }
    | undefined
  if (!rev) throw new Error(`Unknown revision id: ${revisionId}`)
  if (rev.agent_id !== agentId) throw new Error(`Revision ${revisionId} does not belong to agent ${agentId}`)

  const ts = nowIso()
  const apply = db.transaction(() => {
    // Dual-write: body column + primary file row (lockstep)
    db.prepare(`UPDATE agents SET body = ?, presets_json = ?, updated_at = ? WHERE id = ?`)
      .run(rev.body, rev.presets_json, ts, agentId)
    db.prepare(
      `UPDATE agent_files SET content = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
    ).run(rev.body, ts, agentId)
  })
  apply()

  recordRevision(db, agentId, rev.body, rev.presets_json, 'revert', `Reverted to "${rev.summary}"`)

  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  return row
}
```

**3g.** Audit other functions in `agentsService.ts` that read or write `body` directly:
- `createPreset`, `updatePreset`, `deletePreset`, `duplicatePreset` each read `body` to pass into `recordRevision`. Change them to read from the primary file row:

```ts
// Helper for the preset functions — locate next to readPresets()
function readPrimaryBody(db: Database.Database, agentId: string): string {
  const row = db.prepare(
    `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
  ).get(agentId) as { content: string } | undefined
  return row?.content ?? ''
}
```

Then in each of the four preset functions, replace this pattern:
```ts
const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
```
with:
```ts
const body = readPrimaryBody(db, agentId)
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run agentsService.test`
Expected: PASS — the new primary-file tests pass; existing tests that don't depend on `agents.body` column still pass.

Existing tests that DO reference `agent.body` need updating:
- Tests asserting `agent.body === '...'` (TS error once body field is removed in Task 9; can also be migrated now to `getPrimaryFile(db, agent.id).content`)

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): service layer dual-writes body to primary agent_files row

- createAgent + updateAgent({ body }) + revertToRevision now dual-write
  the body to the primary file row (sort_order=0, filename=<handle>.md)
  inside a db.transaction. The agents.body column is also updated in
  lockstep — Task 9 drops the column once every consumer is reading
  from agent_files.
- updateAgent({ handle }) renames the primary file row's filename.
- duplicateAgent reads source primary content; new primary created via
  createAgent.
- deleteFile throws on primary row; updateFile throws on filename change
  of primary row.
- New getPrimaryFile(db, agentId) reader.
- Preset helpers read body from primary file row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Sync + IPC

### Task 3: `agentFileSyncService` — preview functions take primaryContent argument

**Files:**
- Modify: `electron/services/agentFileSyncService.ts`
- Modify: `electron/services/agentFileSyncService.test.ts`

- [ ] **Step 1: Update the test file**

In `electron/services/agentFileSyncService.test.ts`, every call to `previewSubagentFile(agent)` becomes `previewSubagentFile(agent, primaryContent)`. Same for `previewSlashCommandFile`. Update the `baseAgent` helper to drop the `body` field (it's no longer on `AgentRow`).

Concretely, locate the `baseAgent` factory near the top of the test file and remove the `body: 'Agent body content.'` line. Then update each test:

```ts
describe('previewSubagentFile', () => {
  const BODY = 'Agent body content.'

  it('writes name, description, and body — omits tools and model when defaults', () => {
    const out = previewSubagentFile(baseAgent(), BODY)
    expect(out).toContain('name: my-agent')
    expect(out).toContain('description: A test agent.')
    expect(out).not.toContain('tools:')
    expect(out).not.toContain('model:')
    expect(out).toContain('Agent body content.')
  })

  it('emits comma-separated tools when array is non-empty', () => {
    const out = previewSubagentFile(baseAgent({ tools: '["Read","Edit","Bash"]' }), BODY)
    const parsed = matter(out)
    expect(parsed.data.tools).toBe('Read, Edit, Bash')
  })

  // … same pattern for the rest of the previewSubagentFile and previewSlashCommandFile tests
})
```

For the `syncAgentToDisk` describe block, also pass `primaryContent`. Update the function signature handling — `syncAgentToDisk` will need either to take primary content as a second arg or to read it from the DB. Since the function lives in a pure service (no DB import today), we make it the caller's responsibility — pass content in:

```ts
it('writes the subagent file when is_subagent=1 and file does not exist', async () => {
  const agent = baseAgent({ is_subagent: 1 })
  const result = await syncAgentToDisk(agent, 'Agent body content.')
  expect(result.subagent).toMatchObject({ status: 'written' })
  const written = await fs.readFile(subagentPath('my-agent'), 'utf-8')
  expect(written).toContain('name: my-agent')
})
```

Update every `syncAgentToDisk(agent, ctx?)` call site in the test file to `syncAgentToDisk(agent, primaryContent, ctx?)`.

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npm test -- --run agentFileSyncService.test`
Expected: FAIL — `previewSubagentFile` and `previewSlashCommandFile` still only take one argument; `syncAgentToDisk` rejects the new arg signature.

- [ ] **Step 3: Update the service implementation**

In `electron/services/agentFileSyncService.ts`:

```ts
export function previewSubagentFile(agent: AgentRow, primaryContent: string): string {
  const data: Record<string, unknown> = {
    name: agent.handle,
    description: resolvedDescription(agent, primaryContent),
  }
  const tools = parseAgentTools(agent.tools)
  if (tools !== null) {
    data.tools = tools.join(', ')
  }
  if (agent.model !== 'inherit') {
    data.model = MODEL_FRONTMATTER[agent.model]
  }
  return matter.stringify(primaryContent, data)
}

export function previewSlashCommandFile(agent: AgentRow, primaryContent: string): string {
  const data: Record<string, unknown> = {
    description: resolvedDescription(agent, primaryContent),
  }
  if (agent.argument_hint && agent.argument_hint.trim().length > 0) {
    data['argument-hint'] = agent.argument_hint
  }
  return matter.stringify(primaryContent, data)
}

function resolvedDescription(agent: AgentRow, primaryContent: string): string {
  const explicit = agent.description?.trim()
  if (explicit) return explicit
  return deriveDescription(primaryContent)
}
```

Update `syncAgentToDisk` signature:

```ts
export async function syncAgentToDisk(
  agent: AgentRow,
  primaryContent: string,
  ctx: SyncContext = {},
): Promise<SyncResult> {
  const [subagent, slashCommand] = await Promise.all([
    syncOneSurface({
      enabled: agent.is_subagent === 1,
      currentPath: subagentPath(agent.handle),
      oldPath: ctx.oldHandle ? subagentPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_subagent_at,
      content: () => previewSubagentFile(agent, primaryContent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
    syncOneSurface({
      enabled: agent.is_slash_command === 1,
      currentPath: slashCommandPath(agent.handle),
      oldPath: ctx.oldHandle ? slashCommandPath(ctx.oldHandle) : null,
      syncedAt: agent.synced_slash_command_at,
      content: () => previewSlashCommandFile(agent, primaryContent),
      forceOverwrite: ctx.forceOverwrite === true,
    }),
  ])
  return { subagent, slashCommand }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run agentFileSyncService.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts
git commit -m "$(cat <<'EOF'
refactor(agents): previewSubagentFile/SlashCommandFile take primaryContent arg

Sync layer no longer reads agent.body — primary file content is passed in.
syncAgentToDisk's signature gains a second argument for primary content.
Keeps the preview functions pure and testable; the IPC handler in the next
task fetches the content from agent_files before calling them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `agentHandlers` + preload + env.d.ts — new `agents:primaryContent` route + sync handlers fetch primary

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 1: Update sync handlers to fetch primary content**

In `electron/ipc/agentHandlers.ts`, update `runSyncAndPersist` to fetch primary content before calling sync:

```ts
async function runSyncAndPersist(
  row: AgentRow,
  oldHandle: string | undefined,
  forceOverwrite: boolean | undefined,
): Promise<{ row: AgentRow; syncWarning?: string }> {
  const db = getDb(app.getPath('userData'))
  const primary = getPrimaryFile(db, row.id)
  const result = await syncAgentToDisk(row, primary.content, { oldHandle, forceOverwrite })
  // … rest unchanged
  const ts = result.subagent.status === 'written' || result.slashCommand.status === 'written'
    ? new Date().toISOString()
    : ''
  const changes = persistSyncResult(db, row.id, result, ts)
  // … rest unchanged
}
```

Update `agents:sync:retry`:

```ts
ipcMain.handle('agents:sync:retry', async (_, agentId: string): Promise<SyncResult> => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
  const primary = getPrimaryFile(db, agentId)
  const result = await syncAgentToDisk(row, primary.content)
  persistSyncResult(db, agentId, result, new Date().toISOString())
  broadcastChanged()
  return result
})
```

Update `agents:sync:preview`:

```ts
ipcMain.handle('agents:sync:preview', async (_, agentId: string) => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
  const primary = getPrimaryFile(db, agentId)
  return {
    subagent: row.is_subagent === 1 ? previewSubagentFile(row, primary.content) : null,
    slashCommand: row.is_slash_command === 1 ? previewSlashCommandFile(row, primary.content) : null,
  }
})
```

Also add `getPrimaryFile` to the agentsService import at the top:

```ts
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder, updateFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  recordUse,
  listFiles, createFile, updateFile, deleteFile,
  setSyncedAt,
  getPrimaryFile,                                                                  // <-- NEW
  type CreateAgentInput, type UpdateAgentPatch, type UpdateFolderPatch,
  type CreateFileInput, type UpdateFilePatch,
} from '../services/agentsService'
```

- [ ] **Step 2: Add the `agents:primaryContent` IPC route**

Insert a new handler near the other `agents:` handlers in `electron/ipc/agentHandlers.ts`:

```ts
ipcMain.handle('agents:primaryContent', async (_, agentId: string) => {
  const db = getDb(app.getPath('userData'))
  return getPrimaryFile(db, agentId)
})
```

- [ ] **Step 3: Expose the route in preload**

In `electron/preload.ts`, add inside the `agents:` object (between `recordUse` and `mcp:`):

```ts
primaryContent: (agentId: string) =>
  ipcRenderer.invoke('agents:primaryContent', agentId) as Promise<{
    id: string
    filename: string
    content: string
    updated_at: string
  }>,
```

- [ ] **Step 4: Add the ambient type**

In `src/env.d.ts`, locate the `agents:` block (around line 185) and add:

```ts
primaryContent: (agentId: string) => Promise<{
  id: string
  filename: string
  content: string
  updated_at: string
}>
```

(Place it next to `recordUse` to mirror the preload ordering.)

- [ ] **Step 5: TS check**

Run: `npx tsc --noEmit`
Expected: clean (any errors are real — fix them before continuing).

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "$(cat <<'EOF'
feat(agents): IPC route agents:primaryContent + sync handlers fetch primary

runSyncAndPersist, agents:sync:retry, and agents:sync:preview now fetch
primary file content via getPrimaryFile before generating previews. New
agents:primaryContent(id) IPC route exposes the primary row to the
renderer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: External consumers

### Task 5: MCP launcher reads from `agent_files`

**Files:**
- Modify: `electron/mcp-launcher.cjs`

- [ ] **Step 1: Locate the body read in `mcp-launcher.cjs`**

The MCP launcher serves `agent://<handle>` URIs by reading agent rows. Find the query that currently reads `body`:

```bash
grep -n 'body' electron/mcp-launcher.cjs
```

- [ ] **Step 2: Replace with a JOIN to `agent_files`**

Update the query that produces the agent persona to read from the primary file row. The exact change depends on how the launcher reads agents; the pattern is:

```js
// BEFORE
const row = db.prepare(`SELECT * FROM agents WHERE handle = ?`).get(handle)
const persona = row.body

// AFTER
const row = db.prepare(`SELECT * FROM agents WHERE handle = ?`).get(handle)
const primary = db.prepare(
  `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
).get(row.id)
const persona = primary?.content ?? ''
```

- [ ] **Step 3: Manual sanity check via the MCP test connection action**

The Electron MCP test surface is wired through `mcp:testConnection` in main.ts. Open the app, go to Settings → MCP, and verify the launcher can serve an agent persona. (Or trust the IPC + sync tests covered indirectly.)

- [ ] **Step 4: Commit**

```bash
git add electron/mcp-launcher.cjs
git commit -m "$(cat <<'EOF'
refactor(agents): MCP launcher reads body from primary agent_files row

agent://<handle> URIs now resolve the persona from agent_files where
sort_order = 0, instead of the (now-removed) agents.body column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: UI

### Task 6: `AgentOverviewTab` component

**Files:**
- Create: `src/components/AgentOverviewTab.tsx`
- Create: `src/components/AgentOverviewTab.test.tsx`
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Write the failing tests**

Create `src/components/AgentOverviewTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentOverviewTab from './AgentOverviewTab'
import type { AgentRow, AgentFolderRow, AgentRevision, AgentPreset } from '../types/agent'

const baseAgent: AgentRow = {
  id: 'a-1', name: 'My Agent', handle: 'my-agent',
  folder_id: null, color_start: '#888', color_end: null, emoji: null,
  pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
  created_at: '2026-05-20T00:00:00Z', updated_at: '2026-05-25T00:00:00Z',
  description: 'A test agent.',
  origin_plugin: null, origin_path: null, origin_version: null, origin_imported_at: null,
  tools: null, model: 'inherit',
  is_subagent: 0, is_slash_command: 0, argument_hint: null,
  synced_subagent_at: null, synced_slash_command_at: null,
}

function setup(overrides: {
  agent?: Partial<AgentRow>
  folders?: AgentFolderRow[]
  liveBody?: string
  presets?: AgentPreset[]
  recentRevisions?: AgentRevision[]
  fileCount?: number
  activePresetId?: string | null
  onCopy?: () => void
  onOpenEditor?: () => void
  onTabChange?: (tab: string) => void
  onActivePresetChange?: (id: string | null) => void
} = {}) {
  const agent = { ...baseAgent, ...overrides.agent }
  const onCopy = overrides.onCopy ?? vi.fn()
  const onOpenEditor = overrides.onOpenEditor ?? vi.fn()
  const onTabChange = overrides.onTabChange ?? vi.fn()
  const onActivePresetChange = overrides.onActivePresetChange ?? vi.fn()
  render(
    <MemoryRouter>
      <AgentOverviewTab
        agent={agent}
        folders={overrides.folders ?? []}
        liveBody={overrides.liveBody ?? 'persona body'}
        presets={overrides.presets ?? []}
        activePresetId={overrides.activePresetId ?? null}
        recentRevisions={overrides.recentRevisions ?? []}
        fileCount={overrides.fileCount ?? 1}
        onCopy={onCopy}
        onOpenEditor={onOpenEditor}
        onTabChange={onTabChange}
        onActivePresetChange={onActivePresetChange}
      />
    </MemoryRouter>
  )
  return { onCopy, onOpenEditor, onTabChange, onActivePresetChange }
}

describe('AgentOverviewTab — hero', () => {
  it('renders description prominently', () => {
    setup({ agent: { description: 'A drafting partner.' } })
    expect(screen.getByText('A drafting partner.')).toBeTruthy()
  })

  it('falls back to derived description with hint when explicit description is empty', () => {
    setup({ agent: { description: '' }, liveBody: 'You are a helpful drafting partner.' })
    expect(screen.getByText(/Set an explicit description/i)).toBeTruthy()
  })

  it('shows the chip strip with folder/model/files/last-used', () => {
    setup({
      agent: { model: 'sonnet', last_used_at: new Date(Date.now() - 12 * 60_000).toISOString() },
      fileCount: 4,
    })
    expect(screen.getByText(/sonnet/i)).toBeTruthy()
    expect(screen.getByText(/4 files/i)).toBeTruthy()
    expect(screen.getByText(/12m ago/i)).toBeTruthy()
  })

  it('Copy button calls onCopy', () => {
    const { onCopy } = setup()
    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(onCopy).toHaveBeenCalled()
  })

  it('Open in editor button calls onOpenEditor', () => {
    const { onOpenEditor } = setup()
    fireEvent.click(screen.getByRole('button', { name: /open in editor/i }))
    expect(onOpenEditor).toHaveBeenCalled()
  })
})

describe('AgentOverviewTab — preset row', () => {
  it('hides the preset row when no presets exist', () => {
    setup({ presets: [] })
    expect(screen.queryByText(/active preset/i)).toBeNull()
  })

  it('shows the preset dropdown when presets exist', () => {
    const presets: AgentPreset[] = [
      { id: 'p1', name: 'Default', slug: 'default', values: {} },
      { id: 'p2', name: 'Concise', slug: 'concise', values: {} },
    ]
    setup({ presets, activePresetId: 'p1' })
    expect(screen.getByText(/active preset/i)).toBeTruthy()
    expect(screen.getByDisplayValue('Default')).toBeTruthy()
  })

  it('changing the preset calls onActivePresetChange', () => {
    const presets: AgentPreset[] = [
      { id: 'p1', name: 'Default', slug: 'default', values: {} },
      { id: 'p2', name: 'Concise', slug: 'concise', values: {} },
    ]
    const { onActivePresetChange } = setup({ presets, activePresetId: 'p1' })
    fireEvent.change(screen.getByLabelText(/active preset/i), { target: { value: 'p2' } })
    expect(onActivePresetChange).toHaveBeenCalledWith('p2')
  })
})

describe('AgentOverviewTab — surface cards', () => {
  it('shows "Disabled" for both surfaces when neither is enabled', () => {
    setup()
    expect(screen.getAllByText(/disabled/i).length).toBeGreaterThanOrEqual(2)
  })

  it('shows synced state when subagent is enabled and synced', () => {
    setup({
      agent: {
        is_subagent: 1,
        synced_subagent_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      },
    })
    expect(screen.getByText(/synced/i)).toBeTruthy()
    expect(screen.getByText(/2h ago/i)).toBeTruthy()
  })
})

describe('AgentOverviewTab — variables card', () => {
  it('hides the variables card when body has no variables', () => {
    setup({ liveBody: 'plain text, no placeholders' })
    expect(screen.queryByText(/variables/i)).toBeNull()
  })

  it('shows detected variables when body contains {{var}}', () => {
    setup({ liveBody: 'Hello {{topic}}, please {{action}}.' })
    expect(screen.getByText(/{{topic}}/)).toBeTruthy()
    expect(screen.getByText(/{{action}}/)).toBeTruthy()
  })
})

describe('AgentOverviewTab — recent revisions', () => {
  it('shows empty state when no revisions', () => {
    setup({ recentRevisions: [] })
    expect(screen.getByText(/no revisions yet/i)).toBeTruthy()
  })

  it('lists up to 3 most-recent revisions', () => {
    const revisions: AgentRevision[] = [
      { id: 'r1', agent_id: 'a-1', body: '', presets: [], summary: 'Edited body',  kind: 'body_edit', created_at: new Date().toISOString() },
      { id: 'r2', agent_id: 'a-1', body: '', presets: [], summary: 'Added preset', kind: 'preset_change', created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 'r3', agent_id: 'a-1', body: '', presets: [], summary: 'Renamed',      kind: 'preset_change', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 'r4', agent_id: 'a-1', body: '', presets: [], summary: 'Created',      kind: 'create', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    ]
    setup({ recentRevisions: revisions })
    expect(screen.getByText('Edited body')).toBeTruthy()
    expect(screen.getByText('Added preset')).toBeTruthy()
    expect(screen.getByText('Renamed')).toBeTruthy()
    expect(screen.queryByText('Created')).toBeNull()
  })

  it('"View all" link triggers tab change to history', () => {
    const revisions: AgentRevision[] = [
      { id: 'r1', agent_id: 'a-1', body: '', presets: [], summary: 'Edited body', kind: 'body_edit', created_at: new Date().toISOString() },
    ]
    const { onTabChange } = setup({ recentRevisions: revisions })
    fireEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(onTabChange).toHaveBeenCalledWith('history')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run AgentOverviewTab`
Expected: FAIL — `Failed to resolve import "./AgentOverviewTab"`.

- [ ] **Step 3: Implement the component**

Create `src/components/AgentOverviewTab.tsx`:

```tsx
import { Copy, Edit3, Folder, FileText, Clock, Settings as SettingsIcon, ChevronRight, Star } from 'lucide-react'
import type { AgentRow, AgentFolderRow, AgentPreset, AgentRevision } from '../types/agent'
import { parseAgentTools } from '../types/agent'
import { detectVariables } from '../utils/agentVariables'
import { relativeTime } from '../utils/relativeTime'
import { deriveDescription } from '../utils/copyPayload'

interface Props {
  agent: AgentRow
  folders: AgentFolderRow[]
  liveBody: string
  presets: AgentPreset[]
  activePresetId: string | null
  recentRevisions: AgentRevision[]
  fileCount: number
  onCopy: () => void
  onOpenEditor: () => void
  onTabChange: (tab: 'preview' | 'mcp' | 'history' | 'files' | 'settings') => void
  onActivePresetChange: (id: string | null) => void
}

export default function AgentOverviewTab({
  agent, folders, liveBody, presets, activePresetId, recentRevisions, fileCount,
  onCopy, onOpenEditor, onTabChange, onActivePresetChange,
}: Props) {
  const folderName = agent.folder_id === null ? 'Unfiled'
    : folders.find(f => f.id === agent.folder_id)?.name ?? 'Unfiled'
  const tools = parseAgentTools(agent.tools)
  const variables = detectVariables(liveBody)
  const description = agent.description?.trim() || deriveDescription(liveBody)
  const hasExplicitDescription = (agent.description?.trim() ?? '').length > 0
  const top3Revisions = recentRevisions.slice(0, 3)

  return (
    <div className="agent-overview">
      {/* Hero card */}
      <section className="agent-overview-hero">
        <p className={'agent-overview-description' + (hasExplicitDescription ? '' : ' agent-overview-description--derived')}>
          {description}
        </p>
        {!hasExplicitDescription && (
          <p className="agent-overview-hint">Set an explicit description in Settings.</p>
        )}
        <div className="agent-overview-chips">
          <span className="agent-overview-chip"><Folder size={11} /> {folderName}</span>
          <span className="agent-overview-chip"><SettingsIcon size={11} /> {agent.model}</span>
          {tools !== null && tools.length > 0 && (
            <span className="agent-overview-chip">🔧 {tools.length} tools</span>
          )}
          <span className="agent-overview-chip"><FileText size={11} /> {fileCount} files</span>
          {agent.last_used_at && (
            <span className="agent-overview-chip"><Clock size={11} /> used {relativeTime(agent.last_used_at)}</span>
          )}
        </div>

        {presets.length > 0 && (
          <div className="agent-overview-preset-row">
            <label htmlFor="overview-active-preset" className="agent-overview-preset-label">
              Active preset
            </label>
            <select
              id="overview-active-preset"
              value={activePresetId ?? ''}
              onChange={e => onActivePresetChange(e.target.value || null)}
              className="agent-overview-preset-select"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {variables.length > 0 && (
              <div className="agent-overview-var-chips">
                {variables.map(v => (
                  <span key={v} className="agent-overview-var-chip">{`{{${v}}}`}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="agent-overview-actions">
          <button type="button" className="agent-overview-btn agent-overview-btn--primary" onClick={onCopy}>
            <Copy size={13} /> Copy prompt
          </button>
          <button type="button" className="agent-overview-btn" onClick={onOpenEditor}>
            <Edit3 size={13} /> Open in editor <ChevronRight size={13} />
          </button>
        </div>
      </section>

      <div className="agent-overview-split">
        {/* Left column */}
        <div className="agent-overview-col">
          <SurfaceSummaryCard
            kind="subagent"
            enabled={agent.is_subagent === 1}
            syncedAt={agent.synced_subagent_at}
            onConfigure={() => onTabChange('settings')}
          />
          <SurfaceSummaryCard
            kind="slashCommand"
            enabled={agent.is_slash_command === 1}
            syncedAt={agent.synced_slash_command_at}
            onConfigure={() => onTabChange('settings')}
          />
          {variables.length > 0 && (
            <div className="agent-overview-card">
              <h4>Variables</h4>
              <div className="agent-overview-var-chips">
                {variables.map(v => (
                  <span key={v} className="agent-overview-var-chip">{`{{${v}}}`}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="agent-overview-col">
          <div className="agent-overview-card">
            <h4>Files <span className="agent-overview-card-meta">{fileCount}</span></h4>
            <FilesPreview
              agentHandle={agent.handle}
              fileCount={fileCount}
              onOpenEditor={onOpenEditor}
            />
          </div>
          <div className="agent-overview-card">
            <h4>Recent revisions</h4>
            {top3Revisions.length === 0 ? (
              <p className="agent-overview-empty">No revisions yet</p>
            ) : (
              <>
                <ul className="agent-overview-revisions">
                  {top3Revisions.map(r => (
                    <li key={r.id}>
                      <span>{r.summary}</span>
                      <span className="agent-overview-revision-time">{relativeTime(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="agent-overview-link"
                  onClick={() => onTabChange('history')}
                >
                  View all <ChevronRight size={11} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SurfaceSummaryCardProps {
  kind: 'subagent' | 'slashCommand'
  enabled: boolean
  syncedAt: string | null
  onConfigure: () => void
}

function SurfaceSummaryCard({ kind, enabled, syncedAt, onConfigure }: SurfaceSummaryCardProps) {
  const label = kind === 'subagent' ? 'Subagent' : 'Slash command'
  return (
    <div className="agent-overview-card">
      <h4>{label}</h4>
      {!enabled ? (
        <p className="agent-overview-empty">
          Disabled ·{' '}
          <button type="button" className="agent-overview-link" onClick={onConfigure}>
            Enable in Settings <ChevronRight size={11} />
          </button>
        </p>
      ) : syncedAt ? (
        <p className="agent-overview-synced">
          <Star size={11} /> Synced {relativeTime(syncedAt)}
        </p>
      ) : (
        <p className="agent-overview-empty">Pending sync — will sync on next save</p>
      )}
    </div>
  )
}

interface FilesPreviewProps {
  agentHandle: string
  fileCount: number
  onOpenEditor: () => void
}

function FilesPreview({ agentHandle, fileCount, onOpenEditor }: FilesPreviewProps) {
  return (
    <div className="agent-overview-files-preview">
      <button type="button" className="agent-overview-file agent-overview-file--primary" onClick={onOpenEditor}>
        <Star size={11} /> {agentHandle}.md
      </button>
      {fileCount > 1 && (
        <button type="button" className="agent-overview-link" onClick={onOpenEditor}>
          + {fileCount - 1} more <ChevronRight size={11} />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add styles**

Append to `src/views/AgentDetail.css`:

```css
/* Overview tab */
.agent-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.agent-overview-hero {
  background: var(--surface-elev-1, #15151a);
  border: 1px solid var(--border, #25252d);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-overview-description {
  font-size: 15px;
  line-height: 1.5;
  margin: 0;
  color: var(--text, #ddd);
}
.agent-overview-description--derived { color: var(--text-muted, #aaa); }
.agent-overview-hint { font-size: 11px; color: var(--text-muted, #888); margin: 0; }

.agent-overview-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.agent-overview-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-elev-2, #25252d);
  padding: 3px 8px; border-radius: 4px;
  font-size: 11px; color: var(--text-muted, #aaa);
}

.agent-overview-preset-row {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding-top: 4px;
}
.agent-overview-preset-label { font-size: 11px; color: var(--text-muted, #888); }
.agent-overview-preset-select {
  background: var(--surface-elev-2, #25252d);
  color: var(--text, #ddd);
  border: 1px solid var(--border, #35353d);
  border-radius: 4px;
  padding: 3px 6px; font-size: 12px;
}
.agent-overview-var-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.agent-overview-var-chip {
  background: rgba(107, 95, 232, 0.15);
  color: var(--accent, #6b5fe8);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  padding: 2px 6px; border-radius: 3px;
}

.agent-overview-actions { display: flex; gap: 8px; }
.agent-overview-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-elev-2, #2a2a32);
  color: var(--text, #ddd);
  border: 1px solid var(--border, #35353d);
  border-radius: 4px;
  padding: 6px 10px; font-size: 12px;
  cursor: pointer;
}
.agent-overview-btn:hover { background: var(--surface-elev-3, #35353d); }
.agent-overview-btn--primary {
  background: var(--accent, #6b5fe8);
  color: #fff;
  border-color: var(--accent, #6b5fe8);
}
.agent-overview-btn--primary:hover { filter: brightness(1.1); }

.agent-overview-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.agent-overview-col { display: flex; flex-direction: column; gap: 12px; }

.agent-overview-card {
  background: var(--surface-elev-1, #15151a);
  border: 1px solid var(--border, #25252d);
  border-radius: 6px;
  padding: 10px 14px;
  display: flex; flex-direction: column; gap: 6px;
}
.agent-overview-card h4 {
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted, #6a6a75);
  margin: 0;
  display: flex; align-items: center; justify-content: space-between;
}
.agent-overview-card-meta { color: var(--text-muted, #6a6a75); font-weight: 400; }

.agent-overview-empty { font-size: 12px; color: var(--text-muted, #888); margin: 0; }
.agent-overview-synced { font-size: 12px; color: var(--success, #6ec07a); display: inline-flex; align-items: center; gap: 4px; margin: 0; }
.agent-overview-link {
  background: none; border: none; padding: 0;
  color: var(--accent, #6b5fe8); font-size: 12px;
  cursor: pointer; display: inline-flex; align-items: center; gap: 2px;
}

.agent-overview-files-preview { display: flex; flex-direction: column; gap: 4px; }
.agent-overview-file {
  background: none; border: none; text-align: left; padding: 4px 0;
  color: var(--text, #ddd); font-family: ui-monospace, monospace;
  font-size: 12px; cursor: pointer;
}
.agent-overview-file--primary { color: var(--accent, #6b5fe8); font-weight: 600; }
.agent-overview-file--primary:hover { text-decoration: underline; }

.agent-overview-revisions { list-style: none; padding: 0; margin: 0; }
.agent-overview-revisions li {
  display: flex; justify-content: space-between;
  font-size: 12px; padding: 3px 0;
  color: var(--text, #ddd);
}
.agent-overview-revision-time { color: var(--text-muted, #888); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run AgentOverviewTab`
Expected: PASS — all component tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentOverviewTab.tsx src/components/AgentOverviewTab.test.tsx src/views/AgentDetail.css
git commit -m "$(cat <<'EOF'
feat(agents): AgentOverviewTab — hero + 2-column dashboard

New component for the Overview tab (replaces Prompt). Hero card with
description, chip strip (folder, model, tools, files, last used), preset
selector + variable chips when presets exist, and Copy/Open-in-editor
actions. Left column: subagent + slash-command summary cards, variables
card. Right column: files preview, recent revisions.

Component is pure — receives data and callbacks from AgentDetail. Wiring
into AgentDetail happens in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: AgentDetail — wire Overview, drop Prompt, fetch primary content

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

This is the heaviest UI task — removing the Prompt tab, adding Overview, switching body reads/writes to `agents.files.update` on the primary file row, and routing the preset state through Overview.

- [ ] **Step 1: Update the AgentDetail tests**

Edit `src/views/AgentDetail.test.tsx`:

**1a.** Update the `makeApi` helper to mock `agents.primaryContent` and `agents.files`:

```ts
function makeApi() {
  return {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [baseAgent] }),
      update: vi.fn().mockResolvedValue(baseAgent),
      delete: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn().mockResolvedValue({ ...baseAgent, id: 'a-dup', handle: 'my-agent-copy' }),
      primaryContent: vi.fn().mockResolvedValue({
        id: 'pf-a-1', filename: 'my-agent.md', content: 'persona body', updated_at: baseAgent.updated_at,
      }),
      // … existing entries for revisions, files, mcp, sync, etc. unchanged
      files: {
        list: vi.fn().mockResolvedValue([
          { id: 'pf-a-1', agent_id: 'a-1', filename: 'my-agent.md', content: 'persona body',
            sort_order: 0, created_at: '', updated_at: '' },
        ]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
      // … sync, mcp, onChanged, etc.
    },
  }
}
```

**1b.** Remove tests that asserted the Prompt tab exists or its placeholder text. Add new tests for the Overview tab:

```tsx
describe('AgentDetail — Overview tab (default)', () => {
  it('default activeTab is overview', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /overview/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('no Prompt tab in the bar', async () => {
    setup()
    await waitForLoaded()
    expect(screen.queryByRole('tab', { name: /prompt/i })).toBeNull()
  })

  it('fetches primary content on agent load', async () => {
    setup()
    await waitForLoaded()
    expect((window as any).api.agents.primaryContent).toHaveBeenCalledWith('a-1')
  })

  it('Copy button on Overview copies the full persona payload', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    await waitFor(() => expect((navigator.clipboard.writeText as any)).toHaveBeenCalled())
  })

  it('Open in editor button switches to Files tab', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /open in editor/i }))
    expect(screen.getByRole('tab', { name: /files/i }).getAttribute('aria-selected')).toBe('true')
  })
})
```

**1c.** Update / remove any test that called `setActiveTab('prompt')` or interacted with the textarea via the Prompt tab. Body editing tests now live in `AgentFilesTab.test.tsx` (Task 8).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run AgentDetail.test`
Expected: FAIL — Overview tab doesn't exist; Prompt tab is still there.

- [ ] **Step 3: Update `AgentDetail.tsx`**

In `src/views/AgentDetail.tsx`:

**3a.** Update imports (drop ReactMarkdown / remarkGfm if Preview tab still renders them — keep if so; add Overview component):

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Pin, Folder, FileText, Clock, Eye, Plug, Settings as SettingsIcon, CopyPlus, Trash2, Zap, LayoutDashboard } from 'lucide-react'
import type { AgentRow, AgentFolderRow, AgentRevision, AgentPreset } from '../types/agent'
import { parseAgentPresets, parseAgentTools } from '../types/agent'
import { useToast } from '../contexts/Toast'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'
import { detectVariables } from '../utils/agentVariables'
import { AGENT_SCOPE, formatScopedHandle } from '../utils/agentScope'
import { isValidHandle } from '../utils/agentSlug'
import AgentVariablePresetBar from '../components/AgentVariablePresetBar'
import AgentHistoryTimeline from '../components/AgentHistoryTimeline'
import AgentSwatchPopover from '../components/AgentSwatchPopover'
import AgentFilesTab from '../components/AgentFilesTab'
import AgentOverviewTab from '../components/AgentOverviewTab'
import { ModelDropdown } from '../components/ModelDropdown'
import { ToolsPicker } from '../components/ToolsPicker'
import { SurfaceToggle } from '../components/SurfaceToggle'
import './AgentDetail.css'
```

**3b.** Update the `activeTab` union and default:

```tsx
type ActiveTab = 'overview' | 'preview' | 'mcp' | 'history' | 'files' | 'settings'
type SaveStatus = 'idle' | 'saving' | 'saved'

export default function AgentDetail() {
  // …
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  // …
}
```

In the `useEffect` that resets state on id change, replace `setActiveTab('prompt')` with `setActiveTab('overview')`.

**3c.** Replace the body-from-agent fetch flow with a primary-content fetch flow. Update the agent-load effect:

```tsx
useEffect(() => {
  if (!id) return
  let cancelled = false
  setNameEditing(false)
  setActiveTab('overview')
  setRevisions([])
  setRevisionsLoaded(false)
  if (bodyTimer.current) { clearTimeout(bodyTimer.current); bodyTimer.current = null }
  if (nameTimer.current) { clearTimeout(nameTimer.current); nameTimer.current = null }
  ;(async () => {
    const [{ folders, agents }, primary] = await Promise.all([
      window.api.agents.getAll(),
      window.api.agents.primaryContent(id),
    ])
    if (cancelled) return
    setFolders(folders)
    const a = agents.find(x => x.id === id) ?? null
    setAgent(a)
    setBodyDraft(primary.content)
    setNameDraft(a?.name ?? '')
    setTakenHandles(agents.filter(x => x.id !== id).map(x => x.handle))
    setPrimaryFileId(primary.id)
  })()
  return () => { cancelled = true }
}, [id])
```

Add a new state for the primary file's row id:

```tsx
const [primaryFileId, setPrimaryFileId] = useState<string | null>(null)
```

**3d.** Replace `scheduleSaveBody` to write through `agents:files:update` on the primary row:

```tsx
const scheduleSaveBody = useCallback((value: string) => {
  if (!id || !primaryFileId) return
  setSaveStatus('saving')
  if (bodyTimer.current) clearTimeout(bodyTimer.current)
  bodyTimer.current = setTimeout(async () => {
    try {
      await window.api.agents.files.update(id, primaryFileId, { content: value })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('idle')
    }
  }, 1500)
}, [id, primaryFileId])
```

Also update the `onChanged` listener to refresh primary content alongside the agent row:

```tsx
useEffect(() => {
  if (!id) return
  const cb = async () => {
    const [{ agents }, primary] = await Promise.all([
      window.api.agents.getAll(),
      window.api.agents.primaryContent(id),
    ])
    const a = agents.find(x => x.id === id) ?? null
    setAgent(a)
    if (!bodyTimer.current) setBodyDraft(primary.content)
    if (!nameEditingRef.current) setNameDraft(a?.name ?? '')
    setTakenHandles(agents.filter(x => x.id !== id).map(x => x.handle))
    setPrimaryFileId(primary.id)
  }
  window.api.agents.onChanged(cb)
  return () => window.api.agents.offChanged(cb)
}, [id])
```

**3e.** Remove the Prompt tab from the nav and its conditional rendering block. In the `<nav>`, replace the `'prompt'` tab button with `'overview'`:

```tsx
<button
  type="button"
  role="tab"
  aria-selected={activeTab === 'overview'}
  className="agent-detail-tab"
  onClick={() => setActiveTab('overview')}
>
  <LayoutDashboard size={13} /> Overview
</button>
{/* … remaining tabs unchanged */}
```

In the body region, replace the `{activeTab === 'prompt' && (…)}` block with:

```tsx
{activeTab === 'overview' && (
  <AgentOverviewTab
    agent={agent}
    folders={folders}
    liveBody={liveBody}
    presets={presets}
    activePresetId={activePresetId}
    recentRevisions={revisions}
    fileCount={fileCount}
    onCopy={handleCopy}
    onOpenEditor={() => setActiveTab('files')}
    onTabChange={setActiveTab}
    onActivePresetChange={setActivePresetId}
  />
)}
```

**3f.** Compute `fileCount` (used for the chip + Files card). Add a state for it that updates from the `onChanged` flow, or fetch it inline with the agent load:

```tsx
const [fileCount, setFileCount] = useState(1)

useEffect(() => {
  if (!id) return
  let cancelled = false
  ;(async () => {
    const files = await window.api.agents.files.list(id)
    if (!cancelled) setFileCount(files.length)
  })()
  return () => { cancelled = true }
}, [id, agent?.updated_at])
```

(Using `agent?.updated_at` as the dep ensures refetch when changes broadcast through `onChanged`.)

**3g.** Update the Preview tab to render from `liveBody`:

```tsx
{activeTab === 'preview' && (
  <div className="agent-detail-rendered">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveBody}</ReactMarkdown>
  </div>
)}
```

**3h.** Move `AgentVariablePresetBar` out of the (removed) Prompt tab. It already lives in AgentDetail's render — verify the props still reference state that exists. The bar will appear in the Files tab when the primary file is the active editor (handled in Task 8). For Overview, the preset row inside `AgentOverviewTab` itself provides the preset selector.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run AgentDetail.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "$(cat <<'EOF'
feat(agents): AgentDetail wires Overview tab, drops Prompt

Default activeTab is now 'overview'. The Prompt tab branch is removed.
Body content is fetched via agents:primaryContent(id) on agent load and
on 'agents:changed' broadcasts; bodyDraft writes route through
agents.files.update on the primary file row id.

Preview tab renders liveBody. AgentOverviewTab receives all derived data
and callbacks; preset state lives at this level and is shared between
Overview's hero row and the Files-tab variable bar (Task 8).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: AgentFilesTab — drop `'main'` synthetic, primary marker, guards

**Files:**
- Modify: `src/components/AgentFilesTab.tsx`
- Create: `src/components/AgentFilesTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/AgentFilesTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentFilesTab from './AgentFilesTab'
import type { AgentRow, AgentFile } from '../types/agent'

const baseAgent: AgentRow = {
  id: 'a-1', name: 'Test', handle: 'my-agent',
  folder_id: null, color_start: '#888', color_end: null, emoji: null,
  pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
  created_at: '', updated_at: '',
  description: '', origin_plugin: null, origin_path: null, origin_version: null, origin_imported_at: null,
  tools: null, model: 'inherit',
  is_subagent: 0, is_slash_command: 0, argument_hint: null,
  synced_subagent_at: null, synced_slash_command_at: null,
}

const primaryFile: AgentFile = {
  id: 'pf-a-1', agent_id: 'a-1', filename: 'my-agent.md',
  content: 'persona body', sort_order: 0,
  created_at: '', updated_at: '',
}

const siblingFile: AgentFile = {
  id: 'f-2', agent_id: 'a-1', filename: 'reference.md',
  content: 'reference content', sort_order: 1,
  created_at: '', updated_at: '',
}

function setup(files: AgentFile[] = [primaryFile, siblingFile]) {
  const list = vi.fn().mockResolvedValue(files)
  const update = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn().mockResolvedValue(undefined)
  const create = vi.fn().mockResolvedValue(undefined)
  ;(window as any).api = {
    agents: {
      files: { list, update, delete: del, create },
    },
  }
  render(<AgentFilesTab agent={baseAgent} />)
  return { list, update, delete: del, create }
}

describe('AgentFilesTab — primary file marker', () => {
  it('marks the primary file with a star', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('my-agent.md')).toBeTruthy())
    const primaryRow = screen.getByText('my-agent.md').closest('[data-file-id]')
    expect(primaryRow?.querySelector('.agent-file-primary-mark')).toBeTruthy()
  })

  it('does not mark sibling files with a star', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('reference.md')).toBeTruthy())
    const sibRow = screen.getByText('reference.md').closest('[data-file-id]')
    expect(sibRow?.querySelector('.agent-file-primary-mark')).toBeNull()
  })
})

describe('AgentFilesTab — primary file guards', () => {
  it('delete button is disabled / hidden for the primary file when primary is active', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('my-agent.md')).toBeTruthy())
    fireEvent.click(screen.getByText('my-agent.md'))
    const deleteBtn = screen.queryByRole('button', { name: /delete/i })
    expect(deleteBtn === null || (deleteBtn as HTMLButtonElement).disabled).toBeTruthy()
  })

  it('rename button is disabled / hidden for the primary file when primary is active', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('my-agent.md')).toBeTruthy())
    fireEvent.click(screen.getByText('my-agent.md'))
    const renameBtn = screen.queryByRole('button', { name: /rename/i })
    expect(renameBtn === null || (renameBtn as HTMLButtonElement).disabled).toBeTruthy()
  })

  it('delete + rename are available for sibling files', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('reference.md')).toBeTruthy())
    fireEvent.click(screen.getByText('reference.md'))
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /rename/i })).not.toBeDisabled()
  })
})

describe('AgentFilesTab — no synthetic main', () => {
  it('does not render a "main" or SKILL.md placeholder when there are no files', async () => {
    setup([])
    await waitFor(() => expect(screen.queryByText(/SKILL\.md/i)).toBeNull())
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npm test -- --run AgentFilesTab.test`
Expected: FAIL — primary mark CSS class doesn't exist; guards aren't in place; the synthetic `'main'` may still render `SKILL.md`.

- [ ] **Step 3: Refactor `AgentFilesTab.tsx`**

Replace the entire component (this is a meaningful rewrite — primary file is no longer synthetic):

```tsx
import { useEffect, useState } from 'react'
import { FileText, Plus, Edit3, Trash2, Star } from 'lucide-react'
import type { AgentRow, AgentFile } from '../types/agent'
import AgentVariablePresetBar from './AgentVariablePresetBar'
import { detectVariables } from '../utils/agentVariables'
import { parseAgentPresets } from '../types/agent'

interface Props {
  agent: AgentRow
  activePresetId?: string | null
  onActivePresetChange?: (id: string | null) => void
}

const SCRIPT_EXTS = new Set(['sh', 'js', 'cjs', 'mjs', 'ts', 'py', 'rb', 'go'])
const MD_EXTS = new Set(['md', 'mdx', 'txt'])

type SectionKey = 'reference' | 'script' | 'other'

function classifyFile(filename: string, isPrimary: boolean): SectionKey | 'primary' {
  if (isPrimary) return 'primary'
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (MD_EXTS.has(ext)) return 'reference'
  if (SCRIPT_EXTS.has(ext)) return 'script'
  return 'other'
}

export default function AgentFilesTab({ agent, activePresetId, onActivePresetChange }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.files.list(agent.id)
      if (!cancelled) {
        setFiles(list)
        // Default to the primary file on first load.
        if (activeId === null) {
          const primary = list.find(f => f.sort_order === 0)
          setActiveId(primary?.id ?? list[0]?.id ?? null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [agent.id])

  // Reset draft when the active file changes
  useEffect(() => {
    if (!activeId) { setDraft(''); return }
    const f = files.find(x => x.id === activeId)
    setDraft(f?.content ?? '')
  }, [activeId, files])

  const activeFile = activeId ? files.find(f => f.id === activeId) ?? null : null
  const isPrimaryActive = activeFile?.sort_order === 0
  const activeFilename = activeFile?.filename ?? ''

  const presets = parseAgentPresets(agent.presets_json)
  const variables = isPrimaryActive ? detectVariables(draft) : []

  const onBlurSave = async (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (!activeFile) return
    const value = e.target.value
    await window.api.agents.files.update(agent.id, activeFile.id, { content: value })
  }

  const handleRename = async () => {
    if (!activeFile || activeFile.sort_order === 0) return
    const next = window.prompt('New filename:', activeFile.filename)
    if (!next || next === activeFile.filename) return
    try {
      await window.api.agents.files.update(agent.id, activeFile.id, { filename: next })
      setFiles(await window.api.agents.files.list(agent.id))
    } catch (err) {
      window.alert(`Rename failed: ${(err as Error).message}`)
    }
  }

  const handleDelete = async () => {
    if (!activeFile || activeFile.sort_order === 0) return
    if (!window.confirm('Delete this file?')) return
    await window.api.agents.files.delete(agent.id, activeFile.id)
    setFiles(await window.api.agents.files.list(agent.id))
    setActiveId(null)
  }

  const handleNew = async () => {
    const name = window.prompt('New filename:')
    if (!name) return
    try {
      const f = await window.api.agents.files.create(agent.id, {
        filename: name,
        content: '',
        sortOrder: Math.max(0, ...files.map(x => x.sort_order)) + 1,
      })
      const next = await window.api.agents.files.list(agent.id)
      setFiles(next)
      setActiveId(f.id)
    } catch (err) {
      window.alert(`Create failed: ${(err as Error).message}`)
    }
  }

  const primaryFile = files.find(f => f.sort_order === 0)
  const references = files.filter(f => f.sort_order !== 0 && MD_EXTS.has(f.filename.split('.').pop()?.toLowerCase() ?? ''))
  const scripts    = files.filter(f => f.sort_order !== 0 && SCRIPT_EXTS.has(f.filename.split('.').pop()?.toLowerCase() ?? ''))
  const others     = files.filter(f => {
    if (f.sort_order === 0) return false
    const ext = f.filename.split('.').pop()?.toLowerCase() ?? ''
    return !MD_EXTS.has(ext) && !SCRIPT_EXTS.has(ext)
  })

  return (
    <div className="agent-files-tab">
      <aside className="agent-files-sidebar">
        {primaryFile && (
          <FileSection title="Persona">
            <FileEntry
              file={primaryFile}
              isActive={activeId === primaryFile.id}
              isPrimary
              onSelect={() => setActiveId(primaryFile.id)}
            />
          </FileSection>
        )}
        {references.length > 0 && (
          <FileSection title="References">
            {references.map(f => (
              <FileEntry key={f.id} file={f} isActive={activeId === f.id} onSelect={() => setActiveId(f.id)} />
            ))}
          </FileSection>
        )}
        {scripts.length > 0 && (
          <FileSection title="Scripts">
            {scripts.map(f => (
              <FileEntry key={f.id} file={f} isActive={activeId === f.id} onSelect={() => setActiveId(f.id)} />
            ))}
          </FileSection>
        )}
        {others.length > 0 && (
          <FileSection title="Other">
            {others.map(f => (
              <FileEntry key={f.id} file={f} isActive={activeId === f.id} onSelect={() => setActiveId(f.id)} />
            ))}
          </FileSection>
        )}
        <button type="button" className="agent-file-new-btn" onClick={handleNew}>
          <Plus size={11} /> New file
        </button>
      </aside>

      <section className="agent-files-editor">
        <header className="agent-files-editor-header">
          <span className="agent-files-editor-filename">
            {isPrimaryActive && <Star size={11} />} {activeFilename || 'Select a file'}
          </span>
          {activeFile && !isPrimaryActive && (
            <div className="agent-files-editor-actions">
              <button type="button" onClick={handleRename}><Edit3 size={11} /> Rename</button>
              <button type="button" onClick={handleDelete}><Trash2 size={11} /> Delete</button>
            </div>
          )}
        </header>
        {isPrimaryActive && presets.length > 0 && onActivePresetChange && (
          <AgentVariablePresetBar
            agent={agent}
            variables={variables}
            activePresetId={activePresetId ?? null}
            onActivePresetChange={onActivePresetChange}
          />
        )}
        {activeFile ? (
          <textarea
            className="agent-files-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={onBlurSave}
            aria-label={`Edit ${activeFilename}`}
          />
        ) : (
          <p className="agent-files-empty">Select a file from the left to edit, or create a new one.</p>
        )}
      </section>
    </div>
  )
}

function FileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="agent-file-section">
      <h5>{title}</h5>
      {children}
    </div>
  )
}

function FileEntry({
  file, isActive, isPrimary = false, onSelect,
}: {
  file: AgentFile; isActive: boolean; isPrimary?: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-file-id={file.id}
      className={'agent-file-entry' + (isActive ? ' agent-file-entry--active' : '')}
      onClick={onSelect}
    >
      {isPrimary && <Star size={11} className="agent-file-primary-mark" />}
      <FileText size={11} /> {file.filename}
    </button>
  )
}
```

**Notes:**
- `activePresetId` and `onActivePresetChange` are passed down from `AgentDetail` (they live there). The preset bar only renders when the primary file is the active editor.
- Sibling files (`sort_order > 0`) can be deleted/renamed; primary cannot.
- The previous synthetic `'main'` activeId code path is gone — every file in the UI corresponds to an `agent_files` row.

**Update the AgentFilesTab call in `AgentDetail.tsx`** to pass the preset props:

```tsx
{activeTab === 'files' && (
  <AgentFilesTab
    agent={agent}
    activePresetId={activePresetId}
    onActivePresetChange={setActivePresetId}
  />
)}
```

- [ ] **Step 4: Add styles**

Append to `src/views/AgentDetail.css`:

```css
/* Files tab refactor */
.agent-file-primary-mark { color: var(--accent, #6b5fe8); }
.agent-file-entry--active .agent-file-primary-mark { color: #fff; }
.agent-file-section { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
.agent-file-section h5 {
  font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted, #6a6a75);
  margin: 4px 8px;
}
.agent-file-entry {
  display: flex; align-items: center; gap: 4px;
  background: none; border: none;
  color: var(--text, #ddd);
  font-size: 12px; padding: 4px 8px;
  text-align: left; cursor: pointer;
  border-radius: 3px;
}
.agent-file-entry:hover { background: var(--surface-elev-2, #25252d); }
.agent-file-entry--active { background: var(--accent, #6b5fe8); color: #fff; }
.agent-file-new-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: none; border: 1px dashed var(--border, #35353d);
  color: var(--text-muted, #888);
  padding: 4px 8px; border-radius: 3px;
  font-size: 11px; cursor: pointer;
  margin: 8px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run AgentFilesTab.test`
Expected: PASS.

Also run the full agent suite:

Run: `npm test -- --run agent 2>&1 | tail -20`
Expected: All passing now that AgentDetail + AgentFilesTab + AgentOverviewTab are wired.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentFilesTab.tsx src/components/AgentFilesTab.test.tsx src/views/AgentDetail.tsx src/views/AgentDetail.css
git commit -m "$(cat <<'EOF'
refactor(agents): AgentFilesTab drops 'main' synthetic, marks primary file

The primary file (sort_order=0) is now a regular agent_files row in the
sidebar's "Persona" section, marked with a ★. Delete and rename are
disabled for it. The variable/preset bar shows above the editor when
the primary file is the active editor.

AgentDetail passes activePresetId + onActivePresetChange into Files tab
so preset state is shared with Overview's hero row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Type + column cleanup

### Task 9: Drop `agents.body` column + `AgentRow.body` field; stop dual-writing

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`
- Modify: `src/types/agent.ts`

By now (after Tasks 1–8), no code reads `agent.body` — every consumer routes through the primary file row. The column and field are dead writes. Drop them.

- [ ] **Step 1: Remove the field from `AgentRow`**

In `src/types/agent.ts`, locate `AgentRow` (around line 11) and remove the `body: string` line.

- [ ] **Step 2: Stop dual-writing `body` in `createAgent`**

In `electron/services/agentsService.ts`, update the `createAgent` INSERT to drop the `body` column from both the column list and values:

```ts
const insert = db.transaction(() => {
  db.prepare(`
    INSERT INTO agents (
      id, name, handle, folder_id, color_start, color_end, emoji, description,
      tools, model, is_subagent, is_slash_command, argument_hint,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, input.handle, input.folderId, input.colorStart, input.colorEnd, input.emoji, input.description ?? '',
    tools, model, isSubagent, isSlashCommand, argumentHint,
    ts, ts,
  )
  // Primary file row — sole source of truth.
  db.prepare(`
    INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(`pf-${id}`, id, `${input.handle}.md`, input.body, ts, ts)
})
insert()
```

- [ ] **Step 3: Stop dual-writing `body` in `updateAgent`**

In `electron/services/agentsService.ts`, remove the `body` column from the SET clause (it stays in the primary file UPDATE inside the transaction):

```ts
// REMOVE this block:
if (patch.body !== undefined) {
  assertBodyLen(patch.body)
  sets.push('body = ?'); params.push(patch.body)
}
```

But KEEP the `assertBodyLen` check — move it to where the patch.body branch starts. Inside the transaction, the primary-file `UPDATE` already exists from Task 2; that stays.

Restructure:

```ts
// Validate body length up-front
if (patch.body !== undefined) {
  assertBodyLen(patch.body)
}

// … sets builder for other columns unchanged (no body) …

const ts = nowIso()
const apply = db.transaction(() => {
  if (sets.length > 0) {
    sets.push('updated_at = ?'); params.push(ts)
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  if (patch.body !== undefined) {
    db.prepare(
      `UPDATE agent_files SET content = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
    ).run(patch.body, ts, id)
  }
  if (patch.handle !== undefined) {
    db.prepare(
      `UPDATE agent_files SET filename = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
    ).run(`${patch.handle}.md`, ts, id)
  }
})
apply()
```

Note: `updated_at` is only bumped on the agents row when there's at least one column in `sets`. If the patch contains only `body`, no other agents column changes — but we still want to track the edit. Update the logic:

```ts
const apply = db.transaction(() => {
  // Always bump updated_at when body changes, even if no other agents column changed
  const bumpUpdatedAt = sets.length > 0 || patch.body !== undefined
  if (bumpUpdatedAt && sets.length === 0) {
    db.prepare(`UPDATE agents SET updated_at = ? WHERE id = ?`).run(ts, id)
  } else if (sets.length > 0) {
    sets.push('updated_at = ?'); params.push(ts)
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  if (patch.body !== undefined) {
    db.prepare(
      `UPDATE agent_files SET content = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
    ).run(patch.body, ts, id)
  }
  if (patch.handle !== undefined) {
    db.prepare(
      `UPDATE agent_files SET filename = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
    ).run(`${patch.handle}.md`, ts, id)
  }
})
apply()
```

- [ ] **Step 4: Stop dual-writing `body` in `revertToRevision`**

```ts
const apply = db.transaction(() => {
  db.prepare(`UPDATE agents SET presets_json = ?, updated_at = ? WHERE id = ?`)
    .run(rev.presets_json, ts, agentId)
  db.prepare(
    `UPDATE agent_files SET content = ?, updated_at = ? WHERE agent_id = ? AND sort_order = 0`
  ).run(rev.body, ts, agentId)
})
apply()
```

- [ ] **Step 5: Drop the `body` column from the schema**

In `electron/db.ts`, after the Phase 26 backfill loop, add:

```ts
  // Phase 26 — Body-as-file (cont.): drop agents.body once every consumer
  // reads from the primary agent_files row. Wrapped in try/catch for
  // idempotency across re-runs.
  try { db.exec(`ALTER TABLE agents DROP COLUMN body`) } catch {}
```

Also update the agents-table `CREATE TABLE IF NOT EXISTS` block (around line 168) to drop the `body TEXT NOT NULL` line, so fresh databases match post-migration schema:

```sql
-- BEFORE:
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  handle      TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL,
  -- … rest
)

-- AFTER:
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  handle      TEXT NOT NULL UNIQUE,
  -- … rest (no body)
)
```

- [ ] **Step 6: Update the migration test from Task 1**

In `electron/db.body-to-primary-file.migration.test.ts`, update the "keeps the agents.body column intact" test to assert the column is now DROPPED:

```ts
it('drops the agents.body column after Task 9', () => {
  const cols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]
  expect(cols.map(c => c.name)).not.toContain('body')
})
```

Also update the `seedAgent` helper — it currently INSERTs with `body`. Since the column no longer exists in fresh DBs, the helper needs to remove `body` from the column list and instead seed via createAgent or by inserting the primary file row directly. Suggested update:

```ts
function seedAgent(db: Database.Database, overrides: Partial<{
  id: string; handle: string; body: string;
}> = {}) {
  const id = overrides.id ?? `a-${Math.random().toString(36).slice(2, 8)}`
  const handle = overrides.handle ?? 'my-agent'
  const body = overrides.body ?? 'Agent body content.'
  db.prepare(`
    INSERT INTO agents (id, name, handle, folder_id, color_start, color_end, emoji,
      created_at, updated_at, description, model)
    VALUES (?, 'Test', ?, NULL, '#888888', NULL, NULL,
      '2026-05-25T00:00:00.000Z', '2026-05-25T00:00:00.000Z', '', 'inherit')
  `).run(id, handle)
  // Primary file row — simulating what Phase 26 backfill or createAgent would do.
  db.prepare(`
    INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(`pf-${id}`, id, `${handle}.md`, body, '2026-05-25T00:00:00.000Z', '2026-05-25T00:00:00.000Z')
  return id
}
```

The "backfill" / "sort_order shift" / "idempotent" tests still work because they explicitly `DELETE FROM agent_files` before re-running `initSchema(db)`, exercising the backfill loop on the pre-existing agents row.

- [ ] **Step 7: TS check + full test run**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test -- --run agent 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add electron/db.ts electron/services/agentsService.ts electron/services/agentsService.test.ts electron/db.body-to-primary-file.migration.test.ts src/types/agent.ts
git commit -m "$(cat <<'EOF'
chore(agents): drop agents.body column + AgentRow.body field

Every consumer now reads body through the primary agent_files row. The
agents.body column has been dual-written by createAgent / updateAgent /
revertToRevision since Task 2 — those writes are now removed, the
column is dropped via Phase 26 (cont.), and AgentRow.body is removed
from the type.

The CREATE TABLE for agents drops body from the column list so fresh
databases match post-migration schema. Migration test updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Verification

### Task 10: Full test + TS sweep

**Files:**
- None (verification only)

- [ ] **Step 1: Full test run**

Run: `npm test 2>&1 | tail -20`
Expected: all suites pass.

- [ ] **Step 2: TS sweep**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Per the user's "no visual testing needed" preference, the developer does the smoke. Confirm with the user when their next session lands:

1. Open an existing agent — Overview is the default tab, hero + 2-column dashboard renders.
2. Click "Open in editor" — Files tab opens with `<handle>.md` selected.
3. Type in the textarea — saving works; the body persists after reload.
4. Rename the handle in the header — primary file's name (in Files sidebar) updates to match.
5. Toggle subagent on (in Settings); confirm the `~/.claude/agents/<handle>.md` file appears with the same content.
6. Delete the primary file in Files tab — blocked (button disabled or error toast).
7. Rename the primary file in Files tab — blocked.
8. Create a sibling file in Files — appears under References/Scripts/Other.
9. Add a preset; on Overview, the preset row shows; switching presets reflects in the preset chip.
10. Click Copy on Overview — clipboard contains the persona payload built from the primary file content + active preset.

- [ ] **Step 4: Hand off**

If everything is green and the smoke passes (or the user defers smoke to their own session), the implementation is complete. Mark the plan tasks as `[x]` and (per the project's branch policy) close the loop — no PR step.

---

## Notes for executors

- **No worktrees / branches.** This project's policy ([CLAUDE.md](../../CLAUDE.md)) is to commit directly to `main`. Each task ends in a commit on main.
- **`npm test`, not `npx vitest`** — direct vitest leaves better-sqlite3 built for Node ABI and breaks the Electron launch (the project's `test` script rebuilds for the right ABI; `posttest` rebuilds for Electron).
- **Pattern matching for tests:** `npm test -- --run <substring>` runs all test files whose path contains the substring.
- **Migration runs once on app launch.** The Phase 26 block in `electron/db.ts` runs every launch but is idempotent — pre-migrated agents are skipped.
- **Order of operations matters.** Each task leaves the branch green; do not skip ahead.
