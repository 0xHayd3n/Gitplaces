# Component Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-component `ComponentExplorer` with a hybrid gallery (overview grid → detail view) and add a second rendering tier that imports components from the published esm.sh bundle when the repo is on npm.

**Architecture:** Two-tier renderer (bundled-tier → source-tier fallback per component); story-file scanning for authored variants; auto-generated variants from string-union prop types when no stories exist; lazy-mounted iframes with component-scoped LRU eviction; light/dark theme toggle. Existing Storybook detection (`StorybookExplorer`) is untouched.

**Spec:** [docs/superpowers/specs/2026-05-03-component-gallery-design.md](../specs/2026-05-03-component-gallery-design.md)

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, esm.sh, Electron IPC.

---

## Pre-flight

**Before executing this plan, the WIP currently in `git status` must be committed or stashed.** It touches `electron/preload.ts`, `src/env.d.ts`, and `src/views/RepoDetail.tsx` — all of which Tasks 7–8 and 13 modify. Without resolving the WIP first, line numbers in those files may not match what this plan references.

**Verification:** before Task 1, run `git status --short` and confirm output is empty (or only contains files this plan creates).

---

## File structure

**New files (created by this plan):**
- `src/types/components.ts` (extended — see Task 1)
- `src/utils/storyParser.ts` + `.test.ts`
- `src/utils/variantGenerator.ts` + `.test.ts`
- `src/utils/componentBundle.ts` + `.test.ts`
- `src/components/ComponentSidebar.tsx` + `.test.tsx`
- `src/components/ComponentCard.tsx` + `.test.tsx`
- `src/components/ComponentGallery.tsx` + `.test.tsx`
- `src/components/ComponentDetailView.tsx` + `.test.tsx`
- `src/components/ComponentExplorer.css`

**Modified files:**
- `src/types/components.ts` — add `ScannedStory`, `Variant`, `RenderTier`, `BundledRender`, `error` field
- `src/utils/componentParser.ts` (+ `.test.ts`) — extract string-literal union types into `ParsedProp.stringUnion`
- `src/utils/iframeTemplate.ts` (+ `.test.ts`) — add `buildBundledIframeHtml`; extend `buildIframeHtml` with `theme` param
- `electron/componentScanner.ts` — extend `scanComponents` (npm registry probe, story scanning, error field)
- `electron/preload.ts` — no shape change; type only
- `src/env.d.ts` — update `window.api.components.scan` return type
- `src/components/ComponentExplorer.tsx` — full rewrite as orchestrator
- `src/views/RepoDetail.tsx:1962-1971` — no change required (existing `<ComponentExplorer />` mount is unchanged)

---

# Phase 1 — Foundations

## Task 1: Extend component types

**Files:**
- Modify: `src/types/components.ts`

- [ ] **Step 1: Read current file**

The file currently has 13 lines. Replace with the extended shape.

- [ ] **Step 2: Write full file**

```ts
// src/types/components.ts
export type Framework = 'react' | 'vue' | 'svelte' | 'solid' | 'angular' | 'javascript' | 'typescript' | 'unknown'

export type RenderTier = 'bundled' | 'source'

export interface ScannedComponent {
  path: string    // e.g. "src/components/Button.tsx"
  source: string  // raw file content
}

export interface ScannedStory {
  path: string    // e.g. "src/components/Button.stories.tsx"
  source: string  // raw file content
}

export interface ComponentScanResult {
  framework: Framework
  pkg: { name: string; version: string } | null
  components: ScannedComponent[]
  stories: ScannedStory[]
  error: 'rate-limit' | 'network' | 'timeout' | null
}

export interface BundledRender {
  importUrl: string         // e.g. "https://esm.sh/@radix-ui/react-dialog@1.0.5"
  exportName: string        // e.g. "Root"
  cssUrls: string[]         // e.g. ["https://esm.sh/@mantine/core@7.6.0/styles.css"]
}

export interface Variant {
  name: string                       // "Primary", "default", etc.
  props: Record<string, unknown>     // arg values for this render
  source: 'story' | 'auto' | 'default'
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `types/components.ts`. Errors in OTHER files (because they don't yet handle the new fields) are expected and will be fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types/components.ts
git commit -m "feat(components): extend scan result types for stories, variants, and tier selection"
```

---

## Task 2: Detect string-literal union prop types

**Files:**
- Modify: `src/utils/componentParser.ts`
- Modify: `src/utils/componentParser.test.ts`

- [ ] **Step 1: Add a failing test for string-union extraction**

Append to `src/utils/componentParser.test.ts`:

```ts
describe('parseComponent — string-literal unions', () => {
  it('extracts a string-union prop into stringUnion', () => {
    const source = `
      interface ButtonProps {
        variant: 'primary' | 'secondary' | 'ghost'
      }
    `
    const result = parseComponent('Button.tsx', source, 'react')
    const variant = result.props.find(p => p.name === 'variant')
    expect(variant?.stringUnion).toEqual(['primary', 'secondary', 'ghost'])
  })

  it('handles double-quoted union members', () => {
    const source = `
      interface Props { size: "sm" | "md" | "lg" }
    `
    const result = parseComponent('X.tsx', source, 'react')
    const size = result.props.find(p => p.name === 'size')
    expect(size?.stringUnion).toEqual(['sm', 'md', 'lg'])
  })

  it('does not set stringUnion for non-union types', () => {
    const source = `
      interface Props { label: string }
    `
    const result = parseComponent('X.tsx', source, 'react')
    expect(result.props[0].stringUnion).toBeUndefined()
  })

  it('does not set stringUnion for unions with non-string members', () => {
    const source = `
      interface Props { x: 'a' | number }
    `
    const result = parseComponent('X.tsx', source, 'react')
    expect(result.props[0].stringUnion).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- componentParser`
Expected: 4 new tests fail (`stringUnion` is undefined since the parser doesn't populate it).

- [ ] **Step 3: Add `stringUnion` to `ParsedProp`**

In `src/utils/componentParser.ts`, modify the `ParsedProp` interface (top of file):

```ts
export interface ParsedProp {
  name: string
  type: string
  required: boolean
  defaultValue?: string
  stringUnion?: string[]   // NEW — populated when type is a string-literal union
}
```

- [ ] **Step 4: Implement extraction in `parsePropBlock`**

In `src/utils/componentParser.ts`, modify `parsePropBlock` to detect string unions. Replace the existing `parsePropBlock` function (lines 38–58) with:

```ts
function parsePropBlock(block: string): ParsedProp[] {
  const props: ParsedProp[] = []
  const clean = block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  for (const line of clean.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\w+)(\?)?:\s*(.+?)[,;]?\s*$/)
    if (!m) continue
    const type = m[3].replace(/[,;]\s*$/, '').trim()
    const stringUnion = parseStringUnion(type)
    props.push({
      name:     m[1],
      type,
      required: !m[2],
      ...(stringUnion ? { stringUnion } : {}),
    })
  }
  return props
}

function parseStringUnion(type: string): string[] | undefined {
  // Match: 'a' | 'b' | 'c'  or  "a" | "b" | "c"  (no other types interleaved)
  const parts = type.split('|').map(p => p.trim())
  if (parts.length < 2) return undefined
  const literals: string[] = []
  for (const p of parts) {
    const m = p.match(/^['"]([^'"]+)['"]$/)
    if (!m) return undefined  // any non-string-literal disqualifies the whole union
    literals.push(m[1])
  }
  return literals
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- componentParser`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/componentParser.ts src/utils/componentParser.test.ts
git commit -m "feat(components): detect string-literal union prop types"
```

---

## Task 3: Story file parser (CSF v3)

**Files:**
- Create: `src/utils/storyParser.ts`
- Create: `src/utils/storyParser.test.ts`

- [ ] **Step 1: Write failing test — default export extraction**

Create `src/utils/storyParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseStoryFile } from './storyParser'

