// electron/componentScanner.ts
import { ipcMain } from 'electron'
import { getToken } from './store'
import { getRepoTree, getFileContent } from './github'
import { detectFramework, detectFrameworkFromTree, isComponentFile } from '../src/utils/componentScanner'
import type { ComponentScanResult, Framework, ScannedComponent, ScannedStory, ScannedHelper } from '../src/types/components'

// Maximum recursion depth when following relative imports out of components.
// Most libraries have a shallow `helpers/` tree; deeper than this is rare and
// would balloon the fetch count.
const HELPER_MAX_DEPTH = 3
// Safety cap on total helper files fetched per scan.
const HELPER_MAX_FILES = 80

function extractRelativeImports(source: string): string[] {
  const imports: string[] = []
  // Match the path inside `from '...'` or `from "..."` when it starts with
  // `./` or `../`. Captures only the path string. Skips `import type` lines —
  // esbuild strips them anyway, no need to fetch a file we won't use.
  const re = /(?<!import\s+type\s)from\s+(['"])(\.\.?\/[^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    imports.push(m[2])
  }
  return imports
}

function resolveRelativeImport(
  fromPath: string,
  relative: string,
  allFilePaths: Set<string>,
): string | null {
  if (!relative.startsWith('./') && !relative.startsWith('../')) return null
  const fromDir = fromPath.split('/').slice(0, -1).join('/')
  const joined = joinPath(fromDir, relative)
  const suffixes = ['', '.tsx', '.ts', '.jsx', '.js',
    '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
  for (const suffix of suffixes) {
    const candidate = joined + suffix
    if (allFilePaths.has(candidate)) return candidate
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

// Recursively fetch every relative-import target reachable from `seedFiles`,
// up to HELPER_MAX_DEPTH levels and HELPER_MAX_FILES total. The seeds are
// already-fetched component sources; their direct relative imports become
// the level-1 helpers, those helpers' imports become level-2, etc.
async function scanHelpers(
  seedFiles: ScannedComponent[],
  allFilePaths: Set<string>,
  excludePaths: Set<string>,
  fetchSource: (path: string) => Promise<string | null>,
): Promise<ScannedHelper[]> {
  const found = new Map<string, ScannedHelper>()
  let frontier = new Set<string>()

  // Seed the frontier with directly-imported relative paths from components
  for (const file of seedFiles) {
    for (const rel of extractRelativeImports(file.source)) {
      const resolved = resolveRelativeImport(file.path, rel, allFilePaths)
      if (resolved && !excludePaths.has(resolved)) frontier.add(resolved)
    }
  }

  for (let depth = 0; depth < HELPER_MAX_DEPTH && frontier.size > 0; depth++) {
    if (found.size >= HELPER_MAX_FILES) break

    // Cap this level's frontier so we don't blow the file budget
    const remaining = HELPER_MAX_FILES - found.size
    const batch = [...frontier].slice(0, remaining)

    const sources = await batchFetch(batch, 10, fetchSource)

    const nextFrontier = new Set<string>()
    for (let i = 0; i < batch.length; i++) {
      const path = batch[i]
      const source = sources[i]
      if (!source) continue
      found.set(path, { path, source })
      for (const rel of extractRelativeImports(source)) {
        const resolved = resolveRelativeImport(path, rel, allFilePaths)
        if (resolved && !found.has(resolved) && !excludePaths.has(resolved)) {
          nextFrontier.add(resolved)
        }
      }
    }

    frontier = nextFrontier
  }

  return [...found.values()]
}

async function probeNpmRegistry(name: string, version: string): Promise<boolean> {
  try {
    // encodeURIComponent handles scoped packages (`@scope/pkg` → `%40scope%2Fpkg`),
    // which CouchDB-spec registries (Verdaccio etc.) require as a single path
    // segment. AbortSignal.timeout bounds the probe so a stalled registry can't
    // hang Stage A indefinitely.
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
      { signal: AbortSignal.timeout(5_000) },
    )
    return res.ok
  } catch {
    return false
  }
}

function isStoryFile(path: string): boolean {
  return /\.stor(y|ies)\.(tsx?|jsx?)$/.test(path)
}

async function batchFetch<T>(
  items: string[],
  concurrency: number,
  fn: (item: string) => Promise<T | null>,
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(items.length).fill(null)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx]).catch(() => null)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

export async function scanComponents(
  owner: string,
  name: string,
  branch: string,
): Promise<ComponentScanResult> {
  const safe = /^[\w.\-]+$/
  if (!safe.test(owner) || !safe.test(name) || !safe.test(branch)) {
    return { framework: 'unknown', components: [], stories: [], helpers: [], pkg: null, error: null }
  }

  try {
    const token = getToken() ?? null

    // Stage A: package.json — framework + maybe pkg
    let framework: Framework = 'unknown'
    let pkg: { name: string; version: string } | null = null
    const pkgSource = await getFileContent(token, owner, name, 'package.json').catch(() => null)
    if (pkgSource) {
      try {
        const parsed = JSON.parse(pkgSource) as {
          name?: string; version?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }
        const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) }
        framework = detectFramework(deps)
        if (parsed.name && parsed.version) {
          if (await probeNpmRegistry(parsed.name, parsed.version)) {
            pkg = { name: parsed.name, version: parsed.version }
          }
        }
      } catch { /* malformed package.json */ }
    }

    // Stage B: file tree
    const tree = await getRepoTree(token, owner, name, branch).catch(() => null)
    if (!tree) {
      return { framework, components: [], stories: [], helpers: [], pkg, error: 'network' }
    }
    const filePaths = tree.filter(n => n.type === 'blob').map(n => n.path)
    const filePathSet = new Set(filePaths)

    if (framework === 'unknown') framework = detectFrameworkFromTree(filePaths)

    // Stage C: candidates (cap components at 50, stories at 30 → 80 source fetches max)
    const componentCandidates = filePaths
      .filter(p => isComponentFile(p, framework))
      .slice(0, 50)
    const storyCandidates = filePaths
      .filter(p => isStoryFile(p))
      .slice(0, 30)

    // Stage D: parallel fetch with 30s overall timeout
    let timerHandle: ReturnType<typeof setTimeout> | undefined
    const fetched = await Promise.race([
      Promise.all([
        batchFetch(componentCandidates, 10, p => getFileContent(token, owner, name, p).catch(() => null)),
        batchFetch(storyCandidates,     10, p => getFileContent(token, owner, name, p).catch(() => null)),
      ]),
      new Promise<null>(resolve => { timerHandle = setTimeout(() => resolve(null), 30_000) }),
    ])
    if (timerHandle !== undefined) clearTimeout(timerHandle)

    if (fetched === null) {
      return { framework, components: [], stories: [], helpers: [], pkg, error: 'timeout' }
    }

    const [componentSources, storySources] = fetched
    const components: ScannedComponent[] = componentCandidates
      .map((path, i) => ({ path, source: componentSources[i] ?? '' }))
      .filter(c => c.source.length > 0)
    const stories: ScannedStory[] = storyCandidates
      .map((path, i) => ({ path, source: storySources[i] ?? '' }))
      .filter(s => s.source.length > 0)

    // Stage E: recursively fetch helper files that components import. These
    // are inlined into the source-tier iframe at render time so calls like
    // `parseLengthAndUnit(15)` actually run instead of getting null-stubbed.
    // Only react/solid benefit (those tiers use the inlining pipeline);
    // for other frameworks we skip the work.
    let helpers: ScannedHelper[] = []
    if (framework === 'react' || framework === 'solid') {
      const excludePaths = new Set(componentCandidates)
      helpers = await scanHelpers(
        components,
        filePathSet,
        excludePaths,
        path => getFileContent(token, owner, name, path).catch(() => null),
      )
    }

    return { framework, components, stories, helpers, pkg, error: null }
  } catch {
    return { framework: 'unknown', components: [], stories: [], helpers: [], pkg: null, error: 'network' }
  }
}

