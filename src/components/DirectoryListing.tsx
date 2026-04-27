import { useMemo } from 'react'
import { Folder, ChevronRight, Image as ImageIcon, FileQuestion, Play, BookOpen } from 'lucide-react'
import FileIcon from './FileIcon'
import SvgThumb from './SvgThumb'
import type { ViewMode, SortField, SortDirection } from './ViewModeBar'

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

// ── Directory Listing ──

interface DirectoryListingProps {
  entries: TreeEntry[]
  onSelect: (entry: TreeEntry, fullPath: string) => void
  basePath: string
  viewMode?: ViewMode
  filterText?: string
  sortField?: SortField
  sortDirection?: SortDirection
  owner?: string
  name?: string
  branch?: string
  treeData?: Map<string, TreeEntry[]>  // for smart folder icon detection
  onContextMenu?: (e: React.MouseEvent, entry: TreeEntry, fullPath: string) => void
}

const MD_EXTENSIONS_DIR = new Set(['md', 'mdx', 'markdown'])

function isMdFolder(sha: string, treeData?: Map<string, TreeEntry[]>): boolean {
  if (!treeData) return false
  const children = treeData.get(sha)
  if (!children) return false
  let count = 0
  for (const c of children) {
    if (c.type === 'blob') {
      const ext = c.path.split('.').pop()?.toLowerCase() ?? ''
      if (MD_EXTENSIONS_DIR.has(ext)) {
        count++
        if (count >= 2) return true
      }
    }
  }
  return false
}

