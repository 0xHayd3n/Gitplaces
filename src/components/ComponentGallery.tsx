// src/components/ComponentGallery.tsx
//
// Hover-to-preview gallery. Default state for every tile is a static name
// + dash placeholder (zero iframes mounted, instant initial paint). When
// the user hovers a tile for ~400ms, that tile mounts a live iframe via
// `IframePreview`; mouse-leave unmounts it.
//
// Why hover-gated rather than all-iframes-at-once: a heavy component
// library (material-tailwind has ~30 components, each iframe parsing
// ~1.5MB of JS — Tailwind CDN + react + the package + framer-motion)
// reliably froze the renderer when every card mounted on first paint.
// Iframes share the renderer's main thread with the parent, so a single
// stub-context render that doesn't yield (e.g. an animation library
// spinning on proxy values) hangs the whole app — no concurrency cap,
// rAF gating, or postMessage handshake can recover, because the parent
// can't even tear the iframe down. Bounding active iframes to ≤1 (the
// hovered tile) eliminates the failure mode while still letting the
// user browse previews on demand.
//
// Implementation note: the tile is ALWAYS a `<button>`. The earlier
// version swapped between `<button>` (static) and `<div>` (live) when
// hover state flipped, which unmounted whatever element was under the
// cursor. The browser fired `mouseleave` on the unmounting element,
// which cleared the hover state, which swapped back to the original
// element — and because the cursor hadn't moved, no `mouseenter`
// fired on the remounted element. Net effect: a brief flash of preview,
// then back to static, with no way to settle. Keeping the button
// stable and swapping only its inner content avoids the loop entirely.
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import type { HelperSources } from '../utils/iframeTemplate'
import { IframePreview } from './IframePreview'

interface Props {
  components: ParsedComponent[]
  variantsByPath: Record<string, Variant[]>
  tierByPath: Record<string, RenderTier>
  bundledByPath: Record<string, BundledRender | undefined>
  sourceByPath: Record<string, string>
  helpers?: HelperSources
  hasTailwind?: boolean
  theme: 'light' | 'dark'
  onSelect: (path: string) => void
}

const HOVER_PREVIEW_DELAY_MS = 400

export function ComponentGallery({
  components, variantsByPath, tierByPath, bundledByPath, sourceByPath, helpers, hasTailwind, theme, onSelect,
}: Props) {
  // Single hovered path — only one tile previews live at a time, which
  // bounds the active iframe count to 1 across the whole gallery.
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)

  return (
    <>
      <div className="cg-gallery-banner" role="status">
        Hover any card to preview, click to view source and props.
      </div>
      <div className="cg-gallery">
        {components.map(c => {
          const variants = variantsByPath[c.path] ?? []
          const variant = variants[0]
          const tier = tierByPath[c.path] ?? 'source'
          const isHovered = hoveredPath === c.path
          return (
            <GalleryTile
              key={c.path}
              component={c}
              variant={variant}
              tier={tier}
              bundled={bundledByPath[c.path]}
              source={sourceByPath[c.path] ?? ''}
              helpers={helpers}
              hasTailwind={hasTailwind}
              theme={theme}
              live={isHovered}
              onHoverStart={() => setHoveredPath(c.path)}
              onHoverEnd={() => setHoveredPath(prev => prev === c.path ? null : prev)}
              onClick={() => onSelect(c.path)}
            />
          )
        })}
      </div>
    </>
  )
}

interface TileProps {
  component: ParsedComponent
  variant: Variant | undefined
  tier: RenderTier
  bundled?: BundledRender
  source: string
  helpers?: HelperSources
  hasTailwind?: boolean
  theme: 'light' | 'dark'
  live: boolean
  onHoverStart: () => void
  onHoverEnd: () => void
  onClick: () => void
}

function GalleryTile({
  component, variant, tier, bundled, source, helpers, hasTailwind, theme,
  live, onHoverStart, onHoverEnd, onClick,
}: TileProps) {
  // Debounce hover-start: a quick mouse pass through the tile shouldn't
  // mount an iframe. Hover-end is instant so the iframe is torn down the
  // moment the user leaves.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
  }, [])

  function handleMouseEnter() {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      onHoverStart()
    }, HOVER_PREVIEW_DELAY_MS)
  }

  function handleMouseLeave() {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    onHoverEnd()
  }

  // The button element is stable across hover state changes. Only the
  // inner content (skeleton vs IframePreview) swaps, so mouseenter /
  // mouseleave fire predictably and don't oscillate.
  return (
    <button
      type="button"
      className="cg-card"
      data-theme={theme}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="cg-card-name">{component.name}</div>
      <div className="cg-card-frame">
        {live && variant ? (
          <IframePreview
            component={component}
            variant={variant}
            tier={tier}
            bundled={bundled}
            theme={theme}
            source={source}
            helpers={helpers}
            hasTailwind={hasTailwind}
            onSourceClick={onClick}
          />
        ) : (
          <div className="cg-card-skeleton" aria-hidden="true">—</div>
        )}
      </div>
    </button>
  )
}
