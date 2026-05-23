# Agent markdown section — design

**Date:** 2026-05-23
**Status:** Approved (brainstorming → ready for plan)

## Summary

Add a third section to the Library view — alongside Repositories and Collections — for a personal library of AI-agent markdown documents (system prompts, persona briefs, role descriptions). Entries are created by pasting markdown into a modal, organised into user-defined folders, and viewed/edited inline with the same RepoNotes-style rendered ↔ edit toggle already used elsewhere in the app.

This is a "curated clipboard library" — content is authored by pasting in, primary user action is copy-to-clipboard for use in other tools. No runtime AI integration with the existing in-app AI chat overlay.

## Goals

- Store, organise, view, and edit arbitrary markdown documents that represent AI agent personas / system prompts.
- Fit naturally into the existing Library shell (sidebar + detail), reusing existing patterns (Repositories, Collections, RepoNotes).
- Folders group agents in the sidebar; each agent belongs to one folder (or "Unfiled").
- Keep the schema and UI extensible so folders can later be promoted to first-class entities (with their own overview routes, colours, descriptions) without a migration.

## Non-goals

- No runtime invocation of agents (no Claude API integration, no swapping the in-app AI chat persona). These markdown documents are reference material only.
- No tags (folders alone for organisation).
- No multi-folder membership for a single agent.
- No import-from-disk / sync-with-folder workflow. Content arrives via paste.
- No folder overview route in this iteration (`/library/agent-folder/:id` is reserved but not built).

## Architecture overview

Three layers, matching the rest of the app:

1. **SQLite schema** — two new tables (`agent_folders`, `agents`) added in `electron/db.ts`.
2. **Main-process service + IPC** — `electron/services/agentsService.ts` + `electron/ipc/agentHandlers.ts`, exposed to the renderer via `window.api.agents.*`.
3. **Renderer UI** — third sidebar mode in `LibrarySidebar.tsx`, new `AgentsSidebar` component, new `AgentDetail` view, new `NewAgentModal` component, wired into `LibraryDetailRoutes.tsx` and `Library.tsx`.

## Data model

### Schema

Added to `electron/db.ts` alongside the existing `collections` / `collection_repos` block:

```sql
CREATE TABLE IF NOT EXISTS agent_folders (
  id          TEXT PRIMARY KEY,        -- UUID
  name        TEXT NOT NULL,
  color_start TEXT,                    -- null today; reserved for future first-class folders
  color_end   TEXT,                    -- null today
  description TEXT,                    -- null today
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,        -- UUID
  name        TEXT NOT NULL,           -- sidebar label; auto-derived from H1 on paste, editable
  body        TEXT NOT NULL,           -- raw markdown
  folder_id   TEXT REFERENCES agent_folders(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_folder ON agents(folder_id);
CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);
```

Rationale:
- `folder_id` nullable → deleting a folder moves its agents to "Unfiled" rather than orphaning or cascade-deleting them.
- `name` separate from `body` → sidebar label is stable when the body is rewritten.
- `agent_folders` carries placeholder columns (`color_start`, `color_end`, `description`) so future promotion to first-class folders is a UI change, not a schema migration.

### Renderer types

New file `src/types/agent.ts`:

```ts
export interface AgentFolderRow {
  id: string
  name: string
  color_start: string | null
  color_end:   string | null
  description: string | null
  created_at:  string
}

export interface AgentRow {
  id: string
  name: string
  body: string
  folder_id: string | null
  created_at: string
  updated_at: string
}
```

## IPC surface

Exposed via `electron/preload.ts` under `window.api.agents`:

```ts
window.api.agents = {
  getAll(): Promise<{ folders: AgentFolderRow[]; agents: AgentRow[] }>

  create(input: { name: string; body: string; folderId: string | null }): Promise<AgentRow>
  update(id: string, patch: { name?: string; body?: string; folderId?: string | null }): Promise<AgentRow>
  delete(id: string): Promise<void>
  duplicate(id: string): Promise<AgentRow>

  createFolder(name: string): Promise<AgentFolderRow>
  renameFolder(id: string, name: string): Promise<AgentFolderRow>
  deleteFolder(id: string): Promise<void>   // ON DELETE SET NULL on agents.folder_id

  onChanged(cb: () => void): void
  offChanged(cb: () => void): void
}
```

### Main-process behaviour

`electron/services/agentsService.ts`:

