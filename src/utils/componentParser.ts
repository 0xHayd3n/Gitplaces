// src/utils/componentParser.ts
import type { Framework } from '../types/components'

export interface ParsedProp {
  name: string
  type: string
  required: boolean
  defaultValue?: string
  stringUnion?: string[]
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
  const name = filename.replace(/\.[^.]+$/, '')
  const renderable = true

  let props: ParsedProp[] = []
  try {
    if (framework === 'react' || framework === 'solid') props = parseReactProps(source)
    else if (framework === 'vue')                        props = parseVueProps(source)
    else if (framework === 'svelte')                     props = parseSvelteProps(source)
  } catch { /* leave props empty on parse error */ }

  return { path, name, props, framework, renderable }
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
