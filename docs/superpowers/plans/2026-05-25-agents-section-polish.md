# Agents section polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the agents section to a Linear/Vercel-minimal look: tighten the sidebar (folder emoji, kebab menu, inline rename, separator under "+ New agent"), redesign the landing page (Variant A — header + pinned + recent carousel, header-only empty state), restructure the New Agent form into three labeled sections, and add the data layer (folder `emoji` column + `updateFolder` service/IPC) needed to support it.

**Architecture:** Adds one DB column (`agent_folders.emoji`) via the existing idempotent `try { db.exec(ALTER TABLE …) } catch {}` pattern. One new unified `updateFolder` service entrypoint replaces ad-hoc folder rename calls; `renameFolder` becomes a thin back-compat wrapper. New `FolderKebabMenu` component replaces the folder branch of `AgentContextMenu` and owns its color/emoji mutations directly via IPC. Sidebar folder rows become `<div role="button">` to legally nest a kebab `<button>`. Landing page collapses the centered onboarding card to header-only.

**Tech Stack:** Electron + React 18 + TypeScript, better-sqlite3, vitest + @testing-library/react (jsdom), lucide-react icons. Run all tests with `npm test` (NOT `npx vitest` — that rebuilds better-sqlite3 against Node's ABI and breaks the Electron launch).

**Spec:** [docs/superpowers/specs/2026-05-25-agents-section-polish-design.md](../specs/2026-05-25-agents-section-polish-design.md)

**Branch policy:** Direct to `main` per global CLAUDE.md. No worktree.

---

## File map

| File | Action | Why |
|---|---|---|
| `electron/db.ts` | modify | ALTER TABLE for `agent_folders.emoji` |
| `electron/services/agentsService.ts` | modify | add `updateFolder`; refactor `renameFolder` to wrapper |
| `electron/services/agentsService.test.ts` | modify | tests for `updateFolder` |
| `electron/db.agents-folder-emoji-migration.test.ts` | create | migration smoke test |
| `electron/ipc/agentHandlers.ts` | modify | add `agents:updateFolder` handler |
| `electron/preload.ts` | modify | expose `updateFolder` to renderer |
| `src/env.d.ts` | modify | declare `updateFolder` on `window.api.agents` |
| `src/types/agent.ts` | modify | add `emoji: string \| null` to `AgentFolderRow` |
| `src/views/AgentDetail.test.tsx` | modify | add `emoji: null` to folder fixture |
| `src/components/CreateAgentPanel.test.tsx` | modify | add `emoji: null` to folder fixture |
| `src/components/AgentsSidebar.test.tsx` | modify | add `emoji: null` to fixtures; new tests for kebab + rename |
| `src/components/AgentsSidebar.tsx` | modify | row layout, emoji avatar, kebab, inline rename, separator |
| `src/components/LibrarySidebar.css` | modify | new `.agents-sidebar-folder-*`, `.agents-sidebar-new-wrap` rules |
| `src/components/FolderKebabMenu.tsx` | create | folder kebab popover (rename / color / emoji / delete) |
| `src/components/FolderKebabMenu.test.tsx` | create | RTL coverage |
| `src/components/FolderKebabMenu.css` | create | styles |
| `src/views/AgentsLanding.tsx` | modify | header w/ right-aligned new btn, recent carousel, header-only empty |
| `src/views/AgentsLanding.test.tsx` | modify | empty state asserts header only, recent carousel asserts cards |
| `src/views/AgentsLanding.css` | modify | header row, recent strip, drop onboarding card |
| `src/components/CreateAgentPanel.tsx` | modify | three labeled sections |
| `src/views/AgentDetail.css` | modify | `.create-agent-section*`, narrower panel |

`src/components/AgentContextMenu.tsx` is left untouched — its agent branch still wires up the agent context menu; the folder branch is simply no longer reached from the sidebar.

---

## Task 1: Schema migration + type + fixtures

**Goal:** Add `agent_folders.emoji` and propagate the type into existing fixtures so the build stays green.

**Files:**
- Modify: `electron/db.ts` (append after the existing `try { db.exec(ALTER TABLE agent_folders …) }` block area)
- Modify: `src/types/agent.ts`
- Modify: `src/views/AgentDetail.test.tsx:9`
- Modify: `src/components/CreateAgentPanel.test.tsx:9`
- Modify: `src/components/AgentsSidebar.test.tsx:9-10`
- Create: `electron/db.agents-folder-emoji-migration.test.ts`

- [ ] **Step 1.1: Write the failing migration test**

Create `electron/db.agents-folder-emoji-migration.test.ts`:

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

describe('agent_folders.emoji — migration', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('agent_folders has an emoji column after initSchema', () => {
    const cols = db.prepare(`PRAGMA table_info(agent_folders)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('emoji')
  })

  it('emoji defaults to NULL on insert when not specified', () => {
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES (?, ?, ?)`)
      .run('f1', 'Writing', '2026-05-25T00:00:00Z')
    const row = db.prepare(`SELECT emoji FROM agent_folders WHERE id='f1'`).get() as { emoji: string | null }
    expect(row.emoji).toBeNull()
  })

  it('emoji round-trips when written', () => {
    db.prepare(`INSERT INTO agent_folders (id, name, created_at) VALUES (?, ?, ?)`)
      .run('f1', 'Writing', '2026-05-25T00:00:00Z')
    db.prepare(`UPDATE agent_folders SET emoji = ? WHERE id = 'f1'`).run('📝')
    const row = db.prepare(`SELECT emoji FROM agent_folders WHERE id='f1'`).get() as { emoji: string }
    expect(row.emoji).toBe('📝')
  })

  it('initSchema is idempotent (running twice does not throw)', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})
```

- [ ] **Step 1.2: Run the test to verify it fails**

```
npm test -- electron/db.agents-folder-emoji-migration.test.ts
```

Expected: first two `it`s FAIL with "no such column: emoji" or empty `names`. Third FAIL on UPDATE.

- [ ] **Step 1.3: Add the migration in `electron/db.ts`**

Find the existing agents-redesign migration block (`try { db.exec(ALTER TABLE agents ADD COLUMN handle …`)`. Append a new block immediately after it, before the `agent_revisions` CREATE TABLE:

```ts
  // Agents polish — folder emoji
  try { db.exec(`ALTER TABLE agent_folders ADD COLUMN emoji TEXT`) } catch {}
```

- [ ] **Step 1.4: Run the migration test again**

```
npm test -- electron/db.agents-folder-emoji-migration.test.ts
```

Expected: all four pass.

- [ ] **Step 1.5: Add `emoji` to the `AgentFolderRow` type**

In `src/types/agent.ts`, replace the existing `AgentFolderRow` with:

```ts
export interface AgentFolderRow {
  id: string
  name: string
  color_start: string | null
  color_end:   string | null
  description: string | null
  emoji:       string | null
  created_at:  string
}
```

- [ ] **Step 1.6: Run the whole test suite to surface fixture failures**

```
npm test
```

Expected: TS compile errors in `AgentDetail.test.tsx`, `CreateAgentPanel.test.tsx`, `AgentsSidebar.test.tsx` — "Property 'emoji' is missing in type …".

- [ ] **Step 1.7: Update folder fixtures**

In `src/views/AgentDetail.test.tsx:9`, change:
```ts
{ id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
```
to:
```ts
{ id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
```

In `src/components/CreateAgentPanel.test.tsx:9`, change:
```ts
{ id: 'f1', name: 'Engineering', color_start: null, color_end: null, description: null, created_at: 't' },
```
to:
```ts
{ id: 'f1', name: 'Engineering', color_start: null, color_end: null, description: null, emoji: null, created_at: 't' },
```

In `src/components/AgentsSidebar.test.tsx:9-10`, change:
```ts
{ id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
{ id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, created_at: '2026-05-23T00:00:00Z' },
```
to:
```ts
{ id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
{ id: 'f2', name: 'Research', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
```

- [ ] **Step 1.8: Run the whole suite**

```
npm test
```

Expected: all tests pass (existing + the new migration tests).

- [ ] **Step 1.9: Commit**

```
git add electron/db.ts electron/db.agents-folder-emoji-migration.test.ts src/types/agent.ts src/views/AgentDetail.test.tsx src/components/CreateAgentPanel.test.tsx src/components/AgentsSidebar.test.tsx
git commit -m "feat(agents): add agent_folders.emoji column + migration test"
```

---

## Task 2: `updateFolder` service (TDD)

**Goal:** Add a unified `updateFolder(db, id, patch)` that can mutate name / colorStart / colorEnd / emoji. Refactor `renameFolder` to delegate.

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

- [ ] **Step 2.1: Write failing tests**

Append the following describe block to `electron/services/agentsService.test.ts`, after the existing `describe('agentsService — folders', …)` block. Also add `updateFolder` to the existing imports at the top of the file.

Top of file, extend imports:
```ts
import {
  createAgent, updateAgent, deleteAgent, duplicateAgent, getAllAgents,
  createFolder, renameFolder, deleteFolder, updateFolder,
  AGENT_NAME_MAX, AGENT_BODY_MAX,
} from './agentsService'
```

Append the describe block (place it just after the existing `describe('agentsService — folders', …)` closes):

```ts
describe('agentsService — updateFolder', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('updates the folder name and returns the row', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { name: 'Research' })
    expect(updated.name).toBe('Research')
    expect(updated.id).toBe(f.id)
  })

  it('normalises a whitespace name to "Untitled folder"', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { name: '   ' })
    expect(updated.name).toBe('Untitled folder')
  })

  it('rejects names exceeding AGENT_NAME_MAX', () => {
    const f = createFolder(db, 'Writing')
    expect(() => updateFolder(db, f.id, { name: 'x'.repeat(AGENT_NAME_MAX + 1) }))
      .toThrow(/name.*length/i)
  })

  it('sets colorStart to a hex value', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, { colorStart: '#22c55e' })
    expect(updated.color_start).toBe('#22c55e')
  })

  it('clears colorStart when null is passed', () => {
    const f = createFolder(db, 'Writing')
    updateFolder(db, f.id, { colorStart: '#22c55e' })
    const cleared = updateFolder(db, f.id, { colorStart: null })
    expect(cleared.color_start).toBeNull()
  })

  it('rejects invalid hex for colorStart', () => {
    const f = createFolder(db, 'Writing')
    expect(() => updateFolder(db, f.id, { colorStart: 'red' }))
      .toThrow(/hex/i)
  })

  it('sets and clears emoji', () => {
    const f = createFolder(db, 'Writing')
    const set = updateFolder(db, f.id, { emoji: '📝' })
    expect(set.emoji).toBe('📝')
    const cleared = updateFolder(db, f.id, { emoji: null })
    expect(cleared.emoji).toBeNull()
  })

  it('an empty patch is a no-op that still returns the row', () => {
    const f = createFolder(db, 'Writing')
    const updated = updateFolder(db, f.id, {})
    expect(updated.name).toBe('Writing')
  })

  it('throws on unknown id', () => {
    expect(() => updateFolder(db, 'nope', { name: 'X' })).toThrow(/folder/i)
  })

  it('renameFolder still works after refactor (back-compat)', () => {
    const f = createFolder(db, 'Writing')
    const updated = renameFolder(db, f.id, 'Research')
    expect(updated.name).toBe('Research')
  })
})
```

- [ ] **Step 2.2: Run the new tests to verify they fail**

```
npm test -- electron/services/agentsService.test.ts
```

Expected: all 10 new tests FAIL with "updateFolder is not exported" (TS compile error) or similar.

- [ ] **Step 2.3: Implement `updateFolder` and refactor `renameFolder`**

In `electron/services/agentsService.ts`, locate the existing folders section (around line 60). Replace the existing `renameFolder` function with the new `updateFolder` + a thin wrapper:

```ts
export interface UpdateFolderPatch {
  name?: string
  colorStart?: string | null
  colorEnd?:   string | null
  emoji?:      string | null
}

export function updateFolder(
  db: Database.Database,
  id: string,
  patch: UpdateFolderPatch,
): AgentFolderRow {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.name !== undefined) {
    const name = normaliseFolderName(patch.name)
    assertNameLen(name)
    sets.push('name = ?'); params.push(name)
  }
  if (patch.colorStart !== undefined) {
    if (patch.colorStart !== null) assertValidHex('colorStart', patch.colorStart)
    sets.push('color_start = ?'); params.push(patch.colorStart)
  }
  if (patch.colorEnd !== undefined) {
    if (patch.colorEnd !== null) assertValidHex('colorEnd', patch.colorEnd)
    sets.push('color_end = ?'); params.push(patch.colorEnd)
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?'); params.push(patch.emoji)
  }

  if (sets.length > 0) {
    params.push(id)
    db.prepare(`UPDATE agent_folders SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  const row = db.prepare('SELECT * FROM agent_folders WHERE id = ?').get(id) as AgentFolderRow | undefined
  if (!row) throw new Error(`Unknown folder id: ${id}`)
  return row
}

export function renameFolder(db: Database.Database, id: string, name: string): AgentFolderRow {
  return updateFolder(db, id, { name })
}
```

Note: `assertValidHex`, `normaliseFolderName`, and `assertNameLen` already exist at the top of this file — reuse them.

- [ ] **Step 2.4: Run service tests**

```
npm test -- electron/services/agentsService.test.ts
```

Expected: all tests in the file pass (the 10 new ones + all existing ones).

- [ ] **Step 2.5: Run the whole suite**

```
npm test
```

Expected: all pass.

- [ ] **Step 2.6: Commit**

```
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): add updateFolder service (folder name/color/emoji)"
```

---

## Task 3: IPC handler + Preload + env.d.ts

**Goal:** Wire `updateFolder` from main process to renderer through IPC.

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 3.1: Add the IPC handler**

In `electron/ipc/agentHandlers.ts`, at the top of the file, extend the imports from `'../services/agentsService'`:

```ts
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder, updateFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  recordUse,
  type CreateAgentInput, type UpdateAgentPatch, type UpdateFolderPatch,
} from '../services/agentsService'
```

Inside `registerAgentHandlers()`, immediately after the existing `agents:renameFolder` handler (around line 80), insert:

```ts
  ipcMain.handle('agents:updateFolder', async (_, id: string, patch: UpdateFolderPatch) => {
    const db = getDb(app.getPath('userData'))
    const row = updateFolder(db, id, patch)
    broadcastChanged()
    return row
  })
