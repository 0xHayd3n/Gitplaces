# Agents Redesign — Phase A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the aesthetic + identity layer of the agents redesign — every agent gets a unique `@handle`, a custom color (solid or gradient) and emoji, and a redesigned detail hero with a one-click Copy button that wraps the prompt in persona-loading framing. No variables/presets, history, MCP, or landing page yet — those are Phases B/C/D.

**Architecture:** Three additive layers on the existing Agents tab. (1) Schema adds new columns to `agents` plus a future-use `agent_revisions` table, with idempotent backfill on first launch. (2) `agentsService` is extended for handle/color/emoji and validation; IPC + preload surface mirrors the changes. (3) `AgentsSidebar` gets a per-row swatch + handle suffix, `AgentDetail` is rewritten around a profile-card hero, and a new `CreateAgentPanel` replaces the in-place create flow with a Customisation section.

**Tech Stack:** Electron (main + renderer split), `better-sqlite3` for the DB, React 18 + react-router-dom v6 for the renderer, Vitest for tests, `react-markdown` + `remark-gfm` for rendered body view. No new runtime dependencies in Phase A.

---

## Spec reference

This plan implements **Phase A** of `docs/superpowers/specs/2026-05-24-agents-library-redesign-design.md`. Read that spec first — this plan assumes familiarity with the data model, UI layouts, and design rationales.

**What Phase A includes:**
- Schema: ALL new columns (`handle`, `color_start`, `color_end`, `emoji`, `pinned`, `pinned_at`, `last_used_at`, `presets_json`) + `agent_revisions` table + indexes + backfill for existing rows.
- Renderer types: extended `AgentRow` plus placeholder `AgentPreset` / `AgentRevision` interfaces.
- `agentsService`: handle generation/validation, color/emoji storage, extended `create`/`update`.
- IPC + preload: extended create/update signatures.
- `AgentsSidebar`: tiny swatch + handle suffix on each row.
- `AgentDetail`: new hero layout (big swatch, `@handle`, name, description, meta chips, Copy/Edit/More buttons). **No tabs yet** — just the hero with the existing rendered/edit body below.
- `CreateAgentPanel`: replaces the existing inline create flow. Includes Name, Handle (auto-filled), and a Customisation section with Solid/Gradient toggle, color picker(s), gradient harmony modes, and emoji picker.
- Copy button: emits `You are @<handle>[, <description>].\n\n<body>` (no variable substitution — preset support comes in Phase B).

**What's NOT in Phase A (deferred):**
- Variables/preset bar (Phase B).
- Edit history snapshots + History tab (Phase C). *Note: the table is created in Phase A's migration so we don't change schema again.*
- MCP launcher script (Phase D).
- AgentsLanding (no-selection state with Pinned + Recent grids) — Phase D.
- Pin/Unpin UI in the More menu (column exists but no UI writes it yet) — Phase D.
- `last_used_at` tracking + `recordUse` IPC — Phase D.

---

## File Structure

### New utility modules (`src/utils/`)

- **`agentSlug.ts`** — pure functions: `slugifyName(name) → handle`, `dedupeHandle(handle, takenHandles[]) → uniqueHandle`, `isValidHandle(handle) → boolean`. No I/O. Used by main process (backfill) and renderer (auto-fill on create).
- **`colorHarmony.ts`** — pure functions: `hexToHsl(hex)`, `hslToHex(h,s,l)`, `applyHarmony(baseHex, mode) → secondHex` for modes `'mono'|'analogous'|'complementary'|'split'|'triadic'|'tetradic'`, `hashHandleToColor(handle) → hex` (deterministic default color from handle for backfill).
- **`copyPayload.ts`** — pure function: `buildPersonaPayload({ handle, description, body }) → string` returning the clipboard string. Phase A version takes no preset/variables; Phase B will extend it.

### New components (`src/components/`)

- **`AgentEmojiPicker.tsx`** — controlled trigger button + popover with a search input and 8-column grid of curated emojis (~200 entries shipped as a static JSON). Exports `interface AgentEmojiPickerProps { value: string | null; onChange: (emoji: string | null) => void }`.
- **`AgentColorPicker.tsx`** — controlled compound picker. Props: `{ mode: 'solid' | 'gradient'; colorStart: string; colorEnd: string | null; harmony: HarmonyMode; onChange: (next: { mode, colorStart, colorEnd, harmony }) => void }`. Renders a solid/gradient toggle, native `<input type="color">` for each color, hex text input(s), gradient preview, and harmony chip row.
- **`CreateAgentPanel.tsx`** — full-page create flow rendered inside the agent detail route (matches the existing `NewAgentPanel`-style pattern from commit `d612bb6`). Composes Name input, Handle input (auto-filled from name), Customisation section (using `AgentEmojiPicker` + `AgentColorPicker`), live preview card, and Cancel/Create footer. Calls `window.api.agents.create(...)` on submit.

### Modified files

- **`electron/db.ts`** — adds the new columns via idempotent `try { ALTER TABLE } catch {}` pattern (consistent with existing migrations), creates `agent_revisions` table, creates new indexes, runs the backfill pass for rows where `handle = ''`.
- **`electron/services/agentsService.ts`** — extends `CreateAgentInput` / `UpdateAgentPatch`, adds handle/color/emoji validation, generates default color from handle if not provided.
- **`electron/services/agentsService.test.ts`** — extended with handle, color, emoji test groups.
- **`electron/ipc/agentHandlers.ts`** — no signature changes (the patch/input types are extended in place), but type imports update.
- **`electron/preload.ts`** — updated argument types for `create` and `update` to include the new fields.
- **`src/types/agent.ts`** — adds the new fields to `AgentRow` and adds placeholder `AgentPreset` / `AgentRevision` interfaces (used in Phase B+).
- **`src/components/AgentsSidebar.tsx`** — adds a 14×14 swatch + `@handle` suffix to each agent row.
- **`src/components/AgentsSidebar.test.tsx`** — extended to assert swatch + handle render.
- **`src/views/AgentDetail.tsx`** — full rewrite around the new hero. The body editor (textarea / rendered toggle) stays but moves below the hero. The folder pill, meta info, Copy/Edit/More actions reorganise into the hero.
- **`src/views/AgentDetail.css`** — full restyle for the hero.
- **`src/views/AgentDetail.test.tsx`** — extended to cover the hero render + new Copy payload format.

---

## Conventions

- **TDD**: write the failing test first, run it, implement, run it again, commit. Every task follows this rhythm.
- **Commits**: one logical change per commit. Conventional-commit style (`feat(agents):`, `refactor(agents):`, etc.) — matches the project's existing style visible in `git log`.
- **Test commands**: use `npm test -- <file>` to scope a single test file. The project's `npm test` recipe runs `npm rebuild better-sqlite3 && vitest run`, which ensures the Node ABI matches what Vitest needs. (Per `~/.claude/CLAUDE.md` memory: do not invoke `npx vitest` directly — it leaves better-sqlite3 built for Node ABI and breaks the Electron launch afterward.)
- **No emoji in code or commit messages** unless the user has asked for them explicitly.

---

## Task 1: Schema migration — add new columns

**Files:**
- Modify: `electron/db.ts:155-175` (the existing agents/agent_folders block) — append new ALTER statements + new table + indexes
- Modify: `electron/db.ts` (end of `initSchema`) — add backfill pass (separate task — see Task 4)
- Test: `electron/db.agents-redesign-migration.test.ts` (new)

This task only handles the schema mutations. The backfill logic for existing rows comes in Task 4.

- [ ] **Step 1: Write the failing test**

Create `electron/db.agents-redesign-migration.test.ts`:

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

describe('agents redesign — schema migration', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('agents table has all new columns', () => {
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('handle')
    expect(names).toContain('color_start')
    expect(names).toContain('color_end')
    expect(names).toContain('emoji')
    expect(names).toContain('pinned')
    expect(names).toContain('pinned_at')
    expect(names).toContain('last_used_at')
    expect(names).toContain('presets_json')
  })

  it('agent_revisions table exists with expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(agent_revisions)`).all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['id', 'agent_id', 'body', 'presets_json', 'summary', 'kind', 'created_at']),
    )
  })

  it('indexes exist for handle (unique), pinned, last_used_at, revisions', () => {
    const idx = db.prepare(`PRAGMA index_list(agents)`).all() as { name: string; unique: number }[]
    expect(idx.find(i => i.name === 'idx_agents_handle')?.unique).toBe(1)
    expect(idx.find(i => i.name === 'idx_agents_pinned')).toBeDefined()
    expect(idx.find(i => i.name === 'idx_agents_last_used')).toBeDefined()

    const revIdx = db.prepare(`PRAGMA index_list(agent_revisions)`).all() as { name: string }[]
    expect(revIdx.find(i => i.name === 'idx_revisions_agent')).toBeDefined()
  })

  it('presets_json defaults to "[]" on new rows', () => {
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at) VALUES ('a1','A','b','t','t')`).run()
    const row = db.prepare(`SELECT presets_json, pinned FROM agents WHERE id='a1'`).get() as any
    expect(row.presets_json).toBe('[]')
    expect(row.pinned).toBe(0)
  })

  it('init is idempotent — running twice does not throw', () => {
    expect(() => initSchema(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/db.agents-redesign-migration.test.ts`
Expected: FAIL — most assertions fail because the columns / table / indexes don't exist yet.

- [ ] **Step 3: Add the ALTER statements + new table + indexes**

Edit `electron/db.ts`. After the `Phase 23 migration — update notifications` block (around line 311) and before the `Post-migration indexes` block (around line 313), insert:

```ts
  // Agents redesign — new columns on existing agents table
  try { db.exec(`ALTER TABLE agents ADD COLUMN handle       TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN color_start  TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN color_end    TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN emoji        TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN pinned       INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN pinned_at    TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN last_used_at TEXT`) } catch {}
  try { db.exec(`ALTER TABLE agents ADD COLUMN presets_json TEXT NOT NULL DEFAULT '[]'`) } catch {}

  // Agents redesign — edit-history snapshots table (writes wired up in Phase C)
  db.exec(`CREATE TABLE IF NOT EXISTS agent_revisions (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    body         TEXT NOT NULL,
    presets_json TEXT NOT NULL,
    summary      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )`)
```

Then in the `Post-migration indexes` block (around line 313), append:

```ts
    CREATE INDEX IF NOT EXISTS idx_agents_pinned    ON agents(pinned, pinned_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agents_last_used ON agents(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_revisions_agent  ON agent_revisions(agent_id, created_at DESC);
```

The UNIQUE index on `handle` is created in Task 4 *after* the backfill, so do **not** add it here yet — the backfill writes valid handles before the unique constraint kicks in.

- [ ] **Step 4: Run test to verify three of four pass (handle index will still be missing)**

Run: `npm test -- electron/db.agents-redesign-migration.test.ts`
Expected: The "indexes exist for handle (unique)..." test still FAILS — that's expected; the unique-handle index is added in Task 4. The other three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.agents-redesign-migration.test.ts
git commit -m "feat(agents): add redesign schema columns + agent_revisions table"
```

---

## Task 2: Utility — `agentSlug.ts`

**Files:**
- Create: `src/utils/agentSlug.ts`
- Test: `src/utils/agentSlug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/agentSlug.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { slugifyName, dedupeHandle, isValidHandle } from './agentSlug'

describe('slugifyName', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyName('Code Investigator')).toBe('code-investigator')
  })

  it('collapses repeated whitespace into a single dash', () => {
    expect(slugifyName('Email   Drafter')).toBe('email-drafter')
  })

  it('strips characters outside [a-z0-9-]', () => {
    expect(slugifyName('Hey! Therapist?')).toBe('hey-therapist')
  })

  it('trims leading/trailing dashes', () => {
    expect(slugifyName('  --hello-- ')).toBe('hello')
  })

  it('falls back to "untitled-agent" for empty/whitespace-only input', () => {
    expect(slugifyName('')).toBe('untitled-agent')
    expect(slugifyName('   ')).toBe('untitled-agent')
    expect(slugifyName('!!!')).toBe('untitled-agent')
  })

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100)
    expect(slugifyName(long).length).toBe(64)
  })
})

