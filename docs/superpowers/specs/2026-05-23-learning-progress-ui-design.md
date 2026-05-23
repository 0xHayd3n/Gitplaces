# Learning Progress UI Design

## Summary

Make repository learning a visible, observable activity rather than an opaque spinner. When a user clicks Learn on any surface (RepoDetail, RepoCard, RepoListRow, LibrarySidebar), all four surfaces show synchronized progress: which of 5 phases is running, what percent complete, how long it's been going. The RepoDetail action row gets a Steam-style split-button (Cancel ▼) with a flush status line + thin progress bar to its right; the sidebar row gets a thin inline bar; cards and list rows get a compact glow + percent on the existing Learn button. Cancel actually kills the underlying anatomy CLI subprocess.

## Goals

- Replace the existing "Learning…" spinner with phase-named progress that reflects real work boundaries.
- Keep every surface that shows a Learn button in sync regardless of where the user triggered Learn.
- Give users a real Cancel that kills the running subprocess, not a UI-only abort.
- Consolidate the RepoDetail action row by moving secondary actions (Clone, Star, Fork, Archive) into a split-button dropdown alongside the primary action.

## Non-Goals

- Real-time byte-rate or token-rate metering (anatomy CLI doesn't emit these; we'd have to lie).
- Sub-phase progress inside `generating` (would require modifying the vendored anatomy CLI).
- ETA / time-remaining estimates (would require historical durations the app doesn't track yet).
- Concurrency caps or queueing — current behavior of unlimited parallel learns is preserved.
- Retry button on failure (user can click Learn again).
- Notifications/toasts — failures surface inline at the source surface.

## 1. Progress Model

Learning has 5 phases derived from the existing flow in `electron/anatomy/index.ts:47-99`. Each maps to a distinct `spawnAnatomy` call or I/O block, so progress emission points are clean and don't require modifying the anatomy CLI.

| # | Phase key | Label shown | Where it starts | Completion |
|---|-----------|-------------|-----------------|------------|
| 1 | `cloning` | CLONING | Before `ensureClone` | Clone returns `{ dir, sha }` |
| 2 | `validating` | VALIDATING | Before `spawnAnatomy(['validate', '--require'])` | Validate process exits |
| 3 | `generating` | GENERATING | Before `tryGenerate` (only if validate failed) | `tryGenerate` returns (may have internally tried up to 3 providers) |
| 4 | `verifying` | VERIFYING | Before `runAnatomyVerify` | Verify returns |
| 5 | `persisting` | PERSISTING | Before `persistAnatomySkill` DB write | DB commit + skill row fetch returns |

**Percent = (completedPhases / 5) × 100**, snapping to 20% / 40% / 60% / 80% / 100% at phase boundaries.

When validate succeeds (cached path), phase 3 is skipped — percent jumps from 20% → 80% → 100% rapidly. This is accurate behavior, not a bug. Most user-visible time is spent at 60% (during GENERATING) — also accurate, since generate is the dominant cost.

Terminal phase states: `completed`, `cancelled`, `failed`. These end the entry's lifecycle.

## 2. Architecture

Three new pieces of infrastructure:

### 2.1 Progress emission (main process)

`electron/anatomy/index.ts` gains an injected `onProgress?: (phase: PhaseKey) => void` callback in `AnatomyEngineDeps`. `generateViaAnatomy` invokes it at each phase boundary. The callback is optional so existing tests that don't pass it keep working.

`spawnAnatomy` migrates from `execFile` to `spawn`:

- `execFile` returns only the final `{stdout, stderr, code}` and provides no early `ChildProcess` handle — Cancel can't reach the subprocess.
- `spawn` returns the handle synchronously; we wrap it in a Promise that resolves with the same `SpawnResult` shape so callers don't change. stdout/stderr are buffered manually with the same 32 MB cap.

The handle is registered in the process registry (§2.2) for the lifetime of the spawn.

### 2.2 Process registry (main process)

New `electron/services/learnProcessRegistry.ts`:

```typescript
type LearnKey = `${string}/${string}` // owner/name

interface LearnProcessRegistry {
  register(key: LearnKey, proc: ChildProcess): void
  unregister(key: LearnKey): void
  cancel(key: LearnKey): boolean  // returns true if a process was killed
  has(key: LearnKey): boolean
}
```

Cancel semantics: `SIGTERM` immediately, then `SIGKILL` after a 2-second grace if the process is still alive. The registry tracks only the *current* anatomy CLI subprocess for a given repo (validate, generate, verify, or render — only one runs at a time per learn). When a phase completes, the previous handle is unregistered before the next is registered.

The registry is module-scoped (singleton) in main process.

### 2.3 IPC channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `skill:learn-progress` | main → renderer (push) | `{ owner, name, phase, percent, elapsedMs, state }` where `state ∈ 'running' \| 'completed' \| 'cancelled' \| 'failed'` |
| `skill:cancelLearn` | renderer → main (invoke) | `(owner, name) → { cancelled: boolean }` |

`skill:generate` (existing) is modified: its handler creates a per-call progress emitter that wraps `event.sender.send('skill:learn-progress', ...)`, passes it down through `AnatomyEngineDeps.onProgress`, and emits a final terminal-state event (`completed` / `cancelled` / `failed`) before returning.

The `skill:generate` Promise still resolves with the existing shape on success and rejects on failure — adding the progress stream doesn't change the request/response contract.

### 2.4 Renderer learning store

New `src/contexts/LearningProgressContext.tsx`:

```typescript
interface LearningState {
  phase: PhaseKey | 'cancelled' | 'failed' | 'completed'
  percent: number
  startedAt: number  // ms timestamp; UI derives elapsed live
  error?: string
}

type LearningMap = Map<string, LearningState>  // key: "owner/name"

const LearningProgressContext = React.createContext<{
  states: LearningMap
  startLearn: (owner: string, name: string, fn: () => Promise<void>) => Promise<void>
  cancelLearn: (owner: string, name: string) => void
}>(...)
```

The provider mounts once at App level. It:

1. Subscribes to `skill:learn-progress` events on mount, updates the map.
2. Drops entries on terminal states (`completed` / `cancelled` / `failed`) after a 5s grace so the final state stays visible briefly.
3. Provides `startLearn(owner, name, fn)` where `fn` is the caller's existing IPC invocation (typically `() => window.api.skill.generate(owner, name, opts)`). The context adds the entry to the map immediately (state=`running`, phase=`cloning`, percent=0), then awaits `fn()`. This guarantees the map is populated before the first IPC progress event arrives. Existing `handleLearn` callsites in `RepoDetail.tsx:1210`, `Discover` cards, and list rows all switch to this wrapper.
4. Runs a single 1Hz `setInterval` only when the map is non-empty, to trigger re-renders for elapsed-time displays.

Hook `useLearningProgress(owner, name)`: returns `{ state, cancel }` where `state` is null if the repo isn't learning. Used by all four UI surfaces.

The existing per-component `learnState` (UNLEARNED / LEARNING / LEARNED) — backed by the persisted `skills` DB row — is **kept**. It represents committed state. The new context layers *transient* progress on top during the LEARNING window only.

## 3. UI Components

### 3.1 RepoDetail action row (biggest change)

Refactor `RepoArticleActionRow` (`src/views/RepoDetail.tsx:2087-2210`) into:

```
[ Primary action ▼ ]   [ flush status inline (if LEARNING) ]
```

The standalone Clone / Star / Fork / Archive buttons are **removed** from the row — they move into the dropdown.

**`<PrimaryActionSplitButton>`** (new component): two-half pill button.

- Left half: state-driven action button. `Learn` (UNLEARNED) / `Cancel` (LEARNING) / `Learned` (LEARNED). Same purple primary styling across states; icon swaps (Brain / pause-bars / checkmark).
- Right half: ▼ caret. Always visible. Click toggles dropdown.

**`<DropdownMenu>`** (new): floats below the split button. Items always include Clone, Star, Fork, Archive (wired to the same handlers used today). Star item's label is "Star" / "Unstar" based on current state. Archive item's label is "Archive" / "Unarchive".

**`<LearnStatusInline>`** (new): rendered to the right of the split button only when `learnState === 'LEARNING'`. Flat — no panel, no border, no glow background. Three stacked elements:

```
LEARNING                       (10px purple, 0.1em letter-spacing)
60% Complete  ·  47s          (11px light grey, dot separator)
[━━━━━━━━━────────]            (3px gradient bar, sized to column min-width 180px)
```

Time format: `47s` / `2m 47s` / `1h 2m 47s` (last is defensive).

Existing translation-status block stays on the right edge of the row, unchanged.

### 3.2 LibrarySidebar row

`library-sidebar-item` gains a `.learning` modifier class (driven by context lookup):

- Preserves existing row height and avatar/name/icon layout.
- Type-icon slot is reused to show "60%" text (purple, 10px, monospace-aligned).
- A 2px gradient bar is appended at the row's bottom edge (absolute-positioned within the row, full width).
- Row gets a 1px purple border + soft glow (`box-shadow: 0 0 10px rgba(139,92,246,0.25)`).

### 3.3 RepoCard and RepoListRow

`.repo-card-badge-learn` gains a `.learning` modifier:

- Reuses the existing purple-glow border styling that today applies to `.learned`.
- Button label text becomes `Learning… 60%` (existing spinner stays as the inline icon).
- No dropdown, no bar — those surfaces are too small.

`RepoListRow` follows the same pattern with its row-internal Learn button.

### 3.4 Cancel UI placement

The Cancel button exists only in the RepoDetail split button. Sidebar rows, cards, and list rows show progress as read-only. If a user starts a learn from a card or sidebar and wants to cancel, they navigate to RepoDetail (one click on the row) and cancel there. This keeps the smaller surfaces uncluttered.

### 3.5 Shared hook

`src/hooks/useLearningProgress.ts`:

```typescript
function useLearningProgress(owner: string, name: string): {
  state: LearningState | null
  cancel: () => void
}
```

Returns `null` when the repo isn't in the learning map, so render branches stay simple (`if (!state) return <NormalUI />`).

## 4. Cancel Flow

1. User clicks Cancel button (RepoDetail) → handler calls `cancel()` from `useLearningProgress`.
2. Hook calls `window.api.skill.cancelLearn(owner, name)`.
3. Main process: `learnProcessRegistry.cancel(key)` sends SIGTERM to the current subprocess; after 2s grace, SIGKILL if still alive.
4. The active `spawnAnatomy` rejects with a typed `CancelledError`.
5. `tryGenerate` / `generateViaAnatomy` catches and rethrows as `LearnCancelledError`.
6. The `skill:generate` handler catches `LearnCancelledError`, emits a final `{ state: 'cancelled' }` progress event, returns `{ cancelled: true }` to the original caller.
7. Renderer context receives `cancelled` event → drops entry from map after 5s grace.
8. UI returns to UNLEARNED (or LEARNED if it was a relearn-mid-flight).

**No partial DB writes**: `persistAnatomySkill` is phase 5 (last). Earlier phases produce only filesystem artifacts in the anatomy cache (clone dir, generated `.anatomy`), which are safe to leave — a subsequent learn reuses or overwrites them.

**No confirmation dialog**: a misclick is recoverable (just click Learn again, anatomy cache may even hit the validate path and finish in seconds). A dialog would add friction without value.

## 5. Error Handling

Three failure modes, all surface the same way: a `{ state: 'failed', phase, error }` event from the main process.

1. **Generate fails (all 3 AI providers exhausted)** — existing `tryGenerate` throws. We catch in the handler, emit failed event with `error: msg`.
2. **Other phase throws** (clone / validate / verify / persist) — emit failed event with the failing phase name.
3. **Subprocess dies unexpectedly** (OOM, signal from outside) — `spawn`'s `error` or non-zero `close` event triggers the same failed event.

UI behavior:

- `<LearnStatusInline>` (RepoDetail) switches its label from `LEARNING` to `FAILED` (red). Meta line shows the error message (truncated to ~80 chars; full text in `title` tooltip).
- Sidebar row drops its bar, keeps the purple border briefly red-tinted, type-icon shows "!" instead of percent.
- Card/row Learn buttons show `Failed` text briefly.
- After 5s, the context drops the entry and all surfaces revert to UNLEARNED. User can click Learn again.

No retry button in v1.

## 6. Concurrency

No new caps. Users can start parallel learns on N repos; each gets its own subprocess and its own entry in the progress map. The registry uses `owner/name` as the key so concurrent learns of different repos don't collide.

Starting a learn for a repo that's already learning is a no-op (button is disabled by state checks in each surface).

## 7. Files Changed

| Area | Files | Change |
|------|-------|--------|
| Main: anatomy engine | `electron/anatomy/index.ts` | Add `onProgress` to `AnatomyEngineDeps`, invoke at phase boundaries |
| Main: anatomy runtime | `electron/anatomy/runtime.ts` | Switch `spawnAnatomy` from `execFile` to `spawn`; integrate registry register/unregister |
| Main: registry (new) | `electron/services/learnProcessRegistry.ts` | New module |
| Main: IPC | `electron/main.ts` | Wire `skill:generate` progress emit; add `skill:cancelLearn` handler |
| Preload | `electron/preload.ts` | Expose `skill.cancelLearn` invoke; expose `skill.onLearnProgress(cb)` subscription with cleanup return |
| Renderer: context (new) | `src/contexts/LearningProgressContext.tsx` | New provider + types |
| Renderer: hook (new) | `src/hooks/useLearningProgress.ts` | New hook |
| Renderer: App | `src/App.tsx` | Wrap content with `LearningProgressProvider` alongside the existing context providers |
| Renderer: RepoDetail | `src/views/RepoDetail.tsx` | Refactor `RepoArticleActionRow` → split button + dropdown + inline status; remove standalone Clone/Star/Fork/Archive |
| Renderer: components (new) | `src/components/PrimaryActionSplitButton.tsx`, `src/components/DropdownMenu.tsx`, `src/components/LearnStatusInline.tsx` | New components |
| Renderer: LibrarySidebar | `src/components/LibrarySidebar.tsx` + `.css` | `.learning` modifier, bar, glow |
| Renderer: RepoCard | `src/components/RepoCard.tsx` | `.learning` modifier on `.repo-card-badge-learn`; show percent in label |
| Renderer: RepoListRow | `src/components/RepoListRow.tsx` | Same treatment as card |
| Styles | `src/styles/globals.css` | New classes for status inline, sidebar `.learning`, split button |

## 8. Testing

**New unit tests:**

- `electron/services/learnProcessRegistry.test.ts` — register, cancel sends SIGTERM then SIGKILL, double-cancel no-op, cancel-unknown no-op.
- `electron/anatomy/index.test.ts` (extend existing) — assert `onProgress` callback fires for each phase boundary in order with correct percent; cover validate-hit path (skips generating).
- `src/contexts/LearningProgressContext.test.tsx` — subscription wiring, multi-repo entries, cancel call, cleanup-after-grace on terminal states.
- `src/hooks/useLearningProgress.test.ts` — null when no entry, returns state when present, elapsed clock ticks.

**Extended component tests:**

- `RepoDetail.test.tsx` — split button renders correctly across UNLEARNED / LEARNING / LEARNED; dropdown opens and items dispatch correct handlers; `<LearnStatusInline>` appears with bar during LEARNING; Cancel call wires to context.
- `LibrarySidebar` test — `.learning` class + bar applied when context has matching entry.
- `RepoCard.test.tsx` — Learn button shows percent during LEARNING via context.

**Mocking strategy:** `LearningProgressContext` exports a `MockLearningProgressProvider` for component tests, so they don't need to mock IPC at all — inject a synthetic state directly. Main-process tests use the existing `spawnAnatomy` injection pattern in `AnatomyEngineDeps`.

## 9. Out of Scope

- Token-rate / byte-rate display (anatomy CLI emits no such signal).
- ETA / time-remaining estimates (needs historical learn-duration data).
- Sub-phase progress inside `generating` (would require modifying vendored anatomy CLI).
- Concurrency cap / queue.
- Retry button on failure.
- Toast / notification on completion.
- Versioned-install progress (separate code path; existing legacy install flow is out of scope per `2026-03-31-release-version-install-design.md`).
