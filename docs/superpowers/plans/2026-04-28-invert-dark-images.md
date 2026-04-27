# Invert Dark Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global "Invert dark images" setting that automatically detects README images with dark content on a light/transparent background and applies `filter: invert(1)` so they're readable on the app's dark background.

**Architecture:** A standalone detection utility samples each image on a 64×64 canvas when it loads, computing dark-pixel ratio, corner-light ratio, and colour-variance. Detected images get a `data-needs-invert="true"` DOM attribute stamped on them. A single CSS rule scoped to `.invert-dark-images` on `<html>` applies the filter; this class is toggled by the Appearance context when the setting changes.

**Tech Stack:** TypeScript, React, Vitest, CSS — no new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/detectImageNeedsInvert.ts` | **Create** | Canvas sampling + detection logic |
| `src/utils/detectImageNeedsInvert.test.ts` | **Create** | Unit tests for detection utility |
| `src/contexts/Appearance.tsx` | **Modify** | Add `invertDarkImages` setting + `<html>` class side-effect |
| `src/styles/globals.css` | **Modify** | Add `.invert-dark-images img[data-needs-invert="true"]` CSS rule |
| `src/components/ReadmeRenderer.tsx` | **Modify** | Accept prop, run detection in `onLoad` handlers, fix `memo` comparator |
| `src/views/RepoDetail.tsx` | **Modify** | Pull setting from context, pass as prop to `ReadmeRenderer` |
| `src/views/Settings.tsx` | **Modify** | Add toggle row in Appearance category |

---

## Task 1: Detection utility + tests

**Files:**
- Create: `src/utils/detectImageNeedsInvert.ts`
- Create: `src/utils/detectImageNeedsInvert.test.ts`

The utility is a pure function over a canvas — testable by constructing fake `HTMLImageElement`-like objects backed by a real canvas with known pixel data.

- [ ] **Step 1.1: Write the failing tests**

Create `src/utils/detectImageNeedsInvert.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectImageNeedsInvert } from './detectImageNeedsInvert'

// Helper: build a fake HTMLImageElement backed by a real OffscreenCanvas
// with a known pixel layout. Vitest runs in jsdom which supports OffscreenCanvas
// only partially — we stub ctx.drawImage to fill the canvas ourselves.
function makeImg(
  width: number,
  height: number,
  fillFn: (data: Uint8ClampedArray, w: number, h: number) => void
): HTMLImageElement {
  const img = { naturalWidth: width, naturalHeight: height } as HTMLImageElement

  // Stub document.createElement so the utility's internal canvas is intercepted
  vi.spyOn(document, 'createElement').mockImplementationOnce((tag) => {
    if (tag !== 'canvas') return document.createElement(tag)
    const canvas = document.createElement('canvas')
    const origGetContext = canvas.getContext.bind(canvas)
    vi.spyOn(canvas, 'getContext').mockImplementation((type) => {
      if (type !== '2d') return origGetContext(type as any)
      const ctx = origGetContext('2d')!
      vi.spyOn(ctx as CanvasRenderingContext2D, 'drawImage').mockImplementation(() => {
        const SIZE = 64
        const imageData = ctx.createImageData(SIZE, SIZE)
        fillFn(imageData.data, SIZE, SIZE)
        ctx.putImageData(imageData, 0, 0)
      })
      return ctx
    })
    return canvas
  })

  return img
}

// Fill entire canvas with a solid RGBA colour
function solidFill(r: number, g: number, b: number, a: number) {
  return (data: Uint8ClampedArray) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a
    }
  }
}

// Fill corners with colour A and the rest with colour B
function cornerFill(
  cornerR: number, cornerG: number, cornerB: number, cornerA: number,
  fillR: number,   fillG: number,   fillB: number,   fillA: number,
  cornerSize = 8
) {
  return (data: Uint8ClampedArray, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const inCorner =
          (x < cornerSize && y < cornerSize) ||
          (x >= w - cornerSize && y < cornerSize) ||
          (x < cornerSize && y >= h - cornerSize) ||
          (x >= w - cornerSize && y >= h - cornerSize)
        if (inCorner) {
          data[idx] = cornerR; data[idx+1] = cornerG; data[idx+2] = cornerB; data[idx+3] = cornerA
        } else {
          data[idx] = fillR; data[idx+1] = fillG; data[idx+2] = fillB; data[idx+3] = fillA
        }
      }
    }
  }
}