```

Leave the existing `agents:renameFolder` handler in place (it goes through the wrapper now — same external behavior).

- [ ] **Step 3.2: Expose `updateFolder` in preload**

In `electron/preload.ts`, inside the `agents` block, add immediately after `renameFolder` (around line 200):

```ts
    updateFolder: (id: string, patch: {
      name?: string
      colorStart?: string | null
      colorEnd?:   string | null
      emoji?:      string | null
    }) =>
      ipcRenderer.invoke('agents:updateFolder', id, patch) as Promise<import('../src/types/agent').AgentFolderRow>,
```

- [ ] **Step 3.3: Declare it in `env.d.ts`**

In `src/env.d.ts:213`, immediately after the existing `renameFolder(...)` declaration, insert:

```ts
        updateFolder(id: string, patch: {
          name?: string
          colorStart?: string | null
          colorEnd?:   string | null
          emoji?:      string | null
        }): Promise<import('./types/agent').AgentFolderRow>
```

- [ ] **Step 3.4: Run the whole suite**

```
npm test
```

Expected: all pass (no behavior changed; this just wires the API surface).

- [ ] **Step 3.5: Commit**

```
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(agents): expose updateFolder via IPC and preload"
```

---

## Task 4: `FolderKebabMenu` component (TDD)

**Goal:** New popover component that owns rename trigger, inline color palette, emoji picker, and delete for one folder. Replaces the folder branch of `AgentContextMenu` (the agent branch stays).

**Files:**
- Create: `src/components/FolderKebabMenu.tsx`
- Create: `src/components/FolderKebabMenu.css`
- Create: `src/components/FolderKebabMenu.test.tsx`

- [ ] **Step 4.1: Write failing render tests**

Create `src/components/FolderKebabMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderKebabMenu, { FOLDER_PALETTE } from './FolderKebabMenu'

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      updateFolder: vi.fn().mockResolvedValue({}),
    },
  }
})

