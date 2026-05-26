# Phase 5 — In-App Agent Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the in-app agent runtime so non-CLI providers (OpenAI, Google, openai-compatible) can run agents inside the AI Chat overlay against MCP tools, and wire the Phase-4-deferred `settings.defaults.*` storage into the existing call sites.

**Architecture:** A dedicated MCP client (`electron/llm/mcpClient.ts`) spawns a second instance of the existing MCP server subprocess and exposes its tools as `McpTool[]`. Each adapter's `runAgentLoop` becomes a real Vercel-AI-SDK `streamText` call that yields `AgentEvent`s (text deltas, tool calls, tool results, done, error). A new `runner.ts` orchestrator wraps any adapter's `runAgentLoop` with auto-injected MCP tools. The existing `aiChatService.sendMessageStream` is split into a dispatcher (`runChat`) that picks the CLI path (Anthropic/OpenCode) or the in-app runner path (others) based on `modelRef.provider`. The AI Chat overlay grows an agent picker + model picker, the `ai:sendMessage` IPC payload widens to carry `agentId` + `modelRef`, and a new `ai:stream-event` channel carries tool-call / tool-result events alongside the existing `ai:stream-token`.

**Tech Stack:** TypeScript, vitest, electron-store, React, Vercel AI SDK (`ai` + `@ai-sdk/*`), `@modelcontextprotocol/sdk` (already installed), Electron child_process with `ELECTRON_RUN_AS_NODE=1`.

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md) — see the **In-app agent runner**, **MCP wiring**, **IPC boundary** sections, and the deferred-from-Phase-4 follow-ups at the bottom.

**Branch policy:** Commit directly to `main` per `~/.claude/CLAUDE.md`. No worktrees, no feature branches.

**Test command:** Always `npm test`, never `npx vitest` (the pretest rebuilds `better-sqlite3` for the Node ABI — running vitest directly leaves it built for Node and breaks Electron launch).

**Scope decisions** (intentional narrowing within Phase 5):
- **Defaults wiring covers `tagExtract` + `skillGen` only.** The `chat` default is read by the new AiChatOverlay flow itself in Task 10 (no separate call-site refactor needed). The Anthropic adapter's `INHERIT_DEFAULT` constant stays put for now — its TODO is resolved when an explicit `chat` consumer reads it, which is the AiChatOverlay default-picking logic in Task 10.
- **MCP client spawns a dedicated subprocess** rather than multiplexing the existing Electron-spawned MCP instance. The MCP stdio transport is inherently single-client; spawning a second process is simpler than refactoring transports. The 5-tool MCP server is cheap (read-only DB + filesystem reads); the duplicate process is acceptable overhead.
- **Per-adapter `runAgentLoop` instead of shared.** Each provider's Vercel SDK has subtly different `fullStream` event shapes; centralizing the loop would require a normalization layer that pays for itself only with more providers. Cleaner per-adapter today; refactor when we add provider #6+.
- **`runner.ts` is a thin orchestrator** — it only adds MCP tools to opts and forwards to adapter.runAgentLoop. The actual stream-processing lives in adapters.
- **Agent picker is a minimum-viable dropdown.** No fuzzy search, no recent-agents pinning, no per-agent override of system prompt UI — just a `<select>` listing all agents from the DB. Polish is a later UX pass.
- **CLI path stays untouched.** `sendMessageStream` for Anthropic via Claude Code CLI is the existing default; the dispatcher branches based on `modelRef.provider`. Zero regression risk for current users.
- **No multi-turn agent loops.** Vercel AI SDK's `streamText` with `tools` and `maxSteps > 1` would let the model call tools then continue. For Phase 5, set `maxSteps: 5` (sensible default) and emit each step's events; don't add UI for step controls.
- **Token usage display deferred.** `AgentEvent.done` carries usage but the UI doesn't show it in Phase 5. Phase 7+ cost tracking work.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `electron/llm/mcpClient.ts` | Singleton MCP stdio client. Spawns dedicated MCP server subprocess, lists tools at connect, exposes `getTools()` + `callTool(name, args)`. |
| `electron/llm/mcpClient.test.ts` | Lifecycle + tool listing tests (subprocess + transport mocked). |
| `electron/llm/runner.ts` | `runAgentLoop(adapter, ref, opts)` — auto-injects MCP tools when `opts.tools` is undefined, forwards to adapter. |
| `electron/llm/runner.test.ts` | Tools-injection test with mocked adapter + MCP client. |
| `electron/services/aiChatService.runChat.test.ts` | Dispatcher tests — verifies CLI vs runner branch by `modelRef.provider`. |
| `src/components/AgentPicker.tsx` | Compact `<select>` listing agents, used in the AI Chat overlay header. |

**Modified files:**

| Path | Change |
|---|---|
| `electron/tag-extractor.ts` | `TAG_MODEL` becomes `resolveTagModel()` that reads `getDefault('tagExtract')` with fallback. |
| `electron/skill-gen/legacy.ts` | `generateWithRawPrompt`'s `options?.model ?? 'claude-haiku-4-5'` becomes a `resolveSkillGenModel(options)` call. |
| `electron/llm/adapters/anthropic.ts` | Replace `runAgentLoop` stub with real Vercel-SDK streaming impl. Add `streamText` real impl too (used by runAgentLoop). |
| `electron/llm/adapters/openai.ts` | Same. |
| `electron/llm/adapters/google.ts` | Same. |
| `electron/llm/adapters/openai-compatible.ts` | Same. |
| `electron/llm/adapters/anthropic.test.ts` | Add `runAgentLoop` tests. |
| `electron/llm/adapters/openai.test.ts` | Same. |
| `electron/llm/adapters/google.test.ts` | Same. |
| `electron/llm/adapters/openai-compatible.test.ts` | Same. |
| `electron/llm/index.ts` | `createLLMService` wires the factory's `runAgentLoop` through `runner.runAgentLoop` (auto-MCP-tools). |
| `electron/services/aiChatService.ts` | Extract `runChat(req)` dispatcher; refactor `sendMessageStream` into the CLI implementation it calls. |
| `electron/ipc/aiChatHandlers.ts` | `ai:sendMessage` payload widens (`agentId?`, `modelRef?`). Add new `ai:stream-event` IPC for tool events. |
| `electron/preload.ts` | Widen `window.api.ai.sendMessage` signature; add `onStreamEvent` / `offStreamEvent`. |
| `src/env.d.ts` | Match preload type widening. |
| `src/components/AiChatOverlay.tsx` | Add agent + model picker controls. Listen to new event channel. Pass new payload fields. |
| `src/components/AiChatOverlay.types.ts` | Extend `AiChatMessage` with optional `toolCalls`/`toolResults` arrays if not present. |
| `electron/main.ts` | Add `mcpClient.shutdown()` call inside the existing `before-quit` cleanup. |

**Files NOT touched** (intentional):
- `electron/llm/adapters/anthropic.ts`'s `INHERIT_DEFAULT` — see scope decisions above.
- `electron/services/agentFileSyncService.ts` — Phase 2 already wired multi-provider sync gating.
- `electron/mcp-server.ts` — runs unchanged; the new client connects to a fresh spawn, identical bytecode.
- Existing `ai:sendMessage` consumers that don't pass `agentId`/`modelRef` — backward compatible via optional fields, default to existing CLI path.

---

## Task 1: Wire defaults into tag-extractor + skill-gen

**Files:**
- Modify: `electron/tag-extractor.ts` (the `TAG_MODEL` constant at line 3)
- Modify: `electron/skill-gen/legacy.ts` (`generateWithRawPrompt` at lines 712-734)
- Modify: `electron/tag-extractor.test.ts` if it exists; otherwise create new tests inline

This is the deferred Phase 4 follow-up. Resolution: each call site reads `getDefault(feature)` and falls back to its current hardcoded ID when no default is configured. The Anthropic-adapter `INHERIT_DEFAULT` stays as-is.

- [ ] **Step 1: Check for existing tag-extractor tests**

```bash
ls electron/tag-extractor.test.ts 2>/dev/null || echo "missing"
ls electron/skill-gen/legacy.test.ts 2>/dev/null || echo "missing"
```

Expected: likely missing (these were untested in earlier phases). Note which exist for the test-edit steps below.

- [ ] **Step 2: Write the failing tag-extractor test**

If `electron/tag-extractor.test.ts` exists, append to it. Otherwise create it:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }))

vi.mock('./llm', () => ({
  createLLMService: () => ({
    generateText: mockGenerateText,
    streamText:    vi.fn(),
    runAgentLoop:  vi.fn(),
  }),
}))

vi.mock('./store', () => ({
  getDefault: vi.fn(),
}))

