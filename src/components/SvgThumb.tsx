import { useState, useEffect } from 'react'
import FileIcon from './FileIcon'

// Keyed by blob SHA (content-addressed, so safe to share across repos)
const svgCache = new Map<string, string>()
const listeners = new Set<() => void>()

export function populateSvgCache(data: Record<string, string>) {
  let added = 0
  for (const [sha, content] of Object.entries(data)) {
    if (content && !svgCache.has(sha)) {
      svgCache.set(sha, content)
      added++
    }
  }
  if (added > 0) listeners.forEach(fn => fn())
}

interface Props {
  owner: string
  name: string
  sha: string
  filename: string
  size: number
  className?: string
}

export default function SvgThumb({ sha, filename, size, className }: Props) {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const notify = () => forceUpdate(v => v + 1)
    listeners.add(notify)
    return () => { listeners.delete(notify) }
  }, [])

  const content = svgCache.get(sha)
  if (!content) {
    return <FileIcon filename={filename} size={size} className={className} />
  }

  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
      width={size}
      height={size}
      alt=""
      style={{ objectFit: 'contain', display: 'block' }}
      className={className}
    />
  )
}
