# Multi-Provider Agent Support — Design

**Date:** 2026-05-26
**Status:** Draft, awaiting user approval
**Scope:** Heavy path (per `~/.claude/CLAUDE.md` scope filter) — multi-phase, multi-subsystem.

## Context

Git Suite today is hardcoded to Anthropic across the stack. Four call sites depend on Claude (`tag-extractor.ts`, `skill-gen/legacy.ts`, `aiChatService.ts`, `agentFileSyncService.ts`), the `apiStore` schema only knows about `anthropic.apiKey`, and the `agents` table's `model` field is an enum (`sonnet|opus|haiku|inherit`) baked to Anthropic. The goal of this design is to make Git Suite **provider-agnostic end to end** — both for the app's own internal AI features *and* for the agent definitions it stores, syncs, and runs.

## Goals

- Support five providers at v1: Anthropic, OpenAI, Google Gemini, OpenAI-compatible local endpoints (Ollama / LM Studio / llama.cpp), and OpenCode (CLI fork of Claude Code).
- One unified agent file format: the existing `.md` + frontmatter, with a `model:` field that accepts any provider/model.
- Two execution paths, chosen automatically by the model string:
  - **CLI agents** (Claude Code, OpenCode) → file synced to the CLI's config directory, user invokes via the CLI as today.
  - **In-app agents** (OpenAI, Gemini, OpenAI-compatible) → run inside Git Suite's chat overlay against the provider's API, with tools sourced from Git Suite's own MCP server.
- Backwards compatible: existing Claude-only agents and the existing chat UX keep working unchanged.

## Non-goals (v1)

- External MCP server support (third-party MCP servers configured in Settings). Architecture supports it; not shipping.
- Native cloud SDK execution for Anthropic/OpenCode (the "unified in-app runner" option from brainstorming). Claude Code CLI and OpenCode CLI stay as the agent runtime for their models.
- Image / vision inputs in chat. (Provider abstraction will accept them in the type but adapters can return `unsupported`.)
- A model marketplace, ratings, or recommendation UI.

## Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │            Renderer (src/)                  │
                   │   Settings UI · Agent Chat · Skill gen UI   │
                   └────────────────────┬────────────────────────┘
                                        │ IPC (window.api.llm.*)
                   ┌────────────────────▼────────────────────────┐
                   │              Main (electron/)               │
                   │                                             │
                   │   ┌──────────────────────────────────────┐  │
                   │   │   llm/                               │  │
                   │   │   ├── types.ts   (interfaces)        │  │
                   │   │   ├── registry.ts (provider lookup)  │  │
                   │   │   ├── adapters/                      │  │
                   │   │   │   ├── anthropic.ts               │  │
                   │   │   │   ├── openai.ts                  │  │
                   │   │   │   ├── google.ts                  │  │
                   │   │   │   └── openai-compatible.ts       │  │
                   │   │   ├── mcpClient.ts                   │  │
                   │   │   └── runner.ts (agent loop + MCP)   │  │
                   │   └──────────────────────────────────────┘  │
                   │           │                  │              │
                   │   ┌───────▼──────┐   ┌───────▼──────────┐   │
                   │   │ Existing 4   │   │ NEW Agent Runner │   │
                   │   │ call sites   │   │ (Chat overlay)   │   │
                   │   │ (refactored) │   │                  │   │
                   │   └──────────────┘   └───────┬──────────┘   │
                   │                              │ stdio        │
                   │   ┌──────────────────────────▼──────────┐   │
                   │   │  Git Suite MCP server (existing)    │   │
                   │   │  list_skills, get_skill, search…    │   │
                   │   └─────────────────────────────────────┘   │
                   │                                             │
                   │   ┌─────────────────────────────────────┐   │
                   │   │  Sync services (existing + new)     │   │
                   │   │  → .claude/agents/   (Claude Code)  │   │
                   │   │  → .opencode/agents/ (OpenCode)     │   │
                   │   └─────────────────────────────────────┘   │
                   └─────────────────────────────────────────────┘
```

`electron/llm/` is the single chokepoint for every AI call. Old call sites and the new agent runner both depend on it. Sync services stay separate — they're file I/O, not LLM work. The MCP server already runs as a subprocess for Claude Desktop; the in-app runner becomes a second stdio client of the same subprocess.

## Provider abstraction (`electron/llm/`)

Built on Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`). The public surface is intentionally small:

```ts
// electron/llm/types.ts
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'opencode'
  | 'openai-compatible';

export type ModelRef = {
  provider: ProviderId;
  model: string;          // e.g. 'claude-sonnet-4-6', 'gpt-4o', 'llama3.1:70b'
  endpoint?: string;      // only for openai-compatible (e.g. http://localhost:11434/v1)
};

export type LLMCallOpts = {
  systemPrompt?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: McpTool[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export interface LLMService {
  generateText(model: ModelRef, opts: LLMCallOpts): Promise<{ text: string; usage: Usage }>;
  streamText(model: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk>;
  runAgentLoop(model: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>;
}
```

`registry.ts` resolves `ModelRef → adapter instance` and injects credentials from the settings store. Each adapter in `adapters/*` is a ~50-line wrapper around a Vercel AI SDK call. `runner.ts` implements `runAgentLoop` — wires the MCP client's tools into the SDK's `tools` parameter and yields a typed event stream (`text-delta`, `tool-call`, `tool-result`, `done`, `error`).

## Storage schema

`apiStore` (electron-store, encrypted) gains a `providers` section. The existing `anthropic.apiKey` key is kept as a read-through alias for compat, and migrated on first launch:

```ts
{
  // legacy, kept for backward compat
  anthropic: { apiKey: string | null },

  providers: {
    anthropic:           { apiKey: string | null, enabled: boolean },
    openai:              { apiKey: string | null, enabled: boolean, organization?: string },
    google:              { apiKey: string | null, enabled: boolean },
    'openai-compatible': {
      enabled: boolean,
      endpoints: Array<{
        id: string,          // user-named: 'ollama-local', 'lmstudio'
        label: string,
        baseUrl: string,     // e.g. http://localhost:11434/v1
        apiKey?: string,     // usually none for local
      }>,
    },
  },

  defaults: {
    chat:        ModelRef,
    skillGen:    ModelRef,
    tagExtract:  ModelRef,
  },
}
```

**Migration:** on first launch after Phase 1 ships, if `anthropic.apiKey` is set and `providers.anthropic.apiKey` is unset, copy across and set `providers.anthropic.enabled = true`. Idempotent — runs once per launch but is a no-op when already migrated.

The `agents` table gets two new columns: `model_provider` (TEXT) and `model_endpoint_id` (TEXT, nullable, only meaningful for `openai-compatible`). The existing `model` column keeps the raw string; the parsed fields are denormalized for fast filtering ("show me all my OpenAI agents"). Existing rows keep their `model` value; `model_provider` is backfilled to `anthropic` on migration.

## Settings UI

The existing "Claude Desktop" category mixes provider config (the Anthropic API key) with runtime config (Claude Code CLI install + skill sync). Split into two:

- **Providers** (new) — one card per provider:
  - Enable toggle
  - API key input (or list-of-endpoints for `openai-compatible`)
  - "Test Connection" button
  - Local provider's card has an "Add endpoint" button for multi-instance Ollama / LM Studio / llama.cpp
- **Defaults** sub-section under Providers — three `ModelRef` pickers for `chat`, `skillGen`, `tagExtract`
- **Claude Code & OpenCode** (renamed from "Claude Desktop") — CLI install detection, authentication, skill sync. Now covers OpenCode as well as Claude Code.

Per the existing memory note (`feedback_no_visual_testing`), UI verification is the user's job after each phase ships — no dev-server screenshot validation in the plan.

## Agent file format

Frontmatter `model:` field accepts a single string in `<provider>/<model>` form, with legacy short names and `inherit` preserved:

```yaml
---
name: research-agent
description: Deep research over the skill library
model: openai/gpt-4o
# legacy still accepted: model: sonnet  → mapped to anthropic/claude-sonnet-4-6
# inherit still accepted: model: inherit → uses runtime default
tools: search_skills, get_skill   # optional; see Tool semantics below
---
```

For local providers, the endpoint id is referenced in-line:
```
model: openai-compatible:ollama-local/llama3.1:70b
```
The `:ollama-local` segment is the user-defined endpoint id from Settings; omit it to use the first enabled `openai-compatible` endpoint.

