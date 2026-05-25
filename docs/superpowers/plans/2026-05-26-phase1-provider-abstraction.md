# Phase 1 — Provider Abstraction & Storage Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundation for multi-provider AI support — `electron/llm/` module (types, parser, Anthropic adapter, factory) + extend `electron/store.ts` to hold per-provider settings + migrate the existing `anthropic.apiKey` into the new shape. **No user-visible behaviour change** in this phase; the old call sites still use the old paths.

**Architecture:** New `electron/llm/` module is the future single chokepoint for every AI call. In this phase the module exists and is unit-tested but unused by call sites — they get refactored to it in Phase 3. Storage gets a new `providers` section alongside the existing `anthropic.apiKey`, which is preserved as a read-through alias and back-filled by an explicit `migrateApiStore()` call wired into main-process startup.

**Tech Stack:** TypeScript, electron-vite, vitest, electron-store (existing), Vercel AI SDK (`ai` + `@ai-sdk/anthropic` — new deps).

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md)

**Branch policy:** Per `~/.claude/CLAUDE.md`, commit directly to `main`. Do not create a feature branch. Each task = its own commit.

**Test command:** Always `npm test`, never `npx vitest` (per memory note `feedback_vitest_rebuild` — the script rebuilds better-sqlite3 for the Node ABI first; bypassing it breaks Electron launch).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `electron/llm/types.ts` | All public interfaces — `ProviderId`, `ModelRef`, `LLMCallOpts`, `LLMService`, `LLMError`, `LLMErrorKind`, `AgentEvent`, `TextChunk`, `Usage`, `McpTool` |
| `electron/llm/registry.ts` | `parseModelRef(str): ModelRef` + `formatModelRef(ref): string` |
| `electron/llm/registry.test.ts` | TDD tests for parse/format |
| `electron/llm/adapters/anthropic.ts` | Anthropic adapter — wraps Vercel AI SDK |
| `electron/llm/adapters/anthropic.test.ts` | TDD tests with `ai` + `@ai-sdk/anthropic` mocked |
| `electron/llm/index.ts` | `createLLMService(): LLMService` factory + dispatch by `ModelRef.provider` |
| `electron/llm/index.test.ts` | TDD test that factory dispatches Anthropic models to the Anthropic adapter |
| `electron/store.providers.test.ts` | TDD tests for new providers helpers + `migrateApiStore` |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `ai` and `@ai-sdk/anthropic` to `dependencies` |
| `electron/store.ts` (lines 40–52 today) | Extend `ApiStoreSchema`; add `providers.*` + `defaults.*` helpers; add `migrateApiStore()` |
| `electron/main.ts` (around line 9 import + early in `app.whenReady` flow) | Import + call `migrateApiStore()` once on startup |

**Not touched in Phase 1:** `preload.ts`, Settings UI, the 4 existing AI call sites, the `agents` DB table. Those land in later phases.

---

## Task 1: Add Vercel AI SDK dependencies

**Files:**
- Modify: `package.json` (line 19 starts `dependencies`)

- [ ] **Step 1: Add deps to package.json**

Open `package.json`. Inside the `"dependencies"` block (currently lines 19–49), add these two entries in alphabetical order (so `ai` slots after `@modelcontextprotocol/sdk`, and `@ai-sdk/anthropic` slots near the top of the `@`-scoped block right after `@anthropic-ai/sdk`):

```json
"@ai-sdk/anthropic": "^1.0.0",
```

```json
"ai": "^4.0.0",
```

(If `npm view ai version` shows a newer major during install, pin to that exact major — the public `generateText({ model, system, messages, maxTokens, abortSignal }) → { text, usage }` shape this plan depends on has been stable since v3.)

- [ ] **Step 2: Install**

Run:
```bash
npm install
```

Expected: install succeeds, `package-lock.json` updates, no peer-dep errors. If `@ai-sdk/anthropic` warns about an `ai` peer mismatch, bump `ai` to match the peer range and re-run.

- [ ] **Step 3: Verify the imports resolve**

Run:
```bash
node -e "const a = require('ai'); const b = require('@ai-sdk/anthropic'); console.log(typeof a.generateText, typeof b.anthropic)"
```

