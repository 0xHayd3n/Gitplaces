# Connectors Fix — Design Spec

**Date:** 2026-04-24  
**Scope:** Option A — targeted fixes to all three connector types  
**Files touched:** ~5 files, ~120 LOC

---

## Problem Statement

The Connectors settings tab has three failure modes:

1. **Custom connectors** always show a green "Connected" badge immediately after being added — no actual server reachability check is performed. The badge is cosmetically dishonest.
2. **GitHub auth flow** silently swallows all errors (`catch {}`). If device-flow auth times out or fails, the UI resets to the idle state with no explanation or retry prompt.
3. **Claude connector** has two gaps: (a) `handleClaudeDisconnect` has no error feedback if `logoutClaude()` rejects, and (b) `loginPhase` can get permanently stuck at `'logging-in'` if the Claude CLI process dies before emitting a `done` event.

---

## Architecture

Three independent fixes touching 5 files. No new modules, no refactoring.

| File | Change |
|---|---|
| `electron/main.ts` | Add `connectors:test` IPC handler |
| `electron/preload.ts` | Add `connectors` namespace |
| `src/env.d.ts` | Type the new `connectors` API |
| `src/views/Settings.tsx` | Fix all three connector failure modes |
| `src/styles/globals.css` | Add `.connector-badge.error` style |

---

## Section 1: Custom Connector Health Check

### IPC handler — `connectors:test`

Added to `electron/main.ts`. Makes an HTTP GET to the provided URL with a hard 5-second timeout using Node's built-in `https`/`http` modules (no new dependencies).

**Accepts any HTTP response** (including `401 Unauthorized`) as "reachable" — only network errors and timeouts are treated as "unreachable." This is intentional: an authenticated MCP server responding with 401 is still a live server.

Returns:
```ts
{ ok: boolean, statusCode?: number, latencyMs: number, error?: string }
```

### Preload bridge

```ts
connectors: {
  test(url: string): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>
}
```

Added to `electron/preload.ts` and typed in `src/env.d.ts`.

### Frontend state

New state in `Settings.tsx`:
```ts
const [connectorStatus, setConnectorStatus] = useState<Record<string, 'idle' | 'checking' | 'ok' | 'error'>>({})
```

**On add:** immediately call `testConnector(connector.id, connector.url)` after saving — sets status to `'checking'`, resolves to `'ok'` or `'error'`.

**Retest button:** each custom connector row gets a "Retest" link that calls the same helper. Disabled while `'checking'`.

**Badge rendering:**
- `'idle'` → no badge (connector was loaded from settings before status known)
- `'checking'` → grey "Checking…" text
- `'ok'` → green "Connected" badge (existing `.connector-badge.connected`)
- `'error'` → red "Error" badge (new `.connector-badge.error`)

**On app load:** status starts `'idle'` for all persisted connectors — no auto-retest on startup (deferred to later iteration).

### New CSS

```css
.connector-badge.error {
  background: color-mix(in srgb, var(--red) 15%, transparent);
  color: var(--red);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
}
```

Uses the existing `--red` token (matches error styling elsewhere in the app).

---

## Section 2: GitHub Error Handling

### Problem

`handleGitHubConnect` wraps the entire flow in `try { … } catch { // cancelled or failed }`. Any failure — timeout, network error, bad response — silently resets the UI to idle with no message.

### Fix

Add `githubError: string | null` state.

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  // AbortError = user cancelled — no error to show
  if (!message.includes('abort') && !message.includes('cancel')) {
    setGithubError('Connection failed — please try again.')
  }
}
```

**Error display:** reuse the existing `.connector-row--log` pattern already used by the Claude login flow — renders as a full-width row beneath the GitHub row when `githubError` is set. Cleared when the user clicks "Connect" again.

---

## Section 3: Claude Fixes

### Fix A — Logout error feedback

`handleClaudeDisconnect` currently has no error path. Add `claudeDisconnectError: string | null` state:

```ts
const handleClaudeDisconnect = async () => {
  setClaudeLoggingOut(true)
  setClaudeDisconnectError(null)
  try {
    await window.api.skill.logoutClaude()
    setClaudeCodeLoggedIn(false)
  } catch {
    setClaudeDisconnectError('Logout failed — please try again.')
  } finally {
    setClaudeLoggingOut(false)
  }
}
```

Error displayed inline using `.connector-row--log` pattern, same as GitHub error above.

### Fix B — Stuck `loginPhase`

If the Claude CLI process exits silently before emitting a `done` event, `loginPhase` stays at `'logging-in'` indefinitely — the Connect button never reappears.

Fix: start a 60-second timeout inside `handleLogin` that fires if `loginPhase` hasn't resolved:

```ts
const loginTimeout = setTimeout(() => {
  setLoginPhase('error')
  setLoginLines(prev => [...prev, 'Login timed out — please try again.'])
}, 60_000)

// Clear timeout when progress resolves
const onProgress = ({ done, isError }) => {
  if (done || isError) clearTimeout(loginTimeout)
  // ... existing logic
}
```

The timeout ref is stored in the existing `timers.current` array for cleanup on unmount.

---

## Error Handling Summary

| Connector | Before | After |
|---|---|---|
| Custom — add | Fake green badge immediately | Health check → real status |
| Custom — reachable | "Connected" (always) | Green badge |
| Custom — unreachable | "Connected" (always) | Red "Error" badge |
| GitHub — auth fail | Silent reset to idle | Inline error + retry |
| GitHub — cancel | Works correctly | Unchanged |
| Claude — logout fail | Silent | Inline error |
| Claude — login hang | Permanent spinner | 60s timeout → error + retry |

---

## Out of Scope

- OAuth PKCE/client_credentials flow for custom connectors
- Auto-retest custom connectors on app startup
- Tool discovery from custom MCP servers
- Connection state persistence across app restarts
