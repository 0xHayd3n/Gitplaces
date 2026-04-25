/**
 * Single source of truth for every language's icon, colour, and GitHub filter key.
 * Used across Discover chips, RepoCard language dot, and Library language labels.
 */

import type { ComponentType } from 'react'
import {
  SiJavascript,
  SiTypescript,
  SiPython,
  SiRust,
  SiGo,
  SiKotlin,
  SiSwift,
  SiC,
  SiCplusplus,
  SiSharp,     // used for C#
  SiRuby,
  SiScala,
  SiR,
  SiElixir,
  SiHaskell,
  SiLua,
  SiHtml5,
  SiVuedotjs,
  SiSvelte,
  SiNixos,
  SiZig,
  SiClojure,
  SiJulia,
  SiOcaml,
  SiSolidity,
  SiCoffeescript,
  SiElm,
  SiFortran,
  SiFsharp,
  SiNim,
  SiCrystal,
  SiV,
  SiJupyter,
  SiSass,
  SiDocker,
  SiMake,
  SiTerraform,
  SiGnuemacs,
  SiLatex,
  SiVim,
  SiNvidia,
  SiGleam,
  SiOdin,
  SiAda,
  SiCommonlisp,
  SiRacket,
  SiPurescript,
  SiAstro,
  SiLess,
  SiGodotengine,
  SiHaxe,
  SiNushell,
  SiWebassembly,
  SiTypst,
  SiLaravel,
  SiEjs,
  SiCmake,
  SiMdx,
  SiPostgresql,
  SiHandlebarsdotjs,
  SiJinja,
  SiSalesforce,
  SiQt,
  SiAutohotkey,
  SiPuppet,
  SiSap,
  SiLuau,
  SiRescript,
} from 'react-icons/si'
import { BiSolidTerminal, BiLogoCss3 } from 'react-icons/bi'
import { DiJava, DiGroovy, DiDlang, DiDotnet, DiPhp, DiPerl, DiErlang, DiDart, DiProlog, DiMsqlServer } from 'react-icons/di'

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
  /** GitHub language filter value (exact case, as GitHub expects) */
  key: string
  category: EcosystemCategory
  domainCategory: DomainCategory
  icon: ComponentType<{ size?: number; color?: string }> | null
  color: string
  scale?: number
  doubleLayer?: boolean
}

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

/** Lookup by key (lowercase). Returns undefined if not in library. */
export const LANG_MAP = new Map(LANGUAGES.map(l => [l.key.toLowerCase(), l]))

/** Fallback colour for unlisted languages */
export const FALLBACK_COLOR = '#6b6b80'

/** Get colour for a language string (case-insensitive) */
export function getLangColor(lang: string | null): string {
  if (!lang) return FALLBACK_COLOR
  return LANG_MAP.get(lang.toLowerCase())?.color ?? FALLBACK_COLOR
}

/** Ordered list of unique categories, preserving array order */
export const LANG_CATEGORIES: LangCategory[] = [...new Set(LANGUAGES.map(l => l.category))]

/** Get all languages in a category */
export function getLangsByCategory(cat: LangCategory): LangDef[] {
  return LANGUAGES.filter(l => l.category === cat)
}
