import { describe, it, expect, beforeAll } from 'vitest'
import { stubLocalImports, buildIframeHtml, buildBundledIframeHtml } from './iframeTemplate'
import type { BundledRender } from '../types/components'
import type { ParsedComponent } from './componentParser'

// Compilation now goes through window.api.components.compile (IPC → esbuild in main).
// We stub it as a passthrough so jsdom can exercise the full pipeline.
beforeAll(() => {
  ;(globalThis as unknown as { api: unknown }).api = {
    components: {
      compile: (src: string, _framework?: string) => Promise.resolve(src),
    },
  }
})

describe('stubLocalImports', () => {
  it('stubs default imports', () => {
    const result = stubLocalImports("import Foo from './foo'")
    expect(result).toBe('const Foo = () => null')
  })

  it('stubs named imports as individual function stubs', () => {
    const result = stubLocalImports("import { Bar, Baz } from '../bar'")
    expect(result).toContain('const Bar = function(){}')
    expect(result).toContain('const Baz = function(){}')
  })

  it('removes CSS side-effect imports', () => {
    const result = stubLocalImports("import './styles.css'")
    expect(result.trim()).toBe('')
  })

  it('removes React default import (already a UMD global)', () => {
    const result = stubLocalImports("import React from 'react'")
    expect(result.trim()).toBe('')
  })

  it('stubs third-party default imports as function', () => {
    const result = stubLocalImports("import PropTypes from 'prop-types'")
    expect(result).toContain('const PropTypes = function(){}')
  })

  it('stubs third-party named imports as individual function stubs', () => {
    const result = stubLocalImports("import { alpha } from '@mui/system'")
    expect(result).toContain('const alpha = function(){}')
  })

  it('stubs multiple imports', () => {
    const source = [
      "import Button from './Button'",
      "import { cn } from '../utils/cn'",
      "import './styles.css'",
      "import PropTypes from 'prop-types'",
    ].join('\n')
    const result = stubLocalImports(source)
    expect(result).toContain('const Button = () => null')
    expect(result).toContain('const cn = function(){}')
    expect(result).not.toContain("import './styles.css'")
    expect(result).toContain('const PropTypes = function(){}')
  })
})

describe('buildIframeHtml', () => {
  const baseComp = (framework: ParsedComponent['framework'], renderable = true): ParsedComponent => ({
    path: 'src/components/Button.tsx',
    name: 'Button',
    props: [],
    framework,
    renderable,
  })

  it('returns null when renderable is false', async () => {
    const comp: ParsedComponent = { path: '', name: 'X', props: [], framework: 'react', renderable: false }
    expect(await buildIframeHtml(comp, '', {})).toBeNull()
  })

  it('returns HTML for angular (TypeScript compile + bootstrap attempt)', async () => {
    const html = await buildIframeHtml(baseComp('angular'), 'class MyComp {}', {})
    expect(html).not.toBeNull()
    expect(html).toContain('zone.js')
    expect(html).toContain('bootstrapApplication')
  })

  it('returns HTML for javascript (jQuery sandbox)', async () => {
    const html = await buildIframeHtml(baseComp('javascript'), '$.fn.test = function(){}', {})
    expect(html).not.toBeNull()
    expect(html).toContain('jquery')
  })

  it('returns HTML for solid', async () => {
    const html = await buildIframeHtml(baseComp('solid'), 'export default function Button() { return null }', {})
    expect(html).not.toBeNull()
    expect(html).toContain('solid-js')
    expect(html).toContain('render')
  })

  it('returns HTML for typescript', async () => {
    const html = await buildIframeHtml(baseComp('typescript'), 'const x: number = 1', {})
    expect(html).not.toBeNull()
  })

  it('returns HTML string for react', async () => {
    const html = await buildIframeHtml(baseComp('react'), 'export default function Button() {}', {})
    expect(html).not.toBeNull()
    expect(html).toContain('react@18')
    expect(html).toContain('react-dom@18')
    expect(html).toContain('Button')
    expect(html).toContain('createRoot')
  })

  it('uses inline <script type="module"> (no Babel in iframe)', async () => {
    const html = await buildIframeHtml(baseComp('react'), 'export default function Button() {}', {})
    expect(html).toContain('<script type="module">')
    expect(html).not.toContain('@babel/standalone')
    expect(html).not.toContain('Babel.transform')
  })

  it('returns HTML string for vue', async () => {
    const html = await buildIframeHtml(baseComp('vue'), '<template><div/></template>', {})
    expect(html).not.toBeNull()
    expect(html).toContain('vue@3')
    expect(html).toContain('createApp')
  })

  it('returns HTML string for svelte', async () => {
    const html = await buildIframeHtml(baseComp('svelte'), '<div>hi</div>', {})
    expect(html).not.toBeNull()
    expect(html).toContain('svelte@4')
    expect(html).toContain('svelte.compile')
  })

  it('includes the onerror postMessage bridge', async () => {
    const html = await buildIframeHtml(baseComp('react'), '', {})
    expect(html).toContain('render-error')
    expect(html).toContain('postMessage')
  })

  it('error bridge uses wildcard origin (not window.location.origin)', async () => {
    const html = await buildIframeHtml(baseComp('react'), '', {})
    expect(html).toContain(",'*'")
    expect(html).not.toContain('window.location.origin')
  })

  it('injects generated props as JSON', async () => {
    const html = await buildIframeHtml(baseComp('react'), '', { label: 'Text', disabled: false })
    expect(html).toContain('"label":"Text"')
  })
})

