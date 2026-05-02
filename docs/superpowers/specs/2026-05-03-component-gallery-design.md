# Component Gallery Design Spec

**Date:** 2026-05-03

## Summary

Replace the current single-component `ComponentExplorer` with a hybrid gallery
experience: an overview grid of every detected component rendered together at a
glance, with click-through to a detail view containing a hero render, variant
strip, props table, and source. Underneath, introduce a second rendering tier
that imports components directly from the package's published esm.sh bundle when
the repo is on npm — dramatically improving render reliability for famous UI
libraries (shadcn/ui, MUI, Radix, Mantine, etc.) — while keeping the existing
source-file scanning approach as a fallback for everything else.

This is the first major upgrade to the Components tab since the original
[component-explorer spec](2026-03-29-component-explorer-design.md). Storybook
detection (`StorybookExplorer`) remains the preferred path when a hosted
Storybook is available; this spec only changes what happens when it isn't.

Out of scope: icon libraries (different display problem, separate spec),
local-clone-based rendering (Vite child process), and per-library theme provider
shims beyond the generic light/dark toggle.

---

## 1. Architecture

Three layers, mirroring the existing structure.

### Main process — `electron/componentScanner.ts` (extended)

The `components:scan` IPC handler is extended to:
- Probe the npm registry when the repo's `package.json` declares a published
  package, returning `{ name, version }` to the renderer or `null` if the
  package isn't published.
- Include `*.stories.{ts,tsx,js,jsx}` files in the file scan and source fetch.

### Renderer utils — `src/utils/`

| File | Status | Responsibility |
|---|---|---|
| `componentParser.ts` | extended | Detect string-literal union types on props (existing prop parsing unchanged) |
| `propsGenerator.ts` | unchanged | Concrete default values for prop types |
| `iframeTemplate.ts` | extended | New `buildBundledIframeHtml` for tier-1 rendering |
| `componentBundle.ts` | new | Resolve `(pkg.name, pkg.version, componentName)` → bundled-tier import URL; verify exports exist on esm.sh |
| `storyParser.ts` | new | Parse CSF v3 story files; extract `args` per named export; map back to component path |
| `variantGenerator.ts` | new | Generate variants from string-union props when no stories exist |

### UI — `src/components/`

| File | Status | Responsibility |
|---|---|---|
| `ComponentExplorer.tsx` | rewritten | Thin orchestrator. Owns selection, theme, search, scan state. Renders sidebar + main area + top bar. |
| `ComponentSidebar.tsx` | new | Folder-grouped component list with search input and an "All" item that returns to gallery mode |
| `ComponentGallery.tsx` | new | Masonry grid of `ComponentCard`s with IntersectionObserver lazy mounting + LRU iframe eviction |
| `ComponentCard.tsx` | new | Single card: iframe + name label + failed-render fallback |
| `ComponentDetailView.tsx` | new | Hero render + variant strip + props table + source accordion |
| `ComponentExplorer.css` | new | Replaces inline styles + extends existing `.sb-*` CSS classes |

`StorybookExplorer.tsx` is **not modified**. The detection branch in
`RepoDetail.tsx:1950` is unchanged: hosted Storybook still wins when present.

---

## 2. Scan Pipeline (`components:scan`)

The handler returns an extended shape:

```ts
// src/types/components.ts
export interface ComponentScanResult {
  framework: Framework
  pkg: { name: string; version: string } | null  // NEW
  components: ScannedComponent[]                   // existing shape
  stories: ScannedStory[]                          // NEW
}

export interface ScannedStory {
  path: string    // e.g. "src/components/Button.stories.tsx"
  source: string  // raw file content
}
```

Pipeline:

1. Fetch `package.json`, detect framework. (existing)
2. **NEW:** if `package.json` parses cleanly and has both `name` and `version`,
   probe `https://registry.npmjs.org/<name>/<version>`. On 200, set
   `result.pkg = { name, version }`. On any other status or network failure,
   `result.pkg = null`. We do **not** read the registry response body — the
   200 is sufficient confirmation.
