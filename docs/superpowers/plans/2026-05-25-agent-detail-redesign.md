# Agent Detail View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the agent detail view (`src/views/AgentDetail.tsx` + CSS + tests) to deliver the design in `docs/superpowers/specs/2026-05-25-agent-detail-redesign-design.md`: scoped handle with copy icon, swatch-as-popover for emoji/color editing, Settings tab on the right, no Edit/Preview toggle (Prompt always editable), no footer, all Lucide icons.

**Architecture:** One new constant (`AGENT_SCOPE`), one new wrapper component (`AgentSwatchPopover` that mounts the existing `AgentEmojiPicker` + `AgentColorPicker` in a popover), and a substantial rewrite of `AgentDetail.tsx` + `AgentDetail.css`. No data-model, IPC, or MCP-launcher changes. Test file is rewritten in lockstep with the JSX changes.

**Tech Stack:** React 18, TypeScript, React Router, Vitest + @testing-library/react, Lucide React icons, CSS variables (existing theme).

**Spec:** [docs/superpowers/specs/2026-05-25-agent-detail-redesign-design.md](../specs/2026-05-25-agent-detail-redesign-design.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/agentScope.ts` | Create | One constant: `AGENT_SCOPE = 'git-suite'`. |
| `src/components/AgentSwatchPopover.tsx` | Create | Renders the hero swatch as a `<button>`; clicking opens a popover with `AgentEmojiPicker` + `AgentColorPicker`; persists changes via `window.api.agents.update`. |
| `src/components/AgentSwatchPopover.test.tsx` | Create | Tests for the popover open/close + picker integration. |
| `src/views/AgentDetail.tsx` | Modify (major) | New hero layout, Settings tab, no Edit toggle, ephemeral save pill, no footer. |
| `src/views/AgentDetail.css` | Modify (major) | New hero gradient + swatch button, handle row, copy-handle button, tab icons + spacer + Settings divider, save pill, Settings grid. Remove footer, description, vertical actions, save-status CSS. |
| `src/views/AgentDetail.test.tsx` | Modify (major) | Rewrite tests to match new structure. |

No other files are touched in this plan.

---

## Phase 1: Foundations

### Task 1: Add `AGENT_SCOPE` constant

**Files:**
- Create: `src/utils/agentScope.ts`

- [ ] **Step 1: Create the file**

```ts
// src/utils/agentScope.ts
// Display + copy-payload prefix for agent handles. Currently hardcoded to the
// app's package name; promoted to a configurable setting in a follow-on spec.
export const AGENT_SCOPE = 'git-suite'

export function formatScopedHandle(handle: string): string {
  return `@${AGENT_SCOPE}/${handle}`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/agentScope.ts
git commit -m "feat(agents): add AGENT_SCOPE constant and formatScopedHandle helper"
```

---

## Phase 2: AgentSwatchPopover component

### Task 2: Test — swatch renders with agent's gradient + emoji

**Files:**
- Create: `src/components/AgentSwatchPopover.test.tsx`

- [ ] **Step 1: Create the test file with the first test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentSwatchPopover from './AgentSwatchPopover'
import type { AgentRow } from '../types/agent'

const agent: AgentRow = {
  id: 'a1',
  name: 'Copy editor',
  handle: 'copy-editor',
  body: '',
  folder_id: null,
  color_start: '#10b981',
  color_end: null,
  emoji: '✏️',
  pinned: 0,
  pinned_at: null,
  last_used_at: null,
  presets_json: '[]',
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
}

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      update: vi.fn().mockResolvedValue(undefined),
    },
  }
})

describe('AgentSwatchPopover', () => {
  it('renders the swatch as a button with the agent emoji and solid color', () => {
    render(<AgentSwatchPopover agent={agent} />)
    const btn = screen.getByRole('button', { name: /edit appearance/i })
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('✏️')
    expect(btn.style.background).toBe('rgb(16, 185, 129)')
  })
})
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
npm test -- src/components/AgentSwatchPopover.test.tsx
```

Expected: FAIL — `Cannot find module './AgentSwatchPopover'`.

- [ ] **Step 3: Create the minimal component**

```tsx
// src/components/AgentSwatchPopover.tsx
import { useEffect, useRef, useState } from 'react'
import AgentEmojiPicker from './AgentEmojiPicker'
import AgentColorPicker, { type AgentColorPickerProps } from './AgentColorPicker'
import type { AgentRow } from '../types/agent'

type HarmonyMode = AgentColorPickerProps['harmony']

interface Props {
  agent: AgentRow
}

export default function AgentSwatchPopover({ agent }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'solid' | 'gradient'>(agent.color_end ? 'gradient' : 'solid')
  const [colorStart, setColorStart] = useState(agent.color_start ?? '#6366f1')
  const [colorEnd, setColorEnd] = useState<string | null>(agent.color_end)
  const [harmony, setHarmony] = useState<HarmonyMode>('manual')
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const background = colorEnd
    ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
    : colorStart

  return (
    <div className="agent-swatch-pop-wrap">
      <button
        type="button"
        className="agent-detail-swatch"
        aria-label="Edit appearance"
        style={{ background }}
        onClick={() => setOpen(o => !o)}
      >
        {agent.emoji ?? ''}
      </button>
      {open && (
        <div ref={popRef} className="agent-swatch-popover">
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
              window.api.agents.update(agent.id, {
                color_start: next.colorStart,
                color_end: next.colorEnd,
              })
            }}
          />
          <AgentEmojiPicker
            value={agent.emoji}
            onChange={emoji => {
              window.api.agents.update(agent.id, { emoji })
            }}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
npm test -- src/components/AgentSwatchPopover.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentSwatchPopover.tsx src/components/AgentSwatchPopover.test.tsx
git commit -m "feat(agents): AgentSwatchPopover wraps emoji + color pickers"
```

### Task 3: Test — swatch click opens and closes the popover

**Files:**
- Modify: `src/components/AgentSwatchPopover.test.tsx`

- [ ] **Step 1: Append the test**

```tsx
  it('clicking the swatch opens the popover; outside click closes it', async () => {
    render(
      <div>
        <AgentSwatchPopover agent={agent} />
        <button>outside</button>
      </div>
    )
    expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    expect(screen.getByRole('button', { name: /emoji/i })).toBeTruthy()
    // Outside click (use mousedown to match the listener)
    fireEvent.mouseDown(screen.getByText('outside'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull())
  })

  it('Escape key closes the popover', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    expect(screen.getByRole('button', { name: /emoji/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull())
  })
```

- [ ] **Step 2: Run tests (expect pass — the implementation already covers this)**

```bash
npm test -- src/components/AgentSwatchPopover.test.tsx
```

Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AgentSwatchPopover.test.tsx
git commit -m "test(agents): swatch popover open/close + escape"
```

### Task 4: Test — emoji and color changes call api.agents.update

**Files:**
- Modify: `src/components/AgentSwatchPopover.test.tsx`

- [ ] **Step 1: Append the tests**

```tsx
  it('selecting an emoji calls api.agents.update with the new emoji', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    // Open the AgentEmojiPicker's own popover
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    // Click the first emoji cell in the grid
    const grid = screen.getByRole('searchbox').parentElement!
    const firstCell = grid.querySelectorAll('.agent-emoji-cell')[0] as HTMLButtonElement
    fireEvent.click(firstCell)
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalled())
    const call = (window.api.agents.update as any).mock.calls[0]
    expect(call[0]).toBe('a1')
    expect(call[1]).toHaveProperty('emoji')
  })

  it('color picker change calls api.agents.update with color_start/color_end', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    // The color picker exposes hex inputs labelled by class .acp-hex; change the first
    const startInput = document.querySelector('.acp-hex') as HTMLInputElement
    fireEvent.change(startInput, { target: { value: '#ff0000' } })
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalled())
    const call = (window.api.agents.update as any).mock.calls.find(
      (c: any[]) => 'color_start' in c[1],
    )
    expect(call).toBeTruthy()
    expect(call[1].color_start).toBe('#ff0000')
  })
