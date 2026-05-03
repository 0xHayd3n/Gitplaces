// src/components/ComponentGallery.tsx
import { useRef } from 'react'
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

  return (
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
          />
        )
      })}
    </div>
  )
}
