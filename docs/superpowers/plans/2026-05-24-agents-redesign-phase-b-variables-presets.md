# Agents Redesign — Phase B (Variables + Presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the variables + presets layer of the agents redesign — a Prompt tab with a variable/preset bar above the body editor, named preset CRUD wired through the IPC surface, and a Copy button that substitutes the active preset's values into `{{variables}}` and uses the callable sub-handle (`@reviewer/security-review`) in the persona-loading framing.

**Architecture:** Three additive layers on top of Phase A. (1) A shared `agentVariables` util (detection + substitution) usable from both renderer and main process — Phase D's MCP launcher will reuse it. (2) Preset CRUD lives on top of the existing `presets_json` TEXT column added in Phase A — no schema changes. A new `presets` namespace on the IPC surface (`window.api.agents.presets.*`). (3) `AgentDetail` gains a tab shell (Prompt / Preview / MCP / History) with Phase B populating the Prompt tab; a new `AgentVariablePresetBar` component renders above the body editor whenever the body contains `{{variable}}` patterns. The hero Copy button is upgraded to substitute variables and use the sub-handle when a preset is active.

**Tech Stack:** Electron (main + renderer split), `better-sqlite3` for the DB, React 18 + react-router-dom v6 for the renderer, Vitest for tests, `react-markdown` + `remark-gfm` for rendered body view. No new runtime dependencies in Phase B.

---

## Spec reference

This plan implements **Phase B** of `docs/superpowers/specs/2026-05-24-agents-library-redesign-design.md`. Read that spec first — this plan assumes familiarity with the data model, UI layouts, and design rationales. Phase A has already shipped on `main` (commits `34d8bb5` through `e4c22ec`).

**What Phase B includes:**
- A shared `agentVariables` util: variable detection regex + substitution helper, importable from both renderer and main.
- `copyPayload.ts` extended to accept an optional preset slug + value map, producing `You are @handle/preset-slug, <description>.\n\n<body with vars substituted>`.
- `agentsService` preset CRUD: `createPreset`, `updatePreset`, `deletePreset`, `duplicatePreset`. Stored as JSON in the existing `presets_json` column. Slugs derived per-agent via the existing `slugifyName` + `dedupeHandle` utilities.
- New IPC routes under `agents:presets:*` and the `presets` namespace on `window.api.agents`.
- A new `AgentVariablePresetBar` component (variable grid + preset stack + copy payload preview block).
- A tab shell in `AgentDetail` (Prompt / Preview / MCP / History) with Phase B populating only the Prompt tab. Preview / MCP / History tabs show a minimal "coming soon" placeholder.
- The hero Copy button is upgraded to substitute the active preset's values into `{{variables}}` and to use `@handle/preset-slug` in the framing line.

**What's NOT in Phase B (deferred):**
- `last_used_at` tracking + `recordUse` IPC (Phase D).
- AgentsLanding (no-selection state with Pinned + Recent grids) — Phase D.
- Pin/Unpin UI (Phase D).
- Edit history snapshots beyond the Phase A backfill — Phase C wires writes + History tab UI.
- MCP launcher script (Phase D).

---

## File Structure

### New files

- **`src/utils/agentVariables.ts`** — pure functions: `detectVariables(body)` returning a deduped list of variable names in order of first appearance, and `substituteVariables(body, values)` replacing `{{var}}` with `values[var]` where defined (missing values stay as literal `{{var}}`). No I/O, no React. Importable from both renderer and main process.
- **`src/utils/agentVariables.test.ts`** — Vitest tests for detection + substitution, including dedup, whitespace tolerance, stale-value handling.
- **`src/components/AgentVariablePresetBar.tsx`** — controlled component. Props: `{ agent, variables, activePresetId, onActivePresetChange }`. Reads presets via `parseAgentPresets(agent.presets_json)`. Renders left preset stack + right variable grid + bottom preview block. Calls `window.api.agents.presets.*` for mutations.
- **`src/components/AgentVariablePresetBar.test.tsx`** — Vitest + RTL tests with a mocked `window.api`.

### Modified files

- **`electron/services/agentsService.ts`** — add preset CRUD (`createPreset`, `updatePreset`, `deletePreset`, `duplicatePreset`) + internal helpers `readPresets` / `writePresets`. Reuse `slugifyName` + `dedupeHandle` from `src/utils/agentSlug` for slug generation. Cap `presets_json` at 64 KB after write.
- **`electron/services/agentsService.test.ts`** — add a `describe('agentsService — presets')` block covering CRUD + slug dedup + size cap + persistence round-trip.
- **`electron/ipc/agentHandlers.ts`** — add four new `ipcMain.handle` routes under `agents:presets:*`. Broadcast `agents:changed` after each mutation.
- **`electron/preload.ts:166-215`** — extend `window.api.agents` with a `presets: { create, update, delete, duplicate }` namespace.
- **`src/env.d.ts:185-215`** — mirror the preload extension in the global `Window['api']` typing.
- **`src/utils/copyPayload.ts`** — extend `PersonaPayloadInput` with optional `presetSlug` and `presetValues`. When `presetSlug` is provided, framing becomes `@handle/preset-slug`. When `presetValues` is provided, run `substituteVariables` on the body before emitting.
- **`src/utils/copyPayload.test.ts`** — add tests covering: framing with sub-handle, body substitution, missing values stay raw, no-preset case unchanged.
- **`src/views/AgentDetail.tsx`** — introduce a tab shell (Prompt / Preview / MCP / History) with Prompt as default. Lift `activePresetId` state to AgentDetail so the hero Copy can use it. Render `AgentVariablePresetBar` above the body editor on the Prompt tab when the live body has any detected variables. Hero Copy now passes preset slug + values to `buildPersonaPayload`.
- **`src/views/AgentDetail.test.tsx`** — extend existing tests for the tab shell + preset-aware Copy.
- **`src/views/AgentDetail.css`** — append tab shell styling + bar styling (left preset stack, variable grid, preview block) using the existing accent purple / dark theme tokens (`var(--accent-soft)`, `var(--accent-text)`, etc.).

---

## Conventions