```

- [ ] **Step 2: Run tests**

```bash
npm test -- src/components/AgentSwatchPopover.test.tsx
```

Expected: 5 tests PASS. If the color test fails because the picker's hex input shape differs, adjust the test to drive the `onChange` via whichever input the picker actually exposes (read `src/components/AgentColorPicker.tsx` for its DOM structure).

- [ ] **Step 3: Commit**

```bash
git add src/components/AgentSwatchPopover.test.tsx
git commit -m "test(agents): swatch popover emoji + color persist via update IPC"
```

---

## Phase 3: AgentDetail hero redesign

This phase replaces the hero JSX and CSS. The Settings tab, no-toggle Prompt, and save pill are deliberately deferred to later phases — by the end of Phase 3 the hero is new but the body still uses the old Edit toggle and the old footer is still present (we'll clear those in Phase 5).

### Task 5: Update the existing test fixture to expect the new hero structure

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

The existing tests reference the old hero (single-line `@handle`, `Edit` button, single-click rename). Update the suite **first** so the implementation in Tasks 6–9 is guided by failing tests.

- [ ] **Step 1: Replace the `renders the hero with @handle, name, swatch and description` test**

In `src/views/AgentDetail.test.tsx`, find the test at line ~89 (it currently checks `@copy-editor`, the swatch background, and a description matching "Hello body"). Replace it with:

```tsx
  it('renders the hero with scoped handle, title, swatch and meta chips', async () => {
    setup()
    await waitForLoaded()
    // Title (name) is the h2
    expect(screen.getByRole('heading', { level: 2, name: 'Copy editor' })).toBeTruthy()
    // Handle row shows the scope prefix and the local part
    expect(screen.getByText('git-suite/')).toBeTruthy()
    expect(screen.getByText('copy-editor')).toBeTruthy()
    // Swatch is now a button with aria-label "Edit appearance"
    expect(screen.getByRole('button', { name: /edit appearance/i })).toBeTruthy()
    // Folder chip
    expect(screen.getByText('Writing')).toBeTruthy()
  })
```

Also **delete** the old `renders the agent name and rendered body` test (line ~82): the new Prompt tab is always editable and renders a textarea, not the rendered markdown — that test no longer reflects the design.

- [ ] **Step 2: Run tests (expect failures because the impl still has the old hero)**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: the `renders the hero with scoped handle...` test FAILS (`git-suite/` text not found). The old tests that we have not yet deleted should still pass for now.

- [ ] **Step 3: Commit the test changes (red state — implementation comes next)**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): expect scoped handle + new hero structure (failing)"
```

### Task 6: Replace the hero JSX in AgentDetail.tsx

**Files:**
- Modify: `src/views/AgentDetail.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/views/AgentDetail.tsx`, add:

