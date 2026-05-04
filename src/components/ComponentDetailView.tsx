// src/components/ComponentDetailView.tsx
import { useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import type { HelperSources } from '../utils/iframeTemplate'
import { ComponentCard } from './ComponentCard'

interface Props {
  component: ParsedComponent
  variants: Variant[]
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  helpers?: HelperSources
  hasTailwind?: boolean
  githubUrl?: string
  onBack: () => void
}

const VARIANT_VISIBLE_CAP = 6

export function ComponentDetailView({
  component, variants, tier, bundled, theme, source, helpers, hasTailwind, githubUrl, onBack,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)

  const visibleVariants = expanded ? variants : variants.slice(0, VARIANT_VISIBLE_CAP)
  const remainder = variants.length - VARIANT_VISIBLE_CAP

  const heroVariant = variants[0]

  return (
    <div className="cg-detail">
      <button className="cg-detail-back" onClick={onBack}>◂ All components</button>
      <div className="cg-detail-header">
        <h2 className="cg-detail-name">{component.name}</h2>
        {githubUrl && (
          <a className="cg-gh-link" href={githubUrl} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        )}
      </div>

      {heroVariant && (
        <div className="cg-detail-hero">
          <ComponentCard
            component={component} variant={heroVariant} tier={tier}
            bundled={bundled} theme={theme} source={source} helpers={helpers} hasTailwind={hasTailwind}
            onClick={() => {/* hero click is a no-op in detail view */}}
          />
        </div>
      )}

      {variants.length > 1 && (
        <div className="cg-detail-variants">
          <h3>Variants</h3>
          <div className="cg-variant-strip">
            {visibleVariants.map((v, i) => (
              <div key={i} className="cg-variant-tile">
                <ComponentCard
                  component={component} variant={v} tier={tier}
                  bundled={bundled} theme={theme} source={source} helpers={helpers} hasTailwind={hasTailwind}
                  onClick={() => {}}
                />
                <div className="cg-variant-name">{v.name}</div>
              </div>
            ))}
          </div>
          {!expanded && remainder > 0 && (
            <button className="cg-variant-more" onClick={() => setExpanded(true)}>
              + {remainder} more
            </button>
          )}
        </div>
      )}

      <div className="cg-detail-props">
        <h3>Props</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Required</th></tr>
          </thead>
          <tbody>
            {component.props.map(p => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.type}</td>
                <td>{p.required ? '✓' : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cg-detail-source">
        <button onClick={() => setSourceOpen(o => !o)}>
          {sourceOpen ? '▾' : '▸'} Source
        </button>
        {sourceOpen && <pre><code>{source}</code></pre>}
      </div>
    </div>
  )
}
