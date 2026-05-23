# Agent Markdown Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Library mode ("Agents") for a personal SQLite-backed library of AI-agent markdown documents, organised into folders, with a paste-to-create flow and a RepoNotes-style rendered ↔ edit detail view.

**Architecture:** Two new SQLite tables (`agent_folders`, `agents`) in `electron/db.ts`. A main-process service (`agentsService.ts`) plus IPC handlers (`agentHandlers.ts`) exposed via `window.api.agents.*` in `preload.ts`. Renderer adds a third sidebar toggle (`Mode = 'agents'`), a new `AgentsSidebar` component, an `AgentDetail` view at `/library/agent/:id`, and a `NewAgentModal` paste-to-create dialog. All mutations broadcast `agents:changed` over IPC; the existing `Library.tsx` debounced refresh pattern is reused.

**Tech Stack:** Electron + React + TypeScript + `better-sqlite3` + ReactMarkdown + Vitest (`@vitest/environment: jsdom` for components, `node` for service tests).

**Spec:** [docs/superpowers/specs/2026-05-23-agent-markdown-section-design.md](../specs/2026-05-23-agent-markdown-section-design.md)

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `electron/services/agentsService.ts` | Pure DB CRUD for agents + folders. Stateless aside from holding a `Database` reference. |
| `electron/services/agentsService.test.ts` | Vitest (`environment: node`) coverage for the service against an in-memory `better-sqlite3` instance. |
| `electron/ipc/agentHandlers.ts` | Registers `agents:*` IPC channels, delegates to `agentsService`, emits `'agents:changed'` to all renderer windows on mutation. |
| `electron/db.agents-migration.test.ts` | Migration test asserting tables, indexes, and `ON DELETE SET NULL` behaviour. |
| `src/types/agent.ts` | Renderer-side `AgentRow` and `AgentFolderRow` interfaces. |
| `src/components/AgentsSidebar.tsx` | Sidebar mode for Agents: folders + Unfiled, expandable groups, "+ New agent" button, search filter. |
| `src/components/AgentsSidebar.test.tsx` | Renders folders, expands/collapses, applies search, highlights selected. |
| `src/components/AgentContextMenu.tsx` | Right-click menu for agent rows AND folder headers (two variants in one file). |
| `src/components/NewAgentModal.tsx` | Paste-to-create modal: folder picker (with inline create), name (auto-derived from H1), body textarea, Create button. |
| `src/components/NewAgentModal.test.tsx` | Autofocus, H1 derivation, folder creation, submit/cancel. |
| `src/views/AgentDetail.tsx` | Rendered markdown ↔ textarea toggle with 1500ms debounced auto-save, inline name edit, folder pill, copy-to-clipboard, status pill. |
| `src/views/AgentDetail.test.tsx` | Toggle, debounced save, copy, folder change. |

**Modified files:**

| Path | Change |
|---|---|
| `electron/db.ts` | Add `agent_folders` and `agents` tables + indexes to `initSchema()`. |
| `electron/main.ts` | Import `registerAgentHandlers` from `ipc/agentHandlers` and call it from the existing handler-registration block. |
| `electron/preload.ts` | Add `window.api.agents.*` surface. |
| `src/components/LibrarySidebar.tsx` | Extend `Mode` to include `'agents'`, add third toggle button + icon, swap `AgentsSidebar` in when active. |
| `src/components/LibraryDetailRoutes.tsx` | Add `<Route path="agent/:id" element={<AgentDetail />} />` to both the entering and leaving `<Routes>` blocks. |
| `src/views/Library.tsx` | Add `useMatch('/library/agent/:id')`, extend `hasDetail`, add `agents:changed` listener wired to `scheduleRefresh`. |

---

## Task 1: Schema migration + migration test

**Files:**
- Modify: `electron/db.ts:35-77` (extend the main `db.exec()` block)
- Create: `electron/db.agents-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `electron/db.agents-migration.test.ts`:

```ts
// electron/db.agents-migration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'

