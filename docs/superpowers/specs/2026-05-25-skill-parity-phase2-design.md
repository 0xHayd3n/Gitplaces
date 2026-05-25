# Agent Skill Parity (Phase 2 of 4) — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Phase context:** Second of four phases bringing the library to full Claude Code plugin authoring parity. Phase 1 (shipped) added SKILL.md shape parity, sibling files, and import from installed plugins. Phase 2 covers **subagent + slash-command parity** — adding the `tools` / `model` / `is_subagent` / `is_slash_command` / `argument_hint` fields, syncing toggled agents out to `~/.claude/agents/<handle>.md` and `~/.claude/commands/<handle>.md`, and round-tripping those fields on import. Phase 3 adds hooks; Phase 4 adds plugin packaging and export.

---

## Overview

Extend the agent data model so every agent can carry the four structured fields Claude Code recognizes on subagents and slash commands: `tools`, `model`, `is_subagent`, `is_slash_command` (plus `argument_hint` for slash commands). Add a Settings-tab section in the agent detail view to edit these fields and toggle whether the agent is exposed to Claude Code as a subagent and/or slash command. When either toggle is on, sync the agent's content to a file on disk in the format Claude Code expects (single .md with YAML frontmatter), keeping the DB as the source of truth — there is no two-way sync.

Phase 1 dropped unknown frontmatter keys (with a console warning) on import. Phase 2 picks up `model`, `tools`, and `argument-hint` from import frontmatter and round-trips them to the new columns.

---

## Goals

- Every agent has explicit `tools`, `model`, `is_subagent`, `is_slash_command`, `argument_hint` columns with sensible defaults.
- Toggling `is_subagent` on writes the agent's body + structured frontmatter to `~/.claude/agents/<handle>.md`.
- Toggling `is_slash_command` on writes to `~/.claude/commands/<handle>.md`.
- Body / description / handle / tools / model changes on an enabled agent propagate to disk on the next save (silent overwrite — we own the file).
- Toggling off cleanly deletes the file.
- Renaming the agent's handle moves the file (delete old, write new).
- First-time toggle ON checks for an existing file at the destination and prompts overwrite/cancel rather than silently clobbering hand-authored content.
- Both toggles independent — an agent can be both subagent and slash command, written to both locations.
- Imported skills pick up `model`, `tools`, and `argument-hint` from frontmatter; subsequent re-export round-trips them.
- Existing agents migrate cleanly with safe defaults (`tools=NULL`, `model='inherit'`, both booleans 0).
- Filesystem write failures (EACCES, ENOSPC) never block the DB write; they surface as a non-fatal toast.

---

## Non-Goals (deferred to later phases)

- **No two-way sync.** Hand-edits to `~/.claude/agents/<handle>.md` are not detected or pulled back into the DB. The DB is the source of truth; the file is a generated artifact. Phase 4 (export/packaging) is a natural place to revisit this if real pain emerges.
- **No sync of sibling `agent_files`.** When `is_subagent` is true, only the agent's `body` is written. The sibling files (references/*.md, scripts/*.sh from Phase 1) stay inside Git-Suite. Claude Code's subagent convention is single-file; preserving siblings on disk would require a non-standard sidecar directory and break that convention. Phase 4 plugin export will package siblings properly.
- **No `Bash(git:*)` allow-list syntax.** The tools picker exposes plain tool names (Read, Edit, Bash, etc.). Users wanting CC's per-command Bash restrictions edit the frontmatter manually after disabling sync.
- **No MCP-tool checkboxes.** The tools picker doesn't enumerate MCP tools — too varied and per-install. Users wanting MCP-tool restriction handle it after Phase 4 plugin authoring.
- **No UI affordance for adding custom tool names.** The picker only checkboxes `STANDARD_CC_TOOLS`. Imported tools outside that list are preserved and rendered as a read-only "Custom" row so the user can untick/keep them, but typing a new custom tool name through the UI is Phase 4. (Storage already supports it — the `tools` JSON column accepts any string array.)
- **No hooks.** Phase 3.
- **No plugin export.** Phase 4.
- **No conflict detection on subsequent writes.** Once `synced_*_at` is non-null, every write silently overwrites. If the user hand-edits the file in between, we clobber on the next agent body save. This is the documented contract.
- **No file watcher.** The app does not poll or watch `~/.claude/agents/` / `~/.claude/commands/`. The IPC handler writes synchronously after each DB mutation.

