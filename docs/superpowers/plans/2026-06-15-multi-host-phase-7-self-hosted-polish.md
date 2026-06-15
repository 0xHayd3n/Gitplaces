# Multi-Host Phase 7: Self-Hosted UX Polish + Phase 6 Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the self-hosted UX surface — an "Add a host" form in Connections, distinguishable TLS/DNS/HTTP/JSON probe errors, a launch-time health check that flags unreachable instances — plus the two Phase 6 debt items: route `repo:save` `stored_version` through the provider instead of a hardcoded `api.github.com` URL, and invalidate the `useHostCapabilities` module-level cache when host auth state changes.

**Architecture:** `electron/providers/{gitlab,gitea}/rest.ts` `getServerVersion` is widened from `{ version } | null` to a discriminated `{ ok: true, version } | { ok: false, errorKind, error }` so the probe handler can attribute failures by class. `hosts:probe` formats each kind with a distinct user-facing message; the existing "did not respond as a <Type> instance" string stays for the JSON-mismatch branch (back-compat for any string checks). A new `hosts:healthCheck()` IPC enumerates every non-GitHub host and reuses the same `getServerVersion` per type; the Connections pane runs it on mount and renders a red dot next to any unreachable host. `repo:save`'s `stored_version` probe is moved off the hardcoded `https://api.github.com/repos/{owner}/{name}/releases/latest` fetch and onto `provider.getReleases(token, owner, name)` via `resolveAny(hostId)`, falling back to `pushed_at` exactly as today when no releases exist. `useHostCapabilities` gains a `clearCachedCapabilities(hostId)` exported function, a `hosts:capabilities-changed` IPC event the renderer subscribes to (preload `onHostCapabilitiesChanged` / `offHostCapabilitiesChanged`), and a per-hostId version counter so any mounted hook re-runs its fetch effect when its host's cache entry is evicted. The Connections pane gains a collapsible Add-a-host form (type dropdown limited to GitLab/Gitea, baseUrl + label inputs), a Remove button on every non-GitHub host (delegates to the existing `hosts:remove` IPC), and the health-status badge described above.

**Tech Stack:** TypeScript, Electron, React, vitest, electron-store, better-sqlite3.

**Source spec:** [docs/superpowers/specs/2026-06-14-multi-host-repo-integration-design.md](../specs/2026-06-14-multi-host-repo-integration-design.md) — Phase 7 section under "Migration phasing", plus the "Host instance config" + "Token storage" sections.

**Out of scope for this plan:**

- Mixed-host main grid (`loadTrending` / `loadMore`) — deferred from Phase 6, not landing here either; each host's pagination cursor differs and a cross-host scroller is its own multi-day design.
- GitHub Enterprise probe support. Today `hosts:probe` short-circuits `type='github'` to `ok: true` for `https://api.github.com` only; the Add-a-host form's type dropdown limits selectable values to `gitlab` and `gitea` accordingly.
- Free-text search across hosts — `searchAll` already supports `'free-text'` translation but the renderer's free-text path stays GitHub-only (untouched since Phase 6).
- Recommendation engine multi-host support.
- TLS-error UX during the periodic background `verificationService` jobs — that surface today already swallows network errors silently and is out of scope.

---

## File structure

### New files

- `electron/ipc/hostHandlers.healthCheck.test.ts` — covers the `hosts:healthCheck` IPC across happy path, partial failure, GitHub skip, and the four error kinds.

### Modified files

- `electron/providers/gitlab/rest.ts` — `getServerVersion` returns `ServerVersionResult` (discriminated). Exports the type for re-use by the probe + health handlers.
- `electron/providers/gitlab/rest.test.ts` — coverage for each `errorKind`.
- `electron/providers/gitea/rest.ts` — same change as gitlab/rest.ts.
- `electron/providers/gitea/rest.test.ts` — same coverage as gitlab/rest.test.ts.
- `electron/ipc/hostHandlers.ts` — `hosts:probe` reads the discriminated result and formats each kind. Adds `hosts:healthCheck`. Adds `hosts:capabilities-changed` broadcast from `setToken` / `clearToken` / `remove`.
- `electron/ipc/hostHandlers.probe.test.ts` — adds cases for TLS / DNS / HTTP-with-body / JSON-mismatch error kinds.
- `electron/ipc/repoHandlers.ts` — `repo:save` `stored_version` probe routes through `resolveAny(hostId).provider.getReleases(...)`.
- `electron/preload.ts` — exposes `hosts.healthCheck` + `hosts.onCapabilitiesChanged` + `hosts.offCapabilitiesChanged`.
- `src/env.d.ts` — adds matching type signatures for the three new preload methods.
- `src/hooks/useHostCapabilities.ts` — adds `clearCachedCapabilities(hostId)`, subscribes to `hosts:capabilities-changed`, uses an internal version counter so any mounted hook re-runs its fetch when its hostId's cache entry is invalidated.
- `src/hooks/useHostCapabilities.test.ts` — adds coverage for `clearCachedCapabilities` and the event-driven invalidation.
- `src/views/settings/ConnectionsPanel.tsx` — adds the Add-a-host form, the Remove button (non-GitHub hosts only), and the health-status badge row.

### Files NOT touched in this plan

- `electron/providers/registry.ts` — `getAnyProvider` already handles dynamic baseUrl lookup; adding a host via `hosts:add` is immediately visible to the registry on the next `getAnyProvider` call.
- `electron/providers/hostConfig.ts` — already exposes `addHost` / `removeHost`. The form just calls the existing IPC.
- `electron/providers/tokenStore.ts` — token storage already keyed by hostId.
- The main process (`electron/main.ts`) wiring — `registerHostHandlers(() => mainWindow)` is already passing the window getter so broadcast works automatically.
- Existing renderer call sites of `useHostCapabilities` (`RepoDetail.tsx`) — they don't need to know about cache invalidation; the hook handles re-renders.

---

## Notes for the executor

