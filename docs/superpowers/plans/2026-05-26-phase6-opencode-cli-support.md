# Phase 6 — OpenCode CLI Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship OpenCode CLI support as a second subscription-style provider alongside Claude Code — parallel install/detection/auth flow, agent file sync to `.opencode/agents/`, fifth provider card in Settings → Providers, and a renamed "Claude Code & OpenCode" Settings category that hosts both CLI install flows.

**Architecture:** Mirror the existing Claude Code subsystem. A new `electron/skill-gen/opencode.ts` module exposes `detectOpenCode` / `installOpenCodeCLI` / `loginOpenCode` / `logoutOpenCode` / `checkOpenCodeAuthStatus` — same shape as the existing helpers in `electron/skill-gen/legacy.ts`. New `opencode:*` IPC channels in `electron/main.ts` parallel the existing `skill:*` channels. The Phase-5 `runChat` dispatcher already routes `provider === 'opencode'` to `sendMessageStream`; we extend `sendMessageStream` to branch on the resolved model's provider and spawn OpenCode's CLI for the opencode case. `agentFileSyncService.previewSubagentFile` gets a parallel sync branch that writes `opencode/*` agents to `.opencode/agents/{handle}.md`. The Settings "Claude Desktop" category is renamed and grows a parallel sub-section for OpenCode; a fifth card (after openai-compatible) is added to the Providers section with a status indicator + link to the category for setup. No new API key inputs — OpenCode uses subscription auth, not API keys.

**Tech Stack:** TypeScript, vitest, electron-store, React, `child_process.spawn`, the existing Claude Code wiring as a template.

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md) — see the **Phasing** table (Phase 6) and the **Settings UI** section's "Claude Code & OpenCode" rename note.

**Branch policy:** Commit directly to `main` per `~/.claude/CLAUDE.md`. No feature branches, no worktrees.

**Test command:** Always `npm test`, never `npx vitest` (the pretest rebuilds `better-sqlite3`).

**Scope decisions** (intentional narrowing within Phase 6):

- **CLI dispatch only — no in-app OpenCode adapter.** `runChat` already routes `provider === 'opencode'` to the CLI path. The `electron/llm/index.ts` factory's `opencode` case currently throws "scheduled for Phase 6"; we replace the throw with a clearer message ("OpenCode runs via the CLI subprocess path; the in-app runner does not support it") — opencode never reaches `createLLMService().runAgentLoop()` in normal use. No adapter file, no Vercel-SDK integration.
- **OpenCode subscription auth, no API key UI.** OpenCode authenticates via its own subscription/OAuth flow (`opencode auth login`). The OpenCode provider card in Settings → Providers shows install + login status with a link to the "Claude Code & OpenCode" category for setup — no API key input.
- **Anthropic API key duplication removal is a no-op.** Phase-6's original spec called for removing a duplicate Anthropic API key input from the Claude Desktop section, but investigation confirmed [`renderClaudeDesktop()`](../../../src/views/Settings.tsx) (lines 1364-1421) has no API key input — the Providers section card is already the sole canonical location. Skip this item.
- **OpenCode CLI argument shapes are verified at install time, not pre-committed.** OpenCode's CLI flags differ from Claude Code's in subtle ways (e.g., `opencode run` subcommand, different `--model` syntax). Task 1 includes a discovery step that runs `opencode --help` against the actual installed CLI and the implementer adjusts arg construction accordingly. The plan commits to the **OpenCode package name `opencode-ai`** (the documented npm distribution) and the **binary name `opencode`** — both confirmed via OpenCode's public docs.
- **`.opencode/agents/` only, no slash commands.** Claude Code's sync writes both subagent files (`.claude/agents/`) and slash command files. For Phase 6 we sync only subagents to `.opencode/agents/` — OpenCode's slash command surface is out of scope.
- **No equivalence tests for OpenCode CLI invocation.** Tests mock `child_process.spawn` and assert the correct command + args are constructed. No live CLI execution in CI.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `electron/skill-gen/opencode.ts` | OpenCode CLI helpers: detect, install, login, logout, auth status. Mirrors `legacy.ts` patterns. |
| `electron/skill-gen/opencode.test.ts` | TDD coverage for the helpers (mocks child_process + node-pty). |

**Modified files:**

| Path | Change |
|---|---|
| `electron/main.ts` | Add `opencode:*` IPC handlers next to the existing `skill:*` block (around line 1241). |
| `electron/preload.ts` | Expose `window.api.opencode.*` parallel to the existing skill-related methods. |
| `src/env.d.ts` | Add the `opencode:` namespace types. |
| `electron/services/aiChatService.ts` | `sendMessageStream` becomes provider-aware — branches on `modelRef.provider` to spawn either Claude Code or OpenCode. Accepts modelRef from caller. |
| `electron/services/dispatchChat.ts` | Pass `modelRef` through to `sendMessageStream` (currently passes only the message payload). |
| `electron/services/aiChatService.runChat.test.ts` | Add a test verifying opencode routes to `sendMessageStream` with the modelRef passed through. |
| `electron/services/agentFileSyncService.ts` | Add `opencodeSubagentPath` + an `opencode` sync branch parallel to the existing claude branch. |
| `electron/services/agentFileSyncService.test.ts` | Add tests for the new opencode sync branch (if file exists; otherwise tests live with the call site). |
| `electron/llm/index.ts` | Replace the `'opencode'` throw with a clearer not-supported message (one-liner). |
| `electron/llm/index.test.ts` | Update the corresponding test's expected message. |
| `src/views/Settings.tsx` | Rename `'claude-desktop'` CategoryId → `'claude-opencode'` (with backward-compat redirect in any persisted state). Rename label "Claude Desktop" → "Claude Code & OpenCode". Restructure `renderClaudeDesktop` → `renderClaudeOpenCode` with two sections (Claude Code + OpenCode). Add fifth provider card after `<OpenAICompatibleSection>` showing OpenCode install + login status. |