describe('db migration — agent markdown section', () => {
  it('creates agent_folders table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agent_folders')").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'color_start', 'color_end', 'description', 'created_at',
    ]))
  })

  it('creates agents table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'body', 'folder_id', 'created_at', 'updated_at',
    ]))
  })

  it('creates idx_agents_folder and idx_agents_updated indexes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    const indexes = db.prepare("PRAGMA index_list('agents')").all() as { name: string }[]
    const names = indexes.map(i => i.name)
    expect(names).toEqual(expect.arrayContaining(['idx_agents_folder', 'idx_agents_updated']))
  })

  it('ON DELETE SET NULL: deleting a folder nulls out folder_id on its agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    const db = getDb(dir)
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES ('f1', 'Writing', '2026-05-23T00:00:00Z')`).run()
    db.prepare(`
      INSERT INTO agents (id, name, body, folder_id, created_at, updated_at)
      VALUES ('a1', 'Test', '# Test', 'f1', '2026-05-23T00:00:00Z', '2026-05-23T00:00:00Z')
    `).run()
    db.prepare(`DELETE FROM agent_folders WHERE id = 'f1'`).run()
    const row = db.prepare(`SELECT folder_id FROM agents WHERE id = 'a1'`).get() as { folder_id: string | null }
    expect(row.folder_id).toBeNull()
  })

  it('initialises cleanly on a pre-existing DB (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-suite-db-'))
    getDb(dir)
    // Re-open the same dir — initSchema runs again
    const db = getDb(dir)
    const cols = db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    expect(cols.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/db.agents-migration.test.ts`
Expected: 5 failures with `no such table: agent_folders` / `no such table: agents`.

- [ ] **Step 3: Add the schema to `electron/db.ts`**

Inside `initSchema()`, add the following blocks to the main `db.exec()` template literal (insert immediately after the existing `repo_releases_cache` block at `electron/db.ts:148-154` — before the `http_etag_cache` block):

```sql
    CREATE TABLE IF NOT EXISTS agent_folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color_start TEXT,
      color_end   TEXT,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      body        TEXT NOT NULL,
      folder_id   TEXT REFERENCES agent_folders(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_folder  ON agents(folder_id);
    CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);
```

`foreign_keys = ON` is already set in the pragma block (`electron/db.ts:7`), so the `ON DELETE SET NULL` clause is honoured.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/db.agents-migration.test.ts`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.agents-migration.test.ts
git commit -m "feat(agents): add agent_folders and agents tables to schema"
```

---

## Task 2: `agentsService` — CRUD with TDD

**Files:**
- Create: `src/types/agent.ts`
- Create: `electron/services/agentsService.test.ts`
- Create: `electron/services/agentsService.ts`

- [ ] **Step 1: Create the shared types file**

Create `src/types/agent.ts`:

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

- [ ] **Step 2: Write the failing service tests**

Create `electron/services/agentsService.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import {
  createAgent, updateAgent, deleteAgent, duplicateAgent, getAllAgents,
  createFolder, renameFolder, deleteFolder,
  AGENT_NAME_MAX, AGENT_BODY_MAX,
} from './agentsService'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('agentsService — folders', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createFolder inserts a row and returns it', () => {
    const f = createFolder(db, 'Writing')
    expect(f.name).toBe('Writing')
    expect(f.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(f.created_at).toMatch(/T/)
    expect(f.color_start).toBeNull()
  })

  it('renameFolder updates the name', () => {
    const f = createFolder(db, 'Writing')
    const updated = renameFolder(db, f.id, 'Research')
    expect(updated.name).toBe('Research')
  })

  it('deleteFolder removes the row and nulls agents.folder_id', () => {
    const f = createFolder(db, 'Writing')
    const a = createAgent(db, { name: 'A', body: '# A', folderId: f.id })
    deleteFolder(db, f.id)
    const all = getAllAgents(db)
    expect(all.folders.find(x => x.id === f.id)).toBeUndefined()
    expect(all.agents.find(x => x.id === a.id)?.folder_id).toBeNull()
  })
})

describe('agentsService — agents', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent inserts and returns the row', () => {
    const a = createAgent(db, { name: 'Editor', body: '# Editor\nbody', folderId: null })
    expect(a.name).toBe('Editor')
    expect(a.body).toBe('# Editor\nbody')
    expect(a.folder_id).toBeNull()
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.created_at).toBe(a.updated_at)
  })

  it('createAgent rejects when name exceeds AGENT_NAME_MAX', () => {
    const name = 'x'.repeat(AGENT_NAME_MAX + 1)
    expect(() => createAgent(db, { name, body: 'body', folderId: null }))
      .toThrow(/name.*length/i)
  })

  it('createAgent rejects when body exceeds AGENT_BODY_MAX', () => {
    const body = 'x'.repeat(AGENT_BODY_MAX + 1)
    expect(() => createAgent(db, { name: 'X', body, folderId: null }))
      .toThrow(/body.*length/i)
  })

  it('createAgent rejects unknown folderId', () => {
    expect(() => createAgent(db, { name: 'X', body: 'b', folderId: 'nope' }))
      .toThrow(/folder/i)
  })

  it('createAgent falls back to "Untitled agent" when name is empty after trim', () => {
    const a = createAgent(db, { name: '   ', body: 'b', folderId: null })
    expect(a.name).toBe('Untitled agent')
  })

  it('updateAgent applies a partial patch and bumps updated_at', async () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5)) // ensure ISO timestamp differs
    const u = updateAgent(db, a.id, { body: 'b2' })
    expect(u.body).toBe('b2')
    expect(u.name).toBe('A')
    expect(u.updated_at > a.updated_at).toBe(true)
  })

  it('updateAgent can set folder_id back to null', () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'A', body: 'b', folderId: f.id })
    const u = updateAgent(db, a.id, { folderId: null })
    expect(u.folder_id).toBeNull()
  })

  it('updateAgent rejects unknown folderId', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    expect(() => updateAgent(db, a.id, { folderId: 'nope' })).toThrow(/folder/i)
  })

  it('deleteAgent removes the row', () => {
    const a = createAgent(db, { name: 'A', body: 'b', folderId: null })
    deleteAgent(db, a.id)
    const all = getAllAgents(db)
    expect(all.agents.find(x => x.id === a.id)).toBeUndefined()
  })

  it('duplicateAgent copies body+folder, names "X (copy)", assigns new id+timestamps', async () => {
    const f = createFolder(db, 'F')
    const a = createAgent(db, { name: 'Original', body: 'body', folderId: f.id })
    await new Promise(r => setTimeout(r, 5))
    const d = duplicateAgent(db, a.id)
    expect(d.id).not.toBe(a.id)
    expect(d.name).toBe('Original (copy)')
    expect(d.body).toBe('body')
    expect(d.folder_id).toBe(f.id)
    expect(d.created_at >= a.created_at).toBe(true)
  })
})

describe('agentsService — getAllAgents', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns folders sorted by name ASC', () => {
    createFolder(db, 'Zeta')
    createFolder(db, 'Alpha')
    createFolder(db, 'Mu')
    const { folders } = getAllAgents(db)
    expect(folders.map(f => f.name)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('returns agents sorted by updated_at DESC', async () => {
    const a1 = createAgent(db, { name: 'A1', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5))
    const a2 = createAgent(db, { name: 'A2', body: 'b', folderId: null })
    await new Promise(r => setTimeout(r, 5))
    const a3 = createAgent(db, { name: 'A3', body: 'b', folderId: null })
    const { agents } = getAllAgents(db)
    expect(agents.map(a => a.id)).toEqual([a3.id, a2.id, a1.id])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run electron/services/agentsService.test.ts`
Expected: failures because `agentsService.ts` doesn't exist yet.

- [ ] **Step 4: Implement `agentsService.ts`**

Create `electron/services/agentsService.ts`:

```ts
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentRow, AgentFolderRow } from '../../src/types/agent'

export const AGENT_NAME_MAX = 200
export const AGENT_BODY_MAX = 1_048_576 // 1 MiB

function nowIso(): string {
  return new Date().toISOString()
}

function normaliseName(input: string): string {
  const trimmed = input.trim()
  return trimmed.length === 0 ? 'Untitled agent' : trimmed
}

function assertNameLen(name: string): void {
  if (name.length > AGENT_NAME_MAX) {
    throw new Error(`Agent name length ${name.length} exceeds ${AGENT_NAME_MAX}`)
  }
}

function assertBodyLen(body: string): void {
  if (body.length > AGENT_BODY_MAX) {
    throw new Error(`Agent body length ${body.length} exceeds ${AGENT_BODY_MAX}`)
  }
}

function assertFolderExists(db: Database.Database, folderId: string): void {
  const row = db.prepare('SELECT id FROM agent_folders WHERE id = ?').get(folderId)
  if (!row) throw new Error(`Unknown folder id: ${folderId}`)
}

// ── Folders ─────────────────────────────────────────────────────────

export function createFolder(db: Database.Database, name: string): AgentFolderRow {
  const id = randomUUID()
  const created_at = nowIso()
  db.prepare(`
    INSERT INTO agent_folders (id, name, color_start, color_end, description, created_at)
    VALUES (?, ?, NULL, NULL, NULL, ?)
  `).run(id, name, created_at)
  return db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow
}

export function renameFolder(db: Database.Database, id: string, name: string): AgentFolderRow {
  db.prepare('UPDATE agent_folders SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow
}

export function deleteFolder(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_folders WHERE id = ?').run(id)
}

// ── Agents ──────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  body: string
  folderId: string | null
}

export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const name = normaliseName(input.name)
  assertNameLen(name)
  assertBodyLen(input.body)
  if (input.folderId !== null) assertFolderExists(db, input.folderId)

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(`
    INSERT INTO agents (id, name, body, folder_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, input.body, input.folderId, ts, ts)
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export interface UpdateAgentPatch {
  name?: string
  body?: string
  folderId?: string | null
}

export function updateAgent(
  db: Database.Database,
  id: string,
  patch: UpdateAgentPatch,
): AgentRow {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    const name = normaliseName(patch.name)
    assertNameLen(name)
    sets.push('name = ?')
    params.push(name)
  }
  if (patch.body !== undefined) {
    assertBodyLen(patch.body)
    sets.push('body = ?')
    params.push(patch.body)
  }
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) assertFolderExists(db, patch.folderId)
    sets.push('folder_id = ?')
    params.push(patch.folderId)
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?')
    params.push(nowIso())
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
}

