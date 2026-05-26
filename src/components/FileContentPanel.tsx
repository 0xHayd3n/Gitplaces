import { lazy, Suspense } from 'react'
import { detectLanguage } from '../utils/detectLanguage'
import { isImageFile, isVideoFile, isPdfFile } from './files/fileTypes'
import { ImagePreview, VideoPlayer, FileMetaView } from './files/fileViewers'
import CodeToolbar from './CodeToolbar'

const CodeViewer = lazy(() => import('./CodeViewer'))
const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))
const PdfViewer = lazy(() => import('./PdfViewer'))

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

const MD_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MD_EXTENSIONS.has(ext)
}

function isBinaryContent(content: string): boolean {
  // Check first 512 chars for null bytes (indicates binary)
  const sample = content.slice(0, 512)
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return true
  }
  return false
}

interface Props {
  selectedPath: string | null
  selectedEntry: TreeEntry | null
  blobContent: string | null
  blobRawBase64: string | null
  blobLoading: boolean
  owner: string
  name: string
  branch: string
  dirEntries: TreeEntry[] | null
  onSelectEntry: (entry: TreeEntry, fullPath: string) => void
  onNavigateToFile?: (path: string) => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  lineCount: number
  onLineCountReady: (count: number) => void
  viewMode?: string
  sortField?: string
  sortDirection?: string
  filterText?: string
  treeData?: Map<string, TreeEntry[]>
  onContextMenu?: (e: React.MouseEvent, entry: TreeEntry, fullPath: string) => void
}

export default function FileContentPanel({
  selectedPath, selectedEntry, blobContent, blobRawBase64, blobLoading,
  owner, name, branch,
  onNavigateToFile,
  wordWrap, onToggleWordWrap, lineCount, onLineCountReady,
}: Props) {
  if (!selectedPath) {
    return (
      <div className="file-content-empty">
        <p>Select a file to view its contents</p>
      </div>
    )
  }

  const filename = selectedPath.split('/').pop() ?? ''
  const basePath = selectedPath.split('/').slice(0, -1).join('/')


  const rawUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${selectedPath}`
  const isSvg = filename.split('.').pop()?.toLowerCase() === 'svg'
  const isCodeFile = selectedEntry?.type === 'blob' && blobContent !== null && !isBinaryContent(blobContent) && !isImageFile(filename) && !isVideoFile(filename) && !isPdfFile(filename) && !isMarkdownFile(filename) && !blobLoading
  const lang = isCodeFile ? detectLanguage(filename) : 'text'

  return (
    <div className="file-content-panel">
      {isCodeFile && (
        <CodeToolbar
          language={lang}
          lineCount={lineCount}
          fileSize={selectedEntry?.size ?? 0}
          wordWrap={wordWrap}
          onToggleWordWrap={onToggleWordWrap}
          content={blobContent ?? undefined}
        />
      )}

      {isImageFile(filename) ? (
        isSvg && blobLoading ? (
          <div className="file-content-panel__loading">
            <span className="spin-ring" style={{ width: 14, height: 14 }} />
          </div>
        ) : (
          <ImagePreview rawUrl={rawUrl} filename={filename} blobContent={blobContent} />
        )
      ) : isVideoFile(filename) ? (
        <VideoPlayer rawUrl={rawUrl} filename={filename} />
      ) : isPdfFile(filename) && selectedPath ? (
        <Suspense fallback={<div style={{ minHeight: 300 }}>Loading PDF viewer…</div>}>
          <PdfViewer owner={owner} name={name} branch={branch} path={selectedPath} />
        </Suspense>
      ) : blobLoading ? (
        <div className="file-content-panel__loading">
          <span className="spin-ring" style={{ width: 14, height: 14 }} />
        </div>
      ) : blobContent === null ? (
        <FileMetaView
          filename={filename}
          size={selectedEntry?.size}
          owner={owner}
          name={name}
          branch={branch}
          path={selectedPath}
        />
      ) : isBinaryContent(blobContent) ? (
        <FileMetaView
          filename={filename}
          size={selectedEntry?.size}
          owner={owner}
          name={name}
          branch={branch}
          path={selectedPath}
        />
      ) : isMarkdownFile(filename) ? (
        <Suspense fallback={<div style={{ minHeight: 200 }} />}>
          <ReadmeRenderer
            content={blobContent}
            repoOwner={owner}
            repoName={name}
            branch={branch}
            basePath={basePath}
            onNavigateToFile={onNavigateToFile}
          />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <CodeViewer content={blobContent} filename={filename} wordWrap={wordWrap} onLineCountReady={onLineCountReady} />
        </Suspense>
      )}
    </div>
  )
}