function mountMenu(overrides: Partial<React.ComponentProps<typeof FolderKebabMenu>> = {}) {
  const onClose  = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const utils = render(
    <FolderKebabMenu
      x={10} y={10}
      folderId="f1"
      currentColor={null}
      currentEmoji={null}
      onClose={onClose}
      onRename={onRename}
      onDelete={onDelete}
      {...overrides}
    />,
  )
  return { ...utils, onClose, onRename, onDelete }
}

describe('FolderKebabMenu', () => {
  it('renders Rename / Color / Emoji / Delete', () => {
    mountMenu()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /color/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /emoji/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy()
  })

  it('clicking Rename calls onRename with folderId and closes', () => {
    const { onRename, onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    expect(onRename).toHaveBeenCalledWith('f1')
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Color expands an inline swatch row', () => {
    mountMenu()
    expect(screen.queryByTestId('folder-color-swatches')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    expect(screen.getByTestId('folder-color-swatches')).toBeTruthy()
  })

  it('clicking a color swatch calls updateFolder with the right hex and closes', async () => {
    const { onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    const greenSwatch = screen.getByLabelText(/green/i)
    fireEvent.click(greenSwatch)
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { colorStart: FOLDER_PALETTE.find(c => c.name === 'Green')!.hex })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking "None" clears the color', async () => {
    const { onClose } = mountMenu({ currentColor: '#22c55e' })
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    fireEvent.click(screen.getByLabelText(/none/i))
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { colorStart: null })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Delete calls onDelete and closes', () => {
    const { onDelete, onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('f1')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes the menu', () => {
    const { onClose } = mountMenu()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.2: Run the test to verify it fails**

```
npm test -- src/components/FolderKebabMenu.test.tsx
```

Expected: all tests FAIL (file does not exist).

- [ ] **Step 4.3: Create the component**

Create `src/components/FolderKebabMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import AgentEmojiPicker from './AgentEmojiPicker'
import './FolderKebabMenu.css'

export const FOLDER_PALETTE: readonly { name: string; hex: string }[] = [
  { name: 'Slate',  hex: '#64748b' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Amber',  hex: '#f59e0b' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Pink',   hex: '#ec4899' },
]

interface Props {
  x: number
  y: number
  folderId: string
  currentColor: string | null
  currentEmoji: string | null
  onClose:  () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}

export default function FolderKebabMenu({
  x, y, folderId, currentColor, currentEmoji,
  onClose, onRename, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [showColors, setShowColors] = useState(false)
  const [showEmoji,  setShowEmoji]  = useState(false)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown',  key)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown',  key)
    }
  }, [onClose])

  const pickColor = async (hex: string | null) => {
    await window.api.agents.updateFolder(folderId, { colorStart: hex })
    onClose()
  }

  const pickEmoji = async (emoji: string | null) => {
    await window.api.agents.updateFolder(folderId, { emoji })
    setShowEmoji(false)
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed', top: y, left: x, zIndex: 9999,
  }

  return (
    <div ref={ref} role="menu" className="folder-kebab-menu" style={style}>
      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => { onRename(folderId); onClose() }}
      >Rename</button>

      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => setShowColors(v => !v)}
      >
        Color
        {currentColor && (
          <span className="folder-kebab-accessory-dot" style={{ background: currentColor }} />
        )}
      </button>
      {showColors && (
        <div className="folder-kebab-color-row" data-testid="folder-color-swatches">
          {FOLDER_PALETTE.map(c => (
            <button
              key={c.hex}
              type="button"
              className="folder-kebab-swatch"
              aria-label={c.name}
              data-active={currentColor === c.hex ? 'true' : undefined}
              style={{ background: c.hex }}
              onClick={() => pickColor(c.hex)}
            />
          ))}
          <button
            type="button"
            className="folder-kebab-swatch folder-kebab-swatch--none"
            aria-label="None"
            onClick={() => pickColor(null)}
          />
        </div>
      )}

      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => setShowEmoji(v => !v)}
      >
        Emoji
        {currentEmoji && (
          <span className="folder-kebab-accessory-emoji">{currentEmoji}</span>
        )}
      </button>
      {showEmoji && (
        <div className="folder-kebab-emoji-host">
          <AgentEmojiPicker value={currentEmoji} onChange={pickEmoji} />
        </div>
      )}

      <button
        role="menuitem" type="button" className="folder-kebab-item folder-kebab-item--danger"
        onClick={() => { onDelete(folderId); onClose() }}
      >Delete folder</button>
    </div>
  )
}
```

- [ ] **Step 4.4: Create the CSS**

Create `src/components/FolderKebabMenu.css`:

```css
.folder-kebab-menu {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.folder-kebab-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  color: var(--t2);
  font-size: 11px;
  padding: 7px 10px;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
}
.folder-kebab-item:hover { background: rgba(255, 255, 255, 0.06); color: var(--t1); }
.folder-kebab-item--danger:hover { color: var(--red-text); background: var(--red-soft); }

.folder-kebab-accessory-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.folder-kebab-accessory-emoji {
  font-size: 14px;
  line-height: 1;
}

.folder-kebab-color-row {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 4px;
  padding: 4px 8px 8px;
}
.folder-kebab-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border);
  cursor: pointer;
  padding: 0;
}
.folder-kebab-swatch[data-active="true"] {
  box-shadow: 0 0 0 1.5px var(--t1);
}
.folder-kebab-swatch--none {
  background: transparent;
  position: relative;
}
.folder-kebab-swatch--none::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 45%, var(--border2) 45%, var(--border2) 55%, transparent 55%);
}

.folder-kebab-emoji-host {
  padding: 4px 8px 8px;
}
```

- [ ] **Step 4.5: Run the tests**

```
npm test -- src/components/FolderKebabMenu.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 4.6: Commit**

```
git add src/components/FolderKebabMenu.tsx src/components/FolderKebabMenu.css src/components/FolderKebabMenu.test.tsx
git commit -m "feat(agents): add FolderKebabMenu with inline color palette + emoji"
```

---

## Task 5: AgentsSidebar refactor (TDD)

**Goal:** Bigger folder names, default `Folder` icon (or emoji), always-visible kebab, double-click inline rename, separator beneath "+ New agent".

**Files:**
- Modify: `src/components/AgentsSidebar.tsx`
- Modify: `src/components/AgentsSidebar.test.tsx`
- Modify: `src/components/LibrarySidebar.css`

- [ ] **Step 5.1: Extend the test mock**

In `src/components/AgentsSidebar.test.tsx`, extend the `beforeEach` mock to add the new IPC methods we'll call:

```tsx
beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
      createFolder: vi.fn(),
      create: vi.fn().mockImplementation(async (input: any) => ({
        id: 'new-id',
        name: input.name,
        body: input.body,
        folder_id: input.folderId,
        created_at: '2026-05-23T00:00:00Z',
        updated_at: '2026-05-23T00:00:00Z',
      })),
      updateFolder: vi.fn().mockResolvedValue({}),
      renameFolder: vi.fn().mockResolvedValue({}),
      deleteFolder: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn().mockResolvedValue({}),
    },
  }
})
```

- [ ] **Step 5.2: Add failing tests for new behavior**

Append the following `it` blocks inside the existing `describe('AgentsSidebar', …)` block in `src/components/AgentsSidebar.test.tsx`:

```tsx
  it('shows a kebab button next to each named folder (not Unfiled)', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    expect(screen.getByTestId('folder-kebab-f1')).toBeTruthy()
    expect(screen.getByTestId('folder-kebab-f2')).toBeTruthy()
    expect(screen.queryByTestId('folder-kebab-__unfiled__')).toBeNull()
  })

  it('clicking the kebab opens the FolderKebabMenu', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.click(screen.getByTestId('folder-kebab-f1'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
  })

  it('double-clicking a folder name shows an inline rename input', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    const nameSpan = screen.getByTestId('folder-name-f1')
    fireEvent.doubleClick(nameSpan)
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('Writing')
  })

  it('Enter on the rename input calls updateFolder and exits edit mode', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.doubleClick(screen.getByTestId('folder-name-f1'))
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Drafts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { name: 'Drafts' })
    })
    expect(screen.queryByTestId('folder-rename-f1')).toBeNull()
  })

  it('Escape on the rename input cancels without calling updateFolder', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    fireEvent.doubleClick(screen.getByTestId('folder-name-f1'))
    const input = screen.getByTestId('folder-rename-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Drafts' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((window as any).api.agents.updateFolder).not.toHaveBeenCalled()
    expect(screen.queryByTestId('folder-rename-f1')).toBeNull()
  })

  it('renders a default folder icon when emoji is null', async () => {
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    const avatar = screen.getByTestId('folder-avatar-f1')
    // No emoji text content — should contain the default Folder svg
    expect(avatar.querySelector('svg')).toBeTruthy()
  })

  it('renders the emoji when folder.emoji is set', async () => {
    const foldersWithEmoji = [
      { ...folders[0], emoji: '📝' },
      folders[1],
    ]
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: foldersWithEmoji, agents })
    renderSidebar()
    await waitFor(() => screen.getByText(/Writing/))
    expect(screen.getByTestId('folder-avatar-f1').textContent).toContain('📝')
  })
