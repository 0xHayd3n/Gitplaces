# Repo detail crossfade transition

**Date:** 2026-05-23
**Status:** Design — ready for implementation plan

## Summary

Replace the current hard cut between repositories in the Library view with an immediate-fade-out + skeleton-fade-in crossfade. Old detail content begins fading out the moment the user clicks a new sidebar row; the new detail's loading state (a structured skeleton for uncached repos, or seeded-from-cache content for revisits) fades in on top. Sidebar selection and the library page header (`owner / name`) update instantly without animation. Total transition duration ~200ms.

## Goals

- Eliminate the visible "flash of empty state" that occurs when navigating between repositories.
- Give immediate visual feedback on click via the sidebar selection update, while the detail pane transitions over a short, snappy interval.
- Keep the layout stable across the transition — only the detail pane animates; sidebar, page header, and tab bar do not.

## Non-goals

- Animating CollectionDetail differently from RepoDetail. The same crossfade applies to both routes inside the Library shell.
- Restructuring `RepoDetail` internally. The 2,216-line file is left alone except for its loading-state JSX (skeleton additions).
- Adding hover prefetch, route-level data caching beyond what `_repoCache` already provides, or any change to the underlying IPC / fetch behavior in `RepoDetail`.
- Animating the library page header text. The `owner / name` line at the top of [Library.tsx:125](../../src/views/Library.tsx:125) updates instantly via the existing `useMatch` re-render.

## Current state

The Library view renders its detail area at [Library.tsx:148-155](../../src/views/Library.tsx:148):

```tsx
{hasDetail ? (
  <Routes>
    <Route path="repo/:owner/:name" element={<RepoDetail />} />
    <Route path="collection/:id" element={<CollectionDetail />} />
  </Routes>
) : (
  <ActivityFeed />
)}
```

When the user clicks a new repo:

1. React Router updates `location.pathname` from `/library/repo/A/x` to `/library/repo/B/y`.
2. The same `<RepoDetail>` component instance is reused (same route pattern, only params change). Its `useEffect([owner, name])` at [RepoDetail.tsx:749](../../src/views/RepoDetail.tsx:749) fires.
3. The effect resets ~20+ state variables (repo, readme, releases, video data, social posts, commands, storybook state, skill state, etc.) in synchronous setStates that batch into one render.
4. The render pass shows mostly-empty state. For previously visited repos a module-level `_repoCache` (at [RepoDetail.tsx:478](../../src/views/RepoDetail.tsx:478)) seeds repo + readme synchronously, so revisits show content without a flash. For uncached repos, the user sees a near-blank pane.
5. Multiple IPC + GitHub fetches resolve over the next 50–1000ms and progressively fill in sections, each triggering re-renders.

The perceived jank comes from step 4 (sudden blank state on uncached navigations) and from step 5 (visible "pop-in" as sections fill).

## Proposed design

### Implementation approach

Introduce a new wrapper component, `LibraryDetailRoutes`, that owns the route-to-route crossfade. The wrapper replaces the inline `<Routes>` block in `Library.tsx`. It tracks the previous `location` in local state alongside the current one; when the URL changes, it renders **two layered `<Routes>` elements** — one for the previous location (fading out) and one for the current location (fading in) — using React Router's documented `location` prop on `<Routes>` to render each layer against its own URL. After the transition completes (~200ms), the previous layer unmounts.

Alternatives considered and rejected:

- **Single-layer fade.** Fade the detail area to opacity 0 over 100ms, swap the route, then fade back to 1. Rejected because there's a visible blank moment at the bottom of the fade and the two halves of the animation can't overlap, making the transition feel choppy.
- **DOM snapshot of leaving layer.** Capture a static clone of the leaving detail's DOM (via `cloneNode(true)`) and animate that out. Rejected because clones don't preserve event handlers or React state, complicate sizing/scroll, and add a class of subtle correctness bugs (e.g. cloned iframes re-load).
- **React Router v6.4+ data loaders with deferred data.** Rejected — this app uses route-element rendering, not data-router APIs. Adopting them would be a much larger refactor than the transition is worth.
- **Framer Motion or another animation library.** Rejected as adding a dependency for what is ~200ms of opacity animation that CSS handles natively.