export function duplicateAgent(db: Database.Database, id: string): AgentRow {
  const src = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!src) throw new Error(`Unknown agent id: ${id}`)
  return createAgent(db, {
    name: `${src.name} (copy)`,
    body: src.body,
    folderId: src.folder_id,
  })
}

// ── Aggregate read ──────────────────────────────────────────────────

export interface AgentsAllPayload {
  folders: AgentFolderRow[]
  agents:  AgentRow[]
}

export function getAllAgents(db: Database.Database): AgentsAllPayload {
  const folders = db.prepare('SELECT * FROM agent_folders ORDER BY name ASC').all() as AgentFolderRow[]
  const agents  = db.prepare('SELECT * FROM agents ORDER BY updated_at DESC').all() as AgentRow[]
  return { folders, agents }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run electron/services/agentsService.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/agent.ts electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): agentsService CRUD with folder + agent ops"
```

---

## Task 3: IPC handlers + preload surface + main.ts registration

**Files:**
- Create: `electron/ipc/agentHandlers.ts`
- Modify: `electron/main.ts` (import + registration call)
- Modify: `electron/preload.ts` (add `window.api.agents.*`)

- [ ] **Step 1: Create the handlers module**

Create `electron/ipc/agentHandlers.ts`:

```ts
import { app, ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db'
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agents:changed')
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agents:getAll', async () => {
    const db = getDb(app.getPath('userData'))
    return getAllAgents(db)
  })

  ipcMain.handle('agents:create', async (_, input: CreateAgentInput) => {
    const db = getDb(app.getPath('userData'))
    const row = createAgent(db, input)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:update', async (_, id: string, patch: UpdateAgentPatch) => {
    const db = getDb(app.getPath('userData'))
    const row = updateAgent(db, id, patch)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:delete', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    deleteAgent(db, id)
    broadcastChanged()
  })

  ipcMain.handle('agents:duplicate', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    const row = duplicateAgent(db, id)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:createFolder', async (_, name: string) => {
    const db = getDb(app.getPath('userData'))
    const row = createFolder(db, name)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:renameFolder', async (_, id: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    const row = renameFolder(db, id, name)
    broadcastChanged()
    return row
  })

  ipcMain.handle('agents:deleteFolder', async (_, id: string) => {
    const db = getDb(app.getPath('userData'))
    deleteFolder(db, id)
    broadcastChanged()
  })
}
```

- [ ] **Step 2: Register the handlers in `main.ts`**

In `electron/main.ts`, add the import next to the other handler imports (around `electron/main.ts:41-48`):

```ts
import { registerAgentHandlers } from './ipc/agentHandlers'
```

And call it during initialisation alongside the other `register*Handlers()` calls. Find the existing call site for `registerAiChatHandlers()` (grep for it) and add immediately after:

```ts
registerAgentHandlers()
```

- [ ] **Step 3: Expose the channels in `preload.ts`**

In `electron/preload.ts`, add a new key inside the `contextBridge.exposeInMainWorld('api', { ... })` object. Insert immediately after the existing `collection:` block (around `electron/preload.ts:157-164`):

```ts
  agents: {
    getAll: () =>
      ipcRenderer.invoke('agents:getAll') as Promise<{
        folders: import('../src/types/agent').AgentFolderRow[]
        agents:  import('../src/types/agent').AgentRow[]
      }>,
    create: (input: { name: string; body: string; folderId: string | null }) =>
      ipcRenderer.invoke('agents:create', input) as Promise<import('../src/types/agent').AgentRow>,
    update: (id: string, patch: { name?: string; body?: string; folderId?: string | null }) =>
      ipcRenderer.invoke('agents:update', id, patch) as Promise<import('../src/types/agent').AgentRow>,
    delete: (id: string) => ipcRenderer.invoke('agents:delete', id) as Promise<void>,
    duplicate: (id: string) =>
      ipcRenderer.invoke('agents:duplicate', id) as Promise<import('../src/types/agent').AgentRow>,

    createFolder: (name: string) =>
      ipcRenderer.invoke('agents:createFolder', name) as Promise<import('../src/types/agent').AgentFolderRow>,
    renameFolder: (id: string, name: string) =>
      ipcRenderer.invoke('agents:renameFolder', id, name) as Promise<import('../src/types/agent').AgentFolderRow>,
    deleteFolder: (id: string) => ipcRenderer.invoke('agents:deleteFolder', id) as Promise<void>,

    onChanged: (cb: () => void) => {
      const wrapper = () => cb()
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('agents:changed', wrapper)
    },
    offChanged: (cb: () => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('agents:changed', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors involving `agents`, `agent.ts`, or the new IPC keys.

- [ ] **Step 5: Run the full Vitest suite**

Run: `npx vitest run`
Expected: all previously-passing tests still pass; the new tests from Tasks 1+2 pass.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/main.ts electron/preload.ts
git commit -m "feat(agents): IPC handlers + preload surface for agents API"
```

---

## Task 4: Library.tsx — agent route plumbing + event listener

**Files:**
- Modify: `src/views/Library.tsx`

This task wires the new agent route into `Library.tsx` (route matching, `hasDetail`, `agents:changed` listener) so subsequent tasks have a place to land sidebar and detail UI. No visible UI change yet.

- [ ] **Step 1: Add the `agentMatch` and extend `hasDetail`**

In `src/views/Library.tsx`, find the existing match block (around `src/views/Library.tsx:27-29`):

```ts
  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null
```

Replace with:

```ts
  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const agentMatch = useMatch('/library/agent/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null || agentMatch !== null
```

- [ ] **Step 2: Add the `agents:changed` listener**

In `src/views/Library.tsx`, immediately after the existing `library:changed` listener (around `src/views/Library.tsx:64-67`):

```ts
  useEffect(() => {
    window.addEventListener('library:changed', scheduleRefresh)
    return () => window.removeEventListener('library:changed', scheduleRefresh)
  }, [scheduleRefresh])
```

Add this sibling effect:

```ts
  useEffect(() => {
    const cb = () => scheduleRefresh()
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [scheduleRefresh])
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Run existing Library.test.tsx**

Run: `npx vitest run src/views/Library.test.tsx`
Expected: passes (no behavioural change for existing flows).

- [ ] **Step 5: Commit**

```bash
git add src/views/Library.tsx
git commit -m "feat(agents): wire agent route match + agents:changed listener in Library"
```

---

## Task 5: LibrarySidebar — third toggle button

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`

- [ ] **Step 1: Add `AgentsIcon` and extend `Mode`**

In `src/components/LibrarySidebar.tsx`, find the icon helpers at the top (around `src/components/LibrarySidebar.tsx:26-40`) and add a new icon next to `ReposIcon` / `CollectionsIcon`:

```tsx
function AgentsIcon({ size = 13 }: { size?: number }) {
  // Small markdown-doc glyph: page with a fold + an "M" mark.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5zM7 13h2v5H7v-5zm4-2h2v7h-2v-7zm4 3h2v4h-2v-4z" />
    </svg>
  )
}
```

Find the `Mode` type (around `src/components/LibrarySidebar.tsx:66`):

```ts
type Mode = 'repos' | 'collections'
```

Replace with:

```ts
type Mode = 'repos' | 'collections' | 'agents'
```

- [ ] **Step 2: Add the third toggle button**

Find the existing toggle button row in `LibrarySidebar.tsx` (around `src/components/LibrarySidebar.tsx:164-183`). The block currently has two buttons inside `.library-sidebar-toggle`. Add a third button after the Collections button:

```tsx
            <button
              type="button"
              className={`library-sidebar-toggle-btn${mode === 'agents' ? ' active' : ''}`}
              onClick={() => { setMode('agents'); setSearchTerm('') }}
              aria-label="Agents"
              title="Agents"
            >
              <AgentsIcon />
            </button>
```

- [ ] **Step 3: Add the mode-restore effect for agents**

Find the existing effects that switch mode when a detail route is active (around `src/components/LibrarySidebar.tsx:85-91`):

```ts
  const collMatch = useMatch('/library/collection/:id')
  const repoMatch = useMatch('/library/repo/:owner/:name')
  // …
  useEffect(() => {
    if (collMatch) setMode('collections')
  }, [collMatch?.params.id])

  useEffect(() => {
    if (repoMatch) setMode('repos')
  }, [repoMatch?.params.owner, repoMatch?.params.name])
```

Add a sibling `agentMatch` and effect:

```ts
  const agentMatch = useMatch('/library/agent/:id')
  // …
  useEffect(() => {
    if (agentMatch) setMode('agents')
  }, [agentMatch?.params.id])
```

Also update the initial mode useState so deep-links work:

```ts
  const [mode, setMode] = useState<Mode>(
    agentMatch ? 'agents' : collMatch ? 'collections' : 'repos'
  )
```

(Replace the existing `useState<Mode>(collMatch ? 'collections' : 'repos')` at `src/components/LibrarySidebar.tsx:77`.)

- [ ] **Step 4: Render placeholder when mode === 'agents'**

The existing conditional at `src/components/LibrarySidebar.tsx:198-301` is `mode === 'repos' ? (...) : (...)`. Change it to handle three modes. Replace:

```tsx
      {mode === 'repos' ? (
        <div className="library-sidebar-list">
          {/* repos content */}
        </div>
      ) : (
        <div className="library-sidebar-list">
          <CollectionsSidebar … />
        </div>
      )}
```

with:

```tsx
      {mode === 'repos' && (
        <div className="library-sidebar-list">
          {/* repos content — unchanged */}
        </div>
      )}
      {mode === 'collections' && (
        <div className="library-sidebar-list">
          <CollectionsSidebar
            selectedId={collSelectedId}
            onSelect={onSelectColl ?? (() => {})}
            searchTerm={searchTerm}
          />
        </div>
      )}
      {mode === 'agents' && (
        <div className="library-sidebar-list">
          <AgentsSidebar searchTerm={searchTerm} />
        </div>
      )}
```

Add the import at the top of the file (next to `CollectionsSidebar`):

```ts
import AgentsSidebar from './AgentsSidebar'
```

`AgentsSidebar` doesn't exist yet — Task 6 creates it. The build will fail until then; that's expected. Skip the build step for this task.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx
git commit -m "feat(agents): add Agents toggle to Library sidebar"
```

---

## Task 6: AgentsSidebar component

**Files:**
- Create: `src/components/AgentsSidebar.tsx`
- Create: `src/components/AgentsSidebar.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/AgentsSidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentsSidebar from './AgentsSidebar'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
  { id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]
const agents: AgentRow[] = [
  { id: 'a1', name: 'Copy editor',   body: '# Copy editor\nbody',   folder_id: 'f1', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a2', name: 'Lit reviewer',  body: '# Lit reviewer\nbody',  folder_id: 'f2', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
  { id: 'a3', name: 'Untagged note', body: '# Untagged\nbody',      folder_id: null, created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
      createFolder: vi.fn(),
      create: vi.fn(),
    },
  }
})

function renderSidebar(searchTerm = '') {
  return render(
    <MemoryRouter>
      <AgentsSidebar searchTerm={searchTerm} />
    </MemoryRouter>,
  )
}

describe('AgentsSidebar', () => {
  it('renders folder section headers sorted by name', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy())
    const sections = screen.getAllByRole('button', { name: /Research|Writing|Unfiled/ })
    const labels = sections.map(b => b.textContent)
    // Unfiled first (synthetic), then alphabetical: Research, Writing
    expect(labels[0]).toMatch(/Unfiled/)
    expect(labels[1]).toMatch(/Research/)
    expect(labels[2]).toMatch(/Writing/)
  })

  it('lists agents under their folder when expanded', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText('Writing'))
    fireEvent.click(screen.getByRole('button', { name: /Writing/ }))
    expect(screen.getByText('Copy editor')).toBeTruthy()
  })

  it('hides the Unfiled section when no unfiled agents exist', async () => {
    ;(window as any).api.agents.getAll.mockResolvedValueOnce({
      folders,
      agents: agents.filter(a => a.folder_id !== null),
    })
    renderSidebar()
    await waitFor(() => screen.getByText('Writing'))
    expect(screen.queryByText(/Unfiled/)).toBeNull()
  })

  it('filters by searchTerm against name + body', async () => {
    renderSidebar('lit')
    await waitFor(() => screen.getByText('Research'))
    fireEvent.click(screen.getByRole('button', { name: /Research/ }))
    expect(screen.getByText('Lit reviewer')).toBeTruthy()
    expect(screen.queryByText('Copy editor')).toBeNull()
  })

  it('opens the create modal when "+ New agent" is clicked', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/New agent/i))
    fireEvent.click(screen.getByRole('button', { name: /\+ New agent/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/AgentsSidebar.test.tsx`
Expected: failure — `AgentsSidebar` doesn't exist yet.

- [ ] **Step 3: Implement `AgentsSidebar.tsx`**

Create `src/components/AgentsSidebar.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import NewAgentModal from './NewAgentModal'

interface Props {
  searchTerm?: string
}

interface FolderGroup {
  id: string | null   // null = synthetic "Unfiled"
  name: string
  agents: AgentRow[]
}

function MarkdownDocIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5zM7 13h2v5H7v-5zm4-2h2v7h-2v-7zm4 3h2v4h-2v-4z" />
    </svg>
  )
}

export default function AgentsSidebar({ searchTerm = '' }: Props) {
  const navigate = useNavigate()
  const agentMatch = useMatch('/library/agent/:id')
  const selectedId = agentMatch?.params.id ?? null

  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)

  const load = useCallback(async () => {
    const data = await window.api.agents.getAll()
    setFolders(data.folders)
    setAgents(data.agents)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const cb = () => load()
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [load])

  const groups: FolderGroup[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const match = (a: AgentRow) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q)

    const byFolder = new Map<string, AgentRow[]>()
    const unfiled: AgentRow[] = []
    for (const a of agents) {
      if (!match(a)) continue
      if (a.folder_id === null) unfiled.push(a)
      else {
        const arr = byFolder.get(a.folder_id) ?? []
        arr.push(a)
        byFolder.set(a.folder_id, arr)
      }
    }
    const folderGroups: FolderGroup[] = folders.map(f => ({
      id: f.id,
      name: f.name,
      agents: byFolder.get(f.id) ?? [],
    }))
    const out: FolderGroup[] = []
    if (unfiled.length > 0) out.push({ id: null, name: 'Unfiled', agents: unfiled })
    return out.concat(folderGroups)
  }, [folders, agents, searchTerm])

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleCreated = (newId: string) => {
    setShowModal(false)
    navigate(`/library/agent/${newId}`)
  }

  return (
    <>
      <div style={{ padding: '8px', flexShrink: 0 }}>
        <button
          type="button"
          className="library-sidebar-seg"
          style={{ width: '100%' }}
          onClick={() => setShowModal(true)}
        >
          + New agent
        </button>
      </div>

      {groups.length === 0 && (
        <div className="library-sidebar-empty">No agents</div>
      )}

      {groups.map(g => {
        const key = g.id ?? '__unfiled__'
        const isOpen = expanded[key] ?? true
        return (
          <div key={key} className="library-sidebar-section">
            <button
              type="button"
              className="library-sidebar-section-header"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
            >
              <span className="library-sidebar-section-caret">{isOpen ? '▾' : '▸'}</span>
              {g.name} ({g.agents.length})
            </button>
            {isOpen && g.agents.map(a => (
              <button
                key={a.id}
                type="button"
                className={`library-sidebar-item installed${selectedId === a.id ? ' selected' : ''}`}
                onClick={() => navigate(`/library/agent/${a.id}`)}
                title={a.name}
              >
                <span className="library-sidebar-avatar library-sidebar-local-avatar">
                  <MarkdownDocIcon />
                </span>
                <span className="library-sidebar-name">{a.name}</span>
              </button>
            ))}
          </div>
        )
      })}

      {showModal && (
        <NewAgentModal
          folders={folders}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}
```

`NewAgentModal` will be created in Task 7 — this file will fail to build until then. That's expected.

- [ ] **Step 4: Stub `NewAgentModal` temporarily so this test can pass**

Until Task 7 runs, create a minimal stub at `src/components/NewAgentModal.tsx` so the file imports resolve and the test in Step 2 can pass:

```tsx
import type { AgentFolderRow } from '../types/agent'

interface Props {
  folders: AgentFolderRow[]
  onClose: () => void
  onCreated: (id: string) => void
}

export default function NewAgentModal(_props: Props) {
  return <div role="dialog" aria-label="New agent" />
}
```

This stub will be replaced in Task 7. The `aria-label` is what the test asserts on via `getByRole('dialog')`.

- [ ] **Step 5: Run the AgentsSidebar test**

Run: `npx vitest run src/components/AgentsSidebar.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentsSidebar.tsx src/components/AgentsSidebar.test.tsx src/components/NewAgentModal.tsx
git commit -m "feat(agents): AgentsSidebar with expandable folder groups"
```

---

## Task 7: NewAgentModal — paste-to-create

**Files:**
- Modify: `src/components/NewAgentModal.tsx` (replace the stub)
- Create: `src/components/NewAgentModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/NewAgentModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NewAgentModal from './NewAgentModal'
import type { AgentFolderRow, AgentRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]

const onClose = vi.fn()
const onCreated = vi.fn()

beforeEach(() => {
  onClose.mockReset()
  onCreated.mockReset()
  ;(window as any).api = {
    agents: {
      create: vi.fn().mockImplementation(async (input: any) => ({
        id: 'new-id',
        name: input.name,
        body: input.body,
        folder_id: input.folderId,
        created_at: '2026-05-23T00:00:00Z',
        updated_at: '2026-05-23T00:00:00Z',
      } satisfies AgentRow)),
      createFolder: vi.fn().mockImplementation(async (name: string) => ({
        id: 'new-folder', name, color_start: null, color_end: null, description: null,
        created_at: '2026-05-23T00:00:00Z',
      } satisfies AgentFolderRow)),
    },
  }
})

function setup() {
  return render(
    <NewAgentModal folders={folders} onClose={onClose} onCreated={onCreated} />,
  )
}

describe('NewAgentModal', () => {
  it('autofocuses the body textarea', () => {
    setup()
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('auto-derives name from first H1', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# Hello world\nbody text' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('Hello world')
  })

  it('falls back to first non-empty line when no H1 present', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '\n\nsome line\nmore' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('some line')
  })

  it('user-edited name is not overwritten by subsequent body edits', () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# First' } })
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'My override' } })
    fireEvent.change(ta, { target: { value: '# Second' } })
    expect(nameInput.value).toBe('My override')
  })

  it('disables Create until body is non-empty', () => {
    setup()
    const create = screen.getByRole('button', { name: /Create/ }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'x' } })
    expect(create.disabled).toBe(false)
  })

  it('on Create: calls api.agents.create with current values and fires onCreated', async () => {
    setup()
    const ta = screen.getByPlaceholderText(/Paste your markdown/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# Title\nhello' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/ }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'))
    expect(window.api.agents.create).toHaveBeenCalledWith({
      name: 'Title', body: '# Title\nhello', folderId: null,
    })
  })

  it('inline folder creation: typing a name and pressing Enter creates and selects it', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /\+ New folder/ }))
    const folderInput = screen.getByPlaceholderText(/Folder name/i) as HTMLInputElement
    fireEvent.change(folderInput, { target: { value: 'Personas' } })
    fireEvent.keyDown(folderInput, { key: 'Enter' })
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('Personas'))
  })

  it('Cancel calls onClose', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape calls onClose', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/NewAgentModal.test.tsx`
Expected: failures — the stub doesn't implement any of this.

- [ ] **Step 3: Implement `NewAgentModal.tsx`**

Replace the stub in `src/components/NewAgentModal.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentFolderRow } from '../types/agent'

interface Props {
  folders: AgentFolderRow[]
  onClose: () => void
  onCreated: (newId: string) => void
}

function deriveName(body: string): string {
  for (const line of body.split('\n')) {
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1) return h1[1].trim().slice(0, 200)
  }
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed.slice(0, 60)
  }
  return ''
}

export default function NewAgentModal({ folders, onClose, onCreated }: Props) {
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [localFolders, setLocalFolders] = useState<AgentFolderRow[]>(folders)

  const overlayRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { taRef.current?.focus() }, [])

  useEffect(() => {
    if (!nameTouched) setName(deriveName(body))
  }, [body, nameTouched])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (creatingFolder) folderInputRef.current?.focus()
  }, [creatingFolder])

  const handleCreate = useCallback(async () => {
    if (body.length === 0) return
    setCreating(true)
    try {
      const row = await window.api.agents.create({
        name: name.trim() || 'Untitled agent',
        body,
        folderId,
      })
      onCreated(row.id)
    } finally {
      setCreating(false)
    }
  }, [body, name, folderId, onCreated])

  const handleFolderCreate = useCallback(async () => {
    const trimmed = newFolderName.trim()
    if (!trimmed) {
      setCreatingFolder(false)
      return
    }
    const f = await window.api.agents.createFolder(trimmed)
    setLocalFolders(prev => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)))
    setFolderId(f.id)
    setCreatingFolder(false)
    setNewFolderName('')
  }, [newFolderName])

  return (
    <div
      className="coll-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="coll-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-agent-title"
      >
        <div className="coll-modal-title" id="new-agent-title">New agent</div>

        <div className="coll-modal-label">Folder</div>
        {!creatingFolder ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="coll-modal-input"
              value={folderId ?? ''}
              onChange={e => setFolderId(e.target.value === '' ? null : e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">Unfiled</option>
              {localFolders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="coll-modal-cancel"
              onClick={() => setCreatingFolder(true)}
            >
              + New folder
            </button>
          </div>
        ) : (
          <input
            ref={folderInputRef}
            className="coll-modal-input"
            placeholder="Folder name"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleFolderCreate() }}
            onBlur={handleFolderCreate}
            maxLength={200}
          />
        )}

        <div className="coll-modal-label">Name</div>
        <input
          className="coll-modal-input"
          aria-label="Name"
          maxLength={200}
          value={name}
          onChange={e => { setName(e.target.value); setNameTouched(true) }}
        />

        <div className="coll-modal-label">Body</div>
        <textarea
          ref={taRef}
          className="coll-modal-textarea"
          placeholder="Paste your markdown here…"
          rows={12}
          value={body}
          onChange={e => setBody(e.target.value)}
          style={{ fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
        />

        <div className="coll-modal-actions">
          <button className="coll-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="coll-modal-create"
            disabled={body.length === 0 || creating}
            onClick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/NewAgentModal.test.tsx`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/NewAgentModal.tsx src/components/NewAgentModal.test.tsx
git commit -m "feat(agents): NewAgentModal with paste-to-create flow"
```

---

## Task 8: AgentDetail view + LibraryDetailRoutes wiring

**Files:**
- Create: `src/views/AgentDetail.tsx`
- Create: `src/views/AgentDetail.test.tsx`
- Modify: `src/components/LibraryDetailRoutes.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/views/AgentDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AgentDetail from './AgentDetail'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
]
const baseAgent: AgentRow = {
  id: 'a1', name: 'Copy editor', body: '# Copy editor\n\nHello body.',
  folder_id: 'f1', created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z',
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [baseAgent] }),
      update: vi.fn().mockImplementation(async (id: string, patch: any) => ({
        ...baseAgent, ...patch, updated_at: '2026-05-23T00:00:05Z',
      })),
      delete: vi.fn(),
      duplicate: vi.fn(),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => { vi.useRealTimers() })

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/a1']}>
      <Routes>
        <Route path="/library/agent/:id" element={<AgentDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AgentDetail', () => {
  it('renders the agent name and rendered body', async () => {
    setup()
    await waitFor(() => screen.getByText('Copy editor'))
    expect(screen.getByText(/Hello body/)).toBeTruthy()
  })

  it('toggles to edit mode and shows the textarea', async () => {
    setup()
    await waitFor(() => screen.getByText('Copy editor'))
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const ta = screen.getByRole('textbox', { name: /Body/ }) as HTMLTextAreaElement
    expect(ta.value).toContain('Copy editor')
  })

  it('debounced auto-save calls api.agents.update 1500ms after last keystroke', async () => {
    setup()
    await waitFor(() => screen.getByText('Copy editor'))
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const ta = screen.getByRole('textbox', { name: /Body/ })
    fireEvent.change(ta, { target: { value: 'changed body' } })
    expect(window.api.agents.update).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(window.api.agents.update).toHaveBeenCalledWith('a1', { body: 'changed body' })
  })

  it('Copy markdown writes the body to clipboard', async () => {
    setup()
    await waitFor(() => screen.getByText('Copy editor'))
    fireEvent.click(screen.getByRole('button', { name: /Copy markdown/ }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(baseAgent.body),
    )
  })

  it('changing the folder pill calls api.agents.update with new folderId', async () => {
    setup()
    await waitFor(() => screen.getByText('Copy editor'))
    fireEvent.click(screen.getByRole('button', { name: /Folder/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Unfiled/ }))
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { folderId: null }),
    )
  })
})
```

Note: the test asserts the menu item is `role="menuitem"`. The folder picker in `AgentDetail` should use `role="menu"` / `role="menuitem"` semantics.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/AgentDetail.test.tsx`
Expected: failures — `AgentDetail` doesn't exist yet.

