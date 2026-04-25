# Language Grouping Switcher — Design Spec

**Date:** 2026-04-26
**Status:** Approved (rev 2 — post spec-review fixes)

---

## Problem

The language sidebar currently uses 24 categories with mixed organizational axes — some by platform/ecosystem (JVM, Apple, BEAM), some by paradigm (Functional, Lisp), some by use-case (Data, Markup, Hardware). This inconsistency makes the mental model unpredictable: a user can't reliably guess which group a language lives in.

## Solution

Add two named grouping modes — **Domain** and **Ecosystem** — switchable via a segmented toggle inside `FilterPanel`. Domain collapses 24 groups into 8 use-case buckets that are intuitive for any developer. Ecosystem preserves the existing 24 groups for platform-aware users. The active mode is persisted to `localStorage` via the existing `useLocalStorage` hook.

---

## Data Model

### New types in `src/lib/languages.ts`

```ts
// Rename existing LangCategory → EcosystemCategory (24 values, unchanged)
export type EcosystemCategory =
  | 'Systems' | 'JVM' | 'Apple' | '.NET' | 'JavaScript' | 'Web Frameworks'
  | 'Functional' | 'BEAM' | 'Lisp' | 'Scripting' | 'Shell' | 'Data'
  | 'Logic' | 'Markup' | 'Styling' | 'Typesetting' | 'Database' | 'Config'
  | 'Blockchain' | 'Hardware' | 'Game' | 'Enterprise' | 'Editor' | 'UI'

// Keep LangCategory as a type alias — all existing consumers (DiscoverTopNav,
// GridHeader, RepoCard, LanguageIcon, etc.) require zero changes.
export type LangCategory = EcosystemCategory

// New
export type DomainCategory =
  | 'Systems'
  | 'Web'
  | 'Data & Science'
  | 'Functional'
  | 'Mobile & Desktop'
  | 'DevOps & Config'
  | 'Hardware'
  | 'Specialty'

export type GroupingMode = 'domain' | 'ecosystem'
```

### Updated `LangDef`

```ts
export interface LangDef {
  name: string
  key: string
  category: EcosystemCategory      // existing field, type renamed from LangCategory
  domainCategory: DomainCategory   // new required field
  icon: ComponentType<{ size?: number; color?: string }> | null
  color: string
  scale?: number
  doubleLayer?: boolean
}
```

Every entry in the `LANGUAGES` array gets a `domainCategory` assignment. The `category` field keeps its existing value — no ecosystem data changes.

### Domain category definitions

Canonical order (matches sidebar display order top-to-bottom):

| # | Domain | What lives here |
|---|---|---|
| 1 | **Systems** | Low-level, OS, embedded: C, C++, Rust, Go, Zig, D, Nim, V, Crystal, Odin, Carbon, Assembly, Ada, Fortran, Pascal |
| 2 | **Web** | Frontend, backend web, markup, styling: JS, TS, CoffeeScript, ReScript, Wasm, Vue, Svelte, Astro, PHP, Ruby, HTML, MDX, CSS, SCSS, Sass, Less, Blade, EJS, Handlebars, Jinja, Hack |
| 3 | **Data & Science** | Data analysis, ML, scientific computing, SQL: Python, R, Julia, MATLAB, SAS, Jupyter Notebook, Mojo, TSQL, PLpgSQL |
| 4 | **Functional** | Functional-first languages: Haskell, OCaml, Elm, PureScript, Roc, Elixir, Erlang, Gleam, Common Lisp, Emacs Lisp, Scheme, Racket, F#, Clojure, Scala |
| 5 | **Mobile & Desktop** | Platform-tied ecosystems for native apps: Swift, Objective-C, Objective-C++, Java, Kotlin, Groovy, C#, VB.NET, Dart |
| 6 | **DevOps & Config** | Shell, automation, infrastructure: Shell, PowerShell, Batchfile, Nushell, AutoHotkey, Makefile, CMake, Dockerfile, Nix, HCL, Starlark, Jsonnet, Just, Puppet, Pkl, Perl, Lua, Tcl, Raku |
| 7 | **Hardware** | GPU shaders, HDL, FPGA: GLSL, HLSL, CUDA, VHDL, Verilog, SystemVerilog |
| 8 | **Specialty** | Everything else: GDScript, Haxe, COBOL, ABAP, Apex, ActionScript, Vim Script, QML, Prolog, Lean, Solidity, Cairo, Move, TeX, Typst, Bicep, Smalltalk, Luau |

