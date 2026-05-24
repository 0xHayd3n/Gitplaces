# Agents section polish — design spec

**Date:** 2026-05-25
**Status:** approved (brainstorm)
**Branch policy:** direct to `main` (per user CLAUDE.md)

## 1. Problem

The agents section works but does not look professional yet. The user has called out:

- A big centered "+ New agent" card on the landing page when it should be sharper.
- Sidebar folder rows feel cramped and undifferentiated: small text, no icon, no kebab menu, no inline rename, no visual separator under the top-of-sidebar "+ New agent" button.
- The New Agent creation form is visually loose — fields stack without grouping, and density is low.

Aesthetic target: Linear / Vercel minimal — sharp small radii (4–6px), monochrome with a single accent, mono uppercase section labels, dense but breathable, no heavy shadows.

## 2. Scope

### In scope
- Sidebar polish: larger folder names, emoji-or-default-icon per folder, always-visible `⋯` kebab, inline double-click rename, separator beneath the top "+ New agent" button.
- Folder kebab popover with: Rename, Color (inline 8-swatch palette), Emoji (reuse existing `AgentEmojiPicker`), Delete.
- DB: new `emoji` column on `agent_folders`. Existing `color_start` / `color_end` finally exposed to UI (folders are solid-only — `color_end` stays `NULL`).
- Landing page: Variant A — title + sub + small "+ New agent" in the header right; pinned grid restyled; recent items become a horizontal scroll carousel; header-only empty state.
- New Agent form: stacked column with three labeled sections (Identity / Appearance / Organize), tightened spacing and narrower max-width.
- Tests: service `updateFolder`, migration smoke test, RTL render tests for sidebar inline rename + kebab interactions and empty-state landing.

### Out of scope (deferred)
- AI chat-to-create-agent flow (separate later spec).
- Folder gradient colors (folders are solid-only).
- Folder description editing (column exists, leave dormant).
- Redesign of the agent branch of the existing context menu (only the folder branch is replaced this pass).

## 3. Data layer

### 3.1 Migration

Append to the end of `initSchema` in [electron/db.ts](../../../electron/db.ts), matching the existing `try { db.exec(ALTER TABLE …) } catch {}` idempotent pattern:

```ts
// Agents polish — folder emoji
try { db.exec(`ALTER TABLE agent_folders ADD COLUMN emoji TEXT`) } catch {}
```

No index needed — emoji is presentational.

### 3.2 Types

In [src/types/agent.ts](../../../src/types/agent.ts):

```ts
export interface AgentFolderRow {
  id: string
  name: string
  color_start: string | null
  color_end:   string | null
  description: string | null
  emoji:       string | null   // NEW
  created_at:  string
}
```

### 3.3 Service

In [electron/services/agentsService.ts](../../../electron/services/agentsService.ts), add a unified folder updater. `renameFolder` becomes a thin wrapper so existing callers continue to work.

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

// Existing renameFolder becomes a wrapper:
export function renameFolder(db: Database.Database, id: string, name: string): AgentFolderRow {
  return updateFolder(db, id, { name })
}
```

Also update `createFolder` to keep `emoji` as `NULL` on insert (no signature change needed — it's already not part of the insert column list, the new column will default to NULL).

### 3.4 IPC

In [electron/ipc/agentHandlers.ts](../../../electron/ipc/agentHandlers.ts), add a handler that broadcasts `agents:changed`. Existing `agents:renameFolder` stays as-is — it now goes through the wrapper.

```ts
ipcMain.handle('agents:updateFolder', async (_, id: string, patch: UpdateFolderPatch) => {
  const db = getDb(app.getPath('userData'))
  const row = updateFolder(db, id, patch)
  broadcastChanged()
  return row
})
```

Import `updateFolder` and `UpdateFolderPatch` at the top of the file.

### 3.5 Preload

In [electron/preload.ts](../../../electron/preload.ts), expose the new method inside `agents`:

```ts
updateFolder: (id: string, patch: {
  name?: string
  colorStart?: string | null
  colorEnd?:   string | null
  emoji?:      string | null
}) =>
  ipcRenderer.invoke('agents:updateFolder', id, patch) as Promise<import('../src/types/agent').AgentFolderRow>,