- [ ] **Step 3: Implement `AgentDetail.tsx`**

Create `src/views/AgentDetail.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import { useToast } from '../contexts/Toast'

type SaveStatus = 'idle' | 'saving' | 'saved'

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [agent, setAgent] = useState<AgentRow | null>(null)
  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [editing, setEditing] = useState(false)
  const [bodyDraft, setBodyDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [nameEditing, setNameEditing] = useState(false)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load agent + folders
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const { folders, agents } = await window.api.agents.getAll()
      if (cancelled) return
      setFolders(folders)
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      setBodyDraft(a?.body ?? '')
      setNameDraft(a?.name ?? '')
    })()
    return () => { cancelled = true }
  }, [id])

  // Listen for external changes (e.g. another window edited this agent)
  useEffect(() => {
    if (!id) return
    const cb = async () => {
      const { agents } = await window.api.agents.getAll()
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      if (!editing) setBodyDraft(a?.body ?? '')
      if (!nameEditing) setNameDraft(a?.name ?? '')
    }
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [id, editing, nameEditing])

  const scheduleSaveBody = useCallback((value: string) => {
    if (!id) return
    setSaveStatus('saving')
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(async () => {
      await window.api.agents.update(id, { body: value })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1500)
  }, [id])

  const scheduleSaveName = useCallback((value: string) => {
    if (!id) return
    if (nameTimer.current) clearTimeout(nameTimer.current)
    nameTimer.current = setTimeout(async () => {
      await window.api.agents.update(id, { name: value })
    }, 1500)
  }, [id])

  useEffect(() => () => {
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    if (nameTimer.current) clearTimeout(nameTimer.current)
  }, [])

  const currentFolderName = useMemo(() => {
    if (!agent || agent.folder_id === null) return 'Unfiled'
    return folders.find(f => f.id === agent.folder_id)?.name ?? 'Unfiled'
  }, [agent, folders])

  const handleCopy = async () => {
    if (!agent) return
    await navigator.clipboard.writeText(agent.body)
    toast('Copied to clipboard', 'success')
  }

  const handleFolderPick = async (folderId: string | null) => {
    if (!id) return
    setFolderMenuOpen(false)
    const updated = await window.api.agents.update(id, { folderId })
    setAgent(updated)
  }

  const handleDelete = async () => {
    if (!id) return
    if (!confirm('Delete this agent? This cannot be undone.')) return
    await window.api.agents.delete(id)
    navigate('/library')
  }

  const handleDuplicate = async () => {
    if (!id) return
    const dup = await window.api.agents.duplicate(id)
    navigate(`/library/agent/${dup.id}`)
  }

  if (!agent) {
    return <div style={{ padding: 24, color: 'var(--t3)' }}>Loading…</div>
  }

  return (
    <div className="agent-detail">
      <header className="agent-detail-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={() => navigate('/library')} aria-label="Back">←</button>
        {nameEditing ? (
          <input
            value={nameDraft}
            onChange={e => { setNameDraft(e.target.value); scheduleSaveName(e.target.value) }}
            onBlur={() => setNameEditing(false)}
            onKeyDown={e => { if (e.key === 'Enter') setNameEditing(false) }}
            autoFocus
            style={{ flex: 1, font: 'inherit' }}
          />
        ) : (
          <h2 style={{ flex: 1, margin: 0, cursor: 'text' }} onClick={() => setNameEditing(true)}>
            {agent.name}
          </h2>
        )}
        <button type="button" onClick={handleDuplicate} aria-label="Duplicate">Duplicate</button>
        <button type="button" onClick={handleDelete} aria-label="Delete">Delete</button>
        <button type="button" onClick={() => setEditing(e => !e)} aria-label={editing ? 'Preview' : 'Edit'}>
          {editing ? 'Preview' : 'Edit'}
        </button>
      </header>

      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--t3)' }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="Folder"
            onClick={() => setFolderMenuOpen(o => !o)}
          >
            Folder: {currentFolderName} ▾
          </button>
          {folderMenuOpen && (
            <ul role="menu" style={{ position: 'absolute', background: 'var(--bg2)', border: '1px solid var(--border)', listStyle: 'none', padding: 4, margin: 0 }}>
              <li>
                <button role="menuitem" type="button" onClick={() => handleFolderPick(null)}>Unfiled</button>
              </li>
              {folders.map(f => (
                <li key={f.id}>
                  <button role="menuitem" type="button" onClick={() => handleFolderPick(f.id)}>{f.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span>Updated {new Date(agent.updated_at).toLocaleString()}</span>
        <span>· {agent.body.length} chars</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {editing ? (
          <textarea
            aria-label="Body"
            value={bodyDraft}
            onChange={e => { setBodyDraft(e.target.value); scheduleSaveBody(e.target.value) }}
            style={{ width: '100%', minHeight: '60vh', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
          />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.body}</ReactMarkdown>
        )}
      </div>

      <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
        <button type="button" onClick={handleCopy}>Copy markdown</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          {saveStatus === 'saving' && 'saving…'}
          {saveStatus === 'saved' && 'saved ✓'}
        </span>
      </footer>
    </div>
  )
}
```

