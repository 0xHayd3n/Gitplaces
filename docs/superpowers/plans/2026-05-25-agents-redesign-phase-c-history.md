# Agents Redesign — Phase C (Edit History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the edit-history layer of the agents redesign — every body save and preset CRUD writes a snapshot to the existing `agent_revisions` table (from Phase A), retention is capped at 20 per agent, and the History tab in `AgentDetail` shows a timeline grouped by day with restore + diff-view actions.

**Architecture:** Three additive layers on top of Phases A and B. (1) `agentsService` gains a private `recordRevision` helper (with retention pruning) and hooks into the existing `createAgent` / `updateAgent` / preset CRUD entry points to snapshot at the right moments. (2) Two new IPC routes (`agents:revisions:list`, `agents:revisions:revert`) and a new broadcast event (`agents:revision-added`) so the History tab can append in place. (3) A new `AgentHistoryTimeline` React component renders revisions grouped by day, with kind-colored event dots, a simple side-by-side `<pre>` diff viewer for `body_edit` rows, and a Restore action that writes the older snapshot back + inserts a `revert` snapshot.

**Tech Stack:** Electron (main + renderer split), `better-sqlite3` for the DB, React 18, Vitest. No new runtime dependencies. Reuses the existing `DateDivider` component from `src/components/DateDivider.tsx`.

---

## Spec reference

This plan implements **Phase C** of `docs/superpowers/specs/2026-05-24-agents-library-redesign-design.md`. Read that spec first — this plan assumes familiarity with the data model and UI layouts. Phases A and B are on `main`.

**What Phase C includes:**
- Service-level `recordRevision(db, agentId, body, presetsJson, kind, summary)` with retention pruning (cap = 20 per agent).
- `createAgent` now records a `create` snapshot for newly-created agents (parity with Phase A's backfill, which already snapshotted pre-existing agents).
- `updateAgent` records a `body_edit` snapshot when `patch.body` actually changes (`old.body !== new.body`).
- `createPreset` / `updatePreset` / `deletePreset` / `duplicatePreset` each record a `preset_change` snapshot with a kind-specific summary.
- New service functions `listRevisions(db, agentId): AgentRevision[]` and `revertToRevision(db, agentId, revisionId): AgentRow`.
- New IPC routes: `agents:revisions:list`, `agents:revisions:revert`. New broadcast event: `agents:revision-added` (carries the new revision).
- `window.api.agents.revisions.{list, revert, onRevisionAdded, offRevisionAdded}` surface on the renderer.
- A new `AgentHistoryTimeline` component renders inside the History tab of `AgentDetail`. It groups revisions by day with `DateDivider`s, color-codes the event dot by `kind`, supports a Restore action (with confirm), and shows a simple side-by-side `<pre>` diff for adjacent body edits.
- AgentDetail subscribes to `agents:revision-added` and prepends new revisions to the visible list without a full refetch.

**What's NOT in Phase C (deferred):**
- `last_used_at` tracking via `recordUse` IPC (Phase D).
- AgentsLanding no-selection state (Phase D).
- Pin/Unpin UI (Phase D).
- MCP launcher script + MCP tab content (Phase D).
- Collapse-adjacent `preset_change` events into a single timeline row (potential follow-up; not in the spec).
- Word-level or syntax-aware diff viewer (the spec accepts a simple two-pane `<pre>`).

---

## File Structure

### New files

- **`src/components/AgentHistoryTimeline.tsx`** — controlled component. Props: `{ agent, revisions, onRestore }`. Renders revisions grouped by day with `DateDivider`s. Each row shows time, kind-colored dot, summary, optional diff stats, and hover-revealed actions (View diff / Restore). Diff viewer is a small inline two-column `<pre>` block toggleable per row.
- **`src/components/AgentHistoryTimeline.test.tsx`** — Vitest + RTL tests with a mocked `window.api`.

### Modified files

- **`electron/services/agentsService.ts`** — add private `recordRevision` helper + retention pruning; call it from `createAgent` (kind=`create`), `updateAgent` (kind=`body_edit` when body changes), `createPreset` / `updatePreset` / `deletePreset` / `duplicatePreset` (kind=`preset_change`); add public `listRevisions` + `revertToRevision`.
- **`electron/services/agentsService.test.ts`** — add a `describe('agentsService — revisions')` block covering snapshot triggers, retention cap, list ordering, revert behavior, and FK cascade on agent delete.
- **`electron/ipc/agentHandlers.ts`** — add two new `ipcMain.handle` routes (`agents:revisions:list`, `agents:revisions:revert`); broadcast `agents:revision-added` (carrying the new revision) inside `recordRevision` via a callback passed from the IPC layer — alternatively, emit it from the service. (See Task 5 for the chosen approach.)
- **`electron/preload.ts:166-215`** — extend `window.api.agents` with a `revisions: { list, revert }` namespace plus `onRevisionAdded` / `offRevisionAdded` listeners.
- **`src/env.d.ts:185-220`** — mirror the preload extension in the global `Window['api']` typing.
- **`src/views/AgentDetail.tsx`** — replace the History tab placeholder with `<AgentHistoryTimeline />`; fetch revisions when the History tab opens; subscribe to `agents:revision-added` and prepend new revisions to the local list.
- **`src/views/AgentDetail.test.tsx`** — extend existing tests to cover History tab fetch + restore + revision-added event.
- **`src/views/AgentDetail.css`** — append timeline + diff-viewer styling matching the existing accent purple / dark theme.

### Unchanged but worth knowing about

- **`src/components/DateDivider.tsx`** — already exists; export `DateDivider`. We reuse it directly.
- **`src/types/agent.ts`** — already has `AgentRevision` and `parseAgentPresets`. We add no new types in Phase C, but we will use `AgentRevision` heavily.

---

## Conventions

- **TDD**: write the failing test first, run it, implement, run it again, commit. Every task follows this rhythm.
- **Commits**: one logical change per commit. Conventional-commit style (`feat(agents):`, `refactor(agents):`, etc.) — matches the project's existing style visible in `git log`.
- **Test commands**: use `npm test -- <file>` to scope a single test file (which runs `npm rebuild better-sqlite3 && vitest run`). Do not invoke `npx vitest` directly — it leaves better-sqlite3 built for Node ABI and breaks the Electron launch afterward.
- **No emoji in code or commit messages** unless the user has asked for them explicitly.
- **Test environment markers**: renderer tests start with `// @vitest-environment jsdom`; main-process tests start with `// @vitest-environment node`. Match the existing convention in each file.
- **All AgentRow test fixtures** must include `presets_json: '[]'` plus the Phase A redesign fields (`handle`, `color_start`, etc.) — copy from existing test fixtures.

---

## Task 1: Service — `recordRevision` helper with retention

**Files:**
- Modify: `electron/services/agentsService.ts` (append at the END of the file)
- Modify: `electron/services/agentsService.test.ts` (append at the END of the file)

This task adds the foundation: a private `recordRevision` helper that inserts into `agent_revisions` and prunes older rows when count > 20. It does not wire any callers yet — Task 2 / Task 3 do that. Standalone tests verify the helper in isolation.

We export `recordRevision` from the module so the IPC layer can re-invoke it (for the broadcast wrapper in Task 5), but most callers go through Tasks 2/3's wrappers.

- [ ] **Step 1: Write the failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
import {
  recordRevision, listRevisions,
  REVISION_RETENTION,
} from './agentsService'

describe('agentsService — recordRevision + retention', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: '# A\nbody', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  it('inserts a revision and returns the row', () => {
    const rev = recordRevision(db, agentId, '# A\nv2', '[]', 'body_edit', 'Edited body')
    expect(rev.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rev.agent_id).toBe(agentId)
    expect(rev.body).toBe('# A\nv2')
    expect(rev.kind).toBe('body_edit')
    expect(rev.summary).toBe('Edited body')
    expect(rev.created_at).toMatch(/T/)
    expect(rev.presets).toEqual([])
  })

  it('parses presets_json into the returned revision.presets array', () => {
    const rev = recordRevision(
      db, agentId, '#', '[{"id":"p1","name":"x","slug":"x","values":{}}]',
      'preset_change', 'Added preset',
    )
    expect(rev.presets).toEqual([{ id: 'p1', name: 'x', slug: 'x', values: {} }])
  })

  it('REVISION_RETENTION is 20', () => {
    expect(REVISION_RETENTION).toBe(20)
  })

  it('prunes older revisions when count exceeds REVISION_RETENTION', () => {
    // createAgent doesn't snapshot yet (that's Task 2). Start clean.
    for (let i = 0; i < REVISION_RETENTION + 5; i++) {
      recordRevision(db, agentId, `v${i}`, '[]', 'body_edit', `edit ${i}`)
    }
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    expect(count).toBe(REVISION_RETENTION)
  })

  it('pruning keeps the most recent rows', () => {
    for (let i = 0; i < REVISION_RETENTION + 3; i++) {
      recordRevision(db, agentId, `v${i}`, '[]', 'body_edit', `edit ${i}`)
    }
    const summaries = (db.prepare(
      `SELECT summary FROM agent_revisions WHERE agent_id = ? ORDER BY created_at ASC`,
    ).all(agentId) as { summary: string }[]).map(r => r.summary)
    expect(summaries[0]).toBe('edit 3')
    expect(summaries[summaries.length - 1]).toBe(`edit ${REVISION_RETENTION + 2}`)
  })

  it('retention is per-agent — pruning one agent does not affect another', () => {
    const b = createAgent(db, { name: 'B', body: 'b', folderId: null, handle: 'b', colorStart: '#111111', colorEnd: null, emoji: null })
    for (let i = 0; i < REVISION_RETENTION + 5; i++) recordRevision(db, agentId, 'x', '[]', 'body_edit', `a${i}`)
    for (let i = 0; i < 3; i++) recordRevision(db, b.id, 'x', '[]', 'body_edit', `b${i}`)
    const aCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    const bCount = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(b.id) as { n: number }).n
    expect(aCount).toBe(REVISION_RETENTION)
    expect(bCount).toBe(3)
  })

  it('FK cascade: deleting the agent removes its revisions', () => {
    recordRevision(db, agentId, 'x', '[]', 'body_edit', 'e')
    recordRevision(db, agentId, 'y', '[]', 'body_edit', 'f')
    deleteAgent(db, agentId)
    const count = (db.prepare(`SELECT COUNT(*) as n FROM agent_revisions WHERE agent_id = ?`).get(agentId) as { n: number }).n
    expect(count).toBe(0)
  })
})

