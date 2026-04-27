import { useState } from 'react'
import './LibrarySidebar.css'
import { Layers, Brain } from 'lucide-react'
import type { LibraryRow, StarredRepoRow, RepoRow } from '../types/repo'
import RepoContextMenu, { type RepoContextMenuTarget } from './RepoContextMenu'

type ActiveSegment = 'all' | 'active' | 'unstarred'

interface SidebarEntry {
  row: RepoRow
  isInstalled: boolean
  isStarred: boolean
}

interface Props {
  installedRows: LibraryRow[]
  starredRows: StarredRepoRow[]
  unstarredRows: StarredRepoRow[]
  selectedId: string | null
  activeSegment: ActiveSegment
  onSegmentChange: (s: ActiveSegment) => void
  onSelect: (row: RepoRow, isInstalled: boolean) => void
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

export default function LibrarySidebar({
  installedRows, starredRows, unstarredRows, selectedId, activeSegment, onSegmentChange, onSelect,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; target: RepoContextMenuTarget } | null>(null)

  // Build the entry list for the current segment.
  // - 'all' / 'active': merge installedRows + starredRows (starred-but-uninstalled), preserving
  //   starred_at DESC order from the API. Installed rows go first since they have richer data.
  // - 'unstarred': use unstarredRows directly (already ordered by unstarred_at DESC).
  const entries: SidebarEntry[] = (() => {
    if (activeSegment === 'unstarred') {
      return unstarredRows.map(row => ({ row, isInstalled: false, isStarred: false }))
    }
    const map = new Map<string, SidebarEntry>()
    for (const row of installedRows) {
      map.set(row.id, { row, isInstalled: true, isStarred: row.starred_at != null })
    }
    for (const row of starredRows) {
      if (!map.has(row.id)) {
        map.set(row.id, { row, isInstalled: false, isStarred: true })
      }
    }
    return Array.from(map.values())
  })()

  const visible = entries.filter(({ row, isInstalled }) => {
    if (activeSegment === 'all') return true
    if (activeSegment === 'unstarred') return true
    if (activeSegment === 'active') return isInstalled && (row as LibraryRow).active === 1
    return false
  })

  const handleContextMenu = (e: React.MouseEvent, entry: SidebarEntry) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { owner: entry.row.owner, name: entry.row.name, isStarred: entry.isStarred },
    })
  }

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar-filter">
        <button
          className={`library-sidebar-seg${activeSegment === 'all' ? ' active' : ''}`}
          onClick={() => onSegmentChange('all')}
        >
          <Layers size={11} />
          All
        </button>
        <button
          className={`library-sidebar-seg${activeSegment === 'active' ? ' active' : ''}`}
          onClick={() => onSegmentChange('active')}
        >
          <Brain size={11} />
          Learned
        </button>
        <button
          className={`library-sidebar-seg${activeSegment === 'unstarred' ? ' active' : ''}`}
          onClick={() => onSegmentChange('unstarred')}
          title="Recently unstarred (last 30 days)"
        >
          <DashedStar size={11} />
          Unstarred
        </button>
      </div>

      <div className="library-sidebar-list">
        {visible.length === 0 && (
          <div className="library-sidebar-empty">
            {activeSegment === 'unstarred' ? 'Nothing unstarred in the last 30 days' : 'No repos'}
          </div>
        )}
        {visible.map(entry => {
          const { row, isInstalled } = entry
          return (
            <button
              key={row.id}
              className={`library-sidebar-item${selectedId === row.id ? ' selected' : ''}${isInstalled ? ' installed' : ' uninstalled'}`}
              onClick={() => onSelect(row, isInstalled)}
              onContextMenu={e => handleContextMenu(e, entry)}
              title={`${row.owner}/${row.name}`}
            >
              <span className="library-sidebar-avatar">
                {row.avatar_url
                  ? <img src={row.avatar_url} alt="" />
                  : <span className="library-sidebar-avatar-fallback">{(row.name?.[0] ?? '?').toUpperCase()}</span>
                }
              </span>
              <span className="library-sidebar-name">{row.name}</span>
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
