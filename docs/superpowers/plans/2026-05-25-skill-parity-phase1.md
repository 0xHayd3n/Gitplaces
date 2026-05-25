# Skill Parity Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every agent capable of holding the full content of a Superpowers-style `SKILL.md` directory (frontmatter description, main body, sibling `.md` files, scripts) and add a UI to import installed plugin skills as fully-owned agents.

**Architecture:** Schema extends the existing `agents` table with 5 new columns and adds a new `agent_files` child table. Service layer gains file CRUD methods and a new `skillImportService` that walks the filesystem to discover plugins and parse `SKILL.md` directories. UI adds a `Files` tab to the agent detail view (split-view editor) and an `ImportSkillDialog` modal launched from the existing sidebar `+` popover. The agent's body field continues to be `SKILL.md` — the Files tab just exposes it alongside the sibling files in one editor.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3, Vitest + @testing-library/react, Lucide icons, `gray-matter` (new dep for YAML frontmatter parsing).

**Spec:** [docs/superpowers/specs/2026-05-25-skill-parity-phase1-design.md](../specs/2026-05-25-skill-parity-phase1-design.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/db.ts` | Modify | Add `ALTER TABLE agents` for 5 new columns; add `CREATE TABLE IF NOT EXISTS agent_files`. |
| `src/types/agent.ts` | Modify | Extend `AgentRow` with `description`, `origin_*` fields; add `AgentFile` interface. |
| `electron/services/agentsService.ts` | Modify | Add `listFiles`, `createFile`, `updateFile`, `deleteFile`. Extend `updateAgent` to accept `description`. Extend `createAgent` to accept `description`. |
| `electron/services/agentsService.test.ts` | Modify | Tests for the new file functions + description. |
| `electron/services/skillImportService.ts` | Create | `discoverPlugins`, `parseSkill`, `importSkill`. |
| `electron/services/skillImportService.test.ts` | Create | Fixture-based tests against fake plugin directories. |
| `electron/ipc/agentHandlers.ts` | Modify | New IPC handlers under `agents:files:*` and `agents:import:*`. |
| `electron/preload.ts` | Modify | Add `files.*` and `import.*` namespaces under `window.api.agents`. |
| `src/views/AgentDetail.tsx` | Modify | Add `'files'` tab; render description in hero; render origin chip. |
| `src/views/AgentDetail.css` | Modify | Restore `.agent-detail-description`; add `.agent-detail-chip--origin`; add `.agent-detail-files*` rules. |
| `src/views/AgentDetail.test.tsx` | Modify | Tests for Files tab, description, origin chip. |
| `src/components/AgentFilesTab.tsx` | Create | Split-view file list + editor. |
| `src/components/AgentFilesTab.test.tsx` | Create | Component tests. |
| `src/components/ImportSkillDialog.tsx` | Create | Modal. |
| `src/components/ImportSkillDialog.test.tsx` | Create | Component tests. |
| `src/components/AgentsSidebar.tsx` | Modify | Add "Import skill…" item to the `+` popover. |
| `package.json` | Modify | Add `gray-matter` dep. |

---

## Phase 1: Foundation (schema + types)

### Task 1: Add new agent columns and `agent_files` table

**Files:**
- Modify: `electron/db.ts`

- [ ] **Step 1: Add the migration lines**

In `electron/db.ts`, find the bottom of the existing `try { db.exec(\`ALTER TABLE ...\`) } catch {}` block (after the most recent migration). Add a new "Phase 24" migration block:

```ts
  // Phase 24 — Skill parity Phase 1: description + origin tracking + agent_files
  try { db.exec(`ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN origin_plugin TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN origin_path TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN origin_version TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN origin_imported_at TEXT`) } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS agent_files (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (agent_id, filename),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_files_agent ON agent_files(agent_id)`)
```

- [ ] **Step 2: Smoke-test schema by running the test suite**

```bash
npm test -- electron/services/agentsService.test.ts
```

Expected: all existing tests still PASS (the new columns default to empty/NULL so existing behavior is unchanged).

- [ ] **Step 3: Commit**

```bash
git add electron/db.ts
git commit -m "feat(agents): add description + origin columns and agent_files table"
```

### Task 2: Extend TypeScript types

**Files:**
- Modify: `src/types/agent.ts`

- [ ] **Step 1: Add `description` and origin fields to `AgentRow`**

In `src/types/agent.ts`, find the `AgentRow` interface and add these fields after `pinned_at`:

```ts
  description: string
  origin_plugin: string | null
  origin_path: string | null
  origin_version: string | null
  origin_imported_at: string | null
```

- [ ] **Step 2: Add the `AgentFile` interface**

At the bottom of `src/types/agent.ts`:

```ts
export interface AgentFile {
  id: string
  agent_id: string
  filename: string
  content: string
  sort_order: number
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Verify TS compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -20
```

Expected: no new errors beyond the pre-existing AgentsSidebar one.

- [ ] **Step 4: Commit**

```bash
git add src/types/agent.ts
git commit -m "feat(agents): extend AgentRow with description + origin; add AgentFile"
```

---

## Phase 2: Service layer — file CRUD + description

### Task 3: Test — `listFiles` returns rows ordered by `sort_order`

**Files:**
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Append a new `describe` block at the bottom of the file**

```ts
describe('agent files', () => {
  it('listFiles returns rows ordered by sort_order ascending', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('f1', agent.id, 'b.md', 'B', 1, '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    db.prepare(`
      INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('f2', agent.id, 'a.md', 'A', 0, '2026-05-25T00:00:00Z', '2026-05-25T00:00:00Z')
    const files = listFiles(db, agent.id)
    expect(files.map(f => f.filename)).toEqual(['a.md', 'b.md'])
  })
})
```

Reference `openMemoryDb` and `baseInput` from the existing test helpers (they're imported at the top of the file already).

- [ ] **Step 2: Run the test (expect failure — `listFiles` not yet exported)**

```bash
npm test -- electron/services/agentsService.test.ts -t "listFiles returns"
```

Expected: FAIL — `listFiles is not a function` or similar.

- [ ] **Step 3: Implement `listFiles`**

In `electron/services/agentsService.ts`, add after the existing `revertToRevision` function (find it with grep — it's near the bottom):

```ts
export function listFiles(db: Database.Database, agentId: string): AgentFile[] {
  return db.prepare(
    `SELECT * FROM agent_files WHERE agent_id = ? ORDER BY sort_order ASC, filename ASC`,
  ).all(agentId) as AgentFile[]
}
```

Also add `AgentFile` to the type import at the top of the file:

```ts
import type { AgentFile } from '../../src/types/agent'
```

- [ ] **Step 4: Run the test**

```bash
npm test -- electron/services/agentsService.test.ts -t "listFiles returns"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): listFiles service for agent_files table"
```

### Task 4: `createFile`, `updateFile`, `deleteFile`

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Append three tests**

```ts
  it('createFile inserts a file and returns the row', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const file = createFile(db, agent.id, { filename: 'notes.md', content: '# Hi', sortOrder: 0 })
    expect(file.filename).toBe('notes.md')
    expect(file.content).toBe('# Hi')
    expect(listFiles(db, agent.id)).toHaveLength(1)
  })

  it('createFile rejects duplicate filenames within an agent', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    createFile(db, agent.id, { filename: 'notes.md', content: 'a', sortOrder: 0 })
    expect(() => createFile(db, agent.id, { filename: 'notes.md', content: 'b', sortOrder: 1 })).toThrow()
  })

  it('updateFile patches content and updated_at', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const f = createFile(db, agent.id, { filename: 'notes.md', content: 'a', sortOrder: 0 })
    const updated = updateFile(db, agent.id, f.id, { content: 'b' })
    expect(updated.content).toBe('b')
    expect(updated.updated_at).not.toBe(f.updated_at)
  })

  it('updateFile can rename and rejects duplicate rename', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const f1 = createFile(db, agent.id, { filename: 'a.md', content: 'a', sortOrder: 0 })
    createFile(db, agent.id, { filename: 'b.md', content: 'b', sortOrder: 1 })
    const renamed = updateFile(db, agent.id, f1.id, { filename: 'c.md' })
    expect(renamed.filename).toBe('c.md')
    expect(() => updateFile(db, agent.id, f1.id, { filename: 'b.md' })).toThrow()
  })

  it('deleteFile removes the row', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const f = createFile(db, agent.id, { filename: 'notes.md', content: 'a', sortOrder: 0 })
    deleteFile(db, agent.id, f.id)
    expect(listFiles(db, agent.id)).toHaveLength(0)
  })

  it('deleting the agent cascade-deletes its files', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    createFile(db, agent.id, { filename: 'notes.md', content: 'a', sortOrder: 0 })
    deleteAgent(db, agent.id)
    const rows = db.prepare(`SELECT COUNT(*) as c FROM agent_files WHERE agent_id = ?`).get(agent.id) as { c: number }
    expect(rows.c).toBe(0)
  })
