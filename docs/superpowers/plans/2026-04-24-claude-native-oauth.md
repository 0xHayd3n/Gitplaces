# Claude Native OAuth via Pseudo-TTY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-code-paste Claude login flow with `node-pty` so the Claude Code CLI's built-in loopback OAuth flow takes over. The user authenticates in their browser and the code is captured silently by the CLI's local HTTP server — no paste step, no terminal window.

**Architecture:** Spawn the CLI through a PTY so it detects a TTY and picks its loopback OAuth mode. Delete the `LoginHandle` / `submitCode` / `__NEED_CODE__` machinery end-to-end (backend + IPC + frontend UI). Keep `checkAuthStatus()` polling, the 3-minute backend timeout, the existing `onLoginProgress` event stream, and the already-logged-in short-circuit.

**Tech Stack:** Electron (main + preload + renderer), React, TypeScript, Vitest, `node-pty` (new), `@electron/rebuild` (existing).

**Spec:** [docs/superpowers/specs/2026-04-24-claude-native-oauth-design.md](../specs/2026-04-24-claude-native-oauth-design.md)

**Base commit:** `590f90e` (spec commit). All line numbers below refer to this HEAD.

---

## File Map

| File | Change | Why |
|------|--------|-----|
| `package.json` | +1 dep (`node-pty`), extend `@electron/rebuild -w` lists | Native module needs Electron ABI rebuild like `better-sqlite3` |
| `electron/skill-gen/login-helpers.ts` | **New** — `stripAnsi()` + `detectManualFallback()` | Pure helpers, extracted for testability |
| `electron/skill-gen/login-helpers.test.ts` | **New** — Vitest unit tests for the two helpers | Pin contract with CLI output format |
| `electron/skill-gen/legacy.ts` | Rewrite `loginClaude()` body; delete `LoginHandle` interface and `submitCode` closure | Swap `child_process.spawn` for `node-pty` |
| `electron/main.ts` | Simplify `skill:loginClaude` handler; delete `_loginSubmitCode` var and `skill:loginSubmitCode` handler; delete URL-regex / `shell.openExternal` block | CLI now opens browser itself; no paste IPC needed |
| `electron/preload.ts` | Delete `loginSubmitCode` from skill API surface | IPC channel no longer exists |
| `src/env.d.ts` | Delete `loginSubmitCode` from Window API type | Keeps type in sync with preload |
| `src/views/Settings.tsx` | Delete `loginNeedsCode` / `loginCode` / `loginCodeSubmitted` state, `__NEED_CODE__` branch, paste `<input>` + button | Dead UI |

**Convention:** this project puts test files adjacent to source (`electron/skill-gen/classifier.test.ts`, etc.) — NOT in `__tests__/` folders. Follow that.

**Commit structure:** 4 logical commits so no intermediate state is broken at build time:
1. Dep + rebuild hook (standalone; proves `node-pty` builds before anyone depends on it)
2. Helpers + unit tests (standalone addition, no consumers yet)
3. Backend swap (legacy.ts + main.ts together — atomic because the function signature changes)
4. Frontend cleanup (preload.ts + env.d.ts + Settings.tsx together — linked by the `loginSubmitCode` API removal)

Final task is manual verification (no commit).

---

### Task 1: Add `node-pty` dependency and rebuild script

**Files:**
- Modify: `package.json:11-14` (scripts), `package.json:16-43` (dependencies)

- [ ] **Step 1: Add `node-pty` to dependencies**

  Open `package.json`. In the `dependencies` object, add the entry alphabetically (between `msedge-tts` and `pdfjs-dist`):

  ```json
  "node-pty": "^1.0.0",
  ```

- [ ] **Step 2: Extend `@electron/rebuild` watchlists**

  Change line 13 from:
  ```json
  "posttest": "npx @electron/rebuild -f -w better-sqlite3",
  ```
  to:
  ```json
  "posttest": "npx @electron/rebuild -f -w better-sqlite3,node-pty",
  ```

  Change line 14 from:
  ```json
  "postinstall": "npx @electron/rebuild -f -w better-sqlite3,node-pty"
  ```
  (same `-w` value — both scripts must include `node-pty`).

