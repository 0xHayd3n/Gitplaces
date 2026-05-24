// Pattern: {{ identifier }} where identifier is [A-Za-z_][A-Za-z0-9_]*
// Used by both the renderer (variable grid) and the main process / MCP launcher
// (substitution before producing payloads or resources).
const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function detectVariables(body: string): string[] {
  if (body.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  // RegExp objects with the /g flag retain lastIndex across calls; create a
  // fresh regex per invocation to keep the function pure.
  const re = new RegExp(VARIABLE_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

export function substituteVariables(body: string, values: Record<string, string>): string {
  if (body.length === 0) return body
  return body.replace(new RegExp(VARIABLE_RE.source, 'g'), (raw, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : raw
  })
}