import { extractTags } from './tag-extractor'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockGenerateText.mockResolvedValue({ text: '["http","python"]', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
})

describe('extractTags', () => {
  it('uses the hardcoded fallback model when no tagExtract default is set', async () => {
    const storeMod = await import('./store')
    vi.mocked(storeMod.getDefault).mockReturnValue(undefined)

    await extractTags('fast async http for python', ['http', 'python'])
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      expect.any(Object),
    )
  })

  it('uses the configured tagExtract default when present', async () => {
    const storeMod = await import('./store')
    vi.mocked(storeMod.getDefault).mockReturnValue({ provider: 'openai', model: 'gpt-4o-mini' })

    await extractTags('fast async http for python', ['http', 'python'])
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-4o-mini' },
      expect.any(Object),
    )
  })

  it('passes the endpoint through for openai-compatible defaults', async () => {
    const storeMod = await import('./store')
    vi.mocked(storeMod.getDefault).mockReturnValue({
      provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1:70b',
    })

    await extractTags('fast async http', ['http'])
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1:70b' },
      expect.any(Object),
    )
  })
})
```

- [ ] **Step 3: Run test, verify failure**

```bash
npm test -- electron/tag-extractor.test.ts
```

Expected: 3 tests fail — `getDefault` not yet wired in.

- [ ] **Step 4: Update `tag-extractor.ts`**

Replace the file contents:

```ts
import { createLLMService } from './llm'
import { getDefault } from './store'
import type { ModelRef } from './llm/types'

const FALLBACK_TAG_MODEL: ModelRef = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }

function resolveTagModel(): ModelRef {
  const def = getDefault('tagExtract')
  if (!def) return FALLBACK_TAG_MODEL
  return def as ModelRef
}

export async function extractTags(
  query: string,
  knownTopics: string[],
): Promise<string[]> {
  const llm = createLLMService()
  const topicSample = knownTopics.slice(0, 300).join(', ')

  const prompt = `You are a GitHub repository search assistant. Extract search tags from the user's query.

Known GitHub topics (use these when they match): ${topicSample}

User query: "${query}"

Return ONLY a JSON array of 3-6 lowercase tags. Prefer exact matches from the known topics list. Include the programming language if mentioned. Add inferred synonyms if useful.

Examples:
"fast async HTTP client for Python" → ["http", "python", "async", "http-client", "requests"]
"render markdown in terminal" → ["markdown", "terminal", "cli", "renderer", "ansi"]
"small library to parse CSV files" → ["csv", "parser", "lightweight", "data"]

Return only the JSON array, nothing else.`

  try {
    const result = await llm.generateText(resolveTagModel(), {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
    })
    return JSON.parse(result.text.trim())
  } catch {
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)
  }
}
```

- [ ] **Step 5: Run tag-extractor test, verify pass**

```bash
npm test -- electron/tag-extractor.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Update `skill-gen/legacy.ts`**

Find `generateWithRawPrompt` (lines 712-734) and the in-process LLM fallback block. The function currently has `const model = options?.model ?? 'claude-haiku-4-5'` and uses `{ provider: 'anthropic', model }` when calling the LLM service. Update both sites:

Replace `const model = options?.model ?? 'claude-haiku-4-5'` with:

```ts
const { getDefault } = await import('../store')
const def = getDefault('skillGen')
const explicit = options?.model
const fallbackModel = 'claude-haiku-4-5'
const resolvedRef = explicit
  ? { provider: 'anthropic' as const, model: explicit }
  : def
    ? (def as { provider: string; model: string; endpoint?: string })
    : { provider: 'anthropic' as const, model: fallbackModel }
const model = resolvedRef.model
```

Then in the LLM fallback block (the `if (!nodePath)` branch), replace `{ provider: 'anthropic', model }` with `resolvedRef as Parameters<typeof llm.generateText>[0]`.

(The CLI spawn path further down keeps using the raw `model` string — Claude Code CLI's `--model` flag only accepts Anthropic model IDs. If `resolvedRef.provider !== 'anthropic'` and `nodePath` is available, the CLI path would fail; that's acceptable behavior since the user explicitly set a non-Anthropic skill-gen default and the CLI doesn't support it. Document this with a comment.)

Add this comment above the resolution block:

```ts
// Skill generation uses Claude Code CLI when Node is available (faster, no API
// cost on Max plans). When a non-Anthropic skillGen default is configured,
// the CLI path will fail — users must either remove the default or accept that
// skill generation requires the in-process LLM fallback (the `if (!nodePath)`
// branch below).
```

- [ ] **Step 7: Write skill-gen test (optional but recommended)**

Skill-gen's tests are sparse because it's mostly CLI-spawning. The defaults-resolution logic is testable in isolation. Create or append to `electron/skill-gen/legacy.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockFindNode } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockFindNode: vi.fn(),
}))

vi.mock('../llm', () => ({
  createLLMService: () => ({ generateText: mockGenerateText, streamText: vi.fn(), runAgentLoop: vi.fn() }),
}))

vi.mock('../store', () => ({
  getDefault: vi.fn(),
}))

// findNode is exported from this same module; spy via vi.spyOn is tricky.
// Use a local module mock to control it.
vi.mock('./legacy', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./legacy')>()
  return { ...mod, findNode: mockFindNode }
})

import { generateWithRawPrompt } from './legacy'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockFindNode.mockReset()
  mockFindNode.mockResolvedValue(null)  // Force the in-process LLM fallback path
  mockGenerateText.mockResolvedValue({ text: 'generated body', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
})

describe('generateWithRawPrompt — defaults resolution (in-process fallback)', () => {
  it('falls back to claude-haiku-4-5 when no skillGen default is configured', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getDefault).mockReturnValue(undefined)
    await generateWithRawPrompt('prompt', 'readme')
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      expect.any(Object),
    )
  })

  it('uses the configured skillGen default when present', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getDefault).mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    await generateWithRawPrompt('prompt', 'readme')
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-4o' },
      expect.any(Object),
    )
  })

  it('options.model wins over getDefault', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getDefault).mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    await generateWithRawPrompt('prompt', 'readme', { model: 'claude-opus-4-7' })
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-opus-4-7' },
      expect.any(Object),
    )
  })
})
```

(If the `vi.mock('./legacy', ...)` for partial-mock doesn't work cleanly because it's the same module under test, skip the skill-gen tests for Phase 5 — the tag-extractor test gives us coverage on the defaults-resolution pattern. Note this in the commit message.)

- [ ] **Step 8: Run all tests for the modified files**

```bash
npm test -- electron/tag-extractor.test.ts electron/skill-gen/
```

Expected: all pass.

- [ ] **Step 9: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add electron/tag-extractor.ts electron/tag-extractor.test.ts electron/skill-gen/legacy.ts electron/skill-gen/legacy.test.ts 2>/dev/null
git commit -m "feat(llm): wire settings.defaults.{tagExtract,skillGen} into call sites"
```

---

## Task 2: MCP client (singleton + lifecycle)

**Files:**
- Create: `electron/llm/mcpClient.ts`
- Create: `electron/llm/mcpClient.test.ts`
- Modify: `electron/main.ts` (add `mcpClient.shutdown()` to the existing `before-quit` cleanup)

The MCP client is a thin wrapper around `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport`. It spawns a fresh MCP server subprocess (the same `mcp-server.js` the existing Electron-side `startMCPServer()` spawns), connects, lists tools at connect, and exposes `getTools()` + `callTool(name, args)`. Singleton with lazy connection so tests can construct it without side effects.

- [ ] **Step 1: Write the failing test**

Create `electron/llm/mcpClient.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockConnect, mockListTools, mockCallTool, mockClose, mockSpawn, mockTransport } = vi.hoisted(() => ({
  mockConnect:   vi.fn(),
  mockListTools: vi.fn(),
  mockCallTool:  vi.fn(),
  mockClose:     vi.fn(),
  mockSpawn:     vi.fn(),
  mockTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect:   mockConnect,
    listTools: mockListTools,
    callTool:  mockCallTool,
    close:     mockClose,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockTransport,
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/app' },
}))

import { getMcpClient, shutdownMcpClient } from './mcpClient'

beforeEach(() => {
  mockConnect.mockReset()
  mockListTools.mockReset()
  mockCallTool.mockReset()
  mockClose.mockReset()
  mockTransport.mockClear()
  mockSpawn.mockClear()

  mockConnect.mockResolvedValue(undefined)
  mockListTools.mockResolvedValue({
    tools: [
      { name: 'list_skills', description: 'List all skills', inputSchema: { type: 'object' } },
      { name: 'get_skill',   description: 'Fetch skill body', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    ],
  })
  mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'tool output' }] })

  // Reset the singleton between tests
  return shutdownMcpClient()
})

