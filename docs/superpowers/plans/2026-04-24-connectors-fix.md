# Connectors Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three connector failure modes: fake custom-connector status badge, silent GitHub auth errors, and Claude logout/login-hang bugs.

**Architecture:** Five targeted edits across five files — one new IPC handler, one preload namespace, one type declaration, one CSS rule, and focused surgery on Settings.tsx state/handlers/render. No new modules or refactoring.

**Tech Stack:** Electron 31 (`net.fetch` for HTTP), React, TypeScript, electron-vite (build verification via `electron-vite build`).

**Spec:** `docs/superpowers/specs/2026-04-24-connectors-fix-design.md`

---

## File Map

| File | What changes |
|---|---|
| `electron/main.ts` | Add `connectors:test` IPC handler after line 458 |
| `electron/preload.ts` | Add `connectors` namespace after `mcp` block (after line 132) |
| `src/env.d.ts` | Add `connectors` type after `mcp` block (after line 150) |
| `src/styles/globals.css` | Add `.connector-badge.error` after `.connector-badge.connected` (after line 4910) |
| `src/views/Settings.tsx` | 5 targeted edits: new state, 3 handler fixes, custom connector render update |

---

## Task 1: `connectors:test` IPC handler + preload bridge + env type

**Files:**
- Modify: `electron/main.ts` — after line 458 (end of `github:disconnect` handler)
- Modify: `electron/preload.ts` — after line 132 (end of `mcp` block)
- Modify: `src/env.d.ts` — after line 150 (end of `mcp` block)

- [ ] **Step 1: Add the IPC handler to `electron/main.ts`**

  Insert after line 458 (the closing `})` of `github:disconnect`). The `net` module is already imported at line 1.

  ```ts
  ipcMain.handle('connectors:test', async (_event, url: string) => {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await net.fetch(url, { method: 'GET', signal: controller.signal })
      clearTimeout(timeout)
      return { ok: true, statusCode: res.status, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, latencyMs: Date.now() - start, error: message }
    }
  })
  ```

- [ ] **Step 2: Add the preload bridge to `electron/preload.ts`**

  Insert after the closing `},` of the `mcp` block (after line 132):

  ```ts
  connectors: {
    test: (url: string) =>
      ipcRenderer.invoke('connectors:test', url) as Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>,
  },
  ```

- [ ] **Step 3: Add the type declaration to `src/env.d.ts`**

  Insert after the closing `}` of the `mcp` block (after line 150):

  ```ts
  connectors: {
    test(url: string): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

  ```bash
  cd D:\Coding\Git-Suite && npm run build 2>&1 | tail -20
  ```

  Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add electron/main.ts electron/preload.ts src/env.d.ts
  git commit -m "feat(connectors): add connectors:test IPC handler and preload bridge"
  ```

---

## Task 2: Error badge CSS

**Files:**
- Modify: `src/styles/globals.css` — insert after line 4910 (after `.connector-badge.connected` block)

- [ ] **Step 1: Add the error badge style**

  Insert after the closing `}` of `.connector-badge.connected` (line 4910):

  ```css
  .connector-badge.error {
    background: color-mix(in srgb, var(--red) 15%, transparent);
    color: var(--red);
    border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/styles/globals.css
  git commit -m "feat(connectors): add error badge CSS"
  ```

---

## Task 3: Custom connector health check in Settings.tsx

**Files:**
- Modify: `src/views/Settings.tsx` — state block (line 113), `handleAddConnector` (line 370), `handleRemoveConnector` (line 383), custom connector render (line 566)

- [ ] **Step 1: Add `connectorStatus` state and `testConnector` helper**

  In the `// Connectors state` block (line 113), add after `claudeLoggingOut` state:

  ```ts
  const [connectorStatus, setConnectorStatus] = useState<Record<string, 'idle' | 'checking' | 'ok' | 'error'>>({})
  ```

  Then add a helper function after `handleRemoveConnector` (after line 385, before `renderConnectors`):

  ```ts
  const testConnector = async (id: string, url: string) => {
    if (!url) return
    setConnectorStatus(prev => ({ ...prev, [id]: 'checking' }))
    try {
      const result = await window.api.connectors.test(url)
      setConnectorStatus(prev => ({ ...prev, [id]: result.ok ? 'ok' : 'error' }))
    } catch {
      setConnectorStatus(prev => ({ ...prev, [id]: 'error' }))
    }
  }
  ```

- [ ] **Step 2: Trigger health check after add**

  In `handleAddConnector` (line 370), replace:

  ```ts
  await saveCustomConnectors([...customConnectors, connector])
  resetAddForm()
  ```

  With:

  ```ts
  await saveCustomConnectors([...customConnectors, connector])
  resetAddForm()
  testConnector(connector.id, connector.url)
  ```

  (No `await` — fire-and-forget so the form closes immediately.)

- [ ] **Step 3: Clean up status on remove**

  In `handleRemoveConnector` (line 383), replace:

  ```ts
  const handleRemoveConnector = async (id: string) => {
    await saveCustomConnectors(customConnectors.filter(c => c.id !== id))
  }
  ```

  With:

  ```ts
  const handleRemoveConnector = async (id: string) => {
    await saveCustomConnectors(customConnectors.filter(c => c.id !== id))
    setConnectorStatus(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
  ```

