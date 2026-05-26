import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useRepoNav } from '../contexts/RepoNav'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useResizable } from '../hooks/useResizable'
import { useLastCommits } from '../hooks/useLastCommits'
import { useGitStatus } from '../hooks/useGitStatus'
import { useFileTreeKeyboard } from '../hooks/useFileTreeKeyboard'
import FilesToolbar from './files/FilesToolbar'
import FileTreeView from './files/FileTreeView'
import DirectoryPane from './files/DirectoryPane'
import FileContentPanel from './FileContentPanel'
import ContextMenu from './ContextMenu'
import type { ContextMenuTarget } from './ContextMenu'
import { populateSvgCache } from './SvgThumb'
import { buildVisibleRows } from '../lib/fileTree/model'
import { buildDiffBaseOptions } from '../lib/fileTree/diffBaseOptions'
import type { TreeEntry, VisibleRow, Density, SearchMode, DiffBaseRef } from '../lib/fileTree/types'
import { isVideoFile, isPdfFile } from './DirectoryListing'

// FileContentPanel's local TreeEntry doesn't include 'commit'; this alias
// matches its expected shape so casts at the boundary are explicit.
type ContentPanelEntry = { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }

interface Props {
  owner: string
  name: string
  branch: string
  initialPath?: string | null
  repoId?: string | null
  releases?: { tag_name: string }[]
}