Notes:
- The header buttons use `aria-label` for test discoverability; final visual styling can come later (or reuse existing `RepoDetail` toolbar styles).
- Folder picker is a minimal `role="menu"` here rather than `SimplePopover` — keeps the test deterministic. Switching to `SimplePopover` is a follow-up if visual consistency demands it.

- [ ] **Step 4: Wire the route in `LibraryDetailRoutes.tsx`**

In `src/components/LibraryDetailRoutes.tsx`, add the import:

```ts
import AgentDetail from '../views/AgentDetail'
```

Add a third `<Route>` to BOTH the leaving and entering `<Routes>` blocks (around `src/components/LibraryDetailRoutes.tsx:29-32` and `38-39`):

```tsx
<Route path="agent/:id" element={<AgentDetail />} />
```

So each `<Routes>` block now reads:

```tsx
<Routes location={leaving /* or current */}>
  <Route path="repo/:owner/:name" element={<RepoDetail />} />
  <Route path="collection/:id" element={<CollectionDetail />} />
  <Route path="agent/:id" element={<AgentDetail />} />
</Routes>
```

- [ ] **Step 5: Run the AgentDetail test**

Run: `npx vitest run src/views/AgentDetail.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 6: Run the full test suite to catch any regressions**

Run: `npx vitest run`
Expected: all tests pass; no regressions in `Library.test.tsx`, `LibrarySidebar.test.tsx`, `LibraryDetailRoutes` tests.

- [ ] **Step 7: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx src/components/LibraryDetailRoutes.tsx
git commit -m "feat(agents): AgentDetail view with rendered/edit toggle + folder pill"
```

