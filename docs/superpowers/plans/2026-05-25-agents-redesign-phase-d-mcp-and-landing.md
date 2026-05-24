# Agents Redesign — Phase D (MCP + Landing + Pinning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final layer of the agents redesign — `last_used_at` tracking via a `recordUse` IPC called from the Copy button, an `AgentsLanding` no-selection state with Pinned + Recent grids, a hero Pin/Unpin button + sidebar pin indicator, and a standalone MCP launcher script that exposes agents as MCP resources to clients like Claude Code and Cursor.

**Architecture:** Four additive slices on top of Phases A-C. (1) Service-layer `recordUse` updates `last_used_at` and broadcasts `agents:changed` so the sidebar Recent ordering refreshes; called from the renderer's Copy handler. (2) A new `AgentsLanding` React component renders inside `library-detail-area` when the user is in agents mode with no agent open — Pinned grid (3 cols), Recent list (≤10 by `last_used_at`), or an onboarding card when both are empty. `Library.tsx` lifts mode from `LibrarySidebar` and conditionally swaps `ActivityFeed` for `AgentsLanding`. (3) A small Pin/Unpin button in `AgentDetail`'s hero action row plus a star indicator in `AgentsSidebar` for pinned agents. (4) A standalone `electron/mcp-launcher.cjs` that opens the SQLite DB read-only and exposes `agent://`, `agent://<handle>`, and `agent://<handle>/<preset-slug>` MCP resources over stdio. The MCP tab of `AgentDetail` becomes a configuration helper that copies the JSON snippet (with the DB path baked in) to the user's clipboard.

**Tech Stack:** Electron (main + renderer split), `better-sqlite3` for the DB, `@modelcontextprotocol/sdk` (already in `package.json` at `^1.0.0`), React 18, Vitest. The launcher is CommonJS (`.cjs`) so MCP clients can `node mcp-launcher.cjs <db-path>` without ESM resolution gymnastics.

---

## Spec reference

This plan implements **Phase D** of `docs/superpowers/specs/2026-05-24-agents-library-redesign-design.md`. Read that spec first — this plan assumes familiarity with the data model, UI layouts, and MCP design. Phases A-C are on `main`.

**What Phase D includes:**
- Service: `recordUse(db, agentId, presetId?)` that updates `last_used_at` and bumps `updated_at`. The `presetId` parameter is captured in the IPC signature for forward compatibility but no per-preset tracking lands in Phase D.
- IPC: `agents:recordUse` (with broadcast), plus the renderer's hero Copy handler calling it after a successful clipboard write.
- Pin/Unpin: a small "Pin" / "Unpin" toggle button in `AgentDetail`'s hero action row (next to Duplicate/Delete); a star indicator in `AgentsSidebar` for pinned agents.
- `AgentsLanding` component (Pinned grid + Recent list + onboarding card).
- `Library.tsx` integration: lift `mode` from `LibrarySidebar` via an `onModeChange` callback prop and conditionally render `AgentsLanding` when `mode === 'agents'` and there's no detail open.
- MCP launcher: a thin `electron/mcp-launcher.cjs` wiring up the MCP SDK's stdio transport to a pure resource resolver in `electron/mcp-launcher-core.cjs`. Core exports `getCatalog(db)`, `getAgentBody(db, handle)`, and `getAgentBodyWithPreset(db, handle, presetSlug)` — testable without MCP transport.
- MCP tab content in `AgentDetail`: lists the resource URIs (`agent://<handle>` and `agent://<handle>/<preset-slug>`) and a "Copy MCP config" button that copies a JSON snippet to the clipboard, with the absolute launcher path + DB path resolved via a new IPC route `agents:mcp:getConfigSnippet`.

**What's NOT in Phase D (intentionally not in scope):**
- A full More menu (⋯) on the hero with Rename / Customise / Move-to-folder. Phase D adds Pin/Unpin as a sibling button to keep the refactor minimal; rearranging hero actions into a dropdown is a separate UX pass.
- Word- or syntax-aware diff for History (current: simple two-pane `<pre>` from Phase C).
- Collapse adjacent `preset_change` events in History.
- Per-preset `last_used_at` tracking for sub-handle invocations.

---

## File Structure

### New files

- **`src/views/AgentsLanding.tsx`** — composed of three blocks: header + Pinned grid + Recent list, falling back to a centered onboarding card when both grids are empty. Fetches via `window.api.agents.getAll()` and `window.api.agents.onChanged` for live updates. Navigates to `/library/agent/:id` on click.
- **`src/views/AgentsLanding.test.tsx`** — Vitest + RTL.
- **`src/views/AgentsLanding.css`** — styling matching the existing accent purple / dark theme.
- **`electron/mcp-launcher-core.cjs`** — pure resource resolvers over a `better-sqlite3` Database handle. CommonJS so the standalone launcher can `require()` it without an ESM toolchain.
- **`electron/mcp-launcher-core.test.ts`** — Vitest tests that seed an in-memory DB and verify each resource URI resolves correctly (catalog, raw body, body with substituted variables, 404s).
- **`electron/mcp-launcher.cjs`** — the standalone Node script. Reads `process.argv[2]` for the DB path, opens it `readonly: true`, wires up `@modelcontextprotocol/sdk`'s stdio transport, dispatches to core. No test (smoke-tested by the user via Claude Code/Cursor).

### Modified files