describe('agentsService — listRevisions', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    agentId = a.id
  })

  it('returns revisions newest first', async () => {
    recordRevision(db, agentId, 'v1', '[]', 'body_edit', 'first')
    await new Promise(r => setTimeout(r, 5))
    recordRevision(db, agentId, 'v2', '[]', 'body_edit', 'second')
    const revs = listRevisions(db, agentId)
    expect(revs[0].summary).toBe('second')
    expect(revs[1].summary).toBe('first')
  })

  it('returns an empty array when there are no revisions', () => {
    expect(listRevisions(db, agentId)).toEqual([])
  })

  it('throws on unknown agentId', () => {
    expect(() => listRevisions(db, 'no-such-agent')).toThrow(/agent/i)
  })

  it('parses presets_json on each row', () => {
    recordRevision(db, agentId, 'x', '[{"id":"p1","name":"x","slug":"x","values":{}}]', 'preset_change', 'p')
    const revs = listRevisions(db, agentId)
    expect(revs[0].presets).toEqual([{ id: 'p1', name: 'x', slug: 'x', values: {} }])
  })
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — `recordRevision`, `listRevisions`, `REVISION_RETENTION` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `electron/services/agentsService.ts`:

```ts
// ── Revisions ───────────────────────────────────────────────────────

import type { AgentRevision } from '../../src/types/agent'

export const REVISION_RETENTION = 20

type RevisionKind = 'create' | 'body_edit' | 'preset_change' | 'revert'

function pruneRevisions(db: Database.Database, agentId: string): void {
  // Delete all but the most-recent REVISION_RETENTION rows for this agent.
  db.prepare(`
    DELETE FROM agent_revisions
    WHERE agent_id = ?
      AND id NOT IN (
        SELECT id FROM agent_revisions
        WHERE agent_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      )
  `).run(agentId, agentId, REVISION_RETENTION)
}

function rowToRevision(row: {
  id: string; agent_id: string; body: string; presets_json: string;
  summary: string; kind: string; created_at: string;
}): AgentRevision {
  return {
    id: row.id,
    agent_id: row.agent_id,
    body: row.body,
    presets: parseAgentPresets(row.presets_json),
    summary: row.summary,
    kind: row.kind as RevisionKind,
    created_at: row.created_at,
  }
}

export function recordRevision(
  db: Database.Database,
  agentId: string,
  body: string,
  presetsJson: string,
  kind: RevisionKind,
  summary: string,
): AgentRevision {
  assertAgentExists(db, agentId)
  const id = randomUUID()
  const created_at = nowIso()
  db.prepare(`
    INSERT INTO agent_revisions (id, agent_id, body, presets_json, summary, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, body, presetsJson, summary, kind, created_at)
  pruneRevisions(db, agentId)
  // Re-read in case prune deleted what we just inserted (would only happen
  // if REVISION_RETENTION were 0 — defensive). Otherwise the row is fresh.
  const row = db.prepare(`SELECT * FROM agent_revisions WHERE id = ?`).get(id) as
    | { id: string; agent_id: string; body: string; presets_json: string; summary: string; kind: string; created_at: string }
    | undefined
  if (!row) throw new Error('Revision was pruned immediately on insert (REVISION_RETENTION misconfigured)')
  return rowToRevision(row)
}