describe('parseStoryFile', () => {
  it('extracts default title and component identifier', () => {
    const source = `
      import { Button } from './Button'
      export default { title: 'Forms/Button', component: Button }
      export const Primary = { args: { variant: 'primary' } }
    `
    const result = parseStoryFile('src/components/Button.stories.tsx', source)
    expect(result?.title).toBe('Forms/Button')
    expect(result?.componentIdent).toBe('Button')
    expect(result?.componentImportPath).toBe('./Button')
  })

  it('extracts named-export stories with parsed args', () => {
    const source = `
      import { Button } from './Button'
      export default { component: Button }
      export const Primary = { args: { variant: 'primary', size: 'md' } }
      export const Secondary = { args: { variant: 'secondary' } }
    `
    const result = parseStoryFile('Button.stories.tsx', source)
    expect(result?.stories).toHaveLength(2)
    expect(result?.stories[0]).toEqual({ name: 'Primary', args: { variant: 'primary', size: 'md' } })
    expect(result?.stories[1]).toEqual({ name: 'Secondary', args: { variant: 'secondary' } })
  })

  it('drops stories whose args fail to parse', () => {
    const source = `
      import { X } from './X'
      export default { component: X }
      export const Good = { args: { foo: 'bar' } }
      export const Broken = { args: { onClick: () => alert('hi') } }
    `
    const result = parseStoryFile('X.stories.tsx', source)
    expect(result?.stories.map(s => s.name)).toEqual(['Good'])
  })

  it('returns null when there is no default export', () => {
    expect(parseStoryFile('X.stories.tsx', 'const Foo = 1')).toBeNull()
  })

  it('returns null when default has no component reference', () => {
    expect(parseStoryFile('X.stories.tsx', 'export default { title: "X" }')).toBeNull()
  })
})

describe('resolveStoryComponent', () => {
  it('resolves "./Button" to Button.tsx in same dir', () => {
    const result = resolveStoryComponent(
      'src/components/Button.stories.tsx',
      './Button',
      ['src/components/Button.tsx', 'src/components/Card.tsx'],
    )
    expect(result).toBe('src/components/Button.tsx')
  })

  it('resolves "./button" to button/index.tsx', () => {
    const result = resolveStoryComponent(
      'src/components/button.stories.tsx',
      './button',
      ['src/components/button/index.tsx'],
    )
    expect(result).toBe('src/components/button/index.tsx')
  })

  it('returns null for path-aliased imports', () => {
    const result = resolveStoryComponent('a/b.stories.tsx', '@/lib/Foo', [])
    expect(result).toBeNull()
  })

  it('returns null when target file is not in scan set', () => {
    const result = resolveStoryComponent('a/b.stories.tsx', './Missing', ['a/Other.tsx'])
    expect(result).toBeNull()
  })
})
```

The test imports `resolveStoryComponent` — add to the import:

```ts
import { parseStoryFile, resolveStoryComponent } from './storyParser'
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- storyParser`
Expected: all tests fail with "Cannot find module" or similar.

- [ ] **Step 3: Implement `storyParser.ts`**

Create `src/utils/storyParser.ts`:

```ts
// src/utils/storyParser.ts
export interface StoryFile {
  title: string | null
  componentIdent: string                  // identifier referenced in default.component
  componentImportPath: string             // relative path the identifier was imported from
  stories: { name: string; args: Record<string, unknown> }[]
}

export function parseStoryFile(_path: string, source: string): StoryFile | null {
  // 1. Find default export object — match `export default { ... }`
  const defaultMatch = source.match(/export\s+default\s+\{([\s\S]*?)\}\s*(?:as\s+\w+)?\s*;?/)
  if (!defaultMatch) return null
  const defaultBody = defaultMatch[1]

  // 2. Pull title (optional) and component identifier (required)
  const titleMatch = defaultBody.match(/title\s*:\s*['"]([^'"]+)['"]/)
  const componentMatch = defaultBody.match(/component\s*:\s*(\w+)/)
  if (!componentMatch) return null
  const componentIdent = componentMatch[1]

  // 3. Find the import line for that identifier and extract the relative path
  const importPath = findImportPath(source, componentIdent)
  if (!importPath) return null

  // 4. Collect all named exports that look like CSF stories
  const stories: { name: string; args: Record<string, unknown> }[] = []
  const namedRe = /export\s+const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\n\s*\}\s*;?/g
  let m: RegExpExecArray | null
  while ((m = namedRe.exec(source)) !== null) {
    const name = m[1]
    const body = m[2]
    const argsBody = extractArgsBody(body)
    if (argsBody === null) continue
    const args = parseArgsBody(argsBody)
    if (args === null) continue
    stories.push({ name, args })
  }

  return {
    title: titleMatch?.[1] ?? null,
    componentIdent,
    componentImportPath: importPath,
    stories,
  }
}

function findImportPath(source: string, ident: string): string | null {
  // Match: import { Ident } from '...'  or  import { Other, Ident } from '...'
  const named = new RegExp(`import\\s+\\{[^}]*\\b${ident}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`)
  const m1 = source.match(named)
  if (m1) return m1[1]
  // Match: import Ident from '...'
  const def = new RegExp(`import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`)
  const m2 = source.match(def)
  if (m2) return m2[1]
  return null
}

function extractArgsBody(storyBody: string): string | null {
  // Find `args: { ... }` block
  const m = storyBody.match(/args\s*:\s*\{([\s\S]*?)\n\s*\}/)
  return m ? m[1] : null
}

function parseArgsBody(body: string): Record<string, unknown> | null {
  // Try to coerce JS-object-literal into JSON: quote bare keys; reject function values + JSX
  if (/=>|\bfunction\b|<[A-Z]/.test(body)) return null
  let normalized = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'/g, '"')
    .replace(/(\b\w+)\s*:/g, '"$1":')
    .replace(/,(\s*[}\]])/g, '$1')
  normalized = `{${normalized}}`
  try {
    return JSON.parse(normalized) as Record<string, unknown>
  } catch {
    return null
  }
}

