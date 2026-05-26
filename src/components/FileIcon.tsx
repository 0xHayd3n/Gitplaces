import type { ComponentType } from 'react'
import {
  SiJavascript, SiTypescript, SiPython, SiRust, SiGo, SiRuby, SiPhp,
  SiKotlin, SiSwift, SiC, SiCplusplus, SiCss, SiHtml5,
  SiVuedotjs, SiSvelte, SiLua, SiZig, SiElixir, SiHaskell, SiDart,
  SiGnubash, SiDocker, SiR, SiScala, SiClojure, SiErlang, SiJulia,
  SiOcaml, SiSolidity, SiCoffeescript, SiElm,
  SiGit, SiNodedotjs, SiNpm, SiEslint, SiPrettier, SiStylelint,
  SiVite, SiWebpack, SiRollupdotjs, SiBabel, SiJest, SiVitest,
  SiYarn, SiPnpm, SiTravisci, SiCircleci, SiGithubactions,
  SiVercel, SiNetlify,
} from 'react-icons/si'
import {
  File, Scale, Settings, Lock, Braces, FileCode, Code, BookOpen,
  Database, GitBranch, Image, Play, Music, Archive, FileDiff,
  FileText, Table, Coffee,
} from 'lucide-react'

type IconDef = {
  icon: ComponentType<{ size?: number | string; color?: string }>
  color: string
}

