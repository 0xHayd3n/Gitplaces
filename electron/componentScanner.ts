// electron/componentScanner.ts
import { ipcMain } from 'electron'
import { getToken } from './store'
import { getRepoTree, getFileContent } from './github'
import { detectFramework, detectFrameworkFromTree, isComponentFile } from '../src/utils/componentScanner'
import type { ComponentScanResult, Framework, ScannedComponent, ScannedStory } from '../src/types/components'

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
    return { framework: 'unknown', components: [], stories: [], pkg: null, error: null }
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
      return { framework, components: [], stories: [], pkg, error: 'network' }
    }
    const filePaths = tree.filter(n => n.type === 'blob').map(n => n.path)

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
      return { framework, components: [], stories: [], pkg, error: 'timeout' }
    }

    const [componentSources, storySources] = fetched
    const components: ScannedComponent[] = componentCandidates
      .map((path, i) => ({ path, source: componentSources[i] ?? '' }))
      .filter(c => c.source.length > 0)
    const stories: ScannedStory[] = storyCandidates
      .map((path, i) => ({ path, source: storySources[i] ?? '' }))
      .filter(s => s.source.length > 0)

    return { framework, components, stories, pkg, error: null }
  } catch {
    return { framework: 'unknown', components: [], stories: [], pkg: null, error: 'network' }
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