Expected output: `function function`

If either prints `undefined`, the installed version has a different export shape — note the actual exports and revise Tasks 5 + 6 accordingly before proceeding.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add Vercel AI SDK + Anthropic adapter for provider abstraction"
```

---

## Task 2: Create `electron/llm/types.ts`

**Files:**
- Create: `electron/llm/types.ts`

No tests for this task — pure type declarations are exercised by later tasks. Verification is `tsc --noEmit`.

- [ ] **Step 1: Create the types file**

Create `electron/llm/types.ts` with exactly this content:

```ts
// Public types for the LLM provider abstraction.
// This module is the single chokepoint that every AI call in the app
// will go through (refactored into in Phase 3). Adapters live in
// ./adapters/*; the dispatch factory is in ./index.ts.

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'opencode'
  | 'openai-compatible'

export type ModelRef = {
  provider: ProviderId
  /** Provider-native model id, preserved verbatim. May contain `:` (e.g. `llama3.1:70b`). */
  model: string
  /** Only meaningful when provider === 'openai-compatible'. References a user-named endpoint id in settings. */
  endpoint?: string
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

export type LLMCallOpts = {
  systemPrompt?: string
  messages: ChatMessage[]
  tools?: McpTool[]
  maxTokens?: number
  signal?: AbortSignal
}

export type Usage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type TextChunk = { type: 'text-delta'; delta: string }

export type AgentEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; name: string; args: Record<string, unknown>; id: string }
  | { type: 'tool-result'; id: string; result: unknown; isError: boolean }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; error: LLMError }

export type LLMErrorKind =
  | 'auth_missing'
  | 'auth_invalid'
  | 'rate_limit'
  | 'network'
  | 'model_unavailable'
  | 'context_overflow'
  | 'tool_failed'
  | 'aborted'
  | 'unknown'

export class LLMError extends Error {
  kind: LLMErrorKind
  cause?: unknown
  constructor(kind: LLMErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
    this.cause = cause
  }
}

