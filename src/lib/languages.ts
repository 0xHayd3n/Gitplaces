/**
 * Single source of truth for every language's icon, colour, and GitHub filter key.
 * Used across Discover chips, RepoCard language dot, and Library language labels.
 */

import { createElement, type ComponentType, type SVGProps } from 'react'
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
  SiMarkdown,
  SiGraphql,
  SiAssemblyscript,
  SiStylus,
  SiPug,
  SiXml,
} from 'react-icons/si'
import { BiSolidTerminal, BiLogoCss3 } from 'react-icons/bi'
import { DiJava, DiGroovy, DiDlang, DiDotnet, DiPhp, DiPerl, DiErlang, DiDart, DiProlog, DiMsqlServer } from 'react-icons/di'

// --- Iconify icons via unplugin-icons (offline-bundled, tree-shaken at build) ---
import IconObjC          from '~icons/vscode-icons/file-type-objectivec'
import IconObjCpp        from '~icons/vscode-icons/file-type-objectivecpp'
import IconAppleScript   from '~icons/vscode-icons/file-type-applescript'
import IconCeylon        from '~icons/logos/ceylon'
import IconXtend         from '~icons/logos/xtend'
import IconGosu          from '~icons/file-icons/gosu'
import IconIdris         from '~icons/file-icons/idris'
import IconLfe           from '~icons/file-icons/lfe'
import IconScheme        from '~icons/file-icons/scheme'
import IconHy            from '~icons/file-icons/hy'
import IconJanet         from '~icons/file-icons/janet'
import IconTcl           from '~icons/file-icons/tcl'
import IconRaku          from '~icons/vscode-icons/file-type-raku'
import IconHack          from '~icons/logos/hack'
import IconAwk           from '~icons/devicon/awk'
import IconPowershell    from '~icons/devicon/powershell'
import IconFish          from '~icons/simple-icons/fishshell'
import IconApl           from '~icons/devicon/apl'
import IconMatlab        from '~icons/devicon/matlab'
import IconSas           from '~icons/vscode-icons/file-type-sas'
import IconMojo          from '~icons/vscode-icons/file-type-mojo'
import IconWolfram       from '~icons/simple-icons/wolfram'
import IconStata         from '~icons/devicon/stata-wordmark'
import IconTla           from '~icons/file-icons/tla'
import IconLean          from '~icons/vscode-icons/file-type-lean'
import IconCoq           from '~icons/file-icons/coq'
import IconAgda          from '~icons/file-icons/agda'
import IconIsabelle      from '~icons/file-icons/isabelle'
import IconPostscript    from '~icons/file-icons/postscript'
import IconPlsql         from '~icons/vscode-icons/file-type-plsql'
import IconSparql        from '~icons/vscode-icons/file-type-sparql'
import IconBicep         from '~icons/vscode-icons/file-type-bicep'
import IconJsonnet       from '~icons/vscode-icons/file-type-jsonnet'
import IconJust          from '~icons/simple-icons/just'
import IconMeson         from '~icons/vscode-icons/file-type-meson'
import IconDhall         from '~icons/vscode-icons/file-type-dhall'
import IconVyper         from '~icons/devicon/vyper'
import IconGlsl          from '~icons/vscode-icons/file-type-glsl'
import IconHlsl          from '~icons/vscode-icons/file-type-hlsl'
import IconVhdl          from '~icons/file-icons/vhdl'
import IconVerilog       from '~icons/file-icons/verilog'
import IconSystemVerilog from '~icons/file-icons/systemverilog'
import IconOpencl        from '~icons/devicon/opencl'
import IconWgsl          from '~icons/vscode-icons/file-type-wgsl'
import IconAngelscript   from '~icons/file-icons/angelscript'
import IconSquirrel      from '~icons/vscode-icons/file-type-squirrel'
import IconInk           from '~icons/vscode-icons/file-type-ink'
import IconCobol         from '~icons/devicon/cobol'
import IconActionscript  from '~icons/vscode-icons/file-type-actionscript'
import IconXaml          from '~icons/vscode-icons/file-type-xaml'
import IconSlint         from '~icons/simple-icons/slint'
import IconHaml          from '~icons/logos/haml'
import IconLiquid        from '~icons/vscode-icons/file-type-liquid'

