import { useEffect, useRef } from 'react'
import { Star, StarOff, Brain, GitBranch, GitFork } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../contexts/Toast'

export interface RepoContextMenuTarget {
  owner: string
  name: string
  isStarred: boolean
}

interface Props {
  x: number
  y: number
  target: RepoContextMenuTarget
  onClose: () => void
}

export default function RepoContextMenu({ x, y, target, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { toast } = useToast()

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleScroll = () => onClose()

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  const handleToggleStar = async () => {
    try {
      if (target.isStarred) {
        await window.api.github.unstarRepo(target.owner, target.name)
      } else {
        await window.api.github.starRepo(target.owner, target.name)
      }
      window.dispatchEvent(new CustomEvent('library:changed'))
      onClose()
    } catch {
      toast(target.isStarred ? 'Failed to unstar — check connection' : 'Failed to star — check connection', 'error')
    }
  }

  const handleLearn = () => {
    navigate(`/library/repo/${target.owner}/${target.name}`)
    onClose()
  }

  const handleClone = () => {
    navigate(`/library/repo/${target.owner}/${target.name}`, { state: { openClone: true } })
    onClose()
  }

  const handleFork = () => {
    window.api.openExternal(`https://github.com/${target.owner}/${target.name}/fork`)
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 180),
    zIndex: 9999,
  }

  return (
    <div ref={menuRef} className="ctx-menu" style={style}>
      <button className="ctx-menu__item" onClick={handleToggleStar}>
        {target.isStarred ? <StarOff size={14} /> : <Star size={14} />}
        <span>{target.isStarred ? 'Unstar' : 'Star'}</span>
      </button>
      <button className="ctx-menu__item" onClick={handleLearn}>
        <Brain size={14} />
        <span>Learn</span>
      </button>
      <button className="ctx-menu__item" onClick={handleClone}>
        <GitBranch size={14} />
        <span>Clone</span>
      </button>
      <button className="ctx-menu__item" onClick={handleFork}>
        <GitFork size={14} />
        <span>Fork</span>
      </button>
    </div>
  )
}