describe('mcpClient', () => {
  it('lazily connects on first getMcpClient() call', async () => {
    expect(mockConnect).not.toHaveBeenCalled()
    await getMcpClient()
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockTransport).toHaveBeenCalledTimes(1)
  })

  it('returns the same instance on subsequent calls (no re-spawn)', async () => {
    const a = await getMcpClient()
    const b = await getMcpClient()
    expect(a).toBe(b)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('getTools() returns the listed tools mapped to McpTool[]', async () => {
    const client = await getMcpClient()
    const tools = await client.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({ name: 'list_skills', description: 'List all skills' })
    expect(typeof tools[0].execute).toBe('function')
  })

  it('callTool() executes via the underlying client', async () => {
    const client = await getMcpClient()
    await client.callTool('list_skills', { folderId: 1 })
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'list_skills', arguments: { folderId: 1 } })
  })

  it('shutdownMcpClient() closes the underlying client and clears the singleton', async () => {
    await getMcpClient()
    await shutdownMcpClient()
    expect(mockClose).toHaveBeenCalledTimes(1)
    // Re-acquire after shutdown spawns a new instance
    await getMcpClient()
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('a tool returned by getTools() executes via callTool when invoked', async () => {
    const client = await getMcpClient()
    const tools = await client.getTools()
    const result = await tools[0].execute({})
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'list_skills', arguments: {} })
    expect(result).toEqual({ content: [{ type: 'text', text: 'tool output' }] })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/mcpClient.test.ts
```

Expected: `Cannot find module './mcpClient'`.

- [ ] **Step 3: Implement `mcpClient.ts`**

Create `electron/llm/mcpClient.ts`:

```ts
import { app } from 'electron'
import * as path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpTool } from './types'

export interface McpClientHandle {
  getTools(): Promise<McpTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

let singleton: McpClientHandle | undefined
let rawClient: Client | undefined
let inflight: Promise<McpClientHandle> | undefined

/**
 * Returns the singleton MCP client, connecting on first call.
 *
 * The MCP server runs as a dedicated subprocess separate from the
 * Electron-spawned one in main.ts — stdio is inherently single-client,
 * and the server is cheap (read-only DB + fs), so a duplicate process
 * is simpler than multiplexing.
 */
export async function getMcpClient(): Promise<McpClientHandle> {
  if (singleton) return singleton
  if (inflight) return inflight

  inflight = (async () => {
    const mcpScript = path.join(app.getAppPath(), 'dist-electron', 'mcp-server.js')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpScript],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string>,
    })

    const client = new Client(
      { name: 'git-suite-in-app-runner', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)
    rawClient = client

    const handle: McpClientHandle = {
      async getTools(): Promise<McpTool[]> {
        const response = await client.listTools()
        return response.tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
          execute: (args: Record<string, unknown>) => client.callTool({ name: t.name, arguments: args }),
        }))
      },
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return client.callTool({ name, arguments: args })
      },
    }

    singleton = handle
    return handle
  })()

  try {
    return await inflight
  } finally {
    inflight = undefined
  }
}

/**
 * Closes the MCP client + underlying subprocess. Call from app cleanup.
 * Safe to call multiple times.
 */
export async function shutdownMcpClient(): Promise<void> {
  const client = rawClient
  singleton = undefined
  rawClient = undefined
  if (client) {
    try {
      await client.close()
    } catch {
      // Best-effort close — subprocess may already be dead.
    }
  }
}
```

**Note on the script path:** the existing `startMCPServer()` in `electron/main.ts:215-229` uses `app.getAppPath() + '/dist-electron/mcp-server.js'`. We mirror that.

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/mcpClient.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Wire cleanup into `main.ts`**

Find the existing `before-quit` handler in `electron/main.ts` (search for `before-quit` or the existing `mcpProcess.kill()` cleanup). Add a shutdown call:

```ts
import { shutdownMcpClient } from './llm/mcpClient'

// inside the existing before-quit handler:
app.on('before-quit', async (e) => {
  // ... existing cleanup ...
  await shutdownMcpClient()
})
```

(If the handler is synchronous and uses `e.preventDefault()` + delayed `app.quit()` already, follow that pattern. If it's purely synchronous, fire-and-forget `shutdownMcpClient()` is fine since the subprocess gets killed by Electron's child reaping anyway.)

- [ ] **Step 6: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If `@modelcontextprotocol/sdk/client/index.js` import errors, check the SDK's exported subpath structure with `node -e "console.log(Object.keys(require('@modelcontextprotocol/sdk')))"` and adjust the import accordingly.

- [ ] **Step 7: Commit**

```bash
git add electron/llm/mcpClient.ts electron/llm/mcpClient.test.ts electron/main.ts
git commit -m "feat(llm): MCP stdio client singleton for in-app agent runner"
```

---

## Task 3: Anthropic adapter — real runAgentLoop (TDD)

**Files:**
- Modify: `electron/llm/adapters/anthropic.ts` (replace `runAgentLoop` + `streamText` stubs)
- Modify: `electron/llm/adapters/anthropic.test.ts` (add runAgentLoop coverage)

Replace the existing throw-stubs with real impls that delegate to Vercel AI SDK's `streamText` (which supports tool calls natively). The adapter's `streamText` returns text-deltas only; `runAgentLoop` returns the full `AgentEvent` stream (text, tool-call, tool-result, done, error).

- [ ] **Step 1: Append the failing tests**

Append to `electron/llm/adapters/anthropic.test.ts`. First, ensure the existing `vi.hoisted` block at the top of the file exports a `mockStreamText` alongside the existing `mockGenerateText`:

```ts
const { mockGenerateText, mockStreamText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockStreamText:   vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText:   mockStreamText,
}))
```

(If the file already imports `streamText` differently, match its style. If the existing `vi.mock('ai', ...)` only exports `generateText`, add `streamText` to the object.)

Then add a new describe block:

```ts
describe('AnthropicAdapter.runAgentLoop', () => {
  // Helper: build a fake fullStream as an AsyncIterable of Vercel AI SDK chunks.
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return {
      fullStream: (async function* () {
        for (const c of chunks) yield c
      })(),
    }
  }

  it('yields text-delta events for each text chunk from the SDK fullStream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'Hello' },
      { type: 'text-delta', textDelta: ' world' },
      { type: 'finish', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } },
    ]))

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ' world' },
      { type: 'done', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } },
    ])
  })

  it('yields tool-call + tool-result events when the SDK fullStream emits them', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'list_skills', args: { folderId: 1 } },
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'list_skills', result: { skills: [] } },
      { type: 'text-delta', textDelta: 'You have no skills.' },
      { type: 'finish', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } },
    ]))

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        messages: [{ role: 'user', content: 'list my skills' }],
        tools: [{
          name: 'list_skills',
          description: 'List skills',
          inputSchema: { type: 'object', properties: { folderId: { type: 'number' } } },
          execute: async () => ({ skills: [] }),
        }],
      },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'tool-call', id: 'call-1', name: 'list_skills', args: { folderId: 1 } },
      { type: 'tool-result', id: 'call-1', result: { skills: [] }, isError: false },
      { type: 'text-delta', delta: 'You have no skills.' },
      { type: 'done', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } },
    ])
  })

  it('passes tools through to the SDK in Vercel AI SDK format (name, description, parameters, execute)', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
    ]))

    const exec = vi.fn(async () => ({ ok: true }))
    const adapter = new AnthropicAdapter()
    for await (const _ of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        messages: [{ role: 'user', content: 'use a tool' }],
        tools: [{
          name: 'my_tool',
          description: 'Does a thing',
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
          execute: exec,
        }],
      },
    )) {}

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools.my_tool).toBeDefined()
    expect(callArgs.tools.my_tool.description).toBe('Does a thing')
    expect(typeof callArgs.tools.my_tool.execute).toBe('function')
  })

  it('yields an error event when the SDK throws', async () => {
    mockStreamText.mockImplementation(() => { throw new Error('connection lost') })

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect(events[0].error.kind).toBe('unknown')
    expect(events[0].error.message).toContain('connection lost')
  })

  it('forwards AbortSignal as abortSignal to streamText', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
    ]))

    const controller = new AbortController()
    const adapter = new AnthropicAdapter()
    for await (const _ of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )) {}

    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }))
  })
})

describe('AnthropicAdapter.streamText', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return {
      fullStream: (async function* () {
        for (const c of chunks) yield c
      })(),
    }
  }

  it('yields text-delta chunks only (ignores tool events)', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'Hello' },
      { type: 'tool-call', toolCallId: 'x', toolName: 'y', args: {} },
      { type: 'text-delta', textDelta: ' world' },
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ]))

    const adapter = new AnthropicAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      out.push(c)
    }

    expect(out).toEqual([
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ' world' },
    ])
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: new tests fail — `runAgentLoop` and `streamText` still throw the Phase-5-not-implemented stub.