export function listRevisions(db: Database.Database, agentId: string): AgentRevision[] {
  assertAgentExists(db, agentId)
  const rows = db.prepare(`
    SELECT * FROM agent_revisions
    WHERE agent_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(agentId) as {
    id: string; agent_id: string; body: string; presets_json: string;
    summary: string; kind: string; created_at: string;
  }[]
  return rows.map(rowToRevision)
}
```

Note: foreign-key cascade behavior depends on `PRAGMA foreign_keys = ON`. Phase A's migration adds the table with `FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE`, but cascade only fires if FKs are enabled. Verify this in the test — if the FK cascade test fails, check `electron/db.ts` for an `exec('PRAGMA foreign_keys = ON')` call and add it if missing (this is a Phase A oversight, not new Phase C work).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — old tests still green plus new revision tests green. If the FK cascade test fails, follow the note in Step 3.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): recordRevision + listRevisions with retention pruning"
```

If you also had to add `PRAGMA foreign_keys = ON` to `electron/db.ts`, commit that separately first:

```bash
git add electron/db.ts
git commit -m "fix(db): enable PRAGMA foreign_keys for cascade delete on agents"
```

---

## Task 2: Wire `create` and `body_edit` snapshots into agent CRUD

**Files:**
- Modify: `electron/services/agentsService.ts` (modify existing `createAgent` and `updateAgent`)
- Modify: `electron/services/agentsService.test.ts` (append new tests)

`createAgent` now records a `create` snapshot for new agents. `updateAgent` records a `body_edit` snapshot when `patch.body !== undefined` AND the body actually changed.

- [ ] **Step 1: Add failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
describe('agentsService — snapshots on agent CRUD', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent inserts a "create" revision snapshot', () => {
    const a = createAgent(db, {
      name: 'A', body: '# A', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
    expect(revs[0].body).toBe('# A')
    expect(revs[0].summary).toMatch(/created/i)
  })

  it('updateAgent records a body_edit snapshot when body changes', () => {
    const a = createAgent(db, { name: 'A', body: 'v1', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { body: 'v2' })
    const revs = listRevisions(db, a.id)
    // newest first: body_edit, then create
    expect(revs[0].kind).toBe('body_edit')
    expect(revs[0].body).toBe('v2')
    expect(revs[1].kind).toBe('create')
  })

  it('updateAgent does NOT snapshot when body is unchanged', () => {
    const a = createAgent(db, { name: 'A', body: 'same', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { body: 'same' })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })

  it('updateAgent does NOT snapshot when only metadata fields change', () => {
    const a = createAgent(db, { name: 'A', body: 'v', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    updateAgent(db, a.id, { name: 'B', emoji: '🌟' })
    const revs = listRevisions(db, a.id)
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })

  it('updateAgent body_edit snapshot captures the current presets_json too', () => {
    const a = createAgent(db, { name: 'A', body: 'v', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    createPreset(db, a.id, 'P1')   // adds preset; pre-existing CRUD already exists, see Task 3
    updateAgent(db, a.id, { body: 'v2' })
    const revs = listRevisions(db, a.id)
    expect(revs[0].kind).toBe('body_edit')
    expect(revs[0].presets.length).toBe(1)
    expect(revs[0].presets[0].name).toBe('P1')
  })
})
```

Note: the last test depends on `createPreset` recording its own `preset_change` snapshot (per Task 3). Because the revisions returned by `listRevisions` are newest-first, `revs[0]` is the body_edit and we don't care what revisions are below it for this assertion. The test should pass cleanly after Task 3 lands.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — new tests expect snapshots that aren't being recorded yet.

- [ ] **Step 3: Modify `createAgent`**

Find the existing `createAgent` function and locate the line:

```ts
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
```

Replace JUST that line with:

```ts
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
  recordRevision(db, id, row.body, '[]', 'create', 'Created agent')
  return row
```

(Note: at creation time the agent has no presets yet, so we pass `'[]'` for the presets_json snapshot rather than re-reading the row.)

- [ ] **Step 4: Modify `updateAgent` to snapshot body changes**

Find the existing `updateAgent` function. Near the top, after `function updateAgent(db, id, patch): AgentRow {`, but BEFORE the existing `const sets: string[] = []` line, INSERT:

```ts
  // Read prior body if we'll need to detect a real change to snapshot. We only
  // care when patch.body is present.
  let priorBody: string | null = null
  if (patch.body !== undefined) {
    const prior = db.prepare('SELECT body FROM agents WHERE id = ?').get(id) as { body: string } | undefined
    priorBody = prior?.body ?? null
  }
```

Then, find the final block of the function (where it re-reads the row and returns):

```ts
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${id}`)
  return row
```

Replace with:

```ts
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${id}`)
  if (patch.body !== undefined && priorBody !== null && priorBody !== patch.body) {
    recordRevision(db, id, row.body, row.presets_json, 'body_edit', 'Edited body')
  }
  return row
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — all previous tests still green plus the new agent-CRUD-snapshot tests green.

- [ ] **Step 6: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): snapshot create + body_edit revisions in agent CRUD"
```

---

## Task 3: Wire `preset_change` snapshots into preset CRUD

**Files:**
- Modify: `electron/services/agentsService.ts` (modify existing preset CRUD functions)
- Modify: `electron/services/agentsService.test.ts` (append new tests)

Each preset CRUD entry point records a `preset_change` snapshot with a kind-specific summary.

Summary format:
- `createPreset` → `Added preset "<name>"`
- `updatePreset` with name change → `Renamed preset "<old>" to "<new>"`
- `updatePreset` with values change only → `Updated preset "<name>"`
- `updatePreset` with both → `Renamed preset "<old>" to "<new>"` (name change is the more "structural" event, so it wins)
- `deletePreset` → `Deleted preset "<name>"`
- `duplicatePreset` → `Duplicated preset "<src.name>"`

- [ ] **Step 1: Add failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
describe('agentsService — snapshots on preset CRUD', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: 'b', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
  })

  it('createPreset records a preset_change snapshot', () => {
    createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Added')
    expect(revs[0].summary).toContain('Security review')
    expect(revs[0].presets.length).toBe(1)
  })

  it('updatePreset records "Renamed" when name changes', () => {
    const p = createPreset(db, agentId, 'Old name')
    updatePreset(db, agentId, p.id, { name: 'New name' })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Renamed')
    expect(revs[0].summary).toContain('Old name')
    expect(revs[0].summary).toContain('New name')
  })

  it('updatePreset records "Updated" when only values change', () => {
    const p = createPreset(db, agentId, 'P')
    updatePreset(db, agentId, p.id, { values: { focus: 'auth' } })
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Updated')
    expect(revs[0].summary).toContain('P')
  })

  it('updatePreset records "Renamed" when both name and values change', () => {
    const p = createPreset(db, agentId, 'P', { x: 'old' })
    updatePreset(db, agentId, p.id, { name: 'Q', values: { x: 'new' } })
    const revs = listRevisions(db, agentId)
    expect(revs[0].summary).toContain('Renamed')
  })

  it('deletePreset records a preset_change snapshot', () => {
    const p = createPreset(db, agentId, 'P')
    deletePreset(db, agentId, p.id)
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Deleted')
    expect(revs[0].summary).toContain('P')
  })

  it('deletePreset on unknown id does NOT snapshot', () => {
    createPreset(db, agentId, 'X')
    const before = listRevisions(db, agentId).length
    deletePreset(db, agentId, 'no-such-preset')
    expect(listRevisions(db, agentId).length).toBe(before)
  })

  it('duplicatePreset records a preset_change snapshot', () => {
    const p = createPreset(db, agentId, 'P')
    duplicatePreset(db, agentId, p.id)
    const revs = listRevisions(db, agentId)
    expect(revs[0].kind).toBe('preset_change')
    expect(revs[0].summary).toContain('Duplicated')
    expect(revs[0].summary).toContain('P')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — preset CRUD doesn't snapshot yet.

- [ ] **Step 3: Modify the preset CRUD functions**

In `electron/services/agentsService.ts`, find the existing preset CRUD functions and update them.

`createPreset` — at the end, after `writePresets(db, agentId, [...presets, preset])`, BEFORE `return preset`, insert:

```ts
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Added preset "${preset.name}"`)
```

`updatePreset` — at the end, after `writePresets(db, agentId, nextPresets)`, BEFORE `return updated`, insert:

```ts
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  const summary = patch.name !== undefined && patch.name.trim() !== current.name
    ? `Renamed preset "${current.name}" to "${nextName}"`
    : `Updated preset "${nextName}"`
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', summary)
```

`deletePreset` — currently:

```ts
export function deletePreset(db: Database.Database, agentId: string, presetId: string): void {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const next = presets.filter(p => p.id !== presetId)
  if (next.length === presets.length) return
  writePresets(db, agentId, next)
}
```

Replace with:

```ts
export function deletePreset(db: Database.Database, agentId: string, presetId: string): void {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const target = presets.find(p => p.id === presetId)
  if (!target) return  // no-op on unknown id, no snapshot
  const next = presets.filter(p => p.id !== presetId)
  writePresets(db, agentId, next)
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Deleted preset "${target.name}"`)
}
```

`duplicatePreset` — at the end, after `writePresets(db, agentId, [...presets, dup])`, BEFORE `return dup`, insert:

```ts
  const after = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
  const body = (db.prepare(`SELECT body FROM agents WHERE id = ?`).get(agentId) as { body: string }).body
  recordRevision(db, agentId, body, after.presets_json, 'preset_change', `Duplicated preset "${src.name}"`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — old preset tests still green, new preset-snapshot tests green, AND the `updateAgent body_edit snapshot captures the current presets_json too` test from Task 2 now passes.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): snapshot preset_change revisions on preset CRUD"
```

---

## Task 4: Service — `revertToRevision`

**Files:**
- Modify: `electron/services/agentsService.ts` (append the function)
- Modify: `electron/services/agentsService.test.ts` (append tests)

`revertToRevision(db, agentId, revisionId): AgentRow` looks up the target revision, writes its body + presets_json back into the agent row, and inserts a new `revert` snapshot capturing the restored state.

- [ ] **Step 1: Add failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
import { revertToRevision } from './agentsService'

describe('agentsService — revertToRevision', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'A', body: 'v1', folderId: null,
      handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null,
    })
    agentId = a.id
    updateAgent(db, agentId, { body: 'v2' })
    updateAgent(db, agentId, { body: 'v3' })
  })

  it('writes the older body back into the agent', () => {
    const revs = listRevisions(db, agentId)
    // revs[0] = body_edit(v3), revs[1] = body_edit(v2), revs[2] = create(v1)
    const v1 = revs[2]
    expect(v1.kind).toBe('create')
    expect(v1.body).toBe('v1')
    const restored = revertToRevision(db, agentId, v1.id)
    expect(restored.body).toBe('v1')
  })

  it('inserts a new "revert" revision snapshot', () => {
    const revs = listRevisions(db, agentId)
    const v1 = revs[2]
    revertToRevision(db, agentId, v1.id)
    const after = listRevisions(db, agentId)
    expect(after[0].kind).toBe('revert')
    expect(after[0].body).toBe('v1')
    expect(after[0].summary).toMatch(/revert/i)
  })

  it('restores presets_json as well', () => {
    // Create a fresh agent with presets, capture a revision, then change presets, then revert.
    const fresh = createAgent(db, { name: 'B', body: 'b', folderId: null, handle: 'b', colorStart: '#000000', colorEnd: null, emoji: null })
    const p = createPreset(db, fresh.id, 'P', { x: 'old' })  // snapshot 'preset_change' (after create snapshot)
    const target = listRevisions(db, fresh.id)[0]  // this is the preset_change snapshot with the preset
    updatePreset(db, fresh.id, p.id, { values: { x: 'new' } })  // another snapshot
    // Now revert to the original preset state:
    const restored = revertToRevision(db, fresh.id, target.id)
    const presets = parseAgentPresets(restored.presets_json)
    expect(presets[0].values).toEqual({ x: 'old' })
  })

  it('throws on unknown revisionId', () => {
    expect(() => revertToRevision(db, agentId, 'no-such-rev')).toThrow(/revision/i)
  })

  it('throws when revision belongs to a different agent', () => {
    const b = createAgent(db, { name: 'B', body: 'x', folderId: null, handle: 'b', colorStart: '#000000', colorEnd: null, emoji: null })
    const otherRev = listRevisions(db, b.id)[0]
    expect(() => revertToRevision(db, agentId, otherRev.id)).toThrow(/revision/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — `revertToRevision` not exported.

- [ ] **Step 3: Implement `revertToRevision`**

Append to `electron/services/agentsService.ts`:

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

  db.prepare(`UPDATE agents SET body = ?, presets_json = ?, updated_at = ? WHERE id = ?`)
    .run(rev.body, rev.presets_json, nowIso(), agentId)

  recordRevision(db, agentId, rev.body, rev.presets_json, 'revert', `Reverted to "${rev.summary}"`)

  const row = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as AgentRow
  return row
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — all revision tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): revertToRevision writes back body/presets + records revert snapshot"
```

---

## Task 5: IPC + preload + env.d.ts for revisions + `agents:revision-added` event

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts:166-215`
- Modify: `src/env.d.ts:185-220`

Two new IPC `invoke` routes plus one new broadcast event. The event fires every time `recordRevision` is called via any of the IPC entry points (createAgent, updateAgent, preset CRUD, revertToRevision) — so the History tab can append in place.

Approach: rather than emitting the event from inside `recordRevision` (which would require passing a callback into the service), we wrap the existing IPC handlers that call mutating service functions. After each successful call, we read the most-recent revision for that agent and broadcast it. This keeps the service layer free of IPC concerns.

- [ ] **Step 1: Add new IPC routes + broadcast helper in `electron/ipc/agentHandlers.ts`**

In `electron/ipc/agentHandlers.ts`:

1. Extend the imports at the top:

```ts
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'
```

2. Add a new broadcast helper right next to the existing `broadcastChanged`:

```ts
function broadcastRevisionAdded(agentId: string): void {
  const db = getDb(app.getPath('userData'))
  // listRevisions returns newest first, so [0] is the just-inserted revision.
  const revs = listRevisions(db, agentId)
  if (revs.length === 0) return
  const rev = revs[0]
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agents:revision-added', rev)
  }
}
```

3. Update the existing handlers that snapshot revisions internally to broadcast the event after the operation:
   - `agents:create` — broadcast after `createAgent` (which now creates a `create` revision)
   - `agents:update` — broadcast after `updateAgent` IF `patch.body !== undefined` (body changes trigger a body_edit snapshot)
   - `agents:presets:create`, `agents:presets:update`, `agents:presets:delete`, `agents:presets:duplicate` — broadcast after each

For `agents:create`:

```ts
  ipcMain.handle('agents:create', async (_, input: CreateAgentInput) => {
    const db = getDb(app.getPath('userData'))
    const row = createAgent(db, input)
    broadcastChanged()
    broadcastRevisionAdded(row.id)
    return row
  })
```

For `agents:update`:

```ts
  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch) => {
    const db = getDb(app.getPath('userData'))
    const row = updateAgent(db, id, patch)
    broadcastChanged()
    if (patch.body !== undefined) broadcastRevisionAdded(id)
    return row
  })
```

For each preset handler, append `broadcastRevisionAdded(agentId)` after `broadcastChanged()`. For `agents:presets:delete`, only broadcast if the preset existed (the service returns void; we can't easily detect from here, but the service already no-ops on unknown id and doesn't snapshot — so a wasted broadcast is harmless. Acceptable to broadcast unconditionally; the renderer can de-dupe if needed).

Actually, cleaner: have `deletePreset` return `boolean` (true if removed, false if no-op). Update the service signature, the test in Task 3, and the handler. Optional refinement; if it adds too much churn, just broadcast unconditionally and accept the wasted event.

For the recommended approach, broadcast unconditionally — the cost is one no-op event per failed delete, and it keeps the service signature stable.

4. Add the two new IPC routes after the existing preset handlers:

```ts
  ipcMain.handle('agents:revisions:list', async (_, agentId: string) => {
    const db = getDb(app.getPath('userData'))
    return listRevisions(db, agentId)
  })

  ipcMain.handle('agents:revisions:revert', async (_, agentId: string, revisionId: string) => {
    const db = getDb(app.getPath('userData'))
    const row = revertToRevision(db, agentId, revisionId)
    broadcastChanged()
    broadcastRevisionAdded(agentId)
    return row
  })
```

- [ ] **Step 2: Extend preload surface**

In `electron/preload.ts`, find the `agents:` block and the existing `presets` namespace (added in Phase B around line 167-190). After the `presets: { ... },` namespace and BEFORE the `onChanged: ...` line, INSERT:

```ts
    revisions: {
      list: (agentId: string) =>
        ipcRenderer.invoke('agents:revisions:list', agentId) as Promise<import('../src/types/agent').AgentRevision[]>,
      revert: (agentId: string, revisionId: string) =>
        ipcRenderer.invoke('agents:revisions:revert', agentId, revisionId) as Promise<import('../src/types/agent').AgentRow>,
    },

    onRevisionAdded: (cb: (rev: import('../src/types/agent').AgentRevision) => void) => {
      const wrapper = (_: unknown, rev: import('../src/types/agent').AgentRevision) => cb(rev)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('agents:revision-added', wrapper)
    },
    offRevisionAdded: (cb: (rev: import('../src/types/agent').AgentRevision) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('agents:revision-added', wrapper)
        callbackWrappers.delete(cb)
      }
    },
```

- [ ] **Step 3: Mirror in `src/env.d.ts`**

In `src/env.d.ts`, find the `agents: {` block and the existing `presets` namespace (added in Phase B). After the `presets: { ... }` block and BEFORE `onChanged(...)`, INSERT:

```ts
        revisions: {
          list(agentId: string): Promise<import('./types/agent').AgentRevision[]>
          revert(agentId: string, revisionId: string): Promise<import('./types/agent').AgentRow>
        }
        onRevisionAdded(cb: (rev: import('./types/agent').AgentRevision) => void): void
        offRevisionAdded(cb: (rev: import('./types/agent').AgentRevision) => void): void
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — zero errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(agents): IPC + preload routes for revision list/revert + revision-added event"
```

---

## Task 6: `AgentHistoryTimeline` component

**Files:**
- Create: `src/components/AgentHistoryTimeline.tsx`
- Create: `src/components/AgentHistoryTimeline.test.tsx`
- Modify: `src/views/AgentDetail.css` (append timeline + diff-viewer styling)

A controlled component. Props: `{ agent, revisions, onRestore }`. The parent (`AgentDetail`) fetches revisions and passes them in; the component renders timeline rows and emits a callback when the user clicks Restore.

Layout:

```
┌──────────────────────────────────────────────────────────────┐
│  Today                                                       │
│  3:42 PM ● [purple]  Edited body                  [Diff][Restore]│
│  10:15 AM ● [neutral] Updated preset "Security"   [Restore]  │
│  ──────────────────────────────────────────────────────────  │
│  Yesterday                                                   │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentHistoryTimeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AgentHistoryTimeline from './AgentHistoryTimeline'
import type { AgentRevision } from '../types/agent'

function rev(overrides: Partial<AgentRevision> = {}): AgentRevision {
  return {
    id: overrides.id ?? `r-${Math.random()}`,
    agent_id: 'a1',
    body: overrides.body ?? 'b',
    presets: overrides.presets ?? [],
    summary: overrides.summary ?? 'something',
    kind: overrides.kind ?? 'body_edit',
    created_at: overrides.created_at ?? new Date().toISOString(),
  }
}

beforeEach(() => {
  // Lock "now" so the "Today" / "Yesterday" grouping is predictable.
  vi.setSystemTime(new Date('2026-05-25T18:00:00Z'))
})

describe('AgentHistoryTimeline', () => {
  it('renders an empty placeholder when there are no revisions', () => {
    render(<AgentHistoryTimeline revisions={[]} onRestore={() => {}} />)
    expect(screen.getByText(/no history/i)).toBeTruthy()
  })

  it('renders one row per revision with the summary text', () => {
    const revisions = [
      rev({ summary: 'Edited body', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ summary: 'Created agent', kind: 'create', created_at: '2026-05-25T16:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    expect(screen.getByText('Edited body')).toBeTruthy()
    expect(screen.getByText('Created agent')).toBeTruthy()
  })

  it('groups revisions by day with DateDivider labels', () => {
    const revisions = [
      rev({ summary: 'today A', created_at: '2026-05-25T17:00:00Z' }),
      rev({ summary: 'today B', created_at: '2026-05-25T10:00:00Z' }),
      rev({ summary: 'yesterday A', created_at: '2026-05-24T20:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    expect(screen.getByText(/^today$/i)).toBeTruthy()
    expect(screen.getByText(/^yesterday$/i)).toBeTruthy()
  })

  it('shows kind-colored dots — body_edit uses the accent class', () => {
    const revisions = [rev({ kind: 'body_edit', summary: 'edit' })]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('edit').closest('.agent-history-row') as HTMLElement
    expect(row.querySelector('.agent-history-dot--body_edit')).toBeTruthy()
  })

  it('clicking Restore on a non-current revision calls onRestore with the revision id', () => {
    const onRestore = vi.fn()
    const revisions = [
      rev({ id: 'r-current', summary: 'current', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', summary: 'old', kind: 'body_edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline agent={baseAgent} revisions={revisions} onRestore={onRestore} />)
    const oldRow = screen.getByText('old').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(oldRow).getByRole('button', { name: /restore/i }))
    expect(onRestore).toHaveBeenCalledWith('r-old')
  })

  it('does NOT show Restore on the most-recent revision (the "current" state)', () => {
    const revisions = [
      rev({ id: 'r-current', summary: 'current', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', summary: 'old', kind: 'body_edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const currentRow = screen.getByText('current').closest('.agent-history-row') as HTMLElement
    expect(within(currentRow).queryByRole('button', { name: /restore/i })).toBeNull()
  })

  it('clicking Diff on a body_edit reveals a two-pane diff viewer', () => {
    const revisions = [
      rev({ id: 'r-new', body: 'line one\nline two changed', kind: 'body_edit', summary: 'edit B', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', body: 'line one\nline two', kind: 'body_edit', summary: 'edit A', created_at: '2026-05-25T16:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const newRow = screen.getByText('edit B').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(newRow).getByRole('button', { name: /diff/i }))
    // The diff panel is rendered inside the timeline; both bodies are visible.
    expect(screen.getByText(/line two$/)).toBeTruthy()
    expect(screen.getByText(/line two changed/)).toBeTruthy()
  })

  it('does NOT render a Diff button on the oldest revision (no prior to compare)', () => {
    const revisions = [
      rev({ id: 'r-only', kind: 'create', summary: 'created', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('created').closest('.agent-history-row') as HTMLElement
    expect(within(row).queryByRole('button', { name: /diff/i })).toBeNull()
  })

  it('does NOT render a Diff button on a preset_change revision (only body_edit has diffs)', () => {
    const revisions = [
      rev({ id: 'r-new', kind: 'preset_change', summary: 'Added preset', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', kind: 'body_edit', body: 'b', summary: 'edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('Added preset').closest('.agent-history-row') as HTMLElement
    expect(within(row).queryByRole('button', { name: /diff/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/AgentHistoryTimeline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AgentHistoryTimeline.tsx`**

Create `src/components/AgentHistoryTimeline.tsx`:

```tsx
import { useMemo, useState } from 'react'
import type { AgentRevision } from '../types/agent'
import { DateDivider } from './DateDivider'

interface Props {
  revisions: AgentRevision[]
  onRestore: (revisionId: string) => void
}

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  if (dayStart.getTime() === today.getTime()) return 'Today'
  if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function groupByDay(revisions: AgentRevision[], now: Date): Array<{ label: string; items: AgentRevision[] }> {
  const groups: Array<{ label: string; items: AgentRevision[] }> = []
  for (const rev of revisions) {
    const label = dayLabel(rev.created_at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(rev)
    else groups.push({ label, items: [rev] })
  }
  return groups
}

export default function AgentHistoryTimeline({ revisions, onRestore }: Props) {
  const [openDiffId, setOpenDiffId] = useState<string | null>(null)
  const now = useMemo(() => new Date(), [revisions])  // re-evaluate when list changes
  const groups = useMemo(() => groupByDay(revisions, now), [revisions, now])

  if (revisions.length === 0) {
    return (
      <div className="agent-history-empty">
        No history yet. Edits to the body or presets will appear here.
      </div>
    )
  }

  // index map for diff lookup: revisions are newest-first; prior = revisions[index + 1]
  return (
    <div className="agent-history">
      {groups.map(group => (
        <div key={group.label} className="agent-history-group">
          <DateDivider label={group.label} />
          {group.items.map(rev => {
            const absoluteIndex = revisions.indexOf(rev)
            const prior = revisions[absoluteIndex + 1] ?? null
            const isCurrent = absoluteIndex === 0
            const canDiff = rev.kind === 'body_edit' && prior !== null
            const isDiffOpen = openDiffId === rev.id
            return (
              <div key={rev.id} className="agent-history-row">
                <span className="agent-history-time">{timeLabel(rev.created_at)}</span>
                <span
                  className={`agent-history-dot agent-history-dot--${rev.kind}`}
                  aria-hidden="true"
                />
                <span className="agent-history-summary">{rev.summary}</span>
                <span className="agent-history-actions">
                  {canDiff && (
                    <button
                      type="button"
                      className="agent-history-btn"
                      onClick={() => setOpenDiffId(isDiffOpen ? null : rev.id)}
                    >
                      {isDiffOpen ? 'Close diff' : 'Diff'}
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      type="button"
                      className="agent-history-btn"
                      onClick={() => onRestore(rev.id)}
                    >
                      Restore
                    </button>
                  )}
                </span>
                {canDiff && isDiffOpen && prior !== null && (
                  <div className="agent-history-diff">
                    <pre className="agent-history-diff-pane agent-history-diff-pane--old">
                      {prior.body}
                    </pre>
                    <pre className="agent-history-diff-pane agent-history-diff-pane--new">
                      {rev.body}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
```

Note: the component takes only the revisions list and a restore callback — the parent (`AgentDetail`) owns the agent and reads its fields (e.g., for the restore-confirm dialog in Task 7) without passing them through.

- [ ] **Step 4: Append CSS to `src/views/AgentDetail.css`**

Append (do NOT modify existing rules) EXACTLY this CSS:

```css

/* ── History timeline ──────────────────────────────────────── */

.agent-history {
  padding: 12px 28px 24px;
  font-size: 12px;
  color: var(--t2);
}

.agent-history-empty {
  padding: 24px 28px;
  color: var(--t3);
  font-size: 12px;
}

.agent-history-group { margin-bottom: 12px; }

.agent-history-row {
  display: grid;
  grid-template-columns: 70px 14px 1fr auto;
  align-items: start;
  gap: 8px;
  padding: 6px 4px;
  border-radius: 4px;
}
.agent-history-row:hover { background: rgba(255, 255, 255, 0.03); }

.agent-history-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--t3);
  padding-top: 2px;
}

.agent-history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--t3);
  margin-top: 5px;
  justify-self: center;
}
.agent-history-dot--body_edit     { background: var(--accent); }
.agent-history-dot--create        { background: #22c55e; }
.agent-history-dot--revert        { background: #f59e0b; }
.agent-history-dot--preset_change { background: var(--t3); }

.agent-history-summary {
  color: var(--t1);
  line-height: 1.5;
}

.agent-history-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms;
}
.agent-history-row:hover .agent-history-actions { opacity: 1; }

.agent-history-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--t2);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.agent-history-btn:hover {
  color: var(--accent-text);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.agent-history-diff {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 8px 0 4px;
}
.agent-history-diff-pane {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--t2);
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.agent-history-diff-pane--old {
  border-left: 2px solid #f87171;
}
.agent-history-diff-pane--new {
  border-left: 2px solid #4ade80;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/AgentHistoryTimeline.test.tsx`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentHistoryTimeline.tsx src/components/AgentHistoryTimeline.test.tsx src/views/AgentDetail.css
git commit -m "feat(agents): AgentHistoryTimeline with day grouping, kind dots, inline diff"
```

---

## Task 7: AgentDetail integration — populate History tab

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

Replace the History tab placeholder with `<AgentHistoryTimeline />`. Fetch revisions on demand (when the History tab opens, or eagerly on agent load), subscribe to `agents:revision-added` to prepend live updates, and wire `onRestore` to call `window.api.agents.revisions.revert`.

- [ ] **Step 1: Add failing tests**

Append to `src/views/AgentDetail.test.tsx`. First, extend the existing `makeApi` factory function to mock the revisions surface — but be careful, the tests above already have their fixtures. The cleanest approach is to add a new `describe` block with its own setup.

Append to `src/views/AgentDetail.test.tsx`:

```ts
describe('AgentDetail — History tab', () => {
  const revisionsFixture: import('../types/agent').AgentRevision[] = [
    {
      id: 'rev-2', agent_id: 'a1', body: 'v2', presets: [],
      summary: 'Edited body', kind: 'body_edit',
      created_at: '2026-05-25T15:00:00Z',
    },
    {
      id: 'rev-1', agent_id: 'a1', body: 'v1', presets: [],
      summary: 'Created agent', kind: 'create',
      created_at: '2026-05-25T10:00:00Z',
    },
  ]

  beforeEach(() => {
    ;(window as any).api.agents.revisions = {
      list: vi.fn().mockResolvedValue(revisionsFixture),
      revert: vi.fn().mockResolvedValue({ ...baseAgent, body: 'v1' }),
    }
    ;(window as any).api.agents.onRevisionAdded = vi.fn()
    ;(window as any).api.agents.offRevisionAdded = vi.fn()
  })

  it('fetches revisions when the History tab is opened', async () => {
    setup()
    await waitForLoaded()
    expect(window.api.agents.revisions.list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await waitFor(() => expect(window.api.agents.revisions.list).toHaveBeenCalledWith('a1'))
    expect(await screen.findByText('Edited body')).toBeTruthy()
    expect(await screen.findByText('Created agent')).toBeTruthy()
  })

  it('clicking Restore calls window.api.agents.revisions.revert', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    const oldRow = screen.getByText('Created agent').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(oldRow).getByRole('button', { name: /restore/i }))
    await waitFor(() => expect(window.api.agents.revisions.revert).toHaveBeenCalledWith('a1', 'rev-1'))
  })

  it('subscribes to onRevisionAdded when the component mounts and unsubscribes on unmount', async () => {
    const { unmount } = setup()
    await waitForLoaded()
    expect(window.api.agents.onRevisionAdded).toHaveBeenCalled()
    unmount()
    expect(window.api.agents.offRevisionAdded).toHaveBeenCalled()
  })

  it('prepends an incoming revision-added event to the timeline', async () => {
    let listener: ((rev: import('../types/agent').AgentRevision) => void) | null = null
    ;(window as any).api.agents.onRevisionAdded = vi.fn((cb: any) => { listener = cb })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    expect(listener).not.toBeNull()
    act(() => {
      listener!({
        id: 'rev-3', agent_id: 'a1', body: 'v3', presets: [],
        summary: 'Updated preset "X"', kind: 'preset_change',
        created_at: '2026-05-25T17:00:00Z',
      })
    })
    expect(await screen.findByText('Updated preset "X"')).toBeTruthy()
  })

  it('ignores revision-added events for a different agent', async () => {
    let listener: ((rev: import('../types/agent').AgentRevision) => void) | null = null
    ;(window as any).api.agents.onRevisionAdded = vi.fn((cb: any) => { listener = cb })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    act(() => {
      listener!({
        id: 'rev-other', agent_id: 'OTHER', body: 'x', presets: [],
        summary: 'Other agent edit', kind: 'body_edit',
        created_at: '2026-05-25T18:00:00Z',
      })
    })
    expect(screen.queryByText('Other agent edit')).toBeNull()
  })
})
```

Make sure `within` is imported in the test file (top imports). If it's already there from Phase B, no change needed. Otherwise update the import:

```ts
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — the History tab still shows the placeholder, no revisions fetched.

- [ ] **Step 3: Integrate in `src/views/AgentDetail.tsx`**

You're making four changes. Read the file first.

**Change A: Imports.** Add `AgentHistoryTimeline` and `AgentRevision`:

Find the existing imports block. Replace it with EXACTLY:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow, AgentRevision } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import { useToast } from '../contexts/Toast'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'
import { detectVariables } from '../utils/agentVariables'
import AgentVariablePresetBar from '../components/AgentVariablePresetBar'
import AgentHistoryTimeline from '../components/AgentHistoryTimeline'
import './AgentDetail.css'
```

**Change B: Add revisions state + fetch + subscribe.**

After the `const [activePresetId, setActivePresetId] = useState<string | null>(null)` line (added in Phase B), INSERT:

```tsx
  const [revisions, setRevisions] = useState<AgentRevision[]>([])
  const [revisionsLoaded, setRevisionsLoaded] = useState(false)