---

## Data model

### `agents` table — new columns (Phase 25 migration)

```sql
ALTER TABLE agents ADD COLUMN tools TEXT;             -- JSON array (e.g., '["Read","Edit"]'); NULL = inherit all
ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'inherit';   -- 'sonnet' | 'opus' | 'haiku' | 'inherit'
ALTER TABLE agents ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN is_slash_command INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN argument_hint TEXT;     -- slash-command frontmatter; NULL when not set
ALTER TABLE agents ADD COLUMN synced_subagent_at TEXT;        -- ISO timestamp; NULL = never written by us
ALTER TABLE agents ADD COLUMN synced_slash_command_at TEXT;   -- ditto for commands/
```

**Column rationale:**

- `tools` as JSON string. NULL means "no restriction — inherit Claude Code's full toolkit" (no `tools:` line emitted). `'[]'` means "no tools allowed". `'["Read","Edit"]'` means restrict to those. The JSON format keeps it human-inspectable in the DB and serializes cleanly to CC's comma-separated frontmatter form.
- `model` is never null — `'inherit'` is the default and tells the sync layer to omit the `model:` line.
- Two separate booleans, not a single enum. An agent can be both a subagent and a slash command simultaneously, writing to both `~/.claude/agents/` and `~/.claude/commands/`.
- `argument_hint` is its own column (not nested in JSON) so the UI can edit it directly and Phase 4 round-trips it without parsing JSON.
- `synced_*_at` columns serve two purposes: (a) "have we ever written this file" determines whether a conflict check is needed on toggle ON; (b) presence tells the UI when the last sync was for the status line.

**TypeScript additions to `AgentRow`:**

```ts
tools: string | null              // JSON-serialized string[]; null = inherit
model: 'sonnet' | 'opus' | 'haiku' | 'inherit'
is_subagent: 0 | 1
is_slash_command: 0 | 1
argument_hint: string | null
synced_subagent_at: string | null
synced_slash_command_at: string | null
```

**Helpers in `src/types/agent.ts`** (next to `parseAgentPresets`):

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

---

## Filesystem sync layer

**New module:** `electron/services/agentFileSyncService.ts`

### Public surface

```ts
export interface SyncResult {
  subagent: SyncOutcome
  slashCommand: SyncOutcome
}

export type SyncOutcome =
  | { status: 'written'; path: string }
  | { status: 'deleted'; path: string }
  | { status: 'skipped' }                       // toggle was off and stayed off
  | { status: 'conflict'; path: string }        // file exists, never synced, forceOverwrite=false
  | { status: 'error'; path: string; message: string }

export interface SyncContext {
  oldHandle?: string          // pass when handle changed in this update
  forceOverwrite?: boolean    // honored only when toggle flips ON
}

export function syncAgentToDisk(
  agent: AgentRow,
  ctx?: SyncContext,
): Promise<SyncResult>

export function checkConflict(handle: string): Promise<{
  subagentExists: boolean
  slashCommandExists: boolean
  subagentPath: string
  slashCommandPath: string
}>

export function previewSubagentFile(agent: AgentRow): string
export function previewSlashCommandFile(agent: AgentRow): string

export function subagentPath(handle: string): string
export function slashCommandPath(handle: string): string

export function cleanupAgentFiles(
  handle: string,
  opts: { cleanSubagent: boolean; cleanSlashCommand: boolean },
): Promise<{ subagent: SyncOutcome; slashCommand: SyncOutcome }>
```

