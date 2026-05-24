# Agent Detail View Redesign — Design Spec

**Date:** 2026-05-25
**Status:** Approved

---

## Overview

Rework `src/views/AgentDetail.tsx` to give each agent a stronger sense of identity, eliminate wasted space, and restructure the action surface around two intents: (1) referencing the agent in an AI chat via its handle, and (2) editing the prompt body. The current vertical column of five buttons on the right (Copy, Preview, Pin, Duplicate, Delete) is dispersed: Pin stays as an icon in the hero, Duplicate/Delete/Folder/full-payload-copy move into a new **Settings** tab, the Preview button disappears (the Prompt tab is now always editable; the Preview tab renders the markdown), and Copy is replaced by a small icon next to a new scoped handle (`@git-suite/agent-1`). The hero gains a subtle color-tinted gradient from the agent's swatch. The save-status + URI footer is removed; save status moves to an ephemeral pill inside the editor area, the URI lives on the MCP tab.

---

## Goals

- The agent's identity (name, handle, color, emoji) reads as the headline of the page, not as metadata around the edges.
- Copying the agent's handle for `@mention` in an AI chat is a one-click action.
- Editing the prompt body has zero modal overhead — open the agent and type.
- Rare and destructive actions (Duplicate, Delete) are reachable but out of the way.
- Tab style and underline-on-active behavior match the existing app convention.
- All UI glyphs are Lucide stroke SVGs (consistent with the rest of the app — no emoji icons).

---

## Non-Goals

- No change to the MCP tab content or behavior.
- No change to the History tab content or behavior (timeline, restore, live updates remain).
- No change to the variable/preset bar component (`AgentVariablePresetBar`).
- No change to the underlying data model — `AgentRow` columns are unchanged.
- The scope prefix `git-suite` is **hardcoded** to the app's package name in this pass. Promoting it to a user-configurable setting is out of scope.
- The MCP launcher's resource URIs are **not** rewritten in this pass — they remain `agent://<handle>` (no scope prefix). See [MCP tab](#mcp-tab) for the rationale.

---

## Layout

The page is three regions stacked vertically: **Hero**, **Tabs**, **Body**. There is no footer.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HERO                                                                    │
│  ┌────────┐                                                             │
│  │ swatch │  Agent 1                                            [📌Pin] │
│  │ (emoji)│  @git-suite/agent-1 [📋]                                    │
│  └────────┘  [📁 Unfiled] [0.0 kb] [Updated 5/24/2026, 1:44 AM]         │
├─────────────────────────────────────────────────────────────────────────┤
│ TABS                                                                    │
│  Prompt   Preview   MCP   History                            │ Settings │
├─────────────────────────────────────────────────────────────────────────┤
│ BODY                                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ [always-editable textarea]                                        │  │
│  │                                                                   │  │
│  │                                                  [✓ saved]        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Hero

The hero is a single horizontal row with three regions: **swatch** (left), **identity block** (middle, fills available space), and **actions** (right).

### Background

A subtle gradient using the agent's `color_start`:

```css
background:
  radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--agent-color) 18%, transparent), transparent 55%),
  linear-gradient(180deg, color-mix(in srgb, var(--agent-color) 6%, transparent), transparent 80%),
  var(--bg2);
```

`--agent-color` is set as an inline style on `.agent-detail-hero` from `agent.color_start`. Fallback when `color_start` is null: use `--accent`.

### Swatch

- 56×56 px rounded square (was 64×64 — slightly tighter).
- Shows the agent's emoji centered (existing behavior).
- Background gradient from `color_start` → `color_end` (existing behavior).
- **New:** rendered as a `<button>` with a hover affordance (scale 1.04 + inner white ring). Clicking opens a popover containing the existing `AgentEmojiPicker` and `AgentColorPicker` components stacked vertically.
- The popover is anchored to the swatch (positioned absolute, top: 100% of swatch, left: 0). Clicking outside or pressing Escape closes it. Changes save via the existing `window.api.agents.update(id, { emoji, color_start, color_end })` IPC — no new IPC routes needed.
- A new wrapper component `src/components/AgentSwatchPopover.tsx` owns the popover state, mounts the two pickers, and exposes an `<AgentSwatchPopover agent={agent} />` API. It renders the swatch button itself and the popover.