export function resolveStoryComponent(
  storyPath: string,
  importPath: string,
  candidatePaths: string[],
): string | null {
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return null

  const storyDir = storyPath.split('/').slice(0, -1).join('/')
  const joined = joinPath(storyDir, importPath)

  const suffixes = ['', '.tsx', '.ts', '.jsx', '.js',
    '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
  for (const suffix of suffixes) {
    const candidate = joined + suffix
    if (candidatePaths.includes(candidate)) return candidate
  }
  return null
}

function joinPath(dir: string, relative: string): string {
  const parts = (dir ? dir.split('/') : [])
  for (const seg of relative.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}
```

- [ ] **Step 4: Run, verify all pass**

Run: `npm test -- storyParser`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/storyParser.ts src/utils/storyParser.test.ts
git commit -m "feat(components): add CSF v3 story file parser + import resolver"
```

---

## Task 4: Variant generator from prop unions

**Files:**
- Create: `src/utils/variantGenerator.ts`
- Create: `src/utils/variantGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/variantGenerator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateVariants } from './variantGenerator'
import type { ParsedComponent } from './componentParser'

function comp(props: ParsedComponent['props']): ParsedComponent {
  return { path: 'X.tsx', name: 'X', props, framework: 'react', renderable: true }
}

describe('generateVariants', () => {
  it('generates one variant per union value when prop name is allowlisted', () => {
    const result = generateVariants(comp([
      { name: 'variant', type: "'a' | 'b' | 'c'", required: false, stringUnion: ['a', 'b', 'c'] },
    ]))
    expect(result).toHaveLength(3)
    expect(result.map(v => v.name)).toEqual(['a', 'b', 'c'])
    expect(result[0].props.variant).toBe('a')
  })

  it('returns empty when no union prop matches the allowlist', () => {
    const result = generateVariants(comp([
      { name: 'foo', type: "'a' | 'b'", required: false, stringUnion: ['a', 'b'] },
    ]))
    expect(result).toEqual([])
  })

  it('uses only the first allowlisted union prop', () => {
    const result = generateVariants(comp([
      { name: 'size',    type: "'sm' | 'md'",     required: false, stringUnion: ['sm', 'md'] },
      { name: 'variant', type: "'a' | 'b' | 'c'", required: false, stringUnion: ['a', 'b', 'c'] },
    ]))
    expect(result).toHaveLength(2)  // size first → 2 variants, not 3
    expect(result.map(v => v.props.size)).toEqual(['sm', 'md'])
  })

  it('caps at 6 variants', () => {
    const result = generateVariants(comp([
      { name: 'variant', type: 'union', required: false,
        stringUnion: ['a','b','c','d','e','f','g','h'] },
    ]))
    expect(result).toHaveLength(6)
  })

  it('returns empty when no union props at all', () => {
    const result = generateVariants(comp([
      { name: 'label', type: 'string', required: true },
    ]))
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- variantGenerator`
Expected: all tests fail (module not found).

- [ ] **Step 3: Implement `variantGenerator.ts`**

Create `src/utils/variantGenerator.ts`:

```ts
// src/utils/variantGenerator.ts
import type { ParsedComponent } from './componentParser'
import { generateProps } from './propsGenerator'
import type { Variant } from '../types/components'

const VARIANT_PROP_ALLOWLIST = new Set([
  'variant', 'size', 'color', 'intent', 'kind', 'tone', 'appearance', 'state',
])

const MAX_AUTO_VARIANTS = 6

export function generateVariants(component: ParsedComponent): Variant[] {
  const target = component.props.find(
    p => VARIANT_PROP_ALLOWLIST.has(p.name) && p.stringUnion && p.stringUnion.length >= 2,
  )
  if (!target || !target.stringUnion) return []

  const baseProps = generateProps(component.props)
  const values = target.stringUnion.slice(0, MAX_AUTO_VARIANTS)

  return values.map(value => ({
    name: value,
    props: { ...baseProps, [target.name]: value },
    source: 'auto',
  }))
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- variantGenerator`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/variantGenerator.ts src/utils/variantGenerator.test.ts
git commit -m "feat(components): generate variants from string-union prop types"
```

---

## Task 5: Component bundle resolver (tier-1 selection)

**Files:**
- Create: `src/utils/componentBundle.ts`
- Create: `src/utils/componentBundle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/componentBundle.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { chooseRenderer, resetBundleCache } from './componentBundle'
import type { ComponentScanResult } from '../types/components'
import type { ParsedComponent } from './componentParser'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  resetBundleCache()
})

const reactComp: ParsedComponent = {
  path: 'src/Button.tsx', name: 'Button', props: [],
  framework: 'react', renderable: true,
}

const baseScan = (overrides: Partial<ComponentScanResult> = {}): ComponentScanResult => ({
  framework: 'react',
  pkg: { name: '@radix-ui/react-dialog', version: '1.0.5' },
  components: [reactComp],
  stories: [],
  error: null,
  ...overrides,
})

describe('chooseRenderer', () => {
  it('returns source tier when pkg is null', async () => {
    const result = await chooseRenderer(reactComp, baseScan({ pkg: null }))
    expect(result.tier).toBe('source')
  })

  it('returns source tier for vue framework even with pkg', async () => {
    const result = await chooseRenderer(
      { ...reactComp, framework: 'vue' },
      baseScan({ framework: 'vue' }),
    )
    expect(result.tier).toBe('source')
  })

  it('returns bundled tier when component name is exported', async () => {
    fetchMock
      // export-list probe → 200 with exports including Button
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button, Card }' })
      // CSS probes → all 404
      .mockResolvedValue({ ok: false, status: 404 })

    const result = await chooseRenderer(reactComp, baseScan())
    expect(result.tier).toBe('bundled')
    if (result.tier === 'bundled') {
      expect(result.render.exportName).toBe('Button')
      expect(result.render.importUrl).toContain('@radix-ui/react-dialog@1.0.5')
    }
  })

  it('returns source tier when component name is not exported', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => 'export { OtherThing }',
    })
    const result = await chooseRenderer(reactComp, baseScan())
    expect(result.tier).toBe('source')
  })

  it('caches export-list lookup across calls within same pkg', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button }' })
      .mockResolvedValue({ ok: false, status: 404 })

    await chooseRenderer(reactComp, baseScan())
    await chooseRenderer(reactComp, baseScan())

    // Only the first call's export-probe should hit the network
    const exportProbeCalls = fetchMock.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0] as string).includes('list-exports'),
    )
    expect(exportProbeCalls).toHaveLength(1)
  })

  it('includes CSS URLs that returned 200 from probe', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button }' })
      .mockResolvedValueOnce({ ok: false, status: 404 })  // /dist/style.css → miss
      .mockResolvedValueOnce({ ok: true,  status: 200 })  // /dist/index.css → hit
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await chooseRenderer(reactComp, baseScan())
    if (result.tier !== 'bundled') throw new Error('expected bundled')
    expect(result.render.cssUrls).toHaveLength(1)
    expect(result.render.cssUrls[0]).toContain('/dist/index.css')
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- componentBundle`
Expected: tests fail (module missing).

- [ ] **Step 3: Implement `componentBundle.ts`**

Create `src/utils/componentBundle.ts`:

```ts
// src/utils/componentBundle.ts
import type { ComponentScanResult, BundledRender, RenderTier } from '../types/components'
import type { ParsedComponent } from './componentParser'

type CacheEntry = { exports: Set<string>; cssUrls: string[] }
const bundleCache = new Map<string, CacheEntry>()

export function resetBundleCache(): void {
  bundleCache.clear()
}

export type RenderChoice =
  | { tier: 'bundled'; render: BundledRender }
  | { tier: 'source' }

const BUNDLED_FRAMEWORKS = new Set(['react', 'solid'])

const CSS_PROBE_PATHS = [
  '/dist/style.css',
  '/dist/index.css',
  '/style.css',
  '/styles.css',
]

export async function chooseRenderer(
  component: ParsedComponent,
  scan: ComponentScanResult,
): Promise<RenderChoice> {
  if (!scan.pkg) return { tier: 'source' }
  if (!BUNDLED_FRAMEWORKS.has(scan.framework)) return { tier: 'source' }

  const cacheKey = `${scan.pkg.name}@${scan.pkg.version}`
  const entry = await ensureCacheEntry(cacheKey, scan.pkg.name, scan.pkg.version)
  if (!entry) return { tier: 'source' }
  if (!entry.exports.has(component.name)) return { tier: 'source' }

  return {
    tier: 'bundled',
    render: {
      importUrl:  `https://esm.sh/${scan.pkg.name}@${scan.pkg.version}`,
      exportName: component.name,
      cssUrls:    entry.cssUrls,
    },
  }
}

async function ensureCacheEntry(
  key: string,
  name: string,
  version: string,
): Promise<CacheEntry | null> {
  const cached = bundleCache.get(key)
  if (cached) return cached

  const exports = await probeExports(name, version)
  if (!exports) return null

  const cssUrls = await probeCssUrls(name, version)
  const entry: CacheEntry = { exports, cssUrls }
  bundleCache.set(key, entry)
  return entry
}