export interface LLMService {
  generateText(model: ModelRef, opts: LLMCallOpts): Promise<{ text: string; usage: Usage }>
  streamText(model: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk>
  runAgentLoop(model: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}
```

- [ ] **Step 2: Verify it type-checks**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If `tsconfig.json` doesn't cover `electron/llm/`, locate the existing electron tsconfig (likely `electron.vite.config.ts` or `tsconfig.node.json`) and run that one — copy the working command from the project's typical typecheck script.

- [ ] **Step 3: Commit**

```bash
git add electron/llm/types.ts
git commit -m "feat(llm): scaffold provider-abstraction type surface"
```

---

## Task 3: Implement `parseModelRef` (TDD)

**Files:**
- Create: `electron/llm/registry.test.ts`
- Create: `electron/llm/registry.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/llm/registry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseModelRef, formatModelRef } from './registry'

describe('parseModelRef', () => {
  it('maps legacy "sonnet" to anthropic/claude-sonnet-4-6', () => {
    expect(parseModelRef('sonnet')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
  })

  it('maps legacy "opus" to anthropic/claude-opus-4-7', () => {
    expect(parseModelRef('opus')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    })
  })

  it('maps legacy "haiku" to anthropic/claude-haiku-4-5', () => {
    expect(parseModelRef('haiku')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    })
  })

  it('returns "inherit" provider for the literal string "inherit"', () => {
    // Special sentinel value — caller resolves the actual model at runtime.
    expect(parseModelRef('inherit')).toEqual({
      provider: 'anthropic',
      model: 'inherit',
    })
  })

  it('parses explicit provider/model form', () => {
    expect(parseModelRef('openai/gpt-4o')).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(parseModelRef('anthropic/claude-sonnet-4-6')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(parseModelRef('google/gemini-2.5-pro')).toEqual({
      provider: 'google',
      model: 'gemini-2.5-pro',
    })
    expect(parseModelRef('opencode/claude-sonnet-4-6')).toEqual({
      provider: 'opencode',
      model: 'claude-sonnet-4-6',
    })
  })

  it('preserves colons inside the model name (local model tags like llama3.1:70b)', () => {
    expect(parseModelRef('openai-compatible:ollama-local/llama3.1:70b')).toEqual({
      provider: 'openai-compatible',
      endpoint: 'ollama-local',
      model: 'llama3.1:70b',
    })
  })

  it('parses openai-compatible with no endpoint segment', () => {
    expect(parseModelRef('openai-compatible/llama3.1:70b')).toEqual({
      provider: 'openai-compatible',
      model: 'llama3.1:70b',
    })
  })

  it('rejects unknown provider', () => {
    expect(() => parseModelRef('mystery/foo')).toThrow(/unknown provider/i)
  })

  it('rejects endpoint segment on non-openai-compatible provider', () => {
    expect(() => parseModelRef('openai:org-1/gpt-4o')).toThrow(/endpoint.*openai-compatible/i)
  })

  it('rejects missing slash', () => {
    expect(() => parseModelRef('openai-gpt-4o')).toThrow(/expected.*provider\/model/i)
  })

  it('rejects empty model segment', () => {
    expect(() => parseModelRef('openai/')).toThrow(/model.*empty/i)
  })
})

describe('formatModelRef', () => {
  it('round-trips a simple ref', () => {
    const ref = { provider: 'openai' as const, model: 'gpt-4o' }
    expect(formatModelRef(ref)).toBe('openai/gpt-4o')
  })

  it('round-trips an openai-compatible ref with endpoint', () => {
    const ref = { provider: 'openai-compatible' as const, endpoint: 'ollama-local', model: 'llama3.1:70b' }
    expect(formatModelRef(ref)).toBe('openai-compatible:ollama-local/llama3.1:70b')
  })

  it('round-trips an openai-compatible ref without endpoint', () => {
    const ref = { provider: 'openai-compatible' as const, model: 'llama3.1:70b' }
    expect(formatModelRef(ref)).toBe('openai-compatible/llama3.1:70b')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run:
```bash
npm test -- electron/llm/registry.test.ts
```

Expected: FAIL with `Cannot find module './registry'` or similar — the implementation doesn't exist yet.

- [ ] **Step 3: Implement `registry.ts`**

Create `electron/llm/registry.ts`:

```ts
import type { ModelRef, ProviderId } from './types'

const KNOWN_PROVIDERS: readonly ProviderId[] = [
  'anthropic', 'openai', 'google', 'opencode', 'openai-compatible',
] as const

const LEGACY_ANTHROPIC_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5',
}

/**
 * Parse a `model:` string from agent frontmatter or settings into a structured ModelRef.
 *
 * Accepted forms:
 *   - "inherit"                        → { anthropic, "inherit" }  (sentinel; resolved at call time)
 *   - "sonnet" | "opus" | "haiku"      → mapped to anthropic/claude-<id>
 *   - "<provider>/<model>"             → explicit
 *   - "openai-compatible:<endpoint>/<model>" → endpoint id + model
 *
 * The model segment is preserved verbatim and may contain `:` (e.g. "llama3.1:70b").
 * Split rule: first '/' separates provider+endpoint from model; first ':' on the left
 * side separates provider from endpoint id (only valid for openai-compatible).
 */
export function parseModelRef(input: string): ModelRef {
  const trimmed = input.trim()

  if (trimmed === 'inherit') {
    return { provider: 'anthropic', model: 'inherit' }
  }

  if (trimmed in LEGACY_ANTHROPIC_ALIASES) {
    return { provider: 'anthropic', model: LEGACY_ANTHROPIC_ALIASES[trimmed] }
  }

  const slashIdx = trimmed.indexOf('/')
  if (slashIdx === -1) {
    throw new Error(`Invalid model ref "${input}": expected "<provider>/<model>"`)
  }

  const left = trimmed.slice(0, slashIdx)
  const model = trimmed.slice(slashIdx + 1)

  if (model.length === 0) {
    throw new Error(`Invalid model ref "${input}": model segment is empty`)
  }

  let provider: string
  let endpoint: string | undefined

  const colonIdx = left.indexOf(':')
  if (colonIdx === -1) {
    provider = left
  } else {
    provider = left.slice(0, colonIdx)
    endpoint = left.slice(colonIdx + 1)
    if (provider !== 'openai-compatible') {
      throw new Error(`Invalid model ref "${input}": endpoint segment is only allowed for openai-compatible provider, got "${provider}"`)
    }
    if (endpoint.length === 0) {
      throw new Error(`Invalid model ref "${input}": endpoint segment is empty`)
    }
  }

  if (!KNOWN_PROVIDERS.includes(provider as ProviderId)) {
    throw new Error(`Invalid model ref "${input}": unknown provider "${provider}"`)
  }

  return endpoint
    ? { provider: provider as ProviderId, endpoint, model }
    : { provider: provider as ProviderId, model }
}

export function formatModelRef(ref: ModelRef): string {
  if (ref.endpoint) {
    return `${ref.provider}:${ref.endpoint}/${ref.model}`
  }
  return `${ref.provider}/${ref.model}`
}
```

- [ ] **Step 4: Run test, verify pass**

Run:
```bash
npm test -- electron/llm/registry.test.ts
```

Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/registry.ts electron/llm/registry.test.ts
git commit -m "feat(llm): parseModelRef + formatModelRef with legacy + openai-compatible support"
```

---

## Task 4: Extend `electron/store.ts` with providers schema + migration (TDD)

**Files:**
- Create: `electron/store.providers.test.ts`
- Modify: `electron/store.ts` (currently 76 lines; extending the `ApiStoreSchema` block at lines 40–52)
- Modify: `electron/main.ts` (line 9 import + call site in `app.whenReady` flow)

- [ ] **Step 1: Write the failing test**

Create `electron/store.providers.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockStore } = vi.hoisted(() => {
  // electron-store mock with in-memory backing — every Store() instance shares it,
  // which matches the test patterns already used in electron/store.test.ts.
  const data = new Map<string, unknown>()
  return {
    mockStore: {
      get: vi.fn((k: string, def?: unknown) => (data.has(k) ? data.get(k) : def)),
      set: vi.fn((k: string, v: unknown) => { data.set(k, v) }),
      delete: vi.fn((k: string) => { data.delete(k) }),
      __seed: (k: string, v: unknown) => { data.set(k, v) },
      __reset: () => { data.clear() },
    },
  }
})

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => mockStore),
}))

