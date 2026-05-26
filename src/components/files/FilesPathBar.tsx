import { Home } from 'lucide-react'
import './FilesPathBar.css'

interface Props {
  path: string
  onNavigate: (path: string) => void
  rightSlot?: React.ReactNode
}

export default function FilesPathBar({ path, onNavigate, rightSlot }: Props) {
  const segments = path ? path.split('/') : []
  const atRoot = segments.length === 0

  return (
    <div className="files-path-bar">
      <div className="files-path-bar__crumbs">
        <button
          className={
            'files-path-bar__segment files-path-bar__home' +
            (atRoot ? ' files-path-bar__segment--current' : '')
          }
          onClick={() => onNavigate('')}
          disabled={atRoot}
          title="Repository root"
        >
          <Home size={12} />
        </button>
        {segments.map((seg, i) => {
          const segPath = segments.slice(0, i + 1).join('/')
          const isLast = i === segments.length - 1
          return (
            <span key={i} className="files-path-bar__row">
              <span className="files-path-bar__sep">/</span>
              {isLast ? (
                <span className="files-path-bar__segment files-path-bar__segment--current">{seg}</span>
              ) : (
                <button
                  className="files-path-bar__segment"
                  onClick={() => onNavigate(segPath)}
                >
                  {seg}
                </button>
              )}
            </span>
          )
        })}
      </div>
      {rightSlot && <div className="files-path-bar__right">{rightSlot}</div>}
    </div>
  )
}
