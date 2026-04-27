# Claude Auth Timeout Fix

**Date:** 2026-04-24
**Status:** Approved

## Problem

When users connect the Claude connector, the OAuth flow requires manually opening a URL, authenticating on claude.ai, copying an auth code from the callback page, and pasting it back into the app. This realistically takes 60–120 seconds. A 60-second frontend countdown in `handleLogin()` fires before the flow completes, showing "Login timed out — please try again." even when the user has already submitted their code and the backend is still processing it.

The backend (`legacy.ts`) has its own 3-minute timeout that sends `{ isError: true }` when it fires — the frontend `onProgress` handler already handles this correctly. The frontend timeout is redundant and actively harmful.

After the timeout fires, auth remains unconfirmed because `checkAuthStatus()` (which runs `auth status --json`) hasn't had time to detect the newly-stored credentials.

## Root Cause Chain

1. `handleLogin()` starts a 60s frontend timer at the moment Connect is clicked
2. User spends ~30–50s: URL appears → open browser → authenticate → copy code → return to app
3. User submits code — timer is already near expiry
4. CLI exchanges code with Claude's auth server (network round-trip, 5–20s)
5. Timer fires at T=60s — UI shows "Login timed out", hides the code input
6. Backend polls `checkAuthStatus()` but gets no time to confirm; eventually its own 3-min timeout fires
7. Auth remains unconfirmed

## Design

### 1. Remove the 60s frontend timeout — `src/views/Settings.tsx`

Delete the `setTimeout` block (lines 265–269) and all references to `loginTimeout` (lines 272, 291). The backend's 3-minute timeout in `legacy.ts:585` is the correct authority — it sends `{ isError: true }` on expiry, which `onProgress` already handles by calling `setLoginPhase('error')`. The `finally` block already handles listener cleanup.

**Before:**
```typescript
const loginTimeout = setTimeout(() => {
  setLoginPhase('error')
  setLoginLines(prev => [...prev, 'Login timed out — please try again.'])
}, 60_000)
timers.current.push(loginTimeout)

const onProgress = ({ message, isError, done }) => {
  if (done || isError) clearTimeout(loginTimeout)
  // ...
}
// ...
} finally {
  clearTimeout(loginTimeout)
  // ...
}
```

**After:** Remove the `setTimeout` block and both `clearTimeout(loginTimeout)` calls. The rest of `handleLogin` is unchanged.

### 2. Progress message on code submission — `electron/skill-gen/legacy.ts`

In `submitCode()`, call `onProgress('Verifying code with Claude…')` immediately before writing to stdin. This surfaces a message to the UI the moment the code is sent, so users know the backend received their submission.

```typescript
const submitCode = (code: string) => {
  console.log(`[skill-gen] Submitting auth code (${code.length} chars)…`)
  if (proc.stdin.writable) {
    onProgress('Verifying code with Claude…')  // ← add
    proc.stdin.write(code.trim() + '\n', 'utf8')
    // ...
  }
  startPolling()
}
```

### 3. Polling heartbeat — `electron/skill-gen/legacy.ts`

In `startPolling()`, send a progress message every 10 poll ticks (~20s) so the UI doesn't appear frozen during the verification window. A simple counter tracks ticks.

```typescript
const startPolling = () => {
  if (pollTimer) return
  let ticks = 0
  pollTimer = setInterval(async () => {
    ticks++
    if (ticks % 10 === 0) onProgress('Still verifying authentication…')
    const ok = await checkAuthStatus().catch(() => false)
    if (ok) {
      try { proc.kill() } catch {}
      settle(resolveLogin)
    }
  }, 2000)
}
```

## Files Changed

| File | Change | LOC |
|------|--------|-----|
| `src/views/Settings.tsx` | Remove 60s timeout and its two `clearTimeout` references | −6 |
| `electron/skill-gen/legacy.ts` | Add `onProgress` call in `submitCode`, add tick counter + heartbeat in `startPolling` | +5 |

**Total:** ~11 lines across 2 files. No new state, no architectural changes.

## Error Handling

- Backend 3-minute timeout fires → sends `{ isError: true }` → `onProgress` sets `loginPhase('error')` — unchanged
- CLI exits with non-zero code → `proc.on('close')` sends error → unchanged
- Component unmounts mid-login → `timers.current` cleanup already handles other timers; IPC listener is cleaned up in `finally`

## Testing

1. Start login, open URL in browser, authenticate, paste code back — should succeed without timeout
2. Start login, wait 65 seconds without doing anything — backend error message should appear (not frontend timeout)
3. Start login, submit wrong/empty code — "Session expired" message should still appear (existing path, unchanged)
