# Discover Repo Overlay

**Date:** 2026-04-28
**Status:** Approved

## Overview

When a user clicks a repository card on the Discover page, instead of navigating away to a separate route, the full RepoDetail content appears as a full-screen overlay on top of the Discover page. When dismissed, Discover is exactly as the user left it — no state restore, no scroll jump, no refetch. A fade-in animation plays on open.

## Approach: React Router Modal Route Pattern

Leverage React Router v6's background-location pattern. The current location (`/repo/:owner/:name`) renders the overlay; the previous location (`/discover`) is frozen in the background and stays mounted.

This requires zero changes to `RepoDetail` — it continues to read `owner`/`name` from `useParams()` and `fromDiscoverView`/`fromDiscoverPath` from `useLocation()` state exactly as it does today.

## Architecture

### 1. `src/views/Discover.tsx` — `navigateToRepo` callback

Add `background: location` to the navigation state:

```ts
// Before
navigate(path, { state: { fromDiscoverView, fromDiscoverPath, repoAvatarUrl } })

// After
navigate(path, { state: { fromDiscoverView, fromDiscoverPath, repoAvatarUrl, background: location } })
```

The snapshot save and engagement log calls remain unchanged.

### 2. `src/App.tsx` — Route rendering

Read `location.state?.background`. When present, render two route trees:

- **Background routes** — rendered with `location={background}`, so only Discover matches and stays mounted. RepoDetail in this tree never renders (its path doesn't match `/discover`).
- **Overlay routes** — rendered with the current location, matching `/repo/:owner/:name` and rendering `<RepoOverlay />`.

When no background state is present (direct navigation to `/repo/owner/name`), only the primary routes render and RepoDetail mounts as a full page — existing behaviour is unchanged.

### 3. `src/components/RepoOverlay.tsx` — New component

Thin wrapper responsible for:
- Rendering the full-screen overlay container with fade-in CSS class
- Rendering `<RepoDetail />` inside it
- Placing an X close button (top-right, fixed within the overlay)
- Attaching an Escape key listener — both X and Escape call `navigate(-1)`

```tsx
export default function RepoOverlay() {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="repo-overlay">
      <button className="repo-overlay-close" onClick={() => navigate(-1)} aria-label="Close">✕</button>
      <RepoDetail />
    </div>
  )
}
```

RepoDetail's existing back button (rendered when `fromDiscoverPath` is in location state) also calls `navigate(-1)` and will close the overlay as a side-effect — no change needed.

### 4. CSS (globals.css or RepoOverlay.css)

```css
.repo-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: var(--bg);
  animation: repo-overlay-fadein 200ms ease-out forwards;
  overflow-y: auto;
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
  /* use existing .btn-close-overlay class from globals.css */
}
```

## Behaviour Summary

| Action | Result |
|---|---|
| Click repo card on Discover | Overlay fades in over Discover; URL updates to `/repo/owner/name` |
| Press Escape or click X | `navigate(-1)` — overlay unmounts, Discover visible exactly as left |
| Click RepoDetail back button | Same as Escape — `navigate(-1)` closes overlay |
| Navigate directly to `/repo/owner/name` | Full-page RepoDetail renders (no background state, existing behaviour) |
| Refresh while overlay is open | App uses `MemoryRouter` — any refresh resets router to `/`, so RepoDetail renders full-page (acceptable for Electron) |

## Files Changed

| File | Change |
|---|---|
| `src/views/Discover.tsx` | Add `background: location` to `navigateToRepo` navigate state |
| `src/App.tsx` | Split routes into background + overlay rendering when background state present |
| `src/components/RepoOverlay.tsx` | New — overlay wrapper with X button and Escape handler |
| `src/styles/globals.css` | Add `.repo-overlay`, `.repo-overlay-close`, `@keyframes repo-overlay-fadein` |

## Out of Scope

- Changing RepoDetail's internal layout or content for the overlay context
- Backdrop/dimming layer (full-screen means no backdrop)
- Swipe-to-close or drag gesture
- Nested overlay stacking (opening a second repo from within the overlay)