// --- Custom inline SVGs (official brand logos) for languages with no library coverage ---
import { IconRoc, IconPkl, IconMove, IconLigo } from './customIcons'

/** Adapter: wrap an Iconify-generated SVG component so it accepts the {size, color} contract. */
const iconify = (Comp: ComponentType<SVGProps<SVGSVGElement>>): ComponentType<{ size?: number; color?: string }> => {
  const Wrapped = ({ size = 16, color }: { size?: number; color?: string }) =>
    createElement(Comp, {
      width: size,
      height: size,
      style: color ? { color } : undefined,
    })
  Wrapped.displayName = (Comp as any).displayName || 'IconifyIcon'
  return Wrapped
}

export type EcosystemCategory =
  | 'Native'
  | 'JVM'
  | 'Apple'
  | '.NET'
  | 'JavaScript'
  | 'Web Frameworks'
  | 'Pure Functional'
  | 'BEAM'
  | 'Lisp'
  | 'Scripting'
  | 'Shell'
  | 'Data'
  | 'Logic Programming'
  | 'Markup'
  | 'Styling'
  | 'Typesetting'
  | 'Database'
  | 'Config'
  | 'Blockchain'
  | 'Shaders & HDL'
  | 'Game Scripting'
  | 'Enterprise'
  | 'Editor'
  | 'UI'

/** Backward-compat alias — all existing consumers (GridHeader, RepoCard, etc.) require zero changes */
export type LangCategory = EcosystemCategory

export interface LangDef {
  name: string
  /** GitHub language filter value (exact case, as GitHub expects) */
  key: string
  category: EcosystemCategory
  icon: ComponentType<{ size?: number; color?: string }> | null
  color: string
  scale?: number
  doubleLayer?: boolean
}