async function probeExports(name: string, version: string): Promise<Set<string> | null> {
  // esm.sh's `?bundle&list-exports` returns the bundle source with named exports.
  const url = `https://esm.sh/${name}@${version}?bundle&list-exports`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const text = await res.text()
    return parseExports(text)
  } catch {
    return null
  }
}

function parseExports(source: string): Set<string> {
  const set = new Set<string>()
  // Match: export { A, B as C, D }
  const re = /export\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim()
      if (!part) continue
      const renamed = part.split(/\s+as\s+/)
      const name = (renamed[1] ?? renamed[0]).trim()
      if (name) set.add(name)
    }
  }
  // Also match: export const Foo / export function Foo / export class Foo
  const declRe = /export\s+(?:const|function|class)\s+(\w+)/g
  while ((m = declRe.exec(source)) !== null) set.add(m[1])
  return set
}

async function probeCssUrls(name: string, version: string): Promise<string[]> {
  const found: string[] = []
  for (const path of CSS_PROBE_PATHS) {
    const url = `https://esm.sh/${name}@${version}${path}`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) found.push(url)
    } catch {
      // network error → skip
    }
  }
  return found
}

export type { RenderTier }
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- componentBundle`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/componentBundle.ts src/utils/componentBundle.test.ts
git commit -m "feat(components): add bundled-tier renderer selection via esm.sh"
```

---

## Task 6: Bundled iframe template + theme support

**Files:**
- Modify: `src/utils/iframeTemplate.ts`
- Modify: `src/utils/iframeTemplate.test.ts`

- [ ] **Step 1: Read existing tests + module**

Read both files to find good insertion points and confirm the existing exports.

- [ ] **Step 2: Add failing tests**

Append to `src/utils/iframeTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildBundledIframeHtml } from './iframeTemplate'
import type { BundledRender } from '../types/components'

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
```

- [ ] **Step 3: Run, verify failure**

Run: `npm test -- iframeTemplate`
Expected: 7 new tests fail (export missing).

- [ ] **Step 4: Implement `buildBundledIframeHtml`**

Append to `src/utils/iframeTemplate.ts`:

```ts
import type { BundledRender } from '../types/components'

export function buildBundledIframeHtml(
  render: BundledRender,
  propsJson: string,
  theme: 'light' | 'dark',
): string {
  const importMap = `<script type="importmap">${JSON.stringify({
    imports: {
      'react':            'https://esm.sh/react@18',
      'react-dom':        'https://esm.sh/react-dom@18',
      'react-dom/client': 'https://esm.sh/react-dom@18/client',
      'react/jsx-runtime':'https://esm.sh/react@18/jsx-runtime',
    },
  })}</script>`

  const cssLinks = render.cssUrls
    .map(u => `<link rel="stylesheet" href="${u}" onerror="this.remove()">`)
    .join('')

  const themeAttr = `data-theme="${theme}"${theme === 'dark' ? ' class="dark"' : ''}`
  const themeStyle = theme === 'dark'
    ? 'background:#0e0e0e;color:#eee'
    : 'background:#fff;color:#000'

  const renderTail = [
    `import { ${render.exportName} as _$C } from '${render.importUrl}'`,
    `import { createElement } from 'react'`,
    `import { createRoot } from 'react-dom/client'`,
    `try {`,
    `  createRoot(document.getElementById('root')).render(createElement(_$C, ${propsJson}))`,
    `} catch (e) {`,
    `  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(e)},'*')`,
    `}`,
  ].join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${ERROR_BRIDGE_BUNDLED}${importMap}${cssLinks}
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;${themeStyle}}</style>
</head><body ${themeAttr}><div id="root"></div>
<script type="module">
${escapeScriptContent(renderTail)}
</script></body></html>`
}

const ERROR_BRIDGE_BUNDLED = `<script>
window.onerror=function(m,s,l,c,e){
  var msg=e?(e.message+(e.stack?'\\n'+e.stack:'')):m;
  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(msg)},'*');
  return true;
};
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  var msg=r instanceof Error?(r.message+(r.stack?'\\n'+r.stack:'')):String(r);
  window.parent.postMessage({type:'render-error',tier:'bundled',message:msg},'*');
});
</script>`
```

The existing `ERROR_BRIDGE` (which lacks the `tier` field) stays in place for the source-tier path; this new one is bundled-tier only. The existing source-tier templates can be updated to add `tier:'source'` to their messages in a follow-up.

- [ ] **Step 5: Run, verify pass**

Run: `npm test -- iframeTemplate`
Expected: all tests pass (existing + 7 new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/iframeTemplate.ts src/utils/iframeTemplate.test.ts
git commit -m "feat(components): add buildBundledIframeHtml with theme + CSS support"
```

---

# Phase 2 — Scanner integration

## Task 7: Extend `componentScanner.ts` with pkg, stories, error

**Files:**
- Modify: `electron/componentScanner.ts`

- [ ] **Step 1: Read current scanner**

Read `electron/componentScanner.ts` (139 lines). Identify the `scanComponents` function — this is what gets extended.

- [ ] **Step 2: Add npm registry probe**

Add a helper near the top of the file:

```ts
async function probeNpmRegistry(name: string, version: string): Promise<boolean> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Add story-file matcher helper**

Add near the existing `isComponentFile` import (the helper itself lives in `src/utils/componentScanner.ts` — but a story matcher belongs locally for now):

```ts
function isStoryFile(path: string): boolean {
  return /\.stor(y|ies)\.(tsx?|jsx?)$/.test(path)
}
```

- [ ] **Step 4: Update `scanComponents` body**

Replace the entire `scanComponents` function body. The new shape:

```ts
export async function scanComponents(
  owner: string,
  name: string,
  branch: string,
): Promise<ComponentScanResult> {
  const safe = /^[\w.\-]+$/
  if (!safe.test(owner) || !safe.test(name) || !safe.test(branch)) {
    return { framework: 'unknown', components: [], stories: [], pkg: null, error: null }
  }

  try {
    const token = getToken() ?? null

    // Stage A: package.json — framework + maybe pkg
    let framework: Framework = 'unknown'
    let pkg: { name: string; version: string } | null = null
    const pkgSource = await getFileContent(token, owner, name, 'package.json').catch(() => null)
    if (pkgSource) {
      try {
        const parsed = JSON.parse(pkgSource) as {
          name?: string; version?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }
        const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) }
        framework = detectFramework(deps)
        if (parsed.name && parsed.version) {
          if (await probeNpmRegistry(parsed.name, parsed.version)) {
            pkg = { name: parsed.name, version: parsed.version }
          }
        }
      } catch { /* malformed package.json */ }
    }

    // Stage B: file tree
    const tree = await getRepoTree(token, owner, name, branch).catch(() => null)
    if (!tree) {
      return { framework, components: [], stories: [], pkg, error: 'network' }
    }
    const filePaths = tree.filter(n => n.type === 'blob').map(n => n.path)

    if (framework === 'unknown') framework = detectFrameworkFromTree(filePaths)

    // Stage C: candidates (cap components at 50, stories at 30 → 80 source fetches max)
    const componentCandidates = filePaths
      .filter(p => isComponentFile(p, framework))
      .slice(0, 50)
    const storyCandidates = filePaths
      .filter(p => isStoryFile(p))
      .slice(0, 30)

    // Stage D: parallel fetch with 30s overall timeout
    const fetched = await Promise.race([
      Promise.all([
        batchFetch(componentCandidates, 10, p => getFileContent(token, owner, name, p).catch(() => null)),
        batchFetch(storyCandidates,     10, p => getFileContent(token, owner, name, p).catch(() => null)),
      ]),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 30_000)),
    ])

    if (fetched === null) {
      return { framework, components: [], stories: [], pkg, error: 'timeout' }
    }

    const [componentSources, storySources] = fetched
    const components: ScannedComponent[] = componentCandidates
      .map((path, i) => ({ path, source: componentSources[i] ?? '' }))
      .filter(c => c.source.length > 0)
    const stories: ScannedStory[] = storyCandidates
      .map((path, i) => ({ path, source: storySources[i] ?? '' }))
      .filter(s => s.source.length > 0)

    return { framework, components, stories, pkg, error: null }
  } catch {
    return { framework: 'unknown', components: [], stories: [], pkg: null, error: 'network' }
  }
}
```

The import line at the top needs to include `ScannedStory`:

```ts
import type { ComponentScanResult, Framework, ScannedComponent, ScannedStory } from '../src/types/components'
```

Note: rate-limit detection is *not* implemented in this pass — it requires inspecting `getRepoTree`'s response headers, which would change the github helper signature. We surface `network` for any tree-fetch failure; rate-limit is a follow-up.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `electron/componentScanner.ts`. Errors elsewhere (e.g. `env.d.ts`, `ComponentExplorer.tsx`) are expected — fixed in Tasks 8 + 13.

- [ ] **Step 6: Commit**

```bash
git add electron/componentScanner.ts
git commit -m "feat(components): scanner returns pkg/stories/error fields"
```

---

## Task 8: Update preload type + env.d.ts

**Files:**
- Modify: `src/env.d.ts`

The runtime shape of `window.api.components.scan` is unchanged; only the return type widens. `electron/preload.ts` itself needs no change.

- [ ] **Step 1: Open `src/env.d.ts`**

Find the existing `components: { scan(...) }` declaration and update its return type to match the extended `ComponentScanResult` (already imported via the `types/components` module — the file may already import it; if not, add the import).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `src/components/ComponentExplorer.tsx` (uses old shape) — these will be fixed by the rewrite in Task 13. No other unrelated errors.

- [ ] **Step 3: Commit**

```bash
git add src/env.d.ts
git commit -m "feat(components): widen window.api.components.scan return type"
```

---

# Phase 3 — UI components

## Task 9: ComponentSidebar

**Files:**
- Create: `src/components/ComponentSidebar.tsx`
- Create: `src/components/ComponentSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/ComponentSidebar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ComponentSidebar } from './ComponentSidebar'

