# Agents library redesign — design

**Date:** 2026-05-24
**Status:** Approved (brainstorming → ready for plan)
**Supersedes (partially):** `2026-05-23-agent-markdown-section-design.md` — original Agents tab spec is extended, not replaced. Tables, IPC surface, and sidebar shell from that spec stay; this document specifies the upgrades.

## Summary

Redesign the Agents tab from a thin "curated clipboard library" into a richer **library + launcher** hybrid. Each agent gets a unique `@handle`, a custom color/emoji, an optional set of `{{variables}}` with named presets, edit-history snapshots, and two invocation surfaces: a smart clipboard payload and a local MCP server exposing each agent as a resource. The sidebar shell stays exactly as it is today (folders + agent rows, same shape as Repositories). The redesign focuses on the **detail/main area** and **adds an MCP server** alongside the existing renderer experience.

## Goals

- Make every agent feel like a distinct, named entity — visible at a glance in the sidebar, prominent in the detail view.
- Make the primary user action (paste a system prompt into any AI) one click with the right framing baked in, including variable substitution.
- Let users save filled-in variable configurations as named **presets** they can switch between, each callable via a sub-handle (`@reviewer/security-review`).
- Expose agents to MCP-capable AI clients (Claude Code, Cursor) so they can fetch personas without copy/paste.
- Preserve everything that works today (sidebar, folders, basic CRUD) without disrupting existing rows.

## Non-goals

- No runtime AI execution inside Git Suite — the existing `@anthropic-ai/sdk` and `@anthropic-ai/claude-code` deps stay where they are; this feature stops at "produce a payload" or "expose a resource."
- No team/cross-user sharing of agents in this iteration.
- No tags (folders + filters cover the organisation need for now).
- No starter agents — empty library by design, onboarding nudge in the no-selection state.
- No richer text editor (the body is still a plain markdown `<textarea>` with the rendered/edit toggle).

## Architecture overview

Three additive layers on top of today's structure:

1. **Schema upgrade** — new columns on the existing `agents` table + a new `agent_revisions` table. No table renames, no destructive operations on existing rows.
2. **Main-process additions** — extend `agentsService` for the new fields/operations. Add a separate `mcp-launcher.cjs` script (standalone, not bound to Electron's lifecycle) that MCP clients launch directly; it reads the SQLite DB read-only and exposes agents as MCP resources over stdio.
3. **Renderer redesign** — replace `AgentDetail.tsx` with a new layout, add a no-selection landing for agents mode, enhance `AgentsSidebar.tsx` with the swatch + handle suffix, add a Create panel that's part of the detail route (not a modal).

## Data model

### Schema changes

```sql
-- Augment existing agents table
ALTER TABLE agents ADD COLUMN handle       TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN color_start  TEXT;           -- hex string, e.g. '#6366f1'
ALTER TABLE agents ADD COLUMN color_end    TEXT;           -- nullable; null = solid swatch
ALTER TABLE agents ADD COLUMN emoji        TEXT;           -- nullable; single emoji glyph
ALTER TABLE agents ADD COLUMN pinned       INTEGER NOT NULL DEFAULT 0;  -- 0/1
ALTER TABLE agents ADD COLUMN pinned_at    TEXT;           -- nullable; ISO timestamp
ALTER TABLE agents ADD COLUMN last_used_at TEXT;           -- nullable; ISO timestamp
ALTER TABLE agents ADD COLUMN presets_json TEXT NOT NULL DEFAULT '[]';

-- Indexes (created AFTER the backfill pass; see migration section)
CREATE UNIQUE INDEX idx_agents_handle    ON agents(handle);
CREATE INDEX        idx_agents_pinned    ON agents(pinned, pinned_at DESC);
CREATE INDEX        idx_agents_last_used ON agents(last_used_at DESC);

-- New table: edit history snapshots
CREATE TABLE IF NOT EXISTS agent_revisions (
  id           TEXT PRIMARY KEY,        -- UUID
  agent_id     TEXT NOT NULL,
  body         TEXT NOT NULL,
  presets_json TEXT NOT NULL,           -- snapshot of presets at this revision
  summary      TEXT NOT NULL,           -- short label, e.g. "edited prompt", "created agent"
  kind         TEXT NOT NULL,           -- 'create' | 'body_edit' | 'preset_change' | 'revert'
  created_at   TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_revisions_agent ON agent_revisions(agent_id, created_at DESC);
```

### `presets_json` shape

```json
[
  {
    "id": "p_security",
    "name": "Security review",
    "slug": "security-review",
    "values": {
      "language": "any",
      "focus_areas": "auth, SQL injection, secrets handling",
      "severity_threshold": "medium"
    }
  },
  {
    "id": "p_style",
    "name": "Style nitpick",
    "slug": "style-nitpick",
    "values": { "language": "TypeScript", "focus_areas": "naming, comments" }
  }
]
```

- `id` — stable UUID per preset (used for edit/rename without breaking references).
- `slug` — kebab-case of `name`, deduped per-agent. Used in the sub-handle: `@<handle>/<slug>`.
- `values` — sparse dict; missing keys mean the variable is unset (renders as `{{var}}` in copy payload).

### Revision retention

- Cap at **20 revisions per agent**. On `INSERT` into `agent_revisions`, prune older rows for the same `agent_id` if count > 20.
- Snapshot is taken on:
  - Initial create (`kind = 'create'`).
  - Body save with a non-trivial change (`kind = 'body_edit'`) — debounced like the body save already is.
  - Preset add / rename / value change (`kind = 'preset_change'`).
  - Revert action (`kind = 'revert'`).
- A snapshot stores the **post-change** body + presets, so reverting means writing the older snapshot's values back into `agents` and inserting a new `revert` snapshot above.

### Renderer types

Extend `src/types/agent.ts`:

```ts
export interface AgentRow {
  id: string
  name: string
  handle: string                     // unique, kebab-case, with no leading '@'
  body: string
  folder_id: string | null
  color_start: string | null         // e.g. '#6366f1'
  color_end: string | null           // null = solid
  emoji: string | null
  pinned: 0 | 1
  pinned_at: string | null
  last_used_at: string | null
  presets: AgentPreset[]             // parsed from presets_json
  created_at: string
  updated_at: string
}

export interface AgentPreset {
  id: string
  name: string
  slug: string
  values: Record<string, string>
}

export interface AgentRevision {
  id: string
  agent_id: string
  body: string
  presets: AgentPreset[]
  summary: string
  kind: 'create' | 'body_edit' | 'preset_change' | 'revert'
  created_at: string
}
```

## IPC surface

Extend `window.api.agents.*`:

```ts
window.api.agents = {
  // Existing surface (unchanged):
  getAll(): Promise<{ folders: AgentFolderRow[]; agents: AgentRow[] }>
  delete(id: string): Promise<void>
  duplicate(id: string): Promise<AgentRow>
  createFolder(name: string): Promise<AgentFolderRow>
  renameFolder(id: string, name: string): Promise<AgentFolderRow>
  deleteFolder(id: string): Promise<void>
  onChanged(cb: () => void): void
  offChanged(cb: () => void): void

  // Updated:
  create(input: {
    name: string
    handle: string
    body?: string
    folderId: string | null
    colorStart: string
    colorEnd: string | null
    emoji: string | null
  }): Promise<AgentRow>

  update(id: string, patch: {
    name?: string
    handle?: string
    body?: string
    folderId?: string | null
    colorStart?: string
    colorEnd?: string | null
    emoji?: string | null
    pinned?: boolean
  }): Promise<AgentRow>

  // New: presets
  presets: {
    create(agentId: string, name: string, values?: Record<string, string>): Promise<AgentPreset>
    update(agentId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }): Promise<AgentPreset>
    delete(agentId: string, presetId: string): Promise<void>
    duplicate(agentId: string, presetId: string): Promise<AgentPreset>
  }

  // New: revisions
  revisions: {
    list(agentId: string): Promise<AgentRevision[]>
    revert(agentId: string, revisionId: string): Promise<AgentRow>
  }

  // New: clipboard helper — main process records last_used_at when the user copies
  recordUse(agentId: string, presetId: string | null): Promise<void>
}
```

### Validation

- `handle` — `/^[a-z0-9][a-z0-9-]{0,63}$/`. Must be unique across all agents. Rejection surfaced inline in the renderer.
- `colorStart`, `colorEnd` — hex strings `/^#[0-9a-f]{6}$/i`. `colorEnd === null` is the solid case.
- `emoji` — single Unicode grapheme, max 8 bytes (covers ZWJ sequences).
- Preset `name` non-empty, max 80 chars. `slug` is derived server-side from `name` and deduped per-agent.
- `presets_json` capped at 64 KB to keep the row small.

### Change events

Existing `'agents:changed'` event continues to fire on any mutation. New events emitted from main:

- `'agents:revision-added'` — sent after a snapshot is inserted, so the History tab can append in place rather than re-fetching the whole list.

The MCP server does **not** subscribe to these — it re-reads from disk on every request and relies on SQLite WAL mode for cross-process freshness.

## UI

The sidebar shell from `2026-05-23-agent-markdown-section-design.md` stays unchanged in structure (folder groups, agent rows, search, "+ New agent" header). Two visual additions to `AgentsSidebar`:

- Each agent row gets a **14×14 swatch** (with emoji overlay if set) on the left of the name.
- The `@handle` is rendered as a small monospace suffix to the right of the name, in `var(--t3)` colour, truncating after the available width.

The detail/main area is the focus of the redesign.

### State A — no agent selected (agents mode only)

Replaces the default `ActivityFeed` when `mode === 'agents'` and no agent is open. Rendered in `Library.tsx`'s `library-detail-area` slot.

```
┌──────────────────────────────────────────────────────────────┐
│  AGENTS                                                       │
│  Your prompt library                                          │
│  6 agents · Click any in the sidebar, or copy a handle.       │
│                                                               │
│  ★ Pinned                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ 🔍 swatch    │ │ ✉️ swatch    │ │ 📋 swatch    │              │
│  │ @investigator│ │ @email-...   │ │ @planner     │              │
│  │ Code Invest. │ │ Email Draft. │ │ Daily Stand. │              │
│  │ snippet...   │ │ snippet...   │ │ snippet...   │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
│                                                               │
│  Recent                                                       │
│  ●  @reviewer        Strict Code Reviewer    2h ago           │
│  ●  @therapist       Calm Therapist          Yesterday        │
│  ●  @bug-triager     Bug Triager             3d ago           │
└──────────────────────────────────────────────────────────────┘
```

- **Pinned grid**: 3 columns, agents with `pinned = 1` ordered by `pinned_at DESC`. Hidden when empty.
- **Recent list**: up to 10 agents ordered by `last_used_at DESC`. Hidden when nothing has been used.
- **Onboarding state**: when pinned and recent are both empty, the area shows a single centered card explaining handles/variables/presets and a prominent "+ New agent" CTA.

### State B — agent open

```
┌──────────────────────────────────────────────────────────────────┐
│  [BIG SWATCH 🔍]   @investigator                       [Copy]    │
│                    Code Investigator                   [Edit]    │
│                    Short description from body.        [⋯ More]  │
│                    [Engineering] [★ Pinned] [1.2 kb] [2h ago]    │
├──────────────────────────────────────────────────────────────────┤
│  Prompt · Preview · MCP · History                                │
├──────────────────────────────────────────────────────────────────┤
│  (tab content)                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Hero** (`agent-detail-hero`):
- Big 64×64 swatch with emoji overlay. Solid background when `color_end === null`, gradient otherwise.
- Stacked id block: `@handle` (mono purple) → `<name>` (h1) → derived description (one line, truncated).
- Meta chip row: folder name, pinned star (if `pinned`), body size in kb, "Updated Xago".
- Right column:
  - **Copy** button (primary, accent) — emits the clipboard payload for the active preset (or no preset).
  - **Edit** toggle — same as today, swaps the Prompt tab's body view between rendered markdown and the textarea editor.
  - **More** menu (`⋯`) with: Rename, Pin/Unpin, Customise (re-opens the color/emoji picker), Move to folder, Duplicate, Delete.

**Tabs**:

- **Prompt** — default. If body has `{{variables}}`, the variable/preset bar renders above the body editor (see below). Body itself is the same markdown textarea / rendered toggle as today, just inside the hero+tabs frame.
- **Preview** — shows the exact clipboard payload that the active preset would produce (or the raw body framed if no preset). Read-only. Useful for confirming what the user will paste.
- **MCP** — explains how to wire this agent into Claude Code / Cursor. Shows the resource URI (`agent://<handle>`), the sub-handles for each preset, and a one-click "Copy MCP config" snippet for `~/.claude/settings.json` or the equivalent.
- **History** — timeline view, see below.

### Variable / preset bar (Prompt tab)

Shown above the body editor only when the body contains `{{variable}}` patterns. Layout: vertical preset stack (~220px wide) on the left, content on the right.

```
┌──────────────┬──────────────────────────────────────────────────┐
│  PRESETS     │  @reviewer/security-review                       │
│  ● Security  │  3 variables · last edited 2h ago      [📋 Copy] │
│    Style     │                                                  │
│    TS strict │  {{language}}            [ any                ]  │
│    Quick     │  {{focus_areas}}         [ auth, SQL inj...   ]  │
│  + New       │  {{severity_threshold}}  [ medium             ]  │
│              │  ┌──────────── COPY PAYLOAD PREVIEW ─────────┐  │
│              │  │ You are @reviewer/security-review, ...   │  │
│              │  └──────────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────────────┘
```

- **Preset rows**: each shows name + the callable sub-handle (`@reviewer/security-review`) in mono purple. Hover reveals an `⋯` action (rename / duplicate / delete).
- **"+ New preset"** dashed row: clicking opens a name input, snapshots current variable values into a fresh preset (does not overwrite the active preset).
- **Active preset** highlighted with a left border accent + tinted background.
- **Variables grid**: right column shows the variables detected in the body. Editing a value updates the active preset's `values[var]` live (debounced save).
- **Copy payload preview**: small monospaced block under the variables grid showing exactly what the Copy button will produce, with substituted values highlighted in purple.
- **No variables in body** — the entire bar is hidden; Prompt tab shows only the body editor.

### Variable detection and substitution

- Pattern: `/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`.
- Detection happens both in the renderer (to show the variables grid) and in main process / MCP server (for substitution before producing the clipboard payload or MCP resource). Single shared helper in `src/utils/agentVariables.ts`, also importable by the main process.
- The list of variable names detected in the current body is canonical — preset `values` may carry stale keys for variables that were removed from the body; those keys are kept (in case the user re-adds the variable) but not shown in the grid and not substituted into the payload.
- When a body edit removes the last variable, the preset bar collapses; presets themselves are not deleted.

### History tab (timeline)

Mirrors `ActivityFeed.tsx` structure. Events grouped by day with `DateDivider`s. Each row:

```
┌────────┬─────┬──────────────────────────────────────┬──────────┐
│ 3:42PM │  ●  │ edited prompt — Add severity_thresh… │ View Rev │
│        │     │ +12 / −3 · body                      │          │
└────────┴─────┴──────────────────────────────────────┴──────────┘
```

- Time column (left), event marker dot (color-coded by `kind`), summary + stats, hover-revealed actions (`View diff`, `Restore` where applicable).
- Dot colors: `body_edit` → accent purple, `create` → green, `revert` → amber, `preset_change` → muted neutral.
- `View diff` for `body_edit` opens a side-by-side diff modal (reuse existing diff infrastructure if any; otherwise a simple two-pane `<pre>` viewer is acceptable).
- `Restore` is available on any non-current row; restoring inserts a new `revert` snapshot above and writes the older body+presets back into `agents`.

### Create-agent panel

Replaces `NewAgentPanel.tsx` in-place (the existing route `/library/agent/new` or whatever its mount point is). Layout matches the brainstorm v3 mockup:

```
Name      [ Code Investigator                                    ]
Handle    [ @code-investigator                                   ]
          Auto from name (space → dash, lowercase). Must be unique.

Customisation
  ┌─────────────────────────────────────────────────────────────┐
  │  Color · [ Solid ] [ Gradient ]    🔍 Click to pick emoji   │
  │                                                              │
  │  (solid)   [█] #6366f1                                       │
  │                                                              │
  │  (gradient)  [█] #6366f1  →  [█] #a855f7   [preview bar]    │
  │              Auto-fit second color:                          │
  │              [Manual] [Mono] [Analogous] [Complementary]…    │
  └─────────────────────────────────────────────────────────────┘

Live preview: [swatch] Code Investigator  @code-investigator

                                            [ Cancel ]  [ Create ]
```

- **Solid/Gradient toggle**: solid is the default. Switching to gradient reveals the second color picker + mode chips.
- **Gradient mode chips** (color theory rules): Manual, Monochromatic, Analogous, Complementary (default when switching to gradient), Split-complementary, Triadic, Tetradic. Selecting a mode auto-derives `color_end` from `color_start` using HSL math:
  - Monochromatic: same hue, lightness shifted +25%.
  - Analogous: hue +30°.
  - Complementary: hue +180°.
  - Split-complementary: hue +150°.
  - Triadic: hue +120°.
  - Tetradic: hue +90°.
  - Manual: `color_end` is independent; user picks freely.
- **Emoji picker**: clicking the emoji slot opens a popover with a searchable grid. Backed by a small emoji JSON (we can use a curated subset, ~200 commonly-useful emojis, to avoid pulling in a huge dataset). Selecting writes to `emoji` field.
- **Create button** is enabled once name and handle are both valid. Body starts empty; on create, the user is dropped into the Prompt tab in edit mode (matches today's behavior).

## Clipboard payload format

When the user clicks **Copy** on the hero or in the variable/preset bar:

```
You are @<handle>[/<preset-slug>], <description>.

<body with {{variables}} substituted>
```

- `<description>` is the derived description (first non-heading line of body, trimmed). If empty, the framing line is `You are @<handle>[/<preset-slug>].`
- Variable substitution: every `{{var}}` in the body is replaced by the active preset's `values[var]`. Missing values stay as literal `{{var}}` so the user can fill manually.
- If no preset is active, the framing line uses just `@<handle>` and variables are left raw.

After a successful copy, `window.api.agents.recordUse(id, presetId)` is called, which:
1. Updates `last_used_at = NOW()` on the agent.
2. Emits `agents:changed` so the sidebar Recent list refreshes.

Note: MCP resource reads do **not** call `recordUse` (the MCP server is a read-only process with no IPC channel to main). Tracking "recent" for MCP-driven invocations is deferred.

## MCP server

A new standalone script: `electron/mcp-launcher.cjs`. Uses the existing `@modelcontextprotocol/sdk` dep. Bundled with the app at build time and shipped alongside the Electron binary.

### Lifecycle

- The MCP server is a **standalone Node script** (`electron/mcp-launcher.cjs`), not embedded in the Electron main process. MCP clients (Claude Code, Cursor) launch it as a child process via stdio.
- The launcher opens the same `better-sqlite3` database file Git Suite uses (`app.getPath('userData')/git-suite.sqlite` or equivalent — exact path resolved at build time and embedded into the launcher, or computed at runtime via a small platform-specific helper).
- SQLite supports concurrent readers safely; the launcher opens the DB **read-only** (`new Database(path, { readonly: true })`). All resource reads come straight from disk on each request — no cache, no IPC to the running Electron process.
- Rationale: this isolates the MCP server from Electron's lifecycle. Git Suite doesn't need to be running for an MCP client to read agents, but if the user has just edited an agent in Git Suite, the change is immediately visible to MCP because SQLite's WAL mode makes it readable from the read-only handle.

### Resources exposed

| URI                                | Returns                                                          |
|------------------------------------|------------------------------------------------------------------|
| `agent://`                         | Catalog: list of `{handle, name, description, presets: [{slug, name}]}` |
| `agent://<handle>`                 | Plain body, raw — `{{vars}}` not substituted                     |
| `agent://<handle>/<preset-slug>`   | Body with that preset's values substituted                        |

- No tools exposed (per the design decision — agents are pure data resources).
- 404 on unknown handle or unknown preset slug. Resource list response is the authoritative catalog for clients that want to enumerate.

### Configuration the user adds to their MCP client

The **MCP** tab of the agent detail view shows the user the exact JSON snippet to paste into their MCP client's config, prefilled with the correct absolute path for their install. Example shape:

```json
{
  "mcpServers": {
    "git-suite-agents": {
      "command": "node",
      "args": ["<path-resolved-at-runtime>/mcp-launcher.cjs"]
    }
  }
}
```

The "Copy MCP config" button in the MCP tab copies this snippet with the resolved path baked in.

### Pinning behavior

- `pinned` is a boolean flag (stored as 0/1 INTEGER). When a user pins an agent: `pinned = 1`, `pinned_at = NOW()`. When unpinning: `pinned = 0`, `pinned_at` left as-is (preserves original pin time for re-pinning UX).
- Pinned ordering: `ORDER BY pinned_at DESC` for the Pinned grid.
- IPC accepts `pinned?: boolean` and the service layer converts to 0/1 + manages `pinned_at`.

## Migration

Runs once on app upgrade, idempotently. Detects "needs backfill" by checking for any row in `agents` with `handle = ''`.

```
1. ALTER TABLE agents ADD COLUMN ... (each new column, with safe defaults)
2. Insert default row values via SQL (handle = '' triggers backfill)
3. For each row WHERE handle = '':
   a. slug = slugify(name) -- "Agent 1" → "agent-1"
   b. Dedupe against existing handles; suffix with -2, -3 on collision
   c. color_start = pickStableColor(slug)  -- HSL hue from hash, fixed saturation/lightness
   d. color_end = null  -- solid
   e. emoji = null  -- UI fallback used
   f. UPDATE row
4. CREATE UNIQUE INDEX idx_agents_handle ON agents(handle)
5. CREATE other indexes
6. CREATE TABLE agent_revisions (if not exists)
7. Insert a 'create' revision for each existing agent (snapshotting current body)
```

Re-runs are no-ops: any row already has `handle != ''`, so the backfill loop skips it.

## Testing

Existing tests for `agentsService`, `AgentsSidebar`, `AgentDetail`, and the migration tests stay; new tests added.

### Main-process

- **`electron/agentsService.handle.test.ts`** — handle generation, dedup, validation (rejects bad chars, enforces uniqueness on update).
- **`electron/agentsService.presets.test.ts`** — preset CRUD, slug derivation, substitution into body, missing-variable behavior.
- **`electron/agentsService.revisions.test.ts`** — snapshot creation on each kind of mutation, retention cap, revert behavior.
- **`electron/agentsService.migration.test.ts`** — backfill from a pre-redesign DB (handle = '' rows get filled), idempotency on re-run, deduplication of generated handles.
- **`electron/mcp-launcher.test.ts`** — given a seeded DB file, the launcher returns the right catalog, resolves handles + preset slugs, substitutes variables correctly, and 404s on unknown.

### Renderer

- **`src/views/AgentDetail.test.tsx`** — hero render, tab switching, Copy emits correct clipboard payload (assert against `navigator.clipboard.writeText` mock), preset switch updates copy payload.
- **`src/views/AgentDetail.variables.test.tsx`** — variable detection, preset bar visibility, create-new-preset, value editing flow.
- **`src/views/AgentDetail.history.test.tsx`** — timeline grouping, restore inserts a new revert snapshot, snapshot retention cap surfacing.
- **`src/views/AgentsLanding.test.tsx`** — no-selection state renders pinned/recent grids; empty case renders onboarding nudge.
- **`src/components/CreateAgentPanel.test.tsx`** — name → handle auto-fill, color modes (solid/gradient + harmony auto-fit), emoji picker, live preview, create submits with full payload.
- **`src/components/AgentsSidebar.test.tsx`** — extends existing tests to assert swatch + handle suffix render.

## Open questions

None at design time. Items explicitly deferred to future iterations:
- Sharing/sync of agents across machines or users.
- Tags as a first-class concept alongside folders.
- Full emoji-picker dataset (this iteration ships a curated subset).
- Side-by-side diff modal polish (acceptable fallback: simple two-pane `<pre>`).
- Hooks for "auto-copy on AI tool open" (browser-extension territory; not in scope).

## Files touched

**New:**
- `electron/mcp-launcher.cjs` (standalone MCP server script — bundled with the app, launched by MCP clients)
- `electron/mcp-launcher.test.ts`
- `electron/agentsService.handle.test.ts`
- `electron/agentsService.presets.test.ts`
- `electron/agentsService.revisions.test.ts`
- `electron/agentsService.migration.test.ts`
- `src/components/CreateAgentPanel.tsx` (replaces existing `NewAgentPanel.tsx`)
- `src/components/CreateAgentPanel.test.tsx`
- `src/components/AgentVariablePresetBar.tsx`
- `src/components/AgentHistoryTimeline.tsx`
- `src/components/AgentEmojiPicker.tsx`
- `src/components/AgentColorPicker.tsx`
- `src/views/AgentsLanding.tsx` (no-selection state for agents mode)
- `src/views/AgentsLanding.test.tsx`
- `src/views/AgentDetail.variables.test.tsx`
- `src/views/AgentDetail.history.test.tsx`
- `src/utils/colorHarmony.ts` (HSL math for gradient modes)
- `src/utils/agentSlug.ts` (handle + preset slug generation)
- `src/utils/agentVariables.ts` (variable detection + substitution)

**Modified:**
- `electron/db.ts` — ALTER TABLE + new table + indexes + backfill
- `electron/services/agentsService.ts` — new fields/operations
- `electron/ipc/agentHandlers.ts` — new IPC routes for presets, revisions, recordUse
- `electron/main.ts` — register the IPC handlers for `presets`, `revisions`, `recordUse`. (Does NOT start the MCP server — the MCP launcher is invoked by MCP clients, not by Electron.)
- `electron/preload.ts` — extend `window.api.agents.*`
- `src/types/agent.ts` — new fields + `AgentPreset` + `AgentRevision` interfaces
- `src/components/AgentsSidebar.tsx` — swatch + handle suffix in rows
- `src/views/AgentDetail.tsx` — new hero + tabs layout
- `src/views/AgentDetail.css` — full restyle
- `src/views/Library.tsx` — swap `ActivityFeed` for `AgentsLanding` when `mode === 'agents'` and no agent is open

**Removed:**
- `src/components/NewAgentPanel.tsx` (superseded by `CreateAgentPanel.tsx`)
- `src/components/NewAgentModal.tsx` if it still exists post-commit `d612bb6`