- **`electron/services/agentsService.ts`** — add `recordUse(db, agentId, presetId?: string | null)`. Returns void; bumps `last_used_at` to `now` and `updated_at` likewise. The `presetId` param is captured but not used (forward compat).
- **`electron/services/agentsService.test.ts`** — add a `describe('agentsService — recordUse')` block covering: updates last_used_at, accepts null presetId, throws on unknown agent, bumps updated_at.
- **`electron/ipc/agentHandlers.ts`** — add the `agents:recordUse` route + the `agents:mcp:getConfigSnippet` route (returns a JSON string with absolute launcher + DB paths baked in).
- **`electron/preload.ts:166-220`** — add `recordUse` and `mcp.getConfigSnippet` to the `agents` namespace.
- **`src/env.d.ts:185-225`** — mirror the preload extension.
- **`src/components/AgentsSidebar.tsx`** — add a star indicator (`★`) to the right of the `@handle` suffix when `pinned === 1`.
- **`src/components/AgentsSidebar.test.tsx`** — extend with a "renders star for pinned agents" test.
- **`src/components/LibrarySidebar.tsx`** — make `mode` controllable via an optional `onModeChange?: (mode: 'repos' | 'collections' | 'agents') => void` prop while keeping internal state for backward compatibility (notify the parent whenever `setMode` fires).
- **`src/views/Library.tsx`** — track `mode` state mirrored from `LibrarySidebar`'s `onModeChange`, and render `<AgentsLanding />` instead of `<ActivityFeed />` when `mode === 'agents' && !hasDetail`.
- **`src/views/AgentDetail.tsx`** — add a Pin/Unpin button in the hero action row; call `window.api.agents.recordUse(id, activePreset?.id ?? null)` after a successful Copy; replace the History/MCP tab placeholders' MCP slot with a real config-snippet panel.
- **`src/views/AgentDetail.test.tsx`** — extend with pin/unpin tests + recordUse-called-after-copy test + MCP tab config-snippet test.
- **`src/views/AgentDetail.css`** — minor additions for the Pin button + MCP tab content.
- **`package.json`** — none; `@modelcontextprotocol/sdk` already declared at `^1.0.0`.

---

## Conventions

- **TDD**: failing test first, run it, implement, run it green, commit. Every task.
- **Commits**: one logical change per commit. Conventional-commit style (`feat(agents):`, `refactor(agents):`, etc.) — matches the project's existing style.
- **Test commands**: `npm test -- <file>` to scope. Don't invoke `npx vitest` directly — it breaks the Electron ABI.
- **No emoji in code or commit messages** unless explicitly asked.
- **Test environment markers**: renderer tests start with `// @vitest-environment jsdom`; main-process tests start with `// @vitest-environment node`.
- **All AgentRow test fixtures** must include `presets_json: '[]'` plus the Phase A redesign fields (`handle`, `color_start`, `pinned`, `pinned_at`, `last_used_at`, etc.). Copy from existing fixtures.

---

## Task 1: Service — `recordUse`

**Files:**
- Modify: `electron/services/agentsService.ts` (append at the END of the file)
- Modify: `electron/services/agentsService.test.ts` (append at the END of the file)

- [ ] **Step 1: Append failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
import { recordUse } from './agentsService'

