import { useState } from 'react'
import { Boxes, GitFork, ArrowUpCircle } from 'lucide-react'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import type { LibraryRow } from '../types/repo'
import UpdateModal from './UpdateModal'

export interface LibraryCardProps {
  row: LibraryRow
  selected: boolean
  hasSubSkill: boolean
  onSelect: () => void
}

export default function LibraryCard({ row, selected, hasSubSkill, onSelect }: LibraryCardProps) {
  const { openProfile } = useProfileOverlay()
  const [showUpdate, setShowUpdate] = useState(false)
  const hasUpdate = row.update_available === 1
  const isFork = row.is_forked === 1

  return (
    <>
      <div
        className={`library-card${selected ? ' selected' : ''}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      >
        {(hasSubSkill || isFork) && (
          <span className="library-sub-skill-indicator" aria-label="Indicators">
            {hasSubSkill && <Boxes size={12} />}
            {isFork && <GitFork size={12} aria-label="Forked repo" />}
          </span>
        )}

        <div className="library-card-header">
          <div className="library-card-title-block">
            <span className={`library-card-name${hasUpdate ? ' update-available' : ''}`}>{row.name}</span>
            <button
              className="owner-name-btn library-card-owner"
              onClick={(e) => { e.stopPropagation(); openProfile(row.owner) }}
            >
              {row.owner}
            </button>
          </div>
          {hasUpdate && (
            <button
              className="library-update-btn"
              onClick={(e) => { e.stopPropagation(); setShowUpdate(true) }}
              aria-label="Update available"
            >
              <ArrowUpCircle size={14} />
            </button>
          )}
        </div>

        {row.description && (
          <p className="library-card-description">{row.description}</p>
        )}
      </div>
      {showUpdate && (
        <UpdateModal repoId={row.id} owner={row.owner} name={row.name} isFork={isFork} onClose={() => setShowUpdate(false)} />
      )}
    </>
  )
}
