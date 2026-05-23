// src/components/ComponentCard.tsx
//
// The "live preview" card with chrome: outer wrapper (card border, click
// handler), component name, and an `IframePreview` inside that mounts a
// real iframe once the card scrolls into view.
//
// Used by `ComponentDetailView` for the hero + variant strip. The gallery
// uses `IframePreview` directly inside its own button wrapper instead, so
// the hover-to-preview UX doesn't have to swap element types.
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import type { HelperSources } from '../utils/iframeTemplate'
import { IframePreview } from './IframePreview'

interface Props {
  component: ParsedComponent
  variant: Variant
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  helpers?: HelperSources
  hasTailwind?: boolean
  onClick: () => void
  onRenderFailed?: () => void
}

export function ComponentCard({
  component, variant, tier, bundled, theme, source, helpers, hasTailwind = false, onClick, onRenderFailed,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // Lazy-mount the iframe only when the card scrolls near the viewport.
  // 50px margin keeps a small pre-load buffer for smooth scrolling without
  // queueing every off-screen card on first mount.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ob = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true)
        ob.disconnect()
      }
    }, { rootMargin: '50px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [])

  return (
    <div ref={wrapRef} className="cg-card" data-theme={theme} onClick={onClick}>
      <div className="cg-card-name">{component.name}</div>
      <div className="cg-card-frame">
        {visible ? (
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
            onRenderFailed={onRenderFailed}
          />
        ) : (
          <div className="cg-card-skeleton" />
        )}
      </div>
    </div>
  )
}