---

## Task 9: AgentContextMenu (right-click for agent rows and folder headers)

**Files:**
- Create: `src/components/AgentContextMenu.tsx`
- Modify: `src/components/AgentsSidebar.tsx` (wire right-click handlers)

- [ ] **Step 1: Implement `AgentContextMenu.tsx`**

Create `src/components/AgentContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react'

export type AgentMenuKind =
  | { kind: 'agent';  agentId: string }
  | { kind: 'folder'; folderId: string }

interface Props {
  x: number
  y: number
  target: AgentMenuKind
  onClose: () => void
  onRenameAgent?: (id: string) => void
  onMoveAgent?:   (id: string) => void   // opens move-to-folder popover at call site
  onDuplicate?:   (id: string) => void
  onDeleteAgent?: (id: string) => void
  onRenameFolder?: (id: string) => void
  onDeleteFolder?: (id: string) => void
}

export default function AgentContextMenu({
  x, y, target, onClose,
  onRenameAgent, onMoveAgent, onDuplicate, onDeleteAgent,
  onRenameFolder, onDeleteFolder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const style: React.CSSProperties = {
    position: 'fixed', top: y, left: x, zIndex: 1000,
    background: 'var(--bg2)', border: '1px solid var(--border)',
    padding: 4, minWidth: 160,
  }

  if (target.kind === 'agent') {
    return (
      <div ref={ref} role="menu" style={style}>
        <button role="menuitem" type="button" onClick={() => { onRenameAgent?.(target.agentId); onClose() }}>Rename</button>
        <button role="menuitem" type="button" onClick={() => { onMoveAgent?.(target.agentId); onClose() }}>Move to folder…</button>
        <button role="menuitem" type="button" onClick={() => { onDuplicate?.(target.agentId); onClose() }}>Duplicate</button>
        <button role="menuitem" type="button" onClick={() => { onDeleteAgent?.(target.agentId); onClose() }}>Delete</button>
      </div>
    )
  }

  return (
    <div ref={ref} role="menu" style={style}>
      <button role="menuitem" type="button" onClick={() => { onRenameFolder?.(target.folderId); onClose() }}>Rename folder</button>
      <button role="menuitem" type="button" disabled>Set colour</button>
      <button role="menuitem" type="button" onClick={() => { onDeleteFolder?.(target.folderId); onClose() }}>Delete folder</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire context-menu handlers in `AgentsSidebar.tsx`**

In `src/components/AgentsSidebar.tsx`, add menu state and handlers. Inside the component:

```tsx
import AgentContextMenu, { type AgentMenuKind } from './AgentContextMenu'