- Work directly on `main`. Do NOT create a feature branch or a worktree (per project-level CLAUDE.md).
- For non-sqlite tests use `npx vitest run <path>`. Run `npm test` only at the very end (Task 9). The user may have the dev app running; if `npm test` fails on better-sqlite3 rebuild because of a file lock, stop and ask.
- Conventional commits, one per task. Scopes: `feat(providers):`, `refactor(ipc):`, `feat(ipc):`, `feat(renderer):`, `fix(ipc):`.
- Batch execution — run every task consecutively. Final code-review at the end (per the user's `feedback_batch_execute_plans` memory).
- All node-fetch errors in tests use `Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })` to mimic undici's actual error shape. Plain `new Error('...')` won't reach the TLS/network branches — only the catch-all does. The existing probe test uses `Promise.reject(new Error('ECONNREFUSED'))` which today produces the "did not respond as a <Type> instance" branch; Phase 7 keeps that test passing because plain Errors with no `cause.code` still hit the catch-all "network" branch (formatted as "Could not reach …").
- The `_resetGitLabCacheForTest` / `_resetGiteaCacheForTest` / `_resetCapabilitiesCacheForTest` helpers should be called in `beforeEach` of any new test file that exercises the registry or capabilities cache.
- The `hosts:probe` test today asserts `/did not respond as a (GitLab|Gitea)/i` for unreachable / non-200 / JSON-mismatch errors. After Phase 7, only the JSON-mismatch case still matches that exact regex. Update those assertions to the new kind-specific strings (or use the more general `/(could not reach|did not respond|HTTP)/i`).

---

## Task 1: Refactor `getServerVersion` in `gitlab/rest.ts`

Widen the return type from `{ version: string } | null` to a discriminated `ServerVersionResult` that names the failure mode.

**Files:**
- Modify: `electron/providers/gitlab/rest.ts`
- Modify: `electron/providers/gitlab/rest.test.ts`

- [ ] **Step 1: Update the rest.test.ts expectations to the new shape**

Find the `describe('getServerVersion', ...)` block in `electron/providers/gitlab/rest.test.ts` (lines 64-84). Replace the whole block with:

```ts
describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true, version, revision } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '16.10.0-pre', revision: 'b93c103' }))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.version).toBe('16.10.0-pre')
      expect(v.revision).toBe('b93c103')
    }
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/version', expect.any(Object))
  })

  it('returns errorKind: "json" when response is missing the version field', async () => {
    mockFetch.mockResolvedValue(makeResponse({ unrelated: true }))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('json')
      expect(v.error).toMatch(/did not respond as a GitLab/)
    }
  })

  it('returns errorKind: "tls" when fetch throws with a TLS-related cause code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' },
      })),
    )
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('tls')
      expect(v.error).toMatch(/CERT_HAS_EXPIRED/)
    }
  })

  it('returns errorKind: "network" when fetch throws with a connection cause code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
      })),
    )
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('network')
      expect(v.error).toMatch(/ECONNREFUSED|gitlab\.com/)
    }
  })

  it('returns errorKind: "network" when fetch throws a plain Error with no cause', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('network')
    }
  })

  it('returns errorKind: "http" with status + body excerpt on non-2xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 502,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Bad Gateway'),
      headers: { get: () => null },
    })
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('http')
      expect(v.error).toMatch(/502/)
      expect(v.error).toMatch(/Bad Gateway/)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitlab/rest.test.ts -t getServerVersion`

Expected: FAIL — the new test cases reference `v.ok` / `v.errorKind` which don't exist on the current `{ version: string } | null` shape.

- [ ] **Step 3: Update `getServerVersion` in `gitlab/rest.ts`**

Replace the existing `getServerVersion` function in `electron/providers/gitlab/rest.ts` (lines 141-151) with:

```ts
// ── Server version (probe target) ────────────────────────────────────────────

export type ServerVersionResult =
  | { ok: true; version: string; revision?: string }
  | { ok: false; errorKind: 'tls' | 'network' | 'http' | 'json'; error: string }

const TLS_CODE_RE = /^(CERT_|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL)/i
const NETWORK_CODE_RE = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN)$/

function classifyFetchError(err: unknown, baseUrl: string): ServerVersionResult {
  // undici (Node 18+ global fetch) wraps the underlying error in `cause`.
  // Cause codes look like 'CERT_HAS_EXPIRED', 'ECONNREFUSED', etc.
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = typeof cause?.code === 'string' ? cause.code : ''
  if (TLS_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'tls', error: `TLS handshake failed (${code})` }
  }
  if (NETWORK_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} (${code})` }
  }
  const msg = (err as Error)?.message ?? String(err)
  return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} — ${msg}` }
}

export async function getServerVersion(baseUrl: string): Promise<ServerVersionResult> {
  let res: Response
  try {
    res = await fetch(api(baseUrl, '/version'), { headers: gitlabHeaders(null) })
  } catch (err) {
    return classifyFetchError(err, baseUrl)
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    return {
      ok: false,
      errorKind: 'http',
      error: body ? `HTTP ${res.status} — ${body}` : `HTTP ${res.status}`,
    }
  }
  let body: { version?: unknown; revision?: unknown }
  try {
    body = await res.json() as { version?: unknown; revision?: unknown }
  } catch {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a GitLab instance (invalid JSON)` }
  }
  if (typeof body?.version !== 'string' || body.version.length === 0) {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a GitLab instance (no /api/v4/version)` }
  }
  return {
    ok: true,
    version: body.version,
    revision: typeof body.revision === 'string' ? body.revision : undefined,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitlab/rest.test.ts -t getServerVersion`

Expected: all 6 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitlab/rest.ts electron/providers/gitlab/rest.test.ts
git commit -m "feat(providers/gitlab): getServerVersion returns discriminated ServerVersionResult"
```

---

## Task 2: Mirror the change in `gitea/rest.ts`

Same shape, same error classification, different host kind in the JSON-mismatch string.

**Files:**
- Modify: `electron/providers/gitea/rest.ts`
- Modify: `electron/providers/gitea/rest.test.ts`

- [ ] **Step 1: Update the rest.test.ts expectations**

Find the `describe('getServerVersion', ...)` block in `electron/providers/gitea/rest.test.ts`. Replace it with the same 6-case structure from Task 1, swapping `GitLab` → `Gitea` and `https://gitlab.com/api/v4/version` → `https://codeberg.org/api/v1/version`:

```ts
describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true, version } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '1.21.0+gitea-x' }))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.version).toBe('1.21.0+gitea-x')
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })

  it('returns errorKind: "json" when the response has no version field', async () => {
    mockFetch.mockResolvedValue(makeResponse({ unrelated: true }))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('json')
      expect(v.error).toMatch(/did not respond as a Gitea/)
    }
  })

  it('returns errorKind: "tls" on a TLS cause code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
      })),
    )
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('tls')
      expect(v.error).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE/)
    }
  })

  it('returns errorKind: "network" on a connection cause code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      })),
    )
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.errorKind).toBe('network')
  })

  it('returns errorKind: "network" on a plain Error reject with no cause', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.errorKind).toBe('network')
  })

  it('returns errorKind: "http" with status on non-2xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 503,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Service Unavailable'),
      headers: { get: () => null },
    })
    const v = await getServerVersion(BASE)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.errorKind).toBe('http')
      expect(v.error).toMatch(/503/)
      expect(v.error).toMatch(/Service Unavailable/)
    }
  })
})
```

The `BASE` constant in the existing gitea test file is `https://codeberg.org` — confirm before running.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/providers/gitea/rest.test.ts -t getServerVersion`

Expected: FAIL.

- [ ] **Step 3: Update `getServerVersion` in `gitea/rest.ts`**

Replace the existing `getServerVersion` function in `electron/providers/gitea/rest.ts` (lines 117-127) with:

```ts
// ── Server version (probe target) ────────────────────────────────────────────

export type ServerVersionResult =
  | { ok: true; version: string }
  | { ok: false; errorKind: 'tls' | 'network' | 'http' | 'json'; error: string }

const TLS_CODE_RE = /^(CERT_|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL)/i
const NETWORK_CODE_RE = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN)$/

