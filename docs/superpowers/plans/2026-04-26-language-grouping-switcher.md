# Language Grouping Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Domain/Ecosystem toggle to `FilterPanel` so users can switch between 8 broad use-case groups and the existing 24 platform-specific groups.

**Architecture:** Add `domainCategory` to every `LangDef` entry in `languages.ts`, expose matching helpers, then wire a `useLocalStorage`-backed segmented toggle inside `FilterPanel` that branches the grouping render between domain and ecosystem mode.

**Tech Stack:** TypeScript, React, Vitest + React Testing Library, `useLocalStorage` hook (`src/hooks/useLocalStorage.ts`), `react-icons/pi`

---

## File Map

| File | What changes |
|---|---|
| `src/lib/languages.ts` | Rename `LangCategory` → `EcosystemCategory`, keep alias; add `DomainCategory`, `GroupingMode`; add `domainCategory` to `LangDef`; assign field on all 112 entries; add `DOMAIN_CATEGORIES` + `getLangsByDomainCategory` |
| `src/lib/languages.test.ts` | New — tests for `DOMAIN_CATEGORIES`, `getLangsByDomainCategory`, and complete coverage sanity check |
| `src/components/DiscoverSidebar.tsx` | 3 new icon imports; `DOMAIN_CAT_ICONS` after `LANG_CAT_ICONS`; `useLocalStorage` + toggle in `FilterPanel`; branched category render |
| `src/components/DiscoverSidebar.css` | Add `.filter-grouping-toggle` + `.filter-grouping-btn` styles |

---

## Task 1: Type scaffold in `languages.ts`

**Files:**
- Modify: `src/lib/languages.ts:80-121`

This task introduces the new types and updates `LangDef`. After this step TypeScript will error on every `LANGUAGES` entry because `domainCategory` is now required — that's intentional and will be fixed in Task 2.

- [ ] **Step 1: Replace `LangCategory` with `EcosystemCategory` + alias, add new types**

Replace lines 80–121 of `src/lib/languages.ts` with:

```ts
export type EcosystemCategory =
  | 'Systems'
  | 'JVM'
  | 'Apple'
  | '.NET'
  | 'JavaScript'
  | 'Web Frameworks'
  | 'Functional'
  | 'BEAM'
  | 'Lisp'
  | 'Scripting'
  | 'Shell'
  | 'Data'
  | 'Logic'
  | 'Markup'
  | 'Styling'
  | 'Typesetting'
  | 'Database'
  | 'Config'
  | 'Blockchain'
  | 'Hardware'
  | 'Game'
  | 'Enterprise'
  | 'Editor'
  | 'UI'

/** Backward-compat alias — all existing consumers (GridHeader, RepoCard, etc.) require zero changes */
export type LangCategory = EcosystemCategory

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

export interface LangDef {
  name: string
  key: string
  category: EcosystemCategory
  domainCategory: DomainCategory
  icon: ComponentType<{ size?: number; color?: string }> | null
  color: string
  scale?: number
  doubleLayer?: boolean
}
```

- [ ] **Step 2: Verify TypeScript reports missing `domainCategory` errors**

Run: `npx tsc --noEmit 2>&1 | grep domainCategory | head -5`

Expected: errors on LANGUAGES entries — confirms the field is required. If no errors appear, the interface change didn't take — re-check the edit.

- [ ] **Step 3: Commit scaffold (TypeScript errors expected)**

```bash
git add src/lib/languages.ts
git commit -m "feat(languages): add EcosystemCategory, DomainCategory, GroupingMode types"
```

---

## Task 2: Assign `domainCategory` to all 112 LANGUAGES entries

**Files:**
- Modify: `src/lib/languages.ts:123-260`

Add `domainCategory` to every object in the `LANGUAGES` array. The `category` field is unchanged. Use the table below — every language must have exactly one domain.

**Domain assignment reference:**