### Component structure

```
<LibraryDetailRoutes>
  <DetailStack>                                 // position: relative, full size
    {leaving && (
      <DetailLayer phase="leaving">             // position: absolute, fading out
        <Routes location={leavingLocation}>
          <Route path="repo/:owner/:name" element={<RepoDetail />} />
          <Route path="collection/:id" element={<CollectionDetail />} />
        </Routes>
      </DetailLayer>
    )}
    <DetailLayer phase={entering ? 'entering' : 'idle'}>
      <Routes location={currentLocation}>
        <Route path="repo/:owner/:name" element={<RepoDetail />} />
        <Route path="collection/:id" element={<CollectionDetail />} />
      </Routes>
    </DetailLayer>
  </DetailStack>
</LibraryDetailRoutes>
```

`DetailStack` and `DetailLayer` are plain `<div>`s with CSS classes — no separate component files. The wrapper itself lives in `src/components/LibraryDetailRoutes.tsx`.

### Transition state machine

Three phases, tracked in component state:

- **idle** — no transition in flight. One layer rendered at opacity 1.
- **transitioning** — both layers rendered. Leaving layer animates `1 → 0`; entering layer animates `0 → 1`.
- (back to idle after the leaving layer unmounts)

State shape:

```ts
{
  current: Location           // the location whose Routes we render in the entering/idle layer
  leaving: Location | null    // the previous location, if a transition is in flight
}
```

Trigger logic, in a `useEffect` keyed on `useLocation()`:

```ts
useEffect(() => {
  if (location.pathname === current.pathname) return
  setLeaving(current)
  setCurrent(location)
  const t = setTimeout(() => setLeaving(null), 220)
  return () => clearTimeout(t)
}, [location.pathname])
```

Note: keyed on `pathname` only (not the full `location` object), so identical-URL replaces from React Router (e.g., state-only updates) don't trigger a transition.

### Timing and easing

- **Leaving layer:** `opacity: 1 → 0` over **120ms**, `ease-out`.
- **Entering layer:** `opacity: 0 → 1` over **180ms**, `ease-out`.
- Both stages start at the same wall-clock moment (`t=0`). Leaving finishes at 120ms; entering finishes at 180ms; the leaving layer is held in the DOM until 220ms (40ms buffer) and then unmounted.

The leaving fade is slightly shorter than the entering fade so the old content is fully out of the way before the new content reaches full opacity — this makes the transition feel like the new content is *arriving* rather than the two contents simultaneously dissolving into each other.

### Skeleton additions

The "skeleton" piece of "immediate fade-out + skeleton in" is whatever `RepoDetail` shows when it first mounts for a repo with no cache entry. Today that's a near-blank pane while data loads. To make it feel like a skeleton rather than a blank, add placeholder shapes to two areas of `RepoDetail`:

1. **Header band placeholder.** When `repo === null && !repoError`, render placeholder rectangles at the avatar + title + description positions instead of nothing. Avatar = 48×48 rounded square. Title = ~200px × 18px line. Description = ~340px × 12px line. All filled with `var(--bg3)` and given the `skeleton-shimmer` class (CSS keyframe animation, ~1.5s loop).
2. **Body placeholder.** When `readme === 'loading'`, render six greyed lines of varying widths inside the article container, using the same `skeleton-shimmer` style.

Other sections (tabs, stats sidebar, related repos, etc.) are left alone for v1 — they either render acceptably empty or are structurally fixed (tab strip is always visible regardless of data).

The `skeleton-shimmer` keyframe lives in `src/styles/globals.css` and uses a translucent gradient sweep (typical skeleton-loader pattern). The shimmer is purely visual; it should NOT animate `width`, `height`, or any layout property — only `background-position`.

### Sidebar selection

No change. The sidebar's selected highlight already updates synchronously via `selectedId` derived from `useMatch` in [Library.tsx:79](../../src/views/Library.tsx:79), and is rendered by `LibrarySidebar` which does not participate in the crossfade. The user gets immediate click feedback there.

### CSS

`src/components/LibraryDetailRoutes.css` (new file):