- **TDD**: write the failing test first, run it, implement, run it again, commit. Every task follows this rhythm.
- **Commits**: one logical change per commit. Conventional-commit style (`feat(agents):`, `refactor(agents):`, etc.) — matches the project's existing style visible in `git log`.
- **Test commands**: use `npm test -- <file>` to scope a single test file. The project's `npm test` recipe runs `npm rebuild better-sqlite3 && vitest run`, which ensures the Node ABI matches what Vitest needs. Do not invoke `npx vitest` directly — it leaves better-sqlite3 built for Node ABI and breaks the Electron launch afterward.
- **No emoji in code or commit messages** unless the user has asked for them explicitly.
- **Test environment markers**: renderer tests start with `// @vitest-environment jsdom`; main-process tests start with `// @vitest-environment node`. Match the existing convention in each file.
- **Phase A test fixtures** in `AgentDetail.test.tsx` already include `presets_json: '[]'` on every `AgentRow` — keep that field on any new fixtures.

---

## Task 1: `agentVariables` utility (detection + substitution)

**Files:**
- Create: `src/utils/agentVariables.ts`
- Test: `src/utils/agentVariables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/agentVariables.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectVariables, substituteVariables } from './agentVariables'

describe('detectVariables', () => {
  it('returns an empty array when there are no variables', () => {
    expect(detectVariables('Just a regular body.')).toEqual([])
  })

  it('returns an empty array on an empty body', () => {
    expect(detectVariables('')).toEqual([])
  })

  it('detects a single variable', () => {
    expect(detectVariables('Hello {{name}}!')).toEqual(['name'])
  })

  it('detects multiple distinct variables in order of first appearance', () => {
    expect(detectVariables('{{first}} then {{second}} and {{third}}')).toEqual(['first', 'second', 'third'])
  })

  it('dedupes repeated variables, preserving first-appearance order', () => {
    expect(detectVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(detectVariables('{{ name }} and {{  other  }}')).toEqual(['name', 'other'])
  })

  it('rejects identifiers starting with a digit', () => {
    expect(detectVariables('{{1bad}} {{good}}')).toEqual(['good'])
  })

  it('rejects identifiers containing dashes or spaces', () => {
    expect(detectVariables('{{foo-bar}} {{foo bar}} {{ok_name}}')).toEqual(['ok_name'])
  })

  it('accepts underscores and digits after the first character', () => {
    expect(detectVariables('{{_x}} {{a1}} {{foo_bar_2}}')).toEqual(['_x', 'a1', 'foo_bar_2'])
  })
})

describe('substituteVariables', () => {
  it('replaces a single variable', () => {
    expect(substituteVariables('Hello {{name}}!', { name: 'world' })).toBe('Hello world!')
  })

  it('replaces multiple variables', () => {
    expect(substituteVariables('{{a}} and {{b}}', { a: 'foo', b: 'bar' })).toBe('foo and bar')
  })

  it('replaces all occurrences of the same variable', () => {
    expect(substituteVariables('{{x}} + {{x}} = 2{{x}}', { x: '1' })).toBe('1 + 1 = 21')
  })

  it('leaves missing variables as literal {{var}}', () => {
    expect(substituteVariables('{{a}} and {{b}}', { a: 'foo' })).toBe('foo and {{b}}')
  })

  it('tolerates whitespace inside the braces when substituting', () => {
    expect(substituteVariables('Hi {{ name }} ok', { name: 'sam' })).toBe('Hi sam ok')
  })

  it('ignores stale values for variables not in the body', () => {
    expect(substituteVariables('Hello {{name}}', { name: 'sam', removed: 'x' })).toBe('Hello sam')
  })

  it('returns the body unchanged when values is empty', () => {
    expect(substituteVariables('{{a}} and {{b}}', {})).toBe('{{a}} and {{b}}')
  })

  it('does not substitute when the value is undefined (key absent)', () => {
    expect(substituteVariables('{{a}}', {})).toBe('{{a}}')
  })

  it('substitutes when the value is an empty string', () => {
    expect(substituteVariables('Hello {{name}}!', { name: '' })).toBe('Hello !')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/agentVariables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agentVariables.ts`**

Create `src/utils/agentVariables.ts`:

```ts
// Pattern: {{ identifier }} where identifier is [A-Za-z_][A-Za-z0-9_]*
// Used by both the renderer (variable grid) and the main process / MCP launcher
// (substitution before producing payloads or resources).
const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function detectVariables(body: string): string[] {
  if (body.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  // RegExp objects with the /g flag retain lastIndex across calls; create a
  // fresh regex per invocation to keep the function pure.
  const re = new RegExp(VARIABLE_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

export function substituteVariables(body: string, values: Record<string, string>): string {
  if (body.length === 0) return body
  return body.replace(new RegExp(VARIABLE_RE.source, 'g'), (raw, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : raw
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/agentVariables.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/agentVariables.ts src/utils/agentVariables.test.ts
git commit -m "feat(agents): add agentVariables detect + substitute utilities"
```

---

## Task 2: Extend `copyPayload` to accept preset slug + values

**Files:**
- Modify: `src/utils/copyPayload.ts`
- Modify: `src/utils/copyPayload.test.ts`

- [ ] **Step 1: Add failing tests for the new fields**

Append to `src/utils/copyPayload.test.ts`:

```ts
describe('buildPersonaPayload — preset support', () => {
  it('uses @handle/preset-slug in the framing line when presetSlug is provided', () => {
    const out = buildPersonaPayload({
      handle: 'reviewer',
      description: 'a strict reviewer',
      body: 'Body.',
      presetSlug: 'security-review',
    })
    expect(out.startsWith('You are @reviewer/security-review, a strict reviewer.\n\n')).toBe(true)
  })

  it('substitutes variables in the body using presetValues', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: 'Look at {{focus}} carefully.',
      presetSlug: 'sec',
      presetValues: { focus: 'auth' },
    })
    expect(out).toContain('Look at auth carefully.')
  })

  it('leaves variables raw when no presetValues are provided', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: 'See {{focus}}.',
    })
    expect(out).toContain('See {{focus}}.')
  })

  it('leaves missing-value variables raw and substitutes provided ones', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: '',
      body: '{{a}} and {{b}}',
      presetSlug: 'p',
      presetValues: { a: 'one' },
    })
    expect(out).toContain('one and {{b}}')
  })

  it('omits the sub-handle when presetSlug is null/undefined', () => {
    const out = buildPersonaPayload({
      handle: 'r',
      description: 'd',
      body: 'b',
      presetSlug: null,
    })
    expect(out.startsWith('You are @r, d.\n\n')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/copyPayload.test.ts`
Expected: FAIL — the new tests expect a `presetSlug` field and substitution behavior that don't exist yet.

- [ ] **Step 3: Update `copyPayload.ts`**

