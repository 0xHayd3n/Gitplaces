// src/components/ComponentExplorer.tsx
import { useState, useEffect, useMemo } from 'react'
import type { ComponentScanResult, Variant, RenderTier, BundledRender } from '../types/components'
import type { ParsedComponent } from '../utils/componentParser'
import type { HelperSources } from '../utils/iframeTemplate'
import { getCachedScan, performComponentScan } from '../utils/componentScan'
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
  const [hasTailwind, setHasTailwind] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    let cancelled = false

    function applyCached(cached: ReturnType<typeof getCachedScan>): void {
      if (!cached) return
      setComponents(cached.components)
      setSourceByPath(cached.sourceByPath)
      setVariantsByPath(cached.variantsByPath)
      setTierByPath(cached.tierByPath)
      setBundledByPath(cached.bundledByPath)
      setHelpers(cached.helpers)
      setHasTailwind(cached.hasTailwind)
      setSelectedPath(null)
      setScanError(null)
      setScanState('done')
    }

    // Tab-switch / prefetch fast path: a prior mount or RepoDetail's idle
    // prefetch may have populated the cache — apply it synchronously and
    // skip the scanning UI entirely.
    const cached = getCachedScan(owner, name, branch)
    if (cached) {
      applyCached(cached)
      return
    }

    setScanState('scanning')
    setScanError(null)
    setComponents([])
    setSourceByPath({})
    setVariantsByPath({})
    setTierByPath({})
    setBundledByPath({})
    setHelpers(null)
    setHasTailwind(false)
    setSelectedPath(null)
    // Note: bundleCache is intentionally NOT reset here — it's keyed on
    // `${pkg}@${version}` which is invalidation-safe across navigations.
    // Resetting on every mount made navigating back to a previously-explored
    // repo re-probe esm.sh for every package.

    // performComponentScan dedupes if a prefetch is already in flight for
    // this key, so clicking the tab while the prefetch is running awaits
    // the same Promise instead of starting a second scan.
    void performComponentScan(owner, name, branch).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setScanState('error')
        setScanError(result.error)
        return
      }
      applyCached(result.cached)
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
    <div className="cg-explorer" data-theme={theme}>
      <ComponentSidebar
        components={components.map(c => ({ path: c.path, name: c.name }))}
        selectedPath={selectedPath}
        searchQuery={searchQuery}
        theme={theme}
        onSelectPath={setSelectedPath}
        onClearSelection={() => setSelectedPath(null)}
        onSearchChange={setSearchQuery}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
      <main className="cg-main">
        {selectedComponent ? (
          <ComponentDetailView
            component={selectedComponent}
            variants={variantsByPath[selectedComponent.path] ?? []}
            tier={tierByPath[selectedComponent.path] ?? 'source'}
            bundled={bundledByPath[selectedComponent.path]}
            theme={theme}
            source={sourceByPath[selectedComponent.path] ?? ''}
            helpers={helpers ?? undefined}
            hasTailwind={hasTailwind}
            githubUrl={`https://github.com/${owner}/${name}/blob/${branch}/${selectedComponent.path}`}
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
            hasTailwind={hasTailwind}
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