describe('detectImageNeedsInvert', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns false for images smaller than 32px', () => {
    const img = { naturalWidth: 16, naturalHeight: 16 } as HTMLImageElement
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns true for black-on-white image (classic dark logo on light background)', () => {
    // Corners: white (255,255,255,255), interior: black (0,0,0,255)
    const img = makeImg(64, 64, cornerFill(255,255,255,255, 0,0,0,255))
    expect(detectImageNeedsInvert(img)).toBe(true)
  })

  it('returns true for black-on-transparent image (logo with transparent background)', () => {
    // Corners: fully transparent, interior: black
    const img = makeImg(64, 64, cornerFill(0,0,0,0, 0,0,0,255))
    expect(detectImageNeedsInvert(img)).toBe(true)
  })

  it('returns false for white-on-dark image (already readable, no inversion needed)', () => {
    // Corners: black (dark bg), interior: white text
    const img = makeImg(64, 64, cornerFill(0,0,0,255, 255,255,255,255))
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a solid white image (nothing to invert)', () => {
    const img = makeImg(64, 64, solidFill(255, 255, 255, 255))
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a solid black image (all-dark: no light background → not a logo)', () => {
    const img = makeImg(64, 64, solidFill(0, 0, 0, 255))
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a colourful image (high colour variance = photograph)', () => {
    // Fill with high-variance colour data: alternating vivid red and vivid blue
    const img = makeImg(64, 64, (data) => {
      for (let i = 0; i < data.length; i += 4) {
        const isEven = (i / 4) % 2 === 0
        data[i]   = isEven ? 220 : 30
        data[i+1] = isEven ? 30  : 30
        data[i+2] = isEven ? 30  : 220
        data[i+3] = 255
      }
    })
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false when canvas throws (CORS tainted)', () => {
    const img = { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => {
      throw new Error('Tainted canvas')
    })
    expect(detectImageNeedsInvert(img)).toBe(false)
  })
})
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose src/utils/detectImageNeedsInvert.test.ts
```

Expected: all tests fail with "Cannot find module './detectImageNeedsInvert'"

- [ ] **Step 1.3: Implement the detection utility**

Create `src/utils/detectImageNeedsInvert.ts`:

```typescript
const SAMPLE_SIZE = 64
const CORNER_SIZE = 8
const DARK_THRESHOLD = 80
const LIGHT_THRESHOLD = 200
const DARK_RATIO_MIN = 0.25
const CORNER_LIGHT_MIN = 0.5
const COLOUR_VARIANCE_MAX = 30