Replace `src/utils/copyPayload.ts` with:

```ts
import { substituteVariables } from './agentVariables'

const DESCRIPTION_MAX = 200

export function deriveDescription(body: string): string {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
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
  handle: string
  description: string
  body: string
  presetSlug?: string | null
  presetValues?: Record<string, string>
}

export function buildPersonaPayload(input: PersonaPayloadInput): string {
  const { handle, description, body, presetSlug, presetValues } = input
  const callable = presetSlug ? `${handle}/${presetSlug}` : handle
  const framing = description.length > 0
    ? `You are @${callable}, ${stripTrailingPunct(description)}.`
    : `You are @${callable}.`
  const substituted = presetValues ? substituteVariables(body, presetValues) : body
  return `${framing}\n\n${substituted}`
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/copyPayload.test.ts`
Expected: PASS — both the existing tests and the new ones green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/copyPayload.ts src/utils/copyPayload.test.ts
git commit -m "feat(agents): preset slug + variable substitution in buildPersonaPayload"
```

---

## Task 3: `agentsService` preset CRUD

**Files:**
- Modify: `electron/services/agentsService.ts`
- Modify: `electron/services/agentsService.test.ts`

The `presets_json` column was added in Phase A's migration (default `'[]'`). This task adds CRUD on top of it, plus internal helpers for read/write/size enforcement. Slug derivation reuses `slugifyName` + `dedupeHandle` from `src/utils/agentSlug.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `electron/services/agentsService.test.ts`:

```ts
import {
  createPreset, updatePreset, deletePreset, duplicatePreset,
  PRESET_NAME_MAX, PRESETS_JSON_MAX,
} from './agentsService'
import { parseAgentPresets } from '../../src/types/agent'

describe('agentsService — presets', () => {
  let db: Database.Database
  let agentId: string
  beforeEach(() => {
    db = freshDb()
    const a = createAgent(db, {
      name: 'Reviewer',
      body: 'Look at {{focus}} for {{language}}',
      folderId: null,
      handle: 'reviewer',
      colorStart: '#6366f1',
      colorEnd: null,
      emoji: null,
    })
    agentId = a.id
  })

  it('createPreset returns a preset with derived slug + given values', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth', language: 'TS' })
    expect(p.name).toBe('Security review')
    expect(p.slug).toBe('security-review')
    expect(p.values).toEqual({ focus: 'auth', language: 'TS' })
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('createPreset persists the preset to presets_json', () => {
    createPreset(db, agentId, 'Style nitpick', { focus: 'naming' })
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    const presets = parseAgentPresets(row.presets_json)
    expect(presets.length).toBe(1)
    expect(presets[0].name).toBe('Style nitpick')
  })

  it('createPreset defaults values to {} when omitted', () => {
    const p = createPreset(db, agentId, 'Empty')
    expect(p.values).toEqual({})
  })

  it('createPreset rejects empty/whitespace name', () => {
    expect(() => createPreset(db, agentId, '')).toThrow(/name/i)
    expect(() => createPreset(db, agentId, '   ')).toThrow(/name/i)
  })

  it('createPreset rejects name exceeding PRESET_NAME_MAX', () => {
    const name = 'x'.repeat(PRESET_NAME_MAX + 1)
    expect(() => createPreset(db, agentId, name)).toThrow(/name.*length/i)
  })

  it('createPreset rejects unknown agentId', () => {
    expect(() => createPreset(db, 'no-such-agent', 'X')).toThrow(/agent/i)
  })

  it('createPreset dedupes slug per agent when two presets share a slug', () => {
    const p1 = createPreset(db, agentId, 'Security review')
    const p2 = createPreset(db, agentId, 'Security review')
    expect(p1.slug).toBe('security-review')
    expect(p2.slug).toBe('security-review-2')
    expect(p1.id).not.toBe(p2.id)
  })

  it('updatePreset changes name and regenerates slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const updated = updatePreset(db, agentId, p.id, { name: 'Security audit' })
    expect(updated.name).toBe('Security audit')
    expect(updated.slug).toBe('security-audit')
    expect(updated.values).toEqual({ focus: 'auth' })  // unchanged
  })

  it('updatePreset can change values without affecting name/slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const updated = updatePreset(db, agentId, p.id, { values: { focus: 'SQL injection' } })
    expect(updated.name).toBe('Security review')
    expect(updated.slug).toBe('security-review')
    expect(updated.values).toEqual({ focus: 'SQL injection' })
  })

  it('updatePreset dedupes slug against OTHER presets when renaming', () => {
    createPreset(db, agentId, 'Style nitpick')          // slug: style-nitpick
    const p = createPreset(db, agentId, 'Quick review') // slug: quick-review
    const updated = updatePreset(db, agentId, p.id, { name: 'Style nitpick' })
    expect(updated.slug).toBe('style-nitpick-2')
  })

  it('updatePreset is a no-op slug change when renaming to same name', () => {
    const p = createPreset(db, agentId, 'Security review')
    const updated = updatePreset(db, agentId, p.id, { name: 'Security review' })
    expect(updated.slug).toBe('security-review')
  })

  it('updatePreset throws on unknown presetId', () => {
    expect(() => updatePreset(db, agentId, 'no-such-preset', { name: 'X' })).toThrow(/preset/i)
  })

  it('deletePreset removes the preset', () => {
    const p = createPreset(db, agentId, 'Security review')
    deletePreset(db, agentId, p.id)
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    expect(parseAgentPresets(row.presets_json)).toEqual([])
  })

  it('deletePreset on unknown id is a no-op', () => {
    createPreset(db, agentId, 'X')
    expect(() => deletePreset(db, agentId, 'no-such-preset')).not.toThrow()
    const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string }
    expect(parseAgentPresets(row.presets_json).length).toBe(1)
  })

  it('duplicatePreset copies values and appends " (copy)" to the name with unique slug', () => {
    const p = createPreset(db, agentId, 'Security review', { focus: 'auth' })
    const dup = duplicatePreset(db, agentId, p.id)
    expect(dup.name).toBe('Security review (copy)')
    expect(dup.slug).toBe('security-review-copy')
    expect(dup.values).toEqual({ focus: 'auth' })
    expect(dup.id).not.toBe(p.id)
  })

  it('createPreset rejects when serialised presets exceed PRESETS_JSON_MAX', () => {
    // Push presets until the JSON blob is over the 64KB cap
    const bigValue = 'x'.repeat(1024)
    let count = 0
    expect(() => {
      while (count < 200) {
        createPreset(db, agentId, `Preset ${count++}`, { focus: bigValue })
      }
    }).toThrow(/presets.*size|too large/i)
  })

  it('updateAgent bumps updated_at when presets change', async () => {
    const before = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    await new Promise(r => setTimeout(r, 5))
    createPreset(db, agentId, 'P')
    const after = db.prepare(`SELECT updated_at FROM agents WHERE id = ?`).get(agentId) as { updated_at: string }
    expect(after.updated_at > before.updated_at).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: FAIL — `createPreset`, `updatePreset`, `deletePreset`, `duplicatePreset`, `PRESET_NAME_MAX`, `PRESETS_JSON_MAX` are not exported yet.

- [ ] **Step 3: Implement preset CRUD in `agentsService.ts`**

Append the following to `electron/services/agentsService.ts` (after the existing `getAllAgents` function, before the file ends):

```ts
// ── Presets ─────────────────────────────────────────────────────────