**Files NOT touched** (intentional):
- `electron/llm/adapters/*` — OpenCode doesn't get an adapter (CLI-only). The existing four adapters stay untouched.
- `electron/llm/registry.ts` — `'opencode'` is already a valid ProviderId from Phase 1.
- `electron/store.ts` — Phase 1 already reserved `providers.opencode.enabled?: boolean` and listed `'opencode'` in `PROVIDERS_WITHOUT_TOP_LEVEL_KEY`. No changes needed.
- The Anthropic API key input in `src/views/Settings.tsx` — there is no duplicate (already canonical in the Providers card).

---

## Task 1: OpenCode CLI helpers — detect, install, login, logout (TDD)

**Files:**
- Create: `electron/skill-gen/opencode.ts`
- Create: `electron/skill-gen/opencode.test.ts`

This task mirrors the Claude Code helper functions in `electron/skill-gen/legacy.ts:366-705`. The OpenCode CLI is distributed as the npm package `opencode-ai` with binary `opencode`.

- [ ] **Step 1: CLI discovery + verification (no code yet)**

Before writing tests, run these commands to confirm OpenCode's actual CLI shape. The plan assumes specific flags; verify them.

```bash
# Check if OpenCode is already installed locally (probably isn't)
which opencode 2>/dev/null || echo "not in PATH"
# Verify npm package name
npm view opencode-ai version 2>&1 | head -3
```

Then if not installed: `npm install -g opencode-ai` and run `opencode --help` to confirm:
- The subcommands (`auth`, `run`, etc.)
- The `--print` flag (or its equivalent for non-interactive mode)
- The `--model` flag syntax
- The `auth status` / `auth login` / `auth logout` subcommands

If any of those diverge from this plan's assumptions, note the actual shape and adapt the spawn args in Step 3. The function names + IPC channels stay the same — only the args inside `spawn(...)` change.

- [ ] **Step 2: Write the failing tests**

Create `electron/skill-gen/opencode.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: vi.fn() }
})

import { detectOpenCode, checkOpenCodeAuthStatus, findOpenCodeBinary } from './opencode'

beforeEach(() => {
  mockSpawn.mockReset()
})

function makeSpawnMock(opts: { stdout?: string; stderr?: string; exitCode?: number }) {
  return {
    stdout: { on: (event: string, cb: (data: Buffer) => void) => { if (event === 'data' && opts.stdout) cb(Buffer.from(opts.stdout)) } },
    stderr: { on: (event: string, cb: (data: Buffer) => void) => { if (event === 'data' && opts.stderr) cb(Buffer.from(opts.stderr)) } },
    on: (event: string, cb: (code: number) => void) => { if (event === 'close') setImmediate(() => cb(opts.exitCode ?? 0)) },
  }
}

describe('findOpenCodeBinary', () => {
  it('returns null when opencode is not in PATH', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(findOpenCodeBinary()).toBeNull()
  })

  it('returns the path when opencode is found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).includes('opencode'))
    expect(findOpenCodeBinary()).toMatch(/opencode/)
  })
})

describe('detectOpenCode', () => {
  it('returns true when the opencode binary is found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await detectOpenCode()).toBe(true)
  })

  it('returns false when not found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(await detectOpenCode()).toBe(false)
  })
})

describe('checkOpenCodeAuthStatus', () => {
  it('returns true when "opencode auth status" reports logged in', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '{"loggedIn":true}\n', exitCode: 0 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(true)
  })

  it('returns false when the CLI reports loggedIn:false', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '{"loggedIn":false}\n', exitCode: 0 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })

  it('returns false when the CLI is not installed', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })

  it('returns false when the CLI exits non-zero (not authenticated)', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '', exitCode: 1 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })
})
```

- [ ] **Step 3: Run the failing tests**

```bash
npm test -- electron/skill-gen/opencode.test.ts
```

Expected: `Cannot find module './opencode'`.

- [ ] **Step 4: Implement the module**

Create `electron/skill-gen/opencode.ts`:

```ts
import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import * as path from 'path'
import * as os from 'os'
import { buildEnv } from './legacy'

/**
 * Find the OpenCode binary. Checks common install locations:
 * - npm global: $APPDATA/npm/opencode.cmd (Windows), /usr/local/bin/opencode (POSIX)
 * - $HOME/.opencode/bin/opencode (the curl-installer location)
 * - $APPDATA/npm/node_modules/opencode-ai/bin/opencode
 */
export function findOpenCodeBinary(): string | null {
  const candidates: string[] = []
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(appdata, 'npm', 'opencode.cmd'),
      path.join(appdata, 'npm', 'opencode.exe'),
      path.join(appdata, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.cmd'),
      path.join(home, '.opencode', 'bin', 'opencode.exe'),
    )
  } else {
    candidates.push(
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
      path.join(home, '.npm-global', 'bin', 'opencode'),
      path.join(home, '.opencode', 'bin', 'opencode'),
    )
  }
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * Detect whether OpenCode is installed and runnable.
 */
export async function detectOpenCode(): Promise<boolean> {
  return findOpenCodeBinary() !== null
}

/**
 * Check whether OpenCode is authenticated. Spawns `opencode auth status --json`.
 * Returns false if the CLI is missing, exits non-zero, or reports loggedIn:false.
 *
 * Note (Phase 6): the exact subcommand may be `opencode auth status` without
 * `--json`, or it may print human-readable text. Adapt parsing if needed —
 * the function contract is just boolean.
 */
export async function checkOpenCodeAuthStatus(): Promise<boolean> {
  const bin = findOpenCodeBinary()
  if (!bin) return false
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    const proc = spawn(bin, ['auth', 'status', '--json'], { env: buildEnv(true) })
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('close', (code: number) => {
      if (code !== 0) return resolve(false)
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { loggedIn?: boolean }
        resolve(Boolean(parsed.loggedIn))
      } catch {
        // Fallback: treat any non-error output as "logged in" (best-effort
        // when the CLI's output format isn't JSON).
        resolve(Buffer.concat(chunks).length > 0)
      }
    })
    proc.on('error', () => resolve(false))
  })
}

/**
 * Install OpenCode via npm. Streams progress to the callback.
 */
export async function installOpenCodeCLI(
  onProgress: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', 'opencode-ai'], {
      env: buildEnv(true),
      shell: process.platform === 'win32',
    })
    proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`opencode install failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Trigger OpenCode's OAuth login flow.
 *
 * Implementation pattern mirrors `loginClaude` in legacy.ts: spawn via
 * node-pty to give the CLI a TTY (so its built-in OAuth-loopback flow
 * picks up the callback URL automatically). Poll `checkOpenCodeAuthStatus`
 * with a 3-minute timeout. The CLI's actual subcommand may be
 * `opencode auth login` (most likely) or `opencode login` — adapt during
 * implementation if Step 1's verification showed otherwise.
 */