A single utility `parseModelRef(str) → ModelRef` in `electron/llm/registry.ts` handles every form (legacy, inherit, new). One place to maintain.

**Parsing rule** (unambiguous, because local model names like `llama3.1:70b` themselves contain colons):
1. If the string is `inherit` or one of the legacy short names (`sonnet`, `opus`, `haiku`) → map directly.
2. Otherwise split on the **first** `/`. Left side is `<provider>` or `<provider>:<endpoint-id>`; right side is the model name (preserved verbatim, may contain any character including `:`).
3. If the left side contains a `:`, split it on the first `:` to get `provider` and `endpoint`. The `endpoint` segment is only valid when `provider === 'openai-compatible'`; any other provider with an endpoint segment is a parse error.
4. If `provider === 'openai-compatible'` and no endpoint segment is present, the registry resolves to the first enabled `openai-compatible` endpoint at call time.

**Sync semantics differ by target:**
- `anthropic/*` or legacy short names → sync to `.claude/agents/` for Claude Code, frontmatter rewritten to a Claude-Code-compatible model id (existing behavior of `MODEL_FRONTMATTER`)
- `opencode/*` → sync to `.opencode/agents/`, same file format
- `openai/*`, `google/*`, `openai-compatible:*` → **does not sync to any CLI**. Lives in Git Suite's library only; invoked through the in-app runner.

**Tool semantics:**
- CLI agents (Claude Code / OpenCode): `tools:` keeps its existing meaning — Claude Code's built-in tool names (Read, Edit, Bash, etc.). Synced verbatim.
- In-app agents (OpenAI / Google / openai-compatible): `tools:` refers to MCP tool names from Git Suite's MCP server.
  - Default (no field or `tools: inherit`): all MCP tools
  - `tools: <comma list>`: filter to those names
  - `tools: none`: pure chat, no tools

The runtime determines interpretation — no conflict because no agent runs against both runtimes.

## In-app agent runner

The existing AI Chat overlay (`src/components/AiChatOverlay.tsx` + `electron/services/aiChatService.ts`) evolves rather than gets replaced:

```
AiChatOverlay
├── Quick chat mode (existing) — no agent picked
│   ├── Model picker (defaults to settings.defaults.chat)
│   └── Existing page-context system prompt
└── Agent mode (new) — agent picked from library dropdown
    ├── Model picker (defaults to agent's `model:`, can override)
    └── Agent's system prompt body
```

Dispatch lives in a new `runChat(agentId | null, modelRef, messages)` in `aiChatService.ts`:

```
if modelRef.provider in {anthropic, opencode} AND CLI installed:
    → spawn CLI subprocess (existing path, untouched)
else:
    → call llm.runAgentLoop(modelRef, opts) with MCP tools attached
```

The CLI path is unchanged — zero regression risk for current users. The new path is purely additive.

**Streaming + structured outputs:** the existing chat overlay already parses `repo` and `action` JSON blocks from assistant text output. That parsing is provider-agnostic (text → blocks), so it works unchanged for the new runner. The runner yields a typed event stream over IPC and the renderer reassembles into the same `assistant message + parsed blocks` shape.

## MCP wiring

The MCP server already runs as a stdio subprocess (`electron/mcp-server.ts`, spawned from `electron/main.ts`) so Claude Desktop can consume it. The in-app runner becomes a **second client** of the same subprocess — identical transport, identical tools:

```
                  ┌─────────────────────┐
                  │  MCP server         │
                  │  (existing subproc) │
                  └──┬───────────────┬──┘
                     │ stdio         │ stdio
              ┌──────▼──────┐  ┌─────▼─────────────────┐
              │ Claude      │  │ In-app runner         │
              │ Desktop     │  │ (MCP client in main)  │
              │ (external)  │  │                       │
              └─────────────┘  └───────────────────────┘
```

`electron/llm/mcpClient.ts` uses `@modelcontextprotocol/sdk` (already a dep) to connect over stdio. Singleton, lazy-initialized on first runner call. Tools are fetched once at connect and attached to every `runAgentLoop` invocation via the Vercel AI SDK's `tool({ inputSchema, execute })` helper.

