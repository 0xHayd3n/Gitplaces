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
    // Local import stubbed as _$stub. Not sent to esm.sh.
    expect(html).toContain('const Card = _$stub')
    expect(html).not.toContain('esm.sh/./Card')
  })

  it('inlines helper sources when provided, not stubbed as null', async () => {
    const compSource = "import { parseLength } from './helpers/parseLength'\n"
      + "export default function BarLoader({ size = 4 }) {\n"
      + "  const { value, unit } = parseLength(size)\n"
      + "  return null\n"
      + "}"
    const helperSource = "export function parseLength(size) {\n"
      + "  if (typeof size === 'number') return { value: size, unit: 'px' }\n"
      + "  return { value: 0, unit: 'px' }\n"
      + "}"
    const html = await buildIframeHtml(
      { ...reactComp(), path: 'src/spinners/BarLoader.tsx' },
      compSource,
      {},
      'dark',
      { byPath: { 'src/spinners/helpers/parseLength.ts': helperSource } },
    )
    // Helper code is inlined — `parseLength` defined as a real function,
    // not stubbed as `_$stub`.
    expect(html).toContain('function parseLength')
    expect(html).toContain('inlined: src/spinners/helpers/parseLength.ts')
    expect(html).not.toContain('const parseLength = _$stub')
  })

  it('falls back to null stub when helper file is not in the helpers map', async () => {
    const compSource = "import { unknownHelper } from './helpers/missing'\n"
      + "export default function C() { return null }"
    const html = await buildIframeHtml(
      { ...reactComp(), path: 'src/Foo.tsx' },
      compSource,
      {},
      'dark',
      { byPath: {} },
    )
    expect(html).toContain('const unknownHelper = _$stub')
  })

  it('inlines transitive helper deps in dependency order', async () => {
    // Component imports A; A imports B. Both should be inlined, B before A.
    const compSource = "import { A } from './A'\n"
      + "export default function C() { return A() }"
    const helperA = "import { B } from './B'\n"
      + "export const A = () => B()"
    const helperB = "export const B = () => 42"
    const html = await buildIframeHtml(
      { ...reactComp(), path: 'src/C.tsx' },
      compSource,
      {},
      'dark',
      { byPath: {
        'src/A.ts': helperA,
        'src/B.ts': helperB,
      } },
    )
    const idxB = html?.indexOf('inlined: src/B.ts') ?? -1
    const idxA = html?.indexOf('inlined: src/A.ts') ?? -1
    const idxC = html?.indexOf('component: src/C.tsx') ?? -1
    expect(idxB).toBeGreaterThan(-1)
    expect(idxA).toBeGreaterThan(-1)
    expect(idxC).toBeGreaterThan(-1)
    expect(idxB).toBeLessThan(idxA)
    expect(idxA).toBeLessThan(idxC)
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

// Regression tests for the helper-inlining bugs that broke material-tailwind
// (and any library where helpers re-export a default identifier or use
// `export *` re-exports). All three bugs surfaced as "Compile returned null
// (source tier)" because the broken inlined block was a syntax error.
describe('buildIframeHtml — helper inlining: export forms', () => {
  const reactComp = (path = 'src/Comp.tsx'): ParsedComponent => ({
    name: 'Comp', props: [], framework: 'react', renderable: true, path,
  })

  it('strips `export default <identifier>;` from helpers without producing `const  = identifier`', async () => {
    // Reproduces material-tailwind's theme/index pattern: a helper that
    // declares an object then re-exports it as the default.
    const compSource = "import theme from './theme'\nexport default function Comp() { return theme.color }"
    const helperSource = "const theme = { color: 'red' };\nexport default theme;"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/theme.ts': helperSource } },
    )
    expect(html).not.toBeNull()
    // The previously-broken code path emitted `const  = theme` (empty binding).
    expect(html).not.toMatch(/const\s+=\s+theme/)
    // The identifier should still be in scope from its `const theme = {...}` declaration.
    expect(html).toContain("const theme = { color: 'red' }")
  })

  it('keeps named function/class declarations when stripping `export default`', async () => {
    const compSource = "import f from './f'\nexport default function Comp() { return f() }"
    const helperSource = "export default function f() { return 42 }"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/f.ts': helperSource } },
    )
    expect(html).toContain('function f()')
    expect(html).not.toContain('export default function f')
  })

  it('strips `export * from "..."` re-export lines from helpers', async () => {
    // Reproduces material-tailwind's theme/index.ts which has dozens of
    // `export * from "./components/<name>";` lines. The target paths are
    // already inlined as preceding helper blocks, so these lines must be
    // dropped — leaving them in produces dangling relative imports.
    const compSource = "import theme from './theme'\nexport default function Comp() { return null }"
    const helperSource = "export * from './missing'\nexport * as ns from './also-missing'\nconst theme = {};\nexport default theme;"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/theme.ts': helperSource } },
    )
    expect(html).not.toContain("export * from './missing'")
    expect(html).not.toContain("export * as ns")
  })

  it('strips `export { … }` re-export lines from helpers', async () => {
    const compSource = "import h from './h'\nexport default function Comp() { return h }"
    const helperSource = "const h = 1;\nconst extra = 2;\nexport { extra };\nexport default h;"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/h.ts': helperSource } },
    )
    expect(html).not.toContain('export { extra }')
    // The const declarations themselves should still be there.
    expect(html).toContain('const h = 1')
    expect(html).toContain('const extra = 2')
  })
})