// ── Exact filename matches (case-sensitive) ──────────────────────────
const FILENAME_ICONS: Record<string, IconDef> = {
  // Docker
  'Dockerfile':           { icon: SiDocker,     color: '#0ea5e9' },
  '.dockerignore':        { icon: SiDocker,     color: '#0ea5e9' },
  // Git
  '.gitignore':           { icon: SiGit,        color: '#f97316' },
  '.gitattributes':       { icon: SiGit,        color: '#f97316' },
  '.gitmodules':          { icon: SiGit,        color: '#f97316' },
  '.gitkeep':             { icon: SiGit,        color: '#f97316' },
  // License / build
  'LICENSE':              { icon: Scale,        color: '#9ca3af' },
  'LICENSE.md':           { icon: Scale,        color: '#9ca3af' },
  'LICENSE.txt':          { icon: Scale,        color: '#9ca3af' },
  'COPYING':              { icon: Scale,        color: '#9ca3af' },
  'Makefile':             { icon: Settings,     color: '#9ca3af' },
  'CMakeLists.txt':       { icon: Settings,     color: '#9ca3af' },
  // Secrets
  '.env':                 { icon: Lock,         color: '#f59e0b' },
  '.env.local':           { icon: Lock,         color: '#f59e0b' },
  '.env.example':         { icon: Lock,         color: '#f59e0b' },
  '.env.development':     { icon: Lock,         color: '#f59e0b' },
  '.env.production':      { icon: Lock,         color: '#f59e0b' },
  // Editor / formatter
  '.editorconfig':        { icon: Settings,     color: '#9ca3af' },
  // Node / npm / pnpm / yarn
  'package.json':         { icon: SiNodedotjs,  color: '#16a34a' },
  'package-lock.json':    { icon: SiNodedotjs,  color: '#16a34a' },
  '.nvmrc':               { icon: SiNodedotjs,  color: '#16a34a' },
  '.node-version':        { icon: SiNodedotjs,  color: '#16a34a' },
  '.npmrc':               { icon: SiNpm,        color: '#cb3837' },
  '.npmignore':           { icon: SiNpm,        color: '#cb3837' },
  'yarn.lock':            { icon: SiYarn,       color: '#2c8ebb' },
  '.yarnrc':              { icon: SiYarn,       color: '#2c8ebb' },
  '.yarnrc.yml':          { icon: SiYarn,       color: '#2c8ebb' },
  'pnpm-lock.yaml':       { icon: SiPnpm,       color: '#f69220' },
  'pnpm-workspace.yaml':  { icon: SiPnpm,       color: '#f69220' },
  // TypeScript
  'tsconfig.json':        { icon: SiTypescript, color: '#3178c6' },
  // ESLint
  '.eslintrc':            { icon: SiEslint,     color: '#4b32c3' },
  '.eslintrc.json':       { icon: SiEslint,     color: '#4b32c3' },
  '.eslintrc.js':         { icon: SiEslint,     color: '#4b32c3' },
  '.eslintrc.cjs':        { icon: SiEslint,     color: '#4b32c3' },
  '.eslintrc.yaml':       { icon: SiEslint,     color: '#4b32c3' },
  '.eslintrc.yml':        { icon: SiEslint,     color: '#4b32c3' },
  '.eslintignore':        { icon: SiEslint,     color: '#4b32c3' },
  'eslint.config.js':     { icon: SiEslint,     color: '#4b32c3' },
  'eslint.config.mjs':    { icon: SiEslint,     color: '#4b32c3' },
  // Prettier
  '.prettierrc':          { icon: SiPrettier,   color: '#f7b93e' },
  '.prettierrc.json':     { icon: SiPrettier,   color: '#f7b93e' },
  '.prettierrc.js':       { icon: SiPrettier,   color: '#f7b93e' },
  '.prettierrc.yaml':     { icon: SiPrettier,   color: '#f7b93e' },
  '.prettierrc.yml':      { icon: SiPrettier,   color: '#f7b93e' },
  '.prettierignore':      { icon: SiPrettier,   color: '#f7b93e' },
  'prettier.config.js':   { icon: SiPrettier,   color: '#f7b93e' },
  // Stylelint
  '.stylelintrc':         { icon: SiStylelint,  color: '#4b32c3' },
  '.stylelintrc.json':    { icon: SiStylelint,  color: '#4b32c3' },
  '.stylelintrc.js':      { icon: SiStylelint,  color: '#4b32c3' },
  '.stylelintignore':     { icon: SiStylelint,  color: '#4b32c3' },
  'stylelint.config.js':  { icon: SiStylelint,  color: '#4b32c3' },
  // Bundlers / builders
  'vite.config.ts':       { icon: SiVite,       color: '#646cff' },
  'vite.config.js':       { icon: SiVite,       color: '#646cff' },
  'vite.config.mjs':      { icon: SiVite,       color: '#646cff' },
  'webpack.config.js':    { icon: SiWebpack,    color: '#8dd6f9' },
  'webpack.config.ts':    { icon: SiWebpack,    color: '#8dd6f9' },
  'rollup.config.js':     { icon: SiRollupdotjs, color: '#ec4a3f' },
  'rollup.config.ts':     { icon: SiRollupdotjs, color: '#ec4a3f' },
  // Babel
  '.babelrc':             { icon: SiBabel,      color: '#f5da55' },
  '.babelrc.json':        { icon: SiBabel,      color: '#f5da55' },
  '.babelrc.js':          { icon: SiBabel,      color: '#f5da55' },
  'babel.config.js':      { icon: SiBabel,      color: '#f5da55' },
  'babel.config.json':    { icon: SiBabel,      color: '#f5da55' },
  'babel.config.cjs':     { icon: SiBabel,      color: '#f5da55' },
  // Jest / Vitest
  'jest.config.ts':       { icon: SiJest,       color: '#c21325' },
  'jest.config.js':       { icon: SiJest,       color: '#c21325' },
  'jest.config.json':     { icon: SiJest,       color: '#c21325' },
  'vitest.config.ts':     { icon: SiVitest,     color: '#6e9f18' },
  'vitest.config.js':     { icon: SiVitest,     color: '#6e9f18' },
  // CI / deploy
  '.travis.yml':          { icon: SiTravisci,   color: '#a3a3a3' },
  '.circleci':            { icon: SiCircleci,   color: '#a3a3a3' },
  'vercel.json':          { icon: SiVercel,     color: '#ffffff' },
  'netlify.toml':         { icon: SiNetlify,    color: '#00c7b7' },
  // commit / changelog
  'commitlint.config.js': { icon: SiGit,        color: '#f97316' },
  'commitlint.config.ts': { icon: SiGit,        color: '#f97316' },
  '.commitlintrc':        { icon: SiGit,        color: '#f97316' },
  '.commitlintrc.json':   { icon: SiGit,        color: '#f97316' },
  'CHANGELOG.md':         { icon: BookOpen,     color: '#3b82f6' },
  'README.md':            { icon: BookOpen,     color: '#3b82f6' },
  'README':               { icon: BookOpen,     color: '#3b82f6' },
}

