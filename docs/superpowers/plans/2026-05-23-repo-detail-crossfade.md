# Repo Detail Crossfade Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard cut between repositories in the Library with an immediate-fade-out + skeleton-fade-in crossfade.

**Architecture:** A new wrapper component `LibraryDetailRoutes` renders two stacked `<Routes>` blocks — one for the previous location (fading out) and one for the current location (fading in) — using React Router's `location` prop. CSS animations handle the fade. Minimal skeleton placeholders in `RepoDetail`'s loading state give uncached repos a structured shimmer rather than blank text.

**Tech Stack:** React 18, React Router v6, TypeScript, plain CSS, vitest + @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-05-23-repo-detail-crossfade-design.md`](../specs/2026-05-23-repo-detail-crossfade-design.md)

---

## File Map

**To create:**

- `src/components/LibraryDetailRoutes.tsx` — wrapper component with the two-layer crossfade state machine.
- `src/components/LibraryDetailRoutes.css` — stack/layer styles and fade keyframes.
- `src/components/LibraryDetailRoutes.test.tsx` — unit tests for the state machine (fake timers).

**To modify:**

- `src/styles/globals.css` — add `.skeleton-shimmer` utility class + keyframe.
- `src/views/RepoDetail.tsx` — replace the "Loading README…" placeholder text with shimmer lines; add description-area shimmer when repo data hasn't loaded.
- `src/views/Library.tsx` — replace the inline `<Routes>` block with `<LibraryDetailRoutes />`.

---

## Task 1: Add `.skeleton-shimmer` utility class

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Append the skeleton class and keyframe to globals.css**

Add at the bottom of the file:

```css

/* ── Skeleton loader shimmer ─────────────────────────── */
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
  100% { background-position:  200% 0; }
}
```

- [ ] **Step 2: Type-check passes**

Run: `npx tsc --noEmit`
Expected: clean exit (no output).

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(skeleton): add .skeleton-shimmer utility class"
```

---

## Task 2: Replace README loading text with skeleton lines, add description-area shimmer

**Files:**
- Modify: `src/views/RepoDetail.tsx`

The two insertion points are:

1. The `description` prop on `ArticleLayout` at [src/views/RepoDetail.tsx:1661](../../src/views/RepoDetail.tsx:1661). Currently `repo?.description ? <>{repo.description}</> : undefined` — i.e., empty when no repo loaded. We add a shimmer placeholder when `repo === null` (still loading), keeping `undefined` for repos that genuinely have no description.
2. The README loading branch at [src/views/RepoDetail.tsx:1677-1678](../../src/views/RepoDetail.tsx:1677). Currently `<p className="repo-detail-placeholder">Loading README…</p>`. We replace it with six shimmer lines of varying widths.

- [ ] **Step 1: Update the `description` prop on ArticleLayout**

Find (around line 1661):

```tsx
            description={repo?.description ? <>{repo.description}</> : undefined}
```

Replace with:

```tsx
            description={
              repo?.description
                ? <>{repo.description}</>
                : repo === null && !repoError
                  ? <span className="skeleton-shimmer repo-detail-skeleton-description" aria-hidden="true" />
                  : undefined
            }
```

- [ ] **Step 2: Replace the README loading placeholder**

Find (around line 1677-1678):

```tsx
                {activeTab === 'readme' && (
                  readme === 'loading' || (deferredReadmeContent === '' && rawReadmeContent !== '') ? (
                    <p className="repo-detail-placeholder">Loading README…</p>
                  ) : readme === 'error' ? (
```

Replace the `<p className="repo-detail-placeholder">Loading README…</p>` line with:

```tsx
                    <div className="repo-detail-skeleton-readme" aria-hidden="true">
                      <span className="skeleton-shimmer" style={{ width: '92%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '88%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '76%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '94%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '70%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '82%', height: 14 }} />
                    </div>
```

Now the full README branch reads:

```tsx
                {activeTab === 'readme' && (
                  readme === 'loading' || (deferredReadmeContent === '' && rawReadmeContent !== '') ? (
                    <div className="repo-detail-skeleton-readme" aria-hidden="true">
                      <span className="skeleton-shimmer" style={{ width: '92%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '88%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '76%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '94%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '70%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '82%', height: 14 }} />
                    </div>
                  ) : readme === 'error' ? (
```

- [ ] **Step 3: Add layout styles for the two skeleton containers**

The existing `.repo-detail-placeholder` selector lives in `src/styles/globals.css`. Add the following adjacent to it (so related styles stay together):

```css
.repo-detail-skeleton-description {
  display: inline-block;
  width: 72%;
  height: 14px;
  vertical-align: middle;
}

.repo-detail-skeleton-readme {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
}

.repo-detail-skeleton-readme .skeleton-shimmer {
  display: block;
}
```

- [ ] **Step 4: Type-check passes**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Existing RepoDetail tests still pass**

