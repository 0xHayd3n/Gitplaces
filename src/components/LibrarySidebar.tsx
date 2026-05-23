// src/components/LibrarySidebar.tsx
import { useState, useMemo, useEffect, useCallback, memo } from 'react'
import { useLocation, useNavigate, useMatch } from 'react-router-dom'
import { Home, Search } from 'lucide-react'
import './LibrarySidebar.css'
import type { LibraryRow, StarredRepoRow, RepoRow, CollectionRow } from '../types/repo'
import type { LibraryEntry, LocalProject } from '../types/library'
import { useLearningProgress } from '../hooks/useLearningProgress'
import RepoContextMenu, { type RepoContextMenuTarget } from './RepoContextMenu'
import CollectionsSidebar from './CollectionsSidebar'

interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  localProjects: LocalProject[]
  archivedSet: Set<string>
  selectedId: string | null
  selectedLocalPath: string | null
  collSelectedId?: string | null
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onSelectLocal: (project: LocalProject) => void
  onSelectColl?: (id: string, coll: CollectionRow) => void
}

function ReposIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z" />
    </svg>
  )
}

function CollectionsIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    </svg>
  )
}

function GitHubIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function LocalIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: '#a78bfa' }}>
      <path d="M20 6h-2.18c.07-.44.18-.86.18-1a3 3 0 0 0-6 0c0 .14.11.56.18 1H10c-.27 0-2 .12-2 2v10c0 1.5 1.73 2 2 2h10c.27 0 2-.12 2-2V8c0-1.88-1.73-2-2-2zm-6-1a1 1 0 0 1 2 0c0 .14-.06.39-.11.6-.04.13-.07.27-.11.4h-1.56c-.04-.13-.07-.27-.11-.4-.05-.21-.11-.46-.11-.6zm6 13H10V8h2v1h6V8h2v10z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#a78bfa' }} aria-hidden="true">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

type Mode = 'repos' | 'collections'

