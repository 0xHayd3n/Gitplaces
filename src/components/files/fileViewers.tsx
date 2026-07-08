import { Image as ImageIcon, FileQuestion, Play } from 'lucide-react'
import { VIDEO_MIME } from './fileTypes'
import { formatBytes } from '../../utils/formatBytes'

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
        <img src={rawUrl} alt={filename} className="file-image-preview__img" />
      </div>
    </div>
  )
}

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
      {size != null && <p className="file-meta-view__size">{formatBytes(size)}</p>}
      <a
        className="file-meta-view__link"
        href={githubUrl}
        onClick={(e) => { e.preventDefault(); window.api.openExternal(githubUrl) }}
      >
        View on GitHub
      </a>
    </div>
  )
}