import { slugifyName } from '../../src/utils/agentSlug'
import { parseAgentPresets } from '../../src/types/agent'
import type { AgentPreset } from '../../src/types/agent'

export const PRESET_NAME_MAX = 80
export const PRESETS_JSON_MAX = 64 * 1024   // 64 KB cap on the serialised JSON

function assertAgentExists(db: Database.Database, agentId: string): void {
  const row = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
}

function readPresets(db: Database.Database, agentId: string): AgentPreset[] {
  const row = db.prepare(`SELECT presets_json FROM agents WHERE id = ?`).get(agentId) as { presets_json: string } | undefined
  if (!row) throw new Error(`Unknown agent id: ${agentId}`)
  return parseAgentPresets(row.presets_json)
}

function writePresets(db: Database.Database, agentId: string, presets: AgentPreset[]): void {
  const json = JSON.stringify(presets)
  if (json.length > PRESETS_JSON_MAX) {
    throw new Error(`Presets size ${json.length} exceeds ${PRESETS_JSON_MAX}`)
  }
  db.prepare(`UPDATE agents SET presets_json = ?, updated_at = ? WHERE id = ?`)
    .run(json, nowIso(), agentId)
}

function derivePresetSlug(name: string, existing: AgentPreset[], exceptId?: string): string {
  const base = slugifyName(name)
  const taken = existing
    .filter(p => p.id !== exceptId)
    .map(p => p.slug)
  // Inline dedupe (case-insensitive) — preset slugs live inside the JSON blob,
  // not the agents.handle column, so we don't reuse the global dedupeHandle.
  const lowerTaken = new Set(taken.map(s => s.toLowerCase()))
  if (!lowerTaken.has(base)) return base
  let i = 2
  while (lowerTaken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function assertPresetName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('Preset name must not be empty')
  if (trimmed.length > PRESET_NAME_MAX) {
    throw new Error(`Preset name length ${trimmed.length} exceeds ${PRESET_NAME_MAX}`)
  }
  return trimmed
}

export function createPreset(
  db: Database.Database,
  agentId: string,
  name: string,
  values: Record<string, string> = {},
): AgentPreset {
  assertAgentExists(db, agentId)
  const normalisedName = assertPresetName(name)
  const presets = readPresets(db, agentId)
  const preset: AgentPreset = {
    id: randomUUID(),
    name: normalisedName,
    slug: derivePresetSlug(normalisedName, presets),
    values: { ...values },
  }
  writePresets(db, agentId, [...presets, preset])
  return preset
}

export function updatePreset(
  db: Database.Database,
  agentId: string,
  presetId: string,
  patch: { name?: string; values?: Record<string, string> },
): AgentPreset {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const idx = presets.findIndex(p => p.id === presetId)
  if (idx < 0) throw new Error(`Unknown preset id: ${presetId}`)
  const current = presets[idx]

  let nextName = current.name
  let nextSlug = current.slug
  if (patch.name !== undefined) {
    nextName = assertPresetName(patch.name)
    nextSlug = derivePresetSlug(nextName, presets, presetId)
  }
  const nextValues = patch.values !== undefined ? { ...patch.values } : current.values

  const updated: AgentPreset = { id: current.id, name: nextName, slug: nextSlug, values: nextValues }
  const nextPresets = [...presets]
  nextPresets[idx] = updated
  writePresets(db, agentId, nextPresets)
  return updated
}

export function deletePreset(db: Database.Database, agentId: string, presetId: string): void {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const next = presets.filter(p => p.id !== presetId)
  if (next.length === presets.length) return  // no-op on unknown id
  writePresets(db, agentId, next)
}

export function duplicatePreset(
  db: Database.Database,
  agentId: string,
  presetId: string,
): AgentPreset {
  assertAgentExists(db, agentId)
  const presets = readPresets(db, agentId)
  const src = presets.find(p => p.id === presetId)
  if (!src) throw new Error(`Unknown preset id: ${presetId}`)
  const suffix = ' (copy)'
  const baseName = src.name.length + suffix.length > PRESET_NAME_MAX
    ? src.name.slice(0, PRESET_NAME_MAX - suffix.length)
    : src.name
  const dupName = `${baseName}${suffix}`
  const dup: AgentPreset = {
    id: randomUUID(),
    name: dupName,
    slug: derivePresetSlug(dupName, presets),
    values: { ...src.values },
  }
  writePresets(db, agentId, [...presets, dup])
  return dup
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/services/agentsService.test.ts`
Expected: PASS — old agent/folder tests still green, new preset tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agentsService.ts electron/services/agentsService.test.ts
git commit -m "feat(agents): preset CRUD on top of presets_json column"
```

---

## Task 4: IPC + preload + env.d.ts for presets

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts:166-215`
- Modify: `src/env.d.ts:185-215`

- [ ] **Step 1: Add IPC routes for preset CRUD**

In `electron/ipc/agentHandlers.ts`, extend the imports at the top of the file:

```ts
import {
  getAllAgents,
  createAgent, updateAgent, deleteAgent, duplicateAgent,
  createFolder, renameFolder, deleteFolder,
  createPreset, updatePreset, deletePreset, duplicatePreset,
  type CreateAgentInput, type UpdateAgentPatch,
} from '../services/agentsService'
```

Then, inside `registerAgentHandlers()` (after the existing `agents:deleteFolder` handler, before the closing brace), append:

```ts
  ipcMain.handle('agents:presets:create', async (
    _,
    agentId: string,
    name: string,
    values?: Record<string, string>,
  ) => {
    const db = getDb(app.getPath('userData'))
    const preset = createPreset(db, agentId, name, values)
    broadcastChanged()
    return preset
  })

  ipcMain.handle('agents:presets:update', async (
    _,
    agentId: string,
    presetId: string,
    patch: { name?: string; values?: Record<string, string> },
  ) => {
    const db = getDb(app.getPath('userData'))
    const preset = updatePreset(db, agentId, presetId, patch)
    broadcastChanged()
    return preset
  })

  ipcMain.handle('agents:presets:delete', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    deletePreset(db, agentId, presetId)
    broadcastChanged()
  })

  ipcMain.handle('agents:presets:duplicate', async (_, agentId: string, presetId: string) => {
    const db = getDb(app.getPath('userData'))
    const preset = duplicatePreset(db, agentId, presetId)
    broadcastChanged()
    return preset
  })
```

- [ ] **Step 2: Extend preload surface**

In `electron/preload.ts`, find the `agents:` block (around line 166-215). Inside the `agents: {` object, after the `deleteFolder` line and before `onChanged`, insert:

```ts
    presets: {
      create: (agentId: string, name: string, values?: Record<string, string>) =>
        ipcRenderer.invoke('agents:presets:create', agentId, name, values) as Promise<import('../src/types/agent').AgentPreset>,
      update: (agentId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }) =>
        ipcRenderer.invoke('agents:presets:update', agentId, presetId, patch) as Promise<import('../src/types/agent').AgentPreset>,
      delete: (agentId: string, presetId: string) =>
        ipcRenderer.invoke('agents:presets:delete', agentId, presetId) as Promise<void>,
      duplicate: (agentId: string, presetId: string) =>
        ipcRenderer.invoke('agents:presets:duplicate', agentId, presetId) as Promise<import('../src/types/agent').AgentPreset>,
    },
```

- [ ] **Step 3: Mirror in `src/env.d.ts`**

In `src/env.d.ts`, find the `agents: {` block (around line 185-215). Inside that block, after the `deleteFolder(id: string): Promise<void>` line and before `onChanged(...)`, insert:

```ts
        presets: {
          create(agentId: string, name: string, values?: Record<string, string>): Promise<import('./types/agent').AgentPreset>
          update(agentId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }): Promise<import('./types/agent').AgentPreset>
          delete(agentId: string, presetId: string): Promise<void>
          duplicate(agentId: string, presetId: string): Promise<import('./types/agent').AgentPreset>
        }
```

- [ ] **Step 4: Type-check the project**

Run: `npx tsc --noEmit`
Expected: PASS — the preload signatures match the env.d.ts shape, and the IPC handler types come from the service exports.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(agents): IPC + preload routes for preset CRUD"
```

---

## Task 5: `AgentVariablePresetBar` component

**Files:**
- Create: `src/components/AgentVariablePresetBar.tsx`
- Test: `src/components/AgentVariablePresetBar.test.tsx`

This is the largest single task. The component is controlled: parent (`AgentDetail`) owns `activePresetId`, the bar emits change events. Variable editing live-saves to the active preset via `window.api.agents.presets.update` with a 500 ms debounce.

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentVariablePresetBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AgentVariablePresetBar from './AgentVariablePresetBar'
import type { AgentRow, AgentPreset } from '../types/agent'

const baseAgent: AgentRow = {
  id: 'a1',
  name: 'Reviewer',
  handle: 'reviewer',
  body: 'Focus on {{focus}} for {{language}}.',
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

function withPresets(presets: AgentPreset[]): AgentRow {
  return { ...baseAgent, presets_json: JSON.stringify(presets) }
}

function makeApi() {
  return {
    agents: {
      presets: {
        create: vi.fn().mockImplementation(async (_aId: string, name: string, values: Record<string, string> = {}) => ({
          id: 'p-new', name, slug: name.toLowerCase().replace(/\s+/g, '-'), values,
        })),
        update: vi.fn().mockImplementation(async (_aId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }) => ({
          id: presetId, name: patch.name ?? 'X', slug: 'x', values: patch.values ?? {},
        })),
        delete: vi.fn().mockResolvedValue(undefined),
        duplicate: vi.fn().mockImplementation(async (_aId: string, presetId: string) => ({
          id: presetId + '-dup', name: 'dup', slug: 'dup', values: {},
        })),
      },
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
})

describe('AgentVariablePresetBar', () => {
  it('renders the variable grid for the detected variables', () => {
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        variables={['focus', 'language']}
        activePresetId={null}
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByText('{{focus}}')).toBeTruthy()
    expect(screen.getByText('{{language}}')).toBeTruthy()
  })

  it('renders one row per preset with the callable sub-handle', () => {
    const agent = withPresets([
      { id: 'p1', name: 'Security review', slug: 'security-review', values: {} },
      { id: 'p2', name: 'Style nitpick', slug: 'style-nitpick', values: {} },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByText('Security review')).toBeTruthy()
    expect(screen.getByText('Style nitpick')).toBeTruthy()
    expect(screen.getByText('@reviewer/security-review')).toBeTruthy()
    expect(screen.getByText('@reviewer/style-nitpick')).toBeTruthy()
  })

  it('clicking a preset row calls onActivePresetChange with its id', () => {
    const onActivePresetChange = vi.fn()
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: {} },
      { id: 'p2', name: 'B', slug: 'b', values: {} },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={onActivePresetChange}
      />,
    )
    fireEvent.click(screen.getByText('B'))
    expect(onActivePresetChange).toHaveBeenCalledWith('p2')
  })

  it('variable inputs show the active preset\'s values', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth', language: 'TS' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('focus') as HTMLInputElement).value).toBe('auth')
    expect((screen.getByLabelText('language') as HTMLInputElement).value).toBe('TS')
  })

  it('editing a variable input debounce-saves to the active preset', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    const input = screen.getByLabelText('focus') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SQL injection' } })
    expect(window.api.agents.presets.update).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(window.api.agents.presets.update).toHaveBeenCalledWith('a1', 'p1', { values: { focus: 'SQL injection' } })
    vi.useRealTimers()
  })

  it('clicking + New preset opens a name input, submitting creates with the typed name', async () => {
    const onActivePresetChange = vi.fn()
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        variables={['focus']}
        activePresetId={null}
        onActivePresetChange={onActivePresetChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }))
    const nameInput = screen.getByPlaceholderText(/preset name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Quick scan' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() =>
      expect(window.api.agents.presets.create).toHaveBeenCalledWith('a1', 'Quick scan', {}),
    )
    await waitFor(() => expect(onActivePresetChange).toHaveBeenCalledWith('p-new'))
  })

  it('+ New preset snapshots the currently-typed values into the new preset', async () => {
    // With no active preset, the user types into the variable inputs locally,
    // then clicks "+ New preset" to save those values as the first preset.
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        variables={['focus']}
        activePresetId={null}
        onActivePresetChange={() => {}}
      />,
    )
    const input = screen.getByLabelText('focus') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'auth' } })
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }))
    const nameInput = screen.getByPlaceholderText(/preset name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Auth scan' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() =>
      expect(window.api.agents.presets.create).toHaveBeenCalledWith('a1', 'Auth scan', { focus: 'auth' }),
    )
  })

  it('renders a copy-payload preview with substituted values', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth', language: 'TS' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByTestId('agent-bar-preview').textContent).toContain('Focus on auth for TS.')
  })

  it('shows raw {{var}} in preview when the value is missing', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth' } },  // language missing
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByTestId('agent-bar-preview').textContent).toContain('{{language}}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentVariablePresetBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AgentVariablePresetBar.tsx`**

Create `src/components/AgentVariablePresetBar.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRow, AgentPreset } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import { substituteVariables } from '../utils/agentVariables'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'

interface Props {
  agent: AgentRow
  variables: string[]
  activePresetId: string | null
  onActivePresetChange: (id: string | null) => void
}

const SAVE_DEBOUNCE_MS = 500

export default function AgentVariablePresetBar({
  agent,
  variables,
  activePresetId,
  onActivePresetChange,
}: Props) {
  const presets = useMemo(() => parseAgentPresets(agent.presets_json), [agent.presets_json])
  const activePreset = useMemo(
    () => presets.find(p => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  )

  // localValues holds the user's typed values for the current state. When a
  // preset is active, it mirrors the preset's values; when no preset is active,
  // it holds local edits that can be snapshotted via "+ New preset".
  const [localValues, setLocalValues] = useState<Record<string, string>>(
    activePreset?.values ?? {},
  )

  // Sync localValues whenever the active preset changes (or its values change
  // from outside, e.g. another window edited the same preset).
  useEffect(() => {
    setLocalValues(activePreset?.values ?? {})
  }, [activePreset])

  // Debounced save: when localValues change while a preset is active, push to
  // window.api.agents.presets.update.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((nextValues: Record<string, string>) => {
    if (!activePreset) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await window.api.agents.presets.update(agent.id, activePreset.id, { values: nextValues })
      } catch {
        // The 'agents:changed' broadcast will reconcile on next fetch.
      }
    }, SAVE_DEBOUNCE_MS)
  }, [activePreset, agent.id])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const handleVarChange = (name: string, value: string) => {
    const next = { ...localValues, [name]: value }
    setLocalValues(next)
    scheduleSave(next)
  }

  // "+ New preset" name-input state
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const startCreate = () => { setCreating(true); setNewName(''); setCreateError(null) }
  const cancelCreate = () => { setCreating(false); setNewName(''); setCreateError(null) }
  const submitCreate = async () => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) { setCreateError('Name required'); return }
    try {
      const created = await window.api.agents.presets.create(agent.id, trimmed, { ...localValues })
      onActivePresetChange(created.id)
      setCreating(false)
      setNewName('')
      setCreateError(null)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create preset')
    }
  }

  // Preview payload — built with the values we'd send if the user hit Copy.
  const previewPayload = useMemo(() => {
    const description = deriveDescription(agent.body)
    return buildPersonaPayload({
      handle: agent.handle,
      description,
      body: agent.body,
      presetSlug: activePreset?.slug ?? null,
      presetValues: activePreset ? localValues : undefined,
    })
  }, [agent.body, agent.handle, activePreset, localValues])

  const previewBody = useMemo(() => {
    if (!activePreset) return agent.body
    return substituteVariables(agent.body, localValues)
  }, [agent.body, activePreset, localValues])

  return (
    <div className="agent-bar">
      <aside className="agent-bar-presets">
        <div className="agent-bar-presets-label">PRESETS</div>
        {presets.map(p => (
          <PresetRow
            key={p.id}
            agent={agent}
            preset={p}
            active={p.id === activePresetId}
            onClick={() => onActivePresetChange(p.id)}
          />
        ))}
        {creating ? (
          <div className="agent-bar-new-form">
            <input
              autoFocus
              className="agent-bar-new-input"
              placeholder="Preset name"
              value={newName}
              onChange={e => { setNewName(e.target.value); if (createError) setCreateError(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitCreate() }
                else if (e.key === 'Escape') { e.preventDefault(); cancelCreate() }
              }}
              onBlur={() => { if (newName.trim().length === 0) cancelCreate() }}
              maxLength={80}
            />
            {createError && <div className="agent-bar-new-error">{createError}</div>}
          </div>
        ) : (
          <button
            type="button"
            className="agent-bar-new-btn"
            onClick={startCreate}
          >
            + New preset
          </button>
        )}
      </aside>

      <section className="agent-bar-content">
        <header className="agent-bar-header">
          <span className="agent-bar-sub-handle">
            {activePreset ? `@${agent.handle}/${activePreset.slug}` : `@${agent.handle}`}
          </span>
          <span className="agent-bar-meta">
            {variables.length} variable{variables.length === 1 ? '' : 's'}
          </span>
        </header>

        <div className="agent-bar-vars">
          {variables.map(name => (
            <div key={name} className="agent-bar-var-row">
              <label className="agent-bar-var-name" htmlFor={`var-${name}`}>{`{{${name}}}`}</label>
              <input
                id={`var-${name}`}
                className="agent-bar-var-input"
                aria-label={name}
                value={localValues[name] ?? ''}
                onChange={e => handleVarChange(name, e.target.value)}
                placeholder={`value for ${name}`}
              />
            </div>
          ))}
        </div>

        <div className="agent-bar-preview-block">
          <div className="agent-bar-preview-label">COPY PAYLOAD PREVIEW</div>
          <pre className="agent-bar-preview" data-testid="agent-bar-preview">
            {previewPayload}
          </pre>
        </div>
      </section>
    </div>
  )
}

interface PresetRowProps {
  agent: AgentRow
  preset: AgentPreset
  active: boolean
  onClick: () => void
}

function PresetRow({ agent, preset, active, onClick }: PresetRowProps) {
  return (
    <button
      type="button"
      className={`agent-bar-preset${active ? ' agent-bar-preset--active' : ''}`}
      onClick={onClick}
    >
      <span className="agent-bar-preset-dot" aria-hidden="true">●</span>
      <div className="agent-bar-preset-text">
        <div className="agent-bar-preset-name">{preset.name}</div>
        <div className="agent-bar-preset-handle">@{agent.handle}/{preset.slug}</div>
      </div>
    </button>
  )
}
```

- [ ] **Step 4: Add bar styling to `AgentDetail.css`**

Append to `src/views/AgentDetail.css`:

```css
/* ── Variable / Preset bar ───────────────────────────────────── */

.agent-bar {
  display: grid;
  grid-template-columns: 220px 1fr;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 0 0 18px;
  overflow: hidden;
}

.agent-bar-presets {
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.15);
}
.agent-bar-presets-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--t3);
  padding: 0 6px 6px;
}

.agent-bar-preset {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: 5px;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
  color: var(--t2);
}
.agent-bar-preset:hover { background: var(--bg3); }
.agent-bar-preset--active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  color: var(--t1);
}

.agent-bar-preset-dot {
  font-size: 8px;
  color: var(--accent-text);
  opacity: 0;
  width: 8px;
}
.agent-bar-preset--active .agent-bar-preset-dot { opacity: 1; }

.agent-bar-preset-text { flex: 1; min-width: 0; }
.agent-bar-preset-name {
  font-size: 12px;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-bar-preset-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--accent-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-bar-new-btn {
  background: transparent;
  border: 1px dashed var(--border2);
  color: var(--t3);
  padding: 6px 8px;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.agent-bar-new-btn:hover { color: var(--accent-text); border-color: var(--accent-border); }

.agent-bar-new-form { padding: 6px 8px; }
.agent-bar-new-input {
  width: 100%;
  background: var(--bg3);
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  color: var(--t1);
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
}
.agent-bar-new-error {
  font-size: 10px;
  color: var(--red-text);
  margin-top: 3px;
}

.agent-bar-content {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.agent-bar-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.agent-bar-sub-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: var(--accent-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.agent-bar-meta {
  font-size: 10px;
  color: var(--t3);
}

.agent-bar-vars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-bar-var-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 10px;
  align-items: center;
}
.agent-bar-var-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--t2);
}
.agent-bar-var-input {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--t1);
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.agent-bar-var-input:focus { border-color: var(--accent-border); }

.agent-bar-preview-block {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.agent-bar-preview-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--t3);
  margin-bottom: 5px;
}
.agent-bar-preview {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--t2);
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/AgentVariablePresetBar.test.tsx`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentVariablePresetBar.tsx src/components/AgentVariablePresetBar.test.tsx src/views/AgentDetail.css
git commit -m "feat(agents): AgentVariablePresetBar with preset stack + variable grid + preview"
```

---

## Task 6: Tab shell in `AgentDetail`

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.css`
- Modify: `src/views/AgentDetail.test.tsx`

Introduce the tab navigation (Prompt / Preview / MCP / History) above the body area. Phase B populates only the Prompt tab; the other three show a minimal placeholder so Phase C/D can fill them in without restructuring.

- [ ] **Step 1: Add a failing test for the tab shell**

Append to `src/views/AgentDetail.test.tsx`:

```ts
describe('AgentDetail — tabs', () => {
  it('renders the four tab buttons with Prompt active by default', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /^Prompt$/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /^Preview$/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^MCP$/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^History$/ })).toBeTruthy()
  })

  it('clicking Preview shows the preview placeholder and hides the body editor', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^Preview$/ }))
    expect(screen.getByRole('tab', { name: /^Preview$/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('textbox', { name: /Body/ })).toBeNull()
    // The Prompt tab's rendered markdown is no longer in the DOM either.
    // Just confirm a placeholder block is shown.
    expect(screen.getByText(/preview tab/i)).toBeTruthy()
  })

  it('clicking back on Prompt restores the body view', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^Preview$/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^Prompt$/ }))
    expect(screen.getAllByText(/Hello body/).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — no tab UI yet.

- [ ] **Step 3: Add tab styling**

Append to `src/views/AgentDetail.css`:

```css
/* ── Tab bar ───────────────────────────────────────────────── */

.agent-detail-tabs {
  display: flex;
  gap: 4px;
  padding: 0 28px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.agent-detail-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--t3);
  font-size: 12px;
  padding: 10px 14px;
  cursor: pointer;
  transition: color 120ms, border-color 120ms;
}
.agent-detail-tab:hover { color: var(--t2); }
.agent-detail-tab[aria-selected="true"] {
  color: var(--accent-text);
  border-bottom-color: var(--accent);
}