Run: `npx vitest run src/views/RepoDetail.test.tsx`
Expected: all existing tests pass. (The skeleton additions are conditional on `repo === null` / `readme === 'loading'`, which existing tests already exercise as their initial state — but they don't assert on placeholder text, so they should be unaffected.)

- [ ] **Step 6: Commit**

```bash
git add src/views/RepoDetail.tsx src/styles/globals.css
git commit -m "feat(repo-detail): shimmer placeholders for description and README loading"
```

**Spec divergence noted:** The spec's "Header band placeholder" section called for placeholder rectangles at the avatar + title + description positions when `repo === null`. In practice the byline (`src/views/RepoDetail.tsx:1354`) already renders a non-blank fallback for avatar (the bucket-abbrev tile) and the title shows `{name}` from URL params, so the only genuinely-blank area in the loading header is the description. The plan keeps the existing fallbacks and only adds the description shimmer — replacing the working fallbacks with shimmers would be a regression.

---

## Task 3: Write the failing test for `LibraryDetailRoutes` state machine

**Files:**
- Create: `src/components/LibraryDetailRoutes.test.tsx`

The component doesn't exist yet — these tests will fail with import errors, then pass after Task 4.

- [ ] **Step 1: Create the test file**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import LibraryDetailRoutes from './LibraryDetailRoutes'

// The wrapper renders `<Routes>` for paths `repo/:owner/:name` and
// `collection/:id`. These tests stub out the routed components by
// asserting via test ids rendered through the routes — we mock the
// imported view modules at the module level.
vi.mock('../views/RepoDetail', () => ({
  default: () => <div data-testid="repo-detail" />,
}))
vi.mock('../views/CollectionDetail', () => ({
  default: () => <div data-testid="collection-detail" />,
}))

function NavButton({ to, label, replace }: { to: string; label?: string; replace?: boolean }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to, replace ? { replace: true } : undefined)}>{label ?? `go-${to}`}</button>
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LibraryDetailRoutes />
    </MemoryRouter>
  )
}

