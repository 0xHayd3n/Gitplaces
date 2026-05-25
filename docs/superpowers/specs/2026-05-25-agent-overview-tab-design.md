# Agent Overview Tab + Body-as-File — Design

> **Status:** Design (brainstorm output). Implementation plan: TBD.
> **Date:** 2026-05-25

---

## 1. Goal & motivation

The current `AgentDetail` view has a **Prompt** tab whose only job is hosting a textarea for `agent.body`. The **Files** tab already half-treats that body as a file (a synthetic "main" entry labeled `SKILL.md`). The Prompt tab is therefore duplicative for editing, and inert as a landing surface — opening an agent drops you straight into an empty editor with placeholder text, with no orientation about what the agent does or what state it's in.

Two changes, in one design because they're tightly coupled:

1. **Remove the Prompt tab.** Editing the persona body happens in the Files tab alongside the agent's other content. One editor, one place.
2. **Add an Overview tab** as the new landing surface. Shows identity, surfaces, configuration, content, recent activity. Hosts the primary actions (Copy prompt, jump to editor).

To make Files honest about "everything is a file," **`agents.body` migrates to a row in `agent_files`** under the convention `<handle>.md`, `sort_order = 0`. The synthetic "main" code path in `AgentFilesTab` goes away.

---

## 2. Scope

**In scope:**
- New Overview tab, default landing surface
- Removal of the Prompt tab
- `agents.body` → primary `agent_files` row migration (Phase 26)
- Updates to every consumer of `agent.body` (sync, copy, revisions, variables/presets, MCP launcher, skill import, duplicate)
- Files tab: drop the `'main'` synthetic, mark the primary file (★), block delete + rename of the primary
- Variable/preset bar appears on both Overview (hero, drives Copy) and Files tab (when primary file is active)