```

- [ ] **Step 2: Run the tests (expect failure)**

```bash
npm test -- electron/services/agentsService.test.ts -t "createFile|updateFile|deleteFile|cascade-deletes"
```

Expected: 6 FAIL.

- [ ] **Step 3: Implement the three functions**

In `electron/services/agentsService.ts`, after `listFiles`:

```ts
export interface CreateFileInput {
  filename: string
  content: string
  sortOrder?: number
}

export interface UpdateFilePatch {
  filename?: string
  content?: string
  sortOrder?: number
}

const FILENAME_RE = /^[\w./-]+$/

function assertValidFilename(name: string): void {
  if (!FILENAME_RE.test(name)) throw new Error(`Invalid filename: ${name}`)
  if (name.length === 0 || name.length > 200) throw new Error(`Filename out of range: ${name}`)
}

export function createFile(
  db: Database.Database,
  agentId: string,
  input: CreateFileInput,
): AgentFile {
  assertValidFilename(input.filename)
  const id = randomUUID()
  const ts = nowIso()
  const sortOrder = input.sortOrder ?? 0
  db.prepare(`
    INSERT INTO agent_files (id, agent_id, filename, content, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, input.filename, input.content, sortOrder, ts, ts)
  return db.prepare(`SELECT * FROM agent_files WHERE id = ?`).get(id) as AgentFile
}

export function updateFile(
  db: Database.Database,
  agentId: string,
  fileId: string,
  patch: UpdateFilePatch,
): AgentFile {
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

export function deleteFile(db: Database.Database, agentId: string, fileId: string): void {
  db.prepare(`DELETE FROM agent_files WHERE id = ? AND agent_id = ?`).run(fileId, agentId)
}
```

`randomUUID`, `nowIso`, and `Database` are already imported at the top of the file.

- [ ] **Step 4: Run the tests**

```bash
npm test -- electron/services/agentsService.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): createFile, updateFile, deleteFile services"
```

### Task 5: `description` field on createAgent + updateAgent

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 1: Append tests**

```ts
  it('createAgent accepts and persists description', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, { ...baseInput(), description: 'My description' })
    expect(agent.description).toBe('My description')
  })

  it('createAgent defaults description to empty string when omitted', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    expect(agent.description).toBe('')
  })

  it('updateAgent patches description', () => {
    const db = openMemoryDb()
    const agent = createAgent(db, baseInput())
    const updated = updateAgent(db, agent.id, { description: 'New desc' })
    expect(updated.description).toBe('New desc')
  })
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/agentsService.test.ts -t "description"
```

Expected: 3 FAIL.

- [ ] **Step 3: Extend `CreateAgentInput`, `UpdateAgentPatch`, and the SQL**

In `electron/services/agentsService.ts`:

1. Add to `CreateAgentInput` interface (find it; it's near line 120):

```ts
  description?: string
```

2. In `createAgent`, change the INSERT to include description. Find:

```ts
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, ts, ts)
```

Replace with:

```ts
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, input.description ?? '', ts, ts)
```

3. Add to `UpdateAgentPatch` interface:

```ts
  description?: string
```

4. In `updateAgent`, after the existing patch.emoji handling, add:

```ts
  if (patch.description !== undefined) {
    sets.push('description = ?'); params.push(patch.description)
  }
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/agentsService.test.ts -t "description"
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): description field on createAgent + updateAgent"
```

### Task 6: IPC handlers for file CRUD

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add the IPC handlers**

In `electron/ipc/agentHandlers.ts`, at the top extend the imports:

```ts
import {
  // existing imports...
  listFiles, createFile, updateFile, deleteFile,
  type CreateFileInput, type UpdateFilePatch,
} from '../services/agentsService'
```

Then append these handlers at the end of the registration function (right before the closing brace), alongside the existing `agents:revisions:*` handlers:

```ts
  ipcMain.handle('agents:files:list', async (_, agentId: string) => {
    return listFiles(getDb(app.getPath('userData')), agentId)
  })

  ipcMain.handle('agents:files:create', async (_, agentId: string, input: CreateFileInput) => {
    const file = createFile(getDb(app.getPath('userData')), agentId, input)
    broadcastChanged()
    return file
  })

  ipcMain.handle('agents:files:update', async (_, agentId: string, fileId: string, patch: UpdateFilePatch) => {
    const file = updateFile(getDb(app.getPath('userData')), agentId, fileId, patch)
    broadcastChanged()
    return file
  })

  ipcMain.handle('agents:files:delete', async (_, agentId: string, fileId: string) => {
    deleteFile(getDb(app.getPath('userData')), agentId, fileId)
    broadcastChanged()
  })
```

- [ ] **Step 2: Add the preload routes**

In `electron/preload.ts`, find the existing `revisions:` block under `agents:` (around the existing `revisions: { list: ..., revert: ... }` definition) and add a `files` block immediately after it:

```ts
    files: {
      list: (agentId: string) =>
        ipcRenderer.invoke('agents:files:list', agentId) as Promise<import('../src/types/agent').AgentFile[]>,
      create: (agentId: string, input: { filename: string; content: string; sortOrder?: number }) =>
        ipcRenderer.invoke('agents:files:create', agentId, input) as Promise<import('../src/types/agent').AgentFile>,
      update: (agentId: string, fileId: string, patch: { filename?: string; content?: string; sortOrder?: number }) =>
        ipcRenderer.invoke('agents:files:update', agentId, fileId, patch) as Promise<import('../src/types/agent').AgentFile>,
      delete: (agentId: string, fileId: string) =>
        ipcRenderer.invoke('agents:files:delete', agentId, fileId) as Promise<void>,
    },
```

Also extend the existing `update` patch type to include `description`:

```ts
    update: (id: string, patch: {
      // existing fields...
      description?: string
    }) =>
```

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -10
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts
git commit -m "feat(agents): IPC routes for agent file CRUD and description"
```

---

## Phase 3: Skill import service

### Task 7: Add `gray-matter` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install gray-matter**

```bash
npm install gray-matter@^4.0.3
```

Expected: clean install, no warnings.

- [ ] **Step 2: Verify import works in a quick smoke**

Create a temp file `/tmp/gm-smoke.cjs`:

```js
const m = require('gray-matter')
console.log(m('---\nname: x\n---\nbody'))
```

Run: `node /tmp/gm-smoke.cjs`

Expected output: object with `data: { name: 'x' }` and `content: 'body'`.

Delete the temp file: `rm /tmp/gm-smoke.cjs`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add gray-matter for YAML frontmatter parsing"
```

### Task 8: `parseSkill` — read a skill directory

**Files:**
- Create: `electron/services/skillImportService.ts`
- Create: `electron/services/skillImportService.test.ts`
- Create: test fixtures under `electron/services/__fixtures__/skills/`

- [ ] **Step 1: Create the fixture directory**

Create `electron/services/__fixtures__/skills/basic/SKILL.md`:

```markdown
---
name: basic-skill
description: A simple skill for testing import.
---

# Basic Skill

This is the body of the basic skill.
```

Create `electron/services/__fixtures__/skills/with-siblings/SKILL.md`:

```markdown
---
name: with-siblings
description: A skill that has sibling files.
---

# Main

See `notes.md` for details.
```

Create `electron/services/__fixtures__/skills/with-siblings/notes.md`:

```markdown
# Notes

Some supplementary content.
```

Create `electron/services/__fixtures__/skills/with-siblings/scripts/run.sh`:

```bash
#!/bin/bash
echo "hello"
```

Create `electron/services/__fixtures__/skills/with-siblings/.DS_Store` (empty file — to verify it's excluded):

```bash
touch electron/services/__fixtures__/skills/with-siblings/.DS_Store
```

- [ ] **Step 2: Write the failing test**

Create `electron/services/skillImportService.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { parseSkill } from './skillImportService'

const FIXTURES = path.join(__dirname, '__fixtures__/skills')

describe('parseSkill', () => {
  it('reads a basic SKILL.md and returns name, description, body', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    expect(skill.name).toBe('basic-skill')
    expect(skill.description).toBe('A simple skill for testing import.')
    expect(skill.body).toContain('# Basic Skill')
    expect(skill.files).toEqual([])
    expect(skill.handle).toBe('basic-skill')
  })

  it('enumerates sibling .md files alphabetically, excluding ignore patterns and scripts', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const filenames = skill.files.map(f => f.filename)
    expect(filenames).toContain('notes.md')
    expect(filenames).toContain('scripts/run.sh')
    expect(filenames).not.toContain('.DS_Store')
    expect(filenames).not.toContain('SKILL.md')
    // Alphabetical order
    expect(filenames).toEqual([...filenames].sort())
  })

  it('accepts a SKILL.md file path directly and uses its parent directory', async () => {
    const skill = await parseSkill(path.join(FIXTURES, 'basic', 'SKILL.md'))
    expect(skill.name).toBe('basic-skill')
  })

  it('throws when SKILL.md is missing', async () => {
    await expect(parseSkill(path.join(FIXTURES, 'does-not-exist'))).rejects.toThrow(/SKILL\.md/i)
  })
})
```

- [ ] **Step 3: Run the test (expect failure)**

```bash
npm test -- electron/services/skillImportService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement parseSkill**

Create `electron/services/skillImportService.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { slugifyName } from '../../src/utils/agentSlug'

export interface ParsedSkill {
  name: string
  handle: string
  description: string
  body: string
  files: { filename: string; content: string }[]
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
}

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']

export async function parseSkill(inputPath: string): Promise<ParsedSkill> {
  // Resolve to the skill directory. If user gave a SKILL.md path, use its parent.
  let skillDir = inputPath
  const stat = await fs.stat(inputPath).catch(() => null)
  if (!stat) throw new Error(`Path does not exist: ${inputPath}`)
  if (stat.isFile()) skillDir = path.dirname(inputPath)

  const skillMdPath = path.join(skillDir, 'SKILL.md')
  const skillMd = await fs.readFile(skillMdPath, 'utf-8').catch(() => null)
  if (skillMd === null) throw new Error(`SKILL.md not found in: ${skillDir}`)

  const parsed = matter(skillMd)
  const data = parsed.data as Record<string, unknown>
  const name = typeof data.name === 'string' && data.name.length > 0
    ? data.name
    : path.basename(skillDir)
  const description = typeof data.description === 'string' ? data.description : ''

  // Warn about unknown frontmatter keys (Phase 1 drops them)
  const known = new Set(['name', 'description'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[skillImportService] Dropped frontmatter keys from ${skillDir}:`, dropped)
  }

  const files = await walkSkillFiles(skillDir)
  const handle = slugifyName(name)

  return {
    name,
    handle,
    description,
    body: parsed.content.trim(),
    files,
    origin: null,  // populated by importSkill caller
  }
}

async function walkSkillFiles(skillDir: string): Promise<{ filename: string; content: string }[]> {
  const collected: { filename: string; content: string }[] = []
  await walkRecursive(skillDir, skillDir, collected)
  return collected.sort((a, b) => a.filename.localeCompare(b.filename))
}

async function walkRecursive(
  root: string,
  current: string,
  out: { filename: string; content: string }[],
): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE_NAMES.has(entry.name)) continue
    if (IGNORE_SUFFIXES.some(s => entry.name.endsWith(s))) continue
    const abs = path.join(current, entry.name)
    if (entry.isDirectory()) {
      await walkRecursive(root, abs, out)
    } else if (entry.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (rel === 'SKILL.md') continue
      const content = await fs.readFile(abs, 'utf-8')
      out.push({ filename: rel, content })
    }
  }
}
```

- [ ] **Step 5: Run the test**

```bash
npm test -- electron/services/skillImportService.test.ts
```

Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/skillImportService.ts electron/services/skillImportService.test.ts electron/services/__fixtures__
git commit -m "feat(agents): parseSkill — read SKILL.md + siblings + scripts"
```

### Task 9: `discoverPlugins` — walk install roots

**Files:**
- Modify: `electron/services/skillImportService.ts`
- Modify: `electron/services/skillImportService.test.ts`
- Create: more fixtures under `electron/services/__fixtures__/plugins/`

- [ ] **Step 1: Create fixture plugins**

Create `electron/services/__fixtures__/plugins/cool-plugin/package.json`:

```json
{ "name": "cool-plugin", "version": "1.2.3" }
```

Create `electron/services/__fixtures__/plugins/cool-plugin/skills/foo/SKILL.md`:

```markdown
---
name: foo
description: Foo skill.
---

# Foo
```

Create `electron/services/__fixtures__/plugins/cool-plugin/skills/bar/SKILL.md`:

```markdown
---
name: bar
description: Bar skill.
---

# Bar
```

Create `electron/services/__fixtures__/plugins/no-package/skills/baz/SKILL.md`:

```markdown
---
name: baz
description: Baz skill.
---

# Baz
```

Create an empty marker file `electron/services/__fixtures__/plugins/not-a-plugin/README.md` (a dir without skills/ — should be ignored):

```markdown
# Not a plugin
```

- [ ] **Step 2: Append tests**

```ts
describe('discoverPlugins', () => {
  it('finds plugins with package.json and skills/', async () => {
    const roots = [path.join(__dirname, '__fixtures__/plugins')]
    const plugins = await discoverPlugins(roots)
    const names = plugins.map(p => p.name).sort()
    expect(names).toContain('cool-plugin')
    expect(names).toContain('no-package')
    expect(names).not.toContain('not-a-plugin')
  })

  it('reads version from package.json', async () => {
    const roots = [path.join(__dirname, '__fixtures__/plugins')]
    const plugins = await discoverPlugins(roots)
    const cool = plugins.find(p => p.name === 'cool-plugin')
    expect(cool?.version).toBe('1.2.3')
  })

  it('uses directory name when package.json is absent', async () => {
    const roots = [path.join(__dirname, '__fixtures__/plugins')]
    const plugins = await discoverPlugins(roots)
    const noPkg = plugins.find(p => p.name === 'no-package')
    expect(noPkg).toBeDefined()
    expect(noPkg?.version).toBeNull()
  })

  it('lists each plugin\'s skills with name and fileCount', async () => {
    const roots = [path.join(__dirname, '__fixtures__/plugins')]
    const plugins = await discoverPlugins(roots)
    const cool = plugins.find(p => p.name === 'cool-plugin')!
    expect(cool.skills.map(s => s.name).sort()).toEqual(['bar', 'foo'])
    expect(cool.skills[0].fileCount).toBeGreaterThanOrEqual(1)
  })
})
```

Add the imports at the top of the test file (`discoverPlugins`).

- [ ] **Step 3: Run tests (expect failure)**

```bash
npm test -- electron/services/skillImportService.test.ts -t "discoverPlugins"
```

Expected: 4 FAIL — `discoverPlugins is not a function`.

- [ ] **Step 4: Implement `discoverPlugins`**

In `electron/services/skillImportService.ts`, append:

```ts
export interface DiscoveredSkill {
  name: string
  path: string
  description: string | null
  fileCount: number
}

export interface DiscoveredPlugin {
  id: string         // hash of root path
  name: string
  version: string | null
  root: string
  skills: DiscoveredSkill[]
}

export async function discoverPlugins(roots: string[]): Promise<DiscoveredPlugin[]> {
  const out: DiscoveredPlugin[] = []
  for (const root of roots) {
    const exists = await fs.stat(root).catch(() => null)
    if (!exists || !exists.isDirectory()) continue
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = path.join(root, entry.name)
      const skillsDir = path.join(pluginDir, 'skills')
      const skillsStat = await fs.stat(skillsDir).catch(() => null)
      if (!skillsStat?.isDirectory()) continue
      const skills = await listSkillsInPluginDir(skillsDir)
      if (skills.length === 0) continue

      let name = entry.name
      let version: string | null = null
      const pkgPath = path.join(pluginDir, 'package.json')
      const pkgRaw = await fs.readFile(pkgPath, 'utf-8').catch(() => null)
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw)
          if (typeof pkg.name === 'string') name = pkg.name
          if (typeof pkg.version === 'string') version = pkg.version
        } catch {
          // Malformed package.json — fall back to dir name
        }
      }
      out.push({
        id: simpleHash(pluginDir),
        name,
        version,
        root: pluginDir,
        skills,
      })
    }
  }
  return out
}

async function listSkillsInPluginDir(skillsDir: string): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = []
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(skillsDir, entry.name)
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const skillMd = await fs.readFile(skillMdPath, 'utf-8').catch(() => null)
    if (skillMd === null) continue
    let name = entry.name
    let description: string | null = null
    try {
      const parsed = matter(skillMd)
      const data = parsed.data as Record<string, unknown>
      if (typeof data.name === 'string') name = data.name
      if (typeof data.description === 'string') description = data.description
    } catch {
      // Bad frontmatter — keep defaults
    }
    const fileCount = await countSkillFiles(skillDir)
    out.push({ name, path: skillDir, description, fileCount })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function countSkillFiles(dir: string): Promise<number> {
  let n = 0
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const e of entries) {
      if (IGNORE_NAMES.has(e.name)) continue
      if (e.isDirectory()) await walk(path.join(d, e.name))
      else if (e.isFile()) n++
    }
  }
  await walk(dir)
  return n
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- electron/services/skillImportService.test.ts -t "discoverPlugins"
```

Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/skillImportService.ts electron/services/skillImportService.test.ts electron/services/__fixtures__
git commit -m "feat(agents): discoverPlugins — walk install roots for plugin shapes"
```

### Task 10: `importSkill` — create agent + files in DB

**Files:**
- Modify: `electron/services/skillImportService.ts`
- Modify: `electron/services/skillImportService.test.ts`

- [ ] **Step 1: Append tests**

```ts
import Database from 'better-sqlite3'
import { initSchema } from '../db'
import { createFolder, createAgent } from './agentsService'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

describe('importSkill', () => {
  it('creates a new agent with files when handle is unused', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'with-siblings'))
    const result = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    expect(result.conflictResolved).toBe('created')
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(result.agentId) as any
    expect(agent.handle).toBe('with-siblings')
    expect(agent.body).toContain('# Main')
    expect(agent.description).toBe('A skill that has sibling files.')
    const files = db.prepare(`SELECT * FROM agent_files WHERE agent_id = ?`).all(result.agentId) as any[]
    expect(files.length).toBeGreaterThanOrEqual(2) // notes.md + scripts/run.sh
  })

  it('overwrites an existing agent when onConflict=overwrite', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    const first = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, { ...skill, body: 'CHANGED BODY' }, { folderId: folder.id, onConflict: 'overwrite' })
    expect(second.conflictResolved).toBe('overwritten')
    expect(second.agentId).toBe(first.agentId)
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(first.agentId) as any
    expect(agent.body).toBe('CHANGED BODY')
  })

  it('skips when onConflict=skip and agent exists', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, { ...skill, body: 'CHANGED' }, { folderId: folder.id, onConflict: 'skip' })
    expect(second.conflictResolved).toBe('skipped')
  })

  it('renames with -2 suffix when onConflict=rename and handle is taken', async () => {
    const db = openDb()
    const folder = createFolder(db, 'Test')
    const skill = await parseSkill(path.join(FIXTURES, 'basic'))
    importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    const second = importSkill(db, skill, { folderId: folder.id, onConflict: 'rename' })
    expect(second.conflictResolved).toBe('renamed')
    const second_agent = db.prepare(`SELECT handle FROM agents WHERE id = ?`).get(second.agentId) as any
    expect(second_agent.handle).toBe('basic-skill-2')
  })
})
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- electron/services/skillImportService.test.ts -t "importSkill"
```

Expected: 4 FAIL.

- [ ] **Step 3: Implement importSkill**

In `electron/services/skillImportService.ts`, append:

```ts
import type Database from 'better-sqlite3'
import { createAgent, updateAgent, createFile, deleteFile, listFiles } from './agentsService'
import { dedupeHandle } from '../../src/utils/agentSlug'
import { hashHandleToColor } from '../../src/utils/colorHarmony'

export interface ImportOptions {
  folderId: string | null
  onConflict: 'overwrite' | 'skip' | 'rename'
}

export interface ImportResult {
  agentId: string
  conflictResolved: 'created' | 'overwritten' | 'skipped' | 'renamed'
}

export function importSkill(
  db: Database.Database,
  skill: ParsedSkill,
  opts: ImportOptions,
): ImportResult {
  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const existing = db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(skill.handle) as { id: string } | undefined

  if (existing) {
    if (opts.onConflict === 'skip') {
      return { agentId: existing.id, conflictResolved: 'skipped' }
    }
    if (opts.onConflict === 'overwrite') {
      // Update agent fields + replace files
      updateAgent(db, existing.id, {
        name: skill.name,
        body: skill.body,
        description: skill.description,
      })
      // Replace origin metadata
      const ts = new Date().toISOString()
      db.prepare(`
        UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
        WHERE id = ?
      `).run(
        skill.origin?.plugin ?? null,
        skill.origin?.path ?? null,
        skill.origin?.pluginVersion ?? null,
        ts,
        existing.id,
      )
      const oldFiles = listFiles(db, existing.id)
      for (const f of oldFiles) deleteFile(db, existing.id, f.id)
      skill.files.forEach((f, i) => {
        createFile(db, existing.id, { filename: f.filename, content: f.content, sortOrder: i })
      })
      return { agentId: existing.id, conflictResolved: 'overwritten' }
    }
    // rename
    const newHandle = dedupeHandle(skill.handle, taken)
    return createFromScratch(db, { ...skill, handle: newHandle }, opts, 'renamed')
  }

  return createFromScratch(db, skill, opts, 'created')
}

function createFromScratch(
  db: Database.Database,
  skill: ParsedSkill,
  opts: ImportOptions,
  resolution: 'created' | 'renamed',
): ImportResult {
  const colorStart = hashHandleToColor(skill.handle)
  const agent = createAgent(db, {
    name: skill.name,
    body: skill.body,
    folderId: opts.folderId,
    handle: skill.handle,
    colorStart,
    colorEnd: null,
    emoji: null,
    description: skill.description,
  })
  const ts = new Date().toISOString()
  db.prepare(`
    UPDATE agents SET origin_plugin = ?, origin_path = ?, origin_version = ?, origin_imported_at = ?
    WHERE id = ?
  `).run(
    skill.origin?.plugin ?? null,
    skill.origin?.path ?? null,
    skill.origin?.pluginVersion ?? null,
    ts,
    agent.id,
  )
  skill.files.forEach((f, i) => {
    createFile(db, agent.id, { filename: f.filename, content: f.content, sortOrder: i })
  })
  return { agentId: agent.id, conflictResolved: resolution }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/skillImportService.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/skillImportService.ts electron/services/skillImportService.test.ts
git commit -m "feat(agents): importSkill — create/overwrite/skip/rename"
```

### Task 11: IPC handlers for the import service

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add the import-discovery roots resolver**

In `electron/ipc/agentHandlers.ts`, at the top of the file add:

```ts
import os from 'node:os'
import { discoverPlugins, parseSkill, importSkill, type ImportOptions } from '../services/skillImportService'
```

Then define a helper function that returns the discovery roots:

```ts
function pluginDiscoveryRoots(): string[] {
  const home = os.homedir()
  const cwd = process.cwd()
  return [
    path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]
}
```

The `cache` root has versioned subdirs (e.g., `claude-plugins-official/superpowers/5.1.0/`). `discoverPlugins` walks one level deep. To handle the cache's nested-by-version layout, we need to walk one level further. **Update `discoverPlugins`** instead to recurse one extra level when a discovered directory does not itself contain `skills/` — actually, the cleanest fix is to flatten the cache before passing to `discoverPlugins`. Replace `pluginDiscoveryRoots` with:

```ts
async function pluginDiscoveryRoots(): Promise<string[]> {
  const home = os.homedir()
  const cwd = process.cwd()
  const roots = [
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]
  // The cache layout is ~/.claude/plugins/cache/<source>/<plugin>/<version>/, so
  // we need to walk to that depth. Enumerate cache subdirectories and add them.
  const cacheDir = path.join(home, '.claude', 'plugins', 'cache')
  try {
    const sources = await import('node:fs/promises').then(fs => fs.readdir(cacheDir, { withFileTypes: true }))
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourceDir = path.join(cacheDir, source.name)
      // Each source contains plugin dirs; each plugin has version subdirs.
      const plugins = await import('node:fs/promises').then(fs => fs.readdir(sourceDir, { withFileTypes: true }))
      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue
        const versionsDir = path.join(sourceDir, plugin.name)
        const versions = await import('node:fs/promises').then(fs => fs.readdir(versionsDir, { withFileTypes: true }))
        for (const v of versions) {
          if (v.isDirectory()) roots.push(path.join(versionsDir, v.name, '..'))
          // ^ that's the wrong path — fix below
        }
      }
    }
  } catch {
    // cache dir missing or unreadable — ignore
  }
  return roots
}
```

Wait, that's not quite right. Let me re-design — `discoverPlugins(roots)` expects each `root` to be a directory whose immediate children are plugin directories. The cache layout puts plugins three levels deep. Easier: pass each `<source>/<plugin>/` as a root, and `discoverPlugins` will treat its immediate children (the version dirs) as plugins. That works because each version dir has `package.json` and `skills/`.

Replace with the cleaner version:

```ts
async function pluginDiscoveryRoots(): Promise<string[]> {
  const fs = await import('node:fs/promises')
  const home = os.homedir()
  const cwd = process.cwd()
  const roots = [
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.opencode', 'plugins'),
  ]
  // Cache layout: ~/.claude/plugins/cache/<source>/<plugin>/<version>/<files>
  // We pass each <source>/<plugin>/ as a root so discoverPlugins sees the
  // <version> directories as plugin dirs.
  const cacheDir = path.join(home, '.claude', 'plugins', 'cache')
  try {
    const sources = await fs.readdir(cacheDir, { withFileTypes: true })
    for (const source of sources) {
      if (!source.isDirectory()) continue
      const sourceDir = path.join(cacheDir, source.name)
      const plugins = await fs.readdir(sourceDir, { withFileTypes: true })
      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue
        roots.push(path.join(sourceDir, plugin.name))
      }
    }
  } catch {
    // cache dir missing — ignore
  }
  return roots
}
```

- [ ] **Step 2: Add the three IPC handlers**

```ts
  ipcMain.handle('agents:import:discoverPlugins', async () => {
    const roots = await pluginDiscoveryRoots()
    return discoverPlugins(roots)
  })

  ipcMain.handle('agents:import:readSkillFromDisk', async (_, skillPath: string) => {
    return parseSkill(skillPath)
  })

  ipcMain.handle('agents:import:importSkill', async (_, skill: any, opts: ImportOptions) => {
    const result = importSkill(getDb(app.getPath('userData')), skill, opts)
    broadcastChanged()
    return result
  })
```

- [ ] **Step 3: Add the preload routes**

In `electron/preload.ts`, after the new `files: {...}` block, append a sibling `import: {...}` block:

```ts
    import: {
      discoverPlugins: () =>
        ipcRenderer.invoke('agents:import:discoverPlugins') as Promise<import('../electron/services/skillImportService').DiscoveredPlugin[]>,
      readSkillFromDisk: (skillPath: string) =>
        ipcRenderer.invoke('agents:import:readSkillFromDisk', skillPath) as Promise<import('../electron/services/skillImportService').ParsedSkill>,
      importSkill: (
        skill: import('../electron/services/skillImportService').ParsedSkill,
        opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' },
      ) =>
        ipcRenderer.invoke('agents:import:importSkill', skill, opts) as Promise<import('../electron/services/skillImportService').ImportResult>,
    },
```

- [ ] **Step 4: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts
git commit -m "feat(agents): IPC routes for plugin discovery and skill import"
```

---

## Phase 4: Detail view UI

### Task 12: Hero — description + origin chip

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append a failing test for the description**

In `src/views/AgentDetail.test.tsx`, find the `renders the hero with scoped handle...` test. Append two tests after it:

```tsx
  it('renders explicit description from agent.description in the hero', async () => {
    const withDesc: AgentRow = { ...baseAgent, description: 'My explicit description' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [withDesc] })
    setup()
    await waitForLoaded()
    expect(screen.getByText('My explicit description')).toBeTruthy()
  })

  it('renders origin chip when agent.origin_plugin is set', async () => {
    const imported: AgentRow = { ...baseAgent, origin_plugin: 'superpowers', origin_version: '5.1.0' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [imported] })
    setup()
    await waitForLoaded()
    expect(screen.getByText(/from superpowers v5\.1\.0/i)).toBeTruthy()
  })