```tsx
import { Copy, Pin, Folder, FileText, Clock } from 'lucide-react'
import { AGENT_SCOPE, formatScopedHandle } from '../utils/agentScope'
import AgentSwatchPopover from '../components/AgentSwatchPopover'
```

- [ ] **Step 2: Replace the hero JSX**

Find the `<header className="agent-detail-hero">…</header>` block (currently lines 223–302). Replace the entire block with:

```tsx
      <header
        className="agent-detail-hero"
        style={{ ['--agent-color' as any]: agent.color_start ?? 'var(--accent)' }}
      >
        <AgentSwatchPopover agent={agent} />
        <div className="agent-detail-id-block">
          {nameEditing ? (
            <input
              className="agent-detail-title-input"
              aria-label="Name"
              value={nameDraft}
              onChange={e => { setNameDraft(e.target.value); scheduleSaveName(e.target.value) }}
              onBlur={() => setNameEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter') setNameEditing(false) }}
              maxLength={200}
              autoFocus
            />
          ) : (
            <h2
              className="agent-detail-title"
              onDoubleClick={() => setNameEditing(true)}
              title="Double-click to rename"
            >
              {nameDraft || agent.name}
            </h2>
          )}
          <HandleRow
            handle={agent.handle}
            agentId={agent.id}
            takenHandles={takenHandles}
            onCopied={(text) => toast(`Copied ${text}`, 'success')}
          />
          <div className="agent-detail-meta">
            <span className="agent-detail-chip"><Folder size={11} /> {currentFolderName}</span>
            <span className="agent-detail-chip"><FileText size={11} /> {(bodyChars / 1024).toFixed(1)} kb</span>
            <span className="agent-detail-chip"><Clock size={11} /> Updated {new Date(agent.updated_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="agent-detail-actions">
          <button
            type="button"
            className={'agent-detail-pin-btn' + (agent.pinned === 1 ? ' agent-detail-pin-btn--on' : '')}
            onClick={handlePinToggle}
            aria-label={agent.pinned === 1 ? 'Unpin' : 'Pin'}
            title={agent.pinned === 1 ? 'Unpin' : 'Pin'}
          >
            <Pin size={18} />
          </button>
        </div>
      </header>
```

- [ ] **Step 3: Add the `takenHandles` state**

In the state block at the top of the component (around line 21), add:

```tsx
  const [takenHandles, setTakenHandles] = useState<string[]>([])
```

In the effect that calls `getAll()` (line ~37), inside the async block after `setAgent(a)`, add:

```tsx
      setTakenHandles(agents.filter(x => x.id !== id).map(x => x.handle))
```

- [ ] **Step 4: Add the `HandleRow` sub-component**

Add this component at the bottom of the file, alongside `AgentMcpTab`:

```tsx
function HandleRow({
  handle,
  agentId,
  takenHandles,
  onCopied,
}: {
  handle: string
  agentId: string
  takenHandles: readonly string[]
  onCopied: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(handle)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(handle); setError(null) }, [handle])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const scope = AGENT_SCOPE

  const commit = async () => {
    const trimmed = draft.trim()
    if (trimmed === handle) { setEditing(false); return }
    if (!isValidHandle(trimmed)) { setError('Invalid handle'); return }
    if (takenHandles.includes(trimmed)) { setError('Handle already in use'); return }
    try {
      await window.api.agents.update(agentId, { handle: trimmed })
      setEditing(false); setError(null)
    } catch {
      setError('Save failed')
    }
  }

  const cancel = () => { setDraft(handle); setEditing(false); setError(null) }

  const onCopy = async () => {
    const text = formatScopedHandle(handle)
    try {
      await navigator.clipboard.writeText(text)
      onCopied(text)
    } catch {
      // toast handled by parent on failure path if needed
    }
  }

  return (
    <div className="agent-detail-handle-row">
      <span className="agent-detail-handle-at">@</span>
      <span className="agent-detail-handle-scope">{scope}/</span>
      {editing ? (
        <input
          ref={inputRef}
          className={'agent-detail-handle-input' + (error ? ' agent-detail-handle-input--error' : '')}
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null) }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          aria-label="Handle"
          title={error ?? ''}
          maxLength={64}
          size={Math.max(draft.length, 4)}
        />
      ) : (
        <span
          className="agent-detail-handle"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit"
        >
          {handle}
        </span>
      )}
      <button
        type="button"
        className="agent-detail-copy-handle"
        onClick={onCopy}
        aria-label={`Copy @${scope}/${handle}`}
        title={`Copy @${scope}/${handle}`}
      >
        <Copy size={13} />
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Add the missing import for `isValidHandle`**

At the top of `src/views/AgentDetail.tsx`, add:

```tsx
import { isValidHandle } from '../utils/agentSlug'
```

- [ ] **Step 6: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: the `renders the hero with scoped handle...` test now PASSES. The old `Copy` / `Edit` / `Delete` tests still pass because their buttons still exist in the body section (we haven't touched the action column yet — wait, we did remove the actions block. The old `Copy`, `Edit`, `Delete` buttons are gone). Several tests will FAIL — that's expected; we fix them in the next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/views/AgentDetail.tsx
git commit -m "feat(agents): new hero with scoped handle row, swatch popover, Pin-only"
```

### Task 7: Update CSS for the new hero

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Update `.agent-detail-hero` background**

Find `.agent-detail-hero` (line ~12). Replace its body with:

```css
.agent-detail-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border);
  background:
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--agent-color, var(--accent)) 18%, transparent), transparent 55%),
    linear-gradient(180deg, color-mix(in srgb, var(--agent-color, var(--accent)) 6%, transparent), transparent 80%),
    var(--bg2);
  flex-shrink: 0;
}
```

- [ ] **Step 2: Update `.agent-detail-swatch`**

Find `.agent-detail-swatch` (line ~22). Replace with:

```css
.agent-detail-swatch {
  width: 56px;
  height: 56px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.15);
  cursor: pointer;
  border: none;
  padding: 0;
  position: relative;
  transition: transform 120ms;
}
.agent-detail-swatch:hover { transform: scale(1.04); }
.agent-detail-swatch::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 13px;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.3);
  opacity: 0;
  transition: opacity 120ms;
  pointer-events: none;
}
.agent-detail-swatch:hover::after { opacity: 1; }
```

- [ ] **Step 3: Add the swatch popover wrapper styles**

Append after the `.agent-detail-swatch` rules:

```css
.agent-swatch-pop-wrap {
  position: relative;
  flex-shrink: 0;
}
.agent-swatch-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 100;
  width: 320px;
  padding: 14px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 9px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

- [ ] **Step 4: Remove the old `.agent-detail-handle` rule and add the new handle row**

Find `.agent-detail-handle` (line ~39). Replace the entire rule with the new handle-row rules:

```css
.agent-detail-handle-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: var(--t3);
}
.agent-detail-handle-at,
.agent-detail-handle-scope {
  color: var(--t3);
}
.agent-detail-handle {
  color: var(--accent-text);
  cursor: text;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.agent-detail-handle:hover {
  background: var(--bg3);
  border-color: var(--border);
}
.agent-detail-handle-input {
  background: var(--bg3);
  border: 1px solid var(--accent-border);
  border-radius: 3px;
  padding: 0 4px;
  font-family: inherit;
  font-size: 12px;
  color: var(--accent-text);
  outline: none;
}
.agent-detail-handle-input--error {
  border-color: var(--red-border);
}
.agent-detail-copy-handle {
  width: 22px;
  height: 22px;
  margin-left: 2px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--t3);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 120ms, background 120ms, border-color 120ms;
}
.agent-detail-copy-handle:hover {
  color: var(--t1);
  background: var(--bg3);
  border-color: var(--border2);
}
```

- [ ] **Step 5: Adjust the title block (double-click hint)**

Find `.agent-detail-title` (line ~46). Update the cursor to remain `text` but add a margin tweak so the title sits above the handle row without the old description spacing. Replace its rule with:

```css
.agent-detail-title {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
  color: var(--t1);
  cursor: text;
  padding: 0 4px;
  border-radius: 5px;
  border: 1px solid transparent;
  line-height: 1.25;
  display: inline-block;
}
.agent-detail-title:hover {
  background: var(--bg3);
  border-color: var(--border);
}
```

Also delete the `.agent-detail-description` rule (line ~78) — no longer rendered.

- [ ] **Step 6: Replace the actions column with the horizontal Pin button**

Find `.agent-detail-actions` (line ~108). Replace with:

```css
.agent-detail-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.agent-detail-pin-btn {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--t3);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 120ms, background 120ms, border-color 120ms;
}
.agent-detail-pin-btn:hover {
  color: var(--t1);
  background: var(--bg3);
  border-color: var(--border2);
}
.agent-detail-pin-btn--on {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.25);
}
```

Also delete the `.agent-detail-copy`, `.agent-detail-action`, and `.agent-detail-action--danger` rules (lines ~116–153) — those buttons no longer exist.

- [ ] **Step 7: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: same set of pass/fail as Task 6 (CSS doesn't change test outcomes). Visual changes only.

- [ ] **Step 8: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): hero gradient, swatch button, handle row, Pin button"
```

### Task 8: Test — copy-handle icon copies @scope/handle and toasts

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Replace the `Copy button writes the persona payload` test**

Find the test at line ~98 (`Copy button writes the persona payload to the clipboard`). Replace it with:

```tsx
  it('handle copy icon copies @git-suite/<handle> to the clipboard', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy @git-suite\/copy-editor/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const text = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(text).toBe('@git-suite/copy-editor')
  })
```

- [ ] **Step 2: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "handle copy icon"
```

Expected: PASS (the implementation from Task 6 already wires this).

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): handle copy icon copies scoped handle"
```

### Task 9: Test — title rename is double-click and handle local-part double-click edits

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the tests**

```tsx
  it('double-clicking the title enters rename mode', async () => {
    setup()
    await waitForLoaded()
    const title = screen.getByRole('heading', { level: 2, name: 'Copy editor' })
    // Single-click should NOT enter edit mode (regression guard for old behavior)
    fireEvent.click(title)
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    fireEvent.doubleClick(title)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  })

  it('double-clicking the handle local part enters handle edit mode', async () => {
    setup()
    await waitForLoaded()
    const handleSpan = screen.getByText('copy-editor')
    fireEvent.doubleClick(handleSpan)
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    expect(input.value).toBe('copy-editor')
  })

  it('handle edit saves a valid new handle on blur', async () => {
    setup()
    await waitForLoaded()
    fireEvent.doubleClick(screen.getByText('copy-editor'))
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'new-handle' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { handle: 'new-handle' }),
    )
  })

  it('handle edit rejects an invalid handle without saving', async () => {
    setup()
    await waitForLoaded()
    fireEvent.doubleClick(screen.getByText('copy-editor'))
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'INVALID!' } })
    fireEvent.blur(input)
    // No save call
    expect(window.api.agents.update).not.toHaveBeenCalledWith('a1', { handle: 'INVALID!' })
    // Input still present in error state
    expect(input.className).toContain('agent-detail-handle-input--error')
  })
```

