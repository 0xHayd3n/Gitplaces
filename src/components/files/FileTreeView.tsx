import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import FileTreeRow from './FileTreeRow'
import type { VisibleRow, LastCommitInfo, GitFileStatus, Density } from '../../lib/fileTree/types'
import { DENSITY_PX } from '../../lib/fileTree/types'
import './FileTreeView.css'

interface Props {
  rows: VisibleRow[]
  density: Density
  focused: string | null
  selected: Set<string>
  getLastCommit: (path: string) => LastCommitInfo | null | undefined
  getGitStatus: (path: string) => GitFileStatus | undefined
  owner: string
  name: string
  width: number
  onRowClick: (row: VisibleRow, e: React.MouseEvent) => void
  onRowContextMenu: (row: VisibleRow, e: React.MouseEvent) => void
  onSegmentClick: (row: VisibleRow, depth: number) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export default function FileTreeView(props: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowHeight = DENSITY_PX[props.density]

  const virtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  })

  const items = virtualizer.getVirtualItems()
  const firstVisibleRow = items.length > 0 ? props.rows[items[0].index] : null

  // Compute ancestor chain of the first visible row for the sticky overlay.
  const stickyAncestors = useMemo(() => {
    if (!firstVisibleRow) return []
    const result: VisibleRow[] = []
    let cursor = firstVisibleRow
    const firstIdx = items[0].index
    for (let i = firstIdx - 1; i >= 0; i--) {
      const r = props.rows[i]
      if (r.type === 'tree' && r.isExpanded && r.depth < cursor.depth) {
        result.unshift(r)
        cursor = r
        if (r.depth === 0) break
      }
    }
    return result
  }, [firstVisibleRow, items, props.rows])

  return (
    <div
      ref={parentRef}
      className="file-tree-view"
      role="tree"
      tabIndex={0}
      onKeyDown={props.onKeyDown}
    >
      <div className="file-tree-view__sticky-overlay" style={{ height: stickyAncestors.length * rowHeight }}>
        {stickyAncestors.map((ancestor, i) => (
          <div
            key={ancestor.path}
            className="file-tree-view__sticky-row"
            style={{ top: i * rowHeight, zIndex: 10 + i }}
          >
            <FileTreeRow
              row={ancestor}
              density={props.density}
              isFocused={false}
              isSelected={props.selected.has(ancestor.path)}
              lastCommit={props.getLastCommit(ancestor.path)}
              gitStatus={props.getGitStatus(ancestor.path)}
              owner={props.owner}
              name={props.name}
              width={props.width}
              onClick={e => props.onRowClick(ancestor, e)}
              onContextMenu={e => props.onRowContextMenu(ancestor, e)}
            />
          </div>
        ))}
      </div>
      <div className="file-tree-view__list" style={{ height: virtualizer.getTotalSize() }}>
        {items.map(item => {
          const row = props.rows[item.index]
          return (
            <div
              key={row.path}
              className="file-tree-view__item"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <FileTreeRow
                row={row}
                density={props.density}
                isFocused={props.focused === row.path}
                isSelected={props.selected.has(row.path)}
                lastCommit={props.getLastCommit(row.path)}
                gitStatus={props.getGitStatus(row.path)}
                owner={props.owner}
                name={props.name}
                width={props.width}
                onClick={e => props.onRowClick(row, e)}
                onContextMenu={e => props.onRowContextMenu(row, e)}
                onSegmentClick={depth => props.onSegmentClick(row, depth)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