import {
  getApiKey,
  setApiKey,
  getProviderConfig,
  setProviderConfig,
  listOpenAICompatibleEndpoints,
  upsertOpenAICompatibleEndpoint,
  removeOpenAICompatibleEndpoint,
  migrateApiStore,
} from './store'

beforeEach(() => {
  mockStore.__reset()
  mockStore.get.mockClear()
  mockStore.set.mockClear()
  mockStore.delete.mockClear()
})

describe('migrateApiStore', () => {
  it('copies legacy anthropic.apiKey into providers.anthropic.apiKey and sets enabled=true', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    migrateApiStore()
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.apiKey', 'sk-legacy')
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.enabled', true)
  })

  it('does not overwrite providers.anthropic.apiKey if already set', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    mockStore.__seed('providers.anthropic.apiKey', 'sk-new')
    migrateApiStore()
    const calls = mockStore.set.mock.calls.filter(c => c[0] === 'providers.anthropic.apiKey')
    expect(calls).toHaveLength(0)
  })

  it('is a no-op when neither key is set', () => {
    migrateApiStore()
    expect(mockStore.set).not.toHaveBeenCalled()
  })

  it('is idempotent — running twice produces the same end state', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    migrateApiStore()
    const callsAfterFirst = mockStore.set.mock.calls.length
    migrateApiStore()
    // Second call should not write anything new — providers.anthropic.apiKey is now set.
    expect(mockStore.set.mock.calls.length).toBe(callsAfterFirst)
  })
})

describe('getApiKey (back-compat read-through alias)', () => {
  it('returns providers.anthropic.apiKey when set', () => {
    mockStore.__seed('providers.anthropic.apiKey', 'sk-new')
    expect(getApiKey()).toBe('sk-new')
  })

  it('falls back to legacy anthropic.apiKey if providers key is unset', () => {
    mockStore.__seed('anthropic.apiKey', 'sk-legacy')
    expect(getApiKey()).toBe('sk-legacy')
  })

  it('returns undefined when neither is set', () => {
    expect(getApiKey()).toBeUndefined()
  })
})

