// src/utils/propsGenerator.ts
import type { ParsedProp } from './componentParser'

const OMIT = Symbol('omit')

function inferValue(type: string): unknown {
  const t = type.trim()

  if (t === 'string')   return 'Text'
  if (t === 'number')   return 0
  if (t === 'boolean')  return false
  if (t === 'string[]') return []
  if (t === 'number[]') return []

  // Render/node types → omit
  if (/React\.ReactNode|ReactNode|VNode|Snippet|ReactElement|JSX\.Element/.test(t)) return OMIT

  // Function types → omit
  if (t.startsWith('(') || /=>\s*\S/.test(t)) return OMIT

  // Union of string literals: 'sm' | 'md' | 'lg'
  const unionMatch = t.match(/^'([^']+)'/)
  if (unionMatch) return unionMatch[1]

  // Unknown / complex → omit
  return OMIT
}

export function generateProps(props: ParsedProp[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of props) {
    // Prefer a literal default we extracted from the function destructure —
    // it reflects what the library author actually intended. Fall back to
    // type-inference only when no default is available.
    if (prop.extractedDefault !== undefined) {
      result[prop.name] = prop.extractedDefault
      continue
    }
    const value = inferValue(prop.type)
    if (value !== OMIT) result[prop.name] = value
  }
  return result
}