### Path resolution

```ts
function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
}
function subagentPath(handle: string) { return path.join(claudeHome(), 'agents', `${handle}.md`) }
function slashCommandPath(handle: string) { return path.join(claudeHome(), 'commands', `${handle}.md`) }
```

The `CLAUDE_HOME` env override is the test seam — tests set it to a temp dir.

### Sync rules

Called from `agents:create`, `agents:update`, `agents:delete` IPC handlers after the DB write succeeds. The IPC handler captures the pre-mutation row first so it can pass `oldHandle` and detect a toggle transition.

Per surface (subagent and slash command share the same matrix, replacing `subagent` → `slashCommand` and the corresponding column names):

| Prior `is_subagent` | New `is_subagent` | `synced_subagent_at` before | `ctx.forceOverwrite` | File on disk? | Action |
|---|---|---|---|---|---|
| 0 | 0 | n/a | n/a | n/a | `{ status: 'skipped' }` |
| 0 | 1 | NULL | false | yes | `{ status: 'conflict', path }` |
| 0 | 1 | NULL | true (or no file) | n/a | Write file, update `synced_subagent_at`, `{ status: 'written' }` |
| 1 | 1 | non-NULL | n/a | n/a | Write file (silent overwrite), update `synced_subagent_at` |
| 1 | 0 | non-NULL or NULL | n/a | n/a | Delete file at `subagentPath(handle)`, set `synced_subagent_at = NULL`, `{ status: 'deleted' }`. If file missing, succeed silently. |

**Handle rename:** when `ctx.oldHandle && ctx.oldHandle !== agent.handle && agent.is_subagent === 1`, delete `subagentPath(oldHandle)` before writing the new path. Same for slash command surface independently.

**`mkdir -p`:** the `agents/` and `commands/` subdirectories may not exist on a fresh user — the sync layer ensures their parent directories before writing.

### File content — frontmatter generation

**Subagent file** (`~/.claude/agents/<handle>.md`):

```yaml
---
name: <handle>
description: <agent.description>
tools: Read, Edit, Bash       # only when tools !== null
model: claude-sonnet-4-6       # only when model !== 'inherit'
---

<agent.body>
```

**Slash command file** (`~/.claude/commands/<handle>.md`):

```yaml
---
description: <agent.description>
argument-hint: [project-name]  # only when argument_hint is non-empty
---

<agent.body>
```

YAML serialization uses `gray-matter`'s `stringify()` (already a dep from Phase 1). Block scalars (`description: |\n  ...`) are emitted automatically when the value contains newlines. The body trailing newline is preserved exactly as stored in the DB.

**Description fallback:** if `agent.description` is empty, fall back to `deriveDescription(agent.body)` so the frontmatter always has a usable description. Empty-string descriptions are invalid for both surfaces in Claude Code.

### Model name mapping

```ts
const MODEL_FRONTMATTER: Record<Exclude<AgentRow['model'], 'inherit'>, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5-20251001',
}
```

When CC ships new models, bump this table. The short form (`'sonnet'`) is the durable storage value.

### Error policy

A filesystem error (`EACCES`, `ENOSPC`, `EBUSY`, etc.) never throws out of `syncAgentToDisk`. It returns `{ status: 'error', path, message }` for the affected surface and continues with the other surface independently. The IPC handler reads the result and attaches a `syncWarning` field to the response. The DB write has already succeeded — the user's edit is safe.

`is_subagent=1` is preserved on error (the *intent* is correct; the OS failed). Next save retries the write silently. Manual `/sync retry` is also available.

---

## Import roundtrip (`skillImportService`)

### `ParsedSkill` extensions

```ts
export interface ParsedSkill {
  // existing fields from Phase 1...
  model: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  tools: string[] | null
  argumentHint: string | null
}
```

