import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression coverage for the Discover title-bar drag region.
 *
 * Three CSS contracts must hold for the pill nav to be both clickable AND
 * draggable in the title-bar zone of the frameless Electron window:
 *
 *   1. .discover-drag-strip must be `display: none` whenever the pill nav is
 *      mounted. Its full-width OS-level drag region would otherwise intercept
 *      clicks on the pill above it (Chromium hangs -webkit-app-region:drag
 *      off elementFromPoint, which runs before DOM z-index resolution).
 *
 *   2. Drag region lives on leaf .dtn-drag-region elements (NOT on the
 *      wrapper). The original .discover-drag-strip comment in globals.css
 *      documents that the codebase's drag-region detection requires a leaf
 *      element with no descendants — parent-drag + child-no-drag combinations
 *      don't reliably resolve inside .main-content (will-change:transform).
 *
 *   3. The pill bar carries -webkit-app-region: no-drag and pointer-events:
 *      auto so its tabs / search input remain interactive between the two
 *      drag-region siblings.
 */
describe('Discover title-bar drag region (regression)', () => {
  const globals = readFileSync(
    join(__dirname, 'globals.css'),
    'utf8',
  )
  const dtnCss = readFileSync(
    join(__dirname, '..', 'components', 'DiscoverTopNav.css'),
    'utf8',
  )
  const dtnTsx = readFileSync(
    join(__dirname, '..', 'components', 'DiscoverTopNav.tsx'),
    'utf8',
  )

  it('hides .discover-drag-strip whenever .discover-top-nav is present', () => {
    // Must NOT be gated on the removed --compact modifier
    expect(globals).not.toMatch(/\.discover-top-nav--compact[^{]*\)\s+\.discover-drag-strip/)

    // Must hide via :has(.discover-top-nav) (or an equivalent unconditional rule)
    expect(globals).toMatch(/:has\(\.discover-top-nav\)\s+\.discover-drag-strip\s*\{[^}]*display:\s*none/)
  })

  it('declares -webkit-app-region: drag on the .dtn-drag-region leaf, NOT on the wrapper', () => {
    const dragLeafBlock = dtnCss.match(/\.dtn-drag-region\s*\{[^}]*\}/)?.[0] ?? ''
    expect(dragLeafBlock).toContain('-webkit-app-region: drag')

    // The wrapper itself must NOT carry drag — that combination has historically
    // broken in Chromium when the pill sits inside as a no-drag child.
    const wrapperBlock = dtnCss.match(/\.discover-top-nav\s*\{[^}]*\}/)?.[0] ?? ''
    expect(wrapperBlock).not.toContain('-webkit-app-region: drag')
  })

  it('renders two .dtn-drag-region siblings flanking the pill bar', () => {
    const dragMatches = dtnTsx.match(/className="dtn-drag-region"/g) ?? []
    expect(dragMatches.length).toBe(2)
  })

  it('declares -webkit-app-region: no-drag and pointer-events: auto on the pill bar', () => {
    const pillBlock = dtnCss.match(/\.dtn-pill-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(pillBlock).toContain('-webkit-app-region: no-drag')
    expect(pillBlock).toContain('pointer-events: auto')
  })
})