export function detectImageNeedsInvert(img: HTMLImageElement): boolean {
  if (img.naturalWidth < 32 || img.naturalHeight < 32) return false

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    let darkCount = 0
    let totalOpaque = 0
    let colourVarianceSum = 0

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 128) continue
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      totalOpaque++
      if (lum < DARK_THRESHOLD) darkCount++
      colourVarianceSum += Math.max(Math.abs(r - lum), Math.abs(g - lum), Math.abs(b - lum))
    }

    if (totalOpaque === 0) return false

    const darkRatio = darkCount / totalOpaque
    const avgColourVariance = colourVarianceSum / totalOpaque
    if (avgColourVariance > COLOUR_VARIANCE_MAX) return false

    // Check the four corner regions for light/transparent background
    let cornerLightTotal = 0
    let cornerRegions = 0
    const corners = [
      [0, 0],
      [SAMPLE_SIZE - CORNER_SIZE, 0],
      [0, SAMPLE_SIZE - CORNER_SIZE],
      [SAMPLE_SIZE - CORNER_SIZE, SAMPLE_SIZE - CORNER_SIZE],
    ]
    for (const [ox, oy] of corners) {
      let lightInRegion = 0
      const regionSize = CORNER_SIZE * CORNER_SIZE
      for (let y = oy; y < oy + CORNER_SIZE; y++) {
        for (let x = ox; x < ox + CORNER_SIZE; x++) {
          const idx = (y * SAMPLE_SIZE + x) * 4
          const a = data[idx + 3]
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          if (a < 128 || lum > LIGHT_THRESHOLD) lightInRegion++
        }
      }
      cornerLightTotal += lightInRegion / regionSize
      cornerRegions++
    }
    const cornerLightRatio = cornerLightTotal / cornerRegions

    return darkRatio > DARK_RATIO_MIN && cornerLightRatio > CORNER_LIGHT_MIN
  } catch {
    return false
  }
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npm test -- --reporter=verbose src/utils/detectImageNeedsInvert.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/detectImageNeedsInvert.ts src/utils/detectImageNeedsInvert.test.ts
git commit -m "feat(invert): add detectImageNeedsInvert canvas sampling utility"
```

---

## Task 2: Appearance context — add `invertDarkImages` setting

**Files:**
- Modify: `src/contexts/Appearance.tsx`

- [ ] **Step 2.1: Write the failing test**

There are no existing tests for `Appearance.tsx` — this is a context, tested indirectly. Skip unit test; the integration is verified in Task 6 (Settings UI smoke-check). Proceed directly to implementation.

- [ ] **Step 2.2: Implement**

Replace the full contents of `src/contexts/Appearance.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type BackgroundMode = 'none' | 'dither'

interface AppearanceContextValue {
  background: BackgroundMode
  setBackground: (value: BackgroundMode) => void
  invertDarkImages: boolean
  setInvertDarkImages: (value: boolean) => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [background, setBackgroundState] = useState<BackgroundMode>('none')
  const [invertDarkImages, setInvertDarkImagesState] = useState(false)