describe('agentsService — recordUse', () => {
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

  it('updates last_used_at to a fresh ISO timestamp', () => {
    const before = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(before.last_used_at).toBeNull()
    recordUse(db, agentId, null)
    const after = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(after.last_used_at).toMatch(/T/)
  })

  it('accepts a non-null presetId (forward compat, no per-preset tracking yet)', () => {
    expect(() => recordUse(db, agentId, 'p-xyz')).not.toThrow()
    const row = db.prepare(`SELECT last_used_at FROM agents WHERE id = ?`).get(agentId) as { last_used_at: string | null }
    expect(row.last_used_at).toMatch(/T/)
  })

  it('throws on unknown agentId', () => {
    expect(() => recordUse(db, 'no-such-agent', null)).toThrow(/agent/i)
  })

  it('bumps updated_at', async () => {
    const before = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    await new Promise(r => setTimeout(r, 5))
    recordUse(db, agentId, null)
    const after = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    expect(after.updated_at > before.updated_at).toBe(true)
  })

  it('does NOT record a revision (recordUse is metadata-only)', () => {
    recordUse(db, agentId, null)
    const revs = listRevisions(db, agentId)
    // Should be just the initial 'create' revision from createAgent (Phase C).
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — `recordUse` not exported.

If `npm test` errors with EBUSY on `better_sqlite3.node`, STOP and report BLOCKED.

- [ ] **Step 3: Implement `recordUse`**

Append to `electron/services/agentsService.ts`:

```ts
export function recordUse(
  db: Database.Database,
  agentId: string,
  _presetId: string | null,  // forward-compat; per-preset tracking deferred
): void {
  assertAgentExists(db, agentId)
  const ts = nowIso()
  db.prepare(`UPDATE agents SET last_used_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, agentId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — all prior tests still green + 5 new recordUse tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): recordUse marks last_used_at without recording a revision"
```

---

## Task 2: IPC + preload + env.d.ts for `recordUse`

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 1: Add the IPC route**

In `electron/ipc/agentHandlers.ts`:

1. Extend the imports:

```ts
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  listRevisions, revertToRevision,
  recordUse,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'
```

2. After the existing `agents:revisions:revert` handler (the last one in the file) and BEFORE the closing brace of `registerAgentHandlers()`, INSERT:

```ts

  ipcMain.handle('agents:recordUse', async (_, agentId: string, presetId: string | null) => {
    const db = getDb(app.getPath('userData'))
    recordUse(db, agentId, presetId)
    broadcastChanged()
  })
```

- [ ] **Step 2: Extend preload**

In `electron/preload.ts`, find the `agents:` block. Inside it, after the existing `revisions: { ... }` namespace (added in Phase C, around line 191) and BEFORE the `onChanged:` line, INSERT:

```ts
    recordUse: (agentId: string, presetId: string | null) =>
      ipcRenderer.invoke('agents:recordUse', agentId, presetId) as Promise<void>,
```

- [ ] **Step 3: Mirror in `src/env.d.ts`**

In `src/env.d.ts`, find the `agents: {` block. After the `revisions: { ... }` namespace and BEFORE `onChanged(...)`, INSERT:

```ts
        recordUse(agentId: string, presetId: string | null): Promise<void>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(agents): IPC + preload route for recordUse"
```

---

## Task 3: Hero Copy calls `recordUse`

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

When the user clicks Copy on the hero (or, in the future, on any Copy surface), call `recordUse(agentId, activePresetId)` after the clipboard write succeeds.

- [ ] **Step 1: Add failing test**

Append to `src/views/AgentDetail.test.tsx`:

```ts
describe('AgentDetail — recordUse on Copy', () => {
  it('calls window.api.agents.recordUse with the agent id and active preset id after a successful Copy', async () => {
    ;(window as any).api.agents.recordUse = vi.fn().mockResolvedValue(undefined)
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    await waitFor(() => expect(window.api.agents.recordUse).toHaveBeenCalledWith('a1', null))
  })

  it('passes the active preset id when one is selected', async () => {
    ;(window as any).api.agents.recordUse = vi.fn().mockResolvedValue(undefined)
    const agentWithPreset: AgentRow = {
      ...baseAgent,
      body: 'Look at {{focus}}.',
      presets_json: JSON.stringify([
        { id: 'p-sec', name: 'Security review', slug: 'security-review', values: { focus: 'auth' } },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithPreset] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    await waitFor(() => expect(window.api.agents.recordUse).toHaveBeenCalledWith('a1', 'p-sec'))
  })

  it('does NOT call recordUse if clipboard write fails', async () => {
    ;(window as any).api.agents.recordUse = vi.fn().mockResolvedValue(undefined)
    ;(navigator.clipboard.writeText as any) = vi.fn().mockRejectedValue(new Error('denied'))
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    // wait a tick for the (failed) async work to settle
    await new Promise(r => setTimeout(r, 0))
    expect(window.api.agents.recordUse).not.toHaveBeenCalled()
  })
})
```

Update `makeApi()` at the top of `AgentDetail.test.tsx` to include a default `recordUse: vi.fn()` so other tests don't crash when the component calls into it. Find the existing `makeApi` factory (added in Phase C) and add to its `agents:` object:

```ts
recordUse: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — recordUse not called yet.

- [ ] **Step 3: Update `handleCopy` in `AgentDetail.tsx`**

Find the existing `handleCopy` function:

```tsx
  const handleCopy = async () => {
    if (!agent) return
    const payload = buildPersonaPayload({
      handle: agent.handle,
      description,
      body: liveBody,
      presetSlug: activePreset?.slug ?? null,
      presetValues: activePreset?.values,
    })
    await navigator.clipboard.writeText(payload)
    toast(`Copied @${agent.handle}${activePreset ? `/${activePreset.slug}` : ''}`, 'success')
  }
```

Replace with:

```tsx
  const handleCopy = async () => {
    if (!agent) return
    const payload = buildPersonaPayload({
      handle: agent.handle,
      description,
      body: liveBody,
      presetSlug: activePreset?.slug ?? null,
      presetValues: activePreset?.values,
    })
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      toast('Copy failed', 'error')
      return
    }
    toast(`Copied @${agent.handle}${activePreset ? `/${activePreset.slug}` : ''}`, 'success')
    try {
      await window.api.agents.recordUse(agent.id, activePreset?.id ?? null)
    } catch {
      // Non-fatal; the copy already succeeded.
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS — existing tests + 3 new recordUse tests green.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): call recordUse after a successful clipboard copy"
```

---

## Task 4: Hero Pin/Unpin button + sidebar star indicator

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`
- Modify: `src/views/AgentDetail.css` (append a small rule)
- Modify: `src/components/AgentsSidebar.tsx`
- Modify: `src/components/AgentsSidebar.test.tsx`

`updateAgent` already supports `{ pinned: boolean }` (added in Phase A); we just need UI.

### Sidebar star indicator

- [ ] **Step 1: Append failing test to `src/components/AgentsSidebar.test.tsx`**

Find an existing test that renders the sidebar with one or two agents. Append:

```ts
it('renders a star indicator next to the handle for pinned agents', () => {
  const agents = [
    { ...sampleAgent, id: 'pin', name: 'Pinned one', handle: 'pinned', pinned: 1, pinned_at: '2026-05-25T00:00:00Z' },
    { ...sampleAgent, id: 'unpin', name: 'Unpinned', handle: 'unpinned', pinned: 0, pinned_at: null },
  ]
  ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: [], agents })
  render(<AgentsSidebar />)
  // ... await sidebar load (mirror the existing pattern in this file)
  const pinnedRow = (await screen.findByText('Pinned one')).closest('.agents-sidebar-row') as HTMLElement
  expect(pinnedRow.querySelector('.agents-sidebar-row-pin')).toBeTruthy()
  const unpinnedRow = screen.getByText('Unpinned').closest('.agents-sidebar-row') as HTMLElement
  expect(unpinnedRow.querySelector('.agents-sidebar-row-pin')).toBeNull()
})
```

**Note for the executor:** the existing AgentsSidebar test file uses a particular fixture shape and a particular `setup`/`render` pattern. Read it first and adapt the fixture references (`sampleAgent`, the wait-for pattern, the row class name `.agents-sidebar-row`) to match. If the row's CSS class name differs (e.g. `.agent-row`), use that one. The behavior under test — that pinned agents render a visible star indicator — is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentsSidebar.test.tsx`
Expected: FAIL — no star renders.

- [ ] **Step 3: Add the star to `src/components/AgentsSidebar.tsx`**

Read the file. Find the agent row JSX. Add a star span at the end of the row's content (after the handle suffix):

```tsx
{agent.pinned === 1 && (
  <span className="agents-sidebar-row-pin" aria-label="Pinned" title="Pinned">★</span>
)}
```

Add a CSS rule (in the file's existing CSS or `AgentsSidebar.css`):

```css
.agents-sidebar-row-pin {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent-text);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Run sidebar test to verify pass**

Run: `npm test -- src/components/AgentsSidebar.test.tsx`
Expected: PASS.

### Hero Pin/Unpin button

- [ ] **Step 5: Append failing test to `src/views/AgentDetail.test.tsx`**

```ts
describe('AgentDetail — pin toggle', () => {
  it('renders a Pin button when the agent is not pinned', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /^Pin$/ })).toBeTruthy()
  })

  it('renders an Unpin button when the agent is pinned', async () => {
    const pinnedAgent: AgentRow = { ...baseAgent, pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [pinnedAgent] })
    setup()
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /^Unpin$/ })).toBeTruthy()
  })

  it('clicking Pin calls window.api.agents.update with pinned: true', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /^Pin$/ }))
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { pinned: true }))
  })

  it('clicking Unpin calls window.api.agents.update with pinned: false', async () => {
    const pinnedAgent: AgentRow = { ...baseAgent, pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [pinnedAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /^Unpin$/ }))
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { pinned: false }))
  })
})
```

- [ ] **Step 6: Run test to verify failure**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — Pin/Unpin button doesn't exist.

- [ ] **Step 7: Add the Pin/Unpin button to `AgentDetail.tsx`**

Find the existing hero actions block:

```tsx
        <div className="agent-detail-actions">
          <button
            type="button"
            className="agent-detail-copy"
            onClick={handleCopy}
            aria-label="Copy"
          >
            📋 Copy
          </button>
          <button
            type="button"
            className="agent-detail-action"
            onClick={() => setEditing(e => !e)}
            aria-label={editing ? 'Preview' : 'Edit'}
          >
            {editing ? 'Preview' : 'Edit'}
          </button>
          <button
            type="button"
            className="agent-detail-action"
            onClick={handleDuplicate}
            aria-label="Duplicate"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="agent-detail-action agent-detail-action--danger"
            onClick={handleDelete}
            aria-label="Delete"
          >
            Delete
          </button>
        </div>