export async function loginOpenCode(
  onProgress: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const bin = findOpenCodeBinary()
  if (!bin) return { ok: false, error: 'OpenCode CLI not installed' }
  onProgress('Starting OpenCode login flow…')

  // Best-effort: spawn the auth-login subcommand. Don't await — let it run
  // in the background while we poll auth status.
  const proc = spawn(bin, ['auth', 'login'], {
    env: buildEnv(true),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (c: Buffer) => onProgress(c.toString('utf8')))
  proc.stderr.on('data', (c: Buffer) => onProgress(c.toString('utf8')))

  const startedAt = Date.now()
  const timeoutMs = 3 * 60 * 1000
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000))
    if (await checkOpenCodeAuthStatus()) {
      try { proc.kill() } catch { /* best-effort */ }
      onProgress('Login successful.')
      return { ok: true }
    }
  }
  try { proc.kill() } catch { /* best-effort */ }
  return { ok: false, error: 'Login timed out after 3 minutes' }
}

/**
 * Log out of OpenCode.
 */
export async function logoutOpenCode(): Promise<void> {
  const bin = findOpenCodeBinary()
  if (!bin) return
  return new Promise(resolve => {
    const proc = spawn(bin, ['auth', 'logout'], { env: buildEnv(true) })
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* best-effort */ }
      resolve()
    }, 5000)
    proc.on('close', () => { clearTimeout(timer); resolve() })
    proc.on('error', () => { clearTimeout(timer); resolve() })
  })
}
```

- [ ] **Step 5: Run the tests, verify they pass**

```bash
npm test -- electron/skill-gen/opencode.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add electron/skill-gen/opencode.ts electron/skill-gen/opencode.test.ts
git commit -m "feat(opencode): detect, install, login, logout CLI helpers"
```

---

## Task 2: OpenCode IPC handlers + preload surface

**Files:**
- Modify: `electron/main.ts` (add `opencode:*` handlers next to the existing `skill:*` block around line 1241)
- Modify: `electron/preload.ts` (expose `window.api.opencode.*`)
- Modify: `src/env.d.ts` (type augmentation for `window.api.opencode`)

Wire the helpers from Task 1 into IPC channels parallel to the existing `skill:detectClaudeCode`, `skill:checkAuthStatus`, `skill:setup`, `skill:loginClaude`, `skill:logoutClaude` pattern.

- [ ] **Step 1: Add IPC handlers in `electron/main.ts`**

Find the existing block around line 1241-1304 (the `skill:*` handlers). Right after the `skill:logoutClaude` handler, add:

```ts
import {
  detectOpenCode,
  checkOpenCodeAuthStatus,
  installOpenCodeCLI,
  loginOpenCode,
  logoutOpenCode,
} from './skill-gen/opencode'

// ── OpenCode CLI handlers (parallel to skill:* for Claude Code) ──
ipcMain.handle('opencode:detect', async () => detectOpenCode())
ipcMain.handle('opencode:checkAuthStatus', async () => checkOpenCodeAuthStatus())

ipcMain.handle('opencode:setup', async (event) => {
  const send = (phase: string, line?: string) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('opencode:setup-progress', { phase, line })
    }
  }
  send('checking')
  if (await detectOpenCode()) {
    send('done')
    return { ok: true }
  }
  send('installing')
  try {
    await installOpenCodeCLI((line) => send('installing', line))
  } catch (err) {
    send('error', err instanceof Error ? err.message : String(err))
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  send('auth')
  send('done')
  return { ok: true }
})

ipcMain.handle('opencode:loginOpenCode', async (event) => {
  const send = (msg: string, opts?: { isError?: boolean; done?: boolean }) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('opencode:login-progress', { message: msg, ...opts })
    }
  }
  const result = await loginOpenCode((line) => send(line))
  if (result.ok) send('Login successful', { done: true })
  else send(result.error ?? 'Login failed', { isError: true, done: true })
  return result
})

ipcMain.handle('opencode:logoutOpenCode', async () => {
  await logoutOpenCode()
})
```

- [ ] **Step 2: Expose via preload in `electron/preload.ts`**

Find the existing skill-related block (around line 110-122 — search for `loginClaude`). Add a new `opencode:` block alongside it:

```ts
opencode: {
  detect:        () => ipcRenderer.invoke('opencode:detect') as Promise<boolean>,
  checkAuthStatus: () => ipcRenderer.invoke('opencode:checkAuthStatus') as Promise<boolean>,
  setup:         () => ipcRenderer.invoke('opencode:setup') as Promise<{ ok: boolean; error?: string }>,
  loginOpenCode: () => ipcRenderer.invoke('opencode:loginOpenCode') as Promise<{ ok: boolean; error?: string }>,
  logoutOpenCode: () => ipcRenderer.invoke('opencode:logoutOpenCode') as Promise<void>,

  onSetupProgress: (cb: (payload: { phase: string; line?: string }) => void) => {
    const wrapper = (_: unknown, payload: { phase: string; line?: string }) => cb(payload)
    ipcRenderer.on('opencode:setup-progress', wrapper)
    return wrapper
  },
  offSetupProgress: (cb: (payload: { phase: string; line?: string }) => void) => {
    ipcRenderer.removeListener('opencode:setup-progress', cb as never)
  },

  onLoginProgress: (cb: (payload: { message: string; isError?: boolean; done?: boolean }) => void) => {
    const wrapper = (_: unknown, payload: { message: string; isError?: boolean; done?: boolean }) => cb(payload)
    ipcRenderer.on('opencode:login-progress', wrapper)
    return wrapper
  },
  offLoginProgress: (cb: (payload: { message: string; isError?: boolean; done?: boolean }) => void) => {
    ipcRenderer.removeListener('opencode:login-progress', cb as never)
  },
},
```

If the existing preload uses a `callbackWrappers` Map pattern for `onSetupProgress`/`onLoginProgress` (search the file), match that pattern instead of the inline wrappers above. The goal is consistency with how the existing `skill:*` events are wired.

- [ ] **Step 3: Add types in `src/env.d.ts`**

Find the existing `skill:` block in the `window.api` type augmentation. Add a parallel `opencode:` block:

```ts
opencode: {
  detect(): Promise<boolean>
  checkAuthStatus(): Promise<boolean>
  setup(): Promise<{ ok: boolean; error?: string }>
  loginOpenCode(): Promise<{ ok: boolean; error?: string }>
  logoutOpenCode(): Promise<void>
  onSetupProgress(cb: (payload: { phase: string; line?: string }) => void): void
  offSetupProgress(cb: (payload: { phase: string; line?: string }) => void): void
  onLoginProgress(cb: (payload: { message: string; isError?: boolean; done?: boolean }) => void): void
  offLoginProgress(cb: (payload: { message: string; isError?: boolean; done?: boolean }) => void): void
}
```

- [ ] **Step 4: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/env.d.ts
git commit -m "feat(ipc): opencode:* IPC handlers + window.api.opencode.* preload surface"
```