```

Then add a new useEffect AFTER the existing effects (a clean spot: after the auto-select-preset effect block — search for `// When the agent loads or its preset list changes`). INSERT:

```tsx
  // Fetch revisions when the History tab becomes active (lazy load — most
  // sessions never open History).
  useEffect(() => {
    if (activeTab !== 'history' || !id) return
    let cancelled = false
    setRevisionsLoaded(false)
    ;(async () => {
      const list = await window.api.agents.revisions.list(id)
      if (cancelled) return
      setRevisions(list)
      setRevisionsLoaded(true)
    })()
    return () => { cancelled = true }
  }, [activeTab, id])

  // Live updates: subscribe to 'agents:revision-added' and prepend matching
  // revisions to the timeline. Lifetime = component mount → unmount.
  useEffect(() => {
    if (!id) return
    const cb = (rev: AgentRevision) => {
      if (rev.agent_id !== id) return
      setRevisions(prev => [rev, ...prev])
    }
    window.api.agents.onRevisionAdded(cb)
    return () => window.api.agents.offRevisionAdded(cb)
  }, [id])
```

When the active agent changes, also reset `revisions`/`revisionsLoaded` to avoid showing the previous agent's history flash. Find the `id`-dependent useEffect that calls `setActiveTab('prompt')` and INSERT after that line:

