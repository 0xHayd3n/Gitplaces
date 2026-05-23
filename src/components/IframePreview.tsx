// src/components/IframePreview.tsx
//
// Renders the iframe state machine for one component preview, WITHOUT any
// outer card chrome. Always-on once mounted: the parent decides when to
// mount it (gallery hover, detail-view scroll-into-view, etc.).
//
// This is the core of what `ComponentCard` used to do — extracted so the
// gallery and the detail view can both share the iframe-loading logic
// without forcing the gallery's button-shaped wrapper to swap element
// types when hover state changes (an element swap unmounts whatever's
// under the cursor and triggers a spurious mouseleave, which made the
// previous hover-to-preview implementation oscillate between live and
// static state and never settle).
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import {
  compileForIframe,
  buildHtmlFromCompiled,
  buildBundledIframeHtml,
  type HelperSources,
} from '../utils/iframeTemplate'

// ---------------------------------------------------------------------------
// Render concurrency cap.
//
// Each iframe loads cdn.tailwindcss.com (Tailwind JIT runs in-iframe) plus
// react / the package / framer-motion etc. from esm.sh. All of that JS
// executes on the renderer process's single main thread. Mounting many
// iframes at once cumulatively saturates the thread; one whose stub-context
// render doesn't yield can hang the renderer outright.
//
// Three mechanisms keep things responsive:
//
//  1. **Concurrency = 1** — only one iframe is in its loading + initial-
//     render phase at a time. A material-tailwind iframe parses ~1.5MB of
//     JS; at any concurrency >1 two iframes' module-script work overlaps
//     on the single main thread and the UI freezes.
//
//  2. **Slot release on `render-settled` postMessage** — the iframe
//     template emits this from inside its module script after
//     `createRoot.render(...)` has had a beat to commit. `onLoad` is too
//     early because it fires before deferred module scripts run.
//
//  3. **`requestAnimationFrame` between releases** — when one slot
//     releases, the next waiter is scheduled via rAF rather than fired
//     synchronously, so the renderer gets a guaranteed paint frame
//     between iframe loads.
//
// `RENDER_SAFETY_TIMEOUT` releases a slot after 8s if the iframe's module
// script never reaches the render tail (broken HTML, import error). The
// card stays in 'rendering' state visually, but the queue keeps moving.
const MAX_CONCURRENT_RENDERS = 1
const RENDER_SAFETY_TIMEOUT_MS = 8_000

let activeRenderCount = 0
const renderWaiters: Array<() => void> = []

function acquireRenderSlot(): Promise<void> {
  if (activeRenderCount < MAX_CONCURRENT_RENDERS) {
    activeRenderCount++
    return Promise.resolve()
  }
  return new Promise(resolve => {
    renderWaiters.push(() => {
      activeRenderCount++
      resolve()
    })
  })
}

const scheduleNext: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16)

function releaseRenderSlot(): void {
  activeRenderCount = Math.max(0, activeRenderCount - 1)
  const next = renderWaiters.shift()
  if (next) scheduleNext(next)
}

interface Props {
  component: ParsedComponent
  variant: Variant
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  helpers?: HelperSources
  hasTailwind?: boolean
  // Called when the user clicks "View source" on a failed preview.
  onSourceClick?: () => void
  // Called when both render tiers fail terminally.
  onRenderFailed?: () => void
}

type State = 'rendering' | 'rendered' | 'failed'