function sortEntries(entries: TreeEntry[], field: SortField = 'name', direction: SortDirection = 'asc'): TreeEntry[] {
  return [...entries].sort((a, b) => {
    // Folders always first
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1

    let cmp = 0
    if (field === 'name') {
      cmp = a.path.localeCompare(b.path)
    } else if (field === 'type') {
      const typeA = a.type === 'tree' ? 'Folder' : getFileType(a.path)
      const typeB = b.type === 'tree' ? 'Folder' : getFileType(b.path)
      cmp = typeA.localeCompare(typeB)
      if (cmp === 0) cmp = a.path.localeCompare(b.path)
    } else if (field === 'size') {
      const sizeA = a.size ?? 0
      const sizeB = b.size ?? 0
      cmp = sizeA - sizeB
      if (cmp === 0) cmp = a.path.localeCompare(b.path)
    }

    return direction === 'desc' ? -cmp : cmp
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const EXT_TYPES: Record<string, string> = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  md: 'Markdown', mdx: 'Markdown', markdown: 'Markdown',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
  css: 'Stylesheet', scss: 'Stylesheet', sass: 'Stylesheet', less: 'Stylesheet',
  html: 'HTML', htm: 'HTML', vue: 'Vue', svelte: 'Svelte',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', svg: 'SVG', webp: 'Image', ico: 'Image',
  mp4: 'Video', webm: 'Video', mov: 'Video', ogg: 'Video',
  pdf: 'PDF', txt: 'Text', log: 'Log', csv: 'CSV',
  zip: 'Archive', tar: 'Archive', gz: 'Archive', rar: 'Archive',
  sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL',
  c: 'C', h: 'C Header', cpp: 'C++', hpp: 'C++ Header',
  swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', dart: 'Dart',
  php: 'PHP', lua: 'Lua', zig: 'Zig', r: 'R',
  lock: 'Lock File', diff: 'Diff', patch: 'Patch',
}

function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPES[ext] ?? (ext.toUpperCase() || 'File')
}

const IMAGE_EXTENSIONS_SET = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

export function DirectoryListing({ entries, onSelect, basePath, viewMode = 'details', filterText, sortField = 'name', sortDirection = 'asc', owner, name, branch, treeData, onContextMenu }: DirectoryListingProps) {
  const sortedEntries = useMemo(
    () => sortEntries(entries, sortField, sortDirection),
    [entries, sortField, sortDirection],
  )
  const sorted = useMemo(
    () => filterText ? sortedEntries.filter(e => e.path.toLowerCase().includes(filterText.toLowerCase())) : sortedEntries,
    [sortedEntries, filterText],
  )

  const folderCount = sorted.filter(e => e.type === 'tree').length
  const fileCount = sorted.length - folderCount

  const folderIcon = (entry: TreeEntry, size: number) =>
    isMdFolder(entry.sha, treeData)
      ? <BookOpen size={size} className="dir-listing__icon" style={{ color: '#3b82f6' }} />
      : <Folder size={size} className="dir-listing__icon dir-listing__icon--folder" />

  const fileIcon = (entry: TreeEntry, size: number, cls: string) => {
    const isSvg = entry.path.split('.').pop()?.toLowerCase() === 'svg'
    if (isSvg && owner && name) {
      return <SvgThumb owner={owner} name={name} sha={entry.sha} filename={entry.path} size={size} className={cls} />
    }
    return <FileIcon filename={entry.path} size={size} className={cls} />
  }

  if (sorted.length === 0 && filterText) {
    return (
      <div className="dir-listing dir-listing--empty">
        <p>No matching items</p>
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="dir-listing dir-listing--empty">
        <p>This folder is empty</p>
      </div>
    )
  }

  // ── List view ──
  if (viewMode === 'list') {
    return (
      <div className="dir-listing dir-listing--list">
        {sorted.map(entry => {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
          const isDir = entry.type === 'tree'
          return (
            <button
              key={entry.sha + entry.path}
              className="dir-listing__list-row"
              onClick={() => onSelect(entry, fullPath)}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry, fullPath) : undefined}
            >
              {isDir ? (
                folderIcon(entry, 14)
              ) : (
                fileIcon(entry, 14, 'dir-listing__icon')
              )}
              <span className="dir-listing__name">{entry.path}</span>
            </button>
          )
        })}
      </div>
    )
  }

  // ── Small Icons view ──
  if (viewMode === 'small-icons') {
    return (
      <div className="dir-listing dir-listing--small-icons">
        {sorted.map(entry => {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
          const isDir = entry.type === 'tree'
          return (
            <button
              key={entry.sha + entry.path}
              className="dir-listing__icon-cell"
              title={entry.path}
              onClick={() => onSelect(entry, fullPath)}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry, fullPath) : undefined}
            >
              {isDir ? (
                folderIcon(entry, 16)
              ) : (
                fileIcon(entry, 16, 'dir-listing__icon')
              )}
              <span className="dir-listing__icon-label">{entry.path}</span>
            </button>
          )
        })}
      </div>
    )
  }

  // ── Large Icons view ──
  if (viewMode === 'large-icons') {
    return (
      <div className="dir-listing dir-listing--large-icons">
        {sorted.map(entry => {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
          const isDir = entry.type === 'tree'
          const ext = entry.path.split('.').pop()?.toLowerCase() ?? ''
          const isSvg = ext === 'svg'
          const isOtherImage = !isDir && !isSvg && IMAGE_EXTENSIONS_SET.has(ext)
          const rawUrl = isOtherImage && owner && name && branch
            ? `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${fullPath}`
            : null
          return (
            <button
              key={entry.sha + entry.path}
              className="dir-listing__icon-cell dir-listing__icon-cell--large"
              onClick={() => onSelect(entry, fullPath)}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry, fullPath) : undefined}
            >
              {isDir ? (
                folderIcon(entry, 48)
              ) : isSvg && owner && name ? (
                <SvgThumb owner={owner} name={name} sha={entry.sha} filename={entry.path} size={48} className="dir-listing__thumb" />
              ) : rawUrl ? (
                <img
                  src={rawUrl}
                  alt={entry.path}
                  className="dir-listing__thumb"
                  onError={e => {
                    const target = e.currentTarget
                    target.style.display = 'none'
                    const fallback = target.nextElementSibling as HTMLElement
                    if (fallback) fallback.style.display = ''
                  }}
                />
              ) : (
                <FileIcon filename={entry.path} size={48} className="dir-listing__icon" />
              )}
              {rawUrl && (
                <span className="dir-listing__thumb-fallback" style={{ display: 'none' }}>
                  <FileIcon filename={entry.path} size={48} className="dir-listing__icon" />
                </span>
              )}
              <span className="dir-listing__icon-label dir-listing__icon-label--large">{entry.path}</span>
            </button>
          )
        })}
      </div>
    )
  }

  // ── Details view (default) ──
  return (
    <div className="dir-listing">
      <div className="dir-listing__header">
        <span className="dir-listing__header-name">Name</span>
        <span className="dir-listing__header-type">Type</span>
        <span className="dir-listing__header-size">Size</span>
      </div>
      {sorted.map(entry => {
        const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
        const isDir = entry.type === 'tree'
        return (
          <button
            key={entry.sha + entry.path}
            className="dir-listing__row"
            onClick={() => onSelect(entry, fullPath)}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry, fullPath) : undefined}
          >
            {isDir ? (
              folderIcon(entry, 14)
            ) : (
              fileIcon(entry, 14, 'dir-listing__icon')
            )}
            <span className="dir-listing__name">{entry.path}</span>
            <span className="dir-listing__type">{isDir ? 'Folder' : getFileType(entry.path)}</span>
            <span className="dir-listing__size">
              {!isDir && entry.size != null ? formatSize(entry.size) : isDir ? '—' : ''}
            </span>
            {isDir && <ChevronRight size={12} className="dir-listing__chevron" />}
          </button>
        )
      })}
      <div className="dir-listing__footer">
        {folderCount > 0 && <span>{folderCount} folder{folderCount !== 1 ? 's' : ''}</span>}
        {folderCount > 0 && fileCount > 0 && <span className="dir-listing__footer-sep">&middot;</span>}
        {fileCount > 0 && <span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  )
}