describe('buildIframeHtml — helper inlining: bare-import consolidation', () => {
  const reactComp = (path = 'src/Comp.tsx'): ParsedComponent => ({
    name: 'Comp', props: [], framework: 'react', renderable: true, path,
  })

  it('deduplicates default imports that appear in multiple helpers', async () => {
    // material-tailwind has `import PropTypes from "prop-types"` in 3+ helpers.
    // Concatenating those lines verbatim is a parse error in ESM.
    const compSource = "import a from './a'\nimport b from './b'\nexport default function Comp() { return a() + b() }"
    const helperA = "import PropTypes from 'prop-types'\nexport const a = () => PropTypes.string"
    const helperB = "import PropTypes from 'prop-types'\nexport const b = () => PropTypes.number"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/a.ts': helperA, 'src/b.ts': helperB } },
    )
    expect(html).not.toBeNull()
    const propTypesImports = (html!.match(/import\s+PropTypes\s+from\s+['"]prop-types['"]/g) ?? []).length
    expect(propTypesImports).toBe(1)
  })

  it('merges named imports from the same module across helpers', async () => {
    const compSource = "import a from './a'\nimport b from './b'\nexport default function Comp() { return a() + b() }"
    const helperA = "import { useState } from 'react'\nexport const a = () => useState(0)"
    const helperB = "import { useEffect } from 'react'\nexport const b = () => useEffect(() => {})"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/a.ts': helperA, 'src/b.ts': helperB } },
    )
    expect(html).not.toBeNull()
    // Both names should appear in a single consolidated import.
    expect(html).toMatch(/import\s+\{[^}]*useState[^}]*useEffect[^}]*\}\s+from\s+['"]react['"]/)
  })

  it('preserves a single bare import when it only appears once', async () => {
    const compSource = "import a from './a'\nexport default function Comp() { return a() }"
    const helperA = "import classnames from 'classnames'\nexport const a = () => classnames('x', 'y')"
    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: { 'src/a.ts': helperA } },
    )
    expect(html).toContain("import classnames from 'classnames'")
  })

  it('dedups same-named top-level declarations across inlined helpers', async () => {
    // Reproduces the material-tailwind types-collision bug: two helpers
    // (e.g. types/components/popover.ts and types/components/menu.ts) each
    // declare the same identifiers with identical or near-identical shapes.
    // Concatenating both into one module is a parse error in ESM — esbuild
    // reports `The symbol "X" has already been declared`.
    const compSource = "import { propTypesClassName } from './types/popover'\n"
      + "import { propTypesClassName as menuClassName } from './types/menu'\n"
      + "export default function Comp() { return null }"
    const popoverTypes = [
      'export type variant = "filled" | "outlined";',
      'export const propTypesClassName = "string";',
      'export const propTypesOpen = "bool";',
    ].join('\n')
    const menuTypes = [
      'export type variant = "filled" | "outlined";',
      'export const propTypesClassName = "string";',
      'export const propTypesOpen = "bool";',
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'Comp', props: [], framework: 'react', renderable: true, path: 'src/Comp.tsx' },
      compSource, {}, 'dark',
      { byPath: { 'src/types/popover.ts': popoverTypes, 'src/types/menu.ts': menuTypes } },
    )
    expect(html).not.toBeNull()
    // After dedup, each duplicated identifier appears in exactly one declaration.
    const variantDecls = (html!.match(/^type\s+variant\s*=/gm) ?? []).length
    expect(variantDecls).toBe(1)
    const propTypesClassNameDecls = (html!.match(/^const\s+propTypesClassName\s*=/gm) ?? []).length
    expect(propTypesClassNameDecls).toBe(1)
    const propTypesOpenDecls = (html!.match(/^const\s+propTypesOpen\s*=/gm) ?? []).length
    expect(propTypesOpenDecls).toBe(1)
  })

  it("preserves a value declaration when an earlier type uses the same name", async () => {
    // Reproduces material-tailwind's `stepper` runtime error: types/.../stepper.ts
    // declares `export type stepper = …` and theme/components/stepper/index.ts
    // declares `export const stepper = …`. TS treats these as separate
    // namespaces (esbuild strips the type), so both should survive into the
    // output. A naive single-Set dedup would drop the const because the type
    // was seen first, and the rendered iframe would fail with `stepper is
    // not defined` when the theme object references it.
    const compSource = "import { useTheme } from './ctx'\nexport default function Comp() { return null }"
    const ctx = "import theme from './theme/index'\nimport type { stepper } from './types/stepper'\nexport const useTheme = () => theme;"
    const themeIndex = "import { stepper } from './components/stepper'\nconst theme = { stepper };\nexport default theme;"
    const themeStepper = "export const stepper = { defaultProps: {} };"
    const stepperTypes = "export type stepper = { defaultProps?: object };"

    const html = await buildIframeHtml(
      { name: 'Comp', props: [], framework: 'react', renderable: true, path: 'src/Comp.tsx' },
      compSource, {}, 'dark',
      { byPath: {
        'src/ctx.ts': ctx,
        'src/theme/index.ts': themeIndex,
        'src/theme/components/stepper.ts': themeStepper,
        'src/types/stepper.ts': stepperTypes,
      } },
    )
    expect(html).not.toBeNull()
    // The const declaration must survive.
    expect(html).toContain('const stepper = { defaultProps: {} }')
    // The theme object must reference it.
    expect(html).toMatch(/const theme\s*=\s*\{\s*stepper\s*\}/)
  })

  it("drops helper stubs that collide with the rendered component's own declaration", async () => {
    // Reproduces material-tailwind's SpeedDial pattern: a parent index.tsx
    // (a sibling helper) imports the component being rendered. The import
    // gets stubbed as `const SpeedDialContent = _$stub;`, which then
    // collides with the component's `export const SpeedDialContent = …`.
    // Dedup must drop the helper stub, not the component's real declaration.
    const compSource = "import { useParent } from './parent'\n"
      + "export const Child = () => null\n"
      + "export default Child"
    const parent = [
      // The parent helper imports a sibling that resolves to the COMPONENT
      // being rendered. That import doesn't strip (target isn't in helpers
      // map) and gets stubbed by prepareForCompile.
      "import Child from './Child'",
      "export const useParent = () => Child",
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'Child', props: [], framework: 'react', renderable: true,
        path: 'src/Pkg/Child.tsx' },
      compSource, {}, 'dark',
      { byPath: { 'src/Pkg/parent.ts': parent } },
    )
    expect(html).not.toBeNull()
    // After dedup the helper stub is removed; after stripExports the
    // component's `export const Child` becomes `const Child`. Either way,
    // `Child` should be declared exactly once.
    const childDecls = (html!.match(/^const\s+Child\s*=/gm) ?? []).length
    expect(childDecls).toBe(1)
  })

  it('dedups stubs from multi-line type imports that share names across helpers', async () => {
    // Reproduces the bug where multiple theme files each have a multi-line
    // `import type { className, ... } from "../../../types/components/<X>"`.
    // Those imports survive stripInlinedImports (its regex excludes newlines)
    // and get stubbed by prepareForCompile as `const className = _$stub;`.
    // Without trailing semicolons on the stubs, findDeclarationEnd runs past
    // them looking for a terminator and absorbs subsequent declarations into
    // the first one's range, which leaks duplicates through dedup.
    const compSource = "import { useTheme } from './ctx'\nexport default function Comp() { return null }"
    const ctx = "import theme from '../theme/index'\nconst _ctx = theme;\nexport const useTheme = () => _ctx;"
    const themeIndex = "import a from './components/a'\nimport b from './components/b'\nconst theme = { a, b };\nexport default theme;"
    const themeA = [
      'import type {',
      '  variant,',
      '  className,',
      '} from "../../../types/components/a";',
      'const a = { defaultProps: {} };',
      'export default a;',
    ].join('\n')
    const themeB = [
      'import type {',
      '  variant,',
      '  className,',
      '} from "../../../types/components/b";',
      'const b = { defaultProps: {} };',
      'export default b;',
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'Comp', props: [], framework: 'react', renderable: true, path: 'src/Comp.tsx' },
      compSource, {}, 'dark',
      { byPath: {
        'src/ctx.ts': ctx,
        'src/theme/index.ts': themeIndex,
        'src/theme/components/a/index.ts': themeA,
        'src/theme/components/b/index.ts': themeB,
      } },
    )
    expect(html).not.toBeNull()
    // The stubs from BOTH theme files would yield two `const variant = ...`
    // and two `const className = ...` lines — esbuild rejects the duplicates.
    // Dedup MUST collapse to one of each.
    const variantDecls = (html!.match(/^const\s+variant\s*=/gm) ?? []).length
    const classNameDecls = (html!.match(/^const\s+className\s*=/gm) ?? []).length
    expect(variantDecls).toBeLessThanOrEqual(1)
    expect(classNameDecls).toBeLessThanOrEqual(1)
  })

  it('does not absorb the declaration following a multi-line call ending with `)` (no semicolon)', async () => {
    // Reproduces the material-tailwind runtime error: multiple helpers each
    // declare `const propTypesVariant = PropTypes.oneOf([...])` (no trailing
    // semicolon). The first occurrence is kept; subsequent duplicates are
    // skipped. The OLD findDeclarationEnd bug: it only accepted `;` or `}` as
    // terminators, so the closing `)` on the last line of the duplicate was
    // not recognised — scanning continued into the NEXT declaration
    // (`const stepper = ...`), absorbing it into the skipped range. The result
    // was `stepper is not defined` at runtime.
    const compSource = "import a from './a'\nexport default function Comp() { return null }"
    const helperA = "import x from './types-1'\nimport y from './types-2'\nexport default {}"
    const types1 = "export const propTypesVariant = 'filled';"
    const types2 = [
      "export const propTypesVariant = PropTypes.oneOf([",
      "  'filled',",
      "  'outlined'",
      "])",
      "export const important = 'survives';",
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'Comp', props: [], framework: 'react', renderable: true, path: 'src/Comp.tsx' },
      compSource, {}, 'dark',
      { byPath: {
        'src/a.ts': helperA,
        'src/types-1.ts': types1,
        'src/types-2.ts': types2,
      } },
    )
    expect(html).not.toBeNull()
    // Declaration following the `)` must survive — it was absorbed and
    // silently dropped by the old findDeclarationEnd.
    expect(html).toContain("important = 'survives'")
    // propTypesVariant appears exactly once (deduped from two sources).
    const variantDecls = (html!.match(/^const\s+propTypesVariant\s*=/gm) ?? []).length
    expect(variantDecls).toBe(1)
  })

  it('preserves multi-line declarations when deduping (PropTypes.shape across lines)', async () => {
    const compSource = "import { propTypesShape } from './a'\nexport default function Comp() { return null }"
    const helperA = [
      'export const propTypesShape = PropTypes.shape({',
      '  open: PropTypes.bool,',
      '  count: PropTypes.number,',
      '});',
      'export const after = 1;',
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'Comp', props: [], framework: 'react', renderable: true, path: 'src/Comp.tsx' },
      compSource, {}, 'dark',
      { byPath: { 'src/a.ts': helperA } },
    )
    expect(html).not.toBeNull()
    // Multi-line declaration must be kept intact, including its closing `});`.
    expect(html).toContain('open: PropTypes.bool')
    expect(html).toContain('count: PropTypes.number')
    // Following declaration on the next line must still be present (i.e. dedup
    // didn't accidentally swallow lines past the multi-line decl's end).
    expect(html).toContain('const after = 1')
  })

  it('handles the full material-tailwind helper graph without producing syntax errors', async () => {
    // End-to-end repro of all three helper-inlining bugs together:
    //   - theme/index.ts ends with `export default theme;` (broken stripExports)
    //   - theme/index.ts has `export * from "./components/X";` (un-stripped)
    //   - context/theme.js, generic.ts, accordion.ts all `import PropTypes from "prop-types"` (duplicate)
    const accordionBody = [
      'import React from "react";',
      'import { useTheme } from "../../context/theme";',
      'import objectsToString from "../../utils/objectsToString";',
      'import { propTypesClassName } from "../../types/components/accordion";',
      'export const AccordionBody = React.forwardRef((props, ref) => {',
      '  const { accordion } = useTheme();',
      '  const cls = objectsToString(accordion?.styles?.base?.body ?? {});',
      '  return React.createElement("div", { ref, className: cls });',
      '});',
      'AccordionBody.propTypes = { className: propTypesClassName };',
      'export default AccordionBody;',
    ].join('\n')

    const themeIndex = [
      'import accordion from "./components/accordion";',
      'import alert from "./components/alert";',
      'const theme = { accordion, alert };',
      'export * from "./components/accordion";',
      'export * from "./components/alert";',
      'export default theme;',
    ].join('\n')

    const themeContext = [
      'import React, { createContext, useContext } from "react";',
      'import PropTypes from "prop-types";',
      'import theme from "../theme/index";',
      'const MaterialTailwindTheme = createContext(theme);',
      'const useTheme = () => useContext(MaterialTailwindTheme);',
      'export { useTheme };',
    ].join('\n')

    const accordionTypes = [
      'import PropTypes from "prop-types";',
      'export type className = string;',
      'export const propTypesClassName = PropTypes.string;',
    ].join('\n')

    const html = await buildIframeHtml(
      { name: 'AccordionBody', props: [], framework: 'react', renderable: true,
        path: 'packages/material-tailwind-react/src/components/Accordion/AccordionBody.tsx' },
      accordionBody, {}, 'dark',
      { byPath: {
        'packages/material-tailwind-react/src/theme/index.ts': themeIndex,
        'packages/material-tailwind-react/src/theme/components/accordion.ts': 'const accordion = {}; export default accordion;',
        'packages/material-tailwind-react/src/theme/components/alert.ts': 'const alert = {}; export default alert;',
        'packages/material-tailwind-react/src/context/theme.js': themeContext,
        'packages/material-tailwind-react/src/utils/objectsToString.js': 'export default function objectsToString(o) { return Object.values(o).join(" ") }',
        'packages/material-tailwind-react/src/types/components/accordion.ts': accordionTypes,
      } },
    )

    expect(html).not.toBeNull()
    // No broken `const = identifier` from stripExports(name='').
    expect(html).not.toMatch(/const\s+=\s+\w/)
    // No surviving `export *` re-exports.
    expect(html).not.toMatch(/^export\s+\*/m)
    // PropTypes appears in 3 helpers — final output should declare it once.
    const propTypesImports = (html!.match(/import\s+PropTypes\s+from\s+['"]prop-types['"]/g) ?? []).length
    expect(propTypesImports).toBe(1)
    // theme should still be in scope by name (its `const theme = {…}` declaration survived).
    expect(html).toContain('const theme = { accordion, alert }')
  })
})

describe('buildIframeHtml — barrel and multi-line import handling', () => {
  const reactComp = (path = 'src/Comp.tsx'): ParsedComponent => ({
    name: 'Comp', props: [], framework: 'react', renderable: true, path,
  })

  it('stubs named exports from a pure barrel whose sub-files are not in helpers', async () => {
    // Reproduces material-tailwind's stepper: theme/index.ts imports
    // `import { stepper } from "./stepperBarrel"` which resolves to a barrel
    // that only does `export * from "./stepperImpl"`. The barrel IS in
    // helpers.byPath (fetched) but its sub-file is NOT (simulating HELPER_MAX_FILES
    // cutoff). Old code added the barrel to inlinedSet, stripped the import,
    // but never declared `stepper` → ReferenceError at runtime.
    const compSource = "import { useTheme } from './ctx'\nexport default function Comp() { return null }"
    const ctx = "import theme from './themeIndex'\nexport const useTheme = () => theme;"
    const themeIndex = "import { stepper } from './stepperBarrel'\nconst theme = { stepper };\nexport default theme;"
    const stepperBarrel = "export * from './stepperImpl';"  // pure barrel — sub-file NOT in helpers

    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: {
        'src/ctx.ts': ctx,
        'src/themeIndex.ts': themeIndex,
        'src/stepperBarrel.ts': stepperBarrel,
        // stepperImpl.ts intentionally absent (simulates HELPER_MAX_FILES cutoff)
      } },
    )
    expect(html).not.toBeNull()
    // `stepper` must be stubbed (not undefined). Old bug: barrel → inlinedSet →
    // import stripped → name never declared → ReferenceError.
    expect(html).toContain('const stepper = _$stub')
    expect(html).toContain('const theme')
  })

  it('stubs named exports from a barrel even when sub-files ARE inlined (dedup removes stub)', async () => {
    // When the barrel's sub-files ARE in helpers, the real declarations come
    // from them. The barrel is still removed from inlinedSet, causing a stub
    // to be generated. dedupTopLevelDeclarations drops the stub (real decl wins).
    const compSource = "import { useTheme } from './ctx'\nexport default function Comp() { return null }"
    const ctx = "import theme from './themeIndex'\nexport const useTheme = () => theme;"
    const themeIndex = "import { stepper } from './stepperBarrel'\nconst theme = { stepper };\nexport default theme;"
    const stepperBarrel = "export * from './stepperImpl';"
    const stepperImpl = "export const stepper = { defaultProps: {} };"

    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: {
        'src/ctx.ts': ctx,
        'src/themeIndex.ts': themeIndex,
        'src/stepperBarrel.ts': stepperBarrel,
        'src/stepperImpl.ts': stepperImpl,
      } },
    )
    expect(html).not.toBeNull()
    // Real declaration from stepperImpl survives; stub from themeIndex is deduped.
    const stepperDecls = (html!.match(/^const\s+stepper\s*=/gm) ?? []).length
    expect(stepperDecls).toBe(1)
    expect(html).toContain("stepper = { defaultProps: {} }")
  })

  it('stubs named exports from multi-line import blocks', async () => {
    // Reproduces theme/index.ts importing timeline with a multi-line named
    // import block. The single-line regex in stripInlinedImports/prepareForCompile
    // can't match multi-line imports; names must still be stubbed.
    const compSource = "import { useTheme } from './ctx'\nexport default function Comp() { return null }"
    const ctx = "import theme from './themeHelper'\nexport const useTheme = () => theme;"
    const themeHelper = [
      'import {',
      '  timeline,',
      '  timelineItem,',
      "} from './timelineModule';",
      'const theme = { timeline, timelineItem };',
      'export default theme;',
    ].join('\n')

    const html = await buildIframeHtml(
      reactComp(), compSource, {}, 'dark',
      { byPath: {
        'src/ctx.ts': ctx,
        'src/themeHelper.ts': themeHelper,
        // timelineModule absent — tests multi-line import stubbing
      } },
    )
    expect(html).not.toBeNull()
    // Names from multi-line import must be stubbed (not left as dangling
    // relative module references the browser can't resolve from a blob URL).
    expect(html).toContain('const timeline = _$stub')
    expect(html).toContain('const timelineItem = _$stub')
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