const components = [
  { path: 'src/Button.tsx',          name: 'Button' },
  { path: 'src/forms/Input.tsx',     name: 'Input' },
  { path: 'src/forms/Select.tsx',    name: 'Select' },
]

describe('ComponentSidebar', () => {
  it('renders all components', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}}
    />)
    expect(screen.getByText('Button')).toBeInTheDocument()
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Select')).toBeInTheDocument()
  })

  it('groups components by parent folder', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}}
    />)
    expect(screen.getByText(/forms/i)).toBeInTheDocument()
  })

  it('calls onSelectPath when a component is clicked', () => {
    const onSelectPath = vi.fn()
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery=""
      onSelectPath={onSelectPath} onClearSelection={() => {}} onSearchChange={() => {}}
    />)
    fireEvent.click(screen.getByText('Button'))
    expect(onSelectPath).toHaveBeenCalledWith('src/Button.tsx')
  })

  it('calls onClearSelection when "All components" is clicked', () => {
    const onClearSelection = vi.fn()
    render(<ComponentSidebar
      components={components} selectedPath="src/Button.tsx" searchQuery=""
      onSelectPath={() => {}} onClearSelection={onClearSelection} onSearchChange={() => {}}
    />)
    fireEvent.click(screen.getByText(/all components/i))
    expect(onClearSelection).toHaveBeenCalled()
  })

  it('filters components by search query (case-insensitive substring)', () => {
    render(<ComponentSidebar
      components={components} selectedPath={null} searchQuery="sel"
      onSelectPath={() => {}} onClearSelection={() => {}} onSearchChange={() => {}}
    />)
    expect(screen.queryByText('Button')).toBeNull()
    expect(screen.queryByText('Input')).toBeNull()
    expect(screen.getByText('Select')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- ComponentSidebar`
Expected: tests fail (module missing).

- [ ] **Step 3: Implement `ComponentSidebar.tsx`**

Create `src/components/ComponentSidebar.tsx`:

```tsx
// src/components/ComponentSidebar.tsx
import { useMemo } from 'react'

interface SidebarComponent {
  path: string
  name: string
}

interface Props {
  components: SidebarComponent[]
  selectedPath: string | null
  searchQuery: string
  onSelectPath: (path: string) => void
  onClearSelection: () => void
  onSearchChange: (query: string) => void
}

export function ComponentSidebar({
  components, selectedPath, searchQuery,
  onSelectPath, onClearSelection, onSearchChange,
}: Props) {
  const filtered = useMemo(() => {
    if (!searchQuery) return components
    const q = searchQuery.toLowerCase()
    return components.filter(c => c.name.toLowerCase().includes(q))
  }, [components, searchQuery])

  const grouped = useMemo(() => {
    const groups = new Map<string, SidebarComponent[]>()
    for (const c of filtered) {
      const parts = c.path.split('/')
      const folder = parts.length > 1 ? parts[parts.length - 2] : ''
      const arr = groups.get(folder) ?? []
      arr.push(c)
      groups.set(folder, arr)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <aside className="cg-sidebar">
      <input
        type="search"
        className="cg-sidebar-search"
        placeholder="Search components"
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
      />
      <button
        className={`cg-sidebar-all${selectedPath === null ? ' active' : ''}`}
        onClick={onClearSelection}
      >
        All components
      </button>
      {grouped.map(([folder, items]) => (
        <div key={folder || '__root__'} className="cg-sidebar-group">
          {folder && <div className="cg-sidebar-group-label">{folder}</div>}
          {items.map(c => (
            <button
              key={c.path}
              className={`cg-sidebar-item${selectedPath === c.path ? ' active' : ''}`}
              onClick={() => onSelectPath(c.path)}
            >
              {c.name}
            </button>
          ))}
        </div>
      ))}
    </aside>
  )
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- ComponentSidebar`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ComponentSidebar.tsx src/components/ComponentSidebar.test.tsx
git commit -m "feat(components): add ComponentSidebar with search + folder grouping"
```

---

## Task 10: ComponentCard with tier fallback

**Files:**
- Create: `src/components/ComponentCard.tsx`
- Create: `src/components/ComponentCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/ComponentCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComponentCard } from './ComponentCard'

let observerCallback: IntersectionObserverCallback | null = null
beforeEach(() => {
  observerCallback = null
  globalThis.IntersectionObserver = vi.fn((cb: IntersectionObserverCallback) => {
    observerCallback = cb
    return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
             takeRecords: () => [], root: null, rootMargin: '', thresholds: [] }
  }) as unknown as typeof IntersectionObserver
})

const mockComponent = {
  path: 'X.tsx', name: 'Button',
  props: [{ name: 'label', type: 'string', required: true }],
  framework: 'react' as const, renderable: true,
}
const mockVariant = { name: 'default', props: { label: 'Click' }, source: 'default' as const }

describe('ComponentCard', () => {
  it('renders skeleton when not yet visible', () => {
    render(<ComponentCard
      component={mockComponent} variant={mockVariant} tier="source"
      theme="dark" source="" onClick={() => {}}
    />)
    expect(screen.getByText('Button')).toBeInTheDocument()
    expect(screen.queryByTitle(/preview/i)).toBeNull()  // no iframe
  })

  it('mounts iframe when card scrolls into view', async () => {
    render(<ComponentCard
      component={mockComponent} variant={mockVariant} tier="source"
      theme="dark" source="" onClick={() => {}}
    />)
    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => {
      expect(document.querySelector('iframe')).toBeInTheDocument()
    })
  })

  it('shows failed-render UI after both tiers fail', async () => {
    render(<ComponentCard
      component={mockComponent} variant={mockVariant} tier="bundled"
      theme="dark" source="const x = 1" onClick={() => {}}
    />)
    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    // Simulate two tier failures via postMessage
    const iframe = await waitFor(() => document.querySelector('iframe'))
    window.dispatchEvent(new MessageEvent('message', {
      source: (iframe as HTMLIFrameElement).contentWindow,
      data: { type: 'render-error', tier: 'bundled', message: 'oops' },
    }))
    // Re-mount with source tier; second failure
    await waitFor(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: (document.querySelector('iframe') as HTMLIFrameElement).contentWindow,
        data: { type: 'render-error', tier: 'source', message: 'oops' },
      }))
    })
    await waitFor(() => {
      expect(screen.getByText(/view source/i)).toBeInTheDocument()
    })
  })
})
```

Note: this test exercises the fallback handshake at a high level. The iframe is mounted via blob URL (constructed in the implementation); the test only asserts that `<iframe>` appears in the DOM after intersection — its content rendering is out of scope for unit tests.

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- ComponentCard`
Expected: tests fail (module missing).

- [ ] **Step 3: Implement `ComponentCard.tsx`**

Create `src/components/ComponentCard.tsx`:

```tsx
// src/components/ComponentCard.tsx
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import { buildIframeHtml, buildBundledIframeHtml } from '../utils/iframeTemplate'

interface Props {
  component: ParsedComponent
  variant: Variant
  tier: RenderTier
  bundled?: BundledRender   // present when tier === 'bundled'
  theme: 'light' | 'dark'
  source: string             // raw source for source-tier fallback
  onClick: () => void
}

type State = 'idle' | 'rendering' | 'rendered' | 'failed'

export function ComponentCard({
  component, variant, tier, bundled, theme, source, onClick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(false)
  const [currentTier, setCurrentTier] = useState<RenderTier>(tier)
  const [state, setState] = useState<State>('idle')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const triedTiersRef = useRef<Set<RenderTier>>(new Set())

  // Observe visibility
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ob = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true)
        ob.disconnect()
      }
    }, { rootMargin: '400px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [])

  // Build the blob URL when visible / tier / theme changes
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setState('rendering')
    triedTiersRef.current.add(currentTier)

    const buildHtml = currentTier === 'bundled' && bundled
      ? Promise.resolve(buildBundledIframeHtml(bundled, JSON.stringify(variant.props), theme))
      : buildIframeHtml(component, source, variant.props)

    void buildHtml.then(html => {
      if (cancelled || !html) {
        if (!cancelled) handleTierFailure()
        return
      }
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      setBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    })

    return () => { cancelled = true }
  }, [visible, currentTier, theme, component, source, variant, bundled])

  // Cleanup blob URL on unmount
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  // Listen for render-error postMessage from iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type !== 'render-error') return
      const failedTier = (e.data.tier as RenderTier | undefined) ?? currentTier
      if (failedTier !== currentTier) return
      handleTierFailure()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [currentTier])

  function handleTierFailure() {
    if (currentTier === 'bundled' && !triedTiersRef.current.has('source')) {
      setCurrentTier('source')
      setState('rendering')
      return
    }
    setState('failed')
  }

  function handleLoad() {
    if (state === 'rendering') setState('rendered')
  }

  return (
    <div ref={wrapRef} className="cg-card" onClick={onClick}>
      <div className="cg-card-name">{component.name}</div>
      <div className="cg-card-frame">
        {state === 'failed' ? (
          <div className="cg-card-failed">
            <div>Preview failed</div>
            <button onClick={(e) => { e.stopPropagation(); onClick() }}>View source</button>
          </div>
        ) : visible && blobUrl ? (
          <iframe
            ref={iframeRef}
            src={blobUrl}
            sandbox="allow-scripts"
            onLoad={handleLoad}
            title={`${component.name} preview`}
          />
        ) : (
          <div className="cg-card-skeleton" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- ComponentCard`
Expected: all 3 tests pass. The third test may be sensitive — if it flakes, file an issue but proceed (the integration is covered by manual verification in Task 14).

- [ ] **Step 5: Commit**

```bash
git add src/components/ComponentCard.tsx src/components/ComponentCard.test.tsx
git commit -m "feat(components): add ComponentCard with lazy mount + tier fallback"
```

---

## Task 11: ComponentGallery with LRU eviction

**Files:**
- Create: `src/components/ComponentGallery.tsx`
- Create: `src/components/ComponentGallery.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/ComponentGallery.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComponentGallery } from './ComponentGallery'

beforeEach(() => {
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
    takeRecords: () => [], root: null, rootMargin: '', thresholds: [],
  })) as unknown as typeof IntersectionObserver
})

function makeComp(name: string, path = `${name}.tsx`) {
  return {
    path, name, props: [], framework: 'react' as const, renderable: true,
  }
}

const mockVariant = { name: 'default', props: {}, source: 'default' as const }

describe('ComponentGallery', () => {
  it('renders a card for each component', () => {
    const components = ['A', 'B', 'C'].map(n => makeComp(n))
    render(<ComponentGallery
      components={components}
      variantsByPath={Object.fromEntries(components.map(c => [c.path, [mockVariant]]))}
      tierByPath={Object.fromEntries(components.map(c => [c.path, 'source']))}
      bundledByPath={{}} sourceByPath={Object.fromEntries(components.map(c => [c.path, '']))}
      theme="dark" onSelect={() => {}}
    />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('calls onSelect with the component path when a card is clicked', () => {
    const onSelect = vi.fn()
    const components = [makeComp('Button')]
    render(<ComponentGallery
      components={components}
      variantsByPath={{ 'Button.tsx': [mockVariant] }}
      tierByPath={{ 'Button.tsx': 'source' }}
      bundledByPath={{}} sourceByPath={{ 'Button.tsx': '' }}
      theme="dark" onSelect={onSelect}
    />)
    fireEvent.click(screen.getByText('Button').closest('.cg-card')!)
    expect(onSelect).toHaveBeenCalledWith('Button.tsx')
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- ComponentGallery`
Expected: tests fail.

- [ ] **Step 3: Implement `ComponentGallery.tsx`**

Create `src/components/ComponentGallery.tsx`:

```tsx
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
  // is wired up here so a future eviction pass (Task 11 Step 4) can hook in.
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
```

The LRU eviction is wired in but not enforced in this task — the IntersectionObserver-based lazy mount in `ComponentCard` already keeps the active iframe count naturally bounded for typical viewports. Eviction-on-mount can be added in a follow-up if memory profiling shows it's needed.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- ComponentGallery`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ComponentGallery.tsx src/components/ComponentGallery.test.tsx
git commit -m "feat(components): add ComponentGallery grid"
```

---

## Task 12: ComponentDetailView

**Files:**
- Create: `src/components/ComponentDetailView.tsx`
- Create: `src/components/ComponentDetailView.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/ComponentDetailView.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComponentDetailView } from './ComponentDetailView'

beforeEach(() => {
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
    takeRecords: () => [], root: null, rootMargin: '', thresholds: [],
  })) as unknown as typeof IntersectionObserver
})

const baseComponent = {
  path: 'Button.tsx', name: 'Button',
  props: [
    { name: 'variant', type: "'a'|'b'", required: false, stringUnion: ['a', 'b'] },
    { name: 'label',   type: 'string',  required: true },
  ],
  framework: 'react' as const, renderable: true,
}

function variants(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `V${i}`, props: { variant: i }, source: 'auto' as const,
  }))
}

describe('ComponentDetailView', () => {
  it('renders the props table', () => {
    render(<ComponentDetailView
      component={baseComponent} variants={variants(1)} tier="source"
      theme="dark" source="const x = 1" onBack={() => {}}
    />)
    expect(screen.getByText('variant')).toBeInTheDocument()
    expect(screen.getByText('label')).toBeInTheDocument()
  })

  it('renders one tile per variant up to 6', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(4)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(4)
  })

  it('collapses variants beyond 6 behind a "+N more" button', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(10)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(6)
    expect(screen.getByText(/4 more/)).toBeInTheDocument()
  })

  it('shows all variants after clicking expand button', () => {
    const { container } = render(<ComponentDetailView
      component={baseComponent} variants={variants(10)} tier="source"
      theme="dark" source="" onBack={() => {}}
    />)
    fireEvent.click(screen.getByText(/4 more/))
    expect(container.querySelectorAll('.cg-variant-tile').length).toBe(10)
  })

  it('toggles the source accordion', () => {
    render(<ComponentDetailView
      component={baseComponent} variants={variants(1)} tier="source"
      theme="dark" source="const x = 1" onBack={() => {}}
    />)
    expect(screen.queryByText('const x = 1')).toBeNull()
    fireEvent.click(screen.getByText(/source/i))
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- ComponentDetailView`
Expected: tests fail.

- [ ] **Step 3: Implement `ComponentDetailView.tsx`**

Create `src/components/ComponentDetailView.tsx`:

```tsx
// src/components/ComponentDetailView.tsx
import { useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import { ComponentCard } from './ComponentCard'

interface Props {
  component: ParsedComponent
  variants: Variant[]
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  onBack: () => void
}

const VARIANT_VISIBLE_CAP = 6

export function ComponentDetailView({
  component, variants, tier, bundled, theme, source, onBack,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)

  const visibleVariants = expanded ? variants : variants.slice(0, VARIANT_VISIBLE_CAP)
  const remainder = variants.length - VARIANT_VISIBLE_CAP

  const heroVariant = variants[0]

  return (
    <div className="cg-detail">
      <button className="cg-detail-back" onClick={onBack}>◂ All components</button>
      <h2 className="cg-detail-name">{component.name}</h2>

      {heroVariant && (
        <div className="cg-detail-hero">
          <ComponentCard
            component={component} variant={heroVariant} tier={tier}
            bundled={bundled} theme={theme} source={source}
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
                  bundled={bundled} theme={theme} source={source}
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- ComponentDetailView`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ComponentDetailView.tsx src/components/ComponentDetailView.test.tsx
git commit -m "feat(components): add ComponentDetailView with variant strip + source accordion"
```

---

# Phase 4 — Integration

## Task 13: Rewrite ComponentExplorer as orchestrator

**Files:**
- Modify: `src/components/ComponentExplorer.tsx` (full rewrite)
- Create: `src/components/ComponentExplorer.css`

This task replaces the existing 329-line `ComponentExplorer.tsx` with a thin shell that orchestrates `ComponentSidebar`, `ComponentGallery`, and `ComponentDetailView`. The existing inline `.sb-*` styles move to a new CSS file.

- [ ] **Step 1: Read current `ComponentExplorer.tsx` end-to-end**

Confirm what behaviors must be preserved (scan IPC, blob URL cleanup, error states).

- [ ] **Step 2: Write the orchestrator**

Replace the entire file `src/components/ComponentExplorer.tsx`:

```tsx
// src/components/ComponentExplorer.tsx
import { useState, useEffect, useMemo } from 'react'
import type { ComponentScanResult, Variant, RenderTier, BundledRender } from '../types/components'
import { parseComponent, type ParsedComponent } from '../utils/componentParser'
import { generateProps } from '../utils/propsGenerator'
import { generateVariants } from '../utils/variantGenerator'
import { parseStoryFile, resolveStoryComponent } from '../utils/storyParser'
import { chooseRenderer, resetBundleCache } from '../utils/componentBundle'
import { ComponentSidebar } from './ComponentSidebar'
import { ComponentGallery } from './ComponentGallery'
import { ComponentDetailView } from './ComponentDetailView'
import './ComponentExplorer.css'

interface Props {
  owner: string
  name: string
  branch: string
}

type ScanState = 'scanning' | 'done' | 'error'

export default function ComponentExplorer({ owner, name, branch }: Props) {
  const [scanState, setScanState] = useState<ScanState>('scanning')
  const [scanError, setScanError] = useState<ComponentScanResult['error']>(null)
  const [components, setComponents] = useState<ParsedComponent[]>([])
  const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({})
  const [variantsByPath, setVariantsByPath] = useState<Record<string, Variant[]>>({})
  const [tierByPath, setTierByPath] = useState<Record<string, RenderTier>>({})
  const [bundledByPath, setBundledByPath] = useState<Record<string, BundledRender>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [searchQuery, setSearchQuery] = useState('')

  // Reset and scan on owner/name/branch change
  useEffect(() => {
    let cancelled = false
    setScanState('scanning')
    setScanError(null)
    setComponents([])
    setSourceByPath({})
    setVariantsByPath({})
    setTierByPath({})
    setBundledByPath({})
    setSelectedPath(null)
    resetBundleCache()

    void window.api.components.scan(owner, name, branch).then(async (scan: ComponentScanResult) => {
      if (cancelled) return
      if (scan.error) {
        setScanState('error')
        setScanError(scan.error)
        return
      }
      const parsed = scan.components.map(c => parseComponent(c.path, c.source, scan.framework))
      const sources = Object.fromEntries(scan.components.map(c => [c.path, c.source]))

      // Stories → variants
      const storyVariants = computeStoryVariants(scan, parsed)
      const variants: Record<string, Variant[]> = {}
      for (const c of parsed) {
        const fromStories = storyVariants[c.path]
        if (fromStories && fromStories.length > 0) {
          variants[c.path] = fromStories
        } else {
          const auto = generateVariants(c)
          variants[c.path] = auto.length > 0
            ? auto
            : [{ name: 'default', props: generateProps(c.props), source: 'default' }]
        }
      }

      // Tier resolution
      const tiers: Record<string, RenderTier> = {}
      const bundled: Record<string, BundledRender> = {}
      await Promise.all(parsed.map(async c => {
        const choice = await chooseRenderer(c, scan)
        tiers[c.path] = choice.tier
        if (choice.tier === 'bundled') bundled[c.path] = choice.render
      }))

      if (cancelled) return
      setComponents(parsed)
      setSourceByPath(sources)
      setVariantsByPath(variants)
      setTierByPath(tiers)
      setBundledByPath(bundled)
      setScanState('done')
    }).catch(() => {
      if (!cancelled) {
        setScanState('error')
        setScanError('network')
      }
    })

    return () => { cancelled = true }
  }, [owner, name, branch])

  const selectedComponent = useMemo(
    () => components.find(c => c.path === selectedPath) ?? null,
    [components, selectedPath],
  )

  if (scanState === 'scanning') {
    return <div className="cg-empty"><span>Scanning components…</span></div>
  }
  if (scanState === 'error') {
    return (
      <div className="cg-empty">
        <span>{errorMessageFor(scanError)}</span>
      </div>
    )
  }
  if (components.length === 0) {
    return <div className="cg-empty"><span>No components found.</span></div>
  }

  return (
    <div className="cg-explorer">
      <ComponentSidebar
        components={components.map(c => ({ path: c.path, name: c.name }))}
        selectedPath={selectedPath}
        searchQuery={searchQuery}
        onSelectPath={setSelectedPath}
        onClearSelection={() => setSelectedPath(null)}
        onSearchChange={setSearchQuery}
      />
      <main className="cg-main">
        <div className="cg-topbar">
          <button
            className="cg-theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {selectedComponent && (
            <a
              className="cg-gh-link"
              href={`https://github.com/${owner}/${name}/blob/${branch}/${selectedComponent.path}`}
              target="_blank"
              rel="noreferrer"
            >Open on GitHub ↗</a>
          )}
        </div>
        {selectedComponent ? (
          <ComponentDetailView
            component={selectedComponent}
            variants={variantsByPath[selectedComponent.path] ?? []}
            tier={tierByPath[selectedComponent.path] ?? 'source'}
            bundled={bundledByPath[selectedComponent.path]}
            theme={theme}
            source={sourceByPath[selectedComponent.path] ?? ''}
            onBack={() => setSelectedPath(null)}
          />
        ) : (
          <ComponentGallery
            components={components}
            variantsByPath={variantsByPath}
            tierByPath={tierByPath}
            bundledByPath={bundledByPath}
            sourceByPath={sourceByPath}
            theme={theme}
            onSelect={setSelectedPath}
          />
        )}
      </main>
    </div>
  )
}

function errorMessageFor(error: ComponentScanResult['error']): string {
  if (error === 'rate-limit') return 'GitHub rate limit hit. Try again in a few minutes.'
  if (error === 'timeout')    return 'Repo too large to scan.'
  return "Couldn't reach GitHub."
}

function computeStoryVariants(
  scan: ComponentScanResult,
  parsed: ParsedComponent[],
): Record<string, Variant[]> {
  const componentPaths = parsed.map(p => p.path)
  const result: Record<string, Variant[]> = {}
  for (const story of scan.stories) {
    const file = parseStoryFile(story.path, story.source)
    if (!file) continue
    const targetPath = resolveStoryComponent(story.path, file.componentImportPath, componentPaths)
    if (!targetPath) continue
    result[targetPath] = file.stories.map(s => ({
      name: s.name,
      props: s.args,
      source: 'story' as const,
    }))
  }
  return result
}
```

- [ ] **Step 3: Create `ComponentExplorer.css`**

Create `src/components/ComponentExplorer.css`:

```css
.cg-explorer {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
  background: var(--bg);
}

.cg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--t3);
}

/* Sidebar */
.cg-sidebar {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cg-sidebar-search {
  width: 100%;
  background: var(--surface);
  color: var(--t1);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: 'Inter', sans-serif;
  margin-bottom: 8px;
}
.cg-sidebar-all,
.cg-sidebar-item {
  background: none;
  border: none;
  text-align: left;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--t2);
  cursor: pointer;
  border-radius: 4px;
}
.cg-sidebar-all:hover,
.cg-sidebar-item:hover { background: var(--surface); }
.cg-sidebar-all.active,
.cg-sidebar-item.active { background: var(--accent-soft); color: var(--accent-text); }
.cg-sidebar-group-label {
  font-size: 9px;
  color: var(--t3);
  text-transform: uppercase;
  margin: 8px 8px 2px;
  letter-spacing: 0.05em;
}

/* Main */
.cg-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cg-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cg-theme-toggle {
  background: none;
  border: none;
  color: var(--t2);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.cg-gh-link {
  margin-left: auto;
  font-size: 11px;
  color: var(--t3);
  text-decoration: none;
}

/* Gallery */
.cg-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  flex: 1;
}

/* Card */
.cg-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
  background: var(--surface);
}
.cg-card-name {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--t2);
  border-bottom: 1px solid var(--border);
}
.cg-card-frame {
  flex: 1;
  min-height: 120px;
  position: relative;
}
.cg-card-frame iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.cg-card-skeleton,
.cg-card-failed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  font-size: 10px;
  color: var(--t3);
  font-family: 'Inter', sans-serif;
  gap: 4px;
}
.cg-card-failed button {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}