### `parseSkill` additions

The "known frontmatter" set grows to `{ name, description, model, tools, argument-hint }`. Unknown keys continue to log a console warning (Phase 4 will round-trip them via a JSON catch-all column).

**`parseModelFrontmatter(raw)` — accepts both short and full forms:**
- `'sonnet'`, `'opus'`, `'haiku'`, `'inherit'` → pass through
- `'claude-sonnet-4-6'`, `'claude-opus-4-7'`, `'claude-haiku-4-5-20251001'` → map to short form
- Other strings (older model IDs, unknown values) → return `'inherit'` and log warning
- Missing → return `'inherit'`

**`parseToolsFrontmatter(raw)` — accepts CC's comma-separated string OR a YAML array:**
- `null` / `undefined` → `null` (no restriction)
- YAML array `[Read, Edit]` → `['Read', 'Edit']`
- Comma-separated string `'Read, Edit, Bash'` → `['Read', 'Edit', 'Bash']` (trimmed)
- Empty string → `[]`
- Other types → `null` + warning

**`parseArgumentHint(raw)`:**
- String → pass through
- Anything else → `null`

### `importSkill` populates the new columns

```ts
const agent = createAgent(db, {
  // existing fields...
  model: skill.model,
  tools: serializeAgentTools(skill.tools),
  argumentHint: skill.argumentHint,
  // is_subagent and is_slash_command stay 0 — user opts in explicitly
})
```

**Critical: imported skills do not auto-flip `is_subagent` or `is_slash_command` on.** Even if the source frontmatter had `tools:` (a subagent indicator), the import creates a dormant agent. The user reviews it in Git-Suite and explicitly toggles "Available as subagent" if they want it on disk. This prevents bulk-import from clobbering the plugin's own `agents/` files.

### Detection hint

The import dialog gains a small text chip per skill showing the inferred surface based on source location and frontmatter shape:

- Path includes `/agents/` OR frontmatter has `tools:` or `model:` → "subagent"
- Path includes `/commands/` OR frontmatter has `argument-hint:` → "slash command"
- Otherwise → "skill"

The chip is informational — it does not change import behavior. After import, the user sees the chip in the agent's hero (Phase 2 also adds this) and knows which toggle to flip.

---

## UI changes (Settings tab)

The Settings tab in `src/views/AgentDetail.tsx` gains four new groups. Layout, top to bottom:

```
Folder          [dropdown]
─── Claude Code surfaces ───
Surface         [✓] Available as subagent       Synced to ~/.claude/agents/foo.md · 2 min ago
                [✓] Available as slash command  Synced to ~/.claude/commands/foo.md · 2 min ago
Argument hint   [text input]   (visible only when is_slash_command=1)
─── Model & tools ───
Model           [dropdown: Inherit / Sonnet / Opus / Haiku]
Tools           ( ) Inherit all     (•) Restrict to:
                [✓ Read] [✓ Edit] [✓ Bash] [☐ Write] [☐ Glob] [☐ Grep]
                [☐ WebFetch] [☐ WebSearch] [☐ Task] [☐ TodoWrite]
                [☐ NotebookEdit] [☐ ExitPlanMode]
─── existing rows ───
Export prompt   [Copy entire prompt]
Manage          [Duplicate] [Delete agent]
```

### Component breakdown

- **`AgentSettingsTab`** (existing function in `AgentDetail.tsx`) — extended with the new fields.
- **`<SurfaceToggle>`** (new sub-component, inline in `AgentDetail.tsx` or extracted to `src/components/SurfaceToggle.tsx`) — takes `{ kind: 'subagent' | 'slashCommand', agent, onResult }`. Renders the checkbox, sync status line, and clickable path. Handles the conflict-dialog flow on toggle ON.
- **`<ConflictDialog>`** (new modal in `src/components/ConflictDialog.tsx`) — opens when toggle ON's pre-check shows the file already exists. Shows the path with an "Open folder" link (via `window.api.openExternal`), then `[Overwrite]` / `[Cancel]`.
- **`<ToolsPicker>`** (new sub-component) — radio (`Inherit all` / `Restrict to:`) plus checkbox grid over `STANDARD_CC_TOOLS`.
- **`<ModelDropdown>`** (new sub-component) — a `<select>` with the four model values.