```

Update `baseAgent` at the top of the file to include the new fields:

```ts
const baseAgent: AgentRow = {
  // ...existing fields...
  description: '',
  origin_plugin: null,
  origin_path: null,
  origin_version: null,
  origin_imported_at: null,
}
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "explicit description|origin chip"
```

Expected: 2 FAIL.

- [ ] **Step 3: Implement the hero changes**

In `src/views/AgentDetail.tsx`, find the meta-chips block in the hero (the three chips for folder/kb/updated). Above it, add the description paragraph:

```tsx
          {(agent.description || deriveDescription(liveBody)) && (
            <p className="agent-detail-description">
              {agent.description || deriveDescription(liveBody)}
            </p>
          )}
          <div className="agent-detail-meta">
            <span className="agent-detail-chip"><Folder size={11} /> {currentFolderName}</span>
            <span className="agent-detail-chip"><FileText size={11} /> {(bodyChars / 1024).toFixed(1)} kb</span>
            <span className="agent-detail-chip"><Clock size={11} /> Updated {new Date(agent.updated_at).toLocaleString()}</span>
            {agent.origin_plugin && (
              <span className="agent-detail-chip agent-detail-chip--origin">
                <Zap size={11} /> from {agent.origin_plugin}{agent.origin_version ? ` v${agent.origin_version}` : ''}
              </span>
            )}
          </div>