- [ ] **Step 3: Install and verify the native rebuild**

  Run:
  ```bash
  npm install
  ```
  Expected: install completes, the `postinstall` hook runs `@electron/rebuild` and reports success for both `better-sqlite3` and `node-pty`. Check `node_modules/node-pty/build/` exists (proves native compile ran).

  If the rebuild fails, check you have Windows build tools installed (`npm install -g windows-build-tools` or Visual Studio Build Tools with the "Desktop development with C++" workload). Do NOT proceed if the rebuild fails — everything downstream depends on it.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json package-lock.json
  git commit -m "build(connectors): add node-pty dep and rebuild hook for Claude OAuth"
  ```

  Expected: commit succeeds. `git status` clean except for the unrelated pre-existing WIP on `src/components/LibrarySidebar.css`, `src/views/Discover.tsx`, `src/views/Library.tsx`, and the two untracked `2026-04-24-claude-auth-timeout-fix-*.md` docs — leave those alone.

---

### Task 2: Add pure helpers with unit tests (TDD)

**Files:**
- Create: `electron/skill-gen/login-helpers.ts`
- Create: `electron/skill-gen/login-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `electron/skill-gen/login-helpers.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { stripAnsi, detectManualFallback } from './login-helpers'

  describe('stripAnsi', () => {
    it('removes CSI color codes', () => {
      expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
    })
    it('removes CSI cursor/formatting sequences', () => {
      expect(stripAnsi('\x1b[1;31merror\x1b[0m message')).toBe('error message')
    })
    it('removes OSC sequences (e.g. terminal title)', () => {
      expect(stripAnsi('\x1b]0;title\x07plain')).toBe('plain')
    })
    it('passes plain text through unchanged', () => {
      expect(stripAnsi('plain text\n')).toBe('plain text\n')
    })
    it('handles empty string', () => {
      expect(stripAnsi('')).toBe('')
    })
  })

  describe('detectManualFallback', () => {
    it('flags platform.claude.com redirect URL (fallback signal)', () => {
      expect(detectManualFallback('Visit https://platform.claude.com/oauth/code/callback?code=…')).toBe(true)
    })
    it('does not flag loopback URL (happy path)', () => {
      expect(detectManualFallback('Opening browser at http://127.0.0.1:54823/callback')).toBe(false)
    })
    it('does not flag unrelated claude.com URLs', () => {
      expect(detectManualFallback('See https://claude.com/docs for help')).toBe(false)
    })
    it('returns false for empty input', () => {
      expect(detectManualFallback('')).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npx vitest run electron/skill-gen/login-helpers.test.ts
  ```
  Expected: FAIL with module-not-found or import error for `./login-helpers`.

- [ ] **Step 3: Implement the helpers**

  Create `electron/skill-gen/login-helpers.ts`:

  ```typescript
  // Pure helpers for the Claude login flow. Extracted from legacy.ts so they
  // can be unit-tested without the PTY / IPC surface.

  /**
   * Strip ANSI escape sequences from PTY output.
   * Covers CSI (color, cursor, formatting) and OSC (terminal title, hyperlinks).
   */
  export function stripAnsi(s: string): string {
    return s
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
  }

  /**
   * True if the CLI fell back to manual-paste mode. We detect this by the
   * fallback URL it prints and hard-fail rather than re-introducing a paste UI.
   */
  export function detectManualFallback(cleanOutput: string): boolean {
    return cleanOutput.includes('platform.claude.com/oauth/code/callback')
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  npx vitest run electron/skill-gen/login-helpers.test.ts
  ```
  Expected: all 9 tests PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

  ```bash
  npm test
  ```
  Expected: all existing tests pass. The `posttest` hook will rebuild `better-sqlite3` and `node-pty` — expect both rebuilds to succeed.

- [ ] **Step 6: Commit**

  ```bash
  git add electron/skill-gen/login-helpers.ts electron/skill-gen/login-helpers.test.ts
  git commit -m "feat(connectors): add stripAnsi + detectManualFallback helpers"
  ```

---

### Task 3: Rewrite `loginClaude()` to use `node-pty` (backend swap)

This task touches both `legacy.ts` and `main.ts` in one commit because `loginClaude`'s signature changes — any intermediate state would fail to compile.