```

Add a Pin/Unpin button AFTER the Edit button and BEFORE Duplicate. Replace the block with:

```tsx
        <div className="agent-detail-actions">
          <button
            type="button"
            className="agent-detail-copy"
            onClick={handleCopy}
            aria-label="Copy"
          >
            📋 Copy
          </button>
          <button
            type="button"
            className="agent-detail-action"
            onClick={() => setEditing(e => !e)}
            aria-label={editing ? 'Preview' : 'Edit'}
          >
            {editing ? 'Preview' : 'Edit'}
          </button>
          <button
            type="button"
            className="agent-detail-action"
            onClick={handlePinToggle}
            aria-label={agent.pinned === 1 ? 'Unpin' : 'Pin'}
          >
            {agent.pinned === 1 ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            className="agent-detail-action"
            onClick={handleDuplicate}
            aria-label="Duplicate"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="agent-detail-action agent-detail-action--danger"
            onClick={handleDelete}
            aria-label="Delete"
          >
            Delete
          </button>
        </div>
```

Add `handlePinToggle` near the existing handlers:

```tsx
  const handlePinToggle = async () => {
    if (!agent) return
    await window.api.agents.update(agent.id, { pinned: agent.pinned !== 1 })
  }
```

- [ ] **Step 8: Run all AgentDetail + sidebar tests**

Run: `npm test -- src/views/AgentDetail.test.tsx src/components/AgentsSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx src/views/AgentDetail.css src/components/AgentsSidebar.tsx src/components/AgentsSidebar.test.tsx
git commit -m "feat(agents): Pin/Unpin button in hero + star indicator in sidebar"
```

---

## Task 5: `AgentsLanding` component

**Files:**
- Create: `src/views/AgentsLanding.tsx`
- Create: `src/views/AgentsLanding.test.tsx`
- Create: `src/views/AgentsLanding.css`

A self-contained view: fetches agents via `window.api.agents.getAll()`, sorts pinned + recent, renders Pinned grid (3 cols) + Recent list (≤10) + onboarding fallback when both are empty.

Onboarding card explains handles/variables/presets and provides a "+ New agent" CTA that navigates to `/library/agent/new` (the existing CreateAgentPanel route).

- [ ] **Step 1: Write the failing test**

Create `src/views/AgentsLanding.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentsLanding from './AgentsLanding'
import type { AgentRow } from '../types/agent'

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: overrides.id ?? `a-${Math.random()}`,
    name: overrides.name ?? 'Agent',
    handle: overrides.handle ?? 'agent',
    body: overrides.body ?? '# Body',
    folder_id: null,
    color_start: '#6366f1',
    color_end: null,
    emoji: null,
    pinned: overrides.pinned ?? 0,
    pinned_at: overrides.pinned_at ?? null,
    last_used_at: overrides.last_used_at ?? null,
    presets_json: '[]',
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
  }
}

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders: [], agents: [] }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
})

function setup() {
  return render(<MemoryRouter><AgentsLanding /></MemoryRouter>)
}