```

Add `Zap` to the existing `lucide-react` import line.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "explicit description|origin chip"
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): hero shows explicit description + origin chip"
```

### Task 13: CSS — restore `.agent-detail-description` and add `--origin` chip variant

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Add the description rule**

In `src/views/AgentDetail.css`, find `.agent-detail-meta` and add this rule **before** it:

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

- [ ] **Step 2: Add the chip variant**

Find `.agent-detail-chip` and append after it:

```css
.agent-detail-chip--origin {
  color: var(--accent-text);
  background: var(--accent-soft);
  border-color: var(--accent-border);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): description paragraph + origin chip variant"
```

### Task 14: Add `'files'` to the tab list (no body yet)

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append a failing test**

```tsx
  it('tab bar includes Files tab between History and Settings', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
  })
```

- [ ] **Step 2: Run (expect failure)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Files tab between"
```

Expected: FAIL.

- [ ] **Step 3: Add the tab and widen the type**

In `src/views/AgentDetail.tsx`:

1. Widen `activeTab`:

```tsx
const [activeTab, setActiveTab] = useState<'prompt' | 'preview' | 'mcp' | 'history' | 'files' | 'settings'>('prompt')
```

2. Add the Files tab button between History and the spacer. In the tabs block:

```tsx
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('history')}
        >
          <Clock size={13} /> History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'files'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('files')}
        >
          <FileText size={13} /> Files
        </button>
        <span className="agent-detail-tabs-spacer" />
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Files tab between"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): add Files tab to detail view tab bar"
```

### Task 15: AgentFilesTab — render file list

**Files:**
- Create: `src/components/AgentFilesTab.tsx`
- Create: `src/components/AgentFilesTab.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentFilesTab from './AgentFilesTab'
import type { AgentRow, AgentFile } from '../types/agent'