function classifyFetchError(err: unknown, baseUrl: string): ServerVersionResult {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = typeof cause?.code === 'string' ? cause.code : ''
  if (TLS_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'tls', error: `TLS handshake failed (${code})` }
  }
  if (NETWORK_CODE_RE.test(code)) {
    return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} (${code})` }
  }
  const msg = (err as Error)?.message ?? String(err)
  return { ok: false, errorKind: 'network', error: `Could not reach ${baseUrl} — ${msg}` }
}

export async function getServerVersion(baseUrl: string): Promise<ServerVersionResult> {
  let res: Response
  try {
    res = await fetch(api(baseUrl, '/version'), { headers: giteaHeaders(null) })
  } catch (err) {
    return classifyFetchError(err, baseUrl)
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    return {
      ok: false,
      errorKind: 'http',
      error: body ? `HTTP ${res.status} — ${body}` : `HTTP ${res.status}`,
    }
  }
  let body: { version?: unknown }
  try {
    body = await res.json() as { version?: unknown }
  } catch {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a Gitea instance (invalid JSON)` }
  }
  if (typeof body?.version !== 'string' || body.version.length === 0) {
    return { ok: false, errorKind: 'json', error: `${baseUrl} did not respond as a Gitea instance (no /api/v1/version)` }
  }
  return { ok: true, version: body.version }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/providers/gitea/rest.test.ts -t getServerVersion`

Expected: all 6 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/providers/gitea/rest.ts electron/providers/gitea/rest.test.ts
git commit -m "feat(providers/gitea): getServerVersion returns discriminated ServerVersionResult"
```

---

## Task 3: Update `hosts:probe` to format each error kind

Read the discriminated result and surface the appropriate user-facing string.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Modify: `electron/ipc/hostHandlers.probe.test.ts`

- [ ] **Step 1: Update `hostHandlers.probe.test.ts` expectations**

The existing tests assert `/did not respond as a (GitLab|Gitea)/i` for unreachable / non-200 / JSON-mismatch errors. After Phase 7, only the JSON-mismatch case keeps that exact string — the connection / HTTP cases now produce kind-specific strings. Update the affected cases:

In the `'hosts:probe — GitLab'` block:

```ts
  it('returns { ok: false } when the server is unreachable', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://nope.example' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/could not reach https:\/\/nope\.example/i)
  })

  it('returns { ok: false } when the response is not a GitLab version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ unrelated: true }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a GitLab/i)
  })

  it('returns { ok: false } on HTTP error status with status code surfaced', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      text: () => Promise.resolve('404 Not Found'),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/HTTP 404/)
  })
```

In the `'hosts:probe — Gitea'` block apply the same three edits (swap "GitLab" → "Gitea").

Then add four new cases at the end of the file (after the existing Gitea block) covering Phase 7's new kind-specific surfacing:

```ts
describe('hosts:probe — kind-specific surfacing', () => {
  beforeEach(() => mockFetch.mockReset())

  it('surfaces TLS handshake errors with the cert code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'CERT_HAS_EXPIRED' },
      })),
    )
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://expired.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/TLS handshake failed/i)
    expect(out.error).toMatch(/CERT_HAS_EXPIRED/)
  })

  it('surfaces DNS / refused connections with "Could not reach"', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      })),
    )
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://nope.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/could not reach https:\/\/nope\.example/i)
    expect(out.error).toMatch(/ENOTFOUND/)
  })

  it('surfaces HTTP errors with status + body excerpt', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Internal Server Error'),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://broken.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/HTTP 500/)
    expect(out.error).toMatch(/Internal Server Error/)
  })

  it('surfaces JSON-mismatch with the canonical "did not respond as a" message', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ html: '<title>not gitea</title>' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://wrong.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a Gitea/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: FAIL on the kind-specific cases (the current handler collapses everything to "did not respond as a … instance").

- [ ] **Step 3: Update the probe handler**

In `electron/ipc/hostHandlers.ts`, replace the body of the `ipcMain.handle('hosts:probe', ...)` block (lines 75-98) with:

```ts
  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v.ok) return { ok: true }
      return { ok: false, error: formatProbeError(v) }
    }

    if (input.type === 'gitea') {
      const v = await getGiteaServerVersion(input.baseUrl)
      if (v.ok) return { ok: true }
      return { ok: false, error: formatProbeError(v) }
    }

    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })
```

Add the helper above `registerHostHandlers` (just below the `interface ProbeResult` block):

```ts
type ServerVersionFailure = { ok: false; errorKind: 'tls' | 'network' | 'http' | 'json'; error: string }

