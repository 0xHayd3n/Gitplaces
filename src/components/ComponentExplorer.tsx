// src/components/ComponentExplorer.tsx
import { useState, useEffect, useMemo } from 'react'
import type { ComponentScanResult, Variant, RenderTier, BundledRender } from '../types/components'
import { parseComponent, type ParsedComponent } from '../utils/componentParser'
import { generateProps } from '../utils/propsGenerator'
import { generateVariants } from '../utils/variantGenerator'
import { parseStoryFile, resolveStoryComponent } from '../utils/storyParser'
import { chooseRenderer, resetBundleCache } from '../utils/componentBundle'
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

      const tiers: Record<string, RenderTier> = {}
      const bundled: Record<string, BundledRender> = {}
      await Promise.all(parsed.map(async c => {
        const choice = await chooseRenderer(c, scan)
        tiers[c.path] = choice.tier
        if (choice.tier === 'bundled') bundled[c.path] = choice.render
      }))

      if (cancelled) return
      setComponents(parsed)
      setSourceByPath(sources)
      setVariantsByPath(variants)
      setTierByPath(tiers)
      setBundledByPath(bundled)
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
            title="Toggle theme"
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
            onBack={() => setSelectedPath(null)}
          />
        ) : (
          <ComponentGallery
            components={components}
            variantsByPath={variantsByPath}
            tierByPath={tierByPath}
            bundledByPath={bundledByPath}
            sourceByPath={sourceByPath}
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