describe('dedupeHandle', () => {
  it('returns input when no collision', () => {
    expect(dedupeHandle('foo', ['bar', 'baz'])).toBe('foo')
  })

  it('appends -2 on first collision', () => {
    expect(dedupeHandle('foo', ['foo'])).toBe('foo-2')
  })

  it('keeps incrementing until unused', () => {
    expect(dedupeHandle('foo', ['foo', 'foo-2', 'foo-3'])).toBe('foo-4')
  })

  it('handles a base that already ends with a numeric suffix', () => {
    expect(dedupeHandle('agent-1', ['agent-1'])).toBe('agent-1-2')
  })

  it('is case-insensitive against the taken set', () => {
    expect(dedupeHandle('Foo', ['foo'])).toBe('foo-2')
  })
})

describe('isValidHandle', () => {
  it('accepts lowercase letters, digits, dashes', () => {
    expect(isValidHandle('foo-bar-2')).toBe(true)
    expect(isValidHandle('a')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidHandle('')).toBe(false)
  })

  it('rejects uppercase, spaces, special chars', () => {
    expect(isValidHandle('Foo')).toBe(false)
    expect(isValidHandle('foo bar')).toBe(false)
    expect(isValidHandle('foo!')).toBe(false)
  })

  it('rejects leading dash', () => {
    expect(isValidHandle('-foo')).toBe(false)
  })

  it('rejects > 64 chars', () => {
    expect(isValidHandle('a'.repeat(65))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/agentSlug.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agentSlug.ts`**

Create `src/utils/agentSlug.ts`:

```ts
const HANDLE_MAX = 64
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slugifyName(name: string): string {
  const lower = name.toLowerCase()
  const cleaned = lower
    .replace(/[^a-z0-9]+/g, '-')  // any run of non-alphanumeric → single dash
    .replace(/^-+|-+$/g, '')      // trim leading/trailing dashes
  if (cleaned.length === 0) return 'untitled-agent'
  return cleaned.slice(0, HANDLE_MAX)
}

export function dedupeHandle(handle: string, taken: readonly string[]): string {
  const lowerTaken = new Set(taken.map(h => h.toLowerCase()))
  const base = handle.toLowerCase()
  if (!lowerTaken.has(base)) return base
  let i = 2
  while (lowerTaken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/agentSlug.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/agentSlug.ts src/utils/agentSlug.test.ts
git commit -m "feat(agents): add slug + handle utilities"
```

---

## Task 3: Utility — `colorHarmony.ts`

**Files:**
- Create: `src/utils/colorHarmony.ts`
- Test: `src/utils/colorHarmony.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/colorHarmony.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hexToHsl, hslToHex, applyHarmony, hashHandleToColor, type HarmonyMode } from './colorHarmony'

describe('hexToHsl / hslToHex', () => {
  it('round-trips pure red', () => {
    const hsl = hexToHsl('#ff0000')
    expect(hsl.h).toBe(0)
    expect(hsl.s).toBe(100)
    expect(hsl.l).toBe(50)
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe('#ff0000')
  })

  it('round-trips a non-trivial color (#6366f1, indigo-500)', () => {
    const hsl = hexToHsl('#6366f1')
    const back = hslToHex(hsl.h, hsl.s, hsl.l)
    expect(back.toLowerCase()).toBe('#6366f1')
  })

  it('handles white / black at HSL boundaries', () => {
    expect(hexToHsl('#ffffff').l).toBe(100)
    expect(hexToHsl('#000000').l).toBe(0)
  })

  it('hexToHsl accepts uppercase and missing #', () => {
    expect(hexToHsl('FF0000')).toEqual(hexToHsl('#ff0000'))
  })
})

describe('applyHarmony', () => {
  const base = '#6366f1'  // indigo

  it('complementary shifts hue by 180°', () => {
    const result = applyHarmony(base, 'complementary')
    const { h: bh } = hexToHsl(base)
    const { h: rh } = hexToHsl(result)
    expect(Math.abs(((rh - bh) + 360) % 360 - 180)).toBeLessThanOrEqual(1)
  })

  it('analogous shifts hue by 30°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'analogous'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(30, 0)
  })

  it('triadic shifts hue by 120°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'triadic'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(120, 0)
  })

  it('split-complementary shifts hue by 150°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'split'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(150, 0)
  })

  it('tetradic shifts hue by 90°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'tetradic'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(90, 0)
  })

  it('monochromatic keeps hue + saturation, shifts lightness by +25 (clamped)', () => {
    const { h: bh, s: bs, l: bl } = hexToHsl(base)
    const { h: rh, s: rs, l: rl } = hexToHsl(applyHarmony(base, 'mono'))
    expect(rh).toBeCloseTo(bh, 0)
    expect(rs).toBeCloseTo(bs, 0)
    expect(rl).toBeCloseTo(Math.min(100, bl + 25), 0)
  })

  it('returns base unchanged for unknown harmony (defensive)', () => {
    const result = applyHarmony(base, 'unknown' as HarmonyMode)
    expect(result.toLowerCase()).toBe(base.toLowerCase())
  })
})

describe('hashHandleToColor', () => {
  it('returns the same color for the same handle', () => {
    expect(hashHandleToColor('reviewer')).toBe(hashHandleToColor('reviewer'))
  })

  it('different handles produce different hues', () => {
    const a = hashHandleToColor('reviewer')
    const b = hashHandleToColor('investigator')
    expect(a).not.toBe(b)
  })

  it('returns a valid hex string', () => {
    expect(hashHandleToColor('any-handle')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/colorHarmony.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `colorHarmony.ts`**

Create `src/utils/colorHarmony.ts`:

```ts
export type HarmonyMode =
  | 'manual'
  | 'mono'
  | 'analogous'
  | 'complementary'
  | 'split'
  | 'triadic'
  | 'tetradic'

export interface Hsl { h: number; s: number; l: number }

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace(/^#/, '').toLowerCase()
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360
  const ss = Math.max(0, Math.min(100, s)) / 100
  const ll = Math.max(0, Math.min(100, l)) / 100

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  let r: number, g: number, b: number
  if (ss === 0) {
    r = g = b = ll
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
    const p = 2 * ll - q
    r = hue2rgb(p, q, hh + 1 / 3)
    g = hue2rgb(p, q, hh)
    b = hue2rgb(p, q, hh - 1 / 3)
  }

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const HUE_SHIFT: Record<HarmonyMode, number | null> = {
  manual:         null,  // caller picks freely
  mono:           0,
  analogous:      30,
  complementary:  180,
  split:          150,
  triadic:        120,
  tetradic:       90,
}

export function applyHarmony(baseHex: string, mode: HarmonyMode): string {
  const shift = HUE_SHIFT[mode]
  if (shift === null || shift === undefined) return baseHex
  const { h, s, l } = hexToHsl(baseHex)
  if (mode === 'mono') {
    return hslToHex(h, s, Math.min(100, l + 25))
  }
  return hslToHex(h + shift, s, l)
}

// Deterministic default color for an agent given its handle (used by backfill
// and by the create flow as the initial swatch suggestion).
export function hashHandleToColor(handle: string): string {
  let hash = 5381
  for (let i = 0; i < handle.length; i++) {
    hash = ((hash << 5) + hash + handle.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 65, 55)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/colorHarmony.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/colorHarmony.ts src/utils/colorHarmony.test.ts
git commit -m "feat(agents): add color harmony utilities (hex/hsl, modes, default color)"
```

---

## Task 4: Schema backfill for existing agent rows

**Files:**
- Modify: `electron/db.ts` (append backfill after the new columns)
- Test: extend `electron/db.agents-redesign-migration.test.ts`

This task adds the backfill logic and the UNIQUE index on `handle`. The backfill is a one-time scan: any row where `handle = ''` gets a generated handle, default color, and a `create` revision snapshot.

- [ ] **Step 1: Add the backfill test**

Append to `electron/db.agents-redesign-migration.test.ts`:

```ts
describe('agents redesign — backfill', () => {
  function dbWithPreRedesignRow(): Database.Database {
    const db = new Database(':memory:')
    // Initialise to the post-redesign schema, then deliberately reset handle to
    // '' to simulate a row that existed before the redesign.
    initSchema(db)
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a1', 'Agent 1', '# A1', 't', 't')
    db.prepare(`UPDATE agents SET handle = '' WHERE id = 'a1'`).run()
    return db
  }

  it('backfill assigns a handle derived from the name', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const row = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    expect(row.handle).toBe('agent-1')
  })

  it('backfill assigns a color_start derived from the handle', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const row = db.prepare(`SELECT color_start, color_end FROM agents WHERE id='a1'`).get() as any
    expect(row.color_start).toMatch(/^#[0-9a-f]{6}$/)
    expect(row.color_end).toBeNull()
  })

  it('backfill is idempotent — running initSchema again does not change handles', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const first = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    initSchema(db)
    const second = db.prepare(`SELECT handle FROM agents WHERE id='a1'`).get() as any
    expect(second.handle).toBe(first.handle)
  })

  it('backfill dedupes collisions across multiple rows', () => {
    const db = new Database(':memory:')
    initSchema(db)
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a1', 'Hello', '#', 't', 't')
    db.prepare(`INSERT INTO agents (id, name, body, created_at, updated_at)
                VALUES (?,?,?,?,?)`).run('a2', 'Hello', '#', 't', 't')
    db.prepare(`UPDATE agents SET handle = ''`).run()
    initSchema(db)
    const handles = (db.prepare(`SELECT handle FROM agents ORDER BY id`).all() as any[]).map(r => r.handle)
    expect(handles[0]).toBe('hello')
    expect(handles[1]).toBe('hello-2')
  })

  it('UNIQUE index on handle is created (post-backfill)', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const idx = db.prepare(`PRAGMA index_list(agents)`).all() as { name: string; unique: number }[]
    expect(idx.find(i => i.name === 'idx_agents_handle')?.unique).toBe(1)
  })

  it('backfill inserts an initial "create" revision for each existing agent', () => {
    const db = dbWithPreRedesignRow()
    initSchema(db)
    const revs = db.prepare(`SELECT kind, body, agent_id FROM agent_revisions WHERE agent_id='a1'`).all() as any[]
    expect(revs.length).toBe(1)
    expect(revs[0].kind).toBe('create')
    expect(revs[0].body).toBe('# A1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/db.agents-redesign-migration.test.ts`
Expected: FAIL — backfill assertions fail (no handle generated, no UNIQUE index, no revisions).

- [ ] **Step 3: Implement the backfill in `db.ts`**

In `electron/db.ts`, immediately after the new ALTER TABLE statements + the `agent_revisions` table creation (added in Task 1), insert:

```ts
  // Agents redesign — backfill pass for rows that pre-existed the redesign.
  // Idempotent: only touches rows where handle = ''.
  {
    const needsBackfill = db
      .prepare(`SELECT id, name, body FROM agents WHERE handle = ''`)
      .all() as { id: string; name: string; body: string }[]

    if (needsBackfill.length > 0) {
      // Import lazily so tests that mock the renderer side aren't affected.
      // (Pure functions — no Electron imports.)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { slugifyName, dedupeHandle } = require('../src/utils/agentSlug') as typeof import('../src/utils/agentSlug')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hashHandleToColor } = require('../src/utils/colorHarmony') as typeof import('../src/utils/colorHarmony')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { randomUUID } = require('node:crypto') as typeof import('node:crypto')

      // Existing taken handles (across the whole table — not just the needs-backfill subset)
      const taken = new Set<string>(
        (db.prepare(`SELECT handle FROM agents WHERE handle <> ''`).all() as { handle: string }[])
          .map(r => r.handle),
      )

      const updateHandle = db.prepare(
        `UPDATE agents SET handle = ?, color_start = ?, color_end = NULL WHERE id = ?`,
      )
      const insertRevision = db.prepare(
        `INSERT INTO agent_revisions (id, agent_id, body, presets_json, summary, kind, created_at)
         VALUES (?, ?, ?, '[]', ?, 'create', ?)`,
      )

      const txn = db.transaction(() => {
        const nowIso = new Date().toISOString()
        for (const row of needsBackfill) {
          const slug = slugifyName(row.name)
          const handle = dedupeHandle(slug, Array.from(taken))
          taken.add(handle)
          const colorStart = hashHandleToColor(handle)
          updateHandle.run(handle, colorStart, row.id)
          insertRevision.run(randomUUID(), row.id, row.body, 'Initial agent', nowIso)
        }
      })
      txn()
    }
  }

  // UNIQUE index added AFTER backfill so duplicates can't violate it mid-migration.
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_handle ON agents(handle)`) } catch {}
```

A note on the `require()` calls: they're a workaround for the asymmetry between this main-process module (CommonJS at compile time via electron-vite) and the renderer-side TypeScript source. If the project's build setup already supports ESM-style imports here, replace with `import` statements at the top of the file. Check by running the test — if `require` resolves to a usable module, it works; otherwise switch to top-of-file imports of `slugifyName`, `dedupeHandle`, and `hashHandleToColor` from `'../src/utils/agentSlug'` and `'../src/utils/colorHarmony'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/db.agents-redesign-migration.test.ts`
Expected: PASS — all backfill + index + revision assertions green.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/db.agents-redesign-migration.test.ts
git commit -m "feat(agents): backfill handle/color + initial revision for pre-redesign rows"
```

---

## Task 5: Renderer types — extend `AgentRow`, add placeholders

**Files:**
- Modify: `src/types/agent.ts`

- [ ] **Step 1: Update the type definitions**

Replace the contents of `src/types/agent.ts` with:

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
  handle: string                   // unique, kebab-case, no leading '@'
  body: string
  folder_id: string | null
  color_start: string | null       // e.g. '#6366f1'
  color_end:   string | null       // null = solid swatch
  emoji:       string | null
  pinned:      0 | 1
  pinned_at:   string | null
  last_used_at: string | null
  presets_json: string             // raw JSON; parse with parseAgentPresets()
  created_at: string
  updated_at: string
}

// Phase B+ uses these. Defined now so the AgentRevision interface for Phase C
// is also in place — avoids type churn between phases.
export interface AgentPreset {
  id:    string
  name:  string
  slug:  string
  values: Record<string, string>
}

export interface AgentRevision {
  id:       string
  agent_id: string
  body:     string
  presets:  AgentPreset[]
  summary:  string
  kind:     'create' | 'body_edit' | 'preset_change' | 'revert'
  created_at: string
}

export function parseAgentPresets(json: string): AgentPreset[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed as AgentPreset[] : []
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit`
Expected: Either passes, or fails ONLY in spots that depend on the new fields (existing code that destructures `AgentRow` without picking the new fields should still compile because the new fields are additive). If unrelated errors surface, leave them for later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/agent.ts
git commit -m "feat(agents): extend AgentRow with handle/color/emoji + add Preset/Revision types"
```

---

## Task 6: `agentsService` — handle + color/emoji on create

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts` (extend)

- [ ] **Step 1: Add failing tests for the new create signature**

Append to `electron/services/agentsService.test.ts`:

```ts
describe('agentsService — agents (handle/color/emoji)', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('createAgent accepts handle/colorStart/colorEnd/emoji and persists them', () => {
    const a = createAgent(db, {
      name: 'Reviewer',
      body: '',
      folderId: null,
      handle: 'reviewer',
      colorStart: '#6366f1',
      colorEnd: '#a855f7',
      emoji: '🔍',
    })
    expect(a.handle).toBe('reviewer')
    expect(a.color_start).toBe('#6366f1')
    expect(a.color_end).toBe('#a855f7')
    expect(a.emoji).toBe('🔍')
  })

  it('createAgent uses solid swatch when colorEnd is null', () => {
    const a = createAgent(db, {
      name: 'Solid',
      body: '',
      folderId: null,
      handle: 'solid',
      colorStart: '#10b981',
      colorEnd: null,
      emoji: null,
    })
    expect(a.color_end).toBeNull()
    expect(a.emoji).toBeNull()
  })

  it('createAgent rejects invalid handle', () => {
    expect(() => createAgent(db, {
      name: 'X', body: '', folderId: null,
      handle: 'Bad Handle!',
      colorStart: '#000000', colorEnd: null, emoji: null,
    })).toThrow(/handle/i)
  })

  it('createAgent rejects duplicate handle', () => {
    createAgent(db, { name: 'A', body: '', folderId: null, handle: 'taken', colorStart: '#000000', colorEnd: null, emoji: null })
    expect(() => createAgent(db, {
      name: 'B', body: '', folderId: null, handle: 'taken', colorStart: '#000000', colorEnd: null, emoji: null,
    })).toThrow(/handle/i)
  })

  it('updateAgent can change handle when no conflict', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'aaa', colorStart: '#000000', colorEnd: null, emoji: null })
    const updated = updateAgent(db, a.id, { handle: 'bbb' })
    expect(updated.handle).toBe('bbb')
  })

  it('updateAgent rejects handle that conflicts with another agent', () => {
    createAgent(db, { name: 'A', body: '', folderId: null, handle: 'aaa', colorStart: '#000000', colorEnd: null, emoji: null })
    const b = createAgent(db, { name: 'B', body: '', folderId: null, handle: 'bbb', colorStart: '#000000', colorEnd: null, emoji: null })
    expect(() => updateAgent(db, b.id, { handle: 'aaa' })).toThrow(/handle/i)
  })

  it('updateAgent accepts color/emoji patches', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    const updated = updateAgent(db, a.id, { colorStart: '#ffffff', colorEnd: '#000000', emoji: '🌟' })
    expect(updated.color_start).toBe('#ffffff')
    expect(updated.color_end).toBe('#000000')
    expect(updated.emoji).toBe('🌟')
  })

  it('updateAgent accepts pinned boolean and converts to 0/1 + sets pinned_at', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'a', colorStart: '#000000', colorEnd: null, emoji: null })
    const pinned = updateAgent(db, a.id, { pinned: true })
    expect(pinned.pinned).toBe(1)
    expect(pinned.pinned_at).toMatch(/T/)
    const unpinned = updateAgent(db, a.id, { pinned: false })
    expect(unpinned.pinned).toBe(0)
    // pinned_at is preserved on unpin
    expect(unpinned.pinned_at).toBe(pinned.pinned_at)
  })

  it('duplicateAgent generates a unique handle by appending -2 etc.', () => {
    const a = createAgent(db, { name: 'A', body: '', folderId: null, handle: 'foo', colorStart: '#000000', colorEnd: null, emoji: null })
    const dup = duplicateAgent(db, a.id)
    expect(dup.handle).toBe('foo-2')
    const dup2 = duplicateAgent(db, a.id)
    expect(dup2.handle).toBe('foo-3')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — TypeScript errors on the new `handle`/`colorStart`/etc. fields plus runtime mismatches.

- [ ] **Step 3: Update `agentsService.ts`**

Replace the existing `CreateAgentInput`, `UpdateAgentPatch`, `createAgent`, `updateAgent`, and `duplicateAgent` definitions with:

```ts
import { isValidHandle, dedupeHandle } from '../../src/utils/agentSlug'

const HEX_RE = /^#[0-9a-f]{6}$/i

function assertValidHandle(handle: string): void {
  if (!isValidHandle(handle)) throw new Error(`Invalid handle: ${JSON.stringify(handle)}`)
}

function assertValidHex(label: string, hex: string): void {
  if (!HEX_RE.test(hex)) throw new Error(`${label} must be a hex color, got ${JSON.stringify(hex)}`)
}

function assertHandleUnique(db: Database.Database, handle: string, exceptId?: string): void {
  const row = exceptId
    ? db.prepare(`SELECT id FROM agents WHERE handle = ? AND id <> ?`).get(handle, exceptId)
    : db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(handle)
  if (row) throw new Error(`Handle already in use: ${handle}`)
}

export interface CreateAgentInput {
  name: string
  body: string
  folderId: string | null
  handle: string
  colorStart: string
  colorEnd: string | null
  emoji: string | null
}

export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const name = normaliseName(input.name)
  assertNameLen(name)
  assertBodyLen(input.body)
  if (input.folderId !== null) assertFolderExists(db, input.folderId)

  assertValidHandle(input.handle)
  assertHandleUnique(db, input.handle)
  assertValidHex('colorStart', input.colorStart)
  if (input.colorEnd !== null) assertValidHex('colorEnd', input.colorEnd)

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(`
    INSERT INTO agents (id, name, handle, body, folder_id, color_start, color_end, emoji, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.handle, input.body, input.folderId, input.colorStart, input.colorEnd, input.emoji, ts, ts)
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow
}

export interface UpdateAgentPatch {
  name?: string
  body?: string
  folderId?: string | null
  handle?: string
  colorStart?: string
  colorEnd?: string | null
  emoji?: string | null
  pinned?: boolean
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
    sets.push('name = ?'); params.push(name)
  }
  if (patch.body !== undefined) {
    assertBodyLen(patch.body)
    sets.push('body = ?'); params.push(patch.body)
  }
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) assertFolderExists(db, patch.folderId)
    sets.push('folder_id = ?'); params.push(patch.folderId)
  }
  if (patch.handle !== undefined) {
    assertValidHandle(patch.handle)
    assertHandleUnique(db, patch.handle, id)
    sets.push('handle = ?'); params.push(patch.handle)
  }
  if (patch.colorStart !== undefined) {
    assertValidHex('colorStart', patch.colorStart)
    sets.push('color_start = ?'); params.push(patch.colorStart)
  }
  if (patch.colorEnd !== undefined) {
    if (patch.colorEnd !== null) assertValidHex('colorEnd', patch.colorEnd)
    sets.push('color_end = ?'); params.push(patch.colorEnd)
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?'); params.push(patch.emoji)
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?'); params.push(patch.pinned ? 1 : 0)
    if (patch.pinned) {
      sets.push('pinned_at = ?'); params.push(nowIso())
    }
    // when unpinning, leave pinned_at alone (preserved for re-pin UX)
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?'); params.push(nowIso())
    params.push(id)
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!row) throw new Error(`Unknown agent id: ${id}`)
  return row
}

