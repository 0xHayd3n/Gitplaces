// src/components/ComponentCard.tsx
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import {
  compileForIframe,
  buildHtmlFromCompiled,
  buildBundledIframeHtml,
  type HelperSources,
} from '../utils/iframeTemplate'

interface Props {
  component: ParsedComponent
  variant: Variant
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  helpers?: HelperSources
  onClick: () => void
  onRenderFailed?: () => void
}

type State = 'idle' | 'rendering' | 'rendered' | 'failed'

export function ComponentCard({
  component, variant, tier, bundled, theme, source, helpers, onClick, onRenderFailed,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(false)
  const [currentTier, setCurrentTier] = useState<RenderTier>(tier)
  const [state, setState] = useState<State>('idle')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const triedTiersRef = useRef<Set<RenderTier>>(new Set())
  // Cache the compile output (esbuild result for React/Solid, prepared source
  // for other frameworks) so theme/variant changes don't trigger an IPC
  // round-trip + esbuild transform. Cache key is reference identity on
  // (source, helpers, tier) which is stable across renders that don't
  // actually change those inputs.
  const compileCacheRef = useRef<{
    source: string
    helpers: HelperSources | undefined
    tier: RenderTier
    prepared: string
  } | null>(null)

  // If the parent re-resolves and passes a new tier (e.g. after a re-scan),
  // reset the per-card fallback state so the card honors the new tier instead
  // of being stuck on whatever was selected at first mount.
  useEffect(() => {
    setCurrentTier(tier)
    triedTiersRef.current = new Set()
    setErrorMessage(null)
  }, [tier])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ob = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true)
        ob.disconnect()
      }
    }, { rootMargin: '400px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setState('rendering')
    triedTiersRef.current.add(currentTier)

    // Override black-by-default color props to white in dark mode. Many
    // libraries (most spinners, simple icon sets) ship with `color = '#000'`
    // baked into the destructure, which renders invisibly on the dark iframe
    // background. Swap to white so the component is visible.
    const themedProps = applyThemeOverrides(variant.props, theme)

    function publishHtml(html: string) {
      if (cancelled) return
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      setBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    }

    const cleanup = () => { cancelled = true }

    // Bundled tier: no compile step, just template the HTML directly.
    if (currentTier === 'bundled' && bundled) {
      const html = buildBundledIframeHtml(bundled, JSON.stringify(themedProps), theme)
      publishHtml(html)
      return cleanup
    }

    // Source tier: try the compile cache first. A theme/variant change
    // re-runs this effect but doesn't invalidate the prepared source, so we
    // skip the IPC + esbuild transform entirely on cache hits.
    const cache = compileCacheRef.current
    const cacheValid = cache !== null
      && cache.source === source
      && cache.helpers === helpers
      && cache.tier === currentTier

    if (cacheValid) {
      const html = buildHtmlFromCompiled(component, cache.prepared, themedProps, theme)
      if (html) {
        publishHtml(html)
      } else if (!cancelled) {
        setErrorMessage(`Compile returned null (${currentTier} tier)`)
        handleTierFailure()
      }
      return cleanup
    }

    void compileForIframe(component, source, helpers).then(prepared => {
      if (cancelled) return
      if (prepared === null) {
        setErrorMessage(`Compile returned null (${currentTier} tier)`)
        handleTierFailure()
        return
      }
      compileCacheRef.current = { source, helpers, tier: currentTier, prepared }
      const html = buildHtmlFromCompiled(component, prepared, themedProps, theme)
      if (html) {
        publishHtml(html)
      } else {
        setErrorMessage(`Compile returned null (${currentTier} tier)`)
        handleTierFailure()
      }
    })

    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentTier, theme, component, source, variant, bundled, helpers])

  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  // TODO: The two-tier failure handshake (bundled → source → failed) is difficult
  // to unit-test because jsdom iframes have null contentWindow, so the e.source
  // check always fails in tests. Covered by Task 14 manual verification.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type !== 'render-error') return
      const failedTier = (e.data.tier as RenderTier | undefined) ?? currentTier
      if (failedTier !== currentTier) return
      const msg = typeof e.data.message === 'string' ? e.data.message : null
      if (msg) setErrorMessage(msg.split('\n')[0])
      handleTierFailure()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTier])

  function handleTierFailure() {
    if (currentTier === 'bundled' && !triedTiersRef.current.has('source')) {
      setCurrentTier('source')
      setState('rendering')
      return
    }
    setState('failed')
    onRenderFailed?.()
  }

  function handleLoad() {
    if (state === 'rendering') setState('rendered')
  }

  return (
    <div ref={wrapRef} className="cg-card" data-theme={theme} onClick={onClick}>
      <div className="cg-card-name">{component.name}</div>
      <div className="cg-card-frame">
        {state === 'failed' ? (
          <div className="cg-card-failed">
            <div>Preview failed</div>
            {errorMessage && (
              <div className="cg-card-failed-msg" title={errorMessage}>{errorMessage}</div>
            )}
            <button onClick={(e) => { e.stopPropagation(); onClick() }}>View source</button>
          </div>
        ) : visible && blobUrl ? (
          <iframe
            ref={iframeRef}
            src={blobUrl}
            sandbox="allow-scripts"
            onLoad={handleLoad}
            title={`${component.name} preview`}
          />
        ) : (
          <div className="cg-card-skeleton">
            {state === 'rendering'
              ? `Rendering (${currentTier})…`
              : visible
                ? 'Building…'
                : ''}
          </div>
        )}
      </div>
    </div>
  )
}

const BLACK_COLOR_VALUE = /^(#0{3}|#0{6}|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*1\s*\))$/i

function applyThemeOverrides(
  props: Record<string, unknown>,
  theme: 'light' | 'dark',
): Record<string, unknown> {
  if (theme !== 'dark') return props
  const colorKeys = ['color', 'background', 'backgroundColor', 'fill', 'stroke']
  let modified = false
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(props)) {
    if (colorKeys.includes(key) && typeof val === 'string' && BLACK_COLOR_VALUE.test(val)) {
      result[key] = '#fff'
      modified = true
    } else {
      result[key] = val
    }
  }
  return modified ? result : props
}