function formatProbeError(v: ServerVersionFailure): string {
  switch (v.errorKind) {
    case 'tls':     return `TLS handshake failed (self-signed cert? expired?) — ${v.error}`
    case 'network': return v.error  // already starts with "Could not reach …"
    case 'http':    return v.error  // already includes status + body excerpt
    case 'json':    return v.error  // already mentions "did not respond as a <kind>"
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts`

Expected: every case PASSES.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/ipc/hostHandlers.probe.test.ts
git commit -m "feat(ipc): hosts:probe surfaces TLS / DNS / HTTP / JSON errors distinctly"
```

---

## Task 4: Add `hosts:healthCheck` IPC + preload

Returns `Record<hostId, { ok: true } | { ok: false, error: string }>` for the Connections-pane health badges.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`
- Create: `electron/ipc/hostHandlers.healthCheck.test.ts`

- [ ] **Step 1: Write the failing test**

Write `electron/ipc/hostHandlers.healthCheck.test.ts`:

```ts
// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } },
  app: { getPath: () => '/tmp/test' },
}))
vi.mock('../githubLoginPopup', () => ({ openLoginPopup: vi.fn(), closeLoginPopup: vi.fn() }))
vi.mock('../store', () => ({ setGitHubUser: vi.fn(), clearGitHubUser: vi.fn() }))
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../services/topicCacheService', () => ({ initTopicCache: vi.fn() }))
vi.mock('../services/deviceFlowState', () => ({ getDeviceFlowAbort: vi.fn(), setDeviceFlowAbort: vi.fn() }))