- [ ] **Step 2: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: all four new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): title and handle double-click edit behavior"
```

---

## Phase 4: Tabs redesign

### Task 10: Test — tab bar includes Settings tab with leading icons

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the test**

```tsx
  it('tab bar includes Prompt, Preview, MCP, History, Settings', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /prompt/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /mcp/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /history/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /settings/i })).toBeTruthy()
  })
```

- [ ] **Step 2: Run the test (expect failure — no Settings tab yet)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "tab bar includes"
```

Expected: FAIL — `Unable to find role="tab", name=/settings/i`.

- [ ] **Step 3: Update the tab list in AgentDetail.tsx**

In `src/views/AgentDetail.tsx`:

1. Add imports near the existing icon imports:

```tsx
import { Edit3, Eye, Plug, Settings as SettingsIcon } from 'lucide-react'
```

2. Find the `activeTab` state declaration (line ~28). Widen the type:

```tsx
  const [activeTab, setActiveTab] = useState<'prompt' | 'preview' | 'mcp' | 'history' | 'settings'>('prompt')
```

3. Also find the tab reset in the `useEffect` for `id` change (line ~41). It's already `setActiveTab('prompt')` — no change needed.

4. Find the `<nav className="agent-detail-tabs">` block (line ~304). Replace it entirely with:

```tsx
      <nav className="agent-detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'prompt'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('prompt')}
        >
          <Edit3 size={13} /> Prompt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('preview')}
        >
          <Eye size={13} /> Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mcp'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('mcp')}
        >
          <Plug size={13} /> MCP
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('history')}
        >
          <Clock size={13} /> History
        </button>
        <span className="agent-detail-tabs-spacer" />
        <span className="agent-detail-tabs-sep" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          className="agent-detail-tab"
          onClick={() => setActiveTab('settings')}
        >
          <SettingsIcon size={13} /> Settings
        </button>
      </nav>
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "tab bar includes"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): tab bar gets Lucide icons + right-aligned Settings tab"
```

### Task 11: Update tab CSS for icon gap, spacer, and divider

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Update `.agent-detail-tab` to be a flex container**

Find `.agent-detail-tab` (line ~694). Replace its rule with:

```css
.agent-detail-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--t3);
  font-size: 12px;
  padding: 10px 14px;
  cursor: pointer;
  transition: color 120ms, border-color 120ms;
  font-family: inherit;
}
.agent-detail-tab:hover { color: var(--t2); }
.agent-detail-tab[aria-selected="true"] {
  color: var(--accent-text);
  border-bottom-color: var(--accent);
}
```

- [ ] **Step 2: Add spacer and divider rules**

Append:

```css
.agent-detail-tabs-spacer {
  flex: 1;
}
.agent-detail-tabs-sep {
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 8px 6px;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): tab icon gap, spacer, Settings divider"
```

---

## Phase 5: Prompt + Preview body

### Task 12: Replace Edit-toggle tests with always-editable assertions

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Delete the tests that rely on the Edit button**

Delete these tests (they assert behavior that no longer exists):

1. `toggles to edit mode and shows the textarea` (line ~114)
2. `Copy uses live bodyDraft (unsaved edits) when in edit mode` (line ~142) — superseded by the Settings-tab Copy-entire-prompt test in Task 17
3. `resets edit mode when navigating between agents` (line ~154) — the wrapper test that clicks Edit; only the navigation portion is still meaningful

For test 3, replace it with a navigation test that does not click Edit. Reuse the `otherAgent` fixture and the `NavButton` helper but remove all `fireEvent.click(... /^Edit$/ ...)` calls:

```tsx
  it('switches the rendered body when navigating between agents', async () => {
    const otherAgent: AgentRow = {
      id: 'a2',
      name: 'Other agent',
      handle: 'other-agent',
      body: '# Other\n\nother body.',
      folder_id: null,
      color_start: '#6366f1',
      color_end: null,
      emoji: null,
      pinned: 0,
      pinned_at: null,
      last_used_at: null,
      presets_json: '[]',
      created_at: '2026-05-23T00:00:00Z',
      updated_at: '2026-05-23T00:00:00Z',
    }
    ;(window as any).api.agents.getAll = vi.fn()
      .mockResolvedValueOnce({ folders, agents: [baseAgent] })
      .mockResolvedValueOnce({ folders, agents: [otherAgent] })

    function NavButton() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/library/agent/a2')}>Go to a2</button>
    }

    render(
      <MemoryRouter initialEntries={['/library/agent/a1']}>
        <NavButton />
        <Routes>
          <Route path="/library/agent/:id" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.click(screen.getByText('Go to a2'))
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Other agent' }))
    const ta = screen.getByRole('textbox', { name: /Body/ }) as HTMLTextAreaElement
    expect(ta.value).toContain('other body.')
  })
```

- [ ] **Step 2: Update the debounced auto-save test**

Find `debounced auto-save calls api.agents.update 1500ms after last keystroke` (line ~122). Remove the `fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }))` line. The textarea is now always present, so just type directly:

```tsx
  it('debounced auto-save calls api.agents.update 1500ms after last keystroke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setup()
    await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)) })
    await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)) })
    expect(screen.getByRole('heading', { level: 2, name: 'Copy editor' })).toBeTruthy()
    const ta = screen.getByRole('textbox', { name: /Body/ })
    fireEvent.change(ta, { target: { value: 'changed body' } })
    expect(window.api.agents.update).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(window.api.agents.update).toHaveBeenCalledWith('a1', { body: 'changed body' })
  })
```

- [ ] **Step 3: Add a new test for always-editable**

```tsx
  it('Prompt tab textarea is always present (no Edit toggle)', async () => {
    setup()
    await waitForLoaded()
    // No Edit button anywhere
    expect(screen.queryByRole('button', { name: /^Edit$/ })).toBeNull()
    // Textarea is present immediately on load (even though body is non-empty)
    const ta = screen.getByRole('textbox', { name: /Body/ }) as HTMLTextAreaElement
    expect(ta.value).toContain('Copy editor')
  })
```

- [ ] **Step 4: Run the tests (expect the new ones to fail because impl still has the toggle)**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: `Prompt tab textarea is always present` FAILS (the toggle still exists in the impl).

- [ ] **Step 5: Commit (failing-test snapshot)**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): expect always-editable Prompt tab (failing)"
```

### Task 13: Remove Edit toggle and always-render the textarea on Prompt tab

**Files:**
- Modify: `src/views/AgentDetail.tsx`

- [ ] **Step 1: Remove `editing` state and related refs**

Delete these lines:

```tsx
const [editing, setEditing] = useState(false)
```

```tsx
const editingRef = useRef(false)
useEffect(() => { editingRef.current = editing }, [editing])
```

```tsx
useEffect(() => { if (editing) bodyRef.current?.focus() }, [editing])
```

In the `useEffect` that initializes from `id` (line ~37), delete:

```tsx
setEditing(a !== null && a.body === '')
```

In the `useEffect` for `agents:changed` (line ~108), update:

```tsx
if (!editingRef.current) setBodyDraft(a?.body ?? '')
```

to:

```tsx
setBodyDraft(a?.body ?? '')
```

- [ ] **Step 2: Replace the Prompt-tab body branch**

Find the `activeTab === 'prompt'` block (line ~323). Replace it with:

```tsx
        {activeTab === 'prompt' && (
          <div className="agent-detail-prompt-body">
            {variables.length > 0 && (
              <AgentVariablePresetBar
                agent={agent}
                variables={variables}
                activePresetId={activePresetId}
                onActivePresetChange={setActivePresetId}
              />
            )}
            <textarea
              ref={bodyRef}
              className="agent-detail-textarea"
              aria-label="Body"
              placeholder="Write the markdown that defines this agent's persona. Use {{variable}} placeholders for things you'll fill in per copy."
              value={bodyDraft}
              onChange={e => { setBodyDraft(e.target.value); scheduleSaveBody(e.target.value) }}
            />
            {saveStatus !== 'idle' && (
              <span
                className={
                  'agent-detail-save-pill ' +
                  (saveStatus === 'saving'
                    ? 'agent-detail-save-pill--saving'
                    : 'agent-detail-save-pill--saved')
                }
              >
                {saveStatus === 'saving' ? 'saving…' : 'saved ✓'}
              </span>
            )}
          </div>
        )}
```

- [ ] **Step 3: Update the `liveBody` derivation**

Find:

```tsx
const liveBody = editing ? bodyDraft : (agent?.body ?? '')
```

Replace with:

```tsx
const liveBody = bodyDraft
```

(This means Copy/derived-description always use the unsaved draft, which is the previous behavior in edit mode and is fine because the textarea is always live.)

- [ ] **Step 4: Run tests**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: `Prompt tab textarea is always present` PASSES. The debounced-save test also PASSES. The navigation test PASSES.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx
git commit -m "feat(agents): Prompt tab is always editable; drop Edit/Preview toggle"
```

### Task 14: CSS for `.agent-detail-prompt-body` and `.agent-detail-save-pill`

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Add prompt-body wrapper + save pill rules**

Append (or place near the existing `.agent-detail-textarea` rule):

```css
.agent-detail-prompt-body {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.agent-detail-prompt-body .agent-detail-textarea {
  flex: 1;
}

.agent-detail-save-pill {
  position: absolute;
  bottom: 18px;
  right: 18px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  pointer-events: none;
  transition: opacity 200ms;
}
.agent-detail-save-pill--saving {
  color: var(--amber);
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
}
.agent-detail-save-pill--saved {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.22);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): save pill inside Prompt tab body"
```

### Task 15: Test — Preview tab renders markdown of agent.body

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the test**

```tsx
  it('Preview tab renders markdown of agent.body', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /preview/i }))
    // The markdown body contains `# Copy editor` — appears as h1 in the rendered output
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Copy editor' })).toBeTruthy()
    })
  })
```

- [ ] **Step 2: Run the test (expect failure — Preview is currently a placeholder)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Preview tab renders"
```

Expected: FAIL.

- [ ] **Step 3: Replace the Preview-tab branch in AgentDetail.tsx**

Find:

```tsx
        {activeTab === 'preview' && (
          <div className="agent-detail-tab-placeholder">
            The Preview tab will render the full clipboard payload in a future phase. For now, see the preview block on the Prompt tab.
          </div>
        )}
```

Replace with:

```tsx
        {activeTab === 'preview' && (
          <div className="agent-detail-rendered">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.body}</ReactMarkdown>
          </div>
        )}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Preview tab renders"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): Preview tab renders saved markdown"
```

---

## Phase 6: Settings tab body

