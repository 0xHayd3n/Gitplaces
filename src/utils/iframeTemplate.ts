// src/utils/iframeTemplate.ts
import type { ParsedComponent } from './componentParser'

// ---------------------------------------------------------------------------
// stubLocalImports — used by Vue/Svelte paths where we don't have a CDN fallback.
// Stubs ALL imports (local + third-party) so the source can be inlined safely.
// ---------------------------------------------------------------------------
export function stubLocalImports(source: string): string {
  let result = source

  // 1. Side-effect imports first (catches 'import "pkg"' and 'import "./foo.css"')
  result = result.replace(/import\s+['"][^'"]+['"]\s*;?/g, '')

  // 2. Namespace imports: import * as X from '...'
  //    React is already a UMD global — just remove it
  result = result.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, name: string) => (name === 'React' ? '' : `const ${name} = {}`),
  )

  // 3. Mixed: import X, { Y, Z } from '...'
  result = result.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, defName: string, namedPart: string) => {
      const clean = namedPart.replace(/\s+as\s+\w+/g, '')
      if (defName === 'React') return `const {${clean}} = {}`
      return `const ${defName} = {}\nconst {${clean}} = {}`
    },
  )

  // 4. Named imports: import { X, Y } from '...'
  //    Stub each name individually as a function so they work as components
  result = result.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, names: string) =>
      names
        .split(',')
        .map(n => {
          const parts = n.trim().split(/\s+as\s+/)
          const finalName = (parts[1] ?? parts[0]).trim()
          return finalName ? `const ${finalName} = function(){}` : ''
        })
        .filter(Boolean)
        .join('\n'),
  )

  // 5. Default imports: import X from '...'
  //    React/ReactDOM are UMD globals — remove
  //    Local './...' or '../...': component placeholder
  //    Third-party: empty object stub
  result = result.replace(
    /import\s+(\w+)\s+from\s+(['"])([^'"]+)\2\s*;?/g,
    (_m, name: string, _q: string, path: string) => {
      if (name === 'React' || name === 'ReactDOM') return ''
      if (path.startsWith('./') || path.startsWith('../')) return `const ${name} = () => null`
      return `const ${name} = function(){}`
    },
  )

  // 6. Strip export keywords so the component is declared without module syntax
  //    export default function/class → just the declaration
  result = result.replace(/export\s+default\s+(function|class)\s/g, '$1 ')
  //    export default expression → remove (component is referenced by name from filename)
  result = result.replace(/export\s+default\s+\w+\s*;?/g, '')
  //    export named: export function/const/let/var/class/type/interface
  result = result.replace(/export\s+(function|const|let|var|class|type|interface|enum)\s/g, '$1 ')
  //    export { X, Y } blocks
  result = result.replace(/export\s+\{[^}]*\}\s*(?:from\s+['"][^'"]+['"])?\s*;?/g, '')

  return result
}

// ---------------------------------------------------------------------------
// Error bridge — injected into every iframe.
// Forwards JS errors and unhandled promise rejections to the parent window.
// Target '*' is intentional: blob-URL iframes have a null origin so we cannot
// use window.location.origin as the target.
// ---------------------------------------------------------------------------
const ERROR_BRIDGE = `<script>
window.onerror=function(m,s,l,c,e){
  var msg=e?(e.message+(e.stack?'\\n'+e.stack:'')):m;
  window.parent.postMessage({type:'render-error',message:String(msg)},'*');
  return true;
};
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  var msg=r instanceof Error?(r.message+(r.stack?'\\n'+r.stack:'')):String(r);
  window.parent.postMessage({type:'render-error',message:msg},'*');
});
</script>`

function escapeScriptContent(s: string): string {
  // Prevent </script> from closing the containing script tag
  return s.replace(/<\/script>/gi, '<\\/script>')
}