.agent-detail-tab-placeholder {
  padding: 24px 28px;
  color: var(--t3);
  font-size: 12px;
  line-height: 1.5;
}
```

- [ ] **Step 4: Add tab structure to `AgentDetail.tsx`**

In `src/views/AgentDetail.tsx`, make these changes:

1. Add a new state variable inside the component body, after `const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')`:

```tsx
  const [activeTab, setActiveTab] = useState<'prompt' | 'preview' | 'mcp' | 'history'>('prompt')
```

2. Between the existing `</header>` closing the hero and the `<div className="agent-detail-body">` line, insert:

```tsx
      <nav className="agent-detail-tabs" role="tablist">
        {(['prompt', 'preview', 'mcp', 'history'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className="agent-detail-tab"
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'prompt' ? 'Prompt'
              : tab === 'preview' ? 'Preview'
              : tab === 'mcp' ? 'MCP'
              : 'History'}
          </button>
        ))}
      </nav>
```

3. Wrap the existing body area so that the editor only renders on the Prompt tab. Replace the existing block:

```tsx
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
```

with:

```tsx
      <div className="agent-detail-body">
        {activeTab === 'prompt' && (
          editing ? (
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
          )
        )}
        {activeTab === 'preview' && (
          <div className="agent-detail-tab-placeholder">
            The Preview tab will render the full clipboard payload in a future phase. For now, see the preview block on the Prompt tab.
          </div>
        )}
        {activeTab === 'mcp' && (
          <div className="agent-detail-tab-placeholder">
            MCP launcher configuration is coming in Phase D.
          </div>
        )}
        {activeTab === 'history' && (
          <div className="agent-detail-tab-placeholder">
            Revision history is coming in Phase C.
          </div>
        )}
      </div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS — the new tab tests pass and the existing Phase A tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.css src/views/AgentDetail.test.tsx
git commit -m "feat(agents): tab shell in AgentDetail (Prompt active, others placeholder)"
```