export default function LibrarySidebar({
  installedRows, starredRows, unstarredRows, localProjects,
  archivedSet,
  selectedId, selectedLocalPath, collSelectedId = null,
  onSelect, onSelectLocal, onSelectColl,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; target: RepoContextMenuTarget } | null>(null)
  const collMatch = useMatch('/library/collection/:id')
  const repoMatch = useMatch('/library/repo/:owner/:name')
  const [mode, setMode] = useState<Mode>(collMatch ? 'collections' : 'repos')
  const [searchTerm, setSearchTerm] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [unstarredOpen, setUnstarredOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isSummaryActive = location.pathname === '/library'

  useEffect(() => {
    if (collMatch) setMode('collections')
  }, [collMatch?.params.id])

  useEffect(() => {
    if (repoMatch) setMode('repos')
  }, [repoMatch?.params.owner, repoMatch?.params.name])

  const allEntries = useMemo<LibraryEntry[]>(() => {
    const map = new Map<string, LibraryEntry>()
    for (const row of installedRows) {
      map.set(row.id, { kind: 'repo', row, isInstalled: true, isStarred: row.starred_at != null })
    }
    for (const row of starredRows) {
      if (!map.has(row.id)) {
        map.set(row.id, { kind: 'repo', row, isInstalled: false, isStarred: true })
      }
    }
    for (const project of localProjects) {
      map.set(`local:${project.path}`, { kind: 'local', project })
    }
    return Array.from(map.values())
  }, [installedRows, starredRows, localProjects])

  const visible = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return allEntries.filter(e => {
      const key = e.kind === 'repo'
        ? `${e.row.owner}/${e.row.name}`
        : `${e.project.owner ?? ''}/${e.project.repoName ?? e.project.name}`
      if (archivedSet.has(key)) return false
      if (!q) return true
      if (e.kind === 'repo') {
        return e.row.name.toLowerCase().includes(q) || e.row.owner.toLowerCase().includes(q)
      }
      return e.project.name.toLowerCase().includes(q)
    })
  }, [allEntries, archivedSet, searchTerm])

  const archivedEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return allEntries.filter(e => {
      if (e.kind !== 'repo') return false
      const key = `${e.row.owner}/${e.row.name}`
      if (!archivedSet.has(key)) return false
      if (!q) return true
      return e.row.name.toLowerCase().includes(q) || e.row.owner.toLowerCase().includes(q)
    })
  }, [allEntries, archivedSet, searchTerm])

  const visibleUnstarred = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return unstarredRows
    return unstarredRows.filter(r =>
      r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)
    )
  }, [unstarredRows, searchTerm])

  const handleRepoContextMenu = useCallback(
    (e: React.MouseEvent, target: RepoContextMenuTarget) => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, target })
    },
    [],
  )

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar-topbar">
        <div className="library-sidebar-topbar-row1">
          <button
            type="button"
            className={`library-sidebar-home${isSummaryActive ? ' active' : ''}`}
            onClick={() => navigate('/library')}
            aria-label="Home"
            title="Home"
          >
            <Home size={14} />
          </button>
          <div className="library-sidebar-toggle">
            <button
              type="button"
              className={`library-sidebar-toggle-btn${mode === 'repos' ? ' active' : ''}`}
              onClick={() => { setMode('repos'); setSearchTerm('') }}
              aria-label="Repositories"
              title="Repositories"
            >
              <ReposIcon />
            </button>
            <button
              type="button"
              className={`library-sidebar-toggle-btn${mode === 'collections' ? ' active' : ''}`}
              onClick={() => { setMode('collections'); setSearchTerm('') }}
              aria-label="Collections"
              title="Collections"
            >
              <CollectionsIcon />
            </button>
          </div>
        </div>
        <div className="library-sidebar-topbar-row2">
          <div className="library-sidebar-search">
            <Search size={11} className="library-sidebar-search-icon" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={mode === 'repos' ? 'Search repositories' : 'Search collections'}
              className="library-sidebar-search-input"
            />
          </div>
        </div>
      </div>
      {mode === 'repos' ? (
      <div className="library-sidebar-list">
        {visible.length === 0 && (
          <div className="library-sidebar-empty">No repos or projects</div>
        )}
        {visible.map(entry => {
          if (entry.kind === 'repo') {
            const { row, isInstalled, isStarred } = entry
            return (
              <SidebarRepoRow
                key={row.id}
                row={row}
                isInstalled={isInstalled}
                isStarred={isStarred}
                selected={selectedId === row.id}
                onSelect={onSelect}
                onContextMenu={handleRepoContextMenu}
              />
            )
          }

          // kind === 'local'
          const { project } = entry
          return (
            <button
              key={`local:${project.path}`}
              className={`library-sidebar-item installed${selectedLocalPath === project.path ? ' selected' : ''}`}
              onClick={() => onSelectLocal(project)}
              title={project.path}
            >
              <span className="library-sidebar-avatar library-sidebar-local-avatar">
                <FolderIcon />
              </span>
              <span className="library-sidebar-name">{project.name}</span>
              <span className="library-sidebar-type-icon local">
                <LocalIcon />
              </span>
            </button>
          )
        })}

        {archivedEntries.length > 0 && (
          <div className="library-sidebar-section">
            <button
              type="button"
              className="library-sidebar-section-header"
              onClick={() => setArchivedOpen(o => !o)}
              aria-expanded={archivedOpen}
            >
              <span className="library-sidebar-section-caret">{archivedOpen ? '▾' : '▸'}</span>
              Archived ({archivedEntries.length})
            </button>
            {archivedOpen && archivedEntries.map(entry => {
              if (entry.kind !== 'repo') return null
              const { row } = entry
              return (
                <SidebarRepoRow
                  key={`archived-${row.id}`}
                  row={row}
                  isInstalled={entry.isInstalled}
                  isStarred={entry.isStarred}
                  selected={selectedId === row.id}
                  onSelect={onSelect}
                  onContextMenu={handleRepoContextMenu}
                />
              )
            })}
          </div>
        )}

        {visibleUnstarred.length > 0 && (
          <div className="library-sidebar-section">
            <button
              type="button"
              className="library-sidebar-section-header"
              onClick={() => setUnstarredOpen(o => !o)}
              aria-expanded={unstarredOpen}
            >
              <span className="library-sidebar-section-caret">{unstarredOpen ? '▾' : '▸'}</span>
              Recently unstarred ({visibleUnstarred.length})
            </button>
            {unstarredOpen && visibleUnstarred.map(row => (
              <SidebarRepoRow
                key={`unstarred-${row.id}`}
                row={row}
                isInstalled={false}
                isStarred={false}
                selected={selectedId === row.id}
                onSelect={onSelect}
                onContextMenu={handleRepoContextMenu}
              />
            ))}
          </div>
        )}
      </div>
      ) : (
        <div className="library-sidebar-list">
          <CollectionsSidebar
            selectedId={collSelectedId}
            onSelect={onSelectColl ?? (() => {})}
            searchTerm={searchTerm}
          />
        </div>
      )}

      {menu && (
        <RepoContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}

interface SidebarRepoRowProps {
  row: RepoRow | LibraryRow | StarredRepoRow
  isInstalled: boolean
  isStarred: boolean
  selected: boolean
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onContextMenu: (e: React.MouseEvent, target: RepoContextMenuTarget) => void
}

const SidebarRepoRow = memo(function SidebarRepoRow({
  row, isInstalled, isStarred, selected, onSelect, onContextMenu,
}: SidebarRepoRowProps) {
  const { state } = useLearningProgress(row.owner, row.name)
  const learning = !!state && state.state === 'running'
  const percent = state?.percent ?? 0

  const handleClick = useCallback(() => onSelect(row, isInstalled), [onSelect, row.owner, row.name, isInstalled])
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) =>
      onContextMenu(e, { owner: row.owner, name: row.name, isStarred }),
    [onContextMenu, row.owner, row.name, isStarred],
  )

  return (
    <button
      className={`library-sidebar-item${selected ? ' selected' : ''}${isInstalled ? ' installed' : ' uninstalled'}${learning ? ' learning' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${row.owner}/${row.name}`}
    >
      <span className="library-sidebar-avatar">
        {row.avatar_url
          ? <img src={row.avatar_url} alt="" loading="lazy" decoding="async" />
          : <span className="library-sidebar-avatar-fallback">{(row.name?.[0] ?? '?').toUpperCase()}</span>
        }
      </span>
      <span className="library-sidebar-name">{row.name}</span>
      {learning
        ? <span className="library-sidebar-percent">{percent}%</span>
        : <span className="library-sidebar-type-icon"><GitHubIcon /></span>}
      {learning && (
        <span className="library-sidebar-progress">
          <span className="library-sidebar-progress-fill" style={{ width: `${percent}%` }} />
        </span>
      )}
    </button>
  )
})