### Task 16: Test — Settings tab Folder dropdown changes folder_id

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the test**

```tsx
  it('Settings tab Folder dropdown changes the agent\'s folder', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const select = screen.getByLabelText(/folder/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__unfiled' } })
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { folder_id: null }),
    )
  })
```

- [ ] **Step 2: Run the test (expect failure — no Settings tab body yet)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Settings tab Folder"
```

Expected: FAIL — `Unable to find label "folder"`.

- [ ] **Step 3: Add the Settings tab branch to AgentDetail.tsx**

Find the closing `</div>` of the `agent-detail-body` div (around line ~367 after the History branch). Just before that closing tag, add the Settings branch:

```tsx
        {activeTab === 'settings' && (
          <AgentSettingsTab agent={agent} folders={folders} onCopyPayload={handleCopy} onDuplicate={handleDuplicate} onDelete={handleDelete} />
        )}
```

Add the `AgentSettingsTab` component at the bottom of the file, beside `AgentMcpTab` and `HandleRow`:

```tsx
function AgentSettingsTab({
  agent,
  folders,
  onCopyPayload,
  onDuplicate,
  onDelete,
}: {
  agent: AgentRow
  folders: AgentFolderRow[]
  onCopyPayload: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const onFolderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    window.api.agents.update(agent.id, {
      folder_id: value === '__unfiled' ? null : value,
    })
  }
  return (
    <div className="agent-detail-settings-grid">
      <label className="agent-detail-settings-label" htmlFor="agent-settings-folder">Folder</label>
      <div className="agent-detail-settings-field">
        <select
          id="agent-settings-folder"
          value={agent.folder_id ?? '__unfiled'}
          onChange={onFolderChange}
        >
          <option value="__unfiled">Unfiled</option>
          {folders.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="agent-detail-settings-hint">Move this agent into a folder in the sidebar.</div>
      </div>

      <div className="agent-detail-settings-label">Export prompt</div>
      <div className="agent-detail-settings-field">
        <button
          type="button"
          className="agent-detail-settings-btn"
          onClick={onCopyPayload}
        >
          <Copy size={13} /> Copy entire prompt
        </button>
        <div className="agent-detail-settings-hint">
          Copies the full rendered persona markdown to the clipboard — for chats without the MCP server.
        </div>
      </div>

      <div className="agent-detail-settings-label">Manage</div>
      <div className="agent-detail-settings-field">
        <div className="agent-detail-settings-row-actions">
          <button
            type="button"
            className="agent-detail-settings-btn"
            onClick={onDuplicate}
          >
            <CopyPlus size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="agent-detail-settings-btn agent-detail-settings-btn--danger"
            onClick={onDelete}
          >
            <Trash2 size={13} /> Delete agent
          </button>
        </div>
        <div className="agent-detail-settings-hint">
          Duplicate creates a copy with a new handle. Delete cannot be undone.
        </div>
      </div>
    </div>
  )
}
```

Also add the new icon imports near the existing ones:

```tsx
import { CopyPlus, Trash2 } from 'lucide-react'
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Settings tab Folder"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): Settings tab with Folder, Copy entire prompt, Duplicate, Delete"
```

### Task 17: Test — Settings tab "Copy entire prompt" copies persona payload

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the tests**

```tsx
  it('Settings tab "Copy entire prompt" copies the persona payload', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor/)
    expect(payload).toContain('Hello body.')
  })

  it('Settings tab "Copy entire prompt" reflects unsaved textarea edits', async () => {
    setup()
    await waitForLoaded()
    // Edit body on Prompt tab first
    const ta = screen.getByRole('textbox', { name: /Body/ })
    fireEvent.change(ta, { target: { value: 'unsaved draft body' } })
    // Switch to Settings and copy
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toContain('unsaved draft body')
  })
```

- [ ] **Step 2: Run the test (expect pass — button is already wired)**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Settings tab .* Copy entire prompt"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): Settings tab copies persona payload"
```

### Task 18: Test — Settings tab Duplicate and Delete

**Files:**
- Modify: `src/views/AgentDetail.test.tsx`

- [ ] **Step 1: Append the tests**

```tsx
  it('Settings tab Duplicate button calls api.agents.duplicate', async () => {
    ;(window as any).api.agents.duplicate = vi.fn().mockResolvedValue({ id: 'a-dup' })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /duplicate/i }))
    await waitFor(() => expect(window.api.agents.duplicate).toHaveBeenCalledWith('a1'))
  })

  it('Settings tab Delete button confirms and calls api.agents.delete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(window as any).api.agents.delete = vi.fn().mockResolvedValue(undefined)
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete agent/i }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(window.api.agents.delete).toHaveBeenCalledWith('a1'))
    confirmSpy.mockRestore()
  })
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- src/views/AgentDetail.test.tsx -t "Settings tab Duplicate|Settings tab Delete"
```

Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.test.tsx
git commit -m "test(agents): Settings tab duplicate + delete actions"
```

### Task 19: CSS for the Settings tab grid

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Append the Settings-grid rules**

```css
.agent-detail-settings-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 18px 24px;
  max-width: 720px;
  padding: 6px 0;
}
.agent-detail-settings-label {
  font-size: 11px;
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding-top: 8px;
}
.agent-detail-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-detail-settings-field select,
.agent-detail-settings-field input[type="text"] {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 6px 10px;
  color: var(--t1);
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.agent-detail-settings-field select:focus,
.agent-detail-settings-field input[type="text"]:focus {
  border-color: var(--accent-border);
}
.agent-detail-settings-hint {
  font-size: 11px;
  color: var(--t3);
  line-height: 1.5;
}
.agent-detail-settings-row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.agent-detail-settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--t1);
  padding: 6px 12px;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.agent-detail-settings-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border2);
}
.agent-detail-settings-btn--danger {
  color: var(--red-text);
  border-color: var(--red-border);
  background: var(--red-soft);
}
.agent-detail-settings-btn--danger:hover {
  background: rgba(248, 113, 113, 0.12);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): Settings tab grid + buttons"
