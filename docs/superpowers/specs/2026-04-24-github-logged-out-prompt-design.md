# GitHub Logged-Out Prompt — Design

**Date:** 2026-04-24
**Status:** Approved (pending spec review)

## Problem

When the user is not signed in to GitHub, GitHub-data screens (Discover, Library, Starred, Profile, Collections, RepoDetail) still render their full chrome — search bar, filter controls, sidebars, skeleton loaders — even though no data can load. The result is a half-rendered UI with empty skeletons that never resolve, instead of a clear call-to-action.

The root cause is architectural: there is no centralized auth state. Each view independently calls `window.api.github.getUser()` (or implicitly assumes `onboarding_complete === '1'` means GitHub is connected), and there is no shared gate that decides "render the view" vs "render a login prompt." Components mount their chrome eagerly.

## Goals

1. When the user is logged out of GitHub, every GitHub-data view shows a single minimalist "Log in to GitHub" prompt — no search bar, no filters, no logo strip, no skeletons.
2. The prompt's "Log in to GitHub" button starts the device-flow login inline (no need to navigate to Settings first).
3. On successful login, the entire app flips to the connected state in one tick — every view re-renders with its real chrome and data.
4. Robust: works on first boot, after explicit logout, and after a token revocation discovered mid-session.

## Non-Goals

- Changing the underlying device-flow login mechanics (already implemented in `Settings.tsx` / `Onboarding.tsx`).
- Reworking the Dock or Titlebar — they remain visible on every screen regardless of auth.
- Adding a "guest mode" or any local-only browsing of GitHub data.

## Architecture

### 1. Centralized auth state

New context + hook:

- `src/contexts/GitHubAuth.tsx` exports `GitHubAuthProvider` and `useGitHubAuth()`.
- State shape: `{ status: 'loading' | 'connected' | 'disconnected', user: { login: string } | null, refresh: () => Promise<void> }`.
- On mount, calls `window.api.github.getUser()`:
  - Resolves with a user → `status: 'connected'`.
  - Rejects (no token, network error treated as disconnected for our purposes — see Error Handling) → `status: 'disconnected'`.
- `refresh()` re-runs the same probe; called by `useGitHubLogin` after a successful login and by Settings after disconnect.
- Provider mounted in `src/App.tsx` between `RepoNavProvider` and `AppContent` so every view and the Dock can read it.

### 2. Login flow extraction

New hook: `src/hooks/useGitHubLogin.ts`.

- Encapsulates the device-flow logic currently inlined in `Settings.tsx` (`handleGitHubConnect`, around lines 318–340) and `Onboarding.tsx` (around lines 117–138).
- API: `{ status, userCode, verificationUri, error, start, cancel }` where `status` is `'idle' | 'pending' | 'polling' | 'success' | 'error'`.
- `start()` calls `window.api.github.startDeviceFlow()`, sets `userCode` + `verificationUri` (status `'pending'`), then `pollDeviceToken()` (status `'polling'`); on resolve, calls `auth.refresh()` (status `'success'`).
- `cancel()` aborts polling and resets to `'idle'`.
- Both `<GitHubLoginPrompt>` and `Settings.tsx` call this hook — the device-flow code lives in exactly one place.

### 3. The guard

New component: `src/components/RequireGitHub.tsx`.

```tsx
function RequireGitHub({ children }: { children: ReactNode }) {
  const auth = useGitHubAuth()
  if (auth.status === 'loading') return null
  if (auth.status === 'disconnected') return <GitHubLoginPrompt />
  return <>{children}</>
}
```

Behavior:
- `loading` → renders `null` (no skeleton, no flash). Auth probe is fast (single IPC); a brief blank is preferable to mounting chrome that may immediately unmount. The route-level Suspense fallback (`AppLoadingFallback`) may already be visible during lazy-route mount; the guard's `null` then takes over until the probe resolves. If this two-stage transition flashes visibly during testing, fall back to rendering `<AppLoadingFallback />` from the guard during `'loading'` for visual continuity.
- `disconnected` → renders `<GitHubLoginPrompt>` only. Because the guard wraps the entire view, none of the view's chrome (search bar, filters, sidebars, skeletons) mounts.
- `connected` → renders the wrapped view as today.

### 4. The prompt component

New component: `src/components/GitHubLoginPrompt.tsx` + sibling CSS file.

Visual: centered card on the existing app background. Single column, ~360px wide. Contents:

- GitHub mark icon (existing asset).
- Headline: "Connect to GitHub".
- One-line subtitle: "Sign in to browse, save, and manage your repositories."
- Primary button: "Log in to GitHub" → `useGitHubLogin().start()`.
- When `status === 'pending' | 'polling'`:
  - Replaces the button with the device code (large, monospace, click-to-copy) and a secondary "Open GitHub" button linking to `verificationUri`.
  - "Cancel" link below.
