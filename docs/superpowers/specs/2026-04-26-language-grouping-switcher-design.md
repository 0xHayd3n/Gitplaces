# Language Grouping Switcher — Design Spec

**Date:** 2026-04-26
**Status:** Approved

---

## Problem

The language sidebar currently uses 24 categories with mixed organizational axes — some by platform/ecosystem (JVM, Apple, BEAM), some by paradigm (Functional, Lisp), some by use-case (Data, Markup, Hardware). This inconsistency makes the mental model unpredictable: a user can't reliably guess which group a language lives in.

## Solution

Add two named grouping modes — **Domain** and **Ecosystem** — switchable via a segmented toggle in the sidebar header. Domain collapses 24 groups into 8 use-case buckets that are intuitive for any developer. Ecosystem preserves the existing 24 groups for platform-aware users. The active mode is persisted to `localStorage`.

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

// Keep LangCategory as a type alias for backward compat across consumers
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
  category: EcosystemCategory      // existing field, type renamed
  domainCategory: DomainCategory   // new field
  icon: ComponentType<{ size?: number; color?: string }> | null
  color: string
  scale?: number
  doubleLayer?: boolean
}
```

Every entry in the `LANGUAGES` array gets a `domainCategory` assignment. The `category` field keeps its existing value — no ecosystem data changes.

### Domain category definitions

| Domain | What lives here |
|---|---|
| **Systems** | Low-level, OS, embedded: C, C++, Rust, Go, Zig, D, Nim, V, Crystal, Odin, Carbon, Assembly, Ada, Fortran, Pascal |
| **Web** | Frontend, backend web, markup, styling: JS, TS, CoffeeScript, ReScript, Wasm, Vue, Svelte, Astro, PHP, Ruby, Dart, HTML, MDX, CSS, SCSS, Sass, Less, Blade, EJS, Handlebars, Jinja, Hack |
| **Data & Science** | Data analysis, ML, scientific computing, SQL: Python, R, Julia, MATLAB, SAS, Jupyter Notebook, Mojo, TSQL, PLpgSQL |
| **Functional** | Functional-first languages: Haskell, OCaml, Elm, PureScript, Roc, Elixir, Erlang, Gleam, Common Lisp, Emacs Lisp, Scheme, Racket, F#, Clojure, Scala |
| **Mobile & Desktop** | Platform-tied ecosystems for native apps: Swift, Objective-C, Objective-C++, Java, Kotlin, Groovy, C#, VB.NET |
| **DevOps & Config** | Shell, automation, infrastructure: Shell, PowerShell, Batchfile, Nushell, AutoHotkey, Makefile, CMake, Dockerfile, Nix, HCL, Starlark, Jsonnet, Just, Puppet, Pkl, Perl, Lua, Tcl, Raku, Smalltalk |
| **Hardware** | GPU shaders, HDL, FPGA: GLSL, HLSL, CUDA, VHDL, Verilog, SystemVerilog |
| **Specialty** | Everything else: GDScript, Haxe, COBOL, ABAP, Apex, ActionScript, Vim Script, QML, Prolog, Lean, Solidity, Cairo, Move, TeX, Typst, Bicep |

---

## Helper exports

```ts
// Existing — update to accept both category types
export const LANG_CATEGORIES: EcosystemCategory[]  // unchanged
export const DOMAIN_CATEGORIES: DomainCategory[]   // new, ordered

// New helper
export function getLangsByDomainCategory(cat: DomainCategory): LangDef[]
```

---

## UI Changes

### `DiscoverSidebar.tsx`

- Add `groupingMode: GroupingMode` state, initialised from `localStorage.getItem('git-suite:language-grouping') ?? 'domain'`
- Persist on change: `localStorage.setItem('git-suite:language-grouping', mode)`
- Render a segmented toggle (two buttons: "Domain" / "Ecosystem") in the sidebar header, visually matching the existing header style
- Replace the category iteration (`LANG_CATEGORIES` + `getLangsByCategory`) with a branch:
  - `domain` → iterate `DOMAIN_CATEGORIES`, group via `getLangsByDomainCategory`
  - `ecosystem` → existing logic unchanged

### Domain category icons (`LANG_CAT_ICONS` extension)

Add icon + color entries for the 8 domain categories in `DiscoverSidebar.tsx`, using existing Phosphor/FontAwesome icons already imported:

| Domain | Icon |
|---|---|
| Systems | `PiCpuFill` |
| Web | `PiGlobeFill` |
| Data & Science | `PiChartBarFill` |
| Functional | `PiFunctionFill` |
| Mobile & Desktop | `PiDevicesFill` |
| DevOps & Config | `PiTerminalFill` |
| Hardware | `PiCircuitryFill` |
| Specialty | `PiStarFill` |

---

## Persistence

- Key: `'git-suite:language-grouping'`
- Store: `localStorage`
- Values: `'domain'` | `'ecosystem'`
- Default: `'domain'`

---

## Out of scope

- A third grouping mode (Paradigm)
- User-defined custom groupings
- Changing any ecosystem category assignments or language metadata beyond adding `domainCategory`

---

## Files touched

| File | Change |
|---|---|
| `src/lib/languages.ts` | Add `EcosystemCategory`, `DomainCategory`, `GroupingMode` types; add `domainCategory` field to `LangDef`; assign `domainCategory` to all ~140 entries; add `DOMAIN_CATEGORIES` and `getLangsByDomainCategory` |
| `src/components/DiscoverSidebar.tsx` | Add toggle UI; add domain icons; branch grouping logic on `groupingMode` state |
| `src/components/DiscoverSidebar.css` | Style the segmented toggle |
