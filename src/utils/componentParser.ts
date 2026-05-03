// src/utils/componentParser.ts
import type { Framework } from '../types/components'

export interface ParsedProp {
  name: string
  type: string
  required: boolean
  defaultValue?: string
  stringUnion?: string[]
  // A literal default extracted from the function signature destructure
  // (e.g. `function Foo({ size = 15 })` → 15). Filled for React/Solid only;
  // Svelte has its own `defaultValue: string` shape.
  extractedDefault?: unknown
}

export interface ParsedComponent {
  path: string
  name: string
  props: ParsedProp[]
  framework: Framework
  renderable: boolean
}

export function parseComponent(
  path: string,
  source: string,
  framework: Framework,
): ParsedComponent {
  const filename = path.split('/').pop() ?? path
  const rawName = filename.replace(/\.[^.]+$/, '')
  const filenameBased = toPascalCase(rawName)
  // Prefer the actual exported identifier from the source over the filename.
  // Filenames can mismatch their exports — `color-picker.tsx` may export
  // `ColorPicker` (matches), but `Code.tsx` might export `InstallCode`, or
  // a class component named `CPicker` aliased through `export default`.
  // Reading the source removes that guesswork.
  const name = (framework === 'react' || framework === 'solid')
    ? extractExportName(source, filenameBased)
    : filenameBased
  const renderable = true

  let props: ParsedProp[] = []
  try {
    if (framework === 'react' || framework === 'solid') props = parseReactProps(source)
    else if (framework === 'vue')                        props = parseVueProps(source)
    else if (framework === 'svelte')                     props = parseSvelteProps(source)
  } catch { /* leave props empty on parse error */ }

  // Pull literal defaults from the function destructure (React/Solid only).
  // Many libraries import their props type from a sibling file we don't
  // scan, so `parseReactProps` returns []. The destructure is the only
  // remaining signal in those cases — and even when the props type IS
  // parseable, the destructure typically supplies better defaults than
  // our type-inference fallback (`'Text'`, 0, false).
  if (framework === 'react' || framework === 'solid') {
    const defaults = extractDestructureDefaults(source, name)
    for (const [propName, value] of Object.entries(defaults)) {
      const existing = props.find(p => p.name === propName)
      if (existing) {
        existing.extractedDefault = value
      } else {
        props.push({
          name: propName,
          type: typeof value === 'object' ? 'unknown' : typeof value,
          required: false,
          extractedDefault: value,
        })
      }
    }
  }

  return { path, name, props, framework, renderable }
}

// Convert filenames to a PascalCase identifier so the renderer's
// `createElement(<name>, props)` resolves to the actual exported symbol.
// `dialog` → `Dialog`, `alert-dialog` → `AlertDialog`, `Button` → `Button`.
function toPascalCase(s: string): string {
  return s
    .split(/[-_]/)
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

// Find the actual exported component identifier in a source file. Tries
// patterns in priority order; returns `fallback` (typically the PascalCase'd
// filename) when nothing parseable is found. Only PascalCase identifiers
// are accepted — lowercase exports are usually utilities, not components.
function extractExportName(source: string, fallback: string): string {
  // 1. `export default function ComponentName` / `export default class ComponentName`
  let m = source.match(/^export\s+default\s+(?:function|class)\s+([A-Z]\w*)/m)
  if (m) return m[1]

  // 2. `export default ComponentName` (separate declaration)
  m = source.match(/^export\s+default\s+([A-Z]\w*)\s*;?\s*$/m)
  if (m) return m[1]

  // 3. Single named PascalCase export (`export const Foo = ...`,
  //    `export function Foo`, `export class Foo`). When the file has
  //    exactly one such export, it's almost always the component.
  const namedExports: string[] = []
  const re = /^export\s+(?:const|function|class)\s+([A-Z]\w*)/gm
  let m2: RegExpExecArray | null
  while ((m2 = re.exec(source)) !== null) {
    namedExports.push(m2[1])
  }
  if (namedExports.length === 1) return namedExports[0]
  // If there are multiple named exports and one of them matches the
  // filename-derived name, prefer that one.
  if (namedExports.length > 1 && namedExports.includes(fallback)) return fallback

  return fallback
}

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

// Extract `{ key = value, key = value }` defaults from the component
// function's signature. Tries three patterns in order:
//   function Name({ ... }: Props)
//   const Name = ({ ... }: Props) => ...
//   const Name: TypeAnnotation = ({ ... }) => ...
// The destructure body is then split at top-level commas (skipping nested
// braces/brackets/parens) and each `key = expr` is parsed as a JS literal.
// Anything that isn't a literal we can recognize is dropped — it's better
// to omit a default than to guess wrong.
function extractDestructureDefaults(source: string, name: string): Record<string, unknown> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`function\\s+${escaped}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*(?::|\\))`),
    new RegExp(`const\\s+${escaped}\\s*(?::[^=]+)?\\s*=\\s*\\(?\\s*\\{([\\s\\S]*?)\\}\\s*(?::|\\)|=>)`),
  ]
  for (const re of patterns) {
    const m = source.match(re)
    if (!m) continue
    return parseDestructureBody(m[1])
  }
  return {}
}

function parseDestructureBody(body: string): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  // Strip block + line comments before splitting
  const clean = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  // Split on top-level commas — track nesting so we don't split inside
  // object/array/paren expressions.
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(clean.slice(start, i))
      start = i + 1
    }
  }
  parts.push(clean.slice(start))

  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    if (part.startsWith('...')) continue   // rest pattern, no default
    const m = part.match(/^(\w+)\s*=\s*([\s\S]+)$/)
    if (!m) continue
    const value = parseLiteralValue(m[2].trim())
    if (value !== undefined) defaults[m[1]] = value
  }
  return defaults
}

function parseLiteralValue(text: string): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  // Numbers (including negative + decimals)
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  // String literals (single, double, or backtick — backtick must be plain)
  const str = text.match(/^['"`]([^'"`]*)['"`]$/)
  if (str) return str[1]
  // Empty object/array
  if (/^\{\s*\}$/.test(text)) return {}
  if (/^\[\s*\]$/.test(text)) return []
  // Anything else — function calls, references, JSX, complex expressions —
  // we can't safely parse, so omit
  return undefined
}

function parseReactProps(source: string): ParsedProp[] {
  // interface *Props { ... }
  const iface = source.match(/interface\s+\w*Props\s*\{([^}]+)\}/s)
  if (iface) return parsePropBlock(iface[1])

  // type *Props = { ... }
  const alias = source.match(/type\s+\w*Props\s*=\s*\{([^}]+)\}/s)
  if (alias) return parsePropBlock(alias[1])

  return []
}

function parseVueProps(source: string): ParsedProp[] {
  // <script setup> with defineProps<{ ... }>
  const setup = source.match(/defineProps<\{([^}]+)\}>/s)
  if (setup) return parsePropBlock(setup[1])

  // Options API props object (basic support)
  const options = source.match(/props\s*:\s*\{([^}]+)\}/s)
  if (options) return parsePropBlock(options[1])

  return []
}

function parseSvelteProps(source: string): ParsedProp[] {
  const props: ParsedProp[] = []
  // export let propName: Type = default
  // export let propName = default  (no type annotation)
  // export let propName: Type
  const regex = /export\s+let\s+(\w+)(?::\s*([^=;\n]+?))?(?:\s*=\s*([^;\n]+))?\s*[;\n]/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(source)) !== null) {
    props.push({
      name:         m[1],
      type:         (m[2] ?? 'unknown').trim(),
      required:     m[3] === undefined,
      defaultValue: m[3]?.trim(),
    })
  }
  return props
}
