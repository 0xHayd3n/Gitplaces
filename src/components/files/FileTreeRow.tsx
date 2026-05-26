import { memo } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import FileIcon from '../FileIcon'
import SvgThumb from '../SvgThumb'
import type { VisibleRow, LastCommitInfo, GitFileStatus, Density } from '../../lib/fileTree/types'
import { DENSITY_PX } from '../../lib/fileTree/types'
import './FileTreeRow.css'

interface Props {
  row: VisibleRow
  density: Density
  isFocused: boolean
  isSelected: boolean
  lastCommit: LastCommitInfo | null | undefined
  gitStatus: GitFileStatus | undefined
  owner: string
  name: string
  width: number
  variant?: 'tree' | 'listing'  // 'tree' = icon + name only; 'listing' = full columns. Default 'tree'.
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onSegmentClick?: (depth: number) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateModified(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  let hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`
}

function fileTypeLabel(path: string, isDir: boolean): string {
  if (isDir) return 'Folder'
  const ext = path.split('.').pop()?.toUpperCase() ?? ''
  return ext || 'File'
}

const STATUS_COLOR: Record<GitFileStatus, string> = {
  added: '#22c55e',
  modified: '#f59e0b',
  removed: '#ef4444',
  renamed: '#3b82f6',
}

function FileTreeRow({
  row, density, isFocused, isSelected, lastCommit, gitStatus,
  owner, name, width, variant = 'tree', onClick, onContextMenu, onSegmentClick,
}: Props) {
  const height = DENSITY_PX[density]
  const isDir = row.type === 'tree'
  const ext = row.path.split('.').pop()?.toLowerCase() ?? ''
  const showAuthor = width >= 320
  const showMessage = width >= 280

  const nameContent = (
    <span className="file-row__namecol">
      {variant === 'tree' && (
        isDir ? (
          <ChevronRight
            size={12}
            className={'file-row__chevron' + (row.isExpanded ? ' file-row__chevron--expanded' : '')}
          />
        ) : (
          <span className="file-row__chevron-spacer" />
        )
      )}
      {isDir ? (
        <Folder size={14} className="file-row__icon file-row__icon--folder" />
      ) : ext === 'svg' ? (
        <SvgThumb owner={owner} name={name} sha={row.sha} filename={row.path} size={14} className="file-row__icon" />
      ) : (
        <FileIcon filename={row.path} size={14} className="file-row__icon" />
      )}
      <span className="file-row__name">
        {row.isFlattened && row.flattenedSegments && onSegmentClick
          ? row.flattenedSegments.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span className="file-row__segment-sep">/</span>}
                <button
                  className="file-row__segment"
                  onClick={(e) => { e.stopPropagation(); onSegmentClick(i) }}
                >
                  {seg}
                </button>
              </span>
            ))
          : renderWithHighlight(row.name, row.matchRanges)}
      </span>
    </span>
  )

  return (
    <div
      role="treeitem"
      tabIndex={isFocused ? 0 : -1}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={isDir ? row.isExpanded : undefined}
      aria-selected={isSelected}
      data-path={row.path}
      data-variant={variant}
      className={
        'file-row' +
        (isFocused ? ' file-row--focused' : '') +
        (isSelected ? ' file-row--selected' : '')
      }
      style={{ height, paddingLeft: variant === 'listing' ? undefined : 8 + row.depth * 16 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {gitStatus && (
        <span
          className="file-row__status-dot"
          title={gitStatus}
          style={{ backgroundColor: STATUS_COLOR[gitStatus] }}
        />
      )}
      {nameContent}
      {variant === 'listing' && (
        <>
          <span className="file-row__date">{lastCommit ? formatDateModified(lastCommit.committed_at) : ''}</span>
          <span className="file-row__type">{fileTypeLabel(row.path, isDir)}</span>
          <span className="file-row__size">{!isDir && row.size != null ? formatBytes(row.size) : ''}</span>
          <span className="file-row__author">
            <span className="file-row__author-name">{lastCommit?.author_login ?? ''}</span>
          </span>
        </>
      )}
    </div>
  )
}

function renderWithHighlight(text: string, ranges?: [number, number][]): React.ReactNode {
  if (!ranges || ranges.length === 0) return text
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i]
    if (cursor < start) parts.push(text.slice(cursor, start))
    parts.push(<mark key={i} className="file-row__match">{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

export default memo(FileTreeRow)
