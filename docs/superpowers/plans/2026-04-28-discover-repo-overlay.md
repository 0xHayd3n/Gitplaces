# Discover Repo Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks a repo card on Discover, show the full RepoDetail content as a full-screen fade-in overlay instead of navigating away; dismissing via X button or Escape returns to Discover exactly as left, with no state restore or refetch.

**Architecture:** Uses React Router v6's background-location modal pattern — Discover stays mounted in a background route tree (rendered with the previous location) while a second route tree renders `RepoOverlay` at the current `/repo/:owner/:name` location. `navigateToRepo` in Discover passes `background: location` in router state to activate this split. A new `RepoOverlay` component wraps `RepoDetail` with a fixed X button and Escape listener; both call `navigate(-1)` to close.

**Tech Stack:** React 18, React Router v6 (MemoryRouter), Vitest, @testing-library/react, plain CSS with CSS custom properties

---

### Task 1: Add overlay CSS

**Files:**
- Modify: `src/styles/globals.css` (append after line 7951)

- [ ] **Step 1: Append CSS block to globals.css**

Add after the `.btn-close-overlay:hover` rule (search for it — it's around line 7951):

```css
/* ── Repo overlay ──────────────────────────────────────────── */
.repo-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: var(--bg);
  overflow-y: auto;
  animation: repo-overlay-fadein 200ms ease-out forwards;
}

@keyframes repo-overlay-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.repo-overlay-close {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 151;
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass (CSS-only change, no logic affected)

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(overlay): add repo overlay CSS and fade-in animation"
```

---

### Task 2: Create RepoOverlay component

**Files:**
- Create: `src/components/RepoOverlay.tsx`
- Create: `src/components/RepoOverlay.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/RepoOverlay.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RepoOverlay from './RepoOverlay'

vi.mock('../views/RepoDetail', () => ({
  default: () => <div data-testid="repo-detail-content">RepoDetail</div>,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderOverlay() {
  return render(
    <MemoryRouter initialEntries={['/repo/vercel/next.js']}>
      <Routes>
        <Route path="/repo/:owner/:name" element={<RepoOverlay />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RepoOverlay', () => {
  beforeEach(() => { mockNavigate.mockReset() })

  it('renders RepoDetail content', () => {
    renderOverlay()
    expect(screen.getByTestId('repo-detail-content')).toBeInTheDocument()
  })

  it('renders a close button', () => {
    renderOverlay()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls navigate(-1) when close button is clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('calls navigate(-1) when Escape is pressed', () => {
    renderOverlay()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/components/RepoOverlay.test.tsx`
Expected: FAIL — `Cannot find module './RepoOverlay'`

- [ ] **Step 3: Create the RepoOverlay component**

Create `src/components/RepoOverlay.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import RepoDetail from '../views/RepoDetail'

export default function RepoOverlay() {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="repo-overlay">
      <button
        className="repo-overlay-close btn-close-overlay"
        onClick={() => navigate(-1)}
        aria-label="Close"
      >
        ✕
      </button>
      <RepoDetail />
    </div>
  )
}
```

Note: `btn-close-overlay` is an existing class in `globals.css` (line 7940) — it provides the base button style (font, color, cursor, padding, radius). `.repo-overlay-close` adds the fixed positioning on top.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/components/RepoOverlay.test.tsx`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoOverlay.tsx src/components/RepoOverlay.test.tsx
git commit -m "feat(overlay): add RepoOverlay component with close button and Escape handler"
```

---

### Task 3: Wire modal routing in App.tsx

**Files:**
- Modify: `src/App.tsx`

The key constraint: `AppContent` already destructures `const { background } = useAppearance()` on line 39. The router background location must use a different variable name — `backgroundLocation`.

- [ ] **Step 1: Add the RepoOverlay lazy import**

In `src/App.tsx`, add after the existing lazy imports (after line 29):

```tsx
const RepoOverlay = lazy(() => import('./components/RepoOverlay'))
```

- [ ] **Step 2: Read backgroundLocation from router state**

In `AppContent`, after `const location = useLocation()` (line 38), add:

```tsx
const backgroundLocation = (location.state as { background?: typeof location } | null)?.background
```

- [ ] **Step 3: Replace the Routes block**

Replace the existing `<Suspense>` + `<Routes>` block (lines 64–79 in current file) with the block below. The `<ProfileOverlayPortal />` on line 80 sits outside `</Suspense>` — leave it untouched.

```tsx
<Suspense fallback={<AppLoadingFallback />}>
  <Routes location={backgroundLocation ?? location}>
    <Route path="/" element={<Navigate to="/library" replace />} />
    <Route path="/discover" element={<RequireGitHub><Discover /></RequireGitHub>} />
    <Route path="/library/*" element={<RequireGitHub><Library /></RequireGitHub>} />
    <Route path="/collections" element={<Navigate to="/library" replace />} />
    <Route path="/local-project" element={<LocalProjectDetail />} />
    <Route path="/create" element={<Create />} />
    <Route path="/create/:sessionId" element={<Create />} />
    <Route path="/starred" element={<RequireGitHub><Starred /></RequireGitHub>} />
    <Route path="/profile" element={<RequireGitHub><Profile /></RequireGitHub>} />
    <Route path="/repo/:owner/:name" element={<RequireGitHub><RepoDetail /></RequireGitHub>} />
    <Route path="/onboarding" element={<Onboarding />} />
    <Route path="/settings" element={<Settings />} />
  </Routes>
  {backgroundLocation && (
    <Routes>
      <Route path="/repo/:owner/:name" element={<RequireGitHub><RepoOverlay /></RequireGitHub>} />
    </Routes>
  )}
</Suspense>
```

When `backgroundLocation` is absent (direct navigation or any non-Discover origin), only the primary `<Routes>` renders — existing behaviour is entirely unchanged. When present, the primary `<Routes>` freezes at the background location (Discover stays mounted) and the overlay `<Routes>` renders `RepoOverlay` at the current `/repo/:owner/:name` path.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all existing tests pass

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(overlay): wire React Router modal route pattern for repo overlay"
```

---

### Task 4: Pass background location from Discover

**Files:**
- Modify: `src/views/Discover.tsx` (line 788)

- [ ] **Step 1: Update the navigate call in `navigateToRepo`**

At `src/views/Discover.tsx:788`, the current line is:

```tsx
navigate(path, { state: { fromDiscoverView: snap?.viewMode, fromDiscoverPath: location.pathname + location.search, repoAvatarUrl: repo?.avatar_url ?? null } })
```

Change it to:

```tsx
navigate(path, { state: { fromDiscoverView: snap?.viewMode, fromDiscoverPath: location.pathname + location.search, repoAvatarUrl: repo?.avatar_url ?? null, background: location } })
```

That's the entire change — one key added to the state object. The snapshot save and engagement log calls above this line are unaffected.

- [ ] **Step 2: Run the Discover test suite**

Run: `npx vitest run src/views/Discover.test.tsx`
Expected: all existing tests pass (no tests assert on the absence of `background` in navigate state)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/views/Discover.tsx
git commit -m "feat(overlay): pass background location from Discover navigateToRepo"
```
