// src/utils/storyParser.ts
export interface StoryFile {
  title: string | null
  componentIdent: string                  // identifier referenced in default.component
  componentImportPath: string             // relative path the identifier was imported from
  stories: { name: string; args: Record<string, unknown> }[]
}

export function parseStoryFile(_path: string, source: string): StoryFile | null {
  const defaultMatch = source.match(/export\s+default\s+\{([\s\S]*?)\}\s*(?:as\s+\w+)?\s*;?/)
  if (!defaultMatch) return null
  const defaultBody = defaultMatch[1]

  const titleMatch = defaultBody.match(/title\s*:\s*['"]([^'"]+)['"]/)
  const componentMatch = defaultBody.match(/component\s*:\s*(\w+)/)
  if (!componentMatch) return null
  const componentIdent = componentMatch[1]

  const importPath = findImportPath(source, componentIdent)
  if (!importPath) return null

  const stories: { name: string; args: Record<string, unknown> }[] = []
  const namedRe = /export\s+const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(\{[\s\S]*?\}\s*\})/g
  let m: RegExpExecArray | null
  while ((m = namedRe.exec(source)) !== null) {
    const name = m[1]
    const storyBlock = m[2]
    const argsBody = extractArgsBody(storyBlock)
    if (argsBody === null) continue
    const args = parseArgsBody(argsBody)
    if (args === null) continue
    stories.push({ name, args })
  }

  return {
    title: titleMatch?.[1] ?? null,
    componentIdent,
    componentImportPath: importPath,
    stories,
  }
}

function findImportPath(source: string, ident: string): string | null {
  const named = new RegExp(`import\\s+\\{[^}]*\\b${ident}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`)
  const m1 = source.match(named)
  if (m1) return m1[1]
  const def = new RegExp(`import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`)
  const m2 = source.match(def)
  if (m2) return m2[1]
  return null
}

function extractArgsBody(storyBlock: string): string | null {
  // Match args: { ... } — inner brace content
  const m = storyBlock.match(/args\s*:\s*\{([\s\S]*?)\}/)
  return m ? m[1] : null
}

function parseArgsBody(body: string): Record<string, unknown> | null {
  if (/=>|\bfunction\b|<[A-Z]/.test(body)) return null
  let normalized = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'/g, '"')
    .replace(/(\b\w+)\s*:/g, '"$1":')
    .replace(/,(\s*[}\]])/g, '$1')
  normalized = `{${normalized}}`
  try {
    return JSON.parse(normalized) as Record<string, unknown>
  } catch {
    return null
  }
}

export function resolveStoryComponent(
  storyPath: string,
  importPath: string,
  candidatePaths: string[],
): string | null {
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return null

  const storyDir = storyPath.split('/').slice(0, -1).join('/')
  const joined = joinPath(storyDir, importPath)

  const suffixes = ['', '.tsx', '.ts', '.jsx', '.js',
    '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
  for (const suffix of suffixes) {
    const candidate = joined + suffix
    if (candidatePaths.includes(candidate)) return candidate
  }
  return null
}

function joinPath(dir: string, relative: string): string {
  const parts = (dir ? dir.split('/') : [])
  for (const seg of relative.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}