export function registerComponentsIPC(): void {
  ipcMain.handle(
    'components:scan',
    (_event, owner: string, name: string, branch: string) =>
      scanComponents(owner, name, branch),
  )

  ipcMain.handle(
    'components:compile',
    async (_event, source: string, framework = 'react'): Promise<string | null> => {
      try {
        // Use require() — the main process output is CJS, and esbuild ships a
        // native binary that must not be bundled.  Dynamic import() can silently
        // fail in Rollup/CJS contexts; require() is always reliable here.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { transform } = require('esbuild') as typeof import('esbuild')

        let loader: import('esbuild').Loader
        let jsx: import('esbuild').TransformOptions['jsx']
        let jsxImportSource: string | undefined

        if (framework === 'solid') {
          loader = 'tsx'
          jsx = 'automatic'
          jsxImportSource = 'solid-js'
        } else if (framework === 'angular' || framework === 'typescript') {
          loader = 'ts'
          jsx = undefined
          jsxImportSource = undefined
        } else {
          // react (default) and anything else
          loader = 'tsx'
          jsx = 'automatic'
          jsxImportSource = 'react'
        }

        const result = await transform(source, {
          loader,
          ...(jsx !== undefined ? { jsx } : {}),
          ...(jsxImportSource !== undefined ? { jsxImportSource } : {}),
          target:    'es2020',
          format:    'esm',
          sourcemap: false,
        })
        return result.code
      } catch (err) {
        console.error('[components:compile] esbuild transform failed:', err)
        return null
      }
    },
  )
}