export default function FilesTab({ owner, name, branch, initialPath, repoId, releases }: Props) {
  const [rootTreeSha, setRootTreeSha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)

  const [expanded, setExpanded] = useState<Map<string, string>>(new Map())
  const [treeData, setTreeData] = useState<Map<string, TreeEntry[]>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<ContentPanelEntry | null>(null)
  const [blobContent, setBlobContent] = useState<string | null>(null)
  const [blobRawBase64, setBlobRawBase64] = useState<string | null>(null)
  const [blobLoading, setBlobLoading] = useState(false)
  const [, setTreeLoading] = useState<Set<string>>(new Set())

  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useLocalStorage<SearchMode>('files:searchMode', 'expand')
  const [density, setDensity] = useLocalStorage<Density>('files:density', 'comfortable')
  const [diffBaseMap, setDiffBaseMap] = useLocalStorage<Record<string, DiffBaseRef | null>>('files:diffBase', {})
  const diffBase = repoId ? diffBaseMap[repoId] ?? null : null
  const setDiffBase = useCallback((ref: DiffBaseRef | null) => {
    if (!repoId) return
    setDiffBaseMap(prev => ({ ...prev, [repoId]: ref }))
  }, [repoId, setDiffBaseMap])

  const [pathHistory, setPathHistory] = useState<string[]>([''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const skipHistoryRef = useRef(false)

  const { width: sidebarWidth, isCollapsed, toggleCollapse, handleProps } = useResizable({
    storageKey: 'files:sidebarWidth',
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 600,
  })

  const lastCommits = useLastCommits({ repoId: repoId ?? null, owner, name, ref: branch })
  const gitStatus = useGitStatus({
    repoId: repoId ?? null, owner, name,
    baseRef: diffBase?.ref ?? null,
    headRef: branch,
  })

  const repoNav = useRepoNav()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)

  useEffect(() => {
    window.api.svgCache.read(owner, name).then(data => {
      if (data) populateSvgCache(data)
    }).catch(() => {})
  }, [owner, name])

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
      } catch {
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
          } catch { /* fall through */ }
        }
        if (!cancelled) setError('Unable to load repository files.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [owner, name, branch, retryKey])

  const visibleRows = useMemo(() => {
    if (!rootTreeSha) return []
    return buildVisibleRows({
      rootTreeSha,
      treeData,
      expanded,
      searchQuery,
      searchMode,
      flattenEmpty: true,
    })
  }, [rootTreeSha, treeData, expanded, searchQuery, searchMode])

  // Request last-commit metadata for visible blob rows. Pass {path, sha} pairs.
  useEffect(() => {
    const rows = visibleRows.filter(r => r.type === 'blob').map(r => ({ path: r.path, sha: r.sha }))
    if (rows.length > 0) lastCommits.request(rows)
  }, [visibleRows, lastCommits])

  const diffBaseOptions = useMemo(
    () => buildDiffBaseOptions(releases ?? [], branch),
    [releases, branch],
  )

  function pushHistory(path: string) {
    if (skipHistoryRef.current) return
    setPathHistory(prev => [...prev.slice(0, historyIndex + 1), path])
    setHistoryIndex(prev => prev + 1)
  }

  const ensureTreeLoaded = useCallback(async (sha: string) => {
    const existing = treeData.get(sha)
    if (existing) return existing
    setTreeLoading(prev => new Set(prev).add(sha))
    try {
      const entries = await window.api.github.getTree(owner, name, sha)
      setTreeData(prev => new Map(prev).set(sha, entries))
      return entries as TreeEntry[]
    } finally {
      setTreeLoading(prev => {
        const next = new Set(prev)
        next.delete(sha)
        return next
      })
    }
  }, [owner, name, treeData])

  const handleToggleExpand = useCallback(async (path: string) => {
    const row = visibleRows.find(r => r.path === path)
    if (!row || row.type !== 'tree') return
    if (expanded.has(path)) {
      setExpanded(prev => { const n = new Map(prev); n.delete(path); return n })
    } else {
      await ensureTreeLoaded(row.sha)
      setExpanded(prev => new Map(prev).set(path, row.sha))
    }
  }, [visibleRows, expanded, ensureTreeLoaded])

  const handleActivate = useCallback(async (path: string) => {
    const row = visibleRows.find(r => r.path === path)
    if (!row) return
    if (row.type === 'tree') {
      if (!expanded.has(path)) await handleToggleExpand(path)
      setSelectedEntry({ path: row.name, mode: '', type: 'tree', sha: row.sha })
      setBlobContent(null)
      pushHistory(path)
      return
    }
    if (row.type === 'commit') {
      // Submodule — no content to display, just record selection.
      pushHistory(path)
      return
    }
    setSelectedEntry({ path: row.name, mode: '', type: 'blob', sha: row.sha, size: row.size })
    setBlobContent(null)
    setBlobRawBase64(null)
    if (!isVideoFile(path) && !isPdfFile(path) && (!row.size || row.size <= 1_000_000)) {
      setBlobLoading(true)
      try {
        const result = await window.api.github.getBlob(owner, name, row.sha)
        setBlobContent(result.content)
        setBlobRawBase64(result.rawBase64)
      } catch { setBlobContent(null) }
      finally { setBlobLoading(false) }
    }
    pushHistory(path)
  }, [visibleRows, expanded, handleToggleExpand, owner, name])

  const handleRowClick = useCallback((row: VisibleRow, e: React.MouseEvent) => {
    setFocused(row.path)
    if (e.shiftKey && anchor) {
      const startIdx = visibleRows.findIndex(r => r.path === anchor)
      const endIdx = visibleRows.findIndex(r => r.path === row.path)
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const range = new Set(visibleRows.slice(lo, hi + 1).map(r => r.path))
        setSelected(range)
      }
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(row.path)) next.delete(row.path)
        else next.add(row.path)
        return next
      })
      setAnchor(row.path)
      return
    }
    setSelected(new Set([row.path]))
    setAnchor(row.path)
    handleActivate(row.path)
  }, [visibleRows, anchor, handleActivate])

  const handleSelect = useCallback((path: string, opts: { shift: boolean; ctrl: boolean }) => {
    if (opts.shift && anchor) {
      const startIdx = visibleRows.findIndex(r => r.path === anchor)
      const endIdx = visibleRows.findIndex(r => r.path === path)
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        setSelected(new Set(visibleRows.slice(lo, hi + 1).map(r => r.path)))
      }
    } else if (opts.ctrl) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path); else next.add(path)
        return next
      })
      setAnchor(path)
    } else {
      setSelected(new Set([path]))
      setAnchor(path)
    }
  }, [visibleRows, anchor])

  const keyboard = useFileTreeKeyboard({
    rows: visibleRows,
    focused,
    selected,
    onFocusChange: setFocused,
    onToggleExpand: handleToggleExpand,
    onSelect: handleSelect,
    onActivate: handleActivate,
  })

  const handleSegmentClick = useCallback((row: VisibleRow, depth: number) => {
    if (!row.flattenedSegments) return
    const parentPath = row.path.split('/').slice(0, -row.flattenedSegments.length).join('/')
    const segs = row.flattenedSegments.slice(0, depth + 1)
    const targetPath = parentPath ? `${parentPath}/${segs.join('/')}` : segs.join('/')
    setFocused(targetPath)
    handleActivate(targetPath)
  }, [handleActivate])

  const handleContextMenu = useCallback((row: VisibleRow, e: React.MouseEvent) => {
    e.preventDefault()
    const ext = row.path.split('.').pop()?.toLowerCase() ?? ''
    const mdExts = new Set(['md', 'mdx', 'markdown'])
    const isDir = row.type === 'tree'
    let hasMarkdown = false
    if (isDir) {
      const children = treeData.get(row.sha)
      if (children) {
        let count = 0
        for (const c of children) {
          if (c.type === 'blob' && mdExts.has(c.path.split('.').pop()?.toLowerCase() ?? '')) {
            count++
            if (count >= 2) { hasMarkdown = true; break }
          }
        }
      } else {
        hasMarkdown = true
      }
    } else {
      hasMarkdown = mdExts.has(ext)
    }
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: row.name, type: row.type === 'commit' ? 'blob' : row.type, hasMarkdown, fullPath: row.path },
    })
  }, [treeData])

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

  useEffect(() => {
    if (!initialPath || !rootTreeSha) return
    let cancelled = false
    ;(async () => {
      const segments = initialPath.split('/')
      let currentSha = rootTreeSha
      let currentPath = ''
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]
        currentPath = currentPath ? `${currentPath}/${seg}` : seg
        try {
          const entries = await ensureTreeLoaded(currentSha)
          if (cancelled) return
          const dirEntry = entries.find(e => e.path === seg && e.type === 'tree')
          if (!dirEntry) return
          setExpanded(prev => new Map(prev).set(currentPath, dirEntry.sha))
          currentSha = dirEntry.sha
        } catch { return }
      }
      const lastSeg = segments[segments.length - 1]
      try {
        const entries = await ensureTreeLoaded(currentSha)
        if (cancelled) return
        const target = entries.find(e => e.path === lastSeg)
        if (!target) return
        setSelected(new Set([initialPath]))
        setFocused(initialPath)
        setAnchor(initialPath)
        handleActivate(initialPath)
      } catch { return }
    })()
    return () => { cancelled = true }
  }, [initialPath, rootTreeSha, ensureTreeLoaded, handleActivate])

  const breadcrumbNavRef = useRef<(path: string) => void>(() => {})
  breadcrumbNavRef.current = (path: string) => {
    if (!path) {
      setSelected(new Set())
      setSelectedEntry(null)
      setBlobContent(null)
      pushHistory('')
      return
    }
    handleActivate(path)
  }

  const focusedPath = focused ?? (selected.size > 0 ? [...selected][0] : '')
  useEffect(() => {
    repoNav.setFilePath(focusedPath ?? '')
  }, [focusedPath])

  const focusedRow = visibleRows.find(r => r.path === focusedPath)
  const isDir = focusedRow?.type === 'tree' || !focusedPath
  useEffect(() => {
    repoNav.setIsDirectory(isDir)
  }, [isDir])

  useEffect(() => {
    repoNav.setFileNav({
      canGoBack: historyIndex > 0,
      canGoForward: historyIndex < pathHistory.length - 1,
      onGoBack: () => {
        if (historyIndex <= 0) return
        skipHistoryRef.current = true
        setHistoryIndex(i => i - 1)
        const target = pathHistory[historyIndex - 1]
        if (target) handleActivate(target)
        skipHistoryRef.current = false
      },
      onGoForward: () => {
        if (historyIndex >= pathHistory.length - 1) return
        skipHistoryRef.current = true
        setHistoryIndex(i => i + 1)
        const target = pathHistory[historyIndex + 1]
        if (target) handleActivate(target)
        skipHistoryRef.current = false
      },
    })
  }, [historyIndex, pathHistory.length])

  useEffect(() => {
    repoNav.setOnFilePathClick(() => (path: string) => breadcrumbNavRef.current(path))
    return () => {
      repoNav.setFilePath(null)
      repoNav.setOnFilePathClick(null)
      repoNav.setFileNav(null)
      repoNav.setIsDirectory(true)
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('files-toolbar:focus-search'))
      }
      if (e.ctrlKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        toggleCollapse()
      }
      if (e.key === 'Backspace') {
        const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
        const isEditable = tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable
        if (!isEditable && focusedPath) {
          e.preventDefault()
          const parent = focusedPath.split('/').slice(0, -1).join('/')
          if (parent) handleActivate(parent)
          else {
            setSelected(new Set()); setSelectedEntry(null); setBlobContent(null)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleCollapse, focusedPath, handleActivate])

  const rightPaneContent = useMemo(() => {
    if (focusedRow?.type === 'blob') {
      return (
        <FileContentPanel
          key={focusedRow.path}
          selectedPath={focusedRow.path}
          selectedEntry={selectedEntry}
          blobContent={blobContent}
          blobRawBase64={blobRawBase64}
          blobLoading={blobLoading}
          owner={owner}
          name={name}
          branch={branch}
          dirEntries={null}
          onSelectEntry={() => {}}
          onNavigateToFile={path => handleActivate(path)}
          wordWrap={false}
          onToggleWordWrap={() => {}}
          lineCount={0}
          onLineCountReady={() => {}}
          viewMode="details"
          sortField="name"
          sortDirection="asc"
          filterText=""
          treeData={treeData as unknown as Map<string, ContentPanelEntry[]>}
          onContextMenu={() => {}}
        />
      )
    }
    const dirEntries: TreeEntry[] = (() => {
      if (!focusedPath) return treeData.get(rootTreeSha ?? '') ?? []
      if (focusedRow?.type === 'tree') return treeData.get(focusedRow.sha) ?? []
      return []
    })()
    return (
      <DirectoryPane
        entries={dirEntries}
        basePath={focusedPath ?? ''}
        density={density}
        selected={selected}
        getLastCommit={p => lastCommits.get(p)}
        getGitStatus={p => gitStatus.statusMap.get(p)}
        owner={owner}
        name={name}
        width={800}
        onRowClick={(entry, fullPath, e) => {
          handleRowClick({
            path: fullPath, type: entry.type, name: entry.path, depth: 0, sha: entry.sha,
            size: entry.size, isExpanded: false, isFlattened: false,
            level: 1, posInSet: 1, setSize: 1,
          }, e)
        }}
        onRowContextMenu={(entry, fullPath, e) => {
          handleContextMenu({
            path: fullPath, type: entry.type, name: entry.path, depth: 0, sha: entry.sha,
            size: entry.size, isExpanded: false, isFlattened: false,
            level: 1, posInSet: 1, setSize: 1,
          }, e)
        }}
      />
    )
  }, [focusedRow, focusedPath, selectedEntry, blobContent, blobRawBase64, blobLoading,
      owner, name, branch, treeData, rootTreeSha, density, selected, lastCommits, gitStatus,
      handleRowClick, handleContextMenu, handleActivate])

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

  return (
    <div className="files-tab">
      <FilesToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        density={density}
        onDensityChange={setDensity}
        diffBase={diffBase}
        onDiffBaseChange={setDiffBase}
        diffBaseOptions={diffBaseOptions}
      />
      {gitStatus.error && (
        <div className="files-tab__compare-error">
          Compare failed · <button onClick={() => gitStatus.retry()}>Retry</button>
        </div>
      )}
      <div className="files-tab__body">
        {!isCollapsed ? (
          <div className="files-tab__tree" style={{ width: sidebarWidth }}>
            <FileTreeView
              rows={visibleRows}
              density={density}
              focused={focused}
              selected={selected}
              getLastCommit={p => lastCommits.get(p)}
              getGitStatus={p => gitStatus.statusMap.get(p)}
              owner={owner}
              name={name}
              width={sidebarWidth}
              onRowClick={handleRowClick}
              onRowContextMenu={handleContextMenu}
              onSegmentClick={handleSegmentClick}
              onKeyDown={keyboard.handleKeyDown}
            />
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
          {rightPaneContent}
        </div>
      </div>
      {selected.size > 1 && (
        <div className="files-tab__selection-status">
          {selected.size} files selected
        </div>
      )}
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