```tsx
    setRevisions([])
    setRevisionsLoaded(false)
```

**Change C: Add a restore handler.**

Near the existing `handleCopy` / `handleDelete` / `handleDuplicate`, add:

```tsx
  const handleRestore = async (revisionId: string) => {
    if (!id) return
    if (!confirm('Restore this revision? Current body and presets will be replaced.')) return
    await window.api.agents.revisions.revert(id, revisionId)
    // The 'agents:changed' broadcast will refresh `agent`; the
    // 'agents:revision-added' broadcast will prepend the new revert snapshot.
  }
```

**Change D: Replace the History placeholder.**

Find this existing block (added in Task 6 / Phase B):

```tsx
        {activeTab === 'history' && (
          <div className="agent-detail-tab-placeholder">
            Revision history is coming in Phase C.
          </div>
        )}
```

Replace with:

```tsx
        {activeTab === 'history' && (
          revisionsLoaded ? (
            <AgentHistoryTimeline
              revisions={revisions}
              onRestore={handleRestore}
            />
          ) : (
            <div className="agent-detail-tab-placeholder">Loading history…</div>
          )
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS — existing tests still green plus 5 new History tests green.

- [ ] **Step 5: Run the full project's test suite to catch any other regressions**

Run: `npm test`
Expected: PASS for the files we touched (agentsService, AgentDetail, AgentHistoryTimeline). Pre-existing failures in unrelated files (App, ActivityFeed, Settings, etc.) are NOT regressions — they were already failing on `main` before Phase C started.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — zero type errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): wire AgentHistoryTimeline into History tab with live updates"
```