### `STANDARD_CC_TOOLS` constant

Defined as a module-level const in `src/components/ToolsPicker.tsx` (so both the component and any future docs can reference it from one place):

```ts
export const STANDARD_CC_TOOLS = [
  'Read', 'Write', 'Edit',
  'Glob', 'Grep',
  'Bash',
  'WebFetch', 'WebSearch',
  'Task',          // subagent dispatcher
  'TodoWrite',
  'NotebookEdit',
  'ExitPlanMode',
] as const
```

When CC ships new standard tools, edit this array. Out-of-list tool names that arrive via import (e.g., `KillBash`) are still preserved in the DB and rendered as a separate "Custom" row in the picker so the user can keep them — they just can't add new custom tools via the UI in v2.

### Sync status line content

- Toggle OFF: nothing rendered.
- Toggle ON, `synced_*_at IS NULL`: "Will sync on next save."
- Toggle ON, `synced_*_at` non-NULL: "Synced to `<path>` · <relative time>" — `<path>` is a clickable link that opens the containing folder via `window.api.openExternal`.
- Toggle ON, last sync errored (`syncWarning` is in the most recent update response): red "Sync failed: <message>. Will retry on next save." with a `[Retry]` button that calls `window.api.agents.sync.retry(agent.id)`.

The "errored" state is held in component state (not the DB) — the next successful save clears it.

### Toggle ON flow

1. User clicks the checkbox.
2. UI calls `window.api.agents.sync.checkConflict(agent.id)`.
3. If `subagentExists` (for the subagent toggle) is true AND `synced_subagent_at IS NULL`: open `<ConflictDialog>`.
4. **Cancel** → toggle stays unchecked, no IPC `update` call.
5. **Overwrite** → call `window.api.agents.update(id, { isSubagent: true, forceOverwrite: true })`.
6. If no conflict → call `window.api.agents.update(id, { isSubagent: true })`.

The slash-command toggle uses the same flow with `slashCommandExists` / `isSlashCommand`.

### Toggle OFF flow

No dialog. Direct call to `update` with the boolean false. IPC handler deletes the file.

### Sibling-files info chip

When `is_subagent=1` AND `agent_files.length > 0`, render a small info chip below the toggle:

> "Sibling files (3) are not synced to Claude Code in this phase. Phase 4 plugin export will package them."

This makes the non-goal visible at the right moment without surprising users.

---

## IPC contract

### New routes

```ts
// window.api.agents.sync.*
sync: {
  checkConflict: (agentId: string) => Promise<{
    subagentExists: boolean
    slashCommandExists: boolean
    subagentPath: string
    slashCommandPath: string
  }>
  retry: (agentId: string) => Promise<SyncResult>
  preview: (agentId: string) => Promise<{
    subagent: string | null
    slashCommand: string | null
  }>
}
```

### Extended `update` patch

```ts
update: (id: string, patch: {
  // existing Phase 1 fields...
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  tools?: string[] | null              // null = inherit; [] = no tools
  argumentHint?: string | null
  isSubagent?: boolean
  isSlashCommand?: boolean
  forceOverwrite?: boolean             // transient; not persisted
}) => Promise<AgentRow & { syncWarning?: string }>
```

### Extended `create` input

`createAgent` accepts the same five new optional fields plus `forceOverwrite`. New-agent creation defaults `isSubagent` and `isSlashCommand` to `false` so the Create flow never opens a conflict dialog. Opt-in happens in Settings after creation.

### `delete` route