// ── Filename PREFIX matches (e.g. tsconfig.*.json) ──────────────────
const FILENAME_PREFIX_ICONS: { prefix: string; def: IconDef }[] = [
  { prefix: 'tsconfig.', def: { icon: SiTypescript, color: '#3178c6' } },
]

// ── Extension matches (keys are lowercase, no dot) ───────────────────
const EXTENSION_ICONS: Record<string, IconDef> = {
  // JavaScript / TypeScript
  js:   { icon: SiJavascript, color: '#ca8a04' },
  mjs:  { icon: SiJavascript, color: '#ca8a04' },
  cjs:  { icon: SiJavascript, color: '#ca8a04' },
  jsx:  { icon: SiJavascript, color: '#ca8a04' },
  ts:   { icon: SiTypescript,  color: '#3178c6' },
  mts:  { icon: SiTypescript,  color: '#3178c6' },
  cts:  { icon: SiTypescript,  color: '#3178c6' },
  tsx:  { icon: SiTypescript,  color: '#3178c6' },
  // Python
  py:   { icon: SiPython,     color: '#2563eb' },
  pyw:  { icon: SiPython,     color: '#2563eb' },
  // Systems
  rs:   { icon: SiRust,       color: '#b45309' },
  go:   { icon: SiGo,         color: '#16a34a' },
  c:    { icon: SiC,          color: '#2563eb' },
  h:    { icon: SiC,          color: '#2563eb' },
  cpp:  { icon: SiCplusplus,  color: '#7c3aed' },
  hpp:  { icon: SiCplusplus,  color: '#7c3aed' },
  cc:   { icon: SiCplusplus,  color: '#7c3aed' },
  cxx:  { icon: SiCplusplus,  color: '#7c3aed' },
  // JVM
  java: { icon: Coffee,       color: '#dc2626' },
  kt:   { icon: SiKotlin,     color: '#7c3aed' },
  kts:  { icon: SiKotlin,     color: '#7c3aed' },
  scala:{ icon: SiScala,      color: '#dc2626' },
  // Mobile
  swift:{ icon: SiSwift,      color: '#f97316' },
  dart: { icon: SiDart,       color: '#0ea5e9' },
  // Web
  rb:   { icon: SiRuby,       color: '#dc2626' },
  php:  { icon: SiPhp,        color: '#6d28d9' },
  css:  { icon: SiCss,        color: '#3b82f6' },
  scss: { icon: SiCss,        color: '#3b82f6' },
  sass: { icon: SiCss,        color: '#3b82f6' },
  less: { icon: SiCss,        color: '#3b82f6' },
  html: { icon: SiHtml5,      color: '#f97316' },
  htm:  { icon: SiHtml5,      color: '#f97316' },
  vue:  { icon: SiVuedotjs,   color: '#16a34a' },
  svelte:{ icon: SiSvelte,    color: '#f97316' },
  // Functional
  hs:   { icon: SiHaskell,    color: '#5b21b6' },
  ex:   { icon: SiElixir,     color: '#7c3aed' },
  exs:  { icon: SiElixir,     color: '#7c3aed' },
  elm:  { icon: SiElm,        color: '#0ea5e9' },
  clj:  { icon: SiClojure,    color: '#16a34a' },
  cljs: { icon: SiClojure,    color: '#16a34a' },
  erl:  { icon: SiErlang,     color: '#dc2626' },
  ml:   { icon: SiOcaml,      color: '#f97316' },
  mli:  { icon: SiOcaml,      color: '#f97316' },
  jl:   { icon: SiJulia,      color: '#7c3aed' },
  // Other languages
  lua:  { icon: SiLua,        color: '#2563eb' },
  zig:  { icon: SiZig,        color: '#f59e0b' },
  r:    { icon: SiR,          color: '#2563eb' },
  sol:  { icon: SiSolidity,   color: '#6d28d9' },
  coffee:{ icon: SiCoffeescript, color: '#b45309' },
  // Shell
  sh:   { icon: SiGnubash,    color: '#16a34a' },
  bash: { icon: SiGnubash,    color: '#16a34a' },
  zsh:  { icon: SiGnubash,    color: '#16a34a' },
  dockerfile: { icon: SiDocker, color: '#0ea5e9' },
  // Data / Config
  json: { icon: Braces,       color: '#ca8a04' },
  jsonc:{ icon: Braces,       color: '#ca8a04' },
  yaml: { icon: FileCode,     color: '#e879f9' },
  yml:  { icon: FileCode,     color: '#e879f9' },
  toml: { icon: FileCode,     color: '#9ca3af' },
  xml:  { icon: Code,         color: '#f97316' },
  svg:  { icon: Code,         color: '#f97316' },
  sql:  { icon: Database,     color: '#3b82f6' },
  graphql: { icon: GitBranch, color: '#e535ab' },
  gql:  { icon: GitBranch,    color: '#e535ab' },
  csv:  { icon: Table,        color: '#16a34a' },
  tsv:  { icon: Table,        color: '#16a34a' },
  // Docs
  md:   { icon: FileText,     color: '#3b82f6' },
  mdx:  { icon: FileText,     color: '#3b82f6' },
  markdown: { icon: FileText,  color: '#3b82f6' },
  txt:  { icon: FileText,     color: '#9ca3af' },
  text: { icon: FileText,     color: '#9ca3af' },
  log:  { icon: FileText,     color: '#9ca3af' },
  pdf:  { icon: FileText,     color: '#dc2626' },
  // Media
  png:  { icon: Image,        color: '#16a34a' },
  jpg:  { icon: Image,        color: '#16a34a' },
  jpeg: { icon: Image,        color: '#16a34a' },
  gif:  { icon: Image,        color: '#16a34a' },
  webp: { icon: Image,        color: '#16a34a' },
  ico:  { icon: Image,        color: '#16a34a' },
  bmp:  { icon: Image,        color: '#16a34a' },
  mp4:  { icon: Play,         color: '#f97316' },
  webm: { icon: Play,         color: '#f97316' },
  mov:  { icon: Play,         color: '#f97316' },
  ogg:  { icon: Play,         color: '#f97316' },
  mp3:  { icon: Music,        color: '#7c3aed' },
  wav:  { icon: Music,        color: '#7c3aed' },
  flac: { icon: Music,        color: '#7c3aed' },
  aac:  { icon: Music,        color: '#7c3aed' },
  // Archives
  zip:  { icon: Archive,      color: '#9ca3af' },
  tar:  { icon: Archive,      color: '#9ca3af' },
  gz:   { icon: Archive,      color: '#9ca3af' },
  rar:  { icon: Archive,      color: '#9ca3af' },
  '7z': { icon: Archive,      color: '#9ca3af' },
  // Misc
  lock: { icon: Lock,         color: '#9ca3af' },
  diff: { icon: FileDiff,     color: '#f59e0b' },
  patch:{ icon: FileDiff,     color: '#f59e0b' },
}

const FALLBACK: IconDef = { icon: File, color: '#6b6b80' }

function resolveIcon(filename: string): IconDef {
  // 1. Exact filename match (case-sensitive)
  const filenameMatch = FILENAME_ICONS[filename]
  if (filenameMatch) return filenameMatch

  // 2. Filename prefix match (e.g. tsconfig.build.json → TS icon)
  for (const { prefix, def } of FILENAME_PREFIX_ICONS) {
    if (filename.startsWith(prefix)) return def
  }

  // 3. Extension match (case-insensitive)
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx > 0) {
    const ext = filename.slice(dotIdx + 1).toLowerCase()
    const extMatch = EXTENSION_ICONS[ext]
    if (extMatch) return extMatch
  }

  // 4. Fallback
  return FALLBACK
}

interface FileIconProps {
  filename: string    // basename only, e.g. "index.ts"
  size?: number       // defaults to 14
  className?: string  // forwarded to wrapper span
}

export default function FileIcon({ filename, size = 14, className }: FileIconProps) {
  const { icon: Icon, color } = resolveIcon(filename)
  return (
    <span className={className} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <Icon size={size} color={color} />
    </span>
  )
}