| Language | domainCategory |
|---|---|
| C, C++, Rust, Go, Zig, D, Nim, V, Crystal, Odin, Carbon, Assembly, Ada, Fortran, Pascal | `'Systems'` |
| Java, Kotlin, Groovy, Swift, Objective-C, Objective-C++, C#, VB.NET, Dart | `'Mobile & Desktop'` |
| Scala, Clojure, F# | `'Functional'` |
| JavaScript, TypeScript, CoffeeScript, ReScript, WebAssembly, Vue, Svelte, Astro | `'Web'` |
| Ruby, PHP, HTML, MDX, Blade, EJS, Handlebars, Jinja, CSS, SCSS, Sass, Less, Hack | `'Web'` |
| Haskell, OCaml, Elm, PureScript, Roc, Elixir, Erlang, Gleam, Common Lisp, Emacs Lisp, Scheme, Racket | `'Functional'` |
| Python, R, Julia, MATLAB, SAS, Jupyter Notebook, Mojo, TSQL, PLpgSQL | `'Data & Science'` |
| Shell, PowerShell, Batchfile, Nushell, AutoHotkey, Makefile, CMake, Dockerfile, HCL, Nix, Starlark, Jsonnet, Just, Puppet, Pkl, Perl, Lua, Tcl, Raku | `'DevOps & Config'` |
| GLSL, HLSL, CUDA, VHDL, Verilog, SystemVerilog | `'Hardware'` |
| GDScript, Haxe, COBOL, ABAP, Apex, ActionScript, Vim Script, QML, Prolog, Lean, Solidity, Cairo, Move, TeX, Typst, Bicep, Smalltalk, Luau | `'Specialty'` |

- [ ] **Step 1: Add `domainCategory` to every LANGUAGES entry**

Edit `src/lib/languages.ts` lines 123–260. Each entry gains one field. Example transformation:

```ts
// Before:
{ name: 'C', key: 'c', category: 'Systems', icon: SiC, color: '#649bd3' },

// After:
{ name: 'C', key: 'c', category: 'Systems', domainCategory: 'Systems', icon: SiC, color: '#649bd3' },
```

Complete updated LANGUAGES block (replace lines 123–260 entirely):