  useEffect(() => {
    window.api.settings.get('background').then((val: string | null) => {
      if (val === 'dither' || val === 'none') setBackgroundState(val)
    }).catch(() => {})
    window.api.settings.get('invertDarkImages').then((val: string | null) => {
      if (val === 'true') setInvertDarkImagesState(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (invertDarkImages) {
      document.documentElement.classList.add('invert-dark-images')
    } else {
      document.documentElement.classList.remove('invert-dark-images')
    }
  }, [invertDarkImages])

  const setBackground = (value: BackgroundMode) => {
    setBackgroundState(value)
    window.api.settings.set('background', value).catch(() => {})
  }

  const setInvertDarkImages = (value: boolean) => {
    setInvertDarkImagesState(value)
    window.api.settings.set('invertDarkImages', String(value)).catch(() => {})
  }

  return (
    <AppearanceContext.Provider value={{ background, setBackground, invertDarkImages, setInvertDarkImages }}>
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider')
  return ctx
}
```

- [ ] **Step 2.3: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests pass (the context has no direct unit tests; the change is additive).

- [ ] **Step 2.4: Commit**

```bash
git add src/contexts/Appearance.tsx
git commit -m "feat(invert): add invertDarkImages to AppearanceContext"
```

---

## Task 3: CSS rule

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 3.1: Add the CSS rule**

Open `src/styles/globals.css`. Find the section near other README image rules (search for `.rm-img-logo`). Add the following rule **after** the existing `.rm-img-logo` block:

```css
.invert-dark-images img[data-needs-invert="true"] {
  filter: invert(1);
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(invert): add CSS rule for invert-dark-images setting"
```

---

## Task 4: ReadmeRenderer — detection in `onLoad` handlers + prop + memo fix

**Files:**
- Modify: `src/components/ReadmeRenderer.tsx`

This task has three sub-changes that must all land together for the feature to work correctly:
1. Accept the `invertDarkImages` prop
2. Run detection in both `onLoad` paths
3. Fix the `memo` comparator

- [ ] **Step 4.1: Add the prop to the `Props` interface**

Locate the `Props` interface (around line 1082):

```typescript
interface Props {
  content: string
  repoOwner: string
  repoName: string
  branch?: string
  basePath?: string
  onNavigateToFile?: (path: string) => void
  onTocReady?: (headings: TocItem[]) => void
  readmeBodyRef?: React.RefObject<HTMLDivElement>
}
```

Add `invertDarkImages?: boolean` to it:

```typescript
interface Props {
  content: string
  repoOwner: string
  repoName: string
  branch?: string
  basePath?: string
  onNavigateToFile?: (path: string) => void
  onTocReady?: (headings: TocItem[]) => void
  readmeBodyRef?: React.RefObject<HTMLDivElement>
  invertDarkImages?: boolean
}
```

- [ ] **Step 4.2: Destructure the prop in the function signature**

Locate the function signature for `ReadmeRenderer` (around line 1093):

```typescript
function ReadmeRenderer({ content, repoOwner, repoName, branch = 'main', basePath = '', onNavigateToFile, onTocReady, readmeBodyRef }: Props) {
```

Add `invertDarkImages = false`:

```typescript
function ReadmeRenderer({ content, repoOwner, repoName, branch = 'main', basePath = '', onNavigateToFile, onTocReady, readmeBodyRef, invertDarkImages = false }: Props) {
```

- [ ] **Step 4.3: Add the import for the detection utility**

At the top of the file, alongside other utility imports (look for the `import { classifyImage }` line):

```typescript
import { detectImageNeedsInvert } from '../utils/detectImageNeedsInvert'
```

- [ ] **Step 4.4: Add detection to the `rm-img-logo` branch**

Locate the `rm-img-logo` rendering block inside `mdComponents` (around line 1843):

```typescript
      if (treatment === 'logo') {
        return (
          <img src={src} alt={alt ?? ''} className="rm-img-logo" loading="lazy"
            style={pctStyle}
            {...(declaredHeight ? { height: declaredHeight } : {})}
            {...(!isPctW && declaredWidth ? { width: declaredWidth } : {})}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )
      }
```

Replace with:

```typescript
      if (treatment === 'logo') {
        return (
          <img src={src} alt={alt ?? ''} className="rm-img-logo" loading="lazy"
            style={pctStyle}
            {...(declaredHeight ? { height: declaredHeight } : {})}
            {...(!isPctW && declaredWidth ? { width: declaredWidth } : {})}
            onLoad={invertDarkImages ? (e) => {
              const el = e.target as HTMLImageElement
              if (detectImageNeedsInvert(el)) el.setAttribute('data-needs-invert', 'true')
            } : undefined}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )
      }
```

- [ ] **Step 4.5: Add detection to the `rm-img-content` branch**

Locate the `rm-img-content` `onLoad` handler (around line 1860). It currently looks like:

```typescript
          onLoad={(e) => {
            const el = e.target as HTMLImageElement
            if (el.naturalHeight > 0 && el.naturalWidth / el.naturalHeight > 3 && el.naturalHeight < 80) {
              el.className = 'rm-img-logo'
              el.onclick = null
            }
          }}
```

Replace with:

```typescript
          onLoad={(e) => {
            const el = e.target as HTMLImageElement
            if (el.naturalHeight > 0 && el.naturalWidth / el.naturalHeight > 3 && el.naturalHeight < 80) {
              el.className = 'rm-img-logo'
              el.onclick = null
            }
            if (invertDarkImages && detectImageNeedsInvert(el)) {
              el.setAttribute('data-needs-invert', 'true')
            }
          }}
```

- [ ] **Step 4.6: Add `invertDarkImages` to the `useMemo` dep array**

Locate the end of the `mdComponents` `useMemo` (around line 1880):

```typescript
  }), [fnHistory, activeVideo, hoverVideo, ttsReady])
```

Replace with:

```typescript
  }), [fnHistory, activeVideo, hoverVideo, ttsReady, invertDarkImages])
```

- [ ] **Step 4.7: Fix the `memo` comparator**

Locate the export at the bottom of the file (lines 1998–2006):

```typescript
export default memo(ReadmeRenderer, (prev, next) =>
  prev.content === next.content &&
  prev.repoOwner === next.repoOwner &&
  prev.repoName === next.repoName &&
  prev.branch === next.branch &&
  prev.onNavigateToFile === next.onNavigateToFile &&
  prev.onTocReady === next.onTocReady &&
  prev.readmeBodyRef === next.readmeBodyRef
)
```

Replace with:

```typescript
export default memo(ReadmeRenderer, (prev, next) =>
  prev.content === next.content &&
  prev.repoOwner === next.repoOwner &&
  prev.repoName === next.repoName &&
  prev.branch === next.branch &&
  prev.onNavigateToFile === next.onNavigateToFile &&
  prev.onTocReady === next.onTocReady &&
  prev.readmeBodyRef === next.readmeBodyRef &&
  prev.invertDarkImages === next.invertDarkImages
)
```

- [ ] **Step 4.8: Run existing ReadmeRenderer tests**

```bash
npm test -- --reporter=verbose src/components/ReadmeRenderer.test.tsx
```

Expected: all existing tests pass.

- [ ] **Step 4.9: Commit**

```bash
git add src/components/ReadmeRenderer.tsx
git commit -m "feat(invert): wire invertDarkImages prop into ReadmeRenderer onLoad handlers"
```

---

## Task 5: RepoDetail — pass the setting as a prop

**Files:**
- Modify: `src/views/RepoDetail.tsx`

- [ ] **Step 5.1: Pull setting from context**

`RepoDetail.tsx` does not currently import `useAppearance`. Add the import near the top of the file alongside other context/hook imports:

```typescript
import { useAppearance } from '../contexts/Appearance'
```

Then inside the `RepoDetail` component body, add:

```typescript
const { invertDarkImages } = useAppearance()
```

- [ ] **Step 5.2: Pass the prop to `ReadmeRenderer`**

Search for the `<ReadmeRenderer` usage in `RepoDetail.tsx`. It looks like:

```typescript
<ReadmeRenderer
  content={...}
  repoOwner={owner ?? ''}
  repoName={name ?? ''}
  ...
/>
```

Add `invertDarkImages={invertDarkImages}` to it.

- [ ] **Step 5.3: Run the test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5.4: Commit**

```bash
git add src/views/RepoDetail.tsx
git commit -m "feat(invert): pass invertDarkImages from Appearance context to ReadmeRenderer"
```

---

## Task 6: Settings UI — add toggle

**Files:**
- Modify: `src/views/Settings.tsx`

- [ ] **Step 6.1: Pull setting from context**

In `Settings.tsx`, `useAppearance` is already imported. Find the destructuring line (around line 84):

```typescript
const { background, setBackground } = useAppearance()
```

Replace with:

```typescript
const { background, setBackground, invertDarkImages, setInvertDarkImages } = useAppearance()
```

- [ ] **Step 6.2: Add the toggle row in `renderAppearance`**

Find `renderAppearance` — it ends with the Background picker group and closing `</>`. Add a new `settings-group` block **after** the Background group and before the closing `</>`:

```typescript
      <div className="settings-group">
        <div className="settings-group-title">Images</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Invert dark images</div>
              <div className="settings-group-row-sub">
                Automatically inverts logos and banners with dark content so they&rsquo;re readable on dark backgrounds.
              </div>
            </div>
            <input
              type="checkbox"
              checked={invertDarkImages}
              onChange={(e) => setInvertDarkImages(e.target.checked)}
              aria-label="Invert dark images"
            />
          </div>
        </div>
      </div>
```

- [ ] **Step 6.3: Run the full test suite one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6.4: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "feat(invert): add Invert dark images toggle in Appearance settings"
```

---

## Verification checklist (manual)

After all tasks are committed:

1. Open the app, go to Settings → Appearance. The "Invert dark images" toggle should appear below the Background picker.
2. Enable the toggle. Navigate to a repo with a dark logo (e.g. `flipt-io/flipt`). README logos that are black-on-white/transparent should appear white.
3. Disable the toggle. Logos should immediately revert to their original appearance (CSS class removed from `<html>`).
4. Navigate to a repo with a colourful screenshot-heavy README (e.g. a game or art project). Images should not be inverted.
5. Re-open the app (restart). The setting should persist — if it was on, logos should still be inverted.
