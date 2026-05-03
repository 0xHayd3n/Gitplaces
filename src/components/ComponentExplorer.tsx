// src/components/ComponentExplorer.tsx
import { useState, useEffect, useMemo } from 'react'
import type { ComponentScanResult, Variant, RenderTier, BundledRender } from '../types/components'
import { parseComponent, type ParsedComponent } from '../utils/componentParser'
import { generateProps } from '../utils/propsGenerator'
import { generateVariants } from '../utils/variantGenerator'
import { parseStoryFile, resolveStoryComponent } from '../utils/storyParser'
import { chooseRenderer, resetBundleCache } from '../utils/componentBundle'
import type { HelperSources } from '../utils/iframeTemplate'
import { ComponentSidebar } from './ComponentSidebar'
import { ComponentGallery } from './ComponentGallery'
import { ComponentDetailView } from './ComponentDetailView'
import './ComponentExplorer.css'

interface Props {
  owner: string
  name: string
  branch: string
}

type ScanState = 'scanning' | 'done' | 'error'

export default function ComponentExplorer({ owner, name, branch }: Props) {
  const [scanState, setScanState] = useState<ScanState>('scanning')
  const [scanError, setScanError] = useState<ComponentScanResult['error']>(null)
  const [components, setComponents] = useState<ParsedComponent[]>([])
  const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({})
  const [variantsByPath, setVariantsByPath] = useState<Record<string, Variant[]>>({})
  const [tierByPath, setTierByPath] = useState<Record<string, RenderTier>>({})
  const [bundledByPath, setBundledByPath] = useState<Record<string, BundledRender>>({})
  const [helpers, setHelpers] = useState<HelperSources | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setScanState('scanning')
    setScanError(null)
    setComponents([])
    setSourceByPath({})
    setVariantsByPath({})
    setTierByPath({})
    setBundledByPath({})
    setHelpers(null)
    setSelectedPath(null)
    resetBundleCache()

    void window.api.components.scan(owner, name, branch).then(async (scan: ComponentScanResult) => {
      if (cancelled) return
      if (scan.error) {
        setScanState('error')
        setScanError(scan.error)
        return
      }
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

      if (cancelled) return

      const tiers: Record<string, RenderTier> = {}
      const bundled: Record<string, BundledRender> = {}
      await Promise.all(parsed.map(async c => {
        const choice = await chooseRenderer(c, scan)
        tiers[c.path] = choice.tier
        if (choice.tier === 'bundled') bundled[c.path] = choice.render
      }))

      if (cancelled) return
      // Build the helpers map (path → source) once per scan. ComponentCard
      // will look up its component's relative imports against this map and
      // inline anything that resolves, instead of stubbing it as null.
      const helpersByPath: Record<string, string> = {}
      for (const h of scan.helpers ?? []) helpersByPath[h.path] = h.source

      setComponents(parsed)
      setSourceByPath(sources)
      setVariantsByPath(variants)
      setTierByPath(tiers)
      setBundledByPath(bundled)
      setHelpers(Object.keys(helpersByPath).length > 0 ? { byPath: helpersByPath } : null)
      setScanState('done')
    }).catch(() => {
      if (!cancelled) {
        setScanState('error')
        setScanError('network')
      }
    })

    return () => { cancelled = true }
  }, [owner, name, branch])

  const selectedComponent = useMemo(
    () => components.find(c => c.path === selectedPath) ?? null,
    [components, selectedPath],
  )

  if (scanState === 'scanning') {
    return <div className="cg-empty"><span>Scanning components…</span></div>
  }
  if (scanState === 'error') {
    return (
      <div className="cg-empty">
        <span>{errorMessageFor(scanError)}</span>
      </div>
    )
  }
  if (components.length === 0) {
    return <div className="cg-empty"><span>No components found.</span></div>
  }

  return (
    <div className="cg-explorer">
      <ComponentSidebar
        components={components.map(c => ({ path: c.path, name: c.name }))}
        selectedPath={selectedPath}
        searchQuery={searchQuery}
        onSelectPath={setSelectedPath}
        onClearSelection={() => setSelectedPath(null)}
        onSearchChange={setSearchQuery}
      />
      <main className="cg-main">
        <div className="cg-topbar">
          <button
            className="cg-theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {selectedComponent && (
            <a
              className="cg-gh-link"
              href={`https://github.com/${owner}/${name}/blob/${branch}/${selectedComponent.path}`}
              target="_blank"
              rel="noreferrer"
            >Open on GitHub ↗</a>
          )}
        </div>
        {selectedComponent ? (
          <ComponentDetailView
            component={selectedComponent}
            variants={variantsByPath[selectedComponent.path] ?? []}
            tier={tierByPath[selectedComponent.path] ?? 'source'}
            bundled={bundledByPath[selectedComponent.path]}
            theme={theme}
            source={sourceByPath[selectedComponent.path] ?? ''}
            helpers={helpers ?? undefined}
            onBack={() => setSelectedPath(null)}
          />
        ) : (
          <ComponentGallery
            components={components}
            variantsByPath={variantsByPath}
            tierByPath={tierByPath}
            bundledByPath={bundledByPath}
            sourceByPath={sourceByPath}
            helpers={helpers ?? undefined}
            theme={theme}
            onSelect={setSelectedPath}
          />
        )}
      </main>
    </div>
  )
}

function errorMessageFor(error: ComponentScanResult['error']): string {
  if (error === 'rate-limit') return 'GitHub rate limit hit. Try again in a few minutes.'
  if (error === 'timeout')    return 'Repo too large to scan.'
  return "Couldn't reach GitHub."
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
