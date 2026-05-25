# Agent Skill Parity (Phase 1 of 4) — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Phase context:** First of four phases bringing the library to full Claude Code plugin authoring parity. Phase 1 covers **skill format parity** — making each agent able to express everything a Superpowers-style SKILL.md directory can express, and round-tripping import from any installed plugin or arbitrary `SKILL.md` on disk. Subsequent phases will add subagent invocation (Phase 2), hooks (Phase 3), and plugin export/packaging (Phase 4).

---

## Overview

Extend the agent data model so each agent can hold an explicit `description`, a main markdown body (already exists as `body`), and a collection of named auxiliary files (sibling markdown referenced from the body, scripts, templates). Add a new **Files** tab to the agent detail view for managing those files in a split-view editor. Add an **Import skills** dialog that discovers installed Claude Code plugins, lists their skills, and imports selected skills as fully-owned agents in an auto-named folder. Track each imported agent's origin (plugin name, skill path, plugin version) so re-import can detect conflicts and offer overwrite/skip.

The agent's existing concept does not change — it's still a named markdown persona — but now any agent can carry the supporting files that make a skill complete. Scripts are stored as text and editable but **not executed** by Git-Suite; execution is whatever consumes the skill (Claude Code, MCP client, etc.).

---

## Goals

- A `SKILL.md` directory imported from `~/.claude/plugins/*/skills/<name>/` produces an agent that contains 100% of the skill's content (frontmatter description, body markdown, sibling `.md` files, `scripts/*`).
- Imported agents are fully editable — no read-only mode, no "managed by plugin" guardrails. The DB is the source of truth once imported.
- A user can browse installed plugins inside the app, pick a plugin, and bulk-import its skills with one click.
- A user can also point at any `SKILL.md` or skill directory on disk and import it.
- Re-importing the same plugin offers a per-skill or bulk overwrite/skip choice instead of silently duplicating.
- The detail view exposes attached files in a dedicated tab so the main Prompt tab stays focused on the persona body.
- Every existing agent gets a default-valued `description` on migration so the new field is non-null without breaking current data.

---

## Non-Goals (deferred to later phases)