describe('LibraryDetailRoutes', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders the current route immediately on mount', () => {
    renderAt('/library/repo/foo/bar')
    expect(screen.getByTestId('repo-detail')).toBeInTheDocument()
  })

  it('renders a leaving layer for the previous route after navigation', () => {
    render(
      <MemoryRouter initialEntries={['/library/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/library/repo/baz/qux" />
      </MemoryRouter>
    )

    // Before navigation: only one RepoDetail mounted.
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)

    act(() => { screen.getByText('go-/library/repo/baz/qux').click() })

    // Both layers rendered: leaving (foo/bar) and entering (baz/qux).
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)
  })

  it('unmounts the leaving layer after the transition duration', () => {
    render(
      <MemoryRouter initialEntries={['/library/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/library/repo/baz/qux" />
      </MemoryRouter>
    )

    act(() => { screen.getByText('go-/library/repo/baz/qux').click() })
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(250) })

    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })

  it('does not start a transition when the same pathname is replaced', () => {
    render(
      <MemoryRouter initialEntries={['/library/repo/foo/bar']}>
        <LibraryDetailRoutes />
        <NavButton to="/library/repo/foo/bar" replace />
      </MemoryRouter>
    )

    act(() => { screen.getByText('go-/library/repo/foo/bar').click() })

    // Same pathname — no leaving layer, still just one RepoDetail.
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })

  it('handles rapid sequential navigation: leaving layer always reflects the most recently displayed location', () => {
    render(
      <MemoryRouter initialEntries={['/library/repo/a/a']}>
        <LibraryDetailRoutes />
        <NavButton to="/library/repo/b/b" label="goB" />
        <NavButton to="/library/repo/c/c" label="goC" />
      </MemoryRouter>
    )

    act(() => { screen.getByText('goB').click() })          // start A→B transition
    act(() => { vi.advanceTimersByTime(50) })               // 50ms in
    act(() => { screen.getByText('goC').click() })          // interrupt with B→C

    // Two layers rendered (B leaving, C entering) — A is gone.
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(250) })
    expect(screen.getAllByTestId('repo-detail')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails with import error**

Run: `npx vitest run src/components/LibraryDetailRoutes.test.tsx`
Expected: FAIL with "Failed to load url ./LibraryDetailRoutes" or similar — the component doesn't exist yet.

- [ ] **Step 3: Don't commit yet — the failing test pairs with the implementation in Task 4.**

---

## Task 4: Implement `LibraryDetailRoutes` and make the tests pass

**Files:**
- Create: `src/components/LibraryDetailRoutes.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation, type Location } from 'react-router-dom'
import RepoDetail from '../views/RepoDetail'
import CollectionDetail from '../views/CollectionDetail'
import './LibraryDetailRoutes.css'

// Total time the leaving layer remains mounted after a navigation. The fade
// animations themselves finish earlier (entering=180ms, leaving=120ms); the
// extra buffer absorbs jitter so the user never sees the leaving layer
// snap to opacity:0 → unmount.
const TRANSITION_HOLD_MS = 220

export default function LibraryDetailRoutes() {
  const location = useLocation()
  const [current, setCurrent] = useState<Location>(location)
  const [leaving, setLeaving] = useState<Location | null>(null)

  // currentRef lets the effect read the latest "displayed" location without
  // depending on `current` (which would make the effect re-fire after its
  // own setCurrent and clear the unmount timer mid-flight).
  const currentRef = useRef(current)

  useEffect(() => {
    if (location.pathname === currentRef.current.pathname) return
    setLeaving(currentRef.current)
    setCurrent(location)
    currentRef.current = location
    const t = setTimeout(() => setLeaving(null), TRANSITION_HOLD_MS)
    return () => clearTimeout(t)
  }, [location.pathname])

  return (
    <div className="detail-stack">
      {leaving && (
        <div className="detail-layer detail-layer--leaving" aria-hidden="true">
          <Routes location={leaving}>
            <Route path="repo/:owner/:name" element={<RepoDetail />} />
            <Route path="collection/:id" element={<CollectionDetail />} />
          </Routes>
        </div>
      )}
      <div className={`detail-layer ${leaving ? 'detail-layer--entering' : 'detail-layer--idle'}`}>
        <Routes location={current}>
          <Route path="repo/:owner/:name" element={<RepoDetail />} />
          <Route path="collection/:id" element={<CollectionDetail />} />
        </Routes>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the stylesheet `src/components/LibraryDetailRoutes.css`**

```css
.detail-stack {
  position: relative;
  width: 100%;
  height: 100%;
}

.detail-layer {
  position: absolute;
  inset: 0;
  overflow: auto;
}

.detail-layer--idle {
  opacity: 1;
}

.detail-layer--entering {
  animation: detail-fade-in 180ms ease-out forwards;
}

.detail-layer--leaving {
  opacity: 0;
  animation: detail-fade-out 120ms ease-out forwards;
  pointer-events: none;
}

@keyframes detail-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes detail-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
```

- [ ] **Step 3: Run the tests — verify they pass**

Run: `npx vitest run src/components/LibraryDetailRoutes.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 4: Type-check passes**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/components/LibraryDetailRoutes.tsx src/components/LibraryDetailRoutes.css src/components/LibraryDetailRoutes.test.tsx
git commit -m "feat(library): LibraryDetailRoutes — crossfade between repo/collection routes"
```

---

## Task 5: Wire `LibraryDetailRoutes` into `Library.tsx`

**Files:**
- Modify: `src/views/Library.tsx`

- [ ] **Step 1: Add the import**

In `src/views/Library.tsx`, add this import alongside the others (the existing imports include `LibrarySidebar`, `RepoDetail`, `CollectionDetail`, `ActivityFeed` — alphabetical order suggests placing it before `LibrarySidebar`):

```tsx
import LibraryDetailRoutes from '../components/LibraryDetailRoutes'
```

- [ ] **Step 2: Replace the inline `<Routes>` block**

Find (around line 148-155):

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

Replace with:

```tsx
            {hasDetail ? (
              <LibraryDetailRoutes />
            ) : (
              <ActivityFeed />
            )}
```

- [ ] **Step 3: Remove now-unused imports**

After the replacement, `Routes`, `Route`, `RepoDetail`, and `CollectionDetail` are no longer referenced in `Library.tsx`. Remove them from the imports:

Find:

```tsx
import { useNavigate, useMatch, useLocation, Routes, Route } from 'react-router-dom'
```

Replace with:

```tsx
import { useNavigate, useMatch, useLocation } from 'react-router-dom'
```

Find:

```tsx
import RepoDetail from './RepoDetail'
import CollectionDetail from './CollectionDetail'
```

Delete both lines.

- [ ] **Step 4: Type-check passes**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Existing Library tests still pass**

Run: `npx vitest run src/views/Library.test.tsx src/components/LibraryDetailRoutes.test.tsx`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/Library.tsx
git commit -m "feat(library): swap inline Routes for LibraryDetailRoutes wrapper"
```

---

## Final verification

- [ ] **Run the full test suite for the affected modules**

Run: `npx vitest run src/views/Library.test.tsx src/components/LibrarySidebar.test.tsx src/components/LibraryDetailRoutes.test.tsx src/contexts/LearningProgressContext.test.tsx src/hooks/useLearningProgress.test.tsx`
Expected: all pass.

- [ ] **Run a final type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Manual verification by the user**

Per the user's stated preference, they will test the UI themselves. Hand back to the user with a note that the work is ready to test, and ask them to confirm the crossfade feels right and the skeleton looks appropriate on uncached repos.

---

## Out of scope (defer to follow-up)

- Suppressing the leaving instance's wasted IPC + GitHub fetches (a `useContext` flag from the wrapper, read by `RepoDetail`'s main effect). Spec known-trade-offs Section 1.
- Per-repo scroll preservation. Spec known-trade-offs Section 3.
- Skeletons for tabs/stats sidebar/related repos sections (v1 confines skeletons to header description + README body).