- When `status === 'error'`:
  - Inline error text + "Try again" button that re-runs `start()`.

No filters, no logo strip, no search bar — that's the whole point.

### 5. Where the guard applies

Top-level routes (declared in `App.tsx`):

| Route | View | Guarded? | Reason |
|---|---|---|---|
| `/discover` | Discover | Yes | GitHub data |
| `/library/*` | Library | Yes | GitHub data |
| `/starred` | Starred | Yes | GitHub data |
| `/profile` | Profile | Yes | GitHub user |
| `/repo/:owner/:name` | RepoDetail | Yes | GitHub data |
| `/settings` | Settings | No | User must be able to manage prefs / log in / disconnect |
| `/onboarding` | Onboarding | No | Owns its own flow |
| `/create` | Create | No | Local-only |
| `/local-project` | LocalProjectDetail | No | Local-only |

`/collections` is just a redirect to `/library` (`App.tsx:67`) and does not need its own guard. `CollectionDetail` and the nested collections list are rendered as child routes inside `Library` (`Library.tsx:103`), so they inherit Library's guard automatically — no separate guard needed.

The Dock and Titlebar are rendered outside `<Routes>` in `App.tsx` and remain visible regardless of auth.

Application style: each guarded view file's default export wraps its body in `<RequireGitHub>` rather than wrapping at the route level. This keeps the guard co-located with the view and avoids touching `App.tsx`'s route table beyond the provider mount.

## Data Flow

### Initial boot, logged out
1. `App` mounts, `GitHubAuthProvider` runs probe → `status: 'loading'`.
2. Routes render; each guarded view returns `null` from `<RequireGitHub>` while loading.
3. Probe rejects → `status: 'disconnected'`.
4. Each guarded view re-renders, now showing `<GitHubLoginPrompt>`.
5. User clicks "Log in to GitHub" on whichever view they happen to be on.
6. `useGitHubLogin().start()` runs the device flow; on success it calls `auth.refresh()`.
7. `status` flips to `'connected'`; every guarded view re-renders with its real chrome and data starts fetching.

### Mid-session token revocation
1. A view's data fetch returns 401.
2. (Future hook — not in scope for this spec) Add a top-level error listener that calls `auth.refresh()` on 401. For now: relying on next manual refresh / next boot to detect.

### Logout from Settings
1. Settings disconnect button calls existing logout IPC, then `auth.refresh()`.
2. `status` flips to `'disconnected'`; user remains on Settings (which is unguarded), but if they navigate elsewhere they hit the prompt.

## Error Handling

- `getUser()` rejection is treated as `'disconnected'`. We do not distinguish "no token" from "network error" — both result in the user seeing the login prompt, which is the right action in both cases (try again kicks off the flow which will surface a real network error).
- `useGitHubLogin` surfaces device-flow errors via `status: 'error'` with a `Try again` affordance. This matches the existing Settings/Onboarding behavior.
- The guard never throws — `null` during loading, prompt during disconnected, children during connected. No error boundary needed.

## Testing

Unit / component tests, mirroring existing view test patterns (`*.test.tsx` in `src/views`):

1. `RequireGitHub.test.tsx` — three states render as specified (null, prompt, children) given a stubbed `useGitHubAuth`.
2. `GitHubLoginPrompt.test.tsx` — initial render, click "Log in to GitHub" calls `start`, transitions to pending shows device code, error state shows retry.
3. `GitHubAuth.test.tsx` — provider sets `connected` on `getUser` success, `disconnected` on rejection, `refresh()` re-probes.
4. Touch existing view tests: any test that previously asserted view chrome must mount with auth in `'connected'` state. Tests that exercise the disconnected case (new) assert the prompt mounts and the chrome does not.

No E2E tests required — the contract (chrome hidden when disconnected, prompt visible) is fully unit-testable.

## Migration of Existing Code

- `Settings.tsx` `handleGitHubConnect` (around lines 318–340) → replace inline device-flow with `useGitHubLogin()`.
- `Onboarding.tsx` device-flow block (around lines 117–138) → same, share the hook.
- Per-view `getUser()` calls (e.g., `Starred.tsx:73`, `Settings.tsx:169`) → replace with `useGitHubAuth()` reads where the component just needs to know "is the user connected." Keep direct `getUser()` calls only where the component needs fresh user data for other reasons.
- `App.tsx:46–55` `onboarding_complete` check is preserved (separate concern: onboarding completion ≠ GitHub connection).

## Open Questions

None — all sections approved during brainstorming.

## Out of Scope (Future Work)

- Mid-session 401 detection / auto-refresh.
- Multi-account support.
- Offline-mode / cached-data browsing.