describe('setApiKey (writes both legacy + new for back-compat)', () => {
  it('writes providers.anthropic.apiKey AND legacy anthropic.apiKey', () => {
    setApiKey('sk-fresh')
    expect(mockStore.set).toHaveBeenCalledWith('providers.anthropic.apiKey', 'sk-fresh')
    expect(mockStore.set).toHaveBeenCalledWith('anthropic.apiKey', 'sk-fresh')
  })
})

describe('getProviderConfig / setProviderConfig', () => {
  it('returns { enabled: false, apiKey: undefined } by default', () => {
    expect(getProviderConfig('openai')).toEqual({ enabled: false, apiKey: undefined })
  })

  it('round-trips a provider config', () => {
    setProviderConfig('openai', { enabled: true, apiKey: 'sk-openai-test' })
    expect(getProviderConfig('openai')).toEqual({ enabled: true, apiKey: 'sk-openai-test' })
  })

  it('supports google + opencode providers', () => {
    setProviderConfig('google', { enabled: true, apiKey: 'g-key' })
    setProviderConfig('opencode', { enabled: true })
    expect(getProviderConfig('google')).toEqual({ enabled: true, apiKey: 'g-key' })
    expect(getProviderConfig('opencode')).toEqual({ enabled: true, apiKey: undefined })
  })
})

