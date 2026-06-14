import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer, AnnotationLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ZoomIn, ZoomOut, RotateCcw, Search, X, ChevronUp, ChevronDown } from 'lucide-react'

// Configure PDF.js worker — try Vite URL resolution first.
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface Props {
  hostId: string
  owner: string
  name: string
  branch: string
  path: string
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const PAGE_BUFFER = 2 // render this many pages above/below viewport
// Default page size (US Letter) used until real dimensions are known
const DEFAULT_W = 612
const DEFAULT_H = 792

export default function PdfViewer({ hostId, owner, name, branch, path }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  // Sparse map — populated lazily as pages render. Missing entries use defaultDim.
  const pageDimensions = useRef<Map<number, { w: number; h: number }>>(new Map())
  const [defaultDim, setDefaultDim] = useState<{ w: number; h: number }>({ w: DEFAULT_W, h: DEFAULT_H })

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ page: number; index: number }[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const renderedPages = useRef<Set<number>>(new Set())
  const renderingPages = useRef<Set<number>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const rafRef = useRef<number>(0)
  const zoomGeneration = useRef(0)

  // Memoize pages array (must be before early returns — Rules of Hooks)
  const pages = useMemo(() =>
    Array.from({ length: totalPages }, (_, i) => i + 1),
    [totalPages]
  )

  // Fetch raw PDF bytes via main process (avoids renderer SSL issues),
  // then hand the binary to pdf.js. Only page-1 dims are computed upfront.
  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof getDocument> | null = null
    setLoading(true)
    setError(null)
    pageDimensions.current.clear()

    ;(async () => {
      try {
        // Fetch raw binary through main process IPC (15 s timeout built in)
        const buf: ArrayBuffer = await window.api.repo.getRawFile(hostId, owner, name, branch, path)
        if (cancelled) return

        const data = new Uint8Array(buf)
        loadingTask = getDocument({ data })
        const doc = await loadingTask.promise
        if (cancelled) { doc.destroy(); return }

        pdfRef.current?.destroy()
        pdfRef.current = doc

        // Get page-1 dimensions to use as default for all pages
        try {
          const page1 = await doc.getPage(1)
          if (cancelled) return
          const vp = page1.getViewport({ scale: 1 })
          const dim = { w: vp.width, h: vp.height }
          pageDimensions.current.set(1, dim)
          setDefaultDim(dim)
        } catch {
          // Use built-in defaults if page 1 fails
        }

        if (!cancelled) {
          setPdf(doc)
          setTotalPages(doc.numPages)
          setLoading(false)
        }
      } catch (err: any) {
        if (cancelled) return
        setLoading(false)
        if (err?.name === 'PasswordException') {
          setError('This PDF is password-protected and cannot be viewed here.')
        } else {
          setError('Failed to load PDF. Check your network connection.')
        }
      }
    })()

    return () => {
      cancelled = true
      loadingTask?.destroy?.()
      pdfRef.current?.destroy()
      pdfRef.current = null
    }
  }, [hostId, owner, name, branch, path])

  // Get dimensions for a page — returns known dims or the default
  const getDim = useCallback((pageNum: number) => {
    return pageDimensions.current.get(pageNum) ?? defaultDim
  }, [defaultDim])

  // Render a single page
  const renderPage = useCallback(async (pageNum: number, gen: number) => {
    if (!pdf || renderedPages.current.has(pageNum) || renderingPages.current.has(pageNum)) return
    const pageDiv = pageRefs.current.get(pageNum)
    if (!pageDiv) return

    renderingPages.current.add(pageNum)

    try {
      const page = await pdf.getPage(pageNum)
      // Stale zoom generation — discard
      if (gen !== zoomGeneration.current) { renderingPages.current.delete(pageNum); return }
      if (!pageRefs.current.has(pageNum)) { renderingPages.current.delete(pageNum); return }

      const viewport = page.getViewport({ scale: zoom * window.devicePixelRatio })
      const displayViewport = page.getViewport({ scale: zoom })

      // Lazily record this page's real dimensions and update the placeholder size
      if (!pageDimensions.current.has(pageNum)) {
        const vp = page.getViewport({ scale: 1 })
        pageDimensions.current.set(pageNum, { w: vp.width, h: vp.height })
        pageDiv.style.width = `${vp.width * zoom}px`
        pageDiv.style.height = `${vp.height * zoom}px`
      }

      // Clear previous content (keep dimensions)
      pageDiv.innerHTML = ''

      // Canvas layer
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${displayViewport.width}px`
      canvas.style.height = `${displayViewport.height}px`
      pageDiv.appendChild(canvas)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

      // Check generation again after async render
      if (gen !== zoomGeneration.current) { renderingPages.current.delete(pageNum); return }

      // Text layer
      const textContent = await page.getTextContent()
      const textDiv = document.createElement('div')
      textDiv.className = 'pdf-viewer__text-layer'
      textDiv.style.width = `${displayViewport.width}px`
      textDiv.style.height = `${displayViewport.height}px`
      pageDiv.appendChild(textDiv)

      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textDiv,
        viewport: displayViewport,
      })
      await textLayer.render()

      // Highlight search matches on this page if applicable
      if (searchQuery && searchResults.some(r => r.page === pageNum)) {
        highlightTextOnPage(textDiv, searchQuery)
      }

      // Annotation layer
      const annotations = await page.getAnnotations()
      if (annotations.length > 0) {
        const annotDiv = document.createElement('div')
        annotDiv.className = 'pdf-viewer__annotation-layer'
        annotDiv.style.width = `${displayViewport.width}px`
        annotDiv.style.height = `${displayViewport.height}px`
        pageDiv.appendChild(annotDiv)

        const linkService = {
          getDestinationHash: () => '#',
          getAnchorUrl: () => '#',
          addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
            link.href = url
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
          },
          navigateTo: () => {},
          goToDestination: () => {},
          goToPage: () => {},
        } as any

        const annotLayer = new AnnotationLayer({
          div: annotDiv,
          page,
          viewport: displayViewport,
          linkService,
          accessibilityManager: null as any,
          annotationCanvasMap: null as any,
          annotationEditorUIManager: null as any,
          structTreeLayer: null as any,
          commentManager: null as any,
          annotationStorage: null as any,
        })
        await annotLayer.render({
          viewport: displayViewport,
          div: annotDiv,
          annotations,
          page,
          linkService,
          renderForms: false,
          imageResourcesPath: '',
        } as any)
      }

      renderedPages.current.add(pageNum)
    } catch {
      // Individual page render failure — leave placeholder
    } finally {
      renderingPages.current.delete(pageNum)
    }
  }, [pdf, zoom, searchResults, searchQuery])

  // Highlight search text on a rendered text layer
  function highlightTextOnPage(textDiv: HTMLDivElement, query: string) {
    const spans = textDiv.querySelectorAll('span')
    const lowerQuery = query.toLowerCase()
    for (const span of spans) {
      const text = span.textContent?.toLowerCase() ?? ''
      if (text.includes(lowerQuery)) {
        span.classList.add('pdf-viewer__text-highlight')
      }
    }
  }

  // Destroy pages outside buffer — preserve dimensions for stable scroll
  const destroyPage = useCallback((pageNum: number) => {
    if (!renderedPages.current.has(pageNum)) return
    const pageDiv = pageRefs.current.get(pageNum)
    if (pageDiv) {
      pageDiv.innerHTML = ''
    }
    renderedPages.current.delete(pageNum)
  }, [])

  // Determine visible pages and render/destroy (debounced via rAF)
  const updateVisiblePages = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container || !totalPages) return

      const scrollTop = container.scrollTop
      const viewportHeight = container.clientHeight
      const gen = zoomGeneration.current

      let firstVisible = 1
      let lastVisible = 1

      for (let i = 1; i <= totalPages; i++) {
        const pageDiv = pageRefs.current.get(i)
        if (!pageDiv) continue
        const top = pageDiv.offsetTop
        const bottom = top + pageDiv.offsetHeight
        if (bottom > scrollTop && top < scrollTop + viewportHeight) {
          if (firstVisible === 1 || i < firstVisible) firstVisible = i
          lastVisible = i
        }
      }

      setCurrentPage(firstVisible)

      // Render visible + buffer
      const renderStart = Math.max(1, firstVisible - PAGE_BUFFER)
      const renderEnd = Math.min(totalPages, lastVisible + PAGE_BUFFER)

      for (let i = renderStart; i <= renderEnd; i++) {
        renderPage(i, gen)
      }

      // Destroy pages outside buffer
      for (const pageNum of renderedPages.current) {
        if (pageNum < renderStart || pageNum > renderEnd) {
          destroyPage(pageNum)
        }
      }
    })
  }, [totalPages, renderPage, destroyPage])

  // Set up scroll listener.
  // `loading` is included so this re-runs when loading finishes and the container div appears.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !pdf) return

    updateVisiblePages()
    container.addEventListener('scroll', updateVisiblePages)
    return () => {
      container.removeEventListener('scroll', updateVisiblePages)
      cancelAnimationFrame(rafRef.current)
    }
  }, [pdf, updateVisiblePages, loading])

  // Re-render on zoom change
  useEffect(() => {
    zoomGeneration.current++
    renderedPages.current.clear()
    renderingPages.current.clear()
    updateVisiblePages()
  }, [zoom, updateVisiblePages])

  // Ctrl+F handler scoped to PDF viewer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'f' && !e.shiftKey) {
        if (containerRef.current) {
          e.preventDefault()
          e.stopPropagation()
          setSearchOpen(true)
          setTimeout(() => searchInputRef.current?.focus(), 50)
        }
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
        setSearchResults([])
        setSearchIndex(-1)
        setHighlightedPage(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [searchOpen])

  // Search functionality
  const handleSearch = useCallback(async () => {
    if (!pdf || !searchQuery.trim()) {
      setSearchResults([])
      setSearchIndex(-1)
      setHighlightedPage(null)
      return
    }

    const query = searchQuery.toLowerCase()
    const results: { page: number; index: number }[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ').toLowerCase()

      let idx = 0
      while ((idx = text.indexOf(query, idx)) !== -1) {
        results.push({ page: i, index: idx })
        idx += query.length
      }
    }

    setSearchResults(results)
    setSearchIndex(results.length > 0 ? 0 : -1)

    if (results.length > 0) {
      setHighlightedPage(results[0].page)
      scrollToPage(results[0].page)
    }
  }, [pdf, searchQuery])

  const scrollToPage = useCallback((pageNum: number) => {
    const pageDiv = pageRefs.current.get(pageNum)
    if (pageDiv && containerRef.current) {
      pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handleSearchNext = useCallback(() => {
    if (searchResults.length === 0) return
    const next = (searchIndex + 1) % searchResults.length
    setSearchIndex(next)
    setHighlightedPage(searchResults[next].page)
    scrollToPage(searchResults[next].page)
  }, [searchResults, searchIndex, scrollToPage])

  const handleSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return
    const prev = (searchIndex - 1 + searchResults.length) % searchResults.length
    setSearchIndex(prev)
    setHighlightedPage(searchResults[prev].page)
    scrollToPage(searchResults[prev].page)
  }, [searchResults, searchIndex, scrollToPage])

  // Zoom handlers
  const zoomIn = useCallback(() => {
    setZoom(z => {
      const next = ZOOM_STEPS.find(s => s > z)
      return next ?? z
    })
  }, [])

  const zoomOut = useCallback(() => {
    setZoom(z => {
      const prev = [...ZOOM_STEPS].reverse().find(s => s < z)
      return prev ?? z
    })
  }, [])

  const zoomReset = useCallback(() => setZoom(1), [])

  // Set page div ref
  const setPageRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefs.current.set(pageNum, el)
    } else {
      pageRefs.current.delete(pageNum)
    }
  }, [])

  // GitHub URL for download link in error states
  const githubUrl = owner && name && branch && path
    ? `https://github.com/${owner}/${name}/blob/${branch}/${path}`
    : null

  // Error state — with download link per spec
  if (error) {
    return (
      <div className="pdf-viewer__error">
        <p>{error}</p>
        {githubUrl && (
          <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="pdf-viewer__error-link">
            View on GitHub
          </a>
        )}
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="file-content-panel__loading">
        <span className="spin-ring" style={{ width: 14, height: 14 }} />
      </div>
    )
  }

  return (
    <>
      <div className="pdf-viewer__toolbar">
        <div className="pdf-viewer__toolbar-left">
          <span className="code-toolbar__lang-badge">PDF</span>
          <span className="code-toolbar__meta">
            Page {currentPage} of {totalPages}
          </span>
        </div>
        <div className="pdf-viewer__toolbar-center">
          <button className="code-toolbar__btn" onClick={zoomOut} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span className="code-toolbar__meta" style={{ minWidth: 40, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="code-toolbar__btn" onClick={zoomIn} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className="code-toolbar__btn" onClick={zoomReset} title="Reset zoom">
            <RotateCcw size={14} />
          </button>
        </div>
        <div className="pdf-viewer__toolbar-right">
          <button
            className={`code-toolbar__btn${searchOpen ? ' code-toolbar__btn--active' : ''}`}
            onClick={() => {
              setSearchOpen(o => !o)
              if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            title="Search (Ctrl+F)"
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="pdf-viewer__search">
          <input
            ref={searchInputRef}
            className="pdf-viewer__search-input"
            type="text"
            placeholder="Search in PDF..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) handleSearchPrev()
                else if (searchResults.length > 0 && searchIndex >= 0) handleSearchNext()
                else handleSearch()
              }
            }}
          />
          {searchResults.length > 0 ? (
            <span className="pdf-viewer__search-count">
              {searchIndex + 1} / {searchResults.length}
            </span>
          ) : searchQuery && searchIndex === -1 ? (
            <span className="pdf-viewer__search-count">No results</span>
          ) : null}
          <button className="code-toolbar__btn" onClick={handleSearchPrev} title="Previous match">
            <ChevronUp size={14} />
          </button>
          <button className="code-toolbar__btn" onClick={handleSearchNext} title="Next match">
            <ChevronDown size={14} />
          </button>
          <button className="code-toolbar__btn" onClick={() => {
            setSearchOpen(false)
            setSearchQuery('')
            setSearchResults([])
            setSearchIndex(-1)
            setHighlightedPage(null)
          }} title="Close search">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="pdf-viewer__container" ref={containerRef}>
        {pages.map(pageNum => {
          const dim = getDim(pageNum)
          return (
            <div
              key={pageNum}
              ref={el => setPageRef(pageNum, el)}
              className="pdf-viewer__page"
              data-page={pageNum}
              style={{ width: dim.w * zoom, height: dim.h * zoom }}
            />
          )
        })}
      </div>
    </>
  )
}