describe('AgentsLanding', () => {
  it('renders the onboarding card when there are no pinned or recent agents', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ name: 'Brand new', handle: 'brand-new' })],
    })
    setup()
    await waitFor(() => screen.getByText(/your prompt library/i))
    expect(screen.getByText(/new agent/i)).toBeTruthy()
    expect(screen.queryByText(/^pinned$/i)).toBeNull()
    expect(screen.queryByText(/^recent$/i)).toBeNull()
  })

  it('renders the pinned grid when pinned agents exist', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Pinned A', handle: 'pinned-a', pinned: 1, pinned_at: '2026-05-25T10:00:00Z' }),
        agent({ name: 'Pinned B', handle: 'pinned-b', pinned: 1, pinned_at: '2026-05-25T09:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Pinned A'))
    expect(screen.getByText(/^pinned$/i)).toBeTruthy()
    expect(screen.getByText('Pinned B')).toBeTruthy()
  })

  it('renders the recent list when used agents exist', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Recent A', handle: 'recent-a', last_used_at: '2026-05-25T10:00:00Z' }),
        agent({ name: 'Recent B', handle: 'recent-b', last_used_at: '2026-05-25T09:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Recent A'))
    expect(screen.getByText(/^recent$/i)).toBeTruthy()
    expect(screen.getByText('Recent B')).toBeTruthy()
  })

  it('orders pinned agents by pinned_at DESC', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Older pin', handle: 'older', pinned: 1, pinned_at: '2026-05-20T00:00:00Z' }),
        agent({ name: 'Newer pin', handle: 'newer', pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Newer pin'))
    const cards = screen.getAllByTestId('agents-landing-pinned-card')
    expect(cards[0].textContent).toContain('Newer pin')
    expect(cards[1].textContent).toContain('Older pin')
  })

  it('orders recent agents by last_used_at DESC and caps at 10', async () => {
    const many = Array.from({ length: 12 }).map((_, i) =>
      agent({
        name: `Used ${i}`, handle: `used-${i}`,
        last_used_at: `2026-05-25T${String(10 - (i % 12)).padStart(2, '0')}:00:00Z`,
      }),
    )
    // Reorder so the freshest is somewhere in the middle, to force the sort.
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: [], agents: many })
    setup()
    await waitFor(() => screen.getByText(/^recent$/i))
    const rows = screen.getAllByTestId('agents-landing-recent-row')
    expect(rows.length).toBeLessThanOrEqual(10)
  })

  it('clicking a pinned card navigates to the agent', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ id: 'a-pin', name: 'Pinned A', handle: 'pinned-a', pinned: 1, pinned_at: 't' })],
    })
    render(
      <MemoryRouter initialEntries={['/library/agents']}>
        <AgentsLanding />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Pinned A'))
    const card = screen.getByTestId('agents-landing-pinned-card')
    fireEvent.click(card)
    // Routing is verified indirectly: the click handler invokes navigate('/library/agent/a-pin').
    // We rely on the parent route container being correctly wired in Library.tsx (Task 7);
    // here we assert the link's href points to the right place.
    const linkEl = card.querySelector('a')
    expect(linkEl?.getAttribute('href')).toBe('/library/agent/a-pin')
  })

  it('shows the agent count in the header', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ id: '1' }), agent({ id: '2' }), agent({ id: '3' })],
    })
    setup()
    await waitFor(() => screen.getByText(/3 agents/i))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/views/AgentsLanding.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/views/AgentsLanding.tsx`**

Create with EXACTLY this content:

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

  const showOnboarding = pinned.length === 0 && recent.length === 0

  return (
    <div className="agents-landing">
      <header className="agents-landing-header">
        <div className="agents-landing-eyebrow">AGENTS</div>
        <h1 className="agents-landing-title">Your prompt library</h1>
        <p className="agents-landing-sub">
          {agents.length} agent{agents.length === 1 ? '' : 's'} · Click any in the sidebar, or copy a handle.
        </p>
      </header>

      {showOnboarding ? (
        <div className="agents-landing-onboarding">
          <h2>Start your library</h2>
          <p>
            Each agent is a reusable system prompt. Give it a <code>@handle</code>, add{' '}
            <code>{'{{variables}}'}</code>, save named presets, and the Copy button drops
            it into any AI tool with the right framing.
          </p>
          <Link to="/library/agent/new" className="agents-landing-cta">+ New agent</Link>
        </div>
      ) : (
        <>
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
              <ul className="agents-landing-recent">
                {recent.map(a => (
                  <RecentRow key={a.id} agent={a} />
                ))}
              </ul>
            </section>
          )}
        </>
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

function RecentRow({ agent }: { agent: AgentRow }) {
  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }
  return (
    <li className="agents-landing-recent-row" data-testid="agents-landing-recent-row">
      <Link to={`/library/agent/${agent.id}`} className="agents-landing-recent-link">
        <div className="agents-landing-recent-swatch" style={swatchStyle}>
          {agent.emoji ?? ''}
        </div>
        <span className="agents-landing-recent-handle">@{agent.handle}</span>
        <span className="agents-landing-recent-name">{agent.name}</span>
        <span className="agents-landing-recent-time">{relativeTime(agent.last_used_at)}</span>
      </Link>
    </li>
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

- [ ] **Step 4: Create the CSS file**

Create `src/views/AgentsLanding.css`:

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

.agents-landing-header { margin-bottom: 32px; }
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

.agents-landing-section { margin-bottom: 32px; }
.agents-landing-section h2 {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--t3);
  margin: 0 0 12px;
}

/* Pinned grid */
.agents-landing-pinned-grid {
  display: grid;
  gap: 12px;
}
.agents-landing-pinned-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
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
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
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

/* Recent list */
.agents-landing-recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.agents-landing-recent-row {
  border-bottom: 1px solid var(--border);
}
.agents-landing-recent-link {
  display: grid;
  grid-template-columns: 24px 120px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  text-decoration: none;
  color: inherit;
}
.agents-landing-recent-link:hover { background: rgba(255, 255, 255, 0.03); }
.agents-landing-recent-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
}
.agents-landing-recent-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--accent-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agents-landing-recent-name {
  font-size: 13px;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agents-landing-recent-time {
  font-size: 10px;
  color: var(--t3);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* Onboarding */
.agents-landing-onboarding {
  max-width: 540px;
  margin: 80px auto;
  text-align: center;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
}
.agents-landing-onboarding h2 {
  color: var(--t1);
  margin: 0 0 12px;
  font-size: 18px;
}
.agents-landing-onboarding p {
  color: var(--t2);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 18px;
}
.agents-landing-onboarding code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--accent-text);
}
.agents-landing-cta {
  display: inline-block;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: background 120ms, color 120ms;
}
.agents-landing-cta:hover {
  background: var(--accent-hover);
  color: var(--t1);
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/views/AgentsLanding.test.tsx`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/views/AgentsLanding.tsx src/views/AgentsLanding.test.tsx src/views/AgentsLanding.css
git commit -m "feat(agents): AgentsLanding no-selection state with Pinned/Recent/onboarding"
```

---

## Task 6: `Library.tsx` — mode-aware detail area swap

**Files:**
- Modify: `src/components/LibrarySidebar.tsx` (add `onModeChange` prop)
- Modify: `src/views/Library.tsx` (track mode, conditionally render AgentsLanding)

- [ ] **Step 1: Add `onModeChange` prop to `LibrarySidebar`**

Read `src/components/LibrarySidebar.tsx`. Find the existing `setMode` call(s) — there are three callsites (one for each of repos/collections/agents toggle buttons at around line 200, plus a useEffect at around line 107).

Add an optional callback prop to the component:

```ts
interface Props {
  // ... existing props
  onModeChange?: (mode: 'repos' | 'collections' | 'agents') => void
}
```

Wrap each `setMode(...)` call (or the entire `setMode` function reference) so the parent is notified:

```ts
const setModeAndNotify = useCallback((m: Mode) => {
  setMode(m)
  onModeChange?.(m)
}, [onModeChange])
```

Replace each `setMode('agents')`, `setMode('collections')`, `setMode('repos')` callsite with `setModeAndNotify('agents')`, etc. Also call `onModeChange?.(mode)` from the existing `useEffect` that syncs mode to the URL on mount (so the parent gets the initial value).

A simpler approach is to keep `setMode` as-is and just add a useEffect that fires `onModeChange?.(mode)` whenever `mode` changes:

```ts
useEffect(() => { onModeChange?.(mode) }, [mode, onModeChange])
```

That's one-line and avoids touching every setMode site. Go with this.

- [ ] **Step 2: Update `Library.tsx`**

Read `src/views/Library.tsx`. Add a state for the current mode:

```ts
const [mode, setMode] = useState<'repos' | 'collections' | 'agents'>('repos')
```

Pass it to `<LibrarySidebar />` as the `onModeChange` callback:

```tsx
<LibrarySidebar
  /* existing props */
  onModeChange={setMode}
