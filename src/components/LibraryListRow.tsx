import { useState } from 'react'
import { GitFork, ArrowUpCircle } from 'lucide-react'
import type { LibrarySavedRepo } from '../types/repo'
import UpdateModal from './UpdateModal'
import './LibraryListRow.css'

export default function LibraryListRow({
  row, selected, onSelect,
}: {
  row: LibrarySavedRepo
  selected: boolean
  onSelect: () => void
}) {
  const [showUpdate, setShowUpdate] = useState(false)
  const hasUpdate = row.updateAvailable === 1
  const isFork = row.isForked === 1

  return (
    <>
      <div
        className={`library-row${selected ? ' selected' : ''}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      >
        <div className="library-row-info">
          <span className={`library-row-name${hasUpdate ? ' update-available' : ''}`}>{row.name}</span>
          <span className="library-row-owner">{row.owner}</span>
        </div>
        <div className="library-row-indicators">
          {isFork && <GitFork size={11} className="library-indicator-fork" aria-label="Forked repo" />}
          {hasUpdate && (
            <button
              className="library-update-btn"
              onClick={(e) => { e.stopPropagation(); setShowUpdate(true) }}
              aria-label="Update available"
            >
              <ArrowUpCircle size={13} />
            </button>
          )}
        </div>
      </div>
      {showUpdate && (
        <UpdateModal repoId={String(row.hostNativeId)} owner={row.owner} name={row.name} isFork={isFork} onClose={() => setShowUpdate(false)} />
      )}
    </>
  )
}