// ---------------------------------------------------------------------------
// prepareForCompile — used only in the React compile path.
//
// Unlike stubLocalImports (which stubs everything), this function:
//   • removes CSS / style side-effect imports that esbuild can't transform
//   • stubs LOCAL relative imports (we don't have those files)
//   • leaves ALL third-party bare specifiers unchanged so the import map
//     in the iframe can resolve them at runtime
//
// `stubReturn` controls what stubbed function imports return when called.
// The default `'null'` is the safest "rendered as nothing" choice for
// components used as JSX, but it makes destructuring throw — many libraries
// have utility helpers like `const { value } = parseLength(input)` that
// crash when stubbed as `() => null`. Passing `'_$stubEl'` (a React element
// defined in the iframe prolog) makes destructuring return undefined for
// any key while still being a valid React node when used as JSX.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// prepareForCompileWithHelpers — extends prepareForCompile by inlining helper
// file sources before the component code. Each helper has its own imports
// processed (helpers' helpers also inline if present in the map; otherwise
// stubbed as null). Helper exports are stripped so identifiers land at
// module scope.
//
// The component's `import { x } from './rel'` lines are removed for any
// `./rel` we're inlining; non-resolved relatives still fall back to the
// stub-as-null path in prepareForCompile.
//
// This unlocks libraries like react-spinners where the component's first
// line is `const { value, unit } = parseLengthAndUnit(size)` — without the
// real helper, that destructure throws on null. With it inlined, the helper
// runs and the component renders correctly.
// ---------------------------------------------------------------------------
// Returns true when every non-blank, non-comment line in `source` is a
// re-export statement (`export * from "..."`, `export { … } from "…"`) or
// an `import type` line. Such files (barrel/index files that only re-export
// their sub-modules) contribute no value declarations to the merged code.
function isPureBarrel(source: string): boolean {
  for (const line of source.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue
    if (/^import\s+type\b/.test(t)) continue
    if (/^export\s+\*/.test(t)) continue
    if (/^export\s+\{[^}]*\}\s+from\s+['"]/.test(t)) continue
    return false
  }
  return true
}

function prepareForCompileWithHelpers(
  source: string,
  componentPath: string,
  helpers?: HelperSources,
): string {
  if (!helpers || Object.keys(helpers.byPath).length === 0) {
    return prepareForCompile(source, '_$stub')
  }

  // First, identify which of the component's relative imports actually
  // resolve to files in the helpers map. Those are the ones we'll inline.
  // Each resolved path gets walked recursively to pick up its own helper
  // dependencies — so the final inlined block ends up with everything in
  // dependency order (deps before consumers).
  const inlinedOrder: string[] = []
  const inlinedSet = new Set<string>()
  const visiting = new Set<string>()

  function walk(fromPath: string, fileSource: string) {
    for (const rel of extractRelativeImportPaths(fileSource)) {
      const resolved = resolveImportPath(fromPath, rel, helpers!.byPath)
      if (!resolved || inlinedSet.has(resolved) || visiting.has(resolved)) continue
      visiting.add(resolved)
      walk(resolved, helpers!.byPath[resolved])
      visiting.delete(resolved)
      inlinedSet.add(resolved)
      inlinedOrder.push(resolved)
    }
  }
  walk(componentPath, source)

  if (inlinedOrder.length === 0) return prepareForCompile(source, '_$stub')

  // Remove pure barrel files from inlinedSet/inlinedOrder.
  //
  // A barrel is a file whose entire content is re-export statements
  // (`export * from "..."`, `export { … } from "…"`, blank lines, comments,
  // `import type` lines). material-tailwind uses this pattern heavily —
  // e.g. `theme/components/stepper/index.ts` is only:
  //   export * from "./step";
  //   export * from "./stepper";
  //
  // The scanner fetches the barrel (level 2) but not its sub-files (level 3,
  // cut off by HELPER_MAX_FILES). When the barrel IS in inlinedSet,
  // stripInlinedImports removes `import { step, stepper } from "./components/stepper"`
  // from theme/index.ts. But neither `step` nor `stepper` are ever declared
  // in the merged code → ReferenceError at runtime.
  //
  // Fix: remove pure barrels from inlinedSet so the importing file keeps its
  // import line, which prepareForCompile then stubs as `const x = _$stub;`.
  // If the barrel's sub-files ARE fetched and inlined, those real declarations
  // appear earlier in helperBlock; the stubs are seen as duplicates and dropped
  // by dedupTopLevelDeclarations — correct either way.
  for (let i = inlinedOrder.length - 1; i >= 0; i--) {
    if (isPureBarrel(helpers.byPath[inlinedOrder[i]])) {
      inlinedSet.delete(inlinedOrder[i])
      inlinedOrder.splice(i, 1)
    }
  }

  if (inlinedOrder.length === 0) return prepareForCompile(source, '_$stub')

  // For each file (helpers + component), remove relative-import lines
  // whose target is in inlinedSet — they'll be in scope from the inline
  // block. Then run prepareForCompile so remaining imports are stubbed
  // and CSS side-effect imports stripped. Finally, for helpers, also
  // strip exports so identifiers become bare consts at module scope.
  const helperBlock = inlinedOrder.map(path => {
    const stripped = stripInlinedImports(helpers.byPath[path], path, inlinedSet, helpers.byPath)
    const prepared = prepareForCompile(stripped, '_$stub')
    return `// --- inlined: ${path} ---\n${stripHelperExports(prepared)}`
  }).join('\n\n')

  const componentStripped = stripInlinedImports(source, componentPath, inlinedSet, helpers.byPath)
  const componentPrepared = prepareForCompile(componentStripped, '_$stub')

  // Bare-specifier imports (`import React from "react"`) survive both
  // stripInlinedImports and prepareForCompile. When several helpers each
  // declare the same default/namespace, concatenating their bodies yields
  // duplicate top-level bindings — which ESM forbids and esbuild rejects.
  // Hoist + merge them so the final source declares each binding once.
  const merged = consolidateBareImports(
    `${helperBlock}\n\n// --- component: ${componentPath} ---\n${componentPrepared}`,
  )

  // Helpers from different types files often re-declare the same identifiers
  // (`propTypesClassName`, `propTypesOpen`, `variant`, `contextValue`, …).
  // material-tailwind's `types/components/<X>.ts` files all share these
  // names with the same shape, so when walking pulls in several of them
  // (via theme/index.ts → theme/components/<X> → types/components/<X>),
  // the concatenated module has many duplicate top-level declarations.
  // ESM forbids this. Keep the first declaration of each name and drop
  // subsequent ones. Safe because the duplicated symbols are conventional
  // (PropTypes validators, type aliases) — the first wins.
  return dedupTopLevelDeclarations(merged)
}

// dedupTopLevelDeclarations — walks the source line-by-line, identifies
// top-level `const/let/var/function/class/type/interface/enum X` declarations,
// and removes duplicates of any name already declared earlier.
//
// Declaration boundaries are detected by brace/paren/bracket balancing:
// a declaration ends on the first line where depth hits 0 AND the line ends
// with `;` or `}`. This handles single-line (`const X = 5;`), multi-line
// object literals (`const X = {\n  …\n};`), and function/class bodies.
//
// Component-vs-helper priority: a parent helper file (e.g. SpeedDial/index.tsx)
// often imports its sibling components, which prepareForCompile turns into
// `const SpeedDialContent = () => null;` stubs. When THAT sibling is the
// component being rendered, its own file declares `export const SpeedDialContent
// = …` — so we'd have two top-level declarations of the same name.
//
// To resolve: pre-scan the COMPONENT region (everything after the `// ---
// component:` marker) and seed `seen` with its declared names. The dedup
// pass then drops any matching helper stubs, while the component region
// itself passes through verbatim (we don't dedup `export const`).
//
// Limitations: doesn't tokenize strings/comments, so a string literal with
// unbalanced braces could throw off counting. Acceptable for the patterns
// component libraries actually use (type files, PropTypes shapes).
function dedupTopLevelDeclarations(code: string): string {
  const lines = code.split('\n')
  // TypeScript has separate namespaces for types and values. `type X = …`
  // and `const X = …` can legally coexist in source, and esbuild strips
  // types so they never collide at runtime. But my dedup conflating them
  // into one Set caused real bugs: e.g. when `types/components/stepper.ts`
  // declared `type stepper = …` first, the later `const stepper = …` from
  // `theme/components/stepper/index.ts` got dropped, and the rendered
  // iframe failed at runtime with `stepper is not defined`.
  //
  // Track them separately. `interface` is type-only; `enum` straddles both
  // (TypeScript emits a runtime object for enums) so treat it as a value
  // for safety — duplicate enums of the same name are rare in component
  // libraries anyway.
  const seenValues = new Set<string>()
  const seenTypes = new Set<string>()

  // Match top-level declarations. Capture name in group 1, "kind" inferred
  // by the matched keyword (which we re-extract below).
  const valueDeclRe = /^(?:async\s+)?(?:const|let|var|function|class|enum)\s+(\w[\w$]*)/
  const typeDeclRe = /^(?:type|interface)\s+(\w[\w$]*)/

  const exportValueDeclRe = /^export\s+(?:async\s+)?(?:const|let|var|function|class|enum)\s+(\w[\w$]*)/
  const exportTypeDeclRe = /^export\s+(?:type|interface)\s+(\w[\w$]*)/
  const exportDefaultDeclRe = /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w[\w$]*)/

  // Find the component boundary marker emitted by prepareForCompileWithHelpers.
  const componentStart = lines.findIndex(l => l.startsWith('// --- component:'))

  // Pre-populate seen sets with names declared in the component region.
  // These win over helper stubs of the same name.
  if (componentStart >= 0) {
    for (let i = componentStart; i < lines.length; i++) {
      const line = lines[i]
      const valueMatch = line.match(exportValueDeclRe) ?? line.match(exportDefaultDeclRe) ?? line.match(valueDeclRe)
      if (valueMatch) seenValues.add(valueMatch[1])
      const typeMatch = line.match(exportTypeDeclRe) ?? line.match(typeDeclRe)
      if (typeMatch) seenTypes.add(typeMatch[1])
    }
  }

  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    // Component region: pass through verbatim.
    if (componentStart >= 0 && i >= componentStart) {
      out.push(lines[i])
      i++
      continue
    }

    const line = lines[i]
    const valueMatch = line.match(valueDeclRe)
    const typeMatch = !valueMatch ? line.match(typeDeclRe) : null

    if (!valueMatch && !typeMatch) {
      out.push(line)
      i++
      continue
    }

    const name = (valueMatch ?? typeMatch)![1]
    const seen = valueMatch ? seenValues : seenTypes
    const endIdx = findDeclarationEnd(lines, i)

    if (seen.has(name)) {
      i = endIdx + 1
      continue
    }
    seen.add(name)
    for (let j = i; j <= endIdx; j++) out.push(lines[j])
    i = endIdx + 1
  }

  return out.join('\n')
}