---

## Task 7: Wire `AgentVariablePresetBar` + preset-aware Copy into AgentDetail

**Files:**
- Modify: `src/views/AgentDetail.tsx`
- Modify: `src/views/AgentDetail.test.tsx`

This is the integration step: lift `activePresetId` state, render the bar on the Prompt tab when variables are present, and pass preset slug + values to the hero `buildPersonaPayload` call.

- [ ] **Step 1: Add failing tests for the integration**

Append to `src/views/AgentDetail.test.tsx`:

```ts
describe('AgentDetail — variable/preset bar integration', () => {
  it('does NOT render the bar when the body has no {{variables}}', async () => {
    setup()
    await waitForLoaded()
    expect(screen.queryByText('PRESETS')).toBeNull()
  })

  it('renders the bar on the Prompt tab when variables are present', async () => {
    const agentWithVars: AgentRow = {
      ...baseAgent,
      body: 'Look at {{focus}} for {{language}}.',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithVars] })
    setup()
    await waitForLoaded()
    expect(screen.getByText('PRESETS')).toBeTruthy()
    expect(screen.getByText('{{focus}}')).toBeTruthy()
    expect(screen.getByText('{{language}}')).toBeTruthy()
  })

  it('hides the bar on tabs other than Prompt even when variables are present', async () => {
    const agentWithVars: AgentRow = {
      ...baseAgent,
      body: 'Look at {{focus}}.',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithVars] })
    setup()
    await waitForLoaded()
    expect(screen.getByText('PRESETS')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Preview$/ }))
    expect(screen.queryByText('PRESETS')).toBeNull()
  })

  it('hero Copy uses preset sub-handle and substitutes variables when a preset is active', async () => {
    const agentWithPreset: AgentRow = {
      ...baseAgent,
      body: 'Look at {{focus}} for {{language}}.',
      presets_json: JSON.stringify([
        { id: 'p1', name: 'Security review', slug: 'security-review',
          values: { focus: 'auth', language: 'TS' } },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithPreset] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor\/security-review/)
    expect(payload).toContain('Look at auth for TS.')
  })

  it('hero Copy leaves variables raw when no preset is active', async () => {
    const agentWithVars: AgentRow = {
      ...baseAgent,
      body: 'Look at {{focus}}.',
      presets_json: '[]',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithVars] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor,/)
    expect(payload).toContain('Look at {{focus}}.')  // unchanged
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: FAIL — the bar is not yet integrated and Copy doesn't use preset values.

- [ ] **Step 3: Integrate the bar + update Copy in `AgentDetail.tsx`**

In `src/views/AgentDetail.tsx`, make these changes:

1. Update the imports near the top:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import { useToast } from '../contexts/Toast'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'
import { detectVariables } from '../utils/agentVariables'
import AgentVariablePresetBar from '../components/AgentVariablePresetBar'
import './AgentDetail.css'
```