const listHostsMock = vi.fn()
vi.mock('../providers/hostConfig', () => ({
  listHosts: () => listHostsMock(),
  getHost: vi.fn(),
  addHost: vi.fn(),
  removeHost: vi.fn(),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { registerHostHandlers } from './hostHandlers'

registerHostHandlers()

describe('hosts:healthCheck', () => {
  beforeEach(() => {
    listHostsMock.mockReset()
    mockFetch.mockReset()
  })

  it('skips GitHub and pings only GitLab + Gitea hosts', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gh:api.github.com', type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub', addedAt: '' },
      { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com', addedAt: '' },
      { id: 'gt:codeberg.org', type: 'gitea', baseUrl: 'https://codeberg.org', label: 'Codeberg', addedAt: '' },
    ])
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '17.0.0' }),
      headers: { get: () => null },
    })

    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean }>
    expect(out['gh:api.github.com']).toEqual({ ok: true })
    expect(out['gl:gitlab.com']).toEqual({ ok: true })
    expect(out['gt:codeberg.org']).toEqual({ ok: true })
    // GitHub not pinged
    const urls = mockFetch.mock.calls.map(c => c[0])
    expect(urls).toContain('https://gitlab.com/api/v4/version')
    expect(urls).toContain('https://codeberg.org/api/v1/version')
    expect(urls).not.toContain('https://api.github.com')
  })

  it('reports a per-host error when a host is unreachable', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gl:gitlab.acme.com', type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme', addedAt: '' },
    ])
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })),
    )
    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean; error?: string }>
    expect(out['gl:gitlab.acme.com'].ok).toBe(false)
    expect(out['gl:gitlab.acme.com'].error).toMatch(/could not reach/i)
  })

  it('reports a TLS error on a self-signed cert host', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gt:gitea.acme.com', type: 'gitea', baseUrl: 'https://gitea.acme.com', label: 'Acme', addedAt: '' },
    ])
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })),
    )
    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean; error?: string }>
    expect(out['gt:gitea.acme.com'].ok).toBe(false)
    expect(out['gt:gitea.acme.com'].error).toMatch(/TLS handshake failed/i)
  })

  it('returns an empty object when no hosts are configured', async () => {
    listHostsMock.mockReturnValue([])
    const out = await handlers.get('hosts:healthCheck')!({})
    expect(out).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/ipc/hostHandlers.healthCheck.test.ts`

Expected: FAIL — handler not registered.

- [ ] **Step 3: Add the IPC handler**

In `electron/ipc/hostHandlers.ts`, just before the `// ── Device flow ─` block (around line 143), insert:

```ts
  ipcMain.handle('hosts:healthCheck', async (): Promise<Record<string, { ok: true } | { ok: false; error: string }>> => {
    const out: Record<string, { ok: true } | { ok: false; error: string }> = {}
    await Promise.all(listHosts().map(async (host) => {
      // GitHub doesn't expose /version the same way; assume ok.
      if (host.type === 'github') { out[host.id] = { ok: true }; return }

      const v = host.type === 'gitlab'
        ? await getGitLabServerVersion(host.baseUrl)
        : await getGiteaServerVersion(host.baseUrl)
      out[host.id] = v.ok ? { ok: true } : { ok: false, error: v.error }
    }))
    return out
  })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/ipc/hostHandlers.healthCheck.test.ts`

Expected: every case PASSES.

- [ ] **Step 5: Wire the preload binding**

Edit `electron/preload.ts`. In the `hosts:` block, after `getCapabilities` (line 125-126), add:

```ts
    healthCheck: () =>
      ipcRenderer.invoke('hosts:healthCheck') as Promise<Record<string, { ok: true } | { ok: false; error: string }>>,
```

- [ ] **Step 6: Augment src/env.d.ts**

In `src/env.d.ts`, inside the `hosts: { ... }` block, after `getCapabilities`, add:

```ts
        healthCheck: () => Promise<Record<string, { ok: true } | { ok: false; error: string }>>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/ipc/hostHandlers.healthCheck.test.ts electron/preload.ts src/env.d.ts
git commit -m "feat(ipc): hosts:healthCheck pings each non-GitHub host's /version"
```

---

## Task 5: Move `repo:save` `stored_version` probe onto the provider

Drop the hardcoded `https://api.github.com/repos/{owner}/{name}/releases/latest` fetch and route through `provider.getReleases` so non-GitHub hosts get real release tags.

**Files:**
- Modify: `electron/ipc/repoHandlers.ts`

- [ ] **Step 1: Update the `repo:save` handler**

In `electron/ipc/repoHandlers.ts`, find the `repo:save` handler (lines 633-664). Replace the inner `setImmediate(async () => { ... })` block (lines 641-663) with:

```ts
    setImmediate(async () => {
      let storedVersion: string | null = null
      try {
        const { provider, token } = resolveAny(hostId)
        const releases = await provider.getReleases(token, owner, name)
        if (Array.isArray(releases) && releases.length > 0) {
          // GitHubProvider.getReleases returns raw GitHubRelease[] (snake_case
          // `tag_name`). GitLab/Gitea providers return canonical Release[]
          // (camelCase `tagName`). Read whichever is present.
          const first = releases[0] as Record<string, unknown>
          storedVersion =
            (typeof first.tag_name === 'string' ? first.tag_name : null) ??
            (typeof first.tagName === 'string' ? first.tagName : null)
        }
        if (!storedVersion) {
          const dbRow = db.prepare('SELECT pushed_at FROM repos WHERE owner = ? AND name = ?')
            .get(owner, name) as { pushed_at: string | null } | undefined
          storedVersion = dbRow?.pushed_at ?? null
        }
      } catch {
        // Provider unknown or network failure — fall back to pushed_at if available.
        try {
          const dbRow = db.prepare('SELECT pushed_at FROM repos WHERE owner = ? AND name = ?')
            .get(owner, name) as { pushed_at: string | null } | undefined
          storedVersion = dbRow?.pushed_at ?? null
        } catch { /* still null */ }
      }
      const isFork = await checkIsFork(owner, name)
      db.prepare('UPDATE repos SET stored_version = ?, is_forked = ? WHERE owner = ? AND name = ?')
        .run(storedVersion, isFork ? 1 : 0, owner, name)
    })
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the touched specs**

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts electron/ipc/hostHandlers.healthCheck.test.ts`

(`repo:save` has no dedicated test in the repo today; the next test will exercise it as part of npm test in Task 9. Type-check + the related probe specs is sufficient at this commit.)

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/repoHandlers.ts
git commit -m "fix(ipc): repo:save stored_version probe routes through the provider"
```

---

## Task 6: `useHostCapabilities` cache invalidation

Add `clearCachedCapabilities(hostId)` plus event-driven re-renders so hooks pick up new caps when auth state changes.

**Files:**
- Modify: `src/hooks/useHostCapabilities.ts`
- Modify: `src/hooks/useHostCapabilities.test.ts`

- [ ] **Step 1: Update the hook test**

Edit `src/hooks/useHostCapabilities.test.ts`. After the existing `'caches by hostId — second mount reuses the resolved caps'` test, add:

```ts
  it('clearCachedCapabilities forces the next mount to refetch', async () => {
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    const { clearCachedCapabilities } = await import('./useHostCapabilities')
    clearCachedCapabilities('gl:gitlab.com')
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: true, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })

    const b = renderHook(() => useHostCapabilities('gl:gitlab.com'))
    await waitFor(() => expect(b.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
  })

  it('refetches when the hosts:capabilities-changed IPC event fires for the mounted host', async () => {
    const listeners = new Set<(data: { hostId: string }) => void>()
    ;(globalThis as any).window.api = {
      hosts: {
        getCapabilities: getCaps,
        onCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.add(cb) },
        offCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.delete(cb) },
      },
    }
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gt:codeberg.org'))
    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(false))
    expect(getCaps).toHaveBeenCalledTimes(1)

    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: true, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    // Simulate the main process broadcasting that this host's caps changed.
    listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' }))

    await waitFor(() => expect(a.result.current?.vulnerabilityAlerts).toBe(true))
    expect(getCaps).toHaveBeenCalledTimes(2)
  })

  it('ignores capabilities-changed events for other hosts', async () => {
    const listeners = new Set<(data: { hostId: string }) => void>()
    ;(globalThis as any).window.api = {
      hosts: {
        getCapabilities: getCaps,
        onCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.add(cb) },
        offCapabilitiesChanged: (cb: (data: { hostId: string }) => void) => { listeners.delete(cb) },
      },
    }
    getCaps.mockResolvedValueOnce({
      vulnerabilityAlerts: false, codeScanningAlerts: false, events: false,
      trendingDiscovery: true, graphqlBundle: false, isVerifiedOrg: false,
    })
    const a = renderHook(() => useHostCapabilities('gh:api.github.com'))
    await waitFor(() => expect(a.result.current).not.toBeNull())
    expect(getCaps).toHaveBeenCalledTimes(1)

    // Event fires for a different host — must NOT trigger a refetch.
    listeners.forEach(fn => fn({ hostId: 'gt:codeberg.org' }))
    // Yield to the event loop so a hypothetical re-fetch would have started.
    await Promise.resolve()
    expect(getCaps).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useHostCapabilities.test.ts`

Expected: FAIL — `clearCachedCapabilities` not exported; event subscription not wired.

- [ ] **Step 3: Update the hook**

Replace the contents of `src/hooks/useHostCapabilities.ts` with:

```ts
import { useEffect, useState } from 'react'

// Mirror of electron/providers/types.ts → ProviderCapabilities. Kept inline so
// the renderer doesn't have to import from the electron tree at runtime.
export interface ProviderCapabilities {
  vulnerabilityAlerts: boolean
  codeScanningAlerts: boolean
  events: boolean
  trendingDiscovery: boolean
  graphqlBundle: boolean
  isVerifiedOrg: boolean
}

// Module-level cache. Capabilities can change in-process when auth state for a
// host flips (e.g. a token that newly unlocks vulnerability alerts), so the
// main process broadcasts 'hosts:capabilities-changed' on setToken/clearToken;
// the hook listens and re-fetches the affected hostId.
const cache = new Map<string, ProviderCapabilities | null>()
const inflight = new Map<string, Promise<ProviderCapabilities | null>>()

export function _resetCapabilitiesCacheForTest(): void {
  cache.clear()
  inflight.clear()
}

export function clearCachedCapabilities(hostId: string): void {
  cache.delete(hostId)
  inflight.delete(hostId)
}

export function useHostCapabilities(hostId: string | null): ProviderCapabilities | null {
  const [caps, setCaps] = useState<ProviderCapabilities | null>(
    () => (hostId ? cache.get(hostId) ?? null : null),
  )
  // Bumped by the IPC-event subscription below; re-triggers the fetch effect.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!hostId) return
    const handler = (data: { hostId: string }) => {
      if (data?.hostId === hostId) {
        clearCachedCapabilities(hostId)
        setVersion(v => v + 1)
      }
    }
    const on = window.api?.hosts?.onCapabilitiesChanged
    const off = window.api?.hosts?.offCapabilitiesChanged
    if (typeof on !== 'function' || typeof off !== 'function') return
    on(handler)
    return () => { off(handler) }
  }, [hostId])

  useEffect(() => {
    if (!hostId) { setCaps(null); return }
    const cached = cache.get(hostId)
    if (cached !== undefined) { setCaps(cached); return }

    // Defensive: in test environments that don't fully mock window.api the
    // hosts namespace (or getCapabilities specifically) may be absent. Treat
    // that as "no capability information available" rather than crashing.
    const ipc = window.api?.hosts?.getCapabilities
    if (typeof ipc !== 'function') { setCaps(null); return }

    let cancelled = false
    let promise = inflight.get(hostId)
    if (!promise) {
      // Register the inflight entry BEFORE chaining `.then`/`.catch`. If we
      // chained first and then set, a concurrent caller landing between the
      // chain and the set would see no inflight entry, fire a duplicate IPC,
      // and overwrite our entry on its own set.
      promise = ipc(hostId)
        .then(c => { cache.set(hostId, c); inflight.delete(hostId); return c })
        .catch(() => { inflight.delete(hostId); return null })
      inflight.set(hostId, promise)
    }
    promise.then(c => { if (!cancelled) setCaps(c) })
    return () => { cancelled = true }
  }, [hostId, version])

  return caps
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useHostCapabilities.test.ts`

Expected: every case PASSES.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHostCapabilities.ts src/hooks/useHostCapabilities.test.ts
git commit -m "feat(renderer): useHostCapabilities cache invalidates on capabilities-changed event"
```