export const LANGUAGES: LangDef[] = [
  // --- Systems / Low-level ---
  { name: 'C',          key: 'c',           category: 'Native',         icon: SiC,             color: '#649bd3' },
  { name: 'C++',        key: 'c++',         category: 'Native',         icon: SiCplusplus,     color: '#649bd3' },
  { name: 'Rust',       key: 'rust',        category: 'Native',         icon: SiRust,          color: '#000000' },
  { name: 'Go',         key: 'go',          category: 'Native',         icon: SiGo,            color: '#02aed4', scale: 1.6 },
  { name: 'Zig',        key: 'zig',         category: 'Native',         icon: SiZig,           color: '#f6a615' },
  { name: 'D',          key: 'd',           category: 'Native',         icon: DiDlang,         color: '#b03931', scale: 1.6 },
  { name: 'Nim',        key: 'nim',         category: 'Native',         icon: SiNim,           color: '#1e212a' },
  { name: 'V',          key: 'v',           category: 'Native',         icon: SiV,             color: '#5d87bf' },
  { name: 'Crystal',    key: 'crystal',     category: 'Native',         icon: SiCrystal,       color: '#000000' },
  { name: 'Odin',       key: 'odin',        category: 'Native',         icon: SiOdin,          color: '#60AFFE' },
  { name: 'Carbon',     key: 'carbon',      category: 'Native',         icon: null,            color: '#222222' },
  { name: 'Assembly',   key: 'assembly',    category: 'Native',         icon: null,            color: '#6b7280' },
  { name: 'Ada',        key: 'ada',         category: 'Native',         icon: SiAda,           color: '#02f88c' },
  { name: 'Fortran',    key: 'fortran',     category: 'Native',         icon: SiFortran,       color: '#734f97' },
  { name: 'Pascal',     key: 'pascal',      category: 'Native',         icon: null,            color: '#E3F171' },
  // --- JVM ---
  { name: 'Java',       key: 'java',        category: 'JVM', icon: DiJava,          color: '#dc2626', scale: 1.6, doubleLayer: true },
  { name: 'Kotlin',     key: 'kotlin',      category: 'JVM', icon: SiKotlin,        color: '#7c3aed' },
  { name: 'Scala',      key: 'scala',       category: 'JVM',      icon: SiScala,         color: '#dc2626' },
  { name: 'Groovy',     key: 'groovy',      category: 'JVM', icon: DiGroovy,        color: '#4298b8', scale: 2.0 },
  { name: 'Clojure',    key: 'clojure',     category: 'JVM',      icon: SiClojure,       color: '#62b132' },
  { name: 'Ceylon',     key: 'ceylon',      category: 'JVM', icon: iconify(IconCeylon),       color: '#e39842' },
  { name: 'Xtend',      key: 'xtend',       category: 'JVM', icon: iconify(IconXtend),        color: '#2c6fad' },
  { name: 'Gosu',       key: 'gosu',        category: 'JVM', icon: iconify(IconGosu),         color: '#82937f' },
  // --- Apple ---
  { name: 'Swift',      key: 'swift',       category: 'Apple', icon: SiSwift,         color: '#ef503b' },
  { name: 'Objective-C',key: 'objective-c', category: 'Apple', icon: iconify(IconObjC),         color: '#438eff' },
  { name: 'Objective-C++',key:'objective-c++', category: 'Apple', icon: iconify(IconObjCpp),    color: '#6866fb' },
  { name: 'AppleScript',key:'applescript', category: 'Apple', icon: iconify(IconAppleScript),   color: '#101f1f' },
  // --- .NET ---
  { name: 'C#',         key: 'c#',          category: '.NET', icon: SiSharp,         color: '#6d28d9' },
  { name: 'F#',         key: 'f#',          category: '.NET',      icon: SiFsharp,        color: '#378bba' },
  { name: 'VB.NET',     key: 'visual basic .net', category: '.NET', icon: DiDotnet,        color: '#945db7' },
  // --- JavaScript / TypeScript ---
  { name: 'JavaScript', key: 'javascript',  category: 'JavaScript',             icon: SiJavascript,    color: '#fd7d00' },
  { name: 'TypeScript', key: 'typescript',  category: 'JavaScript',             icon: SiTypescript,    color: '#3178c6' },
  { name: 'CoffeeScript',key:'coffeescript',category: 'JavaScript',             icon: SiCoffeescript,  color: '#3e2622' },
  { name: 'ReScript',   key: 'rescript',    category: 'JavaScript',             icon: SiRescript,      color: '#ed5051' },
  { name: 'WebAssembly',key: 'webassembly', category: 'JavaScript',             icon: SiWebassembly,   color: '#04133b' },
  { name: 'AssemblyScript',key:'assemblyscript', category: 'JavaScript',         icon: SiAssemblyscript, color: '#007acc' },
  // --- Web frameworks ---
  { name: 'Vue',        key: 'vue',         category: 'Web Frameworks',         icon: SiVuedotjs,      color: '#3fb883' },
  { name: 'Svelte',     key: 'svelte',      category: 'Web Frameworks',         icon: SiSvelte,        color: '#fb3c06' },
  { name: 'Astro',      key: 'astro',       category: 'Web Frameworks',         icon: SiAstro,         color: '#ff5a03' },
  { name: 'Pug',        key: 'pug',         category: 'Web Frameworks',         icon: SiPug,           color: '#a86454' },
  { name: 'Haml',       key: 'haml',        category: 'Web Frameworks',         icon: iconify(IconHaml),     color: '#ecb163' },
  { name: 'Liquid',     key: 'liquid',      category: 'Web Frameworks',         icon: iconify(IconLiquid),   color: '#7ab55c' },
  // --- Functional / ML ---
  { name: 'Haskell',    key: 'haskell',     category: 'Pure Functional',      icon: SiHaskell,       color: '#9c3c90' },
  { name: 'OCaml',      key: 'ocaml',       category: 'Pure Functional',      icon: SiOcaml,         color: '#c1501e' },
  { name: 'Elm',        key: 'elm',         category: 'Pure Functional',      icon: SiElm,           color: '#0ea5e9' },
  { name: 'PureScript', key: 'purescript',  category: 'Pure Functional',      icon: SiPurescript,    color: '#1D222D' },
  { name: 'Standard ML',key: 'standard ml', category: 'Pure Functional',      icon: null,            color: '#dc566d' },
  { name: 'Roc',        key: 'roc',         category: 'Pure Functional',      icon: IconRoc,         color: '#7c38f5' },
  { name: 'Idris',      key: 'idris',       category: 'Pure Functional',      icon: iconify(IconIdris),    color: '#b30000' },
  // --- BEAM ecosystem ---
  { name: 'Elixir',     key: 'elixir',      category: 'BEAM',      icon: SiElixir,        color: '#4a3560' },
  { name: 'Erlang',     key: 'erlang',      category: 'BEAM',      icon: DiErlang,        color: '#ab0130', scale: 1.6 },
  { name: 'Gleam',      key: 'gleam',       category: 'BEAM',      icon: SiGleam,         color: '#ffaff3' },
  { name: 'LFE',        key: 'lfe',         category: 'BEAM',      icon: iconify(IconLfe),      color: '#4d4d4d' },
  // --- Lisp family ---
  { name: 'Common Lisp',key: 'common lisp', category: 'Lisp',      icon: SiCommonlisp,    color: '#3fb68b' },
  { name: 'Emacs Lisp', key: 'emacs lisp',  category: 'Lisp',      icon: SiGnuemacs,      color: '#c065db' },
  { name: 'Scheme',     key: 'scheme',      category: 'Lisp',      icon: iconify(IconScheme),   color: '#1e4aec' },
  { name: 'Racket',     key: 'racket',      category: 'Lisp',      icon: SiRacket,        color: '#3c5caa' },
  { name: 'Fennel',     key: 'fennel',      category: 'Lisp',      icon: null,            color: '#8ec07c' },
  { name: 'Hy',         key: 'hy',          category: 'Lisp',      icon: iconify(IconHy),       color: '#7790d4' },
  { name: 'Janet',      key: 'janet',       category: 'Lisp',      icon: iconify(IconJanet),    color: '#cba135' },
  // --- Scripting ---
  { name: 'Python',     key: 'python',      category: 'Scripting',  icon: SiPython,        color: '#367ab3' },
  { name: 'Ruby',       key: 'ruby',        category: 'Scripting',             icon: SiRuby,          color: '#dc2626' },
  { name: 'PHP',        key: 'php',         category: 'Scripting',             icon: DiPhp,           color: '#4f5c93', scale: 1.6 },
  { name: 'Perl',       key: 'perl',        category: 'Scripting',       icon: DiPerl,          color: '#0073a0', scale: 1.6 },
  { name: 'Lua',        key: 'lua',         category: 'Scripting',            icon: SiLua,           color: '#010080' },
  { name: 'Luau',       key: 'luau',        category: 'Scripting',            icon: SiLuau,          color: '#00A2FF' },
  { name: 'Dart',       key: 'dart',        category: 'Scripting', icon: DiDart,          color: '#0c6291', scale: 1.6 },
  { name: 'Tcl',        key: 'tcl',         category: 'Scripting',       icon: iconify(IconTcl),      color: '#e4cc98' },
  { name: 'Raku',       key: 'raku',        category: 'Scripting',       icon: iconify(IconRaku),     color: '#0000fb' },
  { name: 'Hack',       key: 'hack',        category: 'Scripting',             icon: iconify(IconHack),     color: '#878787' },
  { name: 'Smalltalk',  key: 'smalltalk',   category: 'Scripting',       icon: null,            color: '#596706' },
  // --- Shell / Automation ---
  { name: 'AWK',        key: 'awk',         category: 'Shell', icon: iconify(IconAwk),        color: '#c30e59' },
  { name: 'Shell',      key: 'shell',       category: 'Shell', icon: BiSolidTerminal, color: '#16a34a' },
  { name: 'PowerShell', key: 'powershell',  category: 'Shell', icon: iconify(IconPowershell), color: '#146fbe' },
  { name: 'Batchfile',  key: 'batchfile',   category: 'Shell', icon: null,            color: '#C1F12E' },
  { name: 'Nushell',    key: 'nushell',     category: 'Shell', icon: SiNushell,       color: '#4E9906' },
  { name: 'AutoHotkey', key: 'autohotkey',  category: 'Shell', icon: SiAutohotkey,    color: '#6594b9' },
  { name: 'Fish',       key: 'fish',        category: 'Shell', icon: iconify(IconFish),       color: '#0d324f' },
  // --- Data / Scientific ---
  { name: 'APL',        key: 'apl',         category: 'Data',  icon: iconify(IconApl),        color: '#5a4fcf' },
  { name: 'R',          key: 'r',           category: 'Data',  icon: SiR,             color: '#2563eb' },
  { name: 'Julia',      key: 'julia',       category: 'Data',  icon: SiJulia,         color: '#7c3aed' },
  { name: 'MATLAB',     key: 'matlab',      category: 'Data',  icon: iconify(IconMatlab),     color: '#e16737' },
  { name: 'SAS',        key: 'sas',         category: 'Data',  icon: iconify(IconSas),        color: '#B34936' },
  { name: 'Jupyter Notebook', key: 'jupyter notebook', category: 'Data', icon: SiJupyter, color: '#DA5B0B' },
  { name: 'Mojo',       key: 'mojo',        category: 'Data',  icon: iconify(IconMojo),       color: '#ff4c1a' },
  { name: 'Wolfram',    key: 'wolfram',     category: 'Data',  icon: iconify(IconWolfram),    color: '#dd1100' },
  { name: 'Q',          key: 'q',           category: 'Data',  icon: null,            color: '#0040cd' },
  { name: 'Stata',      key: 'stata',       category: 'Data',  icon: iconify(IconStata),      color: '#1a5694', scale: 1.6 },
  // --- Logic / Proof ---
  { name: 'TLA+',       key: 'tla',         category: 'Logic Programming',       icon: iconify(IconTla),      color: '#9b59b6' },
  { name: 'Prolog',     key: 'prolog',      category: 'Logic Programming',       icon: DiProlog,        color: '#74283c', scale: 1.6 },
  { name: 'Lean',       key: 'lean',        category: 'Logic Programming',       icon: iconify(IconLean),     color: '#404040' },
  { name: 'Coq',        key: 'coq',         category: 'Logic Programming',       icon: iconify(IconCoq),      color: '#d0b68c' },
  { name: 'Agda',       key: 'agda',        category: 'Logic Programming',       icon: iconify(IconAgda),     color: '#315665' },
  { name: 'Isabelle',   key: 'isabelle',    category: 'Logic Programming',       icon: iconify(IconIsabelle), color: '#b31b1b' },
  // --- Markup / Templating ---
  { name: 'XML',        key: 'xml',         category: 'Markup', icon: SiXml,           color: '#0060ac' },
  { name: 'HTML',       key: 'html',        category: 'Markup', icon: SiHtml5,         color: '#e74b22' },
  { name: 'MDX',        key: 'mdx',         category: 'Markup', icon: SiMdx,           color: '#fcb32c' },
  { name: 'Blade',      key: 'blade',       category: 'Markup', icon: SiLaravel,       color: '#f7523f' },
  { name: 'EJS',        key: 'ejs',         category: 'Markup', icon: SiEjs,           color: '#a91e50' },
  { name: 'Handlebars', key: 'handlebars',  category: 'Markup', icon: SiHandlebarsdotjs, color: '#f7931e' },
  { name: 'Jinja',      key: 'jinja',       category: 'Markup', icon: SiJinja,         color: '#a52a22' },
  { name: 'Markdown',   key: 'markdown',    category: 'Markup', icon: SiMarkdown,      color: '#083fa1' },
  // --- Styling ---
  { name: 'CSS',        key: 'css',         category: 'Styling', icon: BiLogoCss3,      color: '#65309a', scale: 1.4 },
  { name: 'SCSS',       key: 'scss',        category: 'Styling', icon: SiSass,          color: '#c6538c' },
  { name: 'Sass',       key: 'sass',        category: 'Styling', icon: SiSass,          color: '#a53b70' },
  { name: 'Less',       key: 'less',        category: 'Styling', icon: SiLess,          color: '#1d365d' },
  { name: 'Stylus',     key: 'stylus',      category: 'Styling', icon: SiStylus,        color: '#14b789' },
  // --- Typesetting ---
  { name: 'TeX',        key: 'tex',         category: 'Typesetting',      icon: SiLatex,         color: '#3D6117' },
  { name: 'Typst',      key: 'typst',       category: 'Typesetting',      icon: SiTypst,         color: '#239DAD' },
  { name: 'Groff',      key: 'groff',       category: 'Typesetting',      icon: null,            color: '#9e9e9e' },
  { name: 'PostScript', key: 'postscript',  category: 'Typesetting',      icon: iconify(IconPostscript), color: '#da291c' },
  // --- Database / Query ---
  { name: 'TSQL',       key: 'tsql',        category: 'Database',  icon: DiMsqlServer,    color: '#e38c00', scale: 1.6 },
  { name: 'PLpgSQL',    key: 'plpgsql',     category: 'Database',  icon: SiPostgresql,    color: '#336790' },
  { name: 'GraphQL',    key: 'graphql',     category: 'Database',             icon: SiGraphql,       color: '#e10098' },
  { name: 'SQL',        key: 'sql',         category: 'Database',  icon: null,            color: '#f29111' },
  { name: 'PLSQL',      key: 'plsql',       category: 'Database',  icon: iconify(IconPlsql),    color: '#f80000' },
  { name: 'SPARQL',     key: 'sparql',      category: 'Database',  icon: iconify(IconSparql),   color: '#0c479d' },
  // --- Build / Config / IaC ---
  { name: 'Makefile',   key: 'makefile',    category: 'Config', icon: SiMake,          color: '#427819' },
  { name: 'CMake',      key: 'cmake',       category: 'Config', icon: SiCmake,         color: '#DA3434' },
  { name: 'Dockerfile', key: 'dockerfile',  category: 'Config', icon: SiDocker,        color: '#384d54' },
  { name: 'HCL',        key: 'hcl',         category: 'Config', icon: SiTerraform,     color: '#844FBA' },
  { name: 'Nix',        key: 'nix',         category: 'Config', icon: SiNixos,         color: '#3090f6' },
  { name: 'Starlark',   key: 'starlark',    category: 'Config', icon: null,            color: '#76d275' },
  { name: 'Bicep',      key: 'bicep',       category: 'Config',       icon: iconify(IconBicep),    color: '#519aba' },
  { name: 'Jsonnet',    key: 'jsonnet',     category: 'Config', icon: iconify(IconJsonnet),  color: '#0064bd' },
  { name: 'Just',       key: 'just',        category: 'Config', icon: iconify(IconJust),     color: '#384d54' },
  { name: 'Puppet',     key: 'puppet',      category: 'Config', icon: SiPuppet,        color: '#302B6D' },
  { name: 'Meson',      key: 'meson',       category: 'Config', icon: iconify(IconMeson),    color: '#1a6496' },
  { name: 'Pkl',        key: 'pkl',         category: 'Config', icon: IconPkl,         color: '#6b9543' },
  { name: 'CUE',        key: 'cue',         category: 'Config', icon: null,            color: '#5886e1' },
  { name: 'Dhall',      key: 'dhall',       category: 'Config', icon: iconify(IconDhall),    color: '#dfafff' },
  // --- Blockchain / Smart contracts ---
  { name: 'Solidity',   key: 'solidity',    category: 'Blockchain',       icon: SiSolidity,      color: '#2a247c' },
  { name: 'Vyper',      key: 'vyper',       category: 'Blockchain',       icon: iconify(IconVyper),    color: '#2980b9' },
  { name: 'Cairo',      key: 'cairo',       category: 'Blockchain',       icon: null,            color: '#ff4a48' },
  { name: 'Move',       key: 'move',        category: 'Blockchain',       icon: IconMove,        color: '#113BD9', scale: 1.6 },
  { name: 'Sway',       key: 'sway',        category: 'Blockchain',       icon: null,            color: '#00f58c' },
  { name: 'Clarity',    key: 'clarity',     category: 'Blockchain',       icon: null,            color: '#5546ff' },
  { name: 'Cadence',    key: 'cadence',     category: 'Blockchain',       icon: null,            color: '#00ef8b' },
  { name: 'FunC',       key: 'func',        category: 'Blockchain',       icon: null,            color: '#0098ea' },
  { name: 'Tact',       key: 'tact',        category: 'Blockchain',       icon: null,            color: '#00b8e9' },
  { name: 'LIGO',       key: 'cameligo',    category: 'Blockchain',       icon: IconLigo,        color: '#0e74ff' },
  { name: 'Noir',       key: 'noir',        category: 'Blockchain',       icon: null,            color: '#d4392f' },
  { name: 'Leo',        key: 'leo',         category: 'Blockchain',       icon: null,            color: '#00ce8b' },
  // --- Shader / GPU / Hardware ---
  { name: 'GLSL',       key: 'glsl',        category: 'Shaders & HDL',        icon: iconify(IconGlsl),     color: '#5686a5' },
  { name: 'HLSL',       key: 'hlsl',        category: 'Shaders & HDL',        icon: iconify(IconHlsl),     color: '#aace60' },
  { name: 'CUDA',       key: 'cuda',        category: 'Shaders & HDL',        icon: SiNvidia,        color: '#3A4E3A' },
  { name: 'VHDL',       key: 'vhdl',        category: 'Shaders & HDL',        icon: iconify(IconVhdl),     color: '#adb2cb' },
  { name: 'Verilog',    key: 'verilog',     category: 'Shaders & HDL',        icon: iconify(IconVerilog),  color: '#b2b7f8' },
  { name: 'SystemVerilog',key:'systemverilog', category: 'Shaders & HDL',       icon: iconify(IconSystemVerilog), color: '#DAE1C2' },
  { name: 'OpenCL',     key: 'opencl',      category: 'Shaders & HDL',     icon: iconify(IconOpencl),   color: '#ed1c24' },
  { name: 'WGSL',       key: 'wgsl',        category: 'Shaders & HDL',     icon: iconify(IconWgsl),     color: '#005a9c' },
  // --- Game development ---
  { name: 'GDScript',   key: 'gdscript',    category: 'Game Scripting',            icon: SiGodotengine,   color: '#355570' },
  { name: 'Haxe',       key: 'haxe',        category: 'Game Scripting',            icon: SiHaxe,          color: '#df7900' },
  { name: 'AngelScript',key: 'angelscript', category: 'Game Scripting',            icon: iconify(IconAngelscript), color: '#b9d9ff' },
  { name: 'GML',        key: 'game maker language', category: 'Game Scripting',    icon: null,            color: '#f7941d' },
  { name: 'Squirrel',   key: 'squirrel',    category: 'Game Scripting',            icon: iconify(IconSquirrel), color: '#8b4513' },
  { name: 'Ink',        key: 'ink',         category: 'Game Scripting',            icon: iconify(IconInk),      color: '#1a1a1a' },
  // --- Enterprise / Legacy ---
  { name: 'COBOL',      key: 'cobol',       category: 'Enterprise',       icon: iconify(IconCobol),    color: '#0070c0' },
  { name: 'ABAP',       key: 'abap',        category: 'Enterprise',       icon: SiSap,           color: '#E8274B' },
  { name: 'Apex',       key: 'apex',        category: 'Enterprise', icon: SiSalesforce,    color: '#1797c0' },
  { name: 'ActionScript',key:'actionscript', category: 'Enterprise',      icon: iconify(IconActionscript), color: '#882B0F' },
  // --- Editor scripting ---
  { name: 'Vim Script', key: 'vim script',  category: 'Editor',       icon: SiVim,           color: '#199f4b' },
  // --- UI frameworks ---
  { name: 'QML',        key: 'qml',         category: 'UI', icon: SiQt,            color: '#44a51c' },
  { name: 'XAML',       key: 'xaml',        category: 'UI', icon: iconify(IconXaml),     color: '#5b277d' },
  { name: 'Slint',      key: 'slint',       category: 'UI', icon: iconify(IconSlint),    color: '#2379f4' },
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


/** Curated set of broadly popular languages, surfaced via the "Popular" tile in FilterPanel. */
export const POPULAR_LANGUAGES: string[] = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'c++', 'c', 'c#', 'ruby', 'php',
  'swift', 'kotlin', 'html', 'css',
]

/** Get LangDef[] for the popular tile, in the order defined above. Silently skips missing keys. */
export function getPopularLangs(): LangDef[] {
  return POPULAR_LANGUAGES
    .map(key => LANG_MAP.get(key))
    .filter((l): l is LangDef => l != null)
}
