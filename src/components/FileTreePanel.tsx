import { memo } from 'react'
import { ChevronRight, Folder, BookOpen } from 'lucide-react'
import FileIcon from './FileIcon'
import SvgThumb from './SvgThumb'

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

interface Props {
  entries: TreeEntry[]
  expandedDirs: Map<string, string>   // path → treeSha
  treeData: Map<string, TreeEntry[]>  // treeSha → entries
  treeLoading: Set<string>            // paths currently loading
  errorDirs: Set<string>              // paths that failed to load
  selectedPath: string | null
  basePath: string                    // '' for root
  depth: number
  owner: string
  name: string
  onToggleDir: (path: string, sha: string) => void
  onSelectFile: (entry: TreeEntry, fullPath: string) => void
  filterText?: string
  onContextMenu?: (e: React.MouseEvent, entry: TreeEntry, fullPath: string) => void
}

const MD_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

function isMdFolder(sha: string, treeData: Map<string, TreeEntry[]>): boolean {
  const children = treeData.get(sha)
  if (!children) return false
  let count = 0
  for (const c of children) {
    if (c.type === 'blob') {
      const ext = c.path.split('.').pop()?.toLowerCase() ?? ''
      if (MD_EXTENSIONS.has(ext)) {
        count++
        if (count >= 2) return true
      }
    }
  }
  return false
}

function hasMatchingDescendant(sha: string, filter: string, treeData: Map<string, TreeEntry[]>): boolean {
  const children = treeData.get(sha)
  if (!children) return false
  return children.some(c => {
    if (c.path.toLowerCase().includes(filter)) return true
    if (c.type === 'tree') return hasMatchingDescendant(c.sha, filter, treeData)
    return false
  })
}

function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

function FileTreePanel({
  entries, expandedDirs, treeData, treeLoading, errorDirs, selectedPath,
  basePath, depth, owner, name, onToggleDir, onSelectFile, filterText, onContextMenu,
}: Props) {
  const sorted = sortEntries(entries)

  const lowerFilter = filterText?.toLowerCase() ?? ''
  const filtered = filterText
    ? sorted.filter(entry => {
        if (entry.path.toLowerCase().includes(lowerFilter)) return true
        if (entry.type === 'tree') return hasMatchingDescendant(entry.sha, lowerFilter, treeData)
        return false
      })
    : sorted

  return (
    <div className="file-tree" role="tree">
      {filtered.map(entry => {
        const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
        const isDir = entry.type === 'tree'
        const isExpanded = expandedDirs.has(fullPath)
        const isSelected = selectedPath === fullPath
        const isLoading = treeLoading.has(fullPath)
        const childEntries = isExpanded ? treeData.get(entry.sha) : undefined
        const dotIdx = entry.path.lastIndexOf('.')
        const baseName = isDir ? entry.path : (dotIdx > 0 ? entry.path.slice(0, dotIdx) : entry.path)
        const ext = isDir ? '' : (dotIdx > 0 ? entry.path.slice(dotIdx) : '')
        const childCount = isDir ? treeData.get(entry.sha)?.length : undefined

        return (
          <div key={entry.sha + entry.path} role="treeitem">
            <button
              className={`file-tree__node${isSelected ? ' file-tree__node--selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => {
                if (isDir) {
                  onToggleDir(fullPath, entry.sha)
                } else {
                  onSelectFile(entry, fullPath)
                }
              }}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry, fullPath) : undefined}
            >
              {Array.from({ length: depth }, (_, i) => (
                <span
                  key={i}
                  className="file-tree__indent-guide"
                  style={{ left: 14 + i * 16 }}
                />
              ))}
              {isDir ? (
                errorDirs.has(fullPath) ? (
                  <span style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--red)', fontSize: 11, textAlign: 'center' }} title="Failed to load — click to retry">!</span>
                ) : isLoading ? (
                  <span className="spin-ring" style={{ width: 10, height: 10, flexShrink: 0 }} />
                ) : (
                  <ChevronRight
                    size={14}
                    className={`file-tree__chevron${isExpanded ? ' file-tree__chevron--expanded' : ''}`}
                  />
                )
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              {isDir ? (
                isMdFolder(entry.sha, treeData) ? (
                  <BookOpen size={14} className="file-tree__icon" style={{ color: '#3b82f6' }} />
                ) : (
                  <Folder size={14} className="file-tree__icon file-tree__icon--folder" />
                )
              ) : (
                entry.path.split('.').pop()?.toLowerCase() === 'svg' ? (
                  <SvgThumb owner={owner} name={name} sha={entry.sha} filename={entry.path} size={14} className="file-tree__icon" />
                ) : (
                  <FileIcon filename={entry.path} size={14} className="file-tree__icon" />
                )
              )}
              {isDir ? (
                <>
                  <span className="file-tree__name file-tree__name--folder">{entry.path}</span>
                  {!isExpanded && childCount !== undefined && childCount > 0 && (
                    <span className="file-tree__count">{childCount}</span>
                  )}
                </>
              ) : (
                <span className="file-tree__name">
                  {baseName}<span className="file-tree__ext">{ext}</span>
                </span>
              )}
            </button>
            {isDir && isExpanded && childEntries && (
              <FileTreePanel
                entries={childEntries}
                expandedDirs={expandedDirs}
                treeData={treeData}
                treeLoading={treeLoading}
                errorDirs={errorDirs}
                selectedPath={selectedPath}
                basePath={fullPath}
                depth={depth + 1}
                owner={owner}
                name={name}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                filterText={filterText}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default memo(FileTreePanel)