- [ ] **Step 3: Implement `streamText` and `runAgentLoop` in `anthropic.ts`**

Open `electron/llm/adapters/anthropic.ts`. Add `streamText` to the imports from `ai`:

```ts
import { generateText, streamText } from 'ai'
```

Replace the existing `streamText` and `runAgentLoop` stub methods on `AnthropicAdapter` with:

```ts
async *streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk> {
  for await (const ev of this.runAgentLoop(ref, opts)) {
    if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta }
    if (ev.type === 'error') throw ev.error
  }
}

async *runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent> {
  const apiKey = this.assertApiKey()
  const modelId = ref.model === 'inherit' ? INHERIT_DEFAULT : ref.model
  const provider = createAnthropic({ apiKey })

  let stream: { fullStream: AsyncIterable<any> }
  try {
    stream = streamText({
      model: provider(modelId),
      system: opts.systemPrompt,
      messages: opts.messages,
      tools: toolsForSDK(opts.tools),
      maxTokens: opts.maxTokens,
      abortSignal: opts.signal,
      maxSteps: opts.tools && opts.tools.length > 0 ? 5 : 1,
    } as Parameters<typeof streamText>[0])
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
    return
  }

  try {
    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          yield { type: 'text-delta', delta: chunk.textDelta }
          break
        case 'tool-call':
          yield { type: 'tool-call', id: chunk.toolCallId, name: chunk.toolName, args: chunk.args as Record<string, unknown> }
          break
        case 'tool-result':
          yield { type: 'tool-result', id: chunk.toolCallId, result: chunk.result, isError: false }
          break
        case 'finish':
          yield {
            type: 'done',
            usage: {
              promptTokens:     chunk.usage?.promptTokens     ?? 0,
              completionTokens: chunk.usage?.completionTokens ?? 0,
              totalTokens:      chunk.usage?.totalTokens      ?? 0,
            },
          }
          break
        case 'error':
          yield { type: 'error', error: normalizeError(chunk.error) }
          break
        // Other Vercel AI SDK chunk types (step-start, step-finish, reasoning, etc.) are ignored.
      }
    }
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
  }
}
```

At the bottom of the file (or in a shared util location if you prefer — but inline is fine for Phase 5), add the tools-conversion helper:

```ts
function toolsForSDK(tools: McpTool[] | undefined): Record<string, unknown> | undefined {
  if (!tools || tools.length === 0) return undefined
  const out: Record<string, { description: string; parameters: unknown; execute: (args: Record<string, unknown>) => Promise<unknown> }> = {}
  for (const t of tools) {
    out[t.name] = {
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    }
  }
  return out
}
```

Add `McpTool` to the type imports at the top of the file:

```ts
import type {
  LLMCallOpts,
  ModelRef,
  TextChunk,
  AgentEvent,
  Usage,
  LLMErrorKind,
  McpTool,
} from '../types'
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/anthropic.test.ts
```

Expected: all tests pass (the 8 existing + the 5 new runAgentLoop tests + 1 new streamText test = 14).

If the Vercel AI SDK's `streamText` parameter shape doesn't accept `tools` as a plain object (some versions want it wrapped), the test for tool-passthrough will fail with the actual structure — match it. The double-cast `as Parameters<typeof streamText>[0]` keeps types loose while we figure out the exact SDK contract at runtime.

- [ ] **Step 5: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If the `tools` parameter type clashes, use `as never` on the tools field as the absolute-last-resort cast (mirrors the Phase-1 documented escape hatch). Comment why.

- [ ] **Step 6: Commit**

```bash
git add electron/llm/adapters/anthropic.ts electron/llm/adapters/anthropic.test.ts
git commit -m "feat(llm): real runAgentLoop + streamText impls for Anthropic adapter"
```

---

## Task 4: OpenAI adapter — real runAgentLoop (TDD)

**Files:**
- Modify: `electron/llm/adapters/openai.ts` (replace stubs)
- Modify: `electron/llm/adapters/openai.test.ts` (add coverage)

Same pattern as Task 3. Reproduce the helper inline rather than referencing a shared module — duplicate is intentional for Phase 5 (the 4 adapters' helpers may diverge as per-SDK quirks emerge; extract to a shared util only once they've proven stable).

- [ ] **Step 1: Append the failing tests**

Mirror the Anthropic test structure. In `electron/llm/adapters/openai.test.ts`:

Update the existing `vi.hoisted` block to include `mockStreamText`:

```ts
const { mockGenerateText, mockStreamText, mockCreateOpenAI, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockStreamText:   vi.fn(),
    mockCreateOpenAI: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText:   mockStreamText,
}))
```

Then add:

```ts
describe('OpenAIAdapter.runAgentLoop', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta + done from a simple stream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'gpt-' },
      { type: 'text-delta', textDelta: '4o says hi' },
      { type: 'finish', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ]))

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'gpt-' },
      { type: 'text-delta', delta: '4o says hi' },
      { type: 'done', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ])
  })

  it('passes tools through and yields tool-call + tool-result events', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_skills', args: { q: 'http' } },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_skills', result: { hits: 2 } },
      { type: 'text-delta', textDelta: 'Found 2 skills.' },
      { type: 'finish', usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } },
    ]))

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
      {
        messages: [{ role: 'user', content: 'find http skills' }],
        tools: [{
          name: 'search_skills',
          description: 'Search skills',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute: async () => ({ hits: 2 }),
        }],
      },
    )) {
      events.push(ev)
    }

    expect(events.map(e => e.type)).toEqual(['tool-call', 'tool-result', 'text-delta', 'done'])
  })

  it('yields error event when streamText throws', async () => {
    mockStreamText.mockImplementation(() => { throw new Error('OpenAI rate limit') })

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('rate limit')
  })
})

describe('OpenAIAdapter.streamText', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta only', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'a' },
      { type: 'tool-call', toolCallId: 'x', toolName: 'y', args: {} },
      { type: 'text-delta', textDelta: 'b' },
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ]))

    const adapter = new OpenAIAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      out.push(c)
    }
    expect(out).toEqual([
      { type: 'text-delta', delta: 'a' },
      { type: 'text-delta', delta: 'b' },
    ])
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/openai.test.ts
```

Expected: new tests fail.

- [ ] **Step 3: Implement in `openai.ts`**

Add `streamText` to the SDK import:

```ts
import { generateText, streamText } from 'ai'
```

Add `McpTool` to type imports.

Replace the two stub methods with:

```ts
async *streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk> {
  for await (const ev of this.runAgentLoop(ref, opts)) {
    if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta }
    if (ev.type === 'error') throw ev.error
  }
}

async *runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent> {
  const { apiKey, organization } = this.resolveCreds()
  const provider = createOpenAI(organization ? { apiKey, organization } : { apiKey })

  let stream: { fullStream: AsyncIterable<any> }
  try {
    stream = streamText({
      model: provider(ref.model),
      system: opts.systemPrompt,
      messages: opts.messages,
      tools: toolsForSDK(opts.tools),
      maxTokens: opts.maxTokens,
      abortSignal: opts.signal,
      maxSteps: opts.tools && opts.tools.length > 0 ? 5 : 1,
    } as Parameters<typeof streamText>[0])
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
    return
  }

  try {
    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          yield { type: 'text-delta', delta: chunk.textDelta }
          break
        case 'tool-call':
          yield { type: 'tool-call', id: chunk.toolCallId, name: chunk.toolName, args: chunk.args as Record<string, unknown> }
          break
        case 'tool-result':
          yield { type: 'tool-result', id: chunk.toolCallId, result: chunk.result, isError: false }
          break
        case 'finish':
          yield {
            type: 'done',
            usage: {
              promptTokens:     chunk.usage?.promptTokens     ?? 0,
              completionTokens: chunk.usage?.completionTokens ?? 0,
              totalTokens:      chunk.usage?.totalTokens      ?? 0,
            },
          }
          break
        case 'error':
          yield { type: 'error', error: normalizeError(chunk.error) }
          break
      }
    }
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
  }
}
```

And add the same `toolsForSDK` helper at the bottom of the file:

```ts
function toolsForSDK(tools: McpTool[] | undefined): Record<string, unknown> | undefined {
  if (!tools || tools.length === 0) return undefined
  const out: Record<string, { description: string; parameters: unknown; execute: (args: Record<string, unknown>) => Promise<unknown> }> = {}
  for (const t of tools) {
    out[t.name] = {
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    }
  }
  return out
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/adapters/openai.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Confirm typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add electron/llm/adapters/openai.ts electron/llm/adapters/openai.test.ts
git commit -m "feat(llm): real runAgentLoop + streamText impls for OpenAI adapter"
```

