# Claude Auth Timeout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 60-second frontend timeout that races the OAuth flow and add backend progress messages so users know verification is still running.

**Architecture:** Two files, no new state. Remove the redundant `loginTimeout` in `handleLogin()` and let the backend's existing 3-minute timeout be the sole deadline. Add one `onProgress` call in `submitCode` and a heartbeat every 20 seconds during polling.

**Tech Stack:** React (Settings.tsx), Node/Electron main process (legacy.ts)

---

## File Map

| File | Change |
|------|--------|
| `src/views/Settings.tsx` | Remove `loginTimeout` declaration, `timers.current.push`, and both `clearTimeout` calls |
| `electron/skill-gen/legacy.ts` | Add `onProgress` call in `submitCode`; add tick counter + heartbeat in `startPolling` |

No new files. No new state. No test files exist for this flow (it is IPC-heavy and integration-tested manually).

---

### Task 1: Remove the 60-second frontend timeout

**Files:**
- Modify: `src/views/Settings.tsx:259–294`

- [ ] **Step 1: Remove the `loginTimeout` declaration and push**

  In `handleLogin()`, delete these four lines (currently 265–269):

  ```typescript
  // DELETE these lines:
  const loginTimeout = setTimeout(() => {
    setLoginPhase('error')
    setLoginLines(prev => [...prev, 'Login timed out — please try again.'])
  }, 60_000)
  timers.current.push(loginTimeout)
  ```

- [ ] **Step 2: Remove `clearTimeout(loginTimeout)` from `onProgress`**

  Line 272 currently reads:
  ```typescript
  if (done || isError) clearTimeout(loginTimeout)
  ```
  Delete that entire line. The `if (done || isError)` guard logic is no longer needed.

- [ ] **Step 3: Remove `clearTimeout(loginTimeout)` from the `finally` block**

  Line 291 currently reads:
  ```typescript
  clearTimeout(loginTimeout)
  ```
  Delete that line. The `finally` block should now only contain:
  ```typescript
  window.api.skill.offLoginProgress(onProgress)
  ```

- [ ] **Step 4: Verify the result**

  `handleLogin()` should now look exactly like this (no `loginTimeout` anywhere):

  ```typescript
  const handleLogin = useCallback(async () => {
    setLoginPhase('logging-in')
    setLoginLines([])

    let hadError = false

    const onProgress = ({ message, isError, done }: { message: string; isError?: boolean; done?: boolean }) => {
      if (message === '__NEED_CODE__') { setLoginNeedsCode(true); return }
      setLoginLines((prev) => [...prev, message])
      if (isError) { hadError = true; setLoginPhase('error') }
      if (done) {
        setLoginNeedsCode(false)
        setLoginCodeSubmitted(false)
        setLoginPhase('done')
        window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      }
    }

    window.api.skill.onLoginProgress(onProgress)
    try {
      await window.api.skill.loginClaude()
      if (!hadError) setLoginPhase('done')
    } catch {
      setLoginPhase('error')
    } finally {
      window.api.skill.offLoginProgress(onProgress)
    }
  }, [])
  ```

  Check: no occurrences of `loginTimeout` remain in the file.
  ```bash
  grep -n "loginTimeout" src/views/Settings.tsx
  # Expected: no output
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/views/Settings.tsx
  git commit -m "fix(connectors): remove 60s frontend timeout from Claude login flow"
  ```

---

### Task 2: Add progress feedback in `submitCode` and `startPolling`

**Files:**
- Modify: `electron/skill-gen/legacy.ts:571–633`

- [ ] **Step 1: Add `onProgress` call in `submitCode`**

  `submitCode` currently starts at line 621. Add one line immediately before `proc.stdin.write`:

  ```typescript
  const submitCode = (code: string) => {
    console.log(`[skill-gen] Submitting auth code (${code.length} chars)…`)
    if (proc.stdin.writable) {
      onProgress('Verifying code with Claude…')   // ← ADD THIS LINE
      proc.stdin.write(code.trim() + '\n', 'utf8')
      // Don't call stdin.end() immediately on Windows — the CLI may need the
      // pipe to stay open briefly while it processes the code. Instead, end it
      // after a short delay to ensure the data is flushed and read.
      setTimeout(() => {
        try { proc.stdin.end() } catch { /* already closed */ }
      }, 500)
    }
    startPolling() // start checking auth status every 2s
  }
  ```

- [ ] **Step 2: Add tick counter and heartbeat in `startPolling`**

  `startPolling` currently starts at line 571. Add a `ticks` counter and emit a heartbeat every 10 ticks (every 20 seconds):

  ```typescript
  const startPolling = () => {
    if (pollTimer) return // already polling
    console.log('[skill-gen] Starting auth status polling…')
    let ticks = 0                                          // ← ADD
    pollTimer = setInterval(async () => {
      ticks++                                              // ← ADD
      if (ticks % 10 === 0) onProgress('Still verifying authentication…')  // ← ADD
      console.log('[skill-gen] Polling auth status…')
      const ok = await checkAuthStatus().catch(() => false)
      console.log(`[skill-gen] Auth status poll result: ${ok}`)
      if (ok) {
        try { proc.kill() } catch { /* process may already be dead */ }
        settle(resolveLogin)
      }
    }, 2000)
  }
  ```

- [ ] **Step 3: Verify no existing behaviour changed**

  Check that `settle`, `resolveLogin`, `clearInterval(pollTimer)`, and `proc.kill()` paths are all unchanged. Do a quick read of the function to confirm the only new lines are the three additions above.

- [ ] **Step 4: Commit**

  ```bash
  git add electron/skill-gen/legacy.ts
  git commit -m "fix(connectors): add progress feedback during Claude auth code verification"
  ```

---

## Manual Testing Checklist

No automated tests cover this IPC flow. Test by running the app in dev mode:

```bash
npm run dev
```

1. **Happy path (normal speed):** Open Settings → Connectors → Connect Claude. Copy the URL, open browser, log in, copy the code, paste it back within ~30s. Confirm "Logged in successfully!" appears and Claude connector shows Connected.

2. **Happy path (slow):** Same as above but deliberately take 70+ seconds to paste the code. Confirm the UI does NOT show "Login timed out" and instead shows "Verifying code with Claude…" followed by "Logged in successfully!" or the backend's 3-minute error if you wait long enough.

3. **Heartbeat visible:** Paste the code but wait 25+ seconds without the CLI responding. Confirm "Still verifying authentication…" appears in the log area.

4. **Backend timeout path:** Start login, do not paste any code, and wait 3 minutes. Confirm the UI eventually shows the backend's error: "Login timed out. Please try again." (note the period — this is the backend message, not the old frontend one).

5. **Error path:** Paste an obviously wrong/empty code. Confirm "Session expired — please try again." still appears (this is the existing `{ ok: false }` path in the UI — unchanged).