---

## Task 3: sendMessageStream provider-aware dispatch (TDD)

**Files:**
- Modify: `electron/services/aiChatService.ts` (`sendMessageStream` becomes provider-aware)
- Modify: `electron/services/dispatchChat.ts` (pass `modelRef` to `sendMessageStream`)
- Modify: `electron/services/aiChatService.runChat.test.ts` (add opencode-dispatch test)

The Phase-5 `runChat` dispatcher already branches `anthropic|opencode` → CLI. But `sendMessageStream` itself always spawns Claude Code. Phase 6 makes it branch based on the modelRef's provider.

- [ ] **Step 1: Update the test**

In `electron/services/aiChatService.runChat.test.ts`, find the existing `routes opencode to the CLI path` test (added in Phase 5 Task 8). Strengthen it to also verify the modelRef is passed through to `sendMessageStream`:

```ts
it('routes opencode to the CLI path and passes the modelRef through', async () => {
  const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
  await runChat({
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    starredRepos: [],
    installedSkills: [],
    modelRef: { provider: 'opencode', model: 'claude-sonnet-4-6' },
  }, callbacks)
  expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
  // The modelRef should be passed as the last (or distinct) arg — check the
  // exact arg position based on the new sendMessageStream signature.
  const args = mockSendMessageStream.mock.calls[0]
  // sendMessageStream(messages, starredRepos, installedSkills, pageContext, modelRef, callbacks)
  expect(args[4]).toEqual({ provider: 'opencode', model: 'claude-sonnet-4-6' })
})
```

Run the test to confirm it fails:

```bash
npm test -- electron/services/aiChatService.runChat.test.ts
```

Expected: the new assertion fails because modelRef isn't passed yet.

- [ ] **Step 2: Update `sendMessageStream` signature**

In `electron/services/aiChatService.ts`, find `sendMessageStream` (around line 100). Change the signature to accept `modelRef` as the 5th parameter:

```ts
import type { ModelRef } from '../llm/types'
import { findOpenCodeBinary } from '../skill-gen/opencode'

export async function sendMessageStream(
  messages: AiChatMessage[],
  starredRepos: string[],
  installedSkills: string[],
  pageContext: string | undefined,
  modelRef: ModelRef,
  callbacks: StreamCallbacks
): Promise<void> {
  const { detectClaudeCode, checkAuthStatus, findNode, findLocalCli, buildEnv } =
    await import('../skill-gen/legacy')

  // Branch on provider to pick the right CLI.
  const isOpenCode = modelRef.provider === 'opencode'

  if (isOpenCode) {
    const bin = findOpenCodeBinary()
    if (!bin) {
      callbacks.onError('OpenCode CLI not found. Install via Settings → Claude Code & OpenCode.')
      return
    }
    return spawnOpenCodeChat(bin, messages, starredRepos, installedSkills, pageContext, modelRef, callbacks)
  }

  // Existing Claude Code path (anthropic provider) — unchanged below.
  const detected = await detectClaudeCode()
  if (!detected) { callbacks.onError('Claude Code CLI not found. Please install it first via Settings.'); return }
  // ... rest of the existing implementation stays as-is ...
}
```

(Note: the existing implementation continues unchanged after the OpenCode branch. The Claude Code spawn path stays exactly as-is.)

Then add the new function below `sendMessageStream`:

```ts
async function spawnOpenCodeChat(
  bin: string,
  messages: AiChatMessage[],
  starredRepos: string[],
  installedSkills: string[],
  pageContext: string | undefined,
  modelRef: ModelRef,
  callbacks: StreamCallbacks
): Promise<void> {
  const { buildEnv } = await import('../skill-gen/legacy')
  const systemPrompt = buildSystemPrompt(starredRepos, installedSkills, pageContext)
  const prompt = `${systemPrompt}\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`

  console.log('[ai-chat] Spawning OpenCode CLI, bin:', bin, 'model:', modelRef.model)

  // OpenCode CLI args — VERIFY DURING TASK 1 STEP 1.
  // Expected shape: `opencode run --print --model <model>` reading prompt from stdin.
  // If actual flags differ, adjust here; the test only verifies the binary is spawned.
  const proc = spawn(bin, ['run', '--print', '--model', modelRef.model], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildEnv(true),
    shell: process.platform === 'win32',
  })

  const chunks: Buffer[] = []
  let errOutput = ''

  proc.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    // OpenCode may stream incrementally — forward each chunk as a token.
    callbacks.onToken(chunk.toString('utf8'))
  })

  proc.stderr.on('data', (chunk: Buffer) => {
    errOutput += chunk.toString('utf8')
  })

  proc.on('error', (err) => {
    console.error('[ai-chat] Failed to spawn OpenCode CLI:', err.message)
    callbacks.onError(`Failed to start OpenCode CLI: ${err.message}`)
  })

  proc.on('close', (code) => {
    const stdout = Buffer.concat(chunks).toString('utf8')
    if (code !== 0) {
      const detail = errOutput || stdout || '(no output)'
      console.error('[ai-chat] OpenCode exited with code', code, ':', detail.slice(0, 500))
      callbacks.onError(`OpenCode CLI error (code ${code}): ${detail.slice(0, 300)}`)
      return
    }
    callbacks.onDone(stdout.trim())
  })

  proc.stdin.write(prompt, 'utf8')
  proc.stdin.end()
}
```