3. Fetch the repo tree. (existing)
4. Filter component files (existing) **plus** files matching
   `/\.stor(y|ies)\.(tsx?|jsx?)$/`.
5. Batch-fetch sources for both lists with `batchFetch(items, 10, …)`. The
   existing per-call cap of 50 is raised to 80 to accommodate stories without
   starving components.
6. Return the extended shape.

### IPC contract additions

`electron/preload.ts` — the existing `components` block is unchanged shape-wise;
its return type is the extended `ComponentScanResult`. No new methods.

`src/env.d.ts` — update the return type of `window.api.components.scan` to the
extended `ComponentScanResult`.

---

## 3. Two-Tier Rendering

A new function in `src/utils/componentBundle.ts`:

```ts
export type RenderTier = 'bundled' | 'source'

export interface BundledRender {
  importUrl: string         // e.g. "https://esm.sh/@shadcn/ui@1.2.3"
  exportName: string        // e.g. "Button"
  cssUrls: string[]         // e.g. ["https://esm.sh/@shadcn/ui@1.2.3/dist/style.css"]
}

export async function chooseRenderer(
  component: ParsedComponent,
  scan: ComponentScanResult,
): Promise<{ tier: 'bundled'; render: BundledRender } | { tier: 'source' }>
```

Tier-1 ("bundled") is selected when **all** of:

- `scan.pkg !== null`
- `scan.framework === 'react' || scan.framework === 'solid'` (Vue/Svelte
  bundles aren't shaped for direct named-import rendering — they stay on tier-2)
- The component name appears as a named export of the published package
  (verified by a single fetch to `https://esm.sh/<name>@<ver>/dist/index.d.ts`
  or fallback to `https://esm.sh/<name>@<ver>?bundle&list-exports`; the result
  is cached in module-scope per scan)

Otherwise tier-2 ("source") is used — the existing pipeline.

### Per-component fallback

When tier-1 rendering fails (the iframe postMessages a `render-error` with
`tier: 'bundled'`), `ComponentCard` automatically retries with tier-2 once. So
tier-1 is opportunistic, never load-bearing.

### `buildBundledIframeHtml`

```ts
export function buildBundledIframeHtml(
  render: BundledRender,
  propsJson: string,
  theme: 'light' | 'dark',
): string
```

Output (React, simplified):

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <!-- ERROR_BRIDGE same as today, but message includes tier: 'bundled' -->
  <script type="importmap">{
    "imports": {
      "react": "https://esm.sh/react@18",
      "react-dom": "https://esm.sh/react-dom@18",
      "react-dom/client": "https://esm.sh/react-dom@18/client"
    }
  }</script>
  <link rel="stylesheet" href="<cssUrls[0]>" onerror="this.remove()">
  <link rel="stylesheet" href="<cssUrls[1]>" onerror="this.remove()">
  <style>
    body { margin: 0; padding: 16px; }
    body[data-theme="dark"] { background: #0e0e0e; color: #eee; }
    body[data-theme="light"] { background: #fff; color: #000; }
  </style>
</head>
<body data-theme="dark" class="dark">
  <div id="root"></div>
  <script type="module">
    import { <exportName> as _$C } from '<importUrl>'
    import { createElement as _$ce } from 'react'
    import { createRoot as _$cr } from 'react-dom/client'
    try {
      _$cr(document.getElementById('root')).render(_$ce(_$C, <propsJson>))
    } catch (e) {
      window.parent.postMessage(
        { type: 'render-error', tier: 'bundled', message: String(e) },
        '*'
      )
    }
  </script>
</body></html>
```

### CSS probe (one-shot per scan)

Some packages ship CSS at `/dist/style.css`, some at `/dist/index.css`, some
at `/style.css`, some don't ship any. We probe a fixed list **once per repo
scan** by HEAD-requesting each candidate and keeping the URLs that 200. The
result is stored in module-scope keyed by `<name>@<version>`. Subsequent
component renders within the same repo reuse the resolved URLs without
re-probing.

The probe list, in order:
1. `https://esm.sh/<name>@<version>/dist/style.css`
2. `https://esm.sh/<name>@<version>/dist/index.css`
3. `https://esm.sh/<name>@<version>/style.css`
4. `https://esm.sh/<name>@<version>/styles.css`

Probe failures fall through silently (most libraries are JS-only or use
CSS-in-JS; missing CSS isn't fatal — we render uglier but functional).

---

## 4. Variants

A `Variant` is the unit rendered in both gallery cards (variants[0] only) and
the detail view's variant strip:

```ts
export interface Variant {
  name: string                       // "Primary" / "default"
  props: Record<string, unknown>     // arg values for this render
  source: 'story' | 'auto' | 'default'
}
```

`ComponentExplorer` resolves `Variant[]` for each component once per scan, in
priority order:

1. **Authored stories** from `*.stories.*` files, if mapped successfully
2. **Auto-generated variants** from string-union prop types
3. **Single default render** with `propsGenerator` defaults

The result is always an array of length ≥ 1.

### Story file scanning (`storyParser.ts`)

Parses CSF v3 files using regex (matching the project's existing approach in
`componentParser.ts`):

- `export default \{...\}` block → extract `title` and `component` identifier
- Each other named export → name + `args` body (raw text)

`args` text is parsed as JSON-ish: we attempt `JSON.parse` on a normalised form
of the body (single→double quotes, trailing comma stripped, identifier keys
quoted). If parsing fails, **drop that variant silently** — never break the
component because one of its stories was unparseable.

### Story → component mapping

Each story's `default.component` is an identifier. We resolve it by:

1. Finding `import \{ <ident> \}` or `import <ident>` in the story file
2. Extracting the import path (relative)
3. Resolving against scanned `components[].path` from the same directory

Stories whose imports use path aliases (`@/lib/...`), bare specifiers, or files
outside the scan set are dropped.

### Auto-generated variants (`variantGenerator.ts`)

Triggers when:
- A prop has a string-literal union type: `'a' | 'b' | 'c'`
- AND the prop name is in the allowlist:
  `variant`, `size`, `color`, `intent`, `kind`, `tone`, `appearance`, `state`

Logic:
- Pick the **first** matching prop (no Cartesian product across multiple union
  props — that explodes variant counts)
- Generate one variant per union value, capped at 6
- Fill all other props from `propsGenerator` defaults
- If no allowlisted union prop exists, return an empty array (caller falls
  through to the single-default render)

### Cap

The variant strip in `ComponentDetailView` displays up to 6 tiles inline; if
`variants.length > 6` (only possible with authored stories — auto-gen is
already capped), the remainder collapses behind a `+ N more` button that
expands the strip to a 2-row grid.

### What we explicitly drop

- Storybook decorators / parameters / loaders / play functions — out of scope
- MDX stories — out of scope
- Stories with `render: () => …` overrides — dropped (we render with
  `<Component {...args}>` only)

---

## 5. UI Structure

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◂ All components       [☀/☾ theme]                  [Open on GH] │  ← top bar
├──────────────┬──────────────────────────────────────────────────┤
│ [search]     │   GALLERY MODE (selectedPath === null)            │
│              │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ Buttons/     │   │ Btn  │ │ Card │ │Modal │ │Input │            │
│   Button     │   └──────┘ └──────┘ └──────┘ └──────┘            │
│   IconBtn    │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ Forms/       │   │Switch│ │Avatar│ │Toast │ │ Tabs │            │
│   Input      │   └──────┘ └──────┘ └──────┘ └──────┘            │
│   Select     │                                                   │
│              │   DETAIL MODE (selectedPath !== null)             │
│              │   ┌────────────────────────────────┐              │
│              │   │     hero render                │              │
│              │   └────────────────────────────────┘              │
│              │   Variants                                        │
│              │   [prim] [secd] [ghost] [link]                   │
│              │   Props (table)                                   │
│              │   ▸ Source (collapsed accordion)                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### State (owned by `ComponentExplorer`)

```ts
const [scan, setScan] = useState<ComponentScanResult | null>(null)
const [scanState, setScanState] = useState<'scanning' | 'done' | 'error'>('scanning')
const [variantsByPath, setVariantsByPath] = useState<Record<string, Variant[]>>({})
const [tierByPath, setTierByPath] = useState<Record<string, RenderTier>>({})
const [selectedPath, setSelectedPath] = useState<string | null>(null)
const [theme, setTheme] = useState<'light' | 'dark'>('dark')
const [searchQuery, setSearchQuery] = useState('')
```

State is *not* lifted higher. Closing/reopening the Components tab resets it.

### Component breakdown

| File | Approx LOC | Inputs | Owns |
|---|---|---|---|
| `ComponentExplorer.tsx` | ~120 | `owner, name, branch` | All state above; orchestrates scan; renders sidebar + main + top bar |
| `ComponentSidebar.tsx` | ~100 | `components, searchQuery, selectedPath, onSelectPath, onClearSelection, onSearchChange` | Local: none |
| `ComponentGallery.tsx` | ~140 | `components, variantsByPath, tierByPath, theme, onSelect` | Local: IntersectionObserver, LRU iframe registry |
| `ComponentCard.tsx` | ~110 | `component, variant, tier, theme, onClick, onTierFallback` | Local: render state, blob URL, iframe ref |
| `ComponentDetailView.tsx` | ~180 | `component, variants, tier, theme, source, onClose` | Local: variantStripExpanded, sourceAccordionOpen |

### Sidebar

- Search input at top, filters by component name (case-insensitive substring)
- "All components" item highlighted when `selectedPath === null`, on click sets
  `selectedPath = null` (returns to gallery mode)
- Components grouped by parent folder, alphabetised within each group (existing
  grouping behaviour ported from current `ComponentExplorer`)

### Top bar

Three slots, in order:
- "◂ All components" link (visible only in detail mode; clears selection)
- Theme toggle (sun/moon icon, always visible)
- "Open on GitHub ↗" (visible only in detail mode; existing behaviour ported)

### Gallery card render lifecycle

1. Card mounts as a skeleton placeholder (component name + prop count, no iframe)
2. IntersectionObserver fires when card enters within 400px of viewport
3. Card mounts iframe using `tier` and `variants[0]`
4. On `render-error` postMessage with matching `tier`, switch to other tier and
   re-render once. If both fail, switch to failed-render UI: name + props
   summary + "View source" button (which sets `selectedPath` to enter detail
   view)

### LRU iframe eviction

A module-scope `Set<string>` (paths of currently-mounted iframe cards) capped
at 24. When a 25th would mount, the oldest is evicted by setting that card's
internal `evicted: true`, which unmounts its iframe and shows the placeholder
again. Re-entering view re-mounts.

### Theme toggle

Single light/dark binary. The selected theme is passed as a prop to each
iframe template, which renders:
- `<body data-theme="dark" class="dark" style="background:#0e0e0e;color:#eee">`
  (or light equivalents)

This handles three patterns "for free":
- Tailwind libraries reading `.dark` ancestor
- shadcn-style libraries reading `[data-theme="dark"]`
- Everything else: at least the iframe background matches the app theme

Per-library theme provider shims (`MuiThemeProvider`, `ChakraProvider`) are
**not** in v1. Documented as best-effort.

---

## 6. Error Handling

### Whole-scan failures

| Cause | Detection | UI |
|---|---|---|
| Network failure | `components:scan` rejects | `<p>Couldn't reach GitHub. <Retry></p>` |
| API rate limit | Scan returns `{ framework: 'unknown', components: [], stories: [], pkg: null }` AND we infer rate-limit (HTTP 403) — extend scanner to surface this | `<p>GitHub rate limit hit. Try again in a few minutes.</p>` |
| No components found | Scan returns empty `components` | `<p>No components found in this repo.</p>` (existing) |
| Repo too large (timeout) | Scan exceeds 30s | `<p>Repo too large to scan.</p>` |

### Per-component bundled-tier failures

- esm.sh non-200 on import URL → iframe fails, `render-error` postMessage with
  `tier: 'bundled'`
- Component name not exported by the package → iframe fails identically
- Runtime error inside the bundled component → `render-error` postMessage

In all three cases the card silently retries with `tier: 'source'`. No
user-visible error during the retry. The retry counter is per-card, capped at
1, so we don't infinite-loop.

### Per-component source-tier failures

Existing behaviour. Card shows the "failed render" state: component name +
props preview + "View source" button.

### Error bridge

The existing `window.parent.postMessage({type:'render-error',message})` bridge
is extended with a `tier: 'bundled' | 'source'` field. `ComponentCard` checks
the field to decide whether to retry on the other tier or surface the failed
state.

---

## 7. Performance

| Budget | Target | Mechanism |
|---|---|---|
| Scan completion | < 5s warm cache, < 15s cold (100 components) | Existing concurrency=10 batchFetch unchanged |
| Time to first skeleton | < 200ms after tab activation | Skeleton renders as soon as scan completes; no waiting on iframes |
| Time to first iframe | < 2s after card scrolls into view | Lazy-mount via IntersectionObserver |
| Mounted iframe count | ≤ 24 | LRU eviction (module-scope `Set`) |
| Memory pressure | Compiled blobs cached per component, freed on tab unmount | Existing `createdUrls.current` pattern, extended to module-scope keyed by `<owner>/<name>/<path>` |

The CSS probe (Section 3) runs once per repo scan, costing 4 HEAD requests in
the worst case (all probes 404). Cached for the lifetime of the scan.

---

## 8. Testing

Conventions match the project: Vitest unit tests (`*.test.ts`) sibling to the
file under test, React Testing Library for component tests (`*.test.tsx`).

### Unit tests (new)

| File | Coverage |
|---|---|
| `componentBundle.test.ts` | npm registry probe pass/fail; export-list resolution; CSS probe; module-scope cache |
| `storyParser.test.ts` | CSF v3 default + named exports; args parsing; broken args dropped; component-import resolution |
| `variantGenerator.test.ts` | Allowlist matching; first-prop-only behaviour; cap-at-6; empty-result case |
| `iframeTemplate.test.ts` | (extension) `buildBundledIframeHtml` snapshot for React + Solid; theme attr injection |
| `componentParser.test.ts` | (extension) string-literal union type extraction |

### Component tests (new)

| File | Coverage |
|---|---|
| `ComponentGallery.test.tsx` | Card lazy mount via mocked IntersectionObserver; LRU eviction at 25; failed-card surfaces "View source" |
| `ComponentDetailView.test.tsx` | Variant strip render; +N more expansion; source accordion toggle; props table |

### Integration test (one)

A fixture `ComponentScanResult` containing:
- Two components from a known shadcn-style published package (`pkg !== null`)
- One component from a non-published custom file

Asserts: tier selection per component, variant counts, render path used by
the gallery.

### Out of scope for automated tests

- E2E rendering against real npm packages (too flaky for CI)
- Bundled-tier rendering correctness on specific libraries (verified manually
  against shadcn/ui, MUI, Radix during build)

---

## 9. Out of Scope

Explicit exclusions for v1, all viable as follow-up specs:

- **Icon libraries** — different display problem (searchable grid of SVGs,
  copy-on-click). Detection + dedicated icon-grid view will be a separate spec.
- **Local-clone Vite sandbox** — running a real bundler against a cloned repo's
  files. Highest reliability ceiling but huge new infra.
- **Per-library theme providers** — MUI `ThemeProvider`, Chakra `ChakraProvider`,
  etc. Brittle, library-specific. Light/dark binary is what we ship.
- **Authored Storybook decorators / parameters / play functions / MDX**.
- **Persistence** of selected component, theme, or search query across tab
  close-reopen. Local state only.
- **Variant Cartesian products** — variants × sizes × colours expansion.
- **Multi-prop union variants** — only the first allowlisted union prop
  generates variants in v1.