```

- [ ] **Step 5.3: Run the new tests to verify they fail**

```
npm test -- src/components/AgentsSidebar.test.tsx
```

Expected: the new tests FAIL. Existing tests should still PASS (the new ones target additional structure).

- [ ] **Step 5.4: Refactor `AgentsSidebar.tsx`**

Replace `src/components/AgentsSidebar.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { Folder, MoreHorizontal } from 'lucide-react'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import AgentContextMenu, { type AgentMenuKind } from './AgentContextMenu'
import FolderKebabMenu from './FolderKebabMenu'

interface Props {
  searchTerm?: string
}

interface FolderGroup {
  id: string | null   // null = synthetic "Unfiled"
  name: string
  emoji: string | null
  color: string | null
  agents: AgentRow[]
}

export default function AgentsSidebar({ searchTerm = '' }: Props) {
  const navigate = useNavigate()
  const agentMatch = useMatch('/library/agent/:id')
  const selectedId = agentMatch?.params.id ?? null

  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [agents,  setAgents]  = useState<AgentRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; target: AgentMenuKind } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const onAgentRightClick = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'agent', agentId } })
  }

  const onFolderRightClick = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', folderId } })
  }

  const onFolderKebabClick = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
    setMenu({ x: rect.right - 4, y: rect.bottom + 4, target: { kind: 'folder', folderId } })
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

  const startInlineRename = (folderId: string) => {
    const f = folders.find(x => x.id === folderId)
    if (!f) return
    setRenamingId(folderId)
    setRenameDraft(f.name)
  }

  const commitRename = async () => {
    if (renamingId === null) return
    const id = renamingId
    const draft = renameDraft
    setRenamingId(null)
    setRenameDraft('')
    await window.api.agents.updateFolder(id, { name: draft })
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Delete this folder? Agents inside it will move to Unfiled.')) return
    await window.api.agents.deleteFolder(id)
  }

  const handleMoveAgent = async (id: string) => {
    const choice = prompt('Move to folder. Type folder name (blank for Unfiled):', '')
    if (choice === null) return
    if (choice.trim() === '') {
      await window.api.agents.update(id, { folderId: null })
      return
    }
    const f = folders.find(x => x.name.toLowerCase() === choice.trim().toLowerCase())
    if (f) {
      await window.api.agents.update(id, { folderId: f.id })
    } else {
      const created = await window.api.agents.createFolder(choice.trim())
      await window.api.agents.update(id, { folderId: created.id })
    }
  }

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

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

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
    const folderGroups: FolderGroup[] = folders
      .map(f => ({
        id: f.id,
        name: f.name,
        emoji: f.emoji,
        color: f.color_start,
        agents: byFolder.get(f.id) ?? [],
      }))
      .filter(g => q === '' || g.agents.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    const out: FolderGroup[] = []
    if (unfiled.length > 0) {
      out.push({ id: null, name: 'Unfiled', emoji: null, color: null, agents: unfiled })
    }
    return out.concat(folderGroups)
  }, [folders, agents, searchTerm])

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleNewAgent = () => {
    navigate('/library/agent/new')
  }

  const currentMenuFolder = menu?.target.kind === 'folder'
    ? folders.find(f => f.id === menu.target.folderId) ?? null
    : null

  return (
    <>
      <div className="agents-sidebar-new-wrap">
        <button
          type="button"
          className="library-sidebar-seg agents-sidebar-new"
          onClick={handleNewAgent}
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
        const isRenaming = renamingId === g.id
        const headerStyle = g.color ? ({ ['--folder-accent' as any]: g.color } as React.CSSProperties) : undefined
        return (
          <div key={key} className="library-sidebar-section">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              className="agents-sidebar-folder-header"
              data-has-accent={g.color ? 'true' : undefined}
              style={headerStyle}
              onClick={() => { if (!isRenaming) toggle(key) }}
              onKeyDown={(e) => {
                if (isRenaming) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(key)
                }
              }}
              onContextMenu={g.id ? (e) => onFolderRightClick(e, g.id!) : undefined}
            >
              <span className="agents-sidebar-folder-caret">{isOpen ? '▾' : '▸'}</span>
              <span
                className="agents-sidebar-folder-avatar"
                data-testid={g.id ? `folder-avatar-${g.id}` : 'folder-avatar-unfiled'}
              >
                {g.emoji ?? <Folder size={14} strokeWidth={1.8} />}
              </span>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="agents-sidebar-folder-rename-input"
                  data-testid={`folder-rename-${g.id}`}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span
                  className="agents-sidebar-folder-name"
                  data-testid={g.id ? `folder-name-${g.id}` : 'folder-name-unfiled'}
                  onDoubleClick={(e) => {
                    if (!g.id) return
                    e.stopPropagation()
                    startInlineRename(g.id)
                  }}
                >
                  {g.name}
                </span>
              )}
              <span className="agents-sidebar-folder-count">({g.agents.length})</span>
              {g.id && (
                <button
                  type="button"
                  className="agents-sidebar-folder-kebab"
                  data-testid={`folder-kebab-${g.id}`}
                  aria-label="Folder menu"
                  onClick={(e) => onFolderKebabClick(e, g.id!)}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>

            {isOpen && g.agents.map(a => (
              <button
                key={a.id}
                type="button"
                className={`library-sidebar-item installed${selectedId === a.id ? ' selected' : ''}`}
                onClick={() => navigate(`/library/agent/${a.id}`)}
                onContextMenu={(e) => onAgentRightClick(e, a.id)}
                title={`${a.name} @${a.handle}`}
              >
                <span
                  className="library-sidebar-avatar agents-sidebar-swatch"
                  data-testid={`sidebar-swatch-${a.id}`}
                  style={{
                    background: a.color_end
                      ? `linear-gradient(135deg, ${a.color_start ?? '#888'}, ${a.color_end})`
                      : (a.color_start ?? '#888'),
                  }}
                >
                  {a.emoji ?? ''}
                </span>
                <span className="library-sidebar-name">{a.name}</span>
                <span className="agents-sidebar-handle">@{a.handle}</span>
                {a.pinned === 1 && (
                  <span className="agents-sidebar-row-pin" aria-label="Pinned" title="Pinned">★</span>
                )}
              </button>
            ))}
          </div>
        )
      })}

      {menu && menu.target.kind === 'agent' && (
        <AgentContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
          onRenameAgent={handleRenameAgent}
          onMoveAgent={handleMoveAgent}
          onDuplicate={handleDuplicate}
          onDeleteAgent={handleDeleteAgent}
        />
      )}

      {menu && menu.target.kind === 'folder' && currentMenuFolder && (
        <FolderKebabMenu
          x={menu.x}
          y={menu.y}
          folderId={menu.target.folderId}
          currentColor={currentMenuFolder.color_start}
          currentEmoji={currentMenuFolder.emoji}
          onClose={() => setMenu(null)}
          onRename={(id) => startInlineRename(id)}
          onDelete={handleDeleteFolder}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5.5: Add the new sidebar CSS**

In `src/components/LibrarySidebar.css`, append the following block at the end of the file:

```css
/* ── Agents-sidebar: top "+ New agent" wrapper ─────────── */

.agents-sidebar-new-wrap {
  padding: 8px 8px 10px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}
.agents-sidebar-new {
  width: 100%;
}

/* ── Agents-sidebar: folder header row ─────────────────── */

.agents-sidebar-folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  background: transparent;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--t2);
  cursor: pointer;
  text-align: left;
  position: relative;
  user-select: none;
}
.agents-sidebar-folder-header:hover { background: rgba(255, 255, 255, 0.04); }
.agents-sidebar-folder-header:focus-visible { outline: 1px solid var(--accent-border); outline-offset: -1px; }
.agents-sidebar-folder-header[data-has-accent="true"] {
  box-shadow: inset 3px 0 0 var(--folder-accent);
}

.agents-sidebar-folder-caret {
  width: 10px;
  font-size: 9px;
  color: var(--t3);
  flex-shrink: 0;
}

.agents-sidebar-folder-avatar {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--t3);
  flex-shrink: 0;
}

.agents-sidebar-folder-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agents-sidebar-folder-rename-input {
  flex: 1;
  min-width: 0;
  background: var(--bg3);
  border: 1px solid var(--accent-border);
  border-radius: 3px;
  color: var(--t1);
  font-size: 13px;
  font-weight: 500;
  padding: 2px 6px;
  font-family: inherit;
  outline: none;
}

.agents-sidebar-folder-count {
  font-size: 10px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.agents-sidebar-folder-kebab {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--t3);
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
}
.agents-sidebar-folder-kebab:hover { background: rgba(255, 255, 255, 0.08); color: var(--t1); }
```

- [ ] **Step 5.6: Run the tests**

```
npm test -- src/components/AgentsSidebar.test.tsx
```

Expected: all tests PASS — the 7 new ones plus all pre-existing ones.

Note: the existing tests use `screen.getAllByRole('button', { name: /Research|Writing|Unfiled/ })` to find folder headers. Our refactor switches the outer to `<div role="button">`, which `getByRole('button')` still matches. The accessible name comes from the visible text inside (folder name + count), so the regex still hits. If a test asserts a button order that now includes the kebab buttons, restrict the matcher (e.g. `{ name: /Research \(\d+\)/ }`). Apply only if you see a failure — the patterns above were written to coexist with the kebab.

- [ ] **Step 5.7: Run the whole suite**

```
npm test
```

Expected: all pass.

- [ ] **Step 5.8: Commit**

```
git add src/components/AgentsSidebar.tsx src/components/AgentsSidebar.test.tsx src/components/LibrarySidebar.css
git commit -m "feat(agents): sidebar polish — emoji avatar, kebab, inline rename"
```

---

## Task 6: AgentsLanding refactor (TDD)

**Goal:** Variant A landing — header with right-aligned "+ New agent", restyled pinned cards, recent horizontal carousel, header-only empty state.

**Files:**
- Modify: `src/views/AgentsLanding.tsx`
- Modify: `src/views/AgentsLanding.test.tsx`
- Modify: `src/views/AgentsLanding.css`

- [ ] **Step 6.1: Update existing tests to match the new structure**

Replace the body of the first `it` block in `src/views/AgentsLanding.test.tsx` ("renders the onboarding card when there are no pinned or recent agents") — both the name and the assertions need to change. Update the block to:

```tsx
  it('shows only the header (no centered onboarding card) when there are no pinned or recent', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ name: 'Brand new', handle: 'brand-new' })],
    })
    setup()
    await waitFor(() => screen.getByText(/your prompt library/i))
    // Pinned and Recent sections should not render
    expect(screen.queryByText(/^pinned$/i)).toBeNull()
    expect(screen.queryByText(/^recent$/i)).toBeNull()
    // The big centered onboarding card / CTA is gone
    expect(screen.queryByText(/each agent is a reusable system prompt/i)).toBeNull()
    // The header right-aligned "+ New agent" link is still there
    expect(screen.getByRole('link', { name: /\+ New agent/ })).toBeTruthy()
  })
```

In the existing "orders recent agents by last_used_at DESC and caps at 10" test, the selector currently uses `screen.getAllByTestId('agents-landing-recent-row')`. Update it to use the new card testid:

```tsx
    const rows = screen.getAllByTestId('agents-landing-recent-card')
    expect(rows.length).toBeLessThanOrEqual(10)
```

- [ ] **Step 6.2: Add new tests for header link + recent strip**

Append to `src/views/AgentsLanding.test.tsx`, inside the same `describe` block:

```tsx
  it('renders a "+ New agent" link in the header right slot', async () => {
    setup()
    await waitFor(() => screen.getByText(/your prompt library/i))
    const link = screen.getByRole('link', { name: /\+ New agent/ })
    expect(link.getAttribute('href')).toBe('/library/agent/new')
  })

  it('recent items render as horizontal cards (no .agents-landing-recent-row list)', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ name: 'Recent A', handle: 'recent-a', last_used_at: '2026-05-25T10:00:00Z' })],
    })
    setup()
    await waitFor(() => screen.getByText('Recent A'))
    expect(screen.getByTestId('agents-landing-recent-card')).toBeTruthy()
    // Legacy vertical row no longer present
    expect(document.querySelector('.agents-landing-recent-row')).toBeNull()
  })
```

- [ ] **Step 6.3: Run the tests to verify they fail**

```
npm test -- src/views/AgentsLanding.test.tsx
```

Expected: the new tests + the modified first test FAIL. The unchanged tests should still PASS until our refactor breaks them.

- [ ] **Step 6.4: Refactor `AgentsLanding.tsx`**

Replace `src/views/AgentsLanding.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentRow } from '../types/agent'
import './AgentsLanding.css'

const RECENT_CAP = 10
const PINNED_COLS = 3

export default function AgentsLanding() {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const fetchAll = async () => {
    const { agents: list } = await window.api.agents.getAll()
    setAgents(list)
    setLoaded(true)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { agents: list } = await window.api.agents.getAll()
      if (cancelled) return
      setAgents(list)
      setLoaded(true)
    })()
    const cb = () => { fetchAll().catch(() => {}) }
    window.api.agents.onChanged(cb)
    return () => {
      cancelled = true
      window.api.agents.offChanged(cb)
    }
  }, [])

  const pinned = useMemo(
    () => agents
      .filter(a => a.pinned === 1)
      .sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? '')),
    [agents],
  )

  const recent = useMemo(
    () => agents
      .filter(a => a.last_used_at !== null)
      .sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''))
      .slice(0, RECENT_CAP),
    [agents],
  )

  if (!loaded) {
    return <div className="agents-landing-loading">Loading…</div>
  }

  return (
    <div className="agents-landing">
      <header className="agents-landing-header">
        <div className="agents-landing-header-text">
          <div className="agents-landing-eyebrow">AGENTS</div>
          <h1 className="agents-landing-title">Your prompt library</h1>
          <p className="agents-landing-sub">
            {agents.length} agent{agents.length === 1 ? '' : 's'} · Click any in the sidebar, or copy a handle.
          </p>
        </div>
        <Link to="/library/agent/new" className="agents-landing-new-btn">+ New agent</Link>
      </header>

      {pinned.length > 0 && (
        <section className="agents-landing-section">
          <h2>Pinned</h2>
          <div
            className="agents-landing-pinned-grid"
            style={{ gridTemplateColumns: `repeat(${PINNED_COLS}, minmax(0, 1fr))` }}
          >
            {pinned.map(a => (
              <PinnedCard key={a.id} agent={a} />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="agents-landing-section">
          <h2>Recent</h2>
          <div className="agents-landing-recent-strip">
            {recent.map(a => (
              <RecentCard key={a.id} agent={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PinnedCard({ agent }: { agent: AgentRow }) {
  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }
  const snippet = firstLine(agent.body)
  return (
    <Link
      to={`/library/agent/${agent.id}`}
      className="agents-landing-pinned-card"
      data-testid="agents-landing-pinned-card"
    >
      <div className="agents-landing-pinned-swatch" style={swatchStyle}>
        {agent.emoji ?? ''}
      </div>
      <div className="agents-landing-pinned-handle">@{agent.handle}</div>
      <div className="agents-landing-pinned-name">{agent.name}</div>
      <div className="agents-landing-pinned-snippet">{snippet}</div>
    </Link>
  )
}

function RecentCard({ agent }: { agent: AgentRow }) {
  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }
  return (
    <Link
      to={`/library/agent/${agent.id}`}
      className="agents-landing-recent-card"
      data-testid="agents-landing-recent-card"
    >
      <div className="agents-landing-recent-card-swatch" style={swatchStyle}>
        {agent.emoji ?? ''}
      </div>
      <div className="agents-landing-recent-card-handle">@{agent.handle}</div>
      <div className="agents-landing-recent-card-name">{agent.name}</div>
      <span className="agents-landing-recent-card-time">{relativeTime(agent.last_used_at)}</span>
    </Link>
  )
}

function firstLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim()
    if (t.length === 0) continue
    if (t.startsWith('#')) continue
    return t.length > 80 ? t.slice(0, 79) + '…' : t
  }
  return ''
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
```

- [ ] **Step 6.5: Replace `AgentsLanding.css`**

Replace the entire contents of `src/views/AgentsLanding.css` with:

```css
.agents-landing {
  padding: 40px 56px;
  color: var(--t2);
  max-width: 1200px;
  margin: 0 auto;
}
.agents-landing-loading {
  padding: 24px;
  color: var(--t3);
}

/* ── Header ─────────────────────────────────────────── */

.agents-landing-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}
.agents-landing-header-text { min-width: 0; }
.agents-landing-eyebrow {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--accent-text);
  margin-bottom: 6px;
}
.agents-landing-title {
  font-size: 26px;
  color: var(--t1);
  margin: 0 0 6px;
}
.agents-landing-sub {
  font-size: 12px;
  color: var(--t3);
  margin: 0;
}
.agents-landing-new-btn {
  align-self: center;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  padding: 6px 12px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  transition: background 120ms, color 120ms;
  flex-shrink: 0;
}
.agents-landing-new-btn:hover {
  background: var(--accent-hover);
  color: var(--t1);
}

/* ── Sections ───────────────────────────────────────── */

.agents-landing-section { margin-bottom: 32px; }
.agents-landing-section h2 {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--t3);
  margin: 0 0 12px;
}

/* ── Pinned grid ────────────────────────────────────── */

.agents-landing-pinned-grid {
  display: grid;
  gap: 12px;
}
.agents-landing-pinned-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg2);
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms, background 120ms;
}
.agents-landing-pinned-card:hover {
  border-color: var(--accent-border);
  background: var(--bg3);
}
.agents-landing-pinned-swatch {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.agents-landing-pinned-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--accent-text);
}
.agents-landing-pinned-name {
  font-size: 13px;
  color: var(--t1);
  font-weight: 600;
}
.agents-landing-pinned-snippet {
  font-size: 11px;
  color: var(--t3);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ── Recent horizontal strip ────────────────────────── */

.agents-landing-recent-strip {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 2px 10px;
  scroll-snap-type: x mandatory;
}
.agents-landing-recent-strip::-webkit-scrollbar { height: 6px; }
.agents-landing-recent-strip::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

.agents-landing-recent-card {
  flex: 0 0 auto;
  width: 160px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg2);
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms, background 120ms;
  position: relative;
}
.agents-landing-recent-card:hover {
  border-color: var(--accent-border);
  background: var(--bg3);
}
.agents-landing-recent-card-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.agents-landing-recent-card-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--accent-text);
}
.agents-landing-recent-card-name {
  font-size: 12px;
  color: var(--t1);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agents-landing-recent-card-time {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 9px;
  color: var(--t3);
  font-family: 'JetBrains Mono', monospace;
}
```

- [ ] **Step 6.6: Run the landing tests**

```
npm test -- src/views/AgentsLanding.test.tsx
```

Expected: all pass.

- [ ] **Step 6.7: Run the whole suite**

```
npm test
```

Expected: all pass.

- [ ] **Step 6.8: Commit**

```
git add src/views/AgentsLanding.tsx src/views/AgentsLanding.test.tsx src/views/AgentsLanding.css
git commit -m "feat(agents): landing variant A — header right CTA, recent carousel"
```

---

## Task 7: CreateAgentPanel — three labeled sections

**Goal:** Stacked single-column form regrouped as Identity / Appearance / Organize. Narrower panel. Tighter field gaps.

**Files:**
- Modify: `src/components/CreateAgentPanel.tsx`
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 7.1: Restructure `CreateAgentPanel.tsx`**

In `src/components/CreateAgentPanel.tsx`, replace the JSX returned from `CreateAgentPanel` (the `return ( … )` block starting at the existing `<div className="create-agent-panel">`) with:

```tsx
  return (
    <div className="create-agent-panel">
      <header className="create-agent-header">
        <h2>New agent</h2>
      </header>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Identity</div>

        <div className="create-agent-field">
          <label htmlFor="cap-name" className="create-agent-label">Name</label>
          <input
            id="cap-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="create-agent-field">
          <label htmlFor="cap-handle" className="create-agent-label">Handle</label>
          <input
            id="cap-handle"
            type="text"
            value={handle}
            onChange={e => { setHandle(e.target.value); setHandleEdited(true) }}
          />
          <div className="create-agent-hint">
            Auto from name (space → dash, lowercase). Must be unique.
          </div>
        </div>
      </section>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Appearance</div>
        <div className="create-agent-custom">
          <div onMouseDown={() => setColorTouched(true)}>
            <AgentColorPicker
              mode={mode}
              colorStart={colorStart}
              colorEnd={colorEnd}
              harmony={harmony}
              onChange={next => {
                setMode(next.mode)
                setColorStart(next.colorStart)
                setColorEnd(next.colorEnd)
                setHarmony(next.harmony)
              }}
            />
          </div>
          <div className="create-agent-emoji-block">
            <AgentEmojiPicker value={emoji} onChange={setEmoji} />
          </div>
        </div>
      </section>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Organize</div>
        <div className="create-agent-field">
          <label htmlFor="cap-folder" className="create-agent-label">Folder</label>
          <select id="cap-folder" value={folderId ?? ''} onChange={e => setFolderId(e.target.value || null)}>
            <option value="">Unfiled</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </section>

      <div className="create-agent-preview">
        <div
          className="create-agent-preview-swatch"
          style={{
            background: mode === 'gradient' && colorEnd
              ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
              : colorStart,
          }}
        >
          {emoji ?? '🎭'}
        </div>
        <div>
          <div className="create-agent-preview-name">{name || 'New agent'}</div>
          <div className="create-agent-preview-handle">{handle || '@'}</div>
        </div>
      </div>

      <footer className="create-agent-footer">
        <button type="button" onClick={() => navigate('/library')}>Cancel</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="create-agent-submit"
        >
          Create agent
        </button>
      </footer>
    </div>
  )
```

- [ ] **Step 7.2: Update `AgentDetail.css` for the new section styles**

In `src/views/AgentDetail.css`, locate the existing `.create-agent-panel` rule (around line 275) and update it to a narrower max-width:

```css
.create-agent-panel {
  padding: 24px 28px;
  max-width: 640px;
  margin: 0 auto;
  color: var(--t2);
}
```

Then update the existing `.create-agent-field` rule (around line 286):

```css
.create-agent-field { margin-bottom: 10px; }
```

Immediately after the `.create-agent-header h2` rule (around line 285), insert:

```css
.create-agent-section { margin-bottom: 22px; }
.create-agent-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--t3);
  margin: 0 0 10px;
  font-weight: 500;
}
```

- [ ] **Step 7.3: Run the existing CreateAgentPanel tests**

```
npm test -- src/components/CreateAgentPanel.test.tsx
```

Expected: existing tests pass. They assert on field values and submission flow, not on the wrapping section structure.

- [ ] **Step 7.4: Run the whole suite**

```
npm test
```

Expected: all pass.

- [ ] **Step 7.5: Commit**

```
git add src/components/CreateAgentPanel.tsx src/views/AgentDetail.css
git commit -m "feat(agents): new-agent form — three labeled sections, tighter density"
```

---

## Task 8: Final verification

**Goal:** Confirm the implementation matches the spec and nothing regressed.

- [ ] **Step 8.1: Run the entire test suite once more**

```
npm test
```

Expected: all pass.

- [ ] **Step 8.2: Type-check + build**

```
npm run build
```

Expected: completes without TS errors. If the project also has a `typecheck` script, run it.

- [ ] **Step 8.3: Verify the git log shows clean per-task commits**

```
git log --oneline -10
```

Expected: ~7 commits, one per task (Tasks 1-7), each with a `feat(agents):` or similar scoped message.

- [ ] **Step 8.4: Spot-check the spec's done criteria**

Walk through §11 "Done criteria" in `docs/superpowers/specs/2026-05-25-agents-section-polish-design.md`:

- All listed files modified per §10 → confirm via `git diff <last-stable-sha>..HEAD --stat`.
- `npm test` passes → already done in Step 8.1.
- Landing page in zero-agents state: header only → covered by `AgentsLanding.test.tsx` "shows only the header" test.
- Sidebar folder rows: emoji or default Folder icon, bigger names, kebab, inline rename, separator → covered by the `AgentsSidebar.test.tsx` new tests.
- Folder color/emoji round-trip → covered by the `FolderKebabMenu.test.tsx` swatch click test + the `agentsService.test.ts` `updateFolder` tests.
- New-agent form has three labeled sections, narrower max-width → visible in the diff of `CreateAgentPanel.tsx` and `AgentDetail.css`.

If any criterion is unmet, add follow-up steps to fix before declaring done. The user explicitly tests UI changes themselves — do not launch a dev server.

---

## Risks called out in the spec

(See §9 of the design doc for full discussion. Quick-reference here.)

- **220px sidebar width is tight** with caret + avatar + name + count + kebab. If the name truncates too aggressively during implementation, shrink the count to 9px or drop one gap.
- **`<button>` nesting:** the folder row is a clickable `<div role="button" tabIndex={0}>` (not a `<button>`) precisely so the inner kebab `<button>` is legal. Don't switch the outer back to `<button>`.
- **Right-click vs kebab-click coordinates:** right-click uses `e.clientX/Y`; kebab click uses the button's bounding rect. Both feed the same `menu` state — they just compute the anchor differently.
- **Migration idempotence:** the `try/catch` ALTER pattern means running `initSchema` repeatedly on an already-migrated DB is a no-op. Verified by the Task 1 test.