const agent: AgentRow = {
  id: 'a1',
  name: 'Test',
  handle: 'test',
  body: '# Main\n\nSee notes.md',
  folder_id: null,
  color_start: '#10b981',
  color_end: null,
  emoji: null,
  pinned: 0,
  pinned_at: null,
  last_used_at: null,
  presets_json: '[]',
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
  description: '',
  origin_plugin: null,
  origin_path: null,
  origin_version: null,
  origin_imported_at: null,
}

const files: AgentFile[] = [
  { id: 'f1', agent_id: 'a1', filename: 'notes.md', content: '# Notes', sort_order: 0, created_at: 't', updated_at: 't' },
  { id: 'f2', agent_id: 'a1', filename: 'scripts/run.sh', content: '#!/bin/bash', sort_order: 1, created_at: 't', updated_at: 't' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      update: vi.fn().mockResolvedValue(undefined),
      files: {
        list: vi.fn().mockResolvedValue(files),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  }
})

describe('AgentFilesTab', () => {
  it('renders the main SKILL.md entry plus the sibling files', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('SKILL.md'))
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(screen.getByText('scripts/run.sh')).toBeTruthy()
  })

  it('groups files into Main / References / Scripts sections', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('SKILL.md'))
    expect(screen.getByText(/^Main$/i)).toBeTruthy()
    expect(screen.getByText(/^References$/i)).toBeTruthy()
    expect(screen.getByText(/^Scripts$/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test -- src/components/AgentFilesTab.test.tsx
```

Expected: FAIL — file not found.

- [ ] **Step 3: Implement minimal AgentFilesTab**

```tsx
import { useEffect, useState } from 'react'
import { FileText, Plus, Edit3, Trash2 } from 'lucide-react'
import type { AgentRow, AgentFile } from '../types/agent'

interface Props {
  agent: AgentRow
}

const SCRIPT_EXTS = new Set(['sh', 'js', 'cjs', 'mjs', 'ts', 'py', 'rb', 'go'])
const MD_EXTS = new Set(['md', 'mdx', 'txt'])

function classifyFile(filename: string): 'reference' | 'script' | 'other' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (MD_EXTS.has(ext)) return 'reference'
  if (SCRIPT_EXTS.has(ext)) return 'script'
  return 'other'
}

export default function AgentFilesTab({ agent }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([])
  const [activeId, setActiveId] = useState<string>('main')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.files.list(agent.id)
      if (!cancelled) setFiles(list)
    })()
    return () => { cancelled = true }
  }, [agent.id])

  const references = files.filter(f => classifyFile(f.filename) === 'reference')
  const scripts = files.filter(f => classifyFile(f.filename) === 'script')
  const others = files.filter(f => classifyFile(f.filename) === 'other')

  return (
    <div className="agent-detail-files">
      <aside className="agent-detail-files-list">
        <div className="agent-detail-files-section">Main</div>
        <FileItem
          name="SKILL.md"
          isMain
          active={activeId === 'main'}
          onSelect={() => setActiveId('main')}
        />
        {references.length > 0 && <div className="agent-detail-files-section">References</div>}
        {references.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {scripts.length > 0 && <div className="agent-detail-files-section">Scripts</div>}
        {scripts.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {others.length > 0 && <div className="agent-detail-files-section">Other</div>}
        {others.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
      </aside>
      <section className="agent-detail-files-editor">
        {/* editor renders in next task */}
      </section>
    </div>
  )
}

function FileItem({
  name, isMain, active, onSelect,
}: { name: string; isMain?: boolean; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={'agent-detail-files-item' + (active ? ' agent-detail-files-item--active' : '') + (isMain ? ' agent-detail-files-item--main' : '')}
      onClick={onSelect}
    >
      <FileText size={13} />
      {name}
    </button>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/components/AgentFilesTab.test.tsx
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentFilesTab.tsx src/components/AgentFilesTab.test.tsx
git commit -m "feat(agents): AgentFilesTab — file list with section grouping"
```

### Task 16: AgentFilesTab — editor + save on blur

**Files:**
- Modify: `src/components/AgentFilesTab.tsx`
- Modify: `src/components/AgentFilesTab.test.tsx`

- [ ] **Step 1: Append tests**

```tsx
  it('selecting SKILL.md shows the agent.body in the editor', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('SKILL.md'))
    fireEvent.click(screen.getByText('SKILL.md'))
    const editor = screen.getByRole('textbox', { name: /file content/i }) as HTMLTextAreaElement
    expect(editor.value).toContain('# Main')
  })

  it('editing the main file calls api.agents.update with new body', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('SKILL.md'))
    fireEvent.click(screen.getByText('SKILL.md'))
    const editor = screen.getByRole('textbox', { name: /file content/i })
    fireEvent.change(editor, { target: { value: 'changed body' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { body: 'changed body' }))
  })

  it('selecting a sibling file shows its content and edits call files.update', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('notes.md'))
    fireEvent.click(screen.getByText('notes.md'))
    const editor = screen.getByRole('textbox', { name: /file content/i }) as HTMLTextAreaElement
    expect(editor.value).toBe('# Notes')
    fireEvent.change(editor, { target: { value: 'new content' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(window.api.agents.files.update).toHaveBeenCalledWith('a1', 'f1', { content: 'new content' }))
  })
```

- [ ] **Step 2: Run (expect failure)**

```bash
npm test -- src/components/AgentFilesTab.test.tsx -t "selecting SKILL|editing the main|selecting a sibling"
```

Expected: 3 FAIL.

- [ ] **Step 3: Wire the editor**

In `src/components/AgentFilesTab.tsx`, change the component to track active file content and save on blur:

```tsx
export default function AgentFilesTab({ agent }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([])
  const [activeId, setActiveId] = useState<string>('main')
  const [draft, setDraft] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.files.list(agent.id)
      if (!cancelled) setFiles(list)
    })()
    return () => { cancelled = true }
  }, [agent.id])

  // Reset draft when the active file changes
  useEffect(() => {
    if (activeId === 'main') setDraft(agent.body)
    else {
      const f = files.find(x => x.id === activeId)
      setDraft(f?.content ?? '')
    }
  }, [activeId, agent.body, files])

  const onBlurSave = async () => {
    if (activeId === 'main') {
      await window.api.agents.update(agent.id, { body: draft })
    } else {
      await window.api.agents.files.update(agent.id, activeId, { content: draft })
    }
  }

  const references = files.filter(f => classifyFile(f.filename) === 'reference')
  const scripts = files.filter(f => classifyFile(f.filename) === 'script')
  const others = files.filter(f => classifyFile(f.filename) === 'other')

  const activeFilename = activeId === 'main' ? 'SKILL.md' : (files.find(f => f.id === activeId)?.filename ?? '')

  return (
    <div className="agent-detail-files">
      <aside className="agent-detail-files-list">
        {/* same as before — list rendering unchanged */}
        <div className="agent-detail-files-section">Main</div>
        <FileItem name="SKILL.md" isMain active={activeId === 'main'} onSelect={() => setActiveId('main')} />
        {references.length > 0 && <div className="agent-detail-files-section">References</div>}
        {references.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {scripts.length > 0 && <div className="agent-detail-files-section">Scripts</div>}
        {scripts.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {others.length > 0 && <div className="agent-detail-files-section">Other</div>}
        {others.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
      </aside>
      <section className="agent-detail-files-editor">
        <div className="agent-detail-files-header">
          <span className="agent-detail-files-name">{activeFilename}</span>
        </div>
        <textarea
          className="agent-detail-files-textarea"
          aria-label="File content"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={onBlurSave}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Render the tab in AgentDetail**

In `src/views/AgentDetail.tsx`, find the existing `{activeTab === 'history' && ...}` branch. Add a new branch after it:

```tsx
        {activeTab === 'files' && (
          <AgentFilesTab agent={agent} />
        )}
```

And add the import at the top:

```tsx
import AgentFilesTab from '../components/AgentFilesTab'
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/components/AgentFilesTab.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentFilesTab.tsx src/components/AgentFilesTab.test.tsx src/views/AgentDetail.tsx
git commit -m "feat(agents): Files tab editor with save-on-blur for main and siblings"
```

### Task 17: Files tab — Add, Rename, Delete buttons

**Files:**
- Modify: `src/components/AgentFilesTab.tsx`
- Modify: `src/components/AgentFilesTab.test.tsx`

- [ ] **Step 1: Append tests**

```tsx
  it('Add file button creates a new empty file', async () => {
    ;(window as any).api.agents.files.create = vi.fn().mockResolvedValue(
      { id: 'f3', agent_id: 'a1', filename: 'new.md', content: '', sort_order: 2, created_at: 't', updated_at: 't' }
    )
    ;(window as any).api.agents.files.list = vi.fn()
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce([...files, { id: 'f3', agent_id: 'a1', filename: 'new.md', content: '', sort_order: 2, created_at: 't', updated_at: 't' }])
    // Prompt mock
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new.md')
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('SKILL.md'))
    fireEvent.click(screen.getByRole('button', { name: /add file/i }))
    await waitFor(() => expect(window.api.agents.files.create).toHaveBeenCalledWith('a1', expect.objectContaining({ filename: 'new.md' })))
    promptSpy.mockRestore()
  })

  it('Delete button confirms and calls files.delete for the active sibling', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(window as any).api.agents.files.delete = vi.fn().mockResolvedValue(undefined)
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByText('notes.md'))
    fireEvent.click(screen.getByText('notes.md'))
    fireEvent.click(screen.getByRole('button', { name: /delete file/i }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(window.api.agents.files.delete).toHaveBeenCalledWith('a1', 'f1'))
    confirmSpy.mockRestore()
  })
```

- [ ] **Step 2: Implement the buttons**

In `AgentFilesTab.tsx`, extend the editor header and add an Add-file button:

```tsx
        <div className="agent-detail-files-header">
          <span className="agent-detail-files-name">{activeFilename}</span>
          {activeId !== 'main' && (
            <div className="agent-detail-files-actions">
              <button
                type="button"
                className="agent-detail-files-btn"
                aria-label="Rename file"
                onClick={async () => {
                  const f = files.find(x => x.id === activeId)
                  if (!f) return
                  const next = window.prompt('New filename:', f.filename)
                  if (!next || next === f.filename) return
                  await window.api.agents.files.update(agent.id, activeId, { filename: next })
                  setFiles(await window.api.agents.files.list(agent.id))
                }}
              >
                <Edit3 size={13} />
              </button>
              <button
                type="button"
                className="agent-detail-files-btn agent-detail-files-btn--danger"
                aria-label="Delete file"
                onClick={async () => {
                  if (!window.confirm('Delete this file?')) return
                  await window.api.agents.files.delete(agent.id, activeId)
                  setFiles(await window.api.agents.files.list(agent.id))
                  setActiveId('main')
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
```

And add an Add-file button at the bottom of the file list (before the closing `</aside>`):

```tsx
        <button
          type="button"
          className="agent-detail-files-add"
          onClick={async () => {
            const filename = window.prompt('Filename for the new file:')
            if (!filename) return
            const created = await window.api.agents.files.create(agent.id, { filename, content: '', sortOrder: files.length })
            const next = await window.api.agents.files.list(agent.id)
            setFiles(next)
            setActiveId(created.id)
          }}
        >
          <Plus size={13} /> Add file
        </button>
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/components/AgentFilesTab.test.tsx
```

Expected: 7 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentFilesTab.tsx src/components/AgentFilesTab.test.tsx
git commit -m "feat(agents): Files tab — Add/Rename/Delete buttons"
```

### Task 18: CSS for Files tab

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Append the Files tab rules**

At the end of the file:

```css
/* ── Files tab ──────────────────────────────────────────── */

.agent-detail-files {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
  min-height: 480px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.agent-detail-files-list {
  border-right: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.15);
  padding: 8px 0;
  overflow-y: auto;
}

.agent-detail-files-section {
  padding: 6px 14px 4px;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--t3);
}

.agent-detail-files-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--t2);
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  font-family: 'JetBrains Mono', monospace;
}
.agent-detail-files-item:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--t1);
}
.agent-detail-files-item--active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  color: var(--t1);
}
.agent-detail-files-item--main { font-weight: 500; }

