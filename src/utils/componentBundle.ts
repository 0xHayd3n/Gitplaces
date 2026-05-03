// src/utils/componentBundle.ts
import type { ComponentScanResult, BundledRender, RenderTier } from '../types/components'
import type { ParsedComponent } from './componentParser'

// Module-scope cache, keyed per package@version. Entries are populated
// regardless of which component triggered the lookup, so every component in
// the same package reuses the same export set.
type CacheEntry = { exports: Set<string>; cssUrls: string[] }
const bundleCache = new Map<string, CacheEntry>()

export function resetBundleCache(): void {
  bundleCache.clear()
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
  if (!entry.exports.has(component.name)) return { tier: 'source' }

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

  const exports = await probeExports(name, version)
  if (!exports) return null

  const cssUrls = await probeCssUrls(name, version)
  const entry: CacheEntry = { exports, cssUrls }
  bundleCache.set(key, entry)
  return entry
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
  const found: string[] = []
  for (const path of CSS_PROBE_PATHS) {
    const url = `https://esm.sh/${name}@${version}${path}`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) found.push(url)
    } catch {
      // network error → skip
    }
  }
  return found
}

export type { RenderTier }