export function IframePreview({
  component, variant, tier, bundled, theme, source, helpers, hasTailwind = false,
  onSourceClick, onRenderFailed,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [currentTier, setCurrentTier] = useState<RenderTier>(tier)
  const [state, setState] = useState<State>('rendering')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const triedTiersRef = useRef<Set<RenderTier>>(new Set())
  const slotHeldRef = useRef(false)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function releaseHeldSlot(): void {
    if (slotHeldRef.current) {
      slotHeldRef.current = false
      releaseRenderSlot()
    }
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
  }

  // Cache the compile output so theme/variant changes don't re-IPC esbuild.
  const compileCacheRef = useRef<{
    source: string
    helpers: HelperSources | undefined
    tier: RenderTier
    prepared: string
  } | null>(null)

  // If the parent re-resolves and passes a new tier, reset fallback state.
  useEffect(() => {
    setCurrentTier(tier)
    triedTiersRef.current = new Set()
    setErrorMessage(null)
  }, [tier])

  useEffect(() => {
    let cancelled = false
    setState('rendering')
    triedTiersRef.current.add(currentTier)
    releaseHeldSlot()

    const themedProps = applyThemeOverrides(variant.props, theme)

    function publishHtml(html: string) {
      if (cancelled) return
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      setBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    }

    function runRender(): void {
      if (currentTier === 'bundled' && bundled) {
        const html = buildBundledIframeHtml(bundled, JSON.stringify(themedProps), theme, hasTailwind)
        publishHtml(html)
        return
      }

      const cache = compileCacheRef.current
      const cacheValid = cache !== null
        && cache.source === source
        && cache.helpers === helpers
        && cache.tier === currentTier

      if (cacheValid) {
        const html = buildHtmlFromCompiled(component, cache.prepared, themedProps, theme, hasTailwind)
        if (html) {
          publishHtml(html)
        } else if (!cancelled) {
          setErrorMessage(`Compile returned null (${currentTier} tier)`)
          handleTierFailure()
        }
        return
      }

      void compileForIframe(component, source, helpers).then(prepared => {
        if (cancelled) return
        if (prepared === null) {
          setErrorMessage(`Component is not renderable (${currentTier} tier)`)
          handleTierFailure()
          return
        }
        if (typeof prepared !== 'string') {
          setErrorMessage(prepared.error)
          handleTierFailure()
          return
        }
        compileCacheRef.current = { source, helpers, tier: currentTier, prepared }
        const html = buildHtmlFromCompiled(component, prepared, themedProps, theme, hasTailwind)
        if (html) {
          publishHtml(html)
        } else {
          setErrorMessage(`Compile returned null (${currentTier} tier)`)
          handleTierFailure()
        }
      })
    }

    // StrictMode: dev double-invocation runs effect → cleanup → effect.
    // The slow-path acquire only increments `activeRenderCount` inside the
    // waiter callback (not at enqueue), so a queued-then-cancelled acquire
    // bypasses the increment via its `cancelled` branch. The fast path's
    // increment is reversed by the same `cancelled → releaseRenderSlot()`.
    acquireRenderSlot().then(() => {
      if (cancelled) {
        releaseRenderSlot()
        return
      }
      slotHeldRef.current = true
      safetyTimerRef.current = setTimeout(releaseHeldSlot, RENDER_SAFETY_TIMEOUT_MS)
      runRender()
    }).catch(err => {
      console.error('[IframePreview] render slot path threw:', err)
      releaseHeldSlot()
    })

    return () => {
      cancelled = true
      releaseHeldSlot()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTier, theme, component, source, variant, bundled, helpers])

  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'render-settled') {
        releaseHeldSlot()
        return
      }
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
    releaseHeldSlot()
    onRenderFailed?.()
  }

  function handleLoad() {
    if (state === 'rendering') setState('rendered')
  }

  if (state === 'failed') {
    return (
      <div className="cg-card-failed">
        <div>Preview failed</div>
        {errorMessage && (
          <div className="cg-card-failed-msg" title={errorMessage}>{errorMessage}</div>
        )}
        {onSourceClick && (
          <button onClick={(e) => { e.stopPropagation(); onSourceClick() }}>View source</button>
        )}
      </div>
    )
  }

  if (blobUrl) {
    return (
      <iframe
        ref={iframeRef}
        src={blobUrl}
        sandbox="allow-scripts"
        onLoad={handleLoad}
        title={`${component.name} preview`}
      />
    )
  }

  return (
    <div className="cg-card-skeleton">
      {state === 'rendering' ? `Rendering (${currentTier})…` : 'Building…'}
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