```ts
export const LANGUAGES: LangDef[] = [
  // --- Systems / Low-level ---
  { name: 'C',          key: 'c',           category: 'Systems',    domainCategory: 'Systems',         icon: SiC,             color: '#649bd3' },
  { name: 'C++',        key: 'c++',         category: 'Systems',    domainCategory: 'Systems',         icon: SiCplusplus,     color: '#649bd3' },
  { name: 'Rust',       key: 'rust',        category: 'Systems',    domainCategory: 'Systems',         icon: SiRust,          color: '#000000' },
  { name: 'Go',         key: 'go',          category: 'Systems',    domainCategory: 'Systems',         icon: SiGo,            color: '#02aed4', scale: 1.6 },
  { name: 'Zig',        key: 'zig',         category: 'Systems',    domainCategory: 'Systems',         icon: SiZig,           color: '#f6a615' },
  { name: 'D',          key: 'd',           category: 'Systems',    domainCategory: 'Systems',         icon: DiDlang,         color: '#b03931', scale: 1.6 },
  { name: 'Nim',        key: 'nim',         category: 'Systems',    domainCategory: 'Systems',         icon: SiNim,           color: '#1e212a' },
  { name: 'V',          key: 'v',           category: 'Systems',    domainCategory: 'Systems',         icon: SiV,             color: '#5d87bf' },
  { name: 'Crystal',    key: 'crystal',     category: 'Systems',    domainCategory: 'Systems',         icon: SiCrystal,       color: '#000000' },
  { name: 'Odin',       key: 'odin',        category: 'Systems',    domainCategory: 'Systems',         icon: SiOdin,          color: '#60AFFE' },
  { name: 'Carbon',     key: 'carbon',      category: 'Systems',    domainCategory: 'Systems',         icon: null,            color: '#222222' },
  { name: 'Assembly',   key: 'assembly',    category: 'Systems',    domainCategory: 'Systems',         icon: null,            color: '#6b7280' },
  { name: 'Ada',        key: 'ada',         category: 'Systems',    domainCategory: 'Systems',         icon: SiAda,           color: '#02f88c' },
  { name: 'Fortran',    key: 'fortran',     category: 'Systems',    domainCategory: 'Systems',         icon: SiFortran,       color: '#734f97' },
  { name: 'Pascal',     key: 'pascal',      category: 'Systems',    domainCategory: 'Systems',         icon: null,            color: '#E3F171' },
  // --- JVM ---
  { name: 'Java',       key: 'java',        category: 'JVM',        domainCategory: 'Mobile & Desktop', icon: DiJava,          color: '#dc2626', scale: 1.6, doubleLayer: true },
  { name: 'Kotlin',     key: 'kotlin',      category: 'JVM',        domainCategory: 'Mobile & Desktop', icon: SiKotlin,        color: '#7c3aed' },
  { name: 'Scala',      key: 'scala',       category: 'JVM',        domainCategory: 'Functional',      icon: SiScala,         color: '#dc2626' },
  { name: 'Groovy',     key: 'groovy',      category: 'JVM',        domainCategory: 'Mobile & Desktop', icon: DiGroovy,        color: '#4298b8', scale: 2.0 },
  { name: 'Clojure',    key: 'clojure',     category: 'JVM',        domainCategory: 'Functional',      icon: SiClojure,       color: '#62b132' },
  // --- Apple ---
  { name: 'Swift',      key: 'swift',       category: 'Apple',      domainCategory: 'Mobile & Desktop', icon: SiSwift,         color: '#ef503b' },
  { name: 'Objective-C',key: 'objective-c', category: 'Apple',      domainCategory: 'Mobile & Desktop', icon: null,            color: '#438eff' },
  { name: 'Objective-C++',key:'objective-c++', category: 'Apple',   domainCategory: 'Mobile & Desktop', icon: null,            color: '#6866fb' },
  // --- .NET ---
  { name: 'C#',         key: 'c#',          category: '.NET',       domainCategory: 'Mobile & Desktop', icon: SiSharp,         color: '#6d28d9' },
  { name: 'F#',         key: 'f#',          category: '.NET',       domainCategory: 'Functional',      icon: SiFsharp,        color: '#378bba' },
  { name: 'VB.NET',     key: 'visual basic .net', category: '.NET', domainCategory: 'Mobile & Desktop', icon: DiDotnet,        color: '#945db7' },
  // --- JavaScript / TypeScript ---
  { name: 'JavaScript', key: 'javascript',  category: 'JavaScript', domainCategory: 'Web',             icon: SiJavascript,    color: '#fd7d00' },
  { name: 'TypeScript', key: 'typescript',  category: 'JavaScript', domainCategory: 'Web',             icon: SiTypescript,    color: '#3178c6' },
  { name: 'CoffeeScript',key:'coffeescript',category: 'JavaScript', domainCategory: 'Web',             icon: SiCoffeescript,  color: '#3e2622' },
  { name: 'ReScript',   key: 'rescript',    category: 'JavaScript', domainCategory: 'Web',             icon: SiRescript,      color: '#ed5051' },
  { name: 'WebAssembly',key: 'webassembly', category: 'JavaScript', domainCategory: 'Web',             icon: SiWebassembly,   color: '#04133b' },
  // --- Web frameworks ---
  { name: 'Vue',        key: 'vue',         category: 'Web Frameworks', domainCategory: 'Web',         icon: SiVuedotjs,      color: '#3fb883' },
  { name: 'Svelte',     key: 'svelte',      category: 'Web Frameworks', domainCategory: 'Web',         icon: SiSvelte,        color: '#fb3c06' },
  { name: 'Astro',      key: 'astro',       category: 'Web Frameworks', domainCategory: 'Web',         icon: SiAstro,         color: '#ff5a03' },
  // --- Functional / ML ---
  { name: 'Haskell',    key: 'haskell',     category: 'Functional', domainCategory: 'Functional',      icon: SiHaskell,       color: '#9c3c90' },
  { name: 'OCaml',      key: 'ocaml',       category: 'Functional', domainCategory: 'Functional',      icon: SiOcaml,         color: '#c1501e' },
  { name: 'Elm',        key: 'elm',         category: 'Functional', domainCategory: 'Functional',      icon: SiElm,           color: '#0ea5e9' },
  { name: 'PureScript', key: 'purescript',  category: 'Functional', domainCategory: 'Functional',      icon: SiPurescript,    color: '#1D222D' },
  { name: 'Roc',        key: 'roc',         category: 'Functional', domainCategory: 'Functional',      icon: null,            color: '#7c38f5' },
  // --- BEAM ecosystem ---
  { name: 'Elixir',     key: 'elixir',      category: 'BEAM',       domainCategory: 'Functional',      icon: SiElixir,        color: '#4a3560' },
  { name: 'Erlang',     key: 'erlang',      category: 'BEAM',       domainCategory: 'Functional',      icon: DiErlang,        color: '#ab0130', scale: 1.6 },
  { name: 'Gleam',      key: 'gleam',       category: 'BEAM',       domainCategory: 'Functional',      icon: SiGleam,         color: '#ffaff3' },
  // --- Lisp family ---
  { name: 'Common Lisp',key: 'common lisp', category: 'Lisp',       domainCategory: 'Functional',      icon: SiCommonlisp,    color: '#3fb68b' },
  { name: 'Emacs Lisp', key: 'emacs lisp',  category: 'Lisp',       domainCategory: 'Functional',      icon: SiGnuemacs,      color: '#c065db' },
  { name: 'Scheme',     key: 'scheme',      category: 'Lisp',       domainCategory: 'Functional',      icon: null,            color: '#1e4aec' },
  { name: 'Racket',     key: 'racket',      category: 'Lisp',       domainCategory: 'Functional',      icon: SiRacket,        color: '#3c5caa' },
  // --- Scripting ---
  { name: 'Python',     key: 'python',      category: 'Scripting',  domainCategory: 'Data & Science',  icon: SiPython,        color: '#367ab3' },
  { name: 'Ruby',       key: 'ruby',        category: 'Scripting',  domainCategory: 'Web',             icon: SiRuby,          color: '#dc2626' },
  { name: 'PHP',        key: 'php',         category: 'Scripting',  domainCategory: 'Web',             icon: DiPhp,           color: '#4f5c93', scale: 1.6 },
  { name: 'Perl',       key: 'perl',        category: 'Scripting',  domainCategory: 'DevOps & Config', icon: DiPerl,          color: '#0073a0', scale: 1.6 },
  { name: 'Lua',        key: 'lua',         category: 'Scripting',  domainCategory: 'DevOps & Config', icon: SiLua,           color: '#010080' },
  { name: 'Luau',       key: 'luau',        category: 'Scripting',  domainCategory: 'Specialty',       icon: SiLuau,          color: '#00A2FF' },
  { name: 'Dart',       key: 'dart',        category: 'Scripting',  domainCategory: 'Mobile & Desktop', icon: DiDart,          color: '#0c6291', scale: 1.6 },
  { name: 'Tcl',        key: 'tcl',         category: 'Scripting',  domainCategory: 'DevOps & Config', icon: null,            color: '#e4cc98' },
  { name: 'Raku',       key: 'raku',        category: 'Scripting',  domainCategory: 'DevOps & Config', icon: null,            color: '#0000fb' },
  { name: 'Hack',       key: 'hack',        category: 'Scripting',  domainCategory: 'Web',             icon: null,            color: '#878787' },
  { name: 'Smalltalk',  key: 'smalltalk',   category: 'Scripting',  domainCategory: 'Specialty',       icon: null,            color: '#596706' },
  // --- Shell / Automation ---
  { name: 'Shell',      key: 'shell',       category: 'Shell',      domainCategory: 'DevOps & Config', icon: BiSolidTerminal, color: '#16a34a' },
  { name: 'PowerShell', key: 'powershell',  category: 'Shell',      domainCategory: 'DevOps & Config', icon: null,            color: '#146fbe' },
  { name: 'Batchfile',  key: 'batchfile',   category: 'Shell',      domainCategory: 'DevOps & Config', icon: null,            color: '#C1F12E' },
  { name: 'Nushell',    key: 'nushell',     category: 'Shell',      domainCategory: 'DevOps & Config', icon: SiNushell,       color: '#4E9906' },
  { name: 'AutoHotkey', key: 'autohotkey',  category: 'Shell',      domainCategory: 'DevOps & Config', icon: SiAutohotkey,    color: '#6594b9' },
  // --- Data / Scientific ---
  { name: 'R',          key: 'r',           category: 'Data',       domainCategory: 'Data & Science',  icon: SiR,             color: '#2563eb' },
  { name: 'Julia',      key: 'julia',       category: 'Data',       domainCategory: 'Data & Science',  icon: SiJulia,         color: '#7c3aed' },
  { name: 'MATLAB',     key: 'matlab',      category: 'Data',       domainCategory: 'Data & Science',  icon: null,            color: '#e16737' },
  { name: 'SAS',        key: 'sas',         category: 'Data',       domainCategory: 'Data & Science',  icon: null,            color: '#B34936' },
  { name: 'Jupyter Notebook', key: 'jupyter notebook', category: 'Data', domainCategory: 'Data & Science', icon: SiJupyter, color: '#DA5B0B' },
  { name: 'Mojo',       key: 'mojo',        category: 'Data',       domainCategory: 'Data & Science',  icon: null,            color: '#ff4c1a' },
  // --- Logic / Proof ---
  { name: 'Prolog',     key: 'prolog',      category: 'Logic',      domainCategory: 'Specialty',       icon: DiProlog,        color: '#74283c', scale: 1.6 },
  { name: 'Lean',       key: 'lean',        category: 'Logic',      domainCategory: 'Specialty',       icon: null,            color: '#404040' },
  // --- Markup / Templating ---
  { name: 'HTML',       key: 'html',        category: 'Markup',     domainCategory: 'Web',             icon: SiHtml5,         color: '#e74b22' },
  { name: 'MDX',        key: 'mdx',         category: 'Markup',     domainCategory: 'Web',             icon: SiMdx,           color: '#fcb32c' },
  { name: 'Blade',      key: 'blade',       category: 'Markup',     domainCategory: 'Web',             icon: SiLaravel,       color: '#f7523f' },
  { name: 'EJS',        key: 'ejs',         category: 'Markup',     domainCategory: 'Web',             icon: SiEjs,           color: '#a91e50' },
  { name: 'Handlebars', key: 'handlebars',  category: 'Markup',     domainCategory: 'Web',             icon: SiHandlebarsdotjs, color: '#f7931e' },
  { name: 'Jinja',      key: 'jinja',       category: 'Markup',     domainCategory: 'Web',             icon: SiJinja,         color: '#a52a22' },
  // --- Styling ---
  { name: 'CSS',        key: 'css',         category: 'Styling',    domainCategory: 'Web',             icon: BiLogoCss3,      color: '#65309a', scale: 1.4 },
  { name: 'SCSS',       key: 'scss',        category: 'Styling',    domainCategory: 'Web',             icon: SiSass,          color: '#c6538c' },
  { name: 'Sass',       key: 'sass',        category: 'Styling',    domainCategory: 'Web',             icon: SiSass,          color: '#a53b70' },
  { name: 'Less',       key: 'less',        category: 'Styling',    domainCategory: 'Web',             icon: SiLess,          color: '#1d365d' },
  // --- Typesetting ---
  { name: 'TeX',        key: 'tex',         category: 'Typesetting', domainCategory: 'Specialty',      icon: SiLatex,         color: '#3D6117' },
  { name: 'Typst',      key: 'typst',       category: 'Typesetting', domainCategory: 'Specialty',      icon: SiTypst,         color: '#239DAD' },
  // --- Database / Query ---
  { name: 'TSQL',       key: 'tsql',        category: 'Database',   domainCategory: 'Data & Science',  icon: DiMsqlServer,    color: '#e38c00', scale: 1.6 },
  { name: 'PLpgSQL',    key: 'plpgsql',     category: 'Database',   domainCategory: 'Data & Science',  icon: SiPostgresql,    color: '#336790' },
  // --- Build / Config / IaC ---
  { name: 'Makefile',   key: 'makefile',    category: 'Config',     domainCategory: 'DevOps & Config', icon: SiMake,          color: '#427819' },
  { name: 'CMake',      key: 'cmake',       category: 'Config',     domainCategory: 'DevOps & Config', icon: SiCmake,         color: '#DA3434' },
  { name: 'Dockerfile', key: 'dockerfile',  category: 'Config',     domainCategory: 'DevOps & Config', icon: SiDocker,        color: '#384d54' },
  { name: 'HCL',        key: 'hcl',         category: 'Config',     domainCategory: 'DevOps & Config', icon: SiTerraform,     color: '#844FBA' },
  { name: 'Nix',        key: 'nix',         category: 'Config',     domainCategory: 'DevOps & Config', icon: SiNixos,         color: '#3090f6' },
  { name: 'Starlark',   key: 'starlark',    category: 'Config',     domainCategory: 'DevOps & Config', icon: null,            color: '#76d275' },
  { name: 'Bicep',      key: 'bicep',       category: 'Config',     domainCategory: 'Specialty',       icon: null,            color: '#519aba' },
  { name: 'Jsonnet',    key: 'jsonnet',     category: 'Config',     domainCategory: 'DevOps & Config', icon: null,            color: '#0064bd' },
  { name: 'Just',       key: 'just',        category: 'Config',     domainCategory: 'DevOps & Config', icon: null,            color: '#384d54' },
  { name: 'Puppet',     key: 'puppet',      category: 'Config',     domainCategory: 'DevOps & Config', icon: SiPuppet,        color: '#302B6D' },
  { name: 'Pkl',        key: 'pkl',         category: 'Config',     domainCategory: 'DevOps & Config', icon: null,            color: '#6b9543' },
  // --- Blockchain / Smart contracts ---
  { name: 'Solidity',   key: 'solidity',    category: 'Blockchain', domainCategory: 'Specialty',       icon: SiSolidity,      color: '#2a247c' },
  { name: 'Cairo',      key: 'cairo',       category: 'Blockchain', domainCategory: 'Specialty',       icon: null,            color: '#ff4a48' },
  { name: 'Move',       key: 'move',        category: 'Blockchain', domainCategory: 'Specialty',       icon: null,            color: '#4a137a' },
  // --- Shader / GPU / Hardware ---
  { name: 'GLSL',       key: 'glsl',        category: 'Hardware',   domainCategory: 'Hardware',        icon: null,            color: '#5686a5' },
  { name: 'HLSL',       key: 'hlsl',        category: 'Hardware',   domainCategory: 'Hardware',        icon: null,            color: '#aace60' },
  { name: 'CUDA',       key: 'cuda',        category: 'Hardware',   domainCategory: 'Hardware',        icon: SiNvidia,        color: '#3A4E3A' },
  { name: 'VHDL',       key: 'vhdl',        category: 'Hardware',   domainCategory: 'Hardware',        icon: null,            color: '#adb2cb' },
  { name: 'Verilog',    key: 'verilog',     category: 'Hardware',   domainCategory: 'Hardware',        icon: null,            color: '#b2b7f8' },
  { name: 'SystemVerilog',key:'systemverilog', category: 'Hardware', domainCategory: 'Hardware',       icon: null,            color: '#DAE1C2' },
  // --- Game development ---
  { name: 'GDScript',   key: 'gdscript',    category: 'Game',       domainCategory: 'Specialty',       icon: SiGodotengine,   color: '#355570' },
  { name: 'Haxe',       key: 'haxe',        category: 'Game',       domainCategory: 'Specialty',       icon: SiHaxe,          color: '#df7900' },
  // --- Enterprise / Legacy ---
  { name: 'COBOL',      key: 'cobol',       category: 'Enterprise', domainCategory: 'Specialty',       icon: null,            color: '#0070c0' },
  { name: 'ABAP',       key: 'abap',        category: 'Enterprise', domainCategory: 'Specialty',       icon: SiSap,           color: '#E8274B' },
  { name: 'Apex',       key: 'apex',        category: 'Enterprise', domainCategory: 'Specialty',       icon: SiSalesforce,    color: '#1797c0' },
  { name: 'ActionScript',key:'actionscript', category: 'Enterprise', domainCategory: 'Specialty',      icon: null,            color: '#882B0F' },
  // --- Editor scripting ---
  { name: 'Vim Script', key: 'vim script',  category: 'Editor',     domainCategory: 'Specialty',       icon: SiVim,           color: '#199f4b' },
  // --- UI frameworks ---
  { name: 'QML',        key: 'qml',         category: 'UI',         domainCategory: 'Specialty',       icon: SiQt,            color: '#44a51c' },
]
```