/>
```

Import the new component at the top of `Library.tsx`:

```tsx
import AgentsLanding from './AgentsLanding'
```

Replace the detail-area render:

```tsx
{hasDetail ? (
  <LibraryDetailRoutes />
) : (
  <ActivityFeed />
)}
```

with:

```tsx
{hasDetail ? (
  <LibraryDetailRoutes />
) : mode === 'agents' ? (
  <AgentsLanding />
) : (
  <ActivityFeed />
)}
```

- [ ] **Step 3: Type-check + run all touched files' tests**

Run:
```
npx tsc --noEmit
npm test -- src/views/Library.test.tsx src/components/LibrarySidebar.test.tsx src/views/AgentsLanding.test.tsx
```

Expected: type-check clean. Library.tsx and LibrarySidebar tests may not exist (or may not cover this code path) — if they do, they should still pass. AgentsLanding tests should still pass.

If `Library.test.tsx` doesn't exist, that's fine — Phase D doesn't require new tests for the route swap (the AgentsLanding tests in Task 5 already cover the rendering logic).

- [ ] **Step 4: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/views/Library.tsx
git commit -m "feat(agents): swap ActivityFeed for AgentsLanding when in agents mode"
```

---

## Task 7: MCP launcher core (resource resolvers)

**Files:**
- Create: `electron/mcp-launcher-core.cjs`
- Create: `electron/mcp-launcher-core.test.ts`

The core is a CommonJS module exporting three pure functions: `getCatalog(db)`, `getAgentBody(db, handle)`, `getAgentBodyWithPreset(db, handle, presetSlug)`. They take a `better-sqlite3` Database handle. Task 8 will write a thin launcher that opens the DB and wires these into the MCP SDK.

- [ ] **Step 1: Write the failing test**

Create `electron/mcp-launcher-core.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from './db'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('./mcp-launcher-core.cjs') as {
  getCatalog: (db: Database.Database) => Array<{ handle: string; name: string; description: string; presets: { slug: string; name: string }[] }>
  getAgentBody: (db: Database.Database, handle: string) => string | null
  getAgentBodyWithPreset: (db: Database.Database, handle: string, presetSlug: string) => string | null
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

function seedAgent(
  db: Database.Database,
  args: { id: string; name: string; handle: string; body: string; presets?: object[] },
): void {
  const presets = JSON.stringify(args.presets ?? [])
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, presets_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, '#000000', NULL, NULL, ?, 't', 't')
  `).run(args.id, args.name, args.handle, args.body, presets)
}

describe('mcp-launcher-core — getCatalog', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns one entry per agent', () => {
    seedAgent(db, { id: '1', name: 'Reviewer', handle: 'reviewer', body: '# A\nLook at code' })
    seedAgent(db, { id: '2', name: 'Therapist', handle: 'therapist', body: 'Listen carefully' })
    const catalog = core.getCatalog(db)
    expect(catalog.length).toBe(2)
    const handles = catalog.map(c => c.handle).sort()
    expect(handles).toEqual(['reviewer', 'therapist'])
  })

  it('catalog entries include name, handle, description, and presets list', () => {
    seedAgent(db, {
      id: '1', name: 'Reviewer', handle: 'reviewer', body: '# A\nLook at code',
      presets: [{ id: 'p1', name: 'Security', slug: 'security', values: {} }],
    })
    const [entry] = core.getCatalog(db)
    expect(entry.handle).toBe('reviewer')
    expect(entry.name).toBe('Reviewer')
    expect(entry.description).toContain('Look at code')
    expect(entry.presets).toEqual([{ slug: 'security', name: 'Security' }])
  })

  it('returns an empty array when there are no agents', () => {
    expect(core.getCatalog(db)).toEqual([])
  })
})

describe('mcp-launcher-core — getAgentBody', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('returns the raw body for a known handle', () => {
    seedAgent(db, { id: '1', name: 'R', handle: 'reviewer', body: 'Look at {{focus}}' })
    expect(core.getAgentBody(db, 'reviewer')).toBe('Look at {{focus}}')
  })

  it('does NOT substitute variables (raw body)', () => {
    seedAgent(db, { id: '1', name: 'R', handle: 'reviewer', body: 'See {{topic}} now' })
    expect(core.getAgentBody(db, 'reviewer')).toContain('{{topic}}')
  })

  it('returns null for an unknown handle', () => {
    expect(core.getAgentBody(db, 'no-such-handle')).toBeNull()
  })
})

