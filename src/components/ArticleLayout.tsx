// src/components/ArticleLayout.tsx
import React, { useRef, useState, useEffect } from 'react'
import './ArticleLayout.css'

export type ArticleLayoutProps = {
  byline: React.ReactNode
  title: React.ReactNode
  /** Optional right-side content on the title row (e.g. metadata pills) */
  titleExtras?: React.ReactNode
  /** Optional description line below the title row */
  description?: React.ReactNode
  tabs: React.ReactNode
  body: React.ReactNode
  actionRow: React.ReactNode
  /** Optional content rendered between the action row and the tabs divider (e.g. inline clone panel) */
  actionRowExtras?: React.ReactNode
  /** Optional nav/breadcrumb bar rendered above the byline */
  navBar?: React.ReactNode
  /** Optional dithered banner rendered between byline and title */
  dither?: React.ReactNode
  /** When true, body renders without internal padding (for Files / Components tabs) */
  fullBleedBody?: boolean
  /** When true, collapses the banner to a compact title strip (for Files tab) */
  collapsedHeader?: boolean
  /** Forwarded ref to the scroll container (the .article-layout element itself) */
  scrollRef?: React.RefObject<HTMLDivElement>
  /** When provided, body renders as two columns: content | divider | toc. Pass only on readme tab. */
  tocSlot?: React.ReactNode
  /** When provided, body renders a right-hand panel mirroring the TOC slot layout. Pass only on readme tab. */
  statsSlot?: React.ReactNode
  /** @deprecated no longer used — kept for backwards compat with callers */
  bodyScrollRef?: React.RefObject<HTMLDivElement>
}

export function ArticleLayout({
  byline,
  title,
  titleExtras,
  description,
  tabs,
  body,
  actionRow,
  actionRowExtras,
  navBar,
  dither,
  fullBleedBody = false,
  collapsedHeader = false,
  scrollRef,
  tocSlot,
  statsSlot,
}: ArticleLayoutProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const resolvedScrollRef = scrollRef ?? internalScrollRef

  // Track whether the user has scrolled at all so the top drag strip can
  // appear only when content is scrolling under the title-bar zone (and stay
  // hidden while the banner is still anchored to the top).
  const [isScrolled, setIsScrolled] = useState(false)
  useEffect(() => {
    const el = resolvedScrollRef.current
    if (!el) return
    const update = () => setIsScrolled(el.scrollTop > 0)
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [resolvedScrollRef])

  return (
    <div
      ref={resolvedScrollRef}
      className={`article-layout${fullBleedBody ? ' article-layout--fullbleed' : ''}${(tocSlot || statsSlot) ? ' article-layout--has-toc' : ''}${collapsedHeader ? ' article-layout--collapsed-header' : ''}${isScrolled ? ' article-layout--scrolled' : ''}`}
    >
      {/* Drag strip occupies the title-bar zone (top 32px) as a window
          drag region. The navbar (back arrow + breadcrumb) was moved
          into the floating Dock at the bottom of the screen, so this
          strip is now empty by default. The `navBar` prop is still
          accepted for backwards compat with callers but is ignored. */}
      <div className="article-layout-drag-strip" />
      {void navBar /* prop preserved for caller compat; rendering moved to Dock */}
      <div className="article-layout-top">
        {!collapsedHeader && dither && <div className="article-layout-dither-bg">{dither}</div>}
        <div className="article-layout-top-panel">
          {!collapsedHeader && dither && <div className="article-layout-dither-spacer" />}
          {!collapsedHeader && (
            <div className="article-layout-title-row">
              <div className="article-layout-title">{title}</div>
              {titleExtras && <div className="article-layout-title-extras">{titleExtras}</div>}
            </div>
          )}
          {!collapsedHeader && description && <div className="article-layout-description">{description}</div>}
          {!collapsedHeader && <div className="article-layout-byline">{byline}</div>}
          {!collapsedHeader && actionRow != null && <div className="article-layout-actions">{actionRow}</div>}
          {!collapsedHeader && actionRowExtras && <div className="article-layout-action-row-extras">{actionRowExtras}</div>}
        </div>
      </div>
      <div className="article-layout-tabs-slot article-layout-sticky-top">{tabs}</div>
      <div
        className={`article-layout-body${fullBleedBody ? ' article-layout-body--full-bleed' : ''}${(tocSlot || statsSlot) ? ' article-layout-body--with-toc' : ''}`}
      >
        {(tocSlot || statsSlot) ? (
          <>
            {tocSlot && <div className="article-layout-toc-slot">{tocSlot}</div>}
            <div className="article-layout-body-content">{body}</div>
            {statsSlot && <div className="article-layout-stats-slot">{statsSlot}</div>}
          </>
        ) : body}
      </div>
    </div>
  )
}