Make sure `buildSystemPrompt` is in scope (it's defined elsewhere in the same file — already used by the Claude Code path).

- [ ] **Step 3: Update `dispatchChat.ts` to pass modelRef**

In `electron/services/dispatchChat.ts`, find the call to `sendMessageStream` (around lines 43-58). Update it to pass the resolved `ref`:

```ts
if (ref.provider === 'anthropic' || ref.provider === 'opencode') {
  return sendMessageStream(
    req.messages,
    req.starredRepos,
    req.installedSkills,
    req.pageContext,
    ref,                       // NEW — pass the resolved modelRef
    {
      onToken: callbacks.onToken,
      onDone:  callbacks.onDone,
      onError: callbacks.onError,
    },
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- electron/services/aiChatService.runChat.test.ts
```

Expected: all tests pass, including the new modelRef-passthrough assertion.

Also run the broader services tests to confirm no regressions:

```bash
npm test -- electron/services/
```

- [ ] **Step 5: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add electron/services/aiChatService.ts electron/services/dispatchChat.ts electron/services/aiChatService.runChat.test.ts
git commit -m "feat(chat): sendMessageStream branches on modelRef.provider — Claude Code vs OpenCode CLI"
```

---

## Task 4: Agent file sync to .opencode/agents/ (TDD)

**Files:**
- Modify: `electron/services/agentFileSyncService.ts` (add the opencode sync branch)

The existing `previewSubagentFile` and `syncAgentToDisk` write to `.claude/agents/{handle}.md` when `agent.model_provider === 'anthropic'`. Phase 6 adds a parallel branch for `'opencode'` that writes to `.opencode/agents/{handle}.md`. The frontmatter is essentially identical (name, description, tools, model).

- [ ] **Step 1: Read the existing sync code**

```bash
# Reread these lines from agentFileSyncService.ts:
#   - lines 64-69:   modelForClaudeFrontmatter (model normalization)
#   - lines 77-91:   previewSubagentFile (frontmatter builder)
#   - lines 124-152: syncAgentToDisk + syncOneSurface
#   - lines 130-135: comment marker for Phase 6 opencode sync target
```

Confirm what `subagentPath(handle)` returns — it should be `$CLAUDE_HOME/agents/{handle}.md`. Find the equivalent helper or the inline path construction that needs an opencode parallel. Look for `$OPENCODE_HOME` or `.opencode/agents/` in the file. If neither exists, the new function uses `path.join(os.homedir(), '.opencode', 'agents', `${handle}.md`)`.

- [ ] **Step 2: Add `opencodeSubagentPath` helper and a parallel sync branch**

Find the existing path helper (probably `subagentPath(handle)` or similar). Below it, add:

```ts
function opencodeSubagentPath(handle: string): string {
  const home = os.homedir()
  return path.join(home, '.opencode', 'agents', `${handle}.md`)
}
```

Find `modelForClaudeFrontmatter` (lines 64-69) and add a parallel:

```ts
function modelForOpenCodeFrontmatter(model: string): string | null {
  // OpenCode accepts the bare model id (e.g. 'claude-sonnet-4-6', 'gpt-4o').
  // Strip provider prefix if present; pass 'inherit' through as null so the
  // runtime uses OpenCode's own default-model resolution.
  if (model === 'inherit') return null
  const slashIdx = model.indexOf('/')
  if (slashIdx === -1) return model
  return model.slice(slashIdx + 1)
}
```

Find the existing sync dispatch (lines 124-152). The current code looks like (approximate — match what's actually there):

```ts
async function syncAgentToDisk(agent: AgentRow, content: string, ctx?: SyncCtx) {
  // ... existing setup ...
  await Promise.all([
    syncOneSurface({ /* subagent surface — claude */ }),
    syncOneSurface({ /* slash command surface — claude */ }),
  ])
}
```

The gating for the existing subagent branch is `agent.is_subagent === 1 && agent.model_provider === 'anthropic'`. Add a parallel call for `'opencode'`:

```ts
async function syncAgentToDisk(agent: AgentRow, content: string, ctx?: SyncCtx) {
  // ... existing setup ...
  await Promise.all([
    syncOneSurface({
      enabled: agent.is_subagent === 1 && agent.model_provider === 'anthropic',
      handle: agent.name,
      path: subagentPath(agent.name),
      content: previewSubagentFile(agent, content),
      surface: 'claude-subagent',
      ctx,
    }),
    syncOneSurface({
      enabled: agent.is_subagent === 1 && agent.model_provider === 'opencode',
      handle: agent.name,
      path: opencodeSubagentPath(agent.name),
      content: previewOpenCodeSubagentFile(agent, content),
      surface: 'opencode-subagent',
      ctx,
    }),
    syncOneSurface({ /* existing slash command surface — claude only */ }),
  ])
}
```

(Match the actual code style — the snippet above is illustrative. The real file may inline this differently.)

Then add the `previewOpenCodeSubagentFile` function alongside the existing `previewSubagentFile`:

```ts
function previewOpenCodeSubagentFile(agent: AgentRow, body: string): string {
  const fm = {
    name: agent.name,
    description: agent.description,
    tools: agent.tools_config ? parseTools(agent.tools_config).join(', ') : undefined,
    model: modelForOpenCodeFrontmatter(agent.model),
  }
  // Remove null/undefined fields so they don't write out as 'model: null'
  const cleanFm = Object.fromEntries(Object.entries(fm).filter(([_, v]) => v != null && v !== ''))
  return matter.stringify(body, cleanFm)
}
```

(`parseTools` exists in the file; match its name. `matter` is `gray-matter`, already imported.)

- [ ] **Step 3: Write tests (if the file has an existing test)**

Check whether `electron/services/agentFileSyncService.test.ts` exists. If yes, append:

```ts
describe('opencode subagent sync', () => {
  it('writes the agent to ~/.opencode/agents/{name}.md when model_provider is opencode', async () => {
    // Setup mocks similar to existing claude-subagent tests.
    // Verify writeFile is called with a path matching /\.opencode[\/\\]agents[\/\\]my-agent\.md/.
  })

  it('strips provider prefix from model in the opencode frontmatter', async () => {
    // Agent has model 'opencode/claude-sonnet-4-6' → frontmatter should show 'claude-sonnet-4-6'
  })

  it('does not sync the agent to .claude/agents when model_provider is opencode', async () => {
    // Verify writeFile is NOT called for the claude path.
  })
})
```

If the file doesn't exist, skip the test step — the Phase 6 manual smoke test in Task 8 covers the sync end-to-end. Note this in the commit message.

- [ ] **Step 4: Run tests (if added)**

```bash
npm test -- electron/services/agentFileSyncService
```

Expected: all pass.

- [ ] **Step 5: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add electron/services/agentFileSyncService.ts electron/services/agentFileSyncService.test.ts 2>/dev/null
git commit -m "feat(agents): sync model_provider=opencode agents to .opencode/agents/"
```

---

## Task 5: Replace the opencode throw stub in createLLMService

**Files:**
- Modify: `electron/llm/index.ts` (line 43-45 — the `'opencode'` case)
- Modify: `electron/llm/index.test.ts` (update the expected error message)

The factory currently throws `LLMError('unknown', 'Provider "opencode" has no adapter yet — scheduled for Phase 6.')`. Post-Phase-6 this stub is misleading — OpenCode runs via the CLI subprocess path, not the in-app runner. Update the message.

- [ ] **Step 1: Update the test expectation**

In `electron/llm/index.test.ts`, find the test `'still throws LLMError kind=unknown for opencode (Phase 6)'`. Update its expected message:

```ts
it('throws a clear error if opencode reaches the in-app runner (it should use CLI dispatch instead)', async () => {
  const svc = createLLMService()
  await expect(svc.generateText(
    { provider: 'opencode', model: 'claude-sonnet-4-6' },
    { messages: [{ role: 'user', content: 'hi' }] },
  )).rejects.toMatchObject({
    name: 'LLMError',
    kind: 'unknown',
    message: expect.stringContaining('CLI subprocess'),
  })
})
```

Run the test to verify it fails (the existing message says "scheduled for Phase 6"):

```bash
npm test -- electron/llm/index.test.ts
```

Expected: the assertion on the new message fails.

- [ ] **Step 2: Update the throw in `electron/llm/index.ts`**

Find lines 43-45:

```ts
case 'opencode':
  // OpenCode adapter lands in Phase 6 alongside its sync target.
  throw new LLMError('unknown', 'Provider "opencode" has no adapter yet — scheduled for Phase 6.')
```

Replace with:

```ts
case 'opencode':
  // OpenCode runs through the CLI subprocess path (see runChat in
  // electron/services/dispatchChat.ts). The in-app runner doesn't support
  // it — reaching this branch means a caller bypassed runChat with an
  // opencode ModelRef, which is a bug.
  throw new LLMError('unknown', 'OpenCode runs via the CLI subprocess path; the in-app runner does not support it. Use runChat() instead of createLLMService() for opencode models.')
```

- [ ] **Step 3: Run the test**

```bash
npm test -- electron/llm/index.test.ts
```

Expected: all pass.

- [ ] **Step 4: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add electron/llm/index.ts electron/llm/index.test.ts
git commit -m "chore(llm): clarify opencode error message — CLI path only, not in-app runner"
```

---

## Task 6: Settings UI — rename "Claude Desktop" category to "Claude Code & OpenCode"

**Files:**
- Modify: `src/views/Settings.tsx`

Rename the category. Restructure `renderClaudeDesktop` → `renderClaudeOpenCode` to have two parallel sub-sections (Claude Code + OpenCode), each with install / login / logout / test connection controls.

Per the existing memory note (`feedback_no_visual_testing`), UI verification is the user's job after this task ships — no dev-server screenshot validation in the plan.

- [ ] **Step 1: Update the CategoryId type**

In `src/views/Settings.tsx` (line 12):

```ts
// Replace:
type CategoryId = 'providers' | 'claude-desktop' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'

// With:
type CategoryId = 'providers' | 'claude-opencode' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

- [ ] **Step 2: Update the CATEGORIES array**

Find the `CATEGORIES` array (line 148). Change the `claude-desktop` entry:

```ts
// Replace:
{ id: 'claude-desktop', label: 'Claude Desktop', icon: <DesktopIcon /> },

// With:
{ id: 'claude-opencode', label: 'Claude Code & OpenCode', icon: <DesktopIcon /> },
```

- [ ] **Step 3: Add state for OpenCode**

Near the existing Claude Code state (search for `claudeCodeInstalled`, `claudeCodeLoggedIn`), add:

```ts
const [opencodeInstalled, setOpencodeInstalled] = useState<boolean | null>(null)
const [opencodeLoggedIn, setOpencodeLoggedIn] = useState<boolean | null>(null)
const [opencodeSetupPhase, setOpencodeSetupPhase] = useState<SetupPhase>('idle')
const [opencodeSetupLines, setOpencodeSetupLines] = useState<string[]>([])
const [opencodeLoginPhase, setOpencodeLoginPhase] = useState<LoginPhase>('idle')
const [opencodeLoginLines, setOpencodeLoginLines] = useState<string[]>([])
```

In the existing `useEffect` that loads Claude Code state (search for `window.api.skill.detectClaudeCode()`), add parallel calls:

```ts
window.api.opencode.detect().then(setOpencodeInstalled).catch(() => setOpencodeInstalled(false))
window.api.opencode.checkAuthStatus().then(setOpencodeLoggedIn).catch(() => setOpencodeLoggedIn(false))
```

- [ ] **Step 4: Rename `renderClaudeDesktop` → `renderClaudeOpenCode` and add the OpenCode section**

Find `renderClaudeDesktop` (lines 1364-1421). Rename it and add a second sub-section at the bottom for OpenCode. The Claude Code sub-section is the existing content, wrapped in a heading. The OpenCode sub-section mirrors it.

```tsx
const renderClaudeOpenCode = () => (
  <>
    {/* ── Claude Code section (existing UI, wrapped) ── */}
    <div className="settings-group">
      <div className="settings-group-title">Claude Code</div>
      <div className="settings-group-body">
        {/* ... existing renderClaudeDesktop body goes here unchanged ... */}
      </div>
    </div>

    {/* ── NEW: OpenCode section ── */}
    <div className="settings-group">
      <div className="settings-group-title">OpenCode</div>
      <div className="settings-group-body">
        <div className="settings-group-row">
          <div className="settings-group-row-main">
            <div className="settings-group-row-label">Install status</div>
            <div className="settings-group-row-sub">
              <span className="ai-msg-status-dot" style={{ background: opencodeInstalled ? 'var(--green)' : 'var(--text2)' }} />
              {opencodeInstalled === null ? 'Checking…' : opencodeInstalled ? 'Installed' : 'Not installed'}
            </div>
          </div>
          {!opencodeInstalled && (
            <button
              className="settings-btn"
              disabled={opencodeSetupPhase !== 'idle' && opencodeSetupPhase !== 'error'}
              onClick={async () => {
                setOpencodeSetupPhase('installing')
                setOpencodeSetupLines([])
                const cb = (payload: { phase: string; line?: string }) => {
                  if (payload.line) setOpencodeSetupLines(prev => [...prev, payload.line!])
                  if (payload.phase === 'done') setOpencodeSetupPhase('done')
                  if (payload.phase === 'error') setOpencodeSetupPhase('error')
                }
                window.api.opencode.onSetupProgress(cb)
                try {
                  await window.api.opencode.setup()
                  setOpencodeInstalled(true)
                } finally {
                  window.api.opencode.offSetupProgress(cb)
                }
              }}
            >
              {opencodeSetupPhase === 'installing' ? 'Installing…' : 'Install OpenCode'}
            </button>
          )}
        </div>

        <div className="settings-group-row">
          <div className="settings-group-row-main">
            <div className="settings-group-row-label">Authentication</div>
            <div className="settings-group-row-sub">
              <span className="ai-msg-status-dot" style={{ background: opencodeLoggedIn ? 'var(--green)' : 'var(--text2)' }} />
              {opencodeLoggedIn === null ? 'Checking…' : opencodeLoggedIn ? 'Logged in' : 'Not logged in'}
            </div>
          </div>
          {opencodeInstalled && !opencodeLoggedIn && (
            <button
              className="settings-btn"
              disabled={opencodeLoginPhase === 'logging-in'}
              onClick={async () => {
                setOpencodeLoginPhase('logging-in')
                setOpencodeLoginLines([])
                const cb = (payload: { message: string; isError?: boolean; done?: boolean }) => {
                  setOpencodeLoginLines(prev => [...prev, payload.message])
                  if (payload.done) setOpencodeLoginPhase(payload.isError ? 'error' : 'done')
                }
                window.api.opencode.onLoginProgress(cb)
                try {
                  const result = await window.api.opencode.loginOpenCode()
                  if (result.ok) setOpencodeLoggedIn(true)
                } finally {
                  window.api.opencode.offLoginProgress(cb)
                }
              }}
            >
              {opencodeLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login to OpenCode'}
            </button>
          )}
          {opencodeInstalled && opencodeLoggedIn && (
            <button
              className="settings-btn settings-btn--ghost"
              onClick={async () => {
                await window.api.opencode.logoutOpenCode()
                setOpencodeLoggedIn(false)
              }}
            >
              Logout
            </button>
          )}
        </div>

        {(opencodeSetupLines.length > 0 || opencodeLoginLines.length > 0) && (
          <div className="settings-group-row settings-group-row--full">
            <pre style={{ fontSize: 11, color: 'var(--text2)', maxHeight: 120, overflow: 'auto', margin: 0 }}>
              {[...opencodeSetupLines, ...opencodeLoginLines].join('\n')}
            </pre>
          </div>
        )}
      </div>
    </div>
  </>
)
```

(Adjust the exact JSX shape to match the existing renderClaudeDesktop body — the OpenCode section should mirror its visual style, not invent a new one. The snippet above is illustrative of the controls needed; copy-adapt rather than copy-verbatim.)

- [ ] **Step 5: Update the conditional render**

Find the dispatch (line 1705-1706):

```ts
// Replace:
{activeCategory === 'claude-desktop' && renderClaudeDesktop()}

// With:
{activeCategory === 'claude-opencode' && renderClaudeOpenCode()}
```

- [ ] **Step 6: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 7: Manual smoke test (hand off to user)**

Per the `feedback_no_visual_testing` memory, **stop here and ask the user to verify**:

> Phase 6 Task 6 ready for visual check. Open `npm run dev` → Settings. The left-sidebar category previously labeled "Claude Desktop" should now read "Claude Code & OpenCode". Click it. The right pane should show two sections: "Claude Code" (the existing controls) and "OpenCode" (new — install/login/logout buttons + status dots).

Wait for explicit user confirmation before committing.

- [ ] **Step 8: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(settings): rename 'Claude Desktop' → 'Claude Code & OpenCode' with parallel OpenCode setup section"
```

---

## Task 7: Settings UI — fifth provider card for OpenCode

**Files:**
- Modify: `src/views/Settings.tsx` (add OpenCode card after `<OpenAICompatibleSection>` in `renderProviders`)

Add a fifth card to the Providers section. OpenCode uses subscription auth so there's no API key input — the card shows install + login status with a link to the "Claude Code & OpenCode" category for setup.

- [ ] **Step 1: Add the OpenCode card JSX**

In `src/views/Settings.tsx`, find `renderProviders` (line 749) and the existing `<OpenAICompatibleSection .../>` invocation (around line 990). Add the OpenCode card just below it, still inside the same `<div className="settings-group-body">`:

```tsx
{/* OpenCode card */}
<div className="connector-row">
  <div className="connector-icon" style={{ fontSize: 18 }}>⌨</div>
  <div className="connector-info">
    <div className="connector-name" style={{ display: 'flex', alignItems: 'center' }}>
      OpenCode
      <InfoIcon title="Subscription-based CLI agent runner. Supports Claude, GPT, Gemini, and local models via a single OAuth login." />
    </div>
    <div className="connector-desc" style={{ marginTop: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span className="ai-msg-status-dot" style={{ background: opencodeInstalled ? 'var(--green)' : 'var(--text2)' }} />
        {opencodeInstalled === null ? 'Checking…' : opencodeInstalled ? 'Installed' : 'Not installed'}
      </span>
      <span style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span className="ai-msg-status-dot" style={{ background: opencodeLoggedIn ? 'var(--green)' : 'var(--text2)' }} />
        {opencodeLoggedIn === null ? '' : opencodeLoggedIn ? 'Logged in' : 'Not logged in'}
      </span>
    </div>
  </div>
  <div className="connector-actions">
    <button
      className="settings-btn"
      onClick={() => setActiveCategory('claude-opencode')}
    >
      {opencodeInstalled && opencodeLoggedIn ? 'Manage' : 'Set up'}
    </button>
  </div>
</div>
```

(Pick a better icon than `⌨` if there's a more fitting one in the codebase — search for existing connector icons. The `InfoIcon` component is defined elsewhere in the file (from Phase 4 Task 9). The `connector-row` / `connector-icon` / `connector-info` / `connector-desc` / `connector-actions` classes already exist and are used by the other four cards.)

- [ ] **Step 2: Verify the load effect**

The OpenCode install/login state used here (`opencodeInstalled`, `opencodeLoggedIn`) is loaded in the `useEffect` from Task 6 Step 3 — but that effect was probably scoped to when `activeCategory === 'claude-opencode'`. The Providers card needs the state too, so move the load to a category-agnostic effect, or trigger it when `activeCategory === 'providers'` as well.

Find the Phase 4 effect (line ~372) that loads provider configs when entering the Providers category. Add the opencode loads to that effect:

```ts
useEffect(() => {
  if (activeCategory !== 'providers') return
  // ... existing loads ...
  // Add:
  window.api.opencode.detect().then(setOpencodeInstalled).catch(() => setOpencodeInstalled(false))
  window.api.opencode.checkAuthStatus().then(setOpencodeLoggedIn).catch(() => setOpencodeLoggedIn(false))
}, [activeCategory])
```

(The Claude-Code-&-OpenCode category's effect from Task 6 stays — they're independent triggers.)

- [ ] **Step 3: Confirm typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

> Phase 6 Task 7 ready for visual check. In Settings → Providers, scroll down past the four existing cards (Anthropic, OpenAI, Google, Local/openai-compatible). You should see a fifth card for OpenCode with two status dots (install + login) and a "Set up" or "Manage" button that jumps to the Claude Code & OpenCode category.

Wait for user confirmation.

- [ ] **Step 5: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(settings): fifth provider card — OpenCode status + link to setup category"
```

---

## Task 8: Phase 6 close-out — verification + smoke checklist

**Files:** none (verification only)

- [ ] **Step 1: Full electron test sweep**

```bash
npm test -- electron/
```

Expected: all electron tests pass (the pre-existing failures in `anatomy-cli`, `ImportPluginDialog`, `ReadmeRenderer`, `Discover.test.tsx` are confirmed pre-existing and remain — do not investigate).

- [ ] **Step 2: Final typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 3: `grep "Phase 6" electron/`**

```bash
grep -rn "Phase 6" electron/
```

Expected: only doc references or test fixtures remain. No `throw new LLMError(..., 'scheduled for Phase 6')` stubs.

- [ ] **Step 4: User smoke-test handoff**

Hand off to the user with this checklist:

> **Phase 6 smoke test**:
> 1. Settings → Providers — confirm the new OpenCode card appears as the fifth row. "Not installed" + "Not logged in" by default.
> 2. Settings → Claude Code & OpenCode (renamed category) — confirm both sections render: Claude Code (existing controls) + OpenCode (new install/login/logout buttons).
> 3. Click "Install OpenCode" — should run `npm install -g opencode-ai` and stream progress. Card status flips to "Installed" on success.
> 4. Click "Login to OpenCode" — should open the OAuth flow in a browser. After completing login externally, the status dot turns green.
> 5. Create or edit an agent with `model: opencode/claude-sonnet-4-6` — confirm a file appears at `~/.opencode/agents/<agent-name>.md` (Windows: `%USERPROFILE%\.opencode\agents\`).
> 6. In the AI Chat overlay, set Settings → Providers → Defaults chat default to `opencode/claude-sonnet-4-6` (use the dropdown). Send a chat message — should spawn the OpenCode CLI (not Claude Code). Verify by killing all electron processes and seeing the response stream from the OpenCode subprocess.

- [ ] **Step 5: Final commit (if any cleanup needed)**

If anything was missed during the smoke test, fix inline and commit. Otherwise the close-out is done.

---

## Phase 6 done — verification checklist

After Task 8:

- [ ] `npm test -- electron/` passes (pre-existing renderer-side failures unchanged)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline 5cf625d..HEAD` shows ~8 new commits (1 plan + 7 tasks)
- [ ] Manual smoke test covers: OpenCode card appears, category rename, install flow, login flow, agent sync to `.opencode/agents/`, OpenCode CLI dispatch in chat
- [ ] Sanity check: `grep -rn "Phase 6" electron/` returns only doc/test references

**Phase 6 ships:** OpenCode joins Claude Code as a second subscription-style CLI provider. Users can install OpenCode through Settings, authenticate via OAuth, sync their agents to `.opencode/agents/`, and use OpenCode for any chat or agent invocation with a `model: opencode/*` ref.

## Out of scope (deferred)

- **OpenCode plugin discovery.** The existing `electron/ipc/agentHandlers.ts:61` references `.opencode/plugins/` as a discovery root; that integration stays out of Phase 6. A later phase can wire it.
- **OpenCode slash command surface.** Claude Code's sync writes both subagent files and slash command files. Phase 6 only writes the subagent surface for OpenCode. If OpenCode supports its own slash command convention, a later phase adds that branch.
- **Live-CLI integration tests.** Tests mock `child_process.spawn`. No CI-time installation or invocation of the real OpenCode CLI.
- **OpenCode model-list registry.** Settings → Providers → Defaults dropdown (Phase 4 Task 10) doesn't include OpenCode in its provider list because OpenCode supports many providers' models. A polish pass can add an OpenCode entry with a freeform model text input similar to openai-compatible.
- **Vision/image inputs through OpenCode.** Same spec-level scope decision as the other adapters.
