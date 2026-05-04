// src/utils/componentScan.ts
//
// Scan + post-process orchestration shared between ComponentExplorer (the
// lazy-loaded UI) and RepoDetail (which prefetches on idle so the gallery
// is warm when the user clicks the Components tab).
//
// Lives in a standalone module — not inside ComponentExplorer.tsx — because
// importing ComponentExplorer eagerly would defeat its `lazy()` boundary.
// This file deliberately has no React imports.

import type { ComponentScanResult, Variant, RenderTier, BundledRender } from '../types/components'
import { parseComponent, type ParsedComponent } from './componentParser'
import { generateProps } from './propsGenerator'
import { generateVariants } from './variantGenerator'
import { parseStoryFile, resolveStoryComponent } from './storyParser'
import { chooseRenderer } from './componentBundle'
import type { HelperSources } from './iframeTemplate'

export type CachedScan = {
  components: ParsedComponent[]
  sourceByPath: Record<string, string>
  variantsByPath: Record<string, Variant[]>
  tierByPath: Record<string, RenderTier>
  bundledByPath: Record<string, BundledRender>
  helpers: HelperSources | null
  hasTailwind: boolean
  timestamp: number
}

export type ScanResult =
  | { ok: true; cached: CachedScan }
  | { ok: false; error: ComponentScanResult['error'] }

const SCAN_CACHE_TTL_MS = 5 * 60 * 1000
const scanCache = new Map<string, CachedScan>()
// Dedupe parallel scans for the same key — without this, an idle prefetch
// firing right as the user clicks the Components tab would run two scans.
const inflightScans = new Map<string, Promise<ScanResult>>()

function cacheKey(owner: string, name: string, branch: string): string {
  return `${owner}/${name}/${branch}`
}

export function getCachedScan(owner: string, name: string, branch: string): CachedScan | null {
  const entry = scanCache.get(cacheKey(owner, name, branch))
  if (!entry) return null
  if (Date.now() - entry.timestamp > SCAN_CACHE_TTL_MS) {
    scanCache.delete(cacheKey(owner, name, branch))
    return null
  }
  return entry
}

// Single entry point for "scan this repo and produce a CachedScan". Caches
// the result on success, dedupes concurrent calls for the same key, and
// returns the cached value when one is already available.
export function performComponentScan(
  owner: string, name: string, branch: string,
): Promise<ScanResult> {
  const key = cacheKey(owner, name, branch)

  const cached = getCachedScan(owner, name, branch)
  if (cached) return Promise.resolve({ ok: true, cached })

  const inflight = inflightScans.get(key)
  if (inflight) return inflight

  const promise = doScanAndProcess(owner, name, branch, key)
    .finally(() => { inflightScans.delete(key) })
  inflightScans.set(key, promise)
  return promise
}

async function doScanAndProcess(
  owner: string, name: string, branch: string, key: string,
): Promise<ScanResult> {
  let scan: ComponentScanResult
  try {
    scan = await window.api.components.scan(owner, name, branch)
  } catch {
    return { ok: false, error: 'network' }
  }
  if (scan.error) return { ok: false, error: scan.error }

  const parsed = scan.components.map(c => parseComponent(c.path, c.source, scan.framework))
  const sources = Object.fromEntries(scan.components.map(c => [c.path, c.source]))

  const storyVariants = computeStoryVariants(scan, parsed)
  const variants: Record<string, Variant[]> = {}
  for (const c of parsed) {
    const fromStories = storyVariants[c.path]
    if (fromStories && fromStories.length > 0) {
      variants[c.path] = fromStories
    } else {
      const auto = generateVariants(c)
      variants[c.path] = auto.length > 0
        ? auto
        : [{ name: 'default', props: generateProps(c.props), source: 'default' }]
    }
  }

  const tiers: Record<string, RenderTier> = {}
  const bundled: Record<string, BundledRender> = {}
  await Promise.all(parsed.map(async c => {
    const choice = await chooseRenderer(c, scan)
    tiers[c.path] = choice.tier
    if (choice.tier === 'bundled') bundled[c.path] = choice.render
  }))

  const helpersByPath: Record<string, string> = {}
  for (const h of scan.helpers ?? []) helpersByPath[h.path] = h.source
  const helpers = Object.keys(helpersByPath).length > 0 ? { byPath: helpersByPath } : null

  const cached: CachedScan = {
    components: parsed,
    sourceByPath: sources,
    variantsByPath: variants,
    tierByPath: tiers,
    bundledByPath: bundled,
    helpers,
    hasTailwind: scan.hasTailwind,
    timestamp: Date.now(),
  }
  scanCache.set(key, cached)
  return { ok: true, cached }
}

function computeStoryVariants(
  scan: ComponentScanResult,
  parsed: ParsedComponent[],
): Record<string, Variant[]> {
  const componentPaths = parsed.map(p => p.path)
  const result: Record<string, Variant[]> = {}
  for (const story of scan.stories) {
    const file = parseStoryFile(story.path, story.source)
    if (!file) continue
    const targetPath = resolveStoryComponent(story.path, file.componentImportPath, componentPaths)
    if (!targetPath) continue
    result[targetPath] = file.stories.map(s => ({
      name: s.name,
      props: s.args,
      source: 'story' as const,
    }))
  }
  return result
}