// inside component:
const [menu, setMenu] = useState<{ x: number; y: number; target: AgentMenuKind } | null>(null)

const onAgentRightClick = (e: React.MouseEvent, agentId: string) => {
  e.preventDefault()
  setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'agent', agentId } })
}

const onFolderRightClick = (e: React.MouseEvent, folderId: string) => {
  e.preventDefault()
  setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', folderId } })
}

const handleRenameAgent = async (id: string) => {
  const current = agents.find(a => a.id === id)
  const next = prompt('Rename agent', current?.name ?? '')
  if (next != null) await window.api.agents.update(id, { name: next })
}

const handleDeleteAgent = async (id: string) => {
  if (!confirm('Delete this agent? This cannot be undone.')) return
  await window.api.agents.delete(id)
}

const handleDuplicate = async (id: string) => {
  await window.api.agents.duplicate(id)
}

const handleRenameFolder = async (id: string) => {
  const current = folders.find(f => f.id === id)
  const next = prompt('Rename folder', current?.name ?? '')
  if (next != null) await window.api.agents.renameFolder(id, next)
}

const handleDeleteFolder = async (id: string) => {
  if (!confirm('Delete this folder? Agents inside it will move to Unfiled.')) return
  await window.api.agents.deleteFolder(id)
}

// Move-to-folder reuses the same prompt for simplicity in this iteration
const handleMoveAgent = async (id: string) => {
  const choice = prompt(
    'Move to folder. Type folder name (blank for Unfiled):',
    '',
  )
  if (choice === null) return
  if (choice.trim() === '') {
    await window.api.agents.update(id, { folderId: null })
    return
  }
  const f = folders.find(x => x.name === choice.trim())
  if (f) {
    await window.api.agents.update(id, { folderId: f.id })
  } else {
    const created = await window.api.agents.createFolder(choice.trim())
    await window.api.agents.update(id, { folderId: created.id })
  }
}
```

Attach `onContextMenu` to the agent buttons (replace the existing agent button block):

```tsx
{isOpen && g.agents.map(a => (
  <button
    key={a.id}
    type="button"
    className={`library-sidebar-item installed${selectedId === a.id ? ' selected' : ''}`}
    onClick={() => navigate(`/library/agent/${a.id}`)}
    onContextMenu={(e) => onAgentRightClick(e, a.id)}
    title={a.name}
  >
    <span className="library-sidebar-avatar library-sidebar-local-avatar">
      <MarkdownDocIcon />
    </span>
    <span className="library-sidebar-name">{a.name}</span>
  </button>
))}
```

Attach `onContextMenu` to folder header buttons — only the real folders, not the synthetic Unfiled. Update the section-header button:

```tsx
<button
  type="button"
  className="library-sidebar-section-header"
  onClick={() => toggle(key)}
  onContextMenu={g.id ? (e) => onFolderRightClick(e, g.id!) : undefined}
  aria-expanded={isOpen}
