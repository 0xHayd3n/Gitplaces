# Phase 4 — Additional Providers + Settings UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-visible multi-provider release: three new adapters (OpenAI, Google, OpenAI-compatible), wired into the factory, exposed through a new Settings → Providers category where the user can configure API keys, manage local endpoints, and pick per-feature default models.

**Architecture:** Three new adapters live alongside `electron/llm/adapters/anthropic.ts`, each ~50 LOC wrapping a Vercel AI SDK provider package (`@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`). The factory's existing throw-stubs become real dispatches. A new IPC surface (`llm:*`) is exposed via `electron/ipc/llmHandlers.ts` and surfaced as `window.api.llm.*` in preload. The Settings UI gets a new "Providers" category mirroring the existing `.connector-row` list pattern, plus a Defaults section storing per-feature `ModelRef` preferences. **The defaults storage lands but isn't read by the call sites yet** — that wiring is deferred to Phase 5 alongside the in-app runner work.

**Tech Stack:** TypeScript, vitest, electron-store, React, the existing `.settings-group` / `.connector-row` CSS patterns in `src/styles/globals.css`.

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md) — see the **Phasing** table (Phase 4), **Provider abstraction**, **Storage schema**, and **Settings UI shape** sections.

**Branch policy:** Commit directly to `main` per `~/.claude/CLAUDE.md`.

**Test command:** Always `npm test`, never `npx vitest`.

