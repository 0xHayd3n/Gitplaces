# Claude Native OAuth via Pseudo-TTY

**Date:** 2026-04-24
**Status:** Approved

## Problem

The current Claude connector login flow requires the user to manually copy an OAuth code from their browser and paste it into our Electron UI. The user has asked to rip this out. We want **no terminal popup AND no manual paste** — the browser should open, the user authenticates, and auth completes invisibly.

The current approach spawns the Claude Code CLI with `stdio: ['pipe', 'pipe', 'pipe']`, intercepts its code-prompt via a `__NEED_CODE__` heuristic, surfaces a paste input in our Settings page, and writes the pasted code back to the CLI's stdin. Recent commits fixed timeout races around this flow, but the fundamental paste step remains.

## Key Finding from CLI Source

The `@anthropic-ai/claude-code` CLI already has a **built-in loopback OAuth flow with PKCE** (`cli.js` — references to `http://localhost:${PORT}/callback`, `code_verifier`, `code_challenge`, and a local HTTP server). It uses this flow when it detects a TTY, and falls back to the manual-paste flow (`https://platform.claude.com/oauth/code/callback`) when run under non-TTY stdio — which is exactly what our Electron spawn looks like to it.

There is no CLI flag or env var to force loopback mode; the decision is internal and TTY-gated.

## Design

Spawn the CLI through a pseudo-TTY (`node-pty`) instead of `child_process.spawn`. The CLI sees a TTY, automatically picks loopback OAuth, spins up its own local HTTP server, opens the browser, captures the OAuth callback, exchanges the code for tokens, writes credentials, and exits. We pipe its output to our existing log UI for transparency, and poll `auth status --json` as today to detect completion.

**What this eliminates:**
- `LoginHandle.submitCode` method, its callers, and the IPC handler `skill:submitLoginCode` (if present).
- `__NEED_CODE__` sentinel detection, `loginNeedsCode` / `loginCodeSubmitted` state, and the code-paste `<input>` in Settings.
- Any dependency on our UI being able to handle a paste step.

**What this reuses unchanged:**
- `checkAuthStatus()` — still reads `auth status --json`.
- `onLoginProgress` event stream — we pipe PTY stdout line-by-line through it exactly as today.
- The 3-minute backend timeout, polling heartbeat, `settle()` double-resolve guard, post-exit credential-check retries, and unmount cleanup.
- The "already logged in" short-circuit at the top of `loginClaude()`.

## Architecture

```
Settings.tsx (Connect Claude click)
  ↓ window.api.skill.loginClaude()
electron/main.ts  (skill:loginClaude handler)
  ↓ loginClaude(onProgress)
electron/skill-gen/legacy.ts
  ↓ pty.spawn(node, [cli.js, 'auth', 'login', '--claudeai'], {cols, rows, ...})
Claude CLI (in PTY)
  ↓ detects TTY → picks loopback → binds local port
  ↓ opens browser to https://claude.ai/oauth/authorize?redirect_uri=http://127.0.0.1:<port>/callback&...
User authenticates → Claude redirects to loopback → CLI exchanges code → writes credentials → exits 0
  ↑ PTY output (ANSI-stripped) streams via onProgress
  ↑ pollTimer ticks checkAuthStatus() every 2s
Main process resolves → frontend: setLoginPhase('done'), re-check auth
```

## Components

### `electron/skill-gen/legacy.ts::loginClaude`

Signature simplifies to:
```typescript
export async function loginClaude(onProgress: (msg: string) => void): Promise<void>
```

No more `LoginHandle` return type, no `submitCode`. Implementation sketch:

```typescript
export async function loginClaude(onProgress: (msg: string) => void): Promise<void> {
  const nodePath = await findNode()
  if (!nodePath) throw new Error('Node.js not found. Please install Node.js first.')
  const cliPath = findLocalCli()
  if (!cliPath) throw new Error('Claude Code CLI not found in node_modules.')

  if (await checkAuthStatus().catch(() => false)) {
    onProgress('Already logged in!')
    return
  }

  onProgress('Opening browser for Claude login…')

  let pty: typeof import('node-pty')
  try {
    pty = await import('node-pty')
  } catch (err) {
    throw new Error('Authentication helper unavailable. Please reinstall the app.')
  }

  // node-pty's env type rejects undefined values; filter them out.
  const env = Object.fromEntries(
    Object.entries(buildEnv(true)).filter(([, v]) => v !== undefined)
  ) as { [key: string]: string }

  const proc = pty.spawn(nodePath, [cliPath, 'auth', 'login', '--claudeai'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    env,
  })

  let settled = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let resolveLogin!: () => void
  let rejectLogin!: (e: Error) => void
  const done = new Promise<void>((res, rej) => { resolveLogin = res; rejectLogin = rej })

  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    if (pollTimer) clearInterval(pollTimer)
    try { proc.kill() } catch { /* already dead */ }
    fn()
  }

  proc.onData((data: string) => {
    const clean = stripAnsi(data)
    if (detectManualFallback(clean)) {
      settle(() => rejectLogin(new Error("Couldn't start local auth server. Please try again.")))
      return
    }
    clean.split(/\r?\n/).filter(Boolean).forEach((line) => {
      console.log(`[skill-gen] login output: ${line}`)
      onProgress(line)
    })
  })

  const startPolling = () => {
    if (pollTimer) return
    let ticks = 0
    pollTimer = setInterval(async () => {
      ticks++
      if (ticks % 10 === 0 && !settled) onProgress('Still verifying authentication…')
      const ok = await checkAuthStatus().catch(() => false)
      if (ok) settle(resolveLogin)
    }, 2000)
  }
  startPolling()

  const timeoutId = setTimeout(() => {
    settle(() => rejectLogin(new Error('Login timed out. Please try again.')))
  }, 3 * 60 * 1000)

  proc.onExit(async ({ exitCode }) => {
    clearTimeout(timeoutId)
    if (settled) return
    for (const delay of [500, 1500, 3000]) {
      await new Promise(r => setTimeout(r, delay))
      const ok = await checkAuthStatus().catch(() => false)
      if (ok) { settle(resolveLogin); return }
    }
    if (exitCode === 0) {
      settle(() => rejectLogin(new Error(
        'Login process completed but auth could not be confirmed. ' +
        'This may mean login succeeded — please close and re-open Settings to check.'
      )))
    } else {
      settle(() => rejectLogin(new Error(`Login failed (exit code ${exitCode}). Please try again.`)))
    }
  })

  await done
}
```

**Pure helpers (extracted for testability):**

```typescript
// Strip ANSI color / cursor escapes from PTY output
export function stripAnsi(s: string): string {
  // covers CSI, OSC, and simple escape sequences
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
          .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
}

// True if CLI fell back to manual-paste mode (loopback failed)
export function detectManualFallback(cleanOutput: string): boolean {
  return cleanOutput.includes('platform.claude.com/oauth/code/callback')
}
```

### `electron/main.ts` — `skill:loginClaude` handler

Simplifies. Current handler grabs a `LoginHandle` and waits on `handle.done`. New version just `await`s `loginClaude(onProgress)`. Delete the `skill:submitLoginCode` IPC handler if present.

### `electron/preload.ts`

Remove `submitLoginCode` from the `skill` API surface if it exists. Keep `onLoginProgress` / `offLoginProgress` / `loginClaude` / `checkAuthStatus`.

### `src/views/Settings.tsx::handleLogin`

- Delete state: `loginNeedsCode`, `loginCodeSubmitted`, and any `loginCode` input-bound state.
- Delete JSX: the code-paste `<input>` and its submit button in the Claude connector card.
- Delete from the `onProgress` handler: `if (message === '__NEED_CODE__')` branch and the `setLoginNeedsCode(false)` / `setLoginCodeSubmitted(false)` resets on `done`.
- The resulting `handleLogin()` is ~15 lines shorter — just "start listener, call `loginClaude()`, handle done/error/unmount."

### `package.json`

Add `"node-pty": "^1.0.0"` to `dependencies`. Extend existing `@electron/rebuild` watchlist:

```json
"posttest":    "npx @electron/rebuild -f -w better-sqlite3,node-pty",
"postinstall": "npx @electron/rebuild -f -w better-sqlite3,node-pty"
```

No other build config changes — the existing electron-vite pipeline handles native modules via the same mechanism as `better-sqlite3`.

## Data Flow

**Happy path:**

1. User clicks **Connect Claude** → `handleLogin()` → `setLoginPhase('logging-in')` → register `onLoginProgress` listener → IPC `window.api.skill.loginClaude()`.
2. Main-process handler calls `loginClaude(onProgress)`.
3. `loginClaude()` short-circuits if already authed; otherwise emits `"Opening browser for Claude login…"` and `pty.spawn`s the CLI.
4. CLI detects TTY → binds random loopback port → generates PKCE pair → constructs authorize URL.
5. CLI emits `"Opening browser to sign in…"` + the authorize URL to stdout → PTY surfaces it → we strip ANSI and forward each non-empty line via `onProgress` → frontend appends to `loginLines`.
6. CLI opens default browser to `https://claude.ai/oauth/authorize?client_id=…&redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=…&state=…`.
7. User authenticates on claude.ai.
8. Claude redirects to the loopback URL → CLI's local server captures `code` + `state` → CLI POSTs to `/v1/oauth/token` → receives access + refresh tokens → writes credentials to `~/.claude/…` → prints `"Login successful."` → exits 0.
9. Two racing resolution paths (same as today):
   - `pollTimer` ticks every 2s → eventually `checkAuthStatus()` returns `true` → `settle(resolveLogin)`.
   - `proc.onExit` fires on clean exit → post-exit `checkAuthStatus()` retries at `[500, 1500, 3000]ms` → `settle(resolveLogin)`.
   - Whichever fires first wins; `settled` guard prevents double-resolve.