---

## Task 7: Broadcast `hosts:capabilities-changed` from auth mutations

Wire the main process to emit the event so the hook's subscription fires.

**Files:**
- Modify: `electron/ipc/hostHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 1: Add the broadcast helper + emit from setToken / clearToken / remove**

In `electron/ipc/hostHandlers.ts`, just after the `interface ProbeResult` block, add:

```ts
function broadcastCapabilitiesChanged(
  getMainWindow: () => BrowserWindow | null,
  hostId: string,
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('hosts:capabilities-changed', { hostId })
  }
}
```

Then in `registerHostHandlers(...)`, add `broadcastCapabilitiesChanged(getMainWindow, hostId)` to the end of these three handlers:

- `hosts:setToken` (after the existing return on line 113-114; emit BEFORE returning):

```ts
    if (hostId === HOST_ID_GITHUB) {
      setGitHubUser(user.login, user.avatarUrl)
      const db = getDb(app.getPath('userData'))
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
    }
    broadcastCapabilitiesChanged(getMainWindow, hostId)
    return { user }
```

- `hosts:clearToken` (after the existing GitHub-mirror block):

```ts
  ipcMain.handle('hosts:clearToken', (_event, hostId: string) => {
    clearToken(hostId)
    if (hostId === HOST_ID_GITHUB) {
      clearGitHubUser()
      const db = getDb(app.getPath('userData'))
      db.prepare('DELETE FROM settings WHERE key = ?').run('github_username')
    }
    broadcastCapabilitiesChanged(getMainWindow, hostId)
  })
```

- `hosts:remove`:

```ts
  ipcMain.handle('hosts:remove', (_event, hostId: string) => {
    if (hostId === HOST_ID_GITHUB) {
      throw new Error('Cannot remove the GitHub host')
    }
    clearToken(hostId)
    removeHost(hostId)
    broadcastCapabilitiesChanged(getMainWindow, hostId)
  })
```

- Also `hosts:pollDeviceToken` (since it also writes a token):

```ts
      if (hostId === HOST_ID_GITHUB) {
        setGitHubUser(user.login, user.avatarUrl)
        const db = getDb(app.getPath('userData'))
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
        initTopicCache(token).catch(() => {}) // Non-blocking
      }
      broadcastCapabilitiesChanged(getMainWindow, hostId)
      return { user }
```

- [ ] **Step 2: Add the preload bindings**

Edit `electron/preload.ts`. In the `hosts:` block, after `healthCheck`, add:

```ts
    onCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => {
      const wrapper = (_: unknown, data: { hostId: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('hosts:capabilities-changed', wrapper)
    },
    offCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('hosts:capabilities-changed', wrapper)
        callbackWrappers.delete(cb)
      }
    },
```

- [ ] **Step 3: Augment src/env.d.ts**

In the `hosts:` block, after `healthCheck`, add:

```ts
        onCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => void
        offCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => void
```

- [ ] **Step 4: Update hostHandlers.probe.test.ts so existing calls still work**

The probe tests call `registerHostHandlers()` with no args (defaulting `getMainWindow` to `() => null`). The `broadcastCapabilitiesChanged` helper handles null safely, so no test changes are required. Confirm by:

Run: `npx vitest run electron/ipc/hostHandlers.probe.test.ts electron/ipc/hostHandlers.healthCheck.test.ts`

Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/hostHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(ipc): broadcast hosts:capabilities-changed on token/host mutations"
```

---

## Task 8: ConnectionsPanel — Add-a-host form, Remove button, health badges

Adds the three Phase 7 UI surfaces: a collapsible "Add a host" form, a Remove icon button on non-GitHub rows, and a health-status indicator under any host whose `/version` probe failed.

**Files:**
- Modify: `src/views/settings/ConnectionsPanel.tsx`

- [ ] **Step 1: Replace the file with the Phase-7 version**

Replace the entirety of `src/views/settings/ConnectionsPanel.tsx` with:

```tsx
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { User } from '../../types/repo'

// Mirror the shape declared in electron/preload.ts → hosts.list.
// Renderer-local copy so we don't have to import from the electron tree at runtime.
interface HostInstance {
  id: string
  type: 'github' | 'gitlab' | 'gitea'
  baseUrl: string
  label: string
  addedAt: string
  webUrl?: string
}

const HOST_ID_GITHUB = 'gh:api.github.com'

function patDocsUrl(host: HostInstance): string {
  // For gitlab + gitea, deep-link to the matching path on the host's own
  // webUrl (or API baseUrl when there's no explicit webUrl).
  const base = (host.webUrl ?? host.baseUrl).replace(/\/+$/, '')
  switch (host.type) {
    case 'github': return 'https://github.com/settings/tokens'
    case 'gitlab': return `${base}/-/user_settings/personal_access_tokens`
    case 'gitea':  return `${base}/user/settings/applications`
  }
}

const HOST_ICONS: Record<HostInstance['type'], ReactNode> = {
  github: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  ),
  gitlab: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.49A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92Z"/>
    </svg>
  ),
  gitea: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9z" />
    </svg>
  ),
}

interface HostStatus {
  user: User | null
  loading: boolean
  error: string | null
}

type HealthStatus = { ok: true } | { ok: false; error: string }

export default function ConnectionsPanel() {
  const [hosts, setHosts] = useState<HostInstance[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [health, setHealth] = useState<Record<string, HealthStatus>>({})
  const [patDraft, setPatDraft] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({})
  const [removing, setRemoving] = useState<Record<string, boolean>>({})

  // Add-a-host form state.
  const [showAddForm, setShowAddForm] = useState(false)
  const [addType, setAddType] = useState<'gitlab' | 'gitea'>('gitlab')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const refreshHost = useCallback(async (hostId: string) => {
    setStatuses(prev => ({ ...prev, [hostId]: { ...(prev[hostId] ?? { user: null, error: null }), loading: true } }))
    try {
      const user = await window.api.hosts.getConnectedUser(hostId)
      setStatuses(prev => ({ ...prev, [hostId]: { user, loading: false, error: null } }))
    } catch (e) {
      setStatuses(prev => ({ ...prev, [hostId]: { user: null, loading: false, error: (e as Error).message } }))
    }
  }, [])

  const loadHosts = useCallback(async (): Promise<HostInstance[]> => {
    const list = await window.api.hosts.list() as HostInstance[]
    setHosts(list)
    return list
  }, [])

  const runHealthCheck = useCallback(async () => {
    try {
      const result = await window.api.hosts.healthCheck()
      setHealth(result)
    } catch {
      // non-critical — leave previous health state in place
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await loadHosts()
      if (cancelled) return
      await Promise.all(list.map(h => refreshHost(h.id)))
      if (cancelled) return
      void runHealthCheck()
    }
    load()
    return () => { cancelled = true }
  }, [loadHosts, refreshHost, runHealthCheck])

  const handleConnect = useCallback(async (host: HostInstance) => {
    const pat = (patDraft[host.id] ?? '').trim()
    if (!pat) return
    setConnecting(prev => ({ ...prev, [host.id]: true }))
    setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: null } }))
    try {
      const result = await window.api.hosts.setToken(host.id, pat)
      setStatuses(prev => ({ ...prev, [host.id]: { user: result.user, loading: false, error: null } }))
      setPatDraft(prev => ({ ...prev, [host.id]: '' }))
    } catch (e) {
      const message = (e as Error).message ?? 'Failed to connect.'
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: message } }))
    } finally {
      setConnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [patDraft])

  const handleDisconnect = useCallback(async (host: HostInstance) => {
    setDisconnecting(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.clearToken(host.id)
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: null } }))
    } catch (e) {
      const message = (e as Error).message ?? 'Failed to disconnect.'
      setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: message } }))
    } finally {
      setDisconnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [])

  const handleRemove = useCallback(async (host: HostInstance) => {
    if (host.id === HOST_ID_GITHUB) return
    setRemoving(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.remove(host.id)
      await loadHosts()
      setHealth(prev => {
        const next = { ...prev }
        delete next[host.id]
        return next
      })
    } catch (e) {
      setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: (e as Error).message } }))
    } finally {
      setRemoving(prev => ({ ...prev, [host.id]: false }))
    }
  }, [loadHosts])

  const handleOpenPatDocs = useCallback((host: HostInstance) => {
    void window.api.openExternal(patDocsUrl(host))
  }, [])

  const handleAddSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const baseUrl = addBaseUrl.trim().replace(/\/+$/, '')
    const label = addLabel.trim() || baseUrl
    if (!baseUrl) { setAddError('Enter a base URL.'); return }
    if (!/^https?:\/\//i.test(baseUrl)) { setAddError('Base URL must start with https:// or http://.'); return }

    setAddBusy(true)
    setAddError(null)
    try {
      const probe = await window.api.hosts.probe({ type: addType, baseUrl })
      if (!probe.ok) {
        setAddError(probe.error ?? 'Probe failed.')
        return
      }
      await window.api.hosts.add({ type: addType, baseUrl, label, webUrl: baseUrl })
      const list = await loadHosts()
      const newHost = list.find(h => h.baseUrl === baseUrl)
      if (newHost) await refreshHost(newHost.id)
      void runHealthCheck()
      // Reset form
      setAddBaseUrl('')
      setAddLabel('')
      setShowAddForm(false)
    } catch (err) {
      setAddError((err as Error).message ?? 'Failed to add host.')
    } finally {
      setAddBusy(false)
    }
  }, [addType, addBaseUrl, addLabel, loadHosts, refreshHost, runHealthCheck])

  return (
    <>
      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Repository hosts Git Suite can browse and act on. Use a Personal Access Token for each.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">
          {hosts.length === 0 && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint" style={{ margin: 0 }}>No hosts configured yet.</p>
            </div>
          )}

          {hosts.map(host => {
            const status = statuses[host.id]
            const user = status?.user ?? null
            const isConnecting = connecting[host.id] ?? false
            const isDisconnecting = disconnecting[host.id] ?? false
            const isRemoving = removing[host.id] ?? false
            const draft = patDraft[host.id] ?? ''
            const error = status?.error ?? null
            const hostHealth = health[host.id]
            const isUnreachable = hostHealth && hostHealth.ok === false
            const canRemove = host.id !== HOST_ID_GITHUB

            return (
              <div key={host.id}>
                <div className="connector-row">
                  <div className={`connector-icon connector-icon--${host.type}`}>
                    {HOST_ICONS[host.type]}
                  </div>
                  <div className="connector-info">
                    <div className="connector-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isUnreachable && (
                        <span
                          aria-label="Unreachable"
                          title="Unreachable"
                          style={{
                            width: 8, height: 8, borderRadius: 4,
                            background: 'var(--danger, #d33)',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      {host.label}
                    </div>
                    <div className="connector-desc">
                      {status?.loading
                        ? 'Checking…'
                        : user
                          ? `Connected as @${user.login}`
                          : <>
                              <span>{host.baseUrl}</span>
                              {' — '}
                              <a
                                href="#"
                                onClick={e => { e.preventDefault(); handleOpenPatDocs(host) }}
                              >
                                How do I create a PAT?
                              </a>
                            </>}
                    </div>
                  </div>
                  <div className="connector-actions">
                    {user ? (
                      <>
                        <span className="connector-badge connected">Connected</span>
                        <button
                          className="settings-btn settings-btn--link connector-disconnect-btn"
                          disabled={isDisconnecting}
                          onClick={() => handleDisconnect(host)}
                        >
                          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <form
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                        onSubmit={e => { e.preventDefault(); void handleConnect(host) }}
                      >
                        <input
                          type="password"
                          className="settings-input"
                          placeholder="Personal access token"
                          value={draft}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={e => setPatDraft(prev => ({ ...prev, [host.id]: e.target.value }))}
                          disabled={isConnecting}
                          style={{ minWidth: 220 }}
                        />
                        <button
                          type="submit"
                          className="settings-btn"
                          disabled={isConnecting || draft.trim().length === 0}
                        >
                          {isConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                      </form>
                    )}
                    {canRemove && (
                      <button
                        aria-label={`Remove ${host.label}`}
                        title={`Remove ${host.label}`}
                        className="settings-btn settings-btn--link connector-remove-btn"
                        disabled={isRemoving}
                        onClick={() => handleRemove(host)}
                        style={{ marginLeft: 8 }}
                      >
                        {isRemoving ? '…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>

                {isUnreachable && (
                  <div className="connector-row connector-row--log">
                    <p className="settings-hint error" style={{ margin: 0 }}>
                      Unreachable: {hostHealth.error}
                    </p>
                  </div>
                )}

                {error && (
                  <div className="connector-row connector-row--log">
                    <p className="settings-hint error" style={{ margin: 0 }}>{error}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="settings-group" style={{ marginTop: 16 }}>
        <div className="settings-group-body">
          {!showAddForm ? (
            <button
              type="button"
              className="settings-btn"
              onClick={() => setShowAddForm(true)}
            >
              Add a host…
            </button>
          ) : (
            <form
              onSubmit={handleAddSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Type</span>
                  <select
                    className="settings-input"
                    value={addType}
                    onChange={e => setAddType(e.target.value as 'gitlab' | 'gitea')}
                    disabled={addBusy}
                  >
                    <option value="gitlab">GitLab</option>
                    <option value="gitea">Gitea</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Base URL</span>
                  <input
                    className="settings-input"
                    type="url"
                    placeholder="https://gitlab.acme.com"
                    value={addBaseUrl}
                    onChange={e => setAddBaseUrl(e.target.value)}
                    disabled={addBusy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Label</span>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="Acme GitLab"
                    value={addLabel}
                    onChange={e => setAddLabel(e.target.value)}
                    disabled={addBusy}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="settings-btn" disabled={addBusy}>
                  {addBusy ? 'Probing…' : 'Add host'}
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--link"
                  onClick={() => {
                    setShowAddForm(false)
                    setAddError(null)
                    setAddBaseUrl('')
                    setAddLabel('')
                  }}
                  disabled={addBusy}
                >
                  Cancel
                </button>
              </div>
              {addError && (
                <p className="settings-hint error" style={{ margin: 0 }}>{addError}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/ConnectionsPanel.tsx
git commit -m "feat(renderer): Connections pane — add-a-host form, remove, health badges"
```