export function duplicateAgent(db: Database.Database, id: string): AgentRow {
  const src = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!src) throw new Error(`Unknown agent id: ${id}`)
  const suffix = ' (copy)'
  const baseName = src.name.length + suffix.length > AGENT_NAME_MAX
    ? src.name.slice(0, AGENT_NAME_MAX - suffix.length)
    : src.name

  const taken = (db.prepare(`SELECT handle FROM agents`).all() as { handle: string }[]).map(r => r.handle)
  const dupHandle = dedupeHandle(src.handle, taken)

  return createAgent(db, {
    name: `${baseName}${suffix}`,
    body: src.body,
    folderId: src.folder_id,
    handle: dupHandle,
    colorStart: src.color_start ?? '#888888',
    colorEnd: src.color_end,
    emoji: src.emoji,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — old tests still green, new tests for handle/color/emoji green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): handle + color/emoji + pinned in agentsService"
```

---

## Task 7: IPC + preload extensions

**Files:**
- Modify: `electron/ipc/agentHandlers.ts` (no signature change, just type imports — verify)
- Modify: `electron/preload.ts:172-175` (update `create` + `update` argument shapes)

- [ ] **Step 1: Update preload signatures**

In `electron/preload.ts`, replace lines 172-175 (the agent `create` and `update` definitions):

```ts
    create: (input: {
      name: string
      body: string
      folderId: string | null
      handle: string
      colorStart: string
      colorEnd: string | null
      emoji: string | null
    }) =>
      ipcRenderer.invoke('agents:create', input) as Promise<import('../src/types/agent').AgentRow>,
    update: (id: string, patch: {
      name?: string
      body?: string
      folderId?: string | null
      handle?: string
      colorStart?: string
      colorEnd?: string | null
      emoji?: string | null
      pinned?: boolean
    }) =>
      ipcRenderer.invoke('agents:update', id, patch) as Promise<import('../src/types/agent').AgentRow>,
```

- [ ] **Step 2: Verify the IPC handlers don't need code changes**

Open `electron/ipc/agentHandlers.ts`. The handlers use `CreateAgentInput` / `UpdateAgentPatch` from `../services/agentsService` — those interfaces were updated in Task 6 so the IPC layer is type-safe automatically. No code change needed. Run:

```bash
npx tsc --noEmit
```

Expected: PASS. If TS complains about the IPC handler return types or arg types, fix the imports.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(agents): extend preload create/update with handle/color/emoji/pinned"
```

---

## Task 8: Utility — `copyPayload.ts`

**Files:**
- Create: `src/utils/copyPayload.ts`
- Test: `src/utils/copyPayload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/copyPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPersonaPayload, deriveDescription } from './copyPayload'

describe('deriveDescription', () => {
  it('returns the first non-heading line after the H1', () => {
    expect(deriveDescription('# Title\n\nThis is the agent description.\n\nMore body.'))
      .toBe('This is the agent description.')
  })

  it('returns the first non-empty line when there is no H1', () => {
    expect(deriveDescription('Just a paragraph here.\n\nNext.'))
      .toBe('Just a paragraph here.')
  })

  it('skips blank lines', () => {
    expect(deriveDescription('# Title\n\n\n\nLine after blanks.'))
      .toBe('Line after blanks.')
  })

  it('returns empty string when body has only headings/blanks', () => {
    expect(deriveDescription('# Only\n\n## Headings\n\n')).toBe('')
  })

  it('strips simple markdown formatting from the description', () => {
    expect(deriveDescription('# Title\n\n**bold** and *italic* here.'))
      .toBe('bold and italic here.')
  })

  it('truncates very long descriptions to 200 chars', () => {
    const long = 'x'.repeat(500)
    expect(deriveDescription(long).length).toBeLessThanOrEqual(200)
  })
})

describe('buildPersonaPayload', () => {
  it('includes the @handle in the framing line', () => {
    const out = buildPersonaPayload({ handle: 'investigator', description: 'A meticulous code investigator.', body: '# Investigator\n\nBody here.' })
    expect(out.startsWith('You are @investigator, A meticulous code investigator.')).toBe(true)
  })

  it('omits the description when empty', () => {
    const out = buildPersonaPayload({ handle: 'foo', description: '', body: 'Body.' })
    expect(out.startsWith('You are @foo.\n\n')).toBe(true)
  })

  it('appends the body verbatim after the framing line + blank line', () => {
    const out = buildPersonaPayload({ handle: 'a', description: 'd', body: 'Line 1\nLine 2' })
    expect(out).toBe('You are @a, d.\n\nLine 1\nLine 2')
  })

  it('handles a description that already ends in punctuation gracefully', () => {
    const out = buildPersonaPayload({ handle: 'a', description: 'A description.', body: 'body' })
    expect(out.startsWith('You are @a, A description.\n\n')).toBe(true)  // no double-period
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/copyPayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `copyPayload.ts`**

Create `src/utils/copyPayload.ts`:

```ts
const DESCRIPTION_MAX = 200

export function deriveDescription(body: string): string {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    // Strip simple markdown formatting (bold, italic, code, links)
    const cleaned = trimmed
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    return cleaned.length > DESCRIPTION_MAX ? cleaned.slice(0, DESCRIPTION_MAX - 1) + '…' : cleaned
  }
  return ''
}