---

## Final verification

After Task 7, do a top-to-bottom sanity check:

- [ ] `npm test -- electron/services/agentsService.test.ts` — all green (agent + folder + handle + preset + revision tests).
- [ ] `npm test -- src/components/AgentVariablePresetBar.test.tsx src/components/AgentHistoryTimeline.test.tsx src/views/AgentDetail.test.tsx` — all green.
- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `git log --oneline e4c22ec..HEAD` (or whatever base SHA you started from) — commits in Phase C style, one logical change each.

---

## What ships at the end of Phase C

- Every body save and every preset CRUD records a snapshot to `agent_revisions` with retention capped at 20.
- New agents get a `create` snapshot on creation (parity with the Phase A backfill for existing agents).
- `window.api.agents.revisions.{list, revert}` exposed; `onRevisionAdded` / `offRevisionAdded` for live updates.
- History tab in `AgentDetail` shows a day-grouped timeline with kind-colored dots, summary text, an inline two-pane diff for body edits, and a Restore action that writes the older snapshot back and inserts a `revert` snapshot.
- Live updates: edits made while History is open appear at the top of the timeline without a manual refresh.

## Phase D preview (out of scope here)

Phase D will ship: `last_used_at` tracking via `recordUse` IPC; AgentsLanding (no-selection state with Pinned + Recent grids); Pin/Unpin UI; the MCP launcher script + MCP tab content.
