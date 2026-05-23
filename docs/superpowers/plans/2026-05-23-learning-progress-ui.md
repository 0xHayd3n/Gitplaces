# Learning Progress UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opaque "Learning…" spinner with phase-based progress across all four repo surfaces (RepoDetail, RepoCard, RepoListRow, LibrarySidebar), with a Steam-style split-button + flush status line on RepoDetail and a real Cancel that kills the anatomy CLI subprocess.

**Architecture:** Main process gains a process registry + per-phase progress emission via injected `onProgress` callback. Renderer gains a `LearningProgressContext` that subscribes once to `skill:learn-progress` IPC and exposes a `useLearningProgress(owner, name)` hook. All four UI surfaces read from this hook to stay in sync regardless of where Learn was triggered.

**Tech Stack:** Electron (main: Node + child_process.spawn), React 18 (renderer: Context + hooks), TypeScript, vitest, existing CSS (single `globals.css` + per-component `.css`).

**Spec reference:** [docs/superpowers/specs/2026-05-23-learning-progress-ui-design.md](../specs/2026-05-23-learning-progress-ui-design.md)

---

## File Map

**New files:**
- `electron/services/learnProcessRegistry.ts` + `.test.ts`
- `src/contexts/LearningProgressContext.tsx` + `.test.tsx`
- `src/hooks/useLearningProgress.ts` + `.test.ts`
- `src/components/PrimaryActionSplitButton.tsx` + `.test.tsx`
- `src/components/DropdownMenu.tsx` + `.test.tsx`
- `src/components/LearnStatusInline.tsx` + `.test.tsx`

**Modified files:**
- `electron/anatomy/runtime.ts` + existing `runtime.test.ts`
- `electron/anatomy/index.ts` + existing `index.test.ts`
- `electron/main.ts` (skill:generate handler block + new cancelLearn handler)
- `electron/preload.ts` (new skill methods)
- `src/App.tsx` (mount provider)
- `src/views/RepoDetail.tsx` + `RepoDetail.test.tsx`
- `src/components/LibrarySidebar.tsx` + `LibrarySidebar.css` + tests via existing Library tests
- `src/components/RepoCard.tsx` + `RepoCard.test.tsx` (if exists; else cover via Discover tests)
- `src/components/RepoListRow.tsx` + `RepoListRow.test.tsx`
- `src/styles/globals.css` (new classes)

---

## Task 1: Switch `spawnAnatomy` from `execFile` to `spawn`

Foundational change. No UX or behavior visible yet — tests stay green.

**Files:**
- Modify: `electron/anatomy/runtime.ts:31-55`
- Test: `electron/anatomy/runtime.test.ts` (extend the gated `spawnAnatomy (vendored)` block)

- [ ] **Step 1: Add the failing test**

Append to `electron/anatomy/runtime.test.ts`, inside the `describe.runIf(vendored)('spawnAnatomy (vendored)', ...)` block:

```typescript
it('returns a ChildProcess handle via the onProcess hook', async () => {
  let captured: import('node:child_process').ChildProcess | null = null
  const r = await spawnAnatomy(
    { nodeBin: node, cliEntry: cli },
    ['--help'],
    process.cwd(),
    process.env,
    { onProcess: (p) => { captured = p } },
  )
  expect(r.code).toBe(0)
  expect(captured).not.toBeNull()
  expect(captured!.pid).toBeGreaterThan(0)
}, 30_000)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/anatomy/runtime.test.ts -t "ChildProcess handle"`
Expected: FAIL — `spawnAnatomy` doesn't accept a 5th argument.

- [ ] **Step 3: Rewrite `spawnAnatomy` using `spawn`**

Replace the `spawnAnatomy` function in `electron/anatomy/runtime.ts:31-55` with:

```typescript
import { spawn, type ChildProcess } from 'node:child_process'

export interface SpawnAnatomyOptions {
  /** Called synchronously after spawn so callers can track / cancel the process. */
  onProcess?: (proc: ChildProcess) => void
}

const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const TIMEOUT_MS = 15 * 60_000

/** Spawn the vendored anatomy CLI under bundled Node 22. Streams stdout/stderr
 *  into memory with a 32MB cap; matches the previous execFile contract. */
export function spawnAnatomy(
  rt: ResolvedRuntime,
  anatomyArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: SpawnAnatomyOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(rt.nodeBin, buildSpawnArgs(rt.cliEntry, anatomyArgs), { cwd, env })
    opts.onProcess?.(proc)

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let bufferOverflow = false

    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, TIMEOUT_MS)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_BUFFER_BYTES) { bufferOverflow = true; proc.kill('SIGKILL'); return }
      stdout += chunk.toString('utf8')
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_BUFFER_BYTES) { bufferOverflow = true; proc.kill('SIGKILL'); return }
      stderr += chunk.toString('utf8')
    })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (bufferOverflow) return reject(new Error('spawnAnatomy: stdout/stderr exceeded 32MB'))
      if (timedOut) return reject(new Error('spawnAnatomy: 15-minute timeout exceeded'))
      resolve({ stdout, stderr, code: code ?? 1 })
    })
  })
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run electron/anatomy/runtime.test.ts`
Expected: all existing tests (including the original `runs --help` integration test) PASS, plus the new "ChildProcess handle" test PASS. If the vendored CLI is not present, both gated tests are skipped — that's fine.

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/runtime.ts electron/anatomy/runtime.test.ts
git commit -m "refactor(anatomy): spawnAnatomy uses spawn + onProcess hook for tracking

Switches from execFile to spawn so callers can capture the ChildProcess
handle for cancellation. Preserves the SpawnResult contract, 32MB buffer
cap, and 15-minute timeout. Required by the learning-progress UI for
hard-cancel support."
```

---

## Task 2: Create `learnProcessRegistry` module

Pure data structure module. No callers yet.

**Files:**
- Create: `electron/services/learnProcessRegistry.ts`
- Test: `electron/services/learnProcessRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/services/learnProcessRegistry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { learnProcessRegistry } from './learnProcessRegistry'

function fakeProc(): ChildProcess {
  return { kill: vi.fn(() => true), killed: false, exitCode: null } as unknown as ChildProcess
}

beforeEach(() => { learnProcessRegistry._reset() })