export interface PersonaPayloadInput {
  handle: string             // without leading '@'
  description: string        // already trimmed; may be empty
  body: string
}

export function buildPersonaPayload(input: PersonaPayloadInput): string {
  const { handle, description, body } = input
  const framing = description.length > 0
    ? `You are @${handle}, ${stripTrailingPunct(description)}.`
    : `You are @${handle}.`
  return `${framing}\n\n${body}`
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/copyPayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/copyPayload.ts src/utils/copyPayload.test.ts
git commit -m "feat(agents): add deriveDescription + buildPersonaPayload utilities"
```

---

## Task 9: `AgentEmojiPicker` component

**Files:**
- Create: `src/components/AgentEmojiPicker.tsx`
- Create: `src/components/AgentEmojiPicker.test.tsx`
- Create: `src/components/agentEmojiSet.ts` (curated emoji JSON)

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentEmojiPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentEmojiPicker from './AgentEmojiPicker'

describe('AgentEmojiPicker', () => {
  it('renders the current emoji on the trigger button', () => {
    render(<AgentEmojiPicker value="🔍" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /emoji/i }).textContent).toContain('🔍')
  })

  it('shows a default glyph when value is null', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /emoji/i })
    expect(btn.textContent?.length ?? 0).toBeGreaterThan(0)
  })

  it('opens the popover on click and shows emoji choices', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    // popover renders multiple emoji buttons; at least one should be a known curated entry
    const allButtons = screen.getAllByRole('button')
    const emojiButtons = allButtons.filter(b => b.getAttribute('data-emoji'))
    expect(emojiButtons.length).toBeGreaterThan(50)
  })

  it('emits onChange with the selected emoji', () => {
    const onChange = vi.fn()
    render(<AgentEmojiPicker value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    const target = screen.getAllByRole('button').find(b => b.getAttribute('data-emoji') === '🔍')!
    fireEvent.click(target)
    expect(onChange).toHaveBeenCalledWith('🔍')
  })

  it('filters by search input', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'search' } })
    const matches = screen.getAllByRole('button').filter(b => b.getAttribute('data-emoji'))
    // 🔍 has the keyword "search"; we expect at least it to remain
    expect(matches.some(b => b.getAttribute('data-emoji') === '🔍')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentEmojiPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the curated emoji set**

Create `src/components/agentEmojiSet.ts`:

```ts
export interface CuratedEmoji {
  emoji: string
  keywords: string[]
}

// ~150 emojis useful for AI-agent identities. Keywords drive the search filter.
export const AGENT_EMOJIS: CuratedEmoji[] = [
  { emoji: '🔍', keywords: ['search', 'investigate', 'find'] },
  { emoji: '⚡', keywords: ['fast', 'energy', 'quick'] },
  { emoji: '🩺', keywords: ['health', 'doctor', 'therapist'] },
  { emoji: '📋', keywords: ['plan', 'list', 'clipboard'] },
  { emoji: '✉️', keywords: ['email', 'mail', 'message'] },
  { emoji: '🐛', keywords: ['bug', 'debug', 'error'] },
  { emoji: '🎯', keywords: ['target', 'goal', 'focus'] },
  { emoji: '🧠', keywords: ['think', 'brain', 'mind'] },
  { emoji: '📚', keywords: ['books', 'library', 'docs'] },
  { emoji: '🪄', keywords: ['magic', 'wand', 'wizard'] },
  { emoji: '⚙️', keywords: ['settings', 'gear', 'config'] },
  { emoji: '🎨', keywords: ['art', 'design', 'paint'] },
  { emoji: '💡', keywords: ['idea', 'light', 'insight'] },
  { emoji: '🌟', keywords: ['star', 'special', 'favorite'] },
  { emoji: '🔥', keywords: ['fire', 'hot', 'urgent'] },
  { emoji: '🚀', keywords: ['rocket', 'launch', 'fast'] },
  { emoji: '👁️', keywords: ['watch', 'observe', 'eye'] },
  { emoji: '🤖', keywords: ['robot', 'ai', 'bot'] },
  { emoji: '📝', keywords: ['note', 'write', 'memo'] },
  { emoji: '🎭', keywords: ['drama', 'role', 'persona'] },
  { emoji: '🗂️', keywords: ['organize', 'sort', 'files'] },
  { emoji: '⏱️', keywords: ['time', 'fast', 'timer'] },
  { emoji: '🧩', keywords: ['puzzle', 'solve', 'piece'] },
  { emoji: '🛠️', keywords: ['tools', 'build', 'fix'] },
  { emoji: '📊', keywords: ['chart', 'data', 'analytics'] },
  { emoji: '🎓', keywords: ['teach', 'tutor', 'graduate'] },
  { emoji: '🏗️', keywords: ['architecture', 'build', 'construct'] },
  { emoji: '🔧', keywords: ['fix', 'wrench', 'repair'] },
  { emoji: '🧪', keywords: ['experiment', 'test', 'science'] },
  { emoji: '⚖️', keywords: ['judge', 'balance', 'fair'] },
  { emoji: '🗣️', keywords: ['speak', 'talk', 'voice'] },
  { emoji: '👂', keywords: ['listen', 'hear', 'ear'] },
  { emoji: '🧭', keywords: ['compass', 'direction', 'guide'] },
  { emoji: '🗺️', keywords: ['map', 'navigate', 'explore'] },
  { emoji: '📦', keywords: ['package', 'box', 'ship'] },
  { emoji: '🌱', keywords: ['grow', 'start', 'beginner'] },
  { emoji: '🌳', keywords: ['tree', 'nature', 'structure'] },
  { emoji: '🌊', keywords: ['wave', 'flow', 'ocean'] },
  { emoji: '🔮', keywords: ['predict', 'future', 'crystal'] },
  { emoji: '📐', keywords: ['precise', 'measure', 'design'] },
  { emoji: '🪙', keywords: ['money', 'cost', 'coin'] },
  { emoji: '⏰', keywords: ['alarm', 'time', 'remind'] },
  { emoji: '🧹', keywords: ['clean', 'sweep', 'tidy'] },
  { emoji: '🪞', keywords: ['mirror', 'reflect', 'self'] },
  { emoji: '🧱', keywords: ['build', 'brick', 'foundation'] },
  { emoji: '🪜', keywords: ['ladder', 'step', 'climb'] },
  { emoji: '🎁', keywords: ['gift', 'surprise', 'present'] },
  { emoji: '🪧', keywords: ['sign', 'announce', 'notice'] },
  { emoji: '🧰', keywords: ['toolbox', 'kit', 'utility'] },
  { emoji: '🗒️', keywords: ['notepad', 'jot', 'note'] },
]
```

- [ ] **Step 4: Implement the picker component**

Create `src/components/AgentEmojiPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { AGENT_EMOJIS } from './agentEmojiSet'

interface Props {
  value: string | null
  onChange: (emoji: string | null) => void
}

const DEFAULT_GLYPH = '🎭'

export default function AgentEmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const query = q.trim().toLowerCase()
  const filtered = query
    ? AGENT_EMOJIS.filter(e => e.keywords.some(k => k.includes(query)))
    : AGENT_EMOJIS

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label="Emoji"
        onClick={() => setOpen(o => !o)}
        className="agent-emoji-trigger"
      >
        {value ?? DEFAULT_GLYPH}
      </button>
      {open && (
        <div ref={popoverRef} className="agent-emoji-popover" role="dialog" aria-label="Pick emoji">
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="search emoji…"
            autoFocus
            className="agent-emoji-search"
          />
          <div className="agent-emoji-grid">
            {filtered.map(e => (
              <button
                key={e.emoji}
                type="button"
                data-emoji={e.emoji}
                onClick={() => { onChange(e.emoji); setOpen(false) }}
                className={`agent-emoji-cell${e.emoji === value ? ' selected' : ''}`}
              >
                {e.emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="agent-emoji-clear"
              data-emoji="__clear__"
            >
              ✕ clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/AgentEmojiPicker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentEmojiPicker.tsx src/components/AgentEmojiPicker.test.tsx src/components/agentEmojiSet.ts
git commit -m "feat(agents): AgentEmojiPicker with searchable curated set"
```

---

## Task 10: `AgentColorPicker` component

**Files:**
- Create: `src/components/AgentColorPicker.tsx`
- Create: `src/components/AgentColorPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentColorPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentColorPicker, { type AgentColorPickerProps } from './AgentColorPicker'

function setup(overrides: Partial<AgentColorPickerProps> = {}) {
  const onChange = vi.fn()
  const props: AgentColorPickerProps = {
    mode: 'solid',
    colorStart: '#6366f1',
    colorEnd: null,
    harmony: 'manual',
    onChange,
    ...overrides,
  }
  render(<AgentColorPicker {...props} />)
  return { onChange }
}

describe('AgentColorPicker', () => {
  it('renders Solid/Gradient toggle with Solid active by default', () => {
    setup()
    const solid = screen.getByRole('button', { name: /solid/i })
    const gradient = screen.getByRole('button', { name: /gradient/i })
    expect(solid.getAttribute('aria-pressed')).toBe('true')
    expect(gradient.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows only one hex input in solid mode', () => {
    setup()
    expect(screen.getAllByLabelText(/hex/i).length).toBe(1)
  })

  it('switching to gradient calls onChange with mode=gradient and a generated colorEnd', () => {
    const { onChange } = setup({ mode: 'solid' })
    fireEvent.click(screen.getByRole('button', { name: /gradient/i }))
    expect(onChange).toHaveBeenCalled()
    const arg = onChange.mock.calls.at(-1)?.[0]
    expect(arg.mode).toBe('gradient')
    expect(arg.colorEnd).toMatch(/^#[0-9a-f]{6}$/i)
    expect(arg.harmony).toBe('complementary')
  })

  it('in gradient mode, picking a harmony updates colorEnd', () => {
    const { onChange } = setup({ mode: 'gradient', colorStart: '#6366f1', colorEnd: '#a855f7', harmony: 'complementary' })
    fireEvent.click(screen.getByRole('button', { name: /triadic/i }))
    expect(onChange).toHaveBeenCalled()
    const arg = onChange.mock.calls.at(-1)?.[0]
    expect(arg.harmony).toBe('triadic')
    // the new colorEnd should differ from the previous "complementary" colorEnd
    expect(arg.colorEnd?.toLowerCase()).not.toBe('#a855f7')
  })

  it('manual harmony lets the end color picker move independently', () => {
    const { onChange } = setup({ mode: 'gradient', colorStart: '#6366f1', colorEnd: '#a855f7', harmony: 'manual' })
    const endInput = screen.getAllByLabelText(/hex/i)[1] as HTMLInputElement
    fireEvent.change(endInput, { target: { value: '#00ff00' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colorEnd: '#00ff00' }))
  })

  it('typing in the start hex input updates colorStart', () => {
    const { onChange } = setup({ mode: 'solid' })
    const startInput = screen.getAllByLabelText(/hex/i)[0] as HTMLInputElement
    fireEvent.change(startInput, { target: { value: '#ff0000' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colorStart: '#ff0000' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentColorPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the picker**

Create `src/components/AgentColorPicker.tsx`:

```tsx
import { applyHarmony, type HarmonyMode } from '../utils/colorHarmony'

export interface AgentColorPickerProps {
  mode: 'solid' | 'gradient'
  colorStart: string
  colorEnd: string | null
  harmony: HarmonyMode
  onChange: (next: { mode: 'solid' | 'gradient'; colorStart: string; colorEnd: string | null; harmony: HarmonyMode }) => void
}

const HARMONIES: { mode: HarmonyMode; label: string }[] = [
  { mode: 'manual',        label: 'Manual' },
  { mode: 'mono',          label: 'Monochromatic' },
  { mode: 'analogous',     label: 'Analogous' },
  { mode: 'complementary', label: 'Complementary' },
  { mode: 'split',         label: 'Split-complementary' },
  { mode: 'triadic',       label: 'Triadic' },
  { mode: 'tetradic',      label: 'Tetradic' },
]

export default function AgentColorPicker(props: AgentColorPickerProps) {
  const { mode, colorStart, colorEnd, harmony, onChange } = props

  const setMode = (next: 'solid' | 'gradient') => {
    if (next === mode) return
    if (next === 'solid') {
      onChange({ mode: 'solid', colorStart, colorEnd: null, harmony: 'manual' })
    } else {
      const initialHarmony: HarmonyMode = 'complementary'
      onChange({
        mode: 'gradient',
        colorStart,
        colorEnd: applyHarmony(colorStart, initialHarmony),
        harmony: initialHarmony,
      })
    }
  }

  const setColorStart = (next: string) => {
    if (mode === 'gradient' && harmony !== 'manual') {
      onChange({ mode, colorStart: next, colorEnd: applyHarmony(next, harmony), harmony })
    } else {
      onChange({ mode, colorStart: next, colorEnd, harmony })
    }
  }

  const setColorEnd = (next: string) => {
    onChange({ mode, colorStart, colorEnd: next, harmony })
  }

  const setHarmony = (next: HarmonyMode) => {
    if (next === 'manual') {
      onChange({ mode, colorStart, colorEnd, harmony: next })
    } else {
      onChange({ mode, colorStart, colorEnd: applyHarmony(colorStart, next), harmony: next })
    }
  }

  return (
    <div className="agent-color-picker">
      <div className="acp-toggle" role="group" aria-label="Color mode">
        <button
          type="button"
          aria-pressed={mode === 'solid'}
          className={mode === 'solid' ? 'active' : ''}
          onClick={() => setMode('solid')}
        >Solid</button>
        <button
          type="button"
          aria-pressed={mode === 'gradient'}
          className={mode === 'gradient' ? 'active' : ''}
          onClick={() => setMode('gradient')}
        >Gradient</button>
      </div>

      <div className="acp-pickers">
        <label className="acp-color-cell">
          <input
            type="color"
            value={colorStart}
            onChange={e => setColorStart(e.target.value)}
            aria-label="Start color"
          />
        </label>
        <input
          type="text"
          aria-label="Start hex"
          value={colorStart}
          onChange={e => setColorStart(e.target.value)}
          className="acp-hex"
        />

        {mode === 'gradient' && (
          <>
            <span className="acp-arrow">→</span>
            <label className="acp-color-cell">
              <input
                type="color"
                value={colorEnd ?? colorStart}
                onChange={e => setColorEnd(e.target.value)}
                aria-label="End color"
                disabled={harmony !== 'manual'}
              />
            </label>
            <input
              type="text"
              aria-label="End hex"
              value={colorEnd ?? ''}
              onChange={e => setColorEnd(e.target.value)}
              className="acp-hex"
              disabled={harmony !== 'manual'}
            />
          </>
        )}

        <div
          className="acp-preview"
          style={{
            background: mode === 'gradient' && colorEnd
              ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
              : colorStart,
          }}
        />
      </div>

      {mode === 'gradient' && (
        <div className="acp-harmonies">
          {HARMONIES.map(h => (
            <button
              key={h.mode}
              type="button"
              className={`acp-harmony${harmony === h.mode ? ' active' : ''}`}
              onClick={() => setHarmony(h.mode)}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/AgentColorPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentColorPicker.tsx src/components/AgentColorPicker.test.tsx
git commit -m "feat(agents): AgentColorPicker with solid/gradient + harmony modes"
```

---

## Task 11: `CreateAgentPanel` — full create flow

**Files:**
- Create: `src/components/CreateAgentPanel.tsx`
- Create: `src/components/CreateAgentPanel.test.tsx`

This component replaces the existing in-place create flow. The route mount-point (currently in `src/components/LibraryDetailRoutes.tsx`) should already wire this in via the same path used for `NewAgentPanel` — see Task 14 for the wiring.

- [ ] **Step 1: Write the failing test**

Create `src/components/CreateAgentPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateAgentPanel from './CreateAgentPanel'
import type { AgentFolderRow, AgentRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Engineering', color_start: null, color_end: null, description: null, created_at: 't' },
]

function makeApi() {
  return {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [] }),
      create: vi.fn().mockImplementation(async (input: any): Promise<AgentRow> => ({
        id: 'new-id',
        name: input.name,
        handle: input.handle,
        body: input.body ?? '',
        folder_id: input.folderId,
        color_start: input.colorStart,
        color_end: input.colorEnd,
        emoji: input.emoji,
        pinned: 0,
        pinned_at: null,
        last_used_at: null,
        presets_json: '[]',
        created_at: 't',
        updated_at: 't',
      })),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
})

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/new']}>
      <Routes>
        <Route path="/library/agent/new" element={<CreateAgentPanel />} />
        <Route path="/library/agent/:id" element={<div>opened</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CreateAgentPanel', () => {
  it('auto-fills handle from name', async () => {
    setup()
    const name = screen.getByLabelText(/^name$/i) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Code Investigator' } })
    const handle = screen.getByLabelText(/^handle$/i) as HTMLInputElement
    expect(handle.value).toBe('@code-investigator')
  })

  it('lets the user override the handle after auto-fill', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Foo' } })
    const handle = screen.getByLabelText(/^handle$/i) as HTMLInputElement
    expect(handle.value).toBe('@foo')
    fireEvent.change(handle, { target: { value: '@override' } })
    expect(handle.value).toBe('@override')
    // Subsequent name changes do NOT touch a user-edited handle
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Bar' } })
    expect(handle.value).toBe('@override')
  })

  it('disables Create button when name or handle is empty', () => {
    setup()
    const btn = screen.getByRole('button', { name: /create agent/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('submits with the resolved customisation values and navigates to the new agent', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: /create agent/i }))
    await waitFor(() => screen.getByText('opened'))
    const api = (window as any).api as ReturnType<typeof makeApi>
    const call = api.agents.create.mock.calls[0][0]
    expect(call.name).toBe('Reviewer')
    expect(call.handle).toBe('reviewer')
    expect(call.colorStart).toMatch(/^#[0-9a-f]{6}$/)
    expect(call.colorEnd).toBeNull()  // solid by default
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/CreateAgentPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CreateAgentPanel.tsx`**

Create `src/components/CreateAgentPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { slugifyName, dedupeHandle } from '../utils/agentSlug'
import { hashHandleToColor, applyHarmony, type HarmonyMode } from '../utils/colorHarmony'
import AgentEmojiPicker from './AgentEmojiPicker'
import AgentColorPicker from './AgentColorPicker'
import type { AgentRow, AgentFolderRow } from '../types/agent'

export default function CreateAgentPanel() {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [takenHandles, setTakenHandles] = useState<string[]>([])

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)

  const [mode, setMode] = useState<'solid' | 'gradient'>('solid')
  const [colorStart, setColorStart] = useState('#6366f1')
  const [colorEnd, setColorEnd] = useState<string | null>(null)
  const [harmony, setHarmony] = useState<HarmonyMode>('manual')
  const [emoji, setEmoji] = useState<string | null>(null)

  const [folderId, setFolderId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { folders, agents } = await window.api.agents.getAll()
      if (cancelled) return
      setFolders(folders)
      setTakenHandles(agents.map(a => a.handle).filter(Boolean))
    })()
    return () => { cancelled = true }
  }, [])

  // Auto-fill handle from name (only if user hasn't manually edited)
  useEffect(() => {
    if (handleEdited) return
    if (name.trim().length === 0) {
      setHandle('')
      return
    }
    const slug = slugifyName(name)
    const deduped = dedupeHandle(slug, takenHandles)
    setHandle(`@${deduped}`)
  }, [name, handleEdited, takenHandles])

  // Default color follows the handle until the user touches the picker
  const defaultColorStart = useMemo(
    () => handle.length > 1 ? hashHandleToColor(handle.replace(/^@/, '')) : '#6366f1',
    [handle],
  )
  const [colorTouched, setColorTouched] = useState(false)
  useEffect(() => {
    if (colorTouched) return
    setColorStart(defaultColorStart)
  }, [defaultColorStart, colorTouched])

  const cleanHandle = handle.replace(/^@/, '')
  const handleIsValid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(cleanHandle) && !takenHandles.includes(cleanHandle)
  const canSubmit = !submitting && name.trim().length > 0 && handleIsValid

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const row: AgentRow = await window.api.agents.create({
        name: name.trim(),
        body: '',
        folderId,
        handle: cleanHandle,
        colorStart,
        colorEnd,
        emoji,
      })
      navigate(`/library/agent/${row.id}`)
    } catch (e) {
      setSubmitting(false)
      // eslint-disable-next-line no-console
      console.error('Failed to create agent', e)
    }
  }

  return (
    <div className="create-agent-panel">
      <header className="create-agent-header">
        <h2>New agent</h2>
      </header>

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

      <div className="create-agent-field">
        <div className="create-agent-label">Customisation</div>
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
      </div>

      <div className="create-agent-field">
        <label htmlFor="cap-folder" className="create-agent-label">Folder</label>
        <select id="cap-folder" value={folderId ?? ''} onChange={e => setFolderId(e.target.value || null)}>
          <option value="">Unfiled</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/CreateAgentPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CreateAgentPanel.tsx src/components/CreateAgentPanel.test.tsx
git commit -m "feat(agents): CreateAgentPanel with auto-handle + Customisation section"
```

---

## Task 12: Wire `CreateAgentPanel` into the routes; remove old create flow

**Files:**
- Modify: `src/components/LibraryDetailRoutes.tsx` (or wherever the agent routes are registered — locate via Grep)
- Modify: `src/components/AgentsSidebar.tsx:137-153` — change the `handleNewAgent` flow

- [ ] **Step 1: Locate the current create-agent mount point**

Run:
```bash
grep -rn "agent/new\|NewAgentPanel\|handleNewAgent" src
```

Expected: identifies where the existing in-place create flow is routed. The `+ New agent` button in `AgentsSidebar.tsx` currently creates a row directly via `window.api.agents.create(...)` then navigates. That flow must change so it instead navigates to a `/library/agent/new` route which mounts `CreateAgentPanel`.

- [ ] **Step 2: Update `AgentsSidebar.tsx` `handleNewAgent`**

Replace lines 137-153 in `src/components/AgentsSidebar.tsx`:

```ts
  const handleNewAgent = () => {
    navigate('/library/agent/new')
  }
```

(Remove the import of any "next Agent N" naming logic — `CreateAgentPanel` now owns the create UX.)

- [ ] **Step 3: Add the `/library/agent/new` route**

In `src/components/LibraryDetailRoutes.tsx`, add a route that mounts `CreateAgentPanel`. Example shape:

```tsx
import CreateAgentPanel from './CreateAgentPanel'
// …
<Route path="agent/new" element={<CreateAgentPanel />} />
<Route path="agent/:id" element={<AgentDetail />} />
```

Place the `/new` route *before* the `/:id` route so it matches first.

- [ ] **Step 4: Update `Library.tsx` `agentMatch`**

In `src/views/Library.tsx`, the `agentMatch` regex matches `/library/agent/:id`. Verify that it does NOT also match `/library/agent/new` — if it does, the detail area will try to load an agent with id `"new"`. Run the renderer locally and click + New agent to verify the panel appears. If `agentMatch` incorrectly matches, change the route order or add an explicit guard:

```ts
const agentMatch = useMatch('/library/agent/:id')
const hasAgentDetail = agentMatch !== null && agentMatch.params.id !== 'new'
```

Then use `hasAgentDetail` wherever `agentMatch` was used as a boolean.

- [ ] **Step 5: Type-check the project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentsSidebar.tsx src/components/LibraryDetailRoutes.tsx src/views/Library.tsx
git commit -m "feat(agents): route + New agent through CreateAgentPanel"
```

---

## Task 13: `AgentsSidebar` — swatch + handle suffix

**Files:**
- Modify: `src/components/AgentsSidebar.tsx:187-201`
- Modify: `src/components/AgentsSidebar.test.tsx` (extend)

- [ ] **Step 1: Add failing tests**

Append to `src/components/AgentsSidebar.test.tsx`:

```ts
it('renders a color swatch per agent row', async () => {
  setup({ agents: [
    { id: 'a1', name: 'Reviewer', handle: 'reviewer', body: '', folder_id: null,
      color_start: '#10b981', color_end: '#34d399', emoji: '⚡',
      pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
      created_at: 't', updated_at: 't' },
  ] })
  await screen.findByText('Reviewer')
  const swatch = document.querySelector('[data-testid="sidebar-swatch-a1"]') as HTMLElement
  expect(swatch).toBeTruthy()
  expect(swatch.style.background).toMatch(/linear-gradient/)
})

it('renders @handle suffix per agent row', async () => {
  setup({ agents: [
    { id: 'a1', name: 'Reviewer', handle: 'reviewer', body: '', folder_id: null,
      color_start: '#10b981', color_end: null, emoji: null,
      pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
      created_at: 't', updated_at: 't' },
  ] })
  expect(await screen.findByText('@reviewer')).toBeTruthy()
})

it('emits an empty emoji fallback when emoji is null', async () => {
  setup({ agents: [
    { id: 'a1', name: 'X', handle: 'x', body: '', folder_id: null,
      color_start: '#000000', color_end: null, emoji: null,
      pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
      created_at: 't', updated_at: 't' },
  ] })
  const swatch = await screen.findByTestId('sidebar-swatch-a1')
  // No emoji char inside the swatch when emoji is null
  expect(swatch.textContent?.trim()).toBe('')
})
```

(Adapt the existing test file's `setup` helper if it uses a different signature.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentsSidebar.test.tsx`
Expected: FAIL — swatches and handle suffix not rendered yet.

- [ ] **Step 3: Update the agent row render block**

In `src/components/AgentsSidebar.tsx`, replace the agent row block (lines 187-201 in the current code):

```tsx
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
              </button>
            ))}
```

You can drop the `MarkdownDocIcon` import — the swatch replaces it.

- [ ] **Step 4: Add minimal CSS for the new elements**

In whatever CSS file the existing `.library-sidebar-item` lives (likely `src/components/LibrarySidebar.css` or `src/views/Library.css` — find via `grep -rn "library-sidebar-item" src --include="*.css"`):

```css
.agents-sidebar-swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  font-size: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.agents-sidebar-handle {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--t3);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/AgentsSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentsSidebar.tsx src/components/AgentsSidebar.test.tsx <css-file>
git commit -m "feat(agents): swatch + @handle suffix in AgentsSidebar"
```

---

## Task 14: `AgentDetail` — new hero layout

**Files:**
- Rewrite: `src/views/AgentDetail.tsx`
- Replace: `src/views/AgentDetail.css`
- Extend: `src/views/AgentDetail.test.tsx`

This task replaces the current header/meta/body layout with the profile-card hero. The body editor stays — it sits below the hero.

- [ ] **Step 1: Update the existing failing-style tests + add hero tests**

Update `src/views/AgentDetail.test.tsx`:

First, update the `baseAgent` fixture to include the new fields:

```ts
const baseAgent: AgentRow = {
  id: 'a1',
  name: 'Copy editor',
  handle: 'copy-editor',
  body: '# Copy editor\n\nHello body.',
  folder_id: 'f1',
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
```

Add new tests:

```ts
it('renders the hero with @handle, name, swatch and description', async () => {
  setup()
  await waitForLoaded()
  expect(screen.getByText('@copy-editor')).toBeTruthy()
  expect(screen.getByTestId('agent-hero-swatch').style.background).toBe('rgb(16, 185, 129)')
  expect(screen.getByText(/Hello body/)).toBeTruthy()
})

it('Copy button writes the persona payload to the clipboard', async () => {
  setup()
  await waitForLoaded()
  fireEvent.click(screen.getByRole('button', { name: /copy/i }))
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
  const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
  expect(payload).toMatch(/^You are @copy-editor/)
  expect(payload).toContain('Hello body.')
})

it('shows the folder name as a meta chip', async () => {
  setup()
  await waitForLoaded()
  expect(screen.getByText('Writing')).toBeTruthy()  // f1 folder name
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — `@copy-editor`, swatch, and "You are @copy-editor" not present yet.

- [ ] **Step 3: Rewrite `AgentDetail.tsx`**

Replace the contents of `src/views/AgentDetail.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import { useToast } from '../contexts/Toast'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'
import './AgentDetail.css'

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setNameEditing(false)
    if (bodyTimer.current) { clearTimeout(bodyTimer.current); bodyTimer.current = null }
    if (nameTimer.current) { clearTimeout(nameTimer.current); nameTimer.current = null }
    ;(async () => {
      const { folders, agents } = await window.api.agents.getAll()
      if (cancelled) return
      setFolders(folders)
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      setBodyDraft(a?.body ?? '')
      setNameDraft(a?.name ?? '')
      setEditing(a !== null && a.body === '')
    })()
    return () => { cancelled = true }
  }, [id])

  const editingRef = useRef(false)
  const nameEditingRef = useRef(false)
  useEffect(() => { editingRef.current = editing }, [editing])
  useEffect(() => { nameEditingRef.current = nameEditing }, [nameEditing])

  useEffect(() => { if (editing) bodyRef.current?.focus() }, [editing])

  useEffect(() => {
    if (!id) return
    const cb = async () => {
      const { agents } = await window.api.agents.getAll()
      const a = agents.find(x => x.id === id) ?? null
      setAgent(a)
      if (!editingRef.current) setBodyDraft(a?.body ?? '')
      if (!nameEditingRef.current) setNameDraft(a?.name ?? '')
    }
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [id])

  const scheduleSaveBody = useCallback((value: string) => {
    if (!id) return
    setSaveStatus('saving')
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(async () => {
      try {
        await window.api.agents.update(id, { body: value })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
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

  const liveBody = editing ? bodyDraft : (agent?.body ?? '')
  const description = useMemo(() => deriveDescription(liveBody), [liveBody])
  const bodyChars = liveBody.length

  const handleCopy = async () => {
    if (!agent) return
    const payload = buildPersonaPayload({ handle: agent.handle, description, body: liveBody })
    await navigator.clipboard.writeText(payload)
    toast(`Copied @${agent.handle}`, 'success')
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

  if (!agent) return <div className="agent-detail-loading">Loading…</div>

  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }

  return (
    <div className="agent-detail">
      <header className="agent-detail-hero">
        <div
          className="agent-detail-swatch"
          data-testid="agent-hero-swatch"
          style={swatchStyle}
        >
          {agent.emoji ?? ''}
        </div>
        <div className="agent-detail-id-block">
          <div className="agent-detail-handle">@{agent.handle}</div>
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
              onClick={() => setNameEditing(true)}
              title="Click to rename"
            >
              {nameDraft || agent.name}
            </h2>
          )}
          {description && <p className="agent-detail-description">{description}</p>}
          <div className="agent-detail-meta">
            <span className="agent-detail-chip">{currentFolderName}</span>
            <span className="agent-detail-chip">{(bodyChars / 1024).toFixed(1)} kb</span>
            <span className="agent-detail-chip">Updated {new Date(agent.updated_at).toLocaleString()}</span>
          </div>
        </div>
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
      </header>

      <div className="agent-detail-body">
        {editing ? (
          <textarea
            ref={bodyRef}
            className="agent-detail-textarea"
            aria-label="Body"
            placeholder="Paste your markdown here…"
            value={bodyDraft}
            onChange={e => { setBodyDraft(e.target.value); scheduleSaveBody(e.target.value) }}
          />
        ) : (
          <div className="agent-detail-rendered">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.body}</ReactMarkdown>
          </div>
        )}
      </div>

      <footer className="agent-detail-footer">
        <span
          className={
            'agent-detail-save-status' +
            (saveStatus === 'saving' ? ' agent-detail-save-status--saving' : '') +
            (saveStatus === 'saved' ? ' agent-detail-save-status--saved' : '')
          }
        >
          {saveStatus === 'saving' && 'saving…'}
          {saveStatus === 'saved' && 'saved ✓'}
        </span>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "refactor(agents): profile-card hero in AgentDetail + persona-loading Copy"
```

---

## Task 15: `AgentDetail.css` — restyle to match the hero design

**Files:**
- Replace: `src/views/AgentDetail.css`

- [ ] **Step 1: Replace the file**

Replace the contents of `src/views/AgentDetail.css`:

```css
/* ── Agent detail view ──────────────────────────────────────── */

.agent-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

/* Hero ────────────────────────────────────────────────── */

.agent-detail-hero {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 28px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
}

.agent-detail-swatch {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.agent-detail-id-block {
  flex: 1;
  min-width: 0;
}

.agent-detail-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: var(--accent-text);
  margin-bottom: 3px;
}

.agent-detail-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
  color: var(--t1);
  cursor: text;
  padding: 0 4px;
  border-radius: 5px;
  border: 1px solid transparent;
  line-height: 1.25;
}
.agent-detail-title:hover {
  background: var(--bg3);
  border-color: var(--border);
}

.agent-detail-title-input {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
  color: var(--t1);
  background: var(--bg3);
  border: 1px solid var(--border2);
  border-radius: 5px;
  padding: 2px 6px;
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.agent-detail-title-input:focus { border-color: var(--accent-border); }

.agent-detail-description {
  font-size: 12px;
  color: var(--t3);
  line-height: 1.5;
  margin: 0 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.agent-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--t3);
}

.agent-detail-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--t2);
}

/* Actions column ──────────────────────────────────────── */

.agent-detail-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
}

.agent-detail-copy {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  padding: 6px 14px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.agent-detail-copy:hover {
  background: var(--accent-hover);
  border-color: var(--accent);
  color: var(--t1);
}

.agent-detail-action {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--t2);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
  -webkit-app-region: no-drag;
}
.agent-detail-action:hover {
  background: var(--bg3);
  border-color: var(--border2);
  color: var(--t1);
}
.agent-detail-action--danger:hover {
  color: var(--red-text);
  border-color: var(--red-border);
  background: var(--red-soft);
}

/* Body area ───────────────────────────────────────────── */

.agent-detail-body {
  flex: 1;
  overflow: auto;
  padding: 18px 28px;
  background: var(--bg);
  min-height: 0;
}

.agent-detail-textarea {
  width: 100%;
  height: 100%;
  min-height: 200px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--t2);
  font-size: 12px;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 12px 14px;
  resize: none;
  outline: none;
  line-height: 1.55;
  box-sizing: border-box;
}
.agent-detail-textarea:focus {
  border-color: var(--border2);
  background: rgba(255, 255, 255, 0.05);
}
.agent-detail-textarea::-webkit-scrollbar       { width: 6px; }
.agent-detail-textarea::-webkit-scrollbar-track { background: transparent; }
.agent-detail-textarea::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.agent-detail-rendered {
  font-size: 13px;
  color: var(--t2);
  line-height: 1.6;
  max-width: 880px;
}
.agent-detail-rendered h1,
.agent-detail-rendered h2,
.agent-detail-rendered h3,
.agent-detail-rendered h4 {
  color: var(--t1);
  margin: 1em 0 0.4em;
  line-height: 1.3;
}
.agent-detail-rendered h1 { font-size: 20px; }
.agent-detail-rendered h2 { font-size: 16px; }
.agent-detail-rendered h3 { font-size: 14px; }
.agent-detail-rendered p { margin: 0 0 8px; }
.agent-detail-rendered ul,
.agent-detail-rendered ol { margin: 6px 0; padding-left: 20px; }
.agent-detail-rendered li { margin: 2px 0; }
.agent-detail-rendered strong { color: var(--t1); }
.agent-detail-rendered code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}
.agent-detail-rendered pre {
  background: var(--bg2);
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.agent-detail-rendered pre code {
  background: transparent;
  padding: 0;
  font-size: 11px;
}
.agent-detail-rendered blockquote {
  border-left: 2px solid var(--border2);
  padding-left: 10px;
  margin: 8px 0;
  color: var(--t3);
}
.agent-detail-rendered a { color: var(--accent-text); }
.agent-detail-rendered a:hover { color: var(--accent-light); }

/* Footer ──────────────────────────────────────────────── */

.agent-detail-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 28px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
  min-height: 24px;
}

.agent-detail-save-status {
  margin-left: auto;
  font-size: 10px;
  color: var(--t3);
  font-style: italic;
}
.agent-detail-save-status--saving { color: var(--amber); }
.agent-detail-save-status--saved  { color: var(--accent-text); font-style: normal; }

/* Loading state ──────────────────────────────────────── */

.agent-detail-loading {
  padding: 24px;
  color: var(--t3);
  font-size: 12px;
}

/* ── Create Agent Panel ─────────────────────────────────────── */

.create-agent-panel {
  padding: 24px 28px;
  max-width: 720px;
  margin: 0 auto;
  color: var(--t2);
}
.create-agent-header h2 {
  font-size: 18px;
  color: var(--t1);
  margin: 0 0 18px;
}
.create-agent-field { margin-bottom: 14px; }
.create-agent-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--t3);
  margin-bottom: 5px;
}
.create-agent-field input[type="text"],
.create-agent-field select {
  width: 100%;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--t1);
  font-size: 13px;
  padding: 6px 10px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.create-agent-field input[type="text"]:focus,
.create-agent-field select:focus { border-color: var(--accent-border); }
.create-agent-hint { font-size: 10px; color: var(--t3); margin-top: 4px; }

.create-agent-custom {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 14px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.create-agent-emoji-block { margin-left: auto; }

/* Color picker internals */
.agent-color-picker { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.acp-toggle { display: inline-flex; gap: 4px; background: rgba(0,0,0,0.2); border-radius: 5px; padding: 2px; }
.acp-toggle button {
  padding: 4px 12px;
  font-size: 11px;
  background: transparent;
  border: none;
  color: var(--t3);
  border-radius: 4px;
  cursor: pointer;
}
.acp-toggle button.active { background: var(--accent-soft); color: var(--accent-text); }
.acp-pickers { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.acp-color-cell input[type="color"] { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border2); cursor: pointer; padding: 0; background: transparent; }
.acp-arrow { color: var(--t3); }
.acp-hex {
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  color: var(--t1);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  width: 90px;
  box-sizing: border-box;
}
.acp-hex:disabled { opacity: 0.5; }
.acp-preview { width: 80px; height: 32px; border-radius: 6px; border: 1px solid var(--border2); margin-left: auto; }
.acp-harmonies { display: flex; flex-wrap: wrap; gap: 4px; }
.acp-harmony {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--border);
  color: var(--t2);
  cursor: pointer;
}
.acp-harmony.active { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }

/* Emoji picker internals */
.agent-emoji-trigger {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--bg3);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  cursor: pointer;
}
.agent-emoji-popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 10px;
  width: 280px;
  z-index: 100;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
}
.agent-emoji-search {
  width: 100%;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--t1);
  margin-bottom: 8px;
  outline: none;
  box-sizing: border-box;
}
.agent-emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 3px;
  max-height: 220px;
  overflow-y: auto;
}
.agent-emoji-cell {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  font-size: 16px;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
}
.agent-emoji-cell:hover { background: var(--bg3); }
.agent-emoji-cell.selected { background: var(--accent-soft); border-color: var(--accent-border); }
.agent-emoji-clear {
  grid-column: 1 / -1;
  font-size: 10px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--t3);
  border-radius: 4px;
  margin-top: 6px;
  cursor: pointer;
}

.create-agent-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 7px;
  margin: 18px 0;
}
.create-agent-preview-swatch {
  width: 42px;
  height: 42px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.create-agent-preview-name { font-size: 13px; font-weight: 600; color: var(--t1); }
.create-agent-preview-handle { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-text); }

.create-agent-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.create-agent-footer button {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--t2);
  padding: 6px 14px;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
}
.create-agent-footer button:hover:not(:disabled) {
  background: var(--bg3);
  color: var(--t1);
}
.create-agent-footer .create-agent-submit {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}
.create-agent-footer .create-agent-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Run the existing tests one more time to verify nothing regressed**

Run: `npm test -- src/views/AgentDetail.test.tsx src/components/CreateAgentPanel.test.tsx src/components/AgentEmojiPicker.test.tsx src/components/AgentColorPicker.test.tsx src/components/AgentsSidebar.test.tsx`
Expected: PASS for all.

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "refactor(agents): restyle AgentDetail for the hero layout + create panel"
```

---

## Task 16: End-to-end manual sanity check

Phase A doesn't include a Playwright e2e harness, so this is a human sanity pass via the running app. Since the user has memory that says "User tests UI changes themselves, don't launch dev servers or screenshot," ask the user to run through the checklist below at their convenience and report any issues.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```
Expected: ALL tests pass, including the existing pre-redesign tests.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Hand off to the user with this checklist**

Tell the user: "Phase A is implemented. Could you run the app and confirm:
1. Existing Agent 1 row got a handle auto-assigned (visible as `@agent-1` in the sidebar).
2. + New agent opens the new CreateAgentPanel.
3. Typing in Name auto-fills Handle; spaces become dashes; if you edit Handle directly, further Name changes don't overwrite it.
4. Color picker: Solid is default. Switching to Gradient shows two color inputs and harmony chips. Picking Complementary auto-fills the second color.
5. Emoji picker opens, search filters, selecting writes it back.
6. After creating an agent, the detail view shows the new hero (big swatch + @handle + name + description from the body's first line + meta chips).
7. Copy button puts `You are @handle, <description>.\n\n<body>` on the clipboard. Paste into a text editor to verify.
8. Edit toggle still works; body saves debounced; sidebar list refreshes on save."

---

## Self-Review

After writing the plan, I ran the three checks:

**1. Spec coverage:**
- Schema/migration ✓ (Tasks 1, 4)
- agent_revisions table created ✓ (Task 1) — writes deferred to Phase C as noted.
- Backfill (handle, color, initial revision) ✓ (Task 4)
- Renderer types extended ✓ (Task 5)
- agentsService extended ✓ (Task 6)
- IPC + preload ✓ (Task 7)
- Utilities (slug, color harmony, copy payload) ✓ (Tasks 2, 3, 8)
- AgentEmojiPicker ✓ (Task 9)
- AgentColorPicker with all 7 harmony modes ✓ (Task 10)
- CreateAgentPanel with Customisation section ✓ (Tasks 11, 12)
- AgentsSidebar swatch + handle suffix ✓ (Task 13)
- AgentDetail hero ✓ (Tasks 14, 15)
- Phase A explicitly excludes: variables/preset bar (Phase B), History tab (Phase C), MCP launcher (Phase D), AgentsLanding (Phase D), Pin/Unpin UI (Phase D) — noted at top.

**2. Placeholder scan:** No "TBD", "TODO", or "implement later" — every code step has full content. The only contingent instruction is in Task 4 step 3 about `require` vs. top-of-file `import` for the backfill, which gives a fallback action.

**3. Type consistency:**
- `slugifyName` / `dedupeHandle` / `isValidHandle` consistent across Tasks 2, 4, 6, 11.
- `HarmonyMode` consistent across Tasks 3, 10, 11.
- `CreateAgentInput` / `UpdateAgentPatch` field names (`handle`, `colorStart`, `colorEnd`, `emoji`, `pinned`) consistent across service, IPC, preload, and CreateAgentPanel.
- `AgentRow` field names (`color_start`, `color_end`, `emoji`, `pinned`, `presets_json`) match across schema, types, service, sidebar, detail view.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-agents-redesign-phase-a-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