**Out of scope:**
- Plugin export (Phase 4 effort)
- Multi-file MCP serving (mcp:// URIs stay agent-level)
- Inline preview rendering on Overview (the Preview tab still exists)
- Sync semantics changes (`previewSubagentFile` / `previewSlashCommandFile` still generate `~/.claude/agents/<handle>.md` and `~/.claude/commands/<handle>.md`; only their input changes)
- Feature flag / staged rollout — clean one-way migration on app launch

---

## 3. UI structure

### 3.1 Tab bar

```
Overview · Preview · MCP · History · Files · Settings
```

- Default `activeTab = 'overview'` (replaces `'prompt'` in [AgentDetail.tsx:49](../../src/views/AgentDetail.tsx:49))
- `'prompt'` is removed from the `activeTab` union

### 3.2 Overview layout (Layout C — hero + split)

**Hero card** (full width, top):

| Element | Behaviour |
|---|---|
| Description | The prose explicit description, larger than the current chip in the header. Falls back to derived (current `deriveDescription(liveBody)` logic) in muted text + hint when empty. |
| Chip strip | `📁 <folder>`, `⚙ <model>`, `🔧 N tools` (only when restricted), `📄 N files`, `⏱ used <relative>` |
| Preset row | *(only when presets exist)* "Active preset: `<dropdown>`" + chips for each detected `{{variable}}` |
| Action row | **Copy prompt** (primary button), **Open in editor →** (sets `activeTab='files'`, selects primary file) |

**Two columns below:**

| Left column | Right column |
|---|---|
| **Subagent** card — read-only summary: status (synced/disabled/error), path link when synced, retry button when errored | **Files** card — list of all files; primary marked with ★; clicking jumps to Files tab focused on that file |
| **Slash command** card — same shape as Subagent | **Recent revisions** card — last 3 with `<summary> · <relative>`; "View all →" jumps to History tab |
| **Variables** card — *(only when body contains `{{...}}`)* chips for each detected variable | |

Subagent/Slash card content is summary-only. The actual toggles, conflict dialog, and retry plumbing stay in Settings (existing `SurfaceToggle` flow unchanged).

### 3.3 Files tab updates

- Remove the synthetic `'main'` `activeId` branch ([AgentFilesTab.tsx:37-53](../../src/components/AgentFilesTab.tsx:37)). The primary file is now a real row.
- Primary file (`<handle>.md`) shows in the regular list with ★ icon + visual emphasis.
- Delete is disabled (UI + service-level assertion) for the primary file.
- Rename is disabled (filename auto-tracks the handle).
- When the primary file is the active editor, the variable/preset bar (`AgentVariablePresetBar`) appears above the textarea.

### 3.4 Empty states

| State | Treatment |
|---|---|
| No description set | Hero shows derived description in muted text + hint "Set an explicit description in Settings." |
| No surfaces enabled | Subagent + Slash command cards render "Disabled · Enable in Settings →" link |
| No presets | Preset row in hero is hidden; Copy uses raw body |
| No variables in body | Variables card hidden |
| No revisions yet | Recent revisions card shows "No revisions yet" (one-line) |

---

## 4. Data model

### 4.1 Schema changes (Phase 26 migration)

Single migration block in [electron/db.ts](../../electron/db.ts), wrapped in try/catch consistent with prior Phase migrations:

**Step A — shift any existing `sort_order = 0` siblings to `1`:**
```sql
UPDATE agent_files SET sort_order = 1
WHERE sort_order = 0
  AND agent_id IN (SELECT id FROM agents);
```
(`0` is reserved for the primary file from now on; pre-existing rows at `0` step out of the way.)

**Step B — backfill the primary file row for every agent:**
```sql
INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),  -- or generate UUIDs in JS during migration loop
  id,
  handle || '.md',
  body,
  0,
  created_at,
  updated_at
FROM agents
WHERE id NOT IN (
  SELECT agent_id FROM agent_files WHERE sort_order = 0
);
```
Idempotent — re-running skips agents that already have a primary row.

**Step C — drop `agents.body`:**
```sql
ALTER TABLE agents DROP COLUMN body;
```
SQLite 3.35+ supports column drop. better-sqlite3 ships current SQLite; verify on the target version before merging the migration.

### 4.2 Primary file convention

- **Identifier:** `sort_order = 0` AND `filename = <handle>.md`. `sort_order = 0` is the durable marker (handle can change, row stays primary). Filename is the human-facing label.
- **Auto-rename on handle change:** `updateAgent({ handle })` also runs `UPDATE agent_files SET filename = ? WHERE agent_id = ? AND sort_order = 0`.
- **Non-primary files** use `sort_order >= 1` (user-controlled ordering).

### 4.3 `agent_revisions.body` column

The `body` column on `agent_revisions` represents a snapshot of the primary content at the time of the revision. Column stays (renaming has migration cost for no UX benefit). Document the semantics change in a comment near `recordRevision`.

### 4.4 `AgentRow` type

`AgentRow.body` is removed from [src/types/agent.ts](../../src/types/agent.ts:14). TypeScript flags every consumer at compile time; fix in lockstep with the service changes.

---

## 5. Affected systems

| Touchpoint | File | Change |
|---|---|---|
| `createAgent` | [agentsService.ts](../../electron/services/agentsService.ts) | `body` input written to primary `agent_files` row, not an `agents` column |
| `updateAgent` (body) | agentsService.ts | Writes patched body to primary file row |
| `updateAgent` (handle) | agentsService.ts | Also renames the primary file row's filename |
| `deleteFile` | agentsService.ts | Throws when called on a primary row (`sort_order === 0`) |
| `updateFile` (filename) | agentsService.ts | Throws when renaming a primary row |
| `duplicateAgent` | agentsService.ts | Reads source primary content; `createAgent` for duplicate writes its own primary row at `<dup-handle>.md` |
| New: `getPrimaryFile(db, agentId)` | agentsService.ts | Single reader for primary file row |
| `previewSubagentFile` / `previewSlashCommandFile` | [agentFileSyncService.ts](../../electron/services/agentFileSyncService.ts) | Take primary content as a second arg (`agent`, `primaryContent: string`). Stay pure. |
| `runSyncAndPersist` / `agents:sync:retry` | [agentHandlers.ts](../../electron/ipc/agentHandlers.ts) | Fetch primary content once before generating previews |
| New IPC: `agents:primaryContent(agentId)` | agentHandlers.ts + preload.ts + env.d.ts | Returns `{ content: string; updated_at: string }` for the primary row |
| AgentDetail load effect | [AgentDetail.tsx](../../src/views/AgentDetail.tsx) | Adds a fetch for `agents:primaryContent(id)` alongside the existing `agents:getAll`; populates `bodyDraft` from the response |
| `bodyDraft` / `scheduleSaveBody` | AgentDetail.tsx | Writes through `agents:files:update` on the primary row instead of `agents:update({ body })`. `handleCopy` continues to use `liveBody` — no change in the call itself, only in how `liveBody` is populated. |
| `detectVariables` | (pure, no change) | Still operates on primary content |
| `activePresetId` state | AgentDetail.tsx | Lives at component level (already does); shared between Overview hero and Files-tab editor |
| `AgentVariablePresetBar` | Used on Overview (hero) and conditionally above Files-tab editor when primary file is active |
| Preview tab (`<ReactMarkdown>{agent.body}`) | AgentDetail.tsx | Renders the primary file content |
| `recordRevision` callers | agentsService.ts | Pass primary content where they passed `agent.body` |
| MCP launcher | [electron/mcp-launcher.cjs](../../electron/mcp-launcher.cjs) | Query `agent_files` where `agent_id = ? AND sort_order = 0` instead of `agents.body` |
| Skill import | [skillImportService.ts](../../electron/services/skillImportService.ts) | `ParsedSkill.body` unchanged at the import boundary; `createAgent` now persists it to the primary file row internally |

### Open call inside the design

- **Sync content arg vs DB fetch inside preview:** Chose A (pass content as arg). Keeps `previewSubagentFile` / `previewSlashCommandFile` pure and test-friendly; cost is one extra SELECT in the IPC handler before the preview call.
- **`agents:primaryContent(agentId)` route vs bloating `getAll`:** Dedicated route. `getAll` serves the sidebar and shouldn't carry full body text for every agent.

---

## 6. Testing

### 6.1 Migration (`electron/db.body-to-primary-file.migration.test.ts`)

- Agent with non-empty body → primary file row with `filename = <handle>.md`, `sort_order = 0`, `content = body`
- Agent with empty body → primary file row with empty content
- Existing sibling at `sort_order = 0` → shifted to `1` before backfill
- Idempotent: re-running is a no-op
- After migration, `agents.body` column is gone; `AgentRow` no longer has the field

### 6.2 Service (`electron/services/agentsService.test.ts`)

- `createAgent({ body })` writes the primary file row, leaves no `body` column on `agents`
- `updateAgent(id, { body })` writes to the primary file row
- `updateAgent(id, { handle })` renames the primary file row's filename
- `deleteFile` throws when called on the primary row
- `updateFile({ filename })` throws when renaming the primary row
- `duplicateAgent` creates a fresh primary file row for the duplicate
- `getPrimaryFile(db, agentId)` returns the right row
- `recordRevision` callers pass the current primary file content (where they used to pass `agent.body`); the `agent_revisions.body` column persists this as the snapshot

### 6.3 Sync (`electron/services/agentFileSyncService.test.ts`)

- `previewSubagentFile(agent, primaryContent)` builds frontmatter using `agent` + arg (no longer reads `agent.body`)
- Same for `previewSlashCommandFile`
- All existing rename/conflict/sync tests still pass (orthogonal change)

### 6.4 UI (`src/views/AgentDetail.test.tsx`)

- Default `activeTab` is `'overview'`
- No `'prompt'` tab in the bar
- Overview renders: hero (description, chip strip, action row), Subagent card, Slash command card, Variables card (when vars exist), Files card, Recent revisions card
- Empty states: no description / no surfaces / no presets / no variables / no revisions each rendered correctly
- Preset dropdown on Overview drives the Copy payload
- "Open in editor →" sets `activeTab='files'` and selects the primary file
- Variable bar appears in Files tab when primary file is active, and only then
- Files-tab delete is disabled on the primary file
- Files-tab rename is disabled on the primary file

### 6.5 IPC

- `agents:primaryContent(agentId)` returns content for the primary row; throws on unknown agentId

---

## 7. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Phase 26 migration fails on a malformed agent row | Wrap each agent's backfill in its own try/catch; log + skip on error so one bad row doesn't block the rest. Idempotency means a next-launch re-run picks up skipped rows after a fix. |
| Tests that bypass services and write SQL directly leave inconsistent state | Audit `*.test.ts` for direct `INSERT INTO agents` outside `createAgent`; switch to service helpers or also insert the primary file row. |
| Consumers of `agents:getAll` expect a `body` field | TypeScript catches this at compile time once `AgentRow.body` is removed. Fix the call sites in lockstep. |
| AgentDetail re-renders thrash when fetching primary content separately | Fetch primary content once on agent load (same effect that fetches the agent); share via component state. No per-render fetching. |
| `ALTER TABLE … DROP COLUMN` unsupported on the bundled SQLite | Verify SQLite version before merging. Fallback: `CREATE` new agents table without `body`, `INSERT … SELECT` everything else, `DROP` old, `ALTER … RENAME`. Heavier but bulletproof. |

---

## 8. Rollout

- Single feature branch off `main`, merged when complete
- No feature flag — clean one-way migration
- Migration runs once on app launch (Phase 26)
- Visible user impact: tab bar changes (Prompt → Overview), new landing view, body editing moves into Files tab

---

## 9. Implementation plan

**Next step:** invoke `superpowers:writing-plans` to break this design into ordered, executable tasks. Plan file: `docs/superpowers/plans/2026-05-25-agent-overview-tab.md`.