**Notable placement decisions:**
- **Dart** → Mobile & Desktop (GitHub repos are overwhelmingly Flutter; web use is secondary)
- **F# / Scala / Clojure** → Functional (these are functional-first despite running on .NET/JVM; their GitHub repo distribution skews functional/research over application)
- **Smalltalk** → Specialty (not a DevOps language; legacy/research use)
- **Luau** → Specialty (Roblox scripting engine)
- **Perl / Lua / Tcl / Raku** → DevOps & Config (scripting used primarily in automation/tooling contexts on GitHub)

---

## Helper exports

```ts
// Existing — unchanged
export const LANG_CATEGORIES: EcosystemCategory[]

// New
export const DOMAIN_CATEGORIES: DomainCategory[]  // ordered as in the table above
export function getLangsByDomainCategory(cat: DomainCategory): LangDef[]
```

---

## UI Changes

### `FilterPanel` in `DiscoverSidebar.tsx`

`FilterPanel` is a named export used in both `DiscoverSidebar` (sidebar drawer) and `DiscoverTopNav` (mobile/narrow nav). The grouping toggle must live **inside `FilterPanel`** so it's reachable from both layouts.

- Add `groupingMode` state via `useLocalStorage<GroupingMode>('discover:languageGrouping', 'domain')` inside `FilterPanel`
- Render the segmented toggle inside the language tab — above the language list, below the tab bar
- Branch grouping logic on `groupingMode`:
  - `'domain'` → iterate `DOMAIN_CATEGORIES`, group via `getLangsByDomainCategory`
  - `'ecosystem'` → existing logic unchanged (`LANG_CATEGORIES` + `getLangsByCategory`)

#### Toggle markup (inside the language tab, above the category list)

```tsx
<div className="filter-grouping-toggle">
  <button
    className={`filter-grouping-btn${groupingMode === 'domain' ? ' active' : ''}`}
    onClick={() => setGroupingMode('domain')}
  >
    Domain
  </button>
  <button
    className={`filter-grouping-btn${groupingMode === 'ecosystem' ? ' active' : ''}`}
    onClick={() => setGroupingMode('ecosystem')}
  >
    Ecosystem
  </button>
</div>
```

#### CSS (in `DiscoverSidebar.css`)

```css
.filter-grouping-toggle {
  display: flex;
  background: var(--bg-secondary, #111);
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  overflow: hidden;
  margin: 8px 12px 4px;
}

.filter-grouping-btn {
  flex: 1;
  padding: 4px 0;
  font-size: 11px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
}

.filter-grouping-btn.active {
  background: var(--accent, #6c47ff);
  color: #fff;
}
```

### Domain category icons

Add `const DOMAIN_CAT_ICONS: Record<DomainCategory, IconType>` in `DiscoverSidebar.tsx`, declared immediately after `LANG_CAT_ICONS` (line 117):

| Domain | Icon | Import status |
|---|---|---|
| Systems | `PiCpuFill` | Already imported |
| Web | `PiGlobeFill` | **New import needed** |
| Data & Science | `PiChartBarFill` | Already imported |
| Functional | `PiFunctionFill` | Already imported |
| Mobile & Desktop | `PiDevicesFill` | **New import needed** |
| DevOps & Config | `PiTerminalWindowFill` | Already imported |
| Hardware | `PiCircuitryFill` | Already imported |
| Specialty | `PiStarFill` | **New import needed** |

Three new Phosphor icon imports required: `PiGlobeFill`, `PiDevicesFill`, `PiStarFill`.

---

## Persistence

- Hook: `useLocalStorage<GroupingMode>('discover:languageGrouping', 'domain')`  
  (follows the `namespace:camelCaseKey` convention established by `'files:viewMode'` etc.)
- Default: `'domain'`

---

## Out of scope

- A third grouping mode (Paradigm)
- User-defined custom groupings
- Changing any ecosystem category assignments or language metadata beyond adding `domainCategory`
- Any changes to `DiscoverTopNav`, `GridHeader`, `RepoCard`, or `LanguageIcon` (the `LangCategory` type alias preserves all existing consumers unchanged)

---

## Files touched

| File | Change |
|---|---|
| `src/lib/languages.ts` | Add `EcosystemCategory`, `DomainCategory`, `GroupingMode` types; add `domainCategory` field to `LangDef`; assign `domainCategory` to all ~140 entries; add `DOMAIN_CATEGORIES` and `getLangsByDomainCategory` |
| `src/components/DiscoverSidebar.tsx` | Add `groupingMode` state via `useLocalStorage` inside `FilterPanel`; add toggle markup above category list; add `DOMAIN_CAT_ICONS`; branch grouping logic; add 3 new icon imports |
| `src/components/DiscoverSidebar.css` | Add `.filter-grouping-toggle` and `.filter-grouping-btn` styles |