- [ ] **Step 2: Verify TypeScript is clean**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no output (zero errors). If errors remain, check that every entry has `domainCategory` and that the value is a valid `DomainCategory` string.

- [ ] **Step 3: Commit**

```bash
git add src/lib/languages.ts
git commit -m "feat(languages): assign domainCategory to all 112 language entries"
```

---

## Task 3: Add `DOMAIN_CATEGORIES` and `getLangsByDomainCategory`

**Files:**
- Modify: `src/lib/languages.ts:274-280` (bottom of file, after existing helpers)
- Create: `src/lib/languages.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/languages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DOMAIN_CATEGORIES, getLangsByDomainCategory, LANGUAGES } from './languages'

describe('DOMAIN_CATEGORIES', () => {
  it('has exactly 8 entries in canonical order', () => {
    expect(DOMAIN_CATEGORIES).toEqual([
      'Systems',
      'Web',
      'Data & Science',
      'Functional',
      'Mobile & Desktop',
      'DevOps & Config',
      'Hardware',
      'Specialty',
    ])
  })
})

describe('getLangsByDomainCategory', () => {
  it('returns non-empty arrays for every domain', () => {
    for (const cat of DOMAIN_CATEGORIES) {
      const langs = getLangsByDomainCategory(cat)
      expect(langs.length, `${cat} should have at least one language`).toBeGreaterThan(0)
    }
  })

  it('returns only languages with matching domainCategory', () => {
    const systems = getLangsByDomainCategory('Systems')
    expect(systems.every(l => l.domainCategory === 'Systems')).toBe(true)
  })

  it('covers all 112 languages across all domains', () => {
    const covered = DOMAIN_CATEGORIES.flatMap(cat => getLangsByDomainCategory(cat))
    expect(covered.length).toBe(LANGUAGES.length)
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

Run: `npx vitest run src/lib/languages.test.ts`

Expected: FAIL — `DOMAIN_CATEGORIES` and `getLangsByDomainCategory` are not exported yet.

- [ ] **Step 3: Add exports to `languages.ts`**

Append after line 280 (after `getLangsByCategory`):

```ts
/** Ordered list of domain categories (canonical sidebar order) */
export const DOMAIN_CATEGORIES: DomainCategory[] = [
  'Systems',
  'Web',
  'Data & Science',
  'Functional',
  'Mobile & Desktop',
  'DevOps & Config',
  'Hardware',
  'Specialty',
]