```css
.detail-stack {
  position: relative;
  width: 100%;
  height: 100%;
}

.detail-layer {
  position: absolute;
  inset: 0;
  overflow: auto;          /* preserves RepoDetail's existing scroll behavior */
}

.detail-layer--idle {
  opacity: 1;
}

.detail-layer--entering {
  opacity: 0;
  animation: detail-fade-in 180ms ease-out forwards;
}

.detail-layer--leaving {
  opacity: 1;
  animation: detail-fade-out 120ms ease-out forwards;
  pointer-events: none;    /* leaving layer should not intercept clicks */
}

@keyframes detail-fade-in {
  to { opacity: 1; }
}

@keyframes detail-fade-out {
  to { opacity: 0; }
}
```

`pointer-events: none` on the leaving layer is important — otherwise clicks during the brief overlap would land on the stale content instead of the new layer.

`src/styles/globals.css` additions for the skeleton shimmer:

```css
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    var(--bg3) 0%,
    var(--bg4) 50%,
    var(--bg3) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

### Files touched

- **New:** `src/components/LibraryDetailRoutes.tsx` (~60 LOC) — the wrapper + state machine.
- **New:** `src/components/LibraryDetailRoutes.css` (~30 LOC) — stack/layer styles + keyframes.
- **Edit:** `src/views/Library.tsx` (~10 LOC change) — replace the inline `<Routes>` block at [line 149-152](../../src/views/Library.tsx:149) with `<LibraryDetailRoutes />`. Drop the now-unused `Routes`/`Route` imports if no other usage remains.
- **Edit:** `src/views/RepoDetail.tsx` (~40 LOC added) — header and body skeleton blocks rendered when `repo === null` and `readme === 'loading'` respectively.
- **Edit:** `src/styles/globals.css` (~20 LOC added) — `.skeleton-shimmer` class and keyframe.

Total: ~160 LOC across 5 files.

## Known trade-offs

### Double mount during transition

For ~220ms, two `RepoDetail` instances coexist (one per layer). The leaving instance was just visible and its `_repoCache` is warm, so it renders from cache immediately. However, both instances run their initial `useEffect` cascade, meaning the leaving instance fires its IPC + GitHub fetches even though it will be unmounted before any response could land.

**Cost per transition:** ~2 IPC calls + ~2 GitHub requests, all wasted.

**Mitigation (deferred to follow-up if it matters in practice):** add an early-bail path in `RepoDetail`'s main effect that checks whether the component is rendered inside a leaving layer (via a context flag the wrapper sets), and skips network calls in that case.

For v1, accept the waste. It's bounded (one extra fetch cycle per click) and invisible to the user.

### Race during rapid sequential clicks

If the user clicks repo A → repo B → repo C in rapid succession (faster than 220ms), the state machine should jump directly to C, not queue A→B→C as three sequential fades. The implementation handles this naturally:

- Click A→B: `setLeaving(A)`, `setCurrent(B)`, schedule unmount of A at 220ms.
- Click B→C (50ms later): `setLeaving(B)`, `setCurrent(C)`, schedule unmount of B at 220ms. The previous unmount-A timer is cleared by the cleanup function returned from the effect.

Net result: A is replaced by B mid-fade (the user sees B briefly), then B fades to C. This is the correct behavior — no queue.

### Scroll position

`RepoDetail` does not preserve scroll position across navigations today; it scrolls to top on each mount. The crossfade does not change this — each entering layer is a fresh mount, so it starts at scroll-top. Confirm during implementation that this matches user expectation. If preserving scroll per-repo is wanted, that's a separate change.

## Testing strategy

The transition itself is hard to unit-test (it's purely visual and time-based). The structural changes around it are testable:

- **`LibraryDetailRoutes`:** test that it renders the current location's route immediately on mount, that a location change adds a leaving layer for ~220ms, that the leaving layer is gone after 220ms, and that rapid successive navigations don't pile up. Use `vitest`'s fake timers.
- **`Library.tsx`:** existing tests should continue to pass — the route structure is preserved, only the wrapper around it changes.
- **`RepoDetail`:** skeleton elements should render in the empty state and disappear once data arrives. Add a render-only test that asserts the skeleton container is present when `repo === null` and absent when `repo` is populated.

The visual fade is not asserted in tests — verify by hand in the running app.