function findDeclarationEnd(lines: string[], startIdx: number): number {
  let depth = 0
  for (let i = startIdx; i < lines.length; i++) {
    const prevDepth = depth
    const line = lines[i]
    for (let k = 0; k < line.length; k++) {
      const c = line[k]
      if (c === '{' || c === '(' || c === '[') depth++
      else if (c === '}' || c === ')' || c === ']') depth--
    }
    if (depth <= 0) {
      // Depth returned from positive to ≤0: the bracketed expression is
      // fully balanced — this line ends the declaration regardless of its
      // final character. Without this check, multi-line calls ending with
      // just `)` (e.g. `PropTypes.oneOf([...])` without a trailing `;`)
      // would scan into the next declaration, absorbing it into the skip
      // range and silently dropping it during dedup.
      if (prevDepth > 0) return i
      // Depth never opened (single-line or already balanced): accept
      // standard statement terminators and any closing bracket.
      const trimmed = line.trimEnd()
      if (trimmed.endsWith(';') || trimmed.endsWith('}') || trimmed.endsWith(')') || trimmed.endsWith(']')) return i
      // Single-line declaration with no brackets and no standard terminator
      // (e.g. `type X = SomeGeneric<T>`) — treat the line as self-contained.
      if (i === startIdx) return i
    }
  }
  return lines.length - 1
}