10. Main handler sends `{ done: true }` via `onLoginProgress` → frontend: `setLoginPhase('done')` + re-check auth → UI shows **Connected**.

## Error Handling

| Failure | Detection | Resolution |
|---|---|---|
| `node-pty` native binding fails to load | `try { await import('node-pty') } catch` | Reject with `"Authentication helper unavailable. Please reinstall the app."` |
| Node or CLI path not found | Existing checks | Existing error throws — unchanged |
| Loopback port bind fails → CLI falls back to manual | `detectManualFallback(cleanOutput)` | Kill PTY, reject with `"Couldn't start local auth server. Please try again."` |
| User closes browser without authing | Backend 3-minute timeout | Kill PTY, reject with `"Login timed out. Please try again."` |
| OAuth server rejects / network failure | CLI prints error + exits non-zero | `proc.onExit` with `exitCode !== 0` → post-exit retries fail → reject with `"Login failed (exit code N)…"` |
| CLI exits 0 but auth didn't confirm | Post-exit retries at `[500, 1500, 3000]ms` all return `false` | Reject with existing `"Login process completed but auth could not be confirmed…"` message |
| User clicks Connect twice | Existing `loginPhase === 'logging-in'` button disable | No change |
| Already logged in | `checkAuthStatus()` short-circuit at top of `loginClaude()` | Emit `"Already logged in!"` and resolve immediately |
| Component unmounts mid-login | `timers.current` cleanup + `offLoginProgress` | `settle()` kills PTY, listener unregistered |
| PTY process stuck | 3-minute timeout | Kill + reject |

**Design choice:** we deliberately do not re-introduce a manual-paste fallback UI when loopback fails. Loopback failure is rare (random high-numbered port collision) and "please try again" is sufficient. Keeping the paste code path alive would defeat the simplification.

## Testing

**Automated:**

One unit test suite covering the two pure helpers, pinning down contracts with the CLI's output:

```typescript
// electron/skill-gen/__tests__/login-helpers.test.ts
describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
  })
  it('passes plain text through', () => {
    expect(stripAnsi('plain text\n')).toBe('plain text\n')
  })
})

describe('detectManualFallback', () => {
  it('flags platform.claude.com redirect URL', () => {
    expect(detectManualFallback('Go to https://platform.claude.com/oauth/code/callback?…')).toBe(true)
  })
  it('does not flag loopback URL', () => {
    expect(detectManualFallback('Opening browser at http://127.0.0.1:54823/callback')).toBe(false)
  })
})
```

**Manual test checklist** (run `npm run dev`):

1. **Happy path** — Settings → Connectors → Connect Claude. Browser auto-opens, authenticate, redirect happens silently, return to app. Expect log shows "Opening browser…" → "Login successful." → phase `done`, connector shows **Connected**. **No paste UI appears at any point.**
2. **Already logged in** — With an existing session, click Connect. Expect immediate "Already logged in!" + done, no browser opens.
3. **User abandons in browser** — Click Connect, browser opens, close tab without signing in. Backend 3-min timeout fires cleanly with "Login timed out." (no need to wait full 3 min in dev — just verify no JS crashes / hung state).
4. **Connector logout** — Once connected, Disconnect. Confirm existing `logoutClaude` path still works (unchanged).
5. **Fresh install sanity** — Delete `node_modules`, run `npm install`, start dev. Confirm PTY loads without "module not found" on first login click — proves the `postinstall` rebuild caught node-pty.
6. **Test suite** — `npm test` passes. The rebuild+posttest flip covers both `better-sqlite3` and `node-pty`.

**Regressions to watch:** `handleLogin()` `loginPhase` state transitions, `onLoginProgress` unsubscribe in `finally`, `timers.current` cleanup on unmount. These all exist today — easy to accidentally break when deleting adjacent code.

## Files Changed

| File | Change | LOC |
|------|--------|-----|
| `electron/skill-gen/legacy.ts` | Swap `child_process.spawn` for `node-pty` in `loginClaude()`, drop `LoginHandle`/`submitCode`, add `stripAnsi` + `detectManualFallback` helpers, detect manual fallback | ~-30 net |
| `electron/main.ts` | `skill:loginClaude` handler awaits `loginClaude()` directly; remove `skill:submitLoginCode` handler if present | ~-20 |
| `electron/preload.ts` | Remove `submitLoginCode` from skill API if present | ~-3 |
| `src/views/Settings.tsx` | Remove `loginNeedsCode` / `loginCodeSubmitted` state, `__NEED_CODE__` branch, code-paste `<input>` + submit button | ~-30 |
| `package.json` | Add `node-pty` to deps, extend rebuild watchlist | +1 dep, 2 script edits |
| `electron/skill-gen/__tests__/login-helpers.test.ts` | New — unit tests for `stripAnsi` and `detectManualFallback` | +20 |

**Total:** net LOC reduction of ~60, plus 1 new dep and ~20 LOC of new tests. No new IPC channels, no new React state shape. All architectural simplification.