- [ ] **Step 4: Update custom connector render to show real status**

  Replace the entire custom connectors map block (lines 565–585):

  ```tsx
  {/* Custom connectors */}
  {customConnectors.map(c => (
    <div key={c.id} className="connector-row">
      <div className="connector-icon connector-icon--custom">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
        </svg>
      </div>
      <div className="connector-info">
        <div className="connector-name">{c.name}</div>
        {c.url && <div className="connector-desc">{c.url}</div>}
      </div>
      <div className="connector-actions">
        {connectorStatus[c.id] === 'checking' ? (
          <span className="connector-status-text">Checking…</span>
        ) : connectorStatus[c.id] === 'ok' ? (
          <span className="connector-badge connected">Connected</span>
        ) : connectorStatus[c.id] === 'error' ? (
          <span className="connector-badge error">Error</span>
        ) : null}
        <button
          className="settings-btn settings-btn--link connector-disconnect-btn"
          disabled={connectorStatus[c.id] === 'checking'}
          onClick={() => testConnector(c.id, c.url)}
        >
          Retest
        </button>
        <button
          className="settings-btn settings-btn--link connector-disconnect-btn"
          onClick={() => handleRemoveConnector(c.id)}
        >
          Remove
        </button>
      </div>
    </div>
  ))}
  ```

- [ ] **Step 5: Verify build**

  ```bash
  cd D:\Coding\Git-Suite && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/views/Settings.tsx
  git commit -m "feat(connectors): real health-check status for custom connectors"
  ```

---

## Task 4: GitHub error handling

**Files:**
- Modify: `src/views/Settings.tsx` — state block (line 107), `handleGitHubConnect` (line 321), GitHub render section (line 429–444)

- [ ] **Step 1: Add `githubError` state**

  In the `// Connectors state` block (line 107), add after `githubDisconnecting`:

  ```ts
  const [githubError, setGithubError] = useState<string | null>(null)
  ```

- [ ] **Step 2: Fix `handleGitHubConnect` catch block**

  Replace lines 321–339 (`handleGitHubConnect`):

  ```ts
  const handleGitHubConnect = async () => {
    setGithubConnecting(true)
    setGithubUserCode(null)
    setGithubVerificationUri(null)
    setGithubError(null)
    try {
      const flow = await window.api.github.startDeviceFlow()
      setGithubUserCode(flow.userCode)
      setGithubVerificationUri(flow.verificationUri)
      await window.api.github.pollDeviceToken(flow.deviceCode, flow.interval)
      const user = await window.api.github.getUser()
      setGithubUsername(user.login)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.toLowerCase().includes('abort') && !message.toLowerCase().includes('cancel')) {
        setGithubError('Connection failed — please try again.')
      }
    } finally {
      setGithubConnecting(false)
      setGithubUserCode(null)
      setGithubVerificationUri(null)
    }
  }
  ```

- [ ] **Step 3: Add GitHub error display in the render**

  In `renderConnectors`, after the closing `</div>` of the GitHub `connector-row` (after line 444), add:

  ```tsx
  {githubError && (
    <div className="connector-row connector-row--log">
      <p className="settings-hint error" style={{ margin: 0 }}>{githubError}</p>
    </div>
  )}
  ```

- [ ] **Step 4: Verify build**

  ```bash
  cd D:\Coding\Git-Suite && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/views/Settings.tsx
  git commit -m "fix(connectors): show error message when GitHub auth fails"
  ```

---

## Task 5: Claude connector fixes

**Files:**
- Modify: `src/views/Settings.tsx` — state block, `handleLogin` (line 256), `handleClaudeDisconnect` (line 351), Claude render section

- [ ] **Step 1: Add `claudeDisconnectError` state**

  In the `// Connectors state` block, add after `claudeLoggingOut`:

  ```ts
  const [claudeDisconnectError, setClaudeDisconnectError] = useState<string | null>(null)
  ```

- [ ] **Step 2: Fix `handleClaudeDisconnect`**

  Replace lines 351–359:

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

- [ ] **Step 3: Add 60-second login timeout to `handleLogin`**

  Replace lines 256–283 (`handleLogin`):

  ```ts
  const handleLogin = useCallback(async () => {
    setLoginPhase('logging-in')
    setLoginLines([])

    let hadError = false

    const loginTimeout = setTimeout(() => {
      setLoginPhase('error')
      setLoginLines(prev => [...prev, 'Login timed out — please try again.'])
    }, 60_000)
    timers.current.push(loginTimeout)

    const onProgress = ({ message, isError, done }: { message: string; isError?: boolean; done?: boolean }) => {
      if (done || isError) clearTimeout(loginTimeout)
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
      clearTimeout(loginTimeout)
      window.api.skill.offLoginProgress(onProgress)
    }
  }, [])
  ```

- [ ] **Step 4: Add Claude disconnect error display in render**

  In `renderConnectors`, after the closing `</div>` of the Claude `connector-row` (after line 487, before the setup/login progress blocks), add:

  ```tsx
  {claudeDisconnectError && (
    <div className="connector-row connector-row--log">
      <p className="settings-hint error" style={{ margin: 0 }}>{claudeDisconnectError}</p>
    </div>
  )}
  ```

- [ ] **Step 5: Verify build**

  ```bash
  cd D:\Coding\Git-Suite && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/views/Settings.tsx
  git commit -m "fix(connectors): Claude logout error feedback and 60s login timeout"
  ```

---

## Final Verification

- [ ] **Run the app and manually test all three connectors**

  ```bash
  cd D:\Coding\Git-Suite && npm run dev
  ```

  Open Settings → Connectors and verify:

  1. **Custom connector** — add a reachable URL (e.g., `https://httpbin.org/get`) → badge transitions from "Checking…" to green "Connected". Add an unreachable URL (e.g., `https://0.0.0.0`) → badge shows red "Error". "Retest" button re-runs the check.
  2. **GitHub** — if auth times out or network fails, an inline red message appears beneath the GitHub row instead of the UI silently resetting.
  3. **Claude logout** — if `logoutClaude` throws, error message appears. Login flow: if the process hangs, after 60 seconds the UI transitions to error state with "Login timed out" message.