// stripHelperExports — strips `export` keywords from inlined helper code so
// identifiers land at module scope without trying to bind defaults to a name.
//
// Differs from `stripExports` (used post-compile on the component file) in
// that it has no "owner" name to graft `export default <X>` onto. The intent
// for helpers is just to make declarations visible — any `export default`
// referring to an already-declared identifier is dropped entirely (the
// identifier is still in scope from its declaration above), and re-export
// forms (`export { … }`, `export * from "…"`) are dropped because the
// targets are already inlined as preceding helper blocks or are unreachable.
function stripHelperExports(code: string): string {
  let c = code
  // `export default function Name` / `export default class Name` (incl. `async function`) → keep declaration
  c = c.replace(/^export\s+default\s+(async\s+function\s+\w[\w$]*|function\s+\w[\w$]*|class\s+\w[\w$]*)/gm, '$1')
  // `export default identifier;` → drop entirely (identifier already declared above)
  c = c.replace(/^export\s+default\s+\w[\w.]*\s*;?\s*$/gm, '')
  // `export default <other expression>` → drop the keywords (orphan expression evaluates to nothing)
  c = c.replace(/^export\s+default\s+/gm, '')
  // `export { a, b } [from "..."]` → drop
  c = c.replace(/^export\s+\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?\s*;?$/gm, '')
  // `export * [as Name] from "..."` → drop (transitive deps are already inlined)
  c = c.replace(/^export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"][^'"]+['"]\s*;?$/gm, '')
  // `export const/let/var/function/class/type/interface/enum X` → keep declaration only
  c = c.replace(/^export\s+(function|const|let|var|class|type|interface|enum)\s/gm, '$1 ')
  return c
}

// consolidateBareImports — merges duplicate bare-specifier imports across
// inlined helpers + component into a single block at the top of the output.
//
// Why: each helper's `import React from "react"`, `import PropTypes from
// "prop-types"`, etc. survives prepareForCompile (which only stubs/strips
// relative imports). When 2-3 helpers each declare the same default binding,
// the concatenated source has duplicate top-level identifiers — a parse
// error in ESM. We hoist each module's imports to one consolidated line and
// remove the originals.
//
// Conflict policy: first-wins for default and namespace imports. Named
// imports are unioned (later occurrences are merged in). Conflicting
// `as`-aliases for the same imported name are extremely rare in practice;
// we keep the first mapping seen.
function consolidateBareImports(code: string): string {
  type Spec = { defaultName?: string; namespace?: string; named: Map<string, string> }
  const byModule = new Map<string, Spec>()
  const replacements: Array<{ start: number; end: number }> = []

  // Match top-level `import ... from "module";` lines. The clause shape can be:
  //   import D from "m"
  //   import * as N from "m"
  //   import { a, b as c } from "m"
  //   import D, { a } from "m"
  //   import D, * as N from "m"
  // (Side-effect `import "m"` lines were stripped earlier; we don't carry them.)
  const importRe = /^import\s+([^'"]+?)\s+from\s+(['"])([^'"]+)\2\s*;?$/gm

  let m: RegExpExecArray | null
  while ((m = importRe.exec(code)) !== null) {
    const clause = m[1].trim()
    const moduleSpec = m[3]
    // Skip relative imports — those should already be inlined or stubbed.
    // We only consolidate bare specifiers (third-party packages).
    if (moduleSpec.startsWith('./') || moduleSpec.startsWith('../')) continue

    const spec = byModule.get(moduleSpec) ?? { named: new Map() }
    parseImportClause(clause, spec)
    byModule.set(moduleSpec, spec)
    replacements.push({ start: m.index, end: m.index + m[0].length })
  }

  if (replacements.length === 0) return code

  // Remove the original lines (back-to-front to keep indices valid).
  let out = code
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end } = replacements[i]
    out = out.slice(0, start) + out.slice(end)
  }

  // Build consolidated import block — one line per module.
  const lines: string[] = []
  for (const [moduleSpec, spec] of byModule) {
    const parts: string[] = []
    if (spec.defaultName) parts.push(spec.defaultName)
    if (spec.namespace) parts.push(`* as ${spec.namespace}`)
    if (spec.named.size > 0) {
      const named = [...spec.named.entries()]
        .map(([imported, local]) => imported === local ? imported : `${imported} as ${local}`)
        .join(', ')
      parts.push(`{ ${named} }`)
    }
    if (parts.length > 0) {
      lines.push(`import ${parts.join(', ')} from '${moduleSpec}';`)
    }
  }

  return `${lines.join('\n')}\n${out}`
}

function parseImportClause(clause: string, spec: { defaultName?: string; namespace?: string; named: Map<string, string> }): void {
  let rest = clause
  // Default import comes first, optionally followed by `, { … }` or `, * as N`
  const defaultMatch = rest.match(/^(\w[\w$]*)\s*(?:,\s*(.+))?$/)
  if (defaultMatch && !rest.startsWith('{') && !rest.startsWith('*')) {
    if (!spec.defaultName) spec.defaultName = defaultMatch[1]
    rest = (defaultMatch[2] ?? '').trim()
  }

  if (rest.startsWith('*')) {
    const nsMatch = rest.match(/^\*\s+as\s+(\w[\w$]*)/)
    if (nsMatch && !spec.namespace) spec.namespace = nsMatch[1]
    return
  }

  if (rest.startsWith('{')) {
    const namedMatch = rest.match(/^\{([^}]*)\}$/)
    if (!namedMatch) return
    for (const part of namedMatch[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const aliasMatch = trimmed.match(/^(\w[\w$]*)(?:\s+as\s+(\w[\w$]*))?$/)
      if (!aliasMatch) continue
      const imported = aliasMatch[1]
      const local = aliasMatch[2] ?? imported
      if (!spec.named.has(imported)) spec.named.set(imported, local)
    }
  }
}