// ── Video Detection ──

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'ogg'])

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogg: 'video/ogg',
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.has(ext)
}

export function isPdfFile(filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf'
}

// ── Image Preview ──

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext)
}

interface ImagePreviewProps {
  rawUrl: string
  filename: string
  blobContent?: string | null
}

export function ImagePreview({ rawUrl, filename, blobContent }: ImagePreviewProps) {
  const isSvg = filename.split('.').pop()?.toLowerCase() === 'svg'

  if (isSvg && blobContent) {
    return (
      <div className="file-image-preview">
        <div className="file-image-preview__container">
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(blobContent)}`}
            alt={filename}
            className="file-image-preview__img"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="file-image-preview">
      <ImageIcon size={14} style={{ color: 'var(--t3)' }} />
      <span className="file-image-preview__name">{filename}</span>
      <div className="file-image-preview__container">
        <img
          src={rawUrl}
          alt={filename}
          className="file-image-preview__img"
        />
      </div>
    </div>
  )
}

// ── Video Player ──

interface VideoPlayerProps {
  rawUrl: string
  filename: string
}

export function VideoPlayer({ rawUrl, filename }: VideoPlayerProps) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = VIDEO_MIME[ext] ?? 'video/mp4'

  return (
    <div className="file-video-player">
      <Play size={14} style={{ color: 'var(--t3)' }} />
      <span className="file-video-player__name">{filename}</span>
      <div className="file-video-player__container">
        <video controls className="file-video-player__video">
          <source src={rawUrl} type={mime} />
          Your browser does not support video playback.
        </video>
      </div>
    </div>
  )
}

// ── File Meta View (fallback) ──

interface FileMetaViewProps {
  filename: string
  size?: number
  owner: string
  name: string
  branch: string
  path: string
}

export function FileMetaView({ filename, size, owner, name, branch, path }: FileMetaViewProps) {
  const githubUrl = `https://github.com/${owner}/${name}/blob/${branch}/${path}`

  return (
    <div className="file-meta-view">
      <FileQuestion size={32} style={{ color: 'var(--t3)' }} />
      <h3 className="file-meta-view__name">{filename}</h3>
      {size != null && <p className="file-meta-view__size">{formatSize(size)}</p>}
      <a
        className="file-meta-view__link"
        href={githubUrl}
        onClick={(e) => {
          e.preventDefault()
          window.api.openExternal(githubUrl)
        }}
      >
        View on GitHub
      </a>
    </div>
  )
}
