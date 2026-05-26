import { useMemo } from 'react'
import FileTreeRow from './FileTreeRow'
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

export default function DirectoryPane(props: Props) {
  const sorted = useMemo(() => {
    return [...props.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
      return a.path.localeCompare(b.path)
    })
  }, [props.entries])

  if (sorted.length === 0) {
    return <div className="directory-pane directory-pane--empty">This folder is empty</div>
  }

  return (
    <div className="directory-pane">
      <div className="directory-pane__header">
        <span className="directory-pane__h-name">Name</span>
        <span className="directory-pane__h-desc">Description</span>
        <span className="directory-pane__h-type">Type</span>
        <span className="directory-pane__h-size">Size</span>
        <span className="directory-pane__h-author">Author</span>
        <span className="directory-pane__h-age">Age</span>
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