/** Get all languages in a domain category */
export function getLangsByDomainCategory(cat: DomainCategory): LangDef[] {
  return LANGUAGES.filter(l => l.domainCategory === cat)
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/lib/languages.test.ts`

Expected: all 4 tests pass. If the coverage test fails, a language entry is missing `domainCategory` — check for any remaining entries without the field.

- [ ] **Step 5: Commit**

```bash
git add src/lib/languages.ts src/lib/languages.test.ts
git commit -m "feat(languages): add DOMAIN_CATEGORIES and getLangsByDomainCategory"
```

---

## Task 4: Toggle UI in `FilterPanel`

**Files:**
- Modify: `src/components/DiscoverSidebar.tsx`
- Modify: `src/components/DiscoverSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Update the existing import on line 4 of `src/components/DiscoverSidebar.test.tsx` to also pull in `FilterPanel`:

```ts
import DiscoverSidebar, { FilterPanel } from './DiscoverSidebar'
```

Then add this test block after the existing `describe` blocks:

```ts
const filterPanelProps = {
  selectedLanguages: [],
  onSelectedLanguagesChange: () => {},
  selectedSubtypes: [],
  onSelectedSubtypesChange: () => {},
}

describe('FilterPanel — grouping toggle', () => {
  beforeEach(() => localStorage.clear())

  it('renders Domain and Ecosystem buttons', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Domain' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ecosystem' })).toBeInTheDocument()
  })

  it('defaults to Domain mode', () => {
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Domain' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Ecosystem' })).not.toHaveClass('active')
  })

  it('switches to Ecosystem mode on click', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: 'Ecosystem' }))
    expect(screen.getByRole('button', { name: 'Ecosystem' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Domain' })).not.toHaveClass('active')
  })

  it('persists mode to localStorage', async () => {
    const user = userEvent.setup()
    render(<FilterPanel {...filterPanelProps} />)
    await user.click(screen.getByRole('button', { name: 'Ecosystem' }))
    expect(JSON.parse(localStorage.getItem('discover:languageGrouping')!)).toBe('ecosystem')
  })

  it('reads mode from localStorage on mount', () => {
    localStorage.setItem('discover:languageGrouping', JSON.stringify('ecosystem'))
    render(<FilterPanel {...filterPanelProps} />)
    expect(screen.getByRole('button', { name: 'Ecosystem' })).toHaveClass('active')
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

Run: `npx vitest run src/components/DiscoverSidebar.test.tsx`

Expected: the 5 new tests fail (FilterPanel has no toggle yet). Existing tests should still pass.

- [ ] **Step 3: Add 3 new icon imports to `DiscoverSidebar.tsx`**

On line 16 (the `react-icons/pi` import), add `PiGlobeFill`, `PiDevicesFill`, `PiStarFill`:

```ts
import {
  PiCpuFill, PiAppleLogoFill, PiCircleHalfFill, PiGridFourFill,
  PiFunctionFill, PiBroadcastFill,
  PiBracketsCurlyFill, PiScrollFill, PiTerminalWindowFill, PiChartBarFill,
  PiAtomFill, PiFileCodeFill, PiPaletteFill, PiBookOpenFill,
  PiDatabaseFill, PiWrenchFill, PiLinkSimpleFill, PiCircuitryFill,
  PiGameControllerFill, PiBuildingsFill, PiPenNibFill, PiMonitorFill,
  PiBrainFill, PiGraduationCapFill, PiDesktopTowerFill, PiHardDrivesFill,
  PiStackFill,
  PiGlobeFill, PiDevicesFill, PiStarFill,
} from 'react-icons/pi'
```

- [ ] **Step 4: Update the languages import on line 20 to include new exports**

```ts
import { LANG_CATEGORIES, getLangsByCategory, DOMAIN_CATEGORIES, getLangsByDomainCategory, LANG_MAP, getLangColor } from '../lib/languages'
```

Also add `GroupingMode` to the type import on line 115:

```ts
import type { LangCategory, DomainCategory, GroupingMode } from '../lib/languages'
```

- [ ] **Step 5: Add `DOMAIN_CAT_ICONS` after `LANG_CAT_ICONS` (after line 124)**

```ts
const DOMAIN_CAT_ICONS: Record<DomainCategory, IconType> = {
  'Systems':          PiCpuFill,
  'Web':              PiGlobeFill,
  'Data & Science':   PiChartBarFill,
  'Functional':       PiFunctionFill,
  'Mobile & Desktop': PiDevicesFill,
  'DevOps & Config':  PiTerminalWindowFill,
  'Hardware':         PiCircuitryFill,
  'Specialty':        PiStarFill,
}
```

- [ ] **Step 6: Add `groupingMode` state to `FilterPanel`**

Inside `FilterPanel` (after line 179, below the `activeTab` state), add:

```ts
const [groupingMode, setGroupingMode] = useLocalStorage<GroupingMode>('discover:languageGrouping', 'domain')
```

Also add the import at the top of `DiscoverSidebar.tsx` — `useLocalStorage` is not currently imported there, so add:

```ts
import { useLocalStorage } from '../hooks/useLocalStorage'
```

- [ ] **Step 7: Add the toggle markup inside the language tab**

In `FilterPanel`'s JSX, find the language tab section (line ~273: `{activeTab === 'language' && (`). Insert the toggle div **inside** that block, **above** the `<div className="categories-grid categories-grid--lang">` line:

```tsx
{activeTab === 'language' && (
  <>
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
    <div className="categories-grid categories-grid--lang">
      {/* ... existing content unchanged ... */}
    </div>
  </>
)}
```

- [ ] **Step 8: Branch the category iteration on `groupingMode`**

The current file has this structure inside the language tab (roughly lines 274–335):

```tsx
<div className="categories-grid categories-grid--lang">
  {/* Favourites section — lines 276–300, keep untouched */}
  {favLangs.size > 0 && !searchQuery && ( ... )}

  {LANG_CATEGORIES.map(cat => { ... })}  {/* ← replace only this */}
</div>
```

Replace **only** the `{LANG_CATEGORIES.map(cat => {` block (lines 301–334) with the branched ternary below. The outer `<div className="categories-grid">` container and the Favourites block above it stay unchanged.

```tsx
{groupingMode === 'domain'
  ? DOMAIN_CATEGORIES.map(cat => {
      const langs = getLangsByDomainCategory(cat)
        .filter(def => !searchQuery || def.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .filter(def => !itemCounts || (itemCounts.byLanguage.get(def.key) ?? 0) > 0)
      if (!langs.length) return null
      const CatIcon = DOMAIN_CAT_ICONS[cat]
      return (
        <div key={cat} className="bucket-group">
          <div className="bucket-label"><CatIcon size={11} /> {cat}</div>
          {langs.map(def => {
            const selected = draftLanguages.includes(def.key)
            const isFav = favLangs.has(def.key)
            const langCount = itemCounts?.byLanguage.get(def.key)
            return (
              <button
                key={def.key}
                className={`subtype-row${selected ? ' selected' : ''}`}
                style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
                onClick={() => toggleLanguage(def.key)}
              >
                <span className={`subtype-star${isFav ? ' starred' : ''}`} onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}>
                  <Star size={10} />
                </span>
                <LanguageIcon lang={def.key} size={16} boxed />
                <span className="subtype-label">
                  {def.name}{langCount != null && ` (${langCount})`}
                </span>
              </button>
            )
          })}
        </div>
      )
    })
  : LANG_CATEGORIES.map(cat => {
      const langs = getLangsByCategory(cat)
        .filter(def => !searchQuery || def.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .filter(def => !itemCounts || (itemCounts.byLanguage.get(def.key) ?? 0) > 0)
      if (!langs.length) return null
      const CatIcon = LANG_CAT_ICONS[cat]
      return (
        <div key={cat} className="bucket-group">
          <div className="bucket-label"><CatIcon size={11} /> {cat}</div>
          {langs.map(def => {
            const selected = draftLanguages.includes(def.key)
            const isFav = favLangs.has(def.key)
            const langCount = itemCounts?.byLanguage.get(def.key)
            return (
              <button
                key={def.key}
                className={`subtype-row${selected ? ' selected' : ''}`}
                style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
                onClick={() => toggleLanguage(def.key)}
              >
                <span className={`subtype-star${isFav ? ' starred' : ''}`} onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}>
                  <Star size={10} />
                </span>
                <LanguageIcon lang={def.key} size={16} boxed />
                <span className="subtype-label">
                  {def.name}{langCount != null && ` (${langCount})`}
                </span>
              </button>
            )
          })}
        </div>
      )
    })
}
```

- [ ] **Step 9: Run all tests — expect pass**

Run: `npx vitest run src/components/DiscoverSidebar.test.tsx`

Expected: all tests pass including the 5 new toggle tests. If TypeScript errors appear, run `npx tsc --noEmit` to diagnose.

- [ ] **Step 10: Commit**

```bash
git add src/components/DiscoverSidebar.tsx src/components/DiscoverSidebar.test.tsx
git commit -m "feat(sidebar): add domain/ecosystem grouping toggle to FilterPanel"
```

---

## Task 5: CSS for grouping toggle

**Files:**
- Modify: `src/components/DiscoverSidebar.css`

- [ ] **Step 1: Add styles at the end of `DiscoverSidebar.css`**

```css
/* ── Language grouping toggle ──────────────────────────── */

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

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/DiscoverSidebar.css
git commit -m "feat(sidebar): style domain/ecosystem grouping toggle"
```