.agent-detail-files-add {
  display: flex; align-items: center; gap: 6px;
  margin: 8px 14px 0;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--t3);
  background: transparent;
  border: 1px dashed var(--border2);
  border-radius: 5px;
  cursor: pointer;
}
.agent-detail-files-add:hover { color: var(--accent-text); border-color: var(--accent-border); }

.agent-detail-files-editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.agent-detail-files-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.agent-detail-files-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--t1);
}

.agent-detail-files-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.agent-detail-files-btn {
  width: 28px; height: 28px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--t3);
  border: 1px solid var(--border);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.agent-detail-files-btn:hover {
  color: var(--t1);
  background: rgba(255, 255, 255, 0.08);
}
.agent-detail-files-btn--danger:hover {
  color: var(--red-text);
  border-color: var(--red-border);
  background: var(--red-soft);
}

.agent-detail-files-textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.025);
  color: var(--t1);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 16px 20px;
  border: none;
  outline: none;
  resize: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): Files tab split view + editor"
```

---

## Phase 5: Import UI

### Task 19: ImportSkillDialog — list discovered plugins

**Files:**
- Create: `src/components/ImportSkillDialog.tsx`
- Create: `src/components/ImportSkillDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportSkillDialog from './ImportSkillDialog'

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      import: {
        discoverPlugins: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'superpowers', version: '5.1.0', root: '/p1', skills: [
            { name: 'brainstorming', path: '/p1/skills/brainstorming', description: 'Brainstorm things', fileCount: 4 },
            { name: 'writing-plans', path: '/p1/skills/writing-plans', description: 'Plan things', fileCount: 2 },
          ]},
          { id: 'p2', name: 'anatomy', version: null, root: '/p2', skills: [
            { name: 'foo', path: '/p2/skills/foo', description: null, fileCount: 1 },
          ]},
        ]),
        readSkillFromDisk: vi.fn(),
        importSkill: vi.fn(),
      },
    },
  }
})