## IPC boundary

Per the existing memory note (`feedback_no_runtime_imports_from_electron`): `src/` may only `import type` from `electron/`. Provider abstraction lives in `electron/llm/`; renderer reaches it only via IPC:

```
electron/ipc/llmHandlers.ts          (new)
  llm:listProviders          → enabled+configured providers
  llm:listModels(provider)   → known model list per provider
  llm:testConnection(modelRef)
  llm:chat(req)              → streaming via event channel
  llm:abortChat(reqId)

src/lib/llm.ts                       (new — type-only imports from electron)
  thin wrapper around window.api.llm.* for the renderer
```

The existing `ai:sendMessage` handler keeps working — it now calls `runChat` internally, which dispatches CLI vs in-app based on the model. IPC surface unchanged. No regression for current chat behavior.

## Error handling

All provider errors normalize into a single type:

```ts
type LLMErrorKind =
  | 'auth_missing'         // no API key configured for that provider
  | 'auth_invalid'         // 401 from provider
  | 'rate_limit'           // 429
  | 'network'              // timeout, DNS, refused (esp. local Ollama not running)
  | 'model_unavailable'    // 404 model name, or provider down
  | 'context_overflow'     // 413 / explicit token-limit error
  | 'tool_failed'          // MCP tool errored
  | 'aborted'              // user cancelled
  | 'unknown';

type LLMError = { kind: LLMErrorKind; message: string; cause?: unknown };
```

Adapter rules:
- **Background tasks** (tag extraction): retry on `rate_limit` + `network` with exponential backoff, max 3 attempts; on final failure log and skip — tags are optional.
- **Interactive tasks** (chat, skill gen): no auto-retry. Surface immediately to the user with a clear message ("Ollama not reachable at http://localhost:11434 — is it running?", "OpenAI rate limit hit — wait or switch provider").
- All errors flow through one `formatLLMError(err): { title, body, action? }` so the UI is consistent.

Tool failures during the agent loop: return the error string to the model as the tool result (let the model decide whether to retry or give up), but cap at 3 consecutive tool failures before aborting the loop.

Timeouts: 30s for background, 120s for chat. All `AbortSignal`-aware.

## Testing

(Per the existing memory note `feedback_vitest_rebuild`: use `npm test`, not `npx vitest` — the script rebuilds better-sqlite3 for the Node ABI first.)

**Unit tests:**
- `parseModelRef` — every format: legacy (`sonnet`), `inherit`, `provider/model`, `openai-compatible:endpoint/model`, malformed inputs
- Storage migration — `anthropic.apiKey` → `providers.anthropic.apiKey`, happy path + idempotency + both-set conflict resolution
- Each adapter with the Vercel AI SDK mocked — request construction + response parsing
- Error normalization — provider-specific errors → `LLMErrorKind` matrix
- MCP client — connects, lists tools, executes a tool, handles disconnect

**Equivalence tests for the Phase 3 refactor:**
- For each of the 4 call sites, pin one input → expected output as a fixture. Run before and after the refactor; output identical (structurally equal where IDs/timestamps drift).

**Integration tests:**
- Agent runner end-to-end with a stub MCP server: tool-call loop, streaming, abort mid-stream, tool-failure cap
- Backward-compat fixture: existing agent files with `model: sonnet` parse + sync to `.claude/agents/` with the same frontmatter that's written today

**No live API tests** (cost + flakiness). Each provider PR ships with a manual smoke-test checklist:
- [ ] Configure API key in Settings → Test Connection passes
- [ ] Create an agent with `model: <provider>/<model>` → it appears in the Agent picker
- [ ] Run the agent in chat → streams a response
- [ ] Trigger a tool call (`search_skills`) → tool executes, model continues

## Phasing

Each phase is independently shippable. Per `~/.claude/CLAUDE.md` branch policy, work goes directly to `main` — no feature branches unless explicitly requested.

