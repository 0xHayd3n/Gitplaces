import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression coverage for the Discover title-bar drag region.
 *
 * Two CSS contracts must hold simultaneously for the pill nav to be clickable
 * while still allowing the user to drag the Electron window:
 *
 *   1. .discover-drag-strip must be `display: none` whenever the pill nav is
 *      mounted. Its OS-level `-webkit-app-region: drag` intercepts clicks on
 *      anything painted above it (z-index doesn't help — Electron processes
 *      drag at the OS layer before DOM hit-testing).
 *
 *   2. The nav wrapper .discover-top-nav must itself be a drag region
 *      (`-webkit-app-region: drag`) so the user can still drag the window
 *      from the title-bar zone around the pill.
 *
 * This test asserts the CSS file contains both rules. It will fail if a future
 * refactor reintroduces the old `.discover-top-nav--compact`-gated selector or
 * drops the drag-region declaration on the wrapper.
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

  it('hides .discover-drag-strip whenever .discover-top-nav is present', () => {
    // Must NOT be gated on the removed --compact modifier
    expect(globals).not.toMatch(/\.discover-top-nav--compact[^{]*\)\s+\.discover-drag-strip/)

    // Must hide via :has(.discover-top-nav) (or an equivalent unconditional rule)
    expect(globals).toMatch(/:has\(\.discover-top-nav\)\s+\.discover-drag-strip\s*\{[^}]*display:\s*none/)
  })

  it('declares -webkit-app-region: drag on the nav wrapper', () => {
    const wrapperBlock = dtnCss.match(/\.discover-top-nav\s*\{[^}]*\}/)?.[0] ?? ''
    expect(wrapperBlock).toContain('-webkit-app-region: drag')
  })

  it('declares -webkit-app-region: no-drag and pointer-events: auto on the pill bar', () => {
    const pillBlock = dtnCss.match(/\.dtn-pill-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(pillBlock).toContain('-webkit-app-region: no-drag')
    expect(pillBlock).toContain('pointer-events: auto')
  })
})
