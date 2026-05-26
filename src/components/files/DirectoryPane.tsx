import { useCallback, useMemo, useRef } from 'react'
import FileTreeRow from './FileTreeRow'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import type { TreeEntry, LastCommitInfo, GitFileStatus, Density, VisibleRow } from '../../lib/fileTree/types'
import './DirectoryPane.css'

interface Props {
  entries: TreeEntry[]
  basePath: string
  density: Density
  selected: Set<string>
  getLastCommit: (path: string) => LastCommitInfo | null | undefined
  getGitStatus: (path: string) => GitFileStatus | undefined
  owner: string
  name: string
  width: number
  onRowClick: (entry: TreeEntry, fullPath: string, e: React.MouseEvent) => void
  onRowContextMenu: (entry: TreeEntry, fullPath: string, e: React.MouseEvent) => void
}

type ColKey = 'name' | 'desc' | 'type' | 'size' | 'author' | 'age'

interface ColWidths {
  name: number
  desc: number
  type: number
  size: number
  author: number
  age: number
}

const DEFAULT_WIDTHS: ColWidths = {
  name: 260,
  desc: 320,
  type: 60,
  size: 72,
  author: 130,
  age: 72,
}

const MIN_WIDTHS: Record<ColKey, number> = {
  name: 100, desc: 60, type: 40, size: 48, author: 60, age: 48,
}

export default function DirectoryPane(props: Props) {
  const [colWidths, setColWidths] = useLocalStorage<ColWidths>('files:dirColWidths', DEFAULT_WIDTHS)
  const dragRef = useRef<{ col: ColKey; startX: number; startWidth: number } | null>(null)

  const sorted = useMemo(() => {
    return [...props.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
      return a.path.localeCompare(b.path)
    })
  }, [props.entries])

  const onPointerDown = useCallback((col: ColKey) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { col, startX: e.clientX, startWidth: colWidths[col] }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [colWidths])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const delta = e.clientX - d.startX
    const next = Math.max(MIN_WIDTHS[d.col], d.startWidth + delta)
    setColWidths(prev => ({ ...prev, [d.col]: next }))
  }, [setColWidths])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      dragRef.current = null
    }
  }, [])

  const gridTemplate =
    `${colWidths.name}px ${colWidths.desc}px ${colWidths.type}px ${colWidths.size}px ${colWidths.author}px ${colWidths.age}px 1fr`

  const cssVars = { '--dp-grid': gridTemplate } as React.CSSProperties

  if (sorted.length === 0) {
    return <div className="directory-pane directory-pane--empty">This folder is empty</div>
  }

  const handle = (col: ColKey) => (
    <span
      className="directory-pane__resize"
      onPointerDown={onPointerDown(col)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )

  return (
    <div className="directory-pane" style={cssVars}>
      <div className="directory-pane__header">
        <span className="directory-pane__h-cell directory-pane__h-name">Name{handle('name')}</span>
        <span className="directory-pane__h-cell directory-pane__h-desc">Description{handle('desc')}</span>
        <span className="directory-pane__h-cell directory-pane__h-type">Type{handle('type')}</span>
        <span className="directory-pane__h-cell directory-pane__h-size">Size{handle('size')}</span>
        <span className="directory-pane__h-cell directory-pane__h-author">Author{handle('author')}</span>
        <span className="directory-pane__h-cell directory-pane__h-age">Age{handle('age')}</span>
        <span className="directory-pane__h-cell" />
      </div>
      {sorted.map((entry, i) => {
        const fullPath = props.basePath ? `${props.basePath}/${entry.path}` : entry.path
        const row: VisibleRow = {
          path: fullPath,
          type: entry.type,
          name: entry.path,
          depth: 0,
          sha: entry.sha,
          size: entry.size,
          isExpanded: false,
          isFlattened: false,
          level: 1,
          posInSet: i + 1,
          setSize: sorted.length,
        }
        return (
          <FileTreeRow
            key={entry.sha + entry.path}
            row={row}
            variant="listing"
            density={props.density}
            isFocused={false}
            isSelected={props.selected.has(fullPath)}
            lastCommit={props.getLastCommit(fullPath)}
            gitStatus={props.getGitStatus(fullPath)}
            owner={props.owner}
            name={props.name}
            width={props.width}
            onClick={e => props.onRowClick(entry, fullPath, e)}
            onContextMenu={e => props.onRowContextMenu(entry, fullPath, e)}
          />
        )
      })}
    </div>
  )
}