---

## Task 5: Google adapter — real runAgentLoop (TDD)

**Files:**
- Modify: `electron/llm/adapters/google.ts`
- Modify: `electron/llm/adapters/google.test.ts`

Same pattern as Task 4. Steps abbreviated — refer to Task 4 for the test template (substitute `mockCreateGoogle` for `mockCreateOpenAI`, `gemini-2.5-pro` for `gpt-4o`, `GoogleAdapter` for `OpenAIAdapter`, `google` provider for `openai`).

- [ ] **Step 1: Append failing tests**

In `electron/llm/adapters/google.test.ts`, update the `vi.hoisted` block to include `mockStreamText` and add it to the `vi.mock('ai', ...)` block. Then add the equivalent `runAgentLoop` and `streamText` describe blocks from Task 4, substituting `GoogleAdapter`, `mockCreateGoogle`, `gemini-2.5-pro`, and `google` provider id.

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/google.test.ts
```

- [ ] **Step 3: Implement in `google.ts`**

Add `streamText` to ai import. Add `McpTool` to type imports. Replace the two stub methods using the same body as Task 4 but with the Google provider:

```ts
async *streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk> {
  for await (const ev of this.runAgentLoop(ref, opts)) {
    if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta }
    if (ev.type === 'error') throw ev.error
  }
}

async *runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent> {
  const apiKey = this.assertApiKey()
  const provider = createGoogleGenerativeAI({ apiKey })

  let stream: { fullStream: AsyncIterable<any> }
  try {
    stream = streamText({
      model: provider(ref.model),
      system: opts.systemPrompt,
      messages: opts.messages,
      tools: toolsForSDK(opts.tools),
      maxTokens: opts.maxTokens,
      abortSignal: opts.signal,
      maxSteps: opts.tools && opts.tools.length > 0 ? 5 : 1,
    } as Parameters<typeof streamText>[0])
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
    return
  }

  try {
    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta':  yield { type: 'text-delta', delta: chunk.textDelta }; break
        case 'tool-call':   yield { type: 'tool-call', id: chunk.toolCallId, name: chunk.toolName, args: chunk.args as Record<string, unknown> }; break
        case 'tool-result': yield { type: 'tool-result', id: chunk.toolCallId, result: chunk.result, isError: false }; break
        case 'finish':      yield { type: 'done', usage: { promptTokens: chunk.usage?.promptTokens ?? 0, completionTokens: chunk.usage?.completionTokens ?? 0, totalTokens: chunk.usage?.totalTokens ?? 0 } }; break
        case 'error':       yield { type: 'error', error: normalizeError(chunk.error) }; break
      }
    }
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
  }
}
```

Append the same `toolsForSDK` helper as Task 4.

- [ ] **Step 4: Run test, verify pass + commit**

```bash
npm test -- electron/llm/adapters/google.test.ts
npx tsc --noEmit -p tsconfig.json
git add electron/llm/adapters/google.ts electron/llm/adapters/google.test.ts
git commit -m "feat(llm): real runAgentLoop + streamText impls for Google adapter"
```

---

## Task 6: OpenAI-compatible adapter — real runAgentLoop (TDD)

**Files:**
- Modify: `electron/llm/adapters/openai-compatible.ts`
- Modify: `electron/llm/adapters/openai-compatible.test.ts`

Same pattern again — the endpoint-resolution logic already exists from Phase 4, and the streaming path is identical.

- [ ] **Step 1: Append failing tests**

In `electron/llm/adapters/openai-compatible.test.ts`, update `vi.hoisted` to include `mockStreamText` and add to the `ai` mock. Add equivalents of the Task 4 `runAgentLoop` + `streamText` describe blocks, using `OpenAICompatibleAdapter`, `openai-compatible` provider, and an explicit `endpoint: 'ollama-local'` field on the ModelRef.

Add one extra test specific to openai-compatible — that the endpoint's apiKey is passed through:

```ts
it('passes the endpoint apiKey to createOpenAICompatible during runAgentLoop', async () => {
  mockStreamText.mockReturnValue(fakeStream([
    { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
  ]))

  const adapter = new OpenAICompatibleAdapter()
  for await (const _ of adapter.runAgentLoop(
    { provider: 'openai-compatible', endpoint: 'lmstudio', model: 'qwen-7b' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )) {}

  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    baseURL: 'http://localhost:1234/v1',
    apiKey:  'lm-key',
  }))
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/adapters/openai-compatible.test.ts
```

- [ ] **Step 3: Implement**

Add `streamText` import + `McpTool` type import. Replace the two stub methods with the same body pattern as Tasks 3-5, but with the existing endpoint resolution at the top:

```ts
async *streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk> {
  for await (const ev of this.runAgentLoop(ref, opts)) {
    if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta }
    if (ev.type === 'error') throw ev.error
  }
}

async *runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent> {
  const endpoint = this.resolveEndpoint(ref)
  const config: Record<string, unknown> = {
    name: endpoint.id,
    baseURL: endpoint.baseUrl,
  }
  if (endpoint.apiKey) config.apiKey = endpoint.apiKey
  const provider = createOpenAICompatible(config as Parameters<typeof createOpenAICompatible>[0])

  let stream: { fullStream: AsyncIterable<any> }
  try {
    stream = streamText({
      model: provider(ref.model),
      system: opts.systemPrompt,
      messages: opts.messages,
      tools: toolsForSDK(opts.tools),
      maxTokens: opts.maxTokens,
      abortSignal: opts.signal,
      maxSteps: opts.tools && opts.tools.length > 0 ? 5 : 1,
    } as Parameters<typeof streamText>[0])
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
    return
  }

  try {
    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta':  yield { type: 'text-delta', delta: chunk.textDelta }; break
        case 'tool-call':   yield { type: 'tool-call', id: chunk.toolCallId, name: chunk.toolName, args: chunk.args as Record<string, unknown> }; break
        case 'tool-result': yield { type: 'tool-result', id: chunk.toolCallId, result: chunk.result, isError: false }; break
        case 'finish':      yield { type: 'done', usage: { promptTokens: chunk.usage?.promptTokens ?? 0, completionTokens: chunk.usage?.completionTokens ?? 0, totalTokens: chunk.usage?.totalTokens ?? 0 } }; break
        case 'error':       yield { type: 'error', error: normalizeError(chunk.error) }; break
      }
    }
  } catch (err) {
    yield { type: 'error', error: normalizeError(err) }
  }
}
```

Append the `toolsForSDK` helper as in Task 4.

- [ ] **Step 4: Run test, verify pass + commit**

```bash
npm test -- electron/llm/adapters/openai-compatible.test.ts
npx tsc --noEmit -p tsconfig.json
git add electron/llm/adapters/openai-compatible.ts electron/llm/adapters/openai-compatible.test.ts
git commit -m "feat(llm): real runAgentLoop + streamText impls for openai-compatible adapter"
```

---

## Task 7: runner.ts orchestrator (auto-inject MCP tools)

**Files:**
- Create: `electron/llm/runner.ts`
- Create: `electron/llm/runner.test.ts`
- Modify: `electron/llm/index.ts` (wire `createLLMService.runAgentLoop` through the runner)

The runner is a thin layer: if `opts.tools` is undefined, fetch the MCP tool list and inject it; then forward to the adapter's `runAgentLoop`. Lets the factory always offer "tools come from MCP" without each adapter knowing about MCP.

- [ ] **Step 1: Write the failing test**

Create `electron/llm/runner.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGetTools } = vi.hoisted(() => ({ mockGetTools: vi.fn() }))

vi.mock('./mcpClient', () => ({
  getMcpClient: vi.fn(async () => ({
    getTools: mockGetTools,
    callTool: vi.fn(),
  })),
}))

import { runAgentLoop } from './runner'

beforeEach(() => {
  mockGetTools.mockReset()
  mockGetTools.mockResolvedValue([
    { name: 'list_skills', description: 'List skills', inputSchema: { type: 'object' }, execute: vi.fn() },
  ])
})