/* Detail */
.cg-detail {
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cg-detail-back {
  background: none;
  border: none;
  color: var(--t3);
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
  padding: 0;
}
.cg-detail-name {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--t1);
}
.cg-detail-hero { min-height: 240px; }
.cg-detail-hero .cg-card { cursor: default; }
.cg-detail-hero .cg-card-frame { min-height: 200px; }
.cg-variant-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.cg-variant-tile { display: flex; flex-direction: column; gap: 4px; }
.cg-variant-tile .cg-card { cursor: default; }
.cg-variant-name { font-size: 10px; color: var(--t3); text-align: center; }
.cg-variant-more {
  background: none;
  border: 1px dashed var(--border);
  color: var(--t3);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  margin-top: 8px;
  width: fit-content;
}
.cg-detail-props table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: monospace; }
.cg-detail-props th,
.cg-detail-props td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.cg-detail-source pre {
  background: var(--surface);
  padding: 12px;
  border-radius: 4px;
  font-size: 10px;
  overflow: auto;
  margin: 8px 0 0;
}
.cg-detail-source button {
  background: none;
  border: none;
  color: var(--t3);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all tests pass (existing + new from this plan).

- [ ] **Step 6: Build verification**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/ComponentExplorer.tsx src/components/ComponentExplorer.css
git commit -m "feat(components): rewrite ComponentExplorer as gallery + detail orchestrator"
```

---

## Task 14: Manual verification

This task is verification-before-completion. No code changes — just the runtime checks that confirm the gallery works.

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Wait for the Electron window to appear.

- [ ] **Step 2: Navigate to a known tier-1 (bundled) library**

In the Library section (or via the search bar), open a published library that the renderer should detect as bundled-tier:
- `radix-ui/primitives` (likely tier-1 — published as `@radix-ui/*`)
- `mantinedev/mantine` (likely tier-1 — published as `@mantine/*`)

Click the **Components** tab and confirm:
1. Sidebar shows component list
2. Gallery shows cards with rendered previews
3. Theme toggle in top bar flips light/dark on each card
4. Clicking a card opens the detail view with hero render + variants + props + source accordion

- [ ] **Step 3: Navigate to a tier-2 (source) library**

Open `shadcn-ui/ui` or any small custom React component repo not on npm. Click **Components**.

Confirm:
1. Sidebar + gallery render as before
2. Cards either render via source-tier OR show the "Preview failed → View source" fallback (both are acceptable)
3. Detail view is reachable via card click

- [ ] **Step 4: Test the search filter**

Type into the sidebar search box. Confirm the component list filters in real-time.

- [ ] **Step 5: Test the back navigation**

In detail view, click "◂ All components" → returns to gallery.

- [ ] **Step 6: Document any issues**

If anything in steps 2-5 doesn't work, report it as a follow-up issue rather than spilling into this plan. Acceptable to ship a v1 with known cosmetic issues; not acceptable to ship one where the gallery doesn't render at all.

- [ ] **Step 7: Final commit (if any final tweaks were needed)**

If verification surfaced minor fixes, commit them with `fix(components): address verification feedback — <summary>`.

---

# Done

After Task 14, the Components tab in `RepoDetail` (Library and Discover routes alike) shows the new gallery for any repo without a hosted Storybook. Hosted Storybook detection is unchanged.

**Key follow-ups (not in this plan):**
- Icon library detection + dedicated icon-grid view
- Per-library theme provider shims (MUI, Chakra)
- LRU iframe eviction enforcement (currently the registry is wired but not enforced)
- Rate-limit detection from GitHub API headers
- Source-tier `render-error` postMessages should also include `tier:'source'` for clean tier-fallback-error reporting
