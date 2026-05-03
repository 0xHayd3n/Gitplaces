// src/components/ComponentGallery.tsx
import { useCallback, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import { ComponentCard } from './ComponentCard'

interface Props {
  components: ParsedComponent[]
  variantsByPath: Record<string, Variant[]>
  tierByPath: Record<string, RenderTier>
  bundledByPath: Record<string, BundledRender | undefined>
  sourceByPath: Record<string, string>
  theme: 'light' | 'dark'
  onSelect: (path: string) => void
}

const LRU_CAP = 24
// Show the "many components need providers" banner once at least this many
// cards have failed. Tuned low because most failures look like blank cards
// to the user (component renders nothing visible) and only a fraction surface
// as explicit "Preview failed" — so even a few hard failures usually mean
// the library has structural issues we can't preview.
const FAILURE_BANNER_THRESHOLD = 2

export function ComponentGallery({
  components, variantsByPath, tierByPath, bundledByPath, sourceByPath, theme, onSelect,
}: Props) {
  // Component-scoped LRU registry. Currently unused for eviction in v1 — the
  // ComponentCard already lazy-mounts via IntersectionObserver, which keeps
  // the iframe count naturally low for typical viewport sizes. The registry
  // is wired up here so a future eviction pass can hook in.
  const lruRef = useRef<Set<string>>(new Set())
  void lruRef
  void LRU_CAP

  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set())
  const handleCardFailed = useCallback((path: string) => {
    setFailedPaths(prev => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  const showBanner = failedPaths.size >= FAILURE_BANNER_THRESHOLD

  return (
    <>
      {showBanner && (
        <div className="cg-gallery-banner" role="status">
          Many components in this library require provider context or specific
          props to render in isolation. Click any card to view source.
        </div>
      )}
      <div className="cg-gallery">
        {components.map(c => {
          const variants = variantsByPath[c.path] ?? []
          const variant = variants[0]
          if (!variant) return null
          const tier = tierByPath[c.path] ?? 'source'
          return (
            <ComponentCard
              key={c.path}
              component={c}
              variant={variant}
              tier={tier}
              bundled={bundledByPath[c.path]}
              theme={theme}
              source={sourceByPath[c.path] ?? ''}
              onClick={() => onSelect(c.path)}
              onRenderFailed={() => handleCardFailed(c.path)}
            />
          )
        })}
      </div>
    </>
  )
}