**Scope decisions** (intentional narrowing within Phase 4):
- **OpenCode card deferred to Phase 6.** OpenCode needs CLI install detection + skill sync alongside its provider configuration; Phase 6 covers all of that together. Phase 4's Providers section shows cards for: Anthropic, OpenAI, Google, OpenAI-compatible (4 cards, not 5).
- **Anthropic card lives in Providers AND the existing Claude Desktop section keeps its API key input.** Migrating the Claude Desktop section is a Phase 6 concern (when it gets renamed "Claude Code & OpenCode"). For Phase 4, the Providers section's Anthropic card writes to the same store slot via the new IPC; the old Claude Desktop API key input continues to work.
- **Defaults storage + UI lands; defaults wiring into call sites does NOT.** Tag extraction / skill generation continue to use their hardcoded model IDs. Phase 5 (or a small follow-up) wires the call sites to read defaults via `settings.defaults.*`.
- **Network-error kind detection** (deferred Phase-1 TODO in `anthropic.ts` normalizeError) is added now since openai-compatible local endpoints make `ECONNREFUSED` load-bearing.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `electron/llm/adapters/openai.ts` | OpenAI adapter wrapping `@ai-sdk/openai`'s `createOpenAI` |
| `electron/llm/adapters/openai.test.ts` | TDD coverage for the OpenAI adapter |
| `electron/llm/adapters/google.ts` | Google adapter wrapping `@ai-sdk/google`'s `createGoogleGenerativeAI` |
| `electron/llm/adapters/google.test.ts` | TDD coverage for the Google adapter |
| `electron/llm/adapters/openai-compatible.ts` | OpenAI-compatible adapter (for Ollama / LM Studio / llama.cpp) — takes a per-endpoint `baseURL` from settings |
| `electron/llm/adapters/openai-compatible.test.ts` | TDD coverage including endpoint resolution |
| `electron/ipc/llmHandlers.ts` | All `llm:*` IPC handlers (list providers, get/set config, manage openai-compatible endpoints, test connection, get/set defaults) |
| `electron/ipc/llmHandlers.test.ts` | Tests for the handler logic (mock the store + adapters) |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` to `dependencies` |
| `electron/llm/index.ts` | Replace the Phase-4 throw stubs in `resolveAdapter` with real adapter instantiation (lazy, mirroring the Anthropic pattern) |
| `electron/llm/index.test.ts` | Add tests verifying each new provider dispatches to its adapter |
| `electron/llm/adapters/anthropic.ts` | Add `network` kind detection to `normalizeError` (resolves Phase 1's deferred TODO at lines 79-81) |
| `electron/store.ts` | Add `defaults.chat`, `defaults.skillGen`, `defaults.tagExtract` schema fields + `getDefault(feature)` / `setDefault(feature, ref)` helpers |
| `electron/store.providers.test.ts` | Add tests for the new defaults helpers |
| `electron/preload.ts` | Expose `window.api.llm.*` mirroring the IPC surface; add `window.api.llm.getDefaults` / `setDefault` |
| `electron/main.ts` | Call `registerLLMHandlers()` at startup |
| `src/views/Settings.tsx` | Add new `'providers'` category to CATEGORIES, add `renderProviders()` function, render new cards |
| `src/styles/globals.css` | Optional minor CSS additions for the provider card (reuses `.connector-row` mostly) |
| `src/types/api.d.ts` (or wherever `window.api` is typed) | Add `llm` namespace types |

**Files NOT touched** (intentional):
- `electron/tag-extractor.ts`, `electron/skill-gen/legacy.ts` — Phase 3 already routed them through the LLM service; they continue using hardcoded model IDs until the defaults-wiring task in a later phase.
- `electron/services/aiChatService.ts` — Phase 5.

---

## Task 1: Add Vercel AI SDK provider packages

**Files:**
- Modify: `package.json` (`dependencies` block)

- [ ] **Step 1: Add the three new deps**

Open `package.json`. Inside `"dependencies"`, add (alphabetically, all sort under `@ai-sdk/*`):

```json
"@ai-sdk/google": "^1.0.0",
```

```json
"@ai-sdk/openai": "^1.0.0",
```

```json
"@ai-sdk/openai-compatible": "^1.0.0",
```

(Pin to the same major as `@ai-sdk/anthropic@^1.0.0` which is already installed. If `npm view <pkg> version` shows a newer major published, match the major that `@ai-sdk/anthropic` resolved to (`1.2.x` as of the previous install) so all `@ai-sdk/*` packages share the same major.)

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: install succeeds. The EPERM warning on `better-sqlite3` rebuild is acceptable if Electron is running (it'll rebuild fine next clean install) — confirmed in Phase 1.

- [ ] **Step 3: Verify the imports resolve**

```bash
node -e "console.log(typeof require('@ai-sdk/openai').createOpenAI, typeof require('@ai-sdk/google').createGoogleGenerativeAI, typeof require('@ai-sdk/openai-compatible').createOpenAICompatible)"
```

Expected: `function function function`.

If any prints `undefined`, the export name differs from the plan's assumption — note the actual export names and adjust the adapter `import` lines in Tasks 2-4 accordingly.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @ai-sdk/openai + google + openai-compatible for Phase 4 adapters"
```

---

## Task 2: OpenAI adapter (TDD)

**Files:**
- Create: `electron/llm/adapters/openai.test.ts`
- Create: `electron/llm/adapters/openai.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/llm/adapters/openai.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreateOpenAI, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreateOpenAI: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}))

vi.mock('../../store', () => ({
  getProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'sk-openai-test' })),
}))

import { OpenAIAdapter } from './openai'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockCreateOpenAI.mockClear()
  mockModelBuilder.mockClear()
})

describe('OpenAIAdapter.generateText', () => {
  it('wires the stored API key into createOpenAI and calls generateText with the model id', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from gpt',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new OpenAIAdapter()
    const result = await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      },
    )

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-test' })
    expect(mockModelBuilder).toHaveBeenCalledWith('gpt-4o')
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    }))
    expect(result).toEqual({
      text: 'hello from gpt',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('throws LLMError kind=auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new OpenAIAdapter()
    await expect(adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 401 into LLMError kind=auth_invalid', async () => {
    const sdkErr: any = new Error('Unauthorized')
    sdkErr.statusCode = 401
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new OpenAIAdapter()
    await expect(adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_invalid' })
  })

  it('forwards AbortSignal to generateText as abortSignal', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const controller = new AbortController()
    const adapter = new OpenAIAdapter()
    await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }))
  })

  it('passes the optional organization header to createOpenAI when configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: 'sk-x', organization: 'org-foo' } as any)
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

    const adapter = new OpenAIAdapter()
    await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-x', organization: 'org-foo' })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/openai.test.ts
```

Expected: `Cannot find module './openai'`.

- [ ] **Step 3: Implement the adapter**

Create `electron/llm/adapters/openai.ts`:

```ts
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
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

export class OpenAIAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    const { apiKey, organization } = this.resolveCreds()
    const provider = createOpenAI(organization ? { apiKey, organization } : { apiKey })
    try {
      const result = await generateText({
        model: provider(ref.model),
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

  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'OpenAIAdapter.streamText not implemented (Phase 5)')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'OpenAIAdapter.runAgentLoop not implemented (Phase 5)')
  }

  private resolveCreds(): { apiKey: string; organization?: string } {
    const cfg = getProviderConfig('openai') as { enabled: boolean; apiKey?: string; organization?: string }
    if (!cfg.apiKey) {
      throw new LLMError('auth_missing', 'OpenAI API key is not configured. Set it in Settings → Providers.')
    }
    return { apiKey: cfg.apiKey, organization: cfg.organization }
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string; code?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND') kind = 'network'
  return new LLMError(kind, e?.message ?? 'OpenAI adapter failed', err)
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/openai.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/adapters/openai.ts electron/llm/adapters/openai.test.ts
git commit -m "feat(llm): OpenAI adapter via @ai-sdk/openai with createOpenAI"
```

---

## Task 3: Google adapter (TDD)

**Files:**
- Create: `electron/llm/adapters/google.test.ts`
- Create: `electron/llm/adapters/google.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/llm/adapters/google.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreateGoogle, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreateGoogle: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mockCreateGoogle,
}))

vi.mock('../../store', () => ({
  getProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'g-test-key' })),
}))

import { GoogleAdapter } from './google'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockCreateGoogle.mockClear()
  mockModelBuilder.mockClear()
})

describe('GoogleAdapter.generateText', () => {
  it('wires the API key into createGoogleGenerativeAI and calls generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from gemini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new GoogleAdapter()
    const result = await adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
    )

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: 'g-test-key' })
    expect(mockModelBuilder).toHaveBeenCalledWith('gemini-2.5-pro')
    expect(result.text).toBe('hello from gemini')
  })

  it('throws auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new GoogleAdapter()
    await expect(adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 429 into rate_limit', async () => {
    const sdkErr: any = new Error('Rate limited')
    sdkErr.statusCode = 429
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new GoogleAdapter()
    await expect(adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'rate_limit' })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/google.test.ts
```

Expected: `Cannot find module './google'`.

- [ ] **Step 3: Implement the adapter**

Create `electron/llm/adapters/google.ts`:

```ts
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

export class GoogleAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    const apiKey = this.assertApiKey()
    const provider = createGoogleGenerativeAI({ apiKey })
    try {
      const result = await generateText({
        model: provider(ref.model),
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

  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'GoogleAdapter.streamText not implemented (Phase 5)')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'GoogleAdapter.runAgentLoop not implemented (Phase 5)')
  }

  private assertApiKey(): string {
    const cfg = getProviderConfig('google')
    if (!cfg.apiKey) {
      throw new LLMError('auth_missing', 'Google API key is not configured. Set it in Settings → Providers.')
    }
    return cfg.apiKey
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string; code?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND') kind = 'network'
  return new LLMError(kind, e?.message ?? 'Google adapter failed', err)
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/google.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/adapters/google.ts electron/llm/adapters/google.test.ts
git commit -m "feat(llm): Google adapter via @ai-sdk/google with createGoogleGenerativeAI"
```

---

## Task 4: OpenAI-compatible adapter (TDD) — handles Ollama / LM Studio / llama.cpp

**Files:**
- Create: `electron/llm/adapters/openai-compatible.test.ts`
- Create: `electron/llm/adapters/openai-compatible.ts`

This adapter is the trickiest — the `ModelRef` may carry an `endpoint` id that selects which configured `openai-compatible` endpoint to call. The endpoint's `baseURL` (and optional `apiKey`) come from `listOpenAICompatibleEndpoints()` in `electron/store.ts` (added in Phase 1 Task 4).

- [ ] **Step 1: Write the failing test**

Create `electron/llm/adapters/openai-compatible.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreate, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreate: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mockCreate,
}))

vi.mock('../../store', () => ({
  listOpenAICompatibleEndpoints: vi.fn(() => [
    { id: 'ollama-local', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-key' },
  ]),
}))

import { OpenAICompatibleAdapter } from './openai-compatible'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockCreate.mockClear()
  mockModelBuilder.mockClear()
})

describe('OpenAICompatibleAdapter.generateText', () => {
  it('resolves the explicit endpoint id and passes its baseURL to createOpenAICompatible', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from ollama',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1:70b' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:11434/v1',
      name: 'ollama-local',
    }))
    expect(mockModelBuilder).toHaveBeenCalledWith('llama3.1:70b')
  })

  it('passes the endpoint apiKey when present', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'lmstudio', model: 'qwen-7b' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:1234/v1',
      apiKey: 'lm-key',
    }))
  })

  it('falls back to the first configured endpoint when no endpoint id is given', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    // First endpoint in the mocked list is ollama-local.
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:11434/v1',
    }))
  })

  it('throws auth_missing when no endpoints are configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.listOpenAICompatibleEndpoints).mockReturnValueOnce([])
    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', model: 'whatever' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('throws model_unavailable when the requested endpoint id does not exist', async () => {
    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'nonexistent', model: 'whatever' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'model_unavailable' })
  })

  it('normalizes ECONNREFUSED into network (Ollama not running case)', async () => {
    const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:11434')
    netErr.code = 'ECONNREFUSED'
    mockGenerateText.mockRejectedValue(netErr)

    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/openai-compatible.test.ts
```

Expected: `Cannot find module './openai-compatible'`.

- [ ] **Step 3: Implement the adapter**

Create `electron/llm/adapters/openai-compatible.ts`:

```ts
import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { listOpenAICompatibleEndpoints } from '../../store'
import { LLMError } from '../types'
import type {
  LLMCallOpts,
  ModelRef,
  TextChunk,
  AgentEvent,
  Usage,
  LLMErrorKind,
} from '../types'

export class OpenAICompatibleAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    const endpoint = this.resolveEndpoint(ref)
    const config: Record<string, unknown> = {
      name: endpoint.id,
      baseURL: endpoint.baseUrl,
    }
    if (endpoint.apiKey) config.apiKey = endpoint.apiKey
    const provider = createOpenAICompatible(config as Parameters<typeof createOpenAICompatible>[0])
    try {
      const result = await generateText({
        model: provider(ref.model),
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

  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'OpenAICompatibleAdapter.streamText not implemented (Phase 5)')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'OpenAICompatibleAdapter.runAgentLoop not implemented (Phase 5)')
  }

  private resolveEndpoint(ref: ModelRef): { id: string; baseUrl: string; apiKey?: string } {
    const endpoints = listOpenAICompatibleEndpoints()
    if (endpoints.length === 0) {
      throw new LLMError(
        'auth_missing',
        'No openai-compatible endpoints configured. Add one in Settings → Providers (e.g. http://localhost:11434/v1 for Ollama).',
      )
    }
    if (!ref.endpoint) {
      // No explicit endpoint id → use the first configured endpoint.
      return endpoints[0]
    }
    const match = endpoints.find(e => e.id === ref.endpoint)
    if (!match) {
      throw new LLMError(
        'model_unavailable',
        `Endpoint "${ref.endpoint}" is not configured. Available: ${endpoints.map(e => e.id).join(', ')}.`,
      )
    }
    return match
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string; code?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND') kind = 'network'
  return new LLMError(kind, e?.message ?? 'openai-compatible adapter failed', err)
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/openai-compatible.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/adapters/openai-compatible.ts electron/llm/adapters/openai-compatible.test.ts
git commit -m "feat(llm): openai-compatible adapter for Ollama/LM Studio/llama.cpp"
```

---

## Task 5: Wire all three adapters into `createLLMService` factory (TDD)

**Files:**
- Modify: `electron/llm/index.ts` (the `resolveAdapter` switch in `createLLMService`)
- Modify: `electron/llm/index.test.ts` (extend the dispatch test)

- [ ] **Step 1: Append failing tests**

Open `electron/llm/index.test.ts`. Find the existing `vi.mock('./adapters/anthropic', ...)` block at the top and **add** parallel mocks for the three new adapters:

```ts
// Existing vi.hoisted block at the top — extend with three new mocks:
const { mockAnthropicGen, mockOpenAIGen, mockGoogleGen, mockOpenAICompatGen } = vi.hoisted(() => ({
  mockAnthropicGen: vi.fn(),
  mockOpenAIGen: vi.fn(),
  mockGoogleGen: vi.fn(),
  mockOpenAICompatGen: vi.fn(),
}))

// Existing mock — keep as-is:
vi.mock('./adapters/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockAnthropicGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

// NEW — three new adapter mocks:
vi.mock('./adapters/openai', () => ({
  OpenAIAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockOpenAIGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./adapters/google', () => ({
  GoogleAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockGoogleGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./adapters/openai-compatible', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockOpenAICompatGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))
```

Add this reset call inside the existing `beforeEach`:

```ts
beforeEach(() => {
  mockAnthropicGen.mockReset()
  mockOpenAIGen.mockReset()
  mockGoogleGen.mockReset()
  mockOpenAICompatGen.mockReset()
})
```

Then add new dispatch tests after the existing ones (inside the `describe('createLLMService', ...)` block):

```ts
it('dispatches an openai ModelRef to the OpenAI adapter', async () => {
  mockOpenAIGen.mockResolvedValue({ text: 'gpt', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
  const svc = createLLMService()
  await svc.generateText(
    { provider: 'openai', model: 'gpt-4o' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )
  expect(mockOpenAIGen).toHaveBeenCalledTimes(1)
  expect(mockAnthropicGen).not.toHaveBeenCalled()
})

it('dispatches a google ModelRef to the Google adapter', async () => {
  mockGoogleGen.mockResolvedValue({ text: 'gemini', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
  const svc = createLLMService()
  await svc.generateText(
    { provider: 'google', model: 'gemini-2.5-pro' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )
  expect(mockGoogleGen).toHaveBeenCalledTimes(1)
})

it('dispatches an openai-compatible ModelRef to the OpenAICompatible adapter', async () => {
  mockOpenAICompatGen.mockResolvedValue({ text: 'llama', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
  const svc = createLLMService()
  await svc.generateText(
    { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )
  expect(mockOpenAICompatGen).toHaveBeenCalledTimes(1)
})

it('still throws LLMError kind=unknown for opencode (Phase 6)', async () => {
  const svc = createLLMService()
  await expect(svc.generateText(
    { provider: 'opencode', model: 'claude-sonnet-4-6' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )).rejects.toMatchObject({ name: 'LLMError', kind: 'unknown' })
})
```

**Find and remove** the existing test `'throws LLMError kind=unknown for a provider that has no adapter yet (openai in Phase 1)'` — `openai` now has an adapter, so the assertion is invalid. The new opencode test (above) replaces it for the remaining unimplemented provider.

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/index.test.ts
```

Expected: 3 new dispatch tests fail (openai/google/openai-compatible still throw the Phase 4 stub).

- [ ] **Step 3: Update `electron/llm/index.ts`**

Open `electron/llm/index.ts`. **Replace** the imports and the `resolveAdapter` function:

```ts
// At the top, replace this:
import { AnthropicAdapter } from './adapters/anthropic'

// With this:
import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAIAdapter } from './adapters/openai'
import { GoogleAdapter } from './adapters/google'
import { OpenAICompatibleAdapter } from './adapters/openai-compatible'
```

**Replace** the `createLLMService` function body's adapter declarations and switch:

```ts
export function createLLMService(): LLMService {
  // Adapters are constructed lazily — keeps test mocks predictable and avoids
  // touching settings storage when an adapter is never used.
  let anthropicAdapter:        AnthropicAdapter        | undefined
  let openaiAdapter:           OpenAIAdapter           | undefined
  let googleAdapter:           GoogleAdapter           | undefined
  let openaiCompatibleAdapter: OpenAICompatibleAdapter | undefined

  function resolveAdapter(ref: ModelRef): AdapterLike {
    switch (ref.provider) {
      case 'anthropic':
        return (anthropicAdapter ??= new AnthropicAdapter())
      case 'openai':
        return (openaiAdapter ??= new OpenAIAdapter())
      case 'google':
        return (googleAdapter ??= new GoogleAdapter())
      case 'openai-compatible':
        return (openaiCompatibleAdapter ??= new OpenAICompatibleAdapter())
      case 'opencode':
        // OpenCode adapter lands in Phase 6 alongside its sync target.
        throw new LLMError('unknown', 'Provider "opencode" has no adapter yet — scheduled for Phase 6.')
      default: {
        const exhaustive: never = ref.provider
        throw new LLMError('unknown', `Unknown provider: ${String(exhaustive)}`)
      }
    }
  }

  return {
    async generateText(ref, opts) {
      return resolveAdapter(ref).generateText(ref, opts)
    },
    async *streamText(ref, opts) {
      const adapter = resolveAdapter(ref)
      yield* adapter.streamText(ref, opts)
    },
    async *runAgentLoop(ref, opts) {
      const adapter = resolveAdapter(ref)
      yield* adapter.runAgentLoop(ref, opts)
    },
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/index.test.ts
```

Expected: all tests pass (the 4 original + the 4 new = 8 tests, depending on what stays after removing the old openai-specific stub test).

- [ ] **Step 5: Commit**

```bash
git add electron/llm/index.ts electron/llm/index.test.ts
git commit -m "feat(llm): wire openai + google + openai-compatible into createLLMService"
```

---

## Task 6: Add `network` kind detection to the Anthropic adapter (resolves Phase 1 TODO)

**Files:**
- Modify: `electron/llm/adapters/anthropic.ts` (the `normalizeError` function at lines ~70-83)
- Modify: `electron/llm/adapters/anthropic.test.ts` (add one test)

This was a deferred Phase-1 TODO. Now that openai-compatible local endpoints make `ECONNREFUSED` a load-bearing case, the same detection logic belongs in every adapter.

- [ ] **Step 1: Append the test**

In `electron/llm/adapters/anthropic.test.ts`, inside the existing `describe('AnthropicAdapter.generateText', ...)` block, add:

```ts
it('normalizes ECONNREFUSED into LLMError kind=network', async () => {
  const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:443')
  netErr.code = 'ECONNREFUSED'
  mockGenerateText.mockRejectedValue(netErr)

  const adapter = new AnthropicAdapter()
  await expect(adapter.generateText(
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: new test fails — Anthropic's `normalizeError` currently maps ECONNREFUSED to `unknown`.

- [ ] **Step 3: Add the detection branch**

In `electron/llm/adapters/anthropic.ts`, find the `normalizeError` function and **replace** the `TODO(Phase 4)` comment + the missing branch with:

```ts
function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string; code?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND') kind = 'network'
  return new LLMError(kind, e?.message ?? 'Anthropic adapter failed', err)
}
```

(The change is: remove the `TODO(Phase 4)` comment block and add the `else if (e?.code === 'ECONNREFUSED' ...)` branch. The function body otherwise stays identical.)

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: all tests pass (8 existing + 1 new = 9).

- [ ] **Step 5: Commit**

```bash
git add electron/llm/adapters/anthropic.ts electron/llm/adapters/anthropic.test.ts
git commit -m "feat(llm): network error kind detection in Anthropic adapter (resolves Phase 1 TODO)"
```

---

## Task 7: Defaults storage schema + helpers (TDD)

**Files:**
- Modify: `electron/store.ts` (extend `ApiStoreSchema` + add helpers near the providers section)
- Modify: `electron/store.providers.test.ts` (add tests for the new helpers)

The spec's `defaults.*` block was deferred from Phase 1; it lands now so the new Defaults UI in Task 9 has somewhere to read/write.

- [ ] **Step 1: Append the failing tests**

In `electron/store.providers.test.ts`, append a new describe block at the end of the file:

```ts
describe('defaults', () => {
  it('getDefault returns undefined when no default has been set', () => {
    const { getDefault } = require('./store') as typeof import('./store')
    expect(getDefault('chat')).toBeUndefined()
    expect(getDefault('skillGen')).toBeUndefined()
    expect(getDefault('tagExtract')).toBeUndefined()
  })

  it('setDefault round-trips a ModelRef for each feature key', () => {
    const { getDefault, setDefault } = require('./store') as typeof import('./store')
    setDefault('chat',        { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    setDefault('skillGen',    { provider: 'openai',    model: 'gpt-4o' })
    setDefault('tagExtract',  { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1:70b' })

    expect(getDefault('chat')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(getDefault('skillGen')).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(getDefault('tagExtract')).toEqual({
      provider: 'openai-compatible',
      endpoint: 'ollama-local',
      model: 'llama3.1:70b',
    })
  })

  it('setDefault validates the ref by calling parseModelRef (rejects invalid)', () => {
    const { setDefault } = require('./store') as typeof import('./store')
    expect(() => setDefault('chat', { provider: 'mystery' as any, model: 'foo' }))
      .toThrow(/provider/i)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/store.providers.test.ts
```

Expected: the 3 new tests fail — `getDefault` / `setDefault` are not exported yet.

- [ ] **Step 3: Extend `electron/store.ts`**

Add the schema fields and helpers. Find the existing `ApiStoreSchema` interface (it ends near the `providers.openai-compatible.endpoints` line) and add three new keys before the closing `}`:

```ts
  'defaults.chat'?:       { provider: ProviderId; model: string; endpoint?: string }
  'defaults.skillGen'?:   { provider: ProviderId; model: string; endpoint?: string }
  'defaults.tagExtract'?: { provider: ProviderId; model: string; endpoint?: string }
```

Then add the helpers at the bottom of the `// ── Generic per-provider config` section (or in a new section just below it). Import `parseModelRef` at the top of the file alongside the existing `ProviderId` import:

```ts
// Add to imports at top:
import type { ProviderId } from './llm/types'
import { parseModelRef, formatModelRef } from './llm/registry'

// Add to the bottom of the providers section (before the migration function):
export type DefaultFeature = 'chat' | 'skillGen' | 'tagExtract'
export type StoredModelRef = { provider: ProviderId; model: string; endpoint?: string }

export function getDefault(feature: DefaultFeature): StoredModelRef | undefined {
  const key = `defaults.${feature}` as keyof ApiStoreSchema
  return apiStore.get(key) as StoredModelRef | undefined
}

export function setDefault(feature: DefaultFeature, ref: StoredModelRef): void {
  // Validate the ref shape by round-tripping through the parser. This rejects
  // unknown providers + malformed openai-compatible endpoints, matching the
  // validation that the LLM service performs at call time.
  const formatted = formatModelRef(ref)
  parseModelRef(formatted)  // throws on invalid

  const key = `defaults.${feature}` as keyof ApiStoreSchema
  apiStore.set(key, ref as never)
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/store.providers.test.ts
```

Expected: all tests in the file pass (the existing 17 + the 3 new = 20).

- [ ] **Step 5: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add electron/store.ts electron/store.providers.test.ts
git commit -m "feat(store): defaults.{chat,skillGen,tagExtract} storage + getDefault/setDefault helpers"
```

---

## Task 8: LLM IPC handlers + preload surface (TDD)

**Files:**
- Create: `electron/ipc/llmHandlers.ts`
- Create: `electron/ipc/llmHandlers.test.ts`
- Modify: `electron/main.ts` (one new import + one new `registerLLMHandlers()` call inside `app.whenReady`)
- Modify: `electron/preload.ts` (expose `window.api.llm.*` mirroring the IPC channels)

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/llmHandlers.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockHandle, registered } = vi.hoisted(() => {
  const registered = new Map<string, (...args: any[]) => unknown>()
  return {
    registered,
    mockHandle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      registered.set(channel, handler)
    }),
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('../store', () => ({
  getProviderConfig: vi.fn(),
  setProviderConfig: vi.fn(),
  listOpenAICompatibleEndpoints: vi.fn(() => []),
  upsertOpenAICompatibleEndpoint: vi.fn(),
  removeOpenAICompatibleEndpoint: vi.fn(),
  getDefault: vi.fn(),
  setDefault: vi.fn(),
}))

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { registerLLMHandlers } from './llmHandlers'

beforeEach(() => {
  registered.clear()
  mockHandle.mockClear()
  mockGenerateText.mockReset()
  registerLLMHandlers()
})

describe('llmHandlers — registration', () => {
  it('registers every llm:* channel', () => {
    const channels = Array.from(registered.keys()).sort()
    expect(channels).toEqual([
      'llm:getDefault',
      'llm:getProviderConfig',
      'llm:listOpenAICompatibleEndpoints',
      'llm:listProviders',
      'llm:removeOpenAICompatibleEndpoint',
      'llm:setDefault',
      'llm:setProviderConfig',
      'llm:testConnection',
      'llm:upsertOpenAICompatibleEndpoint',
    ])
  })
})

describe('llm:listProviders', () => {
  it('returns the 5 known provider ids', async () => {
    const handler = registered.get('llm:listProviders')!
    const ids = await handler(null)
    expect(ids).toEqual(['anthropic', 'openai', 'google', 'opencode', 'openai-compatible'])
  })
})

describe('llm:getProviderConfig', () => {
  it('proxies to the store helper', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: 'sk-test' })

    const handler = registered.get('llm:getProviderConfig')!
    const cfg = await handler(null, 'openai')
    expect(cfg).toEqual({ enabled: true, apiKey: 'sk-test' })
    expect(storeMod.getProviderConfig).toHaveBeenCalledWith('openai')
  })

  it('rejects unknown provider ids', async () => {
    const handler = registered.get('llm:getProviderConfig')!
    await expect(handler(null, 'mystery')).rejects.toThrow(/provider/i)
  })
})

describe('llm:setProviderConfig', () => {
  it('proxies to the store helper', async () => {
    const storeMod = await import('../store')
    const handler = registered.get('llm:setProviderConfig')!
    await handler(null, 'openai', { enabled: true, apiKey: 'sk-new' })
    expect(storeMod.setProviderConfig).toHaveBeenCalledWith('openai', { enabled: true, apiKey: 'sk-new' })
  })
})

describe('llm:testConnection', () => {
  it('returns { ok: true } when the LLM responds', async () => {
    mockGenerateText.mockResolvedValue({ text: 'pong', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const handler = registered.get('llm:testConnection')!
    const result = await handler(null, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(result).toMatchObject({ ok: true })
  })

  it('returns { ok: false, kind, message } when the LLM throws an LLMError', async () => {
    const { LLMError } = await import('../llm')
    mockGenerateText.mockRejectedValue(new LLMError('auth_invalid', 'Bad key'))
    const handler = registered.get('llm:testConnection')!
    const result = await handler(null, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(result).toMatchObject({ ok: false, kind: 'auth_invalid', message: expect.stringContaining('Bad key') })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/ipc/llmHandlers.test.ts
```

Expected: `Cannot find module './llmHandlers'`.

- [ ] **Step 3: Create the handler module**

Create `electron/ipc/llmHandlers.ts`:

```ts
import { ipcMain } from 'electron'
import {
  getProviderConfig,
  setProviderConfig,
  listOpenAICompatibleEndpoints,
  upsertOpenAICompatibleEndpoint,
  removeOpenAICompatibleEndpoint,
  getDefault,
  setDefault,
  type DefaultFeature,
  type StoredModelRef,
} from '../store'
import { createLLMService, LLMError, type ModelRef, type ProviderId } from '../llm'

const KNOWN_PROVIDERS: readonly ProviderId[] = [
  'anthropic', 'openai', 'google', 'opencode', 'openai-compatible',
] as const

function assertKnownProvider(p: unknown): asserts p is ProviderId {
  if (typeof p !== 'string' || !(KNOWN_PROVIDERS as readonly string[]).includes(p)) {
    throw new Error(`Unknown provider: ${JSON.stringify(p)}`)
  }
}

const KNOWN_FEATURES: readonly DefaultFeature[] = ['chat', 'skillGen', 'tagExtract'] as const

function assertKnownFeature(f: unknown): asserts f is DefaultFeature {
  if (typeof f !== 'string' || !(KNOWN_FEATURES as readonly string[]).includes(f)) {
    throw new Error(`Unknown feature: ${JSON.stringify(f)}`)
  }
}

export function registerLLMHandlers(): void {
  // ── Providers ─────────────────────────────────────────────────────
  ipcMain.handle('llm:listProviders', async () => [...KNOWN_PROVIDERS])

  ipcMain.handle('llm:getProviderConfig', async (_event, provider: unknown) => {
    assertKnownProvider(provider)
    return getProviderConfig(provider)
  })

  ipcMain.handle('llm:setProviderConfig', async (_event, provider: unknown, cfg: unknown) => {
    assertKnownProvider(provider)
    if (typeof cfg !== 'object' || cfg === null) throw new Error('cfg must be an object')
    setProviderConfig(provider, cfg as Parameters<typeof setProviderConfig>[1])
  })

  // ── openai-compatible endpoints ───────────────────────────────────
  ipcMain.handle('llm:listOpenAICompatibleEndpoints', async () => listOpenAICompatibleEndpoints())

  ipcMain.handle('llm:upsertOpenAICompatibleEndpoint', async (_event, ep: unknown) => {
    if (typeof ep !== 'object' || ep === null) throw new Error('endpoint must be an object')
    upsertOpenAICompatibleEndpoint(ep as Parameters<typeof upsertOpenAICompatibleEndpoint>[0])
  })

  ipcMain.handle('llm:removeOpenAICompatibleEndpoint', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    removeOpenAICompatibleEndpoint(id)
  })

  // ── Defaults ──────────────────────────────────────────────────────
  ipcMain.handle('llm:getDefault', async (_event, feature: unknown) => {
    assertKnownFeature(feature)
    return getDefault(feature)
  })

  ipcMain.handle('llm:setDefault', async (_event, feature: unknown, ref: unknown) => {
    assertKnownFeature(feature)
    if (typeof ref !== 'object' || ref === null) throw new Error('ref must be an object')
    setDefault(feature, ref as StoredModelRef)
  })

  // ── Test connection ───────────────────────────────────────────────
  ipcMain.handle('llm:testConnection', async (_event, ref: unknown) => {
    if (typeof ref !== 'object' || ref === null) throw new Error('ref must be an object')
    const modelRef = ref as ModelRef
    try {
      const llm = createLLMService()
      const result = await llm.generateText(modelRef, {
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 8,
      })
      return { ok: true, sample: result.text.slice(0, 80) }
    } catch (err) {
      if (err instanceof LLMError) {
        return { ok: false, kind: err.kind, message: err.message }
      }
      return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
    }
  })
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/ipc/llmHandlers.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Wire into `electron/main.ts` startup**

In `electron/main.ts`, add the import near the other handler imports (search for `registerCreateHandlers` or similar to find the right spot):

```ts
import { registerLLMHandlers } from './ipc/llmHandlers'
```

Then inside `app.whenReady().then(() => { ... })` (line ~2623, the same callback where `migrateApiStore()` lives), add `registerLLMHandlers()` after `migrateApiStore()`:

```ts
app.whenReady().then(() => {
  migrateApiStore()
  registerLLMHandlers()
  // ... existing startup ...
})
```

- [ ] **Step 6: Expose `window.api.llm.*` in `electron/preload.ts`**

Open `electron/preload.ts`. Find the `settings: { ... }` block (lines ~74-81 per the explorer) and add a new `llm:` block alongside it, inside the same `contextBridge.exposeInMainWorld('api', {...})` object:

```ts
llm: {
  listProviders:                () => ipcRenderer.invoke('llm:listProviders') as Promise<string[]>,
  getProviderConfig:            (provider: string) => ipcRenderer.invoke('llm:getProviderConfig', provider) as Promise<{ enabled: boolean; apiKey?: string; organization?: string }>,
  setProviderConfig:            (provider: string, cfg: { enabled: boolean; apiKey?: string; organization?: string }) => ipcRenderer.invoke('llm:setProviderConfig', provider, cfg) as Promise<void>,
  listOpenAICompatibleEndpoints: () => ipcRenderer.invoke('llm:listOpenAICompatibleEndpoints') as Promise<Array<{ id: string; label: string; baseUrl: string; apiKey?: string }>>,
  upsertOpenAICompatibleEndpoint: (ep: { id: string; label: string; baseUrl: string; apiKey?: string }) => ipcRenderer.invoke('llm:upsertOpenAICompatibleEndpoint', ep) as Promise<void>,
  removeOpenAICompatibleEndpoint: (id: string) => ipcRenderer.invoke('llm:removeOpenAICompatibleEndpoint', id) as Promise<void>,
  getDefault:                   (feature: 'chat' | 'skillGen' | 'tagExtract') => ipcRenderer.invoke('llm:getDefault', feature) as Promise<{ provider: string; model: string; endpoint?: string } | undefined>,
  setDefault:                   (feature: 'chat' | 'skillGen' | 'tagExtract', ref: { provider: string; model: string; endpoint?: string }) => ipcRenderer.invoke('llm:setDefault', feature, ref) as Promise<void>,
  testConnection:               (ref: { provider: string; model: string; endpoint?: string }) => ipcRenderer.invoke('llm:testConnection', ref) as Promise<{ ok: boolean; sample?: string; kind?: string; message?: string }>,
},
```

- [ ] **Step 7: Update `window.api` type augmentation**

Search the repo for the existing `window.api` type augmentation:

```bash
grep -rn "interface Window" src/ --include="*.ts" --include="*.tsx" --include="*.d.ts" | head -5
```

Locate the file that declares `Window.api` (typical names: `src/types/api.d.ts`, `src/preload.d.ts`, or inline at the top of a major view). Add a parallel `llm` namespace mirroring the preload shape:

```ts
llm: {
  listProviders():        Promise<string[]>
  getProviderConfig(provider: string):                                                                    Promise<{ enabled: boolean; apiKey?: string; organization?: string }>
  setProviderConfig(provider: string, cfg: { enabled: boolean; apiKey?: string; organization?: string }): Promise<void>
  listOpenAICompatibleEndpoints():                                                                        Promise<Array<{ id: string; label: string; baseUrl: string; apiKey?: string }>>
  upsertOpenAICompatibleEndpoint(ep: { id: string; label: string; baseUrl: string; apiKey?: string }):    Promise<void>
  removeOpenAICompatibleEndpoint(id: string):                                                             Promise<void>
  getDefault(feature: 'chat' | 'skillGen' | 'tagExtract'):                                                Promise<{ provider: string; model: string; endpoint?: string } | undefined>
  setDefault(feature: 'chat' | 'skillGen' | 'tagExtract', ref: { provider: string; model: string; endpoint?: string }): Promise<void>
  testConnection(ref: { provider: string; model: string; endpoint?: string }):                            Promise<{ ok: boolean; sample?: string; kind?: string; message?: string }>
}
```

If no `Window` augmentation file exists, the renderer-side code uses `(window as any).api.*` casts — in that case, skip this step and add `as any` casts in Task 9 where needed.

- [ ] **Step 8: Confirm typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

```bash
git add electron/ipc/llmHandlers.ts electron/ipc/llmHandlers.test.ts electron/main.ts electron/preload.ts src/types/api.d.ts 2>/dev/null
git commit -m "feat(ipc): llm:* handlers — provider config, endpoints, defaults, testConnection"
```

(The `2>/dev/null` is in case `src/types/api.d.ts` doesn't exist on this branch — staging a missing path is harmless.)

---

## Task 9: Settings UI — Providers category with cards + endpoints sub-list

**Files:**
- Modify: `src/views/Settings.tsx` (add `'providers'` to `CategoryId`, add `renderProviders()`, render in main pane)
- Modify: `src/styles/globals.css` (optional minor additions if the existing connector-row classes don't cover everything)

This is the biggest task. Build it incrementally — get the cards rendering with mock data, then wire IPC, then add the endpoints sub-list.

Per the existing memory note (`feedback_no_visual_testing`): no dev-server screenshot validation. UI verification is the user's job after this task ships.

- [ ] **Step 1: Add `'providers'` to the CategoryId union and CATEGORIES array**

In `src/views/Settings.tsx` find the `CategoryId` type (lines ~81-89 per the explorer):

```ts
// Replace:
type CategoryId = 'claude-desktop' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'

// With:
type CategoryId = 'providers' | 'claude-desktop' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

Find the `CATEGORIES` array (just below the type) and add a new entry at the top:

```ts
const CATEGORIES: { id: CategoryId; label: string; icon: string }[] = [
  { id: 'providers',      label: 'Providers',        icon: '🔌' },  // NEW
  { id: 'claude-desktop', label: 'Claude Desktop',   icon: '🤖' },
  // ... rest unchanged ...
]
```

(Pick an existing icon style if `🔌` doesn't match the codebase — the icon is whatever the other categories use. If the explorer shows lucide-react icons or SVGs in use elsewhere, switch.)

- [ ] **Step 2: Add module-level types + state for provider configs + endpoints + defaults**

Add these type aliases at **module scope** (top of `Settings.tsx`, near the existing imports — not inside the component). The helper components in Steps 5-6 and Task 10 reference them.

```ts
type ProviderConfig = { enabled: boolean; apiKey?: string; organization?: string }
type OpenAICompatibleEndpoint = { id: string; label: string; baseUrl: string; apiKey?: string }
type DefaultRef = { provider: string; model: string; endpoint?: string } | undefined
```

Then **inside** the `Settings` component function, alongside the existing state (search for `useState<` at the top of the component body), add:

```ts
const [anthropicCfg,  setAnthropicCfg]  = useState<ProviderConfig>({ enabled: false })
const [openaiCfg,     setOpenaiCfg]     = useState<ProviderConfig>({ enabled: false })
const [googleCfg,     setGoogleCfg]     = useState<ProviderConfig>({ enabled: false })
const [endpoints,     setEndpoints]     = useState<OpenAICompatibleEndpoint[]>([])
const [chatDefault,   setChatDefault]   = useState<DefaultRef>(undefined)
const [skillDefault,  setSkillDefault]  = useState<DefaultRef>(undefined)
const [tagDefault,    setTagDefault]    = useState<DefaultRef>(undefined)
const [testStatus,    setTestStatus]    = useState<Record<string, { ok: boolean; message?: string } | 'testing'>>({})
```

- [ ] **Step 3: Add a useEffect to load provider data on first render**

Add this `useEffect` near the other useEffect calls:

```ts
useEffect(() => {
  if (activeCategory !== 'providers') return
  let cancelled = false
  ;(async () => {
    const api = (window as any).api.llm
    const [a, o, g, eps, cd, sd, td] = await Promise.all([
      api.getProviderConfig('anthropic'),
      api.getProviderConfig('openai'),
      api.getProviderConfig('google'),
      api.listOpenAICompatibleEndpoints(),
      api.getDefault('chat'),
      api.getDefault('skillGen'),
      api.getDefault('tagExtract'),
    ])
    if (cancelled) return
    setAnthropicCfg(a)
    setOpenaiCfg(o)
    setGoogleCfg(g)
    setEndpoints(eps)
    setChatDefault(cd)
    setSkillDefault(sd)
    setTagDefault(td)
  })().catch(err => console.error('[settings] failed to load provider configs:', err))
  return () => { cancelled = true }
}, [activeCategory])
```

- [ ] **Step 4: Add the `renderProviders` function**

Inside the `Settings` component (alongside the other `renderXxx` functions), add:

```tsx
const renderProviders = () => {
  const saveProvider = async (provider: 'anthropic' | 'openai' | 'google', cfg: ProviderConfig) => {
    await (window as any).api.llm.setProviderConfig(provider, cfg)
  }

  const testProvider = async (provider: string, modelHint: string) => {
    setTestStatus(s => ({ ...s, [provider]: 'testing' }))
    const result = await (window as any).api.llm.testConnection({ provider, model: modelHint })
    setTestStatus(s => ({ ...s, [provider]: { ok: result.ok, message: result.ok ? `OK: ${result.sample ?? ''}` : `${result.kind}: ${result.message}` } }))
  }

  const renderStatus = (provider: string) => {
    const s = testStatus[provider]
    if (s === 'testing') return <span className="connector-badge">Testing…</span>
    if (!s) return null
    if (s.ok) return <span className="connector-badge connected">{s.message}</span>
    return <span className="connector-badge" style={{ background: 'var(--accent-red-soft, #fee2e2)', color: 'var(--accent-red, #991b1b)' }}>{s.message}</span>
  }

  return (
    <>
      <div className="settings-group">
        <div className="settings-group-title">API providers</div>
        <div className="settings-group-body">

          {/* Anthropic card */}
          <div className="connector-row">
            <div className="connector-icon">🤖</div>
            <div className="connector-info">
              <div style={{ fontWeight: 500 }}>Anthropic</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Claude Sonnet, Opus, Haiku via the Anthropic API.</div>
              <input
                className="settings-input"
                type="password"
                placeholder="sk-ant-..."
                value={anthropicCfg.apiKey ?? ''}
                onChange={e => setAnthropicCfg({ ...anthropicCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                onBlur={() => saveProvider('anthropic', anthropicCfg)}
                style={{ marginTop: 8, width: '100%' }}
              />
            </div>
            <div className="connector-actions">
              <button className="settings-btn" disabled={!anthropicCfg.apiKey} onClick={() => testProvider('anthropic', 'claude-haiku-4-5-20251001')}>Test</button>
              {renderStatus('anthropic')}
            </div>
          </div>

          {/* OpenAI card */}
          <div className="connector-row">
            <div className="connector-icon">🟢</div>
            <div className="connector-info">
              <div style={{ fontWeight: 500 }}>OpenAI</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>GPT-4o, GPT-4.1, o-series.</div>
              <input
                className="settings-input"
                type="password"
                placeholder="sk-..."
                value={openaiCfg.apiKey ?? ''}
                onChange={e => setOpenaiCfg({ ...openaiCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                onBlur={() => saveProvider('openai', openaiCfg)}
                style={{ marginTop: 8, width: '100%' }}
              />
              <input
                className="settings-input"
                type="text"
                placeholder="Organization ID (optional)"
                value={openaiCfg.organization ?? ''}
                onChange={e => setOpenaiCfg({ ...openaiCfg, organization: e.target.value || undefined })}
                onBlur={() => saveProvider('openai', openaiCfg)}
                style={{ marginTop: 4, width: '100%' }}
              />
            </div>
            <div className="connector-actions">
              <button className="settings-btn" disabled={!openaiCfg.apiKey} onClick={() => testProvider('openai', 'gpt-4o')}>Test</button>
              {renderStatus('openai')}
            </div>
          </div>

          {/* Google card */}
          <div className="connector-row">
            <div className="connector-icon">🔷</div>
            <div className="connector-info">
              <div style={{ fontWeight: 500 }}>Google Gemini</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Gemini 1.5/2.0/2.5 Pro and Flash.</div>
              <input
                className="settings-input"
                type="password"
                placeholder="g-..."
                value={googleCfg.apiKey ?? ''}
                onChange={e => setGoogleCfg({ ...googleCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
                onBlur={() => saveProvider('google', googleCfg)}
                style={{ marginTop: 8, width: '100%' }}
              />
            </div>
            <div className="connector-actions">
              <button className="settings-btn" disabled={!googleCfg.apiKey} onClick={() => testProvider('google', 'gemini-2.5-pro')}>Test</button>
              {renderStatus('google')}
            </div>
          </div>

          {/* OpenAI-compatible card (with endpoints sub-list) */}
          <OpenAICompatibleSection endpoints={endpoints} setEndpoints={setEndpoints} testProvider={testProvider} renderStatus={renderStatus} />

        </div>
      </div>

      {/* Defaults section — Task 10 fills this in */}
      <DefaultsSection chatDefault={chatDefault} setChatDefault={setChatDefault}
                       skillDefault={skillDefault} setSkillDefault={setSkillDefault}
                       tagDefault={tagDefault} setTagDefault={setTagDefault} />
    </>
  )
}
```

Then add `renderProviders()` to the conditional rendering near line 1200:

```ts
{activeCategory === 'providers' && renderProviders()}
```

- [ ] **Step 5: Stub the sub-components used in Step 4**

Above the `Settings` component (or in the same file just below the imports), add minimal stubs that Task 10 fills out:

```tsx
function OpenAICompatibleSection(props: {
  endpoints: OpenAICompatibleEndpoint[]
  setEndpoints: React.Dispatch<React.SetStateAction<OpenAICompatibleEndpoint[]>>
  testProvider: (provider: string, modelHint: string) => Promise<void>
  renderStatus: (provider: string) => React.ReactNode
}) {
  // Filled in by step 6 below.
  return (
    <div className="connector-row">
      <div className="connector-icon">🏠</div>
      <div className="connector-info">
        <div style={{ fontWeight: 500 }}>Local / openai-compatible</div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>Ollama, LM Studio, llama.cpp — anything that speaks the OpenAI API.</div>
        <div style={{ marginTop: 8, fontSize: 12 }}>{props.endpoints.length} endpoint(s) configured</div>
      </div>
    </div>
  )
}

function DefaultsSection(props: {
  chatDefault:  DefaultRef
  setChatDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
  skillDefault: DefaultRef
  setSkillDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
  tagDefault:   DefaultRef
  setTagDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
}) {
  // Filled in by Task 10.
  return null
}
```

(These stubs make Step 4 compile. Steps 6 and Task 10 replace them with the real implementations.)

- [ ] **Step 6: Implement `OpenAICompatibleSection` with the endpoints list + add/remove**

Replace the stub from Step 5 with:

```tsx
function OpenAICompatibleSection(props: {
  endpoints: OpenAICompatibleEndpoint[]
  setEndpoints: React.Dispatch<React.SetStateAction<OpenAICompatibleEndpoint[]>>
  testProvider: (provider: string, modelHint: string) => Promise<void>
  renderStatus: (provider: string) => React.ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const [newId,    setNewId]    = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newUrl,   setNewUrl]   = useState('')
  const [newKey,   setNewKey]   = useState('')

  const submitAdd = async () => {
    if (!newId.trim() || !newLabel.trim() || !newUrl.trim()) return
    const ep = { id: newId.trim(), label: newLabel.trim(), baseUrl: newUrl.trim(), apiKey: newKey.trim() || undefined }
    await (window as any).api.llm.upsertOpenAICompatibleEndpoint(ep)
    const fresh = await (window as any).api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
    setAdding(false)
    setNewId(''); setNewLabel(''); setNewUrl(''); setNewKey('')
  }

  const removeEp = async (id: string) => {
    await (window as any).api.llm.removeOpenAICompatibleEndpoint(id)
    const fresh = await (window as any).api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
  }

  return (
    <div className="connector-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div className="connector-icon">🏠</div>
        <div className="connector-info" style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>Local / openai-compatible</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>Ollama, LM Studio, llama.cpp — anything that speaks the OpenAI REST API.</div>
        </div>
        <div className="connector-actions">
          <button className="settings-btn" onClick={() => setAdding(true)}>Add endpoint</button>
        </div>
      </div>

      {props.endpoints.length > 0 && (
        <div className="connector-list" style={{ marginLeft: 50 }}>
          {props.endpoints.map(ep => (
            <div key={ep.id} className="connector-row">
              <div className="connector-info" style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{ep.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>{ep.baseUrl} <span style={{ opacity: 0.6 }}>(id: {ep.id})</span></div>
              </div>
              <div className="connector-actions">
                <button className="settings-btn" onClick={() => props.testProvider(`openai-compatible:${ep.id}`, 'gpt-3.5-turbo')}>Test</button>
                {props.renderStatus(`openai-compatible:${ep.id}`)}
                <button className="settings-btn settings-btn--link" onClick={() => removeEp(ep.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="connector-add-modal" style={{ marginLeft: 50 }}>
          <div className="connector-modal-header"><strong>Add openai-compatible endpoint</strong></div>
          <div className="connector-modal-fields" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="settings-input" placeholder="id (slug, e.g. ollama-local)" value={newId}    onChange={e => setNewId(e.target.value)} />
            <input className="settings-input" placeholder="Display label"                value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            <input className="settings-input" placeholder="Base URL (e.g. http://localhost:11434/v1)" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
            <input className="settings-input" type="password" placeholder="API key (optional, leave blank for local)" value={newKey} onChange={e => setNewKey(e.target.value)} />
          </div>
          <div className="connector-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="settings-btn settings-btn--ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="settings-btn" onClick={submitAdd}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If errors mention missing `useState` / `React`, ensure the import at the top of `Settings.tsx` already includes them (it should — the file uses React heavily).

- [ ] **Step 8: Run the full electron test sweep**

```bash
npm test -- electron/
```

Expected: every electron test passes (the UI change doesn't touch electron tests).

- [ ] **Step 9: Manual smoke test**

Per the no-visual-testing memory, **stop here and ask the user to verify the Settings UI**:

> "Phase 4 Task 9 ready for visual check. Launch the app (`npm run dev`), open Settings, click the new **Providers** category. You should see four cards (Anthropic, OpenAI, Google, Local/openai-compatible). Try: paste an API key in any card and click Test. Add a local endpoint (Add endpoint → fill in id `ollama-local`, label `Ollama`, base URL `http://localhost:11434/v1`)."

Wait for explicit user confirmation before continuing to commit.

- [ ] **Step 10: Commit**

```bash
git add src/views/Settings.tsx src/styles/globals.css 2>/dev/null
git commit -m "feat(settings): Providers category with cards + openai-compatible endpoints"
```

---

## Task 10: Settings UI — Defaults section

**Files:**
- Modify: `src/views/Settings.tsx` (replace the `DefaultsSection` stub from Task 9 Step 5)

Per the spec, the Defaults section lets the user pick which model is the default for each app feature (chat, skill gen, tag extraction). For Phase 4 we ship the minimum: a text input per feature that accepts a `parseModelRef`-compatible string. Phase 5 (or a polish pass) can add a fancy dropdown.

- [ ] **Step 1: Replace the `DefaultsSection` stub**

In `src/views/Settings.tsx`, find the `function DefaultsSection(...)` stub from Task 9 Step 5 and replace it with:

```tsx
function DefaultsSection(props: {
  chatDefault:  DefaultRef
  setChatDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
  skillDefault: DefaultRef
  setSkillDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
  tagDefault:   DefaultRef
  setTagDefault: React.Dispatch<React.SetStateAction<DefaultRef>>
}) {
  const [saveError, setSaveError] = useState<string | null>(null)

  const refToString = (r: DefaultRef): string => {
    if (!r) return ''
    if (r.endpoint) return `${r.provider}:${r.endpoint}/${r.model}`
    return `${r.provider}/${r.model}`
  }

  const saveFeature = async (
    feature: 'chat' | 'skillGen' | 'tagExtract',
    value: string,
    setter: React.Dispatch<React.SetStateAction<DefaultRef>>,
  ) => {
    setSaveError(null)
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      // Empty input — clear the default (sentinel: write undefined, but our IPC
      // doesn't have a delete. Workaround: store provider='anthropic', model='inherit').
      const ref = { provider: 'anthropic', model: 'inherit' }
      try {
        await (window as any).api.llm.setDefault(feature, ref)
        setter(ref)
      } catch (err) { setSaveError(err instanceof Error ? err.message : String(err)) }
      return
    }
    // Parse the string client-side using the same grammar parseModelRef uses,
    // for fast UX. The IPC handler re-validates server-side.
    const slashIdx = trimmed.indexOf('/')
    if (slashIdx === -1) { setSaveError(`Expected "<provider>/<model>"`); return }
    const left = trimmed.slice(0, slashIdx)
    const model = trimmed.slice(slashIdx + 1)
    if (!model) { setSaveError('Model cannot be empty'); return }

    let provider = left
    let endpoint: string | undefined
    const colonIdx = left.indexOf(':')
    if (colonIdx !== -1) {
      provider = left.slice(0, colonIdx)
      endpoint = left.slice(colonIdx + 1)
    }

    const ref = endpoint
      ? { provider, model, endpoint }
      : { provider, model }
    try {
      await (window as any).api.llm.setDefault(feature, ref)
      setter(ref)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const featureRow = (
    label: string,
    description: string,
    current: DefaultRef,
    feature: 'chat' | 'skillGen' | 'tagExtract',
    setter: React.Dispatch<React.SetStateAction<DefaultRef>>,
  ) => (
    <div className="settings-group-row settings-group-row--full">
      <div className="settings-group-row-main">
        <div className="settings-group-row-label">{label}</div>
        <div className="settings-group-row-sub">{description}</div>
      </div>
      <input
        className="settings-input"
        placeholder="e.g. anthropic/claude-sonnet-4-6 or openai/gpt-4o"
        defaultValue={refToString(current)}
        onBlur={e => saveFeature(feature, e.target.value, setter)}
        style={{ marginTop: 8, width: '100%' }}
      />
    </div>
  )

  return (
    <div className="settings-group">
      <div className="settings-group-title">Defaults</div>
      <div className="settings-group-body">
        {featureRow(
          'Chat default',
          'Used by the AI Chat overlay when no agent specifies a model.',
          props.chatDefault, 'chat', props.setChatDefault,
        )}
        {featureRow(
          'Skill generation default',
          'Used when generating skills from repositories.',
          props.skillDefault, 'skillGen', props.setSkillDefault,
        )}
        {featureRow(
          'Tag extraction default',
          'Background task: extracts search tags from queries.',
          props.tagDefault, 'tagExtract', props.setTagDefault,
        )}
        {saveError && (
          <div style={{ padding: '8px 16px', color: 'var(--accent-red, #991b1b)', fontSize: 12 }}>
            Save error: {saveError}
          </div>
        )}
        <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text2)' }}>
          Note (Phase 4): defaults are stored but not yet read by the call sites — that wiring lands in a follow-up. Today the chat, skill gen, and tag extraction features continue to use their hardcoded Claude models.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

> "Phase 4 Task 10 ready for visual check. In Settings → Providers, scroll down to the new **Defaults** section. Try: type `openai/gpt-4o` in Chat default and tab out — it should save without error. Type something invalid like `nonsense` — should show a save error."

Wait for user confirmation.

- [ ] **Step 4: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(settings): Defaults section for chat/skillGen/tagExtract model refs"
```

---

## Phase 4 done — verification checklist

After Task 10:

- [ ] `npm test -- electron/` passes end-to-end (pre-existing renderer-side failures unchanged)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline b7fb44f..HEAD` shows 9 new commits (1 plan + 8 tasks)
- [ ] Manual smoke test from the user covering Settings → Providers (add a key per provider, add a local endpoint, set a default model)
- [ ] Sanity check: `grep -rn "Phase 4" electron/llm/` returns only test/doc references — no remaining `throw new LLMError(..., 'scheduled for Phase 4...')` stubs

Phase 4 ships the first user-visible multi-provider experience. Settings → Providers lets the user configure four provider types and three feature defaults. The internal AI call sites continue to use their hardcoded Claude models — the defaults plumbing is the next phase's work (alongside the in-app agent runner in Phase 5).

## Out of scope (deferred)

- **Wiring defaults into call sites.** `tag-extractor.ts`, `skill-gen/legacy.ts` etc. continue using `claude-haiku-4-5-20251001` / `claude-haiku-4-5` hardcoded. Phase 5 reads `settings.defaults.tagExtract` etc. to resolve at call time.
- **OpenCode card.** Phase 6 handles OpenCode end-to-end (CLI install + sync target + Providers card).
- **Renaming "Claude Desktop" → "Claude Code & OpenCode".** Phase 6.
- **Removing the Anthropic API key input from the existing Claude Desktop section.** Currently duplicated with the Providers card — both write to the same store slot, so this is consistent but not minimal. Phase 6 cleanup.
- **Fancy ModelRef picker UI** (provider dropdown → model dropdown). Phase 4's `<input>` accepts a string. Polish job.
- **Test Connection button on the Defaults section.** Not strictly needed; user can test from the provider cards.
- **Live API smoke tests in vitest.** Continues to use mocks per Phase 1's testing strategy. Manual smoke tests cover the network path.