---

## Task 9: Final verification + code review

- [ ] **Step 1: Run all touched specs**

```bash
npx vitest run electron/providers/gitlab/rest.test.ts electron/providers/gitea/rest.test.ts electron/ipc/hostHandlers.probe.test.ts electron/ipc/hostHandlers.healthCheck.test.ts src/hooks/useHostCapabilities.test.ts
```

Expected: every case PASSES.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`

Expected: PASS modulo the pre-existing baseline failures from earlier phases (Settings.test.tsx useNavigate, ActivityEvent release.name, ReadmeRenderer, vendor anatomy tests). If `npm test` fails on better-sqlite3 rebuild because of a file lock, the user's dev app is running — pause and ask.

- [ ] **Step 4: Dispatch a single code-reviewer agent**

Use the Agent tool with `subagent_type: 'code-reviewer'`. Scope: the full Phase 7 diff (`git diff 6715365..HEAD`). Brief it on:
- The plan path (this file).
- The HEAD-vs-Phase-6 diff covers: discriminated `ServerVersionResult` in gitlab + gitea, `hosts:probe` formatter, new `hosts:healthCheck` IPC, `repo:save` routing through `provider.getReleases`, `useHostCapabilities` cache-invalidation, `hosts:capabilities-changed` broadcast, ConnectionsPanel form/remove/health.
- Specific things to look at: any race conditions in the renderer hook's event subscription; whether the broadcast properly survives main-window recreation (`getMainWindow()` returns the live ref); whether the formatter swallows useful information for any failure mode.

- [ ] **Step 5: Hand off to the user**

Surface:
- Phase 7 complete. Self-hosted UX has an "Add a host" form with TLS-aware probe errors; Connections pane shows red dots for unreachable hosts at launch; `repo:save` `stored_version` works across hosts; capability cache invalidates on auth changes.
- The remaining `PHASE 7 FOLLOW-UP` comment in `electron/ipc/repoHandlers.ts` should be removed in Task 5's edit.
- Next: per spec there is no Phase 8. Remaining gaps (mixed-host main grid pagination, GitHub Enterprise probe, cross-host free-text) can be follow-up specs if the user wants them.
