// src/utils/componentBundle.ts
import type { ComponentScanResult, BundledRender, RenderTier } from '../types/components'
import type { ParsedComponent } from './componentParser'

// Module-scope cache, keyed per package@version. Entries are populated
// regardless of which component triggered the lookup, so every component in
// the same package reuses the same export set.
type CacheEntry = { exports: Set<string>; cssUrls: string[] }
const bundleCache = new Map<string, CacheEntry>()
// Dedup parallel `chooseRenderer` calls for the same package — without this,
// a 25-component scan races into 25 simultaneous export+CSS probes before
// any of them populates the cache, producing ~100 redundant requests.
const inflightProbes = new Map<string, Promise<CacheEntry | null>>()

export function resetBundleCache(): void {
  bundleCache.clear()
  inflightProbes.clear()
}

export type RenderChoice =
  | { tier: 'bundled'; render: BundledRender }
  | { tier: 'source' }

const BUNDLED_FRAMEWORKS = new Set(['react', 'solid'])

const CSS_PROBE_PATHS = [
  '/dist/style.css',
  '/dist/index.css',
  '/style.css',
  '/styles.css',
]

export async function chooseRenderer(
  component: ParsedComponent,
  scan: ComponentScanResult,
): Promise<RenderChoice> {
  if (!scan.pkg) return { tier: 'source' }
  if (!BUNDLED_FRAMEWORKS.has(scan.framework)) return { tier: 'source' }

  const cacheKey = `${scan.pkg.name}@${scan.pkg.version}`
  const entry = await ensureCacheEntry(cacheKey, scan.pkg.name, scan.pkg.version)
  if (!entry) return { tier: 'source' }
  // Lenient membership check: if our parser couldn't find any named exports
  // (common for packages whose esm.sh entrypoint is just `export * from "..."`,
  // which we don't follow), assume the component name is valid and let the
  // iframe render attempt confirm. If the export doesn't actually exist,
  // the iframe will postMessage a render-error and ComponentCard falls back
  // to the source tier. Better than always rejecting.
  if (entry.exports.size > 0 && !entry.exports.has(component.name)) {
    return { tier: 'source' }
  }

  return {
    tier: 'bundled',
    render: {
      importUrl:  `https://esm.sh/${scan.pkg.name}@${scan.pkg.version}`,
      exportName: component.name,
      cssUrls:    entry.cssUrls,
    },
  }
}

async function ensureCacheEntry(
  key: string,
  name: string,
  version: string,
): Promise<CacheEntry | null> {
  const cached = bundleCache.get(key)
  if (cached) return cached

  const inflight = inflightProbes.get(key)
  if (inflight) return inflight

  const probe = (async (): Promise<CacheEntry | null> => {
    try {
      const exports = await probeExports(name, version)
      if (!exports) return null
      const cssUrls = await probeCssUrls(name, version)
      const entry: CacheEntry = { exports, cssUrls }
      bundleCache.set(key, entry)
      return entry
    } finally {
      inflightProbes.delete(key)
    }
  })()
  inflightProbes.set(key, probe)
  return probe
}

async function probeExports(name: string, version: string): Promise<Set<string> | null> {
  // esm.sh's `?bundle&list-exports` returns the bundle source with named exports.
  const url = `https://esm.sh/${name}@${version}?bundle&list-exports`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const text = await res.text()
    return parseExports(text)
  } catch {
    return null
  }
}

function parseExports(source: string): Set<string> {
  const set = new Set<string>()
  const re = /export\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim()
      if (!part) continue
      const renamed = part.split(/\s+as\s+/)
      const name = (renamed[1] ?? renamed[0]).trim()
      if (name) set.add(name)
    }
  }
  const declRe = /export\s+(?:const|function|class)\s+(\w+)/g
  while ((m = declRe.exec(source)) !== null) set.add(m[1])
  return set
}

async function probeCssUrls(name: string, version: string): Promise<string[]> {
  // Run all probes in parallel — they're independent and we keep whichever
  // ones came back 200. Order is preserved by indexing into CSS_PROBE_PATHS.
  const results = await Promise.all(CSS_PROBE_PATHS.map(async path => {
    const url = `https://esm.sh/${name}@${version}${path}`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      return res.ok ? url : null
    } catch {
      return null
    }
  }))
  return results.filter((u): u is string => u !== null)
}

export type { RenderTier }