**Files:**
- Modify: `electron/skill-gen/legacy.ts:508-640` (the entire `LoginHandle` interface and `loginClaude` function)
- Modify: `electron/main.ts:842-881` (the `_loginSubmitCode` variable, `skill:loginClaude` handler, `skill:loginSubmitCode` handler)

- [ ] **Step 1: Update the import and helper list at the top of `legacy.ts`**

  Open `electron/skill-gen/legacy.ts`. At line 2, current import is:
  ```typescript
  import { spawn, execFile } from 'child_process'
  ```

  Leave it — we still use `spawn` elsewhere in this file (e.g. `findNodeViaPowerShell`). We'll import `node-pty` dynamically inside `loginClaude` to match the spec's approach and avoid load-time cost when login isn't used.

  Add a new import line (line 5, after the `path` import):
  ```typescript
  import { stripAnsi, detectManualFallback } from './login-helpers'
  ```

- [ ] **Step 2: Delete the `LoginHandle` interface**

  Lines 510-515 currently read:
  ```typescript
  export interface LoginHandle {
    /** Write the browser-provided auth code to the CLI's stdin and complete login. */
    submitCode: (code: string) => void
    /** Resolves when login succeeds; rejects on error. */
    done: Promise<void>
  }
  ```
  Delete those 6 lines entirely. Also delete the blank line 516 after them to keep spacing tidy.