>
  <span className="library-sidebar-section-caret">{isOpen ? '▾' : '▸'}</span>
  {g.name} ({g.agents.length})
</button>
```

Render the menu at the bottom of the component's return:

```tsx
{menu && (
  <AgentContextMenu
    x={menu.x}
    y={menu.y}
    target={menu.target}
    onClose={() => setMenu(null)}
    onRenameAgent={handleRenameAgent}
    onMoveAgent={handleMoveAgent}
    onDuplicate={handleDuplicate}
    onDeleteAgent={handleDeleteAgent}
    onRenameFolder={handleRenameFolder}
    onDeleteFolder={handleDeleteFolder}
  />
)}
```

- [ ] **Step 3: Run the AgentsSidebar test suite (no new tests for the menu in this iteration — manual verification covers it)**

Run: `npx vitest run src/components/AgentsSidebar.test.tsx`
Expected: still passes (existing tests don't exercise right-click).

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentContextMenu.tsx src/components/AgentsSidebar.tsx
git commit -m "feat(agents): right-click context menus for agents + folders"
```

---

## Task 10: Full-suite check + manual verification

**Files:** none (verification)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new ones from Tasks 1, 2, 6, 7, 8.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 3: Manual verification checklist (the user will run this; don't auto-launch the dev server)**

The user prefers to test UI changes themselves (see memory file). Hand over this checklist verbatim:

```
[ ] Open Library — third toggle button is visible alongside Repos/Collections.
[ ] Click Agents toggle — sidebar shows "No agents" empty state + "+ New agent" button.
[ ] Click "+ New agent", paste some markdown starting with "# Title", verify:
    - Body textarea autofocused
    - Name field auto-fills with "Title"
    - Create button enables once body has content
    - Clicking Create navigates to the new agent detail
[ ] In the new agent detail view:
    - Markdown renders (heading, body)
    - Click name → inline edit input appears, type, blur → name updates
    - Click Edit → textarea appears with raw markdown
    - Type changes, wait 1.5s → "saving…" then "saved ✓" appears in footer
    - Click Preview → rendered view is back, content is the edited body
    - Click Copy markdown → toast confirms, clipboard contains body
    - Click Folder → dropdown shows Unfiled + any folders, picking one updates the pill
[ ] Back to Agents sidebar:
    - New agent appears in its folder section (or Unfiled)
    - Search filters agents by name+body
    - Right-click an agent → Rename / Move / Duplicate / Delete work
    - Right-click a folder header → Rename / Delete work
    - Deleting a folder moves its agents to Unfiled
[ ] Restart the app — agents persist; selections route correctly via /library/agent/:id deep link.
```

- [ ] **Step 4: Commit any documentation updates if the manual pass revealed bugs (otherwise nothing to commit)**

If bugs surfaced during manual verification, fix them as separate small commits per bug, with tests added/updated to cover the regression. Once everything works:

```bash
git log --oneline -10
```

Expected output: the chain of Task 1–9 commits, all merged into `main` (per CLAUDE.md no-branches policy).

---

## Self-Review Notes

**Spec coverage:**
- Schema (agent_folders + agents + indexes + ON DELETE SET NULL) → Task 1 ✓
- IPC surface (getAll, create, update, delete, duplicate, createFolder, renameFolder, deleteFolder, onChanged/offChanged) → Tasks 2 + 3 ✓
- `agents:changed` broadcast + Library.tsx listener → Tasks 3 + 4 ✓
- Third sidebar toggle (`Mode = 'agents'`) → Task 5 ✓
- AgentsSidebar with Unfiled + folder groups + search → Task 6 ✓
- NewAgentModal with paste, H1 derivation, folder picker w/ inline create → Task 7 ✓
- AgentDetail with rendered/edit toggle, debounced save, folder pill, copy → Task 8 ✓
- LibraryDetailRoutes route wiring → Task 8 ✓
- AgentContextMenu (agent + folder variants) → Task 9 ✓
- Validation ceilings (AGENT_NAME_MAX, AGENT_BODY_MAX) → Task 2 ✓
- Auto-derive name from H1, fallback to first non-empty line, fallback to "Untitled agent" → Tasks 2 + 7 ✓
- Search filters by name + body case-insensitive → Task 6 ✓

**Type consistency check:**
- `AgentRow` / `AgentFolderRow` defined in `src/types/agent.ts` (Task 2), imported by service (Task 2), preload (Task 3), and all renderer pieces (4-9) ✓
- `CreateAgentInput` / `UpdateAgentPatch` defined in `agentsService.ts` (Task 2), referenced in `agentHandlers.ts` (Task 3) ✓
- `AgentMenuKind` defined and exported from `AgentContextMenu.tsx` (Task 9), imported by `AgentsSidebar.tsx` (Task 9) ✓
- IPC channel names consistent: `agents:getAll`, `agents:create`, `agents:update`, `agents:delete`, `agents:duplicate`, `agents:createFolder`, `agents:renameFolder`, `agents:deleteFolder`, `agents:changed` (all match across `agentHandlers.ts` and `preload.ts`) ✓
- Route `/library/agent/:id` consistent across `Library.tsx` (Task 4), `LibrarySidebar.tsx` (Task 5), `AgentsSidebar.tsx` (Task 6), `LibraryDetailRoutes.tsx` (Task 8) ✓
- 1500ms debounce constant matches existing `RepoNotes.tsx:54` (Task 8) ✓

**Scope check:** Single feature, contained to Library mode + new tables + new IPC surface. Plannable in one pass.

**Placeholder scan:** No "TBD", no "implement later", no "add validation". All steps contain actual content.