describe('openai-compatible endpoints', () => {
  it('returns an empty list by default', () => {
    expect(listOpenAICompatibleEndpoints()).toEqual([])
  })

  it('upsert creates a new endpoint when id is new', () => {
    upsertOpenAICompatibleEndpoint({
      id: 'ollama-local',
      label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'ollama-local', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
    ])
  })

  it('upsert updates an existing endpoint by id', () => {
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'old', baseUrl: 'http://a' })
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'new', baseUrl: 'http://b' })
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'e1', label: 'new', baseUrl: 'http://b' },
    ])
  })

  it('remove deletes by id', () => {
    upsertOpenAICompatibleEndpoint({ id: 'e1', label: 'one', baseUrl: 'http://a' })
    upsertOpenAICompatibleEndpoint({ id: 'e2', label: 'two', baseUrl: 'http://b' })
    removeOpenAICompatibleEndpoint('e1')
    expect(listOpenAICompatibleEndpoints()).toEqual([
      { id: 'e2', label: 'two', baseUrl: 'http://b' },
    ])
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run:
```bash
npm test -- electron/store.providers.test.ts
```

Expected: FAIL — `getProviderConfig`, `setProviderConfig`, `listOpenAICompatibleEndpoints`, `upsertOpenAICompatibleEndpoint`, `removeOpenAICompatibleEndpoint`, `migrateApiStore` don't exist yet.

- [ ] **Step 3: Extend `electron/store.ts`**

Open `electron/store.ts`. **Replace** the block at lines 40–52 (the entire `ApiStoreSchema` interface + `apiStore` constant + `getApiKey` + `setApiKey`) with this new block:

```ts
import type { ProviderId } from './llm/types'

type ProviderConfig = {
  enabled: boolean
  apiKey?: string
}

type OpenAICompatibleEndpoint = {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
}

interface ApiStoreSchema {
  // Legacy — kept as a back-compat alias. New code reads/writes via
  // providers.anthropic.apiKey; setApiKey() writes both, getApiKey() prefers
  // providers.* and falls back to the legacy key.
  'anthropic.apiKey'?: string

  // Per-provider config introduced by Phase 1 of the multi-provider effort.
  'providers.anthropic.apiKey'?: string
  'providers.anthropic.enabled'?: boolean
  'providers.openai.apiKey'?: string
  'providers.openai.enabled'?: boolean
  'providers.openai.organization'?: string
  'providers.google.apiKey'?: string
  'providers.google.enabled'?: boolean
  'providers.opencode.enabled'?: boolean
  'providers.openai-compatible.enabled'?: boolean
  'providers.openai-compatible.endpoints'?: OpenAICompatibleEndpoint[]
}

const apiStore = new Store<ApiStoreSchema>({ encryptionKey: 'git-suite-api-key-v1' })

// ── API key (back-compat aliases) ───────────────────────────────
export function getApiKey(): string | undefined {
  return apiStore.get('providers.anthropic.apiKey') ?? apiStore.get('anthropic.apiKey')
}

export function setApiKey(key: string): void {
  apiStore.set('providers.anthropic.apiKey', key)
  apiStore.set('anthropic.apiKey', key) // keep legacy key in sync for any code that still reads it directly
}

// ── Generic per-provider config ─────────────────────────────────
export function getProviderConfig(provider: ProviderId): ProviderConfig {
  return {
    enabled: apiStore.get(`providers.${provider}.enabled` as keyof ApiStoreSchema) as boolean | undefined ?? false,
    apiKey:  apiStore.get(`providers.${provider}.apiKey`  as keyof ApiStoreSchema) as string  | undefined,
  }
}

export function setProviderConfig(provider: ProviderId, cfg: ProviderConfig): void {
  apiStore.set(`providers.${provider}.enabled` as keyof ApiStoreSchema, cfg.enabled as never)
  if (cfg.apiKey === undefined) {
    apiStore.delete(`providers.${provider}.apiKey` as keyof ApiStoreSchema)
  } else {
    apiStore.set(`providers.${provider}.apiKey` as keyof ApiStoreSchema, cfg.apiKey as never)
  }
}

// ── openai-compatible endpoint list ─────────────────────────────
export function listOpenAICompatibleEndpoints(): OpenAICompatibleEndpoint[] {
  return apiStore.get('providers.openai-compatible.endpoints') ?? []
}

export function upsertOpenAICompatibleEndpoint(ep: OpenAICompatibleEndpoint): void {
  const all = listOpenAICompatibleEndpoints()
  const idx = all.findIndex(e => e.id === ep.id)
  if (idx === -1) all.push(ep)
  else all[idx] = ep
  apiStore.set('providers.openai-compatible.endpoints', all)
}

export function removeOpenAICompatibleEndpoint(id: string): void {
  const all = listOpenAICompatibleEndpoints().filter(e => e.id !== id)
  apiStore.set('providers.openai-compatible.endpoints', all)
}

// ── Migration (called once on startup from main.ts) ─────────────
/**
 * Copy legacy `anthropic.apiKey` into `providers.anthropic.apiKey` if the new key
 * is empty. Idempotent — safe to call on every startup.
 */
export function migrateApiStore(): void {
  const legacy = apiStore.get('anthropic.apiKey')
  const current = apiStore.get('providers.anthropic.apiKey')
  if (legacy && !current) {
    apiStore.set('providers.anthropic.apiKey', legacy)
    apiStore.set('providers.anthropic.enabled', true)
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run:
```bash
npm test -- electron/store.providers.test.ts electron/store.test.ts
```

Expected: all tests pass (including the pre-existing `electron/store.test.ts` cases, which should be unaffected because the `github` + `skillSync` stores were not touched).

- [ ] **Step 5: Wire migration into main-process startup**

Open `electron/main.ts`. Find line 9 — the existing import from `./store`:

```ts
import { getToken, setToken, clearToken, setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner } from './store'
```

Add `migrateApiStore` to the import list:

```ts
import { getToken, setToken, clearToken, setGitHubUser, getGitHubUser, clearGitHubUser, getApiKey, setApiKey, getSyncEnabled, setSyncEnabled, getSyncRepoOwner, migrateApiStore } from './store'
```

Then find line 2623, which today is:

```ts
app.whenReady().then(() => {
  // Grant permissions (including microphone for speech-to-text)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
```

Insert `migrateApiStore()` as the very first statement inside that callback, before the comment line:

```ts
app.whenReady().then(() => {
  migrateApiStore()
  // Grant permissions (including microphone for speech-to-text)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
```

(Line numbers may have shifted by the time you execute this — if the comment text moved, anchor on `app.whenReady().then(() => {` and insert immediately inside the callback. The constraint is: runs once, after Electron's `app` is ready, before any IPC handler can fire.)

- [ ] **Step 6: Smoke-check the build still compiles**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add electron/store.ts electron/store.providers.test.ts electron/main.ts
git commit -m "feat(store): providers schema + migrateApiStore() called on startup"
```

---

## Task 5: Implement Anthropic adapter (TDD)

**Files:**
- Create: `electron/llm/adapters/anthropic.test.ts`
- Create: `electron/llm/adapters/anthropic.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/llm/adapters/anthropic.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockAnthropic } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockAnthropic: vi.fn((modelId: string) => ({ __isMockedModel: true, modelId })),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: mockAnthropic,
}))

// Mock the store module so the adapter can read the API key without
// constructing a real electron-store.
vi.mock('../../store', () => ({
  getProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'sk-test-key' })),
}))

import { AnthropicAdapter } from './anthropic'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockAnthropic.mockClear()
})

describe('AnthropicAdapter.generateText', () => {
  it('constructs the Anthropic model with the ref.model id and calls ai.generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello world',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new AnthropicAdapter()
    const result = await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      },
    )

    expect(mockAnthropic).toHaveBeenCalledWith('claude-sonnet-4-6')
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    }))
    expect(result).toEqual({
      text: 'hello world',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('resolves "inherit" model to claude-sonnet-4-6 (a sensible default)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'inherit' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockAnthropic).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('throws LLMError with kind=auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 401 from the SDK into LLMError kind=auth_invalid', async () => {
    const sdkErr: any = new Error('Unauthorized')
    sdkErr.statusCode = 401
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_invalid' })
  })

  it('normalizes a 429 from the SDK into LLMError kind=rate_limit', async () => {
    const sdkErr: any = new Error('Rate limited')
    sdkErr.statusCode = 429
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'rate_limit' })
  })

  it('forwards AbortSignal to ai.generateText as abortSignal', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const controller = new AbortController()
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }))
  })

  it('omits system when systemPrompt is not provided', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    const call = mockGenerateText.mock.calls[0][0]
    expect(call.system).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run:
```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: FAIL — `Cannot find module './anthropic'`.

- [ ] **Step 3: Implement the adapter**

Create `electron/llm/adapters/anthropic.ts`:

```ts
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { getProviderConfig } from '../../store'
import { LLMError } from '../types'
import type {
  LLMCallOpts,
  ModelRef,
  TextChunk,
  AgentEvent,
  Usage,
  LLMErrorKind,
} from '../types'

const INHERIT_DEFAULT = 'claude-sonnet-4-6'

export class AnthropicAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    this.assertApiKey()
    const modelId = ref.model === 'inherit' ? INHERIT_DEFAULT : ref.model
    try {
      const result = await generateText({
        model: anthropic(modelId),
        system: opts.systemPrompt,
        messages: opts.messages,
        maxTokens: opts.maxTokens,
        abortSignal: opts.signal,
      } as Parameters<typeof generateText>[0])
      return {
        text: result.text,
        usage: {
          promptTokens:     result.usage?.promptTokens     ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0,
          totalTokens:      result.usage?.totalTokens      ?? 0,
        },
      }
    } catch (err) {
      throw normalizeError(err)
    }
  }

  // Phase 5 will fill these in. Stubs throw so misuse fails loudly during
  // the period when only generateText is wired up.
  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'AnthropicAdapter.streamText not implemented in Phase 1')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'AnthropicAdapter.runAgentLoop not implemented in Phase 1')
  }

  private assertApiKey(): void {
    const cfg = getProviderConfig('anthropic')
    if (!cfg.apiKey) {
      throw new LLMError('auth_missing', 'Anthropic API key is not configured. Set it in Settings → Providers.')
    }
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  return new LLMError(kind, e?.message ?? 'Anthropic adapter failed', err)
}
```

- [ ] **Step 4: Run test, verify pass**

Run:
```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/adapters/anthropic.ts electron/llm/adapters/anthropic.test.ts
git commit -m "feat(llm): Anthropic adapter wrapping Vercel AI SDK with error normalization"
```

---

## Task 6: `createLLMService` factory + index.ts (TDD)

**Files:**
- Create: `electron/llm/index.test.ts`
- Create: `electron/llm/index.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/llm/index.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAnthropicGen } = vi.hoisted(() => ({
  mockAnthropicGen: vi.fn(),
}))

vi.mock('./adapters/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockAnthropicGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { createLLMService } from './index'
import { LLMError } from './types'

beforeEach(() => {
  mockAnthropicGen.mockReset()
})

describe('createLLMService', () => {
  it('returns an LLMService with generateText / streamText / runAgentLoop', () => {
    const svc = createLLMService()
    expect(typeof svc.generateText).toBe('function')
    expect(typeof svc.streamText).toBe('function')
    expect(typeof svc.runAgentLoop).toBe('function')
  })

  it('dispatches an anthropic ModelRef to the Anthropic adapter', async () => {
    mockAnthropicGen.mockResolvedValue({
      text: 'hi',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })

    const svc = createLLMService()
    const out = await svc.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hello' }] },
    )

    expect(mockAnthropicGen).toHaveBeenCalledTimes(1)
    expect(out.text).toBe('hi')
  })

  it('throws LLMError kind=unknown for a provider that has no adapter yet (openai in Phase 1)', async () => {
    const svc = createLLMService()
    await expect(svc.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'unknown',
    })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run:
```bash
npm test -- electron/llm/index.test.ts
```

Expected: FAIL — `Cannot find module './index'` (or `createLLMService is not defined`).

- [ ] **Step 3: Implement the factory**

Create `electron/llm/index.ts`:

```ts
import { AnthropicAdapter } from './adapters/anthropic'
import { LLMError } from './types'
import type {
  AgentEvent,
  LLMCallOpts,
  LLMService,
  ModelRef,
  TextChunk,
  Usage,
} from './types'

export * from './types'
export { parseModelRef, formatModelRef } from './registry'

type AdapterLike = {
  generateText(ref: ModelRef, opts: LLMCallOpts): Promise<{ text: string; usage: Usage }>
  streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk>
  runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}

export function createLLMService(): LLMService {
  // Adapters are constructed lazily — keeps test mocks predictable and avoids
  // touching settings storage when an adapter is never used.
  let anthropicAdapter: AnthropicAdapter | undefined

  function resolveAdapter(ref: ModelRef): AdapterLike {
    switch (ref.provider) {
      case 'anthropic':
        return (anthropicAdapter ??= new AnthropicAdapter())
      // Other providers land in Phase 4. Until then, calling them is an error.
      case 'openai':
      case 'google':
      case 'opencode':
      case 'openai-compatible':
        throw new LLMError(
          'unknown',
          `Provider "${ref.provider}" has no adapter yet — scheduled for Phase 4.`,
        )
      default: {
        // Exhaustiveness — should be unreachable while ProviderId stays narrow.
        const exhaustive: never = ref.provider
        throw new LLMError('unknown', `Unknown provider: ${String(exhaustive)}`)
      }
    }
  }

  return {
    generateText(ref, opts) {
      return resolveAdapter(ref).generateText(ref, opts)
    },
    streamText(ref, opts) {
      return resolveAdapter(ref).streamText(ref, opts)
    },
    runAgentLoop(ref, opts) {
      return resolveAdapter(ref).runAgentLoop(ref, opts)
    },
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run:
```bash
npm test -- electron/llm/index.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Full test sweep**

Run the entire test suite to confirm nothing else regressed:

```bash
npm test
```

Expected: all pre-existing tests continue to pass, plus the four new test files (`registry.test.ts`, `store.providers.test.ts`, `adapters/anthropic.test.ts`, `index.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add electron/llm/index.ts electron/llm/index.test.ts
git commit -m "feat(llm): createLLMService factory dispatching by ModelRef.provider"
```

---

## Phase 1 done — verification checklist

After Task 6:

- [ ] `npm test` passes end-to-end
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline -6` shows six new commits with the messages above
- [ ] Manual smoke test:
  - Launch the app (`npm run dev`)
  - Open Settings → existing Claude Desktop section still loads and saves the API key without error
  - Confirm in DevTools (or by inspecting the store file) that `providers.anthropic.apiKey` was written alongside `anthropic.apiKey`

Phase 1 ships **zero user-visible change**. The provider abstraction exists but no call site uses it yet. Phase 3 refactors the four existing call sites into it; Phase 4 adds the OpenAI/Google/openai-compatible adapters; Phase 5 implements `streamText` + `runAgentLoop` + MCP wiring.