No surface change. The handler reads the row before deletion (to capture `handle`, `is_subagent`, `is_slash_command`), runs `deleteAgent(db, id)`, then calls `cleanupAgentFiles(handle, { cleanSubagent, cleanSlashCommand })` for any owned files.

### IPC handler responsibilities

For every mutating route that touches an agent (`create`, `update`, `delete`):

1. Read the current row (if it exists) — capture `oldHandle`, `oldIsSubagent`, `oldIsSlashCommand`.
2. Run the DB mutation.
3. Read the new row.
4. Call `syncAgentToDisk(newRow, { oldHandle, forceOverwrite: patch.forceOverwrite })`.
5. Persist `synced_*_at` updates from the `SyncResult` to the agent row.
6. Attach `syncWarning` to the response if any `SyncOutcome.status === 'error'`.
7. Broadcast `agents:changed`.

The `agents:changed` broadcast already exists; sync state changes piggyback on the next `getAll` refresh.

---

## Components

### Modified

- **`electron/db.ts`** — add Phase 25 migration block (7 ALTER TABLE lines).
- **`src/types/agent.ts`** — extend `AgentRow` with 7 new fields; add `parseAgentTools` / `serializeAgentTools` helpers.
- **`electron/services/agentsService.ts`** — extend `CreateAgentInput`, `UpdateAgentPatch`, the INSERT, and the patch builder to handle the 5 new public fields. Add a dedicated `setSyncedAt(db, agentId, surface, ts)` helper for the IPC handler to update `synced_subagent_at` / `synced_slash_command_at` (kept out of the public patch type so callers can't accidentally mutate sync state). Add a `MODEL_VALUES` exported constant for validation, plus internal `assertValidTools` / `assertValidModel` helpers.
- **`electron/services/agentsService.test.ts`** — new test cases for create/update with the new fields.
- **`electron/services/skillImportService.ts`** — extend `ParsedSkill`; pick up `model`, `tools`, `argument-hint` in `parseSkill`; populate them in `importSkill`'s `createAgent` call.
- **`electron/services/skillImportService.test.ts`** — new fixtures with `model:` / `tools:` / `argument-hint:` frontmatter; tests for the parsing helpers.
- **`electron/ipc/agentHandlers.ts`** — extend `create`/`update`/`delete` handlers to call `syncAgentToDisk`; add `agents:sync:checkConflict`, `agents:sync:retry`, `agents:sync:preview` handlers.
- **`electron/preload.ts`** — extend `update` and `create` patch types; add `sync` namespace.
- **`src/env.d.ts`** — mirror the preload changes.
- **`src/views/AgentDetail.tsx`** — extend `AgentSettingsTab` with the four new groups; wire up toggle handlers; thread `syncWarning` into a toast.
- **`src/views/AgentDetail.css`** — styling for the new Settings groups, surface toggles, sync status, tools-picker grid.
- **`src/views/AgentDetail.test.tsx`** — new tests for the Settings tab additions.

### Added

- **`electron/services/agentFileSyncService.ts`** — the sync module. Public API: `syncAgentToDisk`, `checkConflict`, `previewSubagentFile`, `previewSlashCommandFile`, `subagentPath`, `slashCommandPath`, `cleanupAgentFiles`.
- **`electron/services/agentFileSyncService.test.ts`** — exhaustive tests against a temp dir keyed off `CLAUDE_HOME`.
- **`src/components/ConflictDialog.tsx`** — modal for the first-time toggle-ON conflict.
- **`src/components/ConflictDialog.test.tsx`** — modal behavior tests.
- **`src/components/SurfaceToggle.tsx`** — checkbox + sync status component. Used twice in `AgentSettingsTab` (one per surface).
- **`src/components/SurfaceToggle.test.tsx`** — toggle flow tests.
- **`src/components/ToolsPicker.tsx`** — radio + checkbox grid for the tools allow-list. Exports `STANDARD_CC_TOOLS`.
- **`src/components/ToolsPicker.test.tsx`** — picker tests.
- **`src/components/ModelDropdown.tsx`** — small select for the model field.
- **Fixtures:** new directories under `electron/services/__fixtures__/skills/` covering `with-model`, `with-tools`, `with-argument-hint`, `with-mixed-frontmatter`.

### Unchanged

- Phase 1 file CRUD, import dialog, import-from-GitHub.
- Phase 1 hero (description paragraph, origin chip, Files tab).
- MCP tab, Preview tab, History tab.
- Revision recording semantics — toggle flips and field changes do not create body revisions (they're not body edits).

---

## Test plan

### Service layer (Vitest, node env)

**`agentsService.test.ts` additions:**
- `createAgent` accepts and round-trips `model`, `tools`, `argumentHint`, `isSubagent`, `isSlashCommand`.
- Defaults: `model='inherit'`, `tools=null`, `argumentHint=null`, both booleans 0, both `synced_*_at` null.
- `updateAgent` patches each new field independently.
- `updateAgent` rejects an unknown model name with a clear error.
- `updateAgent` rejects non-array tools input.
- Boolean coercion: `isSubagent: true` → `1`; `false` → `0`.
- `setSyncedAt` helper updates `synced_subagent_at` / `synced_slash_command_at` independently of the public patch type.

**`agentFileSyncService.test.ts`** (new — load-bearing):
- `previewSubagentFile` produces frontmatter with `name`, `description`; omits `tools` when null; omits `model` when `'inherit'`.
- `previewSubagentFile` emits comma-separated tools when array is non-empty.
- `previewSubagentFile` emits a YAML block scalar when description contains newlines.
- `previewSlashCommandFile` omits `argument-hint` when null/empty.
- Model name mapping: `'sonnet'` → `'claude-sonnet-4-6'`, `'opus'` → `'claude-opus-4-7'`, `'haiku'` → `'claude-haiku-4-5-20251001'`.
- `syncAgentToDisk` with `is_subagent=1` writes the expected file at `subagentPath(handle)`.
- `syncAgentToDisk` with `is_subagent=0` and a previously-synced file deletes it.
- `syncAgentToDisk` with `oldHandle='foo'` and `agent.handle='bar'` deletes the old file and writes the new.
- `syncAgentToDisk` returns `{ status: 'conflict' }` when the file pre-exists, `forceOverwrite=false`, `synced_*_at` null.
- `syncAgentToDisk` overwrites silently when `synced_*_at` is non-null.
- `syncAgentToDisk` with `forceOverwrite=true` overwrites a pre-existing file.
- `syncAgentToDisk` creates the `agents/` and `commands/` parent directories if missing.
- EACCES on write returns `{ status: 'error', message }` without throwing.
- `checkConflict` reads filesystem state without writing.
- `cleanupAgentFiles` removes both surfaces; succeeds when files are already gone.
- Round-trip: write via `syncAgentToDisk`, parse via `parseSkill`, equivalent fields (modulo handle vs name).
- Both surfaces with the same agent: writes two files in two locations.

**`skillImportService.test.ts` additions:**
- `parseSkill` on `with-model` fixture (`model: claude-sonnet-4-6`) returns `model: 'sonnet'`.
- `parseSkill` on `with-tools` fixture (`tools: Read, Edit, Bash`) returns `tools: ['Read', 'Edit', 'Bash']`.
- `parseSkill` on a YAML-array variant (`tools: [Read, Edit]`) returns `['Read', 'Edit']`.
- `parseSkill` on `with-argument-hint` fixture returns `argumentHint: '[project-name]'`.
- `parseSkill` on a skill with `model: gpt-4` returns `'inherit'` and warns.
- `parseSkill` on a fixture without any of the new keys returns the defaults (no warning).
- `importSkill` populates `model`, `tools`, `argument_hint` columns.
- `importSkill` keeps `is_subagent=0` and `is_slash_command=0` even when the source had `tools:` (anti-surprise contract).

### Component layer (Vitest + Testing Library)

**`AgentDetail.test.tsx` additions:**
- Settings tab renders model dropdown with current value selected.
- Changing model dropdown calls `update` with `{ model: 'opus' }`.
- Tools picker shows current tools as checked; toggling one calls `update` with new array.
- "Inherit all" radio is selected when `tools` is null; switching to "Restrict to:" with no checkboxes calls update with `[]`.
- Subagent toggle calls `checkConflict` first; if `subagentExists=true` shows ConflictDialog.
- ConflictDialog Cancel keeps toggle off, no `update` call.
- ConflictDialog Overwrite calls `update` with `{ isSubagent: true, forceOverwrite: true }`.
- Toggle OFF calls `update` with `isSubagent: false` (no dialog).
- Sync status line renders correctly for never-synced / synced / errored states.
- Argument-hint input is hidden when `is_slash_command=0`; visible when 1.
- Sibling-files info chip appears when `is_subagent=1` AND the agent has files.

**`ConflictDialog.test.tsx`:** modal isolated tests — renders the path, both buttons fire the callbacks, ESC dismisses.

**`SurfaceToggle.test.tsx`:** unit test for the toggle + status line component.

**`ToolsPicker.test.tsx`:** all-tools-checked → null result; subset → array; "Inherit all" radio toggles all.

### Manual smoke test

1. Create a fresh agent. Open Settings tab. Toggle "Available as subagent" on → new file at `~/.claude/agents/<handle>.md` with `name`, `description`, and body.
2. Edit body in Prompt tab; wait 1.5s → file content updates.
3. Set Model to Opus → file's frontmatter shows `model: claude-opus-4-7`.
4. Restrict tools to Read+Edit → file's frontmatter shows `tools: Read, Edit`.
5. Rename handle → old file deleted, new file appears.
6. Toggle off → file removed.
7. Pre-create `~/.claude/agents/conflict-test.md` manually. Create agent with handle `conflict-test`, toggle subagent on → ConflictDialog appears. Cancel → toggle stays off, file unchanged. Click again → dialog re-opens, Overwrite → file replaced.
8. Toggle slash command on the same agent → both files exist; both update on body edit.
9. Set argument hint to `[project]` → slash command file frontmatter shows `argument-hint: [project]`.
10. Re-import a Superpowers skill with `model:` and `tools:` frontmatter → imported agent shows those values in Settings; neither toggle is on.
11. Force a permission error (chmod the agents/ dir to read-only) → save shows a toast "Sync failed: …"; toggle stays on; agent body still saved.
12. Delete an agent that had both toggles on → both files removed.

---

## Open items deferred to later phases

- **Two-way sync.** Detecting hand-edits to `~/.claude/agents/<handle>.md` and pulling them back into the DB. Either a periodic poll or a file watcher. Skipping in Phase 2; revisit if real pain emerges.
- **Sibling-file sync.** Currently Phase 2 writes only the body. Phase 4 plugin export bundles siblings + scripts + assets in the proper plugin layout.
- **MCP-tool checkboxes.** Tools picker covers standard CC tools only. Users wanting `mcp__server__tool` restrictions edit the frontmatter manually.
- **Bash allow-list syntax.** `Bash(git:*)` etc. not exposed in the picker. Phase 4 may add a per-tool advanced field.
- **Custom-tool addition via UI.** Imported tools outside `STANDARD_CC_TOOLS` are preserved and rendered, but the UI doesn't let you type a new custom tool name. Phase 4 plugin authoring is the natural home.
- **Per-window sync conflict.** Two windows editing the same agent at once: last write wins on disk. Same as today's body-edit story.
- **`agents:sync:status` event channel.** No live "sync in progress" indicator. The 1500ms debounce already gates writes; the status line updates on the next `agents:changed` broadcast.
