# Invert Dark Images — Design Spec

**Date:** 2026-04-28  
**Status:** Approved

## Problem

The app has a dark background. Some README images — particularly project logos — are dark/black on a light or transparent background and become invisible or hard to read. The Flipt logo (black on transparent) is the motivating example.

## Goal

A global setting that, when enabled, automatically detects README images with dark content on a light/transparent background and inverts them so the content becomes white and readable.

## Scope

- All `<img>` elements rendered by `ReadmeRenderer` (both `rm-img-logo` and `rm-img-content` classes)
- Does **not** apply to: the byline owner avatar, the dither background, the NavBar breadcrumb icon, or the lightbox

## Approach: CSS filter + canvas detection

Detection runs once per image at load time via a canvas sampling function. If the image is flagged, a `data-needs-invert="true"` attribute is stamped on the DOM element. A CSS rule applies `filter: invert(1)` when the global setting class is active on `<html>`.

---

## Components

### 1. `src/utils/detectImageNeedsInvert.ts` (new)

Exports a single function:

```ts
export function detectImageNeedsInvert(img: HTMLImageElement): boolean
```

**Algorithm:**
1. Bail out early if `img.naturalWidth < 32 || img.naturalHeight < 32` (icon-sized images don't need inversion)
2. Draw image into a 64×64 offscreen canvas (downsampled for speed)
3. Read all pixel data via `getImageData`
4. Compute three signals over all pixels:
   - **darkRatio**: `(pixels where alpha ≥ 128 AND luminance < 80) / totalOpaquePixels`
   - **cornerLightRatio**: average across the four 8×8 corner regions of what fraction of corner pixels are transparent (alpha < 128) OR near-white (luminance > 200)
   - **colourVariance**: average per-pixel `max(|R−lum|, |G−lum|, |B−lum|)` across opaque pixels (measures how colourful/photographic the image is)
5. Return `true` if `darkRatio > 0.25 AND cornerLightRatio > 0.5 AND colourVariance ≤ 30`
6. On any exception (CORS tainted canvas, no context): return `false`

**Rationale for thresholds:**
- `darkRatio > 0.25`: at least a quarter of the visible content is dark — enough signal that this is a dark-content logo, not just an image with a dark accent
- `cornerLightRatio > 0.5`: corners are predominantly transparent or white — confirms the background is light, not that we're looking at a dark-themed screenshot
- `colourVariance ≤ 30`: low colour deviation means the image is mostly greyscale (logo/icon). High variance means photographic/colourful content that should not be inverted.

---

### 2. `src/contexts/Appearance.tsx` (modify)

Add `invertDarkImages: boolean` and `setInvertDarkImages: (v: boolean) => void` to the context value.

- Load from `window.api.settings.get('invertDarkImages')` on mount (same pattern as `background`)
- Persist with `window.api.settings.set('invertDarkImages', value)` on change
- Default: `false`
- Side effect: toggle class `invert-dark-images` on `document.documentElement` whenever the value changes (via `useEffect`)

---

### 3. `src/styles/globals.css` (modify)

Add one rule:

```css
.invert-dark-images img[data-needs-invert="true"] {
  filter: invert(1);
}
```

Scoped to `.invert-dark-images` so it is a no-op when the setting is off.

---

### 4. `src/components/ReadmeRenderer.tsx` (modify)

- Accept new prop `invertDarkImages: boolean`
- In the `img` component handler inside `mdComponents`:
  - For the `rm-img-logo` path: add an `onLoad` that calls `detectImageNeedsInvert` and stamps the attribute if `invertDarkImages` is true
  - For the `rm-img-content` path: the existing `onLoad` already upgrades images with wide aspect ratios to `rm-img-logo`; append the same detection step after the existing logic
  - The detection only runs when `invertDarkImages === true` (prop gate)
- `mdComponents` is memoised; add `invertDarkImages` to its dependency array so it picks up the new prop

---

### 5. `src/views/RepoDetail.tsx` (modify)

- Pull `invertDarkImages` from `useAppearance()`
- Pass it as a prop to `<ReadmeRenderer>`

---

### 6. `src/views/Settings.tsx` (modify)

- Pull `invertDarkImages` and `setInvertDarkImages` from `useAppearance()`
- Add a toggle row in the **Appearance** category, below the existing background mode selector:

```
[ ] Invert dark images
    Automatically inverts logos and banners with dark content so they're
    readable on dark backgrounds.
```

---

## Data flow

```
User enables setting in Settings
  → setInvertDarkImages(true)
    → window.api.settings.set('invertDarkImages', true)
    → document.documentElement.classList.add('invert-dark-images')

README renders
  → img onLoad fires
    → if (invertDarkImages) detectImageNeedsInvert(img)
      → if true: img.setAttribute('data-needs-invert', 'true')
        → CSS: .invert-dark-images [data-needs-invert="true"] { filter: invert(1) }
```

---

## Error handling & edge cases

- **CORS-blocked images**: canvas `getImageData` throws; `detectImageNeedsInvert` catches and returns `false`. Image renders normally.
- **Already light-on-dark images**: `cornerLightRatio` will be low (dark corners) → not inverted. ✓
- **Photographs**: `colourVariance` will be high → not inverted. ✓
- **Tiny icons (< 32px)**: bailed out early → not inverted. ✓
- **Setting toggled after render**: the `data-needs-invert` attribute is already stamped (or not) from the initial load; the CSS class on `<html>` shows/hides the filter instantly without re-render. Images that have already loaded and been stamped will correctly respond to the toggle.
- **Images that load before setting is on**: when the setting is later enabled, already-rendered images won't re-run detection. This is acceptable — the user enabling the setting on a page already loaded is an edge case, and a page reload clears it.

## Files changed

| File | Change |
|------|--------|
| `src/utils/detectImageNeedsInvert.ts` | New — detection utility |
| `src/contexts/Appearance.tsx` | Add `invertDarkImages` setting + `document.documentElement` side effect |
| `src/styles/globals.css` | Add `.invert-dark-images img[data-needs-invert="true"]` rule |
| `src/components/ReadmeRenderer.tsx` | Accept prop, run detection in `onLoad` handlers |
| `src/views/RepoDetail.tsx` | Pull setting from context, pass to `ReadmeRenderer` |
| `src/views/Settings.tsx` | Add toggle in Appearance category |