describe('runAgentLoop', () => {
  it('auto-injects MCP tools when opts.tools is undefined', async () => {
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toHaveLength(1)
      expect(opts.tools[0].name).toBe('list_skills')
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'claude-sonnet-4-6' }, { messages: [] })) {
      events.push(ev)
    }
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
  })

  it('passes through opts.tools when caller provided them (no MCP fetch)', async () => {
    const userTools = [{ name: 'custom', description: 'x', inputSchema: { type: 'object' }, execute: vi.fn() }]
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toBe(userTools)
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [], tools: userTools })) {
      events.push(ev)
    }
    expect(mockGetTools).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('passes through opts.tools = [] explicitly as "no tools" (no MCP fetch)', async () => {
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toEqual([])
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    for await (const _ of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [], tools: [] })) {}
    expect(mockGetTools).not.toHaveBeenCalled()
  })

  it('emits an error event if MCP getTools fails', async () => {
    mockGetTools.mockRejectedValue(new Error('mcp dead'))
    const adapter = { runAgentLoop: vi.fn(), streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [] })) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('mcp dead')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/llm/runner.test.ts
```

Expected: `Cannot find module './runner'`.

- [ ] **Step 3: Implement `runner.ts`**

Create `electron/llm/runner.ts`:

```ts
import { getMcpClient } from './mcpClient'
import { LLMError } from './types'
import type { AgentEvent, LLMCallOpts, McpTool, ModelRef } from './types'

interface AdapterLike {
  runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}

/**
 * Wraps an adapter's runAgentLoop with auto-injected MCP tools.
 *
 * Tool resolution rules:
 * - opts.tools is undefined → fetch tools from MCP and inject
 * - opts.tools is [] → use [] (caller explicitly disabled tools)
 * - opts.tools is non-empty → use as-is (caller provided custom tools)
 */