- [ ] **Step 3: Replace the `loginClaude` function body**

  Replace lines 517-640 (the JSDoc comment + the entire `loginClaude` function) with the new implementation:

  ```typescript
  /**
   * Start the Claude Code `auth login` flow.
   *
   * Spawns the CLI through a pseudo-TTY (node-pty) so the CLI detects a TTY
   * and picks its built-in loopback OAuth mode: it spins up a local HTTP
   * server at http://127.0.0.1:<port>/callback, opens the user's browser,
   * captures the callback, exchanges the code for tokens, and writes
   * credentials to disk. We poll `auth status --json` to detect completion.
   *
   * No manual code paste is ever required. If the CLI falls back to manual
   * mode (rare — only if it can't bind a loopback port), we hard-fail with
   * a clear error rather than re-introducing a paste UI.
   */
  export async function loginClaude(onProgress: (msg: string) => void): Promise<void> {
    const nodePath = await findNode()
    if (!nodePath) throw new Error('Node.js not found. Please install Node.js first.')

    const cliPath = findLocalCli()
    if (!cliPath) throw new Error('Claude Code CLI not found in node_modules.')

    // If already logged in, short-circuit
    const alreadyLoggedIn = await checkAuthStatus().catch(() => false)
    if (alreadyLoggedIn) {
      onProgress('Already logged in!')
      return
    }

    console.log(`[skill-gen] loginClaude: node=${nodePath} cli=${cliPath}`)
    onProgress('Opening browser for Claude login…')

    let pty: typeof import('node-pty')
    try {
      pty = await import('node-pty')
    } catch (err) {
      console.error('[skill-gen] Failed to load node-pty:', err)
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
        console.warn('[skill-gen] CLI fell back to manual-paste mode — aborting')
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
      console.log('[skill-gen] Starting auth status polling…')
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
      console.log(`[skill-gen] Login process exited with code ${exitCode}`)
      clearTimeout(timeoutId)
      if (settled) return

      // CLI may exit before credentials flush to disk — retry with delays.
      for (const delay of [500, 1500, 3000]) {
        await new Promise(r => setTimeout(r, delay))
        const ok = await checkAuthStatus().catch(() => false)
        console.log(`[skill-gen] Post-exit auth check (after ${delay}ms): ${ok}`)
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

  **Note:** `node-pty`'s `onExit` provides `{ exitCode, signal }`; the old `proc.on('close', code => ...)` became `proc.onExit(({ exitCode }) => ...)`. There's no equivalent `'error'` event on `node-pty` — if the spawn itself fails, `pty.spawn` throws synchronously, so wrap only the `pty.spawn(...)` call in a try/catch if needed. In practice, the dynamic import try/catch above covers the realistic failure modes (native module not loaded); runtime spawn errors after successful module load are rare.

- [ ] **Step 4: Verify the file compiles standalone**

  Check no occurrences of `LoginHandle`, `submitCode`, or `__NEED_CODE__` remain in `legacy.ts`:
  ```bash
  grep -nE "LoginHandle|submitCode|__NEED_CODE__" electron/skill-gen/legacy.ts
  ```
  Expected: no output.

- [ ] **Step 5: Simplify `electron/main.ts`**

  Open `electron/main.ts`. Lines 842-881 currently contain:

  ```typescript
  // Holds the stdin write fn for the in-progress login process
  let _loginSubmitCode: ((code: string) => void) | null = null

  ipcMain.handle('skill:loginClaude', async (event) => {
    try {
      const handle = await loginClaude((message) => {
        event.sender.send('skill:login-progress', { message })
        // CLI prints "If the browser didn't open, visit: <url>" — open it for them
        const urlMatch = message.match(/https:\/\/\S+/)
        if (urlMatch) {
          shell.openExternal(urlMatch[0]).catch((e) =>
            console.error('[skill-gen] Failed to open auth URL:', e)
          )
          // Tell the renderer a code will be needed
          event.sender.send('skill:login-progress', { message: '__NEED_CODE__' })
        }
      })

      _loginSubmitCode = handle.submitCode

      await handle.done
      _loginSubmitCode = null
      event.sender.send('skill:login-progress', { message: 'Logged in successfully!', done: true })
      return { success: true }
    } catch (err) {
      _loginSubmitCode = null
      const msg = err instanceof Error ? err.message : String(err)
      event.sender.send('skill:login-progress', { message: msg, isError: true })
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('skill:loginSubmitCode', (_, code: string) => {
    if (_loginSubmitCode) {
      _loginSubmitCode(code)
      _loginSubmitCode = null
      return { ok: true }
    }
    return { ok: false }
  })
  ```

  Replace that entire block (lines 842-881) with:

  ```typescript
  ipcMain.handle('skill:loginClaude', async (event) => {
    try {
      await loginClaude((message) => {
        event.sender.send('skill:login-progress', { message })
      })
      event.sender.send('skill:login-progress', { message: 'Logged in successfully!', done: true })
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      event.sender.send('skill:login-progress', { message: msg, isError: true })
      return { success: false, error: msg }
    }
  })
  ```

  Gone:
  - The `_loginSubmitCode` module-level variable
  - The URL-regex + `shell.openExternal` block (the PTY-mode CLI opens its own browser)
  - The `__NEED_CODE__` re-emission (the paste flow no longer exists)
  - The `skill:loginSubmitCode` handler (no IPC consumer after Task 4)

- [ ] **Step 6: Check if `shell` is still imported**

  The `shell.openExternal` call was the only use of `shell` in this area. Check whether `shell` is used elsewhere in `main.ts`:
  ```bash
  grep -n "shell\." electron/main.ts
  ```
  If only that one use was present and it's now deleted, also remove `shell` from the top-of-file `electron` import. If `shell` is used elsewhere, leave the import alone.

- [ ] **Step 7: Run TypeScript check (full project)**

  ```bash
  npx tsc --noEmit
  ```
  Expected: passes. At this point `preload.ts` still exposes `loginSubmitCode` and `env.d.ts` still declares it — those dangling references to a now-removed IPC handler are the subject of Task 4. TS alone won't catch those (they just invoke a non-existent channel at runtime).

- [ ] **Step 8: Commit**

  ```bash
  git add electron/skill-gen/legacy.ts electron/main.ts
  git commit -m "feat(connectors): swap Claude login to PTY-driven loopback OAuth"
  ```

---

### Task 4: Remove dead IPC surface and paste UI (frontend cleanup)

**Files:**
- Modify: `electron/preload.ts:85` (delete `loginSubmitCode` binding)
- Modify: `src/env.d.ts:122` (delete `loginSubmitCode` type)
- Modify: `src/views/Settings.tsx:103-105` (state), `:266` (onProgress branch), `:271-272` (done resets), `:562-587` (paste UI JSX)

- [ ] **Step 1: Remove from `electron/preload.ts`**

  Line 85 currently reads:
  ```typescript
      loginSubmitCode: (code: string) => ipcRenderer.invoke('skill:loginSubmitCode', code) as Promise<{ ok: boolean }>,
  ```
  Delete that entire line.

- [ ] **Step 2: Remove from `src/env.d.ts`**

  Line 122 currently reads:
  ```typescript
          loginSubmitCode(code: string): Promise<{ ok: boolean }>
  ```
  Delete that entire line.

- [ ] **Step 3: Remove state declarations in `src/views/Settings.tsx`**

  Lines 103-105 currently read:
  ```typescript
    const [loginNeedsCode, setLoginNeedsCode] = useState(false)
    const [loginCode, setLoginCode] = useState('')
    const [loginCodeSubmitted, setLoginCodeSubmitted] = useState(false)
  ```
  Delete all three lines.

- [ ] **Step 4: Remove `__NEED_CODE__` branch in `onProgress`**

  Line 266 currently reads:
  ```typescript
        if (message === '__NEED_CODE__') { setLoginNeedsCode(true); return }
  ```
  Delete that line.

- [ ] **Step 5: Remove `setLoginNeedsCode(false)` and `setLoginCodeSubmitted(false)` from the `done` branch**

  Current block (around lines 269-274):
  ```typescript
        if (done) {
          setLoginNeedsCode(false)
          setLoginCodeSubmitted(false)
          setLoginPhase('done')
          window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
        }
  ```
  Delete the two `set*` lines so it becomes:
  ```typescript
        if (done) {
          setLoginPhase('done')
          window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
        }
  ```

- [ ] **Step 6: Remove the paste UI JSX**

  Lines 562-587 currently contain a ternary:
  ```jsx
                  {loginNeedsCode ? (
                    <div style={{ marginTop: 8 }}>
                      <p className="settings-hint" style={{ marginBottom: 6 }}>Paste the code shown in your browser:</p>
                      <div className="settings-inline-row">
                        <input
                          className="settings-input" type="text" value={loginCode} autoFocus
                          onChange={e => setLoginCode(e.target.value)}
                          placeholder="Paste authentication code…"
                          onKeyDown={async e => {
                            if (e.key === 'Enter' && loginCode.trim()) {
                              const { ok } = await window.api.skill.loginSubmitCode(loginCode.trim())
                              setLoginCode(''); setLoginNeedsCode(false)
                              if (!ok) { setLoginLines(p => [...p, 'Session expired — please try again.']); setLoginPhase('error') }
                              else setLoginCodeSubmitted(true)
                            }
                          }}
                        />
                        <button className="settings-btn" disabled={!loginCode.trim()} onClick={async () => {
                          const { ok } = await window.api.skill.loginSubmitCode(loginCode.trim())
                          setLoginCode(''); setLoginNeedsCode(false)
                          if (!ok) { setLoginLines(p => [...p, 'Session expired — please try again.']); setLoginPhase('error') }
                          else setLoginCodeSubmitted(true)
                        }}>Submit</button>
                      </div>
                    </div>
                  ) : <div className="settings-setup-line muted">{loginCodeSubmitted ? 'Verifying…' : 'Waiting for browser login…'}</div>}
  ```

  Replace the entire ternary (lines 562-587) with just the simple status line:
  ```jsx
                  <div className="settings-setup-line muted">Waiting for browser login…</div>
  ```

- [ ] **Step 7: Verify no stale references remain**

  ```bash
  grep -nE "loginNeedsCode|loginCodeSubmitted|loginSubmitCode|__NEED_CODE__|loginCode[^A-Za-z]" src/views/Settings.tsx electron/preload.ts src/env.d.ts
  ```
  Expected: no output. (The `loginCode[^A-Za-z]` pattern is there to avoid matching `loginCodeSubmitted`-style identifiers; with all three gone it should be clean.)

- [ ] **Step 8: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: passes.

- [ ] **Step 9: Run full test suite**

  ```bash
  npm test
  ```
  Expected: all tests pass. The rebuild hook in `posttest` will bring `better-sqlite3` and `node-pty` back to Electron ABI (safe — just covers the case where `vitest` ran them against Node ABI).

- [ ] **Step 10: Commit**

  ```bash
  git add electron/preload.ts src/env.d.ts src/views/Settings.tsx
  git commit -m "refactor(connectors): drop dead paste-UI and loginSubmitCode IPC"
  ```

---

### Task 5: Manual verification

No commit for this task — it's a sanity pass against the real flow.

**Files:** none modified; you are running the dev build and walking through the happy path described in the spec.

- [ ] **Step 1: Start the dev build**

  ```bash
  npm run dev
  ```
  Expected: Electron window opens, no startup errors in terminal or devtools console.

- [ ] **Step 2: Verify "already logged in" short-circuit**

  If you are currently logged in to Claude, go to Settings → Connectors → click **Connect Claude** on the Claude row. Expect immediate `"Already logged in!"` in the log area, no browser opens, phase → `done`, connector shows **Connected**.

  If you are not currently logged in, skip this step.

- [ ] **Step 3: Walk through the happy path**

  If you have a session: log out first via the Disconnect button to force a fresh flow. Then click **Connect Claude**.

  Expected sequence:
  1. Log area shows `"Opening browser for Claude login…"`
  2. Shortly after: CLI's own output appears — an `Opening browser to sign in…` line and a line containing a `http://127.0.0.1:<port>/callback`-style redirect or the authorize URL
  3. Your default browser opens to `claude.ai/oauth/authorize?...`
  4. Sign in normally
  5. Browser briefly redirects to a localhost URL then shows a "you can close this tab" page (or similar — CLI-controlled)
  6. In the Electron app: log area shows `"Login successful."` followed by `"Logged in successfully!"`, phase → `done`, connector shows **Connected**
  7. **No paste input appears at any point**

- [ ] **Step 4: Verify `__NEED_CODE__` path truly dead**

  In the devtools console for the renderer, confirm no `loginNeedsCode`-related state exists. The React DevTools component inspector on the Settings page should show no such state variable. (Optional sanity — TypeScript deletion already proves this.)

- [ ] **Step 5: Spot-check disconnect flow**

  Click Disconnect on the Claude connector. Expect connector shows disconnected status. No regressions — we didn't touch `logoutClaude`.

- [ ] **Step 6: Fresh-install sanity (optional, recommended)**

  If you haven't done it in Task 1: delete `node_modules` entirely and re-run `npm install`. Then start dev and click Connect Claude. Expect `node-pty` loads without `MODULE_NOT_FOUND` errors — proves the `postinstall` rebuild catches `node-pty`.

- [ ] **Step 7: Report**

  If all manual checks pass, the plan is complete. If any step shows unexpected behavior (especially: paste UI appearing, browser not opening, or login hanging past 30 seconds), capture the log output and devtools console and flag it — do not patch blindly.

---

## Notes for the Executor

**Working on main.** User works directly on main (per their `CLAUDE.md`). Do not create branches, worktrees, or PRs. Each of the 3 commits lands directly on main in order.

**Do not touch unrelated WIP.** At Task 1 start, `git status` shows modified `src/components/LibrarySidebar.css`, `src/views/Discover.tsx`, `src/views/Library.tsx`, plus untracked `docs/superpowers/plans/2026-04-24-claude-auth-timeout-fix.md` and `docs/superpowers/specs/2026-04-24-claude-auth-timeout-fix-design.md`. Leave all of those untouched — they are pre-existing and belong to other work streams.

**If `node-pty` fails to build** on the user's machine (Task 1 Step 3), STOP and surface the error. Don't try to work around it — a failed native rebuild means the rest of the plan won't run.

**Do not reintroduce manual-paste fallback.** If the CLI falls back to manual mode at runtime, the design explicitly says we hard-fail with `"Couldn't start local auth server. Please try again."`. This is a deliberate choice in the spec — don't add a paste UI back "as a safety net".

**Key file line references** (as of base commit `590f90e`):
- `electron/skill-gen/legacy.ts:510-515` — `LoginHandle` interface (delete)
- `electron/skill-gen/legacy.ts:526-640` — `loginClaude` function (replace body)
- `electron/main.ts:842-881` — `_loginSubmitCode` var + both login handlers (replace)
- `electron/preload.ts:85` — `loginSubmitCode` binding (delete)
- `src/env.d.ts:122` — `loginSubmitCode` type (delete)
- `src/views/Settings.tsx:103-105` — three state lines (delete)
- `src/views/Settings.tsx:266` — `__NEED_CODE__` branch (delete)
- `src/views/Settings.tsx:269-274` — `done` branch (trim 2 lines)
- `src/views/Settings.tsx:562-587` — paste UI ternary (replace with status line)