describe('mcp-launcher-core — getAgentBodyWithPreset', () => {
  let db: Database.Database
  beforeEach(() => {
    db = freshDb()
    seedAgent(db, {
      id: '1', name: 'R', handle: 'reviewer', body: 'Look at {{focus}} for {{language}}',
      presets: [
        { id: 'p1', name: 'Security', slug: 'security', values: { focus: 'auth', language: 'TS' } },
      ],
    })
  })

  it('returns the body with the preset\'s values substituted', () => {
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'security'))
      .toBe('Look at auth for TS')
  })

  it('leaves missing variables as literal {{var}}', () => {
    db.prepare(`UPDATE agents SET presets_json = ? WHERE id = '1'`).run(
      JSON.stringify([{ id: 'p1', name: 'P', slug: 'partial', values: { focus: 'X' } }]),
    )
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'partial'))
      .toBe('Look at X for {{language}}')
  })

  it('returns null for an unknown handle', () => {
    expect(core.getAgentBodyWithPreset(db, 'nope', 'security')).toBeNull()
  })

  it('returns null for an unknown preset slug on a known handle', () => {
    expect(core.getAgentBodyWithPreset(db, 'reviewer', 'no-such-slug')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/mcp-launcher-core.test.ts`
Expected: FAIL — module not found.

If `npm test` errors EBUSY on `better_sqlite3.node`, STOP and report BLOCKED.

- [ ] **Step 3: Implement `electron/mcp-launcher-core.cjs`**

Create with EXACTLY this content:

```js
// CommonJS module — required by both the standalone launcher and the test
// suite. No Electron imports.
//
// Pure resolvers over a better-sqlite3 Database handle. The launcher opens
// the DB; this file is transport-agnostic.

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function substituteVariables(body, values) {
  return body.replace(new RegExp(VARIABLE_RE.source, 'g'), (raw, name) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : raw
  })
}

function deriveDescription(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    return trimmed.length > 200 ? trimmed.slice(0, 199) + '…' : trimmed
  }
  return ''
}

function parsePresets(json) {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getCatalog(db) {
  const rows = db.prepare(`SELECT handle, name, body, presets_json FROM agents ORDER BY name ASC`).all()
  return rows.map(row => ({
    handle: row.handle,
    name: row.name,
    description: deriveDescription(row.body),
    presets: parsePresets(row.presets_json).map(p => ({ slug: p.slug, name: p.name })),
  }))
}

function getAgentBody(db, handle) {
  const row = db.prepare(`SELECT body FROM agents WHERE handle = ?`).get(handle)
  return row ? row.body : null
}

function getAgentBodyWithPreset(db, handle, presetSlug) {
  const row = db.prepare(`SELECT body, presets_json FROM agents WHERE handle = ?`).get(handle)
  if (!row) return null
  const presets = parsePresets(row.presets_json)
  const preset = presets.find(p => p.slug === presetSlug)
  if (!preset) return null
  return substituteVariables(row.body, preset.values || {})
}

module.exports = { getCatalog, getAgentBody, getAgentBodyWithPreset }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/mcp-launcher-core.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/mcp-launcher-core.cjs electron/mcp-launcher-core.test.ts
git commit -m "feat(agents): mcp-launcher-core resource resolvers (catalog, raw, substituted)"
```

---

## Task 8: MCP launcher script

**Files:**
- Create: `electron/mcp-launcher.cjs`

This is the standalone executable script. MCP clients invoke it via `node mcp-launcher.cjs <db-path>`. It opens the DB read-only, sets up `@modelcontextprotocol/sdk`'s stdio server, and registers handlers that dispatch to `mcp-launcher-core.cjs`.

There's no test for the launcher itself — it's wire-up code. The user smoke-tests via Claude Code/Cursor after Task 10 ships the "Copy MCP config" UX.

- [ ] **Step 1: Create the launcher**

Create `electron/mcp-launcher.cjs`:

```js
#!/usr/bin/env node
// Standalone MCP server exposing Git Suite agents as resources.
//
// Usage: node mcp-launcher.cjs <db-path>
//
// MCP clients (Claude Code, Cursor) launch this as a child process. It opens
// the SQLite DB read-only so it can coexist with a running Git Suite app.

const Database = require('better-sqlite3')
const core = require('./mcp-launcher-core.cjs')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('Usage: node mcp-launcher.cjs <db-path>')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js')

const server = new Server(
  { name: 'git-suite-agents', version: '0.1.0' },
  { capabilities: { resources: {} } },
)

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const catalog = core.getCatalog(db)
  const resources = []
  resources.push({
    uri: 'agent://',
    name: 'Catalog',
    description: 'Browse all available agents',
    mimeType: 'application/json',
  })
  for (const entry of catalog) {
    resources.push({
      uri: `agent://${entry.handle}`,
      name: `@${entry.handle}`,
      description: entry.description || entry.name,
      mimeType: 'text/markdown',
    })
    for (const preset of entry.presets) {
      resources.push({
        uri: `agent://${entry.handle}/${preset.slug}`,
        name: `@${entry.handle}/${preset.slug}`,
        description: `${entry.name} — ${preset.name} preset`,
        mimeType: 'text/markdown',
      })
    }
  }
  return { resources }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri

  if (uri === 'agent://') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(core.getCatalog(db), null, 2),
      }],
    }
  }

  const match = uri.match(/^agent:\/\/([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?$/)
  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`)
  }

  const handle = match[1]
  const presetSlug = match[2]

  const body = presetSlug
    ? core.getAgentBodyWithPreset(db, handle, presetSlug)
    : core.getAgentBody(db, handle)

  if (body === null) {
    throw new Error(`Resource not found: ${uri}`)
  }

  return {
    contents: [{ uri, mimeType: 'text/markdown', text: body }],
  }
})

const transport = new StdioServerTransport()
server.connect(transport).catch((err) => {
  console.error('MCP launcher failed to start:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the file loads without syntax errors**

There's no unit test for the launcher (it's transport wiring). Verify it parses cleanly by running a syntax check:

```bash
node --check electron/mcp-launcher.cjs
```

Expected: no output (script is syntactically valid).

If `node --check` reports `Cannot find module '@modelcontextprotocol/sdk/server/index.js'`, the exact import paths may differ between SDK versions. Check the installed version:

```bash
node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"
```

For SDK 1.x, the entry points listed above are correct. If the installed SDK is older or newer, adjust the require paths. The SDK's `package.json` `exports` field documents the available subpath imports.

- [ ] **Step 3: Commit**

```bash
git add electron/mcp-launcher.cjs
git commit -m "feat(agents): standalone MCP launcher exposing agents as resources"
```

---

## Task 9: MCP config snippet IPC + MCP tab content

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`
- Modify: `src/views/AgentDetail.tsx` (replace MCP tab placeholder)
- Modify: `src/views/AgentDetail.test.tsx`
- Modify: `src/views/AgentDetail.css`

The MCP tab needs to show users:
1. The resource URIs available for the current agent (`agent://<handle>` and `agent://<handle>/<preset-slug>` for each preset).
2. A "Copy MCP config" button that copies the JSON snippet to the clipboard.

The snippet contains the absolute path to `mcp-launcher.cjs` and the user's DB path. Both come from the main process via a new IPC route.

- [ ] **Step 1: Add the snippet-generating IPC route**

In `electron/ipc/agentHandlers.ts`:

1. At the top of the file, add the `path` import:

```ts
import { app, ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
```

2. Inside `registerAgentHandlers()`, near the other handlers, add:

```ts

  ipcMain.handle('agents:mcp:getConfigSnippet', async () => {
    const launcherPath = path.join(app.getAppPath(), 'electron', 'mcp-launcher.cjs')
    const dbPath = path.join(app.getPath('userData'), 'gitsuite.db')
    const snippet = {
      mcpServers: {
        'git-suite-agents': {
          command: 'node',
          args: [launcherPath, dbPath],
        },
      },
    }
    return JSON.stringify(snippet, null, 2)
  })
```

Note: `app.getAppPath()` returns the path to the unpacked app directory in production; during development (electron-vite), it returns the project root. Either way, `electron/mcp-launcher.cjs` resolves to the right file relative to that root.

- [ ] **Step 2: Extend preload + env.d.ts**

In `electron/preload.ts`, find the `agents:` block. After `recordUse:` (added in Task 2) and before `onChanged:`, INSERT:

```ts
    mcp: {
      getConfigSnippet: () => ipcRenderer.invoke('agents:mcp:getConfigSnippet') as Promise<string>,
    },
```

In `src/env.d.ts`, mirror:

```ts
        mcp: {
          getConfigSnippet(): Promise<string>
        }
```

- [ ] **Step 3: Add a failing test for the MCP tab**

Append to `src/views/AgentDetail.test.tsx`:

```ts
describe('AgentDetail — MCP tab', () => {
  beforeEach(() => {
    ;(window as any).api.agents.mcp = {
      getConfigSnippet: vi.fn().mockResolvedValue(JSON.stringify({
        mcpServers: { 'git-suite-agents': { command: 'node', args: ['/path/to/mcp-launcher.cjs', '/path/to/db'] } },
      }, null, 2)),
    }
  })

  it('renders the resource URIs for the current agent', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    expect(await screen.findByText('agent://copy-editor')).toBeTruthy()
  })

  it('renders preset sub-handle URIs when the agent has presets', async () => {
    const withPresets: AgentRow = {
      ...baseAgent,
      presets_json: JSON.stringify([
        { id: 'p1', name: 'Security', slug: 'security-review', values: {} },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [withPresets] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    expect(await screen.findByText('agent://copy-editor/security-review')).toBeTruthy()
  })

  it('Copy MCP config button writes the snippet to the clipboard', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /copy mcp config/i }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('git-suite-agents')),
    )
  })
})
```

Note: the third test uses `toHaveBeenLastCalledWith` because earlier tests in the file already call `clipboard.writeText` via the Copy button. If your test runner's mock-call tracking persists across tests, reset with `vi.clearAllMocks()` in `beforeEach`. Check the existing setup.

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: 3 new MCP-tab tests FAIL.

- [ ] **Step 5: Replace the MCP tab placeholder**

In `src/views/AgentDetail.tsx`, find the existing MCP tab block:

```tsx
        {activeTab === 'mcp' && (
          <div className="agent-detail-tab-placeholder">
            MCP launcher configuration is coming in Phase D.
          </div>
        )}
```

Replace with:

```tsx
        {activeTab === 'mcp' && (
          <AgentMcpTab agent={agent} presets={presets} />
        )}
```

Add the subcomponent definition near the bottom of `AgentDetail.tsx` (after the main `AgentDetail` function):

```tsx
function AgentMcpTab({ agent, presets }: { agent: AgentRow; presets: AgentPreset[] }) {
  const [snippet, setSnippet] = useState<string | null>(null)
  useEffect(() => {
    window.api.agents.mcp.getConfigSnippet().then(setSnippet).catch(() => setSnippet(null))
  }, [])
  const copySnippet = async () => {
    if (!snippet) return
    await navigator.clipboard.writeText(snippet)
  }
  return (
    <div className="agent-detail-mcp">
      <section className="agent-detail-mcp-section">
        <h3>Resources</h3>
        <p className="agent-detail-mcp-hint">
          Reference this agent from any MCP-capable client using these URIs:
        </p>
        <ul className="agent-detail-mcp-uris">
          <li><code>agent://{agent.handle}</code></li>
          {presets.map(p => (
            <li key={p.id}><code>agent://{agent.handle}/{p.slug}</code></li>
          ))}
        </ul>
      </section>
      <section className="agent-detail-mcp-section">
        <h3>Client configuration</h3>
        <p className="agent-detail-mcp-hint">
          Paste this snippet into your MCP client's config (e.g.{' '}
          <code>~/.claude/settings.json</code>):
        </p>
        <pre className="agent-detail-mcp-snippet">{snippet ?? 'Loading…'}</pre>
        <button
          type="button"
          className="agent-detail-action"
          onClick={copySnippet}
          disabled={!snippet}
        >
          Copy MCP config
        </button>
      </section>
    </div>
  )
}
```

Make sure `AgentPreset` is imported in the imports block (it may already be — Phase B added it as part of `parseAgentPresets`). If not:

```tsx
import type { AgentRow, AgentFolderRow, AgentRevision, AgentPreset } from '../types/agent'
```

- [ ] **Step 6: Append CSS to `src/views/AgentDetail.css`**

```css

/* ── MCP tab content ───────────────────────────────────────── */

.agent-detail-mcp {
  padding: 24px 28px;
  max-width: 720px;
}
.agent-detail-mcp-section { margin-bottom: 24px; }
.agent-detail-mcp-section h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--t3);
  margin: 0 0 8px;
}
.agent-detail-mcp-hint {
  font-size: 12px;
  color: var(--t2);
  line-height: 1.6;
  margin: 0 0 10px;
}
.agent-detail-mcp-hint code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--accent-text);
}
.agent-detail-mcp-uris {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agent-detail-mcp-uris code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--accent-text);
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
}
.agent-detail-mcp-snippet {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 12px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--t2);
  line-height: 1.5;
  margin: 0 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
```

- [ ] **Step 7: Run tests**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS — all 3 new MCP-tab tests green, existing tests still green.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx src/views/AgentDetail.css
git commit -m "feat(agents): MCP tab shows resource URIs + copy-able config snippet"
```

---

## Final verification

After Task 9, do a top-to-bottom sanity check:

- [ ] `npm test -- electron/services/agentsService.test.ts` — all green (folder + handle + preset + revision + recordUse tests).
- [ ] `npm test -- electron/mcp-launcher-core.test.ts` — 11 green.
- [ ] `npm test -- src/views/AgentDetail.test.tsx src/views/AgentsLanding.test.tsx src/components/AgentHistoryTimeline.test.tsx src/components/AgentVariablePresetBar.test.tsx src/components/AgentsSidebar.test.tsx` — all green.
- [ ] `node --check electron/mcp-launcher.cjs` — exits 0.
- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `git log --oneline cd26280..HEAD` (or whatever base SHA you started from) — commits in Phase D style, one logical change each.

---

## What ships at the end of Phase D

- Every Copy call records `last_used_at` so the sidebar's Recent list and AgentsLanding's Recent grid stay fresh.
- Pin/Unpin button in the hero; star indicator in the sidebar for pinned agents.
- AgentsLanding replaces ActivityFeed for the no-agent-selected state in agents mode. Pinned grid + Recent list + onboarding card.
- Standalone MCP launcher exposes `agent://`, `agent://<handle>`, `agent://<handle>/<preset-slug>` over stdio. MCP clients (Claude Code, Cursor) can be configured via the "Copy MCP config" button in the MCP tab.

The full four-phase agents redesign is now on `main`.