```

---

## Phase 7: Cleanup

### Task 20: Remove the footer and dead CSS

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Remove the footer JSX**

In `src/views/AgentDetail.tsx`, find the `<footer className="agent-detail-footer">…</footer>` block (around line ~369). Delete it entirely.

Also delete the now-unused state branch — `saveStatus` is still used inside the Prompt tab pill, so keep `saveStatus`, `setSaveStatus`. Do NOT delete `saveStatus` state.

- [ ] **Step 2: Remove dead CSS rules**

In `src/views/AgentDetail.css`, delete these blocks (they are no longer referenced):

- `.agent-detail-footer` (line ~245)
- `.agent-detail-save-status`, `.agent-detail-save-status--saving`, `.agent-detail-save-status--saved` (line ~256)

Verify the `.agent-detail-description` and old `.agent-detail-handle` blocks were already deleted in Task 7. If any remain, delete them now.

- [ ] **Step 3: Run the whole AgentDetail suite**

```bash
npm test -- src/views/AgentDetail.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 4: Run all agent tests as a regression check**

```bash
npm test -- src/components/Agent src/views/Agent
```

Expected: all PASS. If `CreateAgentPanel.test.tsx` or other agent tests fail, the impact is unintended — investigate before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.css
git commit -m "refactor(agents): remove footer + dead CSS after detail-view redesign"
```

### Task 21: Final full-suite verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the whole test suite**

```bash
npm test
```

Expected: all tests PASS. If any test in an unrelated area fails, investigate before declaring done — it may be an unrelated flake or an unintended side effect of the changes.

- [ ] **Step 2: TypeScript check**

```bash
npm run build
```

Or, if `electron-vite build` is heavy, just run the TS check:

```bash
npx tsc --noEmit
```

Expected: clean exit, no type errors.

- [ ] **Step 3: Launch the app and smoke-test the redesigned view**

The user will perform manual UI verification (per their preference — no automated UI/browser testing). Hand back to the user with a short summary of what to look for:

- Hero shows the new gradient + scoped handle + copy icon + Pin
- Tabs have leading icons; Settings is on the right
- Prompt tab textarea is always editable; save pill appears on edit
- Preview tab renders markdown
- Settings tab Folder dropdown, Copy entire prompt, Duplicate, Delete all work
- Swatch click opens emoji + color popover; changes persist

No commit for this task.

---

## Self-Review (already performed by author; the reviewer should re-run on demand)

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Overview | 6, 13, 15, 16 |
| Goals — identity headline | 6, 7 |
| Goals — one-click handle copy | 6, 8 |
| Goals — zero modal edit overhead | 13 |
| Goals — rare actions out of the way | 16, 17, 18 |
| Goals — existing tab style | 10, 11 |
| Goals — Lucide-only icons | 6, 10, 16 |
| Hero background gradient | 7 |
| Swatch button + popover | 2–4, 6 |
| Title double-click rename | 6, 9 |
| Handle row + scope prefix + copy + edit | 6, 8, 9 |
| Meta chips with icons | 6, 7 |
| Pin-only actions column | 6, 7 |
| Tabs with icons + Settings | 10, 11 |
| Prompt tab always editable | 12, 13 |
| Save pill | 13, 14 |
| Preview tab renders markdown | 15 |
| MCP tab unchanged | (no task — unchanged by design) |
| History tab unchanged | (no task — unchanged by design) |
| Settings tab body | 16, 17, 18, 19 |
| Footer removed | 20 |
| AGENT_SCOPE constant | 1 |
| AgentSwatchPopover component | 2 |

**Placeholder scan:** no TBD/TODO/"appropriate"/"similar to". Every step shows the code or command.

**Type consistency:** `AGENT_SCOPE` (string) and `formatScopedHandle` (string → string) are defined in Task 1 and used in Task 6. `AgentSwatchPopover` props (`{ agent: AgentRow }`) defined in Task 2 and used in Task 6. `HandleRow` and `AgentSettingsTab` props are defined inline in the same task that introduces them (Tasks 6 and 16 respectively).

---

## Execution Notes

- **Branch policy:** Per the user's CLAUDE.md, commit directly to `main`. Do not create a feature branch or worktree.
- **Execution style:** This is mostly small, sequential UI/CSS edits touching the same few files. Per the user's CLAUDE.md, **execute inline** with one final `superpowers:code-reviewer` agent pass over the whole diff — do **not** dispatch a subagent per task.
- **Commit hygiene:** Each task ends with a single commit. Keep commit messages in the existing `feat(agents):` / `style(agents):` / `test(agents):` / `refactor(agents):` conventional style.
- **Test command:** Use `npm test`, **not** `npx vitest` — direct vitest leaves `better-sqlite3` built for Node ABI and breaks the Electron launch (per the user's memory note).
- **Visual verification:** The user tests UI changes themselves; do not start a dev server or take screenshots.