- `getAll()` — two `SELECT *` queries returned together; folders ordered by `name ASC`, agents by `updated_at DESC`. One round-trip.
- `create()` — generates UUID via `crypto.randomUUID()` (already used elsewhere); writes `created_at` / `updated_at` as ISO timestamps; returns the full inserted row.
- `update()` — partial patch; bumps `updated_at` on any change; validates that `folderId`, if provided, refers to an existing folder or is `null`.
- `delete()` — single `DELETE FROM agents WHERE id = ?`.
- `duplicate()` — `INSERT … SELECT` copying `body` and `folder_id`, name becomes `<name> (copy)`, new UUID and timestamps.
- Folder CRUD analogous. `deleteFolder()` relies on the `ON DELETE SET NULL` FK clause.

### Change events

After any successful mutation, the main process emits `'agents:changed'` via `webContents.send` to all renderer windows. `Library.tsx` subscribes and re-runs `window.api.agents.getAll()` through the same trailing-edge debounce pattern already used for `library:changed` (see `Library.tsx:64-67`).

### Validation

- `name`: max 200 chars; trimmed; cannot be empty after trim (falls back to `"Untitled agent"`).
- `body`: max ~1 MB. Defensive ceiling — SQLite handles far more, but this guards against accidental paste of binary content.
- `folderId`: must exist in `agent_folders` or be `null`.

## UI

### Sidebar — third toggle

`src/components/LibrarySidebar.tsx`:

```ts
type Mode = 'repos' | 'collections' | 'agents'
```

A third button is added to the existing `.library-sidebar-toggle` row with a new `AgentsIcon` (small SVG, 13×13, matching the existing toggle glyphs). When `mode === 'agents'`, the sidebar list slot renders a new `AgentsSidebar` component (peer of `CollectionsSidebar.tsx`).

Mode-restore effects in `Library.tsx` get a sibling for the agent route, matching the existing repo/collection pattern:

```ts
useEffect(() => { if (agentMatch) setMode('agents') }, [agentMatch?.params.id])
```

### `AgentsSidebar` (new component)

- Fetches via `window.api.agents.getAll()` on mount and on `agents:changed`.
- Renders folders sorted by name, each as an expandable section using the existing `.library-sidebar-section` / `.library-sidebar-section-header` styles (same DOM pattern as "Archived" and "Recently unstarred").
- A synthetic **"Unfiled"** section at the top holds agents with `folder_id === null`. Hidden when empty.
- Each agent row: small markdown-doc icon + name. Selected state highlights when URL matches `/library/agent/:id`.
- Top of the list: **"+ New agent"** button — opens `NewAgentModal`.
- Caret (expanded/collapsed) state per folder lives in component state — not persisted across mounts in this iteration.
- Search input (`searchTerm` from the parent sidebar) filters by agent name + body, case-insensitive substring.

### `AgentContextMenu` (new component)

Peer of `RepoContextMenu`. Right-clicking an agent row:
- Rename
- Move to folder… (submenu / popover with existing folders + "Unfiled" + "+ New folder")
- Duplicate
- Delete (with confirmation)

Right-clicking a folder header:
- Rename folder
- Set colour (disabled today)
- Delete folder (with confirmation — copy: "Agents in this folder will move to Unfiled")

### Detail view — `src/views/AgentDetail.tsx`

Wired into `LibraryDetailRoutes.tsx` as a third route at `/library/agent/:id`. Layout:

```
┌──────────────────────────────────────────────────────────┐
│  ← back   <agent name editable>             [⋯] [Edit]   │
├──────────────────────────────────────────────────────────┤
│  Folder: <Writing ▾>           Updated 2m ago  · 1.2kb   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  <rendered markdown via ReactMarkdown + remark-gfm>      │
│  …or full-bleed monospace <textarea> when editing        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [ Copy markdown ]                              Saved ✓  │
└──────────────────────────────────────────────────────────┘
```

Behaviour (mirrors `src/components/RepoNotes.tsx`):

- **Header name** click-to-edit (inline `<input>`, blur/Enter saves). Debounced save same as body.
- **Folder pill** is a `SimplePopover` listing folders + "Unfiled" + "+ New folder…". Selecting calls `window.api.agents.update(id, { folderId })`.
- **Edit toggle** swaps rendered ↔ textarea. Auto-save fires 1500ms after last keystroke (same constant as RepoNotes). Status pill in footer cycles `idle` → `saving…` → `saved ✓` (auto-fades after 2s).
- **Copy markdown** writes `body` to the clipboard verbatim; toast confirms via the existing `useToast` context.
- **Context menu (⋯)**: Rename, Move to folder…, Duplicate, Delete.
- **Markdown rendering** reuses the same ReactMarkdown setup + plugins (`remark-gfm`) as `RepoNotes` / `ReadmeRenderer` for consistent styling across the app.