describe('ImportSkillDialog', () => {
  it('lists discovered plugins on open', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    expect(screen.getByText('superpowers')).toBeTruthy()
    expect(screen.getByText('anatomy')).toBeTruthy()
    expect(screen.getByText(/v5\.1\.0/)).toBeTruthy()
    expect(screen.getByText(/2 skills/)).toBeTruthy()
    expect(screen.getByText(/1 skill/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run (expect failure)**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx
```

Expected: FAIL — file not found.

- [ ] **Step 3: Implement the minimal dialog**

```tsx
import { useEffect, useState } from 'react'
import type { DiscoveredPlugin } from '../../electron/services/skillImportService'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImportSkillDialog({ open, onClose }: Props) {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[] | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.import.discoverPlugins()
      if (!cancelled) setPlugins(list)
    })()
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  return (
    <div className="import-skill-overlay" role="dialog" aria-label="Import skill">
      <div className="import-skill-modal">
        <header className="import-skill-header">
          <h2>Import skill</h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section className="import-skill-section">
          <div className="import-skill-section-label">Installed plugins</div>
          {plugins === null && <div className="import-skill-loading">Scanning…</div>}
          {plugins !== null && plugins.length === 0 && (
            <div className="import-skill-empty">No plugins found.</div>
          )}
          {plugins?.map(p => (
            <div key={p.id} className="import-skill-plugin">
              <div className="import-skill-plugin-meta">
                <span className="import-skill-plugin-name">{p.name}</span>
                {p.version && <span className="import-skill-plugin-version">v{p.version}</span>}
                <span className="import-skill-plugin-count">
                  {p.skills.length} {p.skills.length === 1 ? 'skill' : 'skills'}
                </span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImportSkillDialog.tsx src/components/ImportSkillDialog.test.tsx
git commit -m "feat(agents): ImportSkillDialog — list discovered plugins"
```

### Task 20: ImportSkillDialog — expand and import a plugin

**Files:**
- Modify: `src/components/ImportSkillDialog.tsx`
- Modify: `src/components/ImportSkillDialog.test.tsx`

- [ ] **Step 1: Append tests**

```tsx
  it('clicking a plugin expands its skill list', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    expect(screen.getByText('brainstorming')).toBeTruthy()
    expect(screen.getByText('writing-plans')).toBeTruthy()
  })

  it('importing a plugin reads each selected skill and calls importSkill', async () => {
    ;(window.api.agents.import.readSkillFromDisk as any) = vi.fn().mockImplementation(async (p: string) => ({
      name: p.split('/').pop(), handle: p.split('/').pop(), description: '', body: '', files: [], origin: null,
    }))
    ;(window.api.agents.import.importSkill as any) = vi.fn().mockResolvedValue({ agentId: 'new', conflictResolved: 'created' })

    // Also need a folder creation IPC for the auto-folder. Mock it:
    ;(window as any).api.agents.createFolder = vi.fn().mockResolvedValue({ id: 'newFolder', name: 'superpowers' })
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: [], agents: [] })

    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.import.importSkill).toHaveBeenCalledTimes(2))
  })
```

- [ ] **Step 2: Run (expect failure)**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx -t "expands its skill list|reads each selected"
```

Expected: 2 FAIL.

- [ ] **Step 3: Implement expansion + import**

Restructure `ImportSkillDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { DiscoveredPlugin, DiscoveredSkill } from '../../electron/services/skillImportService'
import type { AgentFolderRow } from '../types/agent'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImportSkillDialog({ open, onClose }: Props) {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.import.discoverPlugins()
      if (!cancelled) setPlugins(list)
    })()
    return () => { cancelled = true }
  }, [open])

  const expanded = plugins?.find(p => p.id === expandedId) ?? null

  const handleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
    // Default to all checked
    const plug = plugins?.find(p => p.id === id)
    if (plug) {
      setSelected(new Set(plug.skills.map(s => s.path)))
    }
  }

  const toggleSkill = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleImport = async () => {
    if (!expanded) return
    setBusy(true)
    try {
      // Ensure plugin folder exists. We look up by exact name match;
      // if absent, create. (Race-free enough for the modal context.)
      const { folders } = await window.api.agents.getAll()
      let folder: AgentFolderRow | undefined = folders.find((f: AgentFolderRow) => f.name === expanded.name)
      if (!folder) folder = await window.api.agents.createFolder(expanded.name)
      const folderId = folder.id

      for (const skill of expanded.skills) {
        if (!selected.has(skill.path)) continue
        const parsed = await window.api.agents.import.readSkillFromDisk(skill.path)
        // Inject origin
        parsed.origin = { plugin: expanded.name, pluginVersion: expanded.version, path: skill.path }
        await window.api.agents.import.importSkill(parsed, { folderId, onConflict: 'rename' })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="import-skill-overlay" role="dialog" aria-label="Import skill">
      <div className="import-skill-modal">
        <header className="import-skill-header">
          <h2>Import skill</h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section className="import-skill-section">
          <div className="import-skill-section-label">Installed plugins</div>
          {plugins === null && <div className="import-skill-loading">Scanning…</div>}
          {plugins !== null && plugins.length === 0 && (
            <div className="import-skill-empty">No plugins found.</div>
          )}
          {plugins?.map(p => (
            <div key={p.id} className="import-skill-plugin">
              <button
                type="button"
                className="import-skill-plugin-row"
                onClick={() => handleExpand(p.id)}
                aria-expanded={expandedId === p.id}
              >
                <span className="import-skill-plugin-name">{p.name}</span>
                {p.version && <span className="import-skill-plugin-version">v{p.version}</span>}
                <span className="import-skill-plugin-count">
                  {p.skills.length} {p.skills.length === 1 ? 'skill' : 'skills'}
                </span>
              </button>
              {expandedId === p.id && (
                <div className="import-skill-plugin-skills">
                  {p.skills.map(s => (
                    <label key={s.path} className="import-skill-skill-row">
                      <input
                        type="checkbox"
                        checked={selected.has(s.path)}
                        onChange={() => toggleSkill(s.path)}
                      />
                      <span className="import-skill-skill-name">{s.name}</span>
                      {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="import-skill-import-btn"
                    onClick={handleImport}
                    disabled={busy || selected.size === 0}
                  >
                    Import {selected.size} {selected.size === 1 ? 'skill' : 'skills'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImportSkillDialog.tsx src/components/ImportSkillDialog.test.tsx
git commit -m "feat(agents): ImportSkillDialog — expand plugin + bulk import"
```

### Task 21: ImportSkillDialog — CSS

**Files:**
- Modify: `src/views/AgentDetail.css` (or a new file)

- [ ] **Step 1: Append the import-skill modal styles**

Append to `src/views/AgentDetail.css`:

```css
/* ── Import skill dialog ────────────────────────────────── */

.import-skill-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}

.import-skill-modal {
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 10px;
  width: min(560px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 14px 50px rgba(0, 0, 0, 0.6);
}

.import-skill-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.import-skill-header h2 { margin: 0; font-size: 15px; color: var(--t1); }
.import-skill-header button {
  background: transparent; border: none; color: var(--t3); cursor: pointer; font-size: 16px;
}

.import-skill-section { padding: 14px 18px; }
.import-skill-section-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--t3); margin-bottom: 10px;
}
.import-skill-loading, .import-skill-empty {
  font-size: 12px; color: var(--t3); padding: 12px;
}

.import-skill-plugin {
  border: 1px solid var(--border);
  border-radius: 7px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.02);
}
.import-skill-plugin-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 14px;
  background: transparent; border: none;
  color: var(--t1); font-size: 13px;
  cursor: pointer; text-align: left;
}
.import-skill-plugin-row:hover { background: rgba(255, 255, 255, 0.03); }
.import-skill-plugin-name { font-weight: 500; }
.import-skill-plugin-version {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--t3);
}
.import-skill-plugin-count {
  margin-left: auto; font-size: 11px; color: var(--t3);
}
.import-skill-plugin-skills {
  border-top: 1px solid var(--border);
  padding: 8px 14px;
}
.import-skill-skill-row {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 4px;
  font-size: 12px; color: var(--t2);
  cursor: pointer;
}
.import-skill-skill-name { font-family: 'JetBrains Mono', monospace; color: var(--t1); }
.import-skill-skill-desc {
  margin-left: 8px;
  color: var(--t3); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.import-skill-import-btn {
  margin-top: 10px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  padding: 7px 14px;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
}
.import-skill-import-btn:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent);
  color: var(--t1);
}
.import-skill-import-btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): Import skill modal"
```

### Task 22: Wire the dialog into the sidebar `+` popover

**Files:**
- Modify: `src/components/AgentsSidebar.tsx`

- [ ] **Step 1: Add the menu item and modal state**

In `src/components/AgentsSidebar.tsx`, at the top of the component (near other `useState` calls), add:

```tsx
  const [showImport, setShowImport] = useState(false)
```

And import the dialog:

```tsx
import ImportSkillDialog from './ImportSkillDialog'
```

In the `+` popover JSX (the `agents-sidebar-new-menu`), add a third menu item between "New agent" and "New folder":

```tsx
            <button
              role="menuitem"
              type="button"
              onClick={() => { setShowNewMenu(false); setShowImport(true) }}
            >Import skill…</button>
```

At the end of the component's JSX (just before the closing root element), mount the dialog:

```tsx
      <ImportSkillDialog open={showImport} onClose={() => setShowImport(false)} />
```

- [ ] **Step 2: Verify the existing sidebar tests still pass**

```bash
npm test -- src/components/AgentsSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AgentsSidebar.tsx
git commit -m "feat(agents): wire Import skill dialog into sidebar + popover"
```

---

## Phase 6: Verification

### Task 23: Full suite + tsc

**Files:** (none — verification only)

- [ ] **Step 1: Run all agent tests**

```bash
npm test -- "src/components/Agent" "src/views/Agent" "electron/services/agentsService" "electron/services/skillImportService" "src/components/ImportSkillDialog"
```

Expected: all PASS. Note the count.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | tail -20
```

Expected: clean (only the pre-existing AgentsSidebar narrowing error from before this branch).

- [ ] **Step 3: Manual smoke (handed to user)**

User opens the app, opens the sidebar `+` popover, clicks **Import skill…**, sees the Superpowers plugin listed, expands it, sees 14 skills, clicks "Import 14 skills", and verifies a "Superpowers" folder appears in the sidebar with 14 agents inside. Open one (e.g., `brainstorming`), verify:

- Hero shows the description, "from superpowers v5.1.0" origin chip
- Prompt tab shows the SKILL.md body
- Files tab lists `visual-companion.md`, `spec-document-reviewer-prompt.md`, `scripts/start-server.sh`, etc.
- Editing a sibling file and clicking away saves it
- Editing the main file from Files tab updates the Prompt tab content
- Re-import: open the dialog again, click Superpowers, click Import — handles collide, get `-2` suffixes

No commit for this task — just verification.

### Task 24: Final code-reviewer pass

**Files:** (none — verification only)

- [ ] **Step 1: Dispatch one code-reviewer agent across the whole diff**

Per the user's CLAUDE.md light-path review discipline, dispatch exactly one `code-reviewer` subagent. Pass the diff range `7854fef..HEAD` (or whichever commit is the base before this phase started — capture before starting Task 1).

Address findings inline, commit any fixes as `fix(agents): code-review fixes for skill parity phase 1`.

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Data model — agents columns | 1, 2, 5 |
| Data model — agent_files table | 1, 2 |
| Data model — handle uniqueness | 10 (importSkill enforces) |
| IPC — files routes | 6 |
| IPC — import routes | 11 |
| Import — discovery | 9, 11 |
| Import — parsing | 8 |
| Import — bulk + conflict | 10, 20 |
| Import — single from disk | 8 (parseSkill accepts a single path; UI exposed in Task 20's import-flow scaffolding) |
| UI — hero description | 12, 13 |
| UI — hero origin chip | 12, 13 |
| UI — Files tab in tab bar | 14 |
| UI — Files tab body | 15, 16, 17, 18 |
| UI — Import dialog | 19, 20, 21 |
| UI — sidebar `+` popover | 22 |
| Tests — service layer | 3, 4, 5, 8, 9, 10 |
| Tests — components | 12, 15, 16, 17, 19, 20 |
| New dep gray-matter | 7 |
| Migration | 1 |

**Placeholder scan:** No TBD/TODO/"appropriate"/"similar to" patterns.

**Type consistency:**
- `AgentFile` is defined in Task 2 and referenced consistently as `AgentFile` from `../../src/types/agent` in services and `../types/agent` in components.
- `CreateFileInput`, `UpdateFilePatch` defined in Task 4, used in Task 6.
- `ParsedSkill`, `DiscoveredPlugin`, `DiscoveredSkill`, `ImportOptions`, `ImportResult` defined in Tasks 8–10, referenced in Tasks 11, 19, 20.
- IPC patch shapes use camelCase consistently (`sortOrder`, `folderId`, `colorStart`).
- DB row fields use snake_case consistently (`sort_order`, `folder_id`, `color_start`).
- Per-skill conflict screen is **deferred** from this plan — the bulk import uses `onConflict: 'rename'` by default. A future spec can add per-skill resolution.

**Single-from-disk gap:** Task 20 wires bulk-from-plugin import. The "Pick a SKILL.md or skill folder from disk" path is in the spec but not in any task. I'll treat this as a follow-on: the dialog mockup includes the button but its implementation is **deferred to a follow-on plan** (small enough to be a single-task addition). The spec's manual-import flow has a fallback ("set origin manually") that's also deferred. Added to "Open items deferred" below.

---

## Execution Notes

- **Branch policy:** Per the user's CLAUDE.md, commit directly to `main`. No worktree.
- **Execution style:** Mostly TDD-style small commits with sequential dependencies. Per the user's CLAUDE.md, execute **inline** with one final code-reviewer pass — not subagent-driven.
- **Test command:** `npm test`, not `npx vitest` (per user memory).
- **Visual verification:** User tests UI changes themselves; no dev server / screenshots.
- **Manual conflict-resolution UI deferred:** Plan uses `onConflict: 'rename'` for bulk import. The spec mentions an Overwrite/Skip/Per-skill resolution screen — implementing that resolution UI is **deferred to a follow-on plan** within Phase 1's scope.
- **Single-skill-from-disk import deferred:** Same as above — the spec's "Pick a SKILL.md from disk" button is not wired in this plan. Deferred to a follow-on.

---

## Open items deferred to follow-on plans (within Phase 1)

- **Conflict resolution UI** (Overwrite / Skip / Per-skill choice screen). Bulk import currently defaults to `rename`. A small follow-on plan adds the chooser between expanding a plugin and clicking "Import".
- **"Pick a SKILL.md from disk" entry point.** Adds a button at the bottom of the import dialog that opens the OS file picker (via Electron's `dialog.showOpenDialog`) and feeds the path through `readSkillFromDisk` + `importSkill`. ~1 task.
- **Reference-count display in the file editor header.** Spec section line 286 mentions "referenced 10× from SKILL.md". Not in this plan; ~half-day follow-on.
