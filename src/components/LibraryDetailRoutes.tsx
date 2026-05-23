import { useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation, type Location } from 'react-router-dom'
import RepoDetail from '../views/RepoDetail'
import CollectionDetail from '../views/CollectionDetail'
import AgentDetail from '../views/AgentDetail'
import CreateAgentPanel from './CreateAgentPanel'
import './LibraryDetailRoutes.css'

const TRANSITION_HOLD_MS = 220

export default function LibraryDetailRoutes() {
  const location = useLocation()
  const [current, setCurrent] = useState<Location>(location)
  const [leaving, setLeaving] = useState<Location | null>(null)

  const currentRef = useRef(current)

  useEffect(() => {
    if (location.pathname === currentRef.current.pathname) return
    setLeaving(currentRef.current)
    setCurrent(location)
    currentRef.current = location
    const t = setTimeout(() => setLeaving(null), TRANSITION_HOLD_MS)
    return () => clearTimeout(t)
  }, [location.pathname])

  return (
    <div className="detail-stack">
      {leaving && (
        <div className="detail-layer detail-layer--leaving" aria-hidden="true">
          <Routes location={leaving}>
            <Route path="repo/:owner/:name" element={<RepoDetail />} />
            <Route path="collection/:id" element={<CollectionDetail />} />
            <Route path="agent/new" element={<CreateAgentPanel />} />
            <Route path="agent/:id" element={<AgentDetail />} />
          </Routes>
        </div>
      )}
      <div className={`detail-layer ${leaving ? 'detail-layer--entering' : 'detail-layer--idle'}`}>
        <Routes location={current}>
          <Route path="repo/:owner/:name" element={<RepoDetail />} />
          <Route path="collection/:id" element={<CollectionDetail />} />
          <Route path="agent/new" element={<CreateAgentPanel />} />
          <Route path="agent/:id" element={<AgentDetail />} />
        </Routes>
      </div>
    </div>
  )
}
