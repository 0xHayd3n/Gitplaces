// src/components/ComponentCard.tsx
import { useEffect, useRef, useState } from 'react'
import type { ParsedComponent } from '../utils/componentParser'
import type { Variant, RenderTier, BundledRender } from '../types/components'
import { buildIframeHtml, buildBundledIframeHtml } from '../utils/iframeTemplate'

interface Props {
  component: ParsedComponent
  variant: Variant
  tier: RenderTier
  bundled?: BundledRender
  theme: 'light' | 'dark'
  source: string
  onClick: () => void
}

type State = 'idle' | 'rendering' | 'rendered' | 'failed'

export function ComponentCard({
  component, variant, tier, bundled, theme, source, onClick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(false)
  const [currentTier, setCurrentTier] = useState<RenderTier>(tier)
  const [state, setState] = useState<State>('idle')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const triedTiersRef = useRef<Set<RenderTier>>(new Set())

  // If the parent re-resolves and passes a new tier (e.g. after a re-scan),
  // reset the per-card fallback state so the card honors the new tier instead
  // of being stuck on whatever was selected at first mount.
  useEffect(() => {
    setCurrentTier(tier)
    triedTiersRef.current = new Set()
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

    const buildHtml = currentTier === 'bundled' && bundled
      ? Promise.resolve(buildBundledIframeHtml(bundled, JSON.stringify(variant.props), theme))
      : buildIframeHtml(component, source, variant.props, theme)

    void buildHtml.then(html => {
      if (cancelled || !html) {
        if (!cancelled) handleTierFailure()
        return
      }
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      setBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentTier, theme, component, source, variant, bundled])

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
  }

  function handleLoad() {
    if (state === 'rendering') setState('rendered')
  }

  return (
    <div ref={wrapRef} className="cg-card" onClick={onClick}>
      <div className="cg-card-name">{component.name}</div>
      <div className="cg-card-frame">
        {state === 'failed' ? (
          <div className="cg-card-failed">
            <div>Preview failed</div>
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
          <div className="cg-card-skeleton" />
        )}
      </div>
    </div>
  )
}