describe('buildIframeHtml — import map approach', () => {
  const reactComp = (): ParsedComponent => ({
    name: 'OutlinedAlerts',
    props: [],
    framework: 'react',
    renderable: true,
    path: 'src/OutlinedAlerts.tsx',
  })

  it('includes an importmap script for React packages', async () => {
    const source = "import { Alert } from '@mui/material'\nexport default function OutlinedAlerts() { return null }"
    const html = await buildIframeHtml(reactComp(), source, {})
    expect(html).not.toBeNull()
    // The import map must be present and pin react@18 / react-dom@18
    expect(html).toContain('"importmap"')
    expect(html).toContain('react@18')
    expect(html).toContain('react-dom@18')
  })

  it('maps @mui/material to esm.sh in the import map', async () => {
    const source = "import { Alert } from '@mui/material'\nexport default function OutlinedAlerts() { return null }"
    const html = await buildIframeHtml(reactComp(), source, {})
    expect(html).not.toBeNull()
    // esm.sh URL must appear in the import map
    expect(html).toContain('esm.sh/@mui/material')
    // The bare specifier must be preserved in the module script (resolved by import map)
    expect(html).toContain("'@mui/material'")
  })

  it('maps any unknown third-party import to esm.sh', async () => {
    const source = "import { Button } from 'some-component-lib'\nexport default function C() { return null }"
    const html = await buildIframeHtml(reactComp(), source, {})
    expect(html).toContain('esm.sh/some-component-lib')
  })

  it('stubs local/relative imports as function placeholders', async () => {
    const source = "import Card from './Card'\nexport default function C() { return null }"
    const html = await buildIframeHtml(reactComp(), source, {})
    // Local import stubbed — returns null. Used as JSX renders nothing harmful;
    // destructuring throws, which is surfaced as "Preview failed" in the card UI.
    // Not sent to esm.sh.
    expect(html).toContain('const Card = () => null')
    expect(html).not.toContain('esm.sh/./Card')
  })

  it('uses ?external=react,react-dom for third-party packages', async () => {
    const source = "import { Button } from 'some-lib'\nexport default function C() { return null }"
    const html = await buildIframeHtml(reactComp(), source, {})
    // Third-party mapping should pin react to prevent duplicate instances
    expect(html).toContain('external=react')
  })

  it('strips export default from compiled code', async () => {
    const source = 'export default function OutlinedAlerts() { return null }'
    const html = await buildIframeHtml(reactComp(), source, {})
    expect(html).not.toContain('export default')
    expect(html).toContain('function OutlinedAlerts')
  })
})

const baseRender: BundledRender = {
  importUrl: 'https://esm.sh/@radix-ui/react-dialog@1.0.5',
  exportName: 'Root',
  cssUrls: [],
}

describe('buildBundledIframeHtml', () => {
  it('imports the named export from the package URL', () => {
    const html = buildBundledIframeHtml(baseRender, '{}', 'dark')
    expect(html).toContain("import { Root as _$C } from 'https://esm.sh/@radix-ui/react-dialog@1.0.5'")
  })

  it('renders with createRoot from react-dom/client', () => {
    const html = buildBundledIframeHtml(baseRender, '{}', 'dark')
    expect(html).toContain('react-dom/client')
    expect(html).toContain('createRoot')
  })

  it('emits render-error postMessage with tier=bundled on failure', () => {
    const html = buildBundledIframeHtml(baseRender, '{}', 'dark')
    expect(html).toContain("tier:'bundled'")
    expect(html).toContain('render-error')
  })

  it('sets data-theme attribute and dark class on body for dark theme', () => {
    const html = buildBundledIframeHtml(baseRender, '{}', 'dark')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('class="dark"')
  })

  it('sets data-theme attribute for light theme without dark class', () => {
    const html = buildBundledIframeHtml(baseRender, '{}', 'light')
    expect(html).toContain('data-theme="light"')
    expect(html).not.toContain('class="dark"')
  })

  it('emits each css URL as a stylesheet link with onerror remove', () => {
    const html = buildBundledIframeHtml(
      { ...baseRender, cssUrls: ['https://x.test/a.css', 'https://x.test/b.css'] },
      '{}', 'dark',
    )
    expect(html).toContain('href="https://x.test/a.css"')
    expect(html).toContain('href="https://x.test/b.css"')
    expect(html).toMatch(/onerror=["']this\.remove\(\)["']/)
  })

  it('serializes propsJson into the createElement call', () => {
    const html = buildBundledIframeHtml(baseRender, '{"x":1}', 'dark')
    expect(html).toContain('createElement(_$C, {"x":1})')
  })
})