### Identity block

Stacked vertically, top-to-bottom:

1. **Title** — `agent.name`, 22 px / weight 600. **Double-click** to enter rename mode (currently single-click; this changes to double-click to prevent accidental edits while users click around the hero). Existing `nameEditing` state and `scheduleSaveName` debounce logic carry over.
2. **Handle row** — see [Handle row](#handle-row) below. Replaces the old single-line `@handle` and the inline title.
3. **Meta chips** — three pill-shaped chips with leading Lucide icons:
   - `<Folder>` + folder name (or "Unfiled" if `folder_id` is null)
   - `<FileText>` + `(bodyChars / 1024).toFixed(1) + ' kb'`
   - `<Clock>` + `Updated ` + formatted timestamp

The description line (currently `deriveDescription(liveBody)`) is **removed** from the hero. It was a small italic paragraph between title and meta; in practice it duplicates content visible on the Prompt tab. Removing it tightens the hero and removes one source of layout shift as the user edits.

### Handle row

Layout: `<at><scope-prefix><handle><copy-button>`

- `@` — color `--t3`, JetBrains Mono, font-size 12 px.
- `git-suite/` — color `--t3` (locked, non-editable).
- `agent-1` (the local part, `agent.handle`) — color `--accent-text`, double-click to enter edit mode. Edit input replaces the span inline and reuses `isValidHandle` from `src/utils/agentSlug.ts` plus a uniqueness check against the other agents' handles (fetched alongside `folders` in the existing `getAll()` call — store `takenHandles` in state). Save on blur or Enter via `window.api.agents.update(id, { handle })`. On validation failure (invalid format **or** duplicate), the input shows a red border and a small error tooltip; blur reverts to the prior value. Escape also reverts.
- **Copy button** — Lucide `<Copy>` icon, 22×22 px, immediately to the right of the handle. Clicking copies `@git-suite/agent-1` (the full `@scope/local` string with the `@`) to the clipboard and shows the existing `toast('Copied @git-suite/agent-1', 'success')`.

**Scope prefix source:** a new constant `AGENT_SCOPE` is defined in `src/utils/agentScope.ts`, exported as the literal string `'git-suite'`. Both the display and the copy payload read from this constant. Future work can replace the constant with a setting lookup without touching the consumers.

### Actions

A single icon button: **Pin**.

- Lucide `<Pin>` icon. 34×34 px.
- Toggles `agent.pinned` (existing `handlePinToggle`).
- When pinned, the button has an amber tint: `color: #fbbf24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25)`.

The Copy/Edit/Preview/Duplicate/Delete buttons that existed in the current hero are all removed. Their new homes:

| Old button | New home                                                                  |
|------------|---------------------------------------------------------------------------|
| Copy       | Hero handle row (copies handle string, not payload)                       |
| Edit/Preview | **Removed.** Prompt tab is always editable; Preview tab renders markdown |
| Pin        | Hero actions (icon button)                                                |
| Duplicate  | Settings tab                                                              |
| Delete     | Settings tab                                                              |

The full-payload copy (the original behavior of the big Copy button — copying the rendered persona markdown for chats without an MCP server) moves to the Settings tab as **Copy entire prompt**.

---

## Tabs

The tab bar uses the existing underline-on-active style (`.agent-detail-tab` CSS is unchanged in look). Two structural changes:

1. **Leading icons.** Each tab gets a Lucide icon before its label:
   - Prompt → `<Edit3>`
   - Preview → `<Eye>`
   - MCP → `<Plug>`
   - History → `<Clock>`
   - Settings → `<Settings>`

   Icon size: 13 px. Gap between icon and label: 6 px.

2. **Settings tab on the right.** A flex spacer pushes Settings to the right end of the bar. A 1 px vertical divider sits between the History tab and the Settings tab (`width: 1px; background: rgba(255,255,255,0.06); margin: 8px 6px;`).

The `activeTab` state type widens from `'prompt' | 'preview' | 'mcp' | 'history'` to `'prompt' | 'preview' | 'mcp' | 'history' | 'settings'`. The mapping table that converts tab key to label is extended accordingly.

---

## Body — per tab

### Prompt tab

- **Always editable.** The body is a single `<textarea>` styled the same as today's `.agent-detail-textarea`. There is no Edit/Preview toggle and no rendered fallback on this tab.
- `editing` state, `editingRef`, and the `useEffect` that focuses `bodyRef` when entering edit mode are all **removed**.
- The textarea's `value` is `bodyDraft`. `onChange` updates `bodyDraft` and calls `scheduleSaveBody(value)` (existing 1.5 s debounce).
- The variable/preset bar (`AgentVariablePresetBar`) renders above the textarea whenever `variables.length > 0`, exactly as today.

#### Save indicator

The footer is gone. Save status becomes an ephemeral pill positioned absolutely inside the Prompt tab body:

- Container `<div class="agent-detail-prompt-body">` is `position: relative`.
- Pill is `position: absolute; bottom: 18px; right: 32px`.
- States:
  - `saveStatus === 'saving'` → amber tint, label "saving…", Lucide `<Loader2>` icon spinning
  - `saveStatus === 'saved'` → green tint, label "saved", Lucide `<Check>` icon, auto-hides after 2 s (existing `setTimeout(() => setSaveStatus('idle'), 2000)`)
  - `saveStatus === 'idle'` → not rendered

CSS:

```css
.agent-detail-save-pill {
  position: absolute;
  bottom: 18px;
  right: 32px;
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  pointer-events: none;
  transition: opacity 200ms;
}
.agent-detail-save-pill--saving { color: var(--amber); background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); }
.agent-detail-save-pill--saved  { color: #22c55e; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.22); }
```

### Preview tab

The rendered markdown of `agent.body` (not `bodyDraft` — preview always reflects the persisted state). Uses the existing `<ReactMarkdown remarkPlugins={[remarkGfm]}>` block and the existing `.agent-detail-rendered` styles, both moved verbatim from the Prompt tab's preview branch.

The variable/preset bar does **not** appear on the Preview tab. Preview is a clean read of the saved body.

### MCP tab

**Unchanged.** `AgentMcpTab` continues to render Resources (URI list) and Client configuration (copy-able snippet).

**Note on scope mismatch.** The hero displays the handle as `@git-suite/agent-1` and the copy-handle button copies that exact string. The MCP launcher (`electron/mcp-launcher.cjs`) still emits resource URIs as `agent://agent-1` (no scope prefix) — those URIs continue to appear on the MCP tab as-is. The display prefix `git-suite/` is **cosmetic and copy-payload only** in this pass; aligning the MCP URI scheme with the displayed scoped form is explicitly deferred to a follow-on spec because it requires changes to the launcher's resource resolvers, the resource catalog format, and any client configs already pointing at the old URI shape.

### History tab

**Unchanged.** `AgentHistoryTimeline` continues to render lazily on first activation with day grouping, live updates via `onRevisionAdded`, and restore via `handleRestore`.

### Settings tab

New tab. Layout is a two-column grid: left column = label (200 px), right column = field + hint.

| Label          | Field                                                                                                |
|----------------|------------------------------------------------------------------------------------------------------|
| Folder         | `<select>` with one `<option>` per folder + "Unfiled". On change, `window.api.agents.update(id, { folder_id: value === '__unfiled' ? null : value })`. Hint: "Move this agent into a folder in the sidebar." |
| Export prompt  | `<button>` "Copy entire prompt" with Lucide `<Copy>` icon. On click, runs the **existing** `handleCopy` logic from `AgentDetail.tsx` (build persona payload, write to clipboard, toast, record use). This is the only place the full-payload copy lives. Hint: "Copies the full rendered persona markdown to the clipboard — for chats without the MCP server." |
| Manage         | Two buttons inline: "Duplicate" (Lucide `<CopyPlus>`) → existing `handleDuplicate`. "Delete agent" (Lucide `<Trash2>`, danger styling: red text + red-tinted background) → existing `handleDelete` with its `confirm()` prompt. Hint: "Duplicate creates a copy with a new handle. Delete cannot be undone." |

CSS classes: `.agent-detail-settings-grid`, `.agent-detail-settings-label`, `.agent-detail-settings-field`, `.agent-detail-settings-hint`, `.agent-detail-settings-btn`, `.agent-detail-settings-btn--danger`.

Note: emoji and color customization are **not** in the Settings tab. Those are edited via the swatch popover described above.

---

## Components

### Modified

- **`src/views/AgentDetail.tsx`** — major rewrite of JSX and several state simplifications:
  - Remove `editing`, `editingRef`, body-focus effect.
  - Add `activeTab === 'settings'` branch.
  - Replace hero JSX with the new three-region layout.
  - Replace hero actions JSX with the single Pin button.
  - Replace handle/title block with title + handle row + meta chips (new order).
  - Wire copy-handle button to `navigator.clipboard.writeText('@' + AGENT_SCOPE + '/' + agent.handle)` and a toast.
  - Wire swatch click to mount `<AgentSwatchPopover>`.
  - Remove `description` derivation and rendering from the hero (the variable is still used by `buildPersonaPayload`).
  - Move the save-status pill from the removed footer into the Prompt-tab body container.
  - Remove the `<footer>` element entirely.

- **`src/views/AgentDetail.css`** — major rewrite:
  - Update `.agent-detail-hero` background to use the agent-color gradient and the `--agent-color` CSS custom property.
  - Adjust swatch size (64 → 56) and add hover ring.
  - Rename / restyle handle area into a horizontal row.
  - Add `.agent-detail-copy-handle` button styles.
  - Remove `.agent-detail-actions` vertical-stack styles; replace with horizontal-row + single-button styles.
  - Add `.agent-detail-tab` icon-gap rule (`display: inline-flex; gap: 6px`).
  - Add `.agent-detail-tabs-spacer` and `.agent-detail-tabs-sep` for the Settings divider.
  - Add `.agent-detail-prompt-body` (relative-positioned wrapper for the save pill) and `.agent-detail-save-pill` variants.
  - Add `.agent-detail-settings-*` grid and button styles.
  - Remove `.agent-detail-footer`, `.agent-detail-save-status*`, `.agent-detail-description`, and the old vertical-actions rules.

### Added

- **`src/utils/agentScope.ts`** — exports `export const AGENT_SCOPE = 'git-suite'`. Imported by `AgentDetail.tsx`. One file, one constant; future work replaces it with a setting lookup.

- **`src/components/AgentSwatchPopover.tsx`** — new component:
  - Props: `{ agent: AgentRow }`.
  - Renders the swatch button (using existing `swatchStyle` derivation moved into this component).
  - Internal `open` state controls the popover.
  - Popover body mounts the existing pickers using their actual prop shapes (from `CreateAgentPanel`):
    - `<AgentEmojiPicker value={agent.emoji} onChange={(emoji) => window.api.agents.update(agent.id, { emoji })} />`
    - `<AgentColorPicker mode={mode} colorStart={colorStart} colorEnd={colorEnd} harmony={harmony} onChange={next => { setMode(next.mode); setColorStart(next.colorStart); setColorEnd(next.colorEnd); setHarmony(next.harmony); window.api.agents.update(agent.id, { color_start: next.colorStart, color_end: next.colorEnd }) }} />`
  - `mode` and `harmony` are local state (the agent row doesn't persist them):
    - Initial `mode` = `agent.color_end ? 'gradient' : 'solid'`
    - Initial `harmony` = `'manual'`
    - Initial `colorStart` = `agent.color_start ?? '#6366f1'`
    - Initial `colorEnd` = `agent.color_end`
  - Closes on outside click or Escape.
  - Has a test file `src/components/AgentSwatchPopover.test.tsx`.

### Unchanged

- `src/components/AgentEmojiPicker.tsx`, `AgentColorPicker.tsx`, `AgentHistoryTimeline.tsx`, `AgentVariablePresetBar.tsx`, `AgentContextMenu.tsx`, `AgentsSidebar.tsx`, `CreateAgentPanel.tsx`.
- All IPC routes (`window.api.agents.*`).
- The DB schema and migrations.

---

## Behavior changes summary

| Behavior                                  | Before                                                | After                                                       |
|-------------------------------------------|-------------------------------------------------------|-------------------------------------------------------------|
| Open agent → see body                     | Renders markdown if `body !== ''`, textarea if empty  | Always textarea on Prompt tab; rendered markdown on Preview |
| Rename agent                              | Single-click on title                                 | Double-click on title                                       |
| Edit handle                               | Not editable from detail view                         | Double-click the `agent-1` local part of the handle row      |
| Copy handle string                        | Not available                                         | Click Copy icon next to handle → copies `@git-suite/agent-1` |
| Copy full persona payload                 | Big Copy button in hero                               | Settings tab → "Copy entire prompt"                          |
| Edit emoji/color                          | Only from `CreateAgentPanel` or sidebar context menu  | Click the hero swatch → popover                              |
| Change folder                             | Only from sidebar drag/context menu                   | Settings tab → Folder dropdown                               |
| Duplicate                                 | Button in hero                                        | Settings tab → "Duplicate" button                            |
| Delete                                    | Button in hero                                        | Settings tab → "Delete agent" button                         |
| See save status                           | Footer at bottom of view                              | Ephemeral pill in bottom-right of Prompt-tab editor          |
| See `agent://` URI                        | Footer at bottom of view                              | MCP tab (existing Resources section)                         |

---

## Test plan

### Updated tests in `src/views/AgentDetail.test.tsx`

- Replace "clicking Copy copies payload" → "clicking the handle-copy icon copies `@git-suite/<handle>` and toasts".
- Replace "clicking Edit toggles textarea/preview" → assert the textarea is always present on the Prompt tab regardless of body content.
- Replace "clicking Preview shows rendered markdown on Prompt tab" → "Preview tab renders markdown of `agent.body`".
- Replace "clicking Delete confirms and calls delete" → "Settings tab Delete button confirms and calls delete".
- Add "clicking the swatch opens a popover containing the emoji and color pickers".
- Add "double-clicking the handle local part enters edit mode and saves on blur".
- Add "Settings tab Folder dropdown changes agent's folder_id".
- Add "Settings tab Copy entire prompt button copies persona payload (same as old Copy)".
- Add "save pill appears on edit, transitions saving → saved → hidden".

### New tests in `src/components/AgentSwatchPopover.test.tsx`

- Renders the swatch with the agent's emoji and gradient.
- Click opens the popover; outside click closes it; Escape closes it.
- Emoji selection calls `window.api.agents.update` with the new emoji.
- Color selection calls `window.api.agents.update` with the new color_start/color_end.

All other existing tests (sidebar, landing, history timeline, MCP launcher) are untouched.

---

## Open items deferred

- **Configurable scope prefix.** `AGENT_SCOPE` is hardcoded. If the user wants per-workspace or per-user scopes, that's a follow-on spec (new setting + UI + migration of existing handles in copy payloads).
- **MCP URI alignment with the displayed scoped handle.** Currently the MCP launcher emits `agent://<handle>`; the displayed/copied form is `@git-suite/<handle>`. Rewriting the launcher to emit `agent://git-suite/<handle>` (and updating the catalog, resource resolvers, and any saved client configs) is deferred.
- **Keyboard shortcut for handle copy.** Considered (e.g., `Cmd+Shift+C` while focused on the hero). Not in this spec.
- **Settings tab additions.** Other things that could plausibly land in Settings (description override, tags, default preset, archive) are out of scope for this pass.
