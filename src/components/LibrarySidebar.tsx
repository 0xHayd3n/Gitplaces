// src/components/LibrarySidebar.tsx
import { useState, useMemo } from 'react'
import { Layers, Brain, User, History, Archive } from 'lucide-react'
import './LibrarySidebar.css'
import type { LibraryRow, StarredRepoRow, RepoRow } from '../types/repo'
import type { LibraryEntry, LocalProject, ActiveSegment } from '../types/library'
import type { RecentEntry } from '../lib/recentVisits'
import { filterLibraryEntries } from '../lib/libraryFilter'
import RepoContextMenu, { type RepoContextMenuTarget } from './RepoContextMenu'

export type { ActiveSegment }

interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  localProjects: LocalProject[]
  archivedSet: Set<string>
  recentVisits: RecentEntry[]
  githubUsername: string | null
  selectedId: string | null
  selectedLocalPath: string | null
  activeSegment: ActiveSegment
  onSegmentChange: (s: ActiveSegment) => void
  onSelect: (row: RepoRow, isInstalled: boolean) => void
  onSelectLocal: (project: LocalProject) => void
}

function DashedStar({ size = 11 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="2 1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.7 4.1L8 10.77l-3.7 1.96.7-4.1-3-2.93 4.15-.6z" />
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

const EMPTY_STATES: Record<ActiveSegment, string> = {
  all: 'No repos or projects',
  active: 'No active skills',
  unstarred: 'Nothing unstarred in the last 30 days',
  own: 'No repos or projects owned by you',
  recent: 'Nothing viewed recently',
  archive: 'Nothing archived',
}

const SEGMENTS: { id: ActiveSegment; icon: React.ReactNode; label: string }[] = [
  { id: 'all',       icon: <Layers size={12} />,   label: 'All' },
  { id: 'active',    icon: <Brain size={12} />,    label: 'Learned' },
  { id: 'unstarred', icon: <DashedStar size={11} />, label: 'Unstarred' },
  { id: 'own',       icon: <User size={12} />,     label: 'Own' },
  { id: 'recent',    icon: <History size={12} />,  label: 'Recent' },
  { id: 'archive',   icon: <Archive size={12} />,  label: 'Archive' },
]

export default function LibrarySidebar({
  installedRows, starredRows, unstarredRows, localProjects,
  archivedSet, recentVisits, githubUsername,
  selectedId, selectedLocalPath, activeSegment, onSegmentChange, onSelect, onSelectLocal,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; target: RepoContextMenuTarget } | null>(null)

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

  const visible = useMemo(
    () => filterLibraryEntries(allEntries, activeSegment, { archivedSet, recentVisits, githubUsername, unstarredRows }),
    [allEntries, activeSegment, archivedSet, recentVisits, githubUsername, unstarredRows],
  )

  const handleRepoContextMenu = (e: React.MouseEvent, entry: LibraryEntry & { kind: 'repo' }) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { owner: entry.row.owner, name: entry.row.name, isStarred: entry.isStarred },
    })
  }

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar-header">REPOSITORIES</div>
      <div className="library-sidebar-filter">
        {SEGMENTS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`library-sidebar-seg${activeSegment === id ? ' active' : ''}`}
            onClick={() => onSegmentChange(id)}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="library-sidebar-list">
        {visible.length === 0 && (
          <div className="library-sidebar-empty">{EMPTY_STATES[activeSegment]}</div>
        )}
        {visible.map(entry => {
          if (entry.kind === 'repo') {
            const { row, isInstalled } = entry
            return (
              <button
                key={row.id}
                className={`library-sidebar-item${selectedId === row.id ? ' selected' : ''}${isInstalled ? ' installed' : ' uninstalled'}`}
                onClick={() => onSelect(row, isInstalled)}
                onContextMenu={e => handleRepoContextMenu(e, entry)}
                title={`${row.owner}/${row.name}`}
              >
                <span className="library-sidebar-avatar">
                  {row.avatar_url
                    ? <img src={row.avatar_url} alt="" />
                    : <span className="library-sidebar-avatar-fallback">{(row.name?.[0] ?? '?').toUpperCase()}</span>
                  }
                </span>
                <span className="library-sidebar-name">{row.name}</span>
                <span className="library-sidebar-type-icon">
                  <GitHubIcon />
                </span>
              </button>
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
      </div>

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
