import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import RepoDetail from '../views/RepoDetail'

export default function RepoOverlay() {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="repo-overlay">
      <RepoDetail />
    </div>
  )
}