```

## 4. Sidebar

Files: [src/components/AgentsSidebar.tsx](../../../src/components/AgentsSidebar.tsx), [src/components/LibrarySidebar.css](../../../src/components/LibrarySidebar.css).

### 4.1 "+ New agent" wrapper

Update the wrapper around the button to add a visual break before the folder list:

```tsx
<div className="agents-sidebar-new-wrap">
  <button type="button" className="library-sidebar-seg agents-sidebar-new" onClick={handleNewAgent}>
    + New agent
  </button>
</div>
```

```css
.agents-sidebar-new-wrap {
  padding: 8px 8px 10px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}
.agents-sidebar-new {
  width: 100%;
}
```

### 4.2 Folder row visuals

Bump section header from current 10px → 13px, medium weight; gain a left-side avatar slot and a right-side kebab slot.

Row layout (left → right, gaps 6px):
```
[caret 10] [avatar 16] [name flex, 13px medium] [count 10 muted] [⋯ 14]
```

CSS additions (new selectors — keep `library-sidebar-section-header` intact for other consumers of `LibrarySidebar.css`):

```css
.agents-sidebar-folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 8px;
  background: transparent;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--t2);
  cursor: pointer;
  text-align: left;
  position: relative;
}
.agents-sidebar-folder-header:hover { background: rgba(255, 255, 255, 0.04); }
.agents-sidebar-folder-caret { width: 10px; font-size: 9px; color: var(--t3); }
.agents-sidebar-folder-avatar {
  width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
  color: var(--t3);
  flex-shrink: 0;
}
.agents-sidebar-folder-name {
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.agents-sidebar-folder-count {
  font-size: 10px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.agents-sidebar-folder-kebab {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  color: var(--t3);
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
}
.agents-sidebar-folder-kebab:hover { background: rgba(255, 255, 255, 0.08); color: var(--t1); }
.agents-sidebar-folder-header[data-has-accent="true"] {
  box-shadow: inset 3px 0 0 var(--folder-accent);
}
```

The folder header is a `<button>` for the open/close caret toggle, but the kebab is a nested `<button>` — to avoid invalid HTML (button-in-button), wrap the row in a `<div>` with `role="button"` and `tabIndex={0}` instead, with explicit click + keydown handlers, and put the real `<button>` only on the kebab. The double-click-to-rename also lives on this div.

### 4.3 Avatar

Show the folder's emoji when set; otherwise fall back to a default lucide `<Folder size={14} />`. Unfiled (synthetic, `id === null`) always shows the default Folder icon — and is the only group with no kebab.

```tsx
const FolderAvatar = ({ emoji }: { emoji: string | null }) =>
  emoji
    ? <span className="agents-sidebar-folder-avatar">{emoji}</span>
    : <span className="agents-sidebar-folder-avatar"><Folder size={14} strokeWidth={1.8} /></span>
```

### 4.4 Folder accent

If `color_start` is set, apply `style={{ '--folder-accent': row.color_start } as CSSProperties}` to the header div and toggle `data-has-accent="true"`. Resolves into the `inset 3px 0 0` rule above. `color_end` is ignored for folders.

### 4.5 Inline rename

State in `AgentsSidebar.tsx`:
```ts
const [renamingId, setRenamingId] = useState<string | null>(null)
const [renameDraft, setRenameDraft] = useState('')
```

Entering rename mode (from double-click or kebab → Rename):
```ts
setRenamingId(folderId)
setRenameDraft(currentName)
```

Render: when `renamingId === g.id`, the name span swaps for an `<input>` autoFocused with the value selected. Handlers:
- `onChange` → `setRenameDraft`
- `onKeyDown` → Enter calls commit; Escape calls cancel
- `onBlur` → commit

Commit: `await window.api.agents.updateFolder(id, { name: renameDraft })`. Empty / whitespace-only falls back to the service's `normaliseFolderName` ("Untitled folder"). Always clear `renamingId` and `renameDraft` after commit/cancel.

Right-click and the kebab "Rename" item both call `setRenamingId(folderId)` and close the menu — so all three rename paths funnel into the same inline flow. The legacy `prompt()` path in `handleRenameFolder` is removed.

### 4.6 Kebab interaction

The always-visible `⋯` button (lucide `MoreHorizontal`) opens `FolderKebabMenu` anchored beneath. Right-click on the row opens it at the cursor position. The existing `menu` state is reused — on render, if `target.kind === 'agent'` the sidebar renders `AgentContextMenu` (unchanged); if `target.kind === 'folder'` it renders the new `FolderKebabMenu`. `AgentContextMenu`'s folder branch is left in place but no longer reached from the sidebar.

Unfiled has no kebab, no right-click menu, no rename, no delete.

### 4.7 220-pixel width

Sum of widths at 220px panel: 8 + 10 + 6 + 16 + 6 + name-flex + 6 + 10 + 6 + 18 + 8 ≈ 94px of fixed chrome, leaving ~126px for the name. That is workable — the existing agent rows leave less. If during implementation the row feels cramped, shrink the count chip away when the kebab is open or drop the count to 9px. Note as a known constraint, not a blocker.

## 5. FolderKebabMenu component

New file: `src/components/FolderKebabMenu.tsx`.

### 5.1 Props

```ts
interface Props {
  x: number
  y: number
  folderId: string
  currentColor: string | null
  currentEmoji: string | null
  onClose: () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}
```

The agent branch of the old `AgentContextMenu` stays in place (still receives folder right-clicks only via `AgentsSidebar`'s switch, but now the folder branch routes through this new component).

### 5.2 Layout

A single floating panel, ~200px wide, anchored at `(x, y)`. Listens for outside-click, Escape, and scroll-anywhere to close (same pattern as `AgentContextMenu`).

Items in order:

1. **Rename** — closes menu, calls `onRename(folderId)`.
2. **Color** — clicking expands an inline color row inside the panel (no nested popover). The row shows 8 swatches plus a "None" tile. Click a swatch → `updateFolder({ colorStart })` → close menu. Re-clicking "Color" while expanded collapses.
3. **Emoji** — opens the existing `AgentEmojiPicker` anchored to the menu item. On selection: `updateFolder({ emoji })`. On `null` selection: clears. Closing the picker closes the menu.
4. **Delete folder** — uses existing `confirm()` then `onDelete(folderId)`.

### 5.3 Color palette

A fixed set of 8 accent hexes (picked from the existing accent system), plus a `null` "None" option:

```ts
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
```

The currently-selected swatch gets a 1.5px white ring. "None" shows as an outlined tile with a diagonal slash.

### 5.4 Styling

New CSS file `src/components/FolderKebabMenu.css`. 4px radius corners, `var(--bg2)` background, `1px solid var(--border)` border. Menu items are 28px tall, 11px font, left-aligned with optional trailing accessory (the "Color" item shows a tiny swatch reflecting the current color; the "Emoji" item shows the current emoji or a Smile icon).

### 5.5 IPC wiring

The kebab owns its own mutations: color swatch clicks and emoji selections call `window.api.agents.updateFolder(folderId, …)` directly inside the component. Only Rename and Delete are surfaced as props (because they hand off to sidebar state). This keeps the prop surface small.

## 6. Landing page (Variant A)

Files: [src/views/AgentsLanding.tsx](../../../src/views/AgentsLanding.tsx), [src/views/AgentsLanding.css](../../../src/views/AgentsLanding.css).

### 6.1 Header

Replace the current header block with a flex row:

```tsx
<header className="agents-landing-header">
  <div className="agents-landing-header-text">
    <div className="agents-landing-eyebrow">AGENTS</div>
    <h1 className="agents-landing-title">Your prompt library</h1>
    <p className="agents-landing-sub">{agents.length} agent{agents.length === 1 ? '' : 's'} · Click any in the sidebar, or copy a handle.</p>
  </div>
  <Link to="/library/agent/new" className="agents-landing-new-btn">+ New agent</Link>
</header>
```

```css
.agents-landing-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}
.agents-landing-header-text { min-width: 0; }
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
.agents-landing-new-btn:hover { background: var(--accent-hover); color: var(--t1); }
```

The big centered `.agents-landing-onboarding` card and its `.agents-landing-cta` are deleted.

### 6.2 Pinned (when present)

Same data binding, same grid columns count. Restyle the card: 6px radius, no box-shadow on the card itself (the swatch retains its shadow), slightly tighter padding (12px), `var(--bg2)` background, `1px solid var(--border)`. Hover bumps to `var(--bg3)` + `var(--accent-border)`.

### 6.3 Recent (when present)

Replace the vertical `<ul>` with a horizontal scroll strip:

```tsx
<section className="agents-landing-section">
  <h2>Recent</h2>
  <div className="agents-landing-recent-strip">
    {recent.map(a => <RecentCard key={a.id} agent={a} />)}
  </div>
</section>
```

```css
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
  width: 28px; height: 28px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
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

The card mirrors the pinned card visual language at ~70% scale and drops the snippet line. The relative-time chip sits in the top-right corner.

### 6.4 Empty state

When `pinned.length === 0 && recent.length === 0`: render only the header. No `.agents-landing-onboarding` card, no value-prop panel, no inline hint.

```tsx
return (
  <div className="agents-landing">
    <header className="agents-landing-header">…</header>
    {pinned.length > 0 && <PinnedSection pinned={pinned} />}
    {recent.length > 0 && <RecentSection recent={recent} />}
  </div>
)
```

## 7. New Agent form

Files: [src/components/CreateAgentPanel.tsx](../../../src/components/CreateAgentPanel.tsx), [src/views/AgentDetail.css](../../../src/views/AgentDetail.css).

### 7.1 Layout

Three labeled sections inside the existing panel, max-width tightened from 720 → 640px:

```tsx
<div className="create-agent-panel">
  <header className="create-agent-header">
    <h2>New agent</h2>
  </header>

  <section className="create-agent-section">
    <div className="create-agent-section-label">Identity</div>
    {/* Name field */}
    {/* Handle field */}
  </section>

  <section className="create-agent-section">
    <div className="create-agent-section-label">Appearance</div>
    <div className="create-agent-custom">{/* existing color + emoji */}</div>
  </section>

  <section className="create-agent-section">
    <div className="create-agent-section-label">Organize</div>
    {/* Folder field */}
  </section>

  <div className="create-agent-preview">…</div>
  <footer className="create-agent-footer">…</footer>
</div>
```

### 7.2 Styling deltas

```css
.create-agent-panel { max-width: 640px; }     /* was 720 */
.create-agent-section { margin-bottom: 22px; }
.create-agent-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--t3);
  margin: 0 0 10px;
}
.create-agent-field { margin-bottom: 10px; }   /* was 14 */
```

Existing `.create-agent-field`, `.create-agent-custom`, `.create-agent-preview`, `.create-agent-footer` styles all stay.

## 8. Testing

All tests run with `npm test` (per project convention — direct `npx vitest` rebuilds `better-sqlite3` for Node's ABI and breaks the Electron launch).

### 8.1 Service tests

In an existing `agentsService.test.ts` or a new test file, add cases for `updateFolder`:
- Happy path: patch name → row reflects normalised name.
- Color set: patch `colorStart: '#22c55e'` → row stores it.
- Color clear: patch `colorStart: null` → column becomes NULL.
- Hex validation: patch `colorStart: 'red'` throws.
- Emoji set / clear.
- Unknown id throws.
- Empty patch (no fields) is a no-op that still returns the row.

### 8.2 Migration test

New file `electron/db.agents-folder-emoji-migration.test.ts` following the existing `db.*-migration.test.ts` pattern:
- Create a fresh DB with the agents_folders table in its pre-migration shape (no `emoji` column).
- Insert a folder row directly.
- Call `initSchema(db)`.
- Assert the `emoji` column is queryable and reads as `NULL` on the existing row.
- Assert subsequent `UPDATE agent_folders SET emoji = '📁'` succeeds and reads back.

### 8.3 Renderer tests

Using existing React-Testing-Library setup:
- `AgentsSidebar`: render with one folder and one agent; double-click the folder name → an `<input>` is in the document; type a new name and press Enter → `window.api.agents.updateFolder` is called with `{ name: newName }`.
- `AgentsSidebar`: click the kebab on a folder row → `FolderKebabMenu` is visible.
- `FolderKebabMenu`: click a color swatch → `window.api.agents.updateFolder` is called with the expected `colorStart`.
- `AgentsLanding`: render with zero agents → assert the header is present and no `.agents-landing-onboarding` element exists.
- `AgentsLanding`: render with one pinned + one recent → assert one `.agents-landing-recent-card` exists and the old `.agents-landing-recent-row` does not.

Stub `window.api.agents` via the existing test helpers / mocks.

## 9. Risk register

- **220px sidebar width** is tight with the new row chrome. Mitigation: shave gaps, drop the count to 9px, or hide the count when the kebab menu is open. Document during implementation.
- **`<button>` nesting**: the folder header is a clickable row (caret toggle) that also contains a clickable kebab button. Use `role="button"` on a `<div>` outer wrapper and a real `<button>` only on the kebab, with explicit keyboard handlers (Enter / Space toggles, Escape cancels rename). This is the only non-trivial accessibility wrinkle.
- **Right-click + always-visible kebab coexistence**: both open the same menu. The `menu` state's coordinates need to track which one fired (cursor x/y vs anchored-to-button x/y). Solved by computing the kebab button's `getBoundingClientRect()` on click.
- **Migration idempotence**: the `try/catch` ALTER pattern is already used throughout `db.ts`. Re-running `initSchema` after the migration must be a no-op — verified by the migration test.
- **Existing `renameFolder` IPC + back-compat**: keeping both `agents:renameFolder` and `agents:updateFolder` means two paths to write the folder name. The wrapper at the service layer keeps behavior identical; the sidebar uses only `updateFolder` going forward.

## 10. Affected files

| File | Change |
|---|---|
| `electron/db.ts` | add ALTER TABLE for `agent_folders.emoji` |
| `electron/services/agentsService.ts` | add `updateFolder`; `renameFolder` becomes wrapper |
| `electron/ipc/agentHandlers.ts` | add `agents:updateFolder` handler |
| `electron/preload.ts` | expose `updateFolder` |
| `src/types/agent.ts` | add `emoji` to `AgentFolderRow` |
| `src/components/AgentsSidebar.tsx` | row layout, kebab, inline rename, default Folder icon |
| `src/components/LibrarySidebar.css` | new `.agents-sidebar-folder-*` rules, new-wrap separator |
| `src/components/FolderKebabMenu.tsx` | new component |
| `src/components/FolderKebabMenu.css` | new styles |
| `src/components/AgentContextMenu.tsx` | folder branch no longer reachable from sidebar (left in place; no edit needed) |
| `src/components/CreateAgentPanel.tsx` | three sections, narrower max-width |
| `src/views/AgentDetail.css` | `.create-agent-section`, `.create-agent-section-label`, narrower panel |
| `src/views/AgentsLanding.tsx` | header layout, recent carousel, header-only empty state |
| `src/views/AgentsLanding.css` | header row, recent strip, remove onboarding card styles |
| `electron/db.agents-folder-emoji-migration.test.ts` | new migration test |
| `electron/services/agentsService.test.ts` (or new file) | `updateFolder` tests |
| Renderer test files (sidebar + landing) | RTL coverage per §8.3 |

Estimated 600–700 LOC total across roughly 12 production files plus 3 test files.

## 11. Done criteria

- All listed files modified per §10; production code matches §3–§7.
- `npm test` passes locally (no `better-sqlite3` ABI failures).
- Landing page in zero-agents state shows the header only — no centered card, no CTA panel.
- Sidebar folder rows show a default lucide Folder icon (or custom emoji), bigger names, always-visible kebab, working inline rename, separator under "+ New agent".
- Folder color/emoji round-trip through DB after kebab interactions and persist across reload.
- New agent form has three labeled sections and a narrower max-width.
