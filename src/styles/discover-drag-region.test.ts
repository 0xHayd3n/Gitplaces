import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression coverage for the Discover title-bar drag region.
 *
 * After three failed attempts at overlapping the pill nav with the title-bar
 * drag zone, we landed on the proven non-overlapping layout:
 *
 *   y=0..32   .discover-drag-strip  — OS-level drag region (window-move)
 *   y=36+     .discover-top-nav     — pill nav (clickable tabs + search)
 *
 * Three contracts must hold:
 *
 *   1. .discover-drag-strip is NOT conditionally hidden when .discover-top-nav
 *      is mounted. Both render simultaneously and don't overlap by design.
 *
 *   2. The pill nav wrapper sits BELOW the 32px-tall drag strip (top >= 32px).
 *      If a future refactor pushes it back into the title-bar zone, drag
 *      stops working (Chromium's drag-region hit-test is fragile inside
 *      .main-content's composite-promoted layer).
 *
 *   3. The pill bar carries -webkit-app-region: no-drag and pointer-events:
 *      auto so its tabs / search input are interactive.
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

  it('does NOT hide .discover-drag-strip when the pill nav is mounted', () => {
    expect(globals).not.toMatch(/:has\(\.discover-top-nav\)\s+\.discover-drag-strip\s*\{[^}]*display:\s*none/)
    expect(globals).not.toMatch(/\.discover-top-nav--compact[^{]*\)\s+\.discover-drag-strip/)
  })

  it('places the pill nav wrapper below the 32px drag strip', () => {
    const wrapperBlock = dtnCss.match(/\.discover-top-nav\s*\{[^}]*\}/)?.[0] ?? ''
    const topMatch = wrapperBlock.match(/top:\s*(\d+)px/)
    expect(topMatch).not.toBeNull()
    const topPx = Number(topMatch![1])
    expect(topPx).toBeGreaterThanOrEqual(32)
  })

  it('declares -webkit-app-region: no-drag and pointer-events: auto on the pill bar', () => {
    const pillBlock = dtnCss.match(/\.dtn-pill-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(pillBlock).toContain('-webkit-app-region: no-drag')
    expect(pillBlock).toContain('pointer-events: auto')
  })

  it('does NOT carry -webkit-app-region: drag on the wrapper (drag belongs on .discover-drag-strip)', () => {
    const wrapperBlock = dtnCss.match(/\.discover-top-nav\s*\{[^}]*\}/)?.[0] ?? ''
    expect(wrapperBlock).not.toContain('-webkit-app-region: drag')
  })
})