export async function* runAgentLoop(
  adapter: AdapterLike,
  ref: ModelRef,
  opts: LLMCallOpts,
): AsyncIterable<AgentEvent> {
  let tools: McpTool[] | undefined = opts.tools
  if (tools === undefined) {
    try {
      const client = await getMcpClient()
      tools = await client.getTools()
    } catch (err) {
      yield {
        type: 'error',
        error: new LLMError('tool_failed', err instanceof Error ? err.message : String(err), err),
      }
      return
    }
  }
  yield* adapter.runAgentLoop(ref, { ...opts, tools })
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/llm/runner.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Wire `createLLMService.runAgentLoop` through runner**

In `electron/llm/index.ts`, replace the existing `runAgentLoop` factory method body:

```ts
// Add at top:
import { runAgentLoop as runnerRunAgentLoop } from './runner'

// In createLLMService, replace runAgentLoop:
async *runAgentLoop(ref, opts) {
  const adapter = resolveAdapter(ref)
  yield* runnerRunAgentLoop(adapter, ref, opts)
},
```

- [ ] **Step 6: Update the existing `index.test.ts` to mock `./runner`**

Find the `vi.mock` blocks in `electron/llm/index.test.ts`. The existing dispatch tests call `svc.generateText` which doesn't touch the runner, so they keep passing. Add a new mock for `./runner` so the `runAgentLoop` tests don't try to spawn MCP:

```ts
vi.mock('./runner', () => ({
  runAgentLoop: vi.fn(async function* (adapter, ref, opts) {
    yield* adapter.runAgentLoop(ref, opts)
  }),
}))
```

Run the existing test suite to confirm no regressions:

```bash
npm test -- electron/llm/index.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add electron/llm/runner.ts electron/llm/runner.test.ts electron/llm/index.ts electron/llm/index.test.ts
git commit -m "feat(llm): runner.ts orchestrator — auto-inject MCP tools into runAgentLoop"
```

---

## Task 8: aiChatService dispatch — CLI vs in-app runner

**Files:**
- Modify: `electron/services/aiChatService.ts` (extract `runChat`)
- Create: `electron/services/aiChatService.runChat.test.ts`

Today `sendMessageStream` is the only entry point; it always spawns Claude Code CLI. After this task, it becomes the CLI implementation of a new dispatcher `runChat(req)` that branches on `req.modelRef.provider`.

- [ ] **Step 1: Write the failing test**

Create `electron/services/aiChatService.runChat.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock sendMessageStream (the CLI path) and the in-app runner path.
const { mockSendMessageStream, mockLLMRunAgentLoop } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockLLMRunAgentLoop:   vi.fn(),
}))

vi.mock('./aiChatService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./aiChatService')>()
  return { ...mod, sendMessageStream: mockSendMessageStream }
})

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText:  vi.fn(),
    streamText:    vi.fn(),
    runAgentLoop:  mockLLMRunAgentLoop,
  })),
}))

vi.mock('../store', () => ({
  getDefault: vi.fn(),
}))

import { runChat } from './aiChatService'

beforeEach(() => {
  mockSendMessageStream.mockReset()
  mockLLMRunAgentLoop.mockReset()
  mockSendMessageStream.mockResolvedValue(undefined)
})

describe('runChat — dispatcher', () => {
  it('routes anthropic to the CLI path (sendMessageStream)', async () => {
    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    }, callbacks)
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
    expect(mockLLMRunAgentLoop).not.toHaveBeenCalled()
  })

  it('routes opencode to the CLI path', async () => {
    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'opencode', model: 'claude-sonnet-4-6' },
    }, callbacks)
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
  })

  it('routes openai to the in-app runner (llm.runAgentLoop)', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'text-delta', delta: 'gpt says hi' }
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(mockLLMRunAgentLoop).toHaveBeenCalledTimes(1)
    expect(mockSendMessageStream).not.toHaveBeenCalled()
    expect(callbacks.onToken).toHaveBeenCalledWith('gpt says hi')
    expect(callbacks.onDone).toHaveBeenCalledWith('gpt says hi')
  })

  it('falls back to chat default when no modelRef is provided', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getDefault).mockReturnValue({ provider: 'openai', model: 'gpt-4o' })

    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
    }, callbacks)

    expect(mockLLMRunAgentLoop).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-4o' },
      expect.any(Object),
    )
  })

  it('forwards tool-call/tool-result events to onEvent', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'tool-call', id: 't1', name: 'list_skills', args: {} }
      yield { type: 'tool-result', id: 't1', result: { skills: [] }, isError: false }
      yield { type: 'text-delta', delta: 'done' }
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(callbacks.onEvent).toHaveBeenCalledTimes(2)
    expect(callbacks.onEvent.mock.calls[0][0]).toMatchObject({ type: 'tool-call', name: 'list_skills' })
    expect(callbacks.onEvent.mock.calls[1][0]).toMatchObject({ type: 'tool-result', id: 't1' })
  })

  it('forwards error events to onError', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'error', error: { kind: 'auth_invalid', message: 'bad key', name: 'LLMError' } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError.mock.calls[0][0]).toContain('bad key')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/services/aiChatService.runChat.test.ts
```

Expected: `runChat` doesn't exist yet.

- [ ] **Step 3: Add `runChat` to `aiChatService.ts`**

At the bottom of `electron/services/aiChatService.ts` (after the existing `sendMessageStream` and `parseAssistantMessage`), add:

```ts
import { createLLMService } from '../llm'
import { getDefault } from '../store'
import type { AgentEvent, ModelRef } from '../llm/types'

export interface RunChatRequest {
  messages: AiChatMessage[]
  starredRepos: string[]
  installedSkills: string[]
  pageContext?: string
  /** Agent id from the agents table, or null for "quick chat" mode. */
  agentId?: number | null
  /** Optional explicit model. Falls back to settings.defaults.chat or sonnet-4-6. */
  modelRef?: ModelRef
}

export interface RunChatCallbacks {
  onToken(token: string): void
  onEvent(event: AgentEvent): void
  onDone(fullText: string): void
  onError(error: string): void
}

const FALLBACK_CHAT_MODEL: ModelRef = { provider: 'anthropic', model: 'claude-sonnet-4-6' }

function resolveChatModel(req: RunChatRequest): ModelRef {
  if (req.modelRef) return req.modelRef
  const def = getDefault('chat')
  if (def) return def as ModelRef
  return FALLBACK_CHAT_MODEL
}

/**
 * Top-level chat dispatcher. Branches on the resolved model's provider:
 *   - anthropic / opencode → Claude Code (or OpenCode in Phase 6) CLI subprocess
 *   - openai / google / openai-compatible → in-app runner via electron/llm/
 *
 * Callbacks bridge the unified surface to whichever path runs. Token + done
 * fire on both paths; events + error are runner-specific (CLI surfaces errors
 * via onError too).
 */
export async function runChat(req: RunChatRequest, callbacks: RunChatCallbacks): Promise<void> {
  const ref = resolveChatModel(req)

  if (ref.provider === 'anthropic' || ref.provider === 'opencode') {
    // CLI path (existing). The CLI doesn't emit tool events, just text.
    return sendMessageStream(
      req.messages,
      req.starredRepos,
      req.installedSkills,
      req.pageContext,
      {
        onToken: callbacks.onToken,
        onDone:  callbacks.onDone,
        onError: callbacks.onError,
      },
    )
  }

  // In-app runner path.
  const llm = createLLMService()
  const systemPrompt = buildAgentSystemPrompt(req)
  const messages = req.messages.map(m => ({ role: m.role, content: m.content }))

  let acc = ''
  try {
    for await (const event of llm.runAgentLoop(ref, {
      systemPrompt,
      messages,
      // tools omitted → runner auto-injects from MCP
    })) {
      switch (event.type) {
        case 'text-delta':
          acc += event.delta
          callbacks.onToken(event.delta)
          break
        case 'tool-call':
        case 'tool-result':
          callbacks.onEvent(event)
          break
        case 'done':
          callbacks.onDone(acc)
          return
        case 'error':
          callbacks.onError(event.error.message ?? 'Unknown LLM error')
          return
      }
    }
    // Stream ended without 'done' — flush whatever we have.
    callbacks.onDone(acc)
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

/**
 * System prompt for the in-app runner path. Mirrors buildSystemPrompt above
 * but adds agent-specific context when an agentId is present (Phase 5 fetches
 * agent body from DB; Phase 6 may evolve this).
 */
function buildAgentSystemPrompt(req: RunChatRequest): string {
  // For Phase 5 we use the same system prompt as the CLI path.
  // Agent-mode prompts (when agentId is set) will be expanded in Phase 6 to
  // read the agent body from the DB.
  return buildBaseSystemPrompt(req.starredRepos, req.installedSkills, req.pageContext)
}

// Extract the prompt builder so both paths share it.
// Move buildSystemPrompt's body into buildBaseSystemPrompt and have
// buildSystemPrompt call buildBaseSystemPrompt. This is a no-op refactor.
function buildBaseSystemPrompt(starredRepos: string[], installedSkills: string[], pageContext?: string): string {
  return buildSystemPrompt(starredRepos, installedSkills, pageContext)
}
```

(If `buildSystemPrompt` is `function buildSystemPrompt(...)` not exported, it's already in scope. No actual extraction needed — `buildAgentSystemPrompt` can just call it directly. The `buildBaseSystemPrompt` indirection above is removable; included for clarity in the plan, simplify it during implementation.)

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- electron/services/aiChatService.runChat.test.ts
```

Expected: 6 tests pass.

If the test's `vi.mock('./aiChatService', ...)` self-mock pattern errors (mocking the module under test while importing from it is fragile), restructure the test to extract the dispatch logic into a separate function `dispatchByProvider(...)` exported from a new file `electron/services/dispatchChat.ts`. The dispatcher is small enough that one file is fine; this is the test-driven refactor.

- [ ] **Step 5: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add electron/services/aiChatService.ts electron/services/aiChatService.runChat.test.ts
git commit -m "feat(chat): runChat dispatcher — CLI for anthropic/opencode, in-app runner for others"
```

---

## Task 9: IPC + preload — widen ai:sendMessage, add ai:stream-event

**Files:**
- Modify: `electron/ipc/aiChatHandlers.ts` (rewrite `ai:sendMessage` to call `runChat`; add `ai:stream-event` emission)
- Modify: `electron/preload.ts` (widen `sendMessage` arg type; add `onStreamEvent` / `offStreamEvent`)
- Modify: `src/env.d.ts` (match preload types)

- [ ] **Step 1: Update the IPC handler**

In `electron/ipc/aiChatHandlers.ts`, replace the `ai:sendMessage` handler:

```ts
import { runChat, renderContentHtml } from '../services/aiChatService'
import type { AgentEvent, ModelRef } from '../llm/types'

ipcMain.handle('ai:sendMessage', async (event, payload: {
  messages: AiChatMessage[]
  starredRepos: string[]
  installedSkills: string[]
  pageContext?: string
  agentId?: number | null
  modelRef?: ModelRef
}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    throw new Error('Browser window not found')
  }
  return new Promise<{ text: string; html: string }>((resolve, reject) => {
    runChat({
      messages: payload.messages,
      starredRepos: payload.starredRepos,
      installedSkills: payload.installedSkills,
      pageContext: payload.pageContext,
      agentId: payload.agentId ?? null,
      modelRef: payload.modelRef,
    }, {
      onToken: (token) => {
        if (!win.isDestroyed()) win.webContents.send('ai:stream-token', token)
      },
      onEvent: (ev: AgentEvent) => {
        if (!win.isDestroyed()) win.webContents.send('ai:stream-event', ev)
      },
      onDone: (fullText) => {
        resolve({ text: fullText, html: renderContentHtml(fullText) })
      },
      onError: (error) => {
        reject(new Error(error))
      },
    }).catch((err) => {
      console.error('[ai-chat] runChat unhandled error:', err)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
})
```

(Remove the now-unused direct `sendMessageStream` import at the top of the file. The dispatcher calls it internally.)

- [ ] **Step 2: Update preload `window.api.ai`**

Find the `ai:` block in `electron/preload.ts` (around line 498). Update the `sendMessage` signature:

```ts
sendMessage: (payload: {
  messages: any[]
  starredRepos: string[]
  installedSkills: string[]
  pageContext?: string
  agentId?: number | null
  modelRef?: { provider: string; model: string; endpoint?: string }
}) => ipcRenderer.invoke('ai:sendMessage', payload) as Promise<{ text: string; html: string }>,
```

Add the new event channel methods alongside the existing `onStreamToken` / `offStreamToken`:

```ts
onStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => {
  const wrapper = (_: unknown, event: { type: string; [k: string]: unknown }) => cb(event)
  ipcRenderer.on('ai:stream-event', wrapper)
  // Track for removal — match the existing pattern for onStreamToken.
  return wrapper
},
offStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => {
  ipcRenderer.removeListener('ai:stream-event', cb as never)
},
```

(Match the exact callback-tracking pattern that `onStreamToken` uses in the file — it's a per-callback wrapper Map. Mirror that.)

- [ ] **Step 3: Update `src/env.d.ts`**

Find the `ai:` namespace in `src/env.d.ts` (look for `sendMessage:` or `onStreamToken:`). Update the types:

```ts
ai: {
  sendMessage(payload: {
    messages: AiChatMessage[]
    starredRepos: string[]
    installedSkills: string[]
    pageContext?: string
    agentId?: number | null
    modelRef?: { provider: string; model: string; endpoint?: string }
  }): Promise<{ text: string; html: string }>
  onStreamToken(cb: (token: string) => void): void
  offStreamToken(cb: (token: string) => void): void
  onStreamEvent(cb: (event: { type: string; [k: string]: unknown }) => void): void
  offStreamEvent(cb: (event: { type: string; [k: string]: unknown }) => void): void
  // ... existing methods (getChats, getChat, saveChat, deleteChat) unchanged ...
}
```

- [ ] **Step 4: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/aiChatHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(ipc): widen ai:sendMessage payload + add ai:stream-event for tool events"
```

---

## Task 10: AiChatOverlay — agent picker + model picker

**Files:**
- Create: `src/components/AgentPicker.tsx`
- Modify: `src/components/AiChatOverlay.tsx` (add pickers, pass agentId + modelRef, listen for tool events)
- Modify: `src/components/AiChatOverlay.types.ts` (add optional `toolCalls`, `toolResults` fields to `AiChatMessage`)
- Modify: `src/styles/globals.css` (minor styling for the picker row — uses existing settings input pattern)

This is the most user-visible task. Add a compact picker row at the top of the overlay (above the messages) with an Agent dropdown (defaults to "Quick chat" = no agent) and a Model dropdown (defaults to the agent's `model:` or `settings.defaults.chat`). Send both through the widened `sendMessage` IPC. Wire `onStreamEvent` so tool calls render inline.

Per the existing memory note (`feedback_no_visual_testing`): no dev-server screenshot validation — user verifies after this lands.

- [ ] **Step 1: Extend `AiChatMessage` with optional tool fields**

In `src/components/AiChatOverlay.types.ts`, add to the existing type:

```ts
export interface AiChatMessage {
  // ... existing fields ...
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  toolResults?: { id: string; result: unknown; isError: boolean }[]
}
```

- [ ] **Step 2: Add an `agents:getAll` IPC method (if not present)**

Check whether `window.api.agents.getAll()` exists in preload + env.d.ts. If not, add a minimal handler.

Search:

```bash
grep -n "agents:getAll\|agents\.getAll" electron/preload.ts electron/ipc/agentHandlers.ts src/env.d.ts
```

If the handler doesn't exist, in `electron/ipc/agentHandlers.ts` add:

```ts
ipcMain.handle('agents:getAll', () => {
  return getAllAgents()  // already imported in this file
})
```

In `electron/preload.ts`, find the existing `agents:` block and add:

```ts
getAll: () => ipcRenderer.invoke('agents:getAll') as Promise<Array<{
  id: number
  name: string
  body: string
  model: string
  model_provider: string
  model_endpoint_id: string | null
}>>,
```

In `src/env.d.ts`, mirror the type.

- [ ] **Step 3: Create `AgentPicker.tsx`**

Create `src/components/AgentPicker.tsx`:

```tsx
import { useEffect, useState } from 'react'

export interface AgentOption {
  id: number
  name: string
  body: string
  model: string
  model_provider: string
  model_endpoint_id: string | null
}

interface Props {
  selectedAgentId: number | null
  onChange(agent: AgentOption | null): void
  disabled?: boolean
}

export function AgentPicker({ selectedAgentId, onChange, disabled }: Props) {
  const [agents, setAgents] = useState<AgentOption[]>([])

  useEffect(() => {
    window.api.agents.getAll().then(setAgents).catch(err => {
      console.error('[agent-picker] failed to load agents:', err)
    })
  }, [])

  return (
    <select
      className="ai-chat-picker"
      value={selectedAgentId ?? ''}
      onChange={e => {
        const v = e.target.value
        if (v === '') return onChange(null)
        const id = Number(v)
        onChange(agents.find(a => a.id === id) ?? null)
      }}
      disabled={disabled}
    >
      <option value="">Quick chat</option>
      {agents.map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Wire pickers + new fields into `AiChatOverlay.tsx`**

In `src/components/AiChatOverlay.tsx`:

1. Add imports:

```tsx
import { AgentPicker, type AgentOption } from './AgentPicker'
```

2. Add state alongside the existing useState block (around line 88-100):

```tsx
const [selectedAgent, setSelectedAgent] = useState<AgentOption | null>(null)
const [modelRef, setModelRef] = useState<{ provider: string; model: string; endpoint?: string } | null>(null)
const [chatDefault, setChatDefault] = useState<{ provider: string; model: string; endpoint?: string } | null>(null)
```

3. Load the chat default on mount:

```tsx
useEffect(() => {
  window.api.llm.getDefault('chat').then(d => setChatDefault(d ?? null)).catch(() => {})
}, [])
```

4. When the agent changes, update `modelRef` to the agent's stored model (or clear it to fall back to default):

```tsx
useEffect(() => {
  if (!selectedAgent) {
    setModelRef(null)
    return
  }
  setModelRef({
    provider: selectedAgent.model_provider as string,
    model:    selectedAgent.model,
    endpoint: selectedAgent.model_endpoint_id ?? undefined,
  })
}, [selectedAgent])
```

5. In the two places that call `window.api.ai.sendMessage` (initial query effect ~line 122 and `handleSend` ~line 262), add the new fields to the payload:

```tsx
const { text: fullText, html } = await window.api.ai.sendMessage({
  messages: updatedMessages,
  starredRepos: starredNames,
  installedSkills: installedNames,
  pageContext: getPageContext(location.pathname),
  agentId: selectedAgent?.id ?? null,
  modelRef: modelRef ?? chatDefault ?? undefined,
})
```

6. Wire stream events for tool calls. Add alongside the existing token listener:

```tsx
const handleStreamEvent = useCallback((event: { type: string; [k: string]: unknown }) => {
  // Accumulate tool calls/results into the in-flight stream display.
  // For Phase 5 the rendering is minimal: show a small "🛠 calling list_skills…" line.
  // (Polish pass can prettify this later.)
  if (event.type === 'tool-call') {
    setStreamText(prev => prev + `\n\n🛠 calling \`${(event as any).name}\`…\n\n`)
  } else if (event.type === 'tool-result') {
    const isErr = (event as any).isError
    setStreamText(prev => prev + (isErr ? `\n_(tool error)_\n` : `\n_(tool result received)_\n`))
  }
}, [])

useEffect(() => {
  window.api.ai.onStreamEvent(handleStreamEvent)
  return () => window.api.ai.offStreamEvent(handleStreamEvent)
}, [handleStreamEvent])
```

7. Add the picker row to the JSX. Find the existing `<div className="ai-chat-messages">` block (around line 386) and add above it:

```tsx
<div className="ai-chat-picker-row">
  <AgentPicker
    selectedAgentId={selectedAgent?.id ?? null}
    onChange={setSelectedAgent}
    disabled={streaming}
  />
  {(modelRef || chatDefault) && (
    <span className="ai-chat-model-hint" title={`Using ${(modelRef ?? chatDefault)!.provider}/${(modelRef ?? chatDefault)!.model}`}>
      {(modelRef ?? chatDefault)!.provider}/{(modelRef ?? chatDefault)!.model}
    </span>
  )}
</div>
```

- [ ] **Step 5: Add minimal CSS for the picker row**

In `src/styles/globals.css`, append (or merge into the existing `.ai-chat-` section):

```css
.ai-chat-picker-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.ai-chat-picker {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg3);
  color: var(--text);
  cursor: pointer;
}

.ai-chat-picker:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ai-chat-model-hint {
  font-size: 11px;
  color: var(--text2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
```

- [ ] **Step 6: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 7: Manual smoke test**

Per the `feedback_no_visual_testing` memory, **stop here and ask the user to verify**:

> Phase 5 Task 10 ready for visual check. Launch `npm run dev`. Open the AI Chat overlay (whichever shortcut/button triggers it). You should see a new picker row at the top with an Agent dropdown (defaults to "Quick chat") and a tiny model hint chip showing the current provider/model. Try:
> 1. Send a message in "Quick chat" mode — should still work (uses CLI for Anthropic).
> 2. In Settings → Providers, set Chat default to `openai/gpt-4o` (requires OpenAI API key). Re-open the overlay — the hint should now show `openai/gpt-4o`. Send a message — should stream from OpenAI (no CLI spawn).
> 3. If you have any agents in your library, they should appear in the dropdown. Pick one — the hint should switch to whatever model that agent has configured. Send a message — should run via the picked model.
> 4. With an MCP-enabled model (anything other than anthropic/opencode), the assistant should be able to call tools like `list_skills`. You'll see lines like `🛠 calling list_skills…` in the streaming text.

Wait for explicit user confirmation before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/AiChatOverlay.tsx src/components/AiChatOverlay.types.ts src/components/AgentPicker.tsx src/styles/globals.css electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts 2>/dev/null
git commit -m "feat(chat): agent + model picker in AI Chat overlay, stream tool events"
```

---

## Phase 5 done — verification checklist

After Task 10:

- [ ] `npm test -- electron/` passes end-to-end (pre-existing renderer-side failures unchanged)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline 52ea7ab..HEAD` shows 10 new commits (1 plan + 9 tasks; Task 5 and 6 may be combined if executed by a single subagent)
- [ ] Manual smoke tests covered: Quick chat (CLI), OpenAI default (in-app runner), agent picker, tool calls
- [ ] Sanity check: `grep -rn "Phase 5" electron/llm/` returns only test/doc references — no remaining `throw new LLMError(..., 'not implemented (Phase 5)')` stubs

**Phase 5 ships:** non-CLI providers can run agents inside the AI Chat overlay with full MCP tool access. Tag extraction and skill generation now respect user-set defaults. The CLI path for Anthropic/OpenCode remains the default and unchanged.

## Out of scope (deferred)

- **`AnthropicAdapter.INHERIT_DEFAULT`** still hardcoded to `claude-sonnet-4-6`. Only triggered when an agent file has `model: inherit` and the renderer doesn't override; the new chat-default plumbing covers most cases. Cleanup task: make `INHERIT_DEFAULT` read `getDefault('chat')` when called from the agent context — Phase 6 or a follow-up.
- **Multi-turn agent UI controls.** `streamText({ maxSteps: 5 })` lets the model take up to 5 tool-call → response loops automatically; no user-facing controls to adjust this in Phase 5.
- **Token usage display.** `AgentEvent.done` carries `usage`, but the UI doesn't surface it. Cost tracking is a separate phase.
- **Agent picker polish.** Phase 5 is a plain `<select>`. No search, no per-agent description on hover, no "recent agents" pinning.
- **Tool call result rendering.** Tool results show as `_(tool result received)_` in the stream. Phase 6+ can render structured tool outputs (e.g., skill lists as cards).
- **Cancellation UI.** The runner accepts `AbortSignal` but the overlay has no cancel button wired to it yet.
- **Error formatting.** `formatLLMError(err): { title, body, action? }` from the spec isn't built; runner errors surface as plain strings via `onError`. Phase 6 can add the friendly error-card UI.
- **OpenCode in-app execution.** OpenCode the CLI is treated like Anthropic (CLI path) — Phase 6 will add the OpenCode adapter alongside its sync target.
- **External MCP servers.** Only the built-in Git Suite MCP server is wired. Third-party MCP server config in Settings is a future phase.