2. Add `activePresetId` state next to the other `useState` hooks (e.g. after `const [activeTab, setActiveTab] = useState…`):

```tsx
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
```

3. Add a `useEffect` to auto-select the first preset when an agent loads (so the bar opens to a sensible default), and to reset selection when switching agents. Add this after the existing `useEffect` that fetches the agent (the one with `setAgent(a)`):

```tsx
  // When the agent loads or its preset list changes, default the active preset
  // to the first one (or null if none). Clearing on agent change happens
  // because `id` is in the dep array.
  useEffect(() => {
    if (!agent) { setActivePresetId(null); return }
    const presets = parseAgentPresets(agent.presets_json)
    setActivePresetId(prev => {
      if (prev && presets.some(p => p.id === prev)) return prev
      return presets[0]?.id ?? null
    })
  }, [agent])
```

4. Compute `variables` and `activePreset` near where `description` is computed:

```tsx
  const liveBody = editing ? bodyDraft : (agent?.body ?? '')
  const description = useMemo(() => deriveDescription(liveBody), [liveBody])
  const bodyChars = liveBody.length

  const variables = useMemo(() => detectVariables(liveBody), [liveBody])
  const activePreset = useMemo(() => {
    if (!agent || !activePresetId) return null
    return parseAgentPresets(agent.presets_json).find(p => p.id === activePresetId) ?? null
  }, [agent, activePresetId])
```

