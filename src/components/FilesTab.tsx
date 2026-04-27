import { useState, useEffect, useCallback, useRef } from 'react'
import { useRepoNav } from '../contexts/RepoNav'
import FileTreePanel from './FileTreePanel'
import FileContentPanel from './FileContentPanel'
import ViewModeBar from './ViewModeBar'
import type { ViewMode, SortField, SortDirection } from './ViewModeBar'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useResizable } from '../hooks/useResizable'
import { isVideoFile, isPdfFile } from './DirectoryListing'
import { ChevronRight } from 'lucide-react'
import ContextMenu from './ContextMenu'
import type { ContextMenuTarget } from './ContextMenu'
import { populateSvgCache } from './SvgThumb'

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

interface Props {
  owner: string
  name: string
  branch: string
  initialPath?: string | null
}

export default function FilesTab({ owner, name, branch, initialPath }: Props) {
  const [rootTreeSha, setRootTreeSha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)

  const [expandedDirs, setExpandedDirs] = useState<Map<string, string>>(new Map())
  const [treeData, setTreeData] = useState<Map<string, TreeEntry[]>>(new Map())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null)
  const [blobContent, setBlobContent] = useState<string | null>(null)
  const [blobRawBase64, setBlobRawBase64] = useState<string | null>(null)
  const [blobLoading, setBlobLoading] = useState(false)
  const [treeLoading, setTreeLoading] = useState<Set<string>>(new Set())
  const [errorDirs, setErrorDirs] = useState<Set<string>>(new Set())
  const [wordWrap, setWordWrap] = useLocalStorage('files:wordWrap', false)
  const handleToggleWordWrap = useCallback(() => setWordWrap(w => !w), [setWordWrap])
  const [lineCount, setLineCount] = useState(0)
  const [filterText, setFilterText] = useState('')

  // View mode — persisted
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('files:viewMode', 'details')

  // Sort — persisted
  const [sortField, setSortField] = useLocalStorage<SortField>('files:sortField', 'name')
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('files:sortDirection', 'asc')

  // Navigation history
  const [pathHistory, setPathHistory] = useState<string[]>([''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const skipHistoryRef = useRef(false)

  const { width: sidebarWidth, isCollapsed, toggleCollapse, handleProps } = useResizable({
    storageKey: 'files:sidebarWidth',
    defaultWidth: 220,
    minWidth: 180,
    maxWidth: 600,
  })

  // ── Load persisted SVG cache so SvgThumb renders instantly ──
  useEffect(() => {
    window.api.svgCache.read(owner, name).then(data => {
      if (data) populateSvgCache(data)
    }).catch(() => {})
  }, [owner, name])

  // ── RepoNav context (published below after goBack/goForward/handleBreadcrumbNavigate) ──
  const repoNav = useRepoNav()

  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; target: ContextMenuTarget
  } | null>(null)

  // ── Navigation history helpers ──

  function pushHistory(path: string) {
    if (skipHistoryRef.current) return
    setPathHistory(prev => [...prev.slice(0, historyIndex + 1), path])
    setHistoryIndex(prev => prev + 1)
  }

  // ── Keyboard shortcuts ──

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Shift+F → focus search in toolbar
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
      }
      // Ctrl+B → toggle sidebar
      if (e.ctrlKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        toggleCollapse()
      }
      // Alt+Left → go back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        goBack()
      }
      // Alt+Right → go forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        goForward()
      }
      // Alt+Up → go up
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        goUp()
      }
      // Backspace → go up (only when not in an input/textarea/contenteditable)
      if (e.key === 'Backspace') {
        const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
        const isEditable = tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable
        if (!isEditable) {
          e.preventDefault()
          goUp()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleCollapse, historyIndex, pathHistory, selectedPath])

  // ── Resolve branch → root tree SHA ──

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const { rootTreeSha: sha } = await window.api.github.getBranch(owner, name, branch)
        if (cancelled) return
        setRootTreeSha(sha)
        const entries = await window.api.github.getTree(owner, name, sha)
        if (cancelled) return
        setTreeData(prev => new Map(prev).set(sha, entries))
      } catch (err) {
        if (branch === 'main') {
          try {
            const { rootTreeSha: sha } = await window.api.github.getBranch(owner, name, 'master')
            if (cancelled) return
            setRootTreeSha(sha)
            const entries = await window.api.github.getTree(owner, name, sha)
            if (cancelled) return
            setTreeData(prev => new Map(prev).set(sha, entries))
            setLoading(false)
            return
          } catch {
            // Fall through to error
          }
        }
        if (!cancelled) setError('Unable to load repository files.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [owner, name, branch, retryKey])

  // ── Navigate to initial path ──

  useEffect(() => {
    if (!initialPath || !rootTreeSha) return

    let cancelled = false

    ;(async () => {
      const segments = initialPath.split('/')
      let currentSha = rootTreeSha
      let currentPath = ''
      const localTreeData = new Map<string, TreeEntry[]>()

      async function getEntries(sha: string): Promise<TreeEntry[]> {
        if (localTreeData.has(sha)) return localTreeData.get(sha)!
        const entries = await window.api.github.getTree(owner, name, sha)
        localTreeData.set(sha, entries)
        setTreeData(prev => new Map(prev).set(sha, entries))
        return entries
      }

      for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i]
        currentPath = currentPath ? `${currentPath}/${segment}` : segment

        try {
          const entries = await getEntries(currentSha)
          if (cancelled) return
          const dirEntry = entries.find(e => e.path === segment && e.type === 'tree')
          if (!dirEntry) return
          setExpandedDirs(prev => new Map(prev).set(currentPath, dirEntry.sha))
          currentSha = dirEntry.sha
        } catch {
          return
        }
      }

      const lastSegment = segments[segments.length - 1]
      try {
        const entries = await getEntries(currentSha)
        if (cancelled) return
        const targetEntry = entries.find(e => e.path === lastSegment)
        if (!targetEntry) return

        setSelectedPath(initialPath)
        setSelectedEntry(targetEntry)

        if (targetEntry.type === 'blob') {
          // PDFs load directly by URL in PdfViewer — no blob fetch needed
          if (isPdfFile(initialPath)) return
          if (targetEntry.size && targetEntry.size > 1_000_000) return
          setBlobLoading(true)
          try {
            const result = await window.api.github.getBlob(owner, name, targetEntry.sha)
            if (!cancelled) {
              setBlobContent(result.content)
              setBlobRawBase64(result.rawBase64)
            }
          } catch {
            // Content panel will show fallback
          } finally {
            if (!cancelled) setBlobLoading(false)
          }
        }
      } catch {
        return
      }
    })()

    return () => { cancelled = true }
  }, [initialPath, rootTreeSha, owner, name])

  // ── Handlers ──

  const handleToggleDir = useCallback(async (path: string, sha: string) => {
    if (errorDirs.has(path)) {
      setErrorDirs(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }

    if (expandedDirs.has(path)) {
      setExpandedDirs(prev => {
        const next = new Map(prev)
        next.delete(path)
        return next
      })
      return
    }

    if (!treeData.has(sha)) {
      setTreeLoading(prev => new Set(prev).add(path))
      try {
        const entries = await window.api.github.getTree(owner, name, sha)
        setTreeData(prev => new Map(prev).set(sha, entries))
      } catch {
        setTreeLoading(prev => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        setErrorDirs(prev => new Set(prev).add(path))
        return
      }
      setTreeLoading(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }

    setExpandedDirs(prev => new Map(prev).set(path, sha))
    setSelectedPath(path)
    setSelectedEntry({ path: path.split('/').pop()!, mode: '', type: 'tree', sha })
    setBlobContent(null)
  }, [expandedDirs, treeData, errorDirs, owner, name])

  const handleSelectFile = useCallback(async (entry: TreeEntry, fullPath: string) => {
    setSelectedPath(fullPath)
    setSelectedEntry({ ...entry, path: entry.path })
    setBlobContent(null)
    setBlobRawBase64(null)

    if (entry.type === 'tree') {
      if (!treeData.has(entry.sha)) {
        try {
          const entries = await window.api.github.getTree(owner, name, entry.sha)
          setTreeData(prev => new Map(prev).set(entry.sha, entries))
        } catch {
          // Directory listing will show empty
        }
      }
      setExpandedDirs(prev => new Map(prev).set(fullPath, entry.sha))
      pushHistory(fullPath)
      return
    }

    if (isVideoFile(fullPath)) {
      pushHistory(fullPath)
      return
    }

    // PDFs load directly by URL in PdfViewer — skip the blob fetch entirely
    if (isPdfFile(fullPath)) {
      pushHistory(fullPath)
      return
    }

    if (entry.size && entry.size > 1_000_000) {
      pushHistory(fullPath)
      return
    }

    setBlobLoading(true)
    try {
      const result = await window.api.github.getBlob(owner, name, entry.sha)
      setBlobContent(result.content)
      setBlobRawBase64(result.rawBase64)
    } catch {
      setBlobContent(null)
    } finally {
      setBlobLoading(false)
    }
    pushHistory(fullPath)
  }, [owner, name, treeData, historyIndex])

  const handleBreadcrumbNavigate = useCallback((path: string) => {
    if (!path) {
      setSelectedPath(null)
      setSelectedEntry(null)
      setBlobContent(null)
      pushHistory('')
      return
    }
    const sha = expandedDirs.get(path)
    if (sha) {
      setSelectedPath(path)
      setSelectedEntry({ path: path.split('/').pop()!, mode: '', type: 'tree', sha })
      setBlobContent(null)
      pushHistory(path)
    }
  }, [expandedDirs, historyIndex])

  const handleNavigateToFile = useCallback(async (targetPath: string) => {
    if (!rootTreeSha) return

    const segments = targetPath.split('/')
    let currentSha = rootTreeSha

    let currentPath = ''
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      currentPath = currentPath ? `${currentPath}/${segment}` : segment

      let entries = treeData.get(currentSha)
      if (!entries) {
        try {
          entries = await window.api.github.getTree(owner, name, currentSha)
          setTreeData(prev => new Map(prev).set(currentSha, entries!))
        } catch { return }
      }

      const dirEntry = entries.find(e => e.path === segment && e.type === 'tree')
      if (!dirEntry) return
      setExpandedDirs(prev => new Map(prev).set(currentPath, dirEntry.sha))
      currentSha = dirEntry.sha
    }

    const lastSegment = segments[segments.length - 1]
    let entries = treeData.get(currentSha)
    if (!entries) {
      try {
        entries = await window.api.github.getTree(owner, name, currentSha)
        setTreeData(prev => new Map(prev).set(currentSha, entries!))
      } catch { return }
    }

    const targetEntry = entries.find(e => e.path === lastSegment)
    if (!targetEntry) return

    handleSelectFile(targetEntry, targetPath)
  }, [rootTreeSha, treeData, owner, name, handleSelectFile])

  const handlePathSubmit = useCallback((path: string) => {
    handleNavigateToFile(path)
  }, [handleNavigateToFile])

  // ── Silent navigation (for back/forward — no history push) ──

  const silentNavigate = useCallback(async (path: string) => {
    skipHistoryRef.current = true
    try {
      if (!path) {
        setSelectedPath(null)
        setSelectedEntry(null)
        setBlobContent(null)
        setBlobRawBase64(null)
      } else {
        await handleNavigateToFile(path)
      }
    } finally {
      skipHistoryRef.current = false
    }
  }, [handleNavigateToFile])

  function goBack() {
    if (historyIndex <= 0) return
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    silentNavigate(pathHistory[newIndex])
  }

  function goForward() {
    if (historyIndex >= pathHistory.length - 1) return
    const newIndex = historyIndex + 1
    setHistoryIndex(newIndex)
    silentNavigate(pathHistory[newIndex])
  }

  function goUp() {
    if (!selectedPath) return
    const parent = selectedPath.split('/').slice(0, -1).join('/')
    pushHistory(parent || '')
    silentNavigate(parent || '')
  }

  function goHome() {
    setSelectedPath(null)
    setSelectedEntry(null)
    setBlobContent(null)
    setBlobRawBase64(null)
    pushHistory('')
  }

  // ── Publish file path + nav state to NavBar via context ──

  // Use refs so published callbacks always see the latest closure values
  const goBackRef = useRef(goBack)
  goBackRef.current = goBack
  const goForwardRef = useRef(goForward)
  goForwardRef.current = goForward
  const breadcrumbNavRef = useRef(handleBreadcrumbNavigate)
  breadcrumbNavRef.current = handleBreadcrumbNavigate

  useEffect(() => {
    repoNav.setFilePath(selectedPath ?? '')
  }, [selectedPath])

  // Publish whether the entry is a directory for NavBar icon rendering
  const isDir = selectedEntry?.type === 'tree' || !selectedPath
  useEffect(() => {
    repoNav.setIsDirectory(isDir)
  }, [isDir])

  useEffect(() => {
    repoNav.setFileNav({
      canGoBack: historyIndex > 0,
      canGoForward: historyIndex < pathHistory.length - 1,
      onGoBack: () => goBackRef.current(),
      onGoForward: () => goForwardRef.current(),
    })
  }, [historyIndex, pathHistory.length])

  useEffect(() => {
    repoNav.setOnFilePathClick(() => (path: string) => {
      breadcrumbNavRef.current(path)
    })
    return () => {
      repoNav.setFilePath(null)
      repoNav.setOnFilePathClick(null)
      repoNav.setFileNav(null)
      repoNav.setIsDirectory(true)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: TreeEntry, fullPath: string) => {
    e.preventDefault()
    const isDir = entry.type === 'tree'
    const ext = entry.path.split('.').pop()?.toLowerCase() ?? ''
    const mdExts = new Set(['md', 'mdx', 'markdown'])

    let hasMarkdown = false
    if (isDir) {
      const sha = expandedDirs.get(fullPath) ?? entry.sha
      const children = treeData.get(sha)
      if (children) {
        let mdCount = 0
        for (const c of children) {
          if (c.type === 'blob' && mdExts.has(c.path.split('.').pop()?.toLowerCase() ?? '')) {
            mdCount++
            if (mdCount >= 2) { hasMarkdown = true; break }
          }
        }
      } else {
        hasMarkdown = true  // unloaded folder: assume yes, service handles gracefully
      }
    } else {
      hasMarkdown = mdExts.has(ext)
    }

    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: entry.path, type: entry.type, hasMarkdown, fullPath },
    })
  }, [expandedDirs, treeData])

  const handleDownloadRaw = useCallback((target: ContextMenuTarget) => {
    const promise = target.type === 'tree'
      ? window.api.download.rawFolder({ owner, name, branch, path: target.fullPath })
      : window.api.download.rawFile({ owner, name, branch, path: target.fullPath })
    promise.catch(err => console.error('Download failed:', err))
  }, [owner, name, branch])

  const handleDownloadConverted = useCallback((target: ContextMenuTarget, format: 'docx' | 'pdf' | 'epub') => {
    window.api.download.convert({
      owner, name, branch,
      path: target.fullPath,
      format,
      isFolder: target.type === 'tree',
    }).catch(err => console.error('Conversion failed:', err))
  }, [owner, name, branch])

  // ── Render ──

  if (loading) {
    return (
      <div className="files-tab">
        <div className="files-tab__loading">
          <span className="spin-ring" style={{ width: 16, height: 16 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="files-tab">
        <div className="files-tab__error">
          <p>{error}</p>
          <button onClick={() => setRetryKey(k => k + 1)}>Retry</button>
        </div>
      </div>
    )
  }

  const selectedDirEntries = selectedEntry?.type === 'tree'
    ? treeData.get(selectedEntry.sha) ?? null
    : !selectedPath && rootTreeSha
      ? treeData.get(rootTreeSha) ?? null
      : null

  return (
    <div className="files-tab">
      {(selectedEntry?.type === 'tree' || !selectedPath) && selectedDirEntries && (
        <ViewModeBar
          itemCount={selectedDirEntries.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={setSortField}
          onSortDirectionChange={setSortDirection}
          searchValue={filterText}
          onSearchChange={setFilterText}
        />
      )}
      <div className="files-tab__body">
        {!isCollapsed ? (
          <div className="files-tab__tree" style={{ width: sidebarWidth }}>
            {rootTreeSha && treeData.has(rootTreeSha) && (
              <FileTreePanel
                entries={treeData.get(rootTreeSha)!}
                expandedDirs={expandedDirs}
                treeData={treeData}
                treeLoading={treeLoading}
                errorDirs={errorDirs}
                selectedPath={selectedPath}
                basePath=""
                depth={0}
                owner={owner}
                name={name}
                onToggleDir={handleToggleDir}
                onSelectFile={handleSelectFile}
                filterText={filterText}
                onContextMenu={handleContextMenu}
              />
            )}
          </div>
        ) : (
          <button className="files-tab__expand-btn" title="Show sidebar (Ctrl+B)" onClick={toggleCollapse}>
            <ChevronRight size={14} />
          </button>
        )}
        {!isCollapsed && (
          <div className="files-tab__resize-handle" {...handleProps}>
            <div className="files-tab__resize-line" />
          </div>
        )}
        <div className="files-tab__content">
          <FileContentPanel
            key={selectedPath ?? ''}
            selectedPath={selectedPath}
            selectedEntry={selectedEntry}
            blobContent={blobContent}
            blobRawBase64={blobRawBase64}
            blobLoading={blobLoading}
            owner={owner}
            name={name}
            branch={branch}
            dirEntries={selectedDirEntries}
            onSelectEntry={handleSelectFile}
            onNavigateToFile={handleNavigateToFile}
            wordWrap={wordWrap}
            onToggleWordWrap={handleToggleWordWrap}
            lineCount={lineCount}
            onLineCountReady={setLineCount}
            viewMode={viewMode}
            sortField={sortField}
            sortDirection={sortDirection}
            filterText={filterText}
            treeData={treeData}
            onContextMenu={handleContextMenu}
          />
        </div>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          onClose={() => setCtxMenu(null)}
          onDownloadRaw={handleDownloadRaw}
          onDownloadConverted={handleDownloadConverted}
        />
      )}
    </div>
  )
}