function stripInlinedImports(
  source: string,
  fromPath: string,
  inlinedSet: Set<string>,
  helperMap: Record<string, string>,
): string {
  const resolve = (rel: string) => {
    const resolved = resolveImportPath(fromPath, rel, helperMap)
    return resolved && inlinedSet.has(resolved)
  }
  // Single-line: import [clause] from './rel'  (default, named, namespace, side-effect)
  let out = source.replace(
    /^import\s+(?:[^'"\n]+?\s+from\s+)?(['"])(\.\.?\/[^'"]+)\1\s*;?$/gm,
    (match, _quote, rel) => resolve(rel) ? '' : match,
  )
  // Multi-line named: import {\n  a,\n  b,\n} from './rel'
  // `[^}]*` spans newlines; no trailing `$` since the match is multi-line.
  out = out.replace(
    /^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+(['"])(\.\.?\/[^'"]+)\1\s*;?/gm,
    (match, _quote, rel) => resolve(rel) ? '' : match,
  )
  return out
}

function extractRelativeImportPaths(source: string): string[] {
  const paths: string[] = []
  const re = /from\s+(['"])(\.\.?\/[^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) paths.push(m[2])
  return paths
}

function resolveImportPath(
  fromPath: string,
  relative: string,
  helperMap: Record<string, string>,
): string | null {
  if (!relative.startsWith('./') && !relative.startsWith('../')) return null
  const fromDir = fromPath.split('/').slice(0, -1).join('/')
  const joined = joinRelative(fromDir, relative)
  const suffixes = ['', '.tsx', '.ts', '.jsx', '.js',
    '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
  for (const suffix of suffixes) {
    const candidate = joined + suffix
    if (helperMap[candidate] !== undefined) return candidate
  }
  return null
}

function joinRelative(dir: string, relative: string): string {
  const parts = (dir ? dir.split('/') : [])
  for (const seg of relative.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function prepareForCompile(source: string, stubReturn: string = 'null'): string {
  let r = source

  // 1. Side-effect imports: import 'anything'  (CSS, SCSS, JSON, bare strings)
  r = r.replace(/^import\s+['"][^'"]+['"]\s*;?$/gm, '')

  // When stubReturn is '_$stub', assign the proxy directly so that both
  // property access (`stub.x`) and calls (`stub()`) work without wrapping
  // in an arrow function. Otherwise use `() => <value>` for backwards compat.
  const mkStub = (name: string) =>
    stubReturn === '_$stub' ? `const ${name} = _$stub;` : `const ${name} = () => ${stubReturn};`
  const mkNsStub = (name: string) =>
    stubReturn === '_$stub' ? `const ${name} = _$stub;` : `const ${name} = {};`

  // 2. Namespace: import * as X from './relative'
  // Stubs MUST end with `;` — `dedupTopLevelDeclarations` uses statement
  // terminators to find declaration boundaries, and a trailing-`;`-less stub
  // causes findDeclarationEnd to over-include subsequent lines, swallowing
  // duplicate declarations into the first one's range and silently leaking
  // them through the dedup pass.
  r = r.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, name: string) => mkNsStub(name),
  )

  // 3. Mixed: import X, { Y } from './relative'
  r = r.replace(
    /^import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+(['"])(\.[^'"]+)\3\s*;?$/gm,
    (_m, def: string, named: string) => {
      const stubs = named
        .split(',')
        .map((n: string) => {
          const fin = (n.trim().split(/\s+as\s+/).pop() ?? '').trim()
          return fin ? mkStub(fin) : ''
        })
        .filter(Boolean)
        .join('\n')
      return `${mkStub(def)}\n${stubs}`
    },
  )

  // 4. Named: import { X } from './relative'  (also strips import type { … })
  r = r.replace(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, names: string) =>
      names
        .split(',')
        .map((n: string) => {
          const parts = n.trim().split(/\s+as\s+/)
          const fin = (parts[parts.length - 1] ?? '').trim()
          if (!fin || n.trim().startsWith('type ')) return ''
          return mkStub(fin)
        })
        .filter(Boolean)
        .join('\n'),
  )

  // 4b. Multi-line named: import {\n  X,\n  Y,\n} from './relative'
  // The single-line rule above (anchored with `$`) misses these. `[^}]*` spans
  // newlines; the match is consumed from `import` through the closing `;`.
  r = r.replace(
    /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+(['"])(\.[^'"]+)\2\s*;?/gm,
    (_m, names: string) =>
      names
        .split(',')
        .map((n: string) => {
          const parts = n.trim().split(/\s+as\s+/)
          const fin = (parts[parts.length - 1] ?? '').trim()
          if (!fin || n.trim().startsWith('type ')) return ''
          return mkStub(fin)
        })
        .filter(Boolean)
        .join('\n'),
  )

  // 5. Default: import X from './relative'
  r = r.replace(
    /^import\s+(\w+)\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, name: string) => mkStub(name),
  )

  // Third-party bare specifiers (not starting with '.') are left as-is.
  // esbuild's transform API does not bundle them — they remain bare specifiers
  // in the output, which the import map resolves at runtime.

  return r
}

// ---------------------------------------------------------------------------
// buildImportMap — scans compiled code for bare specifiers and generates a
// <script type="importmap"> that maps them to versioned esm.sh URLs.
//
// Key design decisions:
//   • react / react-dom are pinned to @18 so ALL modules share one instance.
//   • Third-party packages use ?external=react,react-dom which tells esm.sh to
//     leave those as bare imports (resolved by our map) instead of bundling
//     their own copy — preventing duplicate React instances.
// ---------------------------------------------------------------------------
const PINNED: Record<string, string> = {
  'react':                    'https://esm.sh/react@18',
  'react/jsx-runtime':        'https://esm.sh/react@18/jsx-runtime',
  'react/jsx-dev-runtime':    'https://esm.sh/react@18/jsx-dev-runtime',
  'react-dom':                'https://esm.sh/react-dom@18',
  'react-dom/client':         'https://esm.sh/react-dom@18/client',
  'react-dom/server':         'https://esm.sh/react-dom@18/server',
  'solid-js':                 'https://esm.sh/solid-js@1',
  'solid-js/web':             'https://esm.sh/solid-js@1/web',
  'solid-js/store':           'https://esm.sh/solid-js@1/store',
}

function buildImportMap(code: string): string {
  const imports: Record<string, string> = { ...PINNED }

  // Extract every bare specifier that appears after `from '…'`
  const re = /\bfrom\s+['"]([^'"./][^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const spec = m[1]!
    if (!imports[spec]) {
      // Pin to same React so the package doesn't bundle its own copy
      imports[spec] = `https://esm.sh/${spec}?external=react,react-dom`
    }
  }

  return `<script type="importmap">${JSON.stringify({ imports })}</script>`
}

// ---------------------------------------------------------------------------
// compileSource — calls esbuild in the main process via IPC with the given
// framework hint so the right loader/jsx settings are applied.
//
// Returns the compiled code on success, or `{ error: string }` with the
// human-readable esbuild diagnostic on failure. The IPC may also return the
// legacy `string | null` shape (older preload bundle, build cache, tests),
// so we normalize both.
// ---------------------------------------------------------------------------
type CompileOutcome = { code: string } | { error: string }

async function compileSource(source: string, framework: string): Promise<CompileOutcome> {
  try {
    const result = await window.api.components.compile(source, framework) as
      | string
      | null
      | { ok: true; code: string }
      | { ok: false; error: string }
    if (typeof result === 'string') return { code: result }
    if (result === null || result === undefined) {
      const msg = 'esbuild returned null — check the dev terminal for the [components:compile] log'
      console.error(`[ComponentExplorer] ${msg}`)
      return { error: msg }
    }
    if (result.ok) return { code: result.code }
    console.error('[ComponentExplorer] esbuild error:', result.error)
    return { error: result.error }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ComponentExplorer] compileSource threw:', e)
    return { error: msg }
  }
}

// ---------------------------------------------------------------------------
// stripExports — removes ES module export keywords from compiled code so that
// declarations are in scope by name (used by React, Solid, Angular, TS paths).
// ---------------------------------------------------------------------------
function stripExports(code: string, name: string): string {
  let c = code
  c = c.replace(/^export\s+default\s+(function\s+\w|class\s+\w)/gm, '$1')
  c = c.replace(/^export\s+default\s+(function|class)\b/gm, `const ${name} = $1`)
  c = c.replace(/^export\s+default\s+(\w[\w.]*)\s*;?\s*$/gm, (_m, id) =>
    id === name ? '' : `const ${name} = ${id}`)
  c = c.replace(/^export\s+default\s+/gm, '')
  c = c.replace(/^export\s+\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?\s*;?$/gm, '')
  c = c.replace(/^export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"][^'"]+['"]\s*;?$/gm, '')
  c = c.replace(/^export\s+(function|const|let|var|class|type|interface|enum)\s/gm, '$1 ')
  return c
}

// ---------------------------------------------------------------------------
// buildIframeHtml — public entry point called by ComponentExplorer.
// ---------------------------------------------------------------------------
export interface HelperSources {
  // Map of file path → raw source. Same shape the scanner returns. The path
  // is used to resolve relative imports out of the component file.
  byPath: Record<string, string>
}

// Compile-only step. The output depends on (source, helpers, framework) — but
// NOT on theme or props. ComponentCard caches this result in a ref so theme
// toggles and prop changes only re-template the HTML wrapper without paying
// the IPC + esbuild cost again.
//
// For React/Solid the output is esbuild-transformed JS. For Vue/Svelte/JS
// there's no precompile step — the source itself is passed straight through.
//
// Returns the prepared/compiled code as a string on success. On failure
// returns `{ error: string }` with the esbuild diagnostic so callers can
// surface it to the UI (instead of a generic "Compile returned null").
// Returns null only when the component itself is non-renderable.
export async function compileForIframe(
  component: ParsedComponent,
  source: string,
  helpers?: HelperSources,
): Promise<string | { error: string } | null> {
  if (!component.renderable) return null
  switch (component.framework) {
    case 'react': {
      const prepared = prepareForCompileWithHelpers(source, component.path, helpers)
      return unwrapOutcome(await compileSource(prepared, 'react'))
    }
    case 'solid': {
      const prepared = prepareForCompileWithHelpers(source, component.path, helpers)
      return unwrapOutcome(await compileSource(prepared, 'solid'))
    }
    case 'angular':
      return unwrapOutcome(await compileSource(prepareForCompile(source), 'angular'))
    case 'typescript':
      return unwrapOutcome(await compileSource(prepareForCompile(source), 'typescript'))
    case 'vue':
      return stubLocalImports(source)
    case 'svelte':
      return stubLocalImports(source)
    case 'javascript':
    case 'unknown':
      return source
    default:
      return null
  }
}

function unwrapOutcome(outcome: CompileOutcome): string | { error: string } {
  return 'code' in outcome ? outcome.code : outcome
}

// HTML-build step. Pure function of (component, prepared, props, theme) —
// fast, synchronous, no IPC. Pair with `compileForIframe` to avoid recompiling
// when only the theme or props change.
export function buildHtmlFromCompiled(
  component: ParsedComponent,
  prepared: string,
  props: Record<string, unknown>,
  theme: 'light' | 'dark' = 'dark',
  hasTailwind = false,
): string | null {
  if (!component.renderable) return null
  const propsJson = JSON.stringify(props)
  switch (component.framework) {
    case 'react':      return buildReactHtml(component.name, prepared, propsJson, theme, hasTailwind)
    case 'solid':      return buildSolidHtml(component.name, prepared, propsJson, theme, hasTailwind)
    case 'angular':    return buildAngularHtml(component.name, prepared, theme)
    case 'typescript': return buildTypeScriptHtml(prepared, theme)
    case 'vue':        return buildVueHtml(component.name, prepared, propsJson, theme)
    case 'svelte':     return buildSvelteHtml(prepared, propsJson, theme)
    case 'javascript':
    case 'unknown':    return buildJavaScriptHtml(prepared, theme)
    default:           return null
  }
}

// Convenience: combined compile + build. Kept for callers that don't benefit
// from caching the compiled output (e.g. one-shot renders, tests).
//
// On compile failure returns null (matching the prior contract). Callers that
// need the underlying error message should use `compileForIframe` directly,
// which surfaces `{ error: string }`.
export async function buildIframeHtml(
  component: ParsedComponent,
  source: string,
  props: Record<string, unknown>,
  theme: 'light' | 'dark' = 'dark',
  helpers?: HelperSources,
  hasTailwind = false,
): Promise<string | null> {
  const prepared = await compileForIframe(component, source, helpers)
  if (prepared === null) return null
  if (typeof prepared !== 'string') return null
  return buildHtmlFromCompiled(component, prepared, props, theme, hasTailwind)
}

function themeStyle(theme: 'light' | 'dark'): string {
  return theme === 'dark'
    ? 'background:#0e0e0e;color:#eee'
    : 'background:#fff;color:#000'
}

function themeBodyAttrs(theme: 'light' | 'dark'): string {
  return `data-theme="${theme}"${theme === 'dark' ? ' class="dark"' : ''}`
}

function baseHead(theme: 'light' | 'dark', importMap = '', hasTailwind = false): string {
  // ERROR_BRIDGE must come before the importmap (which must come before module scripts).
  // Body fills the iframe and centers content so spinners/icons sit in the
  // middle of each gallery cell instead of pinning to the top-left.
  const tailwind = hasTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : ''
  return `<meta charset="utf-8">${ERROR_BRIDGE}${importMap}${tailwind}
<style>html,body{height:100%;overflow:hidden}body{margin:0;padding:16px;box-sizing:border-box;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;${themeStyle(theme)}}</style>`
}

// ---------------------------------------------------------------------------
// STUB_PROLOG — injected at the top of React/Solid iframe module scripts.
//
// Defines `_$stub`, a self-returning Proxy used by prepareForCompile to stub
// unresolvable relative imports. Properties, calls, and nested access all
// return `_$stub` itself, so patterns like:
//   const { open } = useAccordion()   → open = _$stub (no throw)
//   styles.base.padding               → _$stub (no throw)
//   data.findIndex(...)               → _$stub (callable, no throw)
// …all survive without "Cannot destructure" / "is not a function" crashes.
//
// The `then` guard prevents Promise detection (avoids infinite await loops).
// ESM hoists all `import` statements before the module body runs, so any
// `import` in the render tail is already bound by the time this const runs.
// ---------------------------------------------------------------------------
const STUB_PROLOG = `const _$stub=new Proxy(function _s(){return _$stub},{get:(_,p)=>typeof p==='symbol'||p==='then'?undefined:p==='valueOf'||p==='toString'?()=>'':_$stub,apply:()=>_$stub});`

// ---------------------------------------------------------------------------
// buildReactHtml
//
// Takes esbuild-compiled ESM code (bare specifiers intact) and wraps it in a
// self-contained HTML document that:
//   1. Has an import map so bare specifiers resolve to esm.sh CDN URLs
//   2. Strips 'export default' so the component is in scope by name
//   3. Renders the component via React 18 createRoot
// ---------------------------------------------------------------------------
function buildReactHtml(name: string, compiledCode: string, propsJson: string, theme: 'light' | 'dark', hasTailwind = false): string {
  let code = stripExports(compiledCode, name)
  const importMap = buildImportMap(code)
  const renderTail = [
    `import{createElement as _$cc,Component as _$BC}from'react'`,
    `import{createRoot as _$cr}from'react-dom/client'`,
    // Error boundary: catches render-phase errors (e.g. "r is not a function" from
    // context sub-components that need a parent provider) and renders null instead
    // of propagating to the global error handler and triggering "Preview failed".
    `class _$EB extends _$BC{constructor(p){super(p);this.state={e:0}}static getDerivedStateFromError(){return{e:1}}render(){return this.state.e?null:this.props.children}}`,
    `try{_$cr(document.getElementById('root')).render(_$cc(_$EB,null,_$cc(${name},${propsJson})));}` +
      `catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`,
  ].join('\n')

  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap, hasTailwind)}
</head><body ${themeBodyAttrs(theme)}><div id="root"></div>
<script type="module">
${STUB_PROLOG}
${escapeScriptContent(code + '\n' + renderTail)}
</script></body></html>`
}

function buildVueHtml(name: string, source: string, propsJson: string, theme: 'light' | 'dark'): string {
  const templateMatch = source.match(/<template>([\s\S]+?)<\/template>/)
  const template = (templateMatch?.[1] ?? '<div>Component</div>')
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/`/g, '\\`')

  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>')}
</head><body ${themeBodyAttrs(theme)}><div id="app"></div>
<script>
const {createApp,ref,computed,reactive,watch,onMounted}=Vue;
const _props=${propsJson};
const _render=Vue.compile(\`${template}\`);
createApp({setup(){return _props},render:_render}).mount('#app');
</script></body></html>`
}

function buildSvelteHtml(source: string, propsJson: string, theme: 'light' | 'dark'): string {
  const escaped = source
    .replace(/\\/g, '\\\\')
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')

  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/svelte@4/compiler.js"></script>')}
</head><body ${themeBodyAttrs(theme)}>
<script type="module">
const src=\`${escaped}\`;
let compiled;
try{compiled=svelte.compile(src,{generate:'dom',format:'esm'});}
catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');throw e;}
const blob=new Blob([compiled.js.code],{type:'application/javascript'});
const url=URL.createObjectURL(blob);
import(url).then(mod=>{
  new mod.default({target:document.body,props:${propsJson}});
}).catch(e=>{window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');});
</script></body></html>`
}

function buildSolidHtml(name: string, compiledCode: string, propsJson: string, theme: 'light' | 'dark', hasTailwind = false): string {
  const code = stripExports(compiledCode, name)
  const importMap = buildImportMap(code)
  const renderTail = [
    `import{render as _$r,createComponent as _$cc}from'solid-js/web'`,
    `try{_$r(()=>_$cc(${name},${propsJson}),document.getElementById('root'));}` +
    `catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`,
  ].join('\n')
  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap, hasTailwind)}\n</head><body ${themeBodyAttrs(theme)}><div id="root"></div>\n<script type="module">\n${STUB_PROLOG}\n${escapeScriptContent(code + '\n' + renderTail)}\n</script></body></html>`
}

function buildAngularHtml(name: string, compiledCode: string, theme: 'light' | 'dark'): string {
  const code = stripExports(compiledCode, name)
  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/zone.js/dist/zone.js"></script>')}
</head><body ${themeBodyAttrs(theme)}><app-root></app-root>
<script type="module">
import{bootstrapApplication}from'https://esm.sh/@angular/platform-browser@17'
${escapeScriptContent(code)}
try{
  if(typeof ${name}!=='undefined'){
    bootstrapApplication(${name}).catch(function(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');})
  }
}catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}
</script></body></html>`
}

function buildTypeScriptHtml(compiledCode: string, theme: 'light' | 'dark'): string {
  const code = stripExports(compiledCode, '')
  const importMap = buildImportMap(code)
  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap)}\n</head><body ${themeBodyAttrs(theme)}><div id="root" style="padding:16px"></div>\n<script type="module">\n${escapeScriptContent(code)}\n</script></body></html>`
}

function buildJavaScriptHtml(source: string, theme: 'light' | 'dark'): string {
  const pluginMatch = source.match(/\$\.fn\.(\w+)\s*=/)
  const pluginName = pluginMatch?.[1] ?? null
  const autoInit = pluginName
    ? `try{if($.fn.${pluginName}){$('#demo').${pluginName}();}}catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`
    : ''
  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>')}
</head><body ${themeBodyAttrs(theme)}>
<div id="demo" style="padding:8px">
  <div class="accordion"><div class="title"><i class="dropdown icon"></i>Section 1</div><div class="content active"><p>Content</p></div></div>
</div>
<script>
${escapeScriptContent(source)}
${autoInit}
</script></body></html>`
}

// escapeScriptContent kept for potential use by callers
export { escapeScriptContent }

// ---------------------------------------------------------------------------
// buildBundledIframeHtml — bundled-tier renderer.
//
// Renders a component fetched directly from esm.sh (no local compilation).
// Uses a fixed import map for React 18 so the CDN module shares one instance.
// ---------------------------------------------------------------------------
import type { BundledRender } from '../types/components'

export function buildBundledIframeHtml(
  render: BundledRender,
  propsJson: string,
  theme: 'light' | 'dark',
  hasTailwind = false,
): string {
  const importMap = `<script type="importmap">${JSON.stringify({
    imports: {
      'react':            'https://esm.sh/react@18',
      'react-dom':        'https://esm.sh/react-dom@18',
      'react-dom/client': 'https://esm.sh/react-dom@18/client',
      'react/jsx-runtime':'https://esm.sh/react@18/jsx-runtime',
    },
  })}</script>`

  const cssLinks = render.cssUrls
    .map(u => `<link rel="stylesheet" href="${u}" onerror="this.remove()">`)
    .join('')

  const tailwind = hasTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : ''

  const themeAttr = `data-theme="${theme}"${theme === 'dark' ? ' class="dark"' : ''}`
  const themeStyle = theme === 'dark'
    ? 'background:#0e0e0e;color:#eee'
    : 'background:#fff;color:#000'

  const renderTail = [
    `import { ${render.exportName} as _$C } from '${render.importUrl}'`,
    `import { createElement } from 'react'`,
    `import { createRoot } from 'react-dom/client'`,
    `try {`,
    `  createRoot(document.getElementById('root')).render(createElement(_$C, ${propsJson}))`,
    `} catch (e) {`,
    `  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(e)},'*')`,
    `}`,
  ].join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${ERROR_BRIDGE_BUNDLED}${importMap}${cssLinks}${tailwind}
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;${themeStyle}}</style>
</head><body ${themeAttr}><div id="root"></div>
<script type="module">
${escapeScriptContent(renderTail)}
</script></body></html>`
}

const ERROR_BRIDGE_BUNDLED = `<script>
window.onerror=function(m,s,l,c,e){
  var msg=e?(e.message+(e.stack?'\\n'+e.stack:'')):m;
  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(msg)},'*');
  return true;
};
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  var msg=r instanceof Error?(r.message+(r.stack?'\\n'+r.stack:'')):String(r);
  window.parent.postMessage({type:'render-error',tier:'bundled',message:msg},'*');
});
</script>`