5. Replace the existing `handleCopy` function with:

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

6. Render the bar inside the Prompt tab's branch — replace the existing Prompt-tab block from Task 6:

```tsx
        {activeTab === 'prompt' && (
          <>
            {variables.length > 0 && (
              <AgentVariablePresetBar
                agent={agent}
                variables={variables}
                activePresetId={activePresetId}
                onActivePresetChange={setActivePresetId}
              />
            )}
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
          </>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/views/AgentDetail.test.tsx`
Expected: PASS — every existing and new test green.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all tests across the project green.

- [ ] **Step 6: Type-check the project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/AgentDetail.tsx src/views/AgentDetail.test.tsx
git commit -m "feat(agents): wire variable/preset bar into Prompt tab + preset-aware Copy"
```

---

## Final verification

After Task 7, do a top-to-bottom sanity check:

- [ ] `npm test` — full suite green.
- [ ] `npx tsc --noEmit` — zero type errors.
- [ ] `git log --oneline | head -10` — commits all in Phase B's `feat(agents):` style, one logical change each.

If any of these fail, fix and amend the responsible commit (NOT `--amend` after a push — just a new follow-up commit if the offending one is already on the user's branch).

---

## What ships at the end of Phase B

- A Prompt tab with a variable/preset bar that appears whenever the body contains `{{variable}}` patterns.
- Preset CRUD via `window.api.agents.presets.*` (create / update / delete / duplicate), persisting to the existing `presets_json` column.
- A `parseAgentPresets`-driven UI that shows preset rows with their callable sub-handle (`@reviewer/security-review`), live-syncs variable inputs to the active preset, and snapshots typed values into a new preset on "+ New preset".
- A Copy button on the hero that substitutes the active preset's values into `{{variables}}` and uses `@handle/preset-slug` in the persona-loading framing.
- A tab shell ready for Phase C (History) and Phase D (MCP) to populate without restructuring.

## Phase C preview (out of scope here)

Phase C will wire the `agent_revisions` table — which exists already from Phase A — for body / preset writes, and populate the History tab UI. No further schema changes needed.