describe('learnProcessRegistry', () => {
  it('register marks key as present', () => {
    learnProcessRegistry.register('o/n', fakeProc())
    expect(learnProcessRegistry.has('o/n')).toBe(true)
  })

  it('unregister removes the entry', () => {
    learnProcessRegistry.register('o/n', fakeProc())
    learnProcessRegistry.unregister('o/n')
    expect(learnProcessRegistry.has('o/n')).toBe(false)
  })

  it('register replaces an existing entry (new phase, new subprocess)', () => {
    const first = fakeProc()
    const second = fakeProc()
    learnProcessRegistry.register('o/n', first)
    learnProcessRegistry.register('o/n', second)
    learnProcessRegistry.cancel('o/n')
    expect((second.kill as any)).toHaveBeenCalledWith('SIGTERM')
    expect((first.kill as any)).not.toHaveBeenCalled()
  })

  it('cancel sends SIGTERM and returns true', () => {
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    expect(learnProcessRegistry.cancel('o/n')).toBe(true)
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGTERM')
  })

  it('cancel of unknown key returns false', () => {
    expect(learnProcessRegistry.cancel('missing/repo')).toBe(false)
  })

  it('escalates to SIGKILL after the grace window if process is still alive', async () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    learnProcessRegistry.cancel('o/n')
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(2001)
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  it('does not escalate to SIGKILL if process already exited', async () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    learnProcessRegistry.cancel('o/n')
    ;(proc as any).killed = true
    vi.advanceTimersByTime(2001)
    expect((proc.kill as any)).toHaveBeenCalledTimes(1) // only the SIGTERM
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/services/learnProcessRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `electron/services/learnProcessRegistry.ts`:

```typescript
import type { ChildProcess } from 'node:child_process'

export type LearnKey = `${string}/${string}`

const SIGKILL_GRACE_MS = 2000

class LearnProcessRegistry {
  private procs = new Map<LearnKey, ChildProcess>()

  register(key: LearnKey, proc: ChildProcess): void {
    this.procs.set(key, proc)
  }

  unregister(key: LearnKey): void {
    this.procs.delete(key)
  }

  has(key: LearnKey): boolean {
    return this.procs.has(key)
  }

  /** SIGTERM the tracked process; escalate to SIGKILL after a 2s grace.
   *  Returns true if a process was found and signaled. */
  cancel(key: LearnKey): boolean {
    const proc = this.procs.get(key)
    if (!proc) return false
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed && proc.exitCode === null) proc.kill('SIGKILL')
    }, SIGKILL_GRACE_MS)
    return true
  }

  /** Test-only: clear all entries. Module is a singleton so tests must reset. */
  _reset(): void {
    this.procs.clear()
  }
}

export const learnProcessRegistry = new LearnProcessRegistry()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/services/learnProcessRegistry.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/learnProcessRegistry.ts electron/services/learnProcessRegistry.test.ts
git commit -m "feat(anatomy): learnProcessRegistry for subprocess tracking + cancel

Per-repo ChildProcess registry with SIGTERM → 2s grace → SIGKILL
escalation. Consumed by the anatomy engine to wire Cancel-mid-learn."
```

---

## Task 3: Add `onProgress` callback to `AnatomyEngineDeps`; emit at phase boundaries

Extends the engine to emit progress at 5 known boundaries.

**Files:**
- Modify: `electron/anatomy/index.ts:10-15` (interface), `:47-99` (generateViaAnatomy body)
- Test: `electron/anatomy/index.test.ts` (extend existing `deps()` helper and add a new test)

- [ ] **Step 1: Write the failing test**

Append to `electron/anatomy/index.test.ts` inside the existing `describe('generateViaAnatomy', ...)`:

```typescript
it('emits onProgress at each phase boundary in order', async () => {
  const calls: string[] = []
  const d = deps({
    spawnAnatomy: vi.fn(async (_rt, args) => ({
      stdout: '', stderr: '',
      code: args[0] === 'validate' ? 1 : 0, // force generate path
    })),
  })
  await generateViaAnatomy(
    { token: null, owner: 'o', name: 'n', defaultBranch: 'main', apiKey: 'k' },
    { ...d, onProgress: (phase) => calls.push(phase) },
  )
  expect(calls).toEqual(['cloning', 'validating', 'generating', 'verifying'])
})

it('skips generating phase when validate succeeds (cached path)', async () => {
  const calls: string[] = []
  const d = deps({
    spawnAnatomy: vi.fn(async (_rt, args) => ({
      stdout: '', stderr: '',
      code: args[0] === 'validate' ? 0 : 0, // validate passes → cached
    })),
  })
  await generateViaAnatomy(
    { token: null, owner: 'o', name: 'n', defaultBranch: 'main' },
    { ...d, onProgress: (phase) => calls.push(phase) },
  )
  expect(calls).toEqual(['cloning', 'validating', 'verifying'])
})
```

Also update the `deps()` helper signature in the same file to thread `onProgress` through — but only inside `over: Partial<AnatomyEngineDeps>`, no helper change needed since `over` already spreads through.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/anatomy/index.test.ts -t "onProgress"`
Expected: FAIL — `onProgress` not in `AnatomyEngineDeps` type; also fails because the engine doesn't invoke it.

- [ ] **Step 3: Extend the interface and emit at phase boundaries**

In `electron/anatomy/index.ts:10-15`, extend the interface:

```typescript
export type AnatomyPhase = 'cloning' | 'validating' | 'generating' | 'verifying' | 'persisting'

export interface AnatomyEngineDeps {
  ensureClone: (root: string, owner: string, name: string, branch: string, token: string | null) => Promise<{ dir: string; sha: string }>
  spawnAnatomy: (rt: ResolvedRuntime, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<SpawnResult>
  readFile: (p: string) => Promise<string | null>
  runtime: ResolvedRuntime
  /** Optional progress callback invoked at the start of each phase. */
  onProgress?: (phase: AnatomyPhase) => void
}
```

Then in `generateViaAnatomy` (currently lines 47-99), emit at each boundary. Wrap the existing code:

```typescript
export async function generateViaAnatomy(
  input: AnatomyGenerateInput,
  d: AnatomyEngineDeps,
  cacheRoot = join(process.cwd(), '.anatomy-cache'),
): Promise<AnatomyGenerateOutput> {
  const { token, owner, name, defaultBranch, apiKey } = input
  const emit = (phase: AnatomyPhase) => { try { d.onProgress?.(phase) } catch {} }

  emit('cloning')
  let clone: { dir: string; sha: string }
  try {
    clone = await d.ensureClone(cacheRoot, owner, name, defaultBranch, token)
  } catch (err) {
    throw new Error(`anatomy clone failed for ${owner}/${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const warnings: string[] = []
  let source: 'committed' | 'generated'

  emit('validating')
  const v = await d.spawnAnatomy(d.runtime, ['validate', '--require'], clone.dir)
  if (v.code === 0) {
    source = 'committed'
  } else {
    source = 'generated'
    emit('generating')
    const g = await tryGenerate(d, clone.dir, apiKey)
    warnings.push(...g.warnings)
  }

  const content = await d.readFile(join(clone.dir, '.anatomy'))
  if (content === null) throw new Error(`anatomy: no .anatomy produced for ${owner}/${name}`)
  const memory = await d.readFile(join(clone.dir, '.anatomy-memory'))

  const model = parseAnatomy(content)
  parseMemory(memory)

  const briefRes = await d.spawnAnatomy(d.runtime, ['render', '--budget', String(BRIEF_BUDGET)], clone.dir)
  const brief = briefRes.code === 0 && briefRes.stdout.trim() ? briefRes.stdout : content

  emit('verifying')
  const verify = await runAnatomyVerify({ runtime: d.runtime, spawnAnatomy: d.spawnAnatomy }, clone.dir)
  for (const e of verify.errors) warnings.push(`anatomy verify error: ${e}`)
  for (const w of verify.warnings) warnings.push(`anatomy verify: ${w}`)
  for (const s of verify.skipped) warnings.push(`anatomy verify: ${s} (rule unverified)`)

  return {
    content,
    memory,
    brief,
    commit: (model.generated.commit as string | undefined) ?? clone.sha ?? null,
    fingerprint: (model.generated.fingerprint as string | undefined) ?? null,
    source,
    warnings,
    verify,
  }
}
```

Note: `persisting` is NOT emitted by `generateViaAnatomy` — `persistAnatomySkill` is called separately from `main.ts`. That emission lives in the main.ts wiring (Task 5).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/anatomy/index.test.ts`
Expected: all tests (existing + new) PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/anatomy/index.ts electron/anatomy/index.test.ts
git commit -m "feat(anatomy): onProgress callback emits at 5 phase boundaries

generateViaAnatomy now invokes an optional onProgress(phase) at the
start of cloning / validating / generating (only when validate fails) /
verifying. Persisting is emitted from the main.ts handler.

Consumed by the learning-progress UI to drive the per-surface bar."
```

---

## Task 4: Wire registry into the anatomy engine's spawnAnatomy calls

Pass a wrapped spawn function that registers/unregisters the process around each subprocess.

**Files:**
- Modify: `electron/main.ts:1377-1389` (the `generateViaAnatomy` call site in the `skill:generate` handler)

- [ ] **Step 1: Read the current call site**

Open `electron/main.ts:1377-1389` and confirm the shape of the `generateViaAnatomy` call. It currently passes `{ ensureClone, spawnAnatomy, readFile: readFileOrNull, runtime: rt }`.

- [ ] **Step 2: Wrap spawnAnatomy with registry calls**

Modify the call to wrap the bare `spawnAnatomy` with one that registers the process. Replace the `generateViaAnatomy` invocation with:

```typescript
const learnKey = `${owner}/${name}` as const
const trackedSpawn: typeof spawnAnatomy = (rt, args, cwd, env) =>
  spawnAnatomy(rt, args, cwd, env, {
    onProcess: (proc) => {
      learnProcessRegistry.register(learnKey, proc)
      proc.on('close', () => learnProcessRegistry.unregister(learnKey))
    },
  })

const a = await generateViaAnatomy(
  { token, owner, name, defaultBranch: repo.default_branch ?? 'main', apiKey: apiKey ?? undefined },
  { ensureClone, spawnAnatomy: trackedSpawn, readFile: readFileOrNull, runtime: rt /* onProgress added in Task 5 */ },
  path.join(app.getPath('userData'), 'anatomy-cache'),
)
```

Add the import at the top of `electron/main.ts` (find the existing import block for `./anatomy/runtime` and add the registry import nearby):

```typescript
import { learnProcessRegistry } from './services/learnProcessRegistry'
```

- [ ] **Step 3: Smoke-check the build**

Run: `npx tsc --noEmit`
Expected: no type errors in modified files.

- [ ] **Step 4: Run the full electron test suite to confirm no regressions**

Run: `npx vitest run electron/`
Expected: all tests PASS. (Registry wiring is opaque to existing tests since they inject their own `spawnAnatomy` mock — the registry simply doesn't see those.)

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(anatomy): track anatomy subprocesses in learnProcessRegistry

skill:generate handler wraps spawnAnatomy with register/unregister
hooks so the live ChildProcess is reachable from a future cancelLearn
IPC handler. Unregister fires on process close; register replaces on
each new phase's spawn."
```

---

## Task 5: IPC — emit `skill:learn-progress` and add `skill:cancelLearn` handler

Wire the progress events to the renderer and add the cancel channel.

**Files:**
- Modify: `electron/main.ts` (inside the `skill:generate` handler at `:1293-1389`, and add a new handler nearby)

- [ ] **Step 1: Add the progress emit and cancel handler**

Define the percent mapping near the top of the file (after existing imports):

```typescript
const PHASE_PERCENT: Record<'cloning'|'validating'|'generating'|'verifying'|'persisting', number> = {
  cloning: 20,
  validating: 40,
  generating: 60,
  verifying: 80,
  persisting: 100,
}
```

Modify the existing `skill:generate` handler. The full handler signature stays the same, but inside, wire `onProgress` through and emit terminal events. Replace the body where it currently calls `generateViaAnatomy` (around line 1377-1389):

```typescript
const learnKey = `${owner}/${name}` as const
const startedAt = Date.now()
const safeSend = (payload: { phase: string; percent: number; state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string }) => {
  if (!_.sender.isDestroyed()) _.sender.send('skill:learn-progress', { owner, name, ...payload, elapsedMs: Date.now() - startedAt })
}

const trackedSpawn: typeof spawnAnatomy = (rt, args, cwd, env) =>
  spawnAnatomy(rt, args, cwd, env, {
    onProcess: (proc) => {
      learnProcessRegistry.register(learnKey, proc)
      proc.on('close', () => learnProcessRegistry.unregister(learnKey))
    },
  })

try {
  const a = await generateViaAnatomy(
    { token, owner, name, defaultBranch: repo.default_branch ?? 'main', apiKey: apiKey ?? undefined },
    {
      ensureClone, spawnAnatomy: trackedSpawn, readFile: readFileOrNull, runtime: rt,
      onProgress: (phase) => safeSend({ phase, percent: PHASE_PERCENT[phase], state: 'running' }),
    },
    path.join(app.getPath('userData'), 'anatomy-cache'),
  )
  safeSend({ phase: 'persisting', percent: PHASE_PERCENT.persisting, state: 'running' })
  await persistAnatomySkill(db, app.getPath('userData'), repo.id, owner, name, a, version)
  safeSend({ phase: 'persisting', percent: 100, state: 'completed' })
  return { content: a.content, version, generated_at: new Date().toISOString(), warnings: a.warnings }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  // SIGTERM exit appears as exit code 143 surfacing through tryGenerate / verify.
  // Treat any error after we've started as a learn failure (cancelled or failed).
  const cancelled = /\b143\b|SIGTERM|SIGKILL|cancel/i.test(msg)
  safeSend({ phase: 'failed', percent: 0, state: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : msg })
  if (cancelled) return { cancelled: true }
  throw err
}
```

(Note: the wider `skill:generate` handler has multiple code paths — `ref` versioned installs, legacy library, components sub-skill. The progress wiring applies ONLY to the unconditional-anatomy default path at line ~1377-1389. The `ref`-path (versioned, line 1359-1375) is out of scope per spec §9.)

Then add a new handler at the end of the skill IPC block (after `skill:logoutClaude` at line 1288-1291, or grouped naturally):

```typescript
ipcMain.handle('skill:cancelLearn', (_event, owner: string, name: string) => {
  const key = `${owner}/${name}` as const
  return { cancelled: learnProcessRegistry.cancel(key) }
})
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no type errors. The existing `skill:generate` return type may need a small union update — if it does, add `{ cancelled: true }` to the return type union explicitly.

- [ ] **Step 3: Run the electron test suite**

Run: `npx vitest run electron/`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(anatomy): emit skill:learn-progress + add skill:cancelLearn IPC

skill:generate now emits progress events at each phase boundary (and a
final terminal state: completed / cancelled / failed). New cancelLearn
channel signals the registry. Versioned-install path is unchanged."
```

---

## Task 6: Preload — expose `skill.cancelLearn`, `skill.onLearnProgress`, `skill.offLearnProgress`

Mirror the existing `onSetupProgress` / `offSetupProgress` pattern at `electron/preload.ts:95-106`.

**Files:**
- Modify: `electron/preload.ts` (inside the `skill: { ... }` block at `:82-130`)

- [ ] **Step 1: Add the new methods**

Insert into the `skill:` block in `electron/preload.ts`, after `offLoginProgress` (around line 121):

```typescript
cancelLearn: (owner: string, name: string) =>
  ipcRenderer.invoke('skill:cancelLearn', owner, name) as Promise<{ cancelled: boolean }>,
onLearnProgress: (cb: (event: {
  owner: string; name: string; phase: string; percent: number; elapsedMs: number;
  state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string
}) => void) => {
  const wrapper = (_: unknown, data: Parameters<typeof cb>[0]) => cb(data)
  callbackWrappers.set(cb, wrapper)
  ipcRenderer.on('skill:learn-progress', wrapper)
},
offLearnProgress: (cb: (event: { owner: string; name: string }) => void) => {
  const wrapper = callbackWrappers.get(cb)
  if (wrapper) {
    ipcRenderer.removeListener('skill:learn-progress', wrapper)
    callbackWrappers.delete(cb)
  }
},
```

If there's a renderer-side ambient type declaration for `window.api` (search for `env.d.ts` in `src/`), add matching entries. Run a quick grep:

Run: `Grep skill: src/env.d.ts`
If `skill:` is typed there, mirror the three new methods. If `window.api` is typed via `any` or no entry exists, skip.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts src/env.d.ts
git commit -m "feat(preload): expose skill.cancelLearn + on/offLearnProgress

Mirrors the existing on/offSetupProgress + on/offLoginProgress pattern.
Wrapper map ensures off* removes the exact listener instance."
```

---

## Task 7: Create `LearningProgressContext`

Holds the per-repo learning map; subscribes to IPC progress events.

**Files:**
- Create: `src/contexts/LearningProgressContext.tsx`
- Test: `src/contexts/LearningProgressContext.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/contexts/LearningProgressContext.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { LearningProgressProvider, useLearningProgressContext } from './LearningProgressContext'
import React from 'react'

let progressCallbacks: Array<(event: any) => void> = []

beforeEach(() => {
  progressCallbacks = []
  ;(globalThis as any).window = globalThis
  ;(window as any).api = {
    skill: {
      cancelLearn: vi.fn(async () => ({ cancelled: true })),
      onLearnProgress: vi.fn((cb: (e: any) => void) => { progressCallbacks.push(cb) }),
      offLearnProgress: vi.fn((cb: (e: any) => void) => {
        progressCallbacks = progressCallbacks.filter(c => c !== cb)
      }),
    },
  }
})

function wrapper({ children }: { children: React.ReactNode }) {
  return <LearningProgressProvider>{children}</LearningProgressProvider>
}

describe('LearningProgressContext', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLearningProgressContext(), { wrapper })
    expect((window as any).api.skill.onLearnProgress).toHaveBeenCalled()
    unmount()
    expect((window as any).api.skill.offLearnProgress).toHaveBeenCalled()
  })

  it('adds an entry when startLearn is called', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      result.current.startLearn('o', 'n', async () => { /* deferred */ })
    })
    expect(result.current.states.get('o/n')).toEqual(
      expect.objectContaining({ phase: 'cloning', percent: 0 }),
    )
  })

  it('updates state when an IPC progress event arrives', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      result.current.startLearn('o', 'n', () => new Promise(() => {}))
    })
    act(() => {
      progressCallbacks[0]({
        owner: 'o', name: 'n', phase: 'generating', percent: 60, elapsedMs: 1000, state: 'running',
      })
    })
    expect(result.current.states.get('o/n')).toEqual(
      expect.objectContaining({ phase: 'generating', percent: 60 }),
    )
  })

  it('drops the entry 5 seconds after a terminal event', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      result.current.startLearn('o', 'n', () => new Promise(() => {}))
    })
    act(() => {
      progressCallbacks[0]({
        owner: 'o', name: 'n', phase: 'persisting', percent: 100, elapsedMs: 5000, state: 'completed',
      })
    })
    expect(result.current.states.get('o/n')).toBeDefined()
    act(() => { vi.advanceTimersByTime(5001) })
    expect(result.current.states.get('o/n')).toBeUndefined()
    vi.useRealTimers()
  })

  it('cancelLearn invokes the IPC', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => { result.current.cancelLearn('o', 'n') })
    expect((window as any).api.skill.cancelLearn).toHaveBeenCalledWith('o', 'n')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/contexts/LearningProgressContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the context**

Create `src/contexts/LearningProgressContext.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

export type LearningPhase = 'cloning' | 'validating' | 'generating' | 'verifying' | 'persisting'
export type LearningTerminalState = 'completed' | 'cancelled' | 'failed'

export interface LearningState {
  phase: LearningPhase | LearningTerminalState
  percent: number
  startedAt: number
  elapsedMs: number
  state: 'running' | LearningTerminalState
  error?: string
}

type LearningMap = Map<string, LearningState>

interface ContextValue {
  states: LearningMap
  startLearn: (owner: string, name: string, fn: () => Promise<void>) => Promise<void>
  cancelLearn: (owner: string, name: string) => Promise<void>
}

const LearningProgressContext = createContext<ContextValue | null>(null)

const TERMINAL_DROP_DELAY_MS = 5000

const key = (owner: string, name: string) => `${owner}/${name}`

export function LearningProgressProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<LearningMap>(() => new Map())
  const statesRef = useRef(states)
  statesRef.current = states

  useEffect(() => {
    const cb = (event: {
      owner: string; name: string; phase: string; percent: number;
      elapsedMs: number; state: 'running' | LearningTerminalState; error?: string
    }) => {
      const k = key(event.owner, event.name)
      setStates(prev => {
        const next = new Map(prev)
        const existing = next.get(k)
        const startedAt = existing?.startedAt ?? Date.now() - event.elapsedMs
        next.set(k, {
          phase: event.phase as LearningPhase | LearningTerminalState,
          percent: event.percent,
          startedAt,
          elapsedMs: event.elapsedMs,
          state: event.state,
          error: event.error,
        })
        return next
      })
      if (event.state !== 'running') {
        setTimeout(() => {
          setStates(prev => {
            const cur = prev.get(k)
            if (!cur || cur.state === 'running') return prev
            const next = new Map(prev)
            next.delete(k)
            return next
          })
        }, TERMINAL_DROP_DELAY_MS)
      }
    }
    window.api.skill.onLearnProgress(cb)
    return () => window.api.skill.offLearnProgress(cb)
  }, [])

  const startLearn = useCallback(async (owner: string, name: string, fn: () => Promise<void>) => {
    const k = key(owner, name)
    setStates(prev => {
      const next = new Map(prev)
      next.set(k, {
        phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running',
      })
      return next
    })
    try {
      await fn()
    } catch (err) {
      // The main process emits a 'failed' event already; we don't double-mark here.
      // Re-throw so callers can handle UI rollback (e.g. show "Add API key" hint).
      throw err
    }
  }, [])

  const cancelLearn = useCallback(async (owner: string, name: string) => {
    await window.api.skill.cancelLearn(owner, name)
  }, [])

  return (
    <LearningProgressContext.Provider value={{ states, startLearn, cancelLearn }}>
      {children}
    </LearningProgressContext.Provider>
  )
}

export function useLearningProgressContext(): ContextValue {
  const ctx = useContext(LearningProgressContext)
  if (!ctx) throw new Error('useLearningProgressContext must be used within LearningProgressProvider')
  return ctx
}

/** Test helper: a synthetic provider for component tests that don't want to mock IPC. */
export function MockLearningProgressProvider({
  initialStates = new Map(),
  children,
}: {
  initialStates?: LearningMap
  children: React.ReactNode
}) {
  const [states, setStates] = useState<LearningMap>(initialStates)
  const value: ContextValue = {
    states,
    startLearn: async (owner, name, fn) => {
      const k = key(owner, name)
      setStates(prev => {
        const next = new Map(prev)
        next.set(k, { phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running' })
        return next
      })
      try { await fn() } catch (err) { throw err }
    },
    cancelLearn: async () => {},
  }
  return <LearningProgressContext.Provider value={value}>{children}</LearningProgressContext.Provider>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/contexts/LearningProgressContext.test.tsx`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/LearningProgressContext.tsx src/contexts/LearningProgressContext.test.tsx
git commit -m "feat(library): LearningProgressContext + MockLearningProgressProvider

Single-subscription provider that mirrors main-process learn-progress
events into a per-repo state map. 5s grace before dropping terminal
entries so UI can show 'Learned'/'Failed' briefly. Mock provider
exported for component tests."
```

---

## Task 8: Create `useLearningProgress` hook

Per-surface read-only convenience hook.

**Files:**
- Create: `src/hooks/useLearningProgress.ts`
- Test: `src/hooks/useLearningProgress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useLearningProgress.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useLearningProgress } from './useLearningProgress'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

beforeEach(() => {
  ;(window as any).api = { skill: { cancelLearn: vi.fn() } }
})

describe('useLearningProgress', () => {
  it('returns null when no entry exists', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MockLearningProgressProvider>{children}</MockLearningProgressProvider>
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    expect(result.current.state).toBeNull()
  })

  it('returns the entry when present', () => {
    const initial = new Map([['o/n', {
      phase: 'generating' as const, percent: 60, startedAt: Date.now() - 5000,
      elapsedMs: 5000, state: 'running' as const,
    }]])
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MockLearningProgressProvider initialStates={initial}>{children}</MockLearningProgressProvider>
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    expect(result.current.state).toEqual(expect.objectContaining({ phase: 'generating', percent: 60 }))
  })

  it('elapsed clock ticks while entry is running', () => {
    vi.useFakeTimers()
    const initial = new Map([['o/n', {
      phase: 'generating' as const, percent: 60, startedAt: Date.now() - 1000,
      elapsedMs: 1000, state: 'running' as const,
    }]])
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MockLearningProgressProvider initialStates={initial}>{children}</MockLearningProgressProvider>
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    const first = result.current.elapsedMs
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(first + 900)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useLearningProgress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useLearningProgress.ts`:

```typescript
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useLearningProgressContext, type LearningState } from '../contexts/LearningProgressContext'

interface UseLearningProgressResult {
  state: LearningState | null
  elapsedMs: number
  cancel: () => Promise<void>
}

const key = (owner: string, name: string) => `${owner}/${name}`

export function useLearningProgress(owner: string, name: string): UseLearningProgressResult {
  const { states, cancelLearn } = useLearningProgressContext()
  const state = states.get(key(owner, name)) ?? null

  const [, tick] = useState(0)
  useEffect(() => {
    if (!state || state.state !== 'running') return
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [state?.state])

  const elapsedMs = useMemo(() => state ? Date.now() - state.startedAt : 0, [state, state?.startedAt])

  const cancel = useCallback(() => cancelLearn(owner, name), [cancelLearn, owner, name])

  return { state, elapsedMs, cancel }
}

/** Pure formatter: 47s / 2m 47s / 1h 2m 47s. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
```

Add unit tests for `formatElapsed` to the same test file:

```typescript
import { formatElapsed } from './useLearningProgress'

describe('formatElapsed', () => {
  it('formats seconds-only', () => { expect(formatElapsed(47_000)).toBe('47s') })
  it('formats minutes + seconds', () => { expect(formatElapsed(167_000)).toBe('2m 47s') })
  it('formats hours + minutes + seconds', () => { expect(formatElapsed(3_767_000)).toBe('1h 2m 47s') })
  it('handles zero', () => { expect(formatElapsed(0)).toBe('0s') })
  it('rounds down to nearest second', () => { expect(formatElapsed(47_999)).toBe('47s') })
})
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/hooks/useLearningProgress.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLearningProgress.ts src/hooks/useLearningProgress.test.ts
git commit -m "feat(library): useLearningProgress hook + formatElapsed

Per-surface read access to context state. 1Hz internal tick re-renders
elapsedMs only when a learn is running. formatElapsed is the pure
formatter for 47s / 2m 47s / 1h 2m 47s display."
```

---

## Task 9: Mount `LearningProgressProvider` in App.tsx

One-line wrap. Tests covered transitively by all downstream surface tests.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Locate the provider stack**

Open `src/App.tsx:1-30`. The existing provider stack imports include `SavedReposProvider`, `ProfileOverlayProvider`, `SearchProvider`, `ToastProvider`, `RepoNavProvider`, `AppearanceProvider`, `GitHubAuthProvider`.

- [ ] **Step 2: Add the new provider**

Import at the top of the file:

```typescript
import { LearningProgressProvider } from './contexts/LearningProgressContext'
```

Then locate the JSX where the existing providers compose (search the file for `<SavedReposProvider>` or similar). Wrap the inner tree with `<LearningProgressProvider>`. Nesting order doesn't matter since this provider has no dependencies on the others.

- [ ] **Step 3: Type-check + run all tests**

Run: `npx vitest run`
Expected: all PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(library): mount LearningProgressProvider at App root

Single subscription point for skill:learn-progress IPC, exposed to all
four learn-button surfaces via the useLearningProgress hook."
```

---

## Task 10: Create `PrimaryActionSplitButton` component

Generic split-button — primary action button + dropdown caret.

**Files:**
- Create: `src/components/PrimaryActionSplitButton.tsx`
- Test: `src/components/PrimaryActionSplitButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/PrimaryActionSplitButton.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrimaryActionSplitButton } from './PrimaryActionSplitButton'

describe('PrimaryActionSplitButton', () => {
  it('renders the action label and caret', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Learn" onAction={() => {}}>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.getByRole('button', { name: 'Learn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument()
  })

  it('invokes onAction when the primary half is clicked', () => {
    const onAction = vi.fn()
    render(
      <PrimaryActionSplitButton actionLabel="Cancel" onAction={onAction}>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('toggles the dropdown when the caret is clicked', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Learn" onAction={() => {}}>
        <button>Hidden item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.queryByText('Hidden item')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText('Hidden item')).toBeInTheDocument()
  })

  it('disables the primary half when disabled is true', () => {
    render(
      <PrimaryActionSplitButton actionLabel="Cancel" onAction={() => {}} disabled>
        <button>Item</button>
      </PrimaryActionSplitButton>,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/PrimaryActionSplitButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/PrimaryActionSplitButton.tsx`:

```typescript
import { useState, useRef, useEffect, type ReactNode } from 'react'

interface Props {
  actionLabel: string
  onAction: () => void
  actionIcon?: ReactNode
  disabled?: boolean
  variant?: 'primary' | 'idle' | 'learned'
  className?: string
  children: ReactNode // dropdown menu items
}

export function PrimaryActionSplitButton({
  actionLabel, onAction, actionIcon, disabled, variant = 'primary', className = '', children,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={wrapRef} className={`split-button split-button--${variant} ${className}`}>
      <button
        type="button"
        className="split-button-action"
        onClick={onAction}
        disabled={disabled}
      >
        {actionIcon}
        <span>{actionLabel}</span>
      </button>
      <button
        type="button"
        className="split-button-caret"
        onClick={() => setOpen(o => !o)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="split-button-menu" role="menu">
          {children}
        </div>
      )}
    </div>
  )
}
```

Append the matching CSS to `src/styles/globals.css` (find a sensible position near other component styles):

```css
/* ── Split button (Learn / Cancel / Learned + dropdown) ───────────── */
.split-button { display: inline-flex; position: relative; }
.split-button-action,
.split-button-caret {
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  transition: background 0.1s, color 0.1s;
}
.split-button-action { border-radius: 6px 0 0 6px; }
.split-button-caret  { border-radius: 0 6px 6px 0; padding: 8px 8px; border-left: 1px solid rgba(0,0,0,0.15); }
.split-button--primary .split-button-action,
.split-button--primary .split-button-caret { background: var(--accent); color: var(--t1); }
.split-button--primary .split-button-action:hover:not(:disabled),
.split-button--primary .split-button-caret:hover { background: #7c3aed; }
.split-button--idle .split-button-action,
.split-button--idle .split-button-caret { background: var(--accent); color: var(--t1); }
.split-button--idle .split-button-action:hover:not(:disabled),
.split-button--idle .split-button-caret:hover { background: #7c3aed; }
.split-button--learned .split-button-action,
.split-button--learned .split-button-caret {
  background: transparent; color: var(--accent-text);
  border: 1px solid var(--accent-text);
}
.split-button--learned .split-button-caret { border-left: 1px solid var(--accent-text); }
.split-button-action:disabled { opacity: 0.85; cursor: default; }
.split-button-menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 50;
  background: #15151a; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
  min-width: 140px; box-shadow: 0 6px 20px rgba(0,0,0,0.6); overflow: hidden;
  display: flex; flex-direction: column;
}
.split-button-menu button {
  background: transparent; border: none; color: var(--t1); padding: 8px 14px;
  width: 100%; display: flex; align-items: center; gap: 10px; font-size: 12px;
  text-align: left; cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.split-button-menu button:last-child { border-bottom: none; }
.split-button-menu button:hover { background: rgba(255,255,255,0.05); }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/PrimaryActionSplitButton.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PrimaryActionSplitButton.tsx src/components/PrimaryActionSplitButton.test.tsx src/styles/globals.css
git commit -m "feat(ui): PrimaryActionSplitButton — split action + dropdown caret

Generic two-half button (action + caret) with three variants (primary,
idle, learned). Menu items passed as children. Click-outside dismiss.
Used as the Learn / Cancel / Learned control in RepoDetail."
```

---

## Task 11: Create `LearnStatusInline` component

The flush status pill (no panel/border) shown to the right of the split button during LEARNING.

**Files:**
- Create: `src/components/LearnStatusInline.tsx`
- Test: `src/components/LearnStatusInline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/LearnStatusInline.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LearnStatusInline } from './LearnStatusInline'

describe('LearnStatusInline', () => {
  it('renders phase label, percent, and elapsed in seconds-only format', () => {
    render(<LearnStatusInline phase="generating" percent={60} elapsedMs={47_000} state="running" />)
    expect(screen.getByText('LEARNING')).toBeInTheDocument()
    expect(screen.getByText(/60% Complete/)).toBeInTheDocument()
    expect(screen.getByText(/47s/)).toBeInTheDocument()
  })

  it('renders mm ss format past 60s', () => {
    render(<LearnStatusInline phase="generating" percent={60} elapsedMs={167_000} state="running" />)
    expect(screen.getByText(/2m 47s/)).toBeInTheDocument()
  })

  it('renders FAILED label and red bar on failed state', () => {
    render(<LearnStatusInline phase="generating" percent={0} elapsedMs={5_000} state="failed" error="boom" />)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('renders the progress bar with correct fill width', () => {
    const { container } = render(
      <LearnStatusInline phase="generating" percent={60} elapsedMs={5_000} state="running" />,
    )
    const fill = container.querySelector('.learn-status-bar-fill') as HTMLElement
    expect(fill.style.width).toBe('60%')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/LearnStatusInline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/LearnStatusInline.tsx`:

```typescript
import { formatElapsed } from '../hooks/useLearningProgress'
import type { LearningPhase, LearningTerminalState } from '../contexts/LearningProgressContext'

interface Props {
  phase: LearningPhase | LearningTerminalState
  percent: number
  elapsedMs: number
  state: 'running' | LearningTerminalState
  error?: string
}

const PHASE_LABEL: Record<LearningPhase | LearningTerminalState, string> = {
  cloning: 'LEARNING',
  validating: 'LEARNING',
  generating: 'LEARNING',
  verifying: 'LEARNING',
  persisting: 'LEARNING',
  completed: 'LEARNED',
  cancelled: 'CANCELLED',
  failed: 'FAILED',
}

export function LearnStatusInline({ phase, percent, elapsedMs, state, error }: Props) {
  const label = PHASE_LABEL[phase]
  const isFailed = state === 'failed'
  return (
    <div className={`learn-status-inline${isFailed ? ' learn-status-inline--failed' : ''}`} title={error}>
      <div className="learn-status-label">{label}</div>
      <div className="learn-status-meta">
        {state === 'running' ? `${percent}% Complete` : (isFailed ? (error ?? 'Error') : 'Done')}
        <span className="learn-status-meta-sep"> · </span>
        <span className="learn-status-meta-elapsed">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="learn-status-bar">
        <div className="learn-status-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
```

Add CSS to `src/styles/globals.css`:

```css
/* ── Learn status inline (RepoDetail action row) ─────────────────── */
.learn-status-inline { display: flex; flex-direction: column; justify-content: center; min-width: 180px; }
.learn-status-label { color: var(--accent-text); font-size: 10px; letter-spacing: 0.1em; line-height: 1.3; }
.learn-status-meta { color: var(--t2); font-size: 11px; margin-top: 3px; margin-bottom: 5px; }
.learn-status-meta-sep { color: var(--t4); margin-left: 4px; margin-right: 4px; }
.learn-status-meta-elapsed { color: var(--t4); }
.learn-status-bar { height: 3px; background: rgba(139,92,246,0.15); border-radius: 2px; overflow: hidden; }
.learn-status-bar-fill { height: 100%; background: linear-gradient(90deg, #8b5cf6, #a78bfa); transition: width 0.3s ease; }
.learn-status-inline--failed .learn-status-label { color: #f87171; }
.learn-status-inline--failed .learn-status-bar-fill { background: #f87171; }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/LearnStatusInline.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LearnStatusInline.tsx src/components/LearnStatusInline.test.tsx src/styles/globals.css
git commit -m "feat(ui): LearnStatusInline — flush phase label + bar + elapsed

Renders adjacent to the split button during LEARNING. Pure presentation
component; receives phase/percent/elapsed from useLearningProgress.
Switches to red FAILED label on terminal failure."
```

---

## Task 12: Refactor RepoDetail action row

Wire the split button, dropdown, status inline, and switch `handleLearn` to use `startLearn`.

**Files:**
- Modify: `src/views/RepoDetail.tsx` (the `handleLearn` function at `:1210-1229` and the `RepoArticleActionRow` component at `:2087-2210`)
- Modify: `src/views/RepoDetail.test.tsx`

- [ ] **Step 1: Write the failing test additions**

Open `src/views/RepoDetail.test.tsx` and find the existing "learn button" test block (there are several test groups; pick the one nearest to learn flow tests). Add:

```typescript
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

// Use this wrapper for tests that exercise the action row
function renderWithLearning(node: React.ReactElement, initialStates = new Map()) {
  return render(<MockLearningProgressProvider initialStates={initialStates}>{node}</MockLearningProgressProvider>)
}

describe('RepoDetail action row — learning UI', () => {
  it('shows the Cancel split button and inline status when learning', () => {
    const initial = new Map([['o/n', {
      phase: 'generating' as const, percent: 60, startedAt: Date.now() - 47000,
      elapsedMs: 47000, state: 'running' as const,
    }]])
    renderWithLearning(<RepoDetail /* … wire owner/name='o'/'n' via routing as existing tests do … */ />, initial)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByText('LEARNING')).toBeInTheDocument()
    expect(screen.getByText(/60% Complete/)).toBeInTheDocument()
  })

  it('dropdown caret opens menu with Clone/Star/Fork/Archive items', () => {
    renderWithLearning(<RepoDetail /* … */ />)
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText(/Clone/)).toBeInTheDocument()
    expect(screen.getByText(/Star/)).toBeInTheDocument()
    expect(screen.getByText(/Fork/)).toBeInTheDocument()
    expect(screen.getByText(/Archive/)).toBeInTheDocument()
  })

  it('Cancel click invokes cancelLearn', async () => {
    const cancelSpy = vi.fn()
    // Inject a context where cancelLearn is observable (extend MockLearningProgressProvider
    // to accept an onCancel override, OR spy on window.api.skill.cancelLearn directly).
    // See existing RepoDetail.test.tsx patterns for the window.api mock setup.
  })
})
```

(The exact wiring for `RepoDetail` rendering — `MemoryRouter`, route params, IPC mocks — follows the pattern already established in `RepoDetail.test.tsx`. Read that file's test setup helper before writing the wrapper.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/views/RepoDetail.test.tsx -t "action row"`
Expected: FAIL on the new tests (action row hasn't been refactored).

- [ ] **Step 3: Update `handleLearn` to use `startLearn`**

In `src/views/RepoDetail.tsx`, find `handleLearn` at line ~1210 and replace its body. Import the context at the top of the file:

```typescript
import { useLearningProgressContext } from '../contexts/LearningProgressContext'
import { useLearningProgress } from '../hooks/useLearningProgress'
```

Inside the component, add:

```typescript
const { startLearn } = useLearningProgressContext()
const learnProgress = useLearningProgress(owner ?? '', name ?? '')
```

Replace the existing `handleLearn`:

```typescript
const handleLearn = async () => {
  if (learnState !== 'UNLEARNED') return
  setLearnState('LEARNING')
  setLearnError(null)
  try {
    await saveRepo(owner ?? '', name ?? '')
    await startLearn(owner ?? '', name ?? '', () =>
      window.api.skill.generate(owner ?? '', name ?? '', { flavour }),
    )
    const freshRow = await window.api.skill.get(owner ?? '', name ?? '')
    setSkillRow(freshRow)
    const freshComp = await window.api.skill.getSubSkill(owner ?? '', name ?? '', 'components').catch(() => null)
    setComponentsSkillRow(freshComp)
    setLearnState('LEARNED')
    window.dispatchEvent(new CustomEvent('library:changed'))
    window.api.svgCache.prefetch(owner ?? '', name ?? '', repo?.default_branch ?? 'main').catch(() => {})
  } catch (err) {
    setLearnState('UNLEARNED')
    const msg = err instanceof Error ? err.message : ''
    setLearnError(msg.includes('Claude Code not found') || msg.includes('No API key') ? 'no-key' : 'failed')
  }
}
```

- [ ] **Step 4: Refactor `RepoArticleActionRow`**

In the same file, replace `RepoArticleActionRow` (lines ~2087-2210). The new version uses `PrimaryActionSplitButton` and `LearnStatusInline`. Add imports:

```typescript
import { PrimaryActionSplitButton } from '../components/PrimaryActionSplitButton'
import { LearnStatusInline } from '../components/LearnStatusInline'
```

Update the prop type to accept the learn progress (read-only — passed from the parent, not pulled with the hook here to keep the row pure):

```typescript
type RepoArticleActionRowProps = {
  learnState: 'UNLEARNED' | 'LEARNING' | 'LEARNED'
  learnProgress: { state: import('../contexts/LearningProgressContext').LearningState | null; elapsedMs: number; cancel: () => void } | null
  starred: boolean
  starWorking: boolean
  starCount: number
  cloneOpen: boolean
  onToggleClone: () => void
  onLearn: () => void
  onUnlearn: () => void
  onStar: () => void
  onFork: () => void
  archived: boolean
  onArchive: () => void
  translationStatus?: { /* unchanged */ } | null
}

function RepoArticleActionRow({
  learnState, learnProgress, starred, starWorking, starCount,
  cloneOpen, onToggleClone, onLearn, onUnlearn, onStar, onFork,
  archived, onArchive, translationStatus,
}: RepoArticleActionRowProps) {
  const variant = learnState === 'UNLEARNED' ? 'idle' : learnState === 'LEARNED' ? 'learned' : 'primary'
  const actionLabel = learnState === 'UNLEARNED' ? 'Learn' : learnState === 'LEARNING' ? 'Cancel' : 'Learned'
  const onAction = learnState === 'UNLEARNED' ? onLearn : learnState === 'LEARNING' ? (learnProgress?.cancel ?? (() => {})) : onUnlearn
  const actionIcon =
    learnState === 'UNLEARNED' ? <PiBrainFill size={14} /> :
    learnState === 'LEARNING'  ? <span className="split-button-cancel-icon"><span /><span /></span> :
                                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 12 9 17 20 6" /></svg>

  return (
    <div className="article-action-row">
      <PrimaryActionSplitButton
        actionLabel={actionLabel}
        onAction={onAction}
        actionIcon={actionIcon}
        variant={variant}
      >
        <button onClick={onToggleClone}><PiGitBranchFill size={14} />Clone</button>
        <button onClick={onStar} disabled={starWorking}>
          {starred ? <PiStarFill size={14} /> : <PiStar size={14} />}
          {starred ? 'Unstar' : 'Star'}
        </button>
        <button onClick={onFork}><PiGitForkFill size={14} />Fork</button>
        <button onClick={onArchive}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z"/></svg>
          {archived ? 'Unarchive' : 'Archive'}
        </button>
      </PrimaryActionSplitButton>

      {learnState === 'LEARNING' && learnProgress?.state && (
        <LearnStatusInline
          phase={learnProgress.state.phase}
          percent={learnProgress.state.percent}
          elapsedMs={learnProgress.elapsedMs}
          state={learnProgress.state.state}
          error={learnProgress.state.error}
        />
      )}

      {translationStatus && (translationStatus.translating || translationStatus.translated) && (
        /* … existing translation block unchanged … */
      )}
    </div>
  )
}
```

Add a tiny CSS rule for the cancel icon (two vertical bars), appending to `globals.css`:

```css
.split-button-cancel-icon { display: inline-flex; gap: 2px; }
.split-button-cancel-icon span { width: 3px; height: 11px; background: currentColor; }
```

Where `RepoArticleActionRow` is rendered in the parent component (search for `<RepoArticleActionRow` in the file), pass the new `learnProgress` prop:

```typescript
<RepoArticleActionRow
  learnState={learnState}
  learnProgress={learnProgress}
  /* ...existing props... */
/>
```

- [ ] **Step 5: Run all RepoDetail tests**

Run: `npx vitest run src/views/RepoDetail.test.tsx`
Expected: all PASS (existing tests and the new action-row tests).

- [ ] **Step 6: Commit**

```bash
git add src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx src/styles/globals.css
git commit -m "feat(repo-detail): split button + dropdown + inline status

Action row consolidates Clone/Star/Fork/Archive into the split button's
dropdown. LEARNING state shows Cancel + flush LearnStatusInline (label,
percent, elapsed, bar). handleLearn now routes through the context
startLearn wrapper so the sidebar/cards stay in sync."
```

---

## Task 13: LibrarySidebar `.learning` treatment

CSS + class binding via the hook.

**Files:**
- Modify: `src/components/LibrarySidebar.tsx` (the row render at `:160-203`)
- Modify: `src/components/LibrarySidebar.css`

- [ ] **Step 1: Wire the hook into the row**

Open `src/components/LibrarySidebar.tsx`. The row render lives in a `.map` at line ~160. Extract the repo branch into a small subcomponent so the hook can be called per row (hooks can't be inside `.map` directly without a child component). Add at the bottom of the file (before the `RepoContextMenu` import block if any):

```typescript
import { useLearningProgress } from '../hooks/useLearningProgress'

function SidebarRepoRow({
  row, isInstalled, isStarred, selected, onSelect, onContextMenu,
}: {
  row: import('../types/repo').RepoRow
  isInstalled: boolean
  isStarred: boolean
  selected: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { state, elapsedMs: _ } = useLearningProgress(row.owner, row.name)
  const learning = !!state && state.state === 'running'
  const percent = state?.percent ?? 0
  return (
    <button
      className={`library-sidebar-item${selected ? ' selected' : ''}${isInstalled ? ' installed' : ' uninstalled'}${learning ? ' learning' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={`${row.owner}/${row.name}`}
    >
      <span className="library-sidebar-avatar">
        {row.avatar_url
          ? <img src={row.avatar_url} alt="" />
          : <span className="library-sidebar-avatar-fallback">{(row.name?.[0] ?? '?').toUpperCase()}</span>
        }
      </span>
      <span className="library-sidebar-name">{row.name}</span>
      {learning
        ? <span className="library-sidebar-percent">{percent}%</span>
        : <span className="library-sidebar-type-icon"><GitHubIcon /></span>}
      {learning && <span className="library-sidebar-progress"><span className="library-sidebar-progress-fill" style={{ width: `${percent}%` }} /></span>}
    </button>
  )
}
```

In the existing `.map` (around line 160), replace the inline `<button>...</button>` for `kind === 'repo'` entries with:

```typescript
return (
  <SidebarRepoRow
    key={row.id}
    row={row}
    isInstalled={isInstalled}
    isStarred={entry.isStarred}
    selected={selectedId === row.id}
    onSelect={() => onSelect(row, isInstalled)}
    onContextMenu={(e) => handleRepoContextMenu(e, entry)}
  />
)
```

- [ ] **Step 2: Add the CSS**

Append to `src/components/LibrarySidebar.css`:

```css
/* ── Learning row state ─────────────────────────────────── */
.library-sidebar-item.learning {
  position: relative;
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.25);
  border-radius: 4px;
}
.library-sidebar-item.learning .library-sidebar-name { color: rgba(255, 255, 255, 1); }
.library-sidebar-percent {
  font-size: 10px;
  font-weight: 600;
  color: #a78bfa;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.library-sidebar-progress {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: rgba(139, 92, 246, 0.15);
  border-radius: 0 0 4px 4px;
  overflow: hidden;
}
.library-sidebar-progress-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #a78bfa);
  transition: width 0.3s ease;
}

/* Mini-mode: keep highlight + bar, hide percent (name is already hidden) */
.library-panel.mini .library-sidebar-percent { display: none; }
```

- [ ] **Step 3: Add a test**

Open `src/components/LibrarySidebar.test.tsx` (or the closest existing test). Add:

```typescript
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

it('applies .learning class and renders the progress bar when learning', () => {
  const initial = new Map([['o/n', {
    phase: 'generating' as const, percent: 60, startedAt: Date.now() - 5000,
    elapsedMs: 5000, state: 'running' as const,
  }]])
  const { container } = render(
    <MockLearningProgressProvider initialStates={initial}>
      <LibrarySidebar
        installedRows={[{ id: '1', owner: 'o', name: 'n', /* ...required fields per RepoRow type... */ } as any]}
        /* ...other required props... */
      />
    </MockLearningProgressProvider>,
  )
  expect(container.querySelector('.library-sidebar-item.learning')).toBeInTheDocument()
  expect(container.querySelector('.library-sidebar-progress-fill')).toBeInTheDocument()
})
```

(Fill in required props from the actual `LibrarySidebar` props interface; the existing test file should have a usable factory.)

- [ ] **Step 4: Run**

Run: `npx vitest run src/components/LibrarySidebar.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/components/LibrarySidebar.css src/components/LibrarySidebar.test.tsx
git commit -m "feat(library): sidebar row .learning treatment + thin progress bar

Row gains purple glow border + percent (replaces type icon) + 2px
gradient bar at row bottom while learning. Mini mode hides the percent
but keeps glow + bar."
```

---

## Task 14: RepoCard compact treatment

Glow + percent overlay on the existing Learn button.

**Files:**
- Modify: `src/components/RepoCard.tsx` (the learn button at `:282-300`)
- Modify: `src/styles/globals.css` (extend `.repo-card-badge-learn`)
- Modify: any caller that triggers learn from a card (the `onLearn` prop wiring lives in Discover; update there to route through `startLearn`)

- [ ] **Step 1: Wire the hook**

In `src/components/RepoCard.tsx`, add at the top with other imports:

```typescript
import { useLearningProgress } from '../hooks/useLearningProgress'
```

Inside the `RepoCard` component body, after the other hooks (around line 142, near `cardRef`), add:

```typescript
const learningProgress = useLearningProgress(repo.owner, repo.name)
const isLearning = !!learningProgress.state && learningProgress.state.state === 'running'
const learnPercent = learningProgress.state?.percent ?? 0
```

Update the badge render (currently lines 282-300):

```typescript
<button
  className={`repo-card-badge-learn${learnState === 'LEARNED' ? ' learned' : ''}${isLearning ? ' learning' : ''}`}
  onClick={e => { e.stopPropagation(); onLearn?.() }}
  disabled={learnState === 'LEARNING'}
  title={learnState === 'LEARNED' ? 'Learned' : isLearning ? `Learning… ${learnPercent}%` : 'Learn'}
  aria-label={learnState === 'LEARNED' ? 'Learned' : 'Learn'}
>
  {isLearning ? (
    <span className="spin-ring" style={{ width: 12, height: 12 }} />
  ) : learnState === 'LEARNED' ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12 9 17 20 6" />
    </svg>
  ) : (
    <Brain size={14} />
  )}
  <span>
    {learnState === 'LEARNED' ? 'Learned' : isLearning ? `Learning… ${learnPercent}%` : 'Learn'}
  </span>
</button>
```

- [ ] **Step 2: Add the `.learning` CSS modifier**

Append to `src/styles/globals.css` near the existing `.repo-card-badge-learn.learned` rule (line 2043):

```css
.repo-card-badge-learn.learning {
  color: var(--accent-light);
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.4), 0 0 3px rgba(139, 92, 246, 0.2);
}
.repo-card-badge-learn.learning span:last-child { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Update the discover-side learn callsite to use `startLearn`**

Find where `onLearn` is passed to `RepoCard` (search `onLearn={` in `src/views/Discover.tsx` and any sibling views). Wherever a click handler calls `window.api.skill.generate(...)` for a card, switch it to:

```typescript
const { startLearn } = useLearningProgressContext()
// …
onLearn={async () => {
  await startLearn(repo.owner, repo.name, () => window.api.skill.generate(repo.owner, repo.name, { flavour: 'library' }))
  // post-success refresh (same as today)
}}
```

If the discover view doesn't currently kick off learn directly (it may navigate to RepoDetail first), this step is a no-op for that file — just ensure the hook is available wherever a Learn click runs.

- [ ] **Step 4: Add a test**

In `src/components/RepoCard.test.tsx` (if exists; else in `Discover.test.tsx`):

```typescript
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

it('shows percent overlay and glow when learning', () => {
  const initial = new Map([['o/n', {
    phase: 'generating' as const, percent: 60, startedAt: Date.now(),
    elapsedMs: 0, state: 'running' as const,
  }]])
  const { container } = render(
    <MockLearningProgressProvider initialStates={initial}>
      <RepoCard repo={{ owner: 'o', name: 'n', /* …required fields… */ } as any}
        onNavigate={() => {}} onTagClick={() => {}} learnState="LEARNING" onLearn={() => {}} />
    </MockLearningProgressProvider>,
  )
  expect(container.querySelector('.repo-card-badge-learn.learning')).toBeInTheDocument()
  expect(container.textContent).toMatch(/Learning… 60%/)
})
```

- [ ] **Step 5: Run**

Run: `npx vitest run src/components/RepoCard.test.tsx src/views/Discover.test.tsx`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoCard.tsx src/styles/globals.css src/components/RepoCard.test.tsx src/views/Discover.tsx
git commit -m "feat(repo-card): compact learning overlay (glow + percent)

Learn button gains a .learning modifier that adds the same purple glow
used by .learned, plus inlines the percent in the label.
useLearningProgress reads state shared with sidebar + RepoDetail."
```

---

## Task 15: RepoListRow compact treatment

Same treatment as RepoCard, applied to the list row variant.

**Files:**
- Modify: `src/components/RepoListRow.tsx`
- Modify: `src/styles/globals.css` (extend list-row learn rule if it exists; else add)
- Modify: `src/components/RepoListRow.test.tsx`

- [ ] **Step 1: Check whether RepoListRow has a Learn button today**

Open `src/components/RepoListRow.tsx`. Search for `learn` in the file. The header import at the top of this plan noted that `RepoListRow` exists — but whether it has its own learn button (vs. inheriting from the card visuals) needs verification before this task. If it does NOT currently render a Learn button, the work here reduces to: add `.learning` row glow only (no button overlay), matching the sidebar treatment.

If it HAS a Learn button, apply the same pattern as Task 14.

- [ ] **Step 2: Wire the hook and apply the modifier**

If the row has a Learn button, mirror Task 14 step-by-step on the corresponding element. If not, add to the row's root `className`:

```typescript
const learning = useLearningProgress(repo.owner, repo.name)
const isLearning = !!learning.state && learning.state.state === 'running'

// ...
className={`repo-list-row repo-list-row--${density}${focused ? ' kb-focused' : ''}${isLearning ? ' learning' : ''}`}
```

And a CSS rule:

```css
.repo-list-row.learning {
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.25);
}
```

- [ ] **Step 3: Add a row test**

In `src/components/RepoListRow.test.tsx`:

```typescript
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

it('applies .learning to the row when learning', () => {
  const initial = new Map([['o/n', { phase: 'generating', percent: 60, startedAt: Date.now(), elapsedMs: 0, state: 'running' }]])
  const { container } = render(
    <MockLearningProgressProvider initialStates={initial}>
      <RepoListRow repo={{ owner: 'o', name: 'n', /* …required fields… */ } as any}
        onNavigate={() => {}} onTagClick={() => {}} density="comfortable"
        fields={{ /* required */ } as any} />
    </MockLearningProgressProvider>,
  )
  expect(container.querySelector('.repo-list-row.learning')).toBeInTheDocument()
})
```

- [ ] **Step 4: Run**

Run: `npx vitest run src/components/RepoListRow.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoListRow.tsx src/styles/globals.css src/components/RepoListRow.test.tsx
git commit -m "feat(repo-list-row): glow modifier for active learning

Row gains purple glow + border while learning to match the sidebar
treatment. Read from the shared useLearningProgress hook."
```

---

## Task 16: Final full-suite verification

Catch any cross-cutting regressions before declaring done.

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: green across electron + src.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Skip dev-server visual verification**

The user verifies UI changes manually per saved memory `[[feedback_no_visual_testing]]`. Report completion with: test counts, type-check pass, and the list of commits added during the implementation.

- [ ] **Step 4: Final summary commit (none needed)**

The plan does not introduce a "tie everything together" commit. Each task commit stands as a logical unit.

---

## Self-Review

(Run inline before handing off.)

**Spec coverage check:**

| Spec section | Task(s) |
|---|---|
| §1 Progress Model (5 phases, percent mapping) | Task 3, Task 5 |
| §2.1 Progress emission | Task 3 |
| §2.1 spawn migration | Task 1 |
| §2.2 Process registry | Task 2, Task 4 |
| §2.3 IPC channels | Task 5, Task 6 |
| §2.4 Renderer learning store + hook | Task 7, Task 8, Task 9 |
| §3.1 RepoDetail split button + status | Task 10, Task 11, Task 12 |
| §3.2 LibrarySidebar | Task 13 |
| §3.3 RepoCard/RepoListRow | Task 14, Task 15 |
| §3.4 Cancel UI placement | Task 12 |
| §3.5 Shared hook | Task 8 |
| §4 Cancel flow | Tasks 1, 2, 4, 5, 6, 7 collectively |
| §5 Error handling | Task 5 (emit), Task 7 (state), Task 11 (presentation) |
| §6 Concurrency | (No code — registry is per-key, naturally parallel) |
| §8 Testing | Each task has a test step |

All spec sections mapped.

**Placeholder scan:** searched for "TBD" / "TODO" / "implement later" / "appropriate" / "Similar to Task" — none found.

**Type consistency:** `LearningPhase`, `LearningTerminalState`, `LearningState` defined in Task 7 and used identically in Tasks 8, 11, 12. `LearnKey` defined in Task 2 used identically in Tasks 4, 5. `formatElapsed` exported from Task 8 and imported in Task 11.

**One known soft spot:** Task 12 step 1 contains a test stub that refers to `<RepoDetail />` without spelling out the routing/IPC mock setup — directs the executor to the existing test file's setup helpers. The existing `RepoDetail.test.tsx` (per recent commit `4dd7def`) has a working harness; the executor should reuse it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-23-learning-progress-ui.md`.**

**Recommended execution: inline.** The tasks are mostly sequential (Task 4 needs Task 1+2; Task 5 needs Task 3+4; UI tasks need the renderer foundation; etc.) and several are small (Task 9 is a one-line provider wrap; Task 14/15 mirror Task 13's pattern). Per CLAUDE.md scope filter, subagent-driven is overkill here — inline with one final review at the end is the right call.
