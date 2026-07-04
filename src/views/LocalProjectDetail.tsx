import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArticleLayout } from '../components/ArticleLayout'
import NavBar from '../components/NavBar'
import DitherBackground from '../components/DitherBackground'
const ReadmeRenderer = lazy(() => import('../components/ReadmeRenderer'))
import TocNav, { type TocItem } from '../components/TocNav'
import FileIcon from '../components/FileIcon'

// ── Types ─────────────────────────────────────────────────────────────
type DirEntry = { name: string; path: string; type: 'dir' | 'file'; size: number | null }

// ── Helpers ───────────────────────────────────────────────────────────
const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'README']

function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── LocalFilesTab ─────────────────────────────────────────────────────
function LocalFilesTab({ folderPath }: { folderPath: string }) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedFile, setSelectedFile] = useState<DirEntry | null>(null)
  const [fileContent, setFileContent] = useState<string | null | 'loading' | 'binary'>(null)
  const [expandedDirs, setExpandedDirs] = useState<Map<string, DirEntry[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  const loadDir = useCallback(async (subPath: string) => {
    setLoading(true)
    setError(false)
    try {
      const result = await window.api.projects.listDir(folderPath, subPath)
      setEntries(result)
      setCurrentPath(subPath)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [folderPath])

  useEffect(() => { loadDir('') }, [loadDir])

  const handleSelectFile = async (entry: DirEntry) => {
    setSelectedFile(entry)
    setFileContent('loading')
    const content = await window.api.projects.readFile(folderPath, entry.path).catch(() => null)
    if (content === null) {
      setFileContent('binary')
    } else {
      setFileContent(content)
    }
  }

  const toggleDir = async (entry: DirEntry) => {
    if (expandedDirs.has(entry.path)) {
      setExpandedDirs(prev => { const m = new Map(prev); m.delete(entry.path); return m })
      return
    }
    setLoadingDirs(prev => new Set(prev).add(entry.path))
    try {
      const children = await window.api.projects.listDir(folderPath, entry.path)
      setExpandedDirs(prev => new Map(prev).set(entry.path, children))
    } catch { /* ignore */ }
    finally {
      setLoadingDirs(prev => { const s = new Set(prev); s.delete(entry.path); return s })
    }
  }

  // Breadcrumb parts from currentPath
  const crumbs = currentPath ? currentPath.split(/[\\/]/) : []

  function renderEntries(items: DirEntry[], depth = 0): React.ReactNode {
    return items.map(entry => {
      const isDir = entry.type === 'dir'
      const isExpanded = expandedDirs.has(entry.path)
      const isLoading = loadingDirs.has(entry.path)
      const isSelected = selectedFile?.path === entry.path

      return (
        <div key={entry.path}>
          <div
            className={`file-tree__node${isSelected ? ' file-tree__node--selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => isDir ? toggleDir(entry) : handleSelectFile(entry)}
          >
            {isDir && (
              <svg
                className={`file-tree__chevron${isExpanded ? ' file-tree__chevron--expanded' : ''}`}
                width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
              >
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"/>
              </svg>
            )}
            {!isDir && <span style={{ width: 12, flexShrink: 0, display: 'inline-block' }} />}
            {isLoading ? (
              <span className="spin-ring" style={{ width: 14, height: 14, flexShrink: 0 }} />
            ) : isDir ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="file-tree__icon file-tree__icon--folder">
                <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/>
              </svg>
            ) : (
              <FileIcon filename={entry.name} size={14} className="file-tree__icon" />
            )}
            <span className={`file-tree__name${isDir ? ' file-tree__name--folder' : ''}`}>{entry.name}</span>
            {!isDir && entry.size != null && (
              <span className="file-tree__count">{formatBytes(entry.size)}</span>
            )}
          </div>
          {isDir && isExpanded && expandedDirs.get(entry.path) && (
            renderEntries(expandedDirs.get(entry.path)!, depth + 1)
          )}
        </div>
      )
    })
  }

  return (
    <div className="files-tab">
      {/* Breadcrumb */}
      {crumbs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>
          <button style={{ background: 'none', border: 'none', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0 }} onClick={() => loadDir('')}>root</button>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ opacity: 0.4 }}>/</span>
              <button
                style={{ background: 'none', border: 'none', color: i === crumbs.length - 1 ? 'var(--t1)' : 'var(--accent-text)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0 }}
                onClick={() => loadDir(crumbs.slice(0, i + 1).join('/'))}
              >{c}</button>
            </span>
          ))}
        </div>
      )}

      <div className="files-tab__body">
        {/* Tree panel */}
        <div className="files-tab__tree" style={{ width: 240 }}>
          {loading ? (
            <div className="files-tab__loading">
              <span className="spin-ring" style={{ width: 18, height: 18 }} />
            </div>
          ) : error ? (
            <div className="files-tab__error">
              <span>Could not read folder</span>
              <button onClick={() => loadDir(currentPath)}>Retry</button>
            </div>
          ) : entries.length === 0 ? (
            <div className="files-tab__loading" style={{ color: 'var(--t4)' }}>Empty folder</div>
          ) : (
            <div className="file-tree" role="tree">
              {renderEntries(entries)}
            </div>
          )}
        </div>

        {/* Content panel */}
        <div className="files-tab__content">
          {selectedFile === null ? (
            <div className="files-tab__loading" style={{ color: 'var(--t4)', flexDirection: 'column', gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.25 }}>
                <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.75 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>
              </svg>
              <span style={{ fontSize: 11 }}>Select a file to view its contents</span>
            </div>
          ) : fileContent === 'loading' ? (
            <div className="files-tab__loading">
              <span className="spin-ring" style={{ width: 18, height: 18 }} />
            </div>
          ) : fileContent === 'binary' ? (
            <div className="files-tab__loading" style={{ color: 'var(--t4)', flexDirection: 'column', gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.25 }}>
                <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.75 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>
              </svg>
              <span style={{ fontSize: 11 }}>Binary file — cannot preview</span>
            </div>
          ) : (
            <div style={{ height: '100%', overflow: 'auto' }}>
              <div style={{ padding: '4px 0 4px 12px', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--t3)', fontFamily: 'monospace', flexShrink: 0 }}>
                {selectedFile.path}
              </div>
              <pre style={{ margin: 0, padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'break-word' }}>
                {fileContent}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="files-tab__statusbar">
        {selectedFile ? selectedFile.path : `${entries.length} item${entries.length !== 1 ? 's' : ''}`}
        {selectedFile?.size != null && ` · ${formatBytes(selectedFile.size)}`}
      </div>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────
type Tab = 'readme' | 'files'

const META_FILE = '.gitplaces.json'

export default function LocalProjectDetail() {
  const [searchParams, setSearchParams] = useSearchParams()
  const folderPath = searchParams.get('path') ?? ''
  const isGit = searchParams.get('git') === '1'

  const [displayName, setDisplayName] = useState(searchParams.get('name') ?? 'Project')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [description, setDescription] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [currentPath, setCurrentPath] = useState(folderPath)

  const [activeTab, setActiveTab] = useState<Tab>('readme')
  const [readme, setReadme] = useState<string | null | 'loading'>('loading')
  const [tocHeadings, setTocHeadings] = useState<TocItem[]>([])

  const bodyContentRef = useRef<HTMLDivElement>(null)
  const readmeBodyRef = useRef<HTMLDivElement>(null)

  // Load persisted meta (description) from .gitplaces.json
  useEffect(() => {
    if (!currentPath) return
    try {
      window.api.projects.readFile(currentPath, META_FILE).then(content => {
        if (!content) return
        try {
          const meta = JSON.parse(content)
          if (meta.description) setDescription(meta.description)
        } catch { /* ignore */ }
      }).catch(() => { /* ignore */ })
    } catch { /* ignore */ }
  }, [currentPath])

  const saveMeta = async (desc: string) => {
    await window.api.projects.writeFile(currentPath, META_FILE, JSON.stringify({ description: desc }, null, 2))
  }

  const commitTitleRename = async () => {
    const name = titleDraft.trim()
    if (!name || name === displayName) { setEditingTitle(false); return }
    try {
      const newPath = await window.api.projects.renameFolder(currentPath, name)
      setDisplayName(name)
      setCurrentPath(newPath)
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('path', newPath); p.set('name', name); return p }, { replace: true })
    } catch { /* ignore — folder may have been locked */ }
    setEditingTitle(false)
  }

  const commitDescription = async () => {
    const val = descDraft.trim()
    setDescription(val)
    setEditingDesc(false)
    await saveMeta(val)
  }

  const createReadme = async () => {
    const template = `# ${displayName}\n\nAdd a description of your project here.\n`
    await window.api.projects.writeFile(currentPath, 'README.md', template)
    setReadme(template)
  }

  // Fixed: proper sequential async loop with cancellation flag
  useEffect(() => {
    let cancelled = false
    setReadme('loading')
    if (!currentPath) { setReadme(null); return }

    async function findReadme() {
      for (const filename of README_CANDIDATES) {
        if (cancelled) return
        try {
          const content = await window.api.projects.readFile(currentPath, filename)
          if (cancelled) return
          if (content) { setReadme(content); return }
        } catch { /* file not found or unreadable, try next */ }
      }
      if (!cancelled) setReadme(null)
    }

    findReadme().catch(() => { if (!cancelled) setReadme(null) })
    return () => { cancelled = true }
  }, [currentPath])

  const bylineNode = (
    <button
      className="article-layout-byline-name owner-name-btn"
      style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6 }}
      title="Open in file explorer"
      onClick={() => window.api.projects.openFolder(currentPath)}
    >
      {currentPath}
    </button>
  )

  const titleNode = editingTitle ? (
    <input
      autoFocus
      value={titleDraft}
      onChange={e => setTitleDraft(e.target.value)}
      onBlur={commitTitleRename}
      onKeyDown={e => { if (e.key === 'Enter') commitTitleRename(); if (e.key === 'Escape') setEditingTitle(false) }}
      style={{ background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', width: '100%', padding: 0 }}
    />
  ) : (
    <span
      title="Click to rename folder"
      style={{ cursor: 'text' }}
      onClick={() => { setTitleDraft(displayName); setEditingTitle(true) }}
    >
      {displayName}
    </span>
  )

  const descriptionNode = editingDesc ? (
    <textarea
      autoFocus
      value={descDraft}
      onChange={e => setDescDraft(e.target.value)}
      onBlur={commitDescription}
      onKeyDown={e => { if (e.key === 'Escape') { setEditingDesc(false) } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDescription() } }}
      placeholder="Add a description…"
      rows={2}
      style={{ background: 'none', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: 12, color: 'var(--t2)', width: '100%', padding: 0, lineHeight: 1.5 }}
    />
  ) : (
    <span
      title="Click to add description"
      style={{ cursor: 'text', color: description ? 'var(--t2)' : 'var(--t4)', fontSize: 12, lineHeight: 1.5, fontStyle: description ? 'normal' : 'italic' }}
      onClick={() => { setDescDraft(description); setEditingDesc(true) }}
    >
      {description || 'Add a description…'}
    </span>
  )

  const tabsNode = (
    <div className="repo-detail-tabs">
      <button className={`repo-detail-tab${activeTab === 'readme' ? ' active' : ''}`} onClick={() => setActiveTab('readme')}>Readme</button>
      <button className={`repo-detail-tab${activeTab === 'files' ? ' active' : ''}`} onClick={() => setActiveTab('files')}>Files</button>
    </div>
  )

  const isFullBleed = activeTab === 'files'

  const bodyNode = (
    <>
      {activeTab === 'readme' && (
        readme === 'loading' ? (
          <p className="repo-detail-placeholder">Loading…</p>
        ) : readme ? (
          <Suspense fallback={<div style={{ minHeight: 200 }} />}>
            <ReadmeRenderer
              content={readme}
              repoOwner=""
              repoName={displayName}
              onTocReady={setTocHeadings}
              readmeBodyRef={readmeBodyRef as React.RefObject<HTMLDivElement>}
            />
          </Suspense>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 24px' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span style={{ fontSize: 13, color: 'var(--t3)' }}>No README found</span>
            <button
              onClick={createReadme}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 20,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--t2)', fontSize: 11, cursor: 'pointer',
                fontFamily: 'inherit', marginTop: 2,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2z"/>
              </svg>
              Create README.md
            </button>
          </div>
        )
      )}
      {activeTab === 'files' && <LocalFilesTab folderPath={currentPath} />}
    </>
  )

  const statsSlotNode = activeTab === 'readme' ? (
    <div className="stats-sidebar">
      <div className="stats-tile">
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Local project
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--t3)', flexShrink: 0, marginTop: 2 }}>
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/>
            </svg>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--t2)', wordBreak: 'break-all', lineHeight: 1.5 }}>
              {folderPath}
            </span>
          </div>
          {isGit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--t3)', flexShrink: 0 }}>
                <path d="M15.698 7.287 8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 0 1 1.267 2.025 1.226 1.226 0 0 1-2.002-1.334L8.58 5.963v4.353a1.226 1.226 0 1 1-1.008-.036V5.887a1.226 1.226 0 0 1-.666-1.608L5.093 2.465l-4.79 4.79a1.03 1.03 0 0 0 0 1.457l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.03 1.03 0 0 0 0-1.457z"/>
              </svg>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--t3)' }}>Git repository</span>
            </div>
          )}
          <button
            className="article-action-btn"
            style={{ marginTop: 4, width: '100%', justifyContent: 'flex-start', gap: 8, fontSize: 11 }}
            onClick={() => window.api.projects.openFolder(currentPath)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/>
            </svg>
            Open in Explorer
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="repo-detail-stage">
        <div className="repo-detail-layout" data-fullbleed-tab={isFullBleed ? '' : undefined}>
          <div className="repo-detail-panel">
            <ArticleLayout
              navBar={<NavBar />}
              byline={bylineNode}
              dither={<DitherBackground avatarUrl={null} fallbackGradient={['#1a2a3a', '#2a3a4a']} />}
              title={titleNode}
              description={descriptionNode}
              tabs={tabsNode}
              body={bodyNode}
              actionRow={null}
              fullBleedBody={isFullBleed}
              bodyScrollRef={bodyContentRef}
              tocSlot={
                activeTab === 'readme' && tocHeadings.length >= 2
                  ? <TocNav
                      headings={tocHeadings}
                      scrollContainerRef={bodyContentRef}
                      headingsContainerRef={readmeBodyRef as React.RefObject<HTMLElement>}
                    />
                  : undefined
              }
              statsSlot={statsSlotNode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