- **No script execution.** Scripts are stored and editable but never run by Git-Suite. (Out of scope forever for this app; execution is the consumer's job.)
- **No subagent/tools/model fields.** Phase 2.
- **No hooks support.** Phase 3.
- **No plugin export.** Phase 4. Phase 1 is import-only.
- **No revision history for sibling files.** Only the main body (`SKILL.md`) keeps revision history, as today. Edits to sibling files save immediately but do not create `agent_revisions` rows. (We can add per-file history in a later spec if real pain emerges.)
- **No bulk reference-rewriting.** If the user renames a sibling file, references to the old name inside the main body are **not** auto-updated — we surface a warning ("3 references in SKILL.md still point at the old name") but the user fixes them by hand. Auto-rewriting markdown is fragile and out of scope.
- **No conflict resolution when two plugins ship a skill with the same handle.** Per the Auto-folder rule, each plugin imports into its own folder; handles are unique within the agent's folder for imported agents (we extend the uniqueness check from global → `(folder_id, handle)` for imported agents only, see Data Model).

---

## Data model

### Existing `agents` table — new columns

```sql
ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN origin_plugin TEXT;          -- NULL for hand-authored
ALTER TABLE agents ADD COLUMN origin_path TEXT;            -- e.g., 'skills/brainstorming'
ALTER TABLE agents ADD COLUMN origin_version TEXT;         -- e.g., '5.1.0'
ALTER TABLE agents ADD COLUMN origin_imported_at TEXT;     -- ISO timestamp
```

- `description` defaults to empty string. The existing `deriveDescription(body)` helper continues to exist and is used as a fallback for any agent where `description` is empty (so hand-authored agents that never set a description still get one rendered).
- The four `origin_*` columns are only populated by the import path. A `WHERE origin_plugin IS NOT NULL` query identifies imported agents.

### New `agent_files` table

```sql
CREATE TABLE agent_files (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,        -- e.g., 'visual-companion.md' or 'scripts/start-server.sh'
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, filename)
);
CREATE INDEX idx_agent_files_agent ON agent_files(agent_id);
```

- `filename` is the relative path within the skill directory — slashes allowed (e.g., `scripts/start-server.sh`). The UI uses the prefix before the first slash to group files into sections (Main / References / Scripts / etc.).
- `kind` is **not** stored — inferred from filename extension at render time. `.md` → markdown, `.sh`/`.js`/`.cjs`/`.mjs`/`.ts`/`.py` → script, otherwise → plain text. Syntax highlighting in the editor picks up from extension.
- `sort_order` lets the user reorder. Default order on import: the original directory listing order from disk.
- Cascade delete: removing an agent removes its files.

### Handle uniqueness

Handles remain **globally unique** across all agents (imported or hand-authored). This matches the prior agent-redesign spec, keeps the MCP URI scheme (`agent://<handle>`) unambiguous, and keeps the displayed `@git-suite/<handle>` mention unambiguous in AI chats.

Conflict resolution at import time uses the existing `dedupeHandle(slug, takenHandles)` helper in `src/utils/agentSlug.ts`. When the user picks **Rename** in the conflict dialog (see Import flow), the handle becomes `<original>-2`, `-3`, etc. When the user picks **Overwrite**, the existing agent is updated in place (handle preserved). **Skip** is a no-op.

If two plugins ship a skill called `brainstorming`, the second one to be imported triggers the conflict dialog and the user resolves explicitly. There is no auto-prefixing with the plugin name — the user sees the conflict and decides.

Display-side: the chip row gains a "from <plugin>" origin badge for imported agents, which provides visual disambiguation even though the handles themselves are unique.

---

## IPC contract additions

All new routes live under `window.api.agents.files.*` and `window.api.agents.import.*`:

```ts
// File CRUD
files: {
  list: (agentId: string) => Promise<AgentFile[]>
  create: (agentId: string, file: { filename: string; content: string; sortOrder?: number }) => Promise<AgentFile>
  update: (agentId: string, fileId: string, patch: { content?: string; filename?: string; sortOrder?: number }) => Promise<AgentFile>
  delete: (agentId: string, fileId: string) => Promise<void>
}

// Import
import: {
  discoverPlugins: () => Promise<DiscoveredPlugin[]>
  // Scans ~/.claude/plugins/*/ and ./node_modules/@*/* for plugin shapes.
  // Returns: { id, name, version, root, skills: [{ name, path, fileCount }] }[]

  readSkillFromDisk: (path: string) => Promise<ParsedSkill>
  // Path may be a SKILL.md file or a skill directory.
  // Parses frontmatter, body, and enumerates sibling files + scripts.

  importSkill: (skill: ParsedSkill, opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' }) =>
    Promise<{ agentId: string; conflictResolved: 'created' | 'overwritten' | 'skipped' | 'renamed' }>
}
```

Also extend the existing `update` route to accept a `description` field (camelCase: `description`).

### `AgentFile` shape (TypeScript)

```ts
interface AgentFile {
  id: string
  agent_id: string
  filename: string
  content: string
  sort_order: number
  created_at: string
  updated_at: string
}
```

### `DiscoveredPlugin` and `ParsedSkill` shapes

```ts
interface DiscoveredPlugin {
  id: string                // stable id: hash(root path)
  name: string              // from package.json or plugin.json or folder name
  version: string | null    // from package.json if present
  root: string              // absolute path
  skills: DiscoveredSkill[]
}

interface DiscoveredSkill {
  name: string              // from SKILL.md frontmatter, fallback to dir name
  path: string              // absolute path to skill directory
  description: string | null
  fileCount: number         // 1 (SKILL.md) + siblings + scripts
}

interface ParsedSkill {
  name: string
  handle: string            // slug version of name
  description: string
  body: string              // SKILL.md body (frontmatter stripped)
  files: { filename: string; content: string }[]
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
}
```

---

## Import flow

### Discovery

`discoverPlugins()` walks these roots, in order, looking for plugin-shaped directories:

1. `~/.claude/plugins/cache/*/*/`  (versioned plugin cache — Claude Code's install location)
2. `~/.claude/plugins/*/`            (direct install)
3. `<workspace>/.opencode/plugins/*/` (workspace-local)

A directory is plugin-shaped if it contains either:
- `package.json` with a `name` field, **and** a `skills/` subdirectory with at least one `<name>/SKILL.md`, **or**
- A bare `skills/<name>/SKILL.md` (treat parent directory name as the plugin name)

For each plugin, enumerate `skills/*/SKILL.md`. Read the frontmatter `name` and `description` for the preview. Don't read the full body during discovery — that happens at import time.

### Parsing a skill (`readSkillFromDisk`)

Given a path that is either a `SKILL.md` file or a directory containing one:

1. Locate `SKILL.md`. If the path is a directory, look for `SKILL.md` at its root. Error if missing.
2. Parse YAML frontmatter using `gray-matter` (new dependency — add to `package.json` and `electron/package.json` as needed). Required fields: `name` (string), `description` (string). All other frontmatter fields are **discarded** on import with a console warning naming the dropped keys. Phase 2 will add the structured fields the project understands (`model`, `tools`); Phase 4 will add round-trip-fidelity for arbitrary frontmatter via a JSON column. No `frontmatter_extra` column is added in this phase.
3. The skill's `body` is everything after the frontmatter.
4. The skill's `files` are every other file in the directory (recursive), with relative paths preserved. Exclude `SKILL.md` itself, plus standard ignore patterns: `.DS_Store`, `node_modules/`, `__pycache__/`, `.git/`, `*.swp`. **Files are sorted alphabetically by relative path** before assigning `sort_order` — this gives deterministic ordering across platforms.
5. `handle` is derived from `frontmatter.name` via the existing `slugifyName` if not already a valid handle.

### Bulk import from a plugin

User picks a plugin in the dialog → all its skills are listed with checkboxes (default: all checked). For each selected skill:

1. Ensure a folder named after the plugin exists. Find by `name === <plugin_name> AND has any agent with origin_plugin = <plugin_name>`. If none, create one with a default color (`#8b5cf6` violet — distinct from hand-authored agents). Future re-imports reuse the same folder.
2. Parse the skill (`readSkillFromDisk`).
3. Compute conflict: query `agents` for `(folder_id = <plugin folder>, handle = <skill handle>)`. If exists, follow `onConflict`:
   - `'overwrite'`: update the existing agent's `body`, `description`, `name`, `origin_version`, `origin_imported_at`; delete and recreate `agent_files` rows (cleanest).
   - `'skip'`: do nothing, return `{ conflictResolved: 'skipped' }`.
   - `'rename'`: append `-2`, `-3`… via the existing `dedupeHandle` helper; create a new agent.
4. Insert agent row with `origin_*` fields populated.
5. Insert `agent_files` rows in directory-listing order, sort_order = 0..N-1.

The dialog accumulates a summary: "Imported 12, overwrote 2, skipped 0". Toast on close.

### Single import from disk

Same parsing logic. After parsing, prompt the user for a destination folder (default: the currently-selected sidebar folder, fallback Unfiled).

**Origin detection.** If the picked path is under one of the discovery roots listed above (`~/.claude/plugins/...`, `<workspace>/.opencode/plugins/...`), extract the plugin name and version from the enclosing plugin directory and populate `origin_plugin`, `origin_path`, `origin_version`. Otherwise (path is in Downloads, a tarball extract, anywhere else), leave the `origin_*` fields null — the imported agent acts like a hand-authored agent that happens to have sibling files. The import dialog shows an inline "Origin (optional)" field for the user to fill in manually if they want the badge.

---

## UI changes

### Hero — description line restored

Add a paragraph under the handle row, above the meta chips, sourced from `agent.description` (or `deriveDescription(body)` if empty):

```tsx
{descriptionToShow && <p className="agent-detail-description">{descriptionToShow}</p>}
```

CSS — restore the description rule that was deleted in the prior redesign:

```css
.agent-detail-description {
  font-size: 12px;
  color: var(--t3);
  line-height: 1.5;
  margin: 0 0 8px;
  max-width: 680px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
```

### Hero — origin chip

The meta chip row gains a fourth chip when `agent.origin_plugin` is non-null:

```tsx
{agent.origin_plugin && (
  <span className="agent-detail-chip agent-detail-chip--origin">
    <Zap size={11} /> from {agent.origin_plugin}{agent.origin_version ? ` v${agent.origin_version}` : ''}
  </span>
)}
```

CSS variant `--origin` uses the accent purple tint to distinguish it.

### New Files tab

Add a `Files` tab between `History` and the divider/Settings tab. Active key: `'files'`. The tab key list widens:

```ts
useState<'prompt' | 'preview' | 'mcp' | 'history' | 'files' | 'settings'>('prompt')
```

Tab icon: Lucide `<FileText>` (or `<Files>` if Lucide ships it). Label shows a small count badge when files > 0: `Files (3)`.

#### Files tab body — split view

```tsx
<div className="agent-detail-files">
  <aside className="agent-detail-files-list">
    {/* Sectioned file list: Main / References / Scripts */}
    <FileListSection title="Main" files={[mainPseudoFile]} activeId={activeFileId} onSelect={...} />
    <FileListSection title="References" files={mdFiles} activeId={activeFileId} onSelect={...} />
    <FileListSection title="Scripts" files={scriptFiles} activeId={activeFileId} onSelect={...} />
    <button className="agent-detail-files-add" onClick={openAddFileDialog}>
      <Plus size={13} /> Add file
    </button>
  </aside>
  <section className="agent-detail-files-editor">
    <FileHeader file={activeFile} onRename={...} onDelete={...} referenceCount={refCount} />
    <FileEditorTextarea value={activeFile.content} onChange={...} />
  </section>
</div>
```

- The "Main" pseudo-file is `SKILL.md` — its content is the agent's `body`. Editing it from the Files tab updates `agents.body` (same field the Prompt tab edits). One source of truth.
- "References" section: any file with extension `.md`, `.mdx`, `.txt`.
- "Scripts" section: any file with extension `.sh`, `.js`, `.cjs`, `.mjs`, `.ts`, `.py`, `.rb`, `.go`, etc.
- "Other" section (only rendered if non-empty): everything else.
- The "Add file" button opens a small dialog asking for filename; on confirm creates an `agent_files` row with empty content.

#### File header — reference count

The header above the editor shows a count of how many times this file's name appears in the main body:

```ts
const referenceCount = useMemo(
  () => (file.id === 'main') ? 0 : countReferences(agent.body, file.filename),
  [file, agent.body],
)
```

`countReferences(body, name)` is a simple string match (not full markdown parsing) — count occurrences of the bare filename in the body. Display: `referenced 10× from SKILL.md` (singular: `1× from SKILL.md`, zero: `not yet referenced`).

#### Editor

A textarea with `font-family: 'JetBrains Mono', monospace`, no live syntax highlighting (out of scope; rely on monospace + the user's familiarity). Saves on blur and on a 1500ms debounce, same pattern as the body. The save pill from the Prompt tab is reused (one shared pill, repositioned for the Files tab).

#### Rename / delete

- **Rename:** opens an inline input in the header. On commit, validate the new filename matches `/^[\w./-]+$/` and is unique within the agent's files. Surface a "warning: N references to the old name in SKILL.md" toast if applicable (per the no-bulk-rewriting non-goal).
- **Delete:** confirm modal. Cascade is automatic on `agent_files.delete`.

### Import dialog

A new modal opened from the agents sidebar — extend the existing `+` popover (created in commit `32d442d`) with a second item: **"Import skill…"**.

Layout:

```
┌─Import skill──────────────────────────────────────────────┐
│ INSTALLED PLUGINS                                          │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ ⚡ Superpowers       v5.1.0    14 skills    [Import]   │ │
│ │ 📦 anthropic-skills  v—        7 skills     [Import]   │ │
│ │ 📦 cowork-plugin-management   3 skills      [Import]   │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                            │
│ ─ OR ─                                                     │
│                                                            │
│ [📁 Pick a SKILL.md or skill folder from disk…]            │
│                                                            │
│                                          [Cancel]          │
└────────────────────────────────────────────────────────────┘
```

Clicking [Import] on a plugin expands inline to a per-skill checkbox list with select-all/none and shows a "[Import N skills]" CTA at the bottom of that section.

Re-import (one or more skills already exist):

```
┌─Re-import 14 skills──────────────────────────────────────┐
│ 14 of 14 already exist in the "Superpowers" folder.       │
│                                                           │
│ How should existing skills be handled?                    │
│  ( ) Overwrite — replace body, description, and files    │
│  ( ) Skip — keep my edits, only import new (0 in this run)│
│  (•) Per-skill — choose one by one (next screen)          │
│                                                           │
│                              [Cancel]  [Continue]         │
└───────────────────────────────────────────────────────────┘
```

Per-skill screen: list with three radio buttons per row (Overwrite / Skip / Rename). Sticky header at top: bulk-apply controls.

---

## Components

### Modified

- **`src/views/AgentDetail.tsx`** — add `'files'` to the `activeTab` union; render `<AgentFilesTab agent={agent} />` when active; restore description rendering in the hero.
- **`src/views/AgentDetail.css`** — restore `.agent-detail-description`; add `.agent-detail-files*` block, `.agent-detail-chip--origin` variant.
- **`src/views/AgentDetail.test.tsx`** — new tests for Files tab.
- **`src/components/CreateAgentPanel.tsx`** — extend the sidebar `+` popover to include an "Import skill…" menu item that opens the new dialog.
- **`src/types/agent.ts`** — extend `AgentRow` with `description`, `origin_plugin`, `origin_path`, `origin_version`, `origin_imported_at`; add `AgentFile` interface.
- **`electron/preload.ts`** — add the `files.*` and `import.*` routes; extend `update` patch with `description`.
- **`electron/ipc/agentHandlers.ts`** — wire the new IPC handlers to the service layer.
- **`electron/services/agentsService.ts`** — add `listFiles`, `createFile`, `updateFile`, `deleteFile`. The existing `updateAgent` accepts the new `description` field.

### Added

- **`electron/services/skillImportService.ts`** — pure parsing logic. Functions: `discoverPlugins(roots)`, `parseSkill(path)`, `importSkill(skill, opts)`. Uses `gray-matter` for frontmatter (add as dep if missing).
- **`electron/services/skillImportService.test.ts`** — exhaustive tests against fixtures.
- **`src/components/AgentFilesTab.tsx`** — the Files tab body component (split view).
- **`src/components/AgentFilesTab.test.tsx`** — tests.
- **`src/components/ImportSkillDialog.tsx`** — the modal.
- **`src/components/ImportSkillDialog.test.tsx`** — tests.
- **DB migration:** `electron/db/migrations/00XX_add_skill_parity.sql` — the `ALTER`s and the `CREATE TABLE agent_files`. Migration number determined at implementation time based on the next free slot.

### Unchanged

- The MCP tab and launcher — imported skills still expose at `agent://<handle>` via the existing mechanism. The launcher does **not** read `agent_files`; skill consumers that want auxiliary files have to ask the user to copy them out, or wait for Phase 4 export.
- The History tab — still tracks `body` revisions only.
- The Preview tab — still renders the body (which is `SKILL.md`).

---

## Test plan

### Service-layer (Vitest, no DOM)

- `skillImportService.test.ts`:
  - Discovers a plugin with a valid `package.json` and `skills/foo/SKILL.md`.
  - Discovers a bare `skills/<name>/SKILL.md` parent and falls back to dir name.
  - Skips directories without a SKILL.md.
  - Parses frontmatter with `name` and `description`.
  - Errors when frontmatter is missing required fields.
  - Discards unknown frontmatter fields with a console warning.
  - Enumerates sibling `.md` files.
  - Enumerates `scripts/*` recursively.
  - Excludes `.DS_Store`, `node_modules`, `.git`.
  - Handles a SKILL.md without sibling files.
- `agentsService.test.ts` — extend existing:
  - `createFile`, `listFiles`, `updateFile`, `deleteFile` round-trip.
  - Cascade delete: removing an agent removes its files.
  - Filename uniqueness within agent.
  - `description` field round-trips.
- New import-flow integration test:
  - End-to-end: discover → import bulk → verify agents and files in DB.
  - Re-import overwrite: file content changes are reflected.
  - Re-import skip: existing agent untouched.
  - Re-import rename: new agent created with `-2` suffix.

### Component-layer (Vitest + Testing Library)

- `AgentFilesTab.test.tsx`:
  - Renders the file list with Main / References / Scripts sections.
  - Selecting a file shows its content in the editor.
  - Editing the Main pseudo-file updates `agents.body` via IPC.
  - Editing a sibling file updates `agent_files.content`.
  - Rename validates filename format and uniqueness.
  - Delete confirms and removes the file from the list.
  - "Add file" creates a new empty file.
  - Reference count is computed from the body.
- `ImportSkillDialog.test.tsx`:
  - Lists discovered plugins from the mocked IPC.
  - Bulk import sends one IPC call per skill with conflict mode.
  - Per-skill conflict screen renders correctly.
  - "Pick from disk" opens the OS dialog (mocked).
- `AgentDetail.test.tsx` — extensions:
  - Files tab is present and clickable.
  - Description renders in the hero from `agent.description`.
  - Description falls back to `deriveDescription(body)` when empty.
  - Origin chip renders when `origin_plugin` is set.

### Manual smoke test

- Import all 14 Superpowers skills. Verify each renders with full body + sibling files.
- Edit a sibling file, verify the change persists.
- Rename a sibling file, see the reference-count warning, manually update the body reference.
- Re-import Superpowers, choose overwrite-all, verify edits are lost as expected and a fresh copy lands.
- Re-import Superpowers, choose skip-all, verify nothing changes.

---

## Open items deferred to later phases

- **Per-file revision history.** Phase 1 only tracks body revisions. If users start losing important sibling-file edits, add per-file history in a follow-on spec.
- **Round-trip-fidelity frontmatter.** Unknown frontmatter fields are dropped on import. Phase 2 adds the structured fields the project actually understands (`model`, `tools`); Phase 4 adds the JSON catch-all column for true round-trip.
- **Reference rewriting on rename.** Manual for now. Phase 4 (export) is a natural place to add an "update references" affordance because export needs to validate references anyway.
- **Live syntax highlighting** in the script editor. Phase 1 uses a plain monospace textarea. A future spec could add CodeMirror or Monaco if the user reports friction.
- **Plugin-source updates (pull latest).** Imported agents are owned snapshots — they don't track upstream changes. A future "Check for plugin updates" feature could compare `origin_imported_at` against the disk file's mtime, but that's not in this spec.
- **Concurrent edit conflict resolution.** Multi-window editing of the same file isn't addressed. Same as today's agent body editing — last write wins.