Empty state at `/library` in agents mode: centered prompt — "No agent selected. Paste one in to get started." — with the same "+ New agent" button as the sidebar header.

### `NewAgentModal` (new component)

Peer of `src/components/NewCollectionModal.tsx`. Triggered by the "+ New agent" buttons in the sidebar header and detail empty state.

```
┌────────────────────────────────────────────────────────┐
│  New agent                                       [×]  │
├────────────────────────────────────────────────────────┤
│  Folder      [ Unfiled ▾  ]   [+ New folder]          │
│                                                        │
│  Name        [ auto-derived from first H1, editable ]  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                  │ │
│  │   Paste your markdown here…                      │ │
│  │   (full-height monospace textarea, autofocus)    │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│                              [ Cancel ]   [ Create ]   │
└────────────────────────────────────────────────────────┘
```

- **Autofocus** the textarea on open so paste flow is one motion: open → Cmd/Ctrl+V → Enter creates.
- **Name auto-derivation**: first `# Heading` in body → name. Falls back to first non-empty line trimmed to 60 chars. Falls back to `"Untitled agent"` if body is empty. User can override anytime in the input.
- **Folder picker**: existing folders + "Unfiled" (default). "+ New folder" collapses the picker into a small inline `<input>`; pressing Enter creates the folder row (via `window.api.agents.createFolder`) and selects it.
- **Create button** disabled while body is empty. On submit: calls `window.api.agents.create(...)`, modal closes, navigates to `/library/agent/:newId`. Sidebar updates via the `agents:changed` event.

### Routing summary

Added in `src/App.tsx` / `LibraryDetailRoutes.tsx`:

| Route                          | Component       |
|---|---|
| `/library/agent/:id`           | `AgentDetail`   |
| `/library/agent-folder/:id`    | *(reserved, not built — folders are not yet first-class)* |

In `Library.tsx`, `hasDetail` extends to `repoMatch || collMatch || agentMatch`.

## Testing

All tests use the project's existing Vitest + in-memory `better-sqlite3` setup.

### Main-process

- **`electron/agentsService.test.ts`** — CRUD on agents (create / update / delete / duplicate); folder CRUD; `ON DELETE SET NULL` behaviour when a folder is deleted; name + body validation ceilings; `updated_at` bumps on patch.
- **`electron/db.agents-migration.test.ts`** — schema initialises cleanly on a fresh DB and on a pre-agents DB. Mirrors `electron/db.phase23-migration.test.ts`.

### Renderer

- **`src/components/AgentsSidebar.test.tsx`** — renders folders + agents, expand/collapse, search filter, selection highlight, "Unfiled" group appears/disappears. Mirrors `LibrarySidebar.test.tsx`.
- **`src/views/AgentDetail.test.tsx`** — rendered ↔ edit toggle, debounced save (use Vitest fake timers), copy-to-clipboard, folder change. Mirrors the RepoNotes test patterns.
- **`src/components/NewAgentModal.test.tsx`** — autofocus, name auto-derivation from H1, inline folder creation, submit/cancel, navigates to new agent on success.

## Open questions

None at design time. (Folder overview routes, tags, multi-folder membership, and import-from-disk are explicitly deferred to future iterations if needed.)

## Files touched

**New:**
- `electron/services/agentsService.ts`
- `electron/services/agentsService.test.ts`
- `electron/ipc/agentHandlers.ts`
- `electron/db.agents-migration.test.ts`
- `src/types/agent.ts`
- `src/components/AgentsSidebar.tsx`
- `src/components/AgentsSidebar.test.tsx`
- `src/components/AgentContextMenu.tsx`
- `src/components/NewAgentModal.tsx`
- `src/components/NewAgentModal.test.tsx`
- `src/views/AgentDetail.tsx`
- `src/views/AgentDetail.test.tsx`

**Modified:**
- `electron/db.ts` (new tables + indexes)
- `electron/main.ts` (register agent handlers)
- `electron/preload.ts` (`window.api.agents.*` surface)
- `src/components/LibrarySidebar.tsx` (third toggle button, agents mode)
- `src/components/LibraryDetailRoutes.tsx` (third route)
- `src/views/Library.tsx` (`agentMatch`, mode-restore effect, `agents:changed` listener)