| Phase | What lands | User-visible? | Risk |
|---|---|---|---|
| **1. Foundation: provider abstraction** | `electron/llm/` (types, registry, Anthropic adapter), `apiStore` migration with read-through alias | No — pure scaffolding | Low |
| **2. Foundation: agent file format** | `parseModelRef`, new `agents.model_provider` + `model_endpoint_id` columns, frontmatter parser accepts new format alongside legacy | No — existing agents unchanged | Low (DB migration touches existing table) |
| **3. Refactor 4 call sites** | `tag-extractor.ts`, `skill-gen/legacy.ts`, `agentFileSyncService.ts`, `aiChatService.ts` route through `electron/llm/` | No — still Anthropic-only | Medium — touches load-bearing code; equivalence tests required |
| **4. Add other providers** | OpenAI + Google + OpenAI-compatible adapters, Settings UI Providers card + endpoints list, Defaults section | **Yes** — first user-visible multi-provider | Low per adapter; UI is the bulk of the work |
| **5. In-app agent runner** | `electron/llm/runner.ts`, `electron/llm/mcpClient.ts`, AiChatOverlay agent-mode dispatch, IPC events for streaming | **Yes** — non-CLI agents become runnable | Medium — new streaming surface, MCP wiring |
| **6. OpenCode sync target** | Parallel to existing `.claude/agents/` sync, writes to `.opencode/agents/`, Settings UI gains OpenCode CLI section | **Yes** — OpenCode users covered | Low — pattern-match the Claude Code sync code |

Order is enforced: 1+2 are prerequisites for everything; 3 must precede 4 (so adding a provider only requires adding an adapter, not refactoring 4 places); 5 depends on 4 (needs at least one non-CLI provider to be useful); 6 is independent of 4–5 and could ship in parallel.

**Each phase = its own plan + its own commits.** Don't bundle phases into one PR.

## Open questions

- **Claude Code frontmatter compatibility for the new long model form.** Today's sync writes long Anthropic IDs (e.g. `claude-sonnet-4-6`) into `.claude/agents/` and Claude Code accepts them. Confirm in Phase 1 that the *provider-prefixed* form (`anthropic/claude-sonnet-4-6`) is either accepted by Claude Code, or that we always strip the prefix on write. (Current plan assumes "always strip on write" — safest.)
- **OpenCode model naming.** Confirm OpenCode's accepted `model:` values during Phase 6 — they may differ slightly from Claude Code's.
- **Vercel AI SDK MCP helper version.** Newer versions ship an `experimental_createMCPClient`. Decide in Phase 5 whether to use it or wire `@modelcontextprotocol/sdk` directly (we may want the raw SDK for tighter control over the existing subprocess).

### Deferred from Phase 1 (tracked, not yet implemented)

- **`defaults.*` section of the storage schema** (`chat`, `skillGen`, `tagExtract` → `ModelRef`). Phase 1 did NOT land this — there is no caller yet. The Anthropic adapter currently hardcodes `INHERIT_DEFAULT = 'claude-sonnet-4-6'` (see `electron/llm/adapters/anthropic.ts`, marked `TODO(Phase 4)`). Add the schema + helpers in Phase 3 or Phase 4 when the refactored call sites and Settings UI need to read defaults.
- **`KeyedProviderConfig | KeylessProviderConfig` split.** `getProviderConfig` returns `apiKey: undefined` for both "user hasn't set one" and "this provider has no top-level key by design" (opencode, openai-compatible). The ambiguity is documented in JSDoc; the type split is a Phase 4 task when the Settings UI starts branching on missing keys.
- **`network` error kind detection** in `electron/llm/adapters/anthropic.ts`'s `normalizeError`. Currently `ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND` fall through to `unknown`. Load-bearing once openai-compatible local endpoints land in Phase 4 — the most common failure mode there is "Ollama isn't running." TODO marker in place.
- **`Parameters<typeof generateText>[0]` whole-argument cast** in the Anthropic adapter. Acceptable Phase 1 escape hatch for the SDK's overloaded signature; replace with a typed `CoreMessage[]` mapping at the `messages` property in Phase 5 when streaming + tools widen the call shape. TODO marker in place.

## Out of scope (deferred)

- External (third-party) MCP server support in Settings
- Native cloud SDK execution for Anthropic + OpenCode (replacing the CLI subprocess path)
- Vision/image inputs
- Token usage tracking + per-provider cost display
- A model marketplace, ratings, or recommendation UI
